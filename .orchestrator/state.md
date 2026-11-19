# Single-session migration

Base: c48bc94911c2007445e6ee5fd2ed2243b89fa7f4. Branch: feat/single-session-grilling.
Plan: docs/plans/ContextBudget/single-session-migration-plan.md. Iteration 1 finished: implementation verified; S11 external acceptance pending.
Limits: 5 orchestration iterations; mandatory review-until-clean takes precedence over review cap.
Original checkout and installed junctions preserved. No push, merge, global install or user-map reset.
Previous audit ledger preserved as session-audit-before-single-session.md.

## Requirements
| ID | Requirement | Acceptance | Status | Evidence |
|---|---|---|---|---|
| S1 | One model executor | Every event type is prepared/applied by the bound session; no spawn, followup-to-child or worker-wait tools in ordinary grilling traces | DONE | worker.md:3,9,25; connection.mjs:59,63; workers/connection PASS. Real traces remain S11. |
| S2 | Preserve waiting semantics | Hybrid 15-second wait then monitor, explicit pure monitor and justified blocking fallback retain their existing ordering; no overlapping consumers | DONE | hybrid.md:11-16; monitor.md:13-20; parallel-maps.md; monitor/watch/maps PASS. |
| S3 | Shared semantic procedure | Main session reads the same grading, coverage, provenance and event rules; no duplicate parallel instruction source | DONE | worker.md:9,60,62; context/discussion/followups/reread/completeness/spec/knowledge/ideas/preview PASS. |
| S4 | Local result transaction | Token-specific files and read-only preflight remain; complete multipart preflight before first apply; identity/epoch/freshness checks retained | DONE | handoff.md:9,19; result-preflight.mjs:52; preflight/discussion/Hub-runtime PASS. |
| S5 | Safe legacy reuse migration | A valid old `workerReuse.enabled:true` config cannot enable child preparation or cause an unfulfillable manifest acknowledgement | DONE | grill.mjs:837,2426,2466; legacy config inactive; actual c48bc94 upgrade PASS. |
| S6 | Recovery and ownership | Restart, stale notifications/results, Hub Stop/Play, transfer and finish boundaries preserve queued work without duplicate commits | DONE | grill.mjs:2248; hybrid.md:16; session-transfer.md:11; actions/monitor/transfer/Hub-runtime/Hub-service/upgrade PASS. |
| S7 | Bounded authoritative reads | Alias-equivalent instructions are not loaded twice; truncation is detected and repaired; summaries never replace evidence | DONE | handoff.md:7; worker.md:44-50; workers/context PASS. Real reading behavior remains S11. |
| S8 | Honest telemetry | Existing historical descendants remain countable; a no-child run reports actual primary usage and zero observed workers only with adequate completeness | DONE | usage.mjs:180-221; handoff.md:13; usage/session-audit/delivery-trace/worker-cost PASS. |
| S9 | Synchronized delivery | Docs, active instructions, installer requirements, release mirrors and relevant fixtures agree; no reachable default delegate instructions remain | DONE | 44 mirrors byte-identical; active delegation scan and new links PASS; full package retained. |
| S10 | Deterministic regression checks | Required protocol, evidence, queue and security suites pass on disposable state; fresh independent review is clean | DONE | Independent reviewer3 APPROVED; separate full-plan verification on 0d640a7:30/30 suites plus actual baseline upgrade PASS. |
| S11 | Real acceptance | Matched repeated sessions report cost, latency and semantic quality, including adverse results and measurement limits | BLOCKED | Real paired host sessions, long-history observation and human semantic review have not been performed; harness prepared, no savings claim |
| S12 | Release and rollback | One release bump for the completed change, verified package/mirrors; installation is a separate explicit step; rollback preserves data | DONE | One bump1.0.29 to 1.0.30; all package/UI/extension stamps match; implementation.md installation/rollback instructions; installed junctions unchanged1.0.29. |

## Work units
- Runtime: S4-S6/S8 retirement and migration regressions; runtime JS, config, runtime tests.
- Instructions: S1-S3/S7/S9; skill Markdown, repository docs/guides, instruction checks.
- Measurement: S11 baseline manifests, immutable fixture and repeatable harness; no claimed real measurements.
- Integration: mirrors/release S9/S12, full checks and independent review S10.

