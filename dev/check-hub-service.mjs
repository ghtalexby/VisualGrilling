import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
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
let launches = 0, fail = false, state = null, service;
const adapter = {
  getState: () => state,
  probeBinding: async binding => ({ status: binding ? "available" : "absent" }),
  async startOwned(spec) { launches++; await new Promise(r => setTimeout(r, 100)); if (fail) throw new Error("Intentional launch failure"); state = { status: "working", owned: true, threadId: randomUUID(), provider: "codex", lastCheckedAt: Date.now() }; assert.match(spec.prompt, /standalone/); return state; },
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
  const [first, second] = await Promise.all([request("play", params), request("play", params)]);
  assert.equal(launches, 1); assert.deepEqual(first, second); assert.equal(first.board.connected, false); assert.equal(first.board.server, "running");
  const opened = await request("open", params); assert.equal(opened.url, (await request("open", params)).url); assert.equal(launches, 1);
  const boardResponse = await fetch(opened.url + "api/hub"); assert.equal(boardResponse.status, 403);
  const stop = await request("stop", params); assert.equal(stop.stopped, true); assert.equal(stop.preserved, false); assert.equal(stop.board.finished, true); assert.equal(stop.board.server, "stopped");
  fail = true;
  const failures = await Promise.all([request("play", params, {}, 400), request("play", params, {}, 400)]);
  assert.equal(launches, 2); assert.deepEqual(failures[0], failures[1]); assert.match(failures[0].error, /Intentional/);
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
  console.log("Hub service checks passed: auth/rotation, singleton, real saved server Play/Stop, shared success/error, independent status/counts, missing/restart retention (fake Codex adapter; no model turns).");
} finally {
  if (service) await service.close();
  // Terminate only a verified board through its protected API if a check failed.
  try { const info = JSON.parse(fs.readFileSync(path.join(dir, "server.json"))); const check = await fetch(`http://127.0.0.1:${info.port}/api/hub`, { headers: { "x-grill": "1" } }); if ((await check.json()).id === record.id) await fetch(`http://127.0.0.1:${info.port}/api/hub/stop`, { method: "POST", headers: { "x-grill": "1" }, body: "{}" }); } catch {}
  await new Promise(r => setTimeout(r, 200)); fs.rmSync(tmp, { recursive: true, force: true });
}
