# Context budget: focused event context and a semantic map

Status: stages 0–5 implemented and independently verified. Four full review passes ended clean; all 24 standalone checks have passing final results. See `.orchestrator/state.md` and its verification evidence for the isolated knowledge-test retry and bounded real-host acceptance scope.

## Goal

Cut the tokens the agent spends per map event without lowering the quality of grading, discussion replies, duplicate detection or rereads.

Today most events carry a near-complete snapshot of the map, sometimes several copies of it. In a single long session (Codex monitor, levels 0/1) every delivered snapshot also stays in the conversation history, so later events pay for all earlier ones.

The target model is: **focus in full, the rest of the map as a compact index, full cards on demand by ID, and a semantic map (topics and typed links) that tells both the server and the agent which distant cards matter.**

## Baseline (measured on this repository's own maps)

Serialized characters of `S.nodes.map(contextNode)`, which is what `discuss` and `idea` events deliver as `nodes`, against a one-line-per-card index (`id`, parent, status, question, answer cut to 160 characters).

| Map | Cards | Full `nodes` | Index | Ratio |
|---|---|---|---|---|
| ui-preview | 49 | 60 008 | 10 971 | 18% |
| knowledge | 26 | 39 277 | 6 033 | 15% |
| reread | 31 | 38 142 | 6 374 | 17% |
| ux-completeness | 28 | 27 147 | 6 514 | 24% |

Largest fields across maps: `chat`, `verdict`, `options`, `verdictHistory`, `why`, `answer`. A single main-question subtree is at most 18 743 characters (median about 1 000 to 4 000).

Known waste in `payload()` (`skills/grill/grill.mjs`):

- `discuss`: `nodes` is the whole map with chats; `branchSnapshot`, `history` and `messages` repeat data already inside `nodes`.
- `answer`: `existingQuestions` lists the text of every question on the map, only to prevent duplicates.
- `knowledge`: `nodes` plus `sources`, where each card is serialized again as a string in `snapshot`; the agent must then copy those snapshots verbatim into output files (output tokens).
- `reread`: the whole map with chats, and a mandatory `audit` entry with a written reason for every card (output tokens).
- Instructions: `worker.md` is 41 KB and `SKILL.md` 34 KB. A level 2 worker reads all of `worker.md` for every event although grading an answer needs roughly a tenth of it. One long paragraph block ("Parent reassessments deliver…") is duplicated in both files.

## Principles

1. `state.json` stays the only source of truth. The index and the semantic graph are projections computed by the server at delivery time; no second store that can drift.
2. Context is never silently truncated (existing rule). Anything left out of an event is named in it and retrievable by ID.
3. Semantic data is navigation, not evidence. A `decision` summary or a link written by the agent is never treated as the user's words, never copied into an answer, a specification or a knowledge record.
4. `apply` formats stay ID-based, so existing result formats keep working. New fields are additive.
5. No dependencies, no embeddings, no API key. Meaning comes from the agent that is already reading the card.
6. Each stage ships on its own, with checks, and can be stopped after any stage.

## Stage 0: measurement

Add size accounting so every later stage is judged by numbers.

- In `payload()` callers, record per delivered event: `type`, serialized character count, and counts by section (focus, related, index). Keep a bounded rolling log in state (for example the last 200 entries) plus totals by type. Expose it read-only in `GET /api/state` as `contextStats`.
- Add `dev/check-context.mjs`: builds a disposable map from a fixture of at least 40 cards with chats, requests each event type, and prints sizes. Later stages add budget assertions to this file.
- Record the baseline output of this check in this document before changing any payload.

Acceptance: check runs on a fresh checkout; no event content changes.

### Stage 0 fixture baseline

Measured with `node dev/check-context.mjs` before changing event content: 40 questions (five main branches), two chat messages per card including root, 39 answered questions and one open question. Each event starts from the same disposable fixture. Character counts are UTF-16 code units, not bytes/tokens; section counters sum existing serialized field values as defined in `docs/contract.md`. Random credentials have fixed lengths; environment-specific knowledge author metadata can affect the knowledge total.

```text
type        characters focus related index
answer      9730       6671  0       2521
discuss     39603      7245  31793   0
question    3751       828   0       2521
idea        32696      264   31920   0
reevaluate  7507       0     7018    0
reread      30826      0     30272   0
more        1376       0     1098    0
spec        17770      0     17256   0
preview     1446       936   0       0
knowledge   71422      0     70782   0
finish      8607       0     8218    0
```

