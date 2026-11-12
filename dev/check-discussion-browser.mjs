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
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-discussion-browser-")), dir = path.join(cwd, "maps"), profile = path.join(cwd, "browser");
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

  assert.equal(await js("showObsolete"), false);
  await click("[data-obsolete]"); assert.equal(await js("showObsolete"), true);
  await cdp("Page.enable");
  const reloaded = new Promise(resolve => { const listener = e => { if (JSON.parse(e.data).method === "Page.loadEventFired") { ws.removeEventListener("message", listener); resolve(); } }; ws.addEventListener("message", listener); });
  await cdp("Page.reload"); await reloaded; await until(() => js("typeof loaded!=='undefined'&&loaded"));
  assert.equal(await js("showObsolete"), true);
  await js('window.savedKey=S.mapKey;S.mapKey="another-project-same-map-name";showObsolete=localStorage.getItem(obsoleteKey())==="true";render()');
  assert.equal(await js("showObsolete"), false);
  await js(`poll=async()=>{};S.mapKey=savedKey;S.nodes=[
    {id:"root",parentId:null,kind:"root"},
    {id:"old1",parentId:"root",kind:"q",q:"Old closed",status:"ok",obsolete:{reason:"Replaced"}},
    {id:"old2",parentId:"old1",kind:"q",q:"Old weak",status:"weak",obsolete:{reason:"Replaced"}},
    {id:"live",parentId:"old2",kind:"q",q:"Current question",status:"open",options:["A","B"]},
    {id:"hidden",parentId:"root",kind:"q",q:"Historical gap",status:"gap",obsolete:{reason:"Replaced"}},
    {id:"closed",parentId:"root",kind:"q",q:"Current closed",status:"ok"}
  ];showObsolete=false;flt=null;render();`);
  const shown = () => js('[...document.querySelectorAll("#stage .node")].map(n=>n.dataset.id).sort()');
  assert.deepEqual(await shown(), ["closed", "live", "old1", "old2", "root"]);
  assert.equal(await js('["old1","old2"].every(id=>document.querySelector(`[data-id="${id}"]`).classList.contains("ctx"))'), true);
  await click('[data-flt="open"]');
  assert.deepEqual(await shown(), ["live", "old1", "old2", "root"]);
  await click("[data-obsolete]"); assert.equal(await js("flt"), "open");
  assert.deepEqual(await shown(), ["hidden", "live", "old1", "old2", "root"]);
  assert.equal(await js('document.querySelector("[data-flt=open] b").textContent'), "1");
  await click("[data-obsolete]"); assert.equal(await js("flt"), "open");
  await click('[data-flt="verify"]'); assert.deepEqual(await shown(), ["root"]);
  await click("[data-obsolete]"); assert.deepEqual(await shown(), ["hidden", "old1", "old2", "root"]);
  await click("[data-obsolete]"); await click('[data-flt="open"]');
  await js('openPanel({mode:"node",id:"live"})'); await input("#fAns", "Unsent answer draft");
  await click('[data-flt="ok"]'); assert.equal(await js("panel"), null);
  await click('[data-flt="open"]'); await js('openPanel({mode:"node",id:"live"})');
  assert.equal(await js('document.querySelector("#fAns").value'), "Unsent answer draft");
  await js(`get("live").answerHistory=[{answer:"Earlier user answer",source:{id:"old1",q:"Original source"}}];get("live").mergedFrom=[{q:"Merged card",answer:"Latest merged answer",answerHistory:[{answer:"Earlier merged user answer",source:{id:"deleted-source",q:"Historical source title"}}]}];renderPanel()`);
  assert.match(await js('document.querySelector("#panel").textContent'), /Earlier merged user answer/);
  assert.match(await js('document.querySelector("#panel").textContent'), /Historical source title/);
  assert.match(await js("toMarkdown()"), /Earlier merged user answer/);
  assert.match(await js("toMarkdown()"), /Historical source title/);
  // Links are structured escaped text and reveal hidden cards through reversible isolation.
  await js(`S.nodes[0].chat=[{id:"reply",from:"claude",readAt:1,text:"<img src=x onerror=alert(1)>",links:[{id:"hidden",q:"<script>bad()</script>"},{id:"deleted",q:"Gone"}]}];openPanel({mode:"node",id:"root",tab:"chat"});`);
  assert.equal(await js('document.querySelectorAll("#panel .msg script,#panel .msg img").length'), 0);
  await click('[data-card-link="deleted"]');
  assert.equal(await js('document.querySelector("#errorToast").hidden'), false);
  await click('[data-card-link="hidden"]'); assert.equal(await js("panel.id"), "hidden");
  assert.equal(await js("showObsolete"), false); assert.equal(await js("isolated.filter"), "open");
  assert.equal(await js('document.querySelector("[data-id=hidden]").classList.contains("ctx")'), false);
  await click("#zAll"); assert.equal(await js("panel.id"), "hidden");
  await click("#bIsolation"); assert.equal(await js("flt"), "open");
  assert.deepEqual(await shown(), ["live", "old1", "old2", "root"]);
  assert.equal(await js("nextOpen().id"), "live");
  console.log("Discussion browser checks passed");
} finally {
  // Close Chromium normally so its profile-owning subprocesses exit on Windows.
  if (ws?.readyState === WebSocket.OPEN) {
    await Promise.race([cdp("Browser.close").catch(() => {}), sleep(2000)]);
    if (browser?.exitCode === null) await Promise.race([new Promise(resolve => browser.once("exit", resolve)), sleep(2000)]);
  }
  if(ws)ws.close();
  await end(browser); await end(server);
  try { fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
  catch (error) {
    if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
    console.warn(`Browser profile cleanup deferred (${error.code}); retained ${cwd}`);
  }
}
