# Grilling session cost audit — 18 November 2026

Status: investigation and proposed implementation plan; no runtime or workflow changes made.

## Main finding

The previous context optimizations are present, but the remaining cost is dominated by orchestration and repeated worker preparation. Nine user-facing events produced eighteen worker sessions. The parent made 120 worker-wait calls, including 88 timeouts. Each fresh worker read its instructions and event evidence again. Reducing the length of final replies alone will not solve this.

There are two different optimization targets:

1. Reduce repeated cached input by eliminating unnecessary parent model turns.
2. Reduce uncached input and substantive processing by reusing relevant worker context and avoiding redundant downstream reviews.

The user's proposed direction—fewer subagent launches and less repeated context collection—is supported by this session. It should be tested with bounded worker reuse and combined assessment, rather than an indefinitely growing worker conversation.

## Scope and method

- Session: `01a1ee47-ce92-75f1-8af4-a47bd37f5ba7`; map: `group-search` in DbTranlslateText.
- Baseline starts at session creation and ends **before 2026-11-18 11:44:01.417 UTC**, the audit request. This investigation and its review are excluded.
- Source: local Codex JSONL rollouts, explicitly linked child-session metadata, the map's persisted `contextStats`, saved result files and current runtime source.
- Sum `token_usage_record.payload.usage` once per `(thread_id, response_id)`. Discover descendants by explicit parent IDs, not by working-directory or time similarity. All eighteen observed workers have usage records. The scan covered the session's creation day; all observed workers belong to that day.
- Model recorded in the parent and workers: `gpt-6-astra`. Parent turn metadata records medium effort. Waiting mode: hybrid.
- Installed skill is a junction to this repository's `skills/grill`; both report version **1.0.24**. This is not a stale installed copy of the earlier plans.
- Aggregate evidence: [session-audit-2026-11-18.metrics.json](session-audit-2026-11-18.metrics.json). It contains counters and result shapes, not private transcript bodies.
- Source checkout had an unrelated modified `README.md`; it was preserved. The old map monitor was stopped for the explicitly authorized project switch; map state and queued inputs were preserved.

This is a real-session diagnostic baseline, **not** a matched before/after experiment or a billing estimate. Cached input is part of input; reasoning is part of output. Do not add these subsets twice. Tokens and serialized characters are different units.

## Measured cost

| Actor | Sessions | Recorded responses | Input | Cached input | Uncached input | Output |
|---|---:|---:|---:|---:|---:|---:|
| Parent | 1 | 215 | 12,214,781 | 12,064,256 | 150,525 | 17,654 |
| Workers | 18 | 158 | 4,996,099 | 4,385,152 | 610,947 | 36,737 |
| Total | 19 | 373 | **17,210,880** | **16,449,408** | **761,472** | **54,391** |

Total input plus output: **17,265,271**. Reasoning output: 3,211, already included in output. Approximately 95.6% of input was cached. The parent accounts for 71.0% of input, while workers account for 80.2% of uncached input.

The parent input per response ranged from 13,859 to 73,122 tokens, averaging 56,813. The 120,000-token rollover threshold therefore would not address this particular failure mode. Many moderately large calls are expensive even without reaching the rollover threshold.

### Events and worker work

| Type | Events / workers | Payload characters, summed | Worker responses | Worker input | Worker uncached input |
|---|---:|---:|---:|---:|---:|
| Discussion | 8 | 159,584 | 74 | 2,305,088 | 239,680 |
| Answer | 1 | 17,213 | 6 | 148,775 | 20,647 |
| Ancestor reassessment | 4 | 80,690 | 29 | 773,033 | 122,409 |
| Reread | 4 | 146,743 | 36 | 1,214,539 | 174,283 |
| Knowledge | 1 | 38,230 | 13 | 554,664 | 53,928 |
| Total | **18** | **442,460** | **158** | **4,996,099** | **610,947** |

Worker-to-event attribution uses the chronological one-worker-per-event sequence; it is not a server-provided causal cost ID. The aggregate parent/worker split comes directly from rollouts. The map has only eight question cards plus root at observation time: this is not primarily a large-map problem.

The nine internal events account for 350,620 worker uncached tokens, about 57.4% of worker uncached input. This is an optimization opportunity, **not a claim that all internal checks can be deleted**.

## Where the tokens go

### 1. Parent polling is the largest avoidable input multiplier

