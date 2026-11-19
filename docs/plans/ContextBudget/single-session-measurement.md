# Single-session comparison preparation and pending acceptance

S11 is **pending**. No matched real Codex/Claude sessions were run, and no human reviewed the A/B semantic outputs. This implementation session is not a grilling benchmark. Nested paid inference and active user grilling sessions were not used. No token, latency, quality or dollar savings are claimed.

The implementation base is `c48bc94911c2007445e6ee5fd2ed2243b89fa7f4`. The exact baseline runtime is `D:/programming/my/Programming/VisualGrilling/skills/grill`; installed junctions remain there. The candidate is `D:/programming/my/Programming/VisualGrilling-single-session/skills/grill`. The [baseline manifest](single-session-baseline.manifest.json) captures all 44 original runtime files, version 1.0.29, defaults and reference hashes; runtime Git status was clean at capture. Candidate and real host settings remain null in that baseline-only record until an experiment is prepared. Baseline defaults must have `workerReuse.enabled:false`; the harness refuses another baseline. Runtime content hashes, not a supplied commit label alone, identify dirty or otherwise differing files. Freeze both checkouts for the duration of an experiment. Never run consumers of different versions on the same map.

The historical audits were read from the original checkout, where they are untracked/ignored inputs. They are not comparative controls. Exact reference copies are maintained separately in `.orchestrator/reference-inputs/` by the implementation orchestrator; the original audits/metrics are unchanged. The measurement protocol is `TokenEfficiency/SPEC.md`, supplied as the same kind of reference input. The branch-local implementation ledger records reference hashes and broader S1–S12 evidence.

## Prepare independent disposable runs

The offline [preparation harness](../../../dev/single-session-comparison.mjs) creates a new temporary experiment directory. It never launches a model, changes installed links or submits API actions. Its [fixture source](../../../dev/fixtures/single-session.mjs) defines authored project evidence, exact initial map state and sequential user inputs. There are 24 run directories: two workloads, two history conditions, three pairs each, with A/B, B/A, A/B order. Every directory has its own project, map, knowledge files and Hub home. The frozen fixture directory must not be used as a live project.

Create an options JSON outside the repository, replacing the candidate commit and host/model settings with the actual intended values:

```json
{
  "baseline": "D:/programming/my/Programming/VisualGrilling/skills/grill",
  "candidate": "D:/programming/my/Programming/VisualGrilling-single-session/skills/grill",
  "baseCommit": "c48bc94911c2007445e6ee5fd2ed2243b89fa7f4",
  "candidateCommit": "ACTUAL-CANDIDATE-COMMIT",
  "host": "Codex",
  "hostVersion": "ACTUAL-HOST-VERSION",
  "model": "ACTUAL-MODEL",
  "effort": "ACTUAL-EFFORT",
  "mode": "hybrid"
}
```

```text
node dev/single-session-comparison.mjs prepare <options.json>
node dev/single-session-comparison.mjs verify <printed-directory>/manifest.json --initial
```

The machine-readable manifest captures runtime paths, versions, supplied commit IDs, complete file hashes, model/effort/host/mode/language, effective overrides and default configurations, project/map/knowledge hashes, workload/run IDs and execution order. The configuration overrides are in each hashed `.grill/config.json`; defaults are recorded per variant. Run `verify` without `--initial` before each subsequent run to detect runtime/frozen-fixture drift. `--initial` checks all run copies before any are started, so it intentionally fails once a run has changed. A changed source requires a new experiment, never an overwritten manifest. Hashes make accidental changes detectable; they are not an OS write-protection or an adversarial authenticity guarantee.

## Execute only in explicitly authorized real acceptance sessions

