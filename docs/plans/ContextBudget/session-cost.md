# Session cost: fewer model calls and a shorter history

Status: planned, not implemented. Follows [context-budget.md](context-budget.md), which reduced the size of individual events.

## Why a second plan

A real Codex monitor session (12 answers, 33 events) was measured from its rollout:

| Measure | Tokens |
|---|---:|
| Input, including re-read history | 17 631 415 |
| of which cached | 17 345 408 (98.4%) |
| Uncached input | 286 007 |
| Output | 34 916 |

| Stage | Events | Tokens | Share |
|---|---:|---:|---:|
| Answer grading | 12 | 7.69M | 43.5% |
| Ancestor reassessment | 12 | 5.23M | 29.6% |
| Knowledge extraction | 2 | 1.92M | 10.9% |
| Discussion and initial study | 4 | 1.60M | 9.1% |
| Reread | 2 | 0.91M | 5.1% |
| Finish | 1 | 0.31M | 1.8% |

What these numbers mean:

- 138 model calls for 33 events: about 4 calls per event, each re-reading about 128 000 tokens of history.
- All event payloads together were about 395 000 characters. They are paid for again on every later call, so the cost is `calls × history length`, not event size.
- Output is 0.2% of the total. Output-side savings do not matter here.

**Rule for single-session modes (Codex monitor, levels 0/1):** an extra tool round trip costs one full re-read of the history (about 128 000 tokens in this session). A few thousand characters added to an event cost about a thousand tokens per remaining call. Prefer putting small navigation data into the event over making the agent fetch it. Record this rule in `docs/conventions.md`.

Goals, measured by stage 0 on a comparable session:

- at most 3 model calls per event on average (now about 4);
- no model call whose only purpose is to re-arm the monitor (now 10);
- separate `reevaluate` events for at most a quarter of graded answers (now one per answer);
- no truncated or re-printed event output.

## Stage 0: measure calls and tokens per event

- Server: for each delivery, count CLI requests between the delivery and the next arm/wait (`fetch`, read-only commands, `apply`, `monitor`). Store it with the existing `contextStats` entry as `requests`.
- When `sessionUsage` is available, store the cumulative input/cached/output totals at delivery and at the next arm, and record the difference per event. Aggregate by event type.
- Expose both in `GET /api/state` under `contextStats`. Optional: show per-type totals in the existing usage tooltip.
- Extend `dev/check-context.mjs` to assert the request counter. Record the baseline table above in this file as the "before".

No behaviour changes in this stage.

## Stage 1: apply and re-arm in one call

Ten model calls in the measured session did nothing but re-arm the monitor.

- CLI: `G apply --rearm`. One process sends the result and, on success, arms the monitor for the same owner.
- Server: do it as one operation inside `/api/apply` (a `rearm` flag with the owner), so there is no window between apply and arm and the rule "never re-arm while applying" still holds. The response adds `monitor:{phase,...}` exactly as `G monitor` would print it.
- A 400 does not arm: the agent fixes the result and retries with the same token. A stale 409 arms, because the delivery is void and replacement work arrives through the subscription.
- Multi-part `apply discuss`: arm only on the final part (`more:false`).
- `finish`: arm only while the authoritative queue count is above zero; otherwise stop the monitor and say so in the response (`monitor:{phase:"stopped",drained:true}`). The agent still runs `G report`.
- Levels 0/1/2 are unchanged; `--rearm` is rejected when no monitor subscription exists for this map.
- Update `monitor.md`, `SKILL.md`, `docs/contract.md`, `dev/check-monitor.mjs`.

Acceptance: `check-monitor.mjs` covers success, 400, 409, final discuss part, finish with empty and non-empty queue, restart between apply and arm. In a real session no turn consists only of `G monitor`.

## Stage 2: assess ancestors inside the answer result

Every graded answer currently queues a separate `reevaluate` event for all answered ancestors (`queueReview`). That was 12 extra events and 29.6% of the session. The answer event already carries the ancestors in `context.focus`.

