#!/usr/bin/env node
// grill.mjs — local map server + CLI bridge between Claude Code and the grill map in the browser.
// Node 18+, no dependencies.
//
//   node grill.mjs start [--port 4777] [--no-open] [--lang en|ru] [--locale file.json]   start server, set language, open browser
//   node grill.mjs init   < {"title","brief","arch","questions":[...]}   load the first questions
//   node grill.mjs wait   [--timeout 280]                            block until the user does something
//   node grill.mjs watch  [--timeout 280] [--max-wait 1800] [--inbox] wait across timeouts for one event
//   node grill.mjs apply  < {"type":"answer"|"discuss"|"question"|"idea"|"more"|"reread"|"finish"|"spec"|"notes", ...}   send agent's result to the map
//   node grill.mjs config                                       print merged griller model config
//   node grill.mjs spec                                         request an implementation plan
//   node grill.mjs status | report | stop
//   node grill.mjs list                                              all grillings in --dir
//
// GET /api/maps shares list discovery; watch --inbox identifies its map with name (null for legacy).
// Every command takes [--dir .grill] [--name <name>]: the map lives in <dir>/<name>, or in <dir> itself without --name.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { locale, revision, translate, page } from "./i18n.mjs";
import { previews } from "./preview.mjs";
import { bindSession, requestResume, ResumeError } from "./connection.mjs";
import { previewDocument } from "./preview-view.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const has = n => argv.includes("--" + n);
// Windows reserved device names can't be folder names
const NAME_RE = /^(?!(con|prn|aux|nul|com\d|lpt\d)$)[a-z0-9][a-z0-9-]{0,39}$/;
const NAME = opt("name", null);
if (has("name") && !NAME_RE.test(NAME ?? "") || argv.some(a => a.startsWith("--name="))) { console.error("Имя грилинга: латиница в нижнем регистре, цифры и дефис, до 40 символов (например, arch или money-model); нельзя con, prn, aux, nul, com0–9, lpt0–9"); process.exit(1); }
const BASE = path.resolve(opt("dir", ".grill"));
const DIR = NAME ? path.join(BASE, NAME) : BASE;
const STATE = path.join(DIR, "state.json");
const INFO = path.join(DIR, "server.json");
const IMAGES = path.join(DIR, "images");
const IMG_RE = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;
const IMG_TYPE = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const IMG_MAX = 8 * 1024 * 1024, IMG_COUNT = 4;
// The type comes from the file signature, never from the client; SVG stays out because it can carry scripts.
const sniffImage = b => b.toString("latin1", 0, 8) === "\x89PNG\r\n\x1a\n" ? "png" : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg" : b.toString("latin1", 0, 4) === "GIF8" ? "gif" : b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" ? "webp" : null;
const CLI = c => `node "${path.join(HERE, "grill.mjs")}" ${c}${NAME ? " --name " + NAME : ""}`;
const START = CLI("start");
const ORDER = ["gap", "weak", "verify", "open", "ok"];
const countQ = nodes => { const c = { open: 0, ok: 0, weak: 0, gap: 0, verify: 0 }; nodes.filter(n => n.kind === "q" && !n.obsolete).forEach(n => c[n.status]++); return c; };
const samePath = (a, b) => process.platform === "win32" ? String(a).toLowerCase() === b.toLowerCase() : a === b;

