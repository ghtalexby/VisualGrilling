import assert from "node:assert/strict";
import readline from "node:readline";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createCodexAdapter, CodexRpc } from "../skills/grill/hub/codex.mjs";
import { agentObservation } from "../skills/grill/hub/service.mjs";

const self = fileURLToPath(import.meta.url);
if (process.argv[2] === "--fake") {
  const mode = process.argv[3];
  if (["owned", "queue-relocation"].includes(mode) && process.argv.includes("proxy")) process.exit(2);
  let authenticated = mode !== "login";
  const send = value => process.stdout.write(JSON.stringify(value) + "\n");
  readline.createInterface({ input: process.stdin }).on("line", line => {
    const { id, method, params } = JSON.parse(line);
    if (!method || id === undefined) return;
    if (mode === "timeout" && method !== "initialize") return;
    if (method === "thread/read" && mode === "absent") return send({ id, error: { code: -32600, message: "no rollout found for thread id absent" } });
    if (method === "thread/read" && mode === "unknown") return send({ id, error: { code: -32603, message: "Storage inaccessible" } });
    const thread = { id: "11111111-1111-4111-8111-111111111111", cwd: ["owned", "relocated"].includes(mode) && process.argv[4] !== "app-server" ? process.argv[4] : process.cwd(), status: { type: mode === "busy" ? "active" : "idle" } };
    if (mode === "queue-relocation") {
      const replacement = "22222222-2222-4222-8222-222222222222";
      thread.id = method === "thread/start" || params?.threadId === replacement ? replacement : thread.id;
      thread.cwd = thread.id === replacement ? process.argv[5] : process.argv[4];
      if (method === "thread/start") fs.appendFileSync(process.argv[6], "start\n");
    }
    if (method === "thread/resume" && params.cwd) thread.cwd = params.cwd;
    let result = {};
    if (method === "thread/read" || method === "thread/start" || method === "thread/resume") result = { thread };
    if (method === "account/read") result = { account: authenticated ? { type: "chatgpt" } : null, requiresOpenaiAuth: true };
    if (method === "account/login/start") { authenticated = true; result = { type: "chatgpt", authUrl: "https://auth.openai.com/example", loginId: "login-1" }; }
    if (method === "turn/start") result = { turn: { id: "turn-1", status: "inProgress" } };
    if (method === "thread/turns/list") result = { data: [{ id: "turn-1", items: [{ type: "userMessage", content: [{ type: "text", text: "hello" }] }] }], nextCursor: null };
    send({ id, result });
    if (method === "turn/start" && mode === "approval") send({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: "11111111-1111-4111-8111-111111111111", turnId: "turn-1", command: "example" } });
  });
} else {
  const adapter = mode => createCodexAdapter({ command: process.execPath, args: [self, "--fake", mode], timeoutMs: 2000 });
  const binding = { provider: "codex", id: "11111111-1111-4111-8111-111111111111" };
  const spec = { boardId: "board-1", epoch: 4, cwd: process.cwd(), prompt: "Continue the existing map; preserve its data." };
  // Exercise Stop while a terminal-backed turn/start has not answered yet.
  // A started notification is observable but does not prove turn ownership.
  for (const outcome of ["success", "close", "interrupt-failure", "completed", "unrelated"]) {
    const race = createCodexAdapter();
    let settle, interrupts = 0, closes = 0;
    const deferred = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    const session = { state: { boardId: spec.boardId, threadId: binding.id, owned: false, status: "idle" }, pending: new Map(), rpc: {
      closed: false,
      async request(method, params) {
        if (method === "turn/start") return deferred;
        assert.equal(method, "turn/interrupt"); assert.equal(params.turnId, "admitted-turn"); interrupts++;
        if (outcome === "interrupt-failure") throw new Error("interrupt rejected");
        return {};
      },
      close() { closes++; this.closed = true; }
    } };
    race.sessions.set(spec.boardId, session);
    const sending = race.sendChat(spec.boardId, "hello");
    const rejected = outcome === "close" ? assert.rejects(sending, /transport closed/) : sending;
    race.message(session, { method: "turn/started", params: { threadId: binding.id, turn: { id: "admitted-turn" } } });
    let stopped = false;
    const stopping = race.stop(spec.boardId).then(result => { stopped = true; return result; });
    await Promise.resolve();
    assert.equal(stopped, false); assert.equal(closes, 0); assert.equal(interrupts, 0);
    await assert.rejects(race.sendChat(spec.boardId, "too late"), /not idle/);
    if (outcome === "close") { session.rpc.closed = true; settle.reject(new Error("transport closed")); }
    else {
      if (["completed", "unrelated"].includes(outcome)) race.message(session, { method: "turn/completed", params: { threadId: binding.id, turn: { id: "admitted-turn", status: "completed" } } });
      if (outcome === "unrelated") race.message(session, { method: "turn/started", params: { threadId: binding.id, turn: { id: "other-task" } } });
      settle.resolve({ turn: { id: "admitted-turn" } });
    }
    await rejected;
    const result = await stopping;
    assert.equal(result.stopped, ["success", "completed", "unrelated"].includes(outcome));
    assert.equal(result.preserved, true); assert.equal(interrupts, ["close", "completed", "unrelated"].includes(outcome) ? 0 : 1);
    if (!result.stopped) assert.match(result.error, /ambiguous|interrupt rejected/);
    race.message(session, { method: "turn/started", params: { turn: { id: "late" } } });
    race.emit(session, { status: "error", error: "late callback" });
    assert.equal(race.getState(spec.boardId).status, "stopped");
    assert.deepEqual(await race.stop(spec.boardId), result, "Retry cannot turn an unconfirmed shutdown into success");
  }
  const exitTimeout = createCodexAdapter();
  exitTimeout.sessions.set(spec.boardId, { state: { boardId: spec.boardId, owned: true, status: "working" }, pending: new Map(), rpc: { exited: new Promise(() => {}), close() {} } });
  const failedExit = await exitTimeout.stop(spec.boardId);
  assert.equal(failedExit.stopped, false); assert.equal(failedExit.preserved, false); assert.match(failedExit.error, /did not exit/);
  for (const [mode, expected] of [["normal", "available"], ["busy", "busy"], ["absent", "absent"], ["unknown", "unknown"]]) {
    const a = adapter(mode); assert.equal((await a.probeBinding(binding)).status, expected); await a.close();
  }
  for (const mode of ["normal", "busy", "unknown"]) {
    const a = adapter(mode); await assert.rejects(a.startOwned({ ...spec, previousBinding: binding }), /fallback refused/); await a.close();
  }
  const owned = adapter("owned");
  const started = await owned.startOwned(spec);
  const firstChild = owned.sessions.get(spec.boardId).rpc.child;
  assert.equal((await owned.stop(spec.boardId)).preserved, false);
  await new Promise(resolve => firstChild.exitCode !== null || firstChild.signalCode !== null ? resolve() : firstChild.once("exit", resolve));
  const resumed = await owned.resume({ provider: "codex", id: started.threadId, owned: true }, spec);
  assert.equal(resumed.owned, true); assert.equal(resumed.threadId, started.threadId);
  assert.equal(owned.canReadChat(spec.boardId), true);
  const ownedState = owned.getState(spec.boardId);
  const liveBoard = { server: "running", hub: { managed: true, epoch: spec.epoch, attached: ownedState.threadId, connected: true, workActive: true } };
  const selected = { provider: "codex", id: ownedState.threadId };
  const oldWorking = { ...ownedState, lastCheckedAt: Date.now() - 16000 };
  assert.equal(agentObservation(liveBoard, oldWorking, selected, owned.canReadChat(spec.boardId)).connection, "connected", "A long active turn retains its verified live RPC proof");
  assert.equal(agentObservation({ ...liveBoard, hub: { ...liveBoard.hub, connected: false } }, oldWorking, selected, true).connection, "connected", "Long work outlives the runtime activity grace too");
  assert.equal(agentObservation(liveBoard, oldWorking, { provider: "codex", id: "22222222-2222-4222-8222-222222222222" }, true).threadId, ownedState.threadId, "The runtime attachment takes precedence over a stale binding");
  for (const phase of ["waiting_login", "waiting_permission"]) {
    const pendingState = { ...oldWorking, status: phase, ...(phase === "waiting_login" ? { threadId: null, id: null } : {}) };
    const pendingBoard = { ...liveBoard, hub: { ...liveBoard.hub, attached: null, paused: false } };
    const observation = agentObservation(pendingBoard, pendingState, { provider: "codex", id: "22222222-2222-4222-8222-222222222222" }, true);
    assert.equal(observation.agent, phase); assert.equal(observation.state, pendingState);
    assert.equal(observation.threadId, pendingState.threadId); assert.equal(observation.connection, "unconfirmed");
    assert.equal(observation.connected, false, "Login/approval remains actionable without claiming attachment");
  }
  assert.equal(agentObservation(liveBoard, { ...oldWorking, epoch: 3 }, selected, true).connection, "unconfirmed", "Old epoch cannot prove current work");
  assert.equal(agentObservation({ ...liveBoard, hub: { ...liveBoard.hub, workActive: false } }, oldWorking, selected, true).connection, "unconfirmed", "A live process alone is not board consumption");
  assert.equal((await owned.readChat(spec.boardId)).data[0].id, "turn-1");
  const secondChild = owned.sessions.get(spec.boardId).rpc.child;
  assert.notEqual(firstChild.pid, secondChild.pid);
  secondChild.kill();
  await new Promise(resolve => secondChild.exitCode !== null || secondChild.signalCode !== null ? resolve() : secondChild.once("exit", resolve));
  const failedState = owned.getState(spec.boardId);
  assert.equal(failedState.status, "error");
  const lingeringWait = { ...liveBoard, hub: { ...liveBoard.hub, waiting: true } };
  const failedObservation = agentObservation(lingeringWait, failedState, selected, owned.canReadChat(spec.boardId));
  assert.equal(failedObservation.connection, "disconnected"); assert.equal(failedObservation.agent, "error");
  const transferredId = "22222222-2222-4222-8222-222222222222";
  assert.equal(agentObservation({ ...lingeringWait, hub: { ...lingeringWait.hub, attached: transferredId } }, failedState, { provider: "codex", id: transferredId }, false).connection, "connected", "Old failed adapter cannot override a new attached consumer");
  assert.equal(agentObservation({ ...lingeringWait, hub: { ...lingeringWait.hub, attached: transferredId } }, failedState, selected, false).connection, "connected", "Actual transferred attachment wins over stale binding and failed adapter");
  assert.equal((await owned.stop(spec.boardId)).preserved, false);
  await new Promise(resolve => secondChild.exitCode !== null || secondChild.signalCode !== null ? resolve() : secondChild.once("exit", resolve));
  assert.equal(owned.canReadChat(spec.boardId), false); await owned.close();
  for (const mode of ["busy", "unknown"]) {
    const unsafe = adapter(mode);
    await assert.rejects(unsafe.resume({ ...binding, owned: true }, spec), /busy|unknown/);
    assert.equal(unsafe.getState(spec.boardId), null); await unsafe.close();
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
  const oldProject = process.cwd() + "-missing-relocated-project";
  const relocated = createCodexAdapter({ command: process.execPath, args: [self, "--fake", "relocated", oldProject], timeoutMs: 2000 });
  const relocatedSpec = { ...spec, relocation: { from: oldProject, to: spec.cwd } };
  assert.equal((await relocated.resume(binding, relocatedSpec)).owned, false);
  assert.equal((await relocated.stop(spec.boardId)).preserved, true); await relocated.close();
  const queueRelocated = createCodexAdapter({ command: process.execPath, args: [self, "--fake", "owned", oldProject], timeoutMs: 2000 });
  await assert.rejects(queueRelocated.resume(binding, relocatedSpec), /queue-only terminal is preserved/);
  await queueRelocated.close();
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
  const pending = await fallback.resume(binding, spec); assert.equal(pending.status, "starting"); assert.equal(pending.owned, false); assert.equal(queued, 1); assert.equal(fallback.canReadChat(spec.boardId), false);
  assert.equal(agentObservation(liveBoard, pending, binding, false).connection, "unconfirmed", "Queue admission is not persistent RPC proof");
  assert.equal((await fallback.stop(spec.boardId)).preserved, true);
  warning = true; await assert.rejects(fallback.resume(binding, spec), /warning/);
  assert.equal(fallback.getState(spec.boardId).status, "error"); assert.equal(queued, 2);
  await assert.rejects(fallback.resume(binding, spec), /unresolved/); assert.equal(queued, 2);
  await fallback.close();
  console.log("Hub Codex adapter checks passed (fake protocol; no model turns billed).");
}
