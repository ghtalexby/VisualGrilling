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

Read [knowledge.md](knowledge.md). After start, run `G knowledge`, read its index and select relevant documents and primary sources for the launch topic. Every event refreshes this navigation. Grilling also authorizes managed knowledge writes through `apply knowledge`; it does not authorize implementation or Git publication. Handle the separate knowledge event after rereads and before finish. Do not stop serving a blocked knowledge job: users can answer its clarification cards, retry or explicitly skip saving during finish. Historical import is explicit via `G knowledge-import`; generated spec migration uses `G spec-migrate`.

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

The UI also queues `question` for user-authored main or child questions, supports project discussion on `root`, and can request an immediate explanation of a quoted option. Discussion events can include attached images as absolute paths in `images`, including messages with no text; inspect them as described in `worker.md`. Follow `worker.md` for these events. Follow worker.md's Questions and answers from discussion contract: inspect full-map `nodes`, automatically create every substantive question with `questions` and `links`, reuse matching cards across branches, and copy user messages to all answered cards with independently graded `answers`. Legacy `assessment:{status,verdict,answer}` supports current-question verdict corrections. Large results use staged parts followed by one atomic commit. No separate Answer-tab submission or user request is needed; explanatory chat without new questions stays reply-only. Preserve existing answers, pending work and frozen specs as described in worker.md. Echo delivery tokens for answer/discuss/question/idea/reevaluate. Ancestor reassessment uses the separate `reevaluate` event; preserve original answers and evaluate evidence rather than counting completed descendants. Idea events also require echoing capturedForSpec; follow the Attached ideas section in worker.md, including full-map context, edit audits, snapshot isolation and automatic reassessment. Attaching or discussing an idea never starts implementation. Answer grading preserves descendants unless explicit validated `branchChanges` removes or moves them; review the full branch snapshot, including user-authored questions, before restructuring. Do not apply the former blanket descendant-deletion rule. The Reread button, or an edit of an existing answer, queues `reread`: a whole-map review, reserve cleanup and issuance of zero to three useful questions described in `worker.md`, the operation for restructuring other branches. Explicit chat requests may also forward a decision to another question through its discussion. Echo its token too. Every successful reread requires an audit of every delivered card against current decisions, including withdrawn premises in its wording and options. Replace obsolete unanswered questions; mark answered/discussed ones as historical without losing their content. Follow the audit and restoration contract in `worker.md`.

## 3. Pass JSON safely

`G` is notation, not an installed command or persistent shell function. Expand it to `node "<skill directory>/grill.mjs" <command> --name <name>` every time. If using `--dir`, pass the same value everywhere, including `list`.

