# ContextBudget implementation

Project: VisualGrilling. Plan: docs/plans/ContextBudget/context-budget.md.
Base: 6d078d384a425b8dfbe8f5618e43f56d8c145255. Branch: feat/context-budget.
Iteration: 1. Phase: full review1 fix and checks. Limits: 5 iterations, 3 review rounds per unit; mandatory until-clean repository review takes precedence.
Previous completed record archived as ux-completeness-completed.md with user approval. Initial working tree clean.
Checks: all dev/check-*.mjs; disposable simulator --no-open --delay 200; restart recovery; host acceptance where available.

## Requirements
| ID | Requirement | Source | Acceptance | Status | Evidence |
|---|---|---|---|---|---|
| R1 | Bounded delivery telemetry persisted and exposed read-only | Stage 0 | 200 entries, totals by type, no payload change | REVIEW | Stage0 independent review APPROVED; baseline/context/monitor/workers checks pass |
| R2 | Reproducible 40+ card baseline across event types | Stage 0 | check-context, baseline recorded before payload edits | REVIEW | Stage0 independent review APPROVED; baseline/context/monitor/workers checks pass |
| R3 | Compact projection and canonical discussion chat | Stage 1 | no duplicated chat, empty fields, timestamps; targeted histories | REVIEW | Implemented; independent final verification pending |
| R4 | Server-injected captured knowledge snapshots | Stage 1 | valid versions injected, unknown rejected atomically, prior/manual sources preserved | REVIEW | Implemented; independent final verification pending |
| R5 | Focused event context, index and lexical selection | Stage 2 | discuss/idea <=35% baseline; bounded related; complete coverage | REVIEW | Implemented; independent final verification pending |
| R6 | Protected read-only node/branch/index/search | Stage 2 | max20 nodes, validation, no queue/listening effects | REVIEW | Implemented; independent final verification pending |
| R7 | Atomic duplicate guard across all addition paths | Stage 2 | rejects matching IDs, allowSimilar supported | REVIEW | Implemented; independent final verification pending |
| R8 | Semantic fields and validation across apply paths | Stage 3 | limits, valid links, stale/clear behavior | REVIEW | Implemented; independent final verification pending |
| R9 | Bidirectional graph navigation and vocabulary | Stage 3 | neighbours first, related/topic search, capped vocabulary | REVIEW | Implemented; independent final verification pending |
| R10 | Semantics excluded from evidence projections | Stages 1,3 | spec/knowledge/export identity | REVIEW | Implemented; independent final verification pending |
| R11 | Incremental automatic reread and audit validation | Stage 4 | changed cards + neighbours, full manual/first, <=40% full budget | REVIEW | Implemented; independent final verification pending |
| R12 | Changed answered-card knowledge threshold | Stage 4 | configurable default5, finish/manual preserved | REVIEW | Implemented; independent final verification pending |
| R13 | Event-specific worker routing and instruction split | Stage 5 | answer worker <12KB, complete rules and routing | REVIEW | Stage5 independent review APPROVED; worker10262bytes and worker check passes |
| R14 | Mode-specific workflows and installation | Stage 5 | monitor/dispatcher/parallel extracted, installer/checks synced | REVIEW | Stage5 independent review APPROVED; worker10262bytes and worker check passes |
| R15 | Synchronized consumers/docs and measured budgets | All stages | simulator/contract/architecture/skills/checks agree, before-after recorded | REVIEW | Developer docs, instructions, simulator and all24 checks synchronized |
| R16 | Security, atomicity, recovery and regression acceptance | Principles/verification | all checks plus disposable simulator/restart, independent review | REVIEW | Implemented; independent final verification pending |

## Work units
- W0 R1,R2: measurement agent owns grill.mjs/check-context and stage0 docs. Review round0.
- W5 R13,R14: instruction_split agent owns skill Markdown, events/, link-skill/check-workers and README install notes. Disjoint concurrent execution with W0. Review round0.
- W1-4 R3-R12: sequential runtime work after verified baseline; scope to assign.
- Full scope synchronization/review and independent verification after integration. Fresh read-only reviewers without inherited history; distinct fixers.

## History
- User authorized implementation on new branch and archive of old completed orchestration state.
- Branch created; W0 and W5 running concurrently. Plan defaults adopted; optional UI topic display excluded.

## Questions/blockers
None currently. Real host semantic/loop acceptance must be distinguished from simulated transport checks.

### Wave 1 evidence
Stage0 baseline fixture characters: answer 9730; discuss 39603; question 3751; idea 32696; reevaluate 7507; reread 30826; more 1376; spec 17770; preview 1446; knowledge 71422; finish 8607. Measurement files frozen; fresh review_measurement round1 running.
Design decision: preserve complete internal context projection for revisions/frozen grading; use separate compact delivery projection. Knowledge snapshot injection must validate unknown current-session versions before existing blocked-result catch. Incremental audit remains question-only, with final candidate comparison covering indirect mutations. Lexical/duplicate thresholds will be explicit documented constants.
Stage5 routing implemented; worker+answer presently11743 bytes, headroom requested for subsequent context guidance. Not yet independently reviewed.

