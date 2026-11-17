import assert from "node:assert/strict";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createCodexAdapter, CodexRpc } from "../skills/grill/hub/codex.mjs";

const self = fileURLToPath(import.meta.url);
if (process.argv[2] === "--fake") {
  const mode = process.argv[3]; let authenticated = mode !== "login";
  const send = value => process.stdout.write(JSON.stringify(value) + "\n");
  readline.createInterface({ input: process.stdin }).on("line", line => {
    const { id, method, params } = JSON.parse(line);
    if (!method || id === undefined) return;
    if (mode === "timeout" && method !== "initialize") return;
    if (method === "thread/read" && mode === "absent") return send({ id, error: { code: -32600, message: "no rollout found for thread id absent" } });
    if (method === "thread/read" && mode === "unknown") return send({ id, error: { code: -32603, message: "Storage inaccessible" } });
    const thread = { id: "thread-1", cwd: process.cwd(), status: { type: mode === "busy" ? "active" : "idle" } };
    let result = {};
    if (method === "thread/read" || method === "thread/start" || method === "thread/resume") result = { thread };
    if (method === "account/read") result = { account: authenticated ? { type: "chatgpt" } : null, requiresOpenaiAuth: true };
    if (method === "account/login/start") { authenticated = true; result = { type: "chatgpt", authUrl: "https://auth.openai.com/example", loginId: "login-1" }; }
    if (method === "turn/start") result = { turn: { id: "turn-1", status: "inProgress" } };
    if (method === "thread/turns/list") result = { data: [{ id: "turn-1", items: [{ type: "userMessage", content: [{ type: "text", text: "hello" }] }] }], nextCursor: null };
    send({ id, result });
    if (method === "turn/start" && mode === "approval") send({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", turnId: "turn-1", command: "example" } });
  });
} else {
  const adapter = mode => createCodexAdapter({ command: process.execPath, args: [self, "--fake", mode], timeoutMs: 2000 });
  const binding = { provider: "codex", id: "thread-1" };
  const spec = { boardId: "board-1", epoch: 4, cwd: process.cwd(), prompt: "Continue the existing map; preserve its data." };
  for (const [mode, expected] of [["normal", "available"], ["busy", "busy"], ["absent", "absent"], ["unknown", "unknown"]]) {
    const a = adapter(mode); assert.equal((await a.probeBinding(binding)).status, expected); await a.close();
  }
  for (const mode of ["normal", "busy", "unknown"]) {
    const a = adapter(mode); await assert.rejects(a.startOwned({ ...spec, previousBinding: binding }), /fallback refused/); await a.close();
  }
  const a = adapter("normal");
  const [first, second] = await Promise.all([a.startOwned(spec), a.startOwned(spec)]);
  assert.equal(first.threadId, second.threadId); assert.equal(first.status, "working"); assert.equal(first.owned, true);
  assert.equal((await a.readChat(spec.boardId)).data[0].id, "turn-1");
  await assert.rejects(a.sendChat(spec.boardId, "duplicate"), /not idle/);
  await a.stopOwned(spec.boardId); assert.equal(a.getState(spec.boardId).status, "stopped"); await a.close();
  const external = adapter("normal"); await external.resume(binding, spec);
  await assert.rejects(external.resume(binding, { ...spec, boardId: "wrong-project", cwd: "C:/different-project" }), /different or unknown project/);
  await assert.rejects(external.resume(binding, { ...spec, boardId: "another-board" }), /already serves another board/);
  assert.equal((await external.stopOwned(spec.boardId)).preserved, true);
  assert.equal(external.getState(spec.boardId).status, "working");
  assert.equal((await external.stop(spec.boardId)).preserved, true); await external.close();
  const approval = adapter("approval"); await approval.startOwned(spec);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(approval.getState(spec.boardId).status, "waiting_permission");
  assert.equal(approval.getState(spec.boardId).requests.length, 1);
  assert.throws(() => approval.resolveRequest("other-board", "approval-1", { decision: "accept" }), /unavailable/);
  approval.resolveRequest(spec.boardId, "approval-1", { decision: "decline" });
  assert.equal(approval.getState(spec.boardId).requests.length, 0); await approval.close();
  const login = adapter("login"); assert.equal((await login.startOwned(spec)).status, "waiting_login");
  assert.equal((await login.login(spec.boardId)).loginId, "login-1");
  assert.equal((await login.login(spec.boardId)).status, "working"); await login.close();
  const rpc = new CodexRpc({ command: process.execPath, args: [self, "--fake", "timeout"], timeoutMs: 100 });
  await rpc.initialize(); await assert.rejects(rpc.request("account/read"), /timed out/); rpc.close();
  let queued = 0, warning = false;
  const fallback = createCodexAdapter({ command: process.execPath, args: [self, "--fake", "normal"], timeoutMs: 2000,
    async execFile(command, args) { queued++; assert.ok(args.includes("queue")); assert.ok(args.includes("--resume")); return { stderr: warning ? "warning: resume failed" : "" }; } });
  const connect = fallback.connect.bind(fallback);
  fallback.connect = async (binding, owned, session) => { if (!owned) throw new Error("Unsupported proxy transport"); return connect(binding, owned, session); };
  assert.equal((await fallback.probeBinding(binding)).transport, "queue");
  const pending = await fallback.resume(binding, spec); assert.equal(pending.status, "starting"); assert.equal(pending.owned, false); assert.equal(queued, 1);
  assert.equal((await fallback.stop(spec.boardId)).preserved, true);
  warning = true; await assert.rejects(fallback.resume(binding, spec), /warning/);
  assert.equal(fallback.getState(spec.boardId).status, "error"); assert.equal(queued, 2);
  await assert.rejects(fallback.resume(binding, spec), /unresolved/); assert.equal(queued, 2);
  await fallback.close();
  console.log("Hub Codex adapter checks passed (fake protocol; no model turns billed).");
}
