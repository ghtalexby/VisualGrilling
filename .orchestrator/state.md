# UX completeness implementation

Project: VisualGrilling. Specification: docs/specs/grill-ux-completeness.md (2026-11-08).
Iteration: 1. Phase: fixing review 2 finding. Limits: 5 iterations, 3 review rounds per unit (mandatory repository review loop takes precedence).
Unrelated user changes: .gitignore, AGENTS.md. Preserve; exclude from commits.
Checks: dev/check-*.mjs, disposable simulator, browser checks when available.

## Requirements
| ID | Requirement / source | Acceptance | Status | Evidence |
|---|---|---|---|---|
| R1 | §2.1 persisted concrete reserve and coverage | 5+5=50, 8+2=80, unknown distinct, active q only | REVIEW | Implementation complete; integrated checks pass |
| R2 | §2.2 unified reread and automatic batches | 0–3, settled queue, dedupe/restart/finish safety | REVIEW | Implementation complete; integrated checks pass |
| R3 | §2.3 ancestor reassessment | semantic verdict, original answer/history, stale/snapshot isolation | REVIEW | Implementation complete; integrated checks pass |
| R4 | §2.4 chat read state | persisted exact seen reply, active tab, counts/root chat | REVIEW | Implementation complete; integrated checks pass |
| R5 | §2.5 explain question | independent request, drafts and error preservation | REVIEW | Implementation complete; integrated checks pass |
| R6 | §2.6 multi-select | combined answer, exclusive unknown, length/drafts/errors | REVIEW | Implementation complete; integrated checks pass |
| R7 | §2.6 copying | question/answer/verdict/message exact block and error | REVIEW | Implementation complete; integrated checks pass |
| R8 | §2.7 ideas | atomic idempotent queued analysis, stale edits | REVIEW | Implementation complete; integrated checks pass |
| R9 | §2.8 filters | zero selectable, ideas counted, ancestors only, hidden drawer draft | REVIEW | Implementation complete; integrated checks pass |
| R10 | §2.9 camera | all/branch fit, panel geometry, manual 10%, explicit edge decisions | REVIEW | Implementation complete; integrated checks pass |
| R11 | §3 contracts/exports/docs/locales | synchronized worker/simulator/docs and history exports | REVIEW | Integrated synchronization/checks complete |
| R12 | §4–5 preservation/security/regression | token/atomic/snapshot/security tests + fresh review | REVIEW | Integrated synchronization/checks complete |

## Work units
- W1 server: R1,R2,R3,R4(server),R8; grill.mjs and new dev/check-completeness.mjs. Fresh implementer.
- W2 UI: R4–R7,R9,R10; ui.html/locales/en.json, new browser checks. Fresh implementer. Agree server fields first.
- W3 synchronization: R11; skills instructions, docs, simulator, existing checks. Starts after server contract.
- Integrated review: fresh read-only reviewer, then distinct fixer if needed; independent full-spec verifier.

## Decisions
Technical camera choice: branch focus disabled without selection; focus clears filter/isolation so complete selected branch is laid out while other branches stay visible. Previews only appear as required context under status filtering. Manual zoom after sub-10% fit returns to at least 10%.
Other protocol limits and migration decisions to be documented after server design.

## History
- Startup: read applicable AGENTS and docs/spec. No code edits yet.

## Questions/blockers
None. User authorized full implementation; no deployment/push requested.

- Baseline before implementation: node dev/check-spec.mjs, check-ui-api.mjs, check-preview.mjs passed on 2026-11-08. Node v22.19.0 supports CDP browser harness.
- Protocol design in progress: reserve null/array bounded 100, exact chat message IDs/read acknowledgements, tokenized ancestor reevaluate with frozen/live separation. Implementers coordinating consumers.

- Repository has a tracked .claude/skills/grill junction to skills/grill. Git reports both paths for the same physical edits; task commits must synchronize both tracked copies. Do not alter/remove junction.
- Preview browser regression passed during implementation. Ideas browser old assertion fails as expected after ideas begin contributing to status counts; synchronization agent updating expectation.

- Integrated disposable simulator smoke passed: node dev/simulate.mjs --no-open --delay 200 --name ux-smoke-1794129991609 --port 0; graded gap/ok/verify, root discussion, reread consumed 3 reserve candidates, compatibility more, spec, finish/report, missing-header 403. Server stopped; named disposable runtime retained.

