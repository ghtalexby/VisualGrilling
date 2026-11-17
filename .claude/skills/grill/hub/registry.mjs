import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const hubHome = () => path.resolve(process.env.GRILL_HUB_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "VisualGrilling", "Hub"));
const read = file => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const canonical = dir => fs.realpathSync(path.resolve(dir));
function atomic(file, value) {
  const tmp = file + "." + randomUUID() + ".tmp";
  try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function locked(fn) {
  const home = hubHome(); fs.mkdirSync(path.join(home, "boards"), { recursive: true });
  const lock = path.join(home, "registry.lock"), token = randomUUID();
  const prepared = path.join(home, "registry-lock-" + token), owner = "owner-" + token + ".json";
  fs.mkdirSync(prepared);
  fs.writeFileSync(path.join(prepared, owner), JSON.stringify({ pid: process.pid, token }), { flag: "wx" });
  const until = Date.now() + 10000;
  try {
    for (;;) {
      try { fs.renameSync(prepared, lock); break; }
      catch (e) {
        if (!["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(e.code)) throw e;
        // Publish the complete owner directory atomically. A dead owner's unique
        // marker can be removed once; competing reclaimers cannot delete a new lock.
        let entries = [];
        try { entries = fs.readdirSync(lock); } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (!entries.length) {
          // A crash between marker removal and rmdir leaves an empty directory.
          // Never recurse: a replacement owner's populated directory must survive.
          try { fs.rmdirSync(lock); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes(error.code)) throw error; }
        }
        if (entries.length === 1 && /^owner-[0-9a-f-]+\.json$/.test(entries[0])) {
          const marker = path.join(lock, entries[0]);
          let holder; try { holder = read(marker); } catch {}
          let dead = false;
          if (Number.isSafeInteger(holder?.pid) && holder.pid > 0) {
            try { process.kill(holder.pid, 0); } catch (error) { dead = error.code === "ESRCH"; }
          }
          if (dead) {
            try { fs.unlinkSync(marker); try { fs.rmdirSync(lock); } catch {} } catch (error) { if (error.code !== "ENOENT") throw error; }
            continue;
          }
        }
        if (Date.now() >= until) throw new Error("Registry is locked by another writer");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
    try { return fn(); }
    finally { fs.unlinkSync(path.join(lock, owner)); try { fs.rmdirSync(lock); } catch (e) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e.code)) throw e; } }
  } finally { if (fs.existsSync(prepared)) { fs.unlinkSync(path.join(prepared, owner)); fs.rmdirSync(prepared); } }
}
const recordFile = id => { if (!uuid.test(id || "")) throw new Error("Invalid board ID"); return path.join(hubHome(), "boards", id + ".json"); };
function inspect(record) {
  if (!record) return null;
  const identity = read(path.join(record.dir, "board.json"));
  const missing = identity?.id !== record.id;
  let state = null, readError = null;
  try { state = missing ? null : read(path.join(record.dir, "state.json")); } catch (e) { readError = e.message; }
  const counts = { open: 0, closed: 0 };
  for (const n of state?.nodes || []) if (n.kind === "q" && !n.obsolete) {
    if (n.status === "ok") counts.closed++;
    else if (["open", "weak", "gap", "verify"].includes(n.status)) counts.open++;
  }
  return { ...record, ...(record.observation || {}), missing, ...(readError ? { readError } : {}), ...(state ? { title: state.title || "", finished: !!state.finished, counts } : {}) };
}
export function registerBoard({ dir, base, name = null, project, cli }) {
  return locked(() => {
    dir = canonical(dir); base = canonical(base || dir);
    const file = path.join(dir, "board.json");
    let identity = read(file);
    if (!identity) { identity = { id: randomUUID() }; atomic(file, identity); }
    if (!uuid.test(identity.id || "")) throw new Error("Invalid board identity");
    const previous = read(recordFile(identity.id));
    if (previous && !same(previous.dir, dir)) throw new Error("Board identity already registered elsewhere; use explicit rebind");
    const record = { ...previous, id: identity.id, dir, base, name, project: path.resolve(project || path.dirname(base)), cli: path.resolve(cli), registeredAt: previous?.registeredAt || Date.now(), updatedAt: Date.now() };
    const observed = inspect(record);
    if (observed.counts) record.observation = { ...record.observation, title: observed.title, finished: observed.finished, counts: observed.counts };
    atomic(recordFile(record.id), record); return inspect(record);
  });
}
export const getBoard = id => inspect(read(recordFile(id)));
export function listBoards() {
  const dir = path.join(hubHome(), "boards");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => uuid.test(file.slice(0, -5)) && file.endsWith(".json")).map(file => { try { return inspect(read(path.join(dir, file))); } catch (e) { return { id: file.slice(0, -5), unavailable: true, readError: e.message }; } }).filter(Boolean);
}
export function rebindBoard(id, dir) {
  return locked(() => {
    const record = read(recordFile(id)); if (!record) throw new Error("Board not registered");
    dir = canonical(dir);
    if (read(path.join(dir, "board.json"))?.id !== id) throw new Error("Board identity mismatch");
    if (!same(record.dir, dir) && fs.existsSync(record.dir)) throw new Error("Original board directory still exists");
    if (record.name !== null && path.basename(dir) !== record.name) throw new Error("Named board directory must retain its map name");
    const base = record.name === null ? dir : path.dirname(dir);
    atomic(recordFile(id), { ...record, dir, base, project: same(record.project, path.dirname(record.base)) ? path.dirname(base) : record.project, updatedAt: Date.now() });
    return getBoard(id);
  });
}
export function updateObservation(id, observation) {
  return locked(() => {
    const record = read(recordFile(id)); if (!record) throw new Error("Board not registered");
    atomic(recordFile(id), { ...record, observation: { ...observation }, updatedAt: Date.now() }); return getBoard(id);
  });
}
