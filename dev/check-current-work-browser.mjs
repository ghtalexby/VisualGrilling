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


  assert.equal(await js('document.querySelector("#usageTotal").textContent'), "Session tokens: no data");
  await js('window.originalApi=api;api=async(...args)=>{const d=await originalApi(...args);if(args[0]==="/api/state")d.sessionUsage={total_tokens:120,input_tokens:100,cached_input_tokens:80,output_tokens:20,reasoning_output_tokens:5};return d};poll()');
  assert.equal(await js('document.querySelector("#usageTotal").textContent'), "Session tokens: 120");
  assert.equal(await js('document.querySelector("#usageDetails").textContent.startsWith("Input across all requests: 100\\nUncached: 20\\nCached: 80\\nOutput: 20\\nIncluding reasoning: 5")'), true);
  assert.equal(await js('/[А-Яа-я]/.test(document.querySelector("#usageDetails").textContent)'), false);
  assert.equal(await js('document.querySelector("#usageDetails").hidden'), true);
  const headerHeight=await js('document.querySelector("header").getBoundingClientRect().height');
  const counter=await js('(()=>{const r=document.querySelector("#usageTotal").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await cdp("Input.dispatchMouseEvent",{type:"mouseMoved",...counter});
  assert.equal(await js('document.querySelector("#usageDetails").hidden'), false);
  assert.equal(await js('document.querySelector("header").getBoundingClientRect().height'),headerHeight);
  await js('poll()');
  assert.equal(await js('document.querySelector("#usageDetails").hidden'), false);
  await cdp("Input.dispatchMouseEvent",{type:"mouseMoved",x:0,y:0});
  assert.equal(await js('document.querySelector("#usageDetails").hidden'), true);
  await js('document.querySelector("#usageTotal").focus()');
  assert.equal(await js('document.querySelector("#usageDetails").hidden'), false);
  await cdp("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape"});
  assert.equal(await js('document.querySelector("#usageDetails").hidden'), true);
  await js('document.querySelector("#usageTotal").blur()');
  await js('offline=true;renderHeader()');
  assert.equal(await js('document.querySelector("#usageTotal").textContent'), "Session tokens: no data");
  await js('api=originalApi;hideUsage();poll()');

  await js('window.hintApi=api;api=async(...args)=>{const d=await hintApi(...args);if(args[0]==="/api/state")d.sessionHint="rollover";return d};poll()');
  assert.equal(await js('document.querySelector("#sessionHint").hidden'), false);
  assert.match(await js('document.querySelector("#sessionHint").textContent'), /new session/);
  await js('offline=true;renderUsage()');
  assert.equal(await js('document.querySelector("#sessionHint").hidden'), true);
  await js('api=hintApi;poll()');
  assert.equal(await js('document.querySelector("#sessionHint").hidden'), true);
  const id = (await api("state")).nodes.find(n => n.kind === "q").id;
  await api("answer", { id, answer: "Test" });
  const e = await api("wait?timeout=5");
  await until(() => js('document.querySelector("#conn").classList.contains("working")'));
  assert.equal(await js('document.querySelector("#conn").textContent'), "Agent is reviewing an answer…");
  assert.equal(await js('getComputedStyle(document.querySelector("#conn i")).animationName'), "work-breathe");
  assert.equal(await js('document.querySelector("#brandActivity").classList.contains("active")'), true);
  await js("window.beforeReload=true");
  await cdp("Page.reload"); await until(() => js('!window.beforeReload&&typeof loaded!=="undefined"&&loaded&&S.currentWork?.type==="answer"'));
  await js('poll=async()=>{};listening=false;renderHeader()');
  assert.equal(await js('document.querySelector("#conn").className'), "conn working");
  await js('offline=true;renderHeader()');
  assert.equal(await js('document.querySelector("#conn").className'), "conn dead");
  await js('offline=false;renderHeader();openPanel({mode:"node",id:S.nodes.find(n=>n.kind==="q").id})');
  await cdp("Emulation.setDeviceMetricsOverride", { width: 420, height: 800, deviceScaleFactor: 1, mobile: false });
  assert.equal(await js('(()=>{const r=document.querySelector("#conn i").getBoundingClientRect();return r.width===8&&r.height===8})()'), true);
  assert.equal(await js('document.querySelector(".agent-controls").getBoundingClientRect().right<=innerWidth'), true);
  await js('showUsage()');
  assert.equal(await js('(()=>{const r=document.querySelector("#usageDetails").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()'),true);
  await js('hideUsage()');
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await js('getComputedStyle(document.querySelector("#conn i")).animationName'), "none");
  await api("apply", { type: "answer", id, token: e.token, status: "ok", verdict: "Checked" });
  await api("locale", { language: "ru" });
  await js("window.beforeReload=true");
  await cdp("Page.reload"); await until(() => js('!window.beforeReload&&typeof loaded!=="undefined"&&loaded&&document.documentElement.lang==="ru"'));
  await js('poll=async()=>{};listening=false;S.currentWork={type:"spec"};renderHeader()');
  assert.equal(await js('document.querySelector("#conn").textContent'), "Агент составляет спеку…");
  for (const type of ["answer","discuss","reread","reevaluate","question","idea","preview","spec","knowledge","more","finish"]) {
    await js(`S.currentWork={type:${JSON.stringify(type)}};renderHeader()`);
    assert.equal(await js('document.querySelector("#conn").className'), "conn working", type);
  }
  await js('S.currentWork=null;listening=true;renderHeader()');
  assert.equal(await js('document.querySelector("#conn").textContent'), "Агент на связи");
  assert.equal(await js('getComputedStyle(document.querySelector("#conn i")).animationName'), "none");
  console.log("Current work browser checks passed");
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
