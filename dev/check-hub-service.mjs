import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { registerBoard } from "../skills/grill/hub/registry.mjs";
import { startHubService } from "../skills/grill/hub/service.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grill-hub-service-"));
const dataDir = path.join(tmp, "hub"), project = path.join(tmp, "project"), base = path.join(project, ".grill"), dir = path.join(base, "test");
process.env.GRILL_HUB_HOME = dataDir;
const config = { installationId: randomUUID(), secret: randomUUID(), epoch: randomUUID(), extensionId: "a".repeat(32), dataDir, nodePath: process.execPath };
const configFile = path.join(tmp, "installation.json"); fs.writeFileSync(configFile, JSON.stringify(config));
const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ title: "Preserved", finished: true, nodes: ["open", "weak", "gap", "verify", "ok"].map((status, i) => ({ id: "q" + i, kind: "q", status })).concat([{ kind: "q", status: "ok", obsolete: true }, { kind: "idea", status: "ok" }]) }));
const record = registerBoard({ dir, base, name: "test", project, cli });
let launches = 0, fail = false, state = null, service, launchGate = null;
const adapter = {
  getState: () => state,
  probeBinding: async binding => ({ status: binding ? "available" : "absent" }),
  async startOwned(spec) { launches++; if (launchGate) await launchGate; await new Promise(r => setTimeout(r, 100)); if (fail) throw new Error("Intentional launch failure"); state = { status: "working", owned: true, epoch: spec.epoch, threadId: randomUUID(), provider: "codex", lastCheckedAt: Date.now() }; assert.match(spec.prompt, /standalone/); return state; },
  async resume() { launches++; state = { status: "working", owned: false }; return state; },
  async stop() { const owned = state?.owned; state = { ...state, status: "stopped" }; return { stopped: true, preserved: !owned }; },
  async close() {},
  async readChat() { return { data: [], state }; }
};
let url;
const headers = () => ({ "x-grill": "1", authorization: "Bearer " + config.secret, "x-grill-epoch": config.epoch, origin: `chrome-extension://${config.extensionId}/`, "content-type": "application/json" });
async function request(method, params = {}, override = {}, expected = 200) {
  const response = await fetch(url + "/api/command", { method: "POST", headers: { ...headers(), ...override }, body: JSON.stringify({ method, params }) });
  const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
}
try {
  service = await startHubService(configFile, { adapter }); url = `http://127.0.0.1:${service.endpoint.port}`;
  await assert.rejects(startHubService(configFile, { adapter }), /already running/);
  const initial = await request("list"); assert.equal(initial.boards.length, 1); assert.equal(initial.boards[0].server, "stopped"); assert.equal(initial.boards[0].finished, true); assert.deepEqual(initial.boards[0].counts, { open: 4, closed: 1 });
  for (const bad of [{ authorization: "Bearer wrong" }, { "x-grill": "0" }, { origin: "https://example.com" }, { "x-grill-epoch": "wrong" }]) await request("list", {}, bad, 403);
  for (const change of [{ host: "example.com" }, { authorization: undefined }, { origin: undefined }, { "x-grill": undefined }]) {
    const h = { ...headers(), ...change }; for (const key of Object.keys(h)) if (h[key] === undefined) delete h[key];
    const status = await new Promise((resolve, reject) => { const req = http.request(url + "/api/health", { headers: h }, res => { res.resume(); resolve(res.statusCode); }); req.on("error", reject); req.end(); });
    assert.equal(status, 403);
  }
  const params = { boardId: record.id };
  const terminalThreadBeforePlay = randomUUID();
  fs.writeFileSync(path.join(dir, "agent-connection.json"), JSON.stringify({ provider: "codex", id: terminalThreadBeforePlay }));
  const terminalServer = spawn(process.execPath, [cli, "serve", "--dir", base, "--name", "test"], { cwd: project, env: { ...process.env, GRILL_HUB_HOME: dataDir }, windowsHide: true, stdio: "ignore" });
  try {
    let terminalUrl;
    for (let i = 0; i < 100; i++) {
      const current = (await request("list")).boards[0];
      if (current.server === "running") { terminalUrl = current.url; break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(terminalUrl);
    const abort = new AbortController();
    let waitResult;
    const waiter = fetch(terminalUrl + "api/wait?timeout=20", { headers: { "x-grill": "1" }, signal: abort.signal }).then(async response => { waitResult = await response.json(); }).catch(() => {});
    try {
      // Let the wait admission save finish before registry polling opens state.json on Windows.
      await new Promise(resolve => setTimeout(resolve, 150));
      let live;
      for (let i = 0; i < 50; i++) {
        live = (await request("list")).boards[0]; if (live.connected) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(live.connected, true, JSON.stringify({ live, waitResult })); assert.equal(live.provider, "codex"); assert.equal(live.threadId, terminalThreadBeforePlay); assert.equal(live.chatAvailable, false);
    } finally { abort.abort(); await waiter; }
    await fetch(terminalUrl + "api/hub/stop", { method: "POST", headers: { "x-grill": "1" }, body: "{}" });
    await new Promise(resolve => terminalServer.exitCode !== null ? resolve() : terminalServer.once("exit", resolve));
  } finally { if (terminalServer.exitCode === null) terminalServer.kill(); fs.unlinkSync(path.join(dir, "agent-connection.json")); }

  const [first, second] = await Promise.all([request("play", params), request("play", params)]);
  assert.equal(launches, 1); assert.deepEqual(first, second); assert.equal(first.board.connected, false); assert.equal(first.board.server, "running");
  const opened = await request("open", params); assert.equal(opened.url, (await request("open", params)).url); assert.equal(launches, 1);
  const boardResponse = await fetch(opened.url + "api/hub"); assert.equal(boardResponse.status, 403);
  const stop = await request("stop", params); assert.equal(stop.stopped, true); assert.equal(stop.preserved, false); assert.equal(stop.board.finished, true); assert.equal(stop.board.server, "stopped");
  fail = true;
  const failures = await Promise.all([request("play", params, {}, 400), request("play", params, {}, 400)]);
  assert.equal(launches, 2); assert.deepEqual(failures[0], failures[1]); assert.match(failures[0].error, /Intentional/);
  await new Promise(resolve => setTimeout(resolve, 200));
  fail = false;
  let releaseLaunch;
  launchGate = new Promise(resolve => { releaseLaunch = resolve; });
  const beforeOrdered = launches;
  const earlyPlay = request("play", params);
  while (launches === beforeOrdered) await new Promise(resolve => setTimeout(resolve, 10));
  // A different authenticated HTTP client admits Stop between the two Plays.
  const originalCommand = service.controller.command.bind(service.controller);
  let admittedStop;
  const stopAdmission = new Promise(resolve => { admittedStop = resolve; });
  service.controller.command = (...args) => { const result = originalCommand(...args); if (args[0] === "stop") admittedStop(); return result; };
  const middleStop = request("stop", params);
  await stopAdmission;
  const latePlay = request("play", params);
  await new Promise(resolve => setTimeout(resolve, 50));
  releaseLaunch(); launchGate = null;
  const ordered = await Promise.all([earlyPlay, middleStop, latePlay]);
  service.controller.command = originalCommand;
  assert.deepEqual(ordered.map(result => result.board.server), ["running", "stopped", "running"]);
  assert.equal(launches - beforeOrdered, 2);
  assert.equal((await request("list")).boards[0].server, "running");
  await request("stop", params);
  await new Promise(r => setTimeout(r, 200));
  const prior = (await request("list")).boards[0]; fs.renameSync(dir, dir + "-moved");
  const missing = (await request("list")).boards[0]; assert.equal(missing.missing, true); assert.equal(missing.stale, true); assert.equal(missing.checkedAt, prior.checkedAt); assert.deepEqual(missing.counts, prior.counts);
  fs.renameSync(dir + "-moved", dir);
  let commands = 0;
  const command = service.controller.command.bind(service.controller);
  service.controller.command = (...args) => { commands++; return command(...args); };
  // Start an authenticated request, then revoke each credential while its body
  // is incomplete. None may cross command admission using the original headers.
  for (const field of ["installationId", "dataDir", "epoch", "secret", "extensionId"]) {
    let pending;
    const response = new Promise((resolve, reject) => {
      pending = http.request(url + "/api/command", { method: "POST", headers: headers() }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      pending.on("error", reject); pending.write('{"method":"play","params":');
    });
    await new Promise(r => setTimeout(r, 50));
    const changed = { ...config, [field]: field === "extensionId" ? "b".repeat(32) : field === "dataDir" ? dataDir + "-replacement" : randomUUID() };
    fs.writeFileSync(configFile, JSON.stringify(changed));
    const before = commands;
    pending.end(JSON.stringify(params) + "}");
    assert.equal(await response, 403, `Streamed request must revalidate ${field}`);
    assert.equal(commands, before, "Revoked requests must not reach controller dispatch");
    fs.writeFileSync(configFile, JSON.stringify(config));
  }
  const previousHeaders = headers(); config.epoch = randomUUID(); config.secret = randomUUID(); fs.writeFileSync(configFile, JSON.stringify(config));
  await new Promise(r => setTimeout(r, 300));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "endpoint.json"))).epoch, config.epoch);
  await request("list", {}, previousHeaders, 403); await request("list");
  fail = false;
  fs.writeFileSync(path.join(dir, "agent-connection.json"), JSON.stringify({ provider: "codex", id: randomUUID() }));
  await request("play", params); assert.equal(state.owned, false);
  assert.equal((await request("stop", params)).preserved, true);
  await service.close(); service = await startHubService(configFile, { adapter }); url = `http://127.0.0.1:${service.endpoint.port}`;
  assert.equal((await request("list")).boards.length, 1);
  await service.close();
  // Exercise the real adapter/controller persistence path with a fake JSON-RPC
  // child. Its proxy intentionally fails: owned resume must use standalone stdio.
  fs.unlinkSync(path.join(dir, "agent-connection.json"));
  config.codexCommand = process.execPath;
  config.codexArgs = [fileURLToPath(new URL("./check-hub-codex.mjs", import.meta.url)), "--fake", "login"];
  fs.writeFileSync(configFile, JSON.stringify(config));
  service = await startHubService(configFile); url = `http://127.0.0.1:${service.endpoint.port}`;
  const loginPlay = await request("play", params);
  assert.equal(loginPlay.board.agent, "waiting_login"); assert.equal(loginPlay.board.chatAvailable, true);
  assert.equal(service.controller.adapter.getState(record.id).threadId, null);
  await service.close();
  service = await startHubService(configFile); url = `http://127.0.0.1:${service.endpoint.port}`;
  const restartedLogin = await request("play", params);
  assert.equal(restartedLogin.board.agent, "waiting_login"); assert.equal(restartedLogin.board.connected, false);
  assert.equal(restartedLogin.board.chatAvailable, true); assert.equal(service.controller.adapter.getState(record.id).threadId, null);
  await request("stop", params); await service.close();
  const sessionFile = path.join(dataDir, "sessions", record.id + ".json");
  const preThreadMetadata = fs.readFileSync(sessionFile, "utf8");
  fs.writeFileSync(sessionFile, JSON.stringify({ ...JSON.parse(preThreadMetadata), id: "ambiguous" }));
  service = await startHubService(configFile); url = `http://127.0.0.1:${service.endpoint.port}`;
  assert.match((await request("play", params, {}, 400)).error, /Invalid selected board session binding/);
  assert.equal(service.controller.adapter.getState(record.id), null);
  await service.close(); fs.writeFileSync(sessionFile, preThreadMetadata);
  config.codexArgs = [fileURLToPath(new URL("./check-hub-codex.mjs", import.meta.url)), "--fake", "owned", project];
  fs.writeFileSync(configFile, JSON.stringify(config));
  service = await startHubService(configFile); url = `http://127.0.0.1:${service.endpoint.port}`;
  const ownedPlay = await request("play", params);
  const ownedThread = ownedPlay.board.threadId;
  assert.equal(ownedPlay.board.chatAvailable, true);
  const persistedBinding = { provider: "codex", id: ownedThread, owned: false };
  fs.writeFileSync(path.join(dir, "agent-connection.json"), JSON.stringify(persistedBinding));
  const firstChild = service.controller.adapter.sessions.get(record.id).rpc.child;
  assert.equal((await request("stop", params)).preserved, false);
  assert.equal(firstChild.killed, true);
  const resumed = await request("play", { ...params, owned: false });
  assert.equal(resumed.board.threadId, ownedThread);
  assert.equal(service.controller.adapter.getState(record.id).owned, true);
  assert.equal((await request("chat", params)).data[0].id, "turn-1");
  const secondChild = service.controller.adapter.sessions.get(record.id).rpc.child;
  assert.notEqual(secondChild.pid, firstChild.pid);
  assert.equal((await request("stop", params)).preserved, false);
  assert.equal(secondChild.killed, true);
  await service.close();
  service = await startHubService(configFile); url = `http://127.0.0.1:${service.endpoint.port}`;
  assert.equal((await request("play", params)).board.threadId, ownedThread);
  assert.equal(service.controller.adapter.getState(record.id).owned, true);
  const thirdChild = service.controller.adapter.sessions.get(record.id).rpc.child;
  assert.equal((await request("stop", params)).preserved, false); assert.equal(thirdChild.killed, true);
  await service.close();
  state = null; service = await startHubService(configFile, { adapter }); url = `http://127.0.0.1:${service.endpoint.port}`;
  const terminalThread = randomUUID();
  fs.writeFileSync(path.join(dir, "agent-connection.json"), JSON.stringify({ provider: "codex", id: terminalThread, owned: true }));
  const identity = (await request("list")).boards[0];
  assert.equal(identity.provider, "codex"); assert.equal(identity.threadId, terminalThread); assert.equal(identity.connected, false); assert.equal(identity.chatAvailable, false);
  await request("play", { ...params, owned: true }); assert.equal(state.owned, false);
  assert.equal((await request("stop", params)).preserved, true);
  state = null;
  for (const malformed of [{ provider: "unknown", id: terminalThread }, { provider: "codex", id: "bad" }]) {
    fs.writeFileSync(path.join(dir, "agent-connection.json"), JSON.stringify(malformed));
    assert.equal((await request("list")).boards[0].threadId, null);
    await request("play", params, {}, 400);
  }
  fs.unlinkSync(path.join(dir, "agent-connection.json"));
  fs.writeFileSync(path.join(base, "agent-connection.json"), JSON.stringify({ provider: "codex", id: terminalThread }));
  assert.equal((await request("list")).boards[0].provider, null);
  console.log("Hub service checks passed: auth/rotation, singleton, real saved server Play/Stop, shared success/error, independent status/counts, missing/restart retention (fake Codex adapter; no model turns).");
} finally {
  if (service) await service.close();
  // Terminate only a verified board through its protected API if a check failed.
  try { const info = JSON.parse(fs.readFileSync(path.join(dir, "server.json"))); const check = await fetch(`http://127.0.0.1:${info.port}/api/hub`, { headers: { "x-grill": "1" } }); if ((await check.json()).id === record.id) await fetch(`http://127.0.0.1:${info.port}/api/hub/stop`, { method: "POST", headers: { "x-grill": "1" }, body: "{}" }); } catch {}
  await new Promise(r => setTimeout(r, 200)); fs.rmSync(tmp, { recursive: true, force: true });
}