- W2 implementation ready: root independently ran check-completeness-browser PASS in actual Chromium. W1/W3 finishing protocol checks/docs.
- Integrated regression checks PASS: check-spec, check-reread, check-ui-api, check-ideas, check-workers, check-maps, check-locale, check-watch. Existing check-preview still needs deliberate captured ancestor-event ordering adjustment (assigned server agent). Scoped git diff --check clean; unrelated AGENTS EOF whitespace ignored.


- W1/W2/W3 frozen. Fresh read-only reviewer review1 assigned full integrated scope. Author tests and root tests pass; root check-preview + ideas-browser + preview-browser reruns passed. Review round 1 for W1/W2/W3.

- Specification blob hash: 4f691df221fe22de7e319079c7847d0da3e228c3. Root check-completeness passed including restart, exact read receipts, stale ancestor tokens, frozen/live isolation, auto/no-loop/finish. All 13 standalone API/browser checks have passed during integration. Review1 still evaluating full task.


## Review pass 1 (CHANGES_REQUESTED)
- F1 P2: grill.mjs boundBranch whole-map reassessment/reread starves queue for valid maps over 500 total nodes; independent seeded probe reproduced wait400 → finish200 → wait400.
- F2 P2: reevaluation work absent from queueLength/status drain count; finish+child grading stops dispatcher before parent review. Independent normal API probe reproduced.
- F3 root confirmation: mergedFrom retains verdictHistory but UI/report/Markdown omit removed-source historical verdicts; §2.3/§3 require accessible history. Inspected report loops and nodePanel/toMarkdown.
- Fresh distinct fixer fix1 assigned all confirmed findings, tests and synchronized docs. R2/R3/R11/R12 remain REVIEW pending fixes. Review count1; no clean claim.


- Fresh fixer fix1 addressed F1–F3, including oversized single-branch recovery, frozen batched restart, premise ancestor context, status/list drain count and merged-history presentation/export. Relevant author checks pass. Root full13 suite running/passing.
- Real Claude Code semantic smoke (claude --print, no tools, isolated temp cwd, default configured model) passed supplied worker fixtures: resolved duplicate-charge risk → ok; unanswered throughput assumption despite answered unrelated children → verify; duplicate reserve candidate discarded and useful candidate issued. No files/tools or host wake-up behavior tested. Session 9977bb55-4d70-44b8-8714-170b5462fb36. This is a small semantic smoke, not proof of model completeness.

- Review1 fix/check phase complete: all13 root-run standalone API/browser checks passed; scoped diff whitespace clean. Base commit16d524f8e0cd3c5cbb1b584eea10f43f85739479. Preparing one task commit for non-clean review iteration1, then fresh review2.


- Task implementation and review1 fixes committed as b1b58a1. Unrelated .gitignore/AGENTS remain unstaged. Fresh read-only review2 assigned full base16d524f..HEAD scope without previous findings. Review round2 W1/W2/W3.

- Final b1b58a1 simulator smoke passed on disposable ux-final-1794130769027: child grading queued and applied ancestor review, idea creation auto-analyzed, reread consumed reserve, frozen idea/spec events, finish/report. Server stopped; only smoke-generated specification removed. Earlier smoke also covered gap/ok/verify, root chat, compatibility more and403.


## Review pass 2 (CHANGES_REQUESTED)
- F4 P1 lifecycle: queued edit-triggered automatic reread survives finish; already delivered automatic reread remains applicable after finish request because content revision omits lifecycle. Independent public API probe confirms finish→edited answer→automatic reread with finished:true. Explicit manual reread must remain allowed.
- Fresh distinct fixer fix2 assigned cancellation/commit boundary, queue drain preservation, lifecycle regression and docs. Review2 independently passed completeness API/browser; no other concrete findings.

- Fix2 frozen: automatic rereads canceled at finish request/recovery/dispatch/apply boundaries; manual requests/upgrades and answer/ancestor drain preserved. Root simulator ux-stop-1794131152924 passed in-flight cancel (old apply409), after-finish edit without issuing reserve, explicit manual reread issued3. Other root suite checks passed; completeness result recorded by orchestration tool.

- All13 checks PASS after fix2; scoped whitespace check clean. Preparing review2 fix commit and fresh full-scope review3.
