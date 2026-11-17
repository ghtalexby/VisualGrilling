# Task: reduce end-to-end grilling token consumption

Owner: project maintainer. Status: active. Updated: 2026-11-16.

## User authorization and scope

The user requested an investigation, a specification and implementation of the first three improvements, followed by an overarching task and research folder for work across iterations/sessions. Phase 1 implementation is authorized. Later behavioral changes are proposals until selected; do not silently shorten evidence, downgrade models, migrate sessions or disable coverage.

## Resume procedure

1. Read repository AGENTS.md and relevant docs, then this folder.
2. Inspect git status/log and the latest verification log below; preserve unrelated changes.
3. Read phase-1.md and actual code before assuming an item is implemented.
4. Continue the first unfinished authorized item. Record changes, commands/results, blockers and next action here before ending a session.
5. Run the mandatory independent review/fix/check/commit cycle after code changes. Do not count synthetic checks as real token-saving acceptance.

## Requirements ledger

| ID | Outcome | Status | Evidence / next step |
|---|---|---|---|
| R1 | Reproducible baseline and measurement limitations | Investigated | RESEARCH.md; collect matched real sessions later |
| R2 | Compact agent knowledge index, preserved full inventory | Complete | d46d377, 84f27cf; deterministic checks passed |
| R3 | File handoff for delegated events/results | Complete | d46d377, 84f27cf; deterministic checks passed |
| R4 | Parent + descendant usage, explicit incomplete telemetry | Complete | d46d377, 84f27cf; deterministic checks passed |
| R5 | Protocol/docs/fixtures synchronized | Complete | Contract, workflows, mirror, locale and tests synchronized |
| R6 | Release, installed package and independent review | Complete | Version 1.0.20; 3 independent review passes, final pass clean |
| R7 | Comparable real-session cost and quality acceptance | Pending | SPEC.md measurement protocol |
| R8 | Select next optimization based on measurements | Proposed | Service calls, exact duplicates, instruction budget |

## Session log

### 2026-11-16: investigation and phase 1 start

- Read code, workflow instructions, prior plans and saved contextStats without changing user maps.
- Independent read-only review confirmed knowledge-index rereads, conditional parent/worker duplication and missing child-thread aggregation.
- Recorded phase-1 contract before implementation. Working tree was clean at start.
- Verified local Codex session metadata contains explicit parent_thread_id and source.subagent.thread_spawn.parent_thread_id. No transcript content was used for this schema check.
- Initial action was implementation of R2–R4; see subsequent verification and current continuation below.

## Completion rule

Phase 1 completion does not close the overall task. Close the program only after a matched real-session comparison demonstrates lower end-to-end cost with acceptable answer quality, no lost evidence, and no stale/duplicate application. Report cache/input/output separately and include child workers. Otherwise record the next hypothesis and keep the task active.

### Review iteration 1 and checks

- Reviewer found disappearing child rollouts could be forgotten and falsely report complete usage. Fixed by retaining known descendants until rebinding; added disappearance/rescan fixture.
- Force-added the five requested program documents because docs/plans is ignored by repository defaults.
- Runtime checks exposed slow startup under large real session archives. Discovery now runs in the background with bounded filesystem concurrency and a 100 ms foreground wait. Initial partial telemetry is explicit.
- Passed: check-worker-cost, check-usage, check-knowledge, check-monitor, check-watch, check-context, check-maps, check-actions-simulator (gap/ok/verify, chat, more, finish/report, protected API).
- Locale and browser usage checks passed after the latency fix. Real bound-session smoke read: 158 ms initially, then 1–2 ms; two workers available. Discovery uses standard parent-day-and-later Codex storage and reads only the bounded first metadata line.
- Release 1.0.20 stamped; local/global Codex links verified. Next independent review remains pending.

### Additional metadata ordering regression

- The second independent pass was clean. A subsequent self-check identified that a parent_thread_id after base_instructions could be missed by prefix-only parsing. Replaced that optimization with bounded chunked reading of the complete first metadata line and added a long-instructions/key-order fixture.
- Re-run worker-cost and usage checks, then a fresh independent pass over the final scope. This change does not add another release bump.

## Current continuation

Phase 1 runtime is implemented in d46d377 and 84f27cf; version 1.0.20 is installed through verified local/global Codex links. Final independent review is clean (3 passes in total). No push was requested or performed.

Verified commands (passing):

- `node dev/check-worker-cost.mjs`
- `node dev/check-usage.mjs`
- `node dev/check-knowledge.mjs`
- `node dev/check-workers.mjs`
- `node dev/check-context.mjs`
- `node dev/check-watch.mjs`
- `node dev/check-monitor.mjs`
- `node dev/check-maps.mjs`
- `node dev/check-locale.mjs`
- `node dev/check-current-work-browser.mjs`
- `node dev/check-actions-simulator.mjs` (runs the required simulator with --no-open --delay 200 on a disposable map)
- `git diff --check`

Initial worker/locale/simulator failures were caused by broad metadata discovery latency and resolved after bounded background discovery starting at the parent's standard storage day. Stop requests were issued for the failed disposable test instances; user maps were not reset.

Final implementation smoke read against the bound Codex session: three workers observed, complete telemetry, 260 ms cold and 2 ms warm. This validates telemetry availability, not measured token savings. Serialized full saved index: 78708 characters; compact projection: 17652 (78% smaller for this index only).

Next session: start with R7. Arrange a matched real interaction under SPEC.md; record parent/worker usage, cache, model calls, retries and semantic quality in a dated measurements document. Do not claim total savings from payload sizes or these smoke checks. R8 changes remain proposals until selected. Real Claude instruction acceptance and end-to-end file-based grading still require real-host interaction.

Final review: three fresh read-only passes; the final pass reviewed the complete implementation range d46d377^..84f27cf and found no unresolved issues. Phase 1 is complete; the overall program stays active for R7/R8.
