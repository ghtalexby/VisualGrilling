// Optional real-browser checks using built-in CDP/WebSocket, without installed packages.
// Node 22+; set GRILL_BROWSER to a Chromium executable on other platforms.
import { circlePreview } from "./fixtures/preview.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const executable = [process.env.GRILL_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => p && fs.existsSync(p));
if (!executable || typeof WebSocket === "undefined") { console.log("Browser checks skipped: Chromium and Node 22+ required"); process.exit(0); }
const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-preview-browser-")), dir = path.join(cwd, "maps"), profile = path.join(cwd, "browser");
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
  browser = spawn(executable, ["--headless=new", "--disable-site-isolation-trials", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore", windowsHide: true });
  const port = await until(() => { try { return Number(fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); } catch { return false; } });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(p => p.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", e => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); } });
  await cdp("Page.navigate", { url }); await until(() => js("typeof loaded!=='undefined'&&loaded"));

  const q=(await api("state")).nodes.find(n=>n.kind==="q");
  await menu(q.id); await click('[data-ctx="preview"]'); await click('[data-preview="prepare"]');
  let e=await api("wait?timeout=5");
  const result=(extra)=>api("apply",{type:"preview",id:e.id,token:e.token,projectId:e.projectId,base:e.base,...extra});
  await result({question:"Choose visual",options:["Circle UI","Diagram"]});
  const id=e.id; await until(()=>js(`panel?.id==="${id}"`)); await js("poll(true)");
  await input("#fPreview","Circle UI"); await click('[data-preview="build"]');
  e=await api("wait?timeout=5"); await result({files:circlePreview,purpose:"Circle size"}); await js("poll(true)");
  await click('[data-preview="open"]'); await until(()=>js("previewView?.ready"));
  assert.equal(await js('document.querySelector("iframe").getAttribute("sandbox")'),"allow-scripts");
  await js("window.originalFrame=previewView.frame;poll(true)"); assert.equal(await js("previewView.frame===originalFrame"),true);
  let frame=(await cdp("Page.getFrameTree")).frameTree.childFrames[0].frame.id;
  let world=(await cdp("Page.createIsolatedWorld",{frameId:frame,worldName:"test"})).executionContextId;
  const inside=async expression=>{const r=await cdp("Runtime.evaluate",{expression,contextId:world,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  await inside('(()=>{const e=document.querySelector("input");for(const value of [140,150,160,170,180]){e.value=value;e.dispatchEvent(new Event("input",{bubbles:true}));}})()');
  await until(()=>js("previewView.dirty")); await sleep(100);
  assert.equal(await inside('document.querySelector("output").textContent'),"180");
  await click('[data-view="close"]'); await until(()=>js('!!document.querySelector("dialog[open]")'));
  await click('[data-choice="cancel"]'); assert.equal(await js("!!previewView"),true);
  await click('[data-view="save"]'); await until(()=>js("!previewView.dirty"));
  assert.equal((await api("preview?id="+id)).savedState.diameter,180);
  const picture=await js('frameRequest("export")'); assert.ok(picture.svg.includes("180")); assert.ok(!picture.svg.includes("<script"));
  // A refresh response arriving after a new edit must prompt again and preserve Cancel.
  await js('window.realApi=api;window.releaseRefresh=null;api=async(...args)=>{const value=await realApi(...args);if(args[0].startsWith("/api/preview/document"))await new Promise(r=>releaseRefresh=r);return value};document.querySelector("[data-view=refresh]").click()');
  await until(()=>js("!!releaseRefresh"));
  await inside('(()=>{const e=document.querySelector("input");e.value="200";e.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await until(()=>js("previewView.dirty")); await sleep(100);
  await js("releaseRefresh();api=realApi");await until(()=>js('!!document.querySelector("dialog[open]")'));
  await click('[data-choice="cancel"]');assert.equal(await js("previewView.frame===originalFrame"),true);
  await click('[data-view="close"]'); await click('[data-choice="save"]'); await until(()=>js("!previewView"));
  assert.equal((await api("preview?id="+id)).savedState.diameter,200);
  // Project script cannot navigate or fetch, and active markup never enters the document.
  await api("preview/build",{id,request:"Isolation probe"}); e=await api("wait?timeout=5");
  await result({purpose:"Isolation",files:{...circlePreview,"index.html":circlePreview["index.html"]+'<script>parent.injected=true</script><iframe src="https://example.com"></iframe><a href="https://example.com">navigate</a>',"script.js":'const initialState={network:"pending",dom:typeof document,nav:typeof location.assign}; function update(s,e){return s} fetch("https://example.com").then(()=>{},()=>{});'}});
  await js("poll(true)");await js(`openPreview("${id}")`);await until(()=>js("previewView?.ready"));
  frame=(await cdp("Page.getFrameTree")).frameTree.childFrames[0].frame.id;
  world=(await cdp("Page.createIsolatedWorld",{frameId:frame,worldName:"test2"})).executionContextId;
  assert.equal(await inside('document.querySelector("#camera").querySelectorAll("script,iframe,a").length'),0);
  const isolated=await js('frameRequest("save")');assert.equal(isolated.state.dom,"undefined");assert.equal(isolated.state.nav,"undefined");assert.equal(await js("window.injected"),undefined);
  await js("closePreviewNow()");
  await api("locale", {language:"ru"});await cdp("Page.reload");await until(()=>js('typeof loaded!=="undefined"&&loaded&&document.documentElement.lang==="ru"'));
  await menu(q.id);assert.equal(await js('document.querySelector("[data-ctx=preview]").textContent'),"Создать превью");
  console.log("Preview browser checks passed: circle, polling, Save, dirty guard, SVG, sandbox, RU/EN");
} finally {
  ws?.close(); await end(browser); await end(server);
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
