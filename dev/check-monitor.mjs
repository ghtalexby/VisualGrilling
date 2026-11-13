import { contextCards } from "./context-fixture.mjs";
// Real map server and CLI, with a fake Codex transport: never calls a model.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-monitor-"));
const base = path.join(cwd, "maps"), map = path.join(base, "check");
const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const owner = "11111111-1111-1111-1111-111111111111";
const log = path.join(cwd, "calls.jsonl"), mode = path.join(cwd, "mode.txt"), fake = path.join(cwd, "codex.cjs");
const bindingFile = path.join(base, "agent-connection.json");
const binding = { provider: "codex", id: owner, command: process.execPath, args: [fake] };
const children = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, url;
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const calls = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [];
function run(args, input) {
  const child = spawn(process.execPath, [cli, ...args, "--dir", base, "--name", "check"], { cwd, windowsHide: true, env: { ...process.env, CODEX_THREAD_ID: owner }, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  children.add(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", data => stdout += data); child.stderr.on("data", data => stderr += data);
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => { children.delete(child); resolve({ code, stdout, stderr }); });
  });
  return { child, done };
}
async function until(check) { for (let i = 0; i < 150; i++) { if (await check()) return; await sleep(50); } throw Error("Timed out"); }
async function start() {
  server = run(["serve", "--port", "0"]);
  await until(() => { try { const info = read(path.join(map, "server.json")); if (info.pid !== server.child.pid) return false; url = info.url; return true; } catch { return false; } });
}
async function api(route, body, expected = 200, headers = { "x-grill": "1" }) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, expected, await r.clone().text()); return r.json();
}
const arm = () => api("monitor", { action: "arm", owner });
const stop = () => api("monitor", { action: "stop" });
async function pending(phase = "pending") { await until(async () => (await api("monitor")).phase === phase); return api("monitor"); }
const event = delivery => api("monitor?delivery=" + delivery);
const grade = e => api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Checked", children: [] });
const watchdog = setTimeout(() => { for (const child of children) child.kill(); }, 90000);
try {
  fs.mkdirSync(map, { recursive: true });
  fs.writeFileSync(fake, `const fs=require("node:fs");fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+"\\n");const mode=fs.existsSync(${JSON.stringify(mode)})?fs.readFileSync(${JSON.stringify(mode)},"utf8"):"";if(mode==="warning")console.error("Cannot resume");if(mode==="fail")process.exit(1);`);
  await start();
  await api("init", { title: "Monitor", questions: [{ q: "First?" }, { q: "Second?" }, { q: "Leave open?" }] });
  await api("monitor", { action: "arm", owner }, 409);
  fs.writeFileSync(bindingFile, JSON.stringify(binding));
  await api("monitor", { action: "arm", owner: "other" }, 409);
  await api("monitor", { action: "bogus", owner }, 400);
  await api("monitor", { action: "arm", owner }, 403, {});
  await api("monitor", undefined, 403, {});
  const forbidden = await new Promise((resolve, reject) => {
    const req = http.request(url + "api/monitor", { headers: { "x-grill": "1", Host: "evil.example" } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject); req.end();
  });
  assert.equal(forbidden, 403);
  assert.equal((await arm()).phase, "armed");
  await sleep(350); assert.equal(calls().length, 0, "Idle must not invoke Codex");
  assert.equal((await api("state")).listening, true);
  assert.equal((await arm()).phase, "armed");
  await api("wait?timeout=5", undefined, 409);
  await api("init", { title: "Reset" }, 409);
  const ids = (await api("state")).nodes.filter(n => n.kind === "q").map(n => n.id);
  await api("answer", { id: ids[0], answer: "Do not put this user text into the wake prompt" });
  await api("answer", { id: ids[1], answer: "Second queued answer" });
  let status = await pending(), e = await event(status.delivery);
  assert.equal(e.id, ids[0]); assert.equal(calls().length, 1);
  assert.deepEqual(calls()[0].slice(0, 3), ["queue", "--thread", owner]);
  assert.equal(calls()[0].at(-1), "--resume");
  assert.ok(calls()[0][4].includes(status.delivery));
  assert.ok(!calls()[0][4].includes(e.answer));
  assert.equal((await arm()).delivery, status.delivery);
  await api("apply", { type: "notes", text: "Still processing" });
  assert.equal((await api("monitor")).delivery, status.delivery);
  // Plain apply validation without save must preserve the delivery and not dispatch twice.
  await api("apply", { type: "answer", id: e.id, token: e.token, ancestors: [{ id: "missing", status: "ok", verdict: "Invalid" }] }, 400);
  assert.equal((await api("monitor")).delivery, status.delivery);
  assert.equal(calls().length, 1);
  assert.equal((await api("state")).nodes.find(n => n.id === e.id).pending.stage, "thinking");
  await grade(e); await api("monitor?delivery=" + status.delivery, undefined, 409);
  assert.equal(calls().length, 1, "Apply must not re-arm implicitly");
  await arm(); status = await pending(); e = await event(status.delivery);
  assert.equal(e.id, ids[1]); await grade(e);
  assert.equal((await run(["monitor"]).done).code, 0);
  assert.equal(JSON.parse((await run(["monitor", "--status"]).done).stdout).phase, "armed");
  assert.equal((await run(["monitor", "--event", "bad"]).done).code, 1);
  assert.equal((await run(["monitor", "--status", "--stop"]).done).code, 1);
  await stop();
  const waiter = run(["wait", "--timeout", "5"]);
  await sleep(500); await api("monitor", { action: "arm", owner }, 409);
  await api("answer", { id: ids[2], answer: "Manual delivery" });
  e = JSON.parse((await waiter.done).stdout);
  await api("monitor", { action: "arm", owner }, 409);
  // Leave a manual delivery unfinished, then restart: it must be recoverable by monitor.
  await api("stop", {}); await server.done; await start();
  assert.equal((await api("monitor")).phase, "off");
  await arm(); status = await pending();
  const recovered = await event(status.delivery); assert.equal(recovered.id, e.id); assert.notEqual(recovered.token, e.token);
  await stop(); await api("monitor?delivery=" + status.delivery, undefined, 409);
  const manual = await api("wait?timeout=5"); assert.notEqual(manual.token, recovered.token); await grade(manual);
  // Use discussions for transport failures without triggering answer-edit rereads.
  fs.writeFileSync(mode, "warning"); await arm();
  // Automatic reread may be the next event after all answers close; any event tests delivery.
  status = await pending("failed"); assert.ok(status.error); assert.ok(await event(status.delivery));
  const count = calls().length; await arm(); await sleep(200); assert.equal(calls().length, count, "Warnings must not retry or duplicate");
  // Restart while a monitored event is unfinished: stale notification rejected, work retained.
  const stale = status.delivery;
  await api("stop", {}); await server.done; await start();
  await api("monitor?delivery=" + stale, undefined, 409);
  fs.writeFileSync(mode, "fail"); await arm(); status = await pending("failed"); assert.ok(status.error); assert.ok(await event(status.delivery));
  await stop();
  // Rebinding cannot silently route a subscription into another session.
  await api("stop", {}); await server.done; await start();
  await api("init", { title: "Binding", questions: [{ q: "Question?" }] });
  await arm(); fs.writeFileSync(bindingFile, JSON.stringify({ ...binding, id: "22222222-2222-2222-2222-222222222222" }));
  const id = (await api("state")).nodes.find(n => n.kind === "q").id;
  await api("answer", { id, answer: "Keep queued" });
  status = await pending("failed"); assert.equal(status.delivery, null);
  assert.equal((await api("state")).nodes.find(n => n.id === id).pending.stage, "queued");
  await stop(); fs.writeFileSync(bindingFile, JSON.stringify(binding)); fs.writeFileSync(mode, "");
  await api("init", { title: "Invalidation", questions: [{ q: "Leave open?" }] });
  await arm();
  const idea = await api("idea", { id: "monitor-idea", text: "Initial idea" });
  status = await pending(); const ideaDelivery = status.delivery;
  await api("idea/edit", { id: idea.id, revision: 1, text: "Changed idea" });
  await until(async () => (await api("monitor")).delivery !== ideaDelivery);
  status = await pending(); assert.notEqual(status.delivery, ideaDelivery);
  await api("monitor?delivery=" + ideaDelivery, undefined, 409);
  assert.equal((await event(status.delivery)).type, "idea");
  // New answers invalidate a delivered finish without blocking the queue.
  await stop(); await api("init", { title: "Finish recovery", questions: [{ q: "Question?" }] });
  await api("finish", {}); await arm(); status = await pending(); e = await event(status.delivery);
  assert.equal(e.type, "knowledge"); await api("apply", { type: "knowledge", token: e.token, files: [] }); await arm();
  status = await pending(); const finish = await event(status.delivery); assert.equal(finish.type, "finish");
  const finishDelivery = status.delivery;
  const question = (await api("state")).nodes.find(n => n.kind === "q");
  await api("answer", { id: question.id, answer: "Arrived during finish" });
  await api("apply", { type: "finish", token: finish.token, summary: "Stale" }, 409);
  status = await pending(); assert.notEqual(status.delivery, finishDelivery);
  e = await event(status.delivery); assert.equal(e.type, "answer"); await grade(e);
  await arm(); status = await pending(); e = await event(status.delivery);
  assert.equal(e.type, "knowledge");
  await api("apply", { type: "knowledge", token: e.token, files: [] });
  await arm(); status = await pending(); e = await event(status.delivery); assert.equal(e.type, "finish");
  await api("apply", { type: "finish", token: e.token, summary: "Finished" });
  assert.equal((await api("state")).finished, true);
  await stop();
  // Explicit continuation retains finished/summary but serves new discussions.
  await arm(); await api("discuss", { id: "root", message: "Continue this map" });
  status = await pending(); e = await event(status.delivery); assert.equal(e.type, "discuss");
  const beforeReread = calls().length;
  await api("apply", { type: "discuss", id: e.id, token: e.token, reply: "Continued", reread: true });
  assert.deepEqual(await api("monitor"), { phase: "ready", delivery: null, error: null }, "Nested enqueue inside apply must not re-arm or expose a completed delivery");
  assert.equal(calls().length, beforeReread);
  await arm(); status = await pending(); e = await event(status.delivery); assert.equal(e.type, "reread");
  await api("apply", { type: "reread", token: e.token, reserve: [], audit: contextCards(e).map(n => ({ id: n.id, action: "keep", reason: "Transport test" })) });
  assert.equal((await api("state")).knowledgePending, null);
  await arm(); assert.equal((await api("monitor")).phase, "armed");
  // A save-only browser mutation must also replace a now-stale finish delivery.
  await api("finish", {}); status = await pending(); e = await event(status.delivery);
  if (e.type === "knowledge") { await api("apply", { type: "knowledge", token: e.token, files: [] }); await arm(); status = await pending(); e = await event(status.delivery); }
  assert.equal(e.type, "finish");
  const resetDelivery = status.delivery;
  await api("chatreset", { id: "root" });
  await until(async () => (await api("monitor")).delivery !== resetDelivery);
  status = await pending(); await api("monitor?delivery=" + resetDelivery, undefined, 409);
  assert.equal((await event(status.delivery)).type, "knowledge");
  // Finish cancels an automatic reread that was already sent to the host.
  await stop(); await api("init", { title: "Cancel reread", questions: [{ q: "Question?" }] });
  const q = (await api("state")).nodes.find(n => n.kind === "q");
  await api("answer", { id: q.id, answer: "Closed" }); await grade(await api("wait?timeout=5"));
  await arm(); status = await pending(); e = await event(status.delivery); assert.equal(e.type, "reread");
  const rereadDelivery = status.delivery;
  await api("finish", {}); status = await pending();
  assert.notEqual(status.delivery, rereadDelivery); await api("monitor?delivery=" + rereadDelivery, undefined, 409);
  assert.equal((await event(status.delivery)).type, "knowledge");
  // Combined commit/rearm, validation, stale results and staged discussion.
  await stop(); await api("init", { title: "Combined", questions: [{ q: "One?" }, { q: "Open?" }] });
  const combined = (await api("state")).nodes.find(n => n.kind === "q");
  await api("apply", { type: "notes", text: "Must not apply", rearm: true, owner }, 409);
  assert.notEqual((await api("state")).notes, "Must not apply");
  await arm(); await api("answer", { id: combined.id, answer: "First" });
  status = await pending(); e = await event(status.delivery);
  const result = { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Checked", rearm: true, owner };
  await api("apply", { ...result, ancestors: [{ id: "missing", status: "ok", verdict: "Invalid" }] }, 400);
  assert.equal((await api("monitor")).delivery, status.delivery);
  assert.equal((await api("apply", { ...result, ancestors: [] })).monitor.phase, "armed");
  const staleCombined = await api("apply", result, 409); assert.equal(staleCombined.monitor.phase, "armed");
  await api("discuss", { id: "root", message: "Discuss" }); status = await pending(); e = await event(status.delivery);
  const part = { type: "discuss", id: e.id, token: e.token, rearm: true, owner };
  assert.equal((await api("apply", { ...part, part: 0, more: true, questions: [] })).staged, true);
  assert.equal((await api("monitor")).delivery, status.delivery);
  assert.equal((await api("apply", { ...part, part: 1, more: false, reply: "Done" })).monitor.phase, "armed");
  await api("finish", {}); status = await pending(); e = await event(status.delivery);
  if (e.type === "knowledge") { await api("apply", { type: "knowledge", token: e.token, files: [], rearm: true, owner }); status = await pending(); e = await event(status.delivery); }
  assert.equal(e.type, "finish");
  assert.deepEqual((await api("apply", { type: "finish", token: e.token, summary: "Done", rearm: true, owner })).monitor, { phase: "stopped", drained: true });
  // Non-empty finish drains queued work instead of stopping.
  await arm(); await api("finish", {}); status = await pending(); e = await event(status.delivery);
  if (e.type === "knowledge") { await api("apply", { type: "knowledge", token: e.token, files: [], rearm: true, owner }); status = await pending(); e = await event(status.delivery); }
  await api("more", {});
  assert.equal((await api("apply", { type: "finish", token: e.token, summary: "Drain", rearm: true, owner })).monitor.phase, "notifying");
  status = await pending(); e = await event(status.delivery); assert.equal(e.type, "more");
  await api("apply", { type: "more", questions: [], rearm: true, owner });
  // Deliberate negative results complete delivery and must keep serving.
  await api("reread", {}); status = await pending(); e = await event(status.delivery);
  const refused = await api("apply", { type: "reread", token: e.token, error: "Cannot assess", rearm: true, owner });
  assert.equal(refused.ok, false); assert.equal(refused.monitor.phase, "armed");
  await api("knowledge-import", {}); status = await pending(); e = await event(status.delivery);
  const blocked = await api("apply", { type: "knowledge", token: e.token, questions: [{ q: "Who owns the definition?", options: ["Team", "User"] }], rearm: true, owner });
  assert.equal(blocked.ok, false); assert.equal(blocked.monitor.phase, "armed");
  const clarification = (await api("state")).nodes.find(n => n.q === "Who owns the definition?");
  await api("answer", { id: clarification.id, answer: "Team" }); status = await pending();
  assert.equal((await event(status.delivery)).id, clarification.id);
  // A crash after the combined operation loses only the process-local subscription.
  await api("stop", {}); await server.done; await start();
  assert.equal((await api("monitor")).phase, "off");
  assert.equal((await api("state")).finished, true);
  await api("stop", {}); await server.done;
  const statePath = path.join(map, "state.json"), seeded = read(statePath);
  seeded.queue = []; seeded.knowledgeJob = null; seeded.reevaluation = null;
  seeded.nodes = [{ id: "root", kind: "root", parentId: null }, ...Array.from({ length: 180 }, (_, i) => ({ id: "large" + i, kind: "q", parentId: "root", status: "open", q: `Question ${i}: ` + "Long distinct title ".repeat(8) }))];
  fs.writeFileSync(statePath, JSON.stringify(seeded)); await start(); await arm();
  await api("answer", { id: "large0", answer: "File delivery" }); status = await pending();
  const fileOutput = await run(["monitor", "--event", status.delivery]).done;
  assert.equal(fileOutput.code, 0, fileOutput.stderr);
  const header = JSON.parse(fileOutput.stdout); assert.ok(header.characters > 20000);
  assert.equal(read(header.inbox).token, header.token);
  const inlineOutput = await run(["monitor", "--event", status.delivery, "--inline"]).done;
  assert.ok(JSON.parse(inlineOutput.stdout).context);
  const combinedCli = await run(["apply", "--rearm"], { type: "answer", id: "large0", token: header.token, status: "ok", verdict: "Checked", ancestors: [] }).done;
  assert.equal(combinedCli.code, 0, combinedCli.stderr);
  assert.equal(JSON.parse(combinedCli.stdout).monitor.phase, "armed");
  // A new sibling submission must not cause a second grading cycle for the current answer.
  await stop(); await api("init", { title: "Sibling fallback", questions: [{ q: "Parent?" }, { q: "Keep open?" }] });
  const ancestor = (await api("state")).nodes.find(n => n.q === "Parent?").id;
  await arm(); await api("answer", { id: ancestor, answer: "Original evidence" }); status = await pending(); e = await event(status.delivery);
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "weak", verdict: "Needs evidence", children: [{ q: "First proof?" }, { q: "Second proof?" }], rearm: true, owner });
  const siblings = (await api("state")).nodes.filter(n => n.parentId === ancestor);
  await api("answer", { id: siblings[0].id, answer: "First evidence" }); status = await pending(); e = await event(status.delivery);
  await api("answer", { id: siblings[1].id, answer: "New sibling evidence" });
  const applied = await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Accept once", ancestors: [{ id: ancestor, status: "ok", verdict: "Outdated conclusion" }], rearm: true, owner });
  assert.equal(applied.ok, true); assert.equal(applied.monitor.phase, "notifying");
  let siblingState = await api("state");
  assert.equal(siblingState.nodes.find(n => n.id === ancestor).status, "weak");
  assert.equal(siblingState.nodes.find(n => n.id === siblings[0].id).verdictHistory.length, 1);
  assert.equal(siblingState.nodes.find(n => n.id === siblings[0].id).pending, null);
  status = await pending(); e = await event(status.delivery); assert.equal(e.id, siblings[1].id);
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Second", ancestors: [], rearm: true, owner });
  status = await pending(); e = await event(status.delivery);
  assert.equal(e.type, "reevaluate"); assert.deepEqual(e.ids, [ancestor]);
  await api("apply", { type: "reevaluate", token: e.token, assessments: [{ id: ancestor, status: "verify", verdict: "Review both proofs" }], rearm: true, owner });
  console.log("Monitor checks passed: idle, wake, serial delivery, CLI, conflicts, stale events, restart, errors, rebinding and API protection");
} finally {
  clearTimeout(watchdog);
  for (const child of children) child.kill();
  await Promise.allSettled([...children].map(child => new Promise(resolve => child.once("close", resolve))));
  // cwd is the unique mkdtemp directory owned by this check.
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
