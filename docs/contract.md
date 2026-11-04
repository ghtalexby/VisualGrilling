# Contract: CLI, HTTP API, and formats

The agent follows this contract through `skills/grill/SKILL.md`. Keep field and limit changes synchronized with that file, `ui.html` where relevant, and `dev/simulate.mjs`.

## CLI (`node grill.mjs <command>`)

Common options: `--dir <directory>` selects the maps root (default `.grill` under the working directory); `--name <name>` selects `<dir>/<name>/`. Without a name, the legacy map lives directly in `<dir>`. Names match `^[a-z0-9][a-z0-9-]{0,39}$`, excluding Windows reserved `con`, `prn`, `aux`, `nul`, `com0-9`, `lpt0-9`. Invalid names, a missing name value, and `--name=…` exit with code 1. Each map has its own server and port. `list` ignores a valid `--name`; an invalid one is still an error.

| Command | Input | Output / behavior |
|---|---|---|
| `start [--port 4777] [--no-open] [--lang en\|ru] [--locale file.json]` | Optional locale file | Starts the server if necessary, applies the language before opening the browser, prints the map URL |
| `init` | JSON on stdin | `{"ok":true,"questions":N}` |
| `wait [--timeout 280]` | — | One event or `{"type":"timeout","waitingAnswers":N,"waitingDiscussions":M}` |
| `watch [--timeout 280] [--max-wait 1800] [--inbox]` | — | Swallows timeouts; prints one event, or a timeout body with `expired:true`; exits 0 |
| `apply` | JSON on stdin | `{"ok":true,"added":N}`, `{"ok":true}`, or spec result below |
| `config` | Optional `<--dir>/config.json` | Merged griller model, no server required |
| `status` | — | `{name,title,url,counts,queue,finished}` |
| `report` | — | Writes `report.md` in the map directory |
| `spec` | — | Enqueues generation; returns `{ok,path}`; saves after `apply spec` |
| `list` | — | Map array, newest first: `{name,title,counts,queue,finished,updated,url,listening}` |
| `stop` | — | Stops the server, preserving the map |
| `serve [--lang en\|ru] [--locale file.json]` | — | Runs the server in the foreground |

`list` includes the root map and validly named subdirectories with `state.json`. Root `name` is null. `updated` is the state file's mtime in UTC ISO format. `url` is null for stopped servers. `listening` means a live `wait` or activity within 180 seconds, and is false when stopped.

Exit codes: 0 success; 1 HTTP/input errors (CLI stderr uses `Ошибка <code>: <body>`, meaning Error) or invalid options; 2 server not running/responding, including a stale port belonging to a different `pid`.

`watch` uses the same event delivery and recovery as `wait`; run at most one waiter per map. Its per-request timeout is clamped to 5–290 seconds. Total `--max-wait` is at least 5 seconds (default 1800), with no hard maximum. Both options accept finite positive seconds; invalid values exit 1. On expiry the outstanding request is aborted and the last server timeout body gains `expired:true`. If no timeout has arrived yet, the body is `{type:"timeout",waitingAnswers:0,waitingDiscussions:0,expired:true}` (counts are a fallback, not a fresh state query). A work event already read wins over expiry. An event taken at the cancellation boundary but not printed is recovered by the next waiter. Missing/unreachable servers exit 2, as for `wait`.

## Locale

`--lang` selects built-in Russian or English (regional tags such as `en-GB` also work). `--locale` takes precedence and reads UTF-8 JSON:

```json
{"language":"de","messages":{"<Russian source key>":"<translated text>"}}
```

For other languages, supply every key from `skills/grill/locales/en.json`. Keys are exact Russian source phrases; values are their translations. `language` must be a canonicalizable BCP-47 tag. Each value must be nonempty, at most 2000 characters, without `<`, `>`, `&`, ASCII double quotes, or control characters. Use typographic quotation marks. The server keeps only known keys. Russian/English missing entries fall back to their built-in values; other languages require a complete dictionary.

