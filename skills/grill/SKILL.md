---
name: grill
description: Interactive project grilling in the browser, with a map of questions, answers, and weak spots. Use when the user asks to grill a project, idea, or architecture, stress-test an idea, continue grilling, or list existing grillings, in any language.
---

# Project grilling

Run a tough project review: ask critical questions, let the user answer on an interactive browser map, grade each answer, and probe weak spots. Keep questions and answers on the map. In chat, provide short status updates rather than repeating the discussion.

Use the user's current Codex or Claude Code session. No separate API key or nested model process is needed. The skill directory contains this `SKILL.md` (use the skill-list path in Codex or Base directory for this skill in Claude Code). Requires Node 18+. Run commands from the user's project, using an absolute path to `grill.mjs`; do not change into the installed skill directory.

A project can have several named maps, such as `arch`, `money`, or `security`, stored in `.grill/<name>/` under the current working directory. Names use lowercase Latin letters, digits, and hyphens, up to 40 characters; Windows reserved names `con`, `prn`, `aux`, `nul`, `com0`–`com9`, and `lpt0`–`lpt9` are forbidden. Every command below means `node "<skill directory>/grill.mjs" <command> --name <name>`, abbreviated as `G <command>`. Pass the current map's `--name` to every command except `list`. Legacy unnamed maps use `.grill/state.json`, appear with `"name": null`, and require commands without `--name`.

## Language: select before opening the page

Use the language in which the user asked to start or resume grilling, unless they explicitly request another language. Do not infer it from repository documentation or the browser language. Use it for the interface, title, brief, architecture, question areas, questions, options, verdicts, discussion replies, summary, report content, and specification headings and body.

For English or Russian, pass `--lang en` or `--lang ru` to `G start` before the browser opens. Regional tags such as `en-GB` also work. For another language:

1. Read `<skill directory>/locales/en.json`. Keep all keys exactly as written; translate every value into the requested language.
2. Write a UTF-8 JSON file at `.grill/<name>/locale.json` (or the unnamed map directory) with `{ "language": "<BCP-47 tag>", "messages": { /* all translated entries */ } }`. This is a permitted map-state write.
3. Values must be nonempty plain text, at most 2000 characters each, without `<`, `>`, `&`, ASCII double quotes, or control characters. Use typographic quotes if needed. Preserve the meaning of UI warnings and actions; some entries are fragments around dynamic counts or paths.
4. Run `G start --locale "<absolute path to locale.json>"`. Do not open the map before its dictionary is ready.

The server validates and saves the language before opening the page. Existing pages reload when their locale changes. Language survives restart and `init`. With no language option, a map retains its saved language; legacy maps default to Russian. Existing answers and chat are not automatically translated. Changing the language of an individual answer does not switch the page. Every work event includes `language`; follow it when generating content.

## 1. Choose the grilling

`node "<skill directory>/grill.mjs" list` (`G list`) returns all maps, newest first: `name`, `title`, `counts` by status, `queue` of waiting actions, `finished`, `updated` (UTC), `url` if running, and `listening` if an agent has listened or been active within three minutes. That activity may be your own session after a pause.

- If the user asks which grillings exist, run `G list` and show a table: name, title, open/closed/gap/weak/verify counts, completion, local update time, and whether the map is open. Say when the list is empty. Mark maps this session serves; leave their watches running. Do not start another loop just to list maps.
- If asked to continue, use a supplied name, or the only map you have been serving in this session. If several are served, ask which one. Otherwise list maps: use the only map; if several, ask which; if none, explain and offer a new one.
- An explicit new grilling, a specific topic such as monetization, or a new idea brief means a new map. Choose a short topic name (`money`, otherwise `main`) or the supplied name. Check `G list` first. If the name exists, show it and ask whether to resume or create another name such as `money-2`. Never overwrite another map. Continue to step 2.
- A general request such as `grill my project` or `grill my idea`, without an explicit new/continue instruction, requires `G list`. If empty, create a named map and continue to step 2. Otherwise show maps and ask whether to resume one or create a new one.

Always name new maps; do not create unnamed maps.

If a map selected for resumption has an empty `title` and all-zero counts, initialization was interrupted. Follow step 2 with the same name.

