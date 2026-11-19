# Session audit implementation

Project: VisualGrilling. Plan: docs/plans/ContextBudget/session-audit-2026-11-18.md.
Plan SHA256: 81FBE61319AE3AA9E7B954BCF40A1FE36528E552C0016901F911D3A99575A740.
Base: e8b930f5bb5150b7e4c572c214cea89ac1c1bf17. Iteration 2 selected implementation verified on 1388b90; broader audit acceptance remains incomplete. Iteration 1 verified on 5219dc2. External acceptance remains open. Limit: 5 iterations; mandatory review-until-clean overrides review cap.
User authorized implementation and archival on 2026-11-18. Previous ledger: boards-hub-before-session-audit-2026-11-18.md. Preserve unrelated README.md changes.

## Requirements
| ID | Requirement / source | Acceptance | Status | Evidence |
|---|---|---|---|---|
| R1 | P1 waiting and bounded reads | Longer waits and bounded reads | DONE | hybrid.md:12-13; handoff.md:27-29; independent workers check PASS |
| R2 | P1 template and local preflight | Pure coverage/intent/identity/multipart validation | DONE | result-preflight.mjs:15-109; preflight tests PASS |
| R3 | Narrow P2 combined ancestors | Atomic legacy inline ancestors and fallback | DONE | grill.mjs:1126-1145; check-discussion.mjs:160-196 PASS |
| R4 | P2 correctness boundaries | Preserve required work and atomicity | DONE | grill.mjs:1133-1145; discussion structural/reread regressions; spec/actions/context/restart suites PASS |
| R5 | Owner prototype host gate | Inspect existing host routing; distinguish verified from unverified child create/resume/complete/restart | BLOCKED | Transport now passes; direct child RPC rejected by host policy -32600; full lifecycle/restart unverified |
| R6 | Release and synchronization | Docs, mirror and installed version | DONE | Independent verification: 44 mirror files byte-identical; package/UI/extension and installed Codex junctions at1.0.26 |
| R7 | Independent review and checks | Fresh clean review and verification | DONE | Iteration1:2 passes. Iteration2:6 passes, final clean on1388b90; independent full-plan verification PASS for selected scope |
| R8 | Matched experiment | Equal cold/warm real scenarios; actor-specific tokens/model calls, semantic quality | BLOCKED | Controlled real-session experiment pending; baseline remains frozen |
| R9 | Later gated P0/P3/P4/full P2 | Record remaining scope honestly | DONE | Implementation record retains full-scope receipts, reuse, retrieval and measurement gates; frozen audit hash unchanged |

## Work units
- W1 R1/R2: standalone preflight module, workflow files and focused tests; no grill.mjs/docs contract edits.
- W2 R3/R4: grill.mjs and runtime tests.
- W3 R5: read-only host gate investigation/artifact; no nested inference or real-session mutation.
- W4 R6/R9: integration documentation and release after implementations.
- W5 R7: fresh independent review, fixes/checks/commit, then full-plan verification.

## History
- Phase 0: audit/spec read; automatic reread includes broader evidence than ancestors. Preserve it in this narrow release.
- Prior read-only investigation found queue/RPC APIs, not proven child lifecycle routing.

## Decisions and blockers
- No push, user-map replay/reset, model/effort changes. Runtime tests use disposable GRILL_HUB_HOME.
- Parent remains sole consumer/applier. Full scope receipts, reuse and history retrieval remain gated experiments.
- User approved ledger archive; no pending permission question.

## Iteration 1 implementation results
- W1: standalone read-only result-preflight, complete multipart file validation, coverage/ancestor intent checks, bounded reads and longer waits implemented. Focused preflight check passed.
- W2: legacy discussion inline ancestor transaction and conservative structural dependency scheduling implemented. discussion/followups/spec/reread/completeness/context/actions/worker-cost checks passed with disposable registries.
- W3: safe proxy-only probe and implementation/gate record added. Probe timed out on initialize after 5s, exit 1; real child lifecycle remains unverified. No inference started.
- W4: contracts/architecture/development and simulator/promo consumers synchronized. Source copied into tracked mirror; released once as 1.0.25. Source/mirror/installed Codex links/extension version verified.
- Central checks: workers, monitor, maps, usage and actions-simulator PASS. Simulator exercises gap/ok/verify, discussion, more, finish, report and header403. Independent review pass 1 ongoing. Whitespace issue handoff.md:29 pending fix.
- R1–R6 implementation now REVIEW; R5 host acceptance remains BLOCKED by proxy initialization. R8 real matched measurement remains BLOCKED; R9 roadmap recorded. No percentage savings claimed.

