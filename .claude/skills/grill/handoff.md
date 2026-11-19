# Local inbox and result transaction

Hub-managed maps: preserve the supplied `hubEpoch`; include `--hub-epoch <captured epoch>` in every `G` command and copy it into every apply JSON, including notes and staged replies. On an epoch/Stop rejection, end this map loop; never claim or read a replacement epoch. Play preserves state and replays unfinished work; never initialize it.

Keep `--inbox` on wait/watch/monitor fetches. Retain the original header, token and captured epoch; the current session reads the inbox and prepares the result itself. Timeouts remain inline. No child receipt or child telemetry is required.

Resolve installed skill paths and continuation/handoff aliases to their canonical real path before reading. Read each instruction once per known version/session context. After compaction or uncertain coverage, reload bounded relevant sections; never assume unavailable instructions are remembered. Inspect field names, counts and sizes before printing large inbox sections. Read complete required evidence in bounded chunks; truncated output is incomplete and must be reread in smaller pieces before judging. Summaries and notes only navigate evidence.

Write ordinary apply JSON as UTF-8 without BOM to `<map directory>/result-<token>.json`, using [shell-json.md](shell-json.md). Never overwrite inbox/session. Multipart discussions use distinct token-specific part files. Preflight the complete ordered multipart set before applying its first part; only the final `more:false` completes the transaction.

Apply with `G apply --file "<resultFile>" --token "<original header token>"`. Add `--rearm` only for the final pure-monitor result when valid. The CLI checks size and inbox identity; the server checks ownership, epoch, revision and frozen-read freshness. Failure results use the same token. Notes are separate. Never rearm during preparation or intermediate parts.

Correct 400 in the same local files and rerun preflight. On stale 409 discard the delivery under the selected mode's recovery rules. On uncertain tool execution inspect status/receipts before retrying; never replay successful apply for a failed note/report write. Keep result files for diagnosis. Existing stdin/HTTP consumers remain supported. New inline results omit `telemetry.workerSessionId`; never label the primary session as a worker.

Dependent deterministic commands may share a tool call only with explicit exit-code AND result-status branching. Shell exit success alone does not prove application. Never use unbounded shell loops, hide diagnostics or overlap consumers to reduce turns.

## Local preflight and compact templates

After writing the result, run `node "<skill directory>/result-preflight.mjs" --inbox "<inbox path>" --token "<original header token>" --file "<result path>"`. For multipart discussion repeat `--file` for every part in apply order in one invocation. Fix reported omissions in the same files, then rerun before applying any result. This read-only local check never applies, consumes, arms, edits files or fetches state. It checks file limits, event identity/epoch, captured scope, token, ordered complete multipart results, coverage shape and explicit ancestor intent. It cannot establish evidence truth, reference validity, current ownership or freshness; server validation remains authoritative. Existing HTTP/stdin clients retain their compatibility behavior.

Compact answer template (replace placeholders with actual evidence; never copy an invented reason or status):

```json
{"type":"answer","id":"<event id>","token":"<event token>","status":"ok","verdict":"<supported conclusion>","coverage":{"resolved":true,"reason":"<why evidence resolves the original weakness>","sources":[],"gaps":[]},"ancestors":[],"semantics":{"topics":[],"relates":[],"decision":"<evidence-based decision>","chatDigest":""}}
```

For weak/gap/verify use `resolved:false` and nonempty `gaps:[{gap,questionIds}]`; include `sources:[]` even without external evidence, or exact checked `{id,answer,contribution}` sources. Add `questions` only for missing clarifications (see coverage.md). Never auto-fill coverage or semantics to satisfy validation. Every grading entry needs coverage, including inline ancestors, discussion assessment/answers, followup and reread/reevaluate assessments. A reread audit's optional coverage uses the same shape.

For live answer and discussion grading entries choose exactly one of `ancestors:[...]` (empty only after checking) or `reviewAncestors:true` when required evidence is missing. Frozen answer results omit both; the frozen reassessment remains separate. Explanation-only discussion template: `{"type":"discuss","id":"<event id>","token":"<event token>","reply":"<explanation>"}`. Do not add grades when no evidence or judgment changed. Preserve `hubEpoch` on every result when delivered. For reevaluate, followup and idea, preserve the effective `capturedForSpec` scope: true selects frozen work; false or omission selects live work. Multipart intermediates contain only identity/part/more plus questions, links and/or answers; the last part carries reply and commands. No new semantic protocol fields are needed.

## Upgrade compatibility

Legacy `workerReuse` and `roles.griller` configuration cannot enable delegation. Do not mix live old/new consumers: settle pending work or stop and restart the same map to requeue it safely, invalidate old tokens and preserve journal inputs. Do not reuse old manifest-bearing results after restart. Historical child usage remains countable; current processing needs no child identity or acknowledgement.
