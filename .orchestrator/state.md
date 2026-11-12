# ContextBudget implementation

Project: VisualGrilling. Plan: docs/plans/ContextBudget/context-budget.md.
Base: 6d078d384a425b8dfbe8f5618e43f56d8c145255. Branch: feat/context-budget.
Iteration: 1. Phase: complete. Limits: 5 iterations, 3 review rounds per unit; mandatory until-clean repository review takes precedence.
Previous completed record archived as ux-completeness-completed.md with user approval. Initial working tree clean.
Checks: all dev/check-*.mjs; disposable simulator --no-open --delay 200; restart recovery; host acceptance where available.

## Requirements
| ID | Requirement | Source | Acceptance | Status | Evidence |
|---|---|---|---|---|---|
| R1 | Bounded delivery telemetry persisted and exposed read-only | Stage 0 | 200 entries, totals by type, no payload change | DONE | grill.mjs:635; check-context.mjs:390 retention/restart/reset PASS |
| R2 | Reproducible 40+ card baseline across event types | Stage 0 | check-context, baseline recorded before payload edits | DONE | check-context.mjs:57,68; 40-question fixture and all11 event baseline PASS |
| R3 | Compact projection and canonical discussion chat | Stage 1 | no duplicated chat, empty fields, timestamps; targeted histories | DONE | context.mjs:11; grill.mjs:584; context/discussion PASS |
| R4 | Server-injected captured knowledge snapshots | Stage 1 | valid versions injected, unknown rejected atomically, prior/manual sources preserved | DONE | grill.mjs:315; check-context.mjs:239; source injection/rejection/preservation PASS |
| R5 | Focused event context, index and lexical selection | Stage 2 | discuss/idea <=35% baseline; bounded related; complete coverage | DONE | context.mjs:24,69; check-context.mjs:88; budgets/coverage/branch independence PASS |
| R6 | Protected read-only node/branch/index/search | Stage 2 | max20 nodes, validation, no queue/listening effects | DONE | grill.mjs:1190; check-context.mjs:98,258; security/nonmutation/frozen reads PASS |
| R7 | Atomic duplicate guard across all addition paths | Stage 2 | rejects matching IDs, allowSimilar supported | DONE | context.mjs:124; grill.mjs:309,539,874,939,973,981,1130; duplicate checks PASS |
| R8 | Semantic fields and validation across apply paths | Stage 3 | limits, valid links, stale/clear behavior | DONE | context.mjs:85; context checks bounds/stale/clear/atomicity PASS |
| R9 | Bidirectional graph navigation and vocabulary | Stage 3 | neighbours first, related/topic search, capped vocabulary | DONE | context.mjs:32,41; check-context.mjs:118,162 reverse/topic/cap PASS |
| R10 | Semantics excluded from evidence projections | Stages 1,3 | spec/knowledge/export identity | DONE | context.mjs:3; grill.mjs:229; check-context.mjs:138,176 evidence identity incl previews PASS |
| R11 | Incremental automatic reread and audit validation | Stage 4 | changed cards + neighbours, full manual/first, <=40% full budget | DONE | grill.mjs:607,1142,1158; context/reread full/incremental/indirect audits PASS |
| R12 | Changed answered-card knowledge threshold | Stage 4 | configurable default5, finish/manual preserved | DONE | grill.mjs:351,1160,1611; context/knowledge/workers threshold/finish/config PASS |
| R13 | Event-specific worker routing and instruction split | Stage 5 | answer worker <12KB, complete rules and routing | DONE | worker.md:5; check-workers.mjs:13; routed answer bundle11941bytes PASS |
| R14 | Mode-specific workflows and installation | Stage 5 | monitor/dispatcher/parallel extracted, installer/checks synced | DONE | SKILL.md; dev/link-skill.mjs:14; workers/monitor/maps PASS |
| R15 | Synchronized consumers/docs and measured budgets | All stages | simulator/contract/architecture/skills/checks agree, before-after recorded | DONE | 40 changed Markdown files links PASS; contracts/simulator/syntax/diff PASS |
| R16 | Security, atomicity, recovery and regression acceptance | Principles/verification | all checks plus disposable simulator/restart, independent review | DONE | Independent all24 checks final PASS,7 browsers no skips; review4 APPROVED; qualifications below |

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