The recorded parent responses whose sole tool call was `wait_agent` consumed **6,964,565 input tokens**, including 6,882,176 cached tokens: 40.5% of total session input. There were 120 such responses and 88 timeout results. The short waits were repeatedly set to ten seconds.

This was an execution mistake in this session, not an intrinsic requirement of file handoff. The host instructions already favor longer waits. Waiting in a tool is cheap; returning to the model to ask it to wait again repeats the prompt. Some waits returned useful status or completion messages, so the full measured amount is not an achievable savings guarantee.

Use a single interruptible wait up to the host's allowed communication interval (for this environment, normally 45–60 seconds), then send a meaningful update only when needed. Prefer a verified completion notification where supported. Do not create a competing map consumer or end the parent turn without a verified wake-up path.

### 2. Fresh workers repeat preparation for every derived event

`hybrid.md` explicitly requires one fresh prepare-only worker per event. File handoff prevents full event/result duplication in the parent, but does not preserve context between workers. Eighteen workers produced 158 model responses, averaging 8.8 responses each.

Every worker's first response already had about **14.3K input tokens**, before the worker's explicit file-reading tools. This measures the fresh-session envelope, not the size of `worker.md` alone. Additional calls read worker/handoff rules, event rules, coverage, session context, knowledge navigation and evidence.

Observed command mentions include `worker.md`, `handoff.md` and `session.md` for all eighteen workers; seventeen mention the compact knowledge index. These are command-mention counts, not exact file-read byte totals. Repeated loading is therefore confirmed, but cache behavior means it should not be described as eighteen wholly uncached prompts.

The worker result receipts are already small. Shortening those receipts further has little leverage. Reduce launches, unnecessary reads and full histories instead.

### 3. Discussion can trigger a cascade of assessments

The event sequence contains `discuss → reevaluate → reread` chains. These are distinct semantic jobs with separate fresh workers.

Relevant current paths:

- `skills/grill/discussion.mjs`: replacing an existing answer with different user text records an edited target; inline ancestor acknowledgements are supported.
- `skills/grill/grill.mjs`, discussion apply: `result.edited.length` requests an automatic reread. A legacy `assessment` unconditionally calls `queueReview`; touched answer targets without inline assessment also queue it.
- `skills/grill/grill.mjs`, `inlineAncestors`: missing `ancestors` means legacy separate reassessment; an explicit empty array means checked and unchanged.

Most saved discussion answer entries already include `ancestors:[]`. One discussion result (`f95c60c2…`) omitted it for both target answers. The final explanation-only discussion (`9f4719b7…`) included a legacy assessment, and a reassessment followed. A request to explain a grade need not rewrite it if no evidence or judgment changed.

Do not claim every reassessment was caused by an omitted field: the earlier ones occurred despite inline fields in saved discussion results. Exact causal explanations require dependency/reason instrumentation for structural changes and queued tasks. Likewise, automatic rereads may be necessary when an answer changes a premise elsewhere; removing them blindly would lose correctness.

### 4. Focused context still includes growing histories

Historical discussion payloads grew from 1,973 to 36,282 characters; rereads grew from 23,549 to 50,699. The most recent discussion was 33,025 characters. A 15-character user message could therefore trigger tens of thousands of characters of context.

`context.mjs` makes focus include the target, its ancestors and descendants. Semantic neighbours add full cards within a separate budget. `deliveryNode` removes some duplicates, but retains chat, answer history, supplements and other evidence. A related-card budget does not bound the focus itself.

For illustration, reconstructing the current focus for `nx11itg7` after the session yields 34,410 characters across three delivered cards. Field contributions include chat 16,401; answer history 6,793; supplement history 1,976; gap coverage 1,890. This is a **post-session reconstruction**, not a historical payload measurement. It shows where to investigate, not a measured savings percentage.

`evidenceNode` removes semantic navigation fields but retains verdict/history and assistant chat. Reread change detection hashes this evidence projection. Consequently, review-generated changes can expand later rereads even when the new user evidence is small. Separate user-evidence changes, structural changes and review bookkeeping before deciding which work is necessary.

### 5. Truncation and validation repair add more turns

The pre-audit rollouts contain **23 tool outputs with a truncation marker**: three parent outputs and twenty worker outputs. Not all are event dumps; some combine instructions and source reads. Chunking was instructed, but output budgets were still exceeded. This is an observable failure of the read procedure, not proof of lost stored evidence.

