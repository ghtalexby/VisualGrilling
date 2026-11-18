// Offline, aggregate-only audit. Never copies transcript content into its output.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const keys = ["input", "cached", "uncached", "output", "reasoning"];
const zero = () => Object.fromEntries(keys.map(key => [key, 0]));
const count = n => Number.isSafeInteger(n) && n >= 0;
const maxLine = 4 * 1024 * 1024;
function usage(value) {
  if (!value) return null;
  const { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning } = value;
  if (![input, cached, output, reasoning].every(count) || cached > input || reasoning > output) return null;
  return { input, cached, uncached: input - cached, output, reasoning };
}
function add(total, value) {
  for (const key of keys) {
    total[key] += value[key];
    if (!count(total[key])) throw new Error("Сумма счётчиков превышает безопасный диапазон.");
  }
}
// Bound memory even when a transcript contains a huge single line. Capture the
// initial file size so concurrent appends cannot extend this audit indefinitely.
async function* lines(file) {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    let offset = 0, parts = [], length = 0, oversized = false;
    const buffer = Buffer.alloc(64 * 1024);
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!bytesRead) break;
      offset += bytesRead;
      let start = 0;
      for (let i = 0; i < bytesRead; i++) if (buffer[i] === 10) {
        length += i - start;
        if (length > maxLine) oversized = true;
        if (!oversized) parts.push(Buffer.from(buffer.subarray(start, i)));
        yield oversized ? null : Buffer.concat(parts).toString("utf8");
        parts = []; length = 0; oversized = false; start = i + 1;
      }
      length += bytesRead - start;
      if (length > maxLine) { oversized = true; parts = []; }
      if (!oversized) parts.push(Buffer.from(buffer.subarray(start, bytesRead)));
    }
    // A non-newline-terminated record may still be being written.
    if (length || oversized) yield null;
  } finally { await handle.close(); }
}
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19) ? time : NaN;
}
async function discover(home, before) {
  const entries = new Map(), diagnostics = { unreadableDirectories: 0, invalidMetadata: 0, unreadableFiles: 0 };
  async function walk(directory) {
    let children;
    try { children = await fs.readdir(directory, { withFileTypes: true }); }
    catch { diagnostics.unreadableDirectories++; return; }
    for (const child of children) {
      const file = path.join(directory, child.name);
      if (child.isDirectory()) { await walk(file); continue; }
      if (!child.isFile() || !child.name.startsWith("rollout-") || !child.name.endsWith(".jsonl")) continue;
      try {
        let found = false;
        for await (const line of lines(file)) {
          found = true;
          let record; try { record = JSON.parse(line); } catch { /* handled below */ }
          const p = record?.payload;
          if (record?.type !== "session_meta" || !uuid.test(p?.id || "")) { diagnostics.invalidMetadata++; break; }
          const time = timestamp(record.timestamp || p.timestamp);
          if (!Number.isFinite(time)) { diagnostics.invalidMetadata++; break; }
          if (time >= before) break;
          const id = p.id.toLowerCase();
          const rawParent = p.parent_thread_id || p.source?.subagent?.thread_spawn?.parent_thread_id;
          const parent = uuid.test(rawParent || "") ? rawParent.toLowerCase() : null;
          if (rawParent && !parent) diagnostics.invalidMetadata++;
          const entry = entries.get(id) || { id, parents: new Set(), files: [] };
          if (parent) entry.parents.add(parent);
          entry.files.push(file); entries.set(id, entry);
          break;
        }
        if (!found) diagnostics.invalidMetadata++;
      } catch { diagnostics.unreadableFiles++; }
    }
  }
  await walk(path.join(home, "sessions"));
  return { entries, diagnostics };
}
async function readThread(entry, before) {
  const result = { id: entry.id, source: "missing", complete: false, modelResponses: null, observedModelResponses: 0,
    tokens: null, duplicateResponses: 0, invalidRecords: 0, unreadableFiles: 0, conflictingResponses: 0 };
  const seen = new Map(); let legacy = null, legacyTime = -Infinity;
  for (const file of entry.files) {
    try {
      for await (const line of lines(file)) {
        if (line === null) { result.invalidRecords++; continue; }
        let record; try { record = JSON.parse(line); } catch { result.invalidRecords++; continue; }
        if (record.type !== "token_usage_record" && !(record.type === "event_msg" && record.payload?.type === "token_count")) continue;
        const time = timestamp(record.timestamp);
        if (!Number.isFinite(time)) { result.invalidRecords++; continue; }
        if (time >= before) continue;
        const p = record.payload;
        if (record.type === "token_usage_record") {
          const value = usage(p?.usage);
          if (p?.thread_id?.toLowerCase() !== entry.id || typeof p.response_id !== "string" || !p.response_id || !value) { result.invalidRecords++; continue; }
          if (seen.has(p.response_id)) {
            result.duplicateResponses++;
            if (JSON.stringify(seen.get(p.response_id)) !== JSON.stringify(value)) result.conflictingResponses++;
          } else seen.set(p.response_id, value);
        } else {
          const value = usage(p.info?.total_token_usage);
          if (!value) { result.invalidRecords++; continue; }
          if (time > legacyTime) { legacy = value; legacyTime = time; }
        }
      }
    } catch { result.unreadableFiles++; }
  }
  if (seen.size) {
    result.source = "response-records"; result.tokens = zero();
    for (const value of seen.values()) add(result.tokens, value);
    result.modelResponses = result.observedModelResponses = seen.size;
  } else if (legacy) { result.source = "legacy-token-count"; result.tokens = legacy; }
  result.complete = result.tokens !== null && !result.invalidRecords && !result.unreadableFiles && !result.conflictingResponses && entry.parents.size <= 1;
  return result;
}
function aggregate(threads, discoveryComplete = true) {
  const result = { sessions: threads.length, availableSessions: 0, complete: discoveryComplete && threads.every(t => t.complete),
    modelResponses: discoveryComplete && threads.every(t => t.modelResponses !== null && t.complete) ? 0 : null,
    observedModelResponses: 0, tokens: zero() };
  for (const thread of threads) {
    result.observedModelResponses += thread.observedModelResponses;
    if (thread.tokens) { add(result.tokens, thread.tokens); result.availableSessions++; }
    if (result.modelResponses !== null) result.modelResponses += thread.modelResponses;
  }
  if (threads.length && !result.availableSessions) result.tokens = null;
  return result;
}
function correlationCounters(state, recent, sessionIds) {
  const tasks = Array.isArray(state.actionTasks) ? state.actionTasks : [];
  const traces = new Map(); let untracedEntries = 0;
  // The snapshot can contain the same delivery in both collections. Do not
  // infer any correspondence for historical rows without a stable trace UUID.
  for (const row of [...recent, ...tasks]) {
    if (!row || !uuid.test(row.deliveryTraceId || "")) { untracedEntries++; continue; }
    const id = row.deliveryTraceId.toLowerCase(), previous = traces.get(id);
    traces.set(id, { ...previous, ...row, workerSessionIds: [...new Set([
      ...(Array.isArray(previous?.workerSessionIds) ? previous.workerSessionIds : []),
      ...(Array.isArray(row.workerSessionIds) ? row.workerSessionIds : [])].filter(v => typeof v === "string" && uuid.test(v)).map(v => v.toLowerCase()))] });
  }
  const workers = new Map(), changes = { status: 0, answer: 0, topology: 0, verdictText: 0 };
  const statuses = Object.fromEntries(["open", "observed", "missing-start", "missing-end", "session-changed", "counter-reset", "incomplete-tree", "interrupted", "unknown"].map(k => [k, 0]));
  let mapped = 0, actionLinked = 0, caused = 0, revisionKnown = 0, live = 0, frozen = 0;
  for (const trace of traces.values()) {
    if (trace.workerAttribution === "declared" && trace.workerSessionIds.length) {
      mapped++;
      for (const id of trace.workerSessionIds) workers.set(id, (workers.get(id) || 0) + 1);
    }
    if (Array.isArray(trace.actionIds) && trace.actionIds.length) actionLinked++;
    if (Array.isArray(trace.causes) && trace.causes.some(c => c && typeof c.kind === "string" && c.kind !== "unknown")) caused++;
    if (typeof trace.mapRevision === "string" && trace.mapRevision.length) revisionKnown++;
    if (trace.contextScope === "live") live++;
    if (trace.contextScope === "frozen") frozen++;
    const status = Object.hasOwn(statuses, trace.usageDeltaStatus) ? trace.usageDeltaStatus : "unknown";
    statuses[status]++;
    for (const key of Object.keys(changes)) {
      const n = trace.committedChanges?.[key]?.count;
      if (count(n) && count(changes[key] + n)) changes[key] += n;
    }
  }
  return { attribution: "declared-not-verified-ownership", tracedDeliveries: traces.size, untracedEntries,
    mappedDeliveries: mapped, unmappedDeliveries: traces.size - mapped, actionLinkedDeliveries: actionLinked,
    deliveriesWithKnownCause: caused, deliveriesWithRevision: revisionKnown, liveDeliveries: live, frozenDeliveries: frozen,
    usageDeltaStatuses: statuses, committedChanges: changes,
    workers: [...workers].sort(([a], [b]) => a.localeCompare(b)).map(([id, deliveries]) => ({ id, deliveries, inObservedSessionTree: sessionIds.has(id) })) };
}
async function stateCounters(file, sessionIds) {
  if (!file) return null;
  const stat = await fs.stat(file);
  if (stat.size > 64 * 1024 * 1024) throw new Error("Снимок состояния превышает 64 МиБ.");
  const state = JSON.parse(await fs.readFile(file, "utf8")), stats = state.contextStats;
  const totals = stats?.totals && typeof stats.totals === "object" ? Object.values(stats.totals) : [];
  const recent = Array.isArray(stats?.recent) ? stats.recent : [];
  const sum = key => {
    const value = totals.length && totals.every(t => count(t?.[key])) ? totals.reduce((n, t) => n + t[key], 0) : null;
    return count(value) ? value : null;
  };
  return { scope: "supplied-snapshot-not-cutoff-filtered", cliRequests: sum("requests"), events: sum("count"),
    serializedCharacters: sum("characters"), recentEntries: recent.length,
    recentWithoutClosingUsage: recent.filter(t => !t?.usageEnd || !t?.usage).length,
    correlations: correlationCounters(state, recent, sessionIds) };
}
export async function auditSession({ session, codexHome, before, state }) {
  const cutoff = timestamp(before);
  if (!uuid.test(session || "") || !codexHome || !Number.isFinite(cutoff)) throw new Error("Нужны UUID, каталог Codex и --before в формате UTC ISO (Z).");
  session = session.toLowerCase();
  const { entries, diagnostics } = await discover(codexHome, cutoff);
  const ids = new Set([session]);
  for (let size = -1; size !== ids.size;) {
    size = ids.size;
    for (const entry of entries.values()) if ([...entry.parents].some(id => ids.has(id))) ids.add(entry.id);
  }
  const threads = [];
  for (const id of [...ids].sort()) threads.push(await readThread(entries.get(id) || { id, files: [], parents: new Set() }, cutoff));
  const parent = threads.find(t => t.id === session), workers = threads.filter(t => t.id !== session);
  const discoveryComplete = Object.values(diagnostics).every(n => n === 0);
  return { schemaVersion: 1, session, before, cutoff: "exclusive", scope: "metadata-linked-session-tree",
    discovery: { complete: discoveryComplete, ...diagnostics }, complete: discoveryComplete && threads.every(t => t.complete),
    parent: aggregate([parent]), workers: aggregate(workers, discoveryComplete), total: aggregate(threads, discoveryComplete), threads,
    state: await stateCounters(state, ids),
    limitations: ["Observed telemetry only; missing sessions cannot be inferred without metadata links.",
      "Cached input is part of input; reasoning is part of output. Counts are not billing or savings estimates.",
      "Legacy cumulative token counts have unknown response counts; mixed formats prefer response records.",
      "Supplied state counters are observational and may span other sessions; use a snapshot captured at the cutoff."] };
}
export async function run(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = { "--session": "session", "--codex-home": "codexHome", "--before": "before", "--state": "state", "--output": "output" }[argv[i]];
    if (!key || !argv[i + 1] || options[key]) throw new Error("Неверные или повторные параметры аудита.");
    options[key] = argv[i + 1];
  }
  if (!options.output || !options.output.endsWith(".json")) throw new Error("Укажите новый файл --output NEW.json.");
  const report = await auditSession(options);
  await fs.writeFile(options.output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then(() => console.log("Агрегированный аудит сохранён."))
    .catch(error => { console.error(error.code === "EEXIST" ? "Файл результата уже существует; перезапись запрещена." : "Аудит не выполнен: проверьте параметры и доступность данных."); process.exitCode = 1; });
}
