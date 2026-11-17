// Real Chromium rendering of production extension pages with a fixture chrome API.
// This does not claim extension installation or real native-host acceptance.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const executable = [process.env.GRILL_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(file => file && fs.existsSync(file));
if (!executable || typeof WebSocket === "undefined") { console.log("SKIP: Chromium and Node 22+ required; no browser acceptance claimed."); process.exit(0); }
const root = fileURLToPath(new URL("../hub/extension/", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grill-hub-extension-browser-"));
const profile = path.join(dir, "profile");
const screenshotDir = process.env.GRILL_HUB_SCREENSHOTS || path.join(dir, "captures"); fs.mkdirSync(screenshotDir, { recursive: true });
const fixture = String.raw`
window.fixture = {fail: false, calls: [], tabs: [], cache: null, chatStatus:"waiting_permission", pending:[{id:42,method:"item/commandExecution/requestApproval",params:{command:"node dev/check.mjs",cwd:"D:\\Projects\\VisualGrilling",reason:"Run project checks"}}]};
const checkedAt=Date.now();
fixture.boards=[
{id:"11111111-1111-4111-8111-111111111111",title:"Реестр досок и Chrome",project:"D:\\Projects\\VisualGrilling",dir:"D:\\Projects\\VisualGrilling\\.grill\\boards-hub",finished:false,counts:{open:4,closed:20},server:"running",agent:"connected",connected:true,provider:"Codex",checkedAt,chatAvailable:true},
{id:"22222222-2222-4222-8222-222222222222",title:"Проверка архитектуры",project:"D:\\Projects\\VisualGrilling",dir:"D:\\Projects\\VisualGrilling\\.grill\\architecture",finished:false,counts:{open:12,closed:7},server:"stopped",agent:"stopped",connected:false,checkedAt},
{id:"33333333-3333-4333-8333-333333333333",title:"Границы API",project:"D:\\Projects\\Atlas",dir:"D:\\Projects\\Atlas\\.grill\\api",finished:true,counts:{open:0,closed:16},server:"running",agent:"connected",connected:true,checkedAt},
{id:"44444444-4444-4444-8444-444444444444",title:"Проверка архитектуры",project:"D:\\Projects\\Archive",dir:"D:\\Projects\\Archive\\.grill\\architecture",finished:false,counts:{open:5,closed:9},missing:true,stale:true,server:"unknown",agent:"unknown",connected:false,checkedAt:checkedAt-3600000},
{id:"55555555-5555-4555-8555-555555555555",title:"<unsafe> Нужны разрешения",project:"D:\\Projects\\Atlas",dir:"D:\\Projects\\Atlas\\.grill\\permissions",finished:false,counts:{open:3,closed:6},server:"running",agent:"waiting_permission",connected:false,connection:"unconfirmed",checkedAt,chatAvailable:true}];
window.chrome={storage:{local:{get:async()=>({boardsCache:fixture.cache}),set:async data=>{fixture.cache=data.boardsCache;}}},tabs:{create:async value=>fixture.tabs.push(value)},runtime:{sendMessage:async message=>{
fixture.calls.push(message); if(fixture.fail)return {ok:false,error:{code:"UNAVAILABLE",message:"Локальный компонент недоступен. Повторите запуск."}};
let result={};const board=fixture.boards.find(board=>board.id===message.params.boardId);
if(message.method==="list")result={boards:fixture.boards,checkedAt:Date.now(),stale:false};
if(message.method==="open")result={url:"http://127.0.0.1:12345/",board};
if(message.method==="play"){board.server="running";board.agent="waiting_login";result={board};}
if(message.method==="stop"){board.server="stopped";board.agent="stopped";board.connected=false;result={board};}
if(message.method==="rebind")return {ok:false,error:{code:"IDENTITY_MISMATCH",message:"ID доски в выбранной папке не совпадает."}};
if(message.method==="chat")result={data:[{id:"turn1",items:[{type:"userMessage",content:[{type:"text",text:"Проверь проект"}]},{type:"agentMessage",text:"Нужно выполнить проверку. <unsafe>"}]}],nextCursor:null,state:{status:fixture.chatStatus,threadId:"fixture-thread",requests:fixture.pending}};
if(message.method==="approval"){fixture.pending=[];fixture.chatStatus="idle";}
if(message.method==="sendChat")fixture.chatStatus="working";
if(message.method==="login")result={type:"chatgpt",authUrl:"https://auth.openai.com/fixture"};
return {ok:true,result};}}};
`;
const server = http.createServer((req, res) => {
  const filename = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  if (!/^(index|chat)\.(html|js)$|^(common\.js|styles\.css)$/.test(filename)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", filename.endsWith("html") ? "text/html; charset=utf-8" : filename.endsWith("css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
  res.end(fs.readFileSync(path.join(root, filename)));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}/`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, ws, sequence = 0;
const pending = new Map();
async function until(fn) { for (let i = 0; i < 150; i++) { const value = await fn(); if (value) return value; await sleep(100); } throw new Error("Timed out"); }
function cdp(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
async function js(expression) { const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const input = (selector, value) => js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.value=${JSON.stringify(value)};node.dispatchEvent(new Event("input",{bubbles:true}));})()`);
async function capture(name, width, height) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  assert.equal(await js("document.documentElement.scrollWidth <= innerWidth"), true, name + " overflow");
  const result = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(screenshotDir, name + ".png"), Buffer.from(result.data, "base64"));
}
try {
  browser = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { windowsHide: true, stdio: "ignore" });
  const port = await until(() => { try { return Number(fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); } catch { return false; } });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  ws.addEventListener("message", event => { const message = JSON.parse(event.data), request = pending.get(message.id); if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result); } });
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  ws.addEventListener("message", event => { const message = JSON.parse(event.data); if (message.method === "Runtime.exceptionThrown") console.error(JSON.stringify(message.params.exceptionDetails)); });
  const injection = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: fixture });
  await cdp("Page.navigate", { url: origin });
  try { await until(() => js("document.querySelectorAll('.board').length===5")); }
  catch (error) { console.error(await js("({body:document.body.innerText,fixture:window.fixture,c:typeof chrome.runtime})")); throw error; }
  assert.equal(await js("document.querySelector('unsafe')"), null);
  assert.equal(await js("document.querySelector('[data-board-id^=\"5555\"]').textContent.includes('подключение не подтверждено')"), true);
  await capture("boards-wide", 1280, 1000); await capture("boards-narrow", 390, 844);
  await input("#search", "Нужны разрешения");
  await capture("connection-unconfirmed-wide", 1280, 1000); await capture("connection-unconfirmed-narrow", 390, 844);
  await input("#search", "");
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await capture("boards-light", 1280, 1000);
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await click("#active"); assert.equal(await js("document.querySelectorAll('.board').length"), 4);
  assert.equal(await js("!!document.querySelector('[data-board-id^=\"2222\"]')"), true, "stopped unfinished included");
  assert.equal(await js("!!document.querySelector('[data-board-id^=\"3333\"]')"), false, "finished running excluded");
  await input("#search", "Проверка архитектуры"); assert.equal(await js("document.querySelectorAll('.project').length"), 2);
  await click("#group"); assert.equal(await js("document.querySelectorAll('.project').length"), 1);
  await input("#search", ""); await click("#group");
  await js("document.querySelector('[data-board-id^=\"1111\"] button').click()"); await until(() => js("fixture.tabs.length===1"));
  assert.equal(await js("fixture.calls.filter(call=>call.method==='play').length"), 0, "open never starts");
  await js("[...document.querySelector('[data-board-id^=\"2222\"]').querySelectorAll('button')].find(button=>button.textContent==='Play').click()");
  await until(() => js("document.querySelector('[data-board-id^=\"2222\"]').textContent.includes('нужен вход')"));
  await js("[...document.querySelector('[data-board-id^=\"2222\"]').querySelectorAll('button')].find(button=>button.textContent==='Stop').click()");
  await until(() => js("document.querySelector('[data-board-id^=\"2222\"]').textContent.includes('Остановка выполнена')"));
  await click(".rebind summary"); await input(".rebind input", "D:\\New\\.grill\\architecture");
  await js("document.querySelector('.rebind form').requestSubmit()");
  await until(() => js("document.querySelector('[data-board-id^=\"4444\"]').textContent.includes('ID доски')"));
  assert.equal(await js("document.querySelector('.rebind input').value"), "D:\\New\\.grill\\architecture");
  assert.equal(await js("document.querySelector('[data-board-id^=\"4444\"]').textContent.includes('Папка не найдена')"), true);
  await js("fixture.fail=true"); await click("#refresh"); await until(() => js("!document.querySelector('#error').hidden"));
  assert.equal(await js("document.querySelectorAll('.board').length"), 4); assert.ok(await js("document.querySelector('#freshness').textContent.includes('устарели')"));
  await capture("boards-stale", 1280, 1000);
  await cdp("Page.navigate", { url: origin + "chat.html?boardId=11111111-1111-4111-8111-111111111111" }); await until(() => js("document.querySelector('.pending-request')!==null"));
  await capture("chat-approval", 1100, 850);
  await js("[...document.querySelectorAll('#requests button')].find(button=>button.textContent==='Разрешить один раз').click()"); await until(() => js("fixture.pending.length===0"));
  assert.deepEqual(await js("fixture.calls.find(call=>call.method==='approval').params.response"), { decision: "accept" });
  await js("fixture.pending=[{id:44,method:'item/permissions/requestApproval',params:{permissions:{network:{enabled:true},fileSystem:null}}}];fixture.chatStatus='waiting_permission'"); await click("#refresh");
  await until(() => js("[...document.querySelectorAll('#requests button')].some(button=>button.textContent==='Разрешить на этот ход')"));
  await js("[...document.querySelectorAll('#requests button')].find(button=>button.textContent==='Разрешить на этот ход').click()"); await until(() => js("fixture.pending.length===0"));
  assert.deepEqual(await js("fixture.calls.filter(call=>call.method==='approval').at(-1).params.response"), { permissions: { network: { enabled: true } }, scope: "turn" });
  await js("fixture.pending=[{id:43,method:'item/tool/requestUserInput',params:{questions:[{id:'choice',question:'Как продолжить?',options:[{label:'Проверить',description:'Выполнить проверки'}]}]}}];fixture.chatStatus='waiting_input'"); await click("#refresh"); await until(() => js("document.querySelector('#requests input')!==null"));
  await input("#requests input", "Проверить"); await js("document.querySelector('#requests form').requestSubmit()"); await until(() => js("fixture.pending.length===0"));
  assert.deepEqual(await js("fixture.calls.filter(call=>call.method==='approval').at(-1).params.response"), { answers: { choice: { answers: ["Проверить"] } } });
  await until(() => js("!document.querySelector('#send').disabled")); await input("#message", "Продолжай"); await js("document.querySelector('#composer').requestSubmit()"); await until(() => js("fixture.calls.some(call=>call.method==='sendChat')"));
  await js("fixture.chatStatus='waiting_login'"); await click("#refresh"); await until(() => js("document.querySelector('#login button')!==null")); await click("#login button"); await until(() => js("document.querySelector('#login a')!==null"));
  assert.equal(await js("document.querySelector('#login a').href"), "https://auth.openai.com/fixture");
  await capture("chat-narrow", 390, 844);
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: fixture + "fixture.fail=true;" });
  await cdp("Page.navigate", { url: origin }); await until(() => js("document.querySelector('#error')&&!document.querySelector('#error').hidden"));
  assert.equal(await js("document.querySelectorAll('.board').length"), 0);
  assert.ok(await js("document.querySelector('#boards').textContent.includes('Список пока недоступен')"));
  assert.equal(await js("document.querySelector('#boards').textContent.includes('В реестре пока нет досок')"), false);
  await capture("boards-no-cache", 1100, 800);
  console.log("Hub extension browser PASS: production-page fixture rendering; filters, counts, commands, recovery, stale/no-cache, chat/approval/input/login, safe text and narrow layout. Native Chrome installation NOT exercised.");
  console.log("Captures: " + screenshotDir);
} finally {
  ws?.close(); if (browser && browser.exitCode === null) { const ended = new Promise(resolve => browser.once("exit", resolve)); browser.kill(); await ended; }
  await new Promise(resolve => server.close(resolve));
}
