# Repository Guidelines

## Read Before Editing

Start with [docs/README.md](docs/README.md), then read the relevant overview, architecture, contract, development, and conventions pages. Code in `skills/grill/` is the source of truth; correct documentation when it disagrees with the code.

## Project Structure & Module Organization

- `skills/grill/` is the working source: `grill.mjs` contains the HTTP server and CLI, `ui.html` contains the UI template, styles, and browser JavaScript, `i18n.mjs` and `locales/en.json` handle per-map localization, and `SKILL.md` defines Claude's workflow.
- `dev/` contains simulator, linking, and reset utilities; `dev/fixtures/init.json` supplies sample questions.
- `test-project/` is the simulator workspace. The historical deliberately flawed application fixture is absent in this checkout; if restored, preserve its planted weaknesses.
- `docs/` documents architecture, contracts, development, and conventions. Read relevant pages before changes.
- `Examples/` is the original reference; leave it untouched. `.grill/` contains generated runtime state.

## Architecture & State

Claude studies the project, asks questions on a browser map, and grades answers in the current session. Grading instructions live in `skills/grill/SKILL.md`.

Browser actions enqueue events; CLI `wait` retrieves them, and `apply` updates the tree. The UI polls `/api/state` every 1.2 seconds. Each map has its own server and port; its flat `nodes` tree uses `parentId` and persists in `.grill/state.json` or `.grill/<name>/state.json`.

CLI paths resolve from the target project's working directory. Pass the same `--name` and `--dir` to every command for a map; use the correct relative or absolute path to `grill.mjs`.

## Build, Test, and Development Commands

Use Node.js 18+ from the repository root. The skill needs no package installation or build step.

- `npm run sim`: launch the simulator and open the map; initializes sample questions.
- `npm run sim:keep`: continue an existing map.
- `npm run link`: link the skill into the test project's Claude configuration.
- `npm run link:codex` / `npm run link:codex:global`: link into `test-project/.agents/skills` / additionally `~/.agents/skills` for Codex.
- `npm run start`: start only the map server.
- `npm run status` / `npm run list`: inspect the current map or list maps.
- `npm run stop`: stop map servers while preserving state.
- `npm run reset`: stop servers and delete `test-project/.grill`.

Reload the browser after UI edits; restart the server after `grill.mjs` edits.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, semicolons, and double-quoted JavaScript strings. Match existing compact helpers and camelCase names. Keep the skill dependency-free with Node built-ins and vanilla JavaScript; no formatter or linter is configured. Write documentation, skill instructions, and code comments in English. The browser interface and agent-generated content use the language of the user's launch request; select it before opening the browser as described in SKILL.md. CLI diagnostics remain Russian. Preserve exact protocol strings when quoting them, with English explanations where needed.

## Testing Guidelines

No automated framework, test naming convention, or coverage threshold is configured. Validate changes with the simulator: exercise answers, discussions, summary, finish, and Markdown export. Check queue recovery after server changes and API rejection without `x-grill: 1`. Follow `docs/development.md`; validate skill instructions in a real Claude session.

## Commit & Pull Request Guidelines

Git history is unavailable in this checkout. Recommended practice: use concise imperative commit subjects. PRs should explain behavior changes, link relevant issues, record manual checks, and include screenshots for UI changes.

## Contract & Security Rules

Keep API changes synchronized across `SKILL.md`, `docs/contract.md`, and the simulator. Preserve localhost binding, Host validation, the `x-grill: 1` requirement, input limits through `clean()`, and HTML escaping through `esc()`.

- Bind only to `127.0.0.1`; accept only `127.0.0.1` or `localhost` as Host. Both CLI and UI API helpers must supply `x-grill: 1`.
- Update `payload()`, `apply()`, and `/api/init` contracts together with their documentation and simulator consumers.
- Synchronize status labels, ordering, and counts between `grill.mjs` and `ui.html`.
- An answer's `apply` preserves descendants unless explicit validated `branchChanges` removes or moves them. Keep retained IDs, answers, discussions and pending work; validate live and captured spec trees atomically.
- Follow the full synchronization checklist in [docs/conventions.md](docs/conventions.md).

## Agent Review Workflow

After code changes, run the `review-fix-until-clean` skill. For requested reviews or non-trivial changes, review the full task scope and affected consumers until a fresh pass finds no unresolved problems.

Use a fresh, read-only subagent for each review iteration, without inherited conversation history or previous findings. Give it the scope and instructions to read this guide and relevant `docs/` pages. Check correctness, edge cases, contract synchronization, security, conventions, and documentation. Findings must include `file:line`, category, and a concrete failure scenario.

Verify findings against the code, fix confirmed issues, then repeat with a new reviewer. For runtime changes, use `node dev/simulate.mjs --no-open --delay 200` and the API checks in `docs/development.md`: answer grading (`gap`, `ok`, `verify`), discussions, more questions, finish, report, and HTTP 403 without `x-grill`. Check restart recovery when `grill.mjs` changes. Reset only disposable test state; preserve unrelated user maps. Documentation-only changes need link and content checks.

Stop only when review is clean and relevant checks pass; report blockers explicitly. If the same issue persists after two fixes or a disproved finding keeps recurring, ask the user. Report iteration count, fixes, verification, and remaining issues.

Codex uses the same `skills/grill/SKILL.md` and CLI loop as Claude Code. Install locally with `npm run link:codex`, launch `codex` in `test-project`, and invoke `$grill`. User-facing agent labels are provider-neutral; the persisted chat role `claude` remains unchanged for compatibility.

## Per-event worker support

`skills/grill/worker.md` contains the shared procedure and routes to `events/*.md` (or knowledge/preview rules); load only the current event file. Waiting-mode instructions live in `monitor.md`, `dispatcher.md` and `parallel-maps.md`; `config.default.json` defaults the griller model to `inherit`. `node skills/grill/grill.mjs config` merges optional `<--dir>/config.json` without a server. `watch --inbox` writes full events to the map's `inbox.json` and prints a short dispatcher line. `apply notes` replaces bounded agent notes; the server generates `session.md`. Keep these contracts synchronized and run `node dev/check-workers.mjs`. Level 2 requires verified background wake-up and foreground workers; Codex defaults to event-driven `monitor` without repeating wake-up verification; level 0 is only for an explicit user request, a confirmed standalone (--no-daemon) host, or a diagnosed host/transport failure; run `node dev/check-monitor.mjs`. Never re-arm while a worker is applying an event.

## Parallel maps

Levels 1/2 can serve several maps in one session with one background watch per map and sequential event handling. Codex (monitor or level 0) keeps one map per session. The header switcher uses protected, read-only `GET /api/maps` to show sibling maps under the same `--dir`; it never starts/stops servers. Finished maps are unwatched after their queue drains, but their servers remain readable. `watch --inbox` event and expired lines carry `name` (null for legacy). Run `node dev/check-maps.mjs`; real host validation is described in [docs/development.md](docs/development.md).

A fresh checkout includes the npm scripts and helpers, simulator fixture `dev/fixtures/init.json`, and `test-project/.gitkeep`. Runtime `.grill/` directories are ignored. Explicitly continuing a finished map resets only the dispatcher's local completion/drain flags; it stays served until a new finish event, while the server keeps the previous summary.
