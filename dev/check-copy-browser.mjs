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
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-copy-browser-")), dir = path.join(cwd, "maps"), profile = path.join(cwd, "browser");
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


  // Use real layout/hover and deterministic clipboard outcomes with the production renderer.
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await js(`poll=async()=>{};window.qid=S.nodes.find(n=>n.kind==="q").id;
    window.saved=structuredClone(get(qid));window.copied=[];
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>copied.push(text)}});
    Object.assign(get(qid),{answer:"Ответ ё猫\\n<unsafe>",verdict:"Verdict only",status:"ok",
      answerHistory:[{answer:"Earlier answer"}],verdictHistory:[{status:"weak",verdict:"Earlier verdict"},{status:"ok",verdict:"Verdict only"}],
      mergedFrom:[{q:"Merged question",answer:"Merged answer",verdict:"Merged verdict",answerHistory:[{answer:"Merged earlier answer"}]}]});
    openPanel({mode:"node",id:qid});`);
  assert.equal(await js('document.querySelector("unsafe")'), null);
  await click("#mapIdentity [data-copy]");
  const resumeText = await js("copied.pop()");
  assert.ok(resumeText.startsWith("Resume this existing grilling"));
  const resumeData = JSON.parse(resumeText.slice(resumeText.indexOf("{")));
  assert.equal(resumeData.project, cwd);
  assert.equal(resumeData.name, "check");
  assert.equal(resumeData.dir, dir);
  assert.ok(resumeData.start.includes("--name check"));
  assert.equal(await js('document.querySelector("#mapIdentity [data-copy]").classList.contains("copy-success")'), true);
  await js('render();document.querySelector("#mapIdentity [data-copy]").focus()');
  assert.equal(await js('getComputedStyle(document.querySelector("#mapIdentity [data-copy]")).opacity'), "1");
  for(const text of ["Earlier answer","Earlier verdict","Merged question","Merged answer","Merged verdict","Merged earlier answer"]){
    assert.equal(await js(`Array.from(document.querySelectorAll("[data-copy]")).some(b=>b.dataset.copy===${JSON.stringify(text)})`),true,text);
  }
  assert.equal(await js('Array.from(document.querySelectorAll(".copy-block")).every(b=>b.querySelectorAll(":scope > [data-copy]").length===1)'),true);
  assert.equal(await js('document.querySelector("[data-verdict]").textContent.includes("Ответ")'),false);
  assert.equal(await js('Array.from(document.querySelectorAll(".copy-block")).filter(b=>b.getBoundingClientRect().height).every(b=>Array.from(b.children).filter(c=>c.tagName!=="BUTTON").every(c=>c.getBoundingClientRect().bottom<=b.getBoundingClientRect().bottom))'),true,"Text stays inside blocks even in a tall drawer");
  const selector='.copy-heading > [data-copy]';
  const box=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await cdp("Input.dispatchMouseEvent",{type:"mouseMoved",x:1,y:1});
  assert.equal(await js(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity`),"0");
  const before=await js('document.querySelector(".copy-heading").getBoundingClientRect().height');
  await cdp("Input.dispatchMouseEvent",{type:"mouseMoved",...box});
  assert.equal(await js(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity`),"1");
  await cdp("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...box});
  await cdp("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...box});
  await until(()=>js('copied.length===1'));
  assert.equal(await js('copied[0]'),"Existing question");
  assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).ariaLabel`),"Copied");
  assert.equal(await js('document.querySelector(".copy-heading").getBoundingClientRect().height'),before);
  await until(()=>js(`!document.querySelector(${JSON.stringify(selector)}).classList.contains("copy-success")`));
  assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).ariaLabel`),"Copy");
  await js('document.querySelector(".verdict:not([data-verdict]) [data-copy]").click()');
  assert.equal(await js('copied.at(-1)'),"Ответ ё猫\n<unsafe>");
  // Delayed writes cannot report success early or update the next rendered card.
  await js('navigator.clipboard.writeText=()=>new Promise(r=>window.resolveCopy=r);window.oldButton=document.querySelector(".copy-heading [data-copy]");oldButton.click()');
  assert.equal(await js('oldButton.disabled&&!oldButton.classList.contains("copy-success")'),true);
  await js('renderPanel();resolveCopy();');
  assert.equal(await js('document.querySelector(".copy-heading [data-copy]").classList.contains("copy-success")'),false);
  await js('navigator.clipboard.writeText=()=>new Promise((r,j)=>window.rejectCopy=j);document.querySelector(".copy-heading [data-copy]").click();openPanel({mode:"summary"});rejectCopy(new Error("denied"));');
  assert.equal(await js('document.querySelector("#errorToast").hidden'),true);
  await js('navigator.clipboard.writeText=async t=>copied.push(t)');
  await click('[data-act="copy"]');
  assert.equal(await js('copied.at(-1)'),await js('document.querySelector("#md").value'));
  assert.equal(await js('document.querySelector("[data-act=copy]").closest(".copy-block")'),null);
  // Pending/obsolete answers and idea verdicts use independent copy blocks too.
  await js('get(qid).pending={answer:"Pending answer",stage:"queued"};openPanel({mode:"node",id:qid})');
  assert.equal(await js(`!!document.querySelector('[data-copy="Pending answer"]')`),true);
  await js('get(qid).pending=null;get(qid).obsolete={reason:"Past decision"};renderPanel()');
  assert.equal(await js(`!!document.querySelector('[data-copy="Verdict only"]')`),true);
  await js('S.nodes.push({id:"copy-idea",kind:"idea",parentId:"root",text:"Idea",status:"ok",verdict:"Idea verdict",chat:[]});openPanel({mode:"node",id:"copy-idea"})');
  assert.equal(await js(`!!document.querySelector('[data-verdict] > [data-copy="Idea verdict"]')`),true);
  // Chat hover, long content and narrow layout reserve space for the button.
  await js('get("root").chat=[{id:"copy-chat",from:"user",text:"Chat ё猫\\n"+"long message ".repeat(50)}];openPanel({mode:"project",id:"root",tab:"discuss"})');
  for(const width of [1100,390]){
    await cdp("Emulation.setDeviceMetricsOverride",{width,height:800,deviceScaleFactor:1,mobile:false});
    assert.equal(await js('(()=>{const b=document.querySelector(".msg"),c=b.querySelector("[data-copy]"),r=b.getBoundingClientRect(),q=c.getBoundingClientRect();return q.right<r.right&&q.top>=r.top&&q.left>=r.right-parseFloat(getComputedStyle(b).paddingRight)&&b.scrollWidth<=b.clientWidth})()'),true);
  }
  await js('navigator.clipboard.writeText=async()=>{throw new Error("denied")};document.querySelector(".msg [data-copy]").click()');
  await until(()=>js('document.querySelector("#errorToastText").textContent.includes("Copy failed")'));
  assert.equal(await js('!!document.querySelector(".copy-success")'),false);
  if(process.env.GRILL_COPY_SCREENSHOT){
    await cdp("Emulation.setDeviceMetricsOverride",{width:1100,height:800,deviceScaleFactor:1,mobile:false});
    await js('clearError();get(qid).obsolete=null;openPanel({mode:"node",id:qid})');
    const target=await js('(()=>{const r=document.querySelector("[data-verdict]").getBoundingClientRect();return {x:r.right-20,y:r.top+20}})()');
    await cdp("Input.dispatchMouseEvent",{type:"mouseMoved",...target});
    const shot=await cdp("Page.captureScreenshot",{format:"png"});fs.writeFileSync(process.env.GRILL_COPY_SCREENSHOT,Buffer.from(shot.data,"base64"));
  }
  console.log("Copy browser checks passed");
} finally {
  ws?.close(); await end(browser); await end(server);
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