`start` validates the dictionary before starting a server, passes the same selection to a new server, updates a running server through `/api/locale`, and opens the browser only after success. With no locale arguments, preserve the saved language; legacy states default to Russian. `init` preserves it. Invalid dictionaries return 400 through the API and do not change state.

`/api/state` includes `locale:{language,messages}` and `localeRevision`. The page embeds its rendering revision and reloads when polling observes a different one. All delivered non-timeout work events include `language`. The agent uses it for generated map content, replies, summary, and specifications. Server report labels and the specification warning use the same dictionary.

## HTTP API

All `/api/*` require `x-grill: 1` and Host `127.0.0.1` or `localhost`.

| Method and path | Caller | Body / response |
|---|---|---|
| `GET /` | Browser | Localized `ui.html` |
| `GET /api/ping` | CLI `alive()`, start/stop/list | `{ok,dir,port,pid}`; compare `pid` with `server.json` |
| `GET /api/maps` | Header switcher | `{maps:[{name,title,counts,queue,finished,updated,url,listening,current}]}`; same discovery and ordering as `list`, with `current` for this server |
| `GET /api/state` | UI polling, CLI status | State without `queue`, internal spec job/owner; includes `name` (null for legacy), queue length, listening, locale, and spec progress |
| `GET /api/report` | CLI report | Markdown |
| `GET /api/wait?timeout=N` | CLI wait | Event or timeout |
| `POST /api/locale` | CLI start | `{language,messages?}`; returns `{ok:true,language}`; 400 on invalid locale |
| `POST /api/answer` | UI | `{id,answer}`; 404 missing question, 400 empty, 409 thinking or spec-locked |
| `POST /api/discuss` | UI | `{id,message,quote?,about?}`; `about` is option (default) or verdict; 404 missing node (root is allowed), 400 no text/quote or 100 messages reached, 409 thinking |
| `POST /api/chatreset` | UI | `{id}`; deletes chat and queued event, including root; 404 missing node, 409 thinking |
| `POST /api/cancel` | UI | `{id}`; withdraws a queued answer; 409 if spec-locked |
| `POST /api/question` | UI | `{id,parentId,q}`; persisted custom question preparation, see below |
| `POST /api/more` | UI | Enqueues deduplicated more event |
| `POST /api/finish` | UI | Enqueues deduplicated finish event |
| `POST /api/spec` | UI, CLI | Captures map snapshot; deduplicates; returns `{ok,path}` |
| `POST /api/init` | CLI | **Resets the whole map**; see below |
| `POST /api/apply` | CLI | Applies an agent result |
| `POST /api/stop` | CLI | Exits after 100 ms |

Queued discussion messages append without a second event. A quote from the context menu can replace an empty `message`; it is stored separately with `about`.

## `init`

```json
{"title":"Up to 40 characters; server truncates at 80","brief":"...","arch":"...",
 "questions":[{"area":"Monetization","q":"...","why":"...","options":["...","..."]}]}
```

The skill uses localized names for Problem, Customer, Market, Monetization, Technology, Data, Security, Team, Legal, Growth, and Risks. The server does not validate areas. The skill requires exactly five initial questions; the server accepts up to eight.

## Events from `wait`

Every work event below also includes `language`.

**answer**

```json
{"type":"answer","id":"n…","token":"delivery token","question":"...","why":"...","area":"...","level":1,"priority":2,
 "answer":"Current answer","previousAnswer":"Previous answer or null",
 "branch":[{"q":"...","answer":"...","status":"weak"}],
 "existingQuestions":["All questions on the map"]}
```

`level` is depth (main question = 1). `branch` lists ancestors from the main question to the parent.

**discuss**

```json
{"type":"discuss","id":"n…","token":"delivery token","scope":"question","question":"...","why":"...","area":"...","level":1,"priority":2,
 "status":"weak","answer":"Current answer or null","verdict":"... or null","pendingAnswer":"Queued answer or null",
 "branch":[{"q":"...","answer":"...","status":"weak"}],
 "message":"New user messages joined with a blank line",
 "history":[{"from":"user|claude","text":"...","quote":"Only when present","about":"option|verdict"}]}
```

