import { contextCards } from "./context-fixture.mjs";
import { knowledgeFixture } from "./knowledge-fixture.mjs";
// Verify reserve accounting, automatic dispatch, semantic ancestor review and exact read receipts.
import http from "node:http";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-followups-")), dir = path.join(cwd, "maps");
let server, url;
async function start() {
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--name", "check", "--port", "0"], { cwd, windowsHide: true, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(dir, "check", "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("Server did not start");
}
const api = rawRequest;
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

const question = q => ({ q, why: "Evidence needed", options: ["Measured", "Unknown"] });
const resolved = { resolved: true, reason: "Checked evidence resolves the original gap", gaps: [], sources: [] };
const covered = id => ({ resolved: false, reason: "Remaining uncertainty needs this existing question", gaps: [{ gap: "Missing measurement", questionIds: [id] }], sources: [] });
const newCoverage = (count, prefix) => ({ resolved: false, reason: "Independent missing facts", sources: [],
  gaps: Array.from({ length: count }, (_, i) => ({ gap: `Missing fact ${i}`, questionIds: [`$q${i}`] })),
  questions: Array.from({ length: count }, (_, i) => ({ key: `$q${i}`, ...question(`${prefix} ${["Capacity", "Recovery", "Cost", "Ownership", "Security"][i]}?`) })) });