`preview` measures its prepare phase. `reevaluate` first grades a child answer; `finish` first acknowledges knowledge extraction with no files. The check also verifies repeated delivery accounting, rolling-history eviction after 205 events, restart persistence/redelivery, initialization reset, and HTTP 403 without `x-grill: 1`. Payloads remain unchanged in this stage.

## Implemented stages 1–4 measurement

Measured with `node dev/check-context.mjs` on the unchanged stage 0 fixture. Character counts remain UTF-16 code units. The check now asserts the budgets, read-only retrieval, coverage of every card, duplicate atomicity and explicit acknowledgment, semantic limits and reverse links, evidence/specification identity, source snapshot injection, incremental audits, and frozen read-token recovery.

```text
type        characters focus related index
answer      9588       5768  3224    0
discuss     13796      5630  3224    4429
question    1418       948   2       0
idea        7450       241   2       6618
reevaluate  6093       0     5604    0
reread      26329      25454 237     2
more        1376       0     1098    0
spec        17770      0     17256   0
preview     1446       936   0       0
knowledge   30137      0     29497   0
finish      8607       0     8218    0
```

Discussion is 34.84% and idea analysis is 22.79% of the stage 0 delivery. An automatic reread after one edited main answer, with one explicit graph neighbour, is 8,646 characters (32.84% of the full reread's 26,329), below the 40% budget. Adding unrelated branches leaves the focused answer context unchanged when they have no lexical or semantic relation. Related selection remains bounded when candidates qualify.

Concrete defaults: lexical minimum score 2 with `log(1 + N / documentFrequency)` weights, top five lexical candidates after graph neighbours, exact serialized related-array budget 20,000 characters; duplicate normalized exact matching or stem-set Jaccard similarity at least 0.85; `knowledge.rereadThreshold` is an integer from 1 to 500, default 5. Captured answer/idea contexts provide `readToken`; pass it as `--token` to retrieval commands to read the captured tree. Invalid, expired, or restarted delivery tokens fail closed. See [the contract](../../contract.md) for final field and endpoint shapes.

## Stage 1: remove duplication and dead weight

No change in what the agent can know; only repeated or empty data goes away.

- `discuss`: stop sending `history` and `messages` as separate copies when the same chat is present in the delivered focus card. Keep one canonical place: the focus card's `chat` with message IDs, plus `message` (the new user text) and `images`.
- All context nodes: omit null, empty-array and empty-string fields; omit chat `at` timestamps; omit `recommendation` and `why` on cards that already have an answer; keep `options` on answered cards only when the answer is not one of them verbatim.
- `verdictHistory`: deliver only for the focus card and for `reevaluate` targets; elsewhere deliver its length.
- `knowledge` event: stop sending `sources[].snapshot`. Deliver `sources:[{card,version}]`. The agent writes source entries without `snapshot`; on `apply knowledge` the server injects the exact snapshot for entries of this map session whose `version` matches the captured job, and rejects unknown versions with 400. Verify the exact metadata-block handling against `knowledge.mjs` before implementing; preserve prior sources and manual edits as today.
- Compute knowledge `version`/`snapshot` from a stable projection that excludes the semantic fields added in stage 3, so adding navigation data does not make every card look changed.

Acceptance: `check-context.mjs` shows `discuss` and `knowledge` smaller on the fixture; `check-discussion.mjs`, `check-knowledge.mjs`, `check-reread.mjs` pass after the simulator is updated.

## Stage 2: focused context, index and on-demand reads

### Event shape

Events gain a `context` object and lose the whole-map arrays:

```json
{"context":{"mode":"focused",
  "focus":[/* full cards: target, its ancestors, its subtree */],
  "related":[/* full cards chosen by the server, see below */],
  "relatedOmitted":["id"],
  "index":"<text, one line per remaining card>",
  "vocabulary":[["topic",3]]}}
```

Per event type:

| Event | Focus (full) | Related (full) | Index inline |
|---|---|---|---|
| `answer` | graded card, ancestors, its subtree (as `branchSnapshot` today) | yes | no (available through `G index`) |
| `question` | parent and ancestors | yes | no |
| `discuss` (question/idea scope) | card, ancestors, subtree | yes | yes |
| `discuss` (project scope) | root chat | yes | yes |
| `idea` | idea, its subtree | yes | yes |
| `reevaluate`, `spec`, `preview`, `finish` | unchanged | no | no |
| `reread`, `knowledge` | see stage 4 | | |

`existingQuestions` is removed from `answer` and `question`; the duplicate guard below replaces it.

### Index format

Plain text, depth-first, two spaces of indentation per level, one line per card not delivered in full:

```
n2ein89l ok  | Name a real case: which UI contradiction…  | = circle size editor window  | #preview #acceptance | chat:5
  k81aa02x weak ! obsolete | …
```

Columns: ID, status, flags (`obsolete`, `conflict`, `pending`, `idea`), question cut to 140 characters, `decision` when present or else the answer cut to 160, topics, chat message count. Bounded by the existing 500-node limit; report an explicit error rather than cutting lines.

### Related cards (server-side selection)

Until stage 3 adds links, relatedness is lexical:

- Tokenize the new user text (answer or message) and every card's `q` + `answer`: lowercase, Unicode letters and digits, tokens of 3+ characters, cut to the first 5 characters as a crude stem (adequate for Russian and English), weight by inverse document frequency across the map.
- Deliver the top 5 cards above a minimum score in full, within a 20 000 character budget. Cards that qualified but did not fit go to `relatedOmitted`.

### On-demand commands

- `G node <id> [<id>…]`: full context cards (same projection as focus), at most 20 per call.
- `G branch <id>`: a card with ancestors and subtree.
- `G index`: the whole-map index text.
- `G search <text>`: the lexical ranking above, as index lines with scores.

All are read-only `GET /api/*` endpoints with the usual `Host` and `x-grill` checks, inputs through `clean()`. They do not touch the queue, leases or listening state.

### Duplicate guard

When `apply` adds a question (`children`, `newRoot`, `questions`, `branchChanges.add`, reread `add`, `question`), compare its normalized text with existing non-obsolete questions using the same tokenizer. Above a similarity threshold, reject the whole result with 400 and name the matching IDs. The agent either reuses the existing card or resends with `allowSimilar:["id"]` on that question after reading it. Rejection is atomic like every other validation failure.

### Instructions

`worker.md` rules for `discuss` and `idea`: read `focus` and `related`; scan `index` for cards on the same object or decision; fetch any plausible match with `G node` before creating a question, recording an answer for another card, or claiming something is undecided. The existing "search all delivered nodes for duplicates" wording becomes "search the index, then read the candidates".

Acceptance: on the fixture, `discuss` and `idea` events are at most 35% of their stage 0 size; `answer` no longer grows with the number of cards outside its branch. New `dev/check-context.mjs` cases: on-demand commands, duplicate rejection and `allowSimilar`, nothing missing (every card is either in `focus`, `related` or the index). Simulator updated to the new shape.

## Stage 3: semantic map

The agent annotates cards while it already has them in context; the server turns annotations into a graph.

### New card fields

- `topics`: up to 5 lowercase concepts, each up to 40 characters.
- `relates`: up to 8 outgoing links `{id, kind}`, `kind` is `depends | conflicts | same-object | supersedes`.
- `decision`: the gist of the current answer in one line, up to 200 characters.
- `chatDigest`: the outcome of the card's discussion in up to 300 characters.

### Where they are written

A shared optional `semantics` object, accepted by:

- `apply answer` (for the graded card),
- `apply discuss` (for the current card, and per entry in `answers`),
- `apply idea`,
- `apply reread` as `semantics:[{id, topics?, relates?, decision?, chatDigest?}]` for any cards, which is also the backfill path for existing maps.

Validation: all link targets exist and are not the card itself; unknown `kind` rejects; everything through `clean()`. Stored on the node. Editing an answer or adding user chat sets `semanticsStale:true` on that card; the next result that carries `semantics` for it clears the flag.

### What the server does with them

- Links are stored one way and read both ways: a card's neighbours are its own `relates` plus every card that links to it. Nothing is written to the target card, so its branch revision does not change.
- `context.related` selection becomes: one-hop neighbours first, then lexical matches, same budget.
- `context.vocabulary`: the map's topics with counts, most used first, capped at 200. Instructions: reuse a listed topic; introduce a new one only when none fits. The shared glossary under `docs/vgril/` is a good seed when it exists.
- Index lines show `decision` and topics.
- New read-only commands: `G related <id>` (neighbours with link kinds) and `G search --topic <topic>`.

### Boundaries

- Excluded from `specNode`, from specification snapshots, from knowledge source snapshots and version hashes, and from both Markdown exports unless explicitly added later.
- `conflicts` is a navigation hint. Only a conflict card settled by the user resolves a disagreement, as today.
- The UI may ignore the new fields at first. Showing topics and links in the drawer is a separate, optional change.

Acceptance: check covers validation, reverse-link lookup, stale flag on answer edit, vocabulary cap, and that spec/knowledge outputs are byte-identical with and without semantic fields.

## Stage 4: incremental reread and less frequent knowledge extraction

### Reread

- On every successful reread apply, save `S.rereadSeen`: a digest of each card's context projection (excluding semantic fields).
- Automatic rereads (answer edit, issuance) deliver `mode:"incremental"`: cards whose digest changed or is missing, in full; their graph neighbours in full; everything else as the index; plus `reserve`, `coverage`, `ideas`, project chat since the last reread.
- In incremental mode `audit` is required for every card delivered in full and every card the result changes; all other cards default to `keep`. The agent may fetch more cards with `G node` and must audit those it acts on.
- The first reread of a map and rereads requested with the manual button or `G reread` stay `mode:"full"` with the complete audit, as today.
- The instruction to check every card against withdrawn decisions stays for full mode. For incremental mode it becomes: identify decisions changed in the delivered cards, follow `depends`/`same-object` links and topic matches from them, and read those cards.

### Knowledge

- Queue `knowledge` after a reread only when at least N answered cards changed since the last saved extraction (default 5, configurable in `config.json`), and always before finish as today. Manual retry/import are unchanged.

Acceptance: `check-reread.mjs` extended with incremental cases (changed card delivered, untouched card defaults to keep, a result that changes an unaudited card is rejected, full mode unchanged). Budget: an incremental reread after one edited answer on the fixture is at most 40% of a full one.

## Stage 5: split the instructions

- `worker.md` keeps the shared procedure, JSON passing, and a routing table from event type to a rules file. Move event rules to `skills/grill/events/`: `answer.md`, `discuss.md`, `question.md`, `reread.md`, `reevaluate.md`, `idea.md`, `spec.md`, `finish.md`; `knowledge.md` and `preview-format.md` already exist. A worker reads `worker.md` and only the file for its event.
- `SKILL.md`: keep map selection, language, context gathering, `init`, and the choice of waiting mode. Move the Codex monitor workflow, level 2 dispatcher, and parallel maps to separate files read only when that mode is selected.
- Remove the duplicated limit paragraphs; keep each rule in one place and link to it.
- Update `dev/link-skill.mjs`, install notes and `check-workers.mjs` for the new files.

Acceptance: a level 2 worker handling `answer` reads under 12 KB of instructions in total; all `dev/check-*.mjs` pass; a real session on each host still follows the loop.

This stage is independent and can be done first if preferred.

## Considered and deferred

- **Deltas against a snapshot the session already saw.** Largest saving for one long Codex session, but correctness depends on the agent noticing that compaction dropped its base. Revisit after stage 2 numbers.
- **Writing the event to a file instead of stdout in monitor mode.** With focused events the payload is small enough that a file adds a read step without saving much.
- **Batching several queued answers into one event.** Changes tokens, leases and staleness per delivery; not worth the contract risk yet.
- **Vector embeddings.** Needs a dependency or a key.

## Decisions for the owner

Defaults are what the plan assumes; change them before implementation if needed.

1. Manual Reread button stays a full reread; only automatic rereads become incremental. (Default: yes.)
2. Duplicate guard rejects and requires `allowSimilar`, rather than only warning. (Default: reject.)
3. Knowledge extraction threshold N = 5 changed answered cards. (Default: 5.)
4. Related-cards budget 20 000 characters and top 5 lexical matches. (Default: as stated; tune from stage 0 numbers.)
5. Show topics and links in the UI. (Default: not in this plan.)

## Synchronization checklist for every stage

Per `docs/conventions.md`: any change to `payload()` or `apply()` updates `SKILL.md`, `worker.md` (and `events/*` after stage 5), `docs/contract.md`, `dev/simulate.mjs`. New CLI commands update the header comment in `grill.mjs`, its `commands` object, `SKILL.md` and `docs/contract.md`. New endpoints follow the security invariants. New config keys update `config.default.json`, validation and `check-workers.mjs`. Update `docs/architecture.md` with the context model, and record measured before/after sizes in this file when a stage lands.

Verification per stage: `node dev/simulate.mjs --no-open --delay 200 --name <disposable>`, the relevant `dev/check-*.mjs`, one server restart for queue recovery, and the review loop from `CLAUDE.md`.