`history` precedes the new messages. Quoted messages retain the exact protocol prefix `[Про вариант ответа «…»]` (about an answer option) or `[Про вердикт «…»]` (about a verdict), independent of page language. Discussion changes neither status nor tree.

**more**

```json
{"type":"more","mainQuestions":[{"priority":1,"area":"...","q":"...","status":"gap","answer":"..."}]}
```

**finish**

```json
{"type":"finish","counts":{"open":0,"ok":0,"weak":0,"gap":0,"verify":0},
 "problems":[{"status":"gap","area":"...","q":"...","answer":"...","verdict":"..."}]}
```

## `apply`

```json
{"type":"answer","id":"n…","token":"delivery token","status":"ok|weak|gap|verify","verdict":"...",
 "children":[{"q":"...","why":"...","options":["..."]}],
 "newRoot":{"area":"...","q":"...","why":"...","options":["..."]}}
```

```json
{"type":"discuss","id":"n…","token":"delivery token","reply":"Agent reply"}
```

`apply discuss` requires a thinking thread; otherwise 409 means reset chat or requeued messages after restart. Return to `wait`.

```json
{"type":"more","questions":[{"area":"...","q":"...","why":"...","options":["..."]}]}
```

```json
{"type":"finish","summary":"Verdict: ...\n\nRisks:\n1. ...\n\nChecks for the week:\n1. ..."}
```

`apply answer` requires a thinking answer taken by `wait`; otherwise 409 means withdrawn or requeued. A 404 means the question was deleted with a subtree. In either case, return to `wait`.

## Limits

The server truncates through `clean(s,max)`; the skill uses stricter limits.

| Field | Server | SKILL.md |
|---|---|---|
| `title` | 80 | 40 |
| `brief`, `arch` | 6000 | Brief: 3–6 sentences |
| `q` | 220 | 140 for main questions |
| `why` | 260 | 160 |
| `area` | 30 | Localized category list |
| `options` | 4 × 120 | 2–4 |
| `recommendation.option`, `recommendation.reason` | 120, 260; exact option and nonempty reason | Optional, evidence-based |
| `question` request ID / text | 80 Latin letters, digits, hyphens / 220 | Keep user text |
| Pending custom questions | 20 total, 1 per parent | — |
| Graded subtree | 500 nodes, 600000 serialized characters | Full snapshot, no truncation |
| `branchChanges.remove/move/add` | 500 / 500 / 20 | Explicit semantic changes |
| `verdict` | 400 | 220 |
| `notes` | 3000 | Complete replacement, at most 3000 |
| `summary` | 8000 | — |
| User answer | 3000 | — |
| Discussion message / reply | 2000; up to 100 per thread | Reply up to 1200 |
| Discussion quote | 400 | — |
| `children` | 4 | ok 0–1, weak/verify 1–3, gap 1–2 newly needed questions; 0 if retained questions suffice; level ≥ 4 at most 1 |
| `more.questions` | 5 | 3 |
| `init.questions` | 8 | 5 |
| Request body | 1 MB | — |
| Locale value | 2000, validated plain text | Complete translation dictionary for other languages |

Agent replies retain `from:"claude"` in persisted chat for compatibility, including Codex replies. The UI uses a localized provider-neutral Agent label.

## Specification generation

`wait` delivers `{type:"spec",language,token,path,requestedAt,title,brief,arch,nodes}`. Nodes omit discussions, options, and pending answer text. Regrading nodes have `awaiting:true`, `answer:null`, `verdict:null`, `status:"open"`. The request-time snapshot is supplemented by grades of already submitted answers, including explicit branch changes and new questions. Those answers cannot be replaced or withdrawn before grading (`/api/answer` and `/api/cancel` return 409). Other answers do not change the snapshot.

Return `{type:"spec",token,markdown}` or `{type:"spec",token,error}`. Trimmed Markdown must have 1–100000 characters; empty/oversized content returns 400. `error` is cleaned to 1000 characters. Invalid token or non-thinking job returns 409. `apply` returns `{ok,path,error?}`; write/generation errors set `ok:false`, persist the error, and permit another request. HTTP 200 means the result was processed, not necessarily saved.

