// Preview projects are server-owned repositories. Only complete manifests become visible.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";

const fail = (message, code = 400) => { throw [code, message]; };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value, max) => String(value ?? "").trim().slice(0, max);
const idPattern = /^[0-9a-f-]{36}$/;
const filePattern = /^(index\.html|style\.css|script\.js|images\/[a-zA-Z0-9_-]{1,60}\.(png|jpg|gif|webp))$/;
const write = (file, value) => { const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file); };
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
export function validateFiles(files) {
  if (!files || typeof files !== "object" || Array.isArray(files) || Object.keys(files).length > 32 || Buffer.byteLength(JSON.stringify(files)) > 700000) fail("Некорректные файлы превью");
  for (const [name, value] of Object.entries(files)) {
    if (!filePattern.test(name) || typeof value !== "string" || value.length > 250000) fail("Некорректный файл превью");
    if (name.startsWith("images/")) {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail("Некорректная картинка превью");
      const b = Buffer.from(value, "base64"), ext = name.split(".").pop();
      const valid = ext === "png" ? b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : ext === "jpg" ? b[0] === 255 && b[1] === 216 && b[2] === 255 : ext === "gif" ? b.toString("ascii", 0, 4) === "GIF8" : b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
      if (!valid) fail("Некорректная картинка превью");
    }
  }
  if (!files["index.html"] || !files["script.js"]) fail("Нужны index.html и script.js");
  if (/@import|url\s*\(|\\/i.test(files["style.css"] || "")) fail("В CSS превью запрещены загрузки и escape-последовательности");
  return files;
}

export function previews(directory, state, save, enqueue, translate = text => text) {
  const root = path.join(directory, "previews");
  const safe = (...parts) => {
    let current = directory;
    if (fs.lstatSync(current).isSymbolicLink()) fail("Каталог превью не может быть ссылкой");
    for (const part of ["previews", ...parts]) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(part) || part === "..") fail("Некорректный путь превью");
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail("Каталог превью не может быть ссылкой");
    }
    return current;
  };
  const git = (dir, args) => {
    // No shell, hooks, signing, templates, external filters or inherited Git routing.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0" });
    try { return execFileSync("git", ["-c", "core.hooksPath=" + safe("empty-hooks"), "-c", "commit.gpgsign=false", "-c", "user.name=Grill Preview", "-c", "user.email=preview@localhost", ...args], { cwd: dir, env, windowsHide: true, encoding: "utf8", timeout: 15000, maxBuffer: 2000000 }).trim(); }
    catch { fail("Git недоступен или операция превью не выполнена", 409); }
  };
  const all = () => state().nodes.filter(n => n.kind === "preview");
  const get = id => { const n = all().find(n => n.id === id); if (!n) fail("Превью не найдено", 404); return n; };
  const noLinks = dir => { if (!fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isSymbolicLink()) fail("Ссылка в проекте превью"); if (e.isDirectory()) noLinks(p); } };
  const repo = n => { if (!idPattern.test(n.projectId)) fail("Некорректный проект"); const dir = safe(n.projectId); noLinks(dir); if (fs.existsSync(path.join(dir, ".git")) && !fs.lstatSync(path.join(dir, ".git")).isDirectory()) fail("Некорректный Git проекта"); return dir; };
  const commits = n => n.versions || [];
  const version = (n, commit = n.commit) => { const v = commits(n).find(v => v.commit === commit); if (!v) fail("Версия не найдена", 404); return v; };
  const files = (n, commit = n.commit) => { version(n, commit); return validateFiles(JSON.parse(git(repo(n), ["show", commit + ":manifest.json"]))); };
  const sources = (sourceId, branches = [], nodes = state().nodes) => {
    const selected = new Set();
    const chain = id => { for (let n = nodes.find(n => n.id === id); n; n = nodes.find(x => x.id === n.parentId)) selected.add(n.id); };
    if (sourceId === "root") {
      selected.add("root");
      for (const id of branches) {
        selected.add(id);
        for (let size = -1; size !== selected.size;) { size = selected.size; for (const n of nodes) if (n.parentId !== "root" && selected.has(n.parentId)) selected.add(n.id); }
      }
    } else chain(sourceId);
    return nodes.filter(n => selected.has(n.id) && n.kind !== "preview" && !n.obsolete).map(n => ({ id: n.id, parentId: n.parentId, kind: n.kind, q: n.q, text: n.text, answer: n.pending?.answer || n.answer || null, chat: n.chat || [], ...(n.kind === "root" ? { title: state().title, brief: state().brief, arch: state().arch } : {}) }));
  };
  const revisions = nodes => Object.fromEntries(nodes.map(n => [n.id, hash(n)]));
  const lineEnd = id => {
    if (id === "root") return id;
    for (;;) { const children = state().nodes.filter(n => n.kind === "q" && !n.obsolete && n.parentId === id); if (children.length !== 1) return id; id = children[0].id; }
  };
  const stale = n => {
    if (!n.commit) return 0;
    const context = sources(lineEnd(n.sourceId), n.branches), now = revisions(context), old = version(n).sources;
    return new Set([...Object.keys(old), ...Object.keys(now)].filter(id => old[id] !== now[id] && (old[id] || context.find(n => n.id === id)?.answer || context.find(n => n.id === id)?.chat.length))).size;
  };
  const recover = () => { for (const n of all()) if (n.job) { n.job.stage = "queued"; delete n.job.token; if (!state().queue.some(e => e.type === "preview" && e.id === n.id)) state().queue.push({ type: "preview", id: n.id }); } };
  const queue = (n, phase) => {
    const sourceId = lineEnd(n.sourceId), context = sources(sourceId, n.branches);
    n.job = { phase, stage: "queued", base: n.commit || null, epoch: n.epoch || 0, sourceId, context, sources: revisions(context), savedState: n.commit ? structuredClone(version(n).savedState ?? null) : null };
    n.error = null; enqueue({ type: "preview", id: n.id });
  };
  const payload = id => {
    const n = all().find(n => n.id === id), j = n?.job; if (!j) return null;
    j.stage = "thinking"; j.token = randomUUID();
    return { type: "preview", id, token: j.token, phase: j.phase, projectId: n.projectId, base: j.base, sourceId: n.sourceId, branches: n.branches, request: n.request, context: j.context, files: n.commit ? files(n) : null, savedState: j.savedState ?? null };
  };
  const apply = b => {
    const n = get(b.id), j = n.job;
    if (!j || j.stage !== "thinking" || j.token !== b.token || j.base !== (n.commit || null) || j.epoch !== (n.epoch || 0) || b.projectId !== n.projectId || b.base !== j.base) fail("Результат превью устарел", 409);
    if (b.error) { n.error = text(b.error, 1000); delete n.job; save(); return { ok: false, error: n.error }; }
    if (j.phase === "prepare") {
      const options = Array.isArray(b.options) ? b.options.map(x => text(x, 300)).filter(Boolean).slice(0, 4) : [];
      if (options.length < 2 || !text(b.question, 500)) fail("Нужны вопрос и варианты превью");
      n.question = text(b.question, 500); n.options = options; delete n.job; save(); return { ok: true };
    }
    const manifest = validateFiles(b.files), dir = repo(n);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, ".git"))) git(dir, ["init", "--template="]);
    // A failed/unpublished commit stays unreachable from the map; reads use the committed manifest only.
    write(safe(n.projectId, "manifest.json"), manifest);
    const previous = n.commit ? files(n) : {};
    for (const name of Object.keys(previous)) if (!Object.hasOwn(manifest, name)) fs.rmSync(safe(n.projectId, ...name.split("/")), { force: true });
    for (const [name, value] of Object.entries(manifest)) {
      const file = safe(n.projectId, ...name.split("/")); fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, name.startsWith("images/") ? Buffer.from(value, "base64") : value);
    }
    git(dir, ["add", "--all", "--", "manifest.json", "index.html", "script.js", ...(manifest["style.css"] || previous["style.css"] ? ["style.css"] : []), ...(Object.keys(manifest).concat(Object.keys(previous)).some(n => n.startsWith("images/")) ? ["images"] : [])]);
    git(dir, ["commit", "--allow-empty", "-m", text(b.purpose || n.request, 300) || "Preview"]);
    const commit = git(dir, ["rev-parse", "HEAD"]);
    const v = { commit, purpose: text(b.purpose || n.request, 500), at: Date.now(), sources: j.sources, stateRevision: 0 };
    n.versions ||= []; n.versions.push(v); n.commit = commit; n.q = v.purpose; n.sourceId = j.sourceId; n.parentId = n.sourceId;
    delete n.job; n.epoch = (n.epoch || 0) + 1; save(); return { ok: true, commit };
  };
  const snapshot = n => {
    if (!n.commit) return { ...n, job: undefined };
    const v = version(n), value = { projectId: n.projectId, commit: n.commit, purpose: v.purpose, files: files(n), savedState: v.savedState ?? null, stateRevision: v.stateRevision };
    const key = hash(value); fs.mkdirSync(safe("snapshots"), { recursive: true });
    const file = safe("snapshots", key + ".json"); if (!fs.existsSync(file)) write(file, value);
    return { id: n.id, parentId: n.parentId, sourceId: n.sourceId, branches: n.branches, kind: "preview", q: v.purpose, commit: n.commit, snapshot: key, link: "#preview=" + key };
  };
  // User decisions are recorded before any agent tree mutation. Missing decisions reject atomically.
  const reconcile = (before, next) => {
    const present = new Set(next.map(n => n.id));
    for (const n of before.filter(n => n.kind === "preview")) {
      if (present.has(n.sourceId) && present.has(n.job?.sourceId || n.sourceId) && present.has(n.id) && !(n.branches || []).some(id => !present.has(id))) continue;
      const live = all().find(x => x.id === n.id);
      // A frozen reference outlives explicit project deletion. There is no longer
      // a working project whose fate the user could choose; retain its snapshot.
      const policy = !live && n.snapshot ? "keep" : live?.deletionPolicy || n.deletionPolicy;
      if (!policy) fail("Выберите судьбу превью перед удалением источника", 409);
      const i = next.findIndex(x => x.id === n.id); if (i >= 0) next.splice(i, 1);
      if (policy === "keep") next.push({ ...n, sourceId: "root", parentId: "root", branches: [], orphaned: true, job: undefined, epoch: (n.epoch || 0) + 1 });
    }
    return next;
  };
  const fork = (n, sourceId) => {
    const copy = structuredClone(n); copy.id = "p" + randomUUID(); copy.projectId = randomUUID(); copy.sourceId = sourceId; copy.parentId = sourceId; copy.forkOf = n.projectId; copy.forkBranchId = sourceId; copy.originProjectId = n.originProjectId || n.projectId; copy.epoch = 0; delete copy.job; delete copy.deletionPolicy;
    if (n.commit) {
      // Copy only the server-created repository, never follow filesystem links.
      const check = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isSymbolicLink()) fail("Ссылка в проекте превью"); if (e.isDirectory()) check(p); } };
      check(repo(n)); fs.cpSync(repo(n), repo(copy), { recursive: true, dereference: false });
    }
    return copy;
  };
  const route = (method, endpoint, b) => {
    if (method === "GET" && endpoint === "/api/preview/snapshot") {
      if (!/^[a-f0-9]{64}$/.test(b.key || "")) fail("Снимок не найден", 404);
      try { return json(safe("snapshots", b.key + ".json")); } catch (e) { if (Array.isArray(e)) throw e; fail("Снимок не найден", 404); }
    }
    if (method === "GET" && endpoint === "/api/preview") { const n = get(b.id); return { ...publicNode(n), files: n.commit ? files(n) : null, savedState: n.commit ? version(n).savedState ?? null : null }; }
    if (method !== "POST") fail("Метод не поддерживается", 405);
    if (endpoint === "/api/preview/prepare") {
      const source = state().nodes.find(n => n.id === b.sourceId && ["root", "q", "idea"].includes(n.kind));
      if (!source) fail("Источник не найден", 404);
      const branches = b.branches || [];
      if (!Array.isArray(branches) || branches.length > 100 || new Set(branches).size !== branches.length || branches.some(id => !state().nodes.some(n => n.id === id && n.parentId === "root" && n.kind !== "preview"))) fail("Выберите ветки превью");
      if (source.id === "root" && !branches.length) fail("Выберите ветки превью");
      const existing = b.id ? get(b.id) : null;
      if (existing?.job) fail("Превью уже в очереди", 409);
      if (all().filter(n => n.job).length >= 20) fail("Слишком много заданий превью", 409);
      git(directory, ["--version"]);
      let n = existing;
      if (n && n.sourceId !== source.id && !sources(source.id).some(x => x.id === n.sourceId)) fail("Превью из другой линии", 409);
      if (n && n.sourceId !== source.id) {
        const line = sources(source.id), pathIds = new Set();
        for (let at = source; at && at.id !== n.sourceId; at = state().nodes.find(x => x.id === at.parentId)) if (at.parentId) pathIds.add(at.parentId);
        const branched = line.some(x => pathIds.has(x.id) && state().nodes.filter(y => y.kind === "q" && y.parentId === x.id).length > 1);
        if (branched) { n = fork(n, source.id); state().nodes.push(n); }
      }
      if (!n) { n = { id: "p" + randomUUID(), projectId: randomUUID(), kind: "preview", parentId: source.id, sourceId: source.id, branches, q: translate("Превью"), versions: [] }; state().nodes.push(n); }
      n.sourceId = source.id; n.branches = branches; queue(n, "prepare"); return { ok: true, id: n.id };
    }
    const n = get(b.id);
    if (endpoint === "/api/preview/build") {
      if (n.job || !n.question) fail("Дождитесь вариантов превью", 409);
      if (all().filter(n => n.job).length >= 20) fail("Слишком много заданий превью", 409);
      const request = text(b.request, 3000); if (!request) fail("Опишите превью");
      n.request = request; queue(n, "build"); return { ok: true };
    }
    if (endpoint === "/api/preview/policy") { if (!["keep", "delete"].includes(b.policy)) fail("Выберите судьбу превью"); n.deletionPolicy = b.policy; save(); return { ok: true }; }
    if (endpoint === "/api/preview/delete") {
      if (b.confirm !== true) fail("Подтвердите удаление превью");
      const dir = repo(n), parent = all().find(p => p.projectId === n.forkOf);
      if (parent) parent.forkedBranches = [...new Set([...(parent.forkedBranches || []), n.forkBranchId])];
      state().nodes = state().nodes.filter(x => x.id !== n.id); state().queue = state().queue.filter(e => e.id !== n.id); save(); return { ok: true };
    }
    if (endpoint === "/api/preview/save") {
      if (!b.state || typeof b.state !== "object" || Array.isArray(b.state) || JSON.stringify(b.state).length > 60000 || Buffer.byteLength(JSON.stringify(b.state)) > 65536 || Object.values(b.state).some(v => v !== null && !["string", "number", "boolean"].includes(typeof v) || typeof v === "number" && !Number.isFinite(v))) fail("Некорректное состояние превью");
      // A still-open previous version remains saveable after publication. Never write
      // its values into the currently selected version's state slot.
      const v = version(n, b.commit || ""); v.savedState = b.state; v.stateRevision++; save(); return { ok: true, stateRevision: v.stateRevision };
    }
    if (b.epoch !== (n.epoch || 0) || b.commit !== n.commit) fail("Версия превью изменилась", 409);
    if (endpoint === "/api/preview/restore") { const target = version(n, b.target); n.commit = b.target; n.q = target.purpose; n.epoch = (n.epoch || 0) + 1; delete n.job; state().queue = state().queue.filter(e => e.id !== n.id); save(); return { ok: true }; }
    fail("Операция превью не найдена", 404);
  };
  const publicNode = n => ({ ...n, stale: stale(n), versions: commits(n).map(({ savedState, sources, ...v }) => v), job: n.job ? { phase: n.job.phase, stage: n.job.stage } : null });
  const savedContext = (id, nodes = state().nodes) => {
    const line = new Set(sources(id, [], nodes).map(n => n.id));
    return nodes.filter(n => n.kind === "preview" && n.commit && line.has(n.sourceId || n.parentId) && (n.sourceId !== "root" || n.branches?.some(id => line.has(id)))).map(n => ({ id: n.id, commit: n.commit, state: n.snapshot ? json(safe("snapshots", n.snapshot + ".json")).savedState : version(n).savedState ?? null }));
  };
  recover();
  const branchCopies = nodes => {
    const copies = [];
    const next = nodes.map(n => n.kind === "preview" ? { ...n, forkedBranches: [...(n.forkedBranches || [])] } : n);
    const projects = next.filter(n => n.kind === "preview");
    for (const split of nodes.filter(n => n.kind === "q" || n.kind === "idea")) {
      const children = nodes.filter(q => q.kind === "q" && q.parentId === split.id);
      if (children.length < 2) continue;
      const chain = []; for (let at = split; at; at = nodes.find(n => n.id === at.parentId)) chain.push(at.id);
      const nearest = new Map();
      for (const n of projects.filter(n => n.commit && !n.orphaned && n.sourceId !== "root" && chain.includes(n.sourceId)).sort((a, b) => chain.indexOf(a.sourceId) - chain.indexOf(b.sourceId))) if (!nearest.has(n.originProjectId || n.projectId)) nearest.set(n.originProjectId || n.projectId, n);
      for (const n of nearest.values()) for (const child of children) {
        if (n.forkedBranches.includes(child.id)) continue;
        if (!projects.concat(copies).some(p => p.forkOf === n.projectId && p.forkBranchId === child.id)) copies.push(fork(n, child.id));
        n.forkedBranches.push(child.id);
      }
    }
    return [...next, ...copies];
  };
  const cleanup = () => {
    if (!fs.existsSync(safe())) return;
    const archived = (state().archive || []).flatMap(a => a.node ? [a.node] : a.nodes || []).filter(n => n.kind === "preview");
    const live = new Set([...all(), ...archived].map(n => n.projectId));
    for (const name of fs.readdirSync(root)) if (idPattern.test(name) && !live.has(name)) {
      const dir = safe(name); noLinks(dir); fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  return { payload, apply, route, publicNode, snapshot, reconcile, recover, savedContext, all, branchCopies, cleanup };
}
