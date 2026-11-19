# Single-session grilling migration plan

Status: implementation plan only. Requested after the Languages audit. Execute in a separate branch and implementation session; this document does not switch the installed skill or change runtime behavior.

## Decision and objective

Replace per-event child agents with one executing host session. The same session receives an event, reads authoritative evidence, prepares a result, validates it and applies it. Here, "agent-free" means no delegated model workers, not removing the primary model or the deterministic server.

Make this the normal grilling architecture, including Codex hybrid and pure monitor. Do not add an automatic delegation fallback, persistent card workers, another model dispatcher, or nested CLI inference. Retain asynchronous server wake-up: removing children does not require returning to continuous model polling.

The owner reports that the earlier single-session workflow cost less. This is a hypothesis supported by a plausible duplication mechanism, not a matched measurement. The [Languages audit](languages-session-audit-2026-11-18.md) recorded 150 model responses for five events, including 69 parent responses. Reread, knowledge and specification accounted for 71.2% of uncached input. Current same-card answer/discussion reuse does not cover those three operations. The [earlier audit](session-audit-2026-11-18.md) has a different workload and is not a comparative baseline.

Success requires a working single-session workflow, unchanged semantic and safety contracts, and an honest matched cost/quality comparison. Fewer child launches alone do not prove lower cost: the primary session's retained history can become more expensive.

## Branch and isolation

- Suggested branch: `feat/single-session-grilling`.
- Planning reference HEAD: `cbc6dc66f6371cd35f0ba1235f7b50a543a2689d`. At implementation start record the actual chosen base and inspect subsequent changes; do not reset to this hash blindly.
- Prefer a separate Git worktree. Carry this plan into it explicitly if the plan is not yet committed. Preserve unrelated working-tree changes, especially README; do not copy them into implementation commits.
- Create a new branch-local requirement ledger for this plan. Preserve the existing audit ledger/history instead of overwriting it without authorization.
- Before tests or edits, inspect installed skill junctions. They currently point into the original working checkout. Do not relink the global Codex skill to the experimental branch until acceptance and an explicit installation request. Tests use absolute paths into the worktree and disposable map roots/Hub homes.
- Record the exact baseline skill/runtime path for comparisons. Never run old and new consumers against one map or share mutable map/knowledge files between runs.
- No push, merge, user-map reset or installed Hub replacement is part of implementation by default.

## Scope and non-goals

The migration covers all normal event preparation, with Codex as the primary acceptance host. Other supported hosts use their existing inline level 0/1 processing; level 2 child dispatch is retired from the active workflow. Retain existing level 1 sequential multi-map support where already supported; Codex remains one map per session. Do not introduce new parallel processing.

Keep the server, UI, durable queue, context APIs, knowledge storage, result preflight, file apply, usage accounting and host connection transport. Keep explicit session transfer: a user-requested replacement session with ownership fencing is different from a per-event child worker. Never transfer automatically merely to evade a context budget.

Do not combine this migration with new history projections, knowledge/provenance storage redesign, reread suppression, higher document limits, model/effort changes, UI redesign or full P2/P4. Those changes would obscure the comparison and introduce separate correctness risks. Near-limit knowledge documents remain a recorded follow-up; preserve current limits and error behavior.

Repository implementation/review agents required by AGENTS.md are outside the product runtime prohibition. Their token cost must not enter grilling benchmarks.

## Requirements and acceptance ledger

| ID | Requirement | Acceptance evidence |
|---|---|---|
| S1 | One model executor | Every event type is prepared/applied by the bound session; no spawn, followup-to-child or worker-wait tools in ordinary grilling traces |
| S2 | Preserve waiting semantics | Hybrid 15-second wait then monitor, explicit pure monitor and justified blocking fallback retain their existing ordering; no overlapping consumers |
| S3 | Shared semantic procedure | Main session reads the same grading, coverage, provenance and event rules; no duplicate parallel instruction source |
| S4 | Local result transaction | Token-specific files and read-only preflight remain; complete multipart preflight before first apply; identity/epoch/freshness checks retained |
| S5 | Safe legacy reuse migration | A valid old `workerReuse.enabled:true` config cannot enable child preparation or cause an unfulfillable manifest acknowledgement |
| S6 | Recovery and ownership | Restart, stale notifications/results, Hub Stop/Play, transfer and finish boundaries preserve queued work without duplicate commits |
| S7 | Bounded authoritative reads | Alias-equivalent instructions are not loaded twice; truncation is detected and repaired; summaries never replace evidence |
| S8 | Honest telemetry | Existing historical descendants remain countable; a no-child run reports actual primary usage and zero observed workers only with adequate completeness |
| S9 | Synchronized delivery | Docs, active instructions, installer requirements, release mirrors and relevant fixtures agree; no reachable default delegate instructions remain |
| S10 | Deterministic regression checks | Required protocol, evidence, queue and security suites pass on disposable state; fresh independent review is clean |
| S11 | Real acceptance | Matched repeated sessions report cost, latency and semantic quality, including adverse results and measurement limits |
| S12 | Release and rollback | One release bump for the completed change, verified package/mirrors; installation is a separate explicit step; rollback preserves data |