1. Follow manifest order. Open a fresh host session in the selected run's `project`, with the recorded identical model/effort and host version. Set `GRILL_HUB_HOME` to this run's `hubHome`. Use the absolute runtime for the selected variant; do not invoke the installed skill alias. Read that runtime's instructions and continue the existing named map with `--dir <mapsRoot> --name comparison --lang en`. Do not call init: that would erase the supplied fixture. Record the actual session UUID and observed settings; reject mismatches before comparing runs.
2. A fresh-history run starts with ordinary startup only. A warm-history run first submits all eight `warmup` entries from its frozen `sequence.json`, in the same session as the measured scenario. Wait for every resulting event and dependency to settle. Warm history is real accumulated model context, not a label on disk state. Record its actual usage separately, along with whole-session usage including setup and warmup. If eight discussions do not exercise growth/compaction or rollover guidance, long-history acceptance remains pending; create a separately versioned, equally applied extension protocol before additional matched runs.
3. Submit each `steps` entry through the existing protected `POST /api/<route>` with its exact JSON `body` and `x-grill: 1`, or the equivalent browser action. Verify the server's protected ping matches this run's map path and PID first. Only submit the next entry after the current action and all automatically scheduled work complete. The sequence is input data, not an instruction to fake grading or bypass clarification. Record every induced question, followup, reread, knowledge operation, retry and failure. Required unscripted clarifications must be resolved identically with documented human inputs, or mark the pair noncomparable; never invent different user answers to force success.
4. Finish triggers knowledge extraction under the existing contract. Confirm an actual knowledge event completed; a failed or missing broad operation is part of the outcome. The standard workload includes 12 initial answer submissions, correction, cross-branch contradiction, root/card discussion, full reread, spec and finish. The broad workload starts with 73 authored cards and includes full reread, discussion, answer/ancestor work, specification and finish/knowledge. It is a **synthetic broad-evidence substitute**, not an authorized Languages snapshot or historical replay. It does not reproduce the historical payload size or near-limit knowledge documents.
5. Record per-event timestamps, action/delivery identities, apply attempts and results, tool/CLI calls, duplicate/truncated reads and repairs, artifact coverage, context growth, compaction, transfer and complete/error outcomes. Keep trace bodies private. Set the exclusive measurement cutoff immediately after report/artifact completion and before any review, implementation or audit discussion. Preserve failures and downstream cleanup inside the cutoff. Stop only this disposable map's server; preserve its files and evidence.
6. Copy `measurement.template.json` to a new result file without replacing the template. Populate measured values only. `null` means unknown, including descendant counts when discovery is incomplete. Record startup/warmup and scenario splits with their actual boundaries; never derive them by guessing. `wholeSession` includes both. `primary` and `descendants` separately carry responses, input/cached/uncached/output/reasoning. Do not count reasoning twice or cached input twice. Use the existing offline `dev/session-audit.mjs --session <UUID> --codex-home <home> --before <UTC-cutoff> --state <cutoff-state-snapshot> --output <new-aggregate.json>` for whole-session aggregate evidence. Event boundaries and prelude/scenario splits need trace evidence beyond that aggregate audit. No missing data is converted to zero.

## Compare and review

Human review must cover every initial and added card, decisions/corrections/conflicts, required clarifications, ancestor grades, provenance, knowledge and specification. The fixture's semantic checklist identifies intentional contradictions and unmeasured assumptions; it is not a precomputed grading oracle. Record reviewer, covered IDs, A/B differences and unresolved questions. A transport pass cannot substitute for human review.

Report paired totals per successful useful scenario, whole-session totals (including warmup), per-event results, ranges and medians separately for each workload/history condition. Keep failed runs visible, including retry/cleanup costs; report missing data and successful-pair denominators. Observe provider cache counters without claiming a forced cold cache. Compare primary plus all observable descendants, responses, input, uncached input, output and latency; flag systematically worse outcomes. Dollar costs require actual applicable billing. No fabricated percentage target or savings conclusion is built into this preparation harness. Result aggregation and economic decisions remain manual until real observations exist.

## Deterministic verification

`node dev/check-single-session-comparison.mjs` checks 24 isolated copies, pair order, 12 scripted initial answers, 73 broad cards, unknown telemetry defaults, runtime/fixture drift rejection, independence after a run mutation, and actual server loading of both fixtures with HTTP 403 without `x-grill`. It runs no model and never touches user maps or installed links. It establishes preparation and fixture compatibility only. Independent code review and the wider migration regression checks are recorded by the implementation orchestrator.

No installation is part of measurement preparation. Real acceptance remains blocked on explicitly scheduled matched host sessions, complete usage/latency traces, observed long-history behavior and human semantic review.
