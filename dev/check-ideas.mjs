import { contextCards, focusCard } from "./context-fixture.mjs";
import { knowledgeFixture } from "./knowledge-fixture.mjs";
// Exercise attached ideas, frozen evaluations and editing races in a disposable project.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { locale, page } from "../skills/grill/i18n.mjs";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-ideas-")), dir = path.join(cwd, "maps");
let server, url;
async function start() {
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--name", "check", "--port", "0"], { cwd, windowsHide: true, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(dir, "check", "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("Server did not start");
}
const api = knowledgeFixture(rawRequest);
async function rawRequest(route, body, expected = 200) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, expected, await r.clone().text());
  return route === "report" ? r.text() : r.json();
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const ended = new Promise(r => server.once("exit", r)); await api("stop", {}); await ended;
}
let delivered;
const state = () => api("state"), wait = async () => { if (delivered) { const e = delivered; delivered = null; return e; } return api("wait?timeout=5"); };
const node = async id => (await state()).nodes.find(n => n.id === id);
const result = (e, extra = {}, expected = 200) => api("apply", { type: "idea", id: e.id, token: e.token, capturedForSpec: e.capturedForSpec, status: "ok", verdict: "Evidence checked", ...extra }, expected);
const audit = e => contextCards(e).filter(n => n.kind === "q" && n.parentId === e.id).map(n => ({ id: n.id, action: "keep", reason: "Still relevant" }));
let seq = 0;
const attach = async text => { await api("idea", { id: "idea-" + ++seq, actionId: "attach-" + seq, text }); delivered = await api("wait?timeout=5"); return delivered.id; };
const analyze = async id => { await api("idea/analyze", { id }); const e = await wait(); assert.equal(e.type, "idea"); assert.equal(e.id, id); return e; };
const edit = async (id, text) => api("idea/edit", { id, text, revision: (await node(id)).revision });

