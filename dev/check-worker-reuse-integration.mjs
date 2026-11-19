import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildWorkerManifest } from "../skills/grill/worker-reuse.mjs";
import { validateResults } from "../skills/grill/result-preflight.mjs";
const baselineIndex = process.argv.indexOf("--baseline");
const baselineRef = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : null;
if (baselineIndex >= 0 && !/^[a-f0-9]{7,40}$/i.test(baselineRef || "")) throw Error("--baseline requires a commit hash");
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-reuse-integration-"));
const dir = path.join(cwd, "maps"), home = path.join(cwd, "codex"), folder = path.join(home, "sessions", "2026", "11", "18");
const parent = "11111111-1111-1111-1111-111111111111", child = "22222222-2222-2222-2222-222222222222";
fs.mkdirSync(dir); fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ workerReuse: { enabled: true }, roles: { griller: { model: "opus" } } }));
const fake = path.join(cwd, "codex.cjs");
fs.writeFileSync(fake, "process.exit(0);\n");
fs.writeFileSync(path.join(dir, "agent-connection.json"), JSON.stringify({ provider: "codex", id: parent, codexHome: home, command: process.execPath, args: [fake] }));
const record = (id, count) => JSON.stringify({ type: "token_usage_record", payload: { thread_id: id, response_id: `response-${count}`, usage: { input_tokens: 1000, cached_input_tokens: 500, output_tokens: 50, reasoning_output_tokens: 10, total_tokens: 1050 } } }) + "\n";
const rollout = id => path.join(folder, `rollout-test-${id}.jsonl`);
for (const id of [parent, child]) fs.writeFileSync(rollout(id), JSON.stringify({ type: "session_meta", payload: { id, ...(id === child ? { parent_thread_id: parent } : {}) } }) + "\n" + record(id, 1));
let server, url, q, other;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const candidateCli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
async function start(cli = candidateCli) {
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--port", "0"], { cwd, windowsHide: true, env: { ...process.env, GRILL_HUB_HOME: path.join(cwd, "hub") }, stdio: ["ignore", "ignore", "pipe"] });
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
const result = event => ({ type: "discuss", id: event.id, token: event.token, reply: "Current evidence checked" });
async function discuss(id = q.id) { await api("discuss", { id, message: "Explain the current decision" }); return api("wait?timeout=1"); }
async function finish(event) { assert.equal(event.workerContext, undefined); validateResults(event, [result(event)], event.token); return api("apply", result(event)); }
try {
  await start();
  await api("init", { title: "Reuse", brief: "Current project", questions: [{ q: "First?" }, { q: "Other?" }] });
  [q, other] = (await api("state")).nodes.filter(node => node.kind === "q");
  let event = await discuss();
  assert.equal(event.workerContext, undefined, "legacy enabled:true cannot activate reuse");
  await api("apply", { ...result(event), token: "unrelated-stale-token" }, 409);
  for (const body of [{ ...result(event), more: true }, { ...result(event), type: "answer", more: true }, { type: "failure", token: event.token, error: "failed", more: true }]) {
    assert.throws(() => validateResults(event, [body], event.token));
  }
  await api("apply", { ...result(event), reply: "" }, 400);
  await finish(event);
  for (let i = 0; i < 4; i++) { event = await discuss(); await finish(event); }
  let baselineCli;
  if (baselineRef) {
    const repository = fileURLToPath(new URL("..", import.meta.url)), exported = path.join(cwd, "baseline");
    const files = execFileSync("git", ["ls-tree", "-r", "--name-only", baselineRef, "--", "skills/grill"], { cwd: repository, encoding: "utf8" }).trim().split(/\r?\n/);
    assert.ok(files.includes("skills/grill/grill.mjs"));
    for (const file of files) {
      const target = path.join(exported, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, execFileSync("git", ["show", `${baselineRef}:${file}`], { cwd: repository, maxBuffer: 16 * 1024 * 1024 }));
    }
    baselineCli = path.join(exported, "skills/grill/grill.mjs");
    await stop(); await start(baselineCli);
  }
  // Legacy manifests were process-local. Recreate their exact persisted pending
  // state plus old inbox/result envelope; restart must fence the old result.
  event = await discuss();
  const stateBefore = JSON.parse(fs.readFileSync(path.join(dir, "state.json")));
  const legacy = baselineCli ? event : { ...event, workerContext: { manifest: buildWorkerManifest({
    processId: "legacy-process", mapKey: dir, nodes: stateBefore.nodes,
    brief: stateBefore.brief, arch: stateBefore.arch || "", language: event.language,
    ignoreRevision: "legacy-policy", knowledgeRevision: "legacy-knowledge",
    instructionRevision: "legacy-instructions", event
  }) } };
  assert.ok(legacy.workerContext.manifest, "old runtime or constructed legacy envelope must carry a manifest");
  const oldResult = { ...result(legacy), workerContextAck: ack(legacy), telemetry: { workerSessionId: child } };
  assert.throws(() => validateResults(legacy, [result(legacy)], legacy.token), /workerContextAck/);
  validateResults(legacy, [oldResult], legacy.token);
  fs.writeFileSync(path.join(dir, "inbox.json"), JSON.stringify(legacy));
  await stop(); await start();
  await api("apply", oldResult, 409);
  event = await api("wait?timeout=1");
  assert.notEqual(event.token, legacy.token);
  assert.equal(event.message, legacy.message);
  assert.equal(event.workerContext, undefined);
  await api("apply", oldResult, 409);
  await finish(event);
  const settled = await api("state");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "state.json"))).actions.map(action => action.id), stateBefore.actions.map(action => action.id), "restart preserves journal inputs");
  const committed = settled.nodes.find(node => node.id === q.id).chat.length;
  await api("apply", result(event));
  assert.equal((await api("state")).nodes.find(node => node.id === q.id).chat.length, committed, "lost acknowledgement retry must not duplicate replies");
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "Current policy changed\n");
  event = await discuss(); await finish(event);
  event = await discuss();
  const oldEvent = event;
  fs.appendFileSync(path.join(cwd, "AGENTS.md"), "Policy changed during preparation\n");
  await api("apply", result(oldEvent), 409);
  event = await api("wait?timeout=1");
  assert.equal(event.type, "discuss"); assert.equal(event.id, oldEvent.id);
  assert.notEqual(event.token, oldEvent.token);
  assert.equal(event.message, oldEvent.message);
  await api("apply", result(oldEvent), 409);
  await finish(event);
  event = await discuss();
  fs.writeFileSync(path.join(cwd, "README.md"), "New project evidence during preparation\n");
  await api("apply", result(event), 409);
  const staleDocuments = event;
  event = await api("wait?timeout=1");
  assert.notEqual(event.token, staleDocuments.token);
  assert.equal(event.message, staleDocuments.message);
  await finish(event);
  await stop(); await start();
  event = await discuss();
  await api("apply", { type: "failure", token: event.token, error: "Cannot verify evidence" });
  event = await discuss(); await finish(event);
  event = await discuss();
  const policyFile = path.join(cwd, "AGENTS.md"), policyText = fs.readFileSync(policyFile, "utf8");
  fs.unlinkSync(policyFile); fs.mkdirSync(policyFile);
  await api("apply", result(event), 409);
  fs.rmdirSync(policyFile); fs.writeFileSync(policyFile, policyText);
  const recovered = await api("wait?timeout=1");
  assert.notEqual(recovered.token, event.token);
  assert.equal(recovered.message, event.message);
  await finish(recovered);
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
  assert.equal(await new Promise((resolve, reject) => { const req = http.get(url + "api/index", { headers: { "x-grill": "1", host: "invalid.example" } }, res => { res.resume(); resolve(res.statusCode); }); req.on("error", reject); }), 403);
  console.log("Single-session migration integration passed (legacy enabled config, pending manifest/result restart, local preflight, stale policy/monitor, duplicate receipt, failure and API protection)");
  if (baselineCli) console.log(`Actual baseline runtime upgrade passed: ${baselineRef}`);
} finally { await stop(); fs.rmSync(cwd, { recursive: true, force: true }); }