const uid = () => "n" + Math.random().toString(36).slice(2, 9);
const clean = (s, m) => String(s ?? "").trim().slice(0, m);
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const atomicWrite = (file, text) => {
  const tmp = file + "." + randomUUID() + ".tmp";
  try { fs.writeFileSync(tmp, text, { flag: "wx" }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
};
const freshState = () => ({ version: 0, reserve: null, reserveRevision: null, reevaluation: null, title: "", brief: "", arch: "", notes: "", nodes: [{ id: "root", parentId: null, kind: "root" }], queue: [], questionRequests: [], summary: null, finished: false, morePending: false, finishPending: false, rereadJob: null, rereadResult: null });

async function doubleClickTime() {
  const valid = value => Number.isFinite(value) && value > 0 && value <= 10000;
  const override = Number(process.env.GRILL_DOUBLE_CLICK_MS);
  if (valid(override)) return override;
  // Browsers do not expose the desktop double-click interval. Read the local host's preference.
  const commands = {
    win32: ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", 'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public static class GrillMouse { [DllImport("user32.dll")] public static extern uint GetDoubleClickTime(); }\'; [GrillMouse]::GetDoubleClickTime()']],
    darwin: ["osascript", ["-l", "JavaScript", "-e", 'ObjC.import("AppKit"); $.NSEvent.doubleClickInterval * 1000']],
    linux: /(^|:)gnome($|:)/i.test(process.env.XDG_CURRENT_DESKTOP || "") ? ["gsettings", ["get", "org.gnome.desktop.peripherals.mouse", "double-click"]] : null
  };
  try {
    const command = commands[process.platform];
    if (command) {
      const { stdout } = await promisify(execFile)(...command, { timeout: 3000, maxBuffer: 8192, windowsHide: true });
      const value = Number(stdout.trim().split(/\s+/).at(-1));
      if (valid(value)) return value;
    }
  } catch {}
  // Conservative fallback for unavailable desktop settings; an explicit environment override is supported.
  return 5000;
}

/* ============================== server ============================== */
async function serve() {
  fs.mkdirSync(DIR, { recursive: true });
  let S = readJSON(STATE) || freshState();
  S.notes = clean(S.notes, 3000);
  S.locale = has("lang") || has("locale") ? requestedLocale() : locale(S.locale, true);
  const t = text => translate(S.locale, text);
  S.specOwner ||= randomUUID();
  S.specFile ||= `docs/specs/grill-${NAME || "legacy"}.md`;
  S.queue = Array.isArray(S.queue) ? S.queue : [];
  S.reserve ??= null;
  if (S.reevaluation) S.reevaluation = { ids: [...S.reevaluation.ids, ...(S.reevaluation.remaining || [])] };
  S.questionRequests ||= [];
  for (const job of S.questionRequests) {
    job.stage = "queued"; delete job.token;
    if (!S.queue.some(e => e.type === "question" && e.id === job.id)) S.queue.push({ type: "question", id: job.id });
  }
  // answers and discussion messages that were being processed when the server stopped go back to the queue
  for (const n of S.nodes) {
    for (const m of n.chat || []) if (!m.id) { m.id = randomUUID(); if (m.from === "claude") m.readAt = Date.now(); }
    if (n.analysis) {
      n.analysis = { stage: "queued", reason: n.analysis.reason };
      if (!S.queue.some(e => e.type === "idea" && e.id === n.id)) S.queue.push({ type: "idea", id: n.id });
    }
    if (n.pending) {
      n.pending.stage = "queued";
      if (!S.queue.some(e => e.type === "answer" && e.id === n.id)) S.queue.push({ type: "answer", id: n.id });
    }
    if (n.discuss) {
      n.discuss = "queued";
      if (!S.queue.some(e => e.type === "discuss" && e.id === n.id)) S.queue.push({ type: "discuss", id: n.id });
    }
  }
  let waiters = [];
  let lastActivity = 0;

  const save = () => { S.version++; const t = STATE + ".tmp"; fs.writeFileSync(t, JSON.stringify(S, null, 2)); fs.renameSync(t, STATE); preview.cleanup(); };
  const preview = previews(DIR, () => S, save, enqueue, t);
  const writeSession = () => atomicWrite(path.join(DIR, "session.md"), `<!-- Generated by grill.mjs. Do not edit: changes are overwritten. -->
# ${S.title || t("Проект")}
Language: ${S.locale.language}
## Brief
${S.brief}
## Architecture
${S.arch}
## Agent notes
${S.notes || "—"}
`);
  // Files no chat references (reset chats, deleted branches, interrupted writes) are removed; a frozen spec context still counts.
  const pruneImages = () => {
    const used = new Set([...S.nodes, ...(S.specJob?.gradingNodes || [])].flatMap(n => (n.chat || []).flatMap(m => m.images || [])));
    let files; try { files = fs.readdirSync(IMAGES); } catch { return; }
    for (const f of files) if (IMG_RE.test(f) && !used.has(f) || /\.(png|jpg|gif|webp)\.[^.]+\.tmp$/.test(f)) try { fs.unlinkSync(path.join(IMAGES, f)); } catch {}
  };
  const recoverSpec = () => {
    if (!S.specJob) return;
    if (S.specJob.stage !== "refresh") S.specJob.stage = "queued";
    S.specJob.token = null; delete S.specJob.ideaWork; delete S.specJob.reviewWork;
    S.specJob.ideaWaiting ||= [];
    if (!S.queue.some(e => e.type === "spec")) S.queue.unshift({ type: "spec" });
  };
  recoverSpec();
  const cancelStoppedReread = () => {
    if (!(S.finished || S.finishPending) || !S.rereadJob || S.rereadJob.manual) return false;
    S.rereadJob = null;
    S.queue = S.queue.filter(e => e.type !== "reread");
    return true;
  };
  const recoverReread = () => {
    cancelStoppedReread();
    if (!S.rereadJob) return;
    S.rereadJob.stage = "queued"; delete S.rereadJob.token; delete S.rereadJob.revision;
    if (!S.queue.some(e => e.type === "reread")) S.queue.push({ type: "reread" });
  };
  recoverReread();
  save();
  writeSession();
  pruneImages();
  const get = id => S.nodes.find(n => n.id === id);
  const kids = id => S.nodes.filter(n => n.parentId === id);
  const desc = id => kids(id).flatMap(k => [k.id, ...desc(k.id)]);
  const depth = n => { let d = 0; while (n && n.parentId) { d++; n = get(n.parentId); } return d; };
  const anc = n => { const a = []; let p = get(n.parentId); while (p && p.kind !== "root") { a.unshift(p); p = get(p.parentId); } return a; };
  const rootOf = n => { let p = n; while (p.parentId && p.parentId !== "root") p = get(p.parentId); return p; };
  const qs = () => S.nodes.filter(n => n.kind === "q");
  const specNode = n => {
    if (n.kind === "preview") { const snap = n.snapshot ? n : preview.snapshot(n); return { ...snap, link: snap.snapshot ? `http://127.0.0.1:${port}/#preview=${snap.snapshot}` : null }; }
    const { chat, discuss, discussToken, discussRevision, options, pending, analysis, ...rest } = n;
    return { ...rest, ...(n.kind === "idea" ? { chat: chat || [] } : {}), ...(pending ? { answer: null, verdict: null, status: "open", awaiting: true } : {}) };
  };
  const specLocked = id => S.specJob?.waiting.includes(id);
  const subtree = (nodes, id) => {
    const ids = new Set([id]);
    for (let size = -1; size !== ids.size;) { size = ids.size; for (const n of nodes) if (ids.has(n.parentId)) ids.add(n.id); }
    return nodes.filter(n => ids.has(n.id));
  };
  // Processing stages and delivery credentials do not change a question's meaning.
  const contextNode = n => {
    const { discuss, discussToken, discussRevision, pending, analysis, ...rest } = n;
    if (rest.job) { const { stage, token, ...job } = rest.job; rest.job = job; }
    if (rest.chat) rest.chat = rest.chat.map(({ readAt, ...m }) => m);
    return { ...rest, ...(pending ? { pending: { answer: pending.answer, at: pending.at } } : {}) };
  };
  const branchRevision = id => createHash("sha256").update(JSON.stringify([
    subtree(S.nodes, id).map(contextNode), anc(get(id)).map(contextNode),
    S.questionRequests.filter(j => subtree(S.nodes, id).some(n => n.id === j.parentId)).map(j => [j.id, j.parentId, j.q])
  ])).digest("hex");
  const boundBranch = nodes => {
    if (nodes.length > 500 || JSON.stringify(nodes).length > 600000) throw [400, "Ветка слишком большая для обработки", "context-limit"];
  };
  function writeSpec(markdown) {
    // Only fixed project-local paths; never follow links into another directory/file.
    let dir = process.cwd();
    for (const part of ["docs", "specs"]) {
      dir = path.join(dir, part);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      const stat = fs.lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Путь спеки должен содержать обычные каталоги");
    }
    const file = path.join(dir, path.basename(S.specFile));
    const marker = `<!-- grill-owner: ${S.specOwner} -->`;
    const checkOwner = () => {
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || fs.readFileSync(file, "utf8").split(/\r?\n/, 1)[0] !== marker) throw new Error("Файл спеки принадлежит другому документу");
      } catch (e) { if (e.code !== "ENOENT") throw e; }
    };
    checkOwner();
    const tmp = file + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(tmp, marker + "\n\n> " + t("Создано из карты грилинга. Обновление полностью заменяет файл, включая ручные правки.") + "\n\n" + markdown + "\n", { flag: "wx" });
      checkOwner();
      fs.renameSync(tmp, file);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }
  const isListening = () => waiters.some(w => !w.res.destroyed) || Date.now() - lastActivity < 180000;
  // A running rebuild always locks answers. A requested one locks them only while an agent can reach it, and an automatic one never does, so edits in a row join a single run.
  const rereadLocked = () => !!S.rereadJob && (S.rereadJob.stage === "thinking" || !!S.rereadJob.manual && isListening());
  const rereadThinking = () => S.rereadJob?.stage === "thinking";
  // The rebuild reads a settled map: submitted work goes first and a running specification finishes.
  const rereadReady = () => !S.specJob && !S.reevaluation && !S.questionRequests.length && !S.nodes.some(n => n.pending || n.discuss || n.analysis || n.job);
  const mapRevision = () => createHash("sha256").update(JSON.stringify([S.brief, S.arch, S.nodes.map(contextNode), S.questionRequests.map(j => j.id)])).digest("hex");
  const requestReread = (manual, edit) => {
    if (!manual && (S.finished || S.finishPending)) return;
    if (S.rereadJob) {
      if (manual) S.rereadJob.manual = true;
      if (edit && !S.rereadJob.edits.includes(edit)) S.rereadJob.edits.push(edit);
      save(); return;
    }
    S.rereadResult = null;
    // edits: answer edits not yet graded. A withdrawn edit changed nothing, so it must not cost a run.
    S.rereadJob = { stage: "queued", manual: !!manual, edits: edit ? [edit] : [], settled: false, requestedAt: Date.now() };
    enqueue({ type: "reread" });
  };
  const dropEdit = id => {
    const job = S.rereadJob;
    if (!job?.edits.includes(id)) return;
    job.edits = job.edits.filter(x => x !== id);
    if (!job.manual && !job.settled && !job.edits.length && job.stage === "queued") { S.rereadJob = null; S.queue = S.queue.filter(e => e.type !== "reread"); }
  };
  const maxPrio = () => Math.max(0, ...kids("root").map(n => n.prio || 0));
  const mkQ = (o, parentId, extra) => {
    const q = clean(o && o.q, 220); if (!q) return null;
    const options = (Array.isArray(o.options) ? o.options : []).map(x => clean(x, 120)).filter(Boolean).slice(0, 4);
    let recommendation = null;
    if (o.recommendation != null) {
      const option = clean(o.recommendation.option, 120), reason = clean(o.recommendation.reason, 260);
      if (!options.includes(option) || !reason) throw [400, "Рекомендация должна ссылаться на вариант и содержать объяснение"];
      recommendation = { option, reason };
    }
    return { id: uid(), parentId, kind: "q", status: "open", q, why: clean(o.why, 260), area: clean(o.area, 30),
      options, recommendation, ...(extra || {}) };
  };

  const reserveList = (value, nodes) => {
    if (!Array.isArray(value) || value.length > 100) throw [400, "Резерв должен содержать не больше 100 кандидатов"];
    const ids = new Set(), texts = new Set(nodes.filter(n => n.kind === "q" && !n.obsolete).map(n => n.q.toLocaleLowerCase()));
    return value.map(o => {
      const id = clean(o?.id, 81), parentId = clean(o?.parentId || "root", 80), q = mkQ(o, parentId);
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(id) || ids.has(id) || !q || texts.has(q.q.toLocaleLowerCase()) || !nodes.some(n => n.id === parentId && ["root", "q", "idea"].includes(n.kind) && !n.obsolete)) throw [400, "Некорректный или повторный кандидат резерва"];
      ids.add(id); texts.add(q.q.toLocaleLowerCase());
      const { kind, status, ...candidate } = q; return { ...candidate, id };
    });
  };
  const coverage = () => {
    const shown = qs().filter(n => !n.obsolete).length, reserve = S.reserve === null ? null : S.reserve.length;
    return { shown, reserve, percent: reserve === null || !shown || S.reserveRevision !== mapRevision() ? null : Math.round(100 * shown / (shown + reserve)), stale: reserve !== null && S.reserveRevision !== mapRevision() };
  };
  const recordVerdict = (n, status, verdict) => {
    const history = n.verdictHistory || (n.verdict ? [{ status: n.status, verdict: n.verdict, at: n.reviewedAt || 0 }] : []);
    if (history.length >= 1000) throw [400, "История вердиктов достигла предела 1000"];
    n.verdictHistory = [...history, { status, verdict, at: Date.now() }];
    n.status = status; n.verdict = verdict;
  };
  const ancestorIds = (nodes, id) => {
    const ids = []; let n = nodes.find(n => n.id === id);
    while ((n = nodes.find(x => x.id === n?.parentId))) if (n.kind === "q" && n.answer && !n.obsolete) ids.push(n.id);
    return ids;
  };
  const queueReview = (nodes, id, captured = false) => {
    const ids = ancestorIds(nodes, id); if (!ids.length) return;
    if (!captured && S.reevaluationError?.ids.every(id => ids.includes(id))) S.reevaluationError = null;
    if (captured) S.specJob.reviewIds = [...new Set([...(S.specJob.reviewIds || []), ...ids])];
    else S.reevaluation = { ids: [...new Set([...(S.reevaluation?.ids || []), ...(S.reevaluation?.remaining || []), ...ids])] };
  };
  function reviewPayload(captured = false) {
    const nodes = captured ? S.specJob.gradingNodes : S.nodes;
    const ids = (captured ? S.specJob.reviewIds : [...S.reevaluation.ids, ...(S.reevaluation.remaining || [])]).filter(id => nodes.some(n => n.id === id && n.kind === "q" && n.answer && !n.obsolete));
    ids.sort((a, b) => ancestorIds(nodes, b).length - ancestorIds(nodes, a).length);
    // Deliver complete affected branches in independent batches; unrelated map size is immaterial.
    const highest = ids.filter(id => !ancestorIds(nodes, id).some(parent => ids.includes(parent)));
    const branch = highest.length ? subtree(nodes, highest[0]).map(contextNode) : [];
    const batch = ids.filter(id => branch.some(n => n.id === id));
    const context = [...branch];
    let parent = nodes.find(n => n.id === highest[0]);
    while ((parent = nodes.find(n => n.id === parent?.parentId))) context.push(contextNode(parent));
    try {
      boundBranch(branch);
      if (JSON.stringify(context).length > 600000) throw [400, "Ветка слишком большая для обработки", "context-limit"];
    } catch (error) {
      if (error[2] !== "context-limit") throw error;
      if (captured) {
        S.specError = t(error[1]); S.specJob = null; S.queue = S.queue.filter(e => e.type !== "spec");
      } else {
        S.reevaluationError = { ids: batch, error: t(error[1]), at: Date.now() };
        const remaining = ids.filter(id => !batch.includes(id));
        S.reevaluation = remaining.length ? { ids: remaining } : null;
      }
      save(); throw error;
    }
    const job = { ids: batch, remaining: ids.filter(id => !batch.includes(id)), token: randomUUID(), revision: mapRevision() };
    if (captured) S.specJob.reviewWork = job; else S.reevaluation = job;
    return { type: "reevaluate", token: job.token, capturedForSpec: captured, ids: job.ids, nodes: structuredClone(context), title: captured ? S.specJob.title : S.title, brief: captured ? S.specJob.brief : S.brief, arch: captured ? S.specJob.arch : S.arch };
  }
  function applyReview(b) {
    const captured = b.capturedForSpec === true, job = captured ? S.specJob?.reviewWork : S.reevaluation;
    if (!job?.token || job.token !== b.token) throw [409, "Результат устарел, получите событие через wait"];
    if (!captured && job.revision !== mapRevision()) { S.reevaluation = { ids: [...job.ids, ...(job.remaining || [])] }; save(); throw [409, "Карта изменилась, получите событие через wait"]; }
    if (!Array.isArray(b.assessments) || b.assessments.length !== job.ids.length) throw [400, "Нужна оценка каждого родителя"];
    const nodes = structuredClone(captured ? S.specJob.gradingNodes : S.nodes), seen = new Set();
    for (const a of b.assessments) {
      if (!job.ids.includes(a?.id) || seen.has(a.id) || !["ok", "weak", "gap", "verify"].includes(a.status) || !clean(a.verdict, 400)) throw [400, "Некорректная оценка родителя"];
      seen.add(a.id); recordVerdict(nodes.find(n => n.id === a.id), a.status, clean(a.verdict, 400));
    }
    if (captured) { S.specJob.gradingNodes = nodes; S.specJob.nodes = nodes.map(specNode); S.specJob.reviewIds = job.remaining; delete S.specJob.reviewWork; }
    else { S.nodes = preview.branchCopies(nodes); S.reevaluation = job.remaining.length ? { ids: job.remaining } : null; }
    save(); return { ok: true };
  }
  const ideaOf = (nodes, id) => {
    let n = nodes.find(x => x.id === id);
    while (n && n.kind !== "idea") n = nodes.find(x => x.id === n.parentId);
    return n;
  };
  const queueIdea = (n, reason = "answers") => {
    if (!n) return;
    n.analysisStarted = true;
    n.analysis = { stage: "queued", reason: reason === "edit" || n.analysis?.reason === "edit" ? "edit" : reason };
    if (!S.queue.some(e => e.type === "idea" && e.id === n.id)) S.queue.push({ type: "idea", id: n.id });
  };
  const settled = () => !S.questionRequests.length && !S.nodes.some(n => n.pending || n.discuss);
  const captureSpec = () => {
    const waiting = qs().filter(n => n.pending).map(n => n.id);
    const ideaWaiting = [...new Set([...S.nodes.filter(n => n.analysis).map(n => n.id), ...waiting.map(id => ideaOf(S.nodes, id)?.id).filter(Boolean)])];
    return { stage: "queued", token: null, requestedAt: Date.now(), title: S.title, brief: S.brief, arch: S.arch,
      reviewIds: [...new Set([...(S.reevaluation?.ids || []), ...(S.reevaluation?.remaining || []), ...waiting.flatMap(id => ancestorIds(S.nodes, id))])], nodes: S.nodes.map(specNode), gradingNodes: structuredClone(S.nodes.map(n => n.kind === "preview" ? specNode(n) : contextNode(n))), waiting, ideaWaiting, ideaReasons: Object.fromEntries(S.nodes.filter(n => n.analysis).map(n => [n.id, n.analysis.reason])) };
  };
  const specNodes = nodes => {
    const excluded = new Set(nodes.filter(n => n.kind === "idea" && n.status !== "ok").flatMap(n => subtree(nodes, n.id).map(x => x.id)));
    return nodes.filter(n => !excluded.has(n.id));
  };
  const ideaBusy = id => {
    const branch = subtree(S.nodes, id), ids = new Set(branch.map(n => n.id));
    return !!S.rereadJob || !!S.reevaluation || branch.some(n => n.pending || n.discuss || n.analysis) || S.questionRequests.some(j => ids.has(j.parentId)) || !!S.specJob?.nodes.some(n => ids.has(n.id));
  };
  // Idea revisions use the entire map: evidence in another branch can invalidate the conclusion.
  function ideaPayload(id, captured = false) {
    const nodes = captured ? S.specJob.gradingNodes : S.nodes, n = nodes.find(x => x.id === id);
    if (!n || !captured && !n.analysis) return null;
    boundBranch(nodes);
    const job = { id, stage: "thinking", token: randomUUID(), revision: mapRevision(), reason: captured ? S.specJob.ideaReasons?.[id] || "snapshot" : n.analysis.reason };
    if (captured) S.specJob.ideaWork = job; else n.analysis = job;
    return { type: "idea", id, token: job.token, capturedForSpec: captured, reason: job.reason, title: captured ? S.specJob.title : S.title,
      brief: captured ? S.specJob.brief : S.brief, arch: captured ? S.specJob.arch : S.arch,
      idea: contextNode(n), nodes: structuredClone(nodes.map(contextNode)) };
  }
  function applyIdea(b) {
    const captured = b.capturedForSpec === true, n = get(b.id), job = captured ? S.specJob?.ideaWork : n?.analysis;
    if (!job || job.stage !== "thinking" || job.token !== b.token || job.id !== b.id) throw [409, "Результат устарел, получите событие через wait"];
    if (!captured && job.revision !== mapRevision()) {
      queueIdea(n, job.reason); save(); throw [409, "Карта изменилась, получите событие через wait"];
    }
    const source = captured ? S.specJob.gradingNodes : S.nodes, next = structuredClone(source), idea = next.find(x => x.id === b.id);
    const verdict = clean(b.verdict, 400);
    if (!ORDER.includes(b.status) || !verdict) throw [400, "Нужны статус идеи и объяснение"];
    const branch = subtree(next, idea.id).filter(x => x.kind === "q"), ids = new Set(branch.map(x => x.id));
    if (b.audit !== undefined && (!Array.isArray(b.audit) || b.audit.length !== branch.length) || job.reason === "edit" && !Array.isArray(b.audit)) throw [400, "Нужна проверка каждой карточки"];
    const audited = new Set(), drop = new Set();
    for (const a of b.audit || []) {
      const q = next.find(x => x.id === a?.id), reason = clean(a?.reason, 400);
      if (!ids.has(a?.id) || audited.has(a.id) || !reason || !["keep", "obsolete", "restore", "remove"].includes(a.action)) throw [400, "Некорректная проверка карточки"];
      audited.add(a.id);
      if (a.action !== "keep" && q.conflictOf?.length) throw [400, "Расхождение решает только ответ пользователя"];
      if (a.action === "remove") {
        if (q.answer || q.chat?.length || q.mergedFrom?.length) throw [400, "Убрать можно только вопрос без ответа и обсуждения"];
        drop.add(q.id);
      }
      if (a.action === "obsolete") q.obsolete = { reason, sources: [{ id: idea.id, q: idea.text }] };
      if (a.action === "restore") { if (!q.obsolete) throw [400, "Карточка не устарела"]; delete q.obsolete; }
    }
    if (b.children !== undefined && (!Array.isArray(b.children) || b.children.length > 4)) throw [400, "Некорректные вопросы идеи"];
    const children = (b.children || []).map(o => {
      const q = mkQ({ ...o, area: o?.area || "" }, idea.id);
      if (!q || q.options.length < 2) throw [400, "Новому вопросу нужны текст и не менее двух вариантов"];
      return q;
    });
    const result = next.filter(x => !drop.has(x.id)); result.push(...children);
    preview.reconcile(source, result);
    if (result.some(x => drop.has(x.parentId))) throw [400, "Родитель не найден или обнаружен цикл"];
    if (b.status === "ok" && subtree(result, idea.id).some(x => x.kind === "q" && !x.obsolete && (x.pending || ["open", "gap"].includes(x.status)))) throw [400, "Сначала разберите открытые вопросы и дыры"];
    recordVerdict(idea, b.status, verdict);
    Object.assign(idea, { analysis: null, reviewedAt: Date.now() });
    boundBranch(result);
    if (captured) {
      S.specJob.gradingNodes = result; S.specJob.nodes = result.map(specNode);
      S.specJob.ideaWaiting = S.specJob.ideaWaiting.filter(id => id !== idea.id); delete S.specJob.ideaWork;
      // Frozen conclusions never overwrite later live work; the live idea has its own delivery.
    } else S.nodes = preview.branchCopies(result);
    save(); pruneImages(); return { ok: true, added: children.length };
  }

  function payload(e) {
    if (e.type === "preview") return preview.payload(e.id);
    if (e.type === "idea") return ideaPayload(e.id);
    if (e.type === "spec") {
      const j = S.specJob; if (!j) return null;
      j.stage = "thinking"; j.token = randomUUID();
      return { type: "spec", token: j.token, path: S.specFile, requestedAt: j.requestedAt, title: j.title, brief: j.brief, arch: j.arch, nodes: specNodes(j.nodes) };
    }
    if (e.type === "answer") {
      const n = get(e.id); if (!n || !n.pending) return null;
      boundBranch(subtree(S.nodes, n.id));
      n.pending.stage = "thinking"; n.pending.token = randomUUID(); n.pending.revision = branchRevision(n.id);
      const source = specLocked(n.id) ? S.specJob.gradingNodes || S.specJob.nodes : S.nodes;
      const branch = []; let parent = source.find(x => x.id === n.parentId);
      while (parent && parent.kind !== "root") { branch.unshift(parent); parent = source.find(x => x.id === parent.parentId); }
      return { type: "answer", id: n.id, token: n.pending.token, question: n.q, why: n.why, area: n.area, level: depth(n), priority: rootOf(n).prio,
        answer: n.pending.answer, previousAnswer: n.answer || null, previews: preview.savedContext(n.id, source),
        branch: branch.map(a => ({ q: a.q, ...(a.kind === "idea" ? { kind: "idea", text: a.text } : {}), answer: a.answer || null, status: a.status, obsolete: a.obsolete || null })),
        branchSnapshot: structuredClone(subtree(source, n.id).map(contextNode)), capturedForSpec: !!specLocked(n.id),
        questionRequests: S.questionRequests.filter(j => subtree(S.nodes, n.id).some(x => x.id === j.parentId)).map(j => ({ id: j.id, parentId: j.parentId, q: j.q })),
        protectedIds: specLocked(n.id) ? subtree(S.nodes, n.id).filter(x => !source.some(s => s.id === x.id && JSON.stringify(contextNode(s)) === JSON.stringify(contextNode(x)))).map(x => x.id) : [],
        existingQuestions: qs().filter(x => !x.obsolete).map(x => x.q) };
    }
    if (e.type === "discuss") {
      const n = get(e.id); if (!n || !n.discuss) return null;
      const branchSnapshot = n.kind === "q" ? subtree(S.nodes, n.id).map(contextNode) : [];
      boundBranch(branchSnapshot);
      n.discuss = "thinking"; n.discussToken = randomUUID();
      n.discussRevision = branchRevision(n.id);
      const chat = n.chat || []; let i = chat.length; while (i && chat[i - 1].from === "user") i--;
      return { type: "discuss", id: n.id, token: n.discussToken, scope: n.kind === "root" ? "project" : n.kind === "idea" ? "idea" : "question", question: n.kind === "root" ? S.title : n.text || n.q, why: n.why, area: n.area, level: depth(n), priority: n.kind === "root" ? null : rootOf(n).prio,
        status: n.status, obsolete: n.obsolete || null, answer: n.answer || null, verdict: n.verdict || null, pendingAnswer: n.pending ? n.pending.answer : null,
        options: n.options || [], branchSnapshot,
        branch: anc(n).map(a => ({ q: a.q, ...(a.kind === "idea" ? { kind: "idea", text: a.text } : {}), answer: a.answer || null, status: a.status, obsolete: a.obsolete || null })),
        message: chat.slice(i).map(m => m.quote ? `[Про ${m.about === "verdict" ? "вердикт" : m.about === "question" ? "вопрос" : "вариант ответа"} «${m.quote}»]${m.text ? " " + m.text : ""}` : m.text).filter(Boolean).join("\n\n"),
        images: chat.slice(i).flatMap(m => (m.images || []).map(f => path.join(IMAGES, f))),
        history: chat.slice(0, i).map(m => ({ from: m.from, text: m.text, ...(m.quote ? { quote: m.quote, about: m.about || "option" } : {}), ...(m.images ? { images: m.images.map(f => path.join(IMAGES, f)) } : {}) })) };
    }
    if (e.type === "question") {
      const job = S.questionRequests.find(j => j.id === e.id), parent = job && get(job.parentId);
      if (!parent) return null;
      job.stage = "thinking"; job.token = randomUUID(); job.revision = branchRevision(parent.id);
      return { type: "question", id: job.id, token: job.token, parentId: parent.id, question: job.q,
        parent: contextNode(parent), branch: anc(parent).map(contextNode), existingQuestions: qs().filter(x => !x.obsolete).map(x => x.q) };
    }
    if (e.type === "reread") {
      const j = S.rereadJob; if (!j) return null;
      boundBranch(S.nodes);
      j.stage = "thinking"; j.token = randomUUID(); j.revision = mapRevision();
      const talk = m => ({ from: m.from, text: m.text, ...(m.quote ? { quote: m.quote } : {}), ...(m.images ? { images: m.images.map(f => path.join(IMAGES, f)) } : {}) });
      return { type: "reread", token: j.token, reserve: S.reserve, coverage: coverage(), title: S.title, brief: S.brief, arch: S.arch,
        ideas: S.nodes.filter(n => n.kind === "idea").map(contextNode),
        nodes: qs().map(n => ({ id: n.id, parentId: n.parentId, level: depth(n), area: n.area, priority: n.prio ?? null, q: n.q, why: n.why, options: n.options, status: n.status, answer: n.answer || null, verdict: n.verdict || null, createdBy: n.createdBy || null,
          obsolete: n.obsolete || null, conflictOf: n.conflictOf || [], mergedFrom: n.mergedFrom || [], chat: (n.chat || []).map(talk) })),
        projectChat: (get("root").chat || []).map(talk) };
    }
    if (e.type === "more") return { type: "more", mainQuestions: kids("root").filter(n => n.kind === "q").sort((a, b) => a.prio - b.prio).map(r => ({ priority: r.prio, area: r.area, q: r.q, status: r.status, answer: r.answer || null, obsolete: r.obsolete || null })) };
    if (e.type === "finish") {
      const c = counts();
      return { type: "finish", counts: c, ideas: S.nodes.filter(n => n.kind === "idea").map(specNode), problems: qs().filter(n => !n.obsolete && ["gap", "weak", "verify"].includes(n.status)).map(n => ({ status: n.status, area: n.area, q: n.q, answer: n.answer, verdict: n.verdict })) };
    }
    return null;
  }
  const counts = () => countQ(S.nodes);
  function takeEvent() {
    if (cancelStoppedReread()) save();
    if (S.specJob && S.specJob.stage !== "refresh" && !S.specJob.waiting.length && S.specJob.reviewIds?.length) { const p = reviewPayload(true); save(); return { ...p, language: S.locale.language }; }
    if (!S.specJob && S.reevaluation && settled() && !rereadThinking()) { const p = reviewPayload(); save(); return { ...p, language: S.locale.language }; }
    if (!S.finished && !S.finishPending && !S.rereadJob && rereadReady() && !S.queue.length && qs().some(n => !n.obsolete) && !qs().some(n => !n.obsolete && n.status === "open") && S.autoRereadRevision !== mapRevision()) {
      S.autoRereadRevision = mapRevision();
      S.rereadJob = { stage: "queued", manual: false, edits: [], settled: true, requestedAt: Date.now() };
      S.queue.push({ type: "reread" }); save();
    }
    if (S.specJob?.stage === "refresh" && settled() && !S.nodes.some(n => n.analysis) && !rereadThinking()) S.specJob = captureSpec();
    // Captured answers must be graded before the snapshot can be delivered, including after restart.
    if (S.specJob?.waiting.length) {
      const i = S.queue.findIndex(e => e.type === "answer" && specLocked(e.id));
      if (i > 0) S.queue.unshift(...S.queue.splice(i, 1));
    }
    if (S.specJob && S.specJob.stage !== "refresh" && !S.specJob.waiting.length && S.specJob.ideaWaiting?.length) {
      const p = ideaPayload(S.specJob.ideaWaiting[0], true); save(); return { ...p, language: S.locale.language };
    }
    for (;;) {
      const i = S.queue.findIndex(e => e.type === "reread" ? rereadReady() : e.type === "idea" ? settled() && !rereadThinking() : e.type === "spec" ? S.specJob?.stage !== "refresh" && !S.specJob?.waiting.length && !S.specJob?.ideaWaiting?.length : true);
      if (i < 0) return null;
      const [e] = S.queue.splice(i, 1); let p;
      try { p = payload(e); } catch (error) {
        if (e.type === "reread" && error[2] === "context-limit") {
          // Failed full-map context must not retain an answer lock or retry automatically.
          S.rereadJob = null; S.rereadResult = { at: Date.now(), error: t(error[1] || String(error)) };
          S.autoRereadRevision = mapRevision(); save();
        } else S.queue.splice(i, 0, e);
        throw error;
      }
      if (p) { save(); return { ...p, language: S.locale.language }; }
    }
  }
  function requeue(ev) {
    if (ev.type === "answer") { const n = get(ev.id); if (n && n.pending) n.pending.stage = "queued"; S.queue.unshift({ type: "answer", id: ev.id }); }
    else S.queue.unshift({ type: ev.type });
  }
  function pump() {
    waiters = waiters.filter(w => !w.res.destroyed);
    while (waiters.length) {
      // A reread may have to wait, so a waiter keeps its timer until an event really exists.
      const ev = takeEvent(); if (!ev) break;
      const w = waiters.shift(); clearTimeout(w.timer);
      lastActivity = Date.now();
      send(w.res, 200, ev);
    }
  }
  function enqueue(e) { S.queue.push(e); save(); pump(); }

  function report() {
    const LABEL = Object.fromEntries(Object.entries({ open: "Открыт", ok: "Закрыт", weak: "Слабо", gap: "Дыра", verify: "Проверить" }).map(([k, v]) => [k, t(v)]));
    let md = `# ${t("Грилинг:")} ${S.title || t("проект")}\n\n**${t("Бриф:")}** ${S.brief}\n\n**MVP-${t("архитектура:")}** ${S.arch || "—"}\n\n`;
    const merged = (sources, ind = "") => (sources || []).map(m => `${ind}- ${t("Сведено из:")} ${m.q}: ${m.answer}\n` +
      (m.verdict ? `${ind}  - ${t("Вердикт:")} ${m.verdict}\n` : "") +
      (m.verdictHistory || []).map(h => `${ind}  - ${t("История вердиктов")}: [${LABEL[h.status]}] ${h.verdict}\n`).join("") + merged(m.mergedFrom, ind + "  ")).join("");
    const c = counts(); md += `${t("Итого:")} ${ORDER.map(s => `${LABEL[s]} ${c[s]}`).join(" · ")}\n\n`;
    if (S.summary) md += `## ${t("Итог")}\n\n${S.summary}\n\n`;
    md += `## ${t("Карта вопросов")}\n\n`;
    kids("root").sort((a, b) => a.prio - b.prio).forEach(r => {
      if (r.kind === "preview") { md += `### ${t("Превью")} · ${r.q}\n${r.commit || ""}\n\n`; return; }
      md += r.kind === "idea" ? `### ${t("Идея")} · [${t(r.status === "open" ? "Открыта" : r.status === "ok" ? "Закрыта" : LABEL[r.status])}]\n${r.text}\n` : `### P${r.prio} · ${r.area} · [${LABEL[r.status]}]\n${r.q}\n`;
      if (r.kind === "idea") for (const m of r.chat || []) md += `- ${t(m.from === "user" ? "Вы" : "Агент")}: ${m.quote ? "«" + m.quote + "» " : ""}${m.text}${m.images?.length ? " [" + m.images.join(", ") + "]" : ""}\n`;
      if (r.answer) md += `- ${t("Ответ:")} ${r.answer}\n`; if (r.verdict) md += `- ${t("Вердикт:")} ${r.verdict}\n`;
      for (const h of r.verdictHistory || []) md += `- ${t("Вердикт:")} [${LABEL[h.status]}] ${h.verdict}\n`;
      if (r.obsolete) md += `- ${t("Устарело:")} ${r.obsolete.reason}\n`;
      md += merged(r.mergedFrom);
      const walk = (id, ind) => kids(id).forEach(k => {
        md += `${ind}- [${k.kind === "preview" ? t("Превью") : LABEL[k.status]}] ${k.q}${k.commit ? " · " + k.commit : ""}\n`;
        if (k.answer) md += `${ind}  - ${t("Ответ:")} ${k.answer}\n`; if (k.verdict) md += `${ind}  - ${t("Вердикт:")} ${k.verdict}\n`;
        for (const h of k.verdictHistory || []) md += `${ind}  - ${t("Вердикт:")} [${LABEL[h.status]}] ${h.verdict}\n`;
        if (k.obsolete) md += `${ind}  - ${t("Устарело:")} ${k.obsolete.reason}\n`;
        md += merged(k.mergedFrom, ind + "  ");
        if (r.kind === "idea") for (const m of k.chat || []) md += `${ind}  - ${t(m.from === "user" ? "Вы" : "Агент")}: ${m.quote ? "«" + m.quote + "» " : ""}${m.text}${m.images?.length ? " [" + m.images.join(", ") + "]" : ""}\n`;
        walk(k.id, ind + "  ");
      });
      walk(r.id, ""); md += "\n";
    });
    return md;
  }

  function apply(b) {
    lastActivity = Date.now();
    if (b.type === "preview") return preview.apply(b);
    if (b.type === "idea") return applyIdea(b);
    if (b.type === "reevaluate") return applyReview(b);
    if (b.type === "notes") {
      S.notes = clean(b.text, 3000); save(); writeSession(); return { ok: true };
    }
    if (b.type === "spec") {
      const j = S.specJob;
      if (!j || j.stage !== "thinking" || b.token !== j.token) throw [409, "Запрос спеки устарел, получите событие через wait"];
      const markdown = clean(b.markdown, 100001);
      let error = clean(b.error, 1000);
      if (!error && (!markdown || markdown.length > 100000)) throw [400, "Нужен markdown от 1 до 100000 символов"];
      if (!error) {
        try { writeSpec(markdown); S.specUpdatedAt = Date.now(); }
        catch (e) { error = clean(e.message, 1000); }
      }
      error = error ? t(error) : ""; S.specError = error || null; S.specJob = null; save();
      return { ok: !error, path: S.specFile, ...(error ? { error } : {}) };
    }
    if (b.type === "answer") {
      const n = get(b.id); if (!n || n.kind !== "q") throw [404, "Нет вопроса с id " + b.id];
      // only an answer taken by wait can be graded: after a restart it is re-queued and may be edited or withdrawn
      if (!n.pending || n.pending.stage !== "thinking") throw [409, "Ответ не ждёт оценки: его отозвали или он снова в очереди, возьмите его через wait"];
      if (b.token !== n.pending.token) throw [409, "Результат устарел, получите событие через wait"];
      if (n.pending.revision !== branchRevision(n.id)) {
        n.pending.stage = "queued"; delete n.pending.token;
        if (!S.queue.some(e => e.type === "answer" && e.id === n.id)) S.queue.unshift({ type: "answer", id: n.id });
        save(); throw [409, "Ветка изменилась, получите событие через wait"];
      }
      const answer = n.pending.answer;
      const status = ["ok", "weak", "gap", "verify"].includes(b.status) ? b.status : "weak";
      const changes = b.branchChanges || {};
      for (const [key, limit] of [["remove", 500], ["move", 500], ["add", 20]]) {
        if (changes[key] !== undefined && (!Array.isArray(changes[key]) || changes[key].length > limit)) throw [400, "Некорректное изменение ветки"];
      }
      const frozen = specLocked(n.id) ? S.specJob.gradingNodes || S.specJob.nodes : null;
      const scope = new Set(subtree(frozen || S.nodes, n.id).map(x => x.id));
      const drop = new Set(changes.remove || []), moves = changes.move || [];
      if (drop.size !== (changes.remove || []).length || new Set(moves.map(x => x?.id)).size !== moves.length) throw [400, "Повторная операция над вопросом"];
      for (const id of drop) {
        if (id === n.id || !scope.has(id)) throw [400, "Удаление вне затронутой ветки"];
        if (get(id)?.conflictOf?.length) throw [400, "Расхождение решает только ответ пользователя"];
        if (S.questionRequests.some(j => j.parentId === id)) throw [409, "Сначала обработайте собственный вопрос этой карточки"];
        if (frozen && JSON.stringify(contextNode(get(id))) !== JSON.stringify(contextNode(frozen.find(x => x.id === id)))) throw [409, "Нельзя удалить вопрос с более поздними изменениями"];
      }
      const additions = [], refs = new Map();
      for (const o of changes.add || []) {
        if (!o || typeof o.key !== "string" || !/^\$[a-zA-Z0-9-]{1,40}$/.test(o.key) || refs.has(o.key)) throw [400, "Нужен уникальный ключ нового вопроса"];
        const q = mkQ(o, o.parentId); if (!q) throw [400, "Пустой вопрос"];
        refs.set(o.key, q.id); additions.push(q);
      }
      const parentId = id => refs.get(id) || id;
      const allowedParent = id => scope.has(id) && !drop.has(id) && ["q", "idea"].includes(get(id)?.kind) || additions.some(x => x.id === id);
      for (const m of moves) if (!m || get(m.id)?.kind !== "q" || m.id === n.id || !scope.has(m.id) || drop.has(m.id) || !allowedParent(parentId(m.parentId))) throw [400, "Перенос вне затронутой ветки"];
      for (const q of additions) { q.parentId = parentId(q.parentId); if (!allowedParent(q.parentId)) throw [400, "Родитель вопроса не найден"];
      }
      const ch = (Array.isArray(b.children) ? b.children : []).slice(0, 4).map(o => mkQ({ ...o, area: n.area }, n.id)).filter(Boolean);
      additions.push(...ch);
      if (b.newRoot && typeof b.newRoot === "object") { const nr = mkQ(b.newRoot, "root", { prio: maxPrio() + 1, addedFrom: n.q }); if (nr) additions.push(nr); }
      const rebuild = nodes => {
        const next = nodes.filter(x => !drop.has(x.id)).map(x => ({ ...x }));
        next.push(...additions.map(x => ({ ...x })));
        for (const m of moves) { const q = next.find(x => x.id === m.id); if (q) q.parentId = parentId(m.parentId); }
        recordVerdict(next.find(x => x.id === n.id), status, clean(b.verdict, 400));
        Object.assign(next.find(x => x.id === n.id), { answer, pending: null });
        delete next.find(x => x.id === n.id).awaiting;
        const byId = new Map(next.map(x => [x.id, x]));
        if (byId.size !== next.length) throw [400, "Повторный идентификатор вопроса"];
        for (const q of next.filter(x => x.kind === "q")) {
          const seen = new Set([q.id]); let p = q;
          while (p.parentId !== "root") {
            p = byId.get(p.parentId);
            if (!p || seen.has(p.id)) throw [400, "Родитель не найден или обнаружен цикл"];
            seen.add(p.id);
          }
          if (q.parentId !== "root") q.area = p.area;
        }
        boundBranch(subtree(next, n.id));
        return next;
      };
      const next = preview.reconcile(S.nodes, rebuild(S.nodes)), nextFrozen = frozen && preview.reconcile(frozen, rebuild(frozen));
      if (S.rereadJob?.edits.includes(n.id)) { S.rereadJob.edits = S.rereadJob.edits.filter(id => id !== n.id); S.rereadJob.settled = true; }
      S.nodes = preview.branchCopies(next);
      queueReview(S.nodes, n.id);
      queueIdea(ideaOf(S.nodes, n.id));
      S.queue = S.queue.filter(e => !["answer", "discuss"].includes(e.type) || !drop.has(e.id));
      if (nextFrozen) {
        queueReview(nextFrozen, n.id, true);
        S.specJob.gradingNodes = nextFrozen;
        S.specJob.nodes = nextFrozen.map(specNode);
        S.specJob.waiting = S.specJob.waiting.filter(id => id !== n.id && !drop.has(id));
        const idea = ideaOf(nextFrozen, n.id);
        if (idea && !S.specJob.ideaWaiting.includes(idea.id)) S.specJob.ideaWaiting.push(idea.id);
      }
      save(); pruneImages(); return { ok: true, added: additions.length };
    }
    if (b.type === "discuss") {
      const n = get(b.id); if (!n) throw [404, "Нет вопроса с id " + b.id];
      const reply = clean(b.reply, 2000); if (!reply) throw [400, "Пустой reply"];
      // a reply taken before a server restart is stale: the thread was re-queued and may hold newer messages
      if (n.discuss !== "thinking" || b.token !== n.discussToken) throw [409, "Обсуждение не ждёт этого ответа: его сбросили или сообщения снова в очереди, возьмите их через wait"];
      if (b.assessment !== undefined) {
        const a = b.assessment;
        if (n.kind !== "q" || n.obsolete || n.pending || !a || !["ok", "weak", "gap", "verify"].includes(a.status) || !clean(a.verdict, 400) || !n.answer && !clean(a.answer, 2000)) throw [400, "Нужны оценка, вердикт и решение для актуального вопроса"];
        if (n.discussRevision !== branchRevision(n.id)) {
          n.discuss = "queued"; delete n.discussToken; delete n.discussRevision;
          if (!S.queue.some(e => e.type === "discuss" && e.id === n.id)) S.queue.unshift({ type: "discuss", id: n.id });
          save(); throw [409, "Ветка изменилась, получите событие через wait"];
        }
        // Preserve submitted answers and frozen specifications; this evaluates live discussion evidence.
        recordVerdict(n, a.status, clean(a.verdict, 400));
        if (!n.answer) n.answer = clean(a.answer, 2000);
        queueReview(S.nodes, n.id);
        queueIdea(ideaOf(S.nodes, n.id));
      }
      n.chat = [...(n.chat || []), { id: randomUUID(), from: "claude", text: reply, at: Date.now() }]; n.discuss = null;
      delete n.discussRevision;
      save(); return { ok: true };
    }
    if (b.type === "question") {
      const job = S.questionRequests.find(j => j.id === b.id);
      if (!job || job.stage !== "thinking" || job.token !== b.token) throw [409, "Результат устарел, получите событие через wait"];
      const parent = get(job.parentId);
      if (!parent || job.revision !== branchRevision(parent.id)) {
        job.stage = "queued"; delete job.token;
        if (!S.queue.some(e => e.type === "question" && e.id === job.id)) S.queue.unshift({ type: "question", id: job.id });
        save(); throw [409, "Ветка изменилась, получите событие через wait"];
      }
      const q = mkQ({ ...b.question, q: job.q, area: parent.kind === "root" ? b.question?.area : parent.area }, parent.id,
        { createdBy: "user", requestId: job.id, ...(parent.kind === "root" ? { prio: maxPrio() + 1 } : {}) });
      if (q.options.length < 2) throw [400, "Подготовьте не менее двух вариантов"];
      S.nodes = preview.branchCopies([...S.nodes, q]); S.questionRequests = S.questionRequests.filter(j => j.id !== job.id);
      queueIdea(ideaOf(S.nodes, q.id));
      save(); return { ok: true, id: q.id };
    }
    if (b.type === "more") {
      let p = maxPrio();
      const add = (Array.isArray(b.questions) ? b.questions : []).slice(0, 5).map(o => mkQ(o, "root", { prio: ++p })).filter(Boolean);
      S.nodes.push(...add); S.morePending = false; save(); return { ok: true, added: add.length };
    }
    if (b.type === "reread") return applyReread(b);
    if (b.type === "finish") {
      S.summary = clean(b.summary, 8000) || null; S.finished = true; S.finishPending = false; cancelStoppedReread(); save(); return { ok: true };
    }
    throw [400, "type должен быть answer, discuss, question, more, reread, finish, spec или notes"];
  }

  // Whole-map rebuild: the candidate is built and validated on a clone, so any refusal leaves the map untouched.
  function applyReread(b) {
    if (cancelStoppedReread()) save();
    const j = S.rereadJob;
    if (!j || j.stage !== "thinking" || b.token !== j.token) throw [409, "Результат устарел, получите событие через wait"];
    if (j.revision !== mapRevision()) { recoverReread(); save(); throw [409, "Карта изменилась, получите событие через wait"]; }
    const finish = result => { S.autoRereadRevision = mapRevision(); S.rereadJob = null; S.rereadResult = { at: Date.now(), ...result }; };
    const error = clean(b.error, 1000);
    if (error) { finish({ changed: false, error: t(error) }); save(); return { ok: false, error: t(error) }; }
    const bad = message => [400, message];
    const list = (v, max) => { if (v !== undefined && (!Array.isArray(v) || v.length > max)) throw bad("Некорректный результат перечитывания"); return v || []; };
    const close = list(b.close, 500), merge = list(b.merge, 100), add = list(b.add, 3), move = list(b.move, 500), remove = list(b.remove, 500), order = b.order === undefined ? null : list(b.order, 500);
    const next = structuredClone(S.nodes), byId = new Map(next.map(n => [n.id, n]));
    // Coverage is mandatory even for a no-op: structural validation cannot judge the model's semantic review.
    if (!Array.isArray(b.audit) || b.audit.length !== qs().length) throw bad("Нужна проверка каждой карточки");
    const audit = new Map();
    for (const a of b.audit) {
      if (!a || get(a.id)?.kind !== "q" || audit.has(a.id) || !["keep", "close", "merge", "remove", "obsolete", "restore"].includes(a.action) || !clean(a.reason, 400)) throw bad("Некорректная проверка карточки");
      const expected = close.some(o => o?.id === a.id) ? "close" : merge.some(o => Array.isArray(o?.ids) && o.ids.includes(a.id)) ? "merge" : remove.includes(a.id) ? "remove" : ["obsolete", "restore"].includes(a.action) ? a.action : "keep";
      if (a.action !== expected) throw bad("Проверка не соответствует операциям");
      if (["obsolete", "restore"].includes(a.action)) {
        const n = byId.get(a.id), sources = list(a.sources, 20);
        if (n.conflictOf?.length || !sources.length || new Set(sources).size !== sources.length || sources.some(id => !get(id) || !(get(id).answer || get(id).chat?.some(m => m.from === "user")))) throw bad("Нужны источники решения об актуальности карточки");
        if (a.action === "restore") { if (!n.obsolete) throw bad("Карточка не устарела"); delete n.obsolete; }
        else n.obsolete = { reason: clean(a.reason, 400), sources: sources.map(id => ({ id, q: get(id).q || S.title })) };
      }
      audit.set(a.id, { id: a.id, action: a.action, reason: clean(a.reason, 400) });
    }
    const question = id => { const n = typeof id === "string" ? byId.get(id) : null; if (!n || n.kind !== "q") throw bad("Нет вопроса с id " + id); return n; };
    const original = id => { question(id); return get(id); };
    // Each existing card takes part in at most one closing, merge or removal.
    const used = new Set(), claim = id => { if (used.has(id)) throw bad("Повторная операция над вопросом"); used.add(id); };
    for (const o of close) {
      const n = question(o?.id), source = original(o.source), verdict = clean(o.verdict, 400);
      claim(n.id);
      if (n.obsolete || byId.get(source.id).obsolete) throw bad("Устаревшую карточку нельзя закрыть или использовать как актуальный ответ");
      if (n.conflictOf?.length) throw bad("Расхождение решает только ответ пользователя");
      if (n.answer || source.id === n.id || !source.answer || !verdict) throw bad("Закрыть можно вопрос без ответа, указав другой вопрос с ответом и вердикт со ссылкой на него");
      recordVerdict(n, "ok", verdict); n.answer = source.answer;
    }
    const merged = new Map(), combined = new Map();
    for (const o of merge) {
      const ids = list(o?.ids, 20), keepId = o?.keep ?? ids[0], answer = clean(o?.answer, 3000), verdict = clean(o?.verdict, 400);
      if (ids.length < 2 || new Set(ids).size !== ids.length || !ids.includes(keepId) || !answer || !verdict || !["ok", "weak", "gap", "verify"].includes(o.status)) throw bad("Для сведения нужны минимум два вопроса, общий ответ, статус и вердикт");
      const cards = ids.map(id => { const n = question(id); claim(id); if (!n.answer || n.obsolete) throw bad("Свести можно только актуальные вопросы с ответами"); return n; });
      // Answers on record as disagreeing are never combined; only the user settles them.
      if (S.nodes.flatMap(n => [n, ...(n.mergedFrom || [])]).some(n => Object.keys(n.conflictAnswers || {}).filter(id => ids.includes(id)).length > 1)) throw bad("Расхождение решает только ответ пользователя");
      const keep = byId.get(keepId);
      // A merged conflict card must keep its disagreement on record, or it could be raised again.
      const conflicts = [...new Set(cards.flatMap(n => n.conflictOf || []))];
      keep.mergedFrom = cards.flatMap(n => [...(n.mergedFrom || []), { id: n.id, q: n.q, answer: n.answer, status: n.status, verdict: n.verdict || "", verdictHistory: structuredClone(n.verdictHistory || []), ...(n.conflictOf ? { conflictOf: n.conflictOf, conflictAnswers: n.conflictAnswers } : {}) }]);
      // keep.conflictOf is only a union for display; each exact disagreement stays in mergedFrom.
      if (conflicts.length) keep.conflictOf = conflicts;
      delete keep.conflictAnswers;
      // A kept descendant of a merged card moves to the parent of its highest merged ancestor; cards between them become its children.
      const gone = new Set(ids.filter(id => id !== keepId));
      for (let up = keep.parentId; up !== "root"; up = byId.get(up).parentId) if (gone.has(up)) keep.parentId = byId.get(up).parentId;
      const chat = cards.flatMap(n => n.chat || []).sort((x, y) => (x.at || 0) - (y.at || 0));
      if (chat.length > 100) throw bad("Обсуждение слишком длинное");
      if (chat.length) keep.chat = chat;
      combined.set(keepId, answer);
      recordVerdict(keep, o.status, verdict); keep.answer = answer;
      for (const n of cards) if (n !== keep) { merged.set(n.id, keep.id); byId.delete(n.id); }
      for (const n of byId.values()) if (merged.has(n.parentId)) n.parentId = merged.get(n.parentId);
    }
    for (const id of remove) {
      const n = question(id); claim(id);
      if (n.conflictOf?.length) throw bad("Расхождение решает только ответ пользователя");
      if (n.answer || (n.chat || []).length || n.mergedFrom?.length) throw bad("Убрать можно только вопрос без ответа и обсуждения");
      byId.delete(id);
    }
    const resolve = id => merged.get(id) || id;
    const refs = new Map();
    // A disagreement is the cards plus their answers, so editing an answer can raise a new one on the same cards.
    // A merge rewords an answer without the user changing it, so its result replaces the card's recorded answer.
    const followMerges = answers => {
      const out = {};
      for (const [id, answer] of Object.entries(answers)) { const kept = resolve(id); out[kept] = combined.has(kept) ? combined.get(kept) : answer; }
      return out;
    };
    const conflictKey = answers => JSON.stringify(Object.entries(followMerges(answers)).sort());
    // Each merged conflict card keeps its own set in mergedFrom, because keep.conflictOf is only their union.
    const known = new Set(S.nodes.flatMap(n => [n, ...(n.mergedFrom || [])]).filter(n => n.conflictAnswers).map(n => conflictKey(n.conflictAnswers)));
    let newQuestions = 0;
    const additions = add.map(o => {
      if (!o || typeof o.key !== "string" || !/^\$[a-zA-Z0-9-]{1,40}$/.test(o.key) || refs.has(o.key)) throw bad("Нужен уникальный ключ нового вопроса");
      const conflict = o.conflictOf === undefined ? null : list(o.conflictOf, 20);
      if (conflict) {
        if (new Set(conflict.map(resolve)).size < 2 || conflict.some(id => !(typeof id === "string" && get(id)?.answer))) throw bad("Карточка расхождения ссылается минимум на два вопроса с ответами");
        const key = conflictKey(Object.fromEntries(conflict.map(id => [id, get(id).answer])));
        if (known.has(key)) throw bad("Карточка этого расхождения уже есть");
        known.add(key);
      } else if (++newQuestions > 3) throw bad("Новых вопросов не больше 3 за запуск");
      const q = mkQ(o, o.parentId, conflict ? { conflictOf: [...new Set(conflict.map(resolve))], conflictAnswers: Object.fromEntries(conflict.map(id => [id, get(id).answer])) } : {});
      if (!q || q.options.length < 2) throw bad("Новому вопросу нужны текст и не менее двух вариантов");
      refs.set(o.key, q.id);
      return q;
    });
    const parentOf = id => id === "root" ? "root" : refs.get(id) || resolve(id);
    for (const q of additions) { byId.set(q.id, q); q.parentId = parentOf(q.parentId); }
    const moved = new Set();
    for (const m of move) {
      const n = question(m?.id);
      if (moved.has(n.id)) throw bad("Повторная операция над вопросом");
      moved.add(n.id); n.parentId = parentOf(m.parentId);
    }
    for (const n of byId.values()) for (const c of [n, ...(n.mergedFrom || [])]) if (c.conflictOf) {
      c.conflictOf = [...new Set(c.conflictOf.map(resolve))];
      if (c.conflictAnswers) c.conflictAnswers = followMerges(c.conflictAnswers);
    }
    const cards = [...byId.values()].filter(n => n.kind === "q");
    for (const n of cards) {
      if (byId.get(n.parentId)?.kind === "preview") throw bad("Родитель вопроса не найден");
      const seen = new Set([n.id]);
      let p = n;
      while (p.parentId !== "root") {
        p = byId.get(p.parentId);
        if (!p || seen.has(p.id)) throw bad("Родитель не найден или обнаружен цикл");
        seen.add(p.id);
      }
      if (n.parentId !== "root") { n.area = p.area; delete n.prio; }
    }
    // Priorities: an explicit order must name every final main question; otherwise new mains go last.
    const mains = cards.filter(n => n.parentId === "root");
    if (order) {
      const named = order.map(id => refs.get(id) || resolve(id));
      if (new Set(named).size !== mains.length || named.length !== mains.length || !named.every(id => byId.get(id)?.parentId === "root")) throw bad("Порядок должен перечислять все главные вопросы");
      named.forEach((id, i) => { byId.get(id).prio = i + 1; });
    } else {
      let top = Math.max(0, ...mains.map(n => n.prio || 0));
      for (const n of mains) if (!n.prio) n.prio = ++top;
    }
    // The server counts answers itself: the model only checks its own work.
    const kept = new Set(cards.flatMap(n => [n.answer, ...(n.mergedFrom || []).map(m => m.answer)]));
    for (const n of qs()) if (n.answer && !kept.has(n.answer)) throw bad("Ответ пользователя потерян");
    const nodes = preview.reconcile(S.nodes, [...byId.values()]);
    for (const main of mains) boundBranch(subtree(nodes, main.id));
    let reserve = b.reserve === undefined ? S.reserve : b.reserve;
    if (reserve !== null && (!Array.isArray(reserve) || reserve.length > 100)) throw bad("Некорректный резерв");
    const consumed = add.filter(o => o.reserveId !== undefined).map(o => o.reserveId);
    if (new Set(consumed).size !== consumed.length || consumed.some(id => !S.reserve?.some(c => c.id === id))) throw bad("Кандидат резерва не найден");
    if (reserve) reserve = reserve.filter(c => !consumed.includes(c.id));
    if (reserve) reserve = reserveList(reserve, nodes);
    const brief = clean(b.brief, 6000) || S.brief;
    const changed = brief !== S.brief || JSON.stringify(nodes) !== JSON.stringify(S.nodes);
    const summary = clean(b.summary, 1000);
    if (changed) {
      // Without the running job, so restoring this copy cannot start the same rebuild again.
      atomicWrite(path.join(DIR, "state.before-reread.json"), JSON.stringify({ ...S, rereadJob: null }, null, 2));
      S.nodes = preview.branchCopies(nodes); S.brief = brief;
      for (const idea of S.nodes.filter(n => n.kind === "idea" && (n.analysisStarted || n.reviewedAt))) queueIdea(idea, "reread");
      S.queue = S.queue.filter(e => !["answer", "discuss"].includes(e.type) || byId.has(e.id));
    }
    S.reserve = reserve; S.reserveRevision = reserve === null ? null : mapRevision();
    finish({ changed, summary, audit: [...audit.values()] });
    save();
    if (changed) { writeSession(); pruneImages(); }
    return { ok: true, changed, closed: close.length, merged: merge.length, added: additions.length, moved: move.length, removed: remove.length };
  }

  function send(res, code, body, type = "application/json; charset=utf-8") {
    if (res.destroyed) return;
    if (body && typeof body === "object" && typeof body.error === "string") body = { ...body, error: t(body.error) };
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  }
  const readBody = (req, max = 1e6) => new Promise((ok, fail) => {
    // Bodies with images span many chunks: decode as a stream so a split multibyte character survives.
    req.setEncoding("utf8");
    let s = ""; req.on("data", d => { s += d; if (s.length > max) { fail([413, "Слишком большой запрос"]); req.destroy(); } });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { fail([400, "Некорректный JSON"]); } });
  });

  let port = Number(opt("port", 4777));
  const server = http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host || "").split(":")[0];
      if (!["127.0.0.1", "localhost"].includes(host)) return send(res, 403, { error: "forbidden host" });
      const url = new URL(req.url, "http://x");
      const p = url.pathname;
      if (req.method === "GET" && (p === "/" || p === "/index.html")) return send(res, 200, page(fs.readFileSync(path.join(HERE, "ui.html"), "utf8"), S.locale, await doubleClickTime()), "text/html; charset=utf-8");
      if (!p.startsWith("/api/")) return send(res, 404, { error: "not found" });
      if (req.headers["x-grill"] !== "1") return send(res, 403, { error: "missing x-grill header" });
      if (req.method === "GET" && (p === "/api/preview" || p.startsWith("/api/preview/"))) {
        const params = Object.fromEntries(url.searchParams);
        if (p === "/api/preview/document") {
          if (!/^[a-zA-Z0-9-]{1,80}$/.test(params.instance || "")) throw [400, "Некорректный экземпляр превью"];
          const project = preview.route("GET", params.key ? "/api/preview/snapshot" : "/api/preview", params);
          if (!project.files) throw [409, "Превью ещё не готово"];
          return send(res, 200, { document: previewDocument(project, params.instance), commit: project.commit, epoch: project.epoch || 0 });
        }
        return send(res, 200, preview.route("GET", p, params));
      }

      if (req.method === "GET" && p === "/api/ping") return send(res, 200, { ok: true, dir: DIR, port, pid: process.pid });
      if (req.method === "GET" && p === "/api/maps") return send(res, 200, { maps: (await listMaps()).map(m => ({ ...m, current: m.name === NAME })) });
      if (req.method === "GET" && p === "/api/state") {
        const { queue, specJob, specOwner, rereadJob, ...rest } = S;
        return send(res, 200, { ...rest, coverage: coverage(), nodes: S.nodes.map(n => n.kind === "preview" ? preview.publicNode(n) : n.kind === "idea" ? { ...n, deleteBlocked: ideaBusy(n.id) } : n), name: NAME, localeRevision: revision(S.locale), specPending: specJob ? { stage: specJob.stage, waiting: specJob.waiting.length + (specJob.ideaWaiting?.length || 0) } : null, rereadPending: rereadJob ? { stage: rereadJob.stage, locked: rereadLocked() } : null, queueLength: queue.length + (S.reevaluation ? 1 : 0) + (specJob?.reviewIds?.length ? 1 : 0), listening: isListening() });
      }
      if (req.method === "GET" && p === "/api/report") return send(res, 200, report(), "text/markdown; charset=utf-8");
      if (req.method === "GET" && p === "/api/image") {
        const file = url.searchParams.get("file") || "";
        let data; try { if (IMG_RE.test(file)) data = fs.readFileSync(path.join(IMAGES, file)); } catch {}
        if (!data) return send(res, 404, { error: "Картинка не найдена" });
        res.writeHead(200, { "content-type": IMG_TYPE[file.split(".").pop()], "cache-control": "no-store", "x-content-type-options": "nosniff" });
        return res.end(data);
      }
      if (req.method === "GET" && p === "/api/wait") {
        lastActivity = Date.now();
        preview.recover();
        for (const job of S.questionRequests.filter(j => j.stage === "thinking")) {
          job.stage = "queued"; delete job.token;
          if (!S.queue.some(e => e.type === "question" && e.id === job.id)) S.queue.unshift({ type: "question", id: job.id });
          save();
        }
        if (S.specJob?.stage === "thinking" || S.specJob?.ideaWork || S.specJob?.reviewWork) { recoverSpec(); save(); }
        for (const n of S.nodes.filter(n => n.analysis?.stage === "thinking")) { queueIdea(n, n.analysis.reason); save(); }
        if (rereadThinking()) { recoverReread(); save(); }
        // Claude works strictly wait → grade → apply → wait, so anything still in "thinking" when a new wait arrives
        // was taken by a session that died: put it back in front of the queue (assumes one Claude session per map)
        const lost = S.nodes.filter(n => n.pending && n.pending.stage === "thinking" || n.discuss === "thinking");
        for (const n of lost.reverse()) {
          if (n.pending && n.pending.stage === "thinking") { n.pending.stage = "queued"; if (!S.queue.some(e => e.type === "answer" && e.id === n.id)) S.queue.unshift({ type: "answer", id: n.id }); }
          if (n.discuss === "thinking") { n.discuss = "queued"; if (!S.queue.some(e => e.type === "discuss" && e.id === n.id)) S.queue.unshift({ type: "discuss", id: n.id }); }
        }
        if (lost.length) save();
        const ev = takeEvent(); if (ev) return send(res, 200, ev);
        const sec = Math.min(290, Math.max(5, Number(url.searchParams.get("timeout")) || 280));
        const w = { res, timer: null };
        w.timer = setTimeout(() => { waiters = waiters.filter(x => x !== w); lastActivity = Date.now(); send(res, 200, { type: "timeout", waitingAnswers: S.nodes.filter(n => n.pending).length, waitingDiscussions: S.nodes.filter(n => n.discuss).length }); }, sec * 1000);
        res.on("close", () => { clearTimeout(w.timer); waiters = waiters.filter(x => x !== w); });
        waiters.push(w); return;
      }
      if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
      // Only a discussion message carries images: base64 of the allowed files plus its text.
      const b = await readBody(req, p === "/api/discuss" ? Math.ceil(IMG_COUNT * IMG_MAX * 4 / 3) + 1e6 : 1e6);
      if (p.startsWith("/api/preview/")) {
        if (rereadThinking()) throw [409, "Дождитесь завершения перечитывания"];
        return send(res, 200, preview.route("POST", p, b));
      }
      if (p === "/api/locale") {
        let next; try { next = locale(b); } catch (e) { return send(res, 400, { error: e.message }); }
        S.locale = next; save(); writeSession(); return send(res, 200, { ok: true, language: next.language });
      }

      if (["/api/idea/analyze", "/api/idea/edit", "/api/idea/delete"].includes(p)) {
        const n = get(b.id);
        if (!n || n.kind !== "idea") return send(res, 404, { error: "Идея не найдена" });
        if (p === "/api/idea/delete") {
          if (b.confirm !== true) return send(res, 400, { error: "Подтвердите удаление всей ветки идеи" });
          if (ideaBusy(n.id)) return send(res, 409, { error: "Дождитесь завершения работы с веткой идеи" });
          const ids = new Set(subtree(S.nodes, n.id).map(x => x.id));
          S.nodes = preview.reconcile(S.nodes, S.nodes.filter(x => !ids.has(x.id))); S.queue = S.queue.filter(e => !ids.has(e.id));
          save(); pruneImages(); return send(res, 200, { ok: true });
        }
        if (p === "/api/idea/edit") {
          const text = clean(b.text, 3001);
          if (!text || text.length > 3000) return send(res, 400, { error: "Нужен текст идеи до 3000 символов" });
          if (b.revision !== n.revision) return send(res, 409, { error: "Идея изменена в другой вкладке. Откройте её заново" });
          if (text === n.text) return send(res, 200, { ok: true });
          n.text = text; n.q = clean(text, 220); n.revision++;
          queueIdea(n, "edit");
          // A full reread or answer delivery may have depended on the old premise.
          if (rereadThinking()) recoverReread();
          for (const q of subtree(S.nodes, n.id)) if (q.pending?.stage === "thinking") {
            q.pending.stage = "queued"; delete q.pending.token;
            if (!S.queue.some(e => e.type === "answer" && e.id === q.id)) S.queue.unshift({ type: "answer", id: q.id });
          }
          for (const q of subtree(S.nodes, n.id)) if (q.discuss === "thinking") {
            q.discuss = "queued"; delete q.discussToken;
            if (!S.queue.some(e => e.type === "discuss" && e.id === q.id)) S.queue.unshift({ type: "discuss", id: q.id });
          }
          if (S.specJob?.nodes.some(x => x.id === n.id)) {
            S.specJob.stage = "refresh"; S.specJob.token = null; S.specJob.waiting = []; S.specJob.ideaWaiting = []; S.specJob.reviewIds = []; delete S.specJob.ideaWork; delete S.specJob.reviewWork;
            if (!S.queue.some(e => e.type === "spec")) S.queue.push({ type: "spec" });
          }
        } else {
          if (rereadLocked()) return send(res, 409, { error: "Дождитесь завершения перечитывания" });
          if (!n.analysis) queueIdea(n, "manual");
        }
        save(); pump(); return send(res, 200, { ok: true });
      }
      if (p === "/api/idea") {
        const text = clean(b.text, 3001), requestId = clean(b.id, 81);
        if (!text || text.length > 3000 || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId)) return send(res, 400, { error: "Нужны текст идеи до 3000 символов и идентификатор запроса" });
        const existing = S.nodes.find(n => n.requestId === requestId) || S.questionRequests.find(j => j.id === requestId);
        if (existing) {
          if (existing.kind !== "idea" || existing.text !== text) return send(res, 409, { error: "Идентификатор уже использован" });
          return send(res, 200, { ok: true, id: existing.id });
        }
        if (rereadLocked()) return send(res, 409, { error: "Карта перестраивается. Прикрепить идею можно будет после перечитывания" });
        const idea = { id: uid(), parentId: "root", kind: "idea", text, q: clean(text, 220), area: t("Идея"), revision: 1, status: "open", verdict: null, chat: [], requestId };
        S.nodes.push(idea); queueIdea(idea, "created"); save(); pump(); return send(res, 200, { ok: true, id: idea.id });
      }
      if (p === "/api/answer") {
        const n = get(b.id); const answer = clean(b.answer, 3000);
        if (!n || n.kind !== "q") return send(res, 404, { error: "Вопрос не найден" });
        if (n.obsolete) return send(res, 409, { error: "Вопрос устарел. Обсудите его и попросите перечитать карту" });
        if (!answer) return send(res, 400, { error: "Пустой ответ" });
        boundBranch(subtree(S.nodes, n.id));
        if (specLocked(n.id)) return send(res, 409, { error: "Ответ включён в запрос спеки. Дождитесь его оценки, затем измените ответ" });
        if (n.pending && n.pending.stage === "thinking") return send(res, 409, { error: "Агент уже разбирает ответ на этот вопрос" });
        if (rereadLocked()) return send(res, 409, { error: "Карта перестраивается. Ответить можно будет после перечитывания" });
        const edited = !!n.answer && n.answer !== answer, queued = !!n.pending;
        n.pending = { answer, stage: "queued", at: Date.now() };
        if (queued) {
          if (!edited) dropEdit(n.id);
          save(); if (edited) requestReread(false, n.id);
          return send(res, 200, { ok: true });
        }
        enqueue({ type: "answer", id: n.id });
        // Another card may have been closed by the old text; only a rebuild can change other branches.
        if (edited) requestReread(false, n.id);
        return send(res, 200, { ok: true });
      }
      if (p === "/api/discuss/read") {
        const n = get(clean(b.id, 80)), m = n?.chat?.find(m => m.id === clean(b.messageId, 80) && m.from === "claude");
        if (!m) return send(res, 404, { error: "Сообщение не найдено" });
        if (!m.readAt) { m.readAt = Date.now(); save(); }
        return send(res, 200, { ok: true });
      }
      if (p === "/api/discuss") {
        const n = get(b.id); const text = clean(b.message, 2000), quote = clean(b.quote, 400), about = ["verdict", "question"].includes(b.about) ? b.about : "option";
        if (!n) return send(res, 404, { error: "Вопрос не найден" });
        const sources = b.images ?? [];
        if (!Array.isArray(sources)) return send(res, 400, { error: "Неподдерживаемый формат картинки" });
        if (!text && !quote && !sources.length) return send(res, 400, { error: "Пустое сообщение" });
        if (n.discuss === "thinking") return send(res, 409, { error: "Агент уже отвечает в обсуждении этого вопроса" });
        if (rereadThinking()) return send(res, 409, { error: "Карта перестраивается. Отправить сообщение можно будет после перечитывания" });
        if ((n.chat || []).length >= 100) return send(res, 400, { error: "Обсуждение слишком длинное" });
        if (sources.length > IMG_COUNT) return send(res, 400, { error: "Можно вставить не больше 4 картинок" });
        const decoded = sources.map(s => { const data = Buffer.from(typeof s === "string" && s.startsWith("data:") ? s.slice(s.indexOf(",") + 1) : "", "base64"); return { data, ext: sniffImage(data) }; });
        if (decoded.some(x => !x.ext)) return send(res, 400, { error: "Неподдерживаемый формат картинки" });
        if (decoded.some(x => x.data.length > IMG_MAX)) return send(res, 400, { error: "Картинка больше 8 МБ" });
        const images = decoded.map(x => { const file = `${randomUUID()}.${x.ext}`; fs.mkdirSync(IMAGES, { recursive: true }); atomicWrite(path.join(IMAGES, file), x.data); return file; });
        n.chat = [...(n.chat || []), { id: randomUUID(), from: "user", text, ...(quote ? { quote, about } : {}), ...(images.length ? { images } : {}), at: Date.now() }];
        if (n.discuss) { save(); return send(res, 200, { ok: true }); }
        n.discuss = "queued"; enqueue({ type: "discuss", id: n.id }); return send(res, 200, { ok: true });
      }
      if (p === "/api/chatreset") {
        const n = get(b.id);
        if (!n) return send(res, 404, { error: "Вопрос не найден" });
        if (n.discuss === "thinking") return send(res, 409, { error: "Агент сейчас отвечает в обсуждении — сбросить можно после ответа" });
        if (rereadThinking()) return send(res, 409, { error: "Карта перестраивается. Сбросить чат можно будет после перечитывания" });
        delete n.chat; n.discuss = null; S.queue = S.queue.filter(e => !(e.type === "discuss" && e.id === n.id)); save(); pruneImages();
        return send(res, 200, { ok: true });
      }
      if (p === "/api/cancel") {
        const n = get(b.id);
        if (specLocked(b.id)) return send(res, 409, { error: "Ответ включён в запрос спеки. Дождитесь его оценки" });
        if (n && n.pending && n.pending.stage === "queued") {
          n.pending = null; S.queue = S.queue.filter(e => !(e.type === "answer" && e.id === n.id));
          dropEdit(n.id);
          save();
        }
        return send(res, 200, { ok: true });
      }
      if (p === "/api/more") { if (!S.morePending) { S.morePending = true; enqueue({ type: "more" }); } return send(res, 200, { ok: true }); }
      if (p === "/api/reread") {
        if (!qs().length) return send(res, 400, { error: "На карте пока нет вопросов" });
        requestReread(true); return send(res, 200, { ok: true });
      }
      if (p === "/api/question") {
        const parent = get(b.parentId), q = clean(b.q, 220), id = clean(b.id, 80);
        if (!parent || !["root", "q", "idea"].includes(parent.kind)) return send(res, 404, { error: "Вопрос не найден" });
        if (!q || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return send(res, 400, { error: "Нужны текст и идентификатор запроса" });
        const existing = S.questionRequests.find(j => j.id === id) || S.nodes.find(n => n.requestId === id);
        if (existing) {
          if (existing.kind === "idea" || existing.parentId !== parent.id || existing.q !== q) return send(res, 409, { error: "Идентификатор уже использован" });
          return send(res, 200, { ok: true, id });
        }
        if (rereadLocked()) return send(res, 409, { error: "Карта перестраивается. Добавить вопрос можно будет после перечитывания" });
        if (S.questionRequests.some(j => j.parentId === parent.id)) return send(res, 409, { error: "Собственный вопрос уже готовится" });
        if (S.questionRequests.length >= 20) return send(res, 400, { error: "Слишком много ожидающих вопросов" });
        S.questionRequests.push({ id, parentId: parent.id, q, stage: "queued", at: Date.now() });
        enqueue({ type: "question", id }); return send(res, 200, { ok: true, id });
      }
      if (p === "/api/finish") { if (!S.finishPending) { S.finishPending = true; cancelStoppedReread(); enqueue({ type: "finish" }); } return send(res, 200, { ok: true }); }
      if (p === "/api/spec") {
        // A snapshot taken now would freeze the map from before the rebuild.
        if (rereadThinking()) return send(res, 409, { error: "Карта перестраивается. Создать спеку можно будет после перечитывания" });
        if (!S.specJob) {
          S.specError = null;
          S.specJob = captureSpec();
          enqueue({ type: "spec" });
        }
        return send(res, 200, { ok: true, path: S.specFile });
      }
      if (p === "/api/init") {
        const roots = (Array.isArray(b.questions) ? b.questions : []).slice(0, 8);
        if (!roots.length) return send(res, 400, { error: "Нужен хотя бы один вопрос в questions" });
        const questions = roots.map((o, i) => mkQ(o, "root", { prio: i + 1 })).filter(Boolean);
        const reserve = b.reserve === undefined ? null : reserveList(b.reserve, [{ id: "root", kind: "root" }, ...questions]);
        const v = S.version;
        const retainedPreviews = preview.reconcile(S.nodes, [{ id: "root", parentId: null, kind: "root" }]).filter(n => n.kind === "preview");
        S = { ...freshState(), locale: S.locale, version: v, specOwner: S.specOwner, specFile: S.specFile, specUpdatedAt: S.specUpdatedAt,
          title: clean(b.title, 80) || t("Проект"), brief: clean(b.brief, 6000), arch: clean(b.arch, 6000) };
        S.nodes.push(...questions); S.reserve = reserve; S.reserveRevision = reserve === null ? null : mapRevision();
        S.nodes.push(...retainedPreviews);
        lastActivity = Date.now(); save(); writeSession(); pruneImages(); return send(res, 200, { ok: true, questions: S.nodes.length - 1 });
      }
      if (p === "/api/resume") {
        if (S.finishPending) return send(res, 409, { error: "Дождитесь завершения грилинга и повторите попытку." });
        return send(res, 200, await requestResume(BASE, NAME));
      }
      if (p === "/api/apply") { const result = apply(b); pump(); return send(res, 200, result); }
      if (p === "/api/stop") { send(res, 200, { ok: true }); setTimeout(() => { try { fs.unlinkSync(INFO); } catch {} process.exit(0); }, 100); return; }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      if (e instanceof ResumeError) return send(res, 409, { error: e.message });
      if (Array.isArray(e)) return send(res, e[0], { error: e[1] });
      return send(res, 500, { error: String(e && e.message || e) });
    }
  });

  const listen = () => new Promise((ok, fail) => {
    server.once("error", fail); server.listen(port, "127.0.0.1", () => { server.off("error", fail); ok(); });
  });
  for (let i = 0; ; i++) {
    try { await listen(); break; }
    catch (e) { if (e.code === "EADDRINUSE" && i < 20) { port++; continue; } throw e; }
  }
  port = server.address().port;
  fs.writeFileSync(INFO, JSON.stringify({ port, pid: process.pid, url: `http://127.0.0.1:${port}/` }));
  if (!fs.existsSync(STATE)) save();
  console.log(`Грилинг-карта: http://127.0.0.1:${port}/`);
  const bye = () => { try { const i = readJSON(INFO); if (i && i.pid === process.pid) fs.unlinkSync(INFO); } catch {} process.exit(0); };
  process.on("SIGINT", bye); process.on("SIGTERM", bye);
}

