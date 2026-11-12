# Editing conventions

## Requirements

- **Language.** Write documentation and skill instructions in English. Use the language of the user's launch request for the browser interface and agent-generated map content. CLI diagnostics remain Russian. Preserve exact UI labels, protocol strings, and simulator triggers when quoting them in documentation, with English explanations where needed. Write all code comments in English.
- **No dependencies or build step.** `grill.mjs` and `ui.html` are self-contained, using only Node 18+ built-ins and vanilla JavaScript. Install the skill by copying its directory.
- **Code style.** Follow the existing compact style: one-line arrow functions and short names such as `S`, `get`, `kids`, and `clean`.
- **Leave `Examples/` untouched.** It is the original reference.

## Security invariants

When adding an endpoint:

1. Put it under `/api/` so it requires `x-grill: 1`.
2. Preserve the `Host` check (`127.0.0.1|localhost`) at the start of the handler.
3. The CLI and UI `api()` helpers already supply the header; new helpers must supply it too.
4. Pass all input through `clean()` with an appropriate limit.
5. Escape all text inserted into UI `innerHTML` with `esc()`.

## Synchronization checklist

| When changing | Also update |
|---|---|
| Event fields in `payload()` or the `apply()` / `/api/init` format | `SKILL.md`, `worker.md`, `events/*`, `docs/contract.md`, `dev/simulate.mjs` |
| `clean()` limits | The limits table in `docs/contract.md`; numbers in `SKILL.md` where relevant |
| Statuses (`LABEL`, `ORDER`, `counts()`) | Their duplicates in `ui.html` (`STATUS`, `ORDER`, `counts()`), `.s-<status>` CSS classes, and color tokens |
| UI source phrases, locale validation, or language selection | `locales/en.json`, `i18n.mjs`, `SKILL.md`, `docs/contract.md`, simulator options, and locale checks |
| The `report()` format | The similar UI `toMarkdown()` implementation if matching output is needed |
| Reserve, coverage, ancestor reassessment, read receipts, or reread rules/event/transaction | `worker.md`, `events/*`, `SKILL.md`, `docs/contract.md`, `dev/simulate.mjs`, `dev/check-reread.mjs`, UI lock and result states |
| Worker event rules or delegation | `worker.md`, `events/*`, `SKILL.md`, selected mode files, contract, simulator, installer and `check-workers.mjs` |
| Config keys or models | `config.default.json`, config validation, `SKILL.md`, contract and worker checks |
| CLI commands | The header comment in `grill.mjs`, its `commands` object, `SKILL.md`, `docs/contract.md` |
| Repository structure or scripts | `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/overview.md`, `docs/development.md` |
| Weak spots in a restored `test-project/` fixture | The table in `docs/development.md`; optionally `dev/fixtures/init.json` |

## Known code quirks

- Keep the `spec` contract synchronized across the server, UI, `SKILL.md`, documentation, and simulator. The server writes Markdown supplied by the agent through `apply`; the request does not choose the filename. Preserve the ownership marker, symlink checks, and delivery token. The snapshot must exclude changes made after the request.
- `requeue()` is declared in `grill.mjs` but unused.
- Run at most one `wait` or `watch` per map at a time, including across sessions. A second call returns another agent's work from `thinking` to the queue and can take its events. A lease is postponed to a later persistent-worker step.
- There is no processing timeout. Each new `wait` or `watch` returns everything still in `thinking` (answers in `pending.stage`, discussions in `node.discuss`) to the front of the queue. The agent follows `wait/watch → apply → wait/watch`, so such work is assumed to have been abandoned by a dead session.
- `apply answer` preserves descendants by default. `children` is additive; only explicit validated `branchChanges.remove` deletes existing nodes. Preserve IDs and state on moves; validate the whole candidate tree and frozen spec projection before writing.
- `init` completely overwrites a map, preserving its `version` for UI change detection and the specification ownership/write metadata described in the contract.
- An unsupported `status` in `apply` silently becomes `weak`.
- The server does not validate `area` or enforce the skill's question counts; these are the responsibility of `SKILL.md`.

Inbox and session paths are fixed within the selected map directory and never taken from API requests. Only the server writes `session.md`; only `watch --inbox` writes `inbox.json`.

Codex monitor is mutually exclusive with wait/watch. Keep its server state machine, fixed wake prompt, CLI, skill workflow and `dev/check-monitor.mjs` synchronized. Never send browser text as host instructions, retry ambiguous queue delivery automatically, or re-arm while applying an event. Monitor subscriptions are process-local; keep persisted work recovery independent of notification identity.

`GET /api/maps` reads only the server's `--dir` root and valid sibling map directories, ignores request parameters, and never starts processes. Keep list discovery shared with CLI `list`. Escape map text and validate local link URLs in the switcher. `name` in inbox-mode watch lines identifies the map; plain watch stays compatible. Keep dispatcher rules, worker checks and map checks synchronized.

## Preview synchronization

Changes to preview files, reducers, message protocol or versions must synchronize `preview.mjs`, `preview-view.mjs`, `ui.html`, agent instructions, [preview.md](preview.md), simulator fixtures and preview checks. Never run generated project code in the map window or grant iframe same-origin privileges. Preserve per-version state, token/base/epoch checks, immutable snapshots, explicit deletion choices and independent Git copies. Do not count previews as questions.

Completeness changes must keep reserve transactions, automatic issuance and frozen ancestor evaluations synchronized with worker instructions, simulator and completeness checks. Preserve original answers and verdict history; never derive parent closure merely from descendant statuses. UI filter counts include ideas while coverage counts only current questions. Keep both export implementations aligned with verdict history and unread indicators distinct from total chat counts.

## Project knowledge

See [knowledge.md](knowledge.md) for the shared index, editable record schema, provenance, content-version checks, recovery guarantees, knowledge/finish lifecycle, explicit history import and generated-spec migration. Keep `knowledge.mjs`, `knowledge.md`, worker instructions, UI/locales and `dev/check-knowledge.mjs` synchronized. Run the knowledge check along with existing queue, spec, worker and map checks.

## Context and semantic projections

Keep `context.mjs`, delivery callers, read-only context endpoints, simulator consumers and `dev/check-context.mjs` synchronized. Never replace required evidence with semantic summaries or silently truncate focus branches. Preserve frozen read-token isolation. Keep semantic fields out of specification/knowledge evidence and version hashes; shared duplicate validation and semantics validation must complete before any apply mutation. Reread audit coverage must include fully delivered and changed questions in incremental mode, and every question in full mode. Synchronize extraction thresholds with config validation, knowledge checks and instructions. Preserve Stage 0 baseline measurements while recording later budgets separately.
