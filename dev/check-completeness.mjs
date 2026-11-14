import { contextCards } from "./context-fixture.mjs";
import { knowledgeFixture } from "./knowledge-fixture.mjs";
// Verify reserve accounting, automatic dispatch, semantic ancestor review and exact read receipts.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-completeness-")), dir = path.join(cwd, "maps");
let server, url;
async function start() {
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--name", "check", "--port", "0"], { cwd, windowsHide: true, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(dir, "check", "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("Server did not start");
}
const api = knowledgeFixture(rawRequest);
async function rawRequest(route, body, expected = 200) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, expected, await r.clone().text());
  return route === "report" ? r.text() : r.json();
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const ended = new Promise(r => server.once("exit", r)); await api("stop", {}); await ended;
}
const state = () => api("state"), wait = () => api("wait?timeout=5");
const node = async id => (await state()).nodes.find(n => n.id === id);

const question = q => ({ q, options: ["A", "B"] });
const reread = (e, extra = {}, status = 200) => api("apply", { type: "reread", token: e.token, audit: contextCards(e).map(n => ({ id: n.id, action: "keep", reason: "Current" })), ...extra }, status);
const grade = async (id, answer, extra = {}) => {
  await api("answer", { id, answer }); const e = await wait(); assert.equal(e.type, "answer");
  await api("apply", { type: "answer", id, token: e.token, status: "weak", verdict: "Original weakness", ...extra }); return e;
};
const assess = (e, verdict = "Branch evidence resolves weakness", status = "ok", expected = 200) => api("apply", { type: "reevaluate", token: e.token, capturedForSpec: e.capturedForSpec, assessments: e.ids.map(id => ({ id, status, verdict })) }, expected);
try {
  await start();
  await api("init", { title: "Legacy", questions: [question("Legacy?")] });
  assert.equal((await state()).coverage.percent, null);
  assert.equal((await state()).reserve, null);
  const reserve = Array.from({ length: 5 }, (_, i) => ({ id: `candidate-${i}`, ...question(`Hidden ${1000 + i}?`) }));
  await api("init", { title: "Coverage", questions: Array.from({ length: 5 }, (_, i) => question(`Shown ${1000 + i}?`)), reserve });
  assert.equal((await state()).coverage.percent, 50);
  await api("reread", {}); let e = await wait(); assert.equal(e.reserve.length, 5);
  await reread(e, { add: Array.from({ length: 4 }, (_, i) => ({ key: `$q${i}`, parentId: "root", ...question(`Bad ${i}?`) })) }, 400);
  assert.equal((await state()).coverage.percent, 50);
  await reread(e, { add: reserve.slice(0, 3).map((c, i) => ({ key: `$q${i}`, parentId: "root", ...c, reserveId: c.id })), reserve });
  assert.equal((await state()).coverage.percent, 80);
  assert.equal((await state()).reserve.length, 2);
  await reread(e);
  await stop(); await start(); assert.equal((await state()).coverage.percent, 80);
  assert.equal((await state()).reserve.length, 2);
  // Acknowledging one visible reply must never acknowledge a later reply.
  const reply = async text => { await api("discuss", { id: "root", message: text }); const d = await wait(); assert.equal(d.type, "discuss"); await api("apply", { type: "discuss", id: "root", token: d.token, reply: text }); return (await node("root")).chat.at(-1); };
  const first = await reply("First"), second = await reply("Second");
  await api("reread", {}); e = await wait();
  await api("discuss/read", { id: "root", messageId: first.id });
  await reread(e, { reserve: [] }); // Read receipts do not invalidate semantic revisions.
  assert.ok((await node("root")).chat.find(m => m.id === first.id).readAt);
  assert.ok(!(await node("root")).chat.find(m => m.id === second.id).readAt);
  await api("discuss/read", { id: "root", messageId: "missing" }, 404);
  assert.equal((await fetch(url + "api/discuss/read", { method: "POST" })).status, 403);
  await stop(); await start();
  assert.ok((await node("root")).chat.find(m => m.id === first.id).readAt);
  assert.ok(!(await node("root")).chat.find(m => m.id === second.id).readAt);
  // Creation, retry and restart preserve one automatically queued analysis.
  const idea = await api("idea", { id: "create-once", actionId: "create-once", text: "Automatic idea" });
  assert.equal((await api("idea", { id: "create-once", actionId: "create-once", text: "Automatic idea" })).actionId, idea.actionId);
  await stop(); await start(); e = await wait(); assert.equal(e.type, "idea"); assert.ok(e.id);
  await api("apply", { type: "idea", id: e.id, token: e.token, status: "ok", verdict: "Supported" });
  assert.equal((await state()).queueLength, 0); // No answered cards changed, so reread needs no knowledge extraction.
  // A weak parent is reviewed semantically after its child; its own answer stays verbatim.
  await api("init", { title: "Parents", questions: [question("Parent?"), question("Keep map open?")], reserve: [] });
  const parent = (await state()).nodes.find(n => n.q === "Parent?");
  await grade(parent.id, "Original user answer", { children: [question("Evidence?")] });
  const child = (await state()).nodes.find(n => n.parentId === parent.id);
  await grade(child.id, "Concrete evidence"); e = await wait(); assert.equal(e.type, "reevaluate"); assert.deepEqual(e.ids, [parent.id]);
  await api("discuss", { id: parent.id, message: "New contradictory evidence" });
  await assess(e, "Evidence still needs verification", "verify");
  const d = await wait(); assert.equal(d.type, "discuss"); await api("apply", { type: "discuss", id: d.id, token: d.token, reply: "Consider contradiction" });

  assert.equal((await node(parent.id)).answer, "Original user answer");
  assert.equal((await node(parent.id)).status, "verify");
  assert.deepEqual((await node(parent.id)).verdictHistory.map(h => h.verdict), ["Original weakness", "Evidence still needs verification"]);
  assert.match(await api("report"), /Original weakness/);
  await assess(e, "Duplicate", "ok");
  // Inline assessment is atomic; an empty list suppresses only this answer's review.
  await api("answer", { id: child.id, answer: "Concrete evidence" });
  e = await wait(); assert.deepEqual(e.ancestorIds, [parent.id]);
  const inlineResult = { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Measured" };
  const beforeInline = (await node(parent.id)).verdictHistory.length;
  await api("apply", { ...inlineResult, ancestors: [{ id: "root", status: "ok", verdict: "Invalid" }] }, 400);
  assert.ok((await node(child.id)).pending);
  assert.equal((await node(parent.id)).verdictHistory.length, beforeInline);
  await api("apply", { ...inlineResult, ancestors: [{ id: parent.id, status: "ok", verdict: "Original weakness resolved" }] });
  assert.equal((await node(parent.id)).status, "ok");
  assert.equal((await state()).queueLength, 0);
  await grade(child.id, "Concrete evidence", { ancestors: [] });
  assert.equal((await state()).queueLength, 0);
  await grade(child.id, "Concrete evidence", { reviewAncestors: true });
  e = await wait(); assert.equal(e.type, "reevaluate"); await assess(e);
  // Each answer completes its ancestor review before the next sibling answer.
  await grade(parent.id, "Original user answer", { children: [question("Second proof?")] });
  const sibling = (await state()).nodes.find(n => n.q === "Second proof?");
  await api("answer", { id: child.id, answer: "Concrete evidence" });
  await api("answer", { id: sibling.id, answer: "Second evidence" });
  for (const id of [child.id, sibling.id]) {
    e = await wait(); assert.equal(e.type, "answer"); assert.equal(e.id, id);
    await api("apply", { type: "answer", id, token: e.token, status: "ok", verdict: "Confirmed" });
    e = await wait(); assert.deepEqual(e.ids, [parent.id]); await assess(e);
  }
  await grade(child.id, "Concrete evidence"); await assess(await wait(), "Needs verification", "verify");
  // Later sibling discussions do not invalidate the active inline assessment.
  await api("answer", { id: child.id, answer: "Concrete evidence" }); e = await wait();
  const childHistory = (await node(child.id)).verdictHistory.length;
  await api("discuss", { id: sibling.id, message: "This proof is now disputed" });
  const siblingResult = { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Card remains valid" };
  await api("apply", { ...siblingResult, ancestors: [{ id: "root", status: "ok", verdict: "Invalid ID" }] }, 400);
  assert.ok((await node(child.id)).pending);
  await api("apply", { ...siblingResult, ancestors: [{ id: parent.id, status: "ok", verdict: "Stale closure" }] });
  assert.equal((await node(child.id)).pending, null);
  assert.equal((await node(child.id)).verdictHistory.length, childHistory + 1);
  assert.equal((await node(parent.id)).status, "ok");
  e = await wait(); assert.equal(e.type, "discuss");
  await api("apply", { type: "discuss", id: e.id, token: e.token, reply: "Recorded" });

  // An explicit empty ancestor list stays authoritative despite a later answer.
  await api("answer", { id: child.id, answer: "Concrete evidence" }); e = await wait();
  await api("answer", { id: sibling.id, answer: "Second evidence" });
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Keep grade", ancestors: [] });
  assert.equal((await node(child.id)).pending, null);
  assert.equal((await node(parent.id)).status, "ok");
  await stop(); await start();
  e = await wait(); assert.equal(e.type, "answer"); assert.equal(e.id, sibling.id);
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Second grade", ancestors: [] });

  // Earlier parent reviews finish before a specification captures the tree.
  await api("answer", { id: child.id, answer: "Frozen evidence" }); await api("spec", {});
  e = await wait(); assert.equal(e.type, "answer"); assert.equal(!!e.capturedForSpec, false);
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Measured" });
  e = await wait(); assert.equal(e.type, "reevaluate"); assert.equal(!!e.capturedForSpec, false);
  assert.ok((await api("node?id=" + parent.id)).nodes.length);
  await api("discuss", { id: "root", message: "Later live discussion" });
  assert.ok(!e.nodes.find(n => n.id === "root")?.chat?.length);
  await stop(); await start(); await assess(e, "Old token", "ok", 409);
  e = await wait(); assert.equal(e.type, "reevaluate"); assert.equal(!!e.capturedForSpec, false); await assess(e);
  assert.equal((await node(parent.id)).status, "ok");
  e = await wait(); assert.equal(e.type, "reread"); await reread(e, { reserve: [] });
  e = await wait(); assert.equal(e.type, "spec"); assert.equal(e.nodes.find(n => n.id === parent.id).status, "ok");
  await api("apply", { type: "spec", token: e.token, markdown: "# Frozen review" });
  e = await wait(); assert.equal(e.type, "discuss"); await api("apply", { type: "discuss", id: e.id, token: e.token, reply: "Live only" });

  // Zero-open triggers once only after grading; weak/gap/verify do not prevent it.
  await api("init", { title: "Automatic", questions: [question("Last?")], reserve: [{ id: "next", ...question("Next?") }] });
  const last = (await state()).nodes.find(n => n.kind === "q");
  await grade(last.id, "Weak answer"); e = await wait(); assert.equal(e.type, "reread");
  await reread(e, { reserve: [] }); assert.equal((await state()).coverage.percent, 100);
  assert.equal((await wait()).type, "timeout");
  await stop(); await start(); assert.equal((await wait()).type, "timeout");
  await api("finish", {}); e = await wait(); assert.equal(e.type, "finish"); await api("apply", { type: "finish", token: e.token, summary: "Stopped" });
  await api("discuss", { id: "root", message: "After stopping" });
  assert.equal((await wait()).type, "timeout");
  await api("actions/continue", {});
  e = await wait(); assert.equal(e.type, "discuss"); await api("apply", { type: "discuss", id: e.id, token: e.token, reply: "Continued" });
  // Finish respects prior answers and pauses later commands, across restart.
  for (const editBeforeFinish of [false, true]) {
    await api("init", { title: "Stop edits", questions: [question("Editable?")], reserve });
    const q = (await state()).nodes.find(n => n.kind === "q");
    await grade(q.id, "Original");
    if (editBeforeFinish) await api("answer", { id: q.id, answer: "Edited" });
    await api("finish", {});
    if (!editBeforeFinish) await api("answer", { id: q.id, answer: "Edited" });
    await stop(); await start();
    for (;;) {
      e = await wait();
      if (e.type === "answer") await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Edited grade" });
      else if (e.type === "reread") await reread(e, { reserve: [] });
      else { assert.equal(e.type, "finish"); await api("apply", { type: "finish", token: e.token, summary: "Stopped" }); break; }
    }
    assert.equal((await node(q.id)).answer, editBeforeFinish ? "Edited" : "Original");
    assert.equal((await state()).queueLength, 0);
    assert.equal((await wait()).type, "timeout");
    if (!editBeforeFinish) {
      await api("actions/continue", {}); e = await wait(); assert.equal(e.type, "answer");
      await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "After continuation" });
    }
  }
  // A delivered automatic review completes before the finish boundary.
  await api("init", { title: "Stop delivered review", questions: [question("Last?")], reserve });
  await grade((await state()).nodes.find(n => n.kind === "q").id, "Answer");
  e = await wait(); assert.equal(e.type, "reread");
  await api("finish", {});
  await reread(e, { add: [{ key: "$late", parentId: "root", ...question("Earlier review?") }], reserve: [] });
  assert.equal((await state()).nodes.filter(n => n.kind === "q").length, 2);
  await stop(); await start();
  e = await wait(); assert.equal(e.type, "finish"); await api("apply", { type: "finish", token: e.token, summary: "Stopped" });
  await api("reread", {}); assert.equal((await wait()).type, "timeout");
  await api("actions/continue", {}); e = await wait(); assert.equal(e.type, "reread");
  await reread(e, { add: [{ key: "$manual", parentId: "root", ...question("Explicitly requested?") }], reserve: [] });
  assert.equal((await state()).nodes.filter(n => n.kind === "q").length, 3);
  // Drain readiness includes semantic work after finish and child grading.
  await api("init", { title: "Drain", questions: [question("Parent")], reserve: [] });
  const drainParent = (await state()).nodes.find(n => n.kind === "q");
  await grade(drainParent.id, "Parent answer", { children: [question("Child")] });
  const drainChild = (await state()).nodes.find(n => n.parentId === drainParent.id);
  await api("answer", { id: drainChild.id, answer: "Evidence" }); await api("finish", {});
  e = await wait(); assert.equal(e.type, "answer"); await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Child grade" });
  assert.equal((await state()).queueLength, 2); // Review and queued finish.
  assert.equal((await api("maps")).maps[0].queue, 2);
  e = await wait(); await assess(e, "Unique prior parent verdict");
  e = await wait(); assert.equal(e.type, "finish"); await api("apply", { type: "finish", token: e.token, summary: "Done" });
  assert.equal((await state()).queueLength, 0);
  await api("actions/continue", {});
  // Merging removes the source card but preserves every historical verdict in the report.
  await api("reread", {}); e = await wait();
  await reread(e, { audit: contextCards(e).map(n => ({ id: n.id, action: "merge", reason: "Same evidence" })),
    merge: [{ ids: [drainParent.id, drainChild.id], keep: drainChild.id, answer: "Parent answer\nEvidence", status: "ok", verdict: "Combined" }] });
  assert.ok(!(await state()).nodes.some(n => n.id === drainParent.id));
  assert.match(await api("report"), /Original weakness/);
  assert.match(await api("report"), /Unique prior parent verdict/);

  // Seed only disposable state to reproduce large maps without hundreds of HTTP edits.
  const seed = async nodes => {
    await api("init", { title: "Large", questions: [question("Seed")], reserve: [] }); await stop();
    const file = path.join(dir, "check", "state.json"), saved = JSON.parse(fs.readFileSync(file));
    saved.nodes = [saved.nodes[0], ...nodes]; saved.finished = true; saved.reevaluation = { ids: ["p", "other"] };
    fs.writeFileSync(file, JSON.stringify(saved)); await start();
  };
  const parentNode = id => ({ id, parentId: "root", kind: "q", q: id, status: "weak", answer: "Original", verdict: "Weak" });
  const many = Array.from({ length: 501 }, (_, i) => ({ id: "large" + i, parentId: "root", kind: "q", q: "Q" + i, status: "open" }));
  await seed([parentNode("p"), parentNode("other"), ...many]);
  e = await wait(); assert.deepEqual(e.ids, ["p"]); assert.equal(e.nodes.length, 1); // Root is not reassessment evidence.
  await stop(); await start(); await assess(e, "Stale", "ok", 409);
  e = await wait(); await assess(e); assert.equal((await state()).queueLength, 1);
  e = await wait(); assert.deepEqual(e.ids, ["other"]); await assess(e);
  const tooLarge = await api("reread", {}), blockedFinish = await api("finish", {});
  assert.equal((await wait()).type, "timeout");
  assert.equal((await api("actions?id=" + tooLarge.actionId)).actions[0].status, "failed");
  assert.equal((await api("actions?id=" + blockedFinish.actionId)).actions[0].status, "failed");
  await api("finish", {}); // A new finish explicitly excludes the failed reread.
  assert.equal((await wait()).type, "timeout"); // Oversized knowledge needs explicit resolution.
  assert.equal((await state()).knowledgePending.stage, "blocked");
  await api("knowledge-skip", {});
  e = await wait(); assert.equal(e.type, "finish"); await api("apply", { type: "finish", token: e.token, summary: "Done" });
  assert.equal((await wait()).type, "timeout");
  // Legacy batches finish before a new specification and survive redelivery.
  await seed([parentNode("p"), parentNode("other"), ...many]); await api("spec", {});
  assert.ok((await state()).queueLength >= 2);
  e = await wait(); assert.equal(!!e.capturedForSpec, false); assert.deepEqual(e.ids, ["p"]);
  await stop(); await start(); await assess(e, "Stale", "ok", 409);
  e = await wait(); await assess(e); e = await wait(); assert.deepEqual(e.ids, ["other"]); await assess(e);
  assert.equal((await node("p")).status, "ok");
  e = await wait(); assert.equal(e.type, "spec"); await api("apply", { type: "spec", token: e.token, markdown: "# Large frozen map" });
  // Serialized size and a single oversized affected branch also release unrelated work.
  await seed([parentNode("p"), parentNode("other"), { id: "huge", parentId: "p", kind: "q", q: "Huge", status: "open", chat: [{ from: "user", text: "x".repeat(600001) }] }]);
  await api("wait?timeout=5", undefined, 400); assert.deepEqual((await state()).reevaluationError.ids, ["p"]);
  e = await wait(); assert.deepEqual(e.ids, ["other"]); await assess(e);
  const oversized = await api("reread", {}); assert.equal((await wait()).type, "timeout");
  assert.equal((await api("actions?id=" + oversized.actionId)).actions[0].status, "failed");
  assert.equal((await wait()).type, "timeout");
  await seed([parentNode("p"), parentNode("other"), ...many.map(n => ({ ...n, parentId: "p" }))]);
  await api("wait?timeout=5", undefined, 400); e = await wait(); assert.deepEqual(e.ids, ["other"]); await assess(e);
  await seed([parentNode("p"), parentNode("other"), ...many.map(n => ({ ...n, parentId: "p" }))]);
  await api("spec", {}); await api("wait?timeout=5", undefined, 400);
  assert.equal((await state()).specPending, null);
  e = await wait(); assert.deepEqual(e.ids, ["other"]); await assess(e);
  e = await wait(); assert.equal(e.type, "spec");
  await api("apply", { type: "spec", token: e.token, markdown: "# Surviving branch" });
  console.log("completeness checks passed");
} finally { await stop(); fs.rmSync(cwd, { recursive: true, force: true }); }
