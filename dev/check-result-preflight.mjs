// All writes are confined to a disposable directory; preflight itself is read-only.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateResults, preflightFiles } from "../skills/grill/result-preflight.mjs";

const token = "delivery-token";
const event = { type: "answer", id: "q", token };
const covered = { status: "ok", verdict: "Evidence resolves the issue.", coverage: { resolved: true, reason: "Measured directly.", sources: [], gaps: [] } };
const answer = { ...event, ...covered, ancestors: [] };
const check = (inbox, results) => validateResults(inbox, results, token);
const rejects = (change, expression) => {
  const result = structuredClone(answer);
  change(result);
  assert.throws(() => check(event, [result]), expression);
};
assert.deepEqual(check(event, [answer]), { ok: true, files: 1 });
rejects(result => delete result.coverage.sources, /sources/);
rejects(result => delete result.ancestors, /ancestors/);
rejects(result => result.reviewAncestors = true, /ancestors/);
rejects(result => result.token = "stale", /identity/);
rejects(result => result.id = "other", /identity/);
rejects(result => result.hubEpoch = "other", /identity/);
rejects(result => result.coverage.reason = "", /reason/);
rejects(result => result.status = "weak", /resolved/);
rejects(result => result.ancestors = [{ id: "parent", status: "weak", verdict: "Missing test" }], /coverage/);
const deferred = { ...answer, reviewAncestors: true };
delete deferred.ancestors;
check(event, [deferred]);
const frozen = { ...event, capturedForSpec: true };
assert.throws(() => check(frozen, [answer]), /frozen/);
check(frozen, [{ ...event, ...covered, capturedForSpec: true }]);
check(event, [{ type: "failure", token, error: "Unable to read evidence" }]);
for (const type of ["reevaluate", "followup", "idea"]) {
  const scoped = { type, token, ...(type === "reevaluate" ? {} : { id: "q" }) };
  const result = { ...scoped, ...covered };
  for (const capturedForSpec of [undefined, false, true]) {
    const inbox = { ...scoped, ...(capturedForSpec === undefined ? {} : { capturedForSpec }) };
    check(inbox, [{ ...result, capturedForSpec: capturedForSpec === true }]);
    if (capturedForSpec === true) assert.throws(() => check(inbox, [result]), /capturedForSpec/);
    else check(inbox, [result]);
    assert.throws(() => check(inbox, [{ ...result, capturedForSpec: capturedForSpec !== true }]), /capturedForSpec/);
    for (const malformed of [null, "true", 1]) {
      assert.throws(() => check(inbox, [{ ...result, capturedForSpec: malformed }]), /capturedForSpec/);
      assert.throws(() => check({ ...inbox, capturedForSpec: malformed }, [result]), /capturedForSpec/);
    }
  }
}
const discussion = { type: "discuss", id: "q", token };
check(discussion, [{ ...discussion, reply: "Explanation only" }]);
check(discussion, [{ ...discussion, reply: "Revised", assessment: { ...covered, ancestors: [] } }]);
assert.throws(() => check(discussion, [{ ...discussion, assessment: covered }]), /ancestors/);
const parts = [
  { ...discussion, part: 0, more: true, answers: [{ id: "q", messageIds: ["m"], ...covered, ancestors: [] }] },
  { ...discussion, part: 1, more: false, reply: "Done" },
];
check(discussion, parts);
assert.throws(() => check(discussion, parts.toReversed ? parts.toReversed() : [...parts].reverse()), /order/);
assert.throws(() => check(discussion, [parts[0]]), /order/);
assert.throws(() => check(discussion, [{ ...parts[0], reply: "Too early" }, parts[1]]), /part.reply/);
const missingSources = structuredClone(parts);
delete missingSources[0].answers[0].coverage.sources;
assert.throws(() => check(discussion, missingSources), /sources/);
check({ type: "reread", token }, [{ type: "reread", token, assessments: [{ id: "q", ...covered }] }]);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grill-preflight-"));
try {
  const inbox = path.join(dir, "inbox.json"), file = path.join(dir, "result.json");
  fs.writeFileSync(inbox, JSON.stringify(event));
  fs.writeFileSync(file, "\uFEFF" + JSON.stringify(answer));
  const before = fs.readFileSync(file);
  preflightFiles({ inbox, files: [file], token });
  assert.deepEqual(fs.readFileSync(file), before);
  assert.throws(() => preflightFiles({ inbox, files: [inbox], token }), /inbox/);
  assert.throws(() => preflightFiles({ inbox, files: [dir], token }), /file/);
  const cli = fileURLToPath(new URL("../skills/grill/result-preflight.mjs", import.meta.url));
  const run = expected => spawnSync(process.execPath, [cli, "--inbox", inbox, "--token", expected, "--file", file], { encoding: "utf8", windowsHide: true });
  const good = run(token);
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(good.stdout), { ok: true, files: 1 });
  const wrong = run("stale");
  assert.equal(wrong.status, 1);
  assert.equal(wrong.stdout, "");
  fs.writeFileSync(file, "x".repeat(4000001));
  assert.throws(() => preflightFiles({ inbox, files: [file], token }), /size/);
  fs.writeFileSync(file, "{");
  assert.throws(() => preflightFiles({ inbox, files: [file], token }), SyntaxError);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log("Result preflight: identity, coverage, intent, multipart, file limits and read-only checks passed.");