## Phase 0 — capture the baseline

Read repository instructions and [documentation index](../../README.md), [architecture](../../architecture.md), [contract](../../contract.md), [development](../../development.md) and [conventions](../../conventions.md). Read the [measurement protocol](../TokenEfficiency/SPEC.md) and both audits.

Inspect current code rather than assuming the planning revision is unchanged. Inventory references to delegation, worker receipts, `workerReuse`, `workerContext`, `workerContextAck`, griller role configuration and level 2. Include generated continuation/wake-up instructions, connection/Hub launch prompts and the tracked skill mirror, not just SKILL.md. Preserve useful telemetry and shared semantic rules when removing dispatch machinery.

Prepare immutable disposable fixtures and a machine-readable comparison manifest: base/candidate commit, runtime path/version, host/model/effort, language, waiting mode, configuration, project/map/knowledge hashes, scenario and run IDs. Save the baseline with default fresh-worker behavior; do not accidentally benchmark the opt-in reuse prototype as the baseline.

Deliverable: branch-local S1–S12 ledger, exact file inventory, baseline manifest and repeatable scripts/input sequence. No changes to frozen audit files or their metrics.

## Phase 1 — replace the active instruction path

Primary files: `skills/grill/SKILL.md`, `hybrid.md`, `monitor.md`, `worker.md`, `handoff.md`, `dispatcher.md`, `parallel-maps.md`, `session-transfer.md`, `events/*.md`, `knowledge.md`, `preview-format.md` and `shell-json.md` where they contain ownership assumptions.

1. Make the primary session the preparer as well as consumer/applier. Delete mandatory spawn/worker-wait/receipt relay steps from normal handling. Never introduce a "fresh child on error" fallback.
2. Retain `worker.md` initially as the shared semantic procedure, but retitle/reword its contents for the current executor. Its filename is compatibility, not a delegation requirement. A later rename is optional and must update every link and package consumer atomically.
3. Rewrite `handoff.md` into the local inbox/result-file procedure or provide one canonical replacement with updated links. Preserve token-specific paths, safe UTF-8 JSON, preflight, final-only completion and explicit failure handling. Remove the child's compact receipt and optional child telemetry instructions from the active path.
4. Remove level 2 selection from active host guidance. Keep existing supported inline level 0/1 behavior; `dispatcher.md` must not remain a reachable instruction to spawn. Prefer a short retirement/compatibility pointer if deleting it would break external references.
5. Resolve installed and handoff skill aliases by canonical path before reading. Read applicable instructions once per known version/session context; after compaction or uncertain coverage, reload bounded relevant sections rather than assuming they are remembered. Inspect field sizes before printing large inbox sections. A truncated read is incomplete and must be recovered.
6. Update notes only when useful facts change. After spec/knowledge completion, remove stale statements about unfinished artifacts. Notes remain navigation, not proof; do not invent automatic brief edits or unsupported notes fields.

### Required single-session loop

1. Establish exact cwd, CLI, map root/name, language, owner and captured Hub epoch. Inspect current monitor/transfer/finish status as the existing workflow requires.
2. Retrieve one event through the selected consumer. Keep `--inbox`; read its header and complete required evidence in bounded sections in the current session. Never fetch another event during preparation.
3. Load only its routed event rules plus needed shared rules. Use fresh code/knowledge reads when required; remembered answers or earlier summaries cannot override the current event, changed policies or frozen evidence.
4. Write token-specific result JSON, then run the standalone preflight. For discussion, validate the complete ordered multipart set before applying its first part.
5. Apply against the original expected delivery token and captured epoch. Correct 400 locally; on stale 409 discard that delivery and follow existing recovery. On uncertain tool execution inspect status/receipts before any retry. Never replay a successful apply because notes or report failed.
6. Save changed notes and requested artifacts. Hybrid uses plain apply, then stops a completed monitor subscription before its next 15-second wait. Pure monitor retains final `--rearm` where valid. Never rearm mid-multipart or during preparation.
7. After finish, including failed finish, stop listening at the persisted boundary. Only explicit continuation releases later actions. Transfer settles only reserved work, fences the old session and preserves the one-owner handoff.

