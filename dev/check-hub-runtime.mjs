import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { registerBoard, listBoards, getBoard, rebindBoard } from "../skills/grill/hub/registry.mjs";
import { codexConnection } from "../skills/grill/connection.mjs";
import { validateResults } from "../skills/grill/result-preflight.mjs";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grill-hub-runtime-"));
process.env.GRILL_HUB_HOME = path.join(tmp, "hub");
const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const base = path.join(tmp, "project", "maps"), dir = path.join(base, "a");
const children = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));
function child(args) {
  const p = spawn(process.execPath, args, { cwd: tmp, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.add(p); let error = ""; p.stderr.on("data", d => error += d);
  p.done = new Promise(resolve => p.once("exit", code => { children.delete(p); resolve({ code, error }); }));
  return p;
}
async function start(board = { dir, base, name: "a" }) {
  const p = child([cli, "serve", "--dir", board.base, ...(board.name === null ? [] : ["--name", board.name]), "--port", "0", "--lang", "en"]);
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(board.dir, "server.json"))); if (info.pid === p.pid) return { p, url: info.url }; } catch {}
    if (p.exitCode !== null) throw new Error((await p.done).error);
    await sleep(50);
  }
  throw new Error("Server readiness timeout");
}
async function request(server, route, body, epoch, status = 200) {
  const r = await fetch(server.url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json", ...(server.owner ? { "x-grill-owner": server.owner } : {}), ...(epoch ? { "x-grill-epoch": epoch } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, status, await r.clone().text()); return r.json();
}
try {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ nodes: ["open", "weak", "gap", "verify", "ok"].map(status => ({ kind: "q", status })).concat([{ kind: "q", status: "ok", obsolete: true }, { kind: "idea", status: "ok" }]) }));
  const record = registerBoard({ dir, base, name: "a", project: tmp, cli });
  assert.deepEqual(record.counts, { open: 4, closed: 1 });
  assert.equal(registerBoard({ dir, base, name: "a", project: tmp, cli }).id, record.id);
  const copy = path.join(tmp, "copy"); fs.cpSync(dir, copy, { recursive: true });
  assert.throws(() => registerBoard({ dir: copy, base: copy, cli }), /elsewhere/);
  assert.throws(() => rebindBoard(record.id, copy), /still exists/);
  const moved = path.join(tmp, "moved", "a"); fs.mkdirSync(path.dirname(moved)); fs.renameSync(dir, moved);
  assert.equal(getBoard(record.id).missing, true);
  assert.throws(() => rebindBoard(record.id, base), /mismatch/);
  assert.equal(rebindBoard(record.id, moved).missing, false);
  assert.equal(getBoard(record.id).project, tmp, "Custom project path must survive rebind");
  const badName = path.join(tmp, "moved", "Invalid-name"); fs.renameSync(moved, badName);
  assert.throws(() => rebindBoard(record.id, badName), /Invalid named/);
  assert.equal(getBoard(record.id).dir, moved, "Invalid rebind must not update the record");
  fs.renameSync(badName, moved);
  fs.renameSync(moved, dir); rebindBoard(record.id, dir);
  const module = new URL("../skills/grill/hub/registry.mjs", import.meta.url).href;
  const code = `import {registerBoard} from ${JSON.stringify(module)}; registerBoard(${JSON.stringify({ dir, base, name: "a", project: tmp, cli })});`;
  const writes = Array.from({ length: 6 }, () => child(["--input-type=module", "-e", code]));
  for (const p of writes) assert.equal((await p.done).code, 0);
  assert.equal(listBoards().length, 1);
  const dead = child(["-e", ""]); await dead.done;
  const lock = path.join(process.env.GRILL_HUB_HOME, "registry.lock"); fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, "owner-00000000-0000-0000-0000-000000000000.json"), JSON.stringify({ pid: dead.pid }));
  assert.equal(registerBoard({ dir, base, name: "a", project: tmp, cli }).id, record.id);
  // Interrupted release/reclamation leaves no marker. Concurrent writers must
  // recover it without deleting a newly published owner's populated directory.
  fs.mkdirSync(lock);
  const recovered = Array.from({ length: 6 }, () => child(["--input-type=module", "-e", code]));
  for (const p of recovered) { const result = await p.done; assert.equal(result.code, 0, result.error); }
  assert.equal(listBoards().length, 1);
  const neighbor = path.join(base, "b"); fs.mkdirSync(neighbor);
  fs.writeFileSync(path.join(neighbor, "state.json"), "{}");
  const one = "11111111-1111-4111-8111-111111111111", two = "22222222-2222-4222-8222-222222222222";
  fs.writeFileSync(path.join(base, "agent-connection.json"), JSON.stringify({ provider: "codex", id: one, command: process.execPath, args: [] }));
  assert.throws(() => codexConnection(base, "a"), /Codex/);
  fs.writeFileSync(path.join(dir, "agent-connection.json"), JSON.stringify({ provider: "codex", id: one, command: process.execPath, args: [] }));
  fs.writeFileSync(path.join(neighbor, "agent-connection.json"), JSON.stringify({ provider: "codex", id: two, command: process.execPath, args: [] }));
  assert.equal(codexConnection(base, "a").id, one); assert.equal(codexConnection(base, "b").id, two);
  fs.unlinkSync(path.join(dir, "state.json"));
  let server = await start();
  await request(server, "init", { title: "Hub test", questions: [{ q: "Choose policy?" }, { q: "Other policy?" }] });
  const id = (await request(server, "state")).nodes.find(n => n.kind === "q").id;
  const lease = await request(server, "hub/claim", {});
  assert.equal(lease.id, record.id); assert.equal(lease.connected, false);
  assert.equal(lease.waiting, false); assert.equal(lease.monitorArmed, false); assert.equal(lease.workActive, false); assert.ok(Number.isFinite(lease.checkedAt));
  assert.equal((await request(server, "hub/claim", {})).epoch, lease.epoch);
  assert.equal((await fetch(server.url + "api/hub")).status, 403);
  await request(server, "wait?timeout=5", undefined, undefined, 409);
  // A managed multipart reply authenticates every part without staging its epoch.
  await request(server, "discuss", { id: "root", message: "Explain the policy choices" });
  const discussion = await request(server, "wait?timeout=5", undefined, lease.epoch);
  assert.equal(discussion.type, "discuss");
  const identity = { type: "discuss", id: discussion.id, token: discussion.token, hubEpoch: discussion.hubEpoch };
  const parts = [{ ...identity, part: 0, more: true, links: [id] }, { ...identity, part: 1, more: false, reply: "Policy choices explained" }];
  validateResults(discussion, parts, discussion.token);
  await request(server, "apply", { ...parts[0], hubEpoch: "stale" }, undefined, 409);
  assert.equal((await request(server, "apply", parts[0])).staged, true);
  assert.equal((await request(server, "apply", parts[0])).staged, true);
  let root = (await request(server, "state")).nodes.find(n => n.id === "root");
  assert.equal(root.chat.filter(m => m.from === "claude").length, 0);
  const stagedRoot = JSON.parse(fs.readFileSync(path.join(dir, "state.json"))).nodes.find(n => n.id === "root");
  assert.equal(Object.hasOwn(stagedRoot.discussDraft[0], "hubEpoch"), false);
  await request(server, "apply", { ...parts[1], hubEpoch: "stale" }, undefined, 409);
  await request(server, "apply", { ...parts[1], token: "stale" }, undefined, 409);
  await request(server, "apply", parts[1]);
  await request(server, "apply", parts[1]);
  root = (await request(server, "state")).nodes.find(n => n.id === "root");
  assert.equal(root.chat.filter(m => m.from === "claude").length, 1);
  assert.equal(root.chat.at(-1).text, "Policy choices explained");
  assert.equal(root.chat.at(-1).links[0].id, id);
  await request(server, "answer", { id, answer: "Policy accepted" });
  const first = await request(server, "wait?timeout=5", undefined, lease.epoch);
  assert.equal(first.hubEpoch, lease.epoch);
  await request(server, "hub/stop", {}); await server.p.done;
  server = await start();
  const secondLease = await request(server, "hub/claim", {});
  assert.notEqual(secondLease.epoch, lease.epoch);
  const stale = { type: "notes", notes: "stale", hubEpoch: lease.epoch };
  await request(server, "apply", stale, undefined, 409);
  await request(server, "wait?timeout=5", undefined, lease.epoch, 409);
  const event = await request(server, "wait?timeout=5", undefined, secondLease.epoch);
  assert.equal(event.id, id); assert.notEqual(event.token, first.token);
  const result = { type: "answer", id, token: event.token, hubEpoch: event.hubEpoch, status: "ok", verdict: "Accepted" };
  await request(server, "apply", result); await request(server, "apply", result);
  await request(server, "hub/stop", {}); await server.p.done;
  server = await start();
  assert.equal((await request(server, "state")).nodes.find(n => n.id === id).answer, "Policy accepted");
  await request(server, "apply", result, undefined, 409);
  const activeLease = await request(server, "hub/claim", {});
  server.owner = one;
  await request(server, "hub/attach", {}, activeLease.epoch);
  await request(server, "hub/stop", {}); await server.p.done;
  server = await start(); server.owner = one;
  const replacementLease = await request(server, "hub/claim", {});
  await request(server, "hub/attach", {}, replacementLease.epoch);
  await request(server, "stop", {}, activeLease.epoch, 409);
  await request(server, "stop", {}, undefined, 409);
  assert.equal((await request(server, "hub")).epoch, replacementLease.epoch);
  await request(server, "stop", {}, replacementLease.epoch); await server.p.done;
  const renamed = path.join(base, "renamed"); fs.renameSync(dir, renamed);
  const rebound = rebindBoard(record.id, renamed);
  assert.equal(rebound.id, record.id); assert.equal(rebound.name, "renamed"); assert.equal(rebound.base, base);
  server = await start(rebound);
  assert.equal((await request(server, "hub")).id, record.id);
  assert.equal((await request(server, "state")).name, "renamed");
  assert.equal((await request(server, "state")).nodes.find(n => n.id === id).answer, "Policy accepted");
  await request(server, "hub/stop", {}); await server.p.done;
  const legacyDir = path.join(tmp, "legacy"); fs.mkdirSync(legacyDir);
  const legacy = registerBoard({ dir: legacyDir, base: legacyDir, cli });
  const legacyMoved = path.join(tmp, "new-project", "legacy-renamed"); fs.mkdirSync(path.dirname(legacyMoved)); fs.renameSync(legacyDir, legacyMoved);
  const legacyRebound = rebindBoard(legacy.id, legacyMoved);
  assert.equal(legacyRebound.name, null); assert.equal(legacyRebound.base, legacyMoved);
  assert.equal(legacyRebound.project, path.dirname(legacyMoved));
  server = await start(legacyRebound);
  await request(server, "stop", {}); await server.p.done;
  console.log("Hub runtime: identity, renamed/legacy rebind, counts, conflicts, concurrency, empty-lock recovery, same-owner stop epoch fence, replay, accepted result, restart and 403 passed");
} finally {
  for (const p of children) p.kill();
  await Promise.all([...children].map(p => p.done));
  fs.rmSync(tmp, { recursive: true, force: true });
}
