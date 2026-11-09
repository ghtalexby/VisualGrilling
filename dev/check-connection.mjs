// Test host transports without sending a prompt to a real model.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bindSession, requestResume } from "../skills/grill/connection.mjs";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-connection-"));
const base = path.join(cwd, "maps"), map = path.join(base, "one"), other = path.join(base, "two");
const module = fileURLToPath(new URL("../skills/grill/connection.mjs", import.meta.url));
const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const binding = path.join(base, "agent-connection.json");
let channel, server, url, output = "";
const original = { ...process.env };
async function until(check) { for (let i = 0; i < 150; i++) { if (await check()) return; await sleep(50); } throw Error("Timed out"); }
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; const done = new Promise(resolve => child.once("exit", resolve)); child.kill(); await done; }
async function start() {
  server = spawn(process.execPath, [cli, "serve", "--dir", base, "--name", "one", "--port", "0"], { cwd, stdio: "ignore", windowsHide: true });
  await until(() => { try { const info = read(path.join(map, "server.json")); if (info.pid !== server.pid) return false; url = info.url; return true; } catch { return false; } });
}
async function api(route, body, status = 200, headers = { "x-grill": "1" }) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(r.status, status, await r.clone().text()); return r.json();
}
try {
  fs.mkdirSync(map, { recursive: true }); fs.mkdirSync(other);
  await assert.rejects(requestResume(base, "one"), /Связь с сессией/);
  const fakeRoot = path.join(cwd, "fake-cli"), log = path.join(cwd, "args.json");
  fs.mkdirSync(path.join(fakeRoot, "bin"), { recursive: true });
  fs.writeFileSync(path.join(fakeRoot, "bin", "codex.js"), `require("node:fs").writeFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2)));`);
  delete process.env.CLAUDECODE; delete process.env.CLAUDE_CODE_ENTRYPOINT;
  process.env.CODEX_THREAD_ID = "11111111-1111-1111-1111-111111111111";
  process.env.CODEX_MANAGED_PACKAGE_ROOT = fakeRoot;
  bindSession(base);
  assert.equal(read(binding).id, process.env.CODEX_THREAD_ID);
  await start();
  await api("resume", {}, 403, {});
  const forbidden = await new Promise((resolve, reject) => {
    const req = http.request(url + "api/resume", { method: "POST", headers: { "x-grill": "1", Host: "evil.example" } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject); req.end("{}");
  });
  assert.equal(forbidden, 403);
  const before = await api("state");
  assert.equal(before.listening, false);
  await api("resume", { thread: "attacker", message: "arbitrary prompt" });
  const args = read(log);
  assert.deepEqual(args.slice(0, 4), ["--no-daemon", "queue", "--thread", process.env.CODEX_THREAD_ID]);
  assert.equal(args.at(-1), "--resume");
  assert.ok(args[5].includes(JSON.stringify(base)) && args[5].includes('"one"'));
  assert.ok(!args[5].includes("arbitrary prompt"));
  assert.equal((await api("state")).listening, false);
  assert.deepEqual((await api("state")).nodes, before.nodes);
  const first = read(path.join(map, "resume-request.json"));
  await api("resume", {}); assert.equal(read(path.join(map, "resume-request.json")).id, first.id);
  await stop(server); await start();
  await api("resume", {}); assert.equal(read(path.join(map, "resume-request.json")).id, first.id);
  await requestResume(base, "two"); assert.ok(read(log)[5].includes('"two"'));
  fs.writeFileSync(path.join(fakeRoot, "bin", "codex.js"), "process.exit(1)");
  write(path.join(map, "resume-request.json"), { ...first, at: 0 });
  await api("resume", {}, 409); await api("resume", {}, 409);

  channel = spawn(process.execPath, [module, "--dir", base], { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  channel.stdout.on("data", data => output += data);
  const rpc = value => channel.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
  rpc({ id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  await until(() => output.includes('"result"'));
  assert.deepEqual(JSON.parse(output.trim()).result.capabilities.experimental["claude/channel"], {});
  rpc({ method: "notifications/initialized" });
  await until(() => read(binding).provider === "claude");
  const channelId = read(binding).id;
  process.env.CLAUDECODE = "1"; bindSession(base); assert.equal(read(binding).id, channelId);
  await api("resume", {});
  await until(() => output.includes('"notifications/claude/channel"'));
  const events = () => output.trim().split("\n").map(JSON.parse).filter(v => v.method === "notifications/claude/channel");
  assert.equal(events().length, 1); assert.equal(events()[0].params.meta.map, "one");
  await api("resume", {}); await sleep(650); assert.equal(events().length, 1);
  await requestResume(base, "two"); await until(() => events().length === 2);
  assert.equal(events()[1].params.meta.map, "two");
  await assert.rejects(requestResume(base, "../escape"), /имя карты/);
  await stop(channel);
  write(path.join(base, "claude-connection.json"), { provider: "claude", id: channelId, heartbeat: 0 });
  await api("resume", {}, 409);
  await api("init", { title: "Pending finish", questions: [{ q: "Question?" }] });
  await api("finish", {}); await api("resume", {}, 409);
  console.log("Connection checks passed: Codex transport, Claude channel, sibling maps, errors, deduplication, restart and API protection");
} finally {
  for (const key of ["CODEX_THREAD_ID", "CODEX_MANAGED_PACKAGE_ROOT", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
  await stop(channel); await stop(server);
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