Dependent deterministic commands may share one tool invocation only with explicit exit-code AND result-status branching. A shell success code alone is not proof that an event applied. Do not introduce an unbounded shell loop, suppress diagnostics, or overlap monitor/wait to reduce model turns.

## Phase 2 — retire reuse activation safely

Primary code: `skills/grill/grill.mjs`, `config.default.json`, `worker-runtime.mjs`, `worker-reuse.mjs`, `result-preflight.mjs`; inspect `usage.mjs`, `telemetry.mjs` and their consumers without removing accounting.

- Remove `workerReuse` and `roles.griller` from advertised active defaults/workflow. Accept valid legacy entries for compatibility, but make them inactive with a bounded clear diagnostic outside machine-readable stdout. A legacy `enabled:true` must never activate reuse. Do not alter unrelated knowledge or rollover settings or rewrite user config automatically.
- Stop creating new worker reuse manifests/decisions in delivery payloads. The single-session path must not depend on a child UUID, child input measurements, collaboration target mapping or `workerContextAck`.
- Do not simply disable an acknowledgement validator while an old manifest-bearing delivery is active. Require settlement or safe existing restart/requeue during cutover, invalidating old tokens and preserving journal inputs. Test an old pending delivery and an old result after restart. Document that hot mixed-version consumers are unsupported.
- Preserve current token, owner, epoch, map revision and frozen-read validation. Legacy wire fields may remain accepted for backward compatibility if harmless and documented; they must not authorize bypassing freshness or ownership.
- Remove unused reuse runtime imports/modules only after confirming all dependencies, including preflight helpers and packaging. Replace protocol-specific tests with migration regressions where behavior is intentionally retired; do not delete safety assertions merely to obtain a green run.
- Retain optional historical worker attribution and descendant accounting for old sessions and other historical data. New inline results omit `workerSessionId`; never label the primary UUID as a worker or hide old descendant costs.

Deliverable: new/legacy configuration and delivery tests proving normal processing works without child state, even when an existing project previously enabled reuse.

## Phase 3 — synchronize and prove correctness

Update `docs/{overview,architecture,contract,development,conventions}.md`, repository guides where their runtime instructions conflict, `dev/link-skill.mjs`, package/install file lists, simulator/promo consumers, and `.claude/skills/grill`. Do not rewrite historical audits as if they described the new architecture. Inspect Hub packaging and generated prompts for stale workflow assumptions; do not remove the fixed WebSocket transport.

Update `dev/check-workers.mjs` to check shared rules and absence of active delegation rather than require workers. Keep its instruction budget meaningful. Add a focused single-session regression check if existing suites cannot express the migration. Static text checks alone cannot demonstrate that an actual host followed instructions.

Minimum cases:

- Answer grades `gap`, `weak`, `ok`, `verify`; mandatory clarification coverage; inline ancestors and uncovered dependency scheduling; descendant preservation.
- Question/more, root/card/idea discussion, multipart discussion, reread, reevaluate, followup, idea, knowledge, preview, spec and finish.
- Contradictory correction, obsolete/restored evidence, ignored-path changes, frozen reads after live edits and snapshot isolation.
- Stale token/notification, 400 correction, lost apply acknowledgement, restart with pending work, Hub Stop/Play and stale epoch.
- Pure monitor final rearm, hybrid timeout/arm race, no new consumer during preparation, finish pause and explicit continuation.
- Explicit transfer, unsupported transfer host, duplicate transfer notification and fenced old session; no automatic transfer due to context growth.
- Legacy reuse enabled, manifest-bearing pending delivery across upgrade, historical usage with descendants and incomplete usage.