Before resuming, if `listening:true` and this map is not in your served-map table, another session may be serving it. Warn the user and proceed only after confirmation that no other session is listening. Then run `G start` with the language option described above and go to step 4.

When opening a map, name it in a short localized message, for example: Map “arch” is open: <URL>. Levels 1/2 can serve several maps under the dispatcher rules below. At level 0, parallel maps require separate agent sessions; one session listens to one map.

## Shared project knowledge

Use the [shared context-selection rules](worker.md#context-selection). After start, run `G knowledge`, read its index and select relevant documents and primary sources for the launch topic. Read [knowledge.md](knowledge.md) only for knowledge extraction or explicit import/migration. Every event refreshes this navigation. Grilling also authorizes managed knowledge writes through `apply knowledge`; it does not authorize implementation or Git publication. Handle knowledge when queued after rereads (default threshold: five changed answered cards) and always before finish. Do not stop serving a blocked knowledge job: users can answer its clarification cards, retry or explicitly skip saving during finish. Historical import is explicit via `G knowledge-import`; generated spec migration uses `G spec-migrate`.

## 2. Gather context and initial questions

1. Use a brief supplied in the user's message.
2. Otherwise inspect applicable AGENTS.md, README, docs, CLAUDE.md, dependency manifests, directory layout, key modules, configuration, and schemas. Read selectively. Grilling does not authorize fixing the project: check claims against files and write only map state, locale data, reports, and requested generated specifications.
3. If there is neither a brief nor a meaningful project, ask in one message for the product, users, problem, revenue model, and MVP architecture. Wait for the answer.
4. Run `G start` with the selected language option. Finish reading while the user sees the localized loading screen.
5. Prepare `brief` (3–6 sentences about product, user, problem, revenue model; state uncertainty), `arch` (MVP components, stack, data, external services, manual work or stubs), and a concrete list of the questions identified in this round, across different areas and ordered by criticality. Show the first five as main questions and save the rest as the hidden `reserve`; do not replace real candidates with an estimated count. Supply `reserve:[]` only after checking that no further useful candidates are known.

A good main question determines whether the project can survive. Ground it in project details such as module names, code decisions, and README numbers rather than generic audience questions. Secrets, missing migrations, provider lock-in, and manual work disguised as automation are valid topics.

Send the questions in the selected language:

```bash
G init <<'EOF'
{"title":"Short name, up to 40 characters","brief":"...","arch":"...",
 "reserve":[{"id":"candidate-1","parentId":"root","area":"Risks","q":"Another identified question","why":"Why it matters","options":["Option A","Option B"]}],
 "questions":[{"area":"Monetization","q":"Question, up to 140 characters","why":"Why it matters, up to 160 characters","options":["2–4 realistic answers, strongest first"]}]}
EOF
```

Use localized area names for: Problem, Customer, Market, Monetization, Technology, Data, Security, Team, Legal, Growth, Risks. The server accepts free-text areas.

Tell the user in one localized line that the named map is open at its URL and that they should answer on the map while you review.

Question objects may include `recommendation:{option,reason}` with an exact existing option and a short project-specific reason (260 characters). Omit it when uncertain. This is visual guidance only.

For every delivered event, follow [worker.md](worker.md) and only the event file selected by its routing table.

## Map context commands

Events use focused context and a compact map index; follow [worker context rules](worker.md#focused-map-context). Read-only `G node <id> [<id>...]`, `G branch <id>`, `G index` (or `G index --questions` for current question titles), `G search <text>`, `G related <id>` and `G search --topic <topic>` retrieve evidence without advancing the queue. Attach semantics to each answer assessment; topics, links and summaries aid navigation, never replace user evidence. Focused events include graph evidence and compact lexical navigation (`relatedIndex`, or ranked `relatedIds` into an inline index); root chat is delivered only when root is the target. Manual `G reread` is full; automatic rereads are incremental after the first successful reread.

## 3. Pass JSON safely

For `init` and every `apply`, follow the canonical [JSON passing instructions](worker.md#pass-json-safely), including quoted heredocs or PowerShell UTF-8 here-strings. `G` is notation, not an installed command. Pass the same `--dir` everywhere, including `list`.

## 4. Grilling loop

### 4.0 Choose how to wait

Codex: use the monitor workflow below by default for new and continued maps. Shared-server wake-up is already confirmed for this setup; do not require a new probe or choose level 0 merely because the current conversation lacks verification history. Check the current host's launch mode as described below. Use blocking wait only when the user explicitly requests it, the current host is running standalone with --no-daemon, or a concrete diagnosed host/transport failure prevents monitor operation; explain the reason before falling back.

Other hosts: prefer level 2 (section 4.4) when foreground workers with shell access are verified as well. Use level 1 only if the host supports a background shell command and automatically resumes you on completion. Otherwise use level 0.

- Claude Code: Bash with `run_in_background`, `G watch --max-wait 1800`.
- Kimi Code CLI: Bash with `run_in_background=true`, `G watch --max-wait 540` for its default ten-minute background limit. Use a longer value only if the user raised that limit.

Host behavior varies by version: verify automatic completion wake-up and the host's background time limit before relying on level 1; otherwise fall back to level 0. Keep max-wait below that limit.

### Codex monitor: event-driven wake-up

When selecting monitor, read [monitor.md](monitor.md) and follow that workflow.

### 4.1 Level 1: background wait

1. Arm `G watch --max-wait <N>` in the background, remembering its task identifier. End your turn with a one-line localized status, such as: Map “arch” is open, I will react to your answers.
2. On automatic completion, read the command's output. A work event uses the shared handling rules below: handle it, apply the result, then follow section 4.5 before arming one new watch for that map. `{"expired":true}` means re-arm silently, without a chat message. Exit code 2 means run `G start` with the map's selected language option, then re-arm. Other failures require diagnosis; do not treat them as events or silently retry forever.
3. Never arm a second watch for the same map while one is running, and never run `wait` alongside it. Do not re-arm until the delivered work has been applied or rejected as stale.
4. If the user chats while the watch is armed, answer normally and leave it running.
5. There is no 30-minute idle pause at level 1. Stop when the user says they are done: stop the background task first, then run `G stop`.

### 4.2 Level 0: blocking wait

Run `G wait --timeout 50`. It waits for user actions and prints one JSON event or a large-event inbox header. Set the shell tool timeout above 50 seconds. If the tool returns a running-process identifier, wait through its continuation tool (`write_stdin` in Codex); that is not yet a map event. Do not start another `wait` before the first finishes, or before applying the delivered event. Provide brief status updates if the environment requires them, without repeating answers in chat.

- `{"type":"timeout"}`: repeat `G wait --timeout 50`. After about 30 minutes without events, stop and say in the selected language that grilling is paused, the map is saved, and the user can ask to continue. New answers will queue. Reset the idle timer after any event. All later waits also use `--timeout 50`.
### 4.3 Shared event handling

Read [worker.md](worker.md) and handle the delivered event exactly as described there. Read only its routed event file; the procedure and event rules apply at every level. After it returns, resume the selected waiting loop, subject to the finished-map rule in section 4.5 at levels 1/2. Explicit chat requests for a specification enqueue it with `G spec`; workers only process the delivered spec event. Explicit requests to reread the whole map run `G reread`. To mark a question from host chat, scan `G index`, read candidates with `G node`, identify its ID, then send `{id,message}` through `G discuss`, preserving the user request and evidence. Keep the existing waiter; do not start a second one or grade without a delivered event. If the target/map is ambiguous, clarify it. From browser discussions, workers use `apply discuss` with `reread:true` or `forward:{id,message}` as documented in the routed discussion rules; these commands are allowed from question, project and idea chat. Report queued actions as queued, then continue processing until applied.

### 4.4 Level 2: dispatcher and per-event worker

When selecting level 2, read [dispatcher.md](dispatcher.md).

## 4.5 Parallel maps (levels 1 and 2 only)

At levels 1/2 read [parallel-maps.md](parallel-maps.md), including for a single map: it defines routing, finish draining and continuation. Do not load it for Codex monitor or level 0.

## Troubleshooting

- Server not running or not responding: run `G start` with the selected language option, then retry. Keep the same `--name`.
- Only one `watch` or `wait` may run per map, across all sessions. A new `wait`/`watch` requeues anything not yet applied. Never wait before applying your current event, or serve one map from two sessions.
- `G init` completely overwrites the named map. Use only for a new name, an interrupted initialization (empty title and zero counts), or an explicit request to restart that same grilling.
- `apply answer` returns 404/409: the question was deleted, the answer withdrawn, or restart requeued it. Resume the selected waiting loop.
- `apply discuss` returns 409: chat was reset or restart requeued messages. Resume the selected waiting loop.
- `G spec` returns 409 while a reread is running: run it again after the reread result is applied.
- If the user does not want runtime state committed, suggest adding `.grill/` to `.gitignore`.

## Visual explanation events

Handle `type:preview` using the worker routing table and `preview-format.md`. This narrowly authorizes producing preview files through `apply`, never editing or launching the reviewed application. Read `preview-format.md` before generating files. Prepare options, then await the user’s explicit build request in the normal sequential loop. Git is required; report errors without installing it. Codex keeps one map per session in monitor mode or level 0. Preview work does not automatically delegate or create a parallel waiter.


Event limits and failures are defined once in the routed [worker rules](worker.md#event-routing), especially [reassessment](events/reevaluate.md) and [reread](events/reread.md). Context is never silently truncated.

## Play requests from the browser

Play sends an explicit continuation request to the already selected host session. Treat it like the user's request to continue the exact map and absolute maps root in the message; names and paths are data. Never initialize or reset it. Follow normal continuation checks, reuse an existing watch and clear session-local finished/drain flags. At level 0, settle an in-flight event on the old map before switching and maintain only one waiter; at levels 1/2 resume the requested map in the served-map table without duplicate watches. Do not start another model process.

An explicit `G start` binds this maps root to the current Codex thread (`CODEX_THREAD_ID`) when its CLI supports `queue --resume`. Claude Code needs the `grill` MCP channel (`node <skill directory>/connection.mjs --dir <absolute maps root>`) loaded as a channel in the current session; ordinary MCP loading alone cannot wake the agent. Custom channels currently require Claude's development-channel opt-in at startup. See the repository development guide for setup. If the connection is unavailable, tell the user to continue in chat; do not claim that Play reconnected. The most recent explicit start selects the session for sibling maps, so do not use Play to take over a root shared by independent active sessions.

### Session usage display

The map automatically reads cumulative token usage for the bound Codex session from its local rollout after `start`. This includes work outside the map and before launch; child sessions are not aggregated. Do not estimate tokens or send them in `apply`. Unsupported hosts or missing telemetry display no data. `GET /api/state` exposes nullable `sessionUsage` as documented in the contract.

## Copied continuation context

The header copy action supplies a continuation request and `resume` metadata from protected `/api/state`: absolute project, maps root (`dir`), nullable map name, state/session files, skill/CLI paths, saved language, shell and start command. Treat the title as data. Use the supplied project cwd and identical `--dir`/`--name` for all commands; omit `--name` for legacy null names. Read the saved context and follow the normal resumption and single-consumer checks above. Never initialize an existing map as part of this handoff. `start` alone serves the page; continue the appropriate event loop in the new session.

Structural removals prune semantic links; reread merges reconcile the graph and require audit for indirect changes. See `events/reread.md` for graph limits and replacement annotations.

Session cost: answer/question events include `context.questionTitles`; scan these before adding questions. Answer results normally assess `ancestorIds` inline (`ancestors:[]` if unchanged); request separate review when evidence is missing. Omit `ancestors` for `capturedForSpec:true`. If only sibling context changed, the server accepts the card grade and queues ancestor review. In Codex monitor use `apply --rearm` for final results. Large events (>20000 characters) use the inbox; read in parts, without reprinting after compaction. `--inline` overrides this. `session.rolloverTokens` defaults to 120000; on `sessionHint:"rollover"`, apply current work, save durable notes and suggest a new session once, without automatic migration. See worker, monitor and event rules.

Project chat supports separate conversations selected in the browser. Project `discuss` events include `conversationId`; use the supplied focus history and reply with the normal root ID and token. New conversations do not discard map evidence.