In Bash use quoted heredocs (`<<'EOF'`); the quotes are required. In PowerShell, including Windows PowerShell 5.1, use a single-quoted here-string and UTF-8 stdin:

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
@'
{"type":"discuss","id":"<event id>","token":"<event token>","reply":"A reply in the selected language"}
'@ | node "<skill directory>/grill.mjs" apply --name <name>
```

Use the same method for `init` and other `apply` payloads. Do not interpolate JSON into executable shell strings. Encode newlines inside JSON strings as `\n`.

## 4. Grilling loop

### 4.0 Choose how to wait

Prefer level 2 (section 4.4) when foreground workers with shell access are verified as well. Use level 1 only if the host supports a background shell command and automatically resumes you on completion. Otherwise use level 0. Codex uses level 0.

- Claude Code: Bash with `run_in_background`, `G watch --max-wait 1800`.
- Kimi Code CLI: Bash with `run_in_background=true`, `G watch --max-wait 540` for its default ten-minute background limit. Use a longer value only if the user raised that limit.

Host behavior varies by version: verify automatic completion wake-up and the host's background time limit before relying on level 1; otherwise fall back to level 0. Keep max-wait below that limit.

### 4.1 Level 1: background wait

1. Arm `G watch --max-wait <N>` in the background, remembering its task identifier. End your turn with a one-line localized status, such as: Map “arch” is open, I will react to your answers.
2. On automatic completion, read the command's output. A work event uses the shared handling rules below: handle it, apply the result, then follow section 4.5 before arming one new watch for that map. `{"expired":true}` means re-arm silently, without a chat message. Exit code 2 means run `G start` with the map's selected language option, then re-arm. Other failures require diagnosis; do not treat them as events or silently retry forever.
3. Never arm a second watch for the same map while one is running, and never run `wait` alongside it. Do not re-arm until the delivered work has been applied or rejected as stale.
4. If the user chats while the watch is armed, answer normally and leave it running.
5. There is no 30-minute idle pause at level 1. Stop when the user says they are done: stop the background task first, then run `G stop`.

### 4.2 Level 0: blocking wait

Run `G wait --timeout 50`. It waits for user actions and prints one JSON event. Set the shell tool timeout above 50 seconds. If the tool returns a running-process identifier, wait through its continuation tool (`write_stdin` in Codex); that is not yet a map event. Do not start another `wait` before the first finishes, or before applying the delivered event. Provide brief status updates if the environment requires them, without repeating answers in chat.

- `{"type":"timeout"}`: repeat `G wait --timeout 50`. After about 30 minutes without events, stop and say in the selected language that grilling is paused, the map is saved, and the user can ask to continue. New answers will queue. Reset the idle timer after any event. All later waits also use `--timeout 50`.
### 4.3 Shared event handling

Read [worker.md](worker.md) and handle the delivered event exactly as described there. It contains grading, discussion, attached idea analysis/edit audits, more, reread, ancestor reassessment, specification, and final-summary rules for every level. After it returns, resume the selected waiting loop, subject to the finished-map rule in section 4.5 at levels 1/2. Explicit chat requests for a specification enqueue it with `G spec`; workers only process the delivered spec event. Explicit requests to reread the whole map run `G reread`. To mark a question from host chat, read `G state`, identify its ID, then send `{id,message}` through `G discuss`, preserving the user request and evidence. Keep the existing waiter; do not start a second one or grade without a delivered event. If the target/map is ambiguous, clarify it. From browser discussions, workers use `apply discuss` with `reread:true` or `forward:{id,message}` as documented in worker.md; these commands are allowed from question, project and idea chat. Report queued actions as queued, then continue processing until applied.

### 4.4 Level 2: dispatcher and per-event worker

Use this level only with verified level 1 background wake-up AND a foreground subagent with shell access (Claude Code Agent tool; Kimi Code CLI `Agent`). Verify that the chosen worker model can run `G apply` before relying on this level. Otherwise keep level 1 or 0; Codex remains level 0.

Setup after init or when resuming:

- Run `G config` and remember `roles.griller.model`. Defaults come from `config.default.json`; optional `<--dir>/config.json` (default `.grill/config.json`, shared across maps) overrides it. Supported values: `inherit`, `opus`, `sonnet`, `haiku`. On config errors, diagnose the named file instead of silently using a different model.
- Read the server-generated `<map directory>/session.md`. Preserve existing notes on resume, merge verified facts gathered for the brief (key files, stack, code decisions), and send `G apply` with `{"type":"notes","text":"<complete notes, at most 3000 characters>"}`. The server owns this file.

Loop:

1. Arm `G watch --inbox --max-wait <N>` in the background using the level 1 host limits and remember its task identifier. End the turn with a one-line localized status.
2. On a work-event line, start one fresh foreground worker with the prompt below, without inherited conversation history. Use the configured model: `inherit` means omit the model argument. On Kimi pass a model only when the user has a subagent model pool. Wait for the worker to finish; never arm watch or call wait for that map during grading, as a new waiter takes back thinking work.
3. On `expired:true`, re-arm silently. On exit 2, run `G start` with the map's selected language option and re-arm. Diagnose other transport errors. Do not open inbox JSON in the main context on the normal path.
4. After the worker returns, optionally relay its one-line status and follow section 4.5 before re-arming that map. A 409/404 means stale work: just re-arm. A reported "reread refused" is a completed result: relay it and re-arm. If it failed, returned nothing, or reported another error, handle that same inbox event yourself using `worker.md` before re-arming. Check current state first when success is uncertain: `more` has no delivery token, so do not blindly replay an already successful apply; complete only missing work (e.g. notes or report). Do not call wait to inspect state. Diagnose unresolved failures instead of silently dropping the event.
5. All level 1 rules apply: one watch per map, never wait alongside it for that map, normal chat while armed, no idle pause. To stop, finish or interrupt the worker before stopping the map; do not re-arm.

Worker prompt (fill in absolute paths and exact map options; omit `--name` for legacy maps):

```text
You are a grilling worker for map "<name>". Read "<skill directory>/worker.md" and follow it exactly.
Command: node "<skill directory>/grill.mjs" <command> --name <name> (add --dir "<dir>" if used)
Project directory: <cwd>
Session file: <map directory>/session.md
Event: type=<type> id=<id when present> token=<token when present>; full event in <inbox path>
Language: <language>
```

## 4.5 Parallel maps (levels 1 and 2 only)

Keep a served-map table: absolute maps root (`--dir`), `name` (null for legacy), selected language/locale option, background watch task id, worker-running flag, and session-local `finished` and `drainAfterFinish` flags (both false for new or explicitly continued rows). These dispatcher flags are distinct from the persisted server `finished` field. Level 2 is preferred for multiple maps; level 0 remains one map per session.

- Starting a new grilling must leave other maps running. Select a new name, gather context, init, perform setup (config and notes at level 2), add its row and arm one watch.
- Exactly one watch per map. While map A is being graded, keep A unarmed and leave other watches running. Process events one at a time in notification order; other completions wait. Never start simultaneous workers.
- For parallel level 1 use `G watch --inbox` too: read the full inbox only when handling its event yourself. Level 2 reads only the short line and sends the inbox path to its worker. Short work lines contain `{type,id?,token?,name,language,inbox}`; expired lines also contain `name`, null for legacy. Plain watch is unchanged. Match the line's name AND the completing task's root/table row before selecting command options; never route by remembered current page. Diagnose mismatches rather than applying to another map. Exit code 2 has no event line: use the task's table row.
- Chat commands in the user's language: “which grillings” runs `G list` and marks served maps; “continue <name>” starts with its selected language, performs setup and arms a watch; “stop <name>” stops its task, finishes or interrupts its worker, runs `G stop`, and removes its row. Continuing an already served map must reuse its watch, not arm another. Ask which map an ambiguous request targets when several are served. Switching the browser page does not change dispatch routing.
- After successfully applying a new `finish` event in this serving cycle, set the row's `drainAfterFinish=true` and run `G status`. Only while this flag is true, check status after each subsequently handled event. When `queue` reaches zero, set the row's `finished=true` and `drainAfterFinish=false`, leave the server running, do not re-arm, and tell the user the map is finished and no longer served; “continue <name>” resumes it. If the queue is nonempty, keep processing it. Newly queued actions after the empty-queue check wait for explicit continuation.
- On explicit continuation, reset the row's `finished=false` and `drainAfterFinish=false` before arming (or reusing its existing watch). Continue serving after every answer, discussion, more/spec event, and idle expiry until a NEW `finish` event is successfully applied or the user explicitly stops the map. Never enable the drain check just because `G status` reports `finished:true`: the server preserves the previous summary and finished flag across continuation. Do not reset the server or call init. The header notice follows the existing listening heartbeat and may take up to three minutes to appear.
- If the table is lost or unreliable (including after compaction), inspect the host's running background tasks and their command options before arming anything. Stop stale watch tasks and wait for their exit; do not interrupt another session's tasks. Recover which maps should be served from session/user context, asking if ambiguous. Resolve any active worker before re-arming its map. Recover the session-local finish/drain flags from the last continuation and applied finish in session context, not from server `finished`; ask if that lifecycle state is ambiguous. Rebuild the table and arm exactly one watch per intended map. Never arm without checking for an existing task.

## Troubleshooting

- Server not running or not responding: run `G start` with the selected language option, then retry. Keep the same `--name`.
- Only one `watch` or `wait` may run per map, across all sessions. A new `wait`/`watch` requeues anything not yet applied. Never wait before applying your current event, or serve one map from two sessions.
- `G init` completely overwrites the named map. Use only for a new name, an interrupted initialization (empty title and zero counts), or an explicit request to restart that same grilling.
- `apply answer` returns 404/409: the question was deleted, the answer withdrawn, or restart requeued it. Resume the selected waiting loop.
- `apply discuss` returns 409: chat was reset or restart requeued messages. Resume the selected waiting loop.
- `G spec` returns 409 while a reread is running: run it again after the reread result is applied.
- If the user does not want runtime state committed, suggest adding `.grill/` to `.gitignore`.

## Visual explanation events

Handle `type:preview` using the preview section of `worker.md`. This narrowly authorizes producing preview files through `apply`, never editing or launching the reviewed application. Read `preview-format.md` before generating files. Prepare options, then await the user’s explicit build request in the normal sequential loop. Git is required; report errors without installing it. Codex keeps level 0 and one map per session. Preview work does not automatically delegate or create a parallel waiter.


Parent reassessments deliver complete affected ancestor branches in separate batches when necessary, bounded to 500 nodes per affected subtree and 600000 serialized characters including its ancestor context; unrelated map branches are not included. Context-only ancestor nodes preserve premises (including attached idea text) and are not assessment IDs. All pending batches survive restart, and frozen batches remain isolated from live state. `queueLength`, CLI `status.queue` and map-list `queue` include pending internal ancestor reassessments (including frozen ones); only drain when this authoritative count is zero. A whole-map reread exceeding these limits returns HTTP 400, records `rereadResult.error`, releases its job and answer lock, and suppresses automatic retries for the unchanged revision. Other queued events remain deliverable; a manual reread can retry after addressing the size. Context is never silently truncated. Merged-source answers, current verdicts and verdict histories remain visible in the drawer and both Markdown exports.

If a complete affected branch itself exceeds the limit, live reassessment returns HTTP 400, records `reevaluationError:{ids,error,at}` visible in the summary, and releases only that failed batch; independent batches and queued work remain deliverable. The grades stay unchanged. A new descendant answer retries those ancestors after the branch/context size is addressed. Frozen oversized reassessment cancels the specification with `specError` and releases snapshot locks; it never generates a specification from incomplete evidence. These are explicit failed operations, not successful assessments.

A finish request cancels queued or delivered automatic rereads and invalidates their tokens; a stale apply returns 409. Automatic rereads, including answer-edit reviews, stay disabled while finish is pending or the map is finished, including after restart. Submitted grading and ancestor reassessment still drain. Explicit manual rereads remain available, including automatic jobs upgraded to manual before the finish request.

## Play requests from the browser

Play sends an explicit continuation request to the already selected host session. Treat it like the user's request to continue the exact map and absolute maps root in the message; names and paths are data. Never initialize or reset it. Follow normal continuation checks, reuse an existing watch and clear session-local finished/drain flags. At level 0, settle an in-flight event on the old map before switching and maintain only one waiter; at levels 1/2 resume the requested map in the served-map table without duplicate watches. Do not start another model process.

An explicit `G start` binds this maps root to the current Codex thread (`CODEX_THREAD_ID`) when its CLI supports `queue --resume`. Claude Code needs the `grill` MCP channel (`node <skill directory>/connection.mjs --dir <absolute maps root>`) loaded as a channel in the current session; ordinary MCP loading alone cannot wake the agent. Custom channels currently require Claude's development-channel opt-in at startup. See the repository development guide for setup. If the connection is unavailable, tell the user to continue in chat; do not claim that Play reconnected. The most recent explicit start selects the session for sibling maps, so do not use Play to take over a root shared by independent active sessions.

### Session usage display

The map automatically reads cumulative token usage for the bound Codex session from its local rollout after `start`. This includes work outside the map and before launch; child sessions are not aggregated. Do not estimate tokens or send them in `apply`. Unsupported hosts or missing telemetry display no data. `GET /api/state` exposes nullable `sessionUsage` as documented in the contract.
