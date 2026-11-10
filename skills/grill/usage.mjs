// Read only aggregate usage from the bound Codex session's local rollout.
// Rollout format is internal: unsupported/missing records mean unavailable.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  async function update() {
    try {
      const binding = JSON.parse(await fs.readFile(path.join(base, "agent-connection.json"), "utf8"));
      if (binding.provider !== "codex" || !UUID.test(binding.id || "")) return cached = null;
      const home = binding.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
      const nextKey = JSON.stringify([home, binding.id]);
      if (key !== nextKey) { key = nextKey; file = null; searched = 0; cached = null; }
      if (!file && Date.now() - searched >= 10000) {
        searched = Date.now();
        file = await locate(path.join(home, "sessions"), binding.id);
      }
      if (!file) return cached = null;
      const handle = await fs.open(file, "r");
      let data;
      try {
        const stat = await handle.stat(), start = Math.max(0, stat.size - LIMIT);
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
        const fields = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"];
        if (!fields.every(k => Number.isSafeInteger(total[k]) && total[k] >= 0)) return cached = null;
        return cached = { provider: "codex", scope: "session", ...Object.fromEntries(fields.map(k => [k, total[k]])) };
      }
      return cached = null;
    } catch { file = null; return cached = null; }
  }
  return () => {
    if (pending) return pending;
    if (Date.now() - checked < 1000) return Promise.resolve(cached);
    pending = update().finally(() => { checked = Date.now(); pending = null; });
    return pending;
  };
}
