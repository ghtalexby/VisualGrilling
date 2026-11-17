// Optional real-browser checks using built-in CDP/WebSocket, without installed packages.
// Node 22+; set GRILL_BROWSER to a Chromium executable on other platforms.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const executable = [process.env.GRILL_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => p && fs.existsSync(p));
if (!executable || typeof WebSocket === "undefined") { console.log("Browser checks skipped: Chromium and Node 22+ required"); process.exit(0); }
const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-work-browser-")), dir = path.join(cwd, "maps"), profile = path.join(cwd, "browser");
const sleep = ms => new Promise(r => setTimeout(r, ms));
let server, browser, ws, url, sequence = 0;
const pending = new Map();
async function until(fn) { for (let i = 0; i < 150; i++) { const value = await fn(); if (value) return value; await sleep(100); } throw new Error("Timed out"); }
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function js(expression) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function api(route, body) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(r.status, 200, await r.clone().text()); return r.json();
}
async function end(child) { if (!child || child.exitCode !== null) return; const ended = new Promise(r => child.once("exit", r)); child.kill(); await ended; }
try {
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--name", "check", "--port", "0", "--lang", "en"], { cwd, stdio: "ignore", windowsHide: true });
  await until(() => { try { const info = JSON.parse(fs.readFileSync(path.join(dir, "check", "server.json"))); url = info.url; return true; } catch { return false; } });
  await api("init", { title: "Browser check", questions: [{ q: "Existing question", options: ["Yes", "No"] }] });
  browser = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore", windowsHide: true });
  const port = await until(() => { try { return Number(fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); } catch { return false; } });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(p => p.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); } });
  await cdp("Page.navigate", { url }); await until(() => js("typeof loaded!=='undefined'&&loaded"));


  for (const language of ["en", "ru"]) {
    await api("locale", { language }); await js("window.oldPage=true"); await cdp("Page.reload"); await until(() => js('!window.oldPage&&typeof loaded!=="undefined"&&loaded'));
    await api("init", { title: "Coverage", questions: [{ q: "Decision?" }, { q: "Measured fact?" }, { q: "Keep open?" }] });
    const [target, source] = (await api("state")).nodes.filter(n => n.kind === "q");
    await api("answer", { id: source.id, answer: "Observed <script>unsafe()</script> 42" }); let e = await api("wait?timeout=5");
    await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Measured" });
    await api("answer", { id: target.id, answer: "Original answer" }); e = await api("wait?timeout=5");
    await api("apply", { type: "answer", id: e.id, token: e.token, status: "weak", verdict: "Missing proof" });
    await js("poll(true)"); assert.equal(await js('document.querySelector("#queueCount").hidden'), false);
    e = await api("wait?timeout=5"); assert.equal(e.type, "followup");
    await api("apply", { type: "followup", id: e.id, token: e.token, status: "ok", verdict: "Evidence resolves the gap", coverage: { resolved: true, reason: "Checked measurement", gaps: [], sources: [{ id: source.id, answer: "Observed <script>unsafe()</script> 42", contribution: "Verified <b>capacity</b>" }] } });
    await js("poll(true)"); await js('openPanel({mode:"node",id:'+JSON.stringify(target.id)+'})');
    assert.equal(await js('document.querySelector(".pb").textContent.includes("Original answer")'), true);
    assert.equal(await js('document.querySelector(".pb").textContent.includes("Verified <b>capacity</b>")'), true);
    assert.equal(await js('document.querySelector(".pb").textContent.includes('+JSON.stringify(source.id)+')'), true);
    assert.equal(await js('document.querySelectorAll(".pb script").length'), 0);
    assert.match(await js("toMarkdown()"), /Verified <b>capacity<\/b>/);
    assert.match(await js("toMarkdown()"), /Original answer/);
  }
  console.log("Follow-up browser checks passed in EN and RU");
} finally {
  // Close Chromium normally so its profile-owning subprocesses exit on Windows.
  if (ws?.readyState === WebSocket.OPEN) {
    await Promise.race([cdp("Browser.close").catch(() => {}), sleep(2000)]);
    if (browser?.exitCode === null) await Promise.race([new Promise(resolve => browser.once("exit", resolve)), sleep(2000)]);
  }
  if (ws) ws.close();
  await end(browser); await end(server);
  try { fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
  catch (error) {
    if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
    console.warn(`Browser profile cleanup deferred (${error.code}); retained ${cwd}`);
  }
}
