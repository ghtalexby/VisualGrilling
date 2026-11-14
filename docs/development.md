# Development and debugging

Run commands from the repository root. No dependency installation is required. A fresh checkout includes `package.json`, npm helper scripts, `dev/fixtures/init.json`, and `test-project/.gitkeep`; runtime `.grill/` directories and local skill links are ignored.

## Context budget acceptance

Run `node dev/check-context.mjs` against disposable state and retain the printed before/after character counts. The Stage 0 baseline remains in [the plan](plans/ContextBudget/context-budget.md). Acceptance targets are discussion and idea events at most 35% of baseline, answer evidence independent of unrelated branches, with inline question-title navigation, and a one-answer incremental reread at most 40% of a full reread. Run `node dev/check-context.mjs --real-maps .grill` for optional read-only checks of the five saved acceptance maps (reread, knowledge, ui-preview, ux-completeness, attached-ideas). The standard check also covers long answers with shared vocabulary, a focus + 2300 navigation + question-title answer budget without graph neighbours. Character counts are diagnostic UTF-16 units; instruction budgets are UTF-8 bytes.

Check every omitted card remains reachable through the index and on-demand reads; validate node/branch/search/topic/related reads, incoming links, captured `--token` isolation, stale token rejection, and Host/header protection without queue or listening changes. Exercise duplicate rejection and deliberate `allowSimilar` across addition paths, verifying that rejected results change neither grades nor replies. Check semantic bounds, stale annotations, vocabulary limits, and byte-identical specification/knowledge evidence with semantic fields added.

For reread, establish a full baseline, edit one answer, then verify changed cards and graph neighbours are delivered, untouched questions default to keep and changing an unaudited question fails atomically. Manual reread remains full. Verify threshold boundaries and configuration errors, successful extraction resetting the changed-card baseline, and mandatory knowledge before finish. Current-map metadata without snapshots must save exact server-captured snapshots; wrong versions must fail without rewriting files. Preserve prior sources and manual edits.

Run all `dev/check-*.mjs` suites applicable to the host, including context, discussion, knowledge, reread, workers, monitor and maps, plus `node dev/simulate.mjs --no-open --delay 200 --name context-budget-sim`. Restart only the disposable map server and verify queued event recovery. Record browser prerequisites or skips separately. `check-workers.mjs` checks the split instruction files and the answer worker's combined shared/event instructions under 12000 UTF-8 bytes, with an enforced maintenance ceiling of 11000 bytes to reserve at least 1000 bytes for future edits.

Real-host acceptance remains separate from deterministic checks: on Codex and Claude Code verify an actual map event follows the selected waiting mode, loads only its event rules, retrieves plausible distant candidates before grading/issuing questions, and continues after apply. Exercise a withdrawn premise through a linked distant card, avoid treating `decision`/`chatDigest` as accepted evidence, and confirm semantic duplicate judgments and knowledge provenance. Earlier host transport verification does not establish acceptance of this new context workflow. Report hosts not exercised as unverified.

## Release version

The tooltip includes a localized label (`Версия: 1.0.2` in Russian, `Version: 1.0.2` in English). Other languages use the `Версия` dictionary key. The template encodes the colon as an HTML entity to keep the numeric release separate from phrase translation. After introducing a new dictionary key, restart existing servers to load the updated dictionary; saved custom locales use the usual English fallback until translated.

Hover over the Grilling map brand text in the header to see the installed release version, starting at `1.0.0`. Run `npm run release` once for each new release: it increments the patch number (`1.0.0` → `1.0.1` → `1.0.2`) in the root `package.json` and uses the npm `version` lifecycle script to synchronize `skills/grill/version.json`. It does not publish, commit, or tag. Commit the version files and stamped UI templates with the release changes. No compilation or dependency installation is required.

The whole skill directory includes `version.json`, so copied installations do not depend on the repository package file. Recopy the skill for copied installations; linked installations see the updated version on page reload. The release script stamps the numeric version directly into the UI template. Existing servers read that template on each page request, so a browser reload is sufficient even when the server predates version support. Map state revision counters are unrelated to the release version.

