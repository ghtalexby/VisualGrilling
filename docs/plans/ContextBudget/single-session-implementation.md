# Single-session implementation handoff

Branch: `feat/single-session-grilling`. Base: `c48bc94911c2007445e6ee5fd2ed2243b89fa7f4`.
Worktree: `D:/programming/my/Programming/VisualGrilling-single-session`.
Requirement evidence and review/check history: [state](../../../.orchestrator/state.md).
Measurement protocol and pending real acceptance: [measurement](single-session-measurement.md).

The bound host session prepares, preflights and applies every event. Hybrid waiting remains a 15-second wait followed by monitor on timeout; pure monitor remains selectable. Legacy reuse/model configuration is validated but ignored, with a bounded stderr diagnostic. Current deliveries have no child reuse manifest. Historical descendant usage remains counted, with incomplete telemetry explicitly reported.

## Installation boundary

This branch does not install, merge or push. Global Codex junctions remain on the original checkout at version 1.0.29. Candidate release 1.0.30, all 44 tracked mirror files, package/extension versions and UI stamps are consistent. Actual real-host semantic and economic acceptance remains pending; deterministic checks do not establish savings.

When installation is explicitly requested, first settle or safely requeue reserved work and stop its existing consumer/server. Do not run hot mixed-version consumers against one map. Install the complete accepted skill package, then verify the canonical installed path, package version and file hashes. Any separately installed Hub runtime requires its own package update; a skill junction does not replace that runtime. Resume with the same project, map root/name and ownership procedure. A pre-upgrade delivery/result token is stale after restart; retrieve the recovered event and do not replay its old result.

## Rollback

Preserve the original baseline runtime (commit above, version 1.0.29) and baseline manifest. Stop the candidate consumer after settling work or allowing normal restart requeue. Keep current map state, action journal, knowledge and artifacts; never overwrite them with old snapshots. Before resuming the baseline, use an independent disposable copy of current state to verify old-reader compatibility and pending-work recovery. Only then resume the preserved original map with its valid baseline configuration and existing ownership/Hub epoch procedure. Candidate delivery tokens and notifications cannot authorize a baseline consumer. Retain all aggregate measurements, including adverse outcomes. Global installation and any Hub rollback remain explicit separate actions.
## Verified outcome

Implementation commits: `3152fcf` and `0d640a7`. Three fresh review passes; the third was clean. A separate full-plan verifier approved S1-S10 and S12 for implementation/deterministic scope. S11 remains pending real paired host sessions, long-history behavior and human semantic review. No savings are claimed.

All 30 required deterministic suites passed on disposable state, plus `node dev/check-worker-reuse-integration.mjs --baseline c48bc94` against the actual historical runtime. See the [final check summary](../../../.orchestrator/single-session-final-checks.json) and [requirement evidence](../../../.orchestrator/state.md). Earlier failed checks and their fixes remain in the ledger/logs. The original baseline runtime hashes, audit references, installed junctions and unrelated original README change are preserved.
