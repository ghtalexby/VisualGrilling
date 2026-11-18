import assert from "node:assert/strict";
import { buildWorkerManifest, validateWorkerContextAck, validateWorkerReuseSettings, workerReuseDecision } from "../skills/grill/worker-reuse.mjs";

const input = {
  processId: "process-a", mapKey: "project/map", brief: "brief", arch: "architecture", language: "en",
  ignoreRevision: "ignore-1", knowledgeRevision: "knowledge-1", instructionRevision: "instructions-1",
  nodes: [{ id: "root", kind: "root" }, { id: "q1", parentId: "root", kind: "q", q: "Durability?", answer: "fsync", chat: [], status: "ok", topics: ["storage"] }, { id: "q2", parentId: "root", kind: "q", q: "Recovery?", answer: "tested", status: "ok" }],
  event: { type: "answer", id: "q1", token: "token-1" }
};
const original = buildWorkerManifest(input);
const ack = manifest => ({ deliveryToken: manifest.event.token, manifestRevision: manifest.manifestRevision });
const previous = { status: "completed", manifest: original, workerContextAck: ack(original), successfulEvents: 1 };
const measurements = { lastInputTokens: 12000, contextReadAmplification: 1.2 };
const settings = { enabled: true };
const nextInput = () => ({ ...structuredClone(input), event: { type: "discuss", id: "q1", token: "token-2" } });
const decision = (value = nextInput(), overrides = {}) => workerReuseDecision({ settings, previous, measurements, current: buildWorkerManifest(value), ...overrides });
assert.equal(validateWorkerReuseSettings().enabled, false);
assert.equal(validateWorkerReuseSettings().maxEvents, 3);
for (const value of [{ enabled: 1 }, { maxEvents: 0 }, { maxEvents: 6 }, { maxEvents: 2.5 }, { maxInputTokens: Infinity }, { maxReadAmplification: 0 }, { unexpected: true }]) assert.throws(() => validateWorkerReuseSettings(value));
assert.equal(decision().reuse, true, "same question discussion");
const correction = nextInput(); correction.nodes[1].answer = "Correction: fsync was never implemented";
assert.equal(decision(correction).reuse, true);
assert.notEqual(buildWorkerManifest(correction).cardRevisions[0].revision, undefined);
assert.notEqual(buildWorkerManifest(correction).manifestRevision, original.manifestRevision);
const chat = nextInput(); chat.nodes[1].chat.push({ from: "user", text: "Code contradicts my earlier answer; reread src/store.mjs", id: "m1" });
chat.event.scope = "question";
chat.event.contextScope = "live";
assert.equal(decision(chat).reuse, true);
assert.deepEqual(decision(chat).changedIds, ["q1"]);
assert.match(buildWorkerManifest(chat).evidencePolicy, /reread-external-and-code/);
for (const key of ["processId", "mapKey", "language", "ignoreRevision", "knowledgeRevision", "instructionRevision", "brief", "arch"]) {
  const changed = nextInput(); changed[key] += "-changed";
  assert.equal(decision(changed).reuse, false, key);
}
for (const key of ["answer", "topics", "chatDigest", "pending", "parentId"]) {
  const contradiction = nextInput(); contradiction.nodes[2][key] = key === "pending" ? { cancelled: true } : "changed";
  assert.equal(decision(contradiction).reason, "other-cards-changed", key);
}
const removed = nextInput(); removed.nodes.pop();
assert.equal(decision(removed).reuse, false);
assert.deepEqual(decision(removed).removedIds, ["q2"]);
const removedFocus = nextInput(); removedFocus.nodes.splice(1, 1);
assert.equal(decision(removedFocus).reuse, false);
const renamed = nextInput(); renamed.nodes[1].q = "Different question";
assert.equal(decision(renamed).reuse, false);
for (const event of [{ capturedForSpec: true }, { capturedForSpec: "false" }, { scope: "frozen" }, { scope: "question", contextScope: "frozen" }, { cancelled: true }, { stale: true }, { type: "reread" }, { type: "finish" }, { id: "root" }]) {
  const unsupported = nextInput(); Object.assign(unsupported.event, event);
  assert.equal(decision(unsupported).reuse, false);
}
for (const change of [{ cancelled: true }, { stale: true }, { failed: true }, { status: "staged" }, { successfulEvents: 3 }, { successfulEvents: 0 }, { workerContextAck: { ...ack(original), deliveryToken: "stale" } }]) assert.equal(decision(undefined, { previous: { ...previous, ...change } }).reuse, false);
assert.equal(decision(undefined, { previous: { ...previous, successfulEvents: 2 } }).reuse, true);
for (const value of [undefined, {}, { lastInputTokens: 0, contextReadAmplification: 1 }, { lastInputTokens: 60000, contextReadAmplification: 1 }, { lastInputTokens: 40000, contextReadAmplification: 2.1 }, { lastInputTokens: 40000, contextReadAmplification: NaN }]) assert.equal(decision(undefined, { measurements: value }).reuse, false);
assert.equal(decision(undefined, { measurements: { lastInputTokens: 59999, contextReadAmplification: 2 } }).reuse, true);
assert.equal(decision(undefined, { settings: {} }).reuse, false);
assert.equal(validateWorkerContextAck(ack(original), original), false, "staged ack cannot succeed");
assert.equal(validateWorkerContextAck(ack(original), original, { final: true }), true);
assert.equal(validateWorkerContextAck({ ...ack(original), manifestRevision: "stale" }, original, { final: true }), false);
assert.equal(validateWorkerContextAck({ ...ack(original), extra: true }, original, { final: true }), false);
const reordered = { ...input, nodes: input.nodes.map(node => Object.fromEntries(Object.entries(node).reverse())) };
assert.equal(buildWorkerManifest(reordered).manifestRevision, original.manifestRevision);
const duplicate = nextInput(); duplicate.nodes.push(duplicate.nodes[0]);
assert.throws(() => buildWorkerManifest(duplicate));
const oversized = nextInput(); oversized.nodes[1].answer = "x".repeat(4 * 1024 * 1024);
assert.throws(() => buildWorkerManifest(oversized), /manifest limit/);
assert.deepEqual(input.nodes[1].chat, [], "helpers do not mutate source evidence");
console.log("Worker reuse core checks passed (transport fixtures only; no savings or semantic acceptance claim).");


