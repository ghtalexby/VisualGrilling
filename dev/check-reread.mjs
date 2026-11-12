import { contextCards, focusCard, discussionChat } from "./context-fixture.mjs";
import { knowledgeFixture } from "./knowledge-fixture.mjs";
// Exercise the whole-map reread against a real server in a disposable project.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-reread-"));
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
const by = (s, q) => (s.context ? contextCards(s) : s.nodes).find(n => n.q === q);
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
try {
  await start();
  assert.equal((await fetch(url + "api/reread", { method: "POST" })).status, 403);
  await request("reread", {}, 400);
  await request("init", { title: "Map", brief: "Idea", questions: ["Count?", "Colour?", "Why?", "Other?", "Unrelated?"].map(q => ({ q, options })) });
  let s = await state();
  const [count, colour, why, other, unrelated] = ["Count?", "Colour?", "Why?", "Other?", "Unrelated?"].map(q => by(s, q).id);
  await grade(count, "Two blue buttons", { children: [{ q: "Count detail?", options }] });
  await grade(why, "Two blue buttons");
  await grade(other, "Three green buttons");
  s = await state();
  const detail = by(s, "Count detail?").id;

  // A request is deduplicated, hides its token, and waits for submitted answers.
  await request("answer", { id: detail, answer: "Queued first" });
  await request("reread", {}); await request("reread", {});
  s = await state();
  assert.equal(s.rereadJob, undefined); assert.equal(s.rereadPending.stage, "queued"); assert.equal(s.rereadPending.locked, true);
  assert.equal(s.queueLength, 2);
  await request("answer", { id: colour, answer: "Blocked" }, 409);
  await request("question", { id: "custom", parentId: "root", q: "Blocked?" }, 409);
  let e = await wait(); assert.equal(e.type, "answer"); assert.equal(e.id, detail);
  await request("apply", { type: "answer", id: detail, token: e.token, status: "ok", verdict: "Checked" });

  // Delivery rotates tokens; restart recovers the job; a stale result is refused.
  await request("discuss", { id: other, message: "Discussion counts as input" });
  e = await wait(); assert.equal(e.type, "discuss");
  await request("apply", { type: "discuss", id: other, token: e.token, reply: "Noted" });
  e = await wait(); assert.equal(e.type, "reread");
  assert.equal(e.context.mode, "full");
  assert.ok(by(e, "Other?").chat.some(m => m.text === "Discussion counts as input"));
  assert.equal(by(e, "Count?").answer, "Two blue buttons");
  assert.equal((await state()).rereadPending.stage, "thinking");
  await request("discuss", { id: other, message: "Too late" }, 409);
  await request("answer", { id: colour, answer: "Blocked" }, 409);
  const stale = e;
  await stop(); await start();
  await reread(stale, {}, 409);
  assert.equal((await state()).rereadPending.stage, "queued");
  e = await wait(); assert.equal(e.type, "reread"); assert.notEqual(e.token, stale.token);
  const repeated = await wait(); assert.equal(repeated.type, "reread"); assert.notEqual(repeated.token, e.token);
  await reread(e, {}, 409);
  e = repeated;

  // Refused results leave the map and the job in place.
  const before = (await state()).nodes;
  await reread(e, { close: [{ id: count, source: other, verdict: "No" }] }, 400);
  await reread(e, { close: [{ id: colour, source: colour, verdict: "No" }] }, 400);
  await reread(e, { close: [{ id: colour, source: unrelated, verdict: "No" }] }, 400);
  await reread(e, { close: [{ id: colour, source: count }] }, 400);
  await reread(e, { remove: [count] }, 400);
  await reread(e, { remove: [other] }, 400);
  await reread(e, { remove: ["root"] }, 400);
  await reread(e, { move: [{ id: count, parentId: detail }] }, 400);
  await reread(e, { move: [{ id: count, parentId: "missing" }] }, 400);
  await reread(e, { merge: [{ ids: [count, colour], answer: "Both", status: "ok", verdict: "No" }] }, 400);
  await reread(e, { merge: [{ ids: [count], answer: "One", status: "ok", verdict: "No" }] }, 400);
  await reread(e, { add: ["a", "b", "c", "d"].map(k => ({ key: "$" + k, parentId: "root", q: k, options })) }, 400);
  await reread(e, { add: [{ key: "$x", parentId: "root", q: "One option", options: ["A"] }] }, 400);
  await reread(e, { add: [{ key: "$x", parentId: "root", q: "Bad", options, conflictOf: [count, colour] }] }, 400);
  await reread(e, { order: [count] }, 400);
  // Answers being merged cannot also disagree.
  await reread(e, { merge: [{ ids: [count, why], keep: count, answer: "Two blue buttons", status: "ok", verdict: "Same" }], add: [{ key: "$x", parentId: "root", q: "Both?", options, conflictOf: [count, why] }] }, 400);
  await request("spec", {}, 409);
  assert.deepEqual((await state()).nodes, before);
  assert.ok(!fs.existsSync(path.join(map, "state.before-reread.json")));

  // Rules 2-5 apply together, and the previous map is kept.
  const copyOf = fs.readFileSync(path.join(map, "state.json"), "utf8");
  const result = await reread(e, {
    brief: "New idea",
    close: [{ id: colour, source: count, verdict: "Closed by the count answer" }],
    merge: [{ ids: [count, why], keep: count, answer: "Two blue buttons", status: "ok", verdict: "Same answer" }],
    add: [{ key: "$conflict", parentId: "root", area: "Data", q: "Which buttons?", why: "Disagreement", options, conflictOf: [why, other] }],
    remove: [unrelated], order: [other, "$conflict", count, colour]
  });
  assert.equal(result.changed, true); assert.equal(result.added, 1); assert.equal(result.removed, 1);
  s = await state();
  assert.equal(s.rereadPending, null); assert.equal(s.rereadResult.summary, "Checked"); assert.equal(s.brief, "New idea");
  assert.match(fs.readFileSync(path.join(map, "session.md"), "utf8"), /New idea/);
  assert.equal(by(s, "Colour?").answer, "Two blue buttons"); assert.equal(by(s, "Colour?").status, "ok");
  assert.equal(by(s, "Why?"), undefined); assert.equal(by(s, "Unrelated?"), undefined);
  assert.deepEqual(by(s, "Count?").mergedFrom.map(m => m.id), [count, why]);
  assert.match(await (await fetch(url + "api/report", { headers: { "x-grill": "1" } })).text(), /Why\?: Two blue buttons/);
  assert.equal(by(s, "Count detail?").answer, "Queued first");
  const conflict = by(s, "Which buttons?");
  assert.deepEqual(conflict.conflictOf, [count, other]); assert.equal(conflict.status, "open");
  assert.deepEqual(["Other?", "Which buttons?", "Count?", "Colour?"].map(q => by(s, q).prio), [1, 2, 3, 4]);
  const saved = JSON.parse(fs.readFileSync(path.join(map, "state.before-reread.json"), "utf8"));
  assert.equal(saved.version, JSON.parse(copyOf).version);
  assert.equal(saved.rereadJob, null); assert.ok(saved.nodes.some(n => n.q === "Why?"));
  await reread(e, {}, 409);
  await request("answer", { id: colour, answer: "Allowed again" });
  await request("cancel", { id: colour });

  // Chat images reach the rebuild.
  await request("discuss", { id: other, images: ["data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(16)]).toString("base64")] });
  e = await wait(); await request("apply", { type: "discuss", id: other, token: e.token, reply: "Seen" });
  // A disagreement is not raised twice; an unchanged run changes nothing and keeps the copy.
  await request("reread", {}); e = await wait(); assert.equal(e.type, "reread");
  assert.ok(fs.existsSync(by(e, "Other?").chat.at(-2).images[0]));
  await reread(e, { add: [{ key: "$again", parentId: "root", q: "Again?", options, conflictOf: [other, count] }] }, 400);
  const copy = fs.statSync(path.join(map, "state.before-reread.json")).mtimeMs;
  assert.equal((await reread(e)).changed, false);
  assert.equal(fs.statSync(path.join(map, "state.before-reread.json")).mtimeMs, copy);

  // A refusal unlocks the map without touching it.
  await request("reread", {}); e = await wait();
  const refused = await reread(e, { error: "A chain would break" });
  assert.equal(refused.ok, false); s = await state();
  assert.equal(s.rereadPending, null); assert.equal(s.rereadResult.error, "A chain would break");

  // Identical text is not an edit, and a withdrawn edit cancels its automatic run.
  await request("answer", { id: other, answer: "Three green buttons" });
  assert.equal((await state()).rereadPending, null);
  await request("cancel", { id: other });
  await request("answer", { id: other, answer: "Changed my mind" });
  assert.equal((await state()).rereadPending.stage, "queued");
  await request("cancel", { id: other });
  s = await state(); assert.equal(s.rereadPending, null); assert.equal(s.queueLength, s.knowledgePending ? 1 : 0);

  await request("answer", { id: other, answer: "Changed my mind" });
  await request("answer", { id: other, answer: "Three green buttons" });
  s = await state(); assert.equal(s.rereadPending, null);
  e = await wait(); await request("apply", { type: "answer", id: other, token: e.token, status: "ok", verdict: "Checked" });
  assert.equal((await state()).rereadPending, null);

  // A merged conflict card keeps its disagreement on record.
  const conflictId = by(s, "Which buttons?").id;
  await request("answer", { id: conflictId, answer: "Blue" });
  e = await wait(); await request("apply", { type: "answer", id: conflictId, token: e.token, status: "ok", verdict: "Checked" });
  await request("reread", {}); e = await wait();
  await reread(e, { merge: [{ ids: [other, conflictId], keep: other, answer: "Blue after all", status: "ok", verdict: "Settled" }] });
  s = await state(); assert.deepEqual(by(s, "Other?").conflictOf, [count, other]);
  // Only the user settles an open conflict card.
  await request("reread", {}); e = await wait();
  await reread(e, { add: [{ key: "$open", parentId: "root", area: "D", q: "Open conflict?", options, conflictOf: [count, colour] }] });
  const open = by(await state(), "Open conflict?").id;
  await request("reread", {}); e = await wait();
  await reread(e, { close: [{ id: open, source: count, verdict: "Decided for the user" }] }, 400);
  await reread(e, { remove: [open] }, 400);
  await reread(e, { merge: [{ ids: [count, colour], keep: count, answer: "Combined", status: "ok", verdict: "Decided for the user" }] }, 400);
  await reread(e, { add: [{ key: "$same", parentId: "root", area: "D", q: "Same?", options, conflictOf: [colour, count] }] }, 400);
  await reread(e);
  await request("reread", {}); e = await wait();
  await reread(e, { add: [{ key: "$again", parentId: "root", q: "Again?", options, conflictOf: [count, other] }] }, 400);
  await reread(e);

  // Editing an answer queues an unlocked automatic run; edits in a row join it.
  await request("answer", { id: other, answer: "Edited once" });
  s = await state(); assert.equal(s.rereadPending.locked, false);
  await request("answer", { id: count, answer: "Edited twice" });
  assert.equal((await state()).queueLength, 3);
  e = await wait(); assert.equal(e.type, "answer");
  await request("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Checked" });
  e = await wait(); assert.equal(e.type, "answer");
  await request("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Checked" });
  e = await wait(); assert.equal(e.type, "reread"); await reread(e);

  // A running specification finishes first.
  await request("reread", {}); await request("spec", {});
  e = await wait(); assert.equal(e.type, "spec");
  await request("apply", { type: "spec", token: e.token, markdown: "# Plan" });
  e = await wait(); assert.equal(e.type, "reread"); await reread(e);

  // With no agent connected, answers stay open and the request waits.
  await stop(); await start();
  await request("reread", {});
  s = await state(); assert.equal(s.listening, false); assert.equal(s.rereadPending.locked, false);
  await request("answer", { id: colour, answer: "Answered while waiting" });
  e = await wait(); assert.equal(e.type, "answer");
  await request("apply", { type: "answer", id: colour, token: e.token, status: "ok", verdict: "Checked" });
  e = await wait(); assert.equal(e.type, "reread");

  await reread(e);

  // A kept child rises above its merged parent; a repeat set inside a union is still refused; merged chats stay within the limit.
  await request("init", { title: "Merge", questions: ["P?", "A?", "B?", "C?", "D?", "E?", "F?"].map(q => ({ q, options })) });
  s = await state();
  const [P, A, B, C, D, E, F] = ["P?", "A?", "B?", "C?", "D?", "E?", "F?"].map(q => by(s, q).id);
  await grade(P, "Same", { children: [{ q: "Child?", options }] });
  const child = by(await state(), "Child?").id;
  for (const [id, answer] of [[child, "Same"], [A, "a"], [B, "b"], [C, "c"], [D, "d"], [E, "e"], [F, "f"]]) await grade(id, answer);
  await request("reread", {}); e = await wait();
  await reread(e, { merge: [{ ids: [P, child], keep: child, answer: "Same", status: "ok", verdict: "Same" }] });
  s = await state(); assert.equal(by(s, "Child?").parentId, "root"); assert.ok(by(s, "Child?").prio);
  await request("reread", {}); e = await wait();
  await reread(e, { add: [{ key: "$x", parentId: "root", area: "D", q: "X?", options, conflictOf: [A, B] }, { key: "$y", parentId: "root", area: "D", q: "Y?", options, conflictOf: [C, D] }] });
  s = await state();
  const [X, Y] = ["X?", "Y?"].map(q => by(s, q).id);
  await grade(X, "x"); await grade(Y, "y");
  await request("reread", {}); e = await wait();
  await reread(e, { merge: [{ ids: [X, Y], keep: X, answer: "xy", status: "ok", verdict: "Both" }] });
  await request("reread", {}); e = await wait();
  await reread(e, { add: [{ key: "$z", parentId: "root", area: "D", q: "Again?", options, conflictOf: [A, B] }] }, 400);
  await reread(e);
  for (const id of [E, F]) for (let i = 0; i < 26; i++) {
    await request("discuss", { id, message: "m" + i });
    const d = await wait(); await request("apply", { type: "discuss", id, token: d.token, reply: "r" });
  }
  await request("reread", {}); e = await wait();
  await reread(e, { merge: [{ ids: [E, F], keep: E, answer: "ef", status: "ok", verdict: "Both" }] }, 400);
  await reread(e, { error: "stop" });
  assert.equal((await state()).rereadResult.error, "stop");

  // After an edit, the same cards can disagree anew.
  await request("init", { title: "Edit", questions: [{ q: "L?", options }, { q: "M?", options }] });
  s = await state();
  const [L, M] = ["L?", "M?"].map(q => by(s, q).id);
  await grade(L, "two"); await grade(M, "three");
  await request("reread", {}); e = await wait();
  await reread(e, { add: [{ key: "$c", parentId: "root", area: "D", q: "First?", options, conflictOf: [L, M] }] });
  await request("answer", { id: M, answer: "seven" });
  e = await wait(); await request("apply", { type: "answer", id: M, token: e.token, status: "ok", verdict: "Checked" });
  e = await wait(); assert.equal(e.type, "reread");
  await reread(e, { add: [{ key: "$d", parentId: "root", area: "D", q: "Second?", options, conflictOf: [L, M] }] });
  assert.ok(by(await state(), "Second?"));

  // Grading a parent cannot delete a conflict card and its record.
  await request("init", { title: "Guard", questions: [{ q: "Parent?", options }] });
  const parentId = by(await state(), "Parent?").id;
  await grade(parentId, "first", { children: [{ q: "C1?", options }, { q: "C2?", options }] });
  s = await state();
  const [c1, c2] = ["C1?", "C2?"].map(q => by(s, q).id);
  await grade(c1, "two"); await grade(c2, "three");
  await request("reread", {}); e = await wait();
  await reread(e, { add: [{ key: "$c", parentId, q: "C?", options, conflictOf: [c1, c2] }] });
  const cardId = by(await state(), "C?").id;
  await request("answer", { id: parentId, answer: "second" });
  e = await wait(); assert.equal(e.type, "answer");
  await request("apply", { type: "answer", id: parentId, token: e.token, status: "ok", verdict: "Checked", branchChanges: { remove: [cardId] } }, 400);
  await request("apply", { type: "answer", id: parentId, token: e.token, status: "ok", verdict: "Checked" });
  e = await wait(); assert.equal(e.type, "reread"); await reread(e);

  // The repeat guard follows each card, not matching text; unions do not count as disagreements.
  await request("init", { title: "Keys", questions: ["P1?", "P2?", "U1?", "U2?", "E1?", "E2?", "G1?"].map(q => ({ q, options })) });
  s = await state();
  const [P1, P2, U1, U2, E1, E2, G1] = ["P1?", "P2?", "U1?", "U2?", "E1?", "E2?", "G1?"].map(q => by(s, q).id);
  for (const [id, answer] of [[P1, "dunno"], [P2, "yes"], [U1, "dunno"], [U2, "dunno"], [E1, "e"], [E2, "e"], [G1, "g"]]) await grade(id, answer);
  await request("reread", {}); e = await wait();
  await reread(e, { add: [{ key: "$p", parentId: "root", area: "D", q: "PP?", options, conflictOf: [P1, P2] }], merge: [{ ids: [U1, U2], keep: U1, answer: "Unknown", status: "ok", verdict: "Same" }] });
  await request("reread", {}); e = await wait();
  await reread(e, { add: [{ key: "$p", parentId: "root", area: "D", q: "PP again?", options, conflictOf: [P1, P2] }] }, 400);
  await reread(e, { merge: [{ ids: [E1, E2], keep: E1, answer: "ee", status: "ok", verdict: "Same" }], add: [{ key: "$g", parentId: "root", area: "D", q: "EG?", options, conflictOf: [E1, E2, G1] }] });
  await request("reread", {}); e = await wait();
  await reread(e, { add: [{ key: "$g", parentId: "root", area: "D", q: "EG again?", options, conflictOf: [E1, G1] }] }, 400);
  await reread(e);
  await request("init", { title: "Union", questions: ["A1?", "B1?", "C1?", "D1?"].map(q => ({ q, options })) });
  s = await state();
  const [A1, B1, C1, D1] = ["A1?", "B1?", "C1?", "D1?"].map(q => by(s, q).id);
  for (const [id, answer] of [[A1, "same"], [B1, "other"], [C1, "same"], [D1, "another"]]) await grade(id, answer);
  await request("reread", {}); e = await wait();
  await reread(e, { add: [{ key: "$x", parentId: "root", area: "D", q: "AB?", options, conflictOf: [A1, B1] }, { key: "$y", parentId: "root", area: "D", q: "CD?", options, conflictOf: [C1, D1] }] });
  s = await state();
  const [AB, CD] = ["AB?", "CD?"].map(q => by(s, q).id);
  await grade(AB, "settled"); await grade(CD, "settled");
  await request("reread", {}); e = await wait();
  await reread(e, { merge: [{ ids: [AB, CD], keep: AB, answer: "settled", status: "ok", verdict: "Same" }] });
  await request("reread", {}); e = await wait();
  await reread(e, { merge: [{ ids: [A1, C1], keep: A1, answer: "same", status: "ok", verdict: "Same" }] });

  // A new job clears the old result; a deeper kept descendant rises above the merged card.
  await request("init", { title: "Deep", questions: [{ q: "Top?", options }] });
  s = await state();
  const top = by(s, "Top?").id;
  await grade(top, "Deep", { children: [{ q: "Middle?", options }] });
  const middle = by(await state(), "Middle?").id;
  await grade(middle, "Other", { children: [{ q: "Low?", options }] });
  const low = by(await state(), "Low?").id;
  await grade(low, "Deep");
  await request("reread", {}); e = await wait();
  await reread(e, { error: "first" });
  await request("reread", {}); assert.equal((await state()).rereadResult, null);
  e = await wait();
  await reread(e, { merge: [{ ids: [top, low], keep: low, answer: "Deep", status: "ok", verdict: "Same" }] });
  s = await state();
  assert.equal(by(s, "Low?").parentId, "root"); assert.equal(by(s, "Middle?").parentId, low);

  // Retired status vocabulary: replace unanswered cards, preserve answered/discussed history.
  {
  await request("init", { title: "Ideas", questions: ["Which statuses?", "When does implementing start?", "Why not implement?", "Implementation approval?"].map(q => ({ q, options })) });
  s = await state();
  const [decision, emptyOld, answeredOld, discussedOld] = s.nodes.filter(n => n.kind === "q").map(n => n.id);
  await grade(decision, "Drop implementing/not implementing; use open/ok/weak/gap/verify.");
  await grade(answeredOld, "We used to reject implementation.", { children: [{ q: "Still relevant detail?", options }] });
  await request("discuss", { id: discussedOld, message: "Preserve this discussion." });
  e = await wait(); await request("apply", { type: "discuss", id: discussedOld, token: e.token, reply: "Noted" });
  const before = await state();
  await request("reread", {}); e = await wait();
  // Missing, duplicate, unknown, empty-reason and inconsistent audits cannot unlock or mutate the map.
  for (const audit of [undefined, [], auditFor(e).slice(1), auditFor(e).map((a, i) => i === 1 ? { ...a, id: decision } : a), auditFor(e).map((a, i) => i === 0 ? { ...a, id: "missing" } : a), auditFor(e).map(a => ({ ...a, reason: " " })), auditFor(e).map(a => ({ ...a, action: "remove" }))]) {
    await reread(e, { audit }, 400);
    assert.deepEqual((await state()).nodes, before.nodes);
    assert.equal((await state()).rereadPending.stage, "thinking");
  }
  const audit = auditFor(e).map(a => a.id === emptyOld ? { ...a, action: "remove", reason: "Removed statuses no longer exist." } : [answeredOld, discussedOld].includes(a.id) ? { ...a, action: "obsolete", reason: "The user explicitly removed these statuses.", sources: [decision] } : a);
  await reread(e, { audit: audit.map(a => a.action === "obsolete" ? { ...a, sources: [emptyOld] } : a), remove: [emptyOld] }, 400);
  await reread(e, { audit: audit.map(a => a.id === emptyOld ? { ...a, action: "close" } : a), close: [{ id: emptyOld, source: answeredOld, verdict: "Must not reuse a withdrawn answer" }] }, 400);
  await reread(e, { audit, remove: [emptyOld], add: [{ key: "$current", parentId: "root", q: "What happens after Closed?", options }] });
  s = await state();
  assert.equal(s.nodes.some(n => n.id === emptyOld), false);
  for (const id of [answeredOld, discussedOld]) {
    const n = s.nodes.find(n => n.id === id), old = before.nodes.find(n => n.id === id);
    assert.deepEqual({ ...n, obsolete: undefined }, { ...old, obsolete: undefined });
    assert.deepEqual(n.obsolete.sources, [{ id: decision, q: "Which statuses?" }]);
    await request("answer", { id, answer: "Cannot grade retired premises" }, 409);
  }
  assert.equal(by(s, "Still relevant detail?").parentId, answeredOld);
  assert.equal(s.rereadResult.audit.length, contextCards(e).length);
  await request("answer", { id: by(s, "Still relevant detail?").id, answer: "Current child answer" });
  let childEvent = await wait();
  assert.ok(childEvent.context.focus.find(n => n.id === answeredOld).obsolete);
  assert.equal(childEvent.existingQuestions, undefined);
  await request("apply", { type: "answer", id: childEvent.id, token: childEvent.token, status: "ok", verdict: "Current detail checked" });
  await request("more", {}); let moreEvent = await wait();
  assert.ok(moreEvent.mainQuestions.find(n => n.q === "Why not implement?").obsolete);
  await request("apply", { type: "more", questions: [] });
  await request("finish", {}); let finishEvent = await wait();
  assert.equal(finishEvent.counts.ok, 2);
  await request("apply", { type: "finish", summary: "Checked active counts" });
  assert.match(await (await fetch(url + "api/report", { headers: { "x-grill": "1" } })).text(), /Устарело: The user explicitly/);
  await request("spec", {}); let spec = await wait();
  assert.ok(spec.nodes.find(n => n.id === answeredOld).obsolete);
  await request("apply", { type: "spec", token: spec.token, markdown: "# Current decisions only" });
  await stop(); await start();
  assert.ok((await state()).nodes.find(n => n.id === answeredOld).obsolete);
  await request("reread", {}); e = await wait();
  assert.ok(contextCards(e).find(n => n.id === discussedOld).obsolete);
  assert.equal((await reread(e)).changed, false);
  // A later explicit user decision can restore a historical card without changing its old answer.
  await request("discuss", { id: answeredOld, message: "Restore this question; it applies again." });
  e = await wait(); assert.ok(focusCard(e).obsolete); await request("apply", { type: "discuss", id: answeredOld, token: e.token, reply: "Reread will review this." });
  await request("reread", {}); e = await wait();
  await reread(e, { audit: auditFor(e).map(a => a.id === answeredOld ? { ...a, action: "restore", reason: "Explicit user request in discussion.", sources: [answeredOld] } : a) });
  assert.equal((await state()).nodes.find(n => n.id === answeredOld).obsolete, undefined);
  assert.equal((await state()).nodes.find(n => n.id === answeredOld).answer, "We used to reject implementation.");
  }

  // init cancels the job; a late result is stale.
  await request("reread", {}); e = await wait();
  await request("init", { title: "Fresh", questions: [{ q: "New?", options }] });
  await reread(e, {}, 409);
  s = await state(); assert.equal(s.rereadPending, null); assert.equal(s.rereadResult, null);
  // Synthesized merge text must not inherit the exact-user-message label of the kept card.
  await request("init", { title: "Provenance", questions: ["Source A?", "Source B?", "Still open?"].map(q => ({ q, options })) });
  const provenanceIds = (await state()).nodes.filter(n => n.kind === "q").slice(0, 2).map(n => n.id);
  await request("discuss", { id: "root", message: "Original user wording" }); e = await wait();
  await request("apply", { type: "discuss", id: e.id, token: e.token, reply: "Saved to both cards", answers: provenanceIds.map(id => ({ id, messageIds: [discussionChat(e).at(-1).id], status: "ok", verdict: "Confirmed" })) });
  await request("reread", {}); e = await wait();
  await reread(e, { merge: [{ ids: provenanceIds, keep: provenanceIds[0], answer: "Combined synthesis", status: "ok", verdict: "Combined evidence" }] });
  const combined = (await state()).nodes.find(n => n.id === provenanceIds[0]);
  assert.equal(combined.answer, "Combined synthesis"); assert.equal(combined.answerSource, undefined);
  assert.ok(combined.mergedFrom.every(n => n.answer === "Original user wording" && n.answerSource.id === "root"));
  // Discussion replacement of a decision must reconsider other branches based on its old answer.
  await request("init", { title: "Cross-branch discussion edit", questions: ["Decision?", "Dependent?", "Unrelated open?"].map(q => ({ q, options })) });
  const editIds = (await state()).nodes.filter(n => n.kind === "q").map(n => n.id);
  await grade(editIds[0], "Old user decision");
  await request("reread", {}); e = await wait();
  await reread(e, { close: [{ id: editIds[1], source: editIds[0], verdict: "Old decision settles this" }] });
  await request("discuss", { id: "root", message: "New incompatible decision" }); e = await wait();
  await request("apply", { type: "discuss", id: e.id, token: e.token, reply: "Updated; reviewing dependencies", answers: [{ id: editIds[0], messageIds: [discussionChat(e).at(-1).id], status: "ok", verdict: "User changed decision" }] });
  assert.equal((await state()).rereadPending.stage, "queued");
  e = await wait(); assert.equal(e.type, "reread");
  assert.equal(contextCards(e).find(n => n.id === editIds[0]).answer, "New incompatible decision");
  assert.equal(e.context.mode, "incremental");
  assert.equal(contextCards(e).some(n => n.id === editIds[1]), false);
  assert.ok(e.context.index.includes(editIds[1]));
  assert.equal((await request("node?id=" + editIds[1])).nodes[0].answer, "Old user decision");
  const untouched = (await state()).nodes.find(n => n.id === editIds[1]);
  // Changing an indexed card requires its own audit even after an explicit read.
  const unaudited = await reread(e, { semantics: [{ id: editIds[1], decision: "Unaudited navigation edit" }] }, 400);
  assert.match(unaudited.error, /Изменённой карточке нужна проверка/);
  assert.deepEqual((await state()).nodes.find(n => n.id === editIds[1]), untouched);
  await reread(e);
  assert.deepEqual((await state()).nodes.find(n => n.id === editIds[1]), untouched);
  await request("reread", {}); e = await wait();
  assert.equal(e.context.mode, "full");
  assert.equal(contextCards(e).length, 3);
  await reread(e, { audit: auditFor(e).slice(1) }, 400);
  await reread(e);
  console.log("Reread checks passed");
} finally { await stop(); fs.rmSync(cwd, { recursive: true, force: true }); }
