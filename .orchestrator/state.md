# Single-session migration

Base: c48bc94911c2007445e6ee5fd2ed2243b89fa7f4. Branch: feat/single-session-grilling.
Plan: docs/plans/ContextBudget/single-session-migration-plan.md. Iteration 1, independent review/checks.
Limits: 5 orchestration iterations; mandatory review-until-clean takes precedence over review cap.
Original checkout and installed junctions preserved. No push, merge, global install or user-map reset.
Previous audit ledger preserved as session-audit-before-single-session.md.

## Requirements
| ID | Requirement | Acceptance | Status | Evidence |
|---|---|---|---|---|
| S1 | One model executor | Every event type is prepared/applied by the bound session; no spawn, followup-to-child or worker-wait tools in ordinary grilling traces | REVIEW | Implementation complete; independent review pending |
| S2 | Preserve waiting semantics | Hybrid 15-second wait then monitor, explicit pure monitor and justified blocking fallback retain their existing ordering; no overlapping consumers | REVIEW | Implementation complete; independent review pending |
| S3 | Shared semantic procedure | Main session reads the same grading, coverage, provenance and event rules; no duplicate parallel instruction source | REVIEW | Implementation complete; independent review pending |
| S4 | Local result transaction | Token-specific files and read-only preflight remain; complete multipart preflight before first apply; identity/epoch/freshness checks retained | REVIEW | Implementation complete; independent review pending |
| S5 | Safe legacy reuse migration | A valid old `workerReuse.enabled:true` config cannot enable child preparation or cause an unfulfillable manifest acknowledgement | REVIEW | Implementation complete; independent review pending |
| S6 | Recovery and ownership | Restart, stale notifications/results, Hub Stop/Play, transfer and finish boundaries preserve queued work without duplicate commits | REVIEW | Implementation complete; independent review pending |
| S7 | Bounded authoritative reads | Alias-equivalent instructions are not loaded twice; truncation is detected and repaired; summaries never replace evidence | REVIEW | Implementation complete; independent review pending |
| S8 | Honest telemetry | Existing historical descendants remain countable; a no-child run reports actual primary usage and zero observed workers only with adequate completeness | REVIEW | Implementation complete; independent review pending |
| S9 | Synchronized delivery | Docs, active instructions, installer requirements, release mirrors and relevant fixtures agree; no reachable default delegate instructions remain | REVIEW | Implementation complete; independent review pending |
| S10 | Deterministic regression checks | Required protocol, evidence, queue and security suites pass on disposable state; fresh independent review is clean | REVIEW | Implementation complete; independent review pending |
| S11 | Real acceptance | Matched repeated sessions report cost, latency and semantic quality, including adverse results and measurement limits | BLOCKED | Real paired host sessions, long-history observation and human semantic review have not been performed; harness prepared, no savings claim |
| S12 | Release and rollback | One release bump for the completed change, verified package/mirrors; installation is a separate explicit step; rollback preserves data | REVIEW | Implementation complete; independent review pending |

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

Review pass 1 fixes completed: telemetry paragraph and mirror corrected; knowledge guard delegates document/exclusion validation to dedicated reducer while keeping instruction/language/project fences; regression covers blocked retry and ordinary-event freshness. Watch regression now waits for actual HTTP waiter, asserts exit1+HTTP409 fence+empty stdout, retains post-stop exit2. Release bumped exactly once to1.0.30; all44 tracked mirrors and package/extension/UI stamps match. Installed Codex junctions remain original1.0.29; original README modification unchanged. Final focused checks recorded in checks-20261118-225206; broad initial logs retained including failures and subsequent corrections.

Review pass 2 on3152fcf: CHANGES_REQUESTED for generated reconnection prompt still naming retired level2. Fresh fixer synchronized level1/local completion/start--continue semantics and added transport assertions. Independent old-baseline upgrade, workers, knowledge, comparison, monitor, preflight, usage, simulator and transfer all PASS;44 mirrors/version1.0.30 verified. Final watch contract check PASS (checks-20261118-225448). No other confirmed defects. A new fresh whole-scope pass follows the fix commit.
