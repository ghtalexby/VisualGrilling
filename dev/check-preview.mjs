import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { circlePreview } from "./fixtures/preview.mjs";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-preview-")), dir = path.join(cwd, "maps");
let server, url;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function start() {
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--port", "0", "--lang", "en"], { cwd, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 100; i++) { try { const info = JSON.parse(fs.readFileSync(path.join(dir, "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {} await sleep(50); }
  throw new Error("Server did not start");
}
async function api(route, body, expected = 200) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(r.status, expected, await r.clone().text()); return route === "report" ? r.text() : r.json();
}
const wait = () => api("wait?timeout=5");
const apply = (e, extra) => api("apply", { type: "preview", id: e.id, token: e.token, projectId: e.projectId, base: e.base, ...extra });
async function stop() { if (!server || server.exitCode !== null) return; const done = new Promise(r => server.once("exit", r)); await api("stop", {}); await done; }
try {
  await start(); await api("init", { title: "Preview", questions: [{ q: "Size?", options: ["A", "B"] }, { q: "Unrelated", options: ["A", "B"] }] });
  const [q, other] = (await api("state")).nodes.filter(n => n.kind === "q");
  assert.equal((await fetch(url + "api/preview?id=none")).status, 403);
  await api("preview/prepare", { sourceId: "root" }, 400);
  const { id } = await api("preview/prepare", { sourceId: q.id });
  let e = await wait(); assert.equal(e.phase, "prepare"); assert.ok(!e.context.some(n => n.id === other.id));
  await stop(); await start(); const retry = await wait(); assert.notEqual(retry.token, e.token);
  await api("apply", { ...e, question: "Which?", options: ["UI", "Diagram"] }, 409);
  await apply(retry, { question: "Which?", options: ["UI", "Diagram"] });
  await api("preview/build", { id, request: "Circle UI" }); e = await wait();
  await api("apply", { ...e, files: { ...circlePreview, "../escape.js": "x" } }, 400);
  assert.equal((await api("preview?id=" + id)).commit, undefined);
  const first = await apply(e, { files: circlePreview, purpose: "Circle" });
  let n = await api("preview?id=" + id); assert.equal(n.commit, first.commit); assert.equal(n.stale, 0);
  await api("preview/save", { id, commit: n.commit, epoch: n.epoch, state: { diameter: 180 } });
  assert.equal((await api("state")).queueLength, 0);
  await api("spec", {}); const spec = await wait(), snapshot = spec.nodes.find(n => n.id === id);
  assert.match(snapshot.snapshot, /^[a-f0-9]{64}$/);
  await api("preview/save", { id, commit: n.commit, epoch: n.epoch, state: { diameter: 200 } });
  assert.equal((await api("preview/snapshot?key=" + snapshot.snapshot)).savedState.diameter, 180);
  await api("apply", { type: "spec", token: spec.token, markdown: "# Plan\n\n[Circle](" + snapshot.link + ")" });
  await api("preview/build", { id, request: "Larger" }); e = await wait(); assert.equal(e.savedState.diameter, 200);
  assert.equal((await api("preview?id=" + id)).commit, first.commit);
  await api("answer", { id: q.id, answer: "Diameter should be 240" });
  const second = await apply(e, { files: { ...circlePreview, "script.js": circlePreview["script.js"].replace("120", "240") }, purpose: "Larger circle" });
  n = await api("preview?id=" + id); assert.equal(n.stale, 1); assert.equal(n.savedState, null);
  e = await wait(); await api("apply", { type: "answer", id: q.id, token: e.token, status: "ok", verdict: "Accepted", children: [{ q: "Branch A", options: ["A", "B"] }, { q: "Branch B", options: ["A", "B"] }] });
  let state = await api("state"), copies = state.nodes.filter(p => p.forkOf === n.projectId); assert.equal(copies.length, 2);
  const copy = await api("preview?id=" + copies[0].id); assert.equal(copy.versions.length, 2);
  await api("preview/restore", { id: copy.id, commit: copy.commit, epoch: copy.epoch, target: first.commit });
  assert.equal((await api("preview?id=" + copy.id)).savedState.diameter, 200);
  assert.equal((await api("preview?id=" + id)).commit, second.commit);
  await api("preview/build", { id, request: "A pending revision" }); e = await wait();
  await api("preview/restore", { id, commit: n.commit, epoch: n.epoch, target: first.commit });
  await api("apply", { ...e, files: circlePreview }, 409);
  await api("preview/save", { id, commit: second.commit, epoch: n.epoch, state: {} }, 409);
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
  const original = await api("preview/prepare", { sourceId: a.id }); e = await wait(); await apply(e, { question: "Which?", options: ["UI", "Diagram"] });
  await api("preview/build", { id: original.id, request: "A wireframe" }); e = await wait(); await apply(e, { files: circlePreview, purpose: "A" });
  await api("answer", { id: a.id, answer: "First answer" }); e = await wait();
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Accepted", children: [{ q: "B", options: ["A", "B"] }] });
  const b = (await api("state")).nodes.find(n => n.kind === "q" && n.parentId === a.id);
  const moved = await api("preview/prepare", { id: original.id, sourceId: b.id }); assert.equal(moved.id, original.id);
  e = await wait(); await apply(e, { question: "Refine?", options: ["UI", "Diagram"] });
  await api("preview/build", { id: original.id, request: "B wireframe" }); e = await wait(); await apply(e, { files: circlePreview, purpose: "B" });
  // Create a separate ancestor project to cover a split below a one-child chain.
  const ancestor = await api("preview/prepare", { sourceId: a.id }); e = await wait(); await apply(e, { question: "Which?", options: ["UI", "Diagram"] });
  await api("preview/build", { id: ancestor.id, request: "Ancestor wireframe" }); e = await wait(); await apply(e, { files: circlePreview, purpose: "Ancestor" });
  const ancestorNode = await api("preview?id=" + ancestor.id);
  await api("answer", { id: b.id, answer: "Split here" }); e = await wait();
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Accepted", children: [{ q: "C", options: ["A", "B"] }, { q: "D", options: ["A", "B"] }] });
  assert.equal((await api("state")).nodes.filter(n => n.forkOf === ancestorNode.projectId).length, 2);
  console.log("Preview API checks passed: recovery, publication, save, fork, stale, restore, snapshots, rejection");
} finally { await stop(); fs.rmSync(cwd, { recursive: true, force: true }); }
