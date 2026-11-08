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
async function api(route, body, expected = 200) {
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
const reread = (e, extra = {}, status = 200) => api("apply", { type: "reread", token: e.token, audit: e.nodes.map(n => ({ id: n.id, action: "keep", reason: "Current" })), ...extra }, status);
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
  const reserve = Array.from({ length: 5 }, (_, i) => ({ id: `candidate-${i}`, ...question(`Hidden ${i}?`) }));
  await api("init", { title: "Coverage", questions: Array.from({ length: 5 }, (_, i) => question(`Shown ${i}?`)), reserve });
  assert.equal((await state()).coverage.percent, 50);
  await api("reread", {}); let e = await wait(); assert.equal(e.reserve.length, 5);
  await reread(e, { add: Array.from({ length: 4 }, (_, i) => ({ key: `$q${i}`, parentId: "root", ...question(`Bad ${i}?`) })) }, 400);
  assert.equal((await state()).coverage.percent, 50);
  await reread(e, { add: reserve.slice(0, 3).map((c, i) => ({ key: `$q${i}`, parentId: "root", ...c, reserveId: c.id })), reserve });
  assert.equal((await state()).coverage.percent, 80);
  assert.equal((await state()).reserve.length, 2);
  await reread(e, {}, 409);
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
  const idea = await api("idea", { id: "create-once", text: "Automatic idea" });
  assert.equal((await api("idea", { id: "create-once", text: "Automatic idea" })).id, idea.id);
  await stop(); await start(); e = await wait(); assert.equal(e.type, "idea"); assert.equal(e.id, idea.id);
  await api("apply", { type: "idea", id: e.id, token: e.token, status: "ok", verdict: "Supported" });
  assert.equal((await state()).queueLength, 0);
  // A weak parent is reviewed semantically after its child; its own answer stays verbatim.
  await api("init", { title: "Parents", questions: [question("Parent?"), question("Keep map open?")], reserve: [] });
  const parent = (await state()).nodes.find(n => n.q === "Parent?");
  await grade(parent.id, "Original user answer", { children: [question("Evidence?")] });
  const child = (await state()).nodes.find(n => n.parentId === parent.id);
  await grade(child.id, "Concrete evidence"); e = await wait(); assert.equal(e.type, "reevaluate"); assert.deepEqual(e.ids, [parent.id]);
  await api("discuss", { id: parent.id, message: "New contradictory evidence" });
  await assess(e, "Stale", "ok", 409);
  const d = await wait(); assert.equal(d.type, "discuss"); await api("apply", { type: "discuss", id: d.id, token: d.token, reply: "Consider contradiction" });
  e = await wait(); assert.equal(e.type, "reevaluate");
  await assess(e, "Evidence still needs verification", "verify");
  assert.equal((await node(parent.id)).answer, "Original user answer");
  assert.equal((await node(parent.id)).status, "verify");
  assert.deepEqual((await node(parent.id)).verdictHistory.map(h => h.verdict), ["Original weakness", "Evidence still needs verification"]);
  assert.match(await api("report"), /Original weakness/);
  await assess(e, "Duplicate", "ok", 409);
  // Frozen parent reviews use frozen evidence and do not update the live parent.
  await api("answer", { id: child.id, answer: "Frozen evidence" }); await api("spec", {});
  e = await wait(); assert.equal(e.type, "answer"); assert.equal(e.capturedForSpec, true);
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Measured" });
  e = await wait(); assert.equal(e.type, "reevaluate"); assert.equal(e.capturedForSpec, true);
  await api("discuss", { id: "root", message: "Later live discussion" });
  assert.ok(!e.nodes.find(n => n.id === "root")?.chat?.length);
  await stop(); await start(); await assess(e, "Old token", "ok", 409);
  e = await wait(); assert.equal(e.type, "reevaluate"); assert.equal(e.capturedForSpec, true); await assess(e);
  assert.equal((await node(parent.id)).status, "verify");
  e = await wait(); assert.equal(e.type, "spec"); assert.equal(e.nodes.find(n => n.id === parent.id).status, "ok");
  await api("apply", { type: "spec", token: e.token, markdown: "# Frozen review" });
  e = await wait(); assert.equal(e.type, "discuss"); await api("apply", { type: "discuss", id: e.id, token: e.token, reply: "Live only" });
  e = await wait(); assert.equal(e.type, "reevaluate"); assert.equal(e.capturedForSpec, false); await assess(e);
  e = await wait(); assert.equal(e.type, "reread"); await reread(e, { reserve: [] });
  // Zero-open triggers once only after grading; weak/gap/verify do not prevent it.
  await api("init", { title: "Automatic", questions: [question("Last?")], reserve: [{ id: "next", ...question("Next?") }] });
  const last = (await state()).nodes.find(n => n.kind === "q");
  await grade(last.id, "Weak answer"); e = await wait(); assert.equal(e.type, "reread");
  await reread(e, { reserve: [] }); assert.equal((await state()).coverage.percent, 100);
  assert.equal((await wait()).type, "timeout");
  await stop(); await start(); assert.equal((await wait()).type, "timeout");
  await api("finish", {}); e = await wait(); assert.equal(e.type, "finish"); await api("apply", { type: "finish", summary: "Stopped" });
  await reply("After stopping"); assert.equal((await wait()).type, "timeout");
  // Finishing cancels automatic edit reviews, but preserves queued answer grading.
  for (const editBeforeFinish of [false, true]) {
    await api("init", { title: "Stop edits", questions: [question("Editable?")], reserve });
    const q = (await state()).nodes.find(n => n.kind === "q");
    await grade(q.id, "Original");
    if (editBeforeFinish) await api("answer", { id: q.id, answer: "Edited" });
    await api("finish", {});
    if (!editBeforeFinish) await api("answer", { id: q.id, answer: "Edited" });
    assert.equal((await state()).rereadPending, null);
    await stop(); await start(); assert.equal((await state()).rereadPending, null);
    for (let i = 0; i < 2; i++) {
      e = await wait();
      if (e.type === "answer") await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Edited grade" });
      else { assert.equal(e.type, "finish"); await api("apply", { type: "finish", summary: "Stopped" }); }
    }
    assert.equal((await node(q.id)).answer, "Edited");
    assert.equal((await state()).queueLength, 0);
    assert.equal((await wait()).type, "timeout");
    await grade(q.id, "Edited after finish");
    assert.equal((await state()).rereadPending, null);
    await stop(); await start(); assert.equal((await wait()).type, "timeout");
  }
  // An already delivered automatic token is invalid at the finish-request boundary.
  await api("init", { title: "Stop delivered review", questions: [question("Last?")], reserve });
  await grade((await state()).nodes.find(n => n.kind === "q").id, "Answer");
  e = await wait(); assert.equal(e.type, "reread");
  await api("finish", {});
  assert.equal((await state()).rereadPending, null);
  await reread(e, { add: [{ key: "$late", parentId: "root", ...question("Too late?") }] }, 409);
  assert.equal((await state()).nodes.filter(n => n.kind === "q").length, 1);
  await stop(); await start(); await reread(e, {}, 409);
  assert.equal((await wait()).type, "finish"); await api("apply", { type: "finish", summary: "Stopped" });
  await api("reread", {}); e = await wait(); assert.equal(e.type, "reread");
  await reread(e, { add: [{ key: "$manual", parentId: "root", ...question("Explicitly requested?") }], reserve: [] });
  assert.equal((await state()).nodes.filter(n => n.kind === "q").length, 2);
  // Upgrading a queued or delivered automatic review makes it explicit work to drain.
  for (const delivered of [false, true]) {
    await api("init", { title: "Manual upgrade", questions: [question("Editable?")], reserve: [] });
    const q = (await state()).nodes.find(n => n.kind === "q");
    await grade(q.id, "Original");
    if (delivered) { e = await wait(); assert.equal(e.type, "reread"); }
    else await api("answer", { id: q.id, answer: "Edit" });
    await api("reread", {}); await api("finish", {});
    assert.ok((await state()).rereadPending);
    if (delivered) await reread(e, { reserve: [] });
    else {
      e = await wait(); assert.equal(e.type, "answer");
      await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Graded" });
      e = await wait(); assert.equal(e.type, "reread"); await reread(e, { reserve: [] });
    }
    assert.equal((await wait()).type, "finish"); await api("apply", { type: "finish", summary: "Stopped" });
    assert.equal((await state()).queueLength, 0);
  }
  // Drain readiness includes semantic work after finish and child grading.
  await api("init", { title: "Drain", questions: [question("Parent")], reserve: [] });
  const drainParent = (await state()).nodes.find(n => n.kind === "q");
  await grade(drainParent.id, "Parent answer", { children: [question("Child")] });
  const drainChild = (await state()).nodes.find(n => n.parentId === drainParent.id);
  await api("finish", {}); await api("answer", { id: drainChild.id, answer: "Evidence" });
  e = await wait(); assert.equal(e.type, "finish"); await api("apply", { type: "finish", summary: "Done" });
  e = await wait(); await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Child grade" });
  assert.equal((await state()).queueLength, 1);
  assert.equal((await api("maps")).maps[0].queue, 1);
  e = await wait(); await assess(e, "Unique prior parent verdict"); assert.equal((await state()).queueLength, 0);
  // Merging removes the source card but preserves every historical verdict in the report.
  await api("reread", {}); e = await wait();
  await reread(e, { audit: e.nodes.map(n => ({ id: n.id, action: "merge", reason: "Same evidence" })),
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
  e = await wait(); assert.deepEqual(e.ids, ["p"]); assert.equal(e.nodes.length, 2);
  await stop(); await start(); await assess(e, "Stale", "ok", 409);
  e = await wait(); await assess(e); assert.equal((await state()).queueLength, 1);
  e = await wait(); assert.deepEqual(e.ids, ["other"]); await assess(e);
  await api("reread", {}); await api("finish", {}); await api("wait?timeout=5", undefined, 400);
  assert.equal((await state()).rereadPending, null); assert.ok((await state()).rereadResult.error);
  e = await wait(); assert.equal(e.type, "finish"); await api("apply", { type: "finish", summary: "Done" });
  assert.equal((await wait()).type, "timeout");
  // Frozen batches survive redelivery and never mutate live grades.
  await seed([parentNode("p"), parentNode("other"), ...many]); await api("spec", {});
  assert.ok((await state()).queueLength >= 2);
  e = await wait(); assert.equal(e.capturedForSpec, true); assert.deepEqual(e.ids, ["p"]);
  await stop(); await start(); await assess(e, "Stale", "ok", 409);
  e = await wait(); await assess(e); e = await wait(); assert.deepEqual(e.ids, ["other"]); await assess(e);
  assert.equal((await node("p")).status, "weak");
  e = await wait(); assert.equal(e.type, "spec"); await api("apply", { type: "spec", token: e.token, markdown: "# Large frozen map" });
  e = await wait(); await assess(e); e = await wait(); await assess(e);
  // Serialized size and a single oversized affected branch also release unrelated work.
  await seed([parentNode("p"), parentNode("other"), { id: "huge", parentId: "p", kind: "q", q: "Huge", status: "open", chat: [{ from: "user", text: "x".repeat(600001) }] }]);
  await api("wait?timeout=5", undefined, 400); assert.deepEqual((await state()).reevaluationError.ids, ["p"]);
  e = await wait(); assert.deepEqual(e.ids, ["other"]); await assess(e);
  await api("reread", {}); await api("wait?timeout=5", undefined, 400); assert.equal((await state()).rereadPending, null);
  assert.equal((await wait()).type, "timeout");
  await seed([parentNode("p"), parentNode("other"), ...many.map(n => ({ ...n, parentId: "p" }))]);
  await api("wait?timeout=5", undefined, 400); e = await wait(); assert.deepEqual(e.ids, ["other"]); await assess(e);
  await seed([parentNode("p"), parentNode("other"), ...many.map(n => ({ ...n, parentId: "p" }))]);
  await api("spec", {}); await api("wait?timeout=5", undefined, 400);
  assert.equal((await state()).specPending, null); assert.ok((await state()).specError);
  await api("wait?timeout=5", undefined, 400); e = await wait(); assert.deepEqual(e.ids, ["other"]); await assess(e);
  console.log("completeness checks passed");
} finally { await stop(); fs.rmSync(cwd, { recursive: true, force: true }); }