try {
  await start();
  await api("init", { title: "Ideas", questions: [{ q: "Independent question", options: ["A", "B"] }] });
  const independent = (await state()).nodes.find(n => n.kind === "q");
  assert.equal((await fetch(url + "api/idea", { method: "POST" })).status, 403);
  await api("idea", { id: "empty", text: " " }, 400);
  await api("idea", { id: "large", text: "a".repeat(3001) }, 400);
  const id = await attach("<script>idea</script> " + "Long idea ".repeat(35));
  assert.equal((await state()).currentWork.type, "idea");
  assert.equal((await node(id)).analysis.stage, "thinking");
  assert.equal((await api("idea", { id: "idea-1", actionId: "attach-1", text: (await node(id)).text })).actionId, "attach-1");
  await api("idea", { id: "idea-1", actionId: "attach-1", text: "Different" }, 409);
  const initial = await wait(); assert.equal(initial.type, "idea"); assert.equal(initial.id, id);
  await result(initial, { status: "open" });
  await api("reread", {}); const reread = await wait();
  await api("apply", { type: "reread", token: reread.token, brief: "Unrelated brief correction", audit: contextCards(reread).map(n => ({ id: n.id, action: "keep", reason: "Still valid" })) });
  assert.equal((await node(id)).analysis.stage, "queued", "A changed reread reassesses the automatically analyzed attachment");
  const afterReread = await wait(); assert.equal(afterReread.type, "idea");
  await result(afterReread, { status: "open" });
  assert.equal((await state()).queueLength, 0);
  await api("answer", { id, answer: "Cannot grade an idea as a question" }, 404);
  await api("discuss", { id, message: "Keep this chat" });
  let e = await wait(); assert.equal(e.scope, "idea"); assert.equal(e.question, (await node(id)).text);
  await api("apply", { type: "discuss", id, token: e.token, reply: "Discussion only" });
  assert.equal((await node(id)).status, "open");
  e = await analyze(id);
  const deletion = await api("idea/delete", { id, confirm: true });
  const plan = await api("actions/cancel", { id: deletion.actionId });
  await api("actions/cancel", { id: deletion.actionId, confirmation: plan.confirmation });
  await result(e, { children: [{ q: "Needed evidence?", options: ["A", "B"] }] }, 400);
  await result(e, { status: "open", children: [{ q: "Needed evidence?", options: ["A", "B"] }] });
  await result(e);
  const child = (await state()).nodes.find(n => n.parentId === id);
  assert.deepEqual(await node(independent.id), independent);
  await api("answer", { id: child.id, answer: "Measured 50 trials" });
  await api("spec", {});
  e = await wait(); assert.equal(e.type, "answer"); assert.equal(!!e.capturedForSpec, false);
  assert.equal(e.context.focus.find(n => n.id === id).kind, "idea"); assert.equal(e.context.focus.find(n => n.id === id).text, (await node(id)).text);
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "verify", verdict: "Needs replication" });
  const frozen = await wait(); assert.equal(frozen.type, "idea"); assert.equal(!!frozen.capturedForSpec, false);
  await stop(); await start(); await result(frozen, {}, 409);
  e = await wait(); assert.equal(!!e.capturedForSpec, false); assert.notEqual(e.token, frozen.token);
  await result(e);
  e = await wait(); assert.equal(e.type, "spec");
  assert.equal(e.nodes.find(n => n.id === id).status, "ok");
  assert.equal(e.nodes.find(n => n.id === child.id).status, "verify");
  await api("apply", { type: "spec", token: e.token, markdown: "# Frozen plan" });
  assert.equal((await node(id)).status, "ok");
  assert.equal((await node(id)).chat.length, 2);

  // Every non-ok idea excludes its whole subtree, never an unrelated question.
  for (const status of ["open", "weak", "gap", "verify", "ok"]) {
    e = await analyze(id); await result(e, { status }); await api("spec", {});
    e = await wait(); assert.equal(e.type, "spec");
    assert.equal(e.nodes.some(n => n.id === id), status === "ok");
    assert.equal(e.nodes.some(n => n.id === child.id), status === "ok");
    assert.ok(e.nodes.some(n => n.id === independent.id));
    await api("apply", { type: "spec", token: e.token, markdown: "# " + status });
  }
  // Later commands leave the active conclusion valid and execute in FIFO order.
  e = await analyze(id);
  await api("idea", { id: "unrelated", text: "Unrelated new context" });
  await result(e); e = await wait(); assert.equal(e.type, "idea"); await result(e);
  const old = await analyze(id); await edit(id, "Revised idea"); await result(old);
  e = await wait(); assert.equal(e.reason, "edit"); await result(e, {}, 400);
  await result(e, { audit: audit(e) }); assert.equal((await node(id)).chat.length, 2);
  assert.equal((await node(child.id)).answer, "Measured 50 trials");
  const stale = await api("idea/edit", { id, text: "stale tab", revision: 1 });
  await wait();
  assert.equal((await api("actions?id=" + stale.actionId)).actions[0].status, "failed");
  await api("spec", {}); const oldSpec = await wait(); assert.equal(oldSpec.type, "spec");
  await edit(id, "Latest idea");
  await api("apply", { type: "spec", token: oldSpec.token, markdown: "# earlier snapshot" });
  await stop(); await start();
  e = await wait(); assert.equal(e.type, "idea"); assert.equal(focusCard(e).text, "Latest idea");
  await result(e, { audit: audit(e) });
  await api("spec", {});
  e = await wait(); assert.equal(e.type, "spec"); assert.equal(e.nodes.find(n => n.id === id).text, "Latest idea");
  await api("apply", { type: "spec", token: e.token, markdown: "# latest" });
  await api("idea/analyze", { id }); await api("spec", {});
  e = await wait(); assert.equal(!!e.capturedForSpec, false);
  await api("answer", { id: independent.id, answer: "Later unrelated answer" });
  await result(e); const spec = await wait(); assert.equal(spec.type, "spec");
  assert.ok(!spec.nodes.find(n => n.id === independent.id).answer);
  await api("apply", { type: "spec", token: spec.token, markdown: "# isolated" });
  e = await wait(); assert.equal(e.type, "answer");
  await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Accepted" });
  assert.equal((await node(independent.id)).answer, "Later unrelated answer");

  // Browser renderers preserve full text/history and escape idea content.
  const ui = fs.readFileSync(new URL("../skills/grill/ui.html", import.meta.url), "utf8");
  for (const language of ["ru", "en"]) new vm.Script(page(ui, locale({ language })).match(/<script>([\s\S]*?)<\/script>/)[1]);
  const nodes = (await state()).nodes;
  nodes.find(n => n.id === id).text = "<script>untrusted</script>";
  const ctx = vm.createContext({ $: () => ({ addEventListener() {} }), S: { nodes }, STATUS: { ok: "Closed", open: "Open", verify: "Verify" }, ORDER: [], counts: () => ({}), kids: id => nodes.filter(n => n.parentId === id), esc: s => String(s).replaceAll("<", "&lt;").replaceAll(">", "&gt;"), qs: () => [], vis: n => n.status });
  vm.runInContext(ui.slice(ui.indexOf("const ideaStatus="), ui.indexOf("function render(){")), ctx);
  assert.match(vm.runInContext(`nodeHTML(S.nodes.find(n=>n.id==="${id}"))`, ctx), /&lt;script&gt;/);
  vm.runInContext(ui.slice(ui.indexOf("function toMarkdown(){"), ui.indexOf("function summaryPanel(){")), ctx);
  assert.match(vm.runInContext("toMarkdown()", ctx), /Keep this chat/);
  assert.match(await api("report"), /Latest idea/); assert.match(await api("report"), /Keep this chat/);
  await api("idea/delete", { id }, 400);
  await api("idea/delete", { id, confirm: true });
  assert.ok(!await node(id)); assert.ok(!await node(child.id)); assert.ok(await node(independent.id));
  await stop(); await start(); assert.ok(!await node(id));
  console.log("Attached idea checks passed");
} finally {
  await stop();
  fs.rmSync(cwd, { recursive: true, force: true });
}