/* ============================== client ============================== */
async function api(method, p, body, signal) {
  if (!readJSON(INFO)) { console.error(`Сервер карты не запущен. Выполните: ${START}`); process.exit(2); }
  // a stale server.json may point at a port now taken by another map's server: alive() checks the dir
  const info = await alive();
  let r;
  try {
    if (!info) throw 0;
    r = await fetch(`http://127.0.0.1:${info.port}${p}`, { method, headers: { "content-type": "application/json", "x-grill": "1" }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch {
    if (signal?.aborted) throw signal.reason;
    console.error(`Сервер карты не отвечает. Выполните: ${START}`); process.exit(2);
  }
  const t = await r.text();
  if (!r.ok) { console.error(`Ошибка ${r.status}: ${t}`); process.exit(1); }
  return t;
}
const stdinJSON = () => new Promise((ok) => {
  let s = ""; process.stdin.setEncoding("utf8");
  process.stdin.on("data", d => s += d);
  process.stdin.on("end", () => { try { ok(JSON.parse(s)); } catch (e) { console.error("На вход нужен JSON: " + e.message); process.exit(1); } });
});
async function alive(dir = DIR) {
  const info = readJSON(path.join(dir, "server.json")); if (!info) return null;
  try { const r = await fetch(`http://127.0.0.1:${info.port}/api/ping`, { headers: { "x-grill": "1" }, signal: AbortSignal.timeout(1500) }); if (r.ok) { const j = await r.json(); if (j.pid !== undefined ? j.pid === info.pid : samePath(j.dir, dir)) return info; } } catch {}
  return null;
}
async function listMaps() {
  const dirs = [BASE, ...(fs.existsSync(BASE) ? fs.readdirSync(BASE, { withFileTypes: true }).filter(d => d.isDirectory() && NAME_RE.test(d.name)).map(d => path.join(BASE, d.name)) : [])];
  const out = [];
  for (const d of dirs) {
    const f = path.join(d, "state.json"), s = readJSON(f); if (!s || !Array.isArray(s.nodes)) continue;
    const info = await alive(d); let listening = false;
    if (info) try { listening = !!(await (await fetch(`http://127.0.0.1:${info.port}/api/state`, { headers: { "x-grill": "1" }, signal: AbortSignal.timeout(1500) })).json()).listening; } catch {}
    out.push({ name: d === BASE ? null : path.basename(d), title: s.title || "", counts: countQ(s.nodes), queue: (s.queue || []).length + (s.reevaluation ? 1 : 0) + (s.specJob?.reviewIds?.length ? 1 : 0), finished: !!s.finished,
      updated: fs.statSync(f).mtime.toISOString(), url: info ? info.url : null, listening });
  }
  return out.sort((a, b) => b.updated.localeCompare(a.updated));
}

function openBrowser(url) {
  const [c, a] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { const ch = spawn(c, a, { detached: true, stdio: "ignore" }); ch.on("error", () => {}); ch.unref(); } catch {}
}
async function start() {
  bindSession(BASE);
  const selectedLocale = has("lang") || has("locale") ? requestedLocale() : null;
  let info = await alive();
  if (!info) {
    fs.mkdirSync(DIR, { recursive: true });
    try { fs.unlinkSync(INFO); } catch {}
    const args = [path.join(HERE, "grill.mjs"), "serve", "--dir", BASE, ...(NAME ? ["--name", NAME] : []), "--port", opt("port", "4777"), ...(has("locale") ? ["--locale", path.resolve(opt("locale", ""))] : has("lang") ? ["--lang", opt("lang", "")] : [])];
    const ch = spawn(process.execPath, args, { detached: true, stdio: "ignore" }); ch.unref();
    for (let i = 0; i < 40 && !(info = await alive()); i++) await new Promise(r => setTimeout(r, 150));
    if (!info) { console.error("Не удалось запустить сервер карты. Попробуйте вручную: " + CLI("serve")); process.exit(1); }
  }
  if (selectedLocale) await api("POST", "/api/locale", selectedLocale);
  if (!has("no-open")) openBrowser(info.url);
  console.log(`Грилинг-карта: ${info.url}`);
  if (!has("no-open")) console.log("Браузер открыт. Если окно не появилось, откройте адрес вручную.");
}

function requestedLocale() {
  if (has("locale")) {
    const input = readJSON(path.resolve(opt("locale", "")));
    if (!input) throw new Error("--locale requires a readable JSON file");
    return locale(input);
  }
  if (!has("lang") || !opt("lang", "") || opt("lang", "").startsWith("--")) throw new Error("--lang requires a language tag");
  return locale({ language: opt("lang", "") });
}

function config() {
  let model;
  for (const [file, optional] of [[path.join(HERE, "config.default.json"), false], [path.join(BASE, "config.json"), true]]) {
    let input;
    try { input = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) {
      if (optional && e.code === "ENOENT") continue;
      throw new Error(`Не удалось прочитать конфигурацию ${file}: ${e.message}`);
    }
    const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
    if (!object(input) || (Object.hasOwn(input, "roles") && !object(input.roles)) ||
        (input.roles && Object.hasOwn(input.roles, "griller") && !object(input.roles.griller))) {
      throw new Error(`Некорректная конфигурация ${file}: ожидается объект roles.griller`);
    }
    if (input.roles?.griller && Object.hasOwn(input.roles.griller, "model")) {
      const value = input.roles.griller.model;
      if (!["inherit", "opus", "sonnet", "haiku"].includes(value)) throw new Error(`Некорректная модель в ${file}: ${JSON.stringify(value)}`);
      model = value;
    }
  }
  if (model === undefined) throw new Error(`Модель roles.griller.model не задана после слияния ${path.join(HERE, "config.default.json")} и ${path.join(BASE, "config.json")}`);
  console.log(JSON.stringify({ roles: { griller: { model } } }));
}

const commands = {
  config: async () => config(),
  serve,
  start,
  init: async () => console.log(await api("POST", "/api/init", await stdinJSON())),
  apply: async () => console.log(await api("POST", "/api/apply", await stdinJSON())),
  spec: async () => console.log(await api("POST", "/api/spec", {})),
  wait: async () => console.log(await api("GET", `/api/wait?timeout=${Number(opt("timeout", 280))}`)),
  watch: async () => {
    const seconds = (name, fallback) => {
      const value = Number(opt(name, fallback));
      if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name}: нужно положительное конечное число секунд`);
      return Math.max(5, value);
    };
    const timeout = Math.min(290, seconds("timeout", 280));
    const maxWait = seconds("max-wait", 1800);
    const began = performance.now();
    let last = { type: "timeout", waitingAnswers: 0, waitingDiscussions: 0 };
    for (;;) {
      const remaining = maxWait - (performance.now() - began) / 1000;
      if (remaining <= 0) break;
      const controller = new AbortController();
      // Bound each timer to avoid Node's timer overflow for very large max-wait values.
      const timer = setTimeout(() => controller.abort(), Math.min(remaining * 1000, 2147483647));
      try {
        const body = await api("GET", `/api/wait?timeout=${Math.min(timeout, remaining)}`, undefined, controller.signal);
        const event = JSON.parse(body);
        if (event.type !== "timeout") {
          if (has("inbox")) {
            const inbox = path.join(DIR, "inbox.json");
            atomicWrite(inbox, body);
            console.log(JSON.stringify({ type: event.type, ...(event.id === undefined ? {} : { id: event.id }),
              ...(event.token === undefined ? {} : { token: event.token }), name: NAME, language: event.language, inbox }));
          } else console.log(body);
          return;
        }
        last = event;
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally { clearTimeout(timer); }
    }
    console.log(JSON.stringify({ ...last, expired: true, ...(has("inbox") ? { name: NAME } : {}) }));
  },
  status: async () => {
    const s = JSON.parse(await api("GET", "/api/state"));
    console.log(JSON.stringify({ name: NAME, title: s.title, url: readJSON(INFO)?.url, counts: countQ(s.nodes), queue: s.queueLength, finished: s.finished }, null, 2));
  },
  list: async () => {
    console.log(JSON.stringify(await listMaps(), null, 2));
  },
  report: async () => { const md = await api("GET", "/api/report"); const f = path.join(DIR, "report.md"); fs.writeFileSync(f, md); console.log(`Отчёт сохранён: ${f}`); },
  stop: async () => {
    if (await alive()) { await api("POST", "/api/stop", {}); for (let i = 0; i < 20 && await alive(); i++) await new Promise(r => setTimeout(r, 150)); }
    console.log("Сервер карты остановлен. Карта сохранена в " + STATE); },
};
if (!commands[cmd]) { console.error("Команды: start | init | wait | watch | apply | spec | status | report | stop | list | config | serve"); process.exit(1); }
commands[cmd]().catch(e => { console.error(e && e.message || e); process.exit(1); });
