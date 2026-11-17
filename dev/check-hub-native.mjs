import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Writable } from "node:stream";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { frame, messages, dispatch, runNative, MAX_FRAME, MAX_PENDING } from "../hub/native.mjs";

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

  // Exercise the real native entry point and HTTP proxy, with EOF immediately
  // after simultaneous frames. A failed launch must be shared, not retried.
  let launches = 0;
  let pendingPlay;
  let failLaunch = false;
  const seen = [];
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${config.secret}`);
    assert.equal(req.headers["x-grill-epoch"], config.epoch);
    assert.equal(req.headers["x-grill"], "1");
    if (req.url === "/api/health") { res.end(JSON.stringify({ installationId: config.installationId, epoch: config.epoch })); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const command = JSON.parse(Buffer.concat(chunks));
    seen.push(command.method);
    let result = { stopped: true };
    if (command.method === "play") {
      if (!pendingPlay) {
        const launch = ++launches;
        pendingPlay = new Promise(resolve => setTimeout(() => resolve(failLaunch ? { error: { code: "LAUNCH_FAILED", message: `launch failure ${launch}` } } : { launch }), 80));
        pendingPlay.then(() => { pendingPlay = null; });
      }
      result = await pendingPlay;
    }
    res.statusCode = result.error ? 500 : 200;
    res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  fs.writeFileSync(path.join(temporary, "endpoint.json"), JSON.stringify({ port: server.address().port, installationId: config.installationId, epoch: config.epoch }));
  const nativeBatch = async (values, suffix = Buffer.alloc(0)) => {
    const processChild = spawn(process.execPath, [native, "--config", configPath, "--origin", origin], { windowsHide: true });
    const stdout = [], stderr = [];
    processChild.stdout.on("data", data => stdout.push(data));
    processChild.stderr.on("data", data => stderr.push(data));
    const finished = new Promise((resolve, reject) => { processChild.once("error", reject); processChild.once("close", code => resolve(code)); });
    const timer = setTimeout(() => processChild.kill(), 15000);
    processChild.stdin.end(Buffer.concat([...values.map(frame), suffix]));
    try { return { code: await finished, replies: await collect(stdout), stderr: Buffer.concat(stderr).toString() }; }
    finally { clearTimeout(timer); }
  };
  const play = id => ({ ...request("play"), id, params: { boardId: "board" } });
  try {
    for (const failing of [false, true]) {
      launches = 0; failLaunch = failing;
      const batch = await nativeBatch([play("first"), play("second")]);
      assert.equal(batch.code, 0, batch.stderr);
      assert.equal(launches, 1);
      assert.deepEqual(batch.replies.map(reply => reply.id).sort(), ["first", "second"]);
      assert.equal(batch.replies[0].ok, !failing);
      assert.deepEqual(batch.replies[0].result, batch.replies[1].result);
      assert.deepEqual(batch.replies[0].error, batch.replies[1].error);
    }
    launches = 0; failLaunch = false; seen.length = 0;
    const ordered = await nativeBatch([play("before"), { ...play("stop"), method: "stop" }, play("after")]);
    assert.equal(ordered.code, 0, ordered.stderr);
    assert.equal(launches, 2);
    assert.deepEqual(seen, ["play", "stop", "play"]);
    assert.equal(ordered.replies.length, 3);
    const malformed = await nativeBatch([play("admitted")], Buffer.from([1, 0, 0, 0, 123]));
    assert.notEqual(malformed.code, 0);
    assert.equal(malformed.replies[0].id, "admitted");
    assert.equal(malformed.replies[0].ok, true);
  } finally { await new Promise(resolve => server.close(resolve)); }

  // A blocked stdout must stop admission without dropping frames at EOF.
  let produced = 0;
  let releaseWrite;
  const written = [];
  const blockedOutput = new Writable({ highWaterMark: 1, write(chunk, encoding, callback) { written.push(Buffer.from(chunk)); releaseWrite = callback; } });
  const input = { async *[Symbol.asyncIterator]() { for (let i = 0; i < MAX_PENDING * 3; i++) { produced++; yield frame({ v: 1, id: `bound-${i}`, method: "bind" }); } } };
  const running = runNative(input, blockedOutput, configPath, origin);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(produced, MAX_PENDING);
  assert.equal(written.length, 1);
  for (let i = 0; i < MAX_PENDING * 3; i++) {
    assert.equal(typeof releaseWrite, "function");
    const release = releaseWrite; releaseWrite = undefined; release();
    await new Promise(resolve => setImmediate(resolve));
  }
  await running;
  assert.equal((await collect(written)).length, MAX_PENDING * 3);
  console.log("Native concurrent Play success/failure, control ordering, EOF and output backpressure checks passed.");

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
    // Chrome keeps stdin open between requests. EOF-only fixtures miss buffered
    // launcher pipes that never deliver a small request or response while live.
    const persistent = spawn(manifest.path, [origin], { windowsHide: true });
    const closed = new Promise((resolve, reject) => { persistent.once("error", reject); persistent.once("close", resolve); });
    const replies = messages(persistent.stdout)[Symbol.asyncIterator]();
    const deadline = setTimeout(() => persistent.kill(), 10000);
    try {
      for (const id of ["persistent-first", "persistent-second"]) {
        persistent.stdin.write(frame({ v: 1, id, method: "bind" }));
        const reply = await replies.next();
        assert.equal(reply.done, false, "Launcher must reply before stdin closes");
        assert.equal(reply.value.id, id);
        assert.equal(reply.value.ok, true);
        assert.equal(reply.value.result.secret, second.secret);
        assert.equal(persistent.stdin.writableEnded, false);
      }
    } finally {
      persistent.stdin.end();
      await closed;
      clearTimeout(deadline);
    }
    console.log("Native framing, admission, rotation, compiled launcher and isolated installer checks passed.");
  } else console.log("Native framing, admission and rotation passed; Windows installer/launcher not tested on this platform.");
} finally {
  if (path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith("grill-native-")) fs.rmSync(temporary, { recursive: true, force: true });
}
