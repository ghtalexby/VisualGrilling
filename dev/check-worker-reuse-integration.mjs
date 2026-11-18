import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateResults } from "../skills/grill/result-preflight.mjs";
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-reuse-integration-"));
const dir = path.join(cwd, "maps"), home = path.join(cwd, "codex"), folder = path.join(home, "sessions", "2026", "11", "18");
const parent = "11111111-1111-1111-1111-111111111111", child = "22222222-2222-2222-2222-222222222222";
fs.mkdirSync(dir); fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ workerReuse: { enabled: true } }));
const fake = path.join(cwd, "codex.cjs");
fs.writeFileSync(fake, "process.exit(0);\n");
fs.writeFileSync(path.join(dir, "agent-connection.json"), JSON.stringify({ provider: "codex", id: parent, codexHome: home, command: process.execPath, args: [fake] }));
const record = (id, count) => JSON.stringify({ type: "token_usage_record", payload: { thread_id: id, response_id: `response-${count}`, usage: { input_tokens: 1000, cached_input_tokens: 500, output_tokens: 50, reasoning_output_tokens: 10, total_tokens: 1050 } } }) + "\n";
const rollout = id => path.join(folder, `rollout-test-${id}.jsonl`);
for (const id of [parent, child]) fs.writeFileSync(rollout(id), JSON.stringify({ type: "session_meta", payload: { id, ...(id === child ? { parent_thread_id: parent } : {}) } }) + "\n" + record(id, 1));
let server, url, q, other, count = 1;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function start() {
  server = spawn(process.execPath, [fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url)), "serve", "--dir", dir, "--port", "0"], { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; server.stderr.on("data", data => stderr += data);
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(dir, "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {}
    await sleep(50);
  }
  throw Error(stderr || "startup timeout");
}
async function stop() { if (server?.exitCode === null && server.signalCode === null) { const exited = new Promise(resolve => server.once("exit", resolve)); server.kill(); await exited; } }
async function api(route, body, expected = 200) {
  const response = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "x-grill-cli": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
}
const ack = event => ({ deliveryToken: event.token, manifestRevision: event.workerContext.manifest.manifestRevision });
const result = event => ({ type: "discuss", id: event.id, token: event.token, reply: "Current evidence checked", workerContextAck: ack(event), telemetry: { workerSessionId: child } });
async function discuss(id = q.id) { await api("discuss", { id, message: "Explain the current decision" }); return api("wait?timeout=1"); }
async function finish(event) { fs.appendFileSync(rollout(child), record(child, ++count)); return api("apply", result(event)); }
try {
  await start();
  await api("init", { title: "Reuse", brief: "Current project", questions: [{ q: "First?" }, { q: "Other?" }] });
  [q, other] = (await api("state")).nodes.filter(node => node.kind === "q");
  let event = await discuss();
  assert.equal(event.workerContext.reuse, false); assert.ok(event.workerContext.manifest);
  const missing = result(event); delete missing.workerContextAck;
  assert.throws(() => validateResults(event, [missing], event.token), /workerContextAck/);
  await api("apply", missing, 400);
  const wrong = result(event); wrong.workerContextAck.deliveryToken = "stale";
  await api("apply", wrong, 400);
  await api("apply", { ...result(event), token: "unrelated-stale-token", telemetry: undefined }, 409);
  await api("apply", missing, 400);
  for (const body of [{ ...missing, more: true }, { ...missing, type: "answer", more: true }, { type: "failure", token: event.token, error: "failed", more: true }]) {
    assert.throws(() => validateResults(event, [body], event.token));
    await api("apply", body, 400);
  }
  await finish(event);
  event = await discuss();
  assert.equal(event.workerContext.reuse, true, JSON.stringify(event.workerContext));
  assert.equal(event.workerContext.previousWorkerSessionId, child);
  assert.equal(event.workerContext.measurements.lastInputTokens, 1000);
  assert.equal(event.workerContext.measurements.contextReadAmplification, 0);
  validateResults(event, [result(event)], event.token);
  await finish(event);
  event = await discuss(); assert.equal(event.workerContext.reuse, true); await finish(event);
  event = await discuss(); assert.equal(event.workerContext.reuse, false); assert.equal(event.workerContext.reason, "event-limit");
  await api(`node?id=${other.id}`); await finish(event);
  event = await discuss(); assert.equal(event.workerContext.reuse, false); assert.equal(event.workerContext.reason, "repeated-or-crossbranch-reads");
  await api(`node?id=${q.id}`); await api(`node?id=${q.id}`); await finish(event);
  event = await discuss(); assert.equal(event.workerContext.reason, "repeated-or-crossbranch-reads");
  await finish(event);
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "Current policy changed\n");
  event = await discuss(); assert.ok(["policyRevision-changed", "instructionRevision-changed"].includes(event.workerContext.reason)); await finish(event);
  event = await discuss();
  const oldEvent = event;
  fs.appendFileSync(path.join(cwd, "AGENTS.md"), "Policy changed during preparation\n");
  await api("apply", result(oldEvent), 409);
  event = await api("wait?timeout=1");
  assert.equal(event.type, "discuss"); assert.equal(event.id, oldEvent.id);
  assert.notEqual(event.token, oldEvent.token);
  assert.notEqual(event.workerContext.manifest.instructionRevision, oldEvent.workerContext.manifest.instructionRevision);
  assert.equal(event.message, oldEvent.message);
  await api("apply", result(oldEvent), 409);
  const unacked = result(event); delete unacked.workerContextAck;
  await api("apply", unacked, 400);
  await finish(event);
  await stop(); await start();
  event = await discuss(); assert.equal(event.workerContext.reuse, false); assert.equal(event.workerContext.reason, "previous-not-completed");
  const failure = { type: "failure", token: event.token, error: "Cannot verify evidence", workerContextAck: ack(event) };
  await api("apply", failure);
  event = await discuss(); assert.equal(event.workerContext.reuse, false); await finish(event);
  fs.appendFileSync(rollout(child), '{"type":');
  event = await discuss(); await api("apply", result(event));
  fs.appendFileSync(rollout(child), '"response_item"}\n');
  event = await discuss(); assert.equal(event.workerContext.reason, "unknown-measurements"); await finish(event);
  await api("monitor", { action: "arm", owner: parent });
  await api("discuss", { id: q.id, message: "Preserve this monitored input" });
  const monitorEvent = async previous => {
    for (let i = 0; i < 100; i++) {
      const status = await api("monitor");
      if (status.delivery && status.delivery !== previous && status.phase === "pending") return { delivery: status.delivery, event: await api(`monitor?delivery=${status.delivery}`) };
      await sleep(30);
    }
    throw Error("monitor redelivery timeout");
  };
  const oldMonitor = await monitorEvent();
  fs.appendFileSync(path.join(cwd, "AGENTS.md"), "Monitored policy revision\n");
  await api("apply", result(oldMonitor.event), 409);
  const refreshed = await monitorEvent(oldMonitor.delivery);
  assert.notEqual(refreshed.event.token, oldMonitor.event.token);
  assert.equal(refreshed.event.message, oldMonitor.event.message);
  await api(`monitor?delivery=${oldMonitor.delivery}`, undefined, 409);
  await finish(refreshed.event);
  await api("monitor", { action: "stop" });
  assert.equal((await fetch(url + "api/index")).status, 403);
  console.log("Worker reuse integration passed (real same-card reuse, ack, limits, crossbranch/repeated reads, instructions, restart, failure and partial telemetry)");
} finally { await stop(); fs.rmSync(cwd, { recursive: true, force: true }); }
