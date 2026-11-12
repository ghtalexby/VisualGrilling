#!/usr/bin/env node
// Simulate an agent to debug the map without a real model session.
// Start a server in test-project/.grill and load questions from dev/fixtures/init.json.
// Reply to map events with simple heuristics through the real grill.mjs CLI,
// exercising the command contract as well.
//
//   node dev/simulate.mjs [--keep] [--watch] [--inbox] [--no-open] [--delay 1500] [--port 4777] [--name <name>] [--lang en|ru] [--locale file.json]
//     --inbox    read full events from inbox files (implies --watch)
//     --watch    use background-compatible watch instead of wait
// Play is a host-session transport, not a grading event; use check-connection.mjs for its fake-host checks.
// Codex monitor keeps the same event/apply format; check-monitor.mjs tests its fake-host transport.
//     --keep     continue the existing map without reinitializing it
//     --name     use test-project/.grill/<name>; without it, use .grill directly
//     --delay    simulated thinking time before apply, in milliseconds

// relatedIds/relatedIndex are navigation only; simulated grading uses full context cards.
import { contextCards, focusCard, discussionChat } from "./context-fixture.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { circlePreview } from "./fixtures/preview.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GRILL = path.join(ROOT, "skills", "grill", "grill.mjs");
const CWD = path.join(ROOT, "test-project");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const has = n => argv.includes("--" + n);
const DELAY = Number(opt("delay", 1500));
const NAME = opt("name", null);

