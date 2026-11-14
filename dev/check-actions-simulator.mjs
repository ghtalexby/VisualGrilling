import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const maps = path.resolve(root, "test-project/.grill"), name = "queue-check-" + randomUUID().slice(0, 8), map = path.join(maps, name);
let url, log = "";
const child = spawn(process.execPath, ["dev/simulate.mjs", "--no-open", "--delay", "200", "--name", name, "--port", "0"], { cwd: root, windowsHide: true });
child.stdout.on("data", data => log += data); child.stderr.on("data", data => log += data);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await sleep(100); }
  throw new Error("Simulator timeout: " + log);
}
async function api(route, body) {
  const r = await fetch(url + "api/" + route, { method: body ? "POST" : "GET", headers: { "x-grill": "1", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  assert.equal(r.status, 200, await r.clone().text()); return r.json();
}
try {
  await until(async () => { try { url = JSON.parse(fs.readFileSync(path.join(map, "server.json"))).url; return (await api("state")).nodes.length > 1; } catch { return false; } });
  assert.equal((await fetch(url + "api/state")).status, 403);
  const ids = (await api("state")).nodes.filter(n => n.kind === "q").slice(0, 3).map(n => n.id);
  for (const [i, answer] of ["не знаю", "Есть 30 клиентов и 12 подтверждённых заказов", "думаю что спрос будет расти"].entries()) await api("answer", { id: ids[i], answer });
  await until(async () => (await api("state")).nodes.filter(n => ids.includes(n.id)).every(n => n.answer && !n.pending));
  assert.deepEqual(ids.map(id => JSON.parse(fs.readFileSync(path.join(map, "state.json"))).nodes.find(n => n.id === id).status), ["gap", "ok", "verify"]);
  await api("discuss", { id: "root", message: "Explain the priorities" });
  await api("more", {});
  await api("finish", {});
  await until(async () => (await api("state")).actionQueue.paused);
  await until(() => child.exitCode !== null);
  assert.equal(child.exitCode, 0, log);
  assert.ok(fs.readFileSync(path.join(map, "report.md"), "utf8").includes("симуляция"));
  console.log("Simulator passed: gap/ok/verify, discussion, more, finish and report");
} finally {
  if (url) try { await api("stop", {}); } catch {}
  if (child.exitCode === null) child.kill();
  // Only the uniquely named map created by this check is disposable.
  const resolved = path.resolve(map);
  if (path.dirname(resolved) !== maps || path.basename(resolved) !== name) throw new Error("Unsafe test path");
  await sleep(300);
  fs.rmSync(resolved, { recursive: true, force: true });
}