One discussion apply failed because `coverage.sources` was missing. A corrective worker turn and retry followed. A local schema preflight could catch structural errors before parent apply. It must not replace server validation or fabricate semantic coverage.

## Why previous iterations did not finish the job

| Existing work | What it achieved | Remaining boundary |
|---|---|---|
| [context-budget.md](context-budget.md) | Focused payloads, semantic navigation, incremental reread, smaller instructions | Large histories inside focus still grow; synthetic payload budgets do not bound whole-session calls |
| [session-cost.md](session-cost.md) | Inline ancestors, sparse reassessment, file output, `apply --rearm`, usage records | Hybrid intentionally uses plain apply, stop, wait, then arm; pure-monitor atomic rearm is not this session's path |
| [TokenEfficiency phase 1](../TokenEfficiency/phase-1.md) | Compact knowledge index, parent/worker file receipts, child usage accounting | Fresh workers still rebuild context; totals now expose worker costs that older counters omitted |
| [TokenEfficiency task](../TokenEfficiency/TASK.md) | Explicitly leaves matched cost/quality acceptance open | Passing deterministic checks is not proof of lower end-to-end token consumption |

The implementation is not simply missing all the earlier optimizations. The optimization target has to move from payload size alone to **model turns per useful decision and repeated evidence acquisition**. Accounting changes also make historical counters non-comparable without reconstructing both session trees.

## Proposed plan

These stages are proposals. This report does not authorize implementing them or changing grading models.

### P0 — Make the next measurement actionable

1. Add stable parent-action, delivery, worker and response correlation IDs, with internal-task reason codes and evidence revisions. Record whether a review changed a substantive conclusion or only rewrote a verdict.
2. Separate parent/worker input, cache, output and model responses. Keep CLI requests separate: this session recorded 79 CLI requests but 373 model responses. CLI metrics miss worker shell reads and parent collaboration waits.
3. Preserve missing/incomplete telemetry explicitly. One `contextStats.recent` entry lacks a closing usage delta; per-type deltas are observational and must not replace rollout totals.
4. Freeze this baseline. Replay a representative script into disposable state, never into the user's map; collect both cold and warm runs with equal initial history and model settings.

Acceptance: every worker can be traced to its initiating user action and dependency reason; repeated response IDs are deduplicated; the audit itself is excluded from the baseline.

### P1 — Remove service-only model turns and accidental rereads

1. Replace ten-second parent polling with longer interruptible waits or verified completion notifications. Keep the required progress communication interval.
2. Wait for short shell commands long enough to finish: a 15-second map wait can normally use a 20–30-second shell yield instead of an early return followed by several `write_stdin` model turns.
3. Define a safe combined apply/next operation if measurement justifies it: apply, complete subscription, reserve one next event or arm after idle timeout. Preserve atomic ownership, finish boundaries, 400 correction and stale 409 behavior. Do not concatenate shell commands that advance after a failed apply.
4. Treat explanation-only chat as reply-only unless new evidence changes a grade. Require explicit ancestor-review intent in result templates; validate omissions rather than silently treating every omission as a request for expensive work.
5. Supply a compact result template and local preflight, including coverage fields. Read one bounded section at a time and batch independent small reads within a bounded output budget.

Acceptance: no ten-second timeout polling loop; no truncated output; no missing-coverage retry; all existing queue/monitor correctness checks pass. A provisional target is at least 50% fewer parent responses in the matched scenario, to be accepted only after measurement.

### P2 — Combine assessments for one user action

Process the changed answer, affected ancestors and explicit cross-card conclusions in one worker transaction when all required evidence is available. Avoid an immediate second worker rereading the same branch merely to confirm the same conclusion. Return assessed revision receipts, not unsupported declarations that everything was checked.

Track unresolved dependencies explicitly. Defer a separate reread only when its evidence scope was covered; otherwise keep the job. Coalesce automatic dirty-scope checks before the next stable boundary, while preserving user action order and mandatory draining before specification/finish. Manual whole-map reread remains explicit and complete.

Separate content/evidence revision from review bookkeeping so unchanged verdict refreshes do not masquerade as new user evidence. Tests must still propagate real contradictions, changed answers, deletions and cross-branch premise changes.

Acceptance: at least 30% fewer worker launches is an experiment target, not a promised saving. No decision or required clarification may disappear. Explain every remaining internal event by its changed evidence and uncovered scope.