function G(args, input) {
  const r = spawnSync(process.execPath, [GRILL, ...args, ...(NAME ? ["--name", NAME] : [])], { cwd: CWD, input: input === undefined ? undefined : JSON.stringify(input), encoding: "utf8" });
  if (r.status !== 0) throw new Error(`grill ${args[0]}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = s => console.log(`[sim ${new Date().toLocaleTimeString()}] ${s}`);

function grade(e) {
  const a = e.answer.toLowerCase();
  let status;
  if (/не знаю|не думали|не проверяли|пока нет|^-+$/.test(a) || a.length < 4) status = "gap";
  else if (/\d/.test(a) && a.length > 25) status = "ok";
  else if (/думаю|наверное|предполага|интересно|скорее/.test(a)) status = "verify";
  else status = "weak";
  const verdict = {
    ok: "Конкретно, с цифрами — принимаю.",
    weak: "Ответ общий: нет механизма и цифр, на которые можно опереться.",
    gap: "Ответа по сути нет — это дыра.",
    verify: "Держится на допущении, которое никто не проверял.",
  }[status];
  const n = { ok: e.level < 3 ? 1 : 0, weak: 2, verify: 2, gap: 1 }[status];
  const maxKids = e.level >= 4 ? Math.min(n, 1) : n;
  const children = Array.from({ length: maxKids }, (_, i) => ({
    q: `[sim ${e.id}] ${i === 0 ? "Какие измерения подтверждают решение" : "Какие ограничения опровергают допущение"}?`,
    why: `Подвопрос к «${e.question.slice(0, 60)}».`,
    options: ["Есть данные", "Есть косвенные признаки", "Нечем"],
    recommendation: { option: "Есть данные", reason: "[sim] Проверяемое подтверждение." },
  })).filter(child => !contextCards(e).some(n => n.kind === "q" && n.q === child.q));
  // Occasionally exercise the newRoot branch.
  const newRoot = status === "gap" && Math.random() < 0.3
    ? { area: "Риски", q: `[sim] Новый главный вопрос из ответа на «${e.question.slice(0, 40)}»`, why: "Проверка newRoot.", options: ["Да", "Нет"] }
    : null;
  return { type: "answer", id: e.id, token: e.token, status, verdict, children, newRoot };
}

let moreRound = 0;
const handlers = {
  knowledge: e => ({ type: "knowledge", token: e.token, files: [] }),
  preview: e => ({ type: "preview", id: e.id, projectId: e.projectId, base: e.base, token: e.token,
    ...(e.phase === "prepare" ? { question: "[sim] Which visual explanation?", options: ["Circle size wireframe", "Relationship diagram"] } : { purpose: "[sim] Interactive circle size", files: circlePreview }) }),
  spec: e => ({ type: "spec", token: e.token, markdown: `# [sim] План реализации\n\n## Цель\nПроверка генерации: ${e.title}.\n\n## Требования\n${e.nodes.filter(n => n.answer || n.kind === "idea" || n.kind === "preview").map(n => n.kind === "preview" ? n.link ? "- [" + n.q + "](" + n.link + ") · " + n.commit : "- " + n.q + ": [sim] Not published at capture." : "- [" + n.status + "] " + (n.text || n.q) + ": " + (n.answer || n.verdict)).join("\n") || "Нет оценённых ответов."}\n\n## Шаги по компонентам\nЗаблокированы: симулятор не проектирует реализацию.\n\n## Зависимости\nНужен разбор реальным агентом.\n\n## Проверки\nФайл записан и доступен для обновления.\n\n## Открытые вопросы\n${e.nodes.filter(n => n.kind === "q" && !n.answer).map(n => "- " + n.q).join("\n") || "Нет."}` }),
  answer: e => grade(e),
  reevaluate: e => ({ type: "reevaluate", token: e.token, capturedForSpec: e.capturedForSpec,
    assessments: e.ids.map(id => { const n = e.nodes.find(n => n.id === id); return { id, status: n.status === "open" ? "weak" : n.status, verdict: "[sim] Preserve grade: transport fixture does not establish new evidence." }; }) }),
  idea: e => {
    const ids = new Set([e.id]);
    for (let size = -1; size !== ids.size;) { size = ids.size; for (const n of contextCards(e)) if (ids.has(n.parentId)) ids.add(n.id); }
    const branch = contextCards(e).filter(n => n.kind === "q" && ids.has(n.id));
    const active = branch.filter(n => !n.obsolete);
    return { type: "idea", id: e.id, token: e.token, capturedForSpec: e.capturedForSpec,
      status: active.some(n => ["open", "gap"].includes(n.status)) ? "open" : "verify",
      verdict: "[sim] Transport only; a real agent must assess this idea.",
      audit: branch.map(n => ({ id: n.id, action: "keep", reason: "[sim] Preserve history; no semantic review." })),
      children: branch.length ? [] : [{ q: `[sim ${e.id}] Evidence?`, options: ["Measured evidence", "Needs checking"] }] };
  },
  discuss: e => ({ ...(e.message === "[questions]" ? { questions: Array.from({ length: 6 }, (_, i) => ({ key: "$discussion" + i, parentId: "root", q: `[sim ${e.token}] ${["Capacity", "Deployment", "Encryption", "Retention", "Billing", "Staffing"][i]}?`, options: ["Yes", "No"] })), links: Array.from({ length: 6 }, (_, i) => "$discussion" + i) } : {}), ...(e.message.match(/^\[answers:([^\]]+)\]/) ? { answers: e.message.match(/^\[answers:([^\]]+)\]/)[1].split(",").map((id, i) => ({ id, messageIds: [discussionChat(e).at(-1).id], status: i ? "verify" : "ok", verdict: "[sim] Independent target assessment" })) } : {}), type: "discuss", id: e.id, token: e.token, ...(e.message === "[reread]" ? { reread: true } : {}), ...(e.message.match(/^\[forward:([^\]]+)\] ([\s\S]+)$/) ? { forward: { id: e.message.match(/^\[forward:([^\]]+)\]/)[1], message: e.message.replace(/^\[forward:[^\]]+\] /, "") } } : {}), ...(e.scope === "question" && !focusCard(e).obsolete && !focusCard(e).pending && e.message.startsWith("[resolve] ") ? { assessment: { status: "ok", verdict: "[sim] Решение принято в обсуждении.", answer: e.message.slice(10) } } : {}), reply: `[sim] Про «${e.question.slice(0, 60)}»: вы написали «${e.message.slice(0, 80)}». Сообщений в истории: ${discussionChat(e).length}. Картинок: ${e.images.length}. Уточнение сохранено.` }),
  question: e => ({ type: "question", id: e.id, token: e.token, question: { why: "[sim] User question", area: "Project", options: ["Есть данные", "Нужно проверить", "Не знаю"], recommendation: { option: "Нужно проверить", reason: "[sim] Сначала проверить допущение." } } }),
  more: e => ({ type: "more", questions: [1, 2, 3].map(i => ({
    area: ["Рост", "Команда", "Юридическое"][i - 1],
    q: `[sim ${1000 + ++moreRound}] ${["Масштабирование нагрузки", "Компетенции сотрудников", "Лицензирование продукта"][i - 1]}?`,
    why: "Проверка события more.", options: ["Вариант A", "Вариант B"],
  })) }),
  // Transport check only: closes one open card from an answer in another branch. It does not judge meaning.
  reread: e => {
    const rootOf = n => { let p = n; while (p && p.parentId !== "root") p = [...contextCards(e), ...(e.ideas || [])].find(x => x.id === p.parentId); return p?.id || n.parentId; };
    const source = contextCards(e).find(n => n.answer && !n.obsolete), target = source && contextCards(e).find(n => !n.obsolete && !n.answer && n.status === "open" && !n.conflictOf?.length && rootOf(n) !== rootOf(source));
    const audit = contextCards(e).map(n => ({ id: n.id, action: n === target ? "close" : "keep", reason: "[sim] Проверка транспорта, не семантическая оценка." }));
    const candidates = (e.reserve || []).slice(0, 3);
    const reserve = (e.reserve || []).slice(candidates.length);
    const add = candidates.map((n, i) => ({ ...n, key: "$reserve" + i, reserveId: n.id }));
    if (!target) return { type: "reread", token: e.token, audit, reserve, add, summary: "[sim] Схема в балансе, изменений нет." };
    return { type: "reread", token: e.token, audit, reserve, add, summary: `[sim] Закрыт вопрос «${target.q.slice(0, 60)}».`, close: [{ id: target.id, source: source.id, verdict: `[sim] Закрыто ответом на вопрос «${source.q.slice(0, 80)}».` }] };
  },
  finish: e => ({ type: "finish", token: e.token, summary: `Вердикт: Жив при условии… (симуляция)\n\nСчётчики: ${JSON.stringify(e.counts)}\n\nРиски:\n${e.problems.slice(0, 3).map((p, i) => `${i + 1}. ${p.q}`).join("\n") || "—"}\n\nПроверки на неделю:\n1. Проверка из симулятора. Успех — карта отрисовала итог.` }),
};

