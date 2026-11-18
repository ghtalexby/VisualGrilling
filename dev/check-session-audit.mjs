import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditSession, run } from "./session-audit.mjs";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "grill-audit-check-"));
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const before = "2026-11-18T11:44:01.417Z", early = "2026-11-17T10:00:00.000Z";
const secret = "PRIVATE_PROMPT_ANSWER_AND_LOCAL_PATH";
const value = n => ({ input_tokens: n, cached_input_tokens: n / 2, output_tokens: 4, reasoning_output_tokens: 2 });
const record = (thread, response, n = 100, timestamp = early) => ({ type: "token_usage_record", timestamp,
  payload: { thread_id: id(thread), response_id: response, usage: value(n) } });
async function fixture(n, parent, records = [], day = "17", nested = false) {
  const dir = path.join(home, "sessions", "2026", "11", day);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `rollout-fixture-${id(n)}.jsonl`);
  const payload = { id: id(n), cwd: secret, ...(parent === null ? {} : nested
    ? { source: { subagent: { thread_spawn: { parent_thread_id: id(parent) } } } }
    : { parent_thread_id: id(parent) }) };
  await fs.writeFile(file, [{ type: "session_meta", timestamp: early, payload }, ...records]
    .map(r => typeof r === "string" ? r : JSON.stringify(r)).join("\n") + "\n");
  return file;
}
try {
  const parentFile = await fixture(1, null, [record(1, "same"), record(1, "same"),
    record(1, "boundary", 800, before), record(1, "later", 800, "2026-11-18T12:00:00Z"),
    { type: "response_item", timestamp: early, payload: { text: secret } }]);
  await fixture(2, 1, [record(2, "same", 200)], "18", true);
  await fixture(3, 2, [record(3, "third", 300)], "19");
  await fixture(4, null, [record(4, "unrelated", 9000)]);
  const options = { session: id(1), codexHome: home, before };
  let report = await auditSession(options);
  assert.equal(report.complete, true);
  assert.equal(report.total.modelResponses, 3);
  assert.equal(report.total.tokens.input, 600);
  assert.equal(report.total.tokens.cached, 300);
  assert.equal(report.total.tokens.uncached, 300);
  assert.equal(report.total.tokens.output, 12);
  assert.equal(report.total.tokens.reasoning, 6);
  assert.equal(report.workers.sessions, 2);
  assert.equal(report.threads.find(t => t.id === id(1)).duplicateResponses, 1);
  assert(!JSON.stringify(report).includes(secret));
  assert(!JSON.stringify(report).includes(home));

  const hidden = path.join(home, "sessions", "rollout-hidden.jsonl");
  await fs.writeFile(hidden, "{malformed metadata may hide a child\n");
  report = await auditSession(options);
  assert.equal(report.discovery.complete, false);
  assert.equal(report.parent.complete, true);
  assert.equal(report.parent.modelResponses, 1);
  for (const group of [report.workers, report.total]) {
    assert.equal(group.complete, false);
    assert.equal(group.modelResponses, null);
  }
  assert.equal(report.workers.observedModelResponses, 2);
  assert.equal(report.total.observedModelResponses, 3);
  const noKnownChildren = await auditSession({ ...options, session: id(4) });
  assert.equal(noKnownChildren.workers.modelResponses, null, "Unknown children cannot be reported as exact zero");
  assert.equal(noKnownChildren.workers.observedModelResponses, 0);
  assert.equal(noKnownChildren.workers.complete, false);
  await fs.unlink(hidden);

  await fixture(5, 1, [{ type: "event_msg", timestamp: early, payload: { type: "token_count", info: { total_token_usage: value(500) } } },
    { type: "event_msg", timestamp: before, payload: { type: "token_count", info: { total_token_usage: value(9000) } } }]);
  report = await auditSession(options);
  assert.equal(report.total.tokens.input, 1100);
  assert.equal(report.total.modelResponses, null);
  assert.equal(report.total.observedModelResponses, 3);
  assert.equal(report.threads.find(t => t.id === id(5)).source, "legacy-token-count");

  await fixture(6, 1);
  await fixture(7, 1, [record(7, "valid"), "{malformed"]);
  report = await auditSession(options);
  assert.equal(report.complete, false);
  assert.equal(report.threads.find(t => t.id === id(6)).tokens, null);
  assert.equal(report.threads.find(t => t.id === id(7)).invalidRecords, 1);
  assert.equal(report.total.modelResponses, null);
  await fs.appendFile(parentFile, JSON.stringify(record(1, "same", 200)) + "\n");
  report = await auditSession(options);
  assert.equal(report.threads.find(t => t.id === id(1)).conflictingResponses, 1);
  assert.equal(report.parent.complete, false);

  const state = path.join(home, "state.json");
  await fs.writeFile(state, JSON.stringify({ nodes: [{ answer: secret }], contextStats: {
    totals: { [secret]: { count: 2, requests: 7, characters: 120 } },
    recent: [{ usageEnd: {}, usage: {} }, { answer: secret }] } }));
  report = await auditSession({ ...options, state });
  assert.equal(report.state.cliRequests, 7);
  assert.equal(report.state.events, 2);
  assert.equal(report.state.recentWithoutClosingUsage, 1);
  assert.equal(report.state.correlations.untracedEntries, 2);
  assert(!JSON.stringify(report).includes(secret));
  const trace = { deliveryTraceId: id(55), actionIds: [secret], mapRevision: secret, contextScope: "live",
    causes: [{ kind: "user-action", reason: secret }], workerSessionIds: [id(2), secret], workerAttribution: "declared",
    usageDeltaStatus: "missing-end", committedChanges: { answer: { count: 1, ids: [secret] } } };
  await fs.writeFile(state, JSON.stringify({ actionTasks: [trace], contextStats: { recent: [trace] } }));
  report = await auditSession({ ...options, state });
  assert.equal(report.state.correlations.tracedDeliveries, 1);
  assert.equal(report.state.correlations.mappedDeliveries, 1);
  assert.equal(report.state.correlations.workers[0].id, id(2));
  assert.equal(report.state.correlations.workers[0].inObservedSessionTree, true);
  assert.equal(report.state.correlations.committedChanges.answer, 1);
  assert.equal(report.state.correlations.usageDeltaStatuses["missing-end"], 1);
  assert(!JSON.stringify(report).includes(secret));
  const output = path.join(home, "report.json"), args = ["--session", id(1), "--codex-home", home, "--before", before, "--state", state, "--output", output];
  await run(args);
  const saved = await fs.readFile(output);
  await assert.rejects(run(args), { code: "EEXIST" });
  assert.deepEqual(await fs.readFile(output), saved);
  await assert.rejects(auditSession({ ...options, before: "2026-11-18T11:44:01" }));
  await assert.rejects(run([...args, "--session", id(1)]));

  const missing = await auditSession({ ...options, session: id(999) });
  assert.equal(missing.parent.tokens, null);
  assert.equal(missing.complete, false);
  const broken = path.join(home, "sessions", "broken");
  await fs.mkdir(broken);
  await fs.writeFile(path.join(broken, "rollout-bad.jsonl"), "{bad\n");
  report = await auditSession(options);
  assert.equal(report.discovery.complete, false);
  assert.equal(report.discovery.invalidMetadata, 1);
  // Huge transcript lines are discarded with explicit incompleteness, and the
  // next complete usage record is still parsed, with bounded line storage.
  await fixture(8, 1, ["x".repeat(4 * 1024 * 1024 + 100), record(8, "after-huge", 800)]);
  report = await auditSession(options);
  assert.equal(report.threads.find(t => t.id === id(8)).tokens.input, 800);
  assert.equal(report.threads.find(t => t.id === id(8)).complete, false);
  console.log("session-audit: metadata links, cross-day, deduplication, cutoff, missing/legacy/invalid telemetry, privacy and no-overwrite passed");
} finally {
  await fs.rm(home, { recursive: true, force: true });
}
