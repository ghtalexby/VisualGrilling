// Read only aggregate usage from the bound Codex session's local rollout.
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

export function sessionUsage(base) {
  let key, file, searched = 0, checked = 0, cached = null, pending;
  let offset = 0, remainder = "", seen = new Set(), totals = null, lastInput, fileIdentity;
  const reset = () => { offset = 0; remainder = ""; seen = new Set(); totals = null; lastInput = undefined; fileIdentity = undefined; };
  async function update() {
    try {
      const binding = JSON.parse(await fs.readFile(path.join(base, "agent-connection.json"), "utf8"));
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
  return read;
}