Run appropriate existing scripts from `dev/`: `check-result-preflight`, `check-workers`, `check-monitor`, `check-watch`, `check-actions`, `check-actions-simulator`, `check-context`, `check-discussion`, `check-followups`, `check-reread`, `check-completeness`, `check-spec`, `check-knowledge`, `check-ideas`, `check-preview`, `check-maps`, `check-session-transfer`, `check-hub-runtime`, `check-hub-service`, `check-usage`, `check-session-audit`, `check-delivery-trace`, `check-worker-cost` (all `.mjs`). Adapt reuse suites to their retained or retired surface. Add connection/Hub transport checks when touched. Exercise HTTP 403 without `x-grill: 1` and invalid Host protection. Run the documented simulator with `--no-open --delay 200` on disposable state, directly or through the isolated simulator check.

Use disposable `GRILL_HUB_HOME` and explicit map roots for runtime checks; never reset test-project/user maps blindly. Follow the mandatory fresh independent review/fix/check/commit cycle until clean. Record exact commands and limitations.

## Phase 4 — real comparison and decision

Use two independent identical copies per run: A = baseline fresh-worker workflow; B = single-session candidate. Both use the same model, effort, waiting mode, language, initial evidence and scripted user inputs. Do not switch the baseline's installed links mid-run. Keep reviews/implementation/audit requests outside measurement cutoffs.

Use two workloads:

1. Standard scenario: at least twelve answers plus discussion, correction, cross-branch contradiction, reread, knowledge, specification and finish.
2. Broad-evidence scenario modeled on Languages: full reread, knowledge update, root discussion, answer/ancestor assessment and specification over the same large map. Use an authorized disposable snapshot with all 73 cards when available; otherwise clearly label the substitute and do not claim an exact historical replay.

For each workload run at least three paired repetitions, alternating A/B order. Separate fresh-session/low-history and continued-session/warm-history cases. True provider cache state may not be controllable: record the observed cache counters and do not claim a forced cold cache. Long-session acceptance must include context growth/compaction or rollover guidance; never demonstrate only the first cheap answer.

Record actual primary and descendant responses, input/cached/uncached/output/reasoning, per-event latency, tool calls, applies/retries, reads/truncation, artifact coverage, compaction/transfer and telemetry completeness. Compare totals per successful useful scenario as well as per event; do not ignore a failed broad operation or downstream cleanup. Report ranges and medians, not one favorable run. Dollar costs require known applicable billing, and cannot be inferred from total input alone.

Human semantic review checks all fixture cards, decisions, corrections, conflicts, provenance, required clarifications, knowledge contents and spec coverage. Deterministic tests cannot replace this judgment. Record A/B output differences and unresolved review questions.

Acceptance decisions:

- Functional: no ordinary child sessions, no lost work/evidence, protocol checks pass, independent code review clean.
- Economic: repeatable lower total input and model-response count without systematically higher uncached/output consumption; latency and semantic quality must be acceptable. Mixed results must be reported by workload, not collapsed into a universal savings claim. Do not set a fabricated percentage target after observing results.
- If real host runs or human assessment cannot be completed, mark S11 pending with the exact reason. Finish the reviewable implementation branch and measurement harness, but do not claim proven savings or silently install it globally.
- If longer single-session history makes costs worse, retain the candidate for diagnosis and report that finding. Do not reintroduce workers, change models, drop evidence or force automatic transfers as an unmeasured workaround.

## Phase 5 — release and handoff

After implementation/checks, run `npm run release` once for the completed release unless already bumped. Commit package/version/UI stamps and tracked mirrors together. Verify versions and file parity in the branch; global installed links still point to the accepted checkout until explicitly updated.

Deliver a branch report with S1–S12 status/evidence, base and final commits, clean-review count, test results, measured A/B results or pending acceptance, and installation/rollback instructions. Do not merge/push/install by implication. When installation is requested, verify the actual installed files and any separately installed Hub runtime; a junction refresh is not a Hub package update.

Rollback uses the preserved baseline runtime and its own valid configuration after settling or safely requeuing work and stopping the old consumer. Keep map state, durable journal, knowledge and artifacts; do not copy an old state snapshot over accepted user work. Check old-reader compatibility before resuming. Preserve audit measurements even when reverting the workflow.

## Prompt for the implementation session

> Implement `docs/plans/ContextBudget/single-session-migration-plan.md` in a separate branch/worktree. Read AGENTS.md and the plan fully. The target is one host session preparing and applying every grilling event, without runtime child agents; keep hybrid/monitor waiting and existing correctness contracts. Preserve unrelated changes and user maps. Do not update global skill links, merge or push. Maintain S1–S12 evidence, run the required independent review cycle, and report real cost/quality acceptance separately from deterministic correctness. Do not claim measured savings without matched runs.