The release script also synchronizes the tracked `.claude/skills/grill/version.json` and `ui.html` mirror, whether it is a regular directory in a fresh clone or a local junction. Include that version file in the release commit too.

## npm scripts

Run `node dev/check-context.mjs` for per-event serialized-character measurements on a disposable fixture with 40 questions and two chat messages per card. It requests all eleven event types and checks accounting, the 200-entry bound, cumulative totals, restart recovery, reset and protected state access. No user maps are changed. The Stage 0 baseline and section meanings are recorded in [the context budget plan](plans/ContextBudget/context-budget.md) and [contract.md](contract.md); later-stage budgets compare focused discussion/idea with that baseline and incremental reread with a full run.

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

The simulator acknowledges discussions with the message and canonical focus-chat length. `[reread]` requests a whole-map review; `[forward:<question-id>] <message>` forwards a request to another question (use `[resolve] <decision>` as the message to exercise grading). A question discussion beginning with `[resolve] ` simulates an accepted decision and automatically applies an ok assessment when no answer is pending. Generated questions are marked `[sim …]`.

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

- `node dev/check-monitor.mjs`: real server/CLI with a fake Codex executable; idle silence, single wake per event, sequential arming, waiter conflicts, stale IDs, failed/warned submissions, rebinding, restart recovery and Host/header protection. It never invokes a model.

- `node dev/check-copy-browser.mjs`: optional Chromium/Node 22+ checks for copy hover placement, block boundaries, Unicode, history, pending/obsolete answers, clipboard failures, late completions and the unchanged export action. Set `GRILL_COPY_SCREENSHOT` to an output PNG path for a screenshot.

- `node dev/check-maps.mjs`: shared list/API discovery, root and named maps, current flags, stopped maps, watch activity (including the 180-second recent-activity window, not a live-waiter-only assertion), Host/header protection, and inbox/expiry map identity in a temporary project.

- `node dev/check-workers.mjs`: inbox transport, notes isolation and limits, session regeneration/restart, model config validation and protected notes API in a temporary project.
- `node dev/check-watch.mjs`: real CLI against a temporary server; swallowed timeouts, expiry, connected state, server loss, and unacknowledged event recovery.

- `node dev/check-spec.mjs`: HTTP checks in a temporary project: create/update, answer boundary and locking, explicit branch preservation/restructuring, deduplication, restart, stale tokens, collisions, and missing `x-grill`.
- `node dev/check-reread.mjs`: request deduplication, answer locks, settled delivery, token rotation and restart recovery, atomic rejection of invalid results, closing/merging/adding/removing/ordering, answer preservation, the map copy, unchanged runs, refusals, automatic runs on edits, specification ordering, and running without an agent. Semantic quality needs a real agent on a real map.
- `node dev/check-locale.mjs`: first-page language, script syntax, complete translations, custom dictionaries and injection rejection, per-map isolation, protected locale updates, initialization, report/spec labels, restart recovery, and switching a running server before opening the browser.

These use temporary projects and preserve user maps. In a real session, create a spec before finishing; verify six meaningful localized sections, blockers for unanswered questions, updates to the same file, and pending/success/error states. The simulator's `[sim]` specification is only a transport demonstration.

## Real agent session

### Codex monitor verification

Real-host transport acceptance on 2026-11-10 with Codex 0.167.0: after reopening the session through the shared server, a one-shot delayed `queue --resume` arrived after the assistant ended its turn, with exit 0 and empty stderr, and automatically started the next turn. The same attempt from the old standalone session had reported `already has an active writer`. The user also confirmed working monitor behavior on 2026-11-11. Check the current Codex host's launch mode on launch/continuation by following the tool shell's parent-process chain (Windows Get-CimInstance Win32_Process; Linux/macOS ps, or Linux /proc argv). Inspect actual Codex launch options, not unrelated processes or prompt text, and avoid printing private command-line data. A confirmed --no-daemon host uses blocking wait without starting a daemon or migrating the session. If metadata is inaccessible, report the limitation and retain the monitor default unless there is concrete contrary evidence. Monitor is the shared-server Codex default; ordinary launches and continuations do not require a new wake-up probe or verification history in the current conversation. Use the checks below for development or diagnosing a concrete regression; this transport check alone does not establish the complete map lifecycle.

