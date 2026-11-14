import { contextCards } from "./context-fixture.mjs";
import { knowledgeFixture } from "./knowledge-fixture.mjs";
// Run checks in a temporary project without touching user maps.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-spec-check-"));
const dir = path.join(cwd, "maps");
const infoFile = path.join(dir, "check", "server.json");
let child, url;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function start() {
  child = spawn(process.execPath, [cli, "serve", "--dir", dir, "--name", "check", "--port", "0"], { cwd, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(infoFile)) {
      const info = JSON.parse(fs.readFileSync(infoFile));
      url = info.url;
      if (info.pid === child.pid) return;
    }
    await sleep(50);
  }
  throw new Error("Сервер не запустился");
}
const request = knowledgeFixture(rawRequest);
async function rawRequest(route, body, expected = 200) {
  const r = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST",
    headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(r.status, expected, await r.clone().text());
  return route === "report" ? r.text() : r.json();
}
const state = () => request("state");
const wait = async () => {
  for (;;) {
    const e = await request("wait?timeout=5");
    if (e.type !== "reread") return e;
    await request("apply", { type: "reread", token: e.token, audit: contextCards(e).map(n => ({ id: n.id, action: "keep", reason: "Transport review" })) });
  }
};
const grade = (e, status = "ok", children = []) => request("apply", { type: "answer", id: e.id, token: e.token, status, verdict: "Проверено", children });
const markdown = "# План\n\n## Цель\nТест\n\n## Требования\nТест\n\n## Шаги по компонентам\nТест\n\n## Зависимости\nНет\n\n## Проверки\nТест\n\n## Открытые вопросы\nНет";
const applySpec = e => request("apply", { type: "spec", token: e.token, markdown });
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(r => child.once("exit", r));
  await request("stop", {});
  await exited;
}

