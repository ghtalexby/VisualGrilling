// Exercise delivery status against a real server in a disposable project.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-current-work-"));
const dir = path.join(cwd, "maps"), map = path.join(dir, "check");
let server, url;
async function start() {
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--name", "check", "--port", "0"], { cwd, windowsHide: true, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(map, "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("Server did not start");
}
const request = rawRequest;
async function rawRequest(route, body, expected = 200) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, expected, await r.clone().text());
  return r.json();
}
const state = () => request("state");
async function stop() {
  if (!server || server.exitCode !== null) return;
  const ended = new Promise(r => server.once("exit", r));
  await request("stop", {}); await ended;
}
const work = async type => assert.deepEqual((await state()).currentWork, type ? { type } : null);
try {
  await start();
  assert.equal((await fetch(url + "api/state")).status, 403);
  const reset = async () => { await request("init", { title: "Queue", questions: ["Budget?", "Data?", "Ownership?"].map(q => ({ q, options: ["Yes", "No"] })) }); return (await state()).nodes.filter(n => n.kind === "q").map(n => n.id); };
  const wait = () => request("wait?timeout=5");
  const journal = async () => (await request("actions")).actions;
  const grade = (e, status = "ok") => request("apply", { type: "answer", id: e.id, token: e.token, status, verdict: "Checked", ancestors: [] });
  const reply = e => request("apply", { type: "discuss", id: e.id, token: e.token, reply: "Checked" });
  const review = (e, extra = {}) => request("apply", { type: "reread", token: e.token, audit: e.context.focus.filter(n => n.kind === "q").map(n => ({ id: n.id, action: extra.remove?.includes(n.id) ? "remove" : extra.merge?.some(m => m.ids.includes(n.id)) ? "merge" : "keep", reason: "Checked" })), ...extra });
  let [id, other] = await reset();
  const input = { actionId: "first", id, answer: "First answer" };
  await request("answer", input);
  await request("answer", input);
  assert.equal((await journal()).length, 1);
  assert.equal((await request("maps")).maps[0].queue, 1);
  let e = await wait(); assert.equal(e.type, "answer");
  await request("discuss", { id, message: "One" });
  await request("discuss", { id, message: "Two" });
  await request("discuss", { id, message: "Three" });
  assert.equal((await state()).actionQueue.waiting, 3);
  await grade(e, "gap");
  await grade(e, "gap"); // Lost apply response: receipt, no second mutation.
  e = await wait(); assert.equal(e.message, "One\n\nTwo\n\nThree");
  await request("discuss", { id, message: "Next" });
  await reply(e);
  e = await wait(); assert.equal(e.message, "Next"); await reply(e);
  await stop(); await start(); await request("answer", input);
  assert.equal((await journal()).filter(a => a.id === "first").length, 1);

  [id, other] = await reset();
  await request("answer", { id, answer: "Old" });
  await request("answer", { id, answer: "Newest" });
  await request("spec", {});
  await request("answer", { id, answer: "Later" });
  e = await wait(); assert.equal(e.answer, "Newest"); await grade(e);
  assert.equal((await journal())[0].status, "superseded");
  e = await wait(); assert.equal(e.type, "spec"); assert.equal(e.nodes.find(n => n.id === id).answer, "Newest");
  await request("apply", { type: "spec", token: e.token, markdown: "# Queue spec" });
  e = await wait(); assert.equal(e.answer, "Later"); await grade(e, "verify");
  e = await wait(); assert.equal(e.type, "reread"); await review(e);

  [id, other] = await reset();
  await request("reread", {}); e = await wait(); assert.equal(e.type, "reread");
  const gone = await request("answer", { id, answer: "Must not be lost" });
  await request("discuss", { id: other, message: "During reread" });
  await review(e, { remove: [id] });
  e = await wait(); assert.equal(e.message, "During reread"); await reply(e);
  assert.equal((await journal()).find(a => a.id === gone.actionId).status, "needs-decision");
  let archive = (await request("archive")).archive;
  assert.ok(archive.some(a => a.node?.id === id));
  assert.ok(archive.some(a => a.input?.answer === "Must not be lost"));
  await request("reread", {}); e = await wait();
  const entry = archive.find(a => a.node?.id === id);
  await review(e, { archiveDecisions: [{ id: entry.id, action: "restore" }] });
  await request("actions/retry", { id: gone.actionId, actionId: "restore-answer" });
  e = await wait(); assert.equal(e.answer, "Must not be lost"); await grade(e);

  [id] = await reset();
  const a = await request("discuss", { id, message: "A" });
  await request("discuss", { id, message: "B" });
  await request("spec", {});
  let plan = await request("actions/cancel", { id: a.actionId }); assert.equal(plan.ids.length, 3);
  await request("actions/cancel", { id: a.actionId, confirmation: plan.confirmation });
  assert.equal((await journal()).filter(a => a.status === "cancelled").length, 3);
  const raced = await request("answer", { id, answer: "Race" });
  plan = await request("actions/cancel", { id: raced.actionId });
  e = await wait(); await request("actions/cancel", { id: raced.actionId, confirmation: plan.confirmation }, 409);
  await request("apply", { type: "failure", token: e.token, error: "Worker failed" });
  await request("discuss", { id: "root", message: "Independent" });
  await request("actions/retry", { id: raced.actionId, actionId: "retry" });
  e = await wait(); assert.equal(e.type, "discuss"); await reply(e);
  e = await wait(); assert.equal(e.type, "answer"); await grade(e);

  [id] = await reset();
  await request("answer", { id, answer: "Running" }); e = await wait();
  for (let i = 0; i < 20; i++) await request("discuss", { id, message: "Queued " + i });
  await request("discuss", { id, message: "Overflow" }, 429);
  assert.equal((await state()).actionQueue.slots, 20);
  await stop(); await start();
  const old = e; e = await wait(); assert.notEqual(e.token, old.token);
  await grade(e); e = await wait(); assert.equal(e.message.split("\n\n").length, 20); await reply(e);

  [id] = await reset();
  await request("finish", {});
  e = await wait(); assert.equal(e.type, "knowledge");
  await request("apply", { type: "knowledge", token: e.token, files: [] });
  e = await wait(); assert.equal(e.type, "finish");
  await request("answer", { id, answer: "After boundary" });
  await request("apply", { type: "finish", token: e.token, summary: "Done" });
  assert.equal((await state()).actionQueue.paused, true);
  assert.equal((await state()).queueLength, 0);
  assert.equal((await request("maps")).maps[0].queue, 0);
  assert.equal((await state()).actionQueue.waiting, 1);
  await stop(); await start(); assert.equal((await state()).actionQueue.paused, true);
  await request("actions/continue", {});
  e = await wait(); assert.equal(e.answer, "After boundary"); await grade(e);
  assert.ok((await fetch(url + "api/report", { headers: { "x-grill": "1" } })).ok);
  [id, other] = await reset();
  const png = "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(16)]).toString("base64");
  await request("discuss", { id, images: [png] }); e = await wait(); const imagePath = e.images[0]; await reply(e);
  await request("chatreset", { id }); await request("discuss", { id: other, message: "Trigger next action" });
  e = await wait(); await reply(e);
  assert.ok(fs.existsSync(imagePath), "Archived chat keeps image files");
  await stop(); await start(); assert.ok(fs.existsSync(imagePath));

  [id, other] = await reset();
  await stop();
  const stateFile = path.join(map, "state.json"), legacy = JSON.parse(fs.readFileSync(stateFile));
  delete legacy.actions; delete legacy.archive;
  legacy.nodes.find(n => n.id === id).pending = { stage: "queued", answer: "Legacy first" };
  legacy.nodes.find(n => n.id === other).pending = { stage: "queued", answer: "Legacy second" };
  legacy.queue = [{ type: "answer", id }, { type: "answer", id: other }];
  fs.writeFileSync(stateFile, JSON.stringify(legacy)); await start();
  e = await wait(); await request("apply", { type: "failure", token: e.token, error: "Legacy worker failed" });
  e = await wait(); assert.equal(e.answer, "Legacy second"); await grade(e);
  [id, other] = await reset();
  await request("answer", { id, answer: "Original" }); await grade(await wait());
  const edited = await request("answer", { id, answer: "Edited" }); await grade(await wait());
  const history = (await state()).nodes.find(n => n.id === id).verdictHistory.length;
  e = await wait(); assert.equal(e.type, "reread");
  await request("apply", { type: "failure", token: e.token, error: "Reread failed after grading" });
  await request("discuss", { id: other, message: "Independent" });
  await request("actions/retry", { id: edited.actionId, actionId: "retry-internal" });
  await reply(await wait());
  e = await wait(); assert.equal(e.type, "reread"); await review(e);
  assert.equal((await state()).nodes.find(n => n.id === id).verdictHistory.length, history);

  [id, other] = await reset();
  await request("answer", { id, answer: "Same decision" }); await grade(await wait());
  await request("answer", { id: other, answer: "Same decision" }); await grade(await wait());
  await request("reread", {}); e = await wait();
  const redirected = await request("answer", { id: other, answer: "Later evidence" });
  await review(e, { merge: [{ ids: [id, other], keep: id, answer: "Same decision", status: "ok", verdict: "Same meaning" }] });
  e = await wait(); assert.equal(e.id, id); assert.equal(e.answer, "Later evidence"); await grade(e);
  assert.equal((await journal()).find(a => a.id === redirected.actionId).redirectedTo, id);
  console.log("Durable action queue checks passed");
} finally {
  await stop(); fs.rmSync(cwd, { recursive: true, force: true });
}