## Review pass 1
CHANGES_REQUESTED. Confirmed: managed multipart hubEpoch passes preflight but is rejected as staged data; frozen/live scope not checked for reevaluate/followup/idea; handoff trailing whitespace. Fresh fixer assigned, no prior implementer reused. Preserve authenticated epoch and token, add real managed multipart and frozen identity regressions. Commit iteration after fixes/checks; fresh review required.
- Review1 fixes completed: authenticated hubEpoch removed before reducer staging; preflight checks effective frozen scope; whitespace removed. Added managed multipart HTTP regression with stale epoch/token and duplicate publication protection. Preflight, Hub runtime/restart, discussion and workers PASS after fixes. Knowledge and browser promo storyboard PASS centrally.
- Iteration1 fix commit prepared; release remains 1.0.25. R1/R2/R3/R4/R6/R7 awaiting fresh review and final verification.


## Review pass 2
APPROVED on 5219dc2; no confirmed findings. Independent preflight/discussion/hub-runtime/workers/monitor/context/followups/reread checks PASS, source/mirror hashes match, diff whitespace clean. Central final monitor/worker-cost/actions-simulator PASS. Frozen audit SHA256 unchanged. Installed .codex and .agents junctions resolve to source version1.0.25 and contain preflight. Phase3 independent full-plan verification in progress.

## Final independent verification
Seven of nine ledger requirements DONE; R5 and R8 remain BLOCKED. No missing implementation requirement in selected P1/narrow-P2 scope. Conditional apply/next remains measurement-gated. Final verifier independently passed preflight, workers, disposable simulator, syntax, plan links, source/mirror/version and whitespace checks. One verifier worker-check invocation omitted registry isolation; its exact completed fixture registry record was removed and the isolated rerun passed. User maps and unrelated README were preserved.

Review count: 2 passes, final clean. Implementation/fix commit: 5219dc2. No push. Resume at host-proxy prerequisite and matched real-session experiment; full audit program is not complete.

## Iteration 2 — continuation
User requested continuation after release1.0.25. Preserve R1–R9 history and two completed review passes. Reopen host diagnosis (R5) rather than assuming a timeout proves unsupported. Parallel read-only design for P0 measurements; no nested model process or existing-session messages.

| ID | Requirement / source | Acceptance | Status | Evidence |
|---|---|---|---|---|
| R10 | P0 actor response accounting | Deduplicated parent/worker model-response counts separate from CLI requests; fallback count unknown | DONE | usage.mjs:65-78; independent verifier confirms unknown counts; usage/worker-cost tests PASS |
| R11 | P0 delivery attribution | Link event diagnostics to action IDs and noncredential delivery identity; explicit incomplete closing telemetry | DONE | telemetry.mjs:3-11; grill.mjs:807; independent verifier confirms attribution; delivery-trace PASS |
| R12 | P0 reproducible offline report | Explicit parent metadata, cutoff, repeated-ID dedup, incomplete data, aggregate-only output; frozen baseline untouched | DONE | dev/session-audit.mjs:56,92,195; independent verification and focused checks; known19-thread baseline parity PASS |

Work units: W6 host root-cause investigation; W7 usage/report implementation after design; W8 attribution implementation after design; W9 independent review, synchronization, release and full requirement verification. Real P3/direct-publication work remains contingent on evidence/host gate; measured savings cannot be inferred from deterministic tests.

### Iteration2 host diagnosis breakthrough
The proxy is raw WebSocket forwarding, not JSON-lines stdio. A read-only HTTP Upgrade /rpc + masked initialize probe received101 and a successful Codex0.170.0 initialize using the same executable/environment. Earlier timeout was a client protocol bug, not missing host capability. R5 reopened IN_PROGRESS. W10 fresh implementer fixing proxy transport with bounded WebSocket codec while preserving owned stdio. Real lifecycle/child ownership remains unverified; schema thread/start has no parent identity input.
| R13 | Existing-host proxy transport | Correct handshake/framing, fail-closed bounds, preserved stdio and deterministic regressions; real initialize passes | DONE | Independent review/verification and WebSocket tests PASS; real initialization PASS without inference |
| R14 | Disposable worker lifecycle | Exact identity create/resume/completion/reconnect without separate model process; explicit child/host-restart limits | BLOCKED | Direct child input denied by host policy; supported parent followup retains marker; restart unverified |

### Iteration2 routing result
R13 transport unit independently APPROVED; deterministic websocket/adapter/service tests and real initialize PASS. Real disposable v2 child created through supported collaboration (01a1ee9b-a2b2-71b2-a430-25ef4b4dcd9a), then direct app-server lifecycle attempt rejected with code-32600: direct app-server input is not allowed for multi-agent v2 sub-agents. No turn admission was observed. This is a host policy boundary, not a transport timeout; do not bypass it. R14 direct child lifecycle BLOCKED; supported parent followup smoke underway. P3 parent-dispatched prepare-only reuse core under implementation, default disabled, no model overrides.

