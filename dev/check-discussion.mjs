import { contextCards, discussionChat } from "./context-fixture.mjs";
import { knowledgeFixture } from "./knowledge-fixture.mjs";
// Exercise the whole-map reread against a real server in a disposable project.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-discussion-"));
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
const request = knowledgeFixture(rawRequest);
async function rawRequest(route, body, expected = 200) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, expected, await r.clone().text());
  return r.json();
}
const state = () => request("state");
async function wait() {
  for (;;) {
    const e = await request("wait?timeout=5");
    if (e.type !== "reevaluate") return e;
    await request("apply", { type: "reevaluate", token: e.token, capturedForSpec: e.capturedForSpec,
      assessments: e.ids.map(id => { const n = e.nodes.find(n => n.id === id); return { id, status: n.status, verdict: n.verdict }; }) });
  }
}
const auditFor = (e, body = {}) => contextCards(e).map(n => ({ id: n.id, action: body.close?.some(o => o.id === n.id) ? "close" : body.merge?.some(o => o.ids.includes(n.id)) ? "merge" : body.remove?.includes(n.id) ? "remove" : "keep", reason: "Transport fixture review" }));
const reread = (e, body = {}, expected = 200) => request("apply", { type: "reread", token: e.token, summary: "Checked", audit: auditFor(e, body), ...body }, expected);
const by = (s, q) => s.nodes.find(n => n.q === q);
async function stop() {
  if (!server || server.exitCode !== null) return;
  const ended = new Promise(r => server.once("exit", r));
  await request("stop", {}); await ended;
}
const options = ["A", "B"];
const grade = async (id, answer, extra = {}) => {
  await request("answer", { id, answer });
  const e = await wait(); assert.equal(e.type, "answer");
  await request("apply", { type: "answer", id, token: e.token, status: "ok", verdict: "Checked", ...extra });
};
const reply = (e, extra = {}, expected = 200) => request("apply", { type: "discuss", id: e.id, token: e.token, reply: "Discussed", ...extra }, expected);
const begin = async (id, message = "We use two servers but have not tested failover") => {
  await request("discuss", { id, message }); const e = await wait(); assert.equal(e.type, "discuss"); return e;
};
try {
  await start();
  assert.equal((await fetch(url + "api/state")).status, 403);
  await request("init", { title: "Map", questions: ["Count?", "Failover?", "Other?"].map(q => ({ q, options })) });
  let s = await state(); const [count, failover, other] = s.nodes.filter(n => n.kind === "q").map(n => n.id);
  const mapKey = s.mapKey;
  await grade(count, "One server");
  let e = await begin("root");
  assert.equal(e.scope, "project"); assert.equal((await request("node?id=" + count)).nodes[0].answer, "One server");
  const messageIds = [discussionChat(e).at(-1).id];
  const questions = Array.from({ length: 7 }, (_, i) => ({ key: "$q" + i, parentId: i === 0 ? other : "root", q: "Follow-up " + ["capacity", "deployment", "encryption", "retention", "billing", "staffing", "latency"][i], options }));
  const answers = [{ id: count, messageIds, status: "ok", verdict: "Two servers agreed" }, { id: failover, messageIds, status: "verify", verdict: "Failover remains untested" }];
  const transaction = { questions, answers, links: [count, ...questions.map(q => q.key)] };
  const before = (await state()).nodes;
  await reply(e, { ...transaction, links: ["missing"] }, 400);
  assert.deepEqual((await state()).nodes, before);
  await reply(e, { reply: "x".repeat(2001) }, 400);
  await reply(e, { questions: Array(501).fill(questions[0]) }, 400);
  await reply(e, { answers: [{ id: count, messageIds: ["invented"], status: "ok", verdict: "No" }] }, 400);
  await reply(e, { reply: undefined, part: 0, more: true, questions: [{ q: "x".repeat(600001) }] }, 400);
  await reply(e, { questions: [{ key: "$x", q: "Cycle?", parentId: "$x", options }], links: ["$x"] }, 400);
  await reply(e, { questions: [{ key: "$x", q: "Count?", parentId: "root", options }], links: ["$x"] }, 400);
  const staged = await reply(e, { reply: undefined, part: 0, more: true, questions, links: transaction.links });
  assert.equal(staged.committed, false); assert.deepEqual((await state()).nodes.filter(n => n.kind === "q"), before.filter(n => n.kind === "q"));
  await reply(e, { reply: undefined, part: 0, more: true, questions, links: transaction.links });
  await reply(e, { part: 1, more: false, answers });
  s = await state();
  assert.equal(s.nodes.filter(n => n.kind === "q").length, 10);
  assert.equal(by(s, "Follow-up capacity").parentId, other);
  const saved = s.nodes.find(n => n.id === count);
  assert.equal(saved.answer, discussionChat(e).at(-1).text); assert.equal(saved.answerHistory[0].answer, "One server");
  assert.equal(saved.answerSource.id, "root"); assert.equal(saved.verdictHistory.length, 2);
  assert.equal(s.nodes.find(n => n.id === failover).status, "verify"); assert.equal(s.nodes[0].status, undefined);
  assert.equal(s.nodes[0].chat.at(-1).links.length, 8);
  await reply(e, transaction, 409); assert.equal((await state()).nodes.length, s.nodes.length);

  // An unchanged direct submission must retain the earlier transfer provenance in history.
  await grade(count, saved.answer);
  const resubmitted = (await state()).nodes.find(n => n.id === count);
  assert.equal(resubmitted.answerSource, undefined);
  assert.equal(resubmitted.answerHistory.at(-1).source.id, "root");
  assert.deepEqual(resubmitted.answerHistory.at(-1).source.messageIds, messageIds);

  // Current parents remain valid below historical ancestors.
  await request("reread", {}); e = await wait(); assert.equal(e.type, "reread");
  await request("apply", { type: "reread", token: e.token, summary: "Historical premise",
    audit: contextCards(e).map(n => ({ id: n.id, action: n.id === other ? "obsolete" : "keep", reason: "Reviewed", ...(n.id === other ? { sources: ["root"] } : {}) })) });
  const activeParent = by(await state(), "Follow-up capacity").id;
  e = await begin("root");
  await reply(e, { questions: [{ key: "$below", parentId: activeParent, q: "Below historical ancestor?", options }], links: ["$below"] });
  assert.equal(by(await state(), "Below historical ancestor?").parentId, activeParent);

  // Captured specifications must not import later discussion answers/cards.
  await request("discuss", { id: other, message: "Late user decision" });
  await request("spec", {});
  const snapshot = JSON.parse(fs.readFileSync(path.join(map, "state.json"))).specJob.nodes;
  e = await wait(); assert.equal(e.type, "discuss");
  await reply(e, { answers: [{ id: count, messageIds: [discussionChat(e).at(-1).id], status: "weak", verdict: "Still incomplete" }] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(map, "state.json"))).specJob.nodes, snapshot);
  const spec = await wait(); assert.equal(spec.type, "spec");
  await request("apply", { type: "spec", token: spec.token, markdown: "# Snapshot" });

  // A concurrently submitted answer invalidates all staged work without losing either input.
  e = await begin("root");
  await reply(e, { reply: undefined, part: 0, more: true, questions: [{ key: "$race", q: "Race?", parentId: "root", options }], links: ["$race"] });
  await request("answer", { id: failover, answer: "A real submitted answer" });
  await reply(e, { part: 1, more: false, answers: [{ id: failover, messageIds: [discussionChat(e).at(-1).id], status: "ok", verdict: "Must not win" }] }, 409);
  s = await state(); assert.ok(!by(s, "Race?")); assert.equal(s.nodes.find(n => n.id === failover).pending.answer, "A real submitted answer");
  // Redelivered project discussion sees the pending target and cannot overwrite it.
  e = await wait(); assert.equal(e.type, "discuss");
  await reply(e, { answers: [{ id: failover, messageIds: [discussionChat(e).at(-1).id], status: "ok", verdict: "Blocked" }] }, 409);
  await reply(e);
  const pending = await wait(); assert.equal(pending.type, "answer");
  await request("apply", { type: "answer", id: pending.id, token: pending.token, status: "ok", verdict: "Checked" });
  assert.equal((await state()).nodes.find(n => n.id === failover).answerSource, undefined);

  // Restart drops the old token and staging, then permits one fresh atomic result.
  e = await begin(other);
  await reply(e, { reply: undefined, part: 0, more: true, questions: [{ key: "$restart", q: "After restart?", parentId: "root", options }], links: ["$restart"] });
  await stop(); await start(); await reply(e, {}, 409);
  e = await wait(); assert.equal(e.type, "discuss");
  await reply(e, { questions: [{ key: "$restart", q: "After restart?", parentId: "root", options }], links: ["$restart"] });
  assert.equal((await state()).mapKey, mapKey);
  e = await begin(count, "Question discussion decision");
  await reply(e, { answers: [{ id: failover, messageIds: [discussionChat(e).at(-1).id], status: "gap", verdict: "Not enough evidence" }] });

  // Idea discussion uses the same context and may update question cards, never the idea/root grade.
  const idea = await request("idea", { id: "idea-request", text: "Add a second region" });
  await request("discuss", { id: idea.id, message: "The region is not selected" });
  e = await wait(); assert.equal(e.type, "discuss"); assert.equal(e.scope, "idea");
  await reply(e, { answers: [{ id: count, messageIds: [discussionChat(e).at(-1).id], status: "weak", verdict: "Region missing" }], questions: [{ key: "$region", parentId: idea.id, q: "Which region?", options }], links: ["$region"] });
  assert.equal((await state()).nodes.find(n => n.id === idea.id).status, "open");
  await request("init", { title: "Inline discussion", questions: [{ q: "Parent?", options }, { q: "Open?", options }] });
  const inlineParent = (await state()).nodes.find(n => n.q === "Parent?").id;
  await grade(inlineParent, "Original", { status: "weak", children: [{ q: "Proof?", options }] });
  const inlineChild = (await state()).nodes.find(n => n.q === "Proof?").id;
  e = await begin(inlineChild, "Measured evidence");
  const discussionAnswer = { id: inlineChild, messageIds: [discussionChat(e).at(-1).id], status: "ok", verdict: "Measured" };
  await reply(e, { answers: [{ ...discussionAnswer, ancestors: [{ id: "root", status: "ok", verdict: "Invalid" }] }] }, 400);
  assert.equal((await state()).nodes.find(n => n.id === inlineChild).answer, undefined);
  await reply(e, { answers: [{ ...discussionAnswer, ancestors: [{ id: inlineParent, status: "ok", verdict: "Weakness resolved" }] }] });
  assert.equal((await state()).nodes.find(n => n.id === inlineParent).status, "ok");
  assert.equal((await state()).queueLength, 0);
  // Explicit context-limit errors must not starve independent queued answers.
  await request("init", { title: "Large map", questions: [{ q: "Original leaf", options }] });
  const leaf = (await state()).nodes.find(n => n.kind === "q").id;
  e = await begin("root");
  const many = Array.from({ length: 499 }, (_, i) => ({ key: "$large" + i, parentId: "root", q: "Large-map question " + (1000 + i), options }));
  await reply(e, { questions: many, links: many.map(q => q.key) });
  await request("discuss", { id: "root", message: "Preserve this oversized request" });
  await request("answer", { id: leaf, answer: "Independent answer" });
  await request("wait?timeout=5", undefined, 400);
  s = await state(); assert.ok(s.nodes[0].discussError); assert.equal(s.nodes[0].discuss, null);
  assert.equal(s.nodes[0].chat.at(-1).text, "Preserve this oversized request");
  e = await wait(); assert.equal(e.type, "answer"); assert.equal(e.id, leaf);
  await request("apply", { type: "answer", id: leaf, token: e.token, status: "ok", verdict: "Independent work completes" });
  console.log("Discussion questions checks passed");
} finally {
  await stop();
  fs.rmSync(cwd, { recursive: true, force: true });
}
