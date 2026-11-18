# Session audit implementation scope and host-routing gate

Status: P1/narrow-P2 released as 1.0.25; real card-worker lifecycle and matched cost/quality acceptance remain open.

This record supplements the [frozen audit](session-audit-2026-11-18.md) and its
[metrics](session-audit-2026-11-18.metrics.json). It does not revise the baseline:
session `01a1ee47-ce92-75f1-8af4-a47bd37f5ba7`, ending before
2026-11-18 11:44:01.417 UTC, model `gpt-6-astra`, medium effort, hybrid waiting,
installed version 1.0.24. Investigation, implementation and review are excluded.
The measured 17,210,880 input, 16,449,408 cached input, 761,472 uncached input
and 54,391 output tokens are observational totals, not predicted savings.

## Recommended scope

Implement P1 bounded preparation, result preflight, longer interruptible waits
and explicit discussion assessment intent. Narrow P2 to removing provably
redundant assessment scheduling when the existing transaction already covers
the required evidence. Preserve omitted-field compatibility, genuine changed
answer propagation, uncovered dependencies and mandatory spec/finish draining.
Do not infer that all rereads or ancestor checks are unnecessary.

Full P2 still needs assessed revision receipts, dependency coverage, coalescing
and a distinction between evidence changes and review bookkeeping. P0 causal
IDs and complete per-response telemetry, P3 bounded worker reuse and P4
versioned history retrieval remain separate, unresolved work. A local preflight
is structural assistance; the server remains the semantic validator.

The owner proposal for persistent card workers is a separate architecture gate.
It is not enabled by these changes. The audit explicitly requires:

> Verify host routing first. [...] Prototype create/resume/complete/restart
> routing before promising a parent-free loop. [...] do not conceal its model
> cost or start a separate nested model process.

## Evidence and gate decision

On 18 November 2026, read-only `codex --version`, `codex queue --help` and
`codex app-server proxy --help` reported Codex 0.170.0. Queue accepts a UUID or
exact session name, but documents that a failed `--resume` produces a warning
and the command still succeeds. An exit code or queued receipt is therefore
insufficient proof of dispatch or completion. The proxy help describes a
stdio connection to the running app-server control socket.

The existing [adapter](../../../skills/grill/hub/codex.mjs) uses `thread/start`,
`thread/resume`, `turn/start` and `turn/completed`. It also has standalone
owned-process and queue fallbacks, which must not be used to claim that this
host-routing gate passed. Its board-level lifecycle is not a proven per-card
child-session registry or a direct-publication controller.

Run from the repository root:

```powershell
node dev/check-card-worker-routing.mjs
node dev/check-card-worker-routing.mjs --probe
```

The default invocation prints usage without connecting. The explicit probe
only initializes `app-server proxy` and closes that proxy. It never calls
`thread/start`, `thread/resume`, `turn/start`, queue, or the board API, and has
no standalone fallback. Exit zero establishes transport initialization only;
the JSON always reports `lifecycle: "unverified"`. Failure leaves the same
lifecycle gate open. This is a real transport probe, not a fake lifecycle test.

Observed result in this checkout on 18 November 2026: syntax and default usage
checks passed; `--probe` exited 1 after its five-second initialization timeout
(`Codex request timed out: initialize`). No successful proxy initialization was
established here. No thread was created/resumed and no turn was submitted.

| Gate | Required evidence | Current acceptance |
|---|---|---|
| Transport | Existing-host proxy initializes without standalone server | Probe timed out at initialize; prerequisite not established |
| Create | Host creates isolated worker identity in disposable project | Unverified |
| Resume | Later input reaches that exact idle worker and retains context | Unverified |
| Complete | Matching thread and turn completion, with terminal status | Unverified |
| Restart | Controller restart resumes persisted identity without duplicate turn | Unverified |
| Child semantics | Host ownership, parent link and cancellation behavior are established | Unverified; generic thread support is insufficient |
| Direct publication | Token-bound exactly-once board commit without parent model relay | Unimplemented |

No model inference or messages to existing user sessions are needed for the
probe. Real create/resume/complete acceptance requires a working proxy and an isolated
disposable lifecycle environment. Those prerequisites were not established;
this implementation does not perform inference. The timeout leaves support
unverified, not proven unsupported.

## Manual lifecycle experiment after prerequisites are available

