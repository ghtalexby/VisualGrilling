# Session audit implementation

Project: VisualGrilling. Plan: docs/plans/ContextBudget/session-audit-2026-11-18.md.
Plan SHA256: 81FBE61319AE3AA9E7B954BCF40A1FE36528E552C0016901F911D3A99575A740.
Base: e8b930f5bb5150b7e4c572c214cea89ac1c1bf17. Iteration 1, phase 1. Limit: 5 iterations; mandatory review-until-clean overrides review cap.
User authorized implementation and archival on 2026-11-18. Previous ledger: boards-hub-before-session-audit-2026-11-18.md. Preserve unrelated README.md changes.

## Requirements
| ID | Requirement / source | Acceptance | Status | Evidence |
|---|---|---|---|---|
| R1 | P1 waiting and bounded reads | 45–60s worker waits, 20–30s shell yield for 15s wait; bounded reads; synchronized modes | IN_PROGRESS | Pending |
| R2 | P1 template and local preflight | Worker catches missing coverage.sources and ancestor intent before receipt; pure validation, multipart and identity checks | IN_PROGRESS | Pending |
| R3 | Narrow P2 combined ancestors | Legacy discussion assessment accepts inline ancestors atomically; old-client omission fallback; reply-only has no grade | IN_PROGRESS | Pending |
| R4 | P2 correctness boundaries | Preserve reread, stale revisions, ordering, frozen state and finish drain; negative regression checks | IN_PROGRESS | No branch-only reread suppression |
| R5 | Owner prototype host gate | Inspect existing host routing; distinguish verified from unverified child create/resume/complete/restart | IN_PROGRESS | APIs exist; lifecycle unverified |
| R6 | Release and synchronization | Docs, contracts and consumers synchronized; one version bump; installed version verified | TODO | Pending |
| R7 | Independent review and checks | Fresh review until clean; relevant suites, simulator/API checks, fix commits | TODO | Pending |
| R8 | Matched experiment | Equal cold/warm real scenarios; actor-specific tokens/model calls, semantic quality | BLOCKED | Controlled real-session experiment pending; baseline remains frozen |
| R9 | Later gated P0/P3/P4/full P2 | Record prerequisites and remaining scope honestly | TODO | Recommended next scope P1 + narrow P2 + routing gate |

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
