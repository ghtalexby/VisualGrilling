# Worker context and session-tree cost

Status: implemented; deterministic validation and independent review in progress. See TASK.md.

## Objective

Reduce repeated context without weakening evidence, queue ownership or stale-result validation. Implement these three changes only; do not shorten evidence histories, change grading models or combine waiting operations.

## 1. Compact knowledge navigation

Keep the full knowledge index and UI inventory unchanged. Generate `knowledge-agent-index.json` beside it with document paths, headings, stable versions, optional managed-record identity/status and parse errors. Preserve warnings, ignored paths and revisions. Do not expose link/source inventories or duplicate descriptions in this projection. Preserve all document paths rather than silently hiding installed copies that may differ.

Events point workers to the compact index and provide the full index path for explicit provenance/import investigations. Launch uses `knowledge --compact`. Selected documents and primary evidence are still read in full. Changes to exclusions and warnings must reach both indexes, including pending-write recovery warnings.

## 2. File handoff for delegated work

Codex hybrid/monitor use `wait --inbox` and `monitor --event ID --inbox` even for small events. Existing nondelegated CLI defaults and HTTP consumers remain compatible. Timeout output stays inline and must not overwrite the last event. A file header carries identity and paths, never the answer/chat body. The parent passes this header to one fresh prepare-only worker without reading the full event.

The worker writes the ordinary apply JSON to a token-specific result file and returns its path and identity only (small proposed notes may be separate). The parent runs `apply --file PATH --token EXPECTED`; the CLI checks the expected token and inbox type/id/token before sending, and the server retains authoritative stale and owner validation. Reject malformed, oversized and mismatched files before mutation. Multipart discussion uses one file per part and preserves final-commit/rearm rules. No worker may apply, consume events or rearm.

## 3. Session-tree usage

Discover Codex child threads through explicit `session_meta` parent IDs, recursively, not by cwd, title or time proximity. Read only metadata and usage records; never return transcript text or paths. Deduplicate response records within each exact thread and aggregate each descendant once. Preserve existing parent-only output when no descendants exist; when descendants exist expose parent/worker breakdown, available/missing counts and combined counters. Incomplete descendants must be visibly marked; unavailable parent data remains unavailable. `last_input_tokens` stays the parent's latest request for rollover hints.

Cache discovery, metadata and incremental usage readers. The supported Codex storage layout dates children on or after their parent creation day; scanning starts at that day. Moved/backdated rollout files require separate adapter support. Background discovery must not block the map. Support restart, rebind, duplicate usage records, partial writes, missing usage and unrelated sessions. Existing per-event deltas remain observational, not exact billing or model-call counts. Counts include unrelated work within the same session tree; reasoning and cached input remain subsets.

## Acceptance

- Compact index preserves exclusions, warnings, errors, revisions and selectable paths; full inventory unchanged. Compare serialized sizes on a deterministic fixture.
- Small/large delegated events use files; timeouts do not overwrite inbox. File apply succeeds, stale/mismatched/oversized/malformed results do not mutate state. Preserve stdin and inline compatibility.
- Usage fixtures cover child/grandchild aggregation, duplicate records, unrelated threads, late append, incomplete child telemetry, restart and rebinding. UI clearly labels partial tree totals.
- Run worker/context/knowledge/usage/watch/monitor/map/locale checks, durable-action simulator (including restart and protected API checks), and fresh independent review until clean.
- Bump release once, synchronize tracked skill mirror, verify installed Codex package.

Real-host end-to-end grading quality and comparable session-cost reduction require a separate real interaction; deterministic fixtures establish contracts, not a claimed percentage of total token savings.