try {
  await start();
  await request("init", { title: "Проверка", questions: [{ q: "Первый" }, { q: "Второй" }, { q: "Третий" }] });
  const ids = (await state()).nodes.filter(n => n.kind === "q").map(n => n.id);
  const forbidden = await fetch(url + "api/spec", { method: "POST" });
  assert.equal(forbidden.status, 403);
  await request("spec", { actionId: "spec-first" });
  await request("spec", { actionId: "spec-first" });
  assert.equal((await state()).queueLength, 1);
  let e = await wait();
  assert.equal(e.type, "spec");
  assert.equal(e.nodes.filter(n => n.answer).length, 0);
  assert.equal((await applySpec(e)).ok, true);
  const file = path.join(cwd, "docs/vgril/specs/grill-check.md");
  assert.ok(fs.readFileSync(file, "utf8").includes(markdown));
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\r?\n/g, "\r\n"));
  await request("apply", { type: "spec", token: e.token, markdown });

  await request("answer", { id: ids[0], answer: "Старое решение" });
  await grade(await wait(), "ok", [{ q: "Старый потомок" }]);
  const oldChild = (await state()).nodes.find(n => n.parentId === ids[0]).id;
  await request("answer", { id: ids[0], answer: "До клика" });
  await request("spec", {});

  await request("answer", { id: ids[1], answer: "После клика" });
  e = await wait(); assert.equal(e.answer, "До клика");
  await grade(e, "verify", [{ q: "Новый потомок" }]);
  await request("answer", { id: ids[0], answer: "Ещё более новый ответ" });
  e = await wait(); assert.equal(e.type, "spec");
  assert.equal(e.nodes.find(n => n.id === ids[0]).answer, "До клика");
  assert.equal(e.nodes.find(n => n.id === ids[1]).answer, undefined);
  assert.ok(e.nodes.some(n => n.id === oldChild));
  assert.ok(e.nodes.some(n => n.q === "Новый потомок"));
  const stale = e.token;
  e = await wait(); assert.equal(e.type, "spec"); assert.notEqual(e.token, stale);
  await request("apply", { type: "spec", token: stale, markdown }, 409);
  await stop(); await start();
  await request("apply", { type: "spec", token: e.token, markdown }, 409);
  e = await wait(); assert.equal(e.type, "spec");
  assert.equal(e.nodes.find(n => n.id === ids[0]).answer, "До клика");
  assert.equal((await applySpec(e)).ok, true);
  assert.ok(!(await state()).finished);
  e = await wait(); assert.equal(e.type, "answer");
  await grade(e, "gap");
  e = await wait(); assert.equal(e.type, "answer");
  await grade(e);

  // Recover pending answers and the request before delivering the snapshot.
  await request("answer", { id: ids[2], answer: "До рестарта" });
  await request("spec", {});
  await wait();
  await stop();
  // Simulate upgrading a persisted pre-extension spec job.
  const stateFile = path.join(dir, "check", "state.json");
  const legacy = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (legacy.specJob) delete legacy.specJob.gradingNodes;
  fs.writeFileSync(stateFile, JSON.stringify(legacy));
  await start();
  e = await wait(); assert.equal(e.answer, "До рестарта");
  await grade(e);
  e = await wait(); assert.equal(e.type, "spec");
  assert.equal(e.nodes.find(n => n.id === ids[2]).awaiting, undefined);
  assert.equal(e.nodes.find(n => n.id === ids[2]).answer, "До рестарта");
  assert.equal((await applySpec(e)).ok, true);

  fs.writeFileSync(file, "Чужой документ");
  await request("spec", {});
  e = await wait();
  assert.equal((await applySpec(e)).ok, false);
  assert.equal(fs.readFileSync(file, "utf8"), "Чужой документ");
  assert.ok((await state()).specError);
  fs.unlinkSync(file);
  await request("spec", {});
  e = await wait();
  await request("apply", { type: "spec", token: e.token, markdown: "x".repeat(100001) }, 400);
  assert.equal((await applySpec(e)).ok, true);
  await request("spec", {});
  e = await wait();
  const previousDocument = fs.readFileSync(file, "utf8");
  await request("apply", { type: "spec", token: e.token, error: " " }, 400);
  await request("apply", { type: "spec", token: e.token, error: " ", markdown: "x".repeat(100001) }, 400);
  assert.equal(fs.readFileSync(file, "utf8"), previousDocument);
  assert.equal((await request("apply", { type: "spec", token: e.token, error: "Модель недоступна" })).ok, false);
  assert.ok(fs.readFileSync(file, "utf8").includes(markdown));

  await request("discuss", { id: ids[0], message: "Объясни" });
  e = await wait(); assert.equal(e.type, "discuss");
  await request("apply", { type: "discuss", id: e.id, token: e.token, reply: "Объяснение" });
  await request("more", {});
  e = await wait(); assert.equal(e.type, "more");
  await request("apply", { type: "more", token: e.token, questions: [{ q: "Дополнительный" }] });
  await request("finish", {});
  e = await wait(); assert.equal(e.type, "finish");
  await request("apply", { type: "finish", summary: "Жив при условии проверок" });
  assert.ok((await request("report")).includes("Жив при условии"));
  await request("actions/continue", {});
  await request("spec", {});
  e = await wait();
  assert.ok(!e.nodes.some(n => n.chat || n.discuss));
  assert.equal((await applySpec(e)).ok, true);
  assert.ok((await state()).finished);
  const specsDir = path.join(cwd, "docs/vgril/specs");
  const preserved = path.join(cwd, "saved-specs");
  const elsewhere = path.join(cwd, "elsewhere");
  fs.renameSync(specsDir, preserved);
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, specsDir, process.platform === "win32" ? "junction" : "dir");
  await request("spec", {});
  e = await wait();
  assert.equal((await applySpec(e)).ok, false);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  fs.unlinkSync(specsDir);
  fs.renameSync(preserved, specsDir);
  await request("spec", {});
  e = await wait();
  assert.equal((await applySpec(e)).ok, true);
  console.log("Проверки спеки и основных API пройдены: " + cwd);
} finally {
  await stop();
}