`/api/state` exposes `specFile`, `specUpdatedAt` (last successful write), `specError`, and `specPending:null|{stage:"queued"|"thinking",waiting:N}`. It does not expose the snapshot or token. `init` cancels the job but preserves file ownership and last-write metadata. `finish` does not prevent generation.

Files live at `docs/specs/grill-<name>.md` or `grill-legacy.md` relative to the server's working directory; `--dir` only changes map storage. The server checks the first-line ownership marker, forbids directory/file symlinks, creates missing directories, and replaces the file through a temporary file. API-supplied destination paths are not accepted. Rebuilding replaces manual edits; unrelated documents are protected.

The request and snapshot persist on disk. Restart and abandoned waits recover delivery with a new token; captured pending grades go first. Repeating an applied token returns 409.

## Worker transport and context

`watch --inbox` atomically replaces `<map directory>/inbox.json` with the full delivered event before printing one compact line: `{"type":"answer","id":"n…","token":"delivery token","name":"arch","language":"en","inbox":"<absolute path>"}`. Only events with an id include `id`; answer, discuss, question and spec include `token`. More/finish omit both. No full event is printed in this mode. In inbox mode, expired timeout lines also include `name`; it is null for a legacy map. Exit codes and plain watch output are unchanged; timeouts do not write the inbox. Without `--inbox`, watch does not write it. The next work event overwrites it; only one waiter/worker may serve a map.

`apply {"type":"notes","text":"..."}` replaces `S.notes` using `clean(text,3000)` and returns `{"ok":true}`. Empty text clears notes. No queued event is needed or consumed; thinking work and the queue stay unchanged. `/api/state` includes notes, but the UI does not render them. `init` resets notes.

The server atomically regenerates `<map directory>/session.md` on startup, init, notes updates and language updates. It contains:

```markdown
<!-- Generated by grill.mjs. Do not edit: changes are overwritten. -->
# <title, or localized "Project" before init>
Language: <language>
## Brief
<brief>
## Architecture
<arch>
## Agent notes
<notes or "—">
```

`config` merges installed `skills/grill/config.default.json` then optional `<--dir>/config.json` (default `.grill/config.json`, shared across named maps). Output is `{"roles":{"griller":{"model":"inherit"}}}` by default. Supported models: `inherit`, `opus`, `sonnet`, `haiku`. Missing fields inherit defaults; unknown keys are dropped. Invalid models, malformed structures, unreadable files or invalid JSON exit 1 with a Russian diagnostic naming the file. A model must be defined after merging; otherwise the command exits 1 and names both configuration paths. Only an absent project file is optional. The server does not read model config.

`GET /api/maps` is read-only and uses no request parameters for paths. It discovers only the root map and valid named directories within the server's `--dir`, probes with `alive()` (1.5-second timeout) and `/api/state`, and never starts or stops a server. Stopped maps have `url:null,listening:false`. The protected endpoint adds `current` without changing CLI list output.

On restart, saved custom-language dictionaries retain their existing translations and use English for newly missing UI phrases. Explicit locale files and API locale updates still require complete dictionaries. An explicit startup language/locale replaces the saved locale before its validation. Locale checks cover older dictionaries and replacement on restart.

## Recommendations, custom questions, and branch changes

Question objects on init, more, children, newRoot, custom question preparation and keyed additions accept optional `recommendation:null|{option,reason}`. Both strings are cleaned (120/260 characters); an exact match to an existing cleaned option and a nonempty reason are required, otherwise 400 with no partial tree write. Missing fields in legacy maps mean no recommendation. State returns the data; the UI highlights only that option, shows the reason and leaves selection/submission manual.