## Full review pass 2 — CHANGES_REQUESTED
Implementation/fixes committed84a9702. Fresh reviewer independently passed context/reread/knowledge/discussion/workers, then reproduced F4 P2 via valid API: prepared/unbuilt preview annotated through reread leaks decision/topics through specNode preview early return into spec nodes and grading capture. Built preview allowlist is safe. Parent confirmed early return before semantic destructuring. Fresh fixer fix_integrated_2 assigned minimal all-kind semantic stripping and API regression; full review count2. Separate fix commit planned after relevant checks, then fresh full review3.

F4 fixed with semantic stripping before preview handling; prepared/unbuilt and built API regression verifies byte-identical spec.nodes/gradingNodes/delivery and preserves metadata. Targeted context/spec/preview/knowledge checks PASS. Root full24 suite on preceding84a9702 passed with0 failures; final verifier will rerun all24 on final tree. Preparing separate review2 fix commit.

## Full review pass 3 — CHANGES_REQUESTED
Fresh full reviewer found no confirmed runtime issue but F5 P2 stale relative-image instructions in discuss/idea/reread rules versus absolute delivered paths; F6 P3 G index CLI documented JSON instead of plain text. Parent confirmed both. Fresh fix_docs_3 assigned documentation-only correction and link/content checks. Context/reread/workers independently passed; count3. Mandatory until-clean requirement takes precedence over orchestrator default3-round cap; continuing fresh review after fixes. EOF whitespace normalized.

## Full review pass 4 — APPROVED
Fresh reviewer independently inspected complete6d078d3..f4a017d scope and found no actionable defects. Independent context/reread/knowledge/workers and diff checks PASS; worker11941bytes. Review-fix-until-clean reached clean review after4 full passes (plus2 scoped stage reviews). Three nonclean iterations committed84a9702,1e70826,f4a017d. Final independent documentation/requirements verifier next; R1-R16 remain REVIEW until evidence returned.

## Final independent verification — complete
Iteration1 completed; R1-R16 DONE (16/16). Fresh verifier inspected all documentation and final integrated f4a017d code; no omitted requirements or new in-scope defects. Full review cycle:4 passes, final clean; additionally2 scoped early-stage clean reviews. Implementation commits84a9702,1e70826,f4a017d; no push or unrelated changes.

Independent all24 unique standalone checks have passing final outcomes, including7 actual browser suites with no skips. Initial concurrent knowledge lock test failed with ENOENT at unchanged knowledge.mjs:64; isolated rerun passed. This pre-existing lock-reclamation race remains outside task scope and is recorded, not hidden. Some Windows Chromium profiles were retained after cleanup warnings; functional checks passed. Forty changed Markdown files have no missing local link targets; syntax/diff checks passed.

Measured final sizes: discussion13796/39603=34.84%, idea7450/32696=22.79%, incremental reread8646/26329=32.84%; knowledge30137/71422. Shared+answer instructions11941bytes (<12000). All plan budgets pass.

Evidence: verification-results.json (independent attempts), check-results.json (parent full24 run), host-acceptance-results.json (real Codex0.167.2 / Claude2.1.322 bounded foreground answer/apply/discuss/apply loops). Root simulator exercised gap/ok/verify,discussion,more,reread,finish/drain/report and403; own server stopped. Restart and frozen-read recovery covered in deterministic suites. Full interactive monitor wake, Play, dispatcher, parallel-map real-host behavior, real-model knowledge extraction and incremental reread were not independently re-established; no such acceptance claim is made.

No remaining task implementation blockers or unresolved review findings. Optional UI topic display/deferred features remain outside scope. Final record is resumable here; source plan includes historical baseline and final measurements.
