// Exercise the real CLI in a disposable project, never in a user's map.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-watch-check-"));
const dir = path.join(cwd, "maps");
const children = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, url;
function run(args) {
  const child = spawn(process.execPath, [cli, ...args, "--dir", dir, "--name", "check"], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", data => stdout += data);
  child.stderr.on("data", data => stderr += data);
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { children.delete(child); resolve({ code, signal, stdout, stderr }); });
  });
  return { child, done, output: () => stdout };
}
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await sleep(50); }
  throw new Error("Timed out waiting for state");
}
async function start() {
  server = run(["serve", "--port", "0"]);
  await until(() => {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(dir, "check", "server.json")));
      if (info.pid !== server.child.pid) return false;
      url = info.url; return true;
    } catch { return false; }
  });
}
async function request(route, body) {
  const response = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST",
    headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function event(watch, type) {
  const result = await watch.done;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim().split("\n").length, 1);
  const value = JSON.parse(result.stdout);
  assert.equal(value.type, type);
  return value;
}
const watch = (...args) => run(["watch", "--timeout", "5", "--max-wait", "20", ...args]);
// Prevent a failed command from leaving the check hanging indefinitely.
const watchdog = setTimeout(() => { for (const child of children) child.kill(); }, 120000);
try {
  assert.equal((await watch().done).code, 2);
  await start();
  await request("init", { title: "Watch check", questions: [{ q: "First?" }] });
  const id = (await request("state")).nodes.find(n => n.kind === "q").id;
  let w = watch();
  await until(async () => (await request("state")).listening);
  await sleep(7000);
  assert.equal(w.child.exitCode, null);
  assert.equal(w.output(), "", "Inner timeouts must be swallowed");
  assert.equal((await request("state")).listening, true);
  await request("answer", { id, answer: "Delivered after an inner timeout" });
  const first = await event(w, "answer");
  assert.equal(first.id, id);
  assert.equal((await request("state")).nodes.find(n => n.id === id).pending.stage, "thinking");
  // watch exits as soon as it prints; losing its consumer before apply is the same
  // recovery boundary as killing it after the server takes the event.
  w = watch();
  const repeated = await event(w, "answer");
  assert.equal(repeated.answer, first.answer);
  await request("apply", { type: "answer", id, token: repeated.token, status: "ok", verdict: "Checked", children: [] });
  await request("discuss", { id, message: "Can you explain the verdict?" });
  const discussion = await event(watch(), "discuss");
  assert.equal(discussion.id, id);
  assert.equal(discussion.message, "Can you explain the verdict?");
  assert.equal((await request("apply", { type: "discuss", id, token: discussion.token, reply: "The answer was checked." })).ok, true);
  const discussed = (await request("state")).nodes.find(n => n.id === id);
  assert.equal(discussed.discuss, null);
  assert.equal(discussed.chat.at(-1).text, "The answer was checked.");
  const automatic = await event(watch(), "reread");
  await request("apply", { type: "reread", token: automatic.token, reserve: [], audit: automatic.nodes.map(n => ({ id: n.id, action: "keep", reason: "Transport fixture" })) });
  const knowledge = await event(watch(), "knowledge");
  await request("apply", { type: "knowledge", token: knowledge.token, files: [] });
  const began = performance.now();
  w = run(["watch", "--timeout", "5", "--max-wait", "8"]);
  const expired = await event(w, "timeout");
  assert.equal(expired.expired, true);
  assert.equal(expired.waitingAnswers, 0);
  assert.equal(expired.waitingDiscussions, 0);
  assert.ok(performance.now() - began >= 7900);
  assert.ok(performance.now() - began < 10000, "Expiry should not wait for another full poll");
  // Expire before receiving the first server timeout: use the fallback counts.
  const t0 = performance.now();
  const z = await event(run(["watch", "--timeout", "20", "--max-wait", "6"]), "timeout");
  assert.equal(z.expired, true);
  assert.equal(z.waitingAnswers, 0);
  assert.equal(z.waitingDiscussions, 0);
  assert.ok(performance.now() - t0 >= 5900, "Expiry should respect max-wait");
  assert.ok(performance.now() - t0 < 8000);
  w = watch();
  await sleep(500);
  await request("stop", {});
  await server.done;
  assert.equal((await w.done).code, 2);
  assert.equal((await watch().done).code, 2);
  // Restart also preserves an event that was taken but never applied.
  await start();
  await request("answer", { id, answer: "Recover after restart" });
  await event(watch(), "answer");
  await request("stop", {}); await server.done;
  await start();
  assert.equal((await event(watch(), "answer")).answer, "Recover after restart");
  await request("stop", {}); await server.done;
  console.log("watch checks passed");
} finally {
  clearTimeout(watchdog);
  await Promise.all([...children].map(child => new Promise(resolve => { child.once("close", resolve); child.kill(); })));
  fs.rmSync(cwd, { recursive: true, force: true });
}