1. Create a disposable project and evidence directory outside user maps.
   Record host executable/version, model/effort, initial state hash and test
   ID. Open an existing host for that project; preserve the user's current
   host and sessions. Connect only through `codex app-server proxy`. Send
   `initialize` and `initialized` as in `CodexRpc.initialize()`.
2. Send one `thread/start` request with the disposable absolute `cwd`, verify
   returned cwd and record the returned thread UUID before any turn. If the
   host cannot express child ownership, record that limitation; do not relabel
   a generic thread as a child. Do not use `startOwned`, standalone
   `app-server --stdio`, `codex exec`, or a nested model process fallback.
3. Send `turn/start` to that UUID with text `Remember routing marker ALPHA.
   Reply only ALPHA.` using the adapter's text input shape. Persist the
   returned turn ID. Capture `turn/completed` for both exact thread and turn,
   require successful completion, and check the output marker. A timeout or
   ambiguous submission blocks retry until read-only turn inspection resolves
   whether the turn was admitted.
4. Close the test proxy only. Start a new proxy and initialize it, then issue
   `thread/read {threadId, includeTurns:false}`. Require the exact UUID, cwd
   and idle/notLoaded state. Issue `thread/resume {threadId, excludeTurns:true}`,
   validate identity again, then a second `turn/start`: `Reply with the routing
   marker you were asked to remember.` Require ALPHA and matching completion.
   This is a controller/proxy restart test, not evidence of host restart.
5. In an isolated host, stop/restart that test host through its normal controls
   and repeat the read/resume/second-turn procedure. Never terminate the host
   serving user work. Record unknown/busy/unavailable as a failed prerequisite,
   without creating a replacement identity. Verify no unintended session got
   input. Do not treat a notification lacking thread/turn identity as proof.
6. Save a redacted evidence record with request IDs, thread/turn IDs, terminal
   statuses, marker checks, process ownership and timestamps. Separately record
   each result as passed, failed or unverified. Record queue-only results as
   admission evidence, never lifecycle completion.

Passing these steps only permits designing the controller. The next prototype
needs two linked cards and a general worker, one active action per map, durable
card/session mapping, exact delivery capabilities, dependency invalidation and
restart recovery. Exercise a contradiction, correction, worker loss and lost
apply acknowledgement; preserve journal receipts, owner/token/revision checks,
frozen snapshots and finish boundaries. Current workers remain prepare-only
until protocol and workflow changes explicitly authorize direct publication.

## Matched experiment acceptance remains open

Follow the [measurement protocol](../TokenEfficiency/SPEC.md) with equal initial
history, model, effort, host and waiting mode. Compare fresh-worker baseline,
P1, P1 plus narrow P2, and bounded reuse separately; add the direct-publication
prototype only after lifecycle and protocol gates pass. Include at least twelve
answers plus discussion, correction, cross-branch effects, reread, knowledge,
specification and finish. Use disposable state for repeated cold and warm runs.

Report ranges for parent/card/general responses and launches, input/cache/
uncached/output, latency, retries, repeated reads and truncated tool output.
Deduplicate response IDs and preserve incomplete telemetry. Require equivalent
conclusions, provenance and clarification coverage. The audit's 50% fewer
parent responses and 30% fewer launches are experimental targets, not achieved
savings. Deterministic fixture checks, including any fake transport tests,
cannot establish real host lifecycle or end-to-end token/quality acceptance.

## Validation summary for release 1.0.25

Implementation commit: `5219dc2`. Two independent review passes completed; the
second found no confirmed issues. The first pass's managed multipart and
frozen-scope defects were fixed with regression coverage before that clean pass.

Passed checks: result-preflight, discussion, followups, spec, reread,
completeness, context, actions, worker-cost, workers, monitor, maps, usage,
knowledge, Hub runtime/restart, and actions-simulator. The simulator exercised
`gap`, `ok`, `verify`, discussion, more, finish, report and missing-header 403.
The promo browser storyboard also passed with `--no-encode` (65.4 seconds,
2510 frames); the repository clip was not replaced. Runtime checks used
disposable maps. Source/release mirror parity and installed Codex junctions
were verified at 1.0.25. No push was performed.

These results establish deterministic implementation checks for the selected
P1/narrow-P2 scope only. The failed proxy prerequisite, real worker lifecycle,
matched cost/quality comparison and later stages above remain open.

