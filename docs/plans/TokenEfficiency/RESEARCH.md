# Research snapshot — 2026-11-16

## Observed current design

The local server does not call a model API. Codex hybrid/monitor delegate each event to a fresh prepare-only worker; the main session applies and controls waiting. Browser polling itself consumes no model tokens. Worker rules require knowledge-index selection and full relevant evidence. Existing optimizations include focused branches, inline title navigation, incremental reread, inline ancestor grading, sparse reassessment, large-event inbox output, answerFromChat and rollover hints.

## Read-only measurements

- Saved .grill/knowledge-index.json: 102479 characters, 75 documents; 16 entries under .claude/skills/grill and 16 under skills. These are overlapping package sets, not proven identical copies.
- A path+headings projection is 10887 characters; this is illustrative and omits required policy/version fields. Do not claim 89% end-to-end savings.
- Current focused answer projection on saved maps: median per map roughly 1100–8000 characters. This excludes worker instructions and retrieved documents.
- Worker + answer + coverage + shell instructions: about 14165 characters, before event/session/source evidence.
- action-queue saved aggregates: 84 deliveries; input 33689535, cached 33334016, uncached 355519, output 76402. These are historical observations, not a controlled current-version benchmark. The old adapter observes only the bound thread and per-event intervals may include other work or delayed telemetry.

## Confirmed mechanisms

1. worker.md requires index reading for each fresh worker. knowledgeContext only transmits a pointer; actual file reading introduces the large context.
2. CLI events <=20000 characters are inline by default and may reach both parent and worker. Large events already use inbox. Monitor already allows result files, but does not require them.
3. usage.mjs filters exact bound thread_id and does not aggregate children. contextStats counts event JSON, not all tool/source reads or model calls.
4. Event fields repeat some answers/messages already in context cards. Full discussion history can dominate large branches.
5. Hybrid service operations can require extra model turns; commands executed together need not each create a model call. A controlled comparison is required.

## Prior work and uncertainty

Read ../ContextBudget/session-cost.md and context-budget.md. Their optimizations are implemented, but real comparable after-measurements remain pending. Cached input is not equivalent to newly processed input or monetary cost. Current host billing/cache behavior and final savings are not inferred from character counts. Fresh workers reduce inherited history but add instruction/source reads; measure both sides.

## Priority

Implement phase 1, measure all actors, then select remaining changes using the overall SPEC.md protocol. Preserve evidence quality over an arbitrary token ceiling.

## Implemented phase 1 observations

The implemented compact projection of the saved 75-document index is 17652 serialized characters versus 78708 for the full minified index: 78% smaller. It includes required versions/policy fields, so it is larger than the earlier path+headings illustration. Neither result measures whole-session savings.

Session-tree adapter smoke check after implementation observed three workers with complete telemetry (260 ms initial, 2 ms cached read). Full historical archive scanning caused unacceptable latency; the supported adapter scans the standard parent creation date and later, bounds metadata-line reads, and runs discovery in the background. Explicitly moved/backdated files are outside that storage contract. A regression fixture ensures long instructions and arbitrary JSON field order cannot hide the parent ID. See TASK.md for commits/checks and the next real-session experiment.
