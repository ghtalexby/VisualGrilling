import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual, createHash } from "node:crypto";
import { spawn } from "node:child_process";

export const MAX_FRAME = 512 * 1024;
const methods = new Set(["list", "open", "play", "stop", "rebind", "chat", "sendChat", "login", "approval"]);
const fail = (message, code = "INVALID_REQUEST") => Object.assign(new Error(message), { code });
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.length <= 256 && b.length <= 256 && timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > MAX_FRAME) throw fail("Response exceeds native message limit", "RESPONSE_TOO_LARGE");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

export async function* messages(input) {
  let pending = Buffer.alloc(0);
  for await (const chunk of input) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt32LE(0);
      if (!length || length > MAX_FRAME) throw fail("Invalid native frame length");
      if (pending.length < length + 4) break;
      let message;
      try { message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(pending.subarray(4, length + 4))); }
      catch { throw fail("Malformed native JSON"); }
      pending = pending.subarray(length + 4);
      yield message;
    }
  }
  if (pending.length) throw fail("Truncated native frame");
}

export function validate(message, config, origin) {
  if (origin !== `chrome-extension://${config.extensionId}/`) throw fail("Untrusted native caller", "FORBIDDEN");
  if (!message || typeof message !== "object" || Array.isArray(message) || message.v !== 1 || typeof message.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(message.id)) throw fail("Invalid request envelope");
  if (message.method === "bind") return;
  if (!same(message.secret, config.secret) || !same(message.epoch, config.epoch) || !same(message.installationId, config.installationId)) throw fail("Run the installer or bind again", "REBIND_REQUIRED");
  if (!methods.has(message.method)) throw fail("Unsupported method");
  const params = message.params ?? {};
  if (!params || typeof params !== "object" || Array.isArray(params) || JSON.stringify(params).length > 128 * 1024) throw fail("Invalid parameters");
  if (message.method !== "list" && (typeof params.boardId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(params.boardId))) throw fail("Invalid board ID");
  if (message.method === "rebind" && (typeof params.dir !== "string" || !params.dir || params.dir.length > 32767 || /[\x00-\x1f]/.test(params.dir))) throw fail("Invalid board directory");
}

export function readConfig(configPath) {
  const c = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  if (!/^[a-p]{32}$/.test(c.extensionId) || !/^[a-f0-9]{64}$/.test(c.secret) || !/^[a-zA-Z0-9-]{1,80}$/.test(c.epoch) || !/^[a-zA-Z0-9-]{1,80}$/.test(c.installationId)) throw fail("Invalid installation credentials", "INSTALLATION_BROKEN");
  for (const name of ["nodePath", "servicePath", "dataDir"]) if (typeof c[name] !== "string" || !path.isAbsolute(c[name])) throw fail("Invalid installation path", "INSTALLATION_BROKEN");
  return c;
}

async function request(config, endpoint, route, body) {
  const response = await fetch(`http://127.0.0.1:${endpoint.port}${route}`, {
    method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(body ? 120000 : 1500),
    headers: { "x-grill": "1", authorization: `Bearer ${config.secret}`, "x-grill-epoch": config.epoch, origin: `chrome-extension://${config.extensionId}/`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.length;
    if (bytes > MAX_FRAME - 1024) { await reader.cancel(); throw fail("Hub response exceeds limit", "RESPONSE_TOO_LARGE"); }
    chunks.push(value);
  }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!response.ok) throw fail(result.error?.message || result.error || "Hub command failed", result.error?.code || "HUB_ERROR");
  return result;
}

export async function ensureService(config, configPath) {
  async function probe() {
    try {
      const endpoint = JSON.parse(fs.readFileSync(path.join(config.dataDir, "endpoint.json"), "utf8"));
      if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || endpoint.installationId !== config.installationId || endpoint.epoch !== config.epoch) return null;
      const health = await request(config, endpoint, "/api/health");
      return health.installationId === config.installationId && health.epoch === config.epoch ? endpoint : null;
    } catch { return null; }
  }
  let endpoint = await probe();
  if (endpoint) return endpoint;
  // The daemon owns its process-lifetime singleton lock; concurrent launchers may safely race.
  const child = spawn(config.nodePath, [config.servicePath, "--config", configPath], { detached: true, windowsHide: true, stdio: "ignore", shell: false });
  let spawnError;
  child.on("error", error => { spawnError = error; });
  child.unref();
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (spawnError) throw fail("Cannot launch local Hub; rerun the installer", "HUB_UNAVAILABLE");
    endpoint = await probe(); if (endpoint) return endpoint;
  }
  throw fail("Local Hub did not become ready; rerun the installer", "HUB_UNAVAILABLE");
}

export async function dispatch(message, configPath, origin, proxy = async (c, m) => request(c, await ensureService(c, configPath), "/api/command", { method: m.method, params: m.params ?? {} })) {
  try {
    // Reload on every command so an already connected native process cannot retain revoked credentials.
    const config = readConfig(configPath);
    validate(message, config, origin);
    const result = message.method === "bind" ? { installationId: config.installationId, secret: config.secret, epoch: config.epoch } : await proxy(config, message);
    return { v: 1, id: message.id, ok: true, result };
  } catch (error) {
    return { v: 1, id: typeof message?.id === "string" ? message.id.slice(0, 80) : null, ok: false, error: { code: error.code || "HUB_ERROR", message: String(error.message).slice(0, 1000) } };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const configPath = args[args.indexOf("--config") + 1];
  const origin = args[args.indexOf("--origin") + 1];
  const config = readConfig(configPath);
  if (origin !== `chrome-extension://${config.extensionId}/`) throw fail("Untrusted native caller");
  for await (const message of messages(process.stdin)) {
    const output = frame(await dispatch(message, configPath, origin));
    if (!process.stdout.write(output)) await new Promise(resolve => process.stdout.once("drain", resolve));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`Hub: ${error.message}\n`); process.exitCode = 1; });