### P3 — Bounded reuse of a discussion worker

This directly addresses the user's follow-up: keep a worker for several sequential events in one discussion or branch, instead of starting a fresh one for each message and derivative assessment.

- Parent remains the sole result applier and map consumer; only one worker prepares the current event.
- Pass the new message, exact delivery token, map revision, policy/index revisions and changed-card manifest. Every changed required card is authoritative evidence, not just a summary.
- The worker acknowledges the revision it has read. Missing, stale or invalidated evidence triggers retrieval or a fresh worker. Cross-branch changes, language changes, ignored-path changes, cancellation and frozen spec contexts need explicit handling.
- Keep provenance and full history retrievable. A summary may route retrieval but cannot replace a user's answer as evidence.
- Rotate on measured request size, read amplification or repeated retrieval, not only after an arbitrary count. Start with an experiment of up to 3–5 related events, then compare against fresh workers.
- Do not reuse the worker for unrelated maps. Do not change model/effort in this experiment; isolate the reuse effect.

Acceptance: lower uncached input per useful user interaction and acceptable latency, with equivalent conclusions, provenance and clarification coverage. Test a user correction, a cross-branch contradiction, restart, stale delivery, knowledge exclusion update and specification snapshot isolation. Reject reuse if the growing worker history costs more than reconstruction.

### P4 — Evidence retrieval instead of repeated historical material

Introduce a projection that delivers current answer/provenance, unresolved gaps and new messages, with versioned on-demand access to older chat and answer/supplement history. Use exact evidence references to avoid repeating the same message across several cards. Keep the full canonical history in state/export and declare omitted ranges explicitly.

For knowledge documents, offer body/current-decision reads without automatically printing embedded historical snapshots; retain full provenance reads when needed. Measure instruction bundles beyond `worker.md + answer.md`: coverage, handoff, shell rules, repository instructions and actual knowledge reads also contribute.

This is higher risk than fewer waits. First demonstrate that event-scoped retrieval preserves retractions, conflicts and source attribution. Do not silently truncate or turn semantic summaries into accepted facts.

## Owner proposal: persistent card workers with direct board publication

Added after the initial audit: the owner proposes one reusable worker per card, handling both selected answers and discussion messages, and publishing its result directly to the board. Other workers read the board when they need its conclusions; the primary conversation neither waits for nor relays ordinary results.

This is a stronger architectural alternative to P3. P3 retains parent-owned apply and saves worker preparation; this proposal also removes the parent model from the routine execution path. It is the preferred architecture to **prototype**, subject to host feasibility and the validation boundaries below. It is not implemented or proven cheaper yet.

### Proposed ownership

| Component | Responsibility |
|---|---|
| Deterministic board controller | Admit user actions, select/reuse a card worker, deliver work, maintain leases and validate/commit results |
| Card worker session | Handle both answer and discussion events for its card; fetch dependencies; submit a token-bound result directly to the board |
| Board state and evidence store | Canonical decisions, exact user evidence, provenance, revisioned dependencies and outstanding work |
| General worker | Explicit whole-map review, unresolved cross-card reconciliation, knowledge, specification and finish when required |
| Primary conversation | Start/configure the workflow, handle user requests and exceptional failures; no routine result forwarding or polling |

A worker need not be continuously running. Preserve its session identity and reuse it when a new card action arrives. Idle worker state is different from model inference. Current workers were not explicitly killed in this session; the workflow simply created a fresh session for each subsequent event.

### Delivery and publication sequence

1. First action for a card: the controller creates a worker and gives it the card, current authoritative evidence, policies and a compact map/dependency index.
2. Later action: resume that worker with the exact new user action, delivery identity, current card revision and an explicit manifest of changed dependencies and policies. Do not assume its remembered state is current.
3. The worker retrieves changed evidence as needed and sends its result directly to the board's protected apply endpoint or CLI, using a scoped delivery capability.
4. The server validates ownership, action identity, evidence revisions, coverage and source references; commits atomically; records an idempotent receipt; then releases dependent work.
5. Other workers discover committed decisions through the map index and dependency invalidations. They fetch authoritative evidence when assessing a related question. A verdict or summary is not automatically a user decision.

