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
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-knowledge-browser-")), dir = path.join(cwd, "maps"), profile = path.join(cwd, "browser");
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
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const input = (selector, text) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(text)};e.dispatchEvent(new Event("input",{bubbles:true}));})()`);
const menu = id => js(`document.querySelector('[data-id="${id}"]').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:100,clientY:100}))`);
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
  fs.writeFileSync(path.join(cwd, "docs/vgril/manual.md"), "# Snapshot\n<script>window.injected=true</script>\n[Missing](absent.md)\n[Local](http://localhost:4777)");
  for (const language of ["en", "ru"]) {
    await api("locale", { language }); await js("globalThis.__beforeKnowledgeReload=1"); await cdp("Page.reload");
    await until(() => js(`typeof __beforeKnowledgeReload==="undefined"&&typeof loaded!=="undefined"&&loaded&&typeof renderPanel==="function"&&document.documentElement.lang==="${language}"`));
    await js('panel={mode:"summary"};renderPanel()');
    await click('[data-act="knowledge-open"]'); await until(() => js('!!document.querySelector("[data-document]")'));
    await click('[data-document="docs/vgril/manual.md"]'); await until(() => js('!!document.querySelector("#panel pre")'));
    assert.equal(await js("window.injected"), undefined);
    assert.match(await js('document.querySelector("#panel pre").textContent'), /<script>/);
    assert.match(await js('document.querySelector("#panel").textContent'), language === "en" ? /Source unavailable/ : /Источник недоступен/);
    assert.match(await js('document.querySelector("#panel").textContent'), language === "en" ? /Local source/ : /Локальный источник/);
    await api("finish", {}); let event = await api("wait?timeout=5"); assert.equal(event.type, "knowledge");
    await api("apply", { type: "knowledge", token: event.token, error: "Simulated disk failure" });
    await js("poll(true)");
    assert.match(await js('document.querySelector("#panel").textContent'), /Simulated disk failure/);
    await click('[data-act="knowledge-retry"]'); await until(async () => (await api("state")).knowledgePending.stage === "queued");
    event = await api("wait?timeout=5");
    await api("apply", { type: "knowledge", token: event.token, error: "Retry still failed" });
    await js("poll(true)"); await click('[data-act="knowledge-skip"]');
    event = await api("wait?timeout=5"); assert.equal(event.type, "finish");
    await api("apply", { type: "finish", token: event.token, summary: "Skipped explicitly" });
    await js("poll(true)");
    assert.match(await js('document.querySelector("#panel").textContent'), language === "en" ? /Knowledge saving skipped by the user/ : /Сохранение знаний пропущено пользователем/);
  }
  console.log("Knowledge browser checks passed: documents, snapshots, link availability, retry, explicit skip, RU/EN");
} finally {
  ws?.close(); await end(browser); await end(server);
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