### Wave 2
W0 review round1 APPROVED: independent check-context/monitor/workers passed, no findings. R1/R2 ready for final verifier (remain REVIEW until verification). Stage0 author additional current-work/maps checks passed.
W5 implementation complete: answer instruction bundle10262bytes; author check-workers twice, link installer and Markdown links passed. Fresh review_split round1 active.
W1-4 runtime_implementation owns runtime/checks/simulator sequentially; docs_sync concurrently owns developer docs only. Runtime evidence stays separate from lossy delivery. No simultaneous writes to shared files.

W5 review round1 APPROVED; no semantic loss findings. skill_sync now updates routed instructions for stages1-4, preserving <12KB answer budget. Full integration review still required.


Runtime interim stage1-3 measurement (not final acceptance): answer9588, discuss14095(35.59% baseline; budget pending), idea7450, knowledge30137. Captured on-demand reads use context.readToken/--token and must fail closed on stale/missing snapshot. Stage4 underway. Docs/instructions synchronizing exact shapes directly with runtime owner.

### Integration
Stages1-4 runtime core implemented; runtime owner adds deep context regressions and budget assertions. docs_sync completed eight developer/agent docs, local links/diff checks pass. skill_sync completed focused/read-token/semantics/incremental/knowledge instructions; worker+answer11932bytes. Consumer_compatibility owns existing dev/check-* except check-context and simulator, replacing old payload assumptions without weakening negative coverage.
Stage0 and Stage5 each have one clean scoped review; full integrated review not yet performed. Real Codex/Claude context workflow acceptance remains unverified and must be reported separately.

Consumer migration progress: discussion/workers/knowledge/spec/monitor/connection/current-work/usage/locale checks pass. Legacy image focus-path regression identified and sent runtime owner. Remaining idea/preview/completeness/reread/watch/maps checks in progress. Real host acceptance uses Codex0.167.2 and Claude2.1.322 disposable foreground two-event loops; explicitly excludes monitor wake/dispatcher claims.

### Pre-review acceptance
- Full runtime implementation frozen; check-context author PASS. Final measured discuss13796/39603=34.84%, idea7450/32696=22.79%, incremental8646/full26329=32.84%, knowledge30137/71422.
- Root disposable simulator context-smoke-1111 PASS: gap/ok/verify, root discussion, more, reread, finish/queue drain, Markdown report3030chars, missing-header403. Own server stopped.
- Both real host foreground loops PASS: Codex0.167.2, Claude2.1.322. Actual answer/apply/discuss/apply, distant evidence read, stale semantic hints rejected, no duplicate questions, queue0. Claude needed session-local Bash,Read permission allowlist for heredoc. No global changes. Evidence host-acceptance-results.json; interactive wake/Play not covered.
- Fresh full integrated reviewer review_integrated_1 started (full-review pass1). Browser consumer teardown fixes ongoing only; runtime/docs/instructions frozen.

Correction to suite count: 16 existing API/CLI checks + check-context + 7 browser checks = all24 standalone check files, plus simulator syntax. All passed before integrated review. Browser harness baseline drift fixes: session usage wrapper child-order assertion and VM DOM stub; bounded Chromium shutdown retains locked temp profiles with warning rather than masking functional assertions. No UI changes.

## Full review pass 1 — CHANGES_REQUESTED
Fresh reviewer independently ran context/reread/discussion/knowledge/spec/workers/monitor/maps and diff checks, all passed, but reproduced three uncovered issues:
- F1 P2: whole-map size bound still rejects focused discuss/idea and incremental reread with unrelated long histories; inspect grill.mjs490/580/601.
- F2 P2: reread merge/close changes evidence without semanticsStale, leaving old decision marked current.
- F3 P2: merges/removals leave dangling relates; merge targets must remap, self/duplicates disappear, removals prune, atomic live/frozen scope preserved.
Parent confirmed relevant code paths. Fresh distinct fixer fix_integrated_1 assigned all findings plus regressions/docs. Full review count1; requirement statuses remain REVIEW, no clean claim. Required review-fix-checks-commit will commit this nonclean iteration after fixes/checks, then new independent reviewer.


### Review1 fixes verified
Fresh fixer addressed F1-F3; targeted context/reread/discussion/ideas/spec/workers PASS including oversized unrelated histories and focus, stale merge/close, graph remap/prune/union>8 rejection, explicit replacement, indirect incremental audits, live/frozen deletions and idea edits. Budgets unchanged; worker11941bytes. All runtime/docs/check files frozen.
Root final all24 check suite running, per-check results in check-results.json. Preparing review1 implementation/fix commit after targeted relevant checks passed; final full-suite result will be recorded separately.