Event changes (`answer`):

- `ancestorIds`: the answered, non-obsolete ancestor questions that `queueReview` would select.
- For each of them, one index line per direct child that is not already in focus, so the agent sees which sibling clarifications are open, weak or closed.

Result changes (`apply answer`):

- `ancestors:[{id,status,verdict}]`: new grades for ancestors whose conclusion changes. IDs must come from `ancestorIds`. An ancestor not listed keeps its grade. An empty array means "checked, nothing changes".
- `reviewAncestors:true`: the agent needs the full branch; the server queues the existing separate `reevaluate` for all `ancestorIds`.
- Field absent: legacy behaviour, the server queues `reevaluate` as today. This keeps the simulator and older instructions working.

Rules for the agent (`events/answer.md`): close a parent only when the clarifications substantively resolve its original weakness; all children answered is not evidence by itself. Use `reviewAncestors:true` when the judgment depends on branches that are not in focus.

Server:

- Validate and record through `recordVerdict` in the same transaction as the grade. Reject unknown IDs atomically.
- Apply the same handling to answers recorded from discussion (`answers` in `apply discuss`, currently `queueReview` per touched card): accept an optional per-entry `ancestors` list.
- Captured (`capturedForSpec`) deliveries: mirror how the grade itself is applied to the frozen tree. If that proves intricate, keep the separate frozen `reevaluate` for captured work and state it in the contract.
- When a separate `reevaluate` is requested, do not deliver it while answers in the same branch are still queued or pending; one event then covers all of them.

Acceptance: `check-completeness.mjs` (or the check that covers ancestor reassessment) gains cases for inline grades, empty array, `reviewAncestors`, absent field, unknown ID, and coalescing. Simulator sends `ancestors:[]` on some answers and omits it on others.

## Stage 3: question titles inside answer and question events

After the first plan the agent runs `G index --questions` before adding follow-ups. In a single session that round trip costs far more than the titles themselves (2 200 to 4 500 characters on the saved maps).

- Add `context.questionTitles` to `answer` and `question` events: the same text as `G index --questions`, minus cards already delivered in full.
- Instructions: scan `questionTitles` before adding a question; fetch a plausible duplicate with `G node`. `G index --questions` stays for other situations.
- `dev/check-context.mjs`: the fixed 9 730-character ceiling for the answer fixture no longer fits. Replace it with "focus + 2 300 navigation + titles" and note the reason next to the assertion.

Acceptance: instructions for `answer` and `question` contain no mandatory read-only call on the normal path.

## Stage 4: slimmer `reevaluate`

The separate event remains for `reviewAncestors:true`, legacy results and frozen work. Today `reviewPayload` delivers the whole subtree of the highest affected ancestor with chats, then every parent up to root including the project chat. In the session it grew from about 6 000 to 24 000 characters.

- Never include the root card.
- Targets (`ids`): full card, with only the last three `verdictHistory` entries plus `verdictHistoryCount`.
- Descendants of a target that changed since that target's latest verdict (new answer, verdict or user chat message later than its last `verdictHistory` timestamp): full card, chat only if the chat changed.
- Other descendants: index lines.
- Ancestors above the targets: question, answer, status, and full idea `text` for idea ancestors (the existing premise rule); no chat, no history.
- The agent can read more with `G node` / `G branch`. Extend frozen read tokens (`--token`) to `reviewWork` deliveries.
- Keep the 500-node / 600 000-character failure behaviour for the cards that are still delivered in full.

Acceptance: on the context fixture, a `reevaluate` after one child answer is at most half of the current 6 094 characters; every card of the branch is either delivered or present in the index lines.

## Stage 5: large events and knowledge edits

Eight tool outputs in the session were truncated, and the final knowledge event was printed twice after compaction.

Large events:

- When a serialized event exceeds 20 000 characters, `monitor --event`, `wait` and plain `watch` write it to the map's `inbox.json` (the existing inbox mechanism) and print a header: `{type,id?,token?,language,characters,inbox,sections:[{key,characters}]}`.
- Write the file with one card per line inside arrays so a file reader can page through it.
- `--inline` forces the old behaviour.
- Instructions: read the file in parts; after context compaction use `G monitor --status` and the file, never re-print the event.
- Update the "only `watch --inbox` writes `inbox.json`" note in `docs/conventions.md`.

Knowledge:

- `apply knowledge` accepts, for an existing document, `{path,expected,body,meta?,sourcesAdd?}` instead of full `text`. The server keeps the metadata block, replaces the prose after it, shallow-merges `meta` (status, supersedes, conflicts), and appends `sourcesAdd:[{card,version}]` with injected snapshots as it already does for new sources.
- Full `text` remains valid. Verify the block handling against `knowledge.mjs` first.

Acceptance: `check-knowledge.mjs` covers body-only edits preserving prior sources byte for byte; `check-monitor.mjs`/`check-watch.mjs` cover the file threshold and `--inline`.

## Stage 6: suggest a new session when the history is long

Average history, not event size, is the main multiplier, and it grows through the session.

- Read the size of the latest request from the bound session's rollout when the format provides it; otherwise use the difference between consecutive cumulative input totals.
- Config `session.rolloverTokens` (default 120 000). Above it, the map header shows a hint next to the existing copy-continuation control, and delivered events carry `sessionHint:"rollover"`.
- Agent rule: finish and apply the current event, make sure durable facts are in the agent notes (`apply notes`), then tell the user in one line that continuing in a new session will be cheaper. Never migrate automatically.
- Unsupported hosts show nothing.

Acceptance: `check-usage.mjs` fixtures for below/above threshold and missing telemetry; browser check for the hint.

## Stage 7: usage counter and one evidence duplicate

- `usage.mjs` reads `event_msg.token_count`; in the measured session its total was lower than the sum of unique `token_usage_record` entries by exactly the cost of a compaction (244 225 tokens). Count usage records de-duplicated by `response_id` when present and keep the current reader as the fallback. Confirm the record shape on a real rollout before coding; the format is internal.
- When a card's answer was recorded from its own chat (`answerSource.messageIds` all present in the delivered `chat`) and equals the joined text of those messages, omit the repeated text from `answer` in deliveries and send `answerFromChat:true`. Do nothing for other repetitions; an evidence table with IDs is not worth the indirection.

## Order and independence

Stages 1, 3 and 7 are small and independent; do them first. Stage 2 is the largest saving and changes the answer contract. Stage 4 matters less once stage 2 lands. Stages 5 and 6 are independent of the rest.

## Decisions for the owner

1. Inline ancestor assessment is the default instruction for all hosts, with the separate event on request. (Default: yes.)
2. Question titles are always inline in `answer` and `question`, including worker modes. (Default: yes; the cost is small there too.)
3. Large-event threshold 20 000 characters. (Default: as stated.)
4. Rollover hint at 120 000 tokens of history. (Default: as stated; tune after stage 0.)
5. Frozen (`capturedForSpec`) answers keep the separate `reevaluate` if inline handling is intricate. (Default: allowed.)

## Synchronization and verification

Follow the checklist in `docs/conventions.md` for every stage: `payload()`/`apply()` changes update `worker.md`, the affected `events/*.md`, `SKILL.md`, `monitor.md`, `docs/contract.md` and `dev/simulate.mjs`; new CLI flags update the header comment and `commands`; new config keys update `config.default.json` and validation. Keep the answer worker instruction budget in `check-workers.mjs` passing. Run the simulator, the relevant `dev/check-*.mjs`, one server restart, and the review loop from `CLAUDE.md`. After stage 2, repeat a real 12-answer Codex session and record the stage 0 numbers here next to the baseline.