async function main() {
  const startArgs = ["start", "--port", opt("port", "4777")];
  if (has("no-open")) startArgs.push("--no-open");
  if (has("lang")) startArgs.push("--lang", opt("lang", ""));
  if (has("locale")) startArgs.push("--locale", path.resolve(opt("locale", "")));
  // Check before start, because serve creates an empty state.json on startup.
  const keep = has("keep") && fs.existsSync(path.join(CWD, ".grill", NAME || "", "state.json"));
  log(G(startArgs).split("\n")[0]);
  if (!keep) {
    log("init: " + G(["init"], JSON.parse(fs.readFileSync(path.join(ROOT, "dev", "fixtures", "init.json"), "utf8"))));
    log("notes: " + G(["apply"], { type: "notes", text: "Simulator uses dev/fixtures/init.json and heuristic grading; project claims are not verified." }));
  }
  log("Слушаю карту. Ctrl+C — выход (сервер останется работать, остановить: npm run stop).");
  for (;;) {
    const line = JSON.parse(G(has("inbox") ? ["watch", "--inbox"] : has("watch") ? ["watch"] : ["wait", "--timeout", "60"]));
    const e = line.inbox ? JSON.parse(fs.readFileSync(line.inbox, "utf8")) : line;
    if (e.type === "timeout") { log(`timeout, ждут ответа: ${e.waitingAnswers}, обсуждений: ${e.waitingDiscussions}`); continue; }
    const txt = e.type === "discuss" ? e.message : e.answer;
    log(`<- ${e.type}${e.id ? " " + e.id : ""}${txt ? ` «${txt.slice(0, 60)}»` : ""}`);
    await sleep(DELAY);
    const out = handlers[e.type](e);
    const semantics = (id, text) => ({ topics: ["simulation"], decision: String(text || "").replace(/\s+/g, " ").slice(0, 200),
      relates: contextCards(e).filter(n => n.id !== id && ["q", "idea"].includes(n.kind) && (n.id === focusCard(e)?.parentId || n.parentId === id)).slice(0, 2).map(n => ({ id: n.id, kind: "same-object" })) });
    if (["answer", "idea"].includes(e.type) || e.type === "discuss" && out.assessment) out.semantics = semantics(e.id, out.assessment?.answer || e.answer || focusCard(e)?.text);
    for (const answer of out.answers || []) answer.semantics = semantics(answer.id, e.message);
    try { log(`-> ${out.status || e.type}: ${G(["apply"], out)}`); }
    catch (err) { log(`apply не прошёл: ${err.message}`); }
    if (e.type === "finish") log(G(["report"]));
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
