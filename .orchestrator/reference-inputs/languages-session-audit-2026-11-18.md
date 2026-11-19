# Languages map: session token audit

This report covers the resumed `languages` grilling session, not implementation work. The main finding is that broad evidence processing dominated worker cost: knowledge extraction, full reread and specification generation accounted for most worker input. Parent orchestration was also substantial, even though event payloads were handed to workers through files.

## Scope and measurement

- Parent: `01a1ed7c-d509-7353-a9e7-f2d0f43f586e`, created at 2026-11-18 07:09 UTC.
- Exclusive cutoff: **2026-11-19T05:42:05.110Z**, the user's report request. The filename follows the user-provided session date, 18 November. Timestamp boundaries use the actual UTC rollout records.
- Map: `languages`, DbTranlslateText; 73 question cards were reviewed. Waiting mode: Codex hybrid.
- Five fresh prepare-only workers handled reread, knowledge, discussion, answer and specification. The parent applied their results.
- Counters come from local JSONL `token_usage_record.payload.usage`, deduplicated by response ID within each thread. Explicit metadata links identify children. Worker labels follow the observed spawn sequence.
- Coverage is the parent and all five workers visibly spawned in this session. Each has one readable rollout and per-response usage. File lookup covered the 17/18 November directories. A full-archive discovery run using `dev/session-audit.mjs` was stopped after taking several minutes; the attached metrics use a targeted read instead and explicitly mark archive discovery incomplete. These are totals for six observed threads, not a proof that no undiscovered descendant exists.
- The earlier session that transferred this map is excluded, as are this audit and its review. This is not the lifetime cost of the map. In particular, the earlier failed knowledge attempt is outside this baseline.
- Cached input is a subset of input; reasoning is a subset of output. Serialized characters are not tokens. No dollar estimate is justified without applicable model prices and billing rules.
- Aggregate evidence: [metrics](languages-session-audit-2026-11-18.metrics.json). No transcript bodies or user answers are reproduced there.

## Measured tokens

| Actor / event | Responses | Input | Cached input | Uncached input | Output |
|---|---:|---:|---:|---:|---:|
| Parent | 69 | 2,701,128 | 2,654,592 | 46,536 | 6,964 |
| Full reread | 21 | 1,332,340 | 1,219,200 | 113,140 | 6,088 |
| Knowledge | 26 | 2,089,940 | 1,966,976 | 122,964 | 4,146 |
| Root discussion | 8 | 231,184 | 184,832 | 46,352 | 967 |
| Answer and ancestor assessment | 7 | 207,224 | 177,408 | 29,816 | 1,871 |
| Specification | 19 | 1,054,513 | 986,624 | 67,889 | 7,666 |
| **Total** | **150** | **7,616,329** | **7,189,632** | **426,697** | **27,702** |

Input plus output: **7,644,031 tokens**. About **94.4%** of input was cached. Workers account for **89.1% of uncached input**; the parent accounts for **35.5% of total input**. These are repeated inference-input counts, not the size of one context window.

Knowledge is the largest individual worker cost. Together, knowledge, reread and specification consumed **4,476,793 input tokens** and **303,993 uncached input tokens**: about 58.8% and 71.2% of the respective whole-session totals. This session therefore has a different cost mix from the existing [group-search audit](session-audit-2026-11-18.md); its conclusions should not be copied without measurement.

## Work performed and evidence volume

| Event | Delivered JSON characters | Outcome |
|---|---:|---|
| Reread | 236,550 | Reviewed 73 cards; no additions, deletions, moves or merges reported by apply |
| Knowledge | 165,477 | Successfully updated seven knowledge documents |
| Root discussion | 21,956 | Reply saved |
| Answer | 14,178 | Assessed the path-format answer and its ancestor; no new questions |
| Specification | 156,177 | Saved `docs/vgril/specs/grill-languages.md` |
| **Total** | **594,338** | Five applied events |

The reread payload contained 208,193 characters of context and 21,295 characters of project chat. The knowledge payload contained 151,174 characters of nodes; the specification contained 149,181. This identifies a concrete concentration of evidence, but not how much of it is safely removable. Full reread was explicitly requested, and the specification needs the captured requirements.

The knowledge worker reused an earlier corrected draft only after checking current evidence and document versions. Its largest resulting document, including captured snapshots, was reported as 195,592 characters against a 200,000-character limit. The successful apply confirms this attempt completed; proximity to the limit remains a maintenance risk.

## Problems observed

### 1. Broad operations independently reconstruct overlapping evidence

Reread, knowledge and specification each read a substantial map snapshot in a fresh worker. File handoff correctly keeps those bodies out of the parent, but does not eliminate their processing by children. Independent workers also reload common instructions and selected knowledge documents.

The observed volume is justified in part: these operations have different contracts and snapshots. A no-change reread does not prove its review was useless. An optimization must preserve provenance, current answers, historical supersession and frozen-snapshot isolation.

### 2. Many model responses amplify even cached context

There were 150 recorded responses for five events, including 69 parent responses. Parent tool calls included 43 `exec`, five spawns, 15 worker waits and one worker message. The 15 responses whose only tool call was `wait_agent` consumed **608,177 input tokens**, including **604,800 cached**, and 683 output tokens. That is about 8.0% of session input, but only 3,377 uncached tokens.