For map acceptance, run normal start/init in the intended session, then `G monitor` and end the turn. Leave the map idle for five minutes: no model turns should occur and the map should remain listening. Submit two answers: the first notification must fetch the exact delivery, apply it and re-arm before the second is handled. Check discussion, finish/report/drain/stop and explicit continuation of a finished map. `monitor --status` exposes delivery errors without resending. Restart only the disposable map server: monitor must be off, old delivery IDs rejected and unfinished events recoverable after explicit re-arm. Never run a waiter alongside monitor. Run connection, watch, worker, map and existing queue/spec checks alongside the monitor check. The simulator continues using wait/watch to validate shared event/apply behavior.

### Other host background tasks

For background waiting, first verify the installed host: run `sleep 60 && echo done` as a background Bash task and send nothing. Confirm automatic agent resumption and record the version/time limit. Claude Code uses `run_in_background` and max-wait 1800; Kimi uses `run_in_background=true` and max-wait 540 under its default ten-minute limit. If this is unsupported or unverified, use the blocking fallback.

Then run a real-session “tea test”: start grilling and verify the agent arms watch and ends its turn; leave the map idle for 5+ minutes (no agent turns, still connected); submit an answer (automatic grading and re-arm); chat while armed (watch stays running); wait beyond max-wait (silent re-arm). Codex defaults to monitor; use level 0 only for an explicit user request, a confirmed standalone (--no-daemon) host, or a diagnosed host/transport failure, and explain the fallback reason. CLI checks and the simulator do not validate host wake-up behavior.

For transport coverage run `node dev/simulate.mjs --watch --no-open --delay 200 --name sim-watch` on a disposable map and exercise answers, discussions, more, finish/report and spec. Compare with the normal simulator without `--watch`.

Install once, restart the host, open your actual project, and invoke from chat. The agent starts the server; no separate server or simulator launch is needed.

For Codex, run `npm run link:codex:global` from this repository, then ask `$grill grill my project`. Resume with `$grill continue grilling main`. Local test-workspace linking uses `npm run link:codex`.

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

Real Claude Code/Kimi validation remains separate from transport checks: verify a foreground Agent with the selected model can run `apply`, including any permission prompts. Verify background completion wake-up first. In Kimi record whether a subagent model pool exists. Then verify initial session brief/notes, one fresh worker per event, only short event/status lines in main chat, `.grill/config.json` selecting Sonnet, durable notes reused by the next worker, all event types, and dispatcher fallback after an interrupted worker. Also check levels 0/1 read `worker.md` and only the routed event rules. Install the complete skill directory, including `events/`, `monitor.md`, `dispatcher.md` and `parallel-maps.md`; copying only the entrypoint is insufficient. Simulator success does not establish host/model behavior.

## Parallel-map validation

Run two disposable simulators with different `--name` values and `--no-open --delay 200`. Open their URLs; each header switcher must list both maps, highlight itself, and navigate in the same tab. Add a stopped map and check its continuation hint. Verify keyboard open/Escape, long titles, English/Russian labels, and finished/non-listening notice (after the three-minute activity grace period). Listing must never start a server.

In a real Claude Code session with verified wake-up and foreground workers, start `arch`, answer once, then start a new `money` grilling in the same chat. Submit answers on both pages within seconds: both must be graded by separate sequential workers and only their own watches re-armed. Finish `money` with queued work: drain it before unwatching; `arch` must remain served. Continue `money`, send and grade two separate answers with an empty queue between them, and confirm its watch remains armed after both despite server `finished:true`. Only a new finish should drain and unwatch it. Then stop `arch`; check switcher completion and activity states. Check ambiguous chat commands and lost-table recovery without duplicate watchers. Transport checks cannot establish these host behaviors; record them separately.

On restart, saved custom-language dictionaries retain their existing translations and use English for newly missing UI phrases. Explicit locale files and API locale updates still require complete dictionaries. An explicit startup language/locale replaces the saved locale before its validation. Locale checks cover older dictionaries and replacement on restart.