## History
Iteration 1: inspected installed junctions (original checkout); only README.md dirty in original. Planning base delta is plan-only commit c48bc94.

## Open acceptance
S11 requires real matched host runs and human semantic review; retain pending with exact evidence availability.

Iteration 1 implementation: runtime, instructions and comparison harness completed by separate agents. Review pass 1 assigned fresh read-only reviewer. Actual baseline upgrade (--baseline c48bc94) passes. Broad checks in checks-20261118-224500, checks-20261118-224518, checks-20261118-224655. Initial workers config expectation corrected; monitor/watch failures under investigation by fresh fixer. S11 remains pending actual host runs and human assessment; no measured savings claimed.

Review pass 1: CHANGES_REQUESTED for SKILL.md historical usage contradiction; fresh fixer corrected session-tree/completeness semantics, usage/workers PASS. Broad checks also found generic knowledge freshness guard intercepting dedicated blocked-error retry; fresh fixer splitting guard without weakening dedicated reducer. Watch failure reproduced on base c48bc94: old expectation exit2 conflicts with explicit HTTP409 fence (exit1); scope correction will assert both cases separately. Monitor rerun on stable instruction source PASS. All remaining broad suites PASS so far.

Review pass 1 fixes completed: telemetry paragraph and mirror corrected; knowledge guard delegates document/exclusion validation to dedicated reducer while keeping instruction/language/project fences; regression covers blocked retry and ordinary-event freshness. Watch regression now waits for actual HTTP waiter, asserts exit1+HTTP409 fence+empty stdout, retains post-stop exit2. Release bumped exactly once to 1.0.30; all 44 tracked mirrors and package/extension/UI stamps match. Installed Codex junctions remain original1.0.29; original README modification unchanged. Final focused checks recorded in checks-20261118-225206; broad initial logs retained including failures and subsequent corrections.

Review pass 2 on 3152fcf: CHANGES_REQUESTED for generated reconnection prompt still naming retired level2. Fresh fixer synchronized level1/local completion/start--continue semantics and added transport assertions. Independent old-baseline upgrade, workers, knowledge, comparison, monitor, preflight, usage, simulator and transfer all PASS;44 mirrors/version 1.0.30 verified. Final watch contract check PASS (checks-20261118-225448). No other confirmed defects. A new fresh whole-scope pass follows the fix commit.

Review pass 3 on 0d640a7: APPROVED, no confirmed findings. Independent actual-baseline upgrade, comparison, workers, preflight, monitor, transfer, usage and simulator PASS; diff whitespace and44-file byte parity/version 1.0.30 PASS. Clean review count: 3 total passes, final clean. S11 remains explicitly pending/unmeasured. Separate verifier now checks all S1-S12 against full plan and integrated tree.
## Final independent verification

Verifier read the complete plan, relevant docs and preserved audits/SPEC, and assessed integrated commit 0d640a7 against basec48bc94911c2007445e6ee5fd2ed2243b89fa7f4. No missed implementation requirements or new defects. Eleven of twelve requirements DONE for implementation/deterministic scope; S11 remains PARTIAL/BLOCKED on real paired sessions, observed long-history/compaction behavior and human semantic assessment. DONE does not claim actual host compliance or measured economic savings.

Thirty required suites PASS, with results in checks-20261118-230115, checks-20261118-230125 and checks-20261118-230135; concise aggregate: single-session-final-checks.json. Actual historical runtime check `node dev/check-worker-reuse-integration.mjs --baseline c48bc94` independently PASS. Versions/mirrors/new links/reference hashes/whitespace PASS. Baseline 44 runtime hashes unchanged; prior audit ledger exact; original checkout retains only unrelated README change; both installed Codex junctions remain original1.0.29.

Review cycle: 3 fresh passes (two corrections followed by clean pass), then separate independent full-plan verification. Implementation commits 3152fcf and0d640a7. No further product changes after verified0d640a7. Final evidence-only commit records these results. No merge, push, installed Hub replacement, global skill relink or user-map reset.

Resume S11 using docs/plans/ContextBudget/single-session-measurement.md and its 24 isolated runs. Record actual host/model/effort, primary+descendant counters and completeness, latency, failures, growth/compaction and human review. Do not treat synthetic transport checks as quality/cost results. Installation/rollback boundary: docs/plans/ContextBudget/single-session-implementation.md.