`POST /api/question {id,parentId,q}` requires a client request ID matching `^[a-zA-Z0-9-]{1,80}$`, a valid root/question parent, and nonempty text (220 characters). Returns `{ok:true,id}`. Same ID and identical content are idempotent while pending and after completion; conflicting reuse is 409. One request per parent, 20 per map. The pending array `questionRequests:[{id,parentId,q,stage,at,...}]` persists in state. No card exists until apply. The event is `{type:question,id,token,language,parentId,question,parent,branch,existingQuestions}`. Return `{type:question,id,token,question:{why,area,options,recommendation?}}`. At least two nonempty options are required. The server keeps the exact request text, sets `createdBy:user,requestId`, assigns `max(prio)+1` to main questions and inherits area for children. Missing/deleted parent or changed branch invalidates the result (409); unfinished delivery returns to queued on a new wait/restart. Parents with pending custom requests cannot be deleted by branch changes.

Answer events add `token`, `branchSnapshot` (complete affected subtree), `capturedForSpec`, `protectedIds`, and `questionRequests` for pending custom children. Each delivery rotates the token. Apply requires the current token and unchanged branch revision, including ancestors, pending answers, discussions and custom requests. Stale branch content requeues the answer and returns 409; stale tokens cannot affect the newer delivery. Subtrees exceeding 500 nodes or 600000 serialized characters return 400 rather than a truncated grading context.

`apply answer` preserves descendants by default. `children` adds up to four children; `newRoot` adds a main question as before. Optional `branchChanges` contains:

```json
{"remove":["obsolete-id"],"move":[{"id":"kept-id","parentId":"$new"}],
 "add":[{"key":"$new","parentId":"graded-id","q":"New question","options":["A","B"]}]}
```

Keys match `^\$[a-zA-Z0-9-]{1,40}$` and are unique; additions/moves may reference forward keys. Every existing ID and target parent must belong to the graded subtree; the graded node itself cannot move or be removed. Removals are explicit node IDs, not an implicit subtree cascade: move or remove remaining children of a removed parent. Cycles, missing parents, duplicate moves/removals, invalid recommendations and outside IDs reject the entire transaction. Existing question text/meaning cannot be rewritten through move: add a new open question instead. Moves retain IDs, answers, verdicts, chat and queued work; removals discard only deleted nodes’ events. Children retain the main branch area. No automatic/manual author distinction governs preservation.

The same structural transaction updates frozen `specJob.gradingNodes` and the document projection for captured grading. Unchanged captured grades and structure are preserved; later answers/chat/new cards are not copied from live nodes. `protectedIds` marks live nodes changed since capture: they cannot be removed. Captured payloads use frozen grading context; agents must not use later activity or discussions for specification decisions. Explicitly removed waiting IDs leave `waiting`; retained pending grades stay queued. The candidate live tree and frozen tree must both validate before state changes.

Root discussion uses the existing discuss/chatreset/apply routes with `id:root`. Its event has `scope:project`, project title as `question`, `priority:null`, `level:0`; root remains outside grading and counts. All discussion apply results now require the current delivery `token`. Explain-option sends a normal quoted discussion message and cannot change answers or structure. UI busy/error handling keeps unsent text and quote; HTTP 409 is never shown as success.

UI filter focus picks a matching question with smallest X, then Y after layout; context ancestors are excluded. Centering uses the canvas left of the open drawer and does not open it or change zoom. Double-click isolation retains exactly the target and ancestors; an eye button restores the saved status filter. Explicit new filter choice exits isolation. Both header and summary add-three buttons share `/api/more` and `morePending`.

Page rendering also embeds `PAGE_DOUBLE_CLICK_MS` independently of persisted map state. It follows the local desktop preference plus a 100 ms guard so a slow recognized double click cannot run the single-click action first. Detection uses optional built-in desktop utilities, times out after three seconds, and falls back to 5000 ms. `GRILL_DOUBLE_CLICK_MS` can explicitly supply a positive interval up to 10000 ms on other desktops. Reload to reread preferences. No additional package is required.

GNOME timing detection runs only when `XDG_CURRENT_DESKTOP` explicitly identifies GNOME; other Linux desktops use the conservative fallback or explicit override. Pending single-card navigation is cancelled by a newer panel action, clicks outside map cards, or Escape. Unchanged card DOM is retained during polling so the browser can complete its native double-click gesture.