## UI improvements validation

Run `node dev/check-ui-api.mjs` for recommendations, root discussion, pasted image validation/delivery/cleanup, custom question idempotency/restart, mixed branch preservation/moves/removals, cycle/orphan/outside-ID rejection, stale delivery/branch protection, pending activity, and frozen spec consistency. Run all existing `check-spec`, `check-reread`, `check-workers`, `check-maps`, `check-locale`, and `check-watch` scripts too. The simulator handles tokenized answer/discuss/question events, supplies sample recommendations, and preserves existing descendants. Its grading is heuristic and does not establish semantic model quality.

In the browser, verify status filter focus chooses minimum X then Y with an open drawer; a double click does not first open/replace the drawer; isolation excludes descendants and the drawer’s unrelated card; the eye restores the previous filter and a new filter exits isolation. Check disappearing isolated nodes and empty filter results. Right click an option to explain it immediately, exercise busy/offline/409 paths, and verify text and quote remain on failure. Delay a response, request a second explanation, and confirm the first success preserves the second request; existing unfinished text must never be sent by the automatic explanation action. Root right click opens project chat; card right click creates a child question. Waiting state must survive polls and restart. Inspect both languages, manual recommended-option selection, report and Markdown export.

For slow double-click regression checks, launch a disposable server with `GRILL_DOUBLE_CLICK_MS=900`, dispatch the first click, wait 600 ms, then dispatch the second counted mousedown/click and dblclick. Assert the panel remains unchanged throughout and the same target is isolated. Also hold the second press beyond the timer deadline: its mousedown must cancel opening. Verify a single click opens after the configured interval plus guard, keyboard activation opens immediately, and malformed timing values cannot inject script. Desktop interval APIs: [Windows](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdoubleclicktime), [macOS](https://developer.apple.com/documentation/appkit/nsevent/doubleclickinterval), [GTK](https://docs.gtk.org/gtk4/property.Settings.gtk-double-click-time.html). Desktop preference detection is optional; use the override when the current desktop is unavailable to the server.

While a card click is delayed, open Summary and wait past the deadline: the selected panel must stay open. Escape must cancel delayed opening. Trigger a state poll between the two clicks and assert unchanged card/button and text DOM remain connected, then complete isolation. GNOME interval queries must not run for another Linux desktop even when GNOME schemas are installed.

## Reread premise regression

`check-reread.mjs` covers incomplete/duplicate/inconsistent audits, atomic rejection, removal and replacement of unanswered questions about retired statuses, historical marking of answered/discussed cards, preservation of children and answers, exports/spec snapshots, restart persistence and restoration. These are deterministic transport checks, not proof of semantic review quality.

For a real-agent check, use `dev/fixtures/reread-premises.json` as a delivered snapshot, or supply a map that originally uses implementing/not-implementing statuses, then explicitly replaces them with ordinary question grades. Include an unanswered question whose options still assume the old statuses, an answered version, and an unrelated current question. Ask for rereading without naming the obsolete cards. Verify the unanswered obsolete premise is removed/replaced, the answered version retains its history and is marked obsolete, the current question remains, and every card has an individual audit reason. Verify full-map history, status-filter exclusion, the read-only answer panel, discussion, Summary audit and Markdown export in Russian and English.

## Attached idea validation

Run `node dev/check-ideas.mjs` for idempotent attachment and input limits, discussion, analysis tokens, all five grades, no-question conclusions, automatic reassessment, frozen/live isolation, restart recovery, edit audit/history, canceled specifications and fresh snapshots, deletion locks, exports and escaped UI text. Run the other `dev/check-*.mjs` scripts and the simulator too. The simulator's idea handler deliberately returns open/verify: it tests transport, not semantic quality.

In both languages exercise root menu → Attach idea, close/reopen the draft, attach and verify immediate queued analysis, chat, Analyze idea reassessment, editing while analysis/spec is in flight, and deleting with cancel/confirm. Polling must preserve both the edit and chat input, selection and focus. While deleting is blocked, show the reason and retain the confirmation; editing must remain available. Status filters match/count ideas and questions; unmatched ancestors provide context without increasing counts. Check full-length text and history in both exports. Use a disposable map; preserve other maps and their servers.

A real agent session must verify reuse of existing answers without artificial children, material weak conclusions without a percentage formula, a conflict question before ok, preservation of superseded answered history on edits, and no automatic code implementation. Deterministic transport checks do not prove these semantic behaviors.

Optional `node dev/check-ideas-browser.mjs` uses Chromium CDP with built-in Node 22+ WebSocket (no packages). Set GRILL_BROWSER to an executable when not using the standard Windows Chrome/Edge location. It exercises actual drawer drafts, both edit/chat inputs and caret preservation, menu actions, deletion locks, filters, escaped text, and English/Russian pages. Missing browser support is reported as a skip. The skill itself still supports Node 18+.

## Preview validation

Run `node dev/check-preview.mjs` for publication, retry/restart, bad file names, Save without queued work, source staleness, independent fork history/state, restore invalidation and immutable snapshot retention. Run `node dev/check-preview-browser.mjs` (Chromium and Node 22+) for the circle size wireframe, stable iframe polling, Save, three-way dirty prompt, static SVG and sandbox isolation in RU/EN. The browser harness disables process isolation only for CDP inspection; iframe sandbox/CSP remain enabled. Run existing API/browser checks and `node dev/simulate.mjs --no-open --delay 200 --name preview-check` on a disposable map.

Real-agent acceptance is separate: create a contextual UI and root diagram from explicitly selected branches, refine one of two instances, preserve accepted decisions and separate conflicts. Inspect useful output and export quality. Simulator fixtures and protocol checks cannot prove semantic quality. See [preview.md](preview.md) for the supported format and tab-close limitations.

## Completeness acceptance

Use disposable state for all checks. Run `node dev/check-completeness.mjs` and `node dev/check-completeness-browser.mjs`, then existing API/browser checks and `node dev/simulate.mjs --no-open --delay 200 --name completeness-sim`. The simulator seeds five displayed and five reserved candidates and handles ancestor reassessment; its explanations are transport fixtures, not evidence of model quality.

Verify 5+5 gives 50%, issuance of three gives 80%, restart retains reserve, unknown differs from empty, and filters/closing questions do not reduce the coverage numerator. Check zero-to-three reread additions, duplicate application rejection, last-answer processing before automatic issuance, weak/gap/verify eligibility, pending-work blocking and no repeated empty-reserve work after finish. Check parent answer retention, verdict history, stale delivery rejection and frozen specification isolation. Both report and browser export must retain verdict history.

In RU/EN browsers check unread replies across active/background tabs and restart, exact-message acknowledgements, message totals on root/questions/ideas, project chat, question explanation with draft preservation and failure recovery, multi-select plus comments and exclusive I do not know, and individual Unicode/multiline copy controls including clipboard denial. Create an idea offline and retry creation; exactly one card and initial analysis should persist. Check empty status filters, ancestor context, hidden-panel drafts and preview exclusion. Fit a large map below 10%, then use manual zoom; use the Show all icon with the panel open, an active status filter, an empty filter and an isolated branch. It must fit the visible cards while preserving the filter, isolation and drawer. The Zoom selected control is absent. Double-click empty canvas inside and outside the stage and compare its camera with Show all; filters, isolation and drafts must survive. Double-click a connection stroke and verify the camera stays unchanged; card double-click must still isolate the card.

Real-agent acceptance must verify initial concrete reserve discovery and semantic removal of solved, repeated and outdated candidates, useful follow-ups, substantive ancestor reassessment without treating answered descendants as proof, and preservation of untested assumptions. Deterministic checks cannot establish those judgments.

`check-completeness.mjs` also checks finish with queued answer edits, invalidation of an already delivered automatic reread, restart without resurrection, edits after finish, manual rereads after finish, and queued/delivered automatic jobs upgraded to manual before finish. Submitted answers and ancestor reviews must still drain.

## Play and host session connection

Run `node dev/check-connection.mjs` for session binding, Codex argument transport using a fake CLI, Claude MCP initialization/notification transport, deduplication, stale channels, restart and protected HTTP routes. These checks never send prompts to a real model. Run browser checks for the status → Play → Stop order and preservation of drawers/drafts.

For Codex, run the usual `grill.mjs start` from the intended session. The installed Codex must support `codex queue --thread <id> --message <text> --resume`. Play queues to that exact thread and attempts host resume; a host warning or unavailable daemon may require returning to the terminal. No fallback starts a second agent.

Launch Codex normally for this transport. `queue` rejects `--no-daemon` because it needs the shared server. A session already open in a standalone `--no-daemon` process can reject shared-server resume with `already has an active writer`; starting the daemon alone does not migrate that session. End its current work, close that standalone session and resume it through normal `codex resume <thread-id>` before testing Play. Do not launch a competing agent against the same thread. A queued message or exit code 0 does not establish automatic wake-up. When diagnosing a wake-up regression, verify actual receipt after an idle turn; this is not a prerequisite for ordinary monitor launches.

For Claude Code, register the channel once in the target project (replace paths):

```sh
claude mcp add --scope local grill -- node /absolute/path/to/skills/grill/connection.mjs --dir /absolute/project/.grill
claude --dangerously-load-development-channels server:grill
```

The custom-channel flag is Claude's research-preview opt-in, not a tool-permission bypass; accept Claude's own channel/MCP prompts interactively. Organization policy can prohibit channels. Plain MCP initialization is insufficient for event delivery, and notifications have no host acknowledgement. The UI therefore says the request was sent, not that the agent is connected. Follow [Claude's channel reference](https://code.claude.com/docs/en/channels-reference) if the installed release changes its opt-in.

Start or explicitly continue grilling in that session with the same `--dir`. The channel is scoped to this maps root. Do not operate independent sessions against the same root: the most recent explicit start selects the Play destination. Switching the browser to a sibling map preserves this destination. Stop retains the existing finish-and-summary behavior and leaves map servers readable. Play during a pending finish is rejected.

Real-host acceptance is required separately for both apps: stop a map, switch to a sibling, press Play, verify the request appears in the intended existing session, wait for actual listening and submit an answer. Confirm no second model process or duplicate waiter, then continue the finished map without losing its summary. Repeat with the host closed and with Claude's channel disabled; submission must not falsely indicate connectivity. Restart map servers after upgrading `connection.mjs` or `grill.mjs`.

## Project knowledge

See [knowledge.md](knowledge.md) for the shared index, editable record schema, provenance, content-version checks, recovery guarantees, knowledge/finish lifecycle, explicit history import and generated-spec migration. Keep `knowledge.mjs`, `knowledge.md`, worker instructions, UI/locales and `dev/check-knowledge.mjs` synchronized. Run the knowledge check along with existing queue, spec, worker and map checks.

## Discussion questions acceptance

Run `node dev/check-discussion.mjs` for atomic additions beyond four children, cross-branch parenting, reused links, independent multi-card assessments, answer/provenance history, snapshot isolation, pending-answer conflicts, restart, stale/replayed tokens, staged retries, project/question/idea contexts and header protection. Run `node dev/check-discussion-browser.mjs` for safe links, hidden/deleted targets, historical filters/ancestors, map-specific persistence and preserved drawer drafts. Existing locale, UI/API, spec, reread, completeness, ideas, workers and maps checks remain applicable.

The simulator accepts `[questions]` to add six linked cards and `[answers:<id>,<id>] <user text>` to copy the exact message to several independently graded targets. These are deterministic transport fixtures. A real agent session must separately validate semantic duplicate detection, parent selection anywhere on the map, every substantive follow-up appearing in chat and the tree, no cards for pure explanations, and independently justified closure. No deterministic test establishes the quality of that reasoning.

Large discussion results use numbered staged parts and one final commit; intermediate `committed:false` is not success. Oversized context or aggregate results must produce an explicit error rather than hiding questions. With Obsolete off, test empty status matches, several historical ancestors, Show all, isolation and drafts; with it on, test the union with Open and saved preferences after reload. Equal names in different project directories have different map keys.

An oversized focused discussion context returns HTTP 400, records `node.discussError`, and releases only that failed delivery so unrelated queued work can continue. The UI shows the error; all user messages remain saved. After addressing the context limit, send another message to retry the thread (all messages since the last agent reply are delivered together). Resetting the chat clears the error. This is a failed discussion, never a successful partial result.

Run `node dev/check-current-work.mjs` for delivery versus queued work, notes/staged discussion, stale tokens, cancellation, restart, and more-question recovery. `node dev/check-current-work-browser.mjs` checks task labels in RU/EN, elapsed listening, reload, offline precedence, both animations, narrow layout and reduced motion. Existing event suites also assert active delivery types through the shared knowledge fixture.

## Session usage validation

Run `node dev/check-usage.mjs` for isolated rollout fixtures, partial writes, repeated totals, session rebinding, invalid data, missing providers, HTTP protection and restart. Run locale and current-work browser checks for the header. For real Codex acceptance, start from the intended session and compare the tooltip counters with its cumulative usage after another model response; the internal rollout may be flushed with a delay. Counts include work before map launch.

Resume-copy checks are included in `check-maps.mjs` (absolute project/custom root paths, named and legacy maps, protected metadata) and `check-copy-browser.mjs` (clipboard contents, English instructions, confirmation and keyboard access). Manually hover the map title/name, check narrow layouts and touch visibility, and paste into a new session after the old listener has stopped.


Focused-context regression measurements (saved local maps, read-only; mean serialized
context characters for each question using its answer as the query):

| Map | Answer before | Answer after | Discussion median / full stored nodes |
|---|---:|---:|---:|
| reread | 12202 | 4929 | 19.9% |
| knowledge | 8522 | 3623 | 17.1% |
| ui-preview | 7810 | 4071 | 19.9% |
| ux-completeness | 7143 | 4105 | 27.2% |
| attached-ideas | 5785 | 2304 | 24.5% |

These are context-only projections, not token counts or full HTTP-event averages.
Required branches and graph neighbours can still be large; they are not truncated
just to meet a percentage. Lexical matches are compact navigation rows. The title-only
index for these maps is 2207–4527 characters and is now inline in answer/question events to avoid another history reread. Real-agent semantic duplicate judgments remain a separate
acceptance check; the deterministic 0.85 similarity guard does not detect paraphrases.

Session-cost checks extend context, completeness, discussion, monitor, watch, usage and knowledge scripts. A comparable real 12-answer session is a separate acceptance step: record calls/event, usage differences, separate reevaluation ratio and truncated outputs in the session-cost plan; deterministic transport tests do not establish model-call savings.

Project conversation regression checks in `check-discussion.mjs` cover legacy history, isolated delivery, pending-work conflicts, reset isolation and restart. `check-discussion-browser.mjs` checks the dropdown, +, separate drafts and history.


## Durable action queue acceptance

Run `node dev/check-actions.mjs`: durable IDs/replay/restart, adjacent messages/answer versions, execution-time spec snapshots, submissions during reread, missing-target archive/restoration, group cancellation and start races, failures/manual tail retries, 20 queued actions, finish boundaries and protected API. Run check-monitor, check-current-work, check-workers, check-maps and check-locale with it. Earlier suites that asserted immediate mutation or invalidation must follow the durable admission contract.

In both UI languages exercise queue hover/pinning/Close, separate current/queued counts, three messages plus one internal task, problem access without waiting work, answer editing and deletion during reread, archive access and full-queue refusal with drafts intact. Close the browser and confirm the active host keeps processing. In a real Codex session verify one fresh prepare-only worker per event, worker failure fallback, stale result rejection, main-session-only apply and rearm; fake transport and simulator checks do not prove model/host behavior.

`node dev/check-actions-browser.mjs` verifies EN/RU queue grouping, hover/pinning/close, current-work indicator, problem access, archive and exact internal-task counting. `node dev/check-actions-simulator.mjs` runs the required simulator with `--no-open --delay 200` on a uniquely named disposable map and covers all three grade outcomes, chat, more, finish and report.