### Iteration2 review findings
Measurement review: invalid/conflicting usage records must not claim exact response counts; incomplete discovery must propagate to aggregate exact counts. Fresh fixer applied changes; usage/worker-cost/audit tests PASS. Runtime trace review: add actual frozen evidenceRevision while retaining live mapRevision; preserve causes on failure retry; attribute generated followups; retain declared workers on accepted failure results. Fresh fixer assigned. No release/commit yet; final integrated review required.

| R15 | P3 bounded parent-dispatched reuse | Disabled-by-default same-card prototype; full current evidence, exact manifest acknowledgement, measured size/read limits and conservative rotation; supported followup only | DONE | worker-reuse.mjs:3,28,67; independent verification and core/integration PASS; real semantic/cost acceptance remains R8 |
Supported parent followup of the same disposable child returned the remembered marker exactly. This proves supported host context continuation only, not semantic equivalence or savings. Direct-child RPC prohibition is preserved.

### Actual baseline replay (read-only)
Fresh validation on a disposable Codex home pointing only at the session creation-day directory completed in497ms. All19threads and373responses (parent215/workers158) match frozen per-thread metrics, zero mismatches. Totals input17210880/cached16449408/uncached761472/output54391/reasoning3211. This validates parser/accounting for the frozen known19-thread baseline, not independent completeness of the whole archive. Full-home scan slowness separately investigated. Originals preserved.

### Iteration2 integrated checks and reuse review
Version bumped once to1.0.26; source mirrors synchronized before tests. PASS workers(10984-byte instruction bundle), delivery trace, worker-reuse core/integration, actions-simulator, followups, spec, actions and Hub service. P3 review found active policy-change freshness, unrelated-stale-token acknowledgement loss, non-discussion more:true bypass, async baseline resurrection, and stale documentation. Fresh fixer assigned, no claim of clean release yet. Final integrated independent review remains after fixes and commit.
Optional full-home audit stalled on filesystem reads (also reproduced by independent synchronous probe), not proven parser CPU; stopped only the owned test process and shell. Restricted creation-day baseline parity passed as above. No full-archive completeness claim.

### Iteration2 fixes/checkpoint
All confirmed P3 fixes implemented, including current policy/knowledge/lang/instruction guard, requeue with new token and preserved input, monitor refresh, strict numbered discussion intermediate exception, unrelated stale-token isolation and generation-fenced asynchronous telemetry. Final focused core/integration/preflight/monitor/workers and simulator PASS; source mirrors synchronized. Version1.0.26 bumped exactly once. Current continuation review passes: measurement, proxy, trace, reuse (4 scoped passes); next fresh integrated pass required. Preparing one implementation/fix commit, excluding unrelated README.

### Iteration2 integrated review pass 5
Implementation committed as d14eee0. Fresh full-scope review found one contract mismatch: preflight rejects optional telemetry on intermediate discussion parts although the server accepts it. Fresh fixer assigned shared validation and regression coverage. All integrated checks passed: reuse core/integration, preflight, delivery trace, audit, usage, WebSocket, Hub Codex/runtime, monitor, actions, workers, worker-cost, transfer, discussion, followups, spec, context and disposable simulator. Final clean review and phase3 verification remain pending. README remains unrelated and uncommitted.

### Iteration2 integrated review pass 6
APPROVED on1388b90, no confirmed findings. Independent reuse core/integration, WebSocket, audit, trace, usage, preflight, Hub adapter, workers, monitor, context/restart, worker-cost and simulator PASS. Mirrors and1.0.26 stamps match. Root maps/knowledge PASS. Fresh phase3 verifier assigned entire audit, linked specification and all R1-R15. Review count for this continuation:6 (four scoped, two integrated), final clean; previous iteration:2.

### Iteration2 final independent verification
12 of15 ledger requirements DONE for the selected implementation. R5/R14 remain BLOCKED by direct-child host policy; full restart lifecycle remains unverified. R8 remains an unperformed matched experiment (verifier: MISSING), not evidence of a host impossibility for supported parent-dispatched reuse. Full audit completion and savings are not claimed.
Verifier independently passed preflight, workers, disposable simulator,44-file mirror parity,1.0.26 versions/installed junctions,20 documentation links, audit hash and whitespace. Broader runtime suites passed during independent review. Historical metrics byte comparison was unavailable in the checked Git baselines; originals were not edited.
Implementation commits:d14eee0 and1388b90. Review count:6 this continuation (4 scoped,2 integrated), last clean;2 prior passes retained. No push; unrelated README remains uncommitted.
Remaining roadmap: matched repeated cold/warm real-session and semantic assessment; full P2 assessed revisions/dependency coalescing/evidence-bookkeeping separation; P4 versioned history retrieval; complete causal-cost attribution; direct-publication lifecycle only through supported host capabilities. These are unresolved broader program work, not completed features. Resume from this record without rerunning the frozen baseline or claiming percentage savings.