const apply = (e, b, expected = 200) => api("apply", { type: e.type, id: e.id, token: e.token, capturedForSpec: e.capturedForSpec, ...b }, expected);
async function answer(id, text, b) {
  await api("answer", { id, answer: text }); let e = await wait();
  while (["reread", "knowledge"].includes(e.type)) {
    if (e.type === "knowledge") await apply(e, { files: [] });
    else { const cards = contextCards(e); await apply(e, { audit: cards.map(n => ({ id: n.id, action: "keep", reason: "Current fixture" })), assessments: cards.filter(n => ["weak", "gap", "verify"].includes(n.status)).map(n => ({ id: n.id, status: n.status, verdict: n.verdict, coverage: covered(cards.find(q => q.id !== n.id && !q.obsolete).id) })) }); }
    e = await wait();
  }
  assert.equal(e.type, "answer"); if (b.coverage?.questions) { const ids = (await state()).nodes.filter(n => n.kind === "q").map(n => n.id); b.coverage.questions.forEach(q => q.allowSimilar = ids); }
  await apply(e, b); return e;
}
try {
  await start();
  assert.equal((await fetch(url + "api/state")).status, 403);
  assert.equal(await new Promise(resolve => { http.get(url + "api/state", { headers: { "x-grill": "1", Host: "evil.example" } }, r => { r.resume(); resolve(r.statusCode); }); }), 403);
  await api("init", { title: "Followups", questions: [question("Primary decision?"), question("Other branch evidence?"), question("Keep open?")], reserve: [] });
  let cards = (await state()).nodes.filter(n => n.kind === "q"); const [parent, source, spare] = cards;
  const first = await answer(parent.id, "Original", { status: "weak", verdict: "Missing specifics", ancestors: [] });
  assert.equal((await node(parent.id)).status, "weak");
  assert.ok((await state()).actionQueue.internal.some(e => e.type === "followup"));
  let e = await wait(); assert.equal(e.type, "followup"); const stale = e;
  await stop(); await start(); e = await wait(); assert.equal(e.type, "followup"); assert.notEqual(e.token, stale.token);
  await apply(stale, { status: "weak", verdict: "Stale", coverage: covered(spare.id) }, 409);
  await apply(e, { status: "weak", verdict: "Five gaps", coverage: newCoverage(5, "Initial") });
  assert.equal((await state()).nodes.filter(n => n.parentId === parent.id).length, 5);
  const count = (await state()).nodes.length;
  await apply(e, { status: "weak", verdict: "Five gaps", coverage: newCoverage(5, "Initial") });
  assert.equal((await state()).nodes.length, count);
  assert.equal((await node(parent.id)).followup, undefined);
  // Existing cross-branch question covers a gap without additions.
  await answer(parent.id, "Original revision", { status: "verify", verdict: "Needs proof", ancestors: [], coverage: covered(source.id) });
  assert.equal((await state()).nodes.length, count);
  // A deep leaf receives every required question.
  let deep = (await state()).nodes.find(n => n.parentId === parent.id);
  for (let level = 0; level < 4; level++) {
    await answer(deep.id, `Partial ${level}`, { status: "gap", verdict: "Needs facts", ancestors: [], coverage: newCoverage(1, `Depth ${level}`) });
    deep = (await state()).nodes.find(n => n.parentId === deep.id);
  }
  await answer(deep.id, "Deep uncertainty", { status: "weak", verdict: "Five gaps at depth", ancestors: [], coverage: newCoverage(5, "Deep") });
  assert.equal((await state()).nodes.filter(n => n.parentId === deep.id).length, 5);
  // Explicit technical errors retain the delivery and original answer.
  await api("answer", { id: deep.id, answer: "Retry me" }); e = await wait();
  await apply(e, { status: "gap", verdict: "Too many", children: Array.from({ length: 501 }, () => question("Huge?")) }, 400);
  assert.equal((await node(deep.id)).answer, "Deep uncertainty"); assert.ok((await node(deep.id)).pending);
  await apply(e, { status: "gap", verdict: "Covered", ancestors: [], coverage: covered(spare.id) });
  // Checked evidence supplements the original, retaining its history.
  await answer(source.id, "Measured 42 requests", { status: "ok", verdict: "Measured", ancestors: [] });
  await api("reread", {}); e = await wait(); assert.equal(e.type, "reread");
  const audit = contextCards(e).map(n => ({ id: n.id, action: "keep", reason: "Still current" }));
  await apply(e, { audit, assessments: [{ id: parent.id, status: "ok", verdict: "Source resolves the missing fact", coverage: { ...resolved, sources: [{ id: source.id, answer: "Wrong old value", contribution: "A checked measurement" }] } }] }, 400);
  await apply(e, { audit, assessments: [{ id: parent.id, status: "ok", verdict: "Source resolves the missing fact", coverage: { ...resolved, sources: [{ id: source.id, answer: "Measured 42 requests", contribution: "A checked measurement" }] } }, ...contextCards(e).filter(n => n.id !== parent.id && ["weak", "gap", "verify"].includes(n.status)).map(n => ({ id: n.id, status: n.status, verdict: "Still uncertain", coverage: covered(spare.id) }))] });
  assert.equal((await node(parent.id)).answer, "Original revision"); assert.equal((await node(parent.id)).status, "ok");
  assert.ok((await node(parent.id)).answerHistory.some(h => h.answer === "Original"));
  assert.match(await api("report"), /Measured 42 requests/); assert.match(await api("report"), /A checked measurement/);
  // Discussion assessment, multi-answer and inline ancestors all retain missing work.
  await api("discuss", { id: parent.id, message: "This is uncertain again" }); e = await wait();
  if (e.type === "knowledge") { await apply(e, { files: [] }); e = await wait(); }
  assert.equal(e.type, "discuss");
  await apply(e, { reply: "Recheck", assessment: { status: "weak", verdict: "Contradiction" } });
  e = await wait(); assert.equal(e.type, "followup"); await apply(e, { status: "weak", verdict: "Still contradictory", coverage: covered(spare.id) });
  await api("discuss", { id: "root", message: "No evidence for other branch" }); e = await wait();
  const root = await node("root"), messageId = root.chat.filter(m => m.from === "user").at(-1).id;
  await apply(e, { reply: "Recorded", answers: [{ id: source.id, messageIds: [messageId], status: "gap", verdict: "Missing data" }] });
  e = await wait(); assert.equal(e.type, "followup"); assert.equal(e.id, source.id); await apply(e, { status: "gap", verdict: "Missing data", coverage: covered(spare.id) });
  const child = (await state()).nodes.find(n => n.parentId === parent.id);
  await answer(child.id, "Checked", { status: "ok", verdict: "Checked", coverage: resolved, ancestors: [{ id: parent.id, status: "verify", verdict: "Assumption remains" }] });
  e = await wait(); assert.equal(e.type, "followup"); assert.equal(e.id, parent.id); await apply(e, { status: "verify", verdict: "Not verified by answered children", coverage: covered(spare.id) });
  await answer(child.id, "Changed", { status: "ok", verdict: "Checked", reviewAncestors: true });
  e = await wait(); assert.equal(e.type, "reevaluate");
  await apply(e, { assessments: e.ids.map(id => ({ id, status: "weak", verdict: "Needs audit" })) });
  e = await wait(); assert.equal(e.type, "followup"); await apply(e, { status: "weak", verdict: "Covered", coverage: covered(spare.id) });
  await stop(); await start(); assert.equal((await node(parent.id)).followup, undefined);
  await api("init", { title: "Reread required questions", questions: [question("Original decision?"), question("Unused?")] });
  const rootQuestion = (await state()).nodes.find(n => n.kind === "q");
  const otherQuestion = (await state()).nodes.filter(n => n.kind === "q")[1];
  await answer(rootQuestion.id, "Partial", { status: "weak", verdict: "Missing", ancestors: [], coverage: covered(otherQuestion.id) });
  await api("reread", {}); e = await wait();
  await apply(e, { audit: contextCards(e).map(n => ({ id: n.id, action: "keep", reason: "Current" })), assessments: [{ id: rootQuestion.id, status: "weak", verdict: "Five gaps", coverage: newCoverage(5, "Reread") }] });
  assert.equal((await state()).nodes.filter(n => n.parentId === rootQuestion.id).length, 5);
  const leaf = (await state()).nodes.find(n => n.parentId === rootQuestion.id);
  await api("answer", { id: leaf.id, answer: "Evidence" }); e = await wait();
  const huge = { resolved: false, reason: "Too many", sources: [], gaps: [{ gap: "Missing", questionIds: [] }], questions: [] };
  for (let i = 0; i < 499; i++) { huge.gaps[0].questionIds.push("$huge" + i); huge.questions.push({ key: "$huge" + i, ...question(randomUUID()), allowSimilar: [] }); }
  const limitError = await apply(e, { status: "ok", verdict: "Child", ancestors: [{ id: rootQuestion.id, status: "weak", verdict: "Too large", coverage: huge }] }, 400);
  assert.match(limitError.error, /слишком большая/);
  assert.ok((await node(leaf.id)).pending);
  await apply(e, { status: "ok", verdict: "Child", ancestors: [] });
  // Coverage metadata itself must obey the branch size limit, even without additions/sources.
  await api("init", { title: "Coverage size", questions: [question("Bounded evidence?")] });
  const bounded = (await state()).nodes.find(n => n.kind === "q");
  await answer(bounded.id, "Incomplete", { status: "weak", verdict: "Missing", ancestors: [], children: Array.from({ length: 30 }, () => question(randomUUID())) });
  e = await wait(); assert.equal(e.type, "followup");
  const children = (await state()).nodes.filter(n => n.parentId === bounded.id).map(n => n.id);
  const metadata = { resolved: false, reason: "Oversized audit", sources: [], gaps: Array.from({ length: 500 }, () => ({ gap: "x".repeat(1000), questionIds: children })) };
  const metadataError = await apply(e, { status: "weak", verdict: "Missing", coverage: metadata }, 400);
  assert.match(metadataError.error, /слишком большая/);
  assert.equal((await node(bounded.id)).gapCoverage, undefined);
  assert.equal((await node(bounded.id)).followup.stage, "thinking");
  await apply(e, { status: "weak", verdict: "Missing", coverage: covered(children[0]) });
  // Failed migrated work has a visible retry receipt, including frozen legacy work.
  const seed = async frozen => {
    await api("init", { title: "Recovery", questions: [question("Missing?"), question("Evidence?"), question("Spare?")] }); await stop();
    const file = path.join(dir, "check", "state.json"), saved = JSON.parse(fs.readFileSync(file));
    const [target, source] = saved.nodes.filter(n => n.kind === "q");
    Object.assign(target, { answer: "Original", status: "weak", verdict: "Missing", followup: { stage: "queued" } });
    Object.assign(source, { answer: "Captured evidence", status: "ok", verdict: "Checked" });
    saved.actions = []; saved.queue = [];
    if (frozen) {
      saved.specJob = { stage: "queued", title: "Frozen", brief: "", arch: "", requestedAt: Date.now(), nodes: structuredClone(saved.nodes), gradingNodes: structuredClone(saved.nodes), waiting: [], ideaWaiting: [], reviewIds: [] };
      saved.queue = [{ type: "spec" }]; target.status = "ok"; delete target.followup; source.answer = "Late live evidence";
    }
    fs.writeFileSync(file, JSON.stringify(saved)); await start(); return { target, source };
  };
  for (const frozen of [false, true]) {
    const { target, source } = await seed(frozen);
    e = await wait(); assert.equal(e.type, "followup"); assert.equal(!!e.capturedForSpec, frozen);
    if (frozen) {
      const old = e; await stop(); await start();
      await apply(old, { status: "ok", verdict: "Old delivery", coverage: resolved }, 409);
      await api("node?id=" + source.id + "&token=" + old.readToken, undefined, 409);
      e = await wait(); assert.equal(e.type, "followup"); assert.notEqual(e.token, old.token);
    }
    await apply(e, { type: "failure", error: "Fixture worker failure" });
    const failure = (await state()).actionQueue.actions.find(a => a.status === "failed"); assert.ok(failure);
    assert.equal((await state()).currentWork, null);
    await stop(); await start(); await api("actions/retry", { id: failure.id });
    e = await wait(); assert.equal(e.type, "followup"); assert.equal(!!e.capturedForSpec, frozen);
    if (frozen) assert.equal((await api("node?id=" + source.id + "&token=" + e.readToken)).nodes[0].answer, "Captured evidence");
    await apply(e, { status: "ok", verdict: "Evidence closes the gap", coverage: { ...resolved, sources: [{ id: source.id, answer: "Captured evidence", contribution: "Recovered supplement" }] } });
    if (frozen) {
      e = await wait(); assert.equal(e.type, "spec"); assert.equal(e.nodes.find(n => n.id === target.id).supplements[0].answer, "Captured evidence");
      assert.equal((await node(target.id)).supplements, undefined);
      await apply(e, { markdown: "# Captured coverage" });
    } else {
      await api("reread", {}); e = await wait(); assert.equal(e.type, "reread");
      await apply(e, { audit: contextCards(e).map(n => ({ id: n.id, action: [target.id, source.id].includes(n.id) ? "merge" : "keep", reason: "Same decision" })), merge: [{ ids: [target.id, source.id], keep: source.id, answer: "Original and Captured evidence", status: "ok", verdict: "Combined" }] });
      assert.match(await api("report"), /Recovered supplement/);
    }
  }
  // Lost clarification references are repaired independently in frozen evidence.
  const orphan = await seed(true); await stop();
  const orphanFile = path.join(dir, "check", "state.json"), orphanState = JSON.parse(fs.readFileSync(orphanFile));
  const frozenTarget = orphanState.specJob.gradingNodes.find(n => n.id === orphan.target.id);
  delete frozenTarget.followup; frozenTarget.gapCoverage = { resolved: false, reason: "Covered before removal", gaps: [{ gap: "Missing evidence", questionIds: [orphan.source.id] }] };
  orphanState.specJob.gradingNodes = orphanState.specJob.gradingNodes.filter(n => n.id !== orphan.source.id);
  fs.writeFileSync(orphanFile, JSON.stringify(orphanState)); await start();
  e = await wait(); assert.equal(e.type, "followup"); assert.equal(e.capturedForSpec, true);
  const frozenSpare = contextCards(e).find(n => n.kind === "q" && n.id !== orphan.target.id)?.id || (await api("state")).nodes.find(n => n.q === "Spare?").id;
  await apply(e, { status: "weak", verdict: "Still missing", coverage: covered(frozenSpare) });
  e = await wait(); assert.equal(e.type, "spec"); assert.ok(!e.nodes.some(n => n.id === orphan.source.id));
  await apply(e, { markdown: "# Frozen repair" });
  console.log("Follow-up coverage checks passed");
} finally { await stop(); fs.rmSync(cwd, { recursive: true, force: true }); }
