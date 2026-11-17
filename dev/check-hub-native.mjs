import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { frame, messages, dispatch, MAX_FRAME } from "../hub/native.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "grill-native-"));
const key = JSON.parse(fs.readFileSync(path.join(root, "hub/extension-key.json")));
const origin = `chrome-extension://${key.extensionId}/`;
const configPath = path.join(temporary, "installation.json");
const config = { installationId: randomUUID(), epoch: randomUUID(), secret: randomBytes(32).toString("hex"), extensionId: key.extensionId, nodePath: process.execPath, servicePath: path.join(temporary, "service.mjs"), dataDir: temporary };
const save = () => fs.writeFileSync(configPath, JSON.stringify(config));
const collect = async chunks => { const values = []; for await (const value of messages(Readable.from(chunks))) values.push(value); return values; };
const request = (method = "list") => ({ v: 1, id: "test-1", method, params: {}, installationId: config.installationId, secret: config.secret, epoch: config.epoch });
try {
  save();
  const encoded = frame(request());
  assert.deepEqual(await collect([...encoded].map(byte => Buffer.from([byte]))), [request()]);
  assert.equal((await collect([Buffer.concat([encoded, encoded])])).length, 2);
  for (const input of [Buffer.from([1]), encoded.subarray(0, encoded.length - 1), Buffer.from([0, 0, 0, 0]), Buffer.from([1, 0, 0, 0, 123]), Buffer.from([1, 0, 0, 0, 255])]) await assert.rejects(collect([input]));
  const oversized = Buffer.alloc(4); oversized.writeUInt32LE(MAX_FRAME + 1); await assert.rejects(collect([oversized]));
  assert.throws(() => frame({ text: "x".repeat(MAX_FRAME) }));
  let calls = 0;
  const proxy = async () => { calls++; return { boards: [], checkedAt: new Date().toISOString() }; };
  const invoke = (message, from = origin) => dispatch(message, configPath, from, proxy);
  const binding = await invoke({ v: 1, id: "bind-1", method: "bind" });
  assert.equal(binding.result.secret, config.secret);
  assert.equal((await invoke(request())).ok, true);
  const before = calls;
  for (const forged of [undefined, "bad", "я".repeat(64), "", "a".repeat(1000)]) {
    assert.equal((await invoke({ ...request(), secret: forged })).error.code, "REBIND_REQUIRED");
  }
  for (const from of ["https://example.com", origin.slice(0, -1), `${origin}evil`, `chrome-extension://${"a".repeat(32)}/`]) {
    assert.equal((await invoke(request(), from)).error.code, "FORBIDDEN");
    assert.equal((await invoke({ v: 1, id: "bind", method: "bind", origin }, from)).error.code, "FORBIDDEN");
  }
  for (const message of [{ ...request(), method: "exec" }, { ...request("play"), params: {} }, { ...request("rebind"), params: { boardId: "board", dir: "bad\0path" } }, { ...request(), params: { text: "x".repeat(130000 + 2000) } }, { ...request(), v: 2 }]) assert.equal((await invoke(message)).ok, false);
  assert.equal(calls, before);
  const old = request();
  config.epoch = randomUUID(); config.secret = randomBytes(32).toString("hex"); save();
  assert.equal((await invoke(old)).error.code, "REBIND_REQUIRED");
  assert.equal((await invoke({ v: 1, id: "bind-2", method: "bind" })).result.epoch, config.epoch);
  assert.equal((await invoke(request())).ok, true);
  const native = path.join(root, "hub/native.mjs");
  const child = spawnSync(process.execPath, [native, "--config", configPath, "--origin", origin], { input: frame({ v: 1, id: "bind", method: "bind" }), windowsHide: true });
  assert.equal(child.status, 0, child.stderr.toString());
  assert.equal((await collect([child.stdout]))[0].result.secret, config.secret);
  const badOrigin = spawnSync(process.execPath, [native, "--config", configPath, "--origin", "https://example.com"], { input: frame({ v: 1, id: "bind", method: "bind" }), windowsHide: true });
  assert.notEqual(badOrigin.status, 0); assert.equal(badOrigin.stdout.length, 0);
  const truncated = spawnSync(process.execPath, [native, "--config", configPath, "--origin", origin], { input: Buffer.from([2, 0, 0]), windowsHide: true });
  assert.notEqual(truncated.status, 0); assert.equal(truncated.stdout.length, 0);

  if (process.platform === "win32") {
    const fixture = path.join(temporary, "package");
    fs.mkdirSync(path.join(fixture, "hub/extension"), { recursive: true });
    fs.mkdirSync(path.join(fixture, "skills/grill/hub"), { recursive: true });
    for (const file of ["install.ps1", "NativeHost.cs", "native.mjs", "extension-key.json"]) fs.copyFileSync(path.join(root, "hub", file), path.join(fixture, "hub", file));
    fs.writeFileSync(path.join(fixture, "hub/extension/manifest.json"), JSON.stringify({ manifest_version: 3, name: "Fixture", version: "1.0.0", key: key.key }));
    fs.writeFileSync(path.join(fixture, "skills/grill/hub/service.mjs"), "// Installer fixture; never launched.\n");
    const staging = path.join(temporary, "staging with spaces");
    const installerArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(fixture, "hub/install.ps1"), "-StagingDir", staging, "-NoRegister", "-NoBrowser"];
    const install = () => {
      const run = spawnSync("powershell.exe", installerArgs, { encoding: "utf8", windowsHide: true, timeout: 60000 });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      return JSON.parse(fs.readFileSync(path.join(staging, "install/installation.json")));
    };
    const first = install();
    const second = install();
    assert.equal(first.installationId, second.installationId);
    assert.notEqual(first.secret, second.secret); assert.notEqual(first.epoch, second.epoch);
    assert.equal(second.servicePath, path.join(staging, "install/skills/grill/hub/service.mjs"));
    const manifest = JSON.parse(fs.readFileSync(path.join(staging, "install/native-host.json")));
    assert.deepEqual(manifest.allowed_origins, [origin]);
    assert.ok(fs.existsSync(manifest.path));
    const launcher = spawnSync(manifest.path, [origin], { input: frame({ v: 1, id: "compiled", method: "bind" }), windowsHide: true, timeout: 15000 });
    assert.equal(launcher.status, 0, launcher.stderr?.toString());
    assert.equal((await collect([launcher.stdout]))[0].result.secret, second.secret);
    console.log("Native framing, admission, rotation, compiled launcher and isolated installer checks passed.");
  } else console.log("Native framing, admission and rotation passed; Windows installer/launcher not tested on this platform.");
} finally {
  if (path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith("grill-native-")) fs.rmSync(temporary, { recursive: true, force: true });
}
