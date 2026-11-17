// Codex app-server protocol, verified against the local 0.169.0 generated schemas.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const MAX = 4 * 1024 * 1024;
const copy = value => JSON.parse(JSON.stringify(value));
export function resolveCodexCommand(command, args = []) {
  // Resolve the npm wrapper to the actual child we own, so Windows Stop cannot
  // kill just node.exe and leave its Codex subprocess serving the board.
  const roots = [];
  if (args[0] && /[\\/]codex[\\/]bin[\\/]codex\.js$/i.test(args[0])) roots.push(path.dirname(path.dirname(args[0])));
  if (!command && process.env.CODEX_MANAGED_PACKAGE_ROOT) roots.push(process.env.CODEX_MANAGED_PACKAGE_ROOT);
  if (!command) for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const executable = path.join(dir, process.platform === "win32" ? "codex.exe" : "codex");
    if (fs.existsSync(executable)) return { command: executable, args };
    roots.push(path.join(dir, "node_modules", "@openai", "codex"));
  }
  if (process.platform === "win32") for (const root of roots) {
    const triple = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    let vendor = path.join(root, "vendor");
    try { vendor = path.join(path.dirname(createRequire(path.join(root, "package.json")).resolve(`@openai/codex-win32-${process.arch}/package.json`)), "vendor"); } catch {}
    const executable = path.join(vendor, triple, "bin", "codex.exe");
    if (fs.existsSync(executable)) return { command: executable, args: command ? args.slice(1) : args };
  }
  if (command) return { command, args };
  throw new Error("Codex executable not found; install Codex or configure its executable");
}
export class CodexRpcError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export class CodexRpc {
  constructor({ command, args = [], cwd, env, timeoutMs = 15000, spawnProcess = spawn, onMessage = () => {}, onClose = () => {} }) {
    this.pending = new Map(); this.sequence = 0; this.buffer = ""; this.closed = false; this.timeoutMs = timeoutMs;
    const childEnv = { ...process.env, ...env };
    for (const key of ["CODEX_THREAD_ID", "CODEX_SESSION_ID", "CODEX_TOOL_CALL_ID", "CODEX_DAEMON_SHUTDOWN_SOCKET", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]) delete childEnv[key];
    this.child = spawnProcess(command, args, { cwd, env: childEnv, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.exited = new Promise(resolve => { this.child.once("exit", resolve); this.child.once("error", resolve); });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", chunk => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > MAX) return this.fail(new Error("Codex protocol buffer exceeded"));
      let index;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { this.fail(new Error("Invalid Codex protocol JSON")); return; }
        if (message.id !== undefined && !message.method) {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          clearTimeout(pending.timer); this.pending.delete(message.id);
          if (message.error) pending.reject(new CodexRpcError(message.error.message, message.error.code));
          else pending.resolve(message.result);
        } else onMessage(message);
      }
    });
    // Drain diagnostics without retaining credentials or unlimited output.
    this.child.stderr.on("data", () => {});
    this.child.stdin.on("error", error => this.fail(error));
    this.child.on("error", error => this.fail(error));
    this.child.on("exit", () => this.fail(new Error("Codex transport closed")));
    this.onClose = onClose;
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.child.kill(); this.onClose?.(error);
  }
  send(message) {
    if (this.closed) throw new Error("Codex transport closed");
    const line = JSON.stringify(message) + "\n";
    if (Buffer.byteLength(line) > MAX) throw new Error("Codex request too large");
    this.child.stdin.write(line);
  }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("Codex transport closed"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex request timed out: ${method}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async initialize() {
    await this.request("initialize", { clientInfo: { name: "visual_grilling_hub", version: "1.0.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
    this.send({ method: "initialized" }); return this;
  }
  close() { this.fail(new Error("Codex transport closed")); }
}

export function createCodexAdapter(options = {}) { return new CodexAdapter(options); }
export class CodexAdapter {
  constructor(options = {}) { this.options = options; this.sessions = new Map(); this.launches = new Map(); }
  emit(session, patch) {
    Object.assign(session.state, patch, { lastCheckedAt: Date.now() });
    this.options.onState?.(session.state.boardId, copy(session.state));
  }
  async connect(binding, owned, session) {
    const executable = resolveCodexCommand(binding?.command || this.options.command, binding?.args || this.options.args || []);
    const rpc = new CodexRpc({ ...this.options, command: executable.command, args: [...executable.args, "app-server", owned ? "--stdio" : "proxy"],
      env: binding?.codexHome ? { CODEX_HOME: binding.codexHome } : undefined,
      onMessage: message => session && this.message(session, message),
      onClose: error => { if (session && session.state.status !== "stopped") this.emit(session, { status: "error", error: error.message, requests: [] }); }
    });
    try { await rpc.initialize(); return rpc; } catch (error) { rpc.close(); throw error; }
  }
  async probeBinding(binding) {
    if (!binding) return { status: "absent", reason: "unbound" };
    if (binding.provider !== "codex" || typeof (binding.id || binding.threadId) !== "string") return { status: "unknown", reason: "Invalid binding" };
    let rpc;
    try {
      rpc = await this.connect(binding, binding.owned === true);
      const { thread } = await rpc.request("thread/read", { threadId: binding.id || binding.threadId, includeTurns: false });
      if (!thread || thread.id !== (binding.id || binding.threadId)) return { status: "unknown", reason: "Thread identity mismatch" };
      const type = thread.status?.type;
      return { status: type === "active" ? "busy" : ["idle", "notLoaded"].includes(type) ? "available" : "unknown", thread };
    } catch (error) {
      // Only the protocol's explicit missing-thread response permits fallback.
      const missing = error instanceof CodexRpcError && error.code === -32600 && /^no rollout found for thread id /i.test(error.message);
      if (missing) return { status: "absent", reason: error.message };
      if (binding.owned === true) return { status: "unknown", reason: error.message };
      // Some desktop versions expose a control proxy with a different transport.
      // A dedicated read-only app-server can verify persisted thread identity;
      // only the queue command may then ask its original host to resume it.
      let reader;
      try {
        reader = await this.connect(binding, true);
        const { thread } = await reader.request("thread/read", { threadId: binding.id || binding.threadId, includeTurns: false });
        if (thread?.id !== (binding.id || binding.threadId)) throw new Error("Thread identity mismatch");
        const type = thread.status?.type;
        return { status: type === "active" ? "busy" : ["idle", "notLoaded"].includes(type) ? "available" : "unknown", transport: "queue", thread };
      } catch (failure) {
        const absent = failure instanceof CodexRpcError && failure.code === -32600 && /^no rollout found for thread id /i.test(failure.message);
        return { status: absent ? "absent" : "unknown", reason: failure.message };
      } finally { reader?.close(); }
    } finally { rpc?.close(); }
  }
  runOnce(boardId, action) {
    if (this.launches.has(boardId)) return this.launches.get(boardId);
    const pending = action().finally(() => this.launches.delete(boardId)); this.launches.set(boardId, pending); return pending;
  }
  resume(binding, spec) {
    return this.runOnce(spec.boardId, async () => {
      const probe = await this.probeBinding(binding);
      if (probe.status !== "available") throw new Error(`Codex session ${probe.status}: ${probe.reason || "not idle"}`);
      const sameCwd = (a, b) => typeof a === "string" && typeof b === "string" && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
      const relocated = sameCwd(spec.relocation?.from, probe.thread.cwd) && sameCwd(spec.relocation?.to, spec.cwd) && !fs.existsSync(spec.relocation.from);
      if (!sameCwd(probe.thread.cwd, spec.cwd) && !relocated) throw new Error("Codex session belongs to a different or unknown project");
      if (relocated && probe.transport === "queue") throw new Error("Verified project relocation requires a Codex control transport with cwd support; the queue-only terminal is preserved");
      for (const session of this.sessions.values()) if (session.state.boardId !== spec.boardId && session.state.threadId === probe.thread.id && session.state.status !== "stopped") throw new Error("Codex session already serves another board");
      if (probe.transport === "queue") return this.launchQueued(binding, spec);
      return this.launch(binding, spec, binding.owned === true);
    });
  }
  async launchQueued(binding, spec) {
    const existing = this.sessions.get(spec.boardId);
    if (existing && existing.state.status !== "stopped") throw new Error("Previous queue request is unresolved; Stop before retrying");
    const session = { state: { boardId: spec.boardId, epoch: spec.epoch, provider: "codex", owned: false, transport: "queue", status: "starting", requests: [], id: binding.id || binding.threadId, threadId: binding.id || binding.threadId }, spec, pending: new Map(), rpc: null };
    this.sessions.set(spec.boardId, session); this.emit(session, {});
    const executable = resolveCodexCommand(binding.command || this.options.command, binding.args || this.options.args || []);
    const env = { ...process.env, ...(binding.codexHome ? { CODEX_HOME: binding.codexHome } : {}) };
    for (const key of ["CODEX_THREAD_ID", "CODEX_SESSION_ID", "CODEX_TOOL_CALL_ID", "CODEX_DAEMON_SHUTDOWN_SOCKET"]) delete env[key];
    try {
      const run = this.options.execFile || promisify(execFile);
      const result = await run(executable.command, [...executable.args, "queue", "--thread", session.state.threadId, "--message", spec.prompt, "--resume"], { cwd: spec.cwd, env, timeout: this.options.timeoutMs || 15000, maxBuffer: 32768, windowsHide: true });
      if (/warn|error|fail/i.test(result.stderr || "")) throw new Error("Codex queue reported a warning; delivery is unconfirmed");
      // A receipt is deliberately still starting. Runtime attachment/listening
      // is the only evidence that this board is receiving events.
      return this.getState(spec.boardId);
    } catch (error) { session.ambiguousTurn = true; this.emit(session, { status: "error", error: error.message }); throw error; }
  }
  startOwned(spec) {
    return this.runOnce(spec.boardId, async () => {
      const probe = await this.probeBinding(spec.previousBinding);
      if (probe.status !== "absent") throw new Error(`Codex background fallback refused: ${probe.status}`);
      return this.launch(null, spec, true);
    });
  }
  async launch(binding, spec, owned) {
    const existing = this.sessions.get(spec.boardId);
    if (existing && !["stopped", "error"].includes(existing.state.status)) return this.getState(spec.boardId);
    if (existing && existing.state.status === "error" && !existing.rpc?.closed) throw new Error("Codex previous session is ambiguous; stop it before retrying");
    const session = { state: { boardId: spec.boardId, epoch: spec.epoch, provider: "codex", owned, status: "starting", requests: [], id: binding?.id || binding?.threadId || null, threadId: binding?.id || binding?.threadId || null }, spec, pending: new Map(), rpc: null };
    this.sessions.set(spec.boardId, session); this.emit(session, {});
    try {
      session.rpc = await this.connect(binding, owned, session);
      const account = await session.rpc.request("account/read", { refreshToken: false });
      if (account.requiresOpenaiAuth && !account.account) { this.emit(session, { status: "waiting_login" }); return this.getState(spec.boardId); }
      return await this.begin(session);
    } catch (error) { this.emit(session, { status: "error", error: error.message }); throw error; }
  }
  async begin(session) {
    if (session.beginning) return session.beginning;
    session.beginning = this.beginSession(session).finally(() => { session.beginning = null; });
    return session.beginning;
  }
  async beginSession(session) {
    if (session.state.status === "stopped") throw new Error("Codex launch stopped");
    const { state, rpc, spec } = session;
    const result = state.threadId
      ? await rpc.request("thread/resume", { threadId: state.threadId, excludeTurns: true, ...(spec.relocation ? { cwd: spec.cwd } : {}) })
      : await rpc.request("thread/start", { cwd: spec.cwd });
    if (state.threadId && result.thread?.id !== state.threadId) throw new Error("Codex resumed thread identity mismatch");
    if (spec.relocation && (typeof result.thread?.cwd !== "string" || path.resolve(result.thread.cwd).toLowerCase() !== path.resolve(spec.cwd).toLowerCase())) throw new Error("Codex did not accept the verified project relocation");
    if (result.thread?.status?.type === "active") throw new Error("Codex session became busy; no input sent");
    if (state.threadId && !["idle", "notLoaded"].includes(result.thread?.status?.type)) throw new Error("Codex resumed session state is unknown; no input sent");
    this.emit(session, { id: result.thread.id, threadId: result.thread.id, status: "idle" });
    await this.sendChat(state.boardId, spec.prompt);
    return this.getState(state.boardId);
  }
  message(session, message) {
    if (session.state.status === "stopped") return;
    const { method, params = {}, id } = message;
    if (params.threadId && params.threadId !== session.state.threadId) return;
    if (id !== undefined) {
      if (session.pending.size >= 100) { session.rpc?.close(); return; }
      const request = { id, method, params }; session.pending.set(String(id), request);
      const status = /AuthTokens|login/i.test(method) ? "waiting_login" : /Approval/.test(method) ? "waiting_permission" : "waiting_input";
      this.emit(session, { status, requests: [...session.pending.values()] }); this.options.onRequest?.(session.state.boardId, copy(request));
    } else if (method === "turn/started") this.emit(session, { status: "working", turnId: params.turn?.id });
    else if (method === "turn/completed") this.emit(session, { status: params.turn?.status === "failed" ? "error" : "idle", turnId: null, error: params.turn?.error?.message || null });
    else if (method === "account/login/completed") {
      this.emit(session, { status: params.success ? "starting" : "waiting_login", login: null, error: params.error || null });
      if (params.success) this.begin(session).catch(error => this.emit(session, { status: "error", error: error.message }));
    }
  }
  session(boardId) { const value = this.sessions.get(boardId); if (!value || !value.rpc || value.rpc.closed) throw new Error("Codex session unavailable"); return value; }
  getState(boardId) { const session = this.sessions.get(boardId); return session ? copy(session.state) : null; }
  canReadChat(boardId) { const session = this.sessions.get(boardId); return !!session?.rpc && !session.rpc.closed; }
  async readChat(boardId, cursor = null) {
    const session = this.session(boardId);
    if (!session.state.threadId) return { data: [], nextCursor: null, state: this.getState(boardId) };
    const history = await session.rpc.request("thread/turns/list", { threadId: session.state.threadId, cursor, limit: 30, itemsView: "full" });
    return { ...history, state: this.getState(boardId) };
  }
  async sendChat(boardId, text) {
    if (typeof text !== "string" || !text.trim() || text.length > 100000) throw new Error("Invalid chat message");
    const session = this.session(boardId);
    if (session.sending || session.state.status !== "idle") throw new Error("Codex session is not idle");
    session.sending = true;
    try {
      const result = await session.rpc.request("turn/start", { threadId: session.state.threadId, input: [{ type: "text", text, text_elements: [] }] });
      session.ownedTurnId = result.turn.id;
      if (!["waiting_permission", "waiting_input", "waiting_login"].includes(session.state.status)) this.emit(session, { status: "working", turnId: result.turn.id });
      return result;
    } catch (error) {
      session.ambiguousTurn = true;
      this.emit(session, { status: "error", error: error.message }); throw error;
    } finally { session.sending = false; }
  }
  resolveRequest(boardId, requestId, result) {
    const session = this.session(boardId), request = session.pending.get(String(requestId));
    if (!request) throw new Error("Codex request expired");
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid Codex response");
    session.rpc.send({ id: request.id, result }); session.pending.delete(String(requestId));
    this.emit(session, { requests: [...session.pending.values()], status: session.pending.size ? session.state.status : "working" });
    return this.getState(boardId);
  }
  async login(boardId) {
    const session = this.session(boardId);
    if (!["waiting_login", "starting"].includes(session.state.status)) throw new Error("Codex session is not waiting for login");
    const account = await session.rpc.request("account/read", { refreshToken: false });
    if (account.account || !account.requiresOpenaiAuth) return this.begin(session);
    const login = await session.rpc.request("account/login/start", { type: "chatgpt" });
    this.emit(session, { status: "waiting_login", login }); return login;
  }
  async stopOwned(boardId) {
    const session = this.sessions.get(boardId);
    if (session && !session.state.owned) return { stopped: false, preserved: true };
    return this.stop(boardId);
  }
  async stop(boardId) {
    // The service fences map writes before calling this; never interrupt an unrelated turn.
    if (this.launches.has(boardId)) { try { await this.launches.get(boardId); } catch {} }
    const session = this.sessions.get(boardId);
    if (!session) return { stopped: true, preserved: true };
    let error = !session.state.owned && session.ambiguousTurn ? "Codex turn start was ambiguous; map must remain fenced" : null;
    if (!session.state.owned && session.ownedTurnId && session.state.turnId === session.ownedTurnId && !session.rpc?.closed) {
      try { await session.rpc.request("turn/interrupt", { threadId: session.state.threadId, turnId: session.ownedTurnId }); } catch (failure) { error = failure.message; }
    }
    this.emit(session, { status: "stopped", requests: [], turnId: null }); session.pending.clear(); session.rpc?.close();
    if (session.state.owned && session.rpc?.exited) {
      let timer;
      const exited = await Promise.race([session.rpc.exited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
      clearTimeout(timer);
      if (!exited) error = "Owned Codex process did not exit";
    }
    return { stopped: !error, preserved: !session.state.owned, ...(error ? { error } : {}) };
  }
  async close() { await Promise.all([...new Set([...this.sessions.keys(), ...this.launches.keys()])].map(id => this.stop(id))); }
}
