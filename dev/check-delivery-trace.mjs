import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { finishUsage, fieldChanges } from "../skills/grill/telemetry.mjs";
const counters = n => ({ input_tokens: n, cached_input_tokens: n, output_tokens: n });
for (const [start, end, identity, expected] of [
  [null, counters(2), "a", "missing-start"], [counters(1), null, "a", "missing-end"],
  [counters(1), counters(2), "b", "session-changed"], [counters(2), counters(1), "a", "counter-reset"],
  [counters(1), { ...counters(2), tree: { complete: false } }, "a", "incomplete-tree"],
  [counters(1), counters(2), "a", "observed"]]) {
  const entry = { usageStart: start, usageSession: "a" }; finishUsage(entry, end, identity); assert.equal(entry.usageDeltaStatus, expected);
}
assert.deepEqual(fieldChanges([{ id: "x", status: "open" }], [{ id: "x", status: "ok" }]).status, { count: 1, ids: ["x"] });
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-delivery-trace-")), dir = path.join(cwd, "maps"), map = path.join(dir, "test");
const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
let server, url;
async function start() {
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--name", "test", "--port", "0"], { cwd, windowsHide: true, stdio: "ignore", env: { ...process.env, GRILL_HUB_HOME: path.join(cwd, "hub") } });
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(map, "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("Server startup failed");
}
async function request(route, body, expected = 200) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, expected, await r.clone().text()); return r.json();
}
async function stop() { if (!server || server.exitCode !== null) return; const ended = new Promise(r => server.once("exit", r)); await request("stop", {}); await ended; }
try {
  await start();
  await request("init", { title: "Trace", questions: [{ q: "Capacity?" }, { q: "Retention?" }] });
  await request("discuss", { id: "root", message: "First" });
  await request("discuss", { id: "root", message: "Second" });
  const first = await request("wait?timeout=1");
  assert.equal(first.scope, "project"); assert.equal(first.contextScope, "live");
  assert.notEqual(first.deliveryTraceId, first.token); assert.ok(first.actionIds.length);
  await stop(); await start();
  const e = await request("wait?timeout=1");
  assert.notEqual(e.deliveryTraceId, first.deliveryTraceId); assert.deepEqual(e.actionIds, first.actionIds);
  const workerSessionId = randomUUID(), telemetry = { workerSessionId };
  const before = (await request("actions")).tasks;
  await request("apply", { type: "discuss", id: "root", token: first.token, reply: "Stale", telemetry }, 409);
  assert.deepEqual((await request("actions")).tasks, before);
  await request("apply", { type: "discuss", id: "root", token: e.token, part: 0, more: true, telemetry });
  await request("apply", { type: "discuss", id: "root", token: e.token, part: 1, more: false, reply: "Checked", telemetry: { workerSessionId: randomUUID() } });
  const tasks = (await request("actions")).tasks, task = tasks.find(t => t.deliveryTraceId === e.deliveryTraceId);
  assert.equal(task.status, "done"); assert.equal(task.workerSessionIds.length, 2); assert.equal(task.workerAttribution, "declared");
  const stats = (await request("state")).contextStats.recent;
  assert.equal(stats.find(s => s.deliveryTraceId === first.deliveryTraceId).usageDeltaStatus, "interrupted");
  assert.ok(!JSON.stringify(stats).includes(e.token));
  assert.deepEqual(stats.find(s => s.deliveryTraceId === e.deliveryTraceId).workerSessionIds, task.workerSessionIds);
  await request("reread", {});
  const reread = await request("wait?timeout=1");
  assert.equal(reread.type, "reread");
  assert.ok(reread.causes.some(c => c.kind === "reread" && c.reason === "manual" && c.actionIds.length));
  await stop(); await start();
  const recovered = await request("wait?timeout=1");
  assert.equal(recovered.type, "reread"); assert.deepEqual(recovered.causes, reread.causes);
  assert.notEqual(recovered.deliveryTraceId, reread.deliveryTraceId);
  await request("apply", { type: "failure", token: recovered.token, error: "Worker failed", telemetry });
  const failedTask = (await request("actions")).tasks.find(t => t.id === recovered.token);
  assert.equal(failedTask.status, "failed"); assert.deepEqual(failedTask.workerSessionIds, [workerSessionId]);
  assert.deepEqual((await request("state")).contextStats.recent.find(t => t.deliveryTraceId === recovered.deliveryTraceId).workerSessionIds, [workerSessionId]);
  const failedAction = (await request("state")).actionQueue.actions.find(a => a.status === "failed");
  await request("actions/retry", { id: failedAction.id });
  const retried = await request("wait?timeout=1");
  assert.deepEqual(retried.causes.slice(0, recovered.causes.length), recovered.causes);
  assert.ok(retried.causes.some(c => c.reason === "retry" && c.retryOf === failedAction.id));
  // Seed disposable recovered jobs, preserving their original scheduling causes.
  const stateFile = path.join(map, "state.json");
  for (const type of ["reevaluate", "reread"]) {
    await stop();
    const saved = JSON.parse(fs.readFileSync(stateFile));
    saved.actions = []; saved.queue = []; saved.rereadJob = null; saved.reevaluation = null;
    const target = saved.nodes.find(n => n.kind === "q"); target.answer = "Evidence"; target.status = "ok";
    const causes = [{ kind: type, reason: type === "reread" ? "answer-edit" : "descendant-change", nodeIds: [target.id], actionIds: [] }];
    if (type === "reread") { saved.rereadJob = { stage: "queued", manual: false, edits: [], settled: true, causes }; saved.queue.push({ type }); }
    else saved.reevaluation = { ids: [target.id], causes };
    saved.actions.push({ id: randomUUID(), sequence: 1, route: "/api/answer", body: { id: target.id }, status: "running", dependencies: [], at: Date.now() });
    fs.writeFileSync(stateFile, JSON.stringify(saved)); await start();
    const event = await request("wait?timeout=1"); assert.equal(event.type, type);
    await request("apply", { type: "failure", token: event.token, error: "Retry this job", telemetry });
    const failed = (await request("state")).actionQueue.actions.find(a => a.status === "failed");
    await request("actions/retry", { id: failed.id });
    const retry = await request("wait?timeout=1"); assert.equal(retry.type, type);
    assert.deepEqual(retry.causes[0], causes[0]); assert.ok(retry.causes.some(c => c.reason === "retry"));
    assert.ok(!retry.causes.some(c => c.reason === "manual"));
  }
  await request("init", { title: "Followup provenance", questions: [{ q: "Evidence?" }, { q: "Spare?" }] });
  const target = (await request("state")).nodes.find(n => n.kind === "q");
  await request("answer", { id: target.id, answer: "Uncertain" });
  const answer = await request("wait?timeout=1");
  await request("apply", { type: "answer", id: answer.id, token: answer.token, status: "weak", verdict: "Needs proof", ancestors: [] });
  const followup = await request("wait?timeout=1"); assert.equal(followup.type, "followup");
  assert.ok(followup.causes.some(c => c.kind === "followup" && c.nodeIds.includes(target.id) && c.deliveryTraceId === answer.deliveryTraceId));
  const beforeBad = (await request("actions")).tasks;
  await request("apply", { type: "followup", id: followup.id, token: followup.token, status: "weak", verdict: "Missing coverage", telemetry }, 400);
  assert.deepEqual((await request("actions")).tasks, beforeBad);
  await stop();
  const saved = JSON.parse(fs.readFileSync(stateFile));
  saved.actions = []; saved.queue = [{ type: "spec" }];
  saved.specJob = { stage: "queued", title: "Frozen", brief: "", arch: "", requestedAt: Date.now(), nodes: structuredClone(saved.nodes), gradingNodes: structuredClone(saved.nodes), waiting: [], ideaWaiting: [], reviewIds: [] };
  for (const node of saved.nodes) delete node.followup;
  fs.writeFileSync(stateFile, JSON.stringify(saved)); await start();
  const frozen = await request("wait?timeout=1"); assert.equal(frozen.contextScope, "frozen");
  await stop();
  const changed = JSON.parse(fs.readFileSync(stateFile)); changed.specJob.gradingNodes.find(n => n.id === target.id).answer = "Different frozen evidence";
  fs.writeFileSync(stateFile, JSON.stringify(changed)); await start();
  const frozenChanged = await request("wait?timeout=1");
  assert.equal(frozenChanged.mapRevision, frozen.mapRevision); assert.notEqual(frozenChanged.evidenceRevision, frozen.evidenceRevision);
  assert.equal((await request("actions")).tasks.find(t => t.id === frozenChanged.token).evidenceRevision, frozenChanged.evidenceRevision);
  console.log("Delivery trace checks passed");
} finally { await stop(); fs.rmSync(cwd, { recursive: true, force: true }); }
