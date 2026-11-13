import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sessionUsage } from "../skills/grill/usage.mjs";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-usage-"));
const base = path.join(cwd, "maps"), home = path.join(cwd, "codex");
const id = "11111111-1111-1111-1111-111111111111", other = "22222222-2222-2222-2222-222222222222";
const folder = path.join(home, "sessions", "2026", "11", "10");
fs.mkdirSync(base); fs.mkdirSync(folder, { recursive: true });
const file = path.join(folder, `rollout-date-${id}.jsonl`);
const binding = (provider = "codex", thread = id) => fs.writeFileSync(path.join(base, "agent-connection.json"), JSON.stringify({ provider, id: thread, codexHome: home }));
const total = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 };
const line = value => JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: value } } }) + "\n";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let server, url;
async function start() {
  server = spawn(process.execPath, [fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url)), "serve", "--dir", base, "--port", "0"], { cwd, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(base, "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {}
    await sleep(50);
  }
  throw Error("Server startup timed out");
}
async function stop() { if (server && server.exitCode === null && server.signalCode === null) { const done = new Promise(r => server.once("exit", r)); server.kill(); await done; } }
const state = async () => (await fetch(url + "api/state", { headers: { "x-grill": "1" } })).json();
try {
  assert.equal(await sessionUsage(base)(), null);
  binding(); fs.writeFileSync(file, line(total));
  assert.deepEqual(await sessionUsage(base)(), { provider: "codex", scope: "session", ...total });
  fs.appendFileSync(file, line(total) + '{"type":');
  assert.equal((await sessionUsage(base)()).total_tokens, 120);
  fs.writeFileSync(file, line({ ...total, total_tokens: -1 }));
  assert.equal(await sessionUsage(base)(), null);
  fs.writeFileSync(file, line({ ...total, input_tokens: "100" }));
  assert.equal(await sessionUsage(base)(), null);
  fs.writeFileSync(file, line(total) + "x".repeat(4 * 1024 * 1024 + 1));
  assert.equal(await sessionUsage(base)(), null);
  fs.writeFileSync(file, line(total));
  const read = sessionUsage(base);
  assert.equal((await read()).total_tokens, 120);
  binding("codex", other); await sleep(1050);
  assert.equal(await read(), null);
  binding("claude"); await sleep(1050);
  assert.equal(await read(), null);
  binding(); await start();
  assert.equal((await fetch(url + "api/state")).status, 403);
  const before = await state(); assert.equal(before.sessionUsage.total_tokens, 120);
  fs.appendFileSync(file, line({ ...total, input_tokens: 200, total_tokens: 220 }));
  await sleep(1050);
  const after = await state(); assert.equal(after.version, before.version); assert.equal(after.sessionUsage.total_tokens, 220);
  assert.ok(!JSON.stringify(after.sessionUsage).includes(home));
  await stop(); await start(); assert.equal((await state()).sessionUsage.total_tokens, 220);
  const usageRecord = (response, input) => JSON.stringify({ type: "token_usage_record", payload: { thread_id: id, response_id: response, usage: { ...total, input_tokens: input, total_tokens: input + total.output_tokens } } }) + "\n";
  fs.writeFileSync(file, usageRecord("a", 110000) + usageRecord("a", 110000));
  const accurate = sessionUsage(base);
  assert.equal((await accurate()).input_tokens, 110000);
  await sleep(1050); assert.equal((await state()).sessionHint, null);
  fs.appendFileSync(file, usageRecord("b", 130000) + usageRecord("b", 130000));
  await sleep(1050);
  assert.equal((await accurate()).input_tokens, 240000);
  const large = await state(); assert.equal(large.sessionUsage.last_input_tokens, 130000); assert.equal(large.sessionHint, "rollover");
  assert.equal((await sessionUsage(base)()).input_tokens, 240000, "Restart scans all unique responses");
  const headers = { "x-grill": "1", "content-type": "application/json" };
  await fetch(url + "api/init", { method: "POST", headers, body: JSON.stringify({ title: "Usage", questions: [{ q: "Q?" }] }) });
  const q = (await state()).nodes.find(n => n.kind === "q");
  await fetch(url + "api/answer", { method: "POST", headers, body: JSON.stringify({ id: q.id, answer: "A" }) });
  const delivered = await (await fetch(url + "api/wait", { headers: { ...headers, "x-grill-cli": "1" } })).json();
  assert.equal(delivered.sessionHint, "rollover");
  await fetch(url + "api/apply", { method: "POST", headers: { ...headers, "x-grill-cli": "1" }, body: JSON.stringify({ type: "answer", id: q.id, token: delivered.token, status: "ok", verdict: "Checked", ancestors: [] }) });
  fs.appendFileSync(file, usageRecord("c", 140000)); await sleep(1050);
  await fetch(url + "api/wait", { headers: { ...headers, "x-grill-cli": "1" } });
  const stats = (await state()).contextStats;
  assert.equal(stats.totals.answer.usage.input_tokens, 140000);
  assert.equal(stats.recent[0].requests, 2);
  fs.unlinkSync(file); await sleep(1050); assert.equal((await state()).sessionUsage, null);
  console.log("Session usage checks passed");
} finally { await stop(); fs.rmSync(cwd, { recursive: true, force: true }); }
