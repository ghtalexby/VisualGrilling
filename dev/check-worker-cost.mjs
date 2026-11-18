import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { knowledge, agentIndex } from "../skills/grill/knowledge.mjs";
import { sessionUsage } from "../skills/grill/usage.mjs";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-worker-cost-"));
const base = path.join(cwd, ".grill"), map = path.join(base, "check");
const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
fs.mkdirSync(map, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let server, url;
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args, "--dir", base, "--name", "check"], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", d => out += d); child.stderr.on("data", d => err += d);
    child.once("error", reject); child.once("exit", code => resolve({ code, out, err }));
  });
}
async function api(route, body) {
  const response = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  assert.equal(response.status, 200, await response.clone().text()); return response.json();
}
try {
  fs.writeFileSync(path.join(cwd, "README.md"), "# Project\n" + "[Source](source.md) ".repeat(80));
  const store = knowledge(cwd, base), full = store.index(), compact = agentIndex(full);
  assert.deepEqual(compact.documents.map(d => d.path), full.documents.map(d => d.path));
  assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length / 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, "knowledge-agent-index.json"))), compact);
  store.setIgnored("README.md", true);
  assert.deepEqual(agentIndex(store.index()).ignored, ["README.md"]);
  const broken = agentIndex({ ...full, warnings: ["scan failed"], documents: [{ path: "bad.md", version: "v", headings: "", error: "parse failed" }] });
  assert.equal(broken.documents[0].error, "parse failed"); assert.deepEqual(broken.warnings, ["scan failed"]);

  server = spawn(process.execPath, [cli, "serve", "--dir", base, "--name", "check", "--port", "0"], { cwd, windowsHide: true, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(map, "server.json"))); if (info.pid === server.pid) { url = info.url; break; } } catch {}
    await sleep(50);
  }
  assert.ok(url); assert.equal((await fetch(url + "api/state")).status, 403);
  await api("init", { title: "Handoff", questions: [{ q: "First?" }, { q: "Second?" }] });
  const q = (await api("state")).nodes.find(n => n.kind === "q");
  await api("answer", { id: q.id, answer: "Private evidence stays in file" });
  const delivered = await run(["wait", "--timeout", "5", "--inbox"]);
  assert.equal(delivered.code, 0, delivered.err);
  const header = JSON.parse(delivered.out), event = JSON.parse(fs.readFileSync(header.inbox));
  assert.equal(header.token, event.token); assert.ok(!delivered.out.includes(event.answer));
  assert.ok(event.knowledge.index.endsWith("knowledge-agent-index.json"));
  const resultFile = path.join(map, "result.json");
  const result = { type: "answer", id: q.id, token: event.token, status: "ok", verdict: "Checked", ancestors: [], coverage: { resolved: true, reason: "Fixture evidence", sources: [], gaps: [] } };
  fs.writeFileSync(resultFile, JSON.stringify(result));
  assert.equal((await run(["apply", "--file", resultFile])).code, 1);
  assert.equal((await run(["apply", "--file", resultFile, "--token", "wrong"])).code, 1);
  fs.writeFileSync(resultFile, JSON.stringify({ ...result, id: "other" }));
  assert.equal((await run(["apply", "--file", resultFile, "--token", event.token])).code, 1);
  fs.writeFileSync(resultFile, "{");
  assert.equal((await run(["apply", "--file", resultFile, "--token", event.token])).code, 1);
  fs.writeFileSync(resultFile, " ".repeat(1000001));
  assert.equal((await run(["apply", "--file", resultFile, "--token", event.token])).code, 1);
  assert.equal((await api("state")).nodes.find(n => n.id === q.id).status, "open");
  fs.writeFileSync(resultFile, JSON.stringify(result));
  const applied = await run(["apply", "--file", resultFile, "--token", event.token]); assert.equal(applied.code, 0, applied.err);
  const savedVersion = (await api("state")).version;
  await run(["apply", "--file", resultFile, "--token", event.token]);
  assert.equal((await api("state")).version, savedVersion, "Idempotent replay does not mutate state");
  const saved = fs.readFileSync(header.inbox, "utf8");
  const timeout = await run(["wait", "--timeout", "1", "--inbox"]);
  assert.equal(JSON.parse(timeout.out).type, "timeout"); assert.equal(fs.readFileSync(header.inbox, "utf8"), saved);
  const nav = await run(["knowledge", "--compact"]); assert.ok(!JSON.parse(nav.out).files);

  const home = path.join(cwd, "codex"), folder = path.join(home, "sessions", "2026", "11", "16"); fs.mkdirSync(folder, { recursive: true });
  const ids = [1, 2, 3, 4].map(n => String(n).repeat(8) + "-1111-1111-1111-111111111111");
  const counters = input => ({ input_tokens: input, cached_input_tokens: input / 2, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: input + 10 });
  const usage = (id, response, input) => JSON.stringify({ type: "token_usage_record", payload: { thread_id: id, response_id: response, usage: counters(input) } }) + "\n";
  const file = id => path.join(folder, `rollout-date-${id}.jsonl`);
  const write = (id, parent, input) => fs.writeFileSync(file(id), JSON.stringify({ type: "session_meta", payload: { id, source: parent ? { subagent: { thread_spawn: { parent_thread_id: parent } } } : "cli" } }) + "\n" + (input ? usage(id, "same-response", input).repeat(2) : ""));
  const bind = id => fs.writeFileSync(path.join(base, "agent-connection.json"), JSON.stringify({ provider: "codex", id, codexHome: home }));
  write(ids[0], null, 100); write(ids[1], ids[0], 200); write(ids[2], ids[1], 300); write(ids[3], null, 1000); bind(ids[0]);
  // A valid parent ID can follow a long instruction field; JSON key order is not a schema.
  fs.writeFileSync(file(ids[2]), JSON.stringify({ type: "session_meta", payload: { id: ids[2], base_instructions: { text: "x".repeat(20000) }, parent_thread_id: ids[1] } }) + "\n" + usage(ids[2], "same-response", 300));
  const reader = sessionUsage(base); let measured = await reader();
  assert.equal(measured.input_tokens, 600); assert.equal(measured.tree.workers, 2); assert.equal(measured.tree.complete, true);
  assert.equal(measured.tree.parent.input_tokens, 100); assert.equal(measured.tree.workerUsage.input_tokens, 500);
  assert.equal(measured.model_responses, 3, "Same response ID in distinct threads counts separately");
  assert.equal(measured.tree.parent.model_responses, 1);
  assert.equal(measured.tree.workerUsage.model_responses, 2);
  assert.equal(measured.model_responses_complete, true);
  assert.equal(measured.last_input_tokens, 100, "Rollover stays parent-specific");
  assert.equal((await sessionUsage(base)()).input_tokens, 600, "Restart discovers the same tree");
  assert.equal((await sessionUsage(base)()).model_responses, 3);
  fs.appendFileSync(file(ids[1]), usage(ids[1], "next", 80)); await sleep(1050);
  assert.equal((await reader()).input_tokens, 680);
  assert.equal((await reader()).model_responses, 4);
  fs.appendFileSync(file(ids[1]), usage(ids[1], "next", 80)); await sleep(1050);
  assert.equal((await reader()).model_responses, 4, "Duplicate append does not add a response");
  write(ids[2], ids[1], 0);
  fs.appendFileSync(file(ids[2]), JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: counters(300) } } }) + "\n");
  await sleep(1050); measured = await reader();
  assert.equal(measured.tree.complete, true, "Fallback still supplies worker tokens");
  assert.equal(measured.model_responses, null, "Fallback cannot invent worker response counts");
  assert.equal(measured.tree.workerUsage.model_responses_complete, false);
  assert.equal(measured.tree.parent.model_responses, 1);
  write(ids[2], ids[1], 0); await sleep(1050); measured = await reader();
  assert.equal(measured.tree.complete, false); assert.equal(measured.tree.available, 1); assert.equal(measured.input_tokens, 380);
  assert.equal(measured.model_responses, null); assert.equal(measured.model_responses_complete, false);
  assert.equal(measured.tree.workerUsage.model_responses, null);
  fs.unlinkSync(file(ids[2]));
  await sleep(10050); measured = await reader();
  assert.equal(measured.tree.workers, 2); assert.equal(measured.tree.complete, false);
  assert.equal(measured.model_responses, null);
  bind(ids[3]); await sleep(1050); measured = await reader();
  assert.equal(measured.input_tokens, 1000); assert.equal(measured.tree, undefined, "Rebinding drops old descendants");
  assert.equal(measured.model_responses, 1); assert.equal(measured.model_responses_complete, true);
  const incompleteFile = path.join(folder, "rollout-incomplete.jsonl");
  fs.writeFileSync(incompleteFile, '{"type":"session_meta"');
  const incomplete = await sessionUsage(base)();
  assert.equal(incomplete.tree.complete, false, "Unfinished discovery cannot assert a complete tree");
  assert.equal(incomplete.model_responses, null);
  assert.equal(incomplete.tree.parent.model_responses, 1);
  assert.equal(incomplete.tree.workerUsage.model_responses, null);
  assert.equal(incomplete.model_responses_complete, false);
  console.log("Worker-cost checks passed: compact index, file handoff, recursive usage and incomplete telemetry");
} finally {
  if (server && server.exitCode === null) { const done = new Promise(r => server.once("exit", r)); server.kill(); await done; }
  fs.rmSync(cwd, { recursive: true, force: true });
}