// An asynchronous usage read cannot resurrect a discarded or superseded baseline.
const { workerRuntime } = await import("../skills/grill/worker-runtime.mjs");
for (const interruption of ["discard", "deliver", "invalidateBaseline", "reject"]) {
  let resolve, reject;
  const runtime = workerRuntime({ enabled: true }, () => new Promise((ok, fail) => { resolve = ok; reject = fail; }));
  const first = { ...input.event };
  runtime.deliver(first, input);
  const pending = runtime.complete({ ...first, workerContextAck: ack(first.workerContext.manifest) }, { ok: true }, "child");
  if (interruption === "deliver") runtime.deliver({ ...nextInput().event }, nextInput());
  else if (interruption !== "reject") runtime[interruption]();
  if (interruption === "reject") reject(Error("usage unavailable"));
  else resolve({ lastInputTokens: 1000, modelResponses: 1 });
  await pending;
  const next = { ...nextInput().event, token: "token-3" };
  runtime.deliver(next, nextInput());
  assert.equal(next.workerContext.reason, "previous-not-completed", interruption);
}

for (const key of ["language", "ignoreRevision", "knowledgeRevision", "instructionRevision"]) {
  const runtime = workerRuntime({ enabled: true }, async () => null);
  const event = { ...input.event };
  runtime.deliver(event, input);
  const body = { ...input.event, workerContextAck: ack(event.workerContext.manifest) };
  runtime.validate(body, () => input);
  assert.throws(() => runtime.validate(body, () => ({ ...input, [key]: input[key] + "-changed" })), error => error[0] === 409 && error.workerContextStale);
}
