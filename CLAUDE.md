# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation — read first

Detailed context lives in [`docs/`](docs/README.md) (in English). Start a new session by reading the relevant files:

- [docs/overview.md](docs/overview.md) — what the product is, user scenario, statuses, repo layout.
- [docs/architecture.md](docs/architecture.md) — server/CLI/UI internals, state model, answer lifecycle, resilience, security.
- [docs/contract.md](docs/contract.md) — CLI commands, HTTP API, event and `apply` JSON formats, length limits.
- [docs/development.md](docs/development.md) — simulator, test project and its planted weak spots, real-session runs, troubleshooting.
- [docs/conventions.md](docs/conventions.md) — editing rules, what must stay in sync, known code quirks.

Code in `skills/grill/` is the source of truth; if docs disagree with it, fix the docs.

## What this is

**VisualGrilling** — a Codex and Claude Code skill that runs an interactive "grilling" of a project in the browser: the agent (in the user's current session) studies the project, opens a local map page, asks critical questions there; the user answers on the map, the agent grades each answer and branches into sub-questions where the answer is weak. Write documentation and skill instructions in English. The map interface and agent-generated content use the language of the user's launch request; follow `SKILL.md` to select it before opening the browser. CLI diagnostics remain Russian. Write code comments in English.

No dependencies, build step, automated test framework, or linter. Standalone API checks are available. Requires Node 18+.

## Repo layout

- `skills/grill/` — the working copy of the skill (edit this one):
  - `SKILL.md` — instructions the agent follows (context gathering, grading rules, tone, JSON formats). Waiting-mode selection lives here; `monitor.md`, `dispatcher.md` and `parallel-maps.md` carry the selected workflow, and `worker.md` routes to event-specific rules.
  - `grill.mjs` — single file: local HTTP server (`serve`) + CLI client the agent calls.
  - `ui.html` — the map UI template, self-contained vanilla JS served at `/`.
  - `i18n.mjs` and `locales/en.json` — validated dictionaries and page rendering; language is stored per map.
- `test-project/` — simulator workspace. The historical SmetaPhoto application fixture is absent in this checkout; use an idea brief or your own project for real sessions.
- `dev/` — debug tooling: `simulate.mjs` (fake Claude driving the real CLI), `link-skill.mjs` (junction into `test-project/.claude/skills/grill`), `reset.mjs`, `fixtures/init.json`.
- `Examples/` — the original reference example; leave it untouched.

## Commands

```bash
npm run sim        # fake-Claude loop against test-project/.grill, opens the map
npm run sim:keep   # same, continue existing map
npm run link       # link skill into test-project, then: cd test-project && claude → grill my project
npm run status | list | stop | reset
```

Manually, from the target project directory (map in `./.grill/<name>/` with `--name`, or `./.grill/` without it):

```bash
node skills/grill/grill.mjs start [--port 4777] [--no-open] [--dir .grill] [--name arch]   # --name/--dir go to every command
node skills/grill/grill.mjs init  < init.json
node skills/grill/grill.mjs watch --max-wait 1800 # one event or expired timeout; background-capable hosts
node skills/grill/grill.mjs wait --timeout 30     # one event JSON or {"type":"timeout"}
node skills/grill/grill.mjs apply < verdict.json
node skills/grill/grill.mjs status | report | stop
node skills/grill/grill.mjs list                  # all maps in .grill: name, title, counts, url, listening
```

## Architecture in brief

Browser → POST `/api/answer|discuss|more|finish` → event in `S.queue` → the agent's `grill.mjs wait` or background `watch` (long-poll `GET /api/wait`, max 290s) → Claude grades → `grill.mjs apply` mutates the tree → UI picks it up via 1.2s polling of `/api/state`. State is a flat `nodes` tree (via `parentId`) in `.grill/[<name>/]state.json`; each map has its own server/port. Details: [docs/architecture.md](docs/architecture.md).

## Must-keep invariants

- **Security:** bind only `127.0.0.1`; reject `Host` other than `127.0.0.1`/`localhost`; require `x-grill: 1` on all `/api/*` (add it in both `api()` helpers — `grill.mjs` and `ui.html`). All input through `clean()`, all UI text through `esc()`.
- **Contract coupling:** `payload()` / `apply()` / `/api/init` formats are documented for Claude in `SKILL.md` and used by `dev/simulate.mjs` — change all together, plus [docs/contract.md](docs/contract.md).
- Status labels/order (`LABEL`/`STATUS`, `ORDER`, `counts()`) are duplicated between `grill.mjs` and `ui.html`.
- `apply` for `answer` preserves descendants by default; `children` adds questions and explicit validated `branchChanges` removes or moves existing ones. Retained IDs, answers, chats and pending work survive.

Full sync checklist: [docs/conventions.md](docs/conventions.md).

## Code review

When asked to review (or before declaring a non-trivial change done), run an **iterative review loop that ends only when a full pass finds no problems**.

**Scope:** everything changed in the task (or the files the user named), plus code that depends on it — e.g. a change in `grill.mjs` contract pulls in `SKILL.md`, `ui.html`, `dev/simulate.mjs`, `docs/`.

**Each iteration's review runs in a fresh subagent.** The main session only orchestrates: it spawns a new `general-purpose` agent (Agent tool, never `fork`, never reuse/`SendMessage` a previous reviewer) for every iteration, so the reviewer has no memory of earlier passes and no bias from them. The reviewer's prompt contains only:
- the scope (file list / what changed in the task, in one or two sentences — not the previous findings or the fixes made);
- an instruction to read `CLAUDE.md` and `docs/` first, then review per step 1 below;
- an instruction to be read-only (no edits) and to return findings in the step 2 format, or an explicit "no findings".

The main session then does steps 3–4 itself and spawns the next fresh reviewer.

**Each iteration:**

1. **(Reviewer agent) Review the whole scope from scratch** — not just the lines fixed in the previous iteration; fixes often break something nearby. Check:
   - correctness: logic, edge cases (empty/long input, missing node id, `pending` in `queued` vs `thinking`, server restart, port in use, Windows paths);
   - contract sync per the table in [docs/conventions.md](docs/conventions.md): `payload()`/`apply()`/`init` ↔ `SKILL.md` ↔ `dev/simulate.mjs` ↔ `docs/contract.md`; statuses duplicated in `ui.html`;
   - security invariants: `127.0.0.1` bind, `Host` check, `x-grill` header, `clean()` limits, `esc()` in UI;
   - conventions: English documentation/comments, interface and generated content in the launch request's language, no dependencies, code style matching surrounding code;
   - docs and `CLAUDE.md` still match the code.
2. **(Reviewer agent) List findings** with `file:line`, severity (bug / contract-mismatch / security / docs / style) and a concrete failure scenario. Drop anything you can't back with a concrete scenario.
3. **(Main session) Check each finding against the code** — discard ones that don't hold up — and **fix the rest.** If a fix needs a user decision, ask, and treat it as open until answered.
4. **(Main session) Verify:** `node dev/simulate.mjs --no-open --delay 200 --name <disposable-name>` plus API calls from [docs/development.md](docs/development.md) (answer → `gap`/`ok`/`verify`, `discuss`, `more`, `finish`, `report`, request without `x-grill` → 403). Restart the server once to check queue recovery if `grill.mjs` changed. Stop and remove only disposable state; preserve unrelated user maps. Run `node dev/check-watch.mjs`, `node dev/check-workers.mjs`, `node dev/check-maps.mjs`, `node dev/check-spec.mjs`, `node dev/check-reread.mjs`, and `node dev/check-locale.mjs` for relevant runtime changes. Documentation-only edits need link and content checks.
5. Spawn a new fresh reviewer agent and go to step 1.

**Stop condition:** a fresh reviewer agent returns zero findings (or only findings the main session disproved against the code) and verification passes. Do not stop because "only minor issues remain" — fix them or explicitly mark them as accepted by the user. The main session keeps the log of all iterations and compares findings across them: if the same finding keeps coming back after 2 fixes, or a reviewer keeps re-raising a finding already disproved, stop and ask the user instead of looping.

**Report** at the end: number of iterations, what was found and fixed per iteration (one line each), verification result, and anything left open with the reason.

Codex uses the same `skills/grill/SKILL.md` and CLI loop as Claude Code. Install locally with `npm run link:codex`, launch `codex` in `test-project`, and invoke `$grill`. User-facing agent labels are provider-neutral; the persisted chat role `claude` remains unchanged for compatibility.

## Per-event worker support

`skills/grill/worker.md` contains the shared procedure and routes to `events/*.md` (or knowledge/preview rules); load only the current event file. Waiting-mode instructions live in `monitor.md`, `dispatcher.md` and `parallel-maps.md`; `config.default.json` defaults the griller model to `inherit`. `node skills/grill/grill.mjs config` merges optional `<--dir>/config.json` without a server. `watch --inbox` writes full events to the map's `inbox.json` and prints a short dispatcher line. `apply notes` replaces bounded agent notes; the server generates `session.md`. Keep these contracts synchronized and run `node dev/check-workers.mjs`. Level 2 requires verified background wake-up and foreground workers; Codex defaults to event-driven `monitor` without repeating wake-up verification; level 0 is only for an explicit user request, a confirmed standalone (--no-daemon) host, or a diagnosed host/transport failure; run `node dev/check-monitor.mjs`. Never re-arm while a worker is applying an event.

## Parallel maps

Levels 1/2 can serve several maps in one session with one background watch per map and sequential event handling. Codex (monitor or level 0) keeps one map per session. The header switcher uses protected, read-only `GET /api/maps` to show sibling maps under the same `--dir`; it never starts/stops servers. Finished maps are unwatched after their queue drains, but their servers remain readable. `watch --inbox` event and expired lines carry `name` (null for legacy). Run `node dev/check-maps.mjs`; real host validation is described in [docs/development.md](docs/development.md).

A fresh checkout includes the npm scripts and helpers, simulator fixture `dev/fixtures/init.json`, and `test-project/.gitkeep`. Runtime `.grill/` directories are ignored. Explicitly continuing a finished map resets only the dispatcher's local completion/drain flags; it stays served until a new finish event, while the server keeps the previous summary.
