// Read metadata and aggregate usage for the bound Codex session and its descendants.
// Rollout format is internal: unsupported/missing records mean unavailable.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"];
const valid = value => value && fields.every(k => Number.isSafeInteger(value[k]) && value[k] >= 0);
const LIMIT = 4 * 1024 * 1024;
async function locate(root, id, depth = 0) {
  if (depth > 3) return null;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(`-${id}.jsonl`)) return path.join(root, entry.name);
  }
  for (const entry of entries) {
    if (entry.isDirectory() && /^\d{2,4}$/.test(entry.name)) {
      const found = await locate(path.join(root, entry.name), id, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function threadUsage(resolveBinding) {
  let key, file, searched = 0, checked = 0, cached = null, pending;
  let offset = 0, remainder = "", seen = new Set(), totals = null, lastInput, fileIdentity;
  const reset = () => { offset = 0; remainder = ""; seen = new Set(); totals = null; lastInput = undefined; fileIdentity = undefined; };
  async function update() {
    try {
      const binding = await resolveBinding();
      if (binding.provider !== "codex" || !UUID.test(binding.id || "")) return cached = null;
      const home = binding.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
      const nextKey = JSON.stringify([home, binding.id]);
      if (key !== nextKey) { key = nextKey; file = null; searched = 0; cached = null; reset(); }
      if (!file && Date.now() - searched >= 10000) {
        searched = Date.now();
        file = await locate(path.join(home, "sessions"), binding.id);
      }
      if (!file) return cached = null;
      const handle = await fs.open(file, "r");
      let data;
      try {
        const stat = await handle.stat(), start = Math.max(0, stat.size - LIMIT);
        const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
        if (offset > stat.size || fileIdentity !== identity) reset();
        fileIdentity = identity;
        while (offset < stat.size) {
          const chunk = Buffer.alloc(Math.min(stat.size - offset, LIMIT));
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
          if (!bytesRead) break;
          offset += bytesRead;
          const lines = (remainder + chunk.toString("utf8", 0, bytesRead)).split("\n");
          remainder = lines.pop();
          // Usage records are ASCII; discard oversized transcript lines, never parse their contents.
          if (remainder.length > LIMIT) remainder = "";
          for (const line of lines) {
            if (!line.includes('"token_usage_record"')) continue;
            let record; try { record = JSON.parse(line); } catch { continue; }
            const p = record.payload;
            if (record.type !== "token_usage_record" || p?.thread_id !== binding.id || !valid(p.usage)) continue;
            if (typeof p.response_id !== "string" || !p.response_id) continue;
            if (seen.has(p.response_id)) continue;
            seen.add(p.response_id);
            totals ||= Object.fromEntries(fields.map(k => [k, 0]));
            for (const k of fields) totals[k] += p.usage[k];
            lastInput = p.usage.input_tokens;
          }
        }
        if (totals && valid(totals)) return cached = { provider: "codex", scope: "session", ...totals, last_input_tokens: lastInput };
        const buffer = Buffer.alloc(Math.min(stat.size, LIMIT));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        data = buffer.toString("utf8", 0, bytesRead);
        if (start) data = data.slice(data.indexOf("\n") + 1);
      } finally { await handle.close(); }
      const lines = data.split("\n");
      lines.pop(); // A writer may not have completed its last JSON line yet.
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"token_count"')) continue;
        let record;
        try { record = JSON.parse(lines[i]); } catch { continue; }
        if (record.type !== "event_msg" || record.payload?.type !== "token_count" || !record.payload.info) continue;
        const total = record.payload.info.total_token_usage;
        if (!total) return cached = null;
        if (!valid(total)) return cached = null;
        const latest = record.payload.info.last_token_usage?.input_tokens;
        let input = Number.isSafeInteger(latest) && latest >= 0 ? latest : undefined;
        if (input === undefined) {
          for (let j = i - 1; j >= 0; j--) {
            let previous; try { previous = JSON.parse(lines[j]); } catch { continue; }
            const old = previous.type === "event_msg" && previous.payload?.type === "token_count" && previous.payload.info?.total_token_usage;
            if (valid(old) && total.input_tokens > old.input_tokens) { input = total.input_tokens - old.input_tokens; break; }
          }
        }
        return cached = { provider: "codex", scope: "session", ...Object.fromEntries(fields.map(k => [k, total[k]])), ...(input === undefined ? {} : { last_input_tokens: input }) };
      }
      return cached = null;
    } catch { file = null; reset(); return cached = null; }
  }
  const read = () => {
    if (pending) return pending;
    if (Date.now() - checked < 1000) return Promise.resolve(cached);
    pending = update().finally(() => { checked = Date.now(); pending = null; });
    return pending;
  };
  read.identity = () => key;
  read.file = () => file;
  return read;
}

// Discover relationships from metadata only. Never infer ownership from cwd/time.
export function sessionUsage(base, name = null) {
  const binding = async () => JSON.parse(await fs.readFile(path.join(name === null ? base : path.join(base, name), "agent-connection.json"), "utf8"));
  const parent = threadUsage(binding), readers = new Map(), metadata = new Map();
  let identity, discovered = 0, descendants = [], discoveryComplete = false, discovery, pending;
  async function discover(home, rootId, parentFile) {
    const sessions = path.join(home, "sessions");
    const firstDay = parentFile ? path.relative(sessions, path.dirname(parentFile)).split(path.sep).join("/") : "";
    const lower = /^\d{4}\/\d{2}\/\d{2}$/.test(firstDay) ? firstDay : "";
    const links = new Map(); let complete = true;
    async function walk(directory, depth = 0) {
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); }
      catch { complete = false; return; }
      async function inspect(entry) {
        const file = path.join(directory, entry.name);
        if (!entry.isFile() || !entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) return;
        try {
          const stat = await fs.stat(file), stamp = `${stat.ino}:${stat.birthtimeMs}`;
          let meta = metadata.get(file);
          if (!meta || meta.stamp !== stamp) {
            const handle = await fs.open(file, "r"); let first;
            try {
              // Read only the first metadata line, preserving arbitrary JSON key order.
              const buffer = Buffer.alloc(256 * 1024); let length = 0, newline = -1;
              while (length < buffer.length && newline < 0) {
                const { bytesRead } = await handle.read(buffer, length, Math.min(8192, buffer.length - length), length);
                if (!bytesRead) break;
                newline = buffer.indexOf(10, length); length += bytesRead;
                if (newline >= length) newline = -1;
              }
              if (newline < 0) throw new Error("Incomplete session metadata");
              first = buffer.toString("utf8", 0, newline);
            } finally { await handle.close(); }
            const record = JSON.parse(first);
            if (record.type !== "session_meta") return;
            const id = record.payload?.id;
            const parentId = record.payload?.parent_thread_id || record.payload?.source?.subagent?.thread_spawn?.parent_thread_id;
            if (!UUID.test(id || "") || !entry.name.endsWith(`-${id}.jsonl`)) return;
            meta = { stamp, id, parentId }; metadata.set(file, meta);
          }
          if (UUID.test(meta.parentId || "")) links.set(meta.id, meta.parentId);
        } catch { complete = false; }
      }
      // Traverse directories sequentially so nested batches cannot multiply IO concurrency.
      for (const entry of entries) if (entry.isDirectory() && depth < 3 && /^\d{2,4}$/.test(entry.name)) {
        const child = path.join(directory, entry.name), day = path.relative(sessions, child).split(path.sep).join("/");
        // Codex stores newly created descendants on or after their parent creation day.
        if (lower && day < lower.slice(0, day.length)) continue;
        await walk(child, depth + 1);
      }
      const files = entries.filter(entry => entry.isFile());
      for (let i = 0; i < files.length; i += 16) await Promise.all(files.slice(i, i + 16).map(inspect));
    }
    await walk(path.join(home, "sessions"));
    const ids = new Set([rootId]);
    for (let size = -1; size !== ids.size;) { size = ids.size; for (const [id, parentId] of links) if (ids.has(parentId)) ids.add(id); }
    return { ids: [...ids].filter(id => id !== rootId), complete };
  }
  async function update() {
    const main = await parent(); if (!main) return null;
    let current; try { current = await binding(); } catch { return null; }
    const home = current.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const key = JSON.stringify([home, current.id]);
    if (key !== identity) { identity = key; readers.clear(); metadata.clear(); descendants = []; discovered = 0; discovery = null; discoveryComplete = false; }
    // Avoid mixing a parent read with a newly rebound child tree.
    if (parent.identity() !== key) return null;
    if (!discovery && Date.now() - discovered >= 10000) {
      const job = discover(home, current.id, parent.file()).then(result => {
        if (identity !== key) return;
        descendants = [...new Set([...descendants, ...result.ids])]; discoveryComplete = result.complete; discovered = Date.now();
      }).catch(() => { if (identity === key) { discoveryComplete = false; discovered = Date.now(); } })
        .finally(() => { if (discovery === job) discovery = null; });
      discovery = job;
    }
    // Telemetry must not hold server startup or API requests behind an archive scan.
    if (discovery) await Promise.race([discovery, new Promise(resolve => setTimeout(resolve, 100))]);
    if (identity !== key) return null;
    if (!descendants.length && discoveryComplete) return main;
    const workerUsage = Object.fromEntries(fields.map(k => [k, 0])); let available = 0;
    for (const id of descendants) {
      if (!readers.has(id)) readers.set(id, threadUsage(async () => ({ provider: "codex", id, codexHome: home })));
      const usage = await readers.get(id)(); if (!usage) continue;
      available++;
      for (const k of fields) workerUsage[k] += usage[k];
    }
    const combined = Object.fromEntries(fields.map(k => [k, main[k] + workerUsage[k]]));
    if (!valid(combined)) return null;
    return { ...main, ...combined, scope: "session-tree", tree: { workers: descendants.length, available,
      complete: discoveryComplete && available === descendants.length, parent: Object.fromEntries(fields.map(k => [k, main[k]])), workerUsage } };
  }
  const read = () => pending || (pending = update().finally(() => { pending = null; }));
  read.identity = () => parent.identity();
  return read;
}
