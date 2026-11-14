import { contextCards, focusCard } from "./context-fixture.mjs";
// Exercise the real CLI in a disposable project, never in a user's map.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const skillRoot = path.dirname(cli);
const instruction = file => fs.readFileSync(path.join(skillRoot, file), "utf8");
const workerRules = instruction("worker.md");
const eventFiles = ["answer", "discuss", "question", "reread", "reevaluate", "idea", "spec", "finish"].map(name => `events/${name}.md`);
for (const file of [...eventFiles, "knowledge.md", "preview-format.md"]) {
  assert.ok(instruction(file).trim(), `Missing rules: ${file}`);
  assert.ok(workerRules.includes(`](${file})`), `Missing worker route: ${file}`);
}
for (const file of ["monitor.md", "dispatcher.md", "parallel-maps.md"]) {
  assert.ok(instruction(file).trim(), `Missing workflow: ${file}`);
  assert.ok(instruction("SKILL.md").includes(`](${file})`), `Missing mode route: ${file}`);
}
const answerInstructionBytes = Buffer.byteLength(workerRules) + Buffer.byteLength(instruction("events/answer.md"));
assert.ok(answerInstructionBytes < 12000, `Answer instructions exceed budget: ${answerInstructionBytes} bytes`);
assert.ok(answerInstructionBytes <= 11000, `Keep at least 1000 bytes of instruction headroom: ${answerInstructionBytes} bytes`);
// Every local Markdown link in the split instruction package must resolve.
for (const file of ["SKILL.md", "worker.md", "knowledge.md", "preview-format.md", "monitor.md", "dispatcher.md", "parallel-maps.md", ...eventFiles]) {
  for (const match of instruction(file).matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(skillRoot, path.dirname(file), target)), `${file}: missing link ${target}`);
  }
}
console.log(`answer worker instructions: ${answerInstructionBytes} bytes`);
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-workers-check-"));
const dir = path.join(cwd, "maps");
const children = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, url;
function run(args, command = cli, input) {
  const child = spawn(process.execPath, [command, ...args, "--dir", dir, "--name", "check"], { cwd, windowsHide: true, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
  if (input !== undefined) child.stdin.end(JSON.stringify(input));
  children.add(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", data => stdout += data);
  child.stderr.on("data", data => stderr += data);
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { children.delete(child); resolve({ code, signal, stdout, stderr }); });
  });
  return { child, done, output: () => stdout };
}
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await sleep(50); }
  throw new Error("Timed out waiting for state");
}
async function start() {
  server = run(["serve", "--port", "0"]);
  await until(() => {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(dir, "check", "server.json")));
      if (info.pid !== server.child.pid) return false;
      url = info.url; return true;
    } catch { return false; }
  });
}
async function request(route, body) {
  const response = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST",
    headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function event(watch, type) {
  const result = await watch.done;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim().split("\n").length, 1);
  const value = JSON.parse(result.stdout);
  assert.equal(value.type, type);
  return value;
}
const watch = (...args) => run(["watch", "--timeout", "5", "--max-wait", "20", ...args]);
// Prevent a failed command from leaving the check hanging indefinitely.
const watchdog = setTimeout(() => { for (const child of children) child.kill(); }, 120000);
const map = path.join(dir, "check");
const read = name => fs.readFileSync(path.join(map, name), "utf8");
const inbox = () => JSON.parse(read("inbox.json"));
const init = { title: "Worker check", brief: "Product brief", arch: "Node architecture", questions: [{ q: "First?" }, { q: "Second?" }] };
try {
  let result = await run(["config"]).done;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { roles: { griller: { model: "inherit" } }, knowledge: { rereadThreshold: 5 }, session: { rolloverTokens: 120000 } });
  fs.mkdirSync(dir, { recursive: true });
  const configFile = path.join(dir, "config.json");
  for (const model of ["sonnet", "opus", "haiku", "inherit"]) {
    fs.writeFileSync(configFile, JSON.stringify({ ignored: true, roles: { ignored: {}, griller: { model, ignored: 1 } } }));
    result = await run(["config"]).done;
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { roles: { griller: { model } }, knowledge: { rereadThreshold: 5 }, session: { rolloverTokens: 120000 } });
  }
  fs.writeFileSync(configFile, JSON.stringify({ roles: { griller: { ignored: 1 } } }));
  assert.equal(JSON.parse((await run(["config"]).done).stdout).roles.griller.model, "inherit");
  for (const text of ['{"roles":{"griller":{"model":"bad"}}}', '{', 'null', '{"roles":[]}', '{"roles":{"griller":{"model":null}}}']) {
    fs.writeFileSync(configFile, text);
    result = await run(["config"]).done;
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes(configFile));
    const failedStart = await run(["start", "--no-open"]).done;
    assert.equal(failedStart.code, 1);
    assert.ok(failedStart.stderr.includes(configFile));
    assert.ok(!failedStart.stderr.includes("Не удалось запустить сервер карты"));
  }
  for (const threshold of [1, 5, 500]) {
    fs.writeFileSync(configFile, JSON.stringify({ knowledge: { rereadThreshold: threshold } }));
    result = await run(["config"]).done;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).knowledge.rereadThreshold, threshold);
    assert.equal(JSON.parse(result.stdout).roles.griller.model, "inherit");
  }
  for (const threshold of [0, 501, 1.5, "5", null]) {
    fs.writeFileSync(configFile, JSON.stringify({ knowledge: { rereadThreshold: threshold } }));
    result = await run(["config"]).done;
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes(configFile));
  }
  for (const threshold of [1, 120000, 200000]) {
    fs.writeFileSync(configFile, JSON.stringify({ session: { rolloverTokens: threshold } }));
    result = await run(["config"]).done;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).session.rolloverTokens, threshold);
  }
  for (const threshold of [0, -1, 1.5, "120000", null]) {
    fs.writeFileSync(configFile, JSON.stringify({ session: { rolloverTokens: threshold } }));
    assert.equal((await run(["config"]).done).code, 1);
  }
  fs.unlinkSync(configFile);
  fs.mkdirSync(configFile);
  assert.equal((await run(["config"]).done).code, 1);
  fs.rmdirSync(configFile);
  // Use a disposable skill copy so malformed installed defaults cannot affect other sessions.
  const skillCopy = path.join(cwd, "skill");
  fs.cpSync(path.dirname(cli), skillCopy, { recursive: true });
  const copiedCli = path.join(skillCopy, "grill.mjs");
  const defaults = path.join(skillCopy, "config.default.json");
  fs.writeFileSync(defaults, '{"roles":{"griller":{}}}');
  result = await run(["config"], copiedCli).done;
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(defaults));
  assert.ok(result.stderr.includes(configFile));
  fs.writeFileSync(configFile, '{"roles":{"griller":{"model":"sonnet"}}}');
  result = await run(["config"], copiedCli).done;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { roles: { griller: { model: "sonnet" } }, knowledge: { rereadThreshold: 5 }, session: { rolloverTokens: 120000 } });
  fs.unlinkSync(configFile);
  assert.equal((await watch("--inbox").done).code, 2);
  await start();
  assert.match(read("session.md"), /Generated by grill.mjs/);
  assert.match(read("session.md"), /^# Проект$/m);
  await request("locale", { language: "en" });
  assert.match(read("session.md"), /^# Project$/m);
  await request("init", init);
  assert.ok(read("session.md").includes("Language: en"));
  assert.ok(read("session.md").includes(init.brief));
  assert.ok(read("session.md").includes(init.arch));
  const [id, secondId] = (await request("state")).nodes.filter(n => n.kind === "q").map(n => n.id);
  await request("answer", { id, answer: "Full answer with facts" });
  const full = await event(watch(), "answer");
  assert.equal(fs.existsSync(path.join(map, "inbox.json")), false);
  const line = await event(watch("--inbox"), "answer");
  assert.deepEqual(line, { type: "answer", id, token: line.token, name: "check", language: "en", inbox: path.join(map, "inbox.json"), characters: line.characters, sections: line.sections });
  assert.notEqual(inbox().token, full.token);
  assert.deepEqual({ ...inbox(), token: full.token, knowledge: full.knowledge }, full);
  await request("answer", { id: secondId, answer: "Queued answer" });
  const before = JSON.parse(read("state.json"));
  assert.deepEqual(await request("apply", { type: "notes", text: "First facts" }), { ok: true });
  await request("apply", { type: "notes", text: "  Replacement facts  " });
  assert.equal((await request("state")).notes, "Replacement facts");
  assert.match(read("session.md"), /Replacement facts/);
  await request("apply", { type: "notes", text: "x".repeat(3100) });
  assert.equal((await request("state")).notes.length, 3000);
  assert.ok(read("session.md").includes("x".repeat(3000)));
  await request("apply", { type: "notes", text: "" });
  assert.match(read("session.md"), /## Agent notes\n—/);
  const after = JSON.parse(read("state.json"));
  assert.deepEqual(after.queue, before.queue);
  assert.deepEqual(after.nodes, before.nodes);
  const forbidden = await fetch(url + "api/apply", { method: "POST", body: JSON.stringify({ type: "notes", text: "forbidden" }) });
  assert.equal(forbidden.status, 403);
  await request("apply", { type: "notes", text: "Restart facts" });
  await request("stop", {}); await server.done;
  fs.writeFileSync(path.join(map, "session.md"), "overwritten manually");
  await start();
  assert.match(read("session.md"), /Restart facts/);
  assert.ok(read("session.md").includes(init.arch));
  assert.equal((await request("state")).nodes.find(n => n.id === id).pending.stage, "queued");
  await request("init", init);
  assert.equal((await request("state")).notes, "");
  assert.match(read("session.md"), /## Agent notes\n—/);
  const discussionId = (await request("state")).nodes.find(n => n.kind === "q").id;
  await request("discuss", { id: discussionId, message: "Explain this option", quote: "A quoted option", about: "option" });
  const fullDiscussion = await event(watch(), "discuss");
  const discussionLine = await event(watch("--inbox"), "discuss");
  assert.deepEqual(discussionLine, { type: "discuss", id: discussionId, token: discussionLine.token, name: "check", language: "en", inbox: path.join(map, "inbox.json"), characters: discussionLine.characters, sections: discussionLine.sections });
  assert.notEqual(inbox().token, fullDiscussion.token);
  assert.deepEqual({ ...inbox(), token: fullDiscussion.token, knowledge: fullDiscussion.knowledge }, fullDiscussion);
  assert.match(inbox().message, /Explain this option/);
  assert.equal(focusCard(inbox()).q, "First?");
  assert.equal(inbox().history, undefined);
  assert.equal(inbox().messages, undefined);
  assert.equal(focusCard(inbox()).id, discussionId);
  await request("apply", { type: "discuss", id: discussionId, token: discussionLine.token, reply: "Here is the explanation." });
  assert.equal((await request("state")).nodes.find(n => n.id === discussionId).discuss, null);
  assert.equal((await request("state")).nodes.find(n => n.id === discussionId).status, "open");
  const assess = async (message, assessment) => {
    await request("discuss", { id: discussionId, message });
    const e = await event(watch(), "discuss");
    return { type: "discuss", id: e.id, token: e.token, reply: "Decision recorded.", assessment };
  };
  const rejected = async (body, status) => {
    const before = await request("state");
    const response = await fetch(url + "api/apply", { method: "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, status, await response.text());
    if (status === 400) assert.deepEqual((await request("state")).nodes, before.nodes);
  };
  let decision = await assess("Accept the full exception list.", { status: "ok", verdict: "All exceptions accepted.", answer: "Accepted exception list." });
  await rejected({ ...decision, assessment: { status: "bad", verdict: "Invalid" } }, 400);
  await request("apply", decision);
  let resolved = (await request("state")).nodes.find(n => n.id === discussionId);
  assert.equal(resolved.status, "ok");
  assert.equal(resolved.answer, "Accepted exception list.");
  await request("apply", decision);
  decision = await assess("The exceptions still need measurement.", { status: "verify", verdict: "Measure exception frequency.", answer: "Must not replace the original answer." });
  await request("spec", {});
  await request("apply", decision);
  resolved = (await request("state")).nodes.find(n => n.id === discussionId);
  assert.equal(resolved.status, "verify");
  assert.equal(resolved.answer, "Accepted exception list.");
  assert.equal(resolved.verdictHistory.length, 2);
  const frozen = await event(watch(), "spec");
  assert.equal(frozen.nodes.find(n => n.id === discussionId).status, "verify");
  await request("apply", { type: "spec", token: frozen.token, markdown: "# Frozen decision" });
  decision = await assess("Decision before concurrent answer.", { status: "ok", verdict: "Accepted." });
  await request("answer", { id: discussionId, answer: "New submitted answer" });
  await request("cancel", { id: discussionId, confirmation: (await request("cancel", { id: discussionId })).confirmation });
  // A changed branch must invalidate the assessment, even with a valid delivery token.
  await request("discuss", { id: "root", message: "Changed project premise." });
  await request("question", { id: "discussion-child", parentId: discussionId, q: "New branch evidence?" });
  await request("apply", decision);
  const rootDiscussion = await event(watch(), "discuss");
  assert.equal(rootDiscussion.id, "root");
  await rejected({ type: "discuss", id: "root", token: rootDiscussion.token, reply: "No root grade.", assessment: { status: "ok", verdict: "Invalid", answer: "Invalid" } }, 400);
  await request("apply", { type: "discuss", id: "root", token: rootDiscussion.token, reply: "Noted." });
  const childRequest = await event(watch(), "question");
  await request("apply", { type: "question", id: childRequest.id, token: childRequest.token, question: { options: ["Yes", "No"] } });
  await request("discuss", { id: discussionId, message: "Confirm after restart." });
  const recovered = await event(watch(), "discuss");
  await request("stop", {}); await server.done; await start();
  await rejected({ ...decision, token: recovered.token }, 409);
  const restarted = await event(watch(), "discuss");
  await request("apply", { ...decision, token: restarted.token });
  assert.equal((await request("state")).nodes.find(n => n.id === discussionId).status, "ok");
  await request("spec", {});
  const spec = await event(watch("--inbox"), "spec");
  assert.equal(spec.id, undefined);
  assert.ok(spec.token);
  assert.equal(spec.token, inbox().token);
  assert.equal(spec.type, inbox().type);
  await request("apply", { type: "spec", token: spec.token, markdown: "# Worker specification" });
  // Commands from any discussion are persisted atomically with its reply.
  await request("init", init);
  const cliState = await run(["state"]).done;
  assert.equal(cliState.code, 0);
  const [source, target] = JSON.parse(cliState.stdout).nodes.filter(n => n.kind === "q");
  const command = await run(["discuss"], cli, { id: "root", message: "Mark the second question and reread the map." }).done;
  assert.equal(command.code, 0, command.stderr);
  await request("discuss", { id: target.id, message: "Earlier clarification." });
  await request("answer", { id: target.id, answer: "Original submitted decision." });
  const commandEvent = await event(watch(), "discuss");
  const commandApply = { type: "discuss", id: "root", token: commandEvent.token, reply: "Queued.", reread: true,
    forward: { id: target.id, message: "Mark this decision as verify: it needs measurement. Requested in project chat." } };
  await rejected({ ...commandApply, forward: { id: "missing", message: "Invalid" } }, 400);
  await rejected({ ...commandApply, reread: "yes" }, 400);
  assert.equal((await request("state")).rereadPending, null);
  await request("apply", commandApply);
  await request("apply", commandApply);
  assert.equal((await request("state")).nodes.find(n => n.id === target.id).chat.length, 1);
  await request("stop", {}); await server.done; await start();
  const targetEvent = await event(watch(), "discuss");
  assert.equal(focusCard(targetEvent).pending, undefined);
  assert.equal(targetEvent.id, target.id);
  assert.match(targetEvent.message, /needs measurement/);
  assert.equal(focusCard(targetEvent).id, target.id);
  await request("apply", { type: "discuss", id: target.id, token: targetEvent.token, reply: "Marked verify.",
    assessment: { status: "verify", verdict: "Measurement needed.", answer: "Decision subject to measurement." } });
  const commandReview = await event(watch(), "reread");
  assert.equal(contextCards(commandReview).find(n => n.id === target.id).status, "verify");
  await request("apply", { type: "reread", token: commandReview.token, summary: "Checked.", reserve: [],
    audit: contextCards(commandReview).map(n => ({ id: n.id, action: "keep", reason: "Still relevant." })) });
  const earlier = await event(watch(), "discuss");
  assert.match(earlier.message, /Earlier clarification/);
  await request("apply", { type: "discuss", id: target.id, token: earlier.token, reply: "Noted" });
  const targetAnswer = await event(watch(), "answer");
  assert.equal(targetAnswer.id, target.id);
  await request("apply", { type: "answer", id: target.id, token: targetAnswer.token, status: "ok", verdict: "Initial grade." });
  const editReview = await event(watch(), "reread");
  await request("apply", { type: "reread", token: editReview.token, audit: contextCards(editReview).map(n => ({ id: n.id, action: "keep", reason: "Still relevant" })) });
  // CLI reread reuses the same deduplicated manual request path.
  assert.equal((await run(["reread"]).done).code, 0);
  const cliReview = await event(watch(), "reread");
  await request("apply", { type: "reread", token: cliReview.token, summary: "Checked again.", reserve: [],
    audit: contextCards(cliReview).map(n => ({ id: n.id, action: "keep", reason: "Still relevant." })) });
  assert.equal((await request("state")).nodes.find(n => n.id === source.id).status, "open");
  await request("more", {});
  const more = await event(watch("--inbox"), "more");
  assert.deepEqual(Object.keys(more).sort(), ["characters", "inbox", "language", "name", "sections", "token", "type"]);
  assert.equal(inbox().type, "more");
  await request("apply", { type: "more", token: more.token, questions: [] });
  const savedInbox = read("inbox.json");
  const expired = await event(watch("--inbox", "--max-wait", "5"), "timeout");
  assert.equal(expired.expired, true);
  assert.equal(expired.inbox, undefined);
  assert.equal(read("inbox.json"), savedInbox);
  assert.equal(fs.readdirSync(map).some(name => name.endsWith(".tmp")), false);
  await request("stop", {}); await server.done;
  console.log("worker checks passed");
} finally {
  clearTimeout(watchdog);
  await Promise.all([...children].map(child => new Promise(resolve => { child.once("close", resolve); child.kill(); })));
  fs.rmSync(cwd, { recursive: true, force: true });
}