These waits usually used 60 seconds; the initial short request was clamped to ten seconds. This is not the same ten-second polling problem seen in the other audit. Removing all wait cost is neither realistic nor a safe savings claim. Parent status updates, shell continuations and several separate lifecycle commands still cause additional model turns with a growing history.

### 3. Startup read duplication and truncation

The parent loaded both the installed and handoff-referenced `SKILL.md` in one large command, together with transfer instructions. The tool reported truncated output. Much of the workflow text was duplicated. The later worker and waiting-mode reads recovered relevant instructions, but this initial read wasted context and made instruction coverage harder to establish.

This is an execution issue: resolve whether the two paths identify the same skill before loading both, and read bounded, relevant sections. Never interpret truncation as successful full evidence review.

### 4. Historical context and near-limit knowledge documents

Repeated full node histories and provenance snapshots can grow faster than current requirements. The previous knowledge failure was caused by a document limit; this session recovered it, but its largest document was already close to that limit. This makes retries and future edits expensive and fragile.

Separate current requirements from immutable historical evidence at the storage/protocol level, with exact versioned retrieval. Merely summarizing away contradictory or superseded evidence would damage correctness.

### 5. Coordination and stale derived text

A delayed monitor notification for the already handled reread returned 409 and was correctly discarded. It incurred a small extra parent turn, not another worker. Delivery deduplication before model wake-up would avoid this overhead where transport permits it.

The latest path-format answer closed the open question, but the specification worker still had to resolve an outdated brief against current cards. Agent notes were updated after the answer; the parent did not refresh them after the specification, leaving a statement that the specification had not yet incorporated that choice. Such derived summaries need explicit revision stamps or disciplined updates; otherwise future workers spend tokens resolving avoidable inconsistencies.

## Recommended reductions, in priority order

| Priority | Change | Expected benefit | Correctness constraint |
|---|---|---|---|
| P0 | Keep per-response usage, explicit child links, event IDs and evidence-version receipts | Makes future comparisons attributable | Unknown or missing telemetry must remain unknown |
| P1 | Resolve skill aliases; read instructions once in bounded sections; avoid duplicate large command output | Reduces startup input and truncation | All applicable instructions still need to be read |
| P1 | Batch dependent deterministic CLI steps in one shell/tool invocation only after checking each exit/result; let a 15-second wait complete within one shell call where supported | Fewer parent inference turns | Never overlap monitor and wait; branch correctly on stale, failed or finish results |
| P1 | Keep 45–60-second interruptible worker waits; prefer verified completion wake-ups | Reduces orchestration overhead | Maintain the host's communication interval and a verified wake-up path |
| P1 | Refresh brief/notes revision metadata after accepted changes and generated artifacts | Less reconciliation and stale guidance | Summaries remain navigation, not primary evidence |
| P2 | Supply changed-card and changed-document sets with stable evidence hashes for knowledge extraction | Avoid repeated analysis/writes of unchanged material | Track dependencies and superseded facts; preserve exact source snapshots |
| P2 | Separate concise current knowledge from versioned provenance storage; validate final expanded size locally | Prevent limit failures and reduce repeated reads | Preserve auditability and complete evidence retrieval; do not silently truncate |
| P2 | Reuse a verified reread receipt for an unchanged captured revision when scheduling downstream work | Avoid duplicate verification where demonstrably redundant | Explicit full reread, changed answers and uncovered dependencies still require review |
| P3 | Trial bounded worker reuse through supported parent follow-up | Amortizes common instructions and evidence reads | Invalidate on scope, revision, policy, language or lifecycle changes; rotate at a measured budget |

The repository already documents P1/narrow-P2 improvements and a default-disabled P3 prototype in the [implementation record](session-audit-2026-11-18-implementation.md). These suggestions are acceptance targets and remaining opportunities, not a claim that those features are absent. Current checkout code is not proof of which revision ran each historical event. Do not bypass the host's restriction on direct child input to implement reuse.

Do not prioritize shorter final chat replies: the entire session produced only 27,702 output tokens, much of which is useful specifications and assessments. Input repetition is the larger measured issue. Likewise, lowering model capability is an experiment requiring quality checks, not an evidenced saving from this session.

## Validation plan

Replay equivalent captured inputs in disposable maps, separately measuring a local answer, root discussion, full reread, knowledge update and specification. Compare fresh-worker and bounded-reuse modes with the same model, reasoning settings, instructions and cache conditions as far as controllable. Repeat runs rather than attributing a single cache fluctuation to an optimization.

Record input, cached and uncached input, output, responses, tool round trips, latency, payload characters, failed applies, truncation, worker reuse/rotation and telemetry completeness. Check all 73 cards for retained answers and supersession, unchanged frozen reads, required ancestor assessments, knowledge provenance, and specification coverage. Report semantic regressions alongside token changes.

No percentage savings is promised here. The measured cost buckets identify where to test; they do not establish that the whole bucket can be removed. This report changes documentation only; it does not change the skill runtime, map state or implementation code.