The user should not need to answer once through a general worker and then repeat the same answer to a card worker. Route both answer clicks and chat to the card's worker from the outset. The general worker is for genuinely broader tasks, not a mandatory intermediary on every action.

### Required safeguards and open host question

- **Verify host routing first.** The current skill binds monitor notifications to the primary session. This audit has not established that the host can directly resume a specific existing child session from the board controller. Prototype create/resume/complete/restart routing before promising a parent-free loop. If unsupported, retain a small dispatcher temporarily; do not conceal its model cost or start a separate nested model process.
- **Change ownership explicitly.** Current `hybrid.md`, `monitor.md` and `worker.md` forbid worker apply. A new mode needs synchronized protocol and workflow changes, not an instruction to bypass those checks. Workers must not independently run the map-wide `wait`/`monitor` consumer.
- **Serialize commits first.** Start with one active card action per map and persistent idle worker identities. This preserves current ordering while testing reuse. Parallel preparation is a later experiment; no two workers may race for the same action or write incompatible conclusions.
- **Validate read dependencies.** Current discussion validation uses a whole-map revision. A later per-card lease alone is insufficient: changing a depended-on card can invalidate a result. Keep the existing conservative checks initially, then specify a read-set revision protocol if parallelism is introduced.
- **Keep cross-card writes transactional.** A message can answer several cards. Publish its authoritative provenance once, invalidate affected workers, and reassess uncovered dependencies without another general worker rereading everything automatically. Workers must not overwrite newer answers from their cached state.
- **Recover without double publication.** Persist the card-to-session registry, capability ownership, last acknowledged evidence revision and pending delivery identity. Recover worker loss, host restart and an apply whose acknowledgement was lost through the existing journal/idempotency model.
- **Bound retained context.** Reusing a session still resends accumulated context to the model; it does not make it free. Rotate after measured input growth or poor cache/retrieval efficiency. Rebuild from canonical evidence, with retrievable histories, not an unverified worker summary.
- **Preserve specification and finish boundaries.** General jobs consume a consistent snapshot only after required dependencies drain. Card workers cannot apply late results into a frozen snapshot or reopen a finished queue.

### First prototype and decision gate

Use two linked cards and one general worker in disposable state. Replay several answer/chat actions on the first card, a contradictory change on the second, a user correction, a worker restart and a lost apply acknowledgement. Confirm the correct existing worker resumes, ordinary results appear without primary-model turns, dependency changes are noticed, and each action is committed exactly once.

Measure separately: parent responses, card-worker responses, general-worker launches, uncached input, cached input, output, latency and repeated source reads. Compare against fresh-worker P1/P2 and bounded-reuse P3 under the same scripted inputs. Proceed only if semantic quality is preserved and total work falls. Do not substitute one general agent that wakes for every card action for the current parent; that would move the overhead rather than remove it.

## Experiment and decision gates

Use the existing [measurement protocol](../TokenEfficiency/SPEC.md), plus this discussion-heavy case. The standard scenario should include at least twelve answers, discussions, correction, cross-branch effects, reread, knowledge, specification and finish. This session alone does not cover spec/finish or establish comparative acceptance.

Run the same scripted interactions against disposable copies with equal model, effort, host, initial state and waiting mode:

1. Current fresh-worker baseline.
2. P1 orchestration changes only.
3. P1 plus P2 combined assessment.
4. P1/P2 plus bounded worker reuse.

Record repeated runs and report ranges, not a single favorable cache result. Measure input/cache/uncached/output, worker launches, model responses, latency, retries, tool-output truncation, repeated reads and semantic quality. Do not add estimated savings across overlapping interventions.

Keep token, delivery, owner and frozen-read checks intact. For future code changes run the required independent review cycle and relevant context/worker/monitor/action/knowledge/usage tests, then release and verify the installed version. For this report, only aggregate, link and content checks are required.

## Recommended next implementation scope

Start with **P1 and a narrowly specified P2** for immediate gains. In parallel with design work, verify the host-routing prerequisite for the owner's **persistent card-worker/direct-publication prototype**. If it is supported, test that architecture as the target; otherwise test **P3** as an intermediate mode. Do not spend the next iteration merely shortening verdicts or shrinking an already compact index. The largest observed avoidable multiplier is parent polling; the strongest structural opportunity is fewer workers rebuilding the same evidence.

No percentage of monetary savings is claimed. Actual cost depends on model/cache billing, and total input reduction may not track uncached/output reduction.
