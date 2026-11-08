# Development and debugging

Run commands from the repository root. No dependency installation is required. A fresh checkout includes `package.json`, npm helper scripts, `dev/fixtures/init.json`, and `test-project/.gitkeep`; runtime `.grill/` directories and local skill links are ignored.

## npm scripts

| Script | Behavior |
|---|---|
| `npm run sim` | Start the test workspace server, load `dev/fixtures/init.json`, open the browser, simulate replies |
| `npm run sim:keep` | Continue an existing map |
| `npm run link` | Link `test-project/.claude/skills/grill` to `skills/grill` |
| `npm run link:global` | Also link `~/.claude/skills/grill` |
| `npm run link:codex` | Link `test-project/.agents/skills/grill` to `skills/grill` |
| `npm run link:codex:global` | Also link `~/.agents/skills/grill` |
| `npm run start` | Start only the test workspace map server |
| `npm run status` | Counts and queue for the unnamed map |
| `npm run list` | All test workspace maps, unnamed and named |
| `npm run stop` | Stop all test workspace map servers, preserving state |
| `npm run reset` | Stop those servers and delete `test-project/.grill` |

## Simulator

`dev/simulate.mjs` simulates an agent using the real CLI (`start`, `init`, `wait`, `apply`, `report`) with `cwd=test-project`, exercising the server and command contract. Fixtures and simulated replies remain Russian; language options localize the interface, while meaningful content in another language requires a real agent.

`grade()` uses these exact triggers:

- `не знаю` (I don't know), `не думали` (we haven't thought about it), `не проверяли` (we haven't checked), `пока нет` (not yet), dashes only, or fewer than 4 characters → `gap`; one child, with a 30% chance of `newRoot`.
- A digit and more than 25 characters → `ok`; one child at levels 1–2.
- `думаю` (I think), `наверное` (probably), `предполага` (assume stem), `интересно` (interesting), `скорее` (likely) → `verify`; two children.
- Otherwise → `weak`; two children. At level 4 or deeper, at most one child.

The simulator acknowledges discussions with the message and history length. Generated questions are marked `[sim …]`.

Options: `--inbox` (implies `--watch`, reads the event file from the short line), `--watch` (use `watch` instead of `wait`), `--keep`, `--no-open`, `--delay <ms>` (default 1500 before apply), `--port`, `--name <name>`, `--lang en|ru`, `--locale <file.json>`. Two simulators with different names exercise parallel maps. Ctrl+C stops only the simulator; use `npm run stop` to stop servers.

Editing cycle:

- `ui.html`: read on each page request; reload the browser.
- `grill.mjs` or `i18n.mjs`: stop the simulator, stop its server, then resume with the same name/directory and `--keep`. Check queue recovery.
- `SKILL.md`: unused by the simulator; validate it in a real agent session.

### API checks without a browser

These Bash examples use the unnamed simulator map. Replace the node ID and use the appropriate `server.json` for a named map:

```bash
PORT=$(node -p "require('./test-project/.grill/server.json').port")
curl -s -H x-grill:1 http://127.0.0.1:$PORT/api/state
curl -s -H x-grill:1 -H content-type:application/json -X POST \
  -d '{"id":"<id>","answer":"не знаю"}' http://127.0.0.1:$PORT/api/answer
curl -s -H x-grill:1 -H content-type:application/json -X POST \
  -d '{"id":"<id>","message":"What does this question mean?"}' http://127.0.0.1:$PORT/api/discuss
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:$PORT/api/more # expect 403
```

Exercise grading `gap`, `ok`, and `verify`, discussion, more questions, finish, report, and Markdown export. For runtime changes run `node dev/simulate.mjs --no-open --delay 200`; use a disposable named map with `--name` if other maps exist. Restart only that server to check recovery. Never reset unrelated user maps.

## Standalone checks

- `node dev/check-maps.mjs`: shared list/API discovery, root and named maps, current flags, stopped maps, watch activity (including the 180-second recent-activity window, not a live-waiter-only assertion), Host/header protection, and inbox/expiry map identity in a temporary project.

- `node dev/check-workers.mjs`: inbox transport, notes isolation and limits, session regeneration/restart, model config validation and protected notes API in a temporary project.
- `node dev/check-watch.mjs`: real CLI against a temporary server; swallowed timeouts, expiry, connected state, server loss, and unacknowledged event recovery.

- `node dev/check-spec.mjs`: HTTP checks in a temporary project: create/update, answer boundary and locking, explicit branch preservation/restructuring, deduplication, restart, stale tokens, collisions, and missing `x-grill`.
- `node dev/check-reread.mjs`: request deduplication, answer locks, settled delivery, token rotation and restart recovery, atomic rejection of invalid results, closing/merging/adding/removing/ordering, answer preservation, the map copy, unchanged runs, refusals, automatic runs on edits, specification ordering, and running without an agent. Semantic quality needs a real agent on a real map.
- `node dev/check-locale.mjs`: first-page language, script syntax, complete translations, custom dictionaries and injection rejection, per-map isolation, protected locale updates, initialization, report/spec labels, restart recovery, and switching a running server before opening the browser.

These use temporary projects and preserve user maps. In a real session, create a spec before finishing; verify six meaningful localized sections, blockers for unanswered questions, updates to the same file, and pending/success/error states. The simulator's `[sim]` specification is only a transport demonstration.

## Real agent session

For background waiting, first verify the installed host: run `sleep 60 && echo done` as a background Bash task and send nothing. Confirm automatic agent resumption and record the version/time limit. Claude Code uses `run_in_background` and max-wait 1800; Kimi uses `run_in_background=true` and max-wait 540 under its default ten-minute limit. If this is unsupported or unverified, use the blocking fallback.

Then run a real-session “tea test”: start grilling and verify the agent arms watch and ends its turn; leave the map idle for 5+ minutes (no agent turns, still connected); submit an answer (automatic grading and re-arm); chat while armed (watch stays running); wait beyond max-wait (silent re-arm). Codex must still use level 0. CLI checks and the simulator do not validate host wake-up behavior.

For transport coverage run `node dev/simulate.mjs --watch --no-open --delay 200 --name sim-watch` on a disposable map and exercise answers, discussions, more, finish/report and spec. Compare with the normal simulator without `--watch`.

Install once, restart the host, open your actual project, and invoke from chat. The agent starts the server; no separate server or simulator launch is needed.

For Codex, run `npm run link:codex:global` from this repository, then ask `$grill grill my project`. Resume with `$grill continue grilling main`. Local test-workspace linking uses `npm run link:codex`. When invoking a Codex subprocess, always put `--no-daemon` before its subcommand.

For Claude Code, run `npm run link:global`, then ask `grill my project`. Local test-workspace linking uses `npm run link`. Links point to the working skill, so edits are visible without recopying.

The current `test-project/` has generated state/specifications but no application source. Supply an idea brief if using it for a real session, or use your own project. Existing maps are listed before choosing a continuation or a new map.

Only one session serves a map, regardless of provider. In PowerShell use single-quoted here-strings and UTF-8 `$OutputEncoding` as shown in `SKILL.md`. Verify non-ASCII text in questions, discussion, and reports.

## Historical test fixture: SmetaPhoto

The simulator questions refer to the original deliberately flawed SmetaPhoto project: photo-based renovation estimates, with leads sold to contractors for 7%. Its application sources are absent in this checkout. If restored, preserve the planted weaknesses; it is a review target, not an application to deploy.

| Original fixture file | Planted issue |
|---|---|
| `src/config.js` | Production API key and database password in source |
| `src/server.js` | Unauthenticated `/admin/manual-queue`; client-supplied estimate `total` in `/api/lead` |
| `src/estimate.js` | One vision provider without retries/timeouts; confidence below 0.8 hides manual work as a delay; no regional pricing factor |
| `src/leads.js` | One lead sold to five contractors; negative balances handled manually; founder's personal Telegram; phone number shared with all five |
| `db/schema.sql` | Manual schema setup without migrations; January 2024 prices |
| Fixture README | 95% accuracy based on 40 photos of one apartment; claim of 500 contractors |
| `docs/unit-economics.md` | 500 scraped Avito contacts, 12 conversations, three expressions of interest; assumed CAC/conversion; cofounder manually handles 40% of estimates |

Keep this table and relevant fixture questions synchronized when restoring or extending the fixture.

## Troubleshooting

- **Server not running/responding:** run the map's `start` with the same name and directory. `.grill` resolves from the target project's working directory.
- **Port occupied:** the server chooses the next port; find the actual URL in the map's `server.json`, start output, or list.
- **Another map works but this one does not:** a stale `server.json` may point to its port. CLI checks `/api/ping` pid; start the intended named map again.
- **Stuck reviewing:** an agent took an event without applying it. Editing returns 409. A new wait requeues abandoned thinking work. The same applies to discussions. If no agent is listening, restart only that server.
- **Link creation fails:** the target contains a directory or unrelated link. Preserve its contents and free the path manually; the installer does not overwrite it.
- **Wrong language:** the agent must pass the launch request's language to start. For English use `--lang en`; for another language supply a complete `--locale` file. A legacy map without a selection defaults to Russian.
- **Garbled Windows console text:** try `chcp 65001`.

## Worker session validation

Run `node dev/simulate.mjs --inbox --no-open --delay 200 --name sim-workers` on a disposable map and exercise answers (gap/ok/verify), discussion, more, finish/report and spec. The simulator sends initial notes after init. Compare with plain wait and watch modes.

Real Claude Code/Kimi validation remains separate from transport checks: verify a foreground Agent with the selected model can run `apply`, including any permission prompts. Verify background completion wake-up first. In Kimi record whether a subagent model pool exists. Then verify initial session brief/notes, one fresh worker per event, only short event/status lines in main chat, `.grill/config.json` selecting Sonnet, durable notes reused by the next worker, all event types, and dispatcher fallback after an interrupted worker. Also check levels 0/1 read `worker.md`. Simulator success does not establish host/model behavior.

## Parallel-map validation

Run two disposable simulators with different `--name` values and `--no-open --delay 200`. Open their URLs; each header switcher must list both maps, highlight itself, and navigate in the same tab. Add a stopped map and check its continuation hint. Verify keyboard open/Escape, long titles, English/Russian labels, and finished/non-listening notice (after the three-minute activity grace period). Listing must never start a server.

In a real Claude Code session with verified wake-up and foreground workers, start `arch`, answer once, then start a new `money` grilling in the same chat. Submit answers on both pages within seconds: both must be graded by separate sequential workers and only their own watches re-armed. Finish `money` with queued work: drain it before unwatching; `arch` must remain served. Continue `money`, send and grade two separate answers with an empty queue between them, and confirm its watch remains armed after both despite server `finished:true`. Only a new finish should drain and unwatch it. Then stop `arch`; check switcher completion and activity states. Check ambiguous chat commands and lost-table recovery without duplicate watchers. Transport checks cannot establish these host behaviors; record them separately.

On restart, saved custom-language dictionaries retain their existing translations and use English for newly missing UI phrases. Explicit locale files and API locale updates still require complete dictionaries. An explicit startup language/locale replaces the saved locale before its validation. Locale checks cover older dictionaries and replacement on restart.

## UI improvements validation

Run `node dev/check-ui-api.mjs` for recommendations, root discussion, pasted image validation/delivery/cleanup, custom question idempotency/restart, mixed branch preservation/moves/removals, cycle/orphan/outside-ID rejection, stale delivery/branch protection, pending activity, and frozen spec consistency. Run all existing `check-spec`, `check-reread`, `check-workers`, `check-maps`, `check-locale`, and `check-watch` scripts too. The simulator handles tokenized answer/discuss/question events, supplies sample recommendations, and preserves existing descendants. Its grading is heuristic and does not establish semantic model quality.

In the browser, verify status filter focus chooses minimum X then Y with an open drawer; a double click does not first open/replace the drawer; isolation excludes descendants and the drawer’s unrelated card; the eye restores the previous filter and a new filter exits isolation. Check disappearing isolated nodes and empty filter results. Right click an option to explain it immediately, exercise busy/offline/409 paths, and verify text and quote remain on failure. Delay a response, request a second explanation, and confirm the first success preserves the second request; existing unfinished text must never be sent by the automatic explanation action. Root right click opens project chat; card right click creates a child question. Waiting state must survive polls and restart. Inspect both languages, manual recommended-option selection, report and Markdown export.

For slow double-click regression checks, launch a disposable server with `GRILL_DOUBLE_CLICK_MS=900`, dispatch the first click, wait 600 ms, then dispatch the second counted mousedown/click and dblclick. Assert the panel remains unchanged throughout and the same target is isolated. Also hold the second press beyond the timer deadline: its mousedown must cancel opening. Verify a single click opens after the configured interval plus guard, keyboard activation opens immediately, and malformed timing values cannot inject script. Desktop interval APIs: [Windows](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdoubleclicktime), [macOS](https://developer.apple.com/documentation/appkit/nsevent/doubleclickinterval), [GTK](https://docs.gtk.org/gtk4/property.Settings.gtk-double-click-time.html). Desktop preference detection is optional; use the override when the current desktop is unavailable to the server.

While a card click is delayed, open Summary and wait past the deadline: the selected panel must stay open. Escape must cancel delayed opening. Trigger a state poll between the two clicks and assert unchanged card/button and text DOM remain connected, then complete isolation. GNOME interval queries must not run for another Linux desktop even when GNOME schemas are installed.
