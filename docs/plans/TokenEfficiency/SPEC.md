# Overall specification: token efficiency

## Desired outcome

Reduce total model work for a useful grilling interaction while preserving answer quality, full evidence, durable inputs, provenance, snapshot isolation and sequential application. Optimize user-visible latency and uncached/output consumption alongside repeated cached input; total input alone is not a price estimate.

## Measurement protocol

Compare the same project snapshot, initial map, language, model/effort, host version, waiting mode and scripted sequence of at least 12 answers plus discussions, reread, knowledge, spec and finish. Record parent and descendant input, cached input, uncached input, output and reasoning separately. Reasoning is part of output; cached input is part of input. Record model calls, CLI requests, events by type, corrections/retries, elapsed time, duplicate/truncated reads and missing telemetry. CLI requests are not model calls. Mark cold/warm cache and session history differences. Preserve raw aggregate evidence without copying private transcripts into the repository.

Use disposable state. Do not replay actions into user maps. Human semantic checks must confirm correct grades, no repeated or missing necessary questions, preserved decisions and conflicts, valid sources and comparable specification quality. Simulator transport checks cannot establish these qualities.

## Stages

1. Authorized: compact knowledge navigation, file handoff, complete observable session-tree usage. See phase-1.md.
2. Measure matched real sessions; identify the largest remaining cost by event and actor. Revise hypotheses if data disagrees.
3. Candidates: combine routine service commands; skip unchanged notes; deduplicate exact event fields; slim worker instructions with event-specific references. Specify and select each change before implementation.
4. Higher-risk candidates: incremental knowledge extraction, history-on-demand, reusable workers or adaptive model selection. Require explicit evidence/quality and invalidation contracts, user selection and separate acceptance. No arbitrary context truncation.
5. Re-run the matched scenario after each selected change; retain before/after data and a decision to keep, revise or revert it.

## Invariants

Localhost/Host/header protections remain. Every result is validated against the current delivery; frozen reads use their token. Main-session apply/rearm ownership remains. Never substitute a model summary for authoritative evidence or suppress unresolved work. Knowledge ignore policies and warnings remain visible. Unknown usage is unknown, not zero. Existing stdin/HTTP consumers remain compatible.

## Delivery artifacts

TASK.md tracks resumable requirements and verification; RESEARCH.md records observations and uncertainty; numbered phase specifications define implementation contracts. Record commit IDs and test commands in TASK.md. Real-session measurements go in a dated measurements document with environment and limitations. Preserve earlier ContextBudget measurements as historical baselines.
