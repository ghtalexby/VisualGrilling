// Exercise locale rendering, validation, isolation, and restart recovery in a temporary project.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { locale, page, translate } from "../skills/grill/i18n.mjs";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-locale-check-"));
const dir = path.join(cwd, "maps");
const children = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const english = JSON.parse(fs.readFileSync(new URL("../skills/grill/locales/en.json", import.meta.url), "utf8"));
const source = fs.readFileSync(new URL("../skills/grill/ui.html", import.meta.url), "utf8");
const simulator = fileURLToPath(new URL("./simulate.mjs", import.meta.url));
const simName = "locale-check-" + Date.now();
const simMap = fileURLToPath(new URL("../test-project/.grill/" + simName + "/", import.meta.url));
let simUrl, sim;
const script = html => html.match(/<script>([\s\S]*?)<\/script>/)[1];
async function start(name, args = []) {
  const infoFile = path.join(dir, name, "server.json");
  const child = spawn(process.execPath, [cli, "serve", "--dir", dir, "--name", name, "--port", "0", ...args], { cwd, stdio: "ignore", windowsHide: true });
  children.add(child);
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(infoFile)) {
      const info = JSON.parse(fs.readFileSync(infoFile));
      if (info.pid === child.pid) return { child, url: info.url };
    }
    if (child.exitCode !== null) throw new Error("Server exited before readiness");
    await sleep(50);
  }
  throw new Error("Server did not start");
}
async function request(server, route, body, expected = 200) {
  const r = await fetch(server.url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(r.status, expected, await r.clone().text());
  return route === "report" ? r.text() : r.json();
}
async function stop(server) {
  const exited = new Promise(resolve => server.child.once("exit", resolve));
  await request(server, "stop", {}); await exited; children.delete(server.child);
}
async function command(args) {
  const child = spawn(process.execPath, [cli, ...args, "--dir", dir, "--name", "main"], { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = ""; child.stdout.on("data", d => output += d); child.stderr.on("data", d => output += d);
  const code = await new Promise(resolve => child.once("exit", resolve));
  assert.equal(code, 0, output);
}

try {
  for (const language of ["ru", "en", "en-US"]) new vm.Script(script(page(source, locale({ language }))));
  const rendered = page(source, locale({ language: "en" }));
  const slowClicks = page(source, locale({ language: "en" }), 900);
  assert.ok(script(slowClicks).includes("PAGE_DOUBLE_CLICK_MS = 1000"));
  new vm.Script(script(page(source, locale({ language: "en" }), '";throw new Error("injection")')));
  assert.ok(!/[А-Яа-яЁё]/.test(rendered), "Every UI phrase must have an English translation");
  assert.ok(rendered.includes('lang="en"'));
  assert.ok(script(rendered).includes("PAGE_LOCALE"));
  assert.throws(() => locale({ language: "de" }));
  assert.throws(() => locale({ language: "not_a_language" }));
  assert.throws(() => locale({ language: ["en"] }));
  assert.equal(translate(locale({ language: "en" }), "constructor"), "constructor");
  const unicode = locale({ language: "en", messages: { "Не знаю": "Unsure 😀 𐐀" } });
  const unicodePage = page('<script>const label = "Не знаю";</script>', unicode);
  assert.equal(vm.runInNewContext(script(unicodePage) + ";label"), "Unsure 😀 𐐀");
  for (const value of ["<img src=x>", 'bad" onclick=', "A&B", "\n"]) assert.throws(() => locale({ language: "en", messages: { "Не знаю": value } }));
  const custom = { language: "de", messages: Object.fromEntries(Object.entries(english).map(([k, v]) => [k, "DE " + v])) };
  new vm.Script(script(page(source, locale(custom))));
  const arabic = locale({ language: "ar", messages: custom.messages });
  assert.ok(page(source, arabic).includes('dir="rtl"'));

  let server = await start("main", ["--lang", "en"]);
  const other = await start("other");
  const firstPage = await (await fetch(server.url)).text();
  assert.ok(firstPage.includes("Grilling map"));
  assert.ok(firstPage.includes('lang="en"'));
  assert.equal((await request(other, "state")).locale.language, "ru");
  assert.equal((await fetch(server.url + "api/locale", { method: "POST" })).status, 403);
  const stateBefore = await request(server, "state");
  await request(server, "locale", { language: "de" }, 400);
  assert.equal((await request(server, "state")).localeRevision, stateBefore.localeRevision);
  await request(server, "init", { title: "Language test", questions: [{ q: "How do you know?" }] });
  assert.equal((await request(server, "state")).locale.language, "en");
  const id = (await request(server, "state")).nodes.find(n => n.kind === "q").id;
  const error = await request(server, "answer", { id, answer: "" }, 400);
  assert.equal(error.error, "Empty answer");
  await request(server, "answer", { id, answer: "I don't know" });
  assert.equal((await request(server, "wait?timeout=5")).language, "en");
  await stop(server);
  server = await start("main");
  assert.equal((await request(server, "state")).locale.language, "en");
  const recovered = await request(server, "wait?timeout=5");
  assert.equal(recovered.answer, "I don't know");
  await request(server, "apply", { type: "answer", id, token: recovered.token, status: "gap", verdict: "No evidence", children: [] });
  assert.ok((await request(server, "report")).includes("[Gap]"));
  await request(server, "spec", {});
  assert.equal((await request(server, "wait?timeout=5")).language, "en");
  const job = JSON.parse(fs.readFileSync(path.join(dir, "main/state.json"))).specJob;
  await request(server, "apply", { type: "spec", token: job.token, markdown: "# Implementation plan" });
  assert.ok(fs.readFileSync(path.join(cwd, "docs/vgril/specs/grill-main.md"), "utf8").includes("Generated from a grilling map"));
  await request(server, "locale", custom);
  assert.equal((await request(server, "state")).locale.language, "de");
  const customPage = await (await fetch(server.url)).text();
  new vm.Script(script(customPage)); assert.ok(customPage.includes("DE Grilling map"));
  await stop(server); server = await start("main");
  assert.equal((await request(server, "state")).locale.language, "de");
  await stop(server);
  const savedFile = path.join(dir, "main/state.json");
  const oldState = JSON.parse(fs.readFileSync(savedFile));
  delete oldState.locale.messages["Карты"];
  assert.throws(() => locale(oldState.locale));
  fs.writeFileSync(savedFile, JSON.stringify(oldState));
  server = await start("main");
  const migrated = (await request(server, "state")).locale;
  assert.equal(migrated.language, "de");
  assert.equal(migrated.messages["Карты"], "Maps");
  assert.equal(migrated.messages["Не знаю"], custom.messages["Не знаю"]);
  await stop(server);
  fs.writeFileSync(savedFile, JSON.stringify(oldState));
  const replacementFile = path.join(cwd, "replacement.json");
  fs.writeFileSync(replacementFile, JSON.stringify(custom));
  server = await start("main", ["--locale", replacementFile]);
  assert.equal((await request(server, "state")).locale.messages["Карты"], custom.messages["Карты"]);
  await command(["start", "--lang", "ru", "--no-open"]);
  assert.ok((await (await fetch(server.url)).text()).includes("Грилинг-карта"));
  const customFile = path.join(cwd, "de.json"); fs.writeFileSync(customFile, JSON.stringify(custom));
  await command(["start", "--locale", customFile, "--no-open"]);
  assert.equal((await request(server, "state")).locale.language, "de");
  assert.equal((await request(other, "state")).locale.language, "ru");
  await stop(server); await stop(other);
  // The simulator changes its subprocess cwd; locale files must remain relative to its caller.
  sim = spawn(process.execPath, [simulator, "--no-open", "--delay", "200", "--name", simName, "--locale", "de.json"], { cwd, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 100; i++) {
    const infoFile = path.join(simMap, "server.json");
    if (fs.existsSync(infoFile)) { simUrl = JSON.parse(fs.readFileSync(infoFile)).url; break; }
    if (sim.exitCode !== null) throw new Error("Simulator exited before readiness");
    await sleep(50);
  }
  assert.ok(simUrl, "Simulator did not start with a caller-relative locale file");
  assert.equal((await request({ url: simUrl }, "state")).locale.language, "de");
  console.log("Locale checks passed: " + cwd);
} finally {
  if (simUrl) { await request({ url: simUrl }, "stop", {}); await sleep(200); }
  if (sim) sim.kill();
  fs.rmSync(simMap, { recursive: true, force: true });
  for (const child of children) { child.kill(); }
}
