import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { knowledge, digest } from "../skills/grill/knowledge.mjs";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-knowledge-"));
const maps = path.join(cwd, ".grill"), map = path.join(maps, "check");
fs.mkdirSync(map, { recursive: true });
const store = knowledge(cwd, maps);
const sourceText = "A profile is a saved settings bundle.";
fs.writeFileSync(path.join(cwd, "README.md"), sourceText);
const source = { path: "README.md", version: digest(sourceText), snapshot: sourceText };
const record = (extra = {}, prose = sourceText) => `<!-- vgril:1 -->\n\x60\x60\x60json\n${JSON.stringify({ id: "profile", type: "term", scope: "settings", status: "current", author: null, sources: [source], ...extra })}\n\x60\x60\x60\n\n# Profile\n\n${prose}\n`;
const target = "docs/vgril/settings/profile.md";
let server, url;
async function start() {
  server = spawn(process.execPath, [cli, "serve", "--name", "check", "--port", "0", "--lang", "en"], { cwd, windowsHide: true, stdio: "ignore", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(cwd, "no-global-git-config") } });
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(map, "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("Server did not start");
}
async function api(route, body, expected = 200) {
  const response = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, expected, await response.clone().text()); return response.json();
}
const wait = () => api("wait?timeout=5");
async function stop() {
  if (!server || server.exitCode !== null) return;
  const done = new Promise(r => server.once("exit", r)); await api("stop", {}); await done;
}
try {
  // Shared editable records, identity, changed content, invalid parse and unrelated files.
  store.commit([{ path: target, expected: null, text: record() }]);
  let before = store.read(target);
  assert.equal(store.index().documents.find(d => d.path === target).id, "profile");
  fs.appendFileSync(path.join(cwd, target), "\nManual clarification\n");
  assert.throws(() => store.commit([{ path: target, expected: before.version, text: record({}, "Lost manual text") }]), /Конфликт/);
  before = store.read(target);
  store.commit([{ path: target, expected: before.version, text: before.text + "\nMore evidence\n" }]);
  assert.match(store.read(target).text, /Manual clarification/);
  assert.throws(() => store.commit([{ path: "docs/vgril/other.md", expected: null, text: record() }]), /Идентификатор/);
  fs.writeFileSync(path.join(cwd, "docs/vgril/user.md"), "User-owned");
  assert.throws(() => store.commit([{ path: "docs/vgril/user.md", expected: digest("User-owned"), text: record({ id: "other" }) }]), /разобрать/);
  assert.throws(() => store.commit([{ path: "docs/vgril/../../escape.md", expected: null, text: record() }]), /документ/);
  assert.equal(fs.readFileSync(path.join(cwd, "docs/vgril/user.md"), "utf8"), "User-owned");
  fs.writeFileSync(path.join(cwd, "docs/vgril/added.md"), "# New document\n[Absent](missing.md)");
  assert.equal(store.index().documents.find(d => d.path.endsWith("added.md")).links[0].available, false);
  fs.renameSync(path.join(cwd, "docs/vgril/added.md"), path.join(cwd, "docs/vgril/moved.md"));
  assert.ok(!store.index().documents.some(d => d.path.endsWith("added.md")));
  // Recover a crash after original rename, before exclusive replacement.
  before = store.read(target);
  const op = "00000000-0000-4000-8000-000000000001", ops = path.join(maps, "knowledge-ops");
  fs.writeFileSync(path.join(ops, "pending.json"), JSON.stringify({ id: op, files: [{ path: target, expected: before.version, text: before.text + "Recovered\n" }] }));
  fs.renameSync(path.join(cwd, target), path.join(ops, op + "-0.before"));
  assert.ok(store.index().warnings.length); assert.equal(store.read(target).text, null);
  store.reconcile(op); // Restore the original before a fresh extraction proposes the update again.
  store.commit([{ path: target, expected: before.version, text: before.text + "Recovered\n" }]);
  assert.match(store.read(target).text, /Recovered/);
  assert.ok(fs.existsSync(path.join(ops, op + ".conflict.json")));
  // Competing editor publication is preserved and retry reconciles, never overwrites.
  before = store.read(target);
  fs.writeFileSync(path.join(ops, "pending.json"), JSON.stringify({ id: "conflict", files: [{ path: target, expected: before.version, text: before.text + "Agent update\n" }] }));
  fs.appendFileSync(path.join(cwd, target), "Editor update\n");
  assert.ok(store.index().warnings.some(w => w.includes("Незавершённая")));
  store.reconcile(); assert.match(store.read(target).text, /Editor update/);

  const navigation = store.index();
  fs.writeFileSync(path.join(cwd, "docs/vgril/moved.md"), "Changed while another map was preparing an update");
  assert.throws(() => store.commit([], [], digest(JSON.stringify(navigation.documents))), /Документы изменились/);

  // Several maps racing to reclaim the same dead owner must never enter together.
  fs.writeFileSync(path.join(ops, "lock.json"), JSON.stringify({ pid: 2147483647, id: "dead" }));
  const moduleUrl = new URL("../skills/grill/knowledge.mjs", import.meta.url).href;
  const racers = Array.from({ length: 12 }, () => new Promise((resolve, reject) => {
    const script = `import fs from "node:fs"; import {knowledge} from ${JSON.stringify(moduleUrl)};
      const store=knowledge(${JSON.stringify(cwd)},${JSON.stringify(maps)});
      try { store.locked(()=>{const guard=${JSON.stringify(path.join(ops, "critical"))};
        try { fs.writeFileSync(guard,"held",{flag:"wx"}); } catch { console.error("OVERLAP");process.exit(2); }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,80);fs.unlinkSync(guard);
      }); } catch(e) { if (!/занята|EEXIST/.test(e.message)) { console.error(e);process.exit(3); } }`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let error = ""; child.stderr.on("data", data => error += data);
    child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(error)));
  }));
  await Promise.all(racers);

  await start();
  assert.equal((await fetch(url + "api/knowledge")).status, 403);
  await api("init", { title: "Knowledge", questions: [{ q: "Define profile" }, { q: "Another topic" }] });
  const id = (await api("state")).nodes.find(n => n.kind === "q").id;
  await api("answer", { id, answer: sourceText });
  let event = await wait(); assert.ok(event.knowledge.index);
  await api("apply", { type: "answer", id, token: event.token, status: "ok", verdict: "User definition" });
  await api("reread", {}); event = await wait(); assert.equal(event.type, "reread");
  await api("apply", { type: "reread", token: event.token, audit: event.nodes.map(n => ({ id: n.id, action: "keep", reason: "Current" })) });
  event = await wait(); assert.equal(event.type, "knowledge"); assert.equal(event.reason, "reread");
  await api("apply", { type: "knowledge", token: event.token, files: [] });
  await api("apply", { type: "knowledge", token: event.token, files: [] }, 409);
  await api("finish", {}); event = await wait(); assert.equal(event.type, "knowledge");
  await api("apply", { type: "finish", summary: "Bypass" }, 409);
  assert.equal(event.author, null);
  const stale = event.token; await stop(); await start();
  await api("apply", { type: "knowledge", token: stale, files: [] }, 409);
  event = await wait(); assert.equal(event.type, "knowledge");
  const evidence = { ...event.sources.find(s => s.card === id), path: event.sourcePath, map: event.map, session: event.session };
  const newRecord = record({ id: "new-profile", sources: [evidence], author: { name: event.author || "Explicit test user", session: event.session, date: event.date } });
  let result = await api("apply", { type: "knowledge", token: event.token, files: [{ path: "docs/vgril/new-profile.md", expected: null, text: newRecord }] });
  assert.equal(result.ok, true, result.error);
  event = await wait(); assert.equal(event.type, "finish");
  await api("apply", { type: "finish", token: event.token, summary: "Saved" });
  assert.equal((await api("state")).knowledgeResult.status, "saved");
  // Reusing historical snapshots after the source changes must preserve both provenance and origin.
  await api("answer", { id, answer: "A profile now also records a theme." }); event = await wait();
  await api("apply", { type: "answer", id, token: event.token, status: "ok", verdict: "Refined definition" });
  await api("knowledge-import", {}); event = await wait();
  const updatedEvidence = { ...event.sources.find(s => s.card === id), path: event.sourcePath, map: event.map, session: event.session };
  const existing = store.read("docs/vgril/new-profile.md");
  const meta = store.parse(existing.text);
  const historicalAuthor = { name: "Original participant", session: "earlier-map-session", date: "2025-01-01" };
  fs.writeFileSync(path.join(cwd, "docs/vgril/new-profile.md"), record({ ...meta, author: historicalAuthor }));
  result = await api("apply", { type: "knowledge", token: event.token, files: [] });
  assert.equal(result.ok, false); // Navigation changed during analysis, even for a no-op.
  await api("knowledge-retry", {}); event = await wait();
  const rereadDocument = store.read("docs/vgril/new-profile.md");
  result = await api("apply", { type: "knowledge", token: event.token, files: [{ path: rereadDocument.path, expected: rereadDocument.version,
    text: record({ ...meta, author: historicalAuthor, sources: [...meta.sources, updatedEvidence] }, "Definition refined; original provenance retained.") }] });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(store.parse(store.read(rereadDocument.path).text).author, historicalAuthor);
  await api("finish", {}); event = await wait();
  await api("apply", { type: "knowledge", token: event.token, error: "Disk unavailable" });
  await stop(); await start(); assert.equal((await api("state")).knowledgePending.stage, "blocked");
  await api("knowledge-retry", {}); event = await wait(); assert.equal(event.type, "knowledge");
  await api("apply", { type: "knowledge", token: event.token, error: "Need identity", questions: [{ q: "How should your name be recorded?" }, { q: "Which scope?" }] });
  const clarificationState = await api("state");
  const authorCard = clarificationState.nodes.find(n => n.q === "How should your name be recorded?");
  const scopeCard = clarificationState.nodes.find(n => n.q === "Which scope?");
  assert.equal(scopeCard.prio, authorCard.prio + 1);
  await api("answer", { id: authorCard.id, answer: "Ada" }); event = await wait(); assert.equal(event.type, "answer");
  await api("apply", { type: "answer", id: event.id, token: event.token, status: "ok", verdict: "Explicit identity" });
  await api("answer", { id: scopeCard.id, answer: "Settings" }); event = await wait(); assert.equal(event.type, "answer");
  await api("apply", { type: "answer", id: event.id, token: event.token, status: "ok", verdict: "Explicit scope" });
  event = await wait(); assert.equal(event.type, "knowledge");
  await api("apply", { type: "knowledge", token: event.token, error: "Explicit conflict remains" });
  const operation = JSON.parse(fs.readFileSync(path.join(map, "state.json"))).knowledgeJob.operation;
  fs.writeFileSync(path.join(ops, "pending.json"), JSON.stringify({ id: operation, files: [{ path: "docs/vgril/skipped.md", expected: null, text: record({ id: "skipped" }) }] }));
  await api("knowledge-skip", {}); event = await wait(); assert.equal(event.type, "finish");
  await api("apply", { type: "finish", token: event.token, summary: "Skipped" });
  assert.equal((await api("state")).knowledgeResult.status, "skipped");
  await api("knowledge"); assert.equal(store.read("docs/vgril/skipped.md").text, null);
  assert.equal(fs.existsSync(path.join(ops, "pending.json")), false);
  await stop();
  const savedState = JSON.parse(fs.readFileSync(path.join(map, "state.json")));
  savedState.nodes = savedState.nodes.filter(n => n.id !== id);
  fs.writeFileSync(path.join(map, "state.json"), JSON.stringify(savedState));
  const deletedSources = store.index().documents.find(d => d.path === "docs/vgril/new-profile.md").sources;
  assert.ok(deletedSources.every(s => !s.available && s.snapshot));
  // Migration preserves exact authored content and rebases outgoing references, and is repeatable.
  fs.mkdirSync(path.join(cwd, "docs/specs"));
  const old = "docs/specs/grill-check.md", owner = "test-owner";
  const legacy = `<!-- grill-owner: ${owner} -->\n# Manual detail\n[Readme](../../README.md)\n`;
  fs.writeFileSync(path.join(cwd, old), legacy);
  const migrated = store.migrateSpec({ specFile: old, specOwner: owner }, "check");
  assert.match(store.read(migrated.path).text, /\.\.\/\.\.\/\.\.\/README.md/);
  assert.equal(store.read(old).text, legacy);
  assert.equal(store.migrateSpec({ specFile: old, specOwner: owner }, "check").path, migrated.path);
  assert.throws(() => store.migrateSpec({ specFile: old, specOwner: "other" }, "check"), /принадлежит/);
  console.log("Knowledge checks passed: " + cwd);
} finally { await stop(); }
