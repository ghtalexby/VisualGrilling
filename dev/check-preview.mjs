import { contextCards } from "./context-fixture.mjs";
import { knowledgeFixture } from "./knowledge-fixture.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { circlePreview } from "./fixtures/preview.mjs";
import { previews } from "../skills/grill/preview.mjs";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-preview-")), dir = path.join(cwd, "maps");
let server, url;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function start() {
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--port", "0", "--lang", "en"], { cwd, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 100; i++) { try { const info = JSON.parse(fs.readFileSync(path.join(dir, "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {} await sleep(50); }
  throw new Error("Server did not start");
}
const api = knowledgeFixture(rawRequest);
async function rawRequest(route, body, expected = 200) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(r.status, expected, await r.clone().text()); return route === "report" ? r.text() : r.json();
}
let cachedEvent;
const wait = async () => {
  if (cachedEvent) { const e = cachedEvent; cachedEvent = null; return e; }
  for (;;) {
    const e = await api("wait?timeout=5");
    if (e.type !== "reevaluate") return e;
    assert.ok(e.ids.length);
    assert.ok(e.ids.every(id => e.nodes.some(n => n.id === id && n.answer)));
    await api("apply", { type: "reevaluate", token: e.token, capturedForSpec: e.capturedForSpec,
      assessments: e.ids.map(id => ({ id, status: "ok", verdict: "Retain accepted decision after checking branch evidence" })) });
  }
};
const prepare = async (route, body, expected = 200) => {
  const receipt = await api(route, body, expected);
  if (expected !== 200) return receipt;
  cachedEvent = await wait();
  return { ...receipt, id: cachedEvent.id };
};
const apply = (e, extra) => api("apply", { type: "preview", id: e.id, token: e.token, projectId: e.projectId, base: e.base, ...extra });
async function stop() { if (!server || server.exitCode !== null) return; const done = new Promise(r => server.once("exit", r)); await api("stop", {}); await done; }
try {
  await start(); await api("init", { title: "Preview", brief: "Original premise", arch: "Local UI", questions: [{ q: "Size?", options: ["A", "B"] }, { q: "Unrelated", options: ["A", "B"] }] });
  const [q, other] = (await api("state")).nodes.filter(n => n.kind === "q");
  assert.equal((await fetch(url + "api/preview?id=none")).status, 403);
  assert.equal((await prepare("preview/prepare", { sourceId: "root" }, 400)).error, "Select preview branches");
  const { id } = await prepare("preview/prepare", { sourceId: q.id });
  assert.equal((await api("preview?id=" + id)).q, "Preview");
  let e = await wait(); assert.equal(e.phase, "prepare"); assert.ok(!e.context.some(n => n.id === other.id));
  assert.equal(e.context.find(n => n.id === "root").brief, "Original premise");
  assert.equal(e.context.find(n => n.id === "root").arch, "Local UI");
  await stop(); await start(); const retry = await wait(); assert.notEqual(retry.token, e.token);
  await api("apply", { ...e, question: "Which?", options: ["UI", "Diagram"] }, 409);
  await apply(retry, { question: "Which?", options: ["UI", "Diagram"] });
  await api("preview/build", { id, request: "Circle UI" }); e = await wait();
  await api("apply", { ...e, files: { ...circlePreview, "../escape.js": "x" } }, 400);
  assert.equal((await api("preview?id=" + id)).commit, undefined);
  const first = await apply(e, { files: circlePreview, purpose: "Circle" });
  let n = await api("preview?id=" + id); assert.equal(n.commit, first.commit); assert.equal(n.stale, 0);
  await api("reread", {}); const reread = await wait();
  await api("apply", { type: "reread", token: reread.token, brief: "Updated premise", audit: contextCards(reread).map(n => ({ id: n.id, action: "keep", reason: "Only the project premise changes" })) });
  assert.equal((await api("preview?id=" + id)).stale, 1);
  await api("preview/save", { id, commit: n.commit, epoch: n.epoch, state: { diameter: 180 } });
  assert.equal((await api("state")).queueLength, 0);
  await api("spec", {}); const spec = await wait(), snapshot = spec.nodes.find(n => n.id === id);
  assert.match(snapshot.snapshot, /^[a-f0-9]{64}$/);
  await api("preview/save", { id, commit: n.commit, epoch: n.epoch, state: { diameter: 200 } });
  assert.equal((await api("preview/snapshot?key=" + snapshot.snapshot)).savedState.diameter, 180);
  await api("apply", { type: "spec", token: spec.token, markdown: "# Plan\n\n[Circle](" + snapshot.link + ")" });
  await api("preview/build", { id, request: "Larger" });
  await api("preview/save", { id, commit: n.commit, epoch: n.epoch, state: { diameter: 230 } });
  e = await wait(); assert.equal(e.savedState.diameter, 200);
  assert.equal((await api("preview?id=" + id)).commit, first.commit);
  await api("answer", { id: q.id, answer: "Diameter should be 240" });
  const second = await apply(e, { files: { ...circlePreview, "script.js": circlePreview["script.js"].replace("120", "240") }, purpose: "Larger circle" });
  n = await api("preview?id=" + id); assert.equal(n.stale, 0); assert.equal(n.savedState, null);
  e = await wait();
  const beforeInvalidMove = (await api("state")).nodes;
  await api("apply", { type: "answer", id: q.id, token: e.token, status: "ok", verdict: "Invalid cycle", branchChanges: { move: [{ id, parentId: id }] } }, 400);
  await api("apply", { type: "answer", id: q.id, token: e.token, status: "ok", verdict: "Invalid parent", branchChanges: { add: [{ key: "$child", parentId: id, q: "A preview cannot parent a question", options: ["A", "B"] }] } }, 400);
  await api("question", { id: "bad-preview-child", parentId: id, q: "A preview cannot parent a custom question" }, 404);
  assert.deepEqual((await api("state")).nodes, beforeInvalidMove);
  await api("apply", { type: "answer", id: q.id, token: e.token, status: "ok", verdict: "Accepted", children: [{ q: "Capacity branch", options: ["A", "B"] }, { q: "Encryption branch", options: ["A", "B"] }] });
  let state = await api("state"), copies = state.nodes.filter(p => p.forkOf === n.projectId); assert.equal(copies.length, 2);
  const copy = await api("preview?id=" + copies[0].id); assert.equal(copy.versions.length, 2);
  await api("preview/restore", { id: copy.id, commit: copy.commit, epoch: copy.epoch, target: first.commit });
  assert.equal((await api("preview?id=" + copy.id)).savedState.diameter, 230);
  assert.equal((await api("preview?id=" + id)).commit, second.commit);
  await api("preview/build", { id, request: "A pending revision" }); e = await wait();
  await api("preview/restore", { id, commit: n.commit, epoch: n.epoch, target: first.commit });
  await apply(e, { files: circlePreview, purpose: "Pending completed" });
  await api("more", {}); e = await wait(); await api("apply", { type: "more", token: e.token, questions: [] });
  n = await api("preview?id=" + id);
  await api("preview/restore", { id, commit: n.commit, epoch: n.epoch, target: first.commit });
  await api("preview/save", { id, commit: second.commit, epoch: n.epoch, state: { diameter: 260 } });
  assert.equal((await api("preview?id=" + id)).savedState.diameter, 230);
  const badSave = await api("preview/save", { id, commit: "0".repeat(40), epoch: n.epoch, state: {} });
  assert.equal((await api("actions?id=" + badSave.actionId)).actions[0].status, "failed");
  assert.match(await api("report"), /Circle/);
  await api("preview/delete", { id, confirm: true });
  assert.equal((await api("preview/snapshot?key=" + snapshot.snapshot)).savedState.diameter, 180);
  await api("preview?id=" + id, undefined, 404);
  await api("preview/snapshot?key=../state", undefined, 404);
  // A captured answer must read the snapshot's saved values, not a later Save.
  const frozenCopy = await api("preview?id=" + copy.id), copySource = state.nodes.find(n => n.id === copy.sourceId);
  await api("preview/save", { id: copy.id, commit: frozenCopy.commit, epoch: frozenCopy.epoch, state: { diameter: 210 } });
  await api("answer", { id: copySource.id, answer: "Captured choice" });
  await api("spec", {});
  await api("preview/save", { id: copy.id, commit: frozenCopy.commit, epoch: frozenCopy.epoch, state: { diameter: 220 } });
  const captured = await wait(); assert.equal(captured.previews.find(p => p.id === copy.id).state.diameter, 210);
  await api("apply", { type: "answer", id: captured.id, token: captured.token, status: "ok", verdict: "Captured" });
  const frozenSpec = await wait(); await api("apply", { type: "spec", token: frozenSpec.token, markdown: "# Captured" });
  for (const p of (await api("state")).nodes.filter(n => n.kind === "preview")) await api("preview/policy", { id: p.id, policy: "delete" });
  await api("init", { title: "Linear and deep branches", questions: [{ q: "A", options: ["A", "B"] }, { q: "Other", options: ["A", "B"] }] });
  assert.equal(fs.existsSync(path.join(dir, "previews", copy.projectId)), false);
  const a = (await api("state")).nodes.find(n => n.kind === "q");
  const original = await prepare("preview/prepare", { sourceId: a.id }); e = await wait(); await apply(e, { question: "Which?", options: ["UI", "Diagram"] });
  await api("preview/build", { id: original.id, request: "A wireframe" }); e = await wait(); await apply(e, { files: circlePreview, purpose: "A" });
  // Create a separate ancestor project to cover a split below a one-child chain.
  const ancestor = await prepare("preview/prepare", { sourceId: a.id }); e = await wait(); await apply(e, { question: "Which?", options: ["UI", "Diagram"] });
  await api("preview/build", { id: ancestor.id, request: "Ancestor wireframe" }); e = await wait(); await apply(e, { files: circlePreview, purpose: "Ancestor" });
  const ancestorNode = await api("preview?id=" + ancestor.id);
  await api("answer", { id: a.id, answer: "First answer" }); e = await wait();
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Accepted", children: [{ q: "B", options: ["A", "B"] }] });
  const b = (await api("state")).nodes.find(n => n.kind === "q" && n.parentId === a.id);
  await api("answer", { id: b.id, answer: "A newly submitted continuation" });
  assert.ok((await api("preview?id=" + original.id)).stale > 0);
  e = await wait(); await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Accepted" });
  const moved = await prepare("preview/prepare", { id: original.id, sourceId: b.id }); assert.equal(moved.id, original.id);
  e = await wait(); await apply(e, { question: "Refine?", options: ["UI", "Diagram"] });
  await api("preview/build", { id: original.id, request: "B wireframe" }); e = await wait(); await apply(e, { files: circlePreview, purpose: "B" });
  await api("answer", { id: b.id, answer: "Split here" }); e = await wait();
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Accepted", children: [{ q: "C", options: ["A", "B"] }, { q: "D", options: ["A", "B"] }] });
  assert.equal((await api("state")).nodes.filter(n => n.forkOf === ancestorNode.projectId).length, 2);
  const deletedCopy = (await api("state")).nodes.find(n => n.forkOf === ancestorNode.projectId);
  await api("preview/delete", { id: deletedCopy.id, confirm: true });
  e = await wait(); assert.equal(e.type, "reread"); await api("apply", { type: "reread", token: e.token, audit: contextCards(e).map(n => ({ id: n.id, action: "keep", reason: "Preserve current decisions" })) });
  await api("answer", { id: deletedCopy.sourceId, answer: "A later answer" }); e = await wait();
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Accepted" });
  assert.equal((await api("state")).nodes.filter(n => n.forkOf === ancestorNode.projectId && n.sourceId === deletedCopy.sourceId).length, 0);
  // Both phases share the same bounded queue, including already-prepared projects.
  const prepared = [];
  for (let i = 0; i < 21; i++) {
    const p = await prepare("preview/prepare", { sourceId: "root", branches: [a.id] }); prepared.push(p.id);
    e = await wait(); await apply(e, { question: "Which?", options: ["UI", "Diagram"] });
  }
  for (const id of prepared.slice(0, 20)) await api("preview/build", { id, request: "Build" });
  await api("preview/build", { id: prepared[20], request: "Over limit" }, 429);
  const rootOnly = { nodes: [{ id: "root", kind: "root" }], queue: [] };
  const frozenController = previews(cwd, () => rootOnly, () => {}, () => {});
  const retained = frozenController.reconcile([{ id: "old-preview", kind: "preview", sourceId: "deleted-source", parentId: "deleted-source", snapshot: "f".repeat(64) }], [...rootOnly.nodes]);
  assert.equal(retained.find(n => n.id === "old-preview").parentId, "root");
  for (const a of (await api("actions")).actions.filter(a => a.status === "queued")) { const plan = await api("actions/cancel", { id: a.id }); await api("actions/cancel", { id: a.id, confirmation: plan.confirmation }); }
  for (const p of (await api("state")).nodes.filter(n => n.kind === "preview")) await api("preview/policy", { id: p.id, policy: "delete" });
  await api("init", { title: "Idea preview", questions: [{ q: "Existing", options: ["A", "B"] }] });
  const idea = await prepare("idea", { id: "preview-idea-check", text: "An idea with an explanatory preview" });
  e = await wait(); assert.equal(e.type, "idea"); assert.equal(e.id, idea.id);
  await api("apply", { type: "idea", id: idea.id, token: e.token, status: "open", verdict: "Needs visual exploration" });
  const ideaPreview = await prepare("preview/prepare", { sourceId: idea.id }); e = await wait(); await apply(e, { question: "Visual?", options: ["UI", "Diagram"] });
  await api("preview/build", { id: ideaPreview.id, request: "Idea wireframe" }); e = await wait(); await apply(e, { files: circlePreview, purpose: "Idea wireframe" });
  const ideaProject = await api("preview?id=" + ideaPreview.id);
  await api("idea/analyze", { id: idea.id }); e = await wait();
  await api("apply", { type: "idea", id: idea.id, token: e.token, status: "open", verdict: "Compare both branches", children: [{ q: "First branch", options: ["A", "B"] }, { q: "Second branch", options: ["A", "B"] }] });
  assert.equal((await api("state")).nodes.filter(n => n.forkOf === ideaProject.projectId).length, 2);
  // Discussion can split an unanswered branch too; no parent reassessment repairs missing copies.
  const unanswered = (await api("state")).nodes.find(n => n.kind === "q" && n.q === "Existing");
  assert.equal(unanswered.answer, undefined);
  const discussionPreview = await prepare("preview/prepare", { sourceId: unanswered.id });
  e = await wait(); await apply(e, { question: "Discussion visual?", options: ["UI", "Diagram"] });
  await api("preview/build", { id: discussionPreview.id, request: "Before discussion split" });
  e = await wait(); await apply(e, { files: circlePreview, purpose: "Discussion visual" });
  const discussionProject = await api("preview?id=" + discussionPreview.id);
  await api("discuss", { id: "root", message: "Compare two paths" }); e = await wait();
  await api("apply", { type: "discuss", id: e.id, token: e.token, reply: "Two follow-ups", questions: [0, 1].map(i => ({ key: "$path" + i, parentId: unanswered.id, q: ["Discussion capacity", "Discussion encryption"][i], options: ["A", "B"] })), links: ["$path0", "$path1"] });
  const discussionCopies = (await api("state")).nodes.filter(n => n.forkOf === discussionProject.projectId);
  assert.equal(discussionCopies.length, 2);
  assert.notEqual(discussionCopies[0].projectId, discussionCopies[1].projectId);
  console.log("Preview API checks passed: recovery, publication, save, fork, stale, restore, snapshots, rejection");
} finally { await stop(); fs.rmSync(cwd, { recursive: true, force: true }); }
