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
  await request("init", { title: "Work", questions: ["First?", "Second?"].map(q => ({ q, options: ["Yes", "No"] })) });
  const id = (await state()).nodes.find(n => n.kind === "q").id;
  await request("answer", { id, answer: "An answer" }); await work(null);
  let e = await request("wait?timeout=5"); await work("answer");
  const version = (await state()).version;
  await request("apply", { type: "notes", notes: "Intermediate notes" }); await work("answer");
  assert.ok((await state()).version > version);
  const old = e; e = await request("wait?timeout=5");
  assert.notEqual(e.token, old.token);
  await request("apply", { type: "answer", id, token: old.token, status: "ok", verdict: "Old" }, 409); await work("answer");
  await request("apply", { type: "answer", id, token: e.token, status: "ok", verdict: "Checked" }); await work(null);
  await request("discuss", { id: "root", message: "Explain" }); await work(null);
  e = await request("wait?timeout=5"); await work("discuss");
  await request("apply", { type: "discuss", id: "root", token: e.token, part: 0, more: true, questions: [] }); await work("discuss");
  await request("apply", { type: "notes", notes: "Still writing" }); await work("discuss");
  await request("apply", { type: "discuss", id: "root", token: e.token, part: 1, more: false, reply: "Explained" }); await work(null);
  await request("answer", { id, answer: "Changed" });
  e = await request("wait?timeout=5"); await work("answer");
  await stop(); await start(); await work(null);
  await request("wait?timeout=5"); await work("answer");
  await request("apply", { type: "answer", id, token: e.token, status: "ok", verdict: "Stale" }, 409); await work("answer");
  await request("cancel", { id }, 409); await work("answer");
  await stop(); await start(); await request("cancel", { id }, 409); await work(null);
  await request("init", { title: "More", questions: [{ q: "Open?", options: ["Yes", "No"] }] });
  await request("more", {}); await work(null);
  e = await request("wait?timeout=5"); assert.equal(e.type, "more"); await work("more");
  await stop(); await start(); await work(null);
  e = await request("wait?timeout=5"); assert.equal(e.type, "more"); await work("more");
  e = await request("wait?timeout=5"); assert.equal(e.type, "more"); await work("more");
  await request("apply", { type: "more", token: e.token, questions: [{ q: "Another?", options: ["Yes", "No"] }] }); await work(null);
  console.log("Current work lifecycle checks passed");
} finally {
  await stop(); fs.rmSync(cwd, { recursive: true, force: true });
}
