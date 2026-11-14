import { contextCards } from "./context-fixture.mjs";
// Exercise map discovery and dispatch identity with real servers in a disposable project.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill maps O’Reilly 'check-"));
const dir = path.join(cwd, "maps");
const children = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(name, args) {
  const child = spawn(process.execPath, [cli, ...args, "--dir", dir, ...(name === null ? [] : ["--name", name])], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", data => stdout += data);
  child.stderr.on("data", data => stderr += data);
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => { children.delete(child); resolve({ code, stdout, stderr }); });
  });
  return { child, done };
}
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await sleep(50); }
  throw new Error("Timed out waiting for state");
}
async function start(name) {
  const server = run(name, ["serve", "--port", "0", "--lang", "en"]);
  let info;
  await until(() => {
    try { info = JSON.parse(fs.readFileSync(path.join(dir, name || "", "server.json"))); return info.pid === server.child.pid; } catch { return false; }
  });
  return { ...server, url: info.url };
}
async function request(server, route, body) {
  const res = await fetch(server.url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert.equal(res.status, 200, await res.clone().text());
  return res.json();
}
async function result(command) {
  const value = await command.done;
  assert.equal(value.code, 0, value.stderr);
  return JSON.parse(value.stdout);
}
const watchdog = setTimeout(() => { for (const child of children) child.kill(); }, 90000);
try {
  let a = await start("arch");
  const b = await start("money");
  const resume = (await request(a, "state")).resume;
  assert.equal(resume.project, cwd);
  assert.equal(resume.dir, dir);
  assert.equal(resume.name, "arch");
  assert.equal(resume.cli, cli);
  assert.equal(resume.state, path.join(dir, "arch", "state.json"));
  assert.equal(resume.session, path.join(dir, "arch", "session.md"));
  assert.ok(resume.start.includes("--name arch"));
  assert.ok(resume.start.includes("--dir"));
  const statusCommand = resume.start.replace(" start --dir ", " status --dir ");
  const statusOutput = execFileSync(process.platform === "win32" ? "powershell.exe" : "sh", process.platform === "win32" ? ["-NoProfile", "-NonInteractive", "-Command", statusCommand] : ["-c", statusCommand], { encoding: "utf8", windowsHide: true });
  assert.doesNotThrow(() => JSON.parse(statusOutput));
  assert.equal((await fetch(a.url + "api/state")).status, 403);
  for (const [server, title] of [[a, "Architecture"], [b, "Money"]]) await request(server, "init", { title, questions: [{ q: "Why?" }] });
  const state = JSON.parse(fs.readFileSync(path.join(dir, "arch", "state.json")));
  for (const name of ["stopped", "Invalid_Name"]) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, "state.json"), JSON.stringify({ ...state, title: name, finished: true }));
  }
  fs.mkdirSync(path.join(dir, "empty"));
  let maps = (await request(a, "maps?dir=../elsewhere&name=money")).maps;
  assert.equal(maps.length, 3);
  assert.deepEqual(maps.map(m => m.name).sort(), ["arch", "money", "stopped"]);
  assert.deepEqual(maps.filter(m => m.current).map(m => m.name), ["arch"]);
  assert.equal(maps.find(m => m.name === "money").url, b.url);
  assert.equal(maps.find(m => m.name === "stopped").url, null);
  assert.equal(maps.find(m => m.name === "stopped").listening, false);
  assert.equal(maps.find(m => m.name === "stopped").finished, true);

  assert.deepEqual(maps.map(({ current, ...m }) => m), await result(run(null, ["list"])));
  assert.deepEqual(maps.map(m => m.updated), maps.map(m => m.updated).sort().reverse());
  assert.deepEqual((await request(b, "maps")).maps.filter(m => m.current).map(m => m.name), ["money"]);
  assert.equal((await fetch(a.url + "api/maps")).status, 403);
  const forbiddenHost = await new Promise((resolve, reject) => {
    const req = http.get(a.url + "api/maps", { headers: { "x-grill": "1", host: "evil.example" } }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
  });
  assert.equal(forbiddenHost, 403);
  await request(a, "stop", {}); await a.done;
  a = await start("arch");
  assert.equal((await request(b, "maps")).maps.find(m => m.name === "arch").listening, false);
  const watch = run("arch", ["watch", "--inbox", "--max-wait", "20"]);
  // listening includes recent activity; this checks watch activity, not a live-waiter-only flag.
  await until(async () => (await request(b, "maps")).maps.find(m => m.name === "arch").listening);
  const id = (await request(a, "state")).nodes.find(n => n.kind === "q").id;
  await request(a, "answer", { id, answer: "Architecture answer" });
  const line = await result(watch);
  assert.equal(line.name, "arch");
  assert.equal(line.type, "answer");
  assert.equal(line.inbox, path.join(dir, "arch", "inbox.json"));
  assert.equal(JSON.parse(fs.readFileSync(line.inbox)).answer, "Architecture answer");
  await request(a, "apply", { type: "answer", id, token: line.token, status: "ok", verdict: "Good", children: [] });
  const automatic = await request(a, "wait?timeout=5");
  assert.equal(automatic.type, "reread");
  await request(a, "apply", { type: "reread", token: automatic.token, reserve: [], audit: contextCards(automatic).map(n => ({ id: n.id, action: "keep", reason: "Transport fixture" })) });
  assert.equal((await request(a, "state")).knowledgePending, null);
  const expired = await result(run("arch", ["watch", "--inbox", "--max-wait", "5"]));
  assert.equal(expired.name, "arch");
  assert.equal(expired.expired, true);
  const root = await start(null);
  const legacyResume = (await request(root, "state")).resume;
  assert.equal(legacyResume.name, null);
  assert.equal(legacyResume.state, path.join(dir, "state.json"));
  assert.ok(!legacyResume.start.includes("--name"));
  await request(root, "init", { title: "Legacy", questions: [{ q: "Legacy?" }] });
  await request(root, "more", {});
  const legacyMore = await result(run(null, ["watch", "--inbox"])); assert.equal(legacyMore.name, null);
  await request(root, "apply", { type: "more", token: legacyMore.token, questions: [] });
  const legacyExpired = await result(run(null, ["watch", "--inbox", "--max-wait", "5"]));
  assert.equal(legacyExpired.name, null);
  assert.equal(legacyExpired.expired, true);
  maps = (await request(root, "maps")).maps;
  assert.equal(maps.length, 4);
  assert.deepEqual(maps.filter(m => m.current).map(m => m.name), [null]);
  assert.equal((await request(root, "state")).name, null);
  assert.equal((await request(a, "state")).name, "arch");
  for (const server of [a, b, root]) { await request(server, "stop", {}); await server.done; }
  console.log("map checks passed");
} finally {
  clearTimeout(watchdog);
  await Promise.all([...children].map(child => new Promise(resolve => { child.once("close", resolve); child.kill(); })));
  fs.rmSync(cwd, { recursive: true, force: true });
}
