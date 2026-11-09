// Project knowledge: editable Markdown, content versions and recoverable writes.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

export const digest = text => createHash("sha256").update(text).digest("hex");
const limit = 200000;
const excludedDirectories = new Set([".git", ".grill", "node_modules", "examples"]);
const generatedDirectories = new Set(["target", "build", "dist", "out", "coverage", ".next", ".nuxt", ".cache", ".venv", "venv", "__pycache__"]);
const fail = message => { throw new Error(message); };
const bounded = (s, n) => typeof s === "string" && s.trim() && s.length <= n;
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const atomic = (file, text) => {
  const tmp = file + "." + randomUUID() + ".tmp";
  fs.writeFileSync(tmp, text, { flag: "wx" });
  try { fs.renameSync(tmp, file); } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
};

export function knowledge(project, maps) {
  project = path.resolve(project); maps = path.resolve(maps);
  const runtime = path.join(project, ".grill", "knowledge-ops");
  // All generated destinations are fixed or restricted relative paths. Never follow links.
  function safe(root, relative, create = false) {
    if (!relative || relative.includes("\\") || relative.split("/").some(p => !p || p === "." || p === ".." || /[:\x00-\x1f]/.test(p))) fail("Недопустимый путь знаний");
    let current = root;
    const parts = relative.split("/");
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      let stat;
      try { stat = fs.lstatSync(current); } catch (e) {
        if (e.code !== "ENOENT") throw e;
        if (i < parts.length - 1 && create) {
          try { fs.mkdirSync(current); } catch (mkdirError) { if (mkdirError.code !== "EEXIST") throw mkdirError; }
          const created = fs.lstatSync(current);
          if (created.isSymbolicLink() || !created.isDirectory()) fail("Путь знаний должен содержать обычные файлы и каталоги");
        }
        continue;
      }
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) fail("Путь знаний должен содержать обычные файлы и каталоги");
    }
    return current;
  }
  const lockFile = path.join(runtime, "lock.json");
  function locked(fn) {
    safe(project, ".grill/knowledge-ops/placeholder", true);
    const owner = { pid: process.pid, id: randomUUID() };
    try { fs.writeFileSync(lockFile, JSON.stringify(owner), { flag: "wx" }); }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      const reclaim = path.join(runtime, "reclaim");
      try { fs.mkdirSync(reclaim); } catch { fail("База знаний занята другой картой"); }
      try {
        // Re-read under the exclusive reclaim guard: another process may have replaced the dead owner.
        let old;
        try { old = json(lockFile); } catch (readError) {
          if (readError.code !== "ENOENT") fail("База знаний занята другой картой");
        }
        if (old) {
          if (!Number.isInteger(old.pid) || old.pid <= 0) fail("Повреждена блокировка знаний");
          try { process.kill(old.pid, 0); fail("База знаний занята другой картой"); }
          catch (probe) { if (probe.code !== "ESRCH") throw probe; }
          fs.unlinkSync(lockFile);
        }
        fs.writeFileSync(lockFile, JSON.stringify(owner), { flag: "wx" });
      } finally { fs.rmdirSync(reclaim); }
    }
    try { return fn(); } finally { if (json(lockFile).id === owner.id) fs.unlinkSync(lockFile); }
  }
  function read(relative) {
    const file = safe(project, relative);
    if (!fs.existsSync(file)) return { path: relative, version: null, text: null };
    if (fs.statSync(file).size > limit * 4) fail("Документ знаний слишком большой");
    const text = fs.readFileSync(file, "utf8");
    if (text.length > limit) fail("Документ знаний слишком большой");
    return { path: relative, version: digest(text), text };
  }
  function mapSource(relative) {
    const local = path.relative(maps, path.resolve(project, relative)).replaceAll("\\", "/");
    if (!/^(?:[a-z0-9][a-z0-9-]{0,39}\/)?state\.json$/.test(local)) fail("Недопустимый путь знаний");
    const file = safe(maps, local);
    if (fs.statSync(file).size > 8000000) fail("Документ знаний слишком большой");
    return json(file);
  }
  function parse(text) {
    const match = text.match(/^<!-- vgril:1 -->\r?\n```json\r?\n([\s\S]*?)\r?\n```\r?\n/);
    if (!match) fail("Не удалось разобрать документ знаний: исходный файл сохранён");
    const record = JSON.parse(match[1]);
    if (!bounded(record.id, 100) || !["term", "technical", "decision", "hypothesis", "idea", "note"].includes(record.type) || !["current", "superseded", "conflict"].includes(record.status) || !bounded(record.scope, 200) || !Array.isArray(record.sources) || !record.sources.length) fail("Некорректные метаданные знаний");
    return record;
  }
  function scan() {
    const documents = [], warnings = [], mapList = [];
    let visited = 0;
    function walk(relative, depth = 0) {
      if (depth > 12) { warnings.push(`Depth limit: ${relative}`); return; }
      const dir = relative ? path.join(project, relative) : project;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (e) { warnings.push(`${relative || "."}: ${e.code || "Error"}: ${e.message}`); return; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) continue;
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        const inDocs = relative.toLowerCase() === "docs" || relative.toLowerCase().startsWith("docs/");
        if (entry.isDirectory() && (path.resolve(dir, entry.name) === maps || excludedDirectories.has(entry.name.toLowerCase()) || !inDocs && generatedDirectories.has(entry.name.toLowerCase()))) continue;
        if (++visited > 10000) fail("Индекс превышает 10000 объектов; сузьте документацию проекта");
        if (entry.isDirectory()) walk(rel, depth + 1);
        else if (entry.isFile() && /\.(md|mdx|rst|txt)$/i.test(entry.name)) {
          if (documents.length >= 1000) fail("Индекс превышает 1000 документов");
          try {
            const item = read(rel), lines = item.text.split(/\r?\n/);
            const headings = lines.filter(l => /^#{1,3} /.test(l)).slice(0, 5).join(" · ").slice(0, 300);
            const description = lines.filter(l => l.trim() && !/^(#|<!--|```|[{}])/ .test(l)).join(" ").slice(0, 300);
            const links = [...item.text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)].slice(0, 100).map(m => {
              const target = m[1];
              if (/^https?:/i.test(target)) return { target, available: null, localOnly: /127\.0\.0\.1|localhost/.test(target) };
              if (/^[a-z]+:/i.test(target) || path.isAbsolute(target)) return { target, available: false };
              const resolved = path.resolve(path.dirname(path.join(project, rel)), target.split("#")[0]);
              return { target, available: resolved.startsWith(project + path.sep) && fs.existsSync(resolved) };
            });
            let record, error;
            if (item.text.startsWith("<!-- vgril:")) { try { record = parse(item.text); } catch (e) { error = e.message; } }
            const sources = (record?.sources || []).map(s => {
              let available = false, versionMatches = false;
              try {
                if (s.card) {
                  const node = mapSource(s.path).nodes?.find(n => n.id === s.card);
                  available = !!node;
                  if (node) {
                    const { discuss, discussToken, discussRevision, pending, analysis, ...normalized } = node;
                    if (normalized.job) { const { stage, token, ...job } = normalized.job; normalized.job = job; }
                    if (normalized.chat) normalized.chat = normalized.chat.map(({ readAt, ...m }) => m);
                    if (pending) normalized.pending = { answer: pending.answer, at: pending.at };
                    versionMatches = [digest(JSON.stringify(node)), digest(JSON.stringify(normalized))].includes(s.version);
                  }
                } else {
                  const source = read(s.path); available = source.text !== null; versionMatches = source.version === s.version;
                }
              } catch {}
              return { path: s.path, card: s.card || null, version: s.version, available, versionMatches, localOnly: !!s.card, snapshot: !!s.snapshot };
            });
            documents.push({ path: rel, version: item.version, headings, description, links, sources, ...(record ? { id: record.id, type: record.type, scope: record.scope, status: record.status } : {}), ...(error ? { error } : {}) });
          } catch (e) { warnings.push(`${rel}: ${e.message}`); }
        }
      }
    }
    walk("");
    for (const dir of [maps, ...fs.readdirSync(maps, { withFileTypes: true }).filter(e => e.isDirectory() && /^[a-z0-9][a-z0-9-]{0,39}$/.test(e.name)).map(e => path.join(maps, e.name))]) {
      try {
        const file = safe(dir, "state.json"), s = json(file);
        mapList.push({ name: dir === maps ? null : path.basename(dir), title: s.title, version: s.version, source: path.relative(project, file).replaceAll("\\", "/"), finished: !!s.finished });
      } catch {}
    }
    const content = { schema: 1, documents, maps: mapList, warnings };
    const result = { ...content, revision: digest(JSON.stringify(content)) };
    atomic(safe(project, ".grill/knowledge-index.json", true), JSON.stringify(result, null, 2));
    return result;
  }
  // Never overwrite an editor's target. A journal and original backups survive interruption.
  // Editors holding an old file descriptor can still write to the retained backup.
  function recover() {
    const journalFile = path.join(runtime, "pending.json");
    if (!fs.existsSync(journalFile)) return;
    const job = json(journalFile);
    for (let i = 0; i < job.files.length; i++) {
      const op = job.files[i], file = safe(project, op.path, true), backup = path.join(runtime, `${job.id}-${i}.before`);
      const current = read(op.path);
      if (current.version === digest(op.text)) continue;
      if (current.version !== op.expected && !(current.version === null && fs.existsSync(backup))) fail(`Конфликт версии: ${op.path}. Операция сохранена для повтора`);
      if (fs.existsSync(backup) && digest(fs.readFileSync(backup, "utf8")) !== op.expected) fail(`Ручная правка сохранена: ${backup}`);
      if (current.version !== null) {
        if (fs.existsSync(backup)) fail(`Нужна сверка резервной копии: ${op.path}`);
        fs.renameSync(file, backup);
        if (digest(fs.readFileSync(backup, "utf8")) !== op.expected) {
          fs.copyFileSync(backup, file, fs.constants.COPYFILE_EXCL);
          fail(`Конфликт версии: ${op.path}`);
        }
      }
      fs.writeFileSync(file, op.text, { flag: "wx" });
    }
    if (scan().warnings.length) fail("Документы изменились или недоступны; перечитайте индекс и повторите сохранение");
    fs.renameSync(journalFile, path.join(runtime, `${job.id}.done.json`));
  }
  function index() { return locked(() => {
    safe(project, "docs/vgril/placeholder", true);
    const result = scan();
    if (fs.existsSync(path.join(runtime, "pending.json"))) result.warnings.push("Незавершённая запись знаний: повторите сохранение в исходной карте");
    return result;
  }); }
  function reconcile(operation) {
    return locked(() => {
      const file = path.join(runtime, "pending.json");
      if (!fs.existsSync(file)) return;
      const job = json(file);
      if (operation && job.id !== operation) fail("Незавершённая запись знаний принадлежит другой карте");
      // Preserve partial results and every backup; the next delivery reads and reconciles them.
      for (let i = 0; i < job.files.length; i++) {
        const op = job.files[i], target = safe(project, op.path, true), backup = path.join(runtime, `${job.id}-${i}.before`);
        if (!fs.existsSync(target) && fs.existsSync(backup)) fs.copyFileSync(backup, target, fs.constants.COPYFILE_EXCL);
      }
      fs.renameSync(file, path.join(runtime, `${job.id}.conflict.json`));
    });
  }
  function commit(files, validatedSources = [], expectedRevision, operation = randomUUID()) {
    if (!Array.isArray(files) || files.length > 30) fail("Не более 30 документов знаний за операцию");
    return locked(() => {
      if (fs.existsSync(path.join(runtime, "pending.json"))) fail("Незавершённая запись знаний: повторите сохранение в исходной карте");
      const navigation = scan();
      if (navigation.warnings.length) fail("Документы изменились или недоступны; перечитайте индекс и повторите сохранение");
      if (expectedRevision && digest(JSON.stringify(navigation.documents)) !== expectedRevision) fail("Документы изменились или недоступны; перечитайте индекс и повторите сохранение");
      const seen = new Set();
      for (const op of files) {
        if (!op || !/^docs\/vgril\/(?!specs\/)[a-z0-9][a-z0-9/-]*\.md$/.test(op.path) || seen.has(op.path) || !bounded(op.text, limit)) fail("Некорректный документ знаний");
        seen.add(op.path);
        const current = read(op.path), record = parse(op.text);
        if (current.version !== op.expected) fail(`Конфликт версии: ${op.path}`);
        if (current.text !== null && parse(current.text).id !== record.id) fail("Нельзя заменять чужой документ знаний");
        if (record.sources.some(s => !bounded(s.snapshot, 30000) || !bounded(s.version, 100) || !bounded(s.path, 500))) fail("Нужны версии и снимки источников");
        const oldSources = current.text ? parse(current.text).sources : [];
        for (const source of record.sources) {
          if (oldSources.some(s => JSON.stringify(s) === JSON.stringify(source))) continue;
          if (source.card) {
            // The server validates current-map snapshots; archived maps use their raw saved nodes.
            if (validatedSources.includes(JSON.stringify(source))) continue;
            const state = mapSource(source.path);
            const node = state.nodes?.find(n => n.id === source.card);
            if (!node || JSON.stringify(node) !== source.snapshot || digest(source.snapshot) !== source.version) fail("Архивный источник изменился");
          } else {
            const document = read(source.path);
            if (document.version !== source.version || !document.text?.includes(source.snapshot)) fail("Источник документа изменился");
          }
        }
      }
      const existing = navigation.documents.filter(d => d.id && !seen.has(d.path));
      const ids = files.map(o => parse(o.text).id);
      if (new Set(ids).size !== ids.length || existing.some(d => ids.includes(d.id))) fail("Идентификатор знаний уже существует");
      const id = operation;
      atomic(path.join(runtime, "pending.json"), JSON.stringify({ id, files }, null, 2));
      recover();
      return { operation: id, paths: files.map(f => f.path) };
    });
  }
  function author() {
    try { return execFileSync("git", ["config", "--get", "user.name"], { cwd: project, encoding: "utf8", timeout: 3000, windowsHide: true }).trim().slice(0, 200) || null; } catch { return null; }
  }
  function migrateSpec(state, name) {
    return locked(() => {
      const target = `docs/vgril/specs/grill-${name || "legacy"}.md`;
      if (state.specFile === target) return { path: target, migrated: false };
      if (state.specFile !== `docs/specs/grill-${name || "legacy"}.md`) fail("Неизвестный путь старой спеки");
      const source = read(state.specFile);
      if (!source.text) return { path: target, migrated: false };
      const marker = `<!-- grill-owner: ${state.specOwner} -->`;
      if (source.text.split(/\r?\n/, 1)[0] !== marker) fail("Файл спеки принадлежит другому документу");
      // Rebase relative references. Keep the original as a compatibility copy for incoming links.
      const text = source.text.replace(/(\[[^\]]*\]\()([^\s)]+)(\))/g, (all, before, link, after) => {
        if (/^(?:[a-z]+:|\/|#)/i.test(link)) return all;
        const [file, anchor] = link.split("#");
        const resolved = path.resolve(project, path.dirname(state.specFile), file);
        const rebased = path.relative(path.resolve(project, path.dirname(target)), resolved).replaceAll("\\", "/");
        return before + rebased + (anchor === undefined ? "" : "#" + anchor) + after;
      });
      const dest = read(target);
      if (dest.text !== null && dest.text !== text) fail("Коллизия при переносе спеки");
      if (dest.text === null) fs.writeFileSync(safe(project, target, true), text, { flag: "wx" });
      if (read(state.specFile).version !== source.version || read(target).text !== text) fail("Файл изменился при переносе спеки; обе копии сохранены");
      return { path: target, migrated: true, retained: state.specFile, version: digest(text) };
    });
  }
  return { index, read, parse, commit, author, safe, locked, reconcile, migrateSpec };
}
