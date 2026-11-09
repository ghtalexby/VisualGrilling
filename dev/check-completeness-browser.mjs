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
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-completeness-browser-")), dir = path.join(cwd, "maps"), profile = path.join(cwd, "browser");
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

  // The resize grip must follow drawer visibility even with the error toast between them.
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  assert.equal(await js('getComputedStyle(document.querySelector("#panelGrip")).display'), "none");
  await js('openPanel({mode:"summary"})');
  assert.notEqual(await js('getComputedStyle(document.querySelector("#panelGrip")).display'), "none");
  await click('#panel [data-act="close"]');
  await js('showError("Grip visibility check")');
  assert.equal(await js('getComputedStyle(document.querySelector("#panelGrip")).display'), "none");
  await js('openPanel({mode:"summary"})');
  await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  assert.equal(await js('getComputedStyle(document.querySelector("#panelGrip")).display'), "none");
  await js('clearError()');
  await cdp("Emulation.clearDeviceMetricsOverride");

  // Freeze polling and record API writes so each UI scenario has deterministic state.
  await js(`window.originalApi=api;window.originalPoll=poll;poll=async()=>{};window.writes=[];api=async(path,body)=>{writes.push({path,body});return {ok:true}};
    S.coverage={shown:5,reserve:5,percent:50};
    window.qid=S.nodes.find(n=>n.kind==="q").id;
    S.nodes.push({id:"idea",parentId:"root",kind:"idea",text:"Idea",status:"weak",chat:[]});
    render();openPanel({mode:"node",id:qid});`);
  assert.match(await js('document.querySelector("#bReread").textContent'), /50%/);
  assert.equal(await js('document.querySelectorAll("button button").length'), 0);
  assert.equal(await js('document.querySelector("#zReset")'), null);
  assert.equal(await js('document.querySelector("[data-act=more]")'), null);
  // Header activity stays visible with the answer drawer open and ignores idle connectivity.
  await js('window.activityState=S;S={...S,queueLength:0};listening=true;renderHeader()');
  assert.equal(await js('document.querySelector("#brandActivity").classList.contains("active")'), false);
  for(const update of ['S.rereadPending={stage:"thinking",locked:true}', 'S.specPending={stage:"thinking"}', 'S.morePending=true', 'S.finishPending=true', 'S.queueLength=1', 'S.reevaluation={stage:"thinking"}', 'S.questionRequests=[{stage:"queued"}]', ...['pending','analysis','job'].map(key=>`S.nodes=[...S.nodes,{id:"work",${key}:{stage:"thinking"}}]`), 'S.nodes=[...S.nodes,{id:"work",discuss:"thinking"}]']){
    await js(`S={...activityState,queueLength:0};${update};renderHeader()`);
    assert.equal(await js('document.querySelector("#brandActivity").classList.contains("active")'), true, update);
    assert.equal(await js('document.querySelector("#panel").hidden'), false);
  }
  await js('S={...activityState,rereadPending:{stage:"thinking",locked:true}};listening=false;renderHeader()');
  assert.equal(await js('document.querySelector("#brandActivity").classList.contains("active")'), true);
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await js('getComputedStyle(document.querySelector("#brandActivity"),"::before").animationName'), "none");
  await cdp("Emulation.setEmulatedMedia", { features: [] });
  assert.equal(await js('getComputedStyle(document.querySelector("#brandActivity"),"::before").animationName'), "reread-spin");
  await js('S.rereadPending={stage:"queued"};renderHeader()');
  assert.equal(await js('document.querySelector("#brandActivity").classList.contains("active")'), false);
  assert.match(await js('document.querySelector("#brandActivity").getAttribute("aria-label")'), /Waiting for the agent/);
  await js('listening=true;offline=true;renderHeader()');
  assert.equal(await js('document.querySelector("#brandActivity").classList.contains("active")'), false);
  await js('S=activityState;offline=false;listening=false;renderHeader()');
  // Reread failures must not replace the current drawer or interpret error HTML.
  await js('window.savedApi=api;api=async()=>{throw new Error("Request failed <unsafe>")};panel=null;renderPanel()');
  await click('#bReread'); await until(()=>js('!rereadSending'));
  assert.equal(await js('panel'), null);
  assert.equal(await js('document.querySelector("#errorToast").hidden'), false);
  assert.equal(await js('document.querySelector("#errorToastText").textContent'), "Request failed <unsafe>");
  assert.equal(await js('document.querySelector("#errorToast unsafe")'), null);
  assert.equal(await js('document.querySelector("#bReread").disabled'), false);
  await click('#closeErrorToast');
  assert.equal(await js('document.querySelector("#errorToast").hidden'), true);
  await js('openPanel({mode:"node",id:qid})');
  await input('#fAns', 'Retained draft');
  await click('#bReread'); await until(()=>js('!rereadSending'));
  assert.equal(await js('panel.id'), await js('qid'));
  assert.equal(await js('document.querySelector("#fAns").value'), 'Retained draft');
  await js('listening=true;renderHeader()');
  for(const selector of ['#bSpec','#bStop','[data-act="answer"]']){
    await click(selector);
    await until(()=>js('!sending&&!document.querySelector("#errorToast").hidden'));
    assert.equal(await js('panel.id'), await js('qid'));
    assert.equal(await js('document.querySelector("#fAns").value'), 'Retained draft');
    assert.equal(await js('document.querySelector("#panel .err")'), null);
  }
  await js('api=savedApi');
  assert.deepEqual(await js('[...document.querySelector(".agent-controls").children].map(n=>n.id)'), ["conn", "bPlay", "bStop"]);
  await js('listening=false;renderHeader()');
  assert.equal(await js('document.querySelector("#bStop").disabled'), true);
  assert.equal(await js('document.querySelector("#bPlay").disabled'), false);
  await click('#bPlay'); await until(()=>js('!resumeSending'));
  assert.equal(await js('writes.at(-1).path'), '/api/resume');
  assert.equal(await js('listening'), false);
  assert.equal(await js('panel.id'), await js('qid'));
  assert.equal(await js('document.querySelector("#fAns").value'), 'Retained draft');
  assert.match(await js('document.querySelector("#resumeNotice").textContent'), /Request sent/);
  await js('panel=null;renderPanel()');
  await click('#bSpec');
  assert.equal(await js('panel'), null);
  await js('openPanel({mode:"node",id:qid})');

  await click('#bReread'); await until(()=>js('!rereadSending'));
  assert.equal(await js('document.querySelector("#errorToast").hidden'), true);
  await js('S.rereadPending=null;renderHeader()');
  await input("#fAns", "Unicode comment: ё猫\nsecond line");
  await click('[data-chip="Yes"]'); await click('[data-chip="No"]');
  assert.equal(await js('document.querySelectorAll(".chip[aria-pressed=true]").length'), 2);
  assert.equal(await js('document.querySelector("#fAns").value'), "Unicode comment: ё猫\nsecond line");
  await click('[data-act="answer"]'); await until(()=>js('!sending'));
  assert.equal(await js('writes.at(-1).body.answer'), "Yes\nNo\nUnicode comment: ё猫\nsecond line");
  await input("#fAns", "Keep comment");
  await click('[data-chip="Yes"]'); await click('.chip.idk');
  assert.deepEqual(await js('selections[qid]'), ["I don't know"]);
  await click('[data-chip="No"]'); assert.deepEqual(await js('selections[qid]'), ["No"]);
  assert.equal(await js('document.querySelector("#fAns").value'), "Keep comment");
  await input("#fAns", "x".repeat(3000)); await click('[data-act="answer"]');
  assert.match(await js('document.querySelector("#errorToastText").textContent'), /3000/);
  await input("#fAns", "Draft persists");
  await click('#ledger [data-flt="verify"]');
  assert.equal(await js('document.querySelectorAll("#stage .node").length'), 1);
  assert.equal(await js('document.querySelector("#panel").hidden'), true);
  await click('#ledger [data-flt="weak"]');
  assert.equal(await js('counts().weak'), 1);
  assert.deepEqual(await js('[...document.querySelectorAll("#stage .node")].map(n=>n.dataset.id).sort()'), ["idea", "root"]);
  await click('#ledger [data-flt="weak"]'); await js('openPanel({mode:"node",id:qid})');
  assert.equal(await js('document.querySelector("#fAns").value'), "Draft persists");
  await click('[data-tab="discuss"]'); await input('#fMsg', '  Original draft\nwith whitespace  ');
  await js('draftQuotes[qid]={about:"option",text:"No"};panel.quote=draftQuotes[qid]');
  await click('[data-act="explainquestion"]'); await until(()=>js('!sending'));
  assert.equal(await js('writes.at(-1).path'), '/api/discuss');
  assert.equal(await js('writes.at(-1).body.about'), 'question');
  assert.equal(await js('document.querySelector("#fMsg").value'), '  Original draft\nwith whitespace  ');
  assert.equal(await js('panel.quote.text'), 'No');
  // Busy and HTTP rejection preserve the exact draft and quote; retry stays explicit.
  await js('get(qid).discuss="thinking"'); await click('[data-act="explainquestion"]');
  assert.equal(await js('document.querySelector("#fMsg").value'), '  Original draft\nwith whitespace  ');
  await js('get(qid).discuss=null;window.goodApi=api;api=async()=>{throw new Error("HTTP 409")};');
  await click('[data-act="explainquestion"]'); await until(()=>js('!sending'));
  assert.match(await js('document.querySelector("#errorToastText").textContent'), /409/);
  assert.equal(await js('document.querySelector("#fMsg").value'), '  Original draft\nwith whitespace  ');
  await js('api=goodApi');
  // Block-level copy retains Unicode/newlines, and rejection gets visible feedback.
  await js('window.copied=[];Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async t=>copied.push(t)}})');
  await click('[data-copy="Existing question"]'); await until(()=>js('copied.length'));
  assert.equal(await js('copied[0]'), 'Existing question');
  await js('navigator.clipboard.writeText=async()=>{throw new Error("denied")}');
  await click('[data-copy="Existing question"]'); await until(()=>js('document.querySelector("#errorToastText")?.textContent.includes("Copy failed")'));
  // Active/visible checks guard exact message acknowledgements, including root chat.
  await js(`Object.defineProperty(document,"hasFocus",{configurable:true,value:()=>false});
    get("root").chat=[{id:"reply-a",from:"claude",text:"Reply A",at:1},{id:"reply-b",from:"user",text:"Question",at:2}];
    render();openPanel({mode:"project",id:"root",tab:"discuss"});`);
  await js('ackVisibleMessages()');
  assert.equal(await js('writes.filter(w=>w.path==="/api/discuss/read").length'), 0);
  assert.equal(await js('document.querySelector("[data-id=root]").classList.contains("unread")'), true);
  await js('Object.defineProperty(document,"hasFocus",{configurable:true,value:()=>true});Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});ackVisibleMessages()');
  assert.equal(await js('writes.filter(w=>w.path==="/api/discuss/read").length'), 0);
  await js('Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});ackVisibleMessages()');
  assert.deepEqual(await js('writes.filter(w=>w.path==="/api/discuss/read").at(-1).body'), {id:"root",messageId:"reply-a"});
  // Fit includes visible cards below the manual zoom minimum and preserves navigation state.
  await js(`for(let i=0;i<200;i++)S.nodes.push({id:"big"+i,parentId:qid,kind:"q",q:"Large tree "+i,status:"open",options:[],chat:[]});render();`);
  await click('#zAll'); assert.ok(await js('zoom<.1'));
  assert.ok(await js('(()=>{const r=document.querySelector("#stage").getBoundingClientRect(),v=vp.getBoundingClientRect();return r.left>=v.left-1&&r.right<=v.left+viewWidth()+1&&r.top>=v.top-1&&r.bottom<=v.bottom+1})()'));
  await click('#zOut'); assert.equal(await js('zoom'), .1);
  assert.equal(await js('document.querySelector("#zBranch")'), null);
  assert.equal(await js('document.querySelector("#zAll").textContent'), "");
  assert.equal(await js('document.querySelector("#zAll").getAttribute("aria-label")'), "Show all");
  for (const filter of ["weak", "verify"]) {
    await click(`#ledger [data-flt="${filter}"]`);
    const ids = await js('[...document.querySelectorAll("#stage .node")].map(n=>n.dataset.id)');
    await click('#zAll');
    assert.equal(await js('flt'), filter);
    assert.deepEqual(await js('[...document.querySelectorAll("#stage .node")].map(n=>n.dataset.id)'), ids);
    assert.ok(await js('(()=>{const v=vp.getBoundingClientRect();return [...document.querySelectorAll("#stage .node")].every(n=>{const r=n.getBoundingClientRect();return r.left>=v.left&&r.right<=v.left+viewWidth()&&r.top>=v.top&&r.bottom<=v.bottom})})()'));
  }
  await js('flt=null;isolated={id:qid,filter:"weak"};render();openPanel({mode:"node",id:qid})');
  await input('#fAns', 'Fit preserves draft');
  await click('#zAll');
  assert.deepEqual(await js('isolated'), {id:await js('qid'),filter:"weak"});
  assert.equal(await js('flt'), null);
  assert.equal(await js('panel.id'), await js('qid'));
  assert.equal(await js('document.querySelector("#fAns").value'), 'Fit preserves draft');
  assert.equal(await js('document.querySelectorAll("#stage .node").length'), 2);
  assert.ok(await js('(()=>{const v=vp.getBoundingClientRect();return [...document.querySelectorAll("#stage .node")].every(n=>{const r=n.getBoundingClientRect();return r.left>=v.left&&r.right<=v.left+viewWidth()&&r.top>=v.top&&r.bottom<=v.bottom})})()'));
  // Native pointer hit testing distinguishes empty canvas from connection strokes.
  const doubleClickAt = async ({x,y}) => {
    for (const clickCount of [1,2]) {
      await cdp("Input.dispatchMouseEvent", {type:"mousePressed",x,y,button:"left",clickCount});
      await cdp("Input.dispatchMouseEvent", {type:"mouseReleased",x,y,button:"left",clickCount});
    }
  };
  const fittedCamera = await js('[zoom,px,py]');
  assert.match(await js('document.querySelector("#zAll").title'), /double-click an empty area/);
  for (const target of ["viewport", "stage"]) {
    await js('stopGlide();zoom=.5;px=20;py=80;applyView()');
    const point = await js(`(()=>{const v=vp.getBoundingClientRect();for(let y=v.top+5;y<v.bottom-5;y+=5)for(let x=v.left+5;x<v.left+viewWidth()-5;x+=5)if(document.elementFromPoint(x,y)?.id==="${target}")return {x,y};return null})()`);
    assert.ok(point, `Empty ${target} point exists`);
    await doubleClickAt(point);
    assert.deepEqual(await js('[zoom,px,py]'), fittedCamera);
    assert.deepEqual(await js('isolated'), {id:await js('qid'),filter:"weak"});
    assert.equal(await js('document.querySelector("#fAns").value'), 'Fit preserves draft');
  }
  await js('stopGlide();zoom=.5;px=20;py=80;applyView()');
  const edgePoint = await js('(()=>{const e=document.querySelector("#edges path"),p=e.getPointAtLength(e.getTotalLength()/2),q=new DOMPoint(p.x,p.y).matrixTransform(e.getScreenCTM());return {x:q.x,y:q.y,hit:document.elementFromPoint(q.x,q.y)?.tagName}})()');
  assert.equal(edgePoint.hit, "path");
  const beforeEdge = await js('[zoom,px,py]');
  await doubleClickAt(edgePoint);
  assert.deepEqual(await js('[zoom,px,py]'), beforeEdge);
  await click('#zAll');
  await js('isolated=null;render()');
  await click('[data-act="close"]');
  assert.equal(await js('document.querySelector("[data-root-chat]")'), null);
  await click('#bChat'); assert.equal(await js('panel.mode'), 'project');
  assert.equal(await js('isolated'), null);
  await click('[data-act="close"]'); assert.equal(await js('document.querySelector("#zBranch")'), null);
  // A removed merged source keeps its escaped, individually copyable verdict history.
  await js(`get(qid).mergedFrom=[{q:"Removed source",answer:"Source answer",verdict:"Regraded source",verdictHistory:[{status:"weak",verdict:"Historical <unsafe>"},{status:"ok",verdict:"Regraded source"}]}];openPanel({mode:"node",id:qid});`);
  assert.ok(await js('document.querySelector("#panel").textContent.includes("Historical <unsafe>")'));
  assert.equal(await js('document.querySelector("unsafe")'), null);
  assert.ok(await js(`!!document.querySelector('[data-copy="Historical <unsafe>"]')`));
  assert.match(await js('toMarkdown()'), /Historical <unsafe>/);
  await js('openPanel({mode:"summary"})');
  await click('[data-act="copy"]');
  await until(()=>js('!document.querySelector("#errorToast").hidden'));
  assert.match(await js('document.querySelector("#errorToastText").textContent'), /Copy failed/);
  assert.equal(await js('document.querySelector("#md").selectionEnd'), await js('document.querySelector("#md").value.length'));
  // Persisted errors notify once when observed, not on each state refresh.
  await js('window.mockState=structuredClone(S);mockState.specError="Background failure";api=async()=>mockState;originalPoll(true)');
  assert.equal(await js('document.querySelector("#errorToastText").textContent'), "Background failure");
  assert.equal(await js('document.querySelector("#errorToast").hidden'), false);
  await click('#closeErrorToast');
  await js('originalPoll(true)');
  assert.equal(await js('document.querySelector("#errorToast").hidden'), true);
  await js('window.originalFetch=fetch;fetch=async()=>new Response(JSON.stringify({error:"not found"}),{status:404})');
  assert.match(await js('originalApi("/api/reread",{}).catch(e=>e.message)'), /Could not reread the map.*Restart the map server/);
  assert.match(await js('originalApi("/api/spec",{}).catch(e=>e.message)'), /could not find this command/);
  await js('fetch=async()=>new Response(JSON.stringify({error:"The Claude Code channel is offline. Open the session with the grill channel and try again."}),{status:409});api=originalApi;poll=async()=>{};listening=false;renderHeader()');
  await click('#bPlay'); await until(()=>js('!resumeSending'));
  assert.match(await js('document.querySelector("#errorToastText").textContent'), /Claude Code channel is offline.*Open the session/);
  assert.equal(await js('listening'), false);
  assert.equal(await js('document.querySelector("#resumeNotice").hidden'), true);
  await js('fetch=async()=>new Response(JSON.stringify({error:"Question missing"}),{status:404})');
  assert.equal(await js('originalApi("/api/question",{}).catch(e=>e.message)'), "Question missing");
  await js('fetch=async()=>{throw new TypeError("Failed to fetch")}');
  assert.match(await js('originalApi("/api/answer",{}).catch(e=>e.message)'), /Could not reach the map server/);
  for(const [status,body,expected] of [
    [403,JSON.stringify({error:"missing x-grill header"}),/Reload the map/],
    [500,JSON.stringify({error:"ENOENT: open private-path"}),/check the file, access permissions/],
    [500,JSON.stringify({error:"TypeError: internal failure"}),/check the server log/],
    [413,"<html>too large</html>",/request is too large/],
    [400,JSON.stringify({error:"Unexpected token in JSON"}),/server rejected the request/],
    [200,"<html>unexpected</html>",/unexpected response/],
    [200,"null",/unexpected response/]
  ]){
    await js(`fetch=async()=>new Response(${JSON.stringify(body)},{status:${status}})`);
    assert.match(await js('originalApi("/api/answer",{}).catch(e=>e.message)'),expected);
  }
  await js('showError("The discussion is too long")');
  assert.match(await js('document.querySelector("#errorToastText").textContent'), /100 messages.*reset the discussion/);
  assert.match(await js('friendlyError("Превью не ответило")'), /5 seconds.*refresh the viewer/);
  assert.equal(await js('friendlyError("Неподдерживаемый формат картинки")'), "Choose a PNG, JPEG, GIF or WebP image.");
  assert.match(await js('friendlyError(S.locale.messages["Git недоступен или операция превью не выполнена"])'), /Ask the agent to check Git/);
  await js('fetch=originalFetch;showError("First timer")');
  assert.equal(await js('errorCountdown.effect.getTiming().duration'), 10000);
  await sleep(5500);
  assert.ok(await js('parseFloat(getComputedStyle(document.querySelector("#closeErrorToast circle")).strokeDashoffset)>40'));
  await js('showError("Replacement timer")');
  await sleep(5000);
  assert.equal(await js('document.querySelector("#errorToast").hidden'), false);
  await until(()=>js('document.querySelector("#errorToast").hidden'));
  await js('showError("Manual dismissal")');await click('#closeErrorToast');
  assert.equal(await js('errorTimer===null&&errorCountdown===null'),true);
  await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  await js('showError("Reduced motion")');
  assert.equal(await js('errorCountdown===null&&errorTimer!==null'),true);
  await click('#closeErrorToast');
  console.log("Completeness browser checks passed");
} finally {
  ws?.close(); await end(browser); await end(server);
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
