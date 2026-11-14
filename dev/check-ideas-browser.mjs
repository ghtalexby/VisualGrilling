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
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-ideas-browser-")), dir = path.join(cwd, "maps"), profile = path.join(cwd, "browser");
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
  await menu("root"); await click('[data-ctx="attachidea"]');
  const text = "<script>window.injected=true</script> " + "A full idea. ".repeat(30);
  await input("#fIdea", text); await click('[data-act="close"]');
  assert.equal((await api("state")).nodes.length, 2);
  await menu("root"); await click('[data-ctx="attachidea"]'); assert.equal(await js('document.querySelector("#fIdea").value'), text);
  await click('[data-act="attachidea"]'); await until(async () => (await api("state")).actionQueue.slots === 1);
  const initial = await api("wait?timeout=5");
  await until(() => js('S.nodes.some(n=>n.kind==="idea")'));
  const id = (await api("state")).nodes.find(n => n.kind === "idea").id;
  await until(() => js(`panel?.id==="${id}"`));
  assert.equal(await js("window.injected"), undefined);
  assert.equal(await js('document.querySelector("#panel h2").textContent'), text.trim());
  await input("#fMsg", "Discussion draft"); await menu(id); await click('[data-ctx="editidea"]');
  await input("#fIdeaEdit", "Changed idea");
  await js('document.querySelector("#fIdeaEdit").focus();document.querySelector("#fIdeaEdit").setSelectionRange(3,7)');
  await api("apply", { type: "notes", text: "force a poll" }); await js("poll(true)");
  assert.equal(await js('document.querySelector("#fIdeaEdit").value'), "Changed idea");
  assert.equal(await js('document.querySelector("#fMsg").value'), "Discussion draft");
  assert.equal(await js("document.activeElement.id"), "fIdeaEdit"); assert.equal(await js("document.activeElement.selectionStart"), 3);
  await click('[data-act="saveidea"]'); await until(async () => (await api("state")).actionQueue.slots === 1);
  await menu(id); await click('[data-ctx="removeidea"]'); assert.equal(await js('document.querySelector("[data-act=deleteidea]").disabled'), false);
  await click('[data-act="cancelideadelete"]');
  await api("apply", { type: "idea", id, token: initial.token, status: "open", verdict: "Initial" });
  const e = await api("wait?timeout=5"); assert.equal(e.type, "idea");
  await api("apply", { type: "idea", id, token: e.token, capturedForSpec: e.capturedForSpec, status: "open", verdict: "Need evidence", audit: [], children: [{ q: "Idea question", options: ["A", "B"] }] });
  const question = (await api("state")).nodes.find(n => n.parentId === id);
  await api("answer", { id: question.id, answer: "Unknown" }); const answer = await api("wait?timeout=5");
  await api("apply", { type: "answer", id: question.id, token: answer.token, status: "gap", verdict: "Missing evidence" });
  const reevaluation = await api("wait?timeout=5"); await api("apply", { type: "idea", id, token: reevaluation.token, capturedForSpec: reevaluation.capturedForSpec, status: "weak", verdict: "Material weakness" });
  await js("poll(true)"); await click('#ledger [data-flt="gap"]');
  assert.equal(await js(`!!document.querySelector('[data-id="${id}"]')`), true);
  assert.equal(await js(`!!document.querySelector('[data-id="${question.id}"]')`), true);
  assert.equal(await js("counts().gap"), 1); assert.equal(await js("counts().weak"), 1);
  assert.equal(await js(`(()=>{get("${id}").status="gap";render();const old=centerNode;let centered;centerNode=id=>centered=id;focusFilter();centerNode=old;return centered})()`), id);
  await menu(id); await click('[data-ctx="removeidea"]'); await click('[data-act="cancelideadelete"]'); assert.ok((await api("state")).nodes.some(n => n.id === id));
  await api("locale", { language: "ru" }); await cdp("Page.reload"); await until(() => js('typeof loaded!=="undefined"&&loaded&&document.documentElement.lang==="ru"'));
  await menu(id); assert.equal(await js('document.querySelector("[data-ctx=analyzeidea]").textContent'), "Разобрать идею");
  await click('[data-ctx="removeidea"]'); await click('[data-act="deleteidea"]'); await until(() => js(`!get("${id}")`));
  console.log("Attached idea browser checks passed (English and Russian)");
} finally {
  // Close Chromium normally so its profile-owning subprocesses exit on Windows.
  if (ws?.readyState === WebSocket.OPEN) {
    await Promise.race([cdp("Browser.close").catch(() => {}), sleep(2000)]);
    if (browser?.exitCode === null) await Promise.race([new Promise(resolve => browser.once("exit", resolve)), sleep(2000)]);
  }
  ws?.close(); await end(browser); await end(server);
  try { fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
  catch (error) {
    if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
    console.warn(`Browser profile cleanup deferred (${error.code}); retained ${cwd}`);
  }
}
