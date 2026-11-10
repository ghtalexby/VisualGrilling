import { knowledgeFixture } from "./knowledge-fixture.mjs";
// Exercise UI protocol extensions against a real server in a disposable project.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-ui-api-"));
const dir = path.join(cwd, "maps"), map = path.join(dir, "check");
let server, url;
async function start() {
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--name", "check", "--port", "0"], { cwd, windowsHide: true, stdio: "ignore", env: { ...process.env, GRILL_DOUBLE_CLICK_MS: "900" } });
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(map, "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("Server did not start");
}
const request = knowledgeFixture(rawRequest);
async function rawRequest(route, body, expected = 200) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, expected, await r.clone().text());
  return r.json();
}
const state = () => request("state");
async function wait() {
  for (;;) {
    const e = await request("wait?timeout=5");
    if (e.type !== "reevaluate") return e;
    await request("apply", { type: "reevaluate", token: e.token, capturedForSpec: e.capturedForSpec,
      assessments: e.ids.map(id => { const n = e.nodes.find(n => n.id === id); return { id, status: n.status, verdict: n.verdict }; }) });
  }
}
const grade = (e, extra = {}, expected = 200) => request("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Checked", ...extra }, expected);
const discuss = (e, expected = 200) => request("apply", { type: "discuss", id: e.id, token: e.token, reply: "Explanation" }, expected);
async function stop() {
  if (!server || server.exitCode !== null) return;
  const ended = new Promise(r => server.once("exit", r));
  await request("stop", {}); await ended;
}
const options = ["A", "B"], recommendation = { option: "B", reason: "Project evidence" };
try {
  const ui = fs.readFileSync(new URL("../skills/grill/ui.html", import.meta.url), "utf8");
  // A continued map retains finished:true; its connected header must allow another finish.
  const controls = {}, headerState = { finished: true, nodes: [{ kind: "q" }] };
  const headerContext = vm.createContext({
    S: headerState, loaded: true, listening: true, offline: false, panel: null, rereadSending: false, resumeSending: false,
    showObsolete: false, coverageText: () => "", qs: () => headerState.nodes, counts: () => ({}), ORDER: [], document: {},
    $: selector => controls[selector] ||= { classList: { toggle() {} }, setAttribute(key, value) { this[key] = value; } }
  });
  const headerCode = ui.match(/function renderHeader\(\)\{[\s\S]*?\n\}/)[0] + "\nrenderHeader();";
  vm.runInContext(headerCode, headerContext);
  assert.equal(controls["#bStop"].disabled, false); assert.notEqual(controls["#bStop"].hidden, true);
  const stopLabel = controls["#bStop"]["aria-label"];
  headerState.finishPending = true; vm.runInContext(headerCode, headerContext);
  assert.equal(controls["#bStop"].disabled, true); assert.notEqual(controls["#bStop"]["aria-label"], stopLabel);

  // Historical cards retain readable answers but are not answerable or selected as active work.
  const oldCard = { id: "old", parentId: "root", kind: "q", prio: 1, area: "Lifecycle", q: "Old status?", status: "open", answer: "Old answer", obsolete: { reason: "Removed <script>status</script>", sources: [{ id: "new", q: "Decision" }] } };
  const newCard = { id: "new", parentId: "old", kind: "q", area: "Lifecycle", q: "Current detail?", status: "open" };
  const historicalState = { title: "History", nodes: [oldCard, newCard] };
  const historicalContext = vm.createContext({
    copyButton: () => "", S: historicalState, panel: { tab: "answer" }, errMsg: null,
    qs: () => historicalState.nodes, kids: id => historicalState.nodes.filter(n => n.parentId === id),
    get: id => historicalState.nodes.find(n => n.id === id), ancestors: () => [], rootPrio: () => 1, depth: () => 1,
    esc: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    STATUS: { open: "Открыт" }, ORDER: ["open"], node: oldCard
  });
  for (const name of ["counts", "nextOpen", "nodePanel", "toMarkdown"]) {
    const start = ui.indexOf("function " + name + "("), end = ui.indexOf("\nfunction ", start + 1);
    vm.runInContext(ui.slice(start, end), historicalContext);
  }
  assert.equal(vm.runInContext("counts().open", historicalContext), 1);
  assert.equal(vm.runInContext("nextOpen().id", historicalContext), "new");
  const historicalPanel = vm.runInContext("nodePanel(node).body", historicalContext);
  assert.match(historicalPanel, /Устарело/); assert.match(historicalPanel, /Old answer/);
  assert.match(historicalPanel, /&lt;script&gt;/); assert.doesNotMatch(historicalPanel, /<script>|id="fAns"|data-act="answer"/);
  assert.match(vm.runInContext("toMarkdown()", historicalContext), /Устарело: Removed/);

  // Removed attachments release completed blob URLs; late fetches cannot recreate them.
  const imgUrls = {}, imageState = { nodes: [{ chat: [{ images: ["kept.png", "removed.png", "late.png"] }] }] };
  let resolveImage, urlCount = 0;
  const revoked = [];
  const imageContext = vm.createContext({
    imgUrls, S: imageState,
    fetch: async route => ({ ok: true, blob: () => route.endsWith("late.png") ? new Promise(resolve => { resolveImage = resolve; }) : {} }),
    URL: { createObjectURL: () => "blob:" + ++urlCount, revokeObjectURL: u => revoked.push(u) }
  });
  vm.runInContext(ui.slice(ui.indexOf("function imgUrl("), ui.indexOf("/* grow the input")), imageContext);
  const keptUrl = await vm.runInContext('imgUrl("kept.png")', imageContext);
  const removedUrl = await vm.runInContext('imgUrl("removed.png")', imageContext);
  const late = vm.runInContext('imgUrl("late.png")', imageContext);
  await Promise.resolve();
  imageState.nodes[0].chat[0].images = ["kept.png"];
  vm.runInContext("pruneImgUrls();", imageContext); await Promise.resolve();
  assert.deepEqual(revoked, [removedUrl]); assert.deepEqual(Object.keys(imgUrls), ["kept.png"]);
  resolveImage({}); assert.equal(await late, null); assert.equal(urlCount, 2);
  assert.equal(await vm.runInContext('imgUrl("kept.png")', imageContext), keptUrl); assert.equal(urlCount, 2);
  imageState.nodes = []; vm.runInContext("pruneImgUrls();", imageContext); await Promise.resolve();
  assert.deepEqual(revoked, [removedUrl, keptUrl]); assert.deepEqual(Object.keys(imgUrls), []);

  // Exercise desktop selection without changing the machine's mouse preferences.
  const timingCode = fs.readFileSync(cli, "utf8").match(/async function doubleClickTime\(\) \{[\s\S]*?\n\}/)[0];
  for (const [desktop, expected, calls] of [["KDE", 5000, 0], ["XFCE", 5000, 0], ["ubuntu:GNOME", 400, 1]]) {
    let queried = 0;
    const interval = await vm.runInNewContext(timingCode + "\ndoubleClickTime();", {
      process: { platform: "linux", env: { XDG_CURRENT_DESKTOP: desktop } }, execFile: null,
      promisify: () => async () => { queried++; return { stdout: "400\n" }; }
    });
    assert.equal(interval, expected); assert.equal(queried, calls);
  }
  await start();
  assert.match(await (await fetch(url)).text(), /PAGE_DOUBLE_CLICK_MS = 1000/);
  assert.equal((await fetch(url + "api/question", { method: "POST" })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = http.get(url + "api/state", { headers: { host: "evil.example", "x-grill": "1" } }, r => { r.resume(); resolve(r.statusCode); }); req.on("error", reject);
  });
  assert.equal(hostStatus, 403);
  await request("init", { questions: [{ q: "Main", options, recommendation }, { q: "Other" }] });
  const [main, other] = (await state()).nodes.filter(n => n.kind === "q");
  assert.deepEqual(main.recommendation, recommendation);
  assert.equal(other.recommendation, null);
  await request("init", { questions: [{ q: "Bad", options, recommendation: { option: "C", reason: "Invalid" } }] }, 400);
  assert.ok((await state()).nodes.some(n => n.id === main.id));

  await request("discuss", { id: "root", message: "Explain the project" });
  let e = await wait(); assert.equal(e.scope, "project"); assert.equal(e.priority, null);
  await discuss(e); assert.equal((await state()).nodes.find(n => n.id === "root").status, undefined);
  await request("chatreset", { id: "root" });

  // Pasted images: validated by signature, stored in the map, delivered as paths, removed with their chat.
  const png = "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(16)]).toString("base64");
  const stored = () => { try { return fs.readdirSync(path.join(map, "images")); } catch { return []; } };
  await request("discuss", { id: "root", images: ["data:image/svg+xml;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64")] }, 400);
  await request("discuss", { id: "root", images: "x" }, 400);
  await request("discuss", { id: "root", images: [png, png, png, png, png] }, 400);
  await request("discuss", { id: "root", images: ["data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(8 * 1024 * 1024)]).toString("base64")] }, 400);
  assert.deepEqual(stored(), []);
  await request("discuss", { id: "root", images: [png] });
  let [picture] = (await state()).nodes.find(n => n.id === "root").chat[0].images;
  assert.match(picture, /^[0-9a-f-]{36}\.png$/);
  assert.equal((await fetch(url + "api/image?file=" + picture)).status, 403);
  const served = await fetch(url + "api/image?file=" + picture, { headers: { "x-grill": "1" } });
  assert.equal(served.headers.get("content-type"), "image/png"); assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await served.arrayBuffer()).byteLength, 24);
  for (const bad of ["..%2Fstate.json", "..%5Cstate.json", "state.json", "00000000-0000-0000-0000-000000000000.png"])
    assert.equal((await fetch(url + "api/image?file=" + bad, { headers: { "x-grill": "1" } })).status, 404);
  e = await wait();
  assert.equal(e.message, ""); assert.deepEqual(e.images, [path.join(map, "images", picture)]); assert.ok(fs.existsSync(e.images[0]));
  await discuss(e);
  await request("discuss", { id: "root", message: "Follow-up" });
  e = await wait();
  assert.deepEqual(e.images, []); assert.deepEqual(e.history[0].images, [path.join(map, "images", picture)]);
  await discuss(e);
  await stop(); await start();
  assert.deepEqual(stored(), [picture]);
  fs.writeFileSync(path.join(map, "images", "11111111-1111-1111-1111-111111111111.png"), "orphan");
  fs.writeFileSync(path.join(map, "images", "11111111-1111-1111-1111-111111111111.png.interrupted.tmp"), "partial");
  await request("chatreset", { id: "root" });
  assert.deepEqual(stored(), []);
  // A long Cyrillic message must survive being split across network chunks.
  const long = "щ".repeat(2000);
  await request("discuss", { id: "root", message: long, images: ["data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(1024 * 1024)]).toString("base64")] });
  e = await wait(); assert.equal(e.message, long); await discuss(e);
  await request("chatreset", { id: "root" });

  const custom = { id: "custom-main", parentId: "root", q: "User main?" };
  await request("question", custom); await request("question", custom);
  assert.equal((await state()).queueLength, 1);
  await request("question", { ...custom, q: "Different" }, 409);
  e = await wait(); const staleQuestion = e;
  await stop(); await start();
  await request("apply", { type: "question", id: e.id, token: e.token, question: { options } }, 409);
  e = await wait(); assert.equal(e.type, "question"); assert.notEqual(e.token, staleQuestion.token);
  await request("apply", { type: "question", id: e.id, token: e.token, question: { options: ["only one"] } }, 400);
  const created = await request("apply", { type: "question", id: e.id, token: e.token, question: { options, recommendation, area: "Product" } });
  await request("question", custom);
  assert.equal((await state()).nodes.filter(n => n.requestId === custom.id).length, 1);
  assert.equal((await state()).nodes.find(n => n.id === created.id).prio, 3);
  await request("question", { id: "custom-child", parentId: main.id, q: "User child?" });
  e = await wait();
  await request("answer", { id: main.id, answer: "New parent context" });
  await request("apply", { type: "question", id: e.id, token: e.token, question: { options } }, 409);
  e = await wait(); assert.equal(e.type, "question");
  const child = await request("apply", { type: "question", id: e.id, token: e.token, question: { options } });
  e = await wait(); assert.equal(e.type, "answer");
  await grade(e, { children: [{ q: "Automatic child", options, recommendation }] });
  const auto = (await state()).nodes.find(n => n.q === "Automatic child");
  await request("answer", { id: child.id, answer: "Keep this answer" }); await grade(await wait());
  await request("discuss", { id: child.id, message: "Keep this discussion" }); await discuss(await wait());
  await request("answer", { id: auto.id, answer: "Queued child answer" });
  await request("answer", { id: main.id, answer: "Revise the parent" });
  // Grade the queued child first, then inspect the full mixed branch.
  await grade(await wait()); e = await wait();
  assert.ok(e.branchSnapshot.some(n => n.id === child.id && n.createdBy === "user" && n.chat.length === 2));
  const before = (await state()).nodes;
  await grade(e, { branchChanges: { move: [{ id: child.id, parentId: other.id }] } }, 400);
  await grade(e, { branchChanges: { move: [{ id: child.id, parentId: auto.id }, { id: auto.id, parentId: child.id }] } }, 400);
  await grade(e, { children: [{ q: "Bad", options, recommendation: { option: "C", reason: "No" } }] }, 400);
  assert.deepEqual((await state()).nodes, before);
  await grade(e, { branchChanges: { move: [{ id: child.id, parentId: "$new" }], remove: [auto.id], add: [{ key: "$new", parentId: main.id, q: "Relevant grouping", options }] } });
  let kept = (await state()).nodes.find(n => n.id === child.id);
  assert.equal(kept.answer, "Keep this answer"); assert.equal(kept.chat.length, 2);
  assert.equal((await state()).nodes.find(n => n.id === kept.parentId).q, "Relevant grouping");
  await request("answer", { id: main.id, answer: "Preserve by default" }); e = await wait(); await grade(e);
  assert.ok((await state()).nodes.some(n => n.id === child.id));

  // A concurrent browser message invalidates an answer result; delivery rotates tokens.
  await request("answer", { id: main.id, answer: "Concurrent edit" }); e = await wait();
  await request("discuss", { id: child.id, message: "Late activity" });
  await grade(e, {}, 409);
  const newer = await wait(); assert.equal(newer.type, "answer");
  await grade(e, {}, 409); await grade(newer);
  e = await wait(); assert.equal(e.type, "discuss");
  const newerDiscussion = await wait(); await discuss(e, 409); await discuss(newerDiscussion);

  // Explicit deletion must rescue every retained child; failed transactions stay atomic.
  kept = (await state()).nodes.find(n => n.id === child.id);
  const grouping = kept.parentId;
  await request("answer", { id: child.id, answer: "Captured child grade" });
  await request("answer", { id: main.id, answer: "Captured parent grade" });
  await request("spec", {});
  await request("discuss", { id: child.id, message: "Discussion after capture" });
  e = await wait(); assert.equal(e.id, child.id); assert.equal(e.capturedForSpec, true);
  assert.ok(!JSON.stringify(e.branchSnapshot).includes("Discussion after capture"));
  await grade(e);
  await request("answer", { id: child.id, answer: "Answer after capture" });
  e = await wait(); assert.equal(e.id, main.id);
  assert.ok(!JSON.stringify(e.branchSnapshot).includes("Answer after capture"));
  assert.ok(e.protectedIds.includes(child.id));
  await grade(e, { branchChanges: { remove: [grouping] } }, 400);
  await grade(e, { branchChanges: { remove: [child.id] } }, 409);
  await grade(e, { branchChanges: { remove: [grouping], move: [{ id: child.id, parentId: main.id }] } });
  e = await wait(); assert.equal(e.type, "spec");
  assert.equal(e.nodes.find(n => n.id === child.id).answer, "Captured child grade");
  assert.equal(e.nodes.find(n => n.id === child.id).parentId, main.id);
  assert.ok(!e.nodes.some(n => n.id === grouping || n.chat || n.discuss));
  assert.ok(!JSON.stringify(e.nodes).includes("Answer after capture"));
  await request("apply", { type: "spec", token: e.token, markdown: "# Captured implementation" });
  await request("apply", { type: "spec", token: e.token, markdown: "# Repeated" }, 409);
  e = await wait(); assert.equal(e.answer, "Answer after capture"); await grade(e);
  e = await wait(); assert.equal(e.type, "discuss"); assert.equal(e.pendingAnswer, null); await discuss(e);

  // Client request IDs and node IDs occupy separate queue namespaces.
  await request("answer", { id: main.id, answer: "Remove a descendant" });
  await request("question", { id: child.id, parentId: "root", q: "Unrelated custom request" });
  e = await wait(); assert.equal(e.type, "answer");
  await grade(e, { branchChanges: { remove: [child.id] } });
  // The custom question, queued reread and internal parent reassessment.
  assert.equal((await state()).queueLength, 3);
  e = await wait(); assert.equal(e.type, "question"); assert.equal(e.id, child.id);
  await request("apply", { type: "question", id: e.id, token: e.token, question: { options } });
  e = await wait(); assert.equal(e.type, "reread");
  await request("apply", { type: "reread", token: e.token, audit: e.nodes.map(n => ({ id: n.id, action: "keep", reason: "Transport fixture review" })), summary: "Nothing to change" });

  await request("more", {}); await request("more", {});
  assert.equal((await state()).queueLength, 2); await wait();
  await request("apply", { type: "more", questions: [{ q: "More", options, recommendation }] });
  assert.deepEqual((await state()).nodes.find(n => n.q === "More").recommendation, recommendation);
  await request("finish", {}); assert.equal((await wait()).type, "finish");
  await request("apply", { type: "finish", summary: "Done" });
  console.log("UI protocol checks passed: " + cwd);
} finally { await stop(); }
