# Contract: CLI, HTTP API, and formats

## Durable user actions

Mutating browser/CLI commands enter `actions` before affecting the map. The server acknowledges only after atomic state-file replacement. Supply `actionId` (1–80 ASCII letters, digits or hyphens) for safe retries; omitted IDs are generated for legacy clients. The same ID and bounded input return the original action, including after completion/restart; different input returns 409. All IDs, original bounded bodies, outcomes, superseded revisions and apply receipts are retained indefinitely. Explicit init remains a destructive map reset.

Admission returns `{ok:true,queued:true,actionId,status,path?}`, not the eventual mutation result. The journal exposes that result after execution. The limit is 20 queued user actions; running work and internal dependencies do not occupy slots (429 at capacity). Admission validates shape/text/image bounds; execution validates current targets, revisions and operation-specific contracts. An accepted action can subsequently fail visibly. HTTP errors never acknowledge acceptance.

`actions` entries contain `id,sequence,route,body,hash,status,at,dependencies` and optional `group,startedAt,completedAt,result,error,supersededBy,retryOf,redirectedTo`. Statuses are `queued,running,done,superseded,cancelled,failed,needs-decision`. `actionTasks` records deliveries and their owning action IDs. `actionReceipts` records completed tokenized results. These internals are omitted from `/api/state`; protected `GET /api/actions` exposes history and tasks. `/api/state.actionQueue` exposes pending/running/problem rows, `waiting` (messages plus waiting internal tasks), `slots` (queued user actions), `internal` and `paused`.

The scheduler runs one adjacent action group and all its generated internal work before starting the next action. Adjacent messages for the same card/conversation share one response; adjacent answer submissions execute only the last version, retaining earlier entries as superseded. Any intervening action breaks the group. Retries form separate groups; resumed discussion stages retain exact message IDs and conversation identity, so they neither absorb new messages nor repeat successful replies. Spec/reread/finish depend on preceding unsettled actions; failed prerequisites cause an explicit failed dependent action. Manual retry creates a new action at the tail from the saved `resume` stage; successful earlier stages are not applied again. Retried group entries point to `retriedBy`, retaining history while hiding resolved problems. Knowledge retries reconcile the failed operation before creating a new one; explicit knowledge-skip queues the finish continuation without reporting a successful knowledge save. Spec/reread capture their input at execution, after predecessors, while new input stays in the journal and cannot invalidate an active delivery.

Protected queue control endpoints:

| Route | Body / result |
|---|---|
| `POST /api/actions/cancel` | `{id}` previews `{ids,confirmation}` for the adjacent group and queued dependents. Resubmit `{id,confirmation}` after user confirmation; recompute and reject changed/started groups with 409. |
| `POST /api/actions/retry` | `{id,actionId?}` for a failed/needs-decision action; returns a new tail action. |
| `POST /api/actions/continue` | Releases the finish boundary after explicit user continuation; rejects an unfinished finish. `start` calls it for a paused map. |
| `GET /api/actions` | Full journal and task history; read-only. |
| `GET /api/archive` | Removed cards, cleared chats, failed-work evidence and inputs for missing targets. |

`apply {type:"failure",token,error}` explicitly fails an unrecoverable delivery and its pending internal work, preserving evidence for manual retry; independent queued actions continue. Validation errors remain correctable with the current delivery. A repeated completed apply token returns its saved result without applying again. Notes and staged discussion do not complete a task. Result, journal completion and receipt are committed in one state replacement. File-producing reducers retain their existing recovery/ownership checks. No guarantee is made against sudden power loss. Restart recovers running reducers but starts no monitor; explicit continuation is required.

A completed finish records `finishBoundary` and sets `actionPaused`. Later actions are still admitted but cannot execute or affect that summary. `queueLength` counts executable work and excludes paused later actions; the UI's queue counter still shows them. Monitor stops at this boundary; summary completion alone never resumes processing. Explicit continuation preserves the previous summary. The queue window also invokes the host-resume flow, since releasing the boundary does not itself re-arm a stopped monitor. CLI `list` and `/api/maps` use the same executable queue count, including queued journal actions and excluding paused later actions.

`archive` retains original records and image references. `replacements` contains only explicit reread merge links; no lexical fallback is permitted. Missing-target actions become `needs-decision`, with their original input archived. Reread events include the archive. Optional `archiveDecisions` (max 100) restores `{id,action:"restore",parentId?}` original question/idea records without overwriting existing IDs, or creates a clarification with `{id,action:"question",question:{q,why,options}}`. Restore parents before children. Entries remain retained with resolution metadata. Retry preserved input after restoring its target.

Read receipts, conversation selection/creation, locale configuration and queue controls are metadata/control operations; ordinary reads/navigation do not wait for the action journal. Legacy saved reducers drain first, then newly admitted journal actions; migration initializes absent journal/archive fields without resetting nodes or saved work.

## Context size diagnostics

Protected `GET /api/state` includes `contextStats:{recent,totals}`. Each `recent` entry is `{type,characters,focus,related,index}`; the last 200 deliveries are retained. `totals[type]` accumulates those four numeric size fields plus `count`, including deliveries that have rolled out of `recent`. Values are JavaScript serialized string lengths (`JSON.stringify(value).length`, UTF-16 code units), not bytes or tokens. `characters` measures the complete event with its shared knowledge and language envelope.

Stage 0 section counters sum serialized values of existing fields (including repeated data), excluding field names and envelope punctuation:

- `focus`: `question`, `why`, `answer`, `previousAnswer`, `pendingAnswer`, `verdict`, `options`, `branch`, `branchSnapshot`, `parent`, `idea`, `message`, `messages`, `history`, `images`, `previews`, `context`.
- `related`: `nodes`, `ideas`, `projectChat`, `sources`, `mainQuestions`, `problems` (legacy bulk context, including any focus cards repeated there).
- `index`: `existingQuestions`.

Absent fields count as zero; empty arrays and nulls count as their serialized values. The Stage 0 categories describe the historical baseline. Current measurements use `context.focus` and `context.related` in their respective groups, and sum `context.index`, `context.relatedIndex` and `context.relatedIds` for index size; legacy scalar and dedicated-event fields retain their categories. Their sum excludes metadata and need not equal `characters`. Measurements occur once per delivery/reservation, including recovery/redelivery; polling state or fetching an already reserved monitor delivery does not add measurements. Timeouts and rejected payload construction do not count. Statistics persist across restart, reset on `init`, and have no write API. The counter itself does not mutate event content.

The agent follows this contract through `skills/grill/SKILL.md`. Keep field and limit changes synchronized with that file, `ui.html` where relevant, and `dev/simulate.mjs`.

## CLI (`node grill.mjs <command>`)

Common options: `--dir <directory>` selects the maps root (default `.grill` under the working directory); `--name <name>` selects `<dir>/<name>/`. Without a name, the legacy map lives directly in `<dir>`. Names match `^[a-z0-9][a-z0-9-]{0,39}$`, excluding Windows reserved `con`, `prn`, `aux`, `nul`, `com0-9`, `lpt0-9`. Invalid names, a missing name value, and `--name=…` exit with code 1. Each map has its own server and port. `list` ignores a valid `--name`; an invalid one is still an error.

The skill creates new maps under `<project>/.grill` unless the user explicitly requests another location. `--dir` replaces that default; it does not select the project cwd or append `.grill`. Thus `--dir <project> --name main` writes `<project>/main/state.json`. Existing maps resumed through Play or copied context retain their supplied root; changing this layout requires a separate migration request. This is agent workflow policy, not a CLI restriction on custom roots.

| Command | Input | Output / behavior |
|---|---|---|
| `start [--port 4777] [--no-open] [--lang en\|ru] [--locale file.json]` | Optional locale file | Starts the server if necessary, applies the language before opening the browser, prints the map URL |
| `init` | JSON on stdin | `{"ok":true,"questions":N}` |
| `wait [--timeout 280]` | — | One event or `{"type":"timeout","waitingAnswers":N,"waitingDiscussions":M}` |
| `watch [--timeout 280] [--max-wait 1800] [--inbox]` | — | Swallows timeouts; prints one event, or a timeout body with `expired:true`; exits 0 |
| `monitor [--status \| --stop \| --event <delivery>]` | Bound `CODEX_THREAD_ID` for arming | Arms a Codex subscription, inspects/stops it, or fetches an exact delivery; returns immediately |
| `apply` | JSON on stdin | `{"ok":true,"added":N}`, `{"ok":true}`, or spec and reread results below |
| `config` | Optional `<--dir>/config.json` | Merged griller model and knowledge threshold, no server required |
| `status` | — | `{name,title,url,counts,queue,finished}` |
| `report` | — | Writes `report.md` in the map directory |
| `node <id> [<id>…] [--token <readToken>]` | Up to 20 IDs | `{nodes:[…]}` full compact context cards |
| `branch <id> [--token <readToken>]` | Card ID | `{nodes:[…]}` target, ancestors and subtree |
| `index [--questions] [--token <readToken>]` | — | Whole-map depth-first index; `--questions` returns only current question IDs and full titles |
| `search <text> [--token <readToken>]` / `search --topic <topic>` | Text or topic | `{matches:[{id,score,index}]}` ranked index lines |
| `related <id> [--token <readToken>]` | Card ID | `{related:[{id,kinds}]}` incoming/outgoing neighbours |
| `state` | — | Full protected `/api/state` JSON for identifying chat-command targets |
| `discuss` | `{id,message}` JSON on stdin | Enqueues a message through `/api/discuss`; uses the same validation as the browser |
| `reread` | — | Enqueues a manual whole-map reread through `/api/reread` |
| `spec` | — | Queues generation; returns an admission receipt; saves after `apply spec` |
| `list` | — | Map array, newest first: `{name,title,counts,queue,finished,updated,url,listening}` |
| `stop` | — | Stops the server, preserving the map |
| `serve [--lang en\|ru] [--locale file.json]` | — | Runs the server in the foreground |

`list` includes the root map and validly named subdirectories with `state.json`. Root `name` is null. `updated` is the state file's mtime in UTC ISO format. `url` is null for stopped servers. `listening` means an armed monitor, a live `wait` or activity within 180 seconds, and is false when stopped.

Exit codes: 0 success; 1 HTTP/input errors (CLI stderr uses `Ошибка <code>: <body>`, meaning Error) or invalid options; 2 server not running/responding, including a stale port belonging to a different `pid`.

`watch` uses the same event delivery and recovery as `wait`; run at most one waiter per map. Its per-request timeout is clamped to 5–290 seconds. Total `--max-wait` is at least 5 seconds (default 1800), with no hard maximum. Both options accept finite positive seconds; invalid values exit 1. On expiry the outstanding request is aborted and the last server timeout body gains `expired:true`. If no timeout has arrived yet, the body is `{type:"timeout",waitingAnswers:0,waitingDiscussions:0,expired:true}` (counts are a fallback, not a fresh state query). A work event already read wins over expiry. An event taken at the cancellation boundary but not printed is recovered by the next waiter. Missing/unreachable servers exit 2, as for `wait`.

## Codex event monitor

The skill defaults to monitor for new and continued Codex maps without repeating wake-up verification. Blocking wait is reserved for an explicit user request, a confirmed standalone (--no-daemon) host, or a diagnosed host/transport failure. This selection policy does not change the transport contract below.

`monitor` arms a process-local subscription owned by the existing map server. It requires a Codex binding created by `start` and an `owner` matching that binding; arbitrary browser thread/message fields cannot choose a wake target or prompt. It uses the same `takeEvent()` and `apply` contracts as `wait`. Every delivered event has a token; the simulator echoes it. Neither another process nor periodic model calls are needed while idle.

Status is `{phase,delivery,error}`: `off`, `armed`, `notifying`, `pending`, `ready`, or `failed`. `ready` means the last event was successfully applied and explicit re-arm is needed; it exposes no old delivery or transport error. Delivery is null until an event is reserved; otherwise it is a fresh UUID distinct from the event's apply token. Only protected `GET /api/monitor?delivery=...` returns the reserved event. It requires the exact ID, a still-current job and unchanged bound session. Completed, invalidated, stopped or pre-restart notifications return 409. Status and event fetches are read-only. CLI mode flags are mutually exclusive; malformed `--event` values exit 1.

Arming rejects live waiters or unfinished manual work with 409. Repeated arm calls for the same active subscription/delivery are idempotent. `wait/watch` and `init` reject while a monitor exists. Plain apply does not re-arm. Monitor-mode final results use `apply --rearm` to commit and arm in one operation, including completed negative outcomes such as knowledge clarification or reread refusal. `notes` and staged results retain the delivery. Browser actions received during grading stay in the durable journal and cannot invalidate the current result. Invalidated legacy work can still recover using a new delivery ID. This recovery never reactivates a stopped monitor. `monitor --stop` invalidates notification IDs without discarding pending work; the next ordinary wait can recover it. Restart disables the subscription and recovers work using the existing persistence rules; explicit continuation is required.

On one event the server sends a fixed `codex queue --thread ... --message ... --resume` request and becomes pending. A transport error or stderr warning sets `failed` with a bounded diagnostic; no automatic resend occurs because the message might already be queued. The event remains available for manual processing. Payload errors also set `failed`, leaving recovery to the existing queue rules. Rebinding a root cannot redirect an old subscription into a different thread. Armed monitors count as listening; pending/failed/off use the existing activity grace period and current-work indicator. Successful queue submission does not itself prove the host resumed.

Codex monitor mode remains one map per session. After a new finish, save report and stop at the finish boundary, leaving late actions paused and the server readable. Explicit continuation of a finished map retains its previous summary and serves events until a new finish. No subscription survives server restart or enables parallel workers.

## Locale

`--lang` selects built-in Russian or English (regional tags such as `en-GB` also work). `--locale` takes precedence and reads UTF-8 JSON:

```json
{"language":"de","messages":{"<Russian source key>":"<translated text>"}}
```

For other languages, supply every key from `skills/grill/locales/en.json`. Keys are exact Russian source phrases; values are their translations. `language` must be a canonicalizable BCP-47 tag. Each value must be nonempty, at most 2000 characters, without `<`, `>`, `&`, ASCII double quotes, or control characters. Use typographic quotation marks. The server keeps only known keys. Russian/English missing entries fall back to their built-in values; other languages require a complete dictionary.

`start` validates the dictionary before starting a server, passes the same selection to a new server, updates a running server through `/api/locale`, and opens the browser only after success. With no locale arguments, preserve the saved language; legacy states default to Russian. `init` preserves it. Invalid dictionaries return 400 through the API and do not change state.

`/api/state` includes `locale:{language,messages}` and `localeRevision`. The page embeds its rendering revision and reloads when polling observes a different one. All delivered non-timeout work events include `language`. The agent uses it for generated map content, replies, summary, and specifications. Server report labels and the specification warning use the same dictionary.

## HTTP API

All `/api/*` require `x-grill: 1` and Host `127.0.0.1` or `localhost`. Context reads are read-only: they do not consume queue work, rotate leases/tokens or refresh listening. Inputs pass bounded validation. Every context read accepts optional `token=<readToken>` (CLI `--token`) to read the captured specification tree; stale tokens return 409. Use the event's `context.readToken` for all captured-event retrieval so live evidence cannot leak into frozen grading.

| Method and path | Caller | Body / response |
|---|---|---|
| `GET /` | Browser | Localized `ui.html` |
| `GET /api/ping` | CLI `alive()`, start/stop/list | `{ok,dir,port,pid}`; compare `pid` with `server.json` |
| `GET /api/maps` | Header switcher | `{maps:[{name,title,counts,queue,finished,updated,url,listening,current}]}`; same discovery and ordering as `list`, with `current` for this server |
| `GET /api/state` | UI polling, CLI status | State without `queue`, internal spec job/owner, internal reread job; includes `name` (null for legacy), queue length, listening, locale, spec progress, `rereadPending:null\|{stage,locked}` and `rereadResult:null\|{at,changed,summary?,error?}` (a new job clears the previous result) |
| `GET /api/node?id=<id>&id=<id>` | CLI node | `{nodes}`; 1–20 full compact cards |
| `GET /api/branch?id=<id>` | CLI branch | `{nodes}` with target, ancestors and subtree |
| `GET /api/index[?questions=1]` | CLI index [--questions] | `{index}` whole-map index, or only current question IDs and full titles |
| `GET /api/search?text=<text>` or `?topic=<topic>` | CLI search | `{matches:[{id,score,index}]}` |
| `GET /api/related?id=<id>` | CLI related | `{related:[{id,kinds}]}` graph neighbours |
| `GET /api/report` | CLI report | Markdown |
| `GET /api/wait?timeout=N` | CLI wait | Event or timeout; 409 while monitor exists |
| `GET /api/monitor[?delivery=<uuid>]` | CLI monitor | Status, or the exact current event; stale delivery returns 409 |
| `POST /api/monitor` | CLI monitor | `{action:arm,owner:<bound thread UUID>}` or `{action:stop}`; returns monitor status |
| `POST /api/locale` | CLI start | `{language,messages?}`; returns `{ok:true,language}`; 400 on invalid locale |
| `POST /api/answer` | UI | `{id,answer,actionId?}`; durable admission including during current work. Replacing an existing answer executes an automatic reread dependency |
| `GET /api/image?file=<name>` | UI | A stored chat image with its type and `nosniff`; 404 for an unknown or malformed name. The UI fetches it with `x-grill` and shows a blob URL |
| `POST /api/discuss` | UI | `{id,message,quote?,about?,images?}`; `about` is option (default) or verdict; `images` is an array of base64 data URLs; 404 missing node (root is allowed), 400 no text/quote/image, 100 messages reached or invalid image, accepted during current work |
| `POST /api/chatreset` | UI | `{id}`; deletes chat and queued event, including root; 404 missing node, accepted during current work |
| `POST /api/cancel` | UI | `{id}` previews the cancellation plan for an unstarted answer group and dependents. Resubmit `{id,confirmation}` to cancel; changed/started plans return 409 |
| `POST /api/question` | UI | `{id,parentId,q}`; persisted custom question preparation, see below |
| `POST /api/more` | Compatibility clients | Enqueues deduplicated legacy more event; current UI uses Reread |
| `POST /api/reread` | UI | Enqueues deduplicated manual reread; 400 on a map with no questions |
| `POST /api/resume` | Play | `{}`; submits a fixed continuation request to the bound session; `{ok:true,queued:true,resumeWarning?:boolean}`. Coalesces requests within ten seconds; 409 during finish or for a missing/unavailable host connection, with a localized recovery message. Does not set listening or reset state. |
| `POST /api/finish` | UI | Enqueues deduplicated finish event |
| `POST /api/spec` | UI, CLI | Queues snapshot capture for execution; returns an admission receipt |
| `POST /api/init` | CLI | **Resets the whole map**; see below |
| `POST /api/apply` | CLI | Applies an agent result |
| `POST /api/stop` | CLI | Exits after 100 ms |

Adjacent queued discussion messages form one processing group. A quote from the context menu or an image can replace an empty `message`; a quote is stored separately with `about`.

Images are identified by file signature (PNG, JPEG, GIF, WebP; the client's declared type is ignored, SVG is rejected) and written to `<map directory>/images/<uuid>.<ext>`. Persisted chat messages keep only these file names in `images`. Context card chats in worker deliveries and context reads expand image names to absolute file paths; discussion event `images` and reread `projectChat` images are also absolute paths. The server deletes files no chat references on startup, chat reset, explicit branch removal and `init`; files referenced by a frozen specification context stay until a later cleanup.

## `init`

```json
{"title":"Up to 40 characters; server truncates at 80","brief":"...","arch":"...",
 "questions":[{"area":"Monetization","q":"...","why":"...","options":["...","..."]}]}
```

The skill uses localized names for Problem, Customer, Market, Monetization, Technology, Data, Security, Team, Legal, Growth, and Risks. The server does not validate areas. The skill requires exactly five initial questions; the server accepts up to eight.

## Events from `wait`

Every work event below also includes `language`.

**Focused events (`answer`, `question`, `discuss`, `idea`)**

```json
{"type":"discuss","id":"n…","token":"delivery token","scope":"question",
 "message":"New user messages joined with a blank line","images":[],
 "context":{"mode":"focused","focus":[],"related":[],"relatedOmitted":[],
 "index":"One line per remaining card","relatedIds":["matching-card-id"],"vocabulary":[["topic",3]]}}
```

`focus` delivers the target, ancestors and subtree for answer and question/idea discussion; custom-question preparation delivers its parent and ancestors; project discussion delivers root chat; idea analysis delivers the idea and its subtree. `related` holds selected distant cards. Root and its chat are excluded from ancestors unless root itself is the target. `related` contains graph neighbours only; lexical hits appear as up to five compact `relatedIndex` rows in answer/question events and as `relatedIds` in discussion/idea events. These IDs identify up to five rows of the inline index in descending lexical relevance order; fully delivered cards are excluded. An empty list means no qualifying matches. No lexical chat is copied into the event. Answer and question set `indexAvailable:true`. Before proposing new questions, use `G index --questions` for all current question IDs and full titles, then read plausible paraphrases with `G node`; the 0.85 guard alone detects only near-verbatim repeats. Captured answer/idea events also carry `context.readToken` for frozen on-demand reads. Discussion and idea include the inline index. Cards omitted from full context remain discoverable by index/ID. `existingQuestions`, discussion `nodes`, `history`, `messages` and duplicated branch snapshots are replaced by this envelope. The canonical discussion history is the focus card's `chat`, including message IDs used by `answers[].messageIds`; `message` remains the new user text and can be empty for image-only submissions.

Full context is a compact evidence projection, not a raw state dump: omit null/empty fields and chat timestamps; answered cards omit `why` and `recommendation`, and retain options only when the answer is not an exact option. Full verdict history is reserved for the focus card and reassessment targets; other cards expose its count. Image paths in context are absolute file paths that the worker opens directly. Quoted messages retain `[Про вариант ответа «…»]` or `[Про вердикт «…»]` independently of page language. No required branch evidence is silently truncated.

The index is depth-first with two-space indentation. Each line identifies ID, status, obsolete/conflict/pending/idea flags, question (140 characters), decision (200 characters) or answer (160 characters), topics and chat count. The 500-node bound fails explicitly rather than dropping lines. Only one-hop semantic neighbours enter full `related` context, within a 20000-character serialized-array budget; omitted graph IDs appear in `relatedOmitted`. Lexical matches remain compact navigation (`relatedIndex` or `relatedIds`), outside that full-card budget. Lexical ranking lowercases Unicode letter/digit tokens of at least three characters, stems to five characters and weights each shared token by `log(1 + N / documentFrequency)`, with minimum total score 2. Search/index entries and semantic summaries guide retrieval; read full candidate cards before reusing evidence or issuing questions.

`reevaluate`, `spec`, `preview` and `finish` retain their dedicated event shapes. Reread modes and knowledge sources are documented below and in [knowledge.md](knowledge.md).

**more**

```json
{"type":"more","mainQuestions":[{"priority":1,"area":"...","q":"...","status":"gap","answer":"..."}]}
```

**finish**

```json
{"type":"finish","token":"delivery token","counts":{"open":0,"ok":0,"weak":0,"gap":0,"verify":0},
 "problems":[{"status":"gap","area":"...","q":"...","answer":"...","verdict":"..."}]}
```

## Semantic navigation and duplicate protection

Cards may store `topics` (up to five lowercased nonempty concepts, 40 characters each), `relates` (up to eight `{id,kind}` links), `decision` (200 characters) and `chatDigest` (300 characters). Text summaries are single-line. Link kinds are `depends|conflicts|same-object|supersedes`; targets must be existing questions or ideas and cannot be the source card (root and previews are rejected). Invalid annotations reject the whole result.

`apply answer`, `apply discuss`, per-entry `answers`, and `apply idea` accept backward-compatible optional `semantics:{topics?,relates?,decision?,chatDigest?}`. Workers must attach semantics to every answer assessment and idea evaluation; the simulator does likewise. Reread accepts `semantics:[{id,topics?,relates?,decision?,chatDigest?}]` for backfilling or updating cards. Changed answers (including reread close/merge and discussion assessment), edited idea text, new user chat and chat resets mark `semanticsStale:true`; supplying valid semantics clears it. Links are stored only on their source, but retrieval finds incoming and outgoing neighbours without writing target cards or changing their branch revisions. Structural deletion prunes links to removed cards. Reread merge redirects incoming links to the kept card and unions outgoing links from the merged cards, removing self-links and duplicate ID/kind pairs. The final graph must still satisfy the eight-link limit (supply replacement `semantics.relates` if a merge would exceed it). Each live/frozen candidate tree is reconciled independently before commit. Incremental reread audit covers fully delivered questions and evidence changes, using `evidenceNode` to exclude semantic fields. Graph-only rewrites and semantic backfills on undelivered cards do not require an audit. `context.vocabulary` lists topic/count pairs in descending frequency, capped at 200; reuse fitting topics.

Semantic annotations are navigation, never user evidence. They cannot supply an answer, specification assertion or knowledge fact. A `conflicts` link does not settle a conflict; that still requires the user's decision on a conflict card. Semantic fields are excluded from specification projections, knowledge snapshot/version inputs, reread evidence digests and both Markdown exports.

Every question addition is checked against other current, non-obsolete questions using the same normalized token sets. Equal normalized text or Jaccard similarity at least 0.85 returns HTTP 400 naming matching IDs. This covers `children`, `newRoot`, discussion `questions`, `branchChanges.add`, reread `add`, and custom-question preparation. Reuse the existing card, or read it and add `allowSimilar:["existing-id"]` on the proposed question to acknowledge deliberate overlap. The entire result is validated before publication; no reply, grade or partial tree is committed on rejection.

## `apply`

```json
{"type":"answer","id":"n…","token":"delivery token","status":"ok|weak|gap|verify","verdict":"...",
 "children":[{"q":"...","why":"...","options":["..."]}],
 "newRoot":{"area":"...","q":"...","why":"...","options":["..."]}}
```

```json
{"type":"discuss","id":"n…","token":"delivery token","reply":"Agent reply"}
```

`apply discuss` requires the current token and a thinking thread; otherwise 409 means reset chat or requeued messages after restart. Return to `wait`. Optional `assessment:{status,verdict,answer}` automatically grades an active question when discussion establishes a user decision or corrects a verdict, without a separate Answer-tab submission. Status must be `ok|weak|gap|verify`; verdict is required (cleaned to 400 characters) and must capture the current decision and remaining risks. If the node has no answer, a nonempty decision summary in answer (cleaned to 2000 characters) is required and saved. Existing answers are preserved; verdict history records corrections. Invalid assessments, root/idea/obsolete targets return 400 atomically. Discussion delivery waits for its target pending answer to be graded or withdrawn; an answer arriving after delivery stays in the journal for later processing. Assessments require the delivery-time branch revision; a mismatch requeues discussion and returns 409 without a reply or grade. Children and pending work on descendants survive. Live ancestor and idea reassessment are queued; existing spec snapshots are never modified. Explanations, unaccepted suggestions and unresolved deliberation use reply-only apply. Explicit user map commands in question, root or idea discussions may include `reread:true` and/or `forward:{id,message}` in the same apply. Forward names another existing question and a nonempty message (cleaned to 2000 characters); it appends the user request to that question chat and queues its normal discussion event, coalescing with an existing queued discussion. Discussion delivery waits for the target pending answer, even if its answer event was queued later. A missing/non-question/self target or empty message returns 400; a thinking target or running reread returns 409; a full target chat (100 entries) returns 400. A nonboolean reread returns 400, as does a requested reread without questions. Validate these before any assessment or reply mutation. The result saves the reply and queues commands together; replaying its completed token returns the saved receipt without duplicating commands. Reread uses the existing manual deduplication and waits for forwarded discussions and other pending work. Target evaluation uses a fresh delivery with its full branch context; it preserves existing answers and spec snapshots. `G state` lets the worker resolve IDs without taking events. Workers clarify ambiguous targets and report queued work honestly. Omit assessment when the focus card has pending answer input; the queued submission is graded separately.

```json
{"type":"more","questions":[{"area":"...","q":"...","why":"...","options":["..."]}]}
```

```json
{"type":"finish","token":"delivery token","summary":"Verdict: ...\n\nRisks:\n1. ...\n\nChecks for the week:\n1. ..."}
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
| Semantic topics / links | 5 topics × 40 characters / 8 outgoing links | Existing question/idea targets; no self links |
| Semantic decision / chat digest | 200 / 300 characters | Single-line navigation only |
| On-demand node read | 20 IDs | Explicit validation, no queue mutation |
| Related lexical cards | Top 5, 20000 characters | Graph neighbours first; omitted IDs named |
| Graded subtree | 500 nodes, 600000 serialized characters | Full snapshot, no truncation |
| `branchChanges.remove/move/add` | 500 / 500 / 20 | Explicit semantic changes |
| `verdict` | 400 | 220 |
| `notes` | 3000 | Complete replacement, at most 3000 |
| `summary` | 8000 | — |
| User answer | 3000 | — |
| Discussion message / reply | 2000; up to 100 per thread | Reply up to 1200 |
| Discussion quote | 400 | — |
| Discussion images | 4 per message, 8 MB each | — |
| `children` | 4 | ok 0–1, weak/verify 1–3, gap 1–2 newly needed questions; 0 if retained questions suffice; level ≥ 4 at most 1 |
| `more.questions` | 5 | 3 |
| Reread `summary` / `error` | 1000 / 1000 | — |
| Reread `close`, `move`, `remove` / `merge` / `add` | 500 each / 100 / 3 including `conflictOf` | Only as the rules require |
| Reread `merge[].ids`, `add[].conflictOf` | 20 each | — |
| `init.questions` | 8 | First 5 identified questions |
| `reserve` candidates / candidate ID | 100 / 80 characters | Concrete remaining candidates |
| Parent reassessment verdict / verdict history | 400 characters / 1000 entries | Evidence-based conclusion; preserve answers |
| Request body | 1 MB; `/api/discuss` about 44 MB for its images | — |
| Locale value | 2000, validated plain text | Complete translation dictionary for other languages |

Agent replies retain `from:"claude"` in persisted chat for compatibility, including Codex replies. The UI uses a localized provider-neutral Agent label.

## Specification generation

`wait` delivers `{type:"spec",language,token,path,requestedAt,title,brief,arch,nodes}`. Question nodes omit discussions, options, and pending answer text; idea nodes retain captured chat. Regrading nodes have `awaiting:true`, `answer:null`, `verdict:null`, `status:"open"`. New specifications capture the tree when their action starts, after earlier commands and internal work complete. Later answers remain in the journal and do not change that snapshot. Recovered legacy spec jobs can still contain captured pending answers; those grades supplement only their saved snapshot. Active work cannot be withdrawn.

Return `{type:"spec",token,markdown}` or `{type:"spec",token,error}`. Trimmed Markdown must have 1–100000 characters; empty/oversized content returns 400. `error` is cleaned to 1000 characters. Invalid token or non-thinking job returns 409. `apply` returns `{ok,path,error?}`; write/generation errors set `ok:false`, persist the error, and permit another request. HTTP 200 means the result was processed, not necessarily saved.

`/api/state` exposes `specFile`, `specUpdatedAt` (last successful write), `specError`, and `specPending:null|{stage:"queued"|"thinking",waiting:N}`. It does not expose the snapshot or token. `init` cancels the job but preserves file ownership and last-write metadata. An earlier finish pauses later spec actions until explicit continuation.

Files live at `docs/vgril/specs/grill-<name>.md` or `grill-legacy.md` relative to the server's working directory; `--dir` only changes map storage. The server checks the first-line ownership marker, forbids directory/file symlinks, creates missing directories, and replaces the file through a temporary file. API-supplied destination paths are not accepted. Rebuilding replaces manual edits; unrelated documents are protected.

The request and snapshot persist on disk. Restart and abandoned waits recover delivery with a new token; captured pending grades go first. Repeating a completed token returns its saved receipt.

## Reread

A finish request waits for preceding user actions and their internal dependencies. Once it executes, it uses the settled map for knowledge and summary. Automatic rereads stay disabled while finish is pending or the map remains finished. Later manual requests remain saved behind the finish boundary until explicit continuation.

`POST /api/reread` creates a persisted job, and editing an existing answer creates an automatic one. Requests join a single job; a manual request upgrades an automatic job. `wait` delivers `{type:"reread",token,language,title,brief,arch,reserve,coverage,context,ideas,projectChat}` only when no answer is pending, no discussion is queued or thinking, no custom question is waiting and no specification job exists.

`context.mode` is `full` for the first successful review baseline and all manual requests; later automatic edit/issuance reviews use `incremental`. Full mode supplies every question in `context.focus`. Incremental mode supplies questions with changed or missing evidence digests in `focus`, their one-hop graph-neighbour questions in `related`, and remaining questions in `index`. The context also carries `relatedOmitted:[]` and `vocabulary`; ideas are delivered separately in full. Root `projectChat` is complete in full mode and starts after the saved last-seen message ID in incremental mode (falls back to full chat if that cursor is missing). Chat entries omit timestamps. Read additional plausible topic/link matches with `G node` before acting; a summary or link is never sufficient evidence.

After every successful apply, `rereadSeen` stores per-card digests excluding semantic annotations and `rereadChatCursor` stores the final root message ID. Refusals do not advance them. Reports and Markdown export retain `mergedFrom`. Each delivery rotates the token; restart or a new `wait` returns an unapplied job to `queued`.

`rereadPending.locked` is false for browser admission. Reducer locks remain internal to the serialized active job. New answers, questions, discussion, resets and specs are always queued, subject to validation and the 20-action limit. Only unstarted user actions can be cancelled.

```json
{"type":"reread","token":"...","summary":"...","brief":"...",
 "audit":[{"id":"open-id","action":"close","reason":"Answered elsewhere"},{"id":"answered-id","action":"keep","reason":"Current decision"}],
 "close":[{"id":"open-id","source":"answered-id","verdict":"..."}],
 "merge":[{"ids":["keep-id","other-id"],"keep":"keep-id","answer":"...","status":"ok","verdict":"..."}],
 "add":[{"key":"$new","parentId":"root","area":"...","q":"...","why":"...","options":["...","..."],"conflictOf":["id-a","id-b"]}],
 "move":[{"id":"kept-id","parentId":"$new"}],"remove":["obsolete-id"],"order":["main-id","$new"]}
```

Every successful result requires `audit:[{id,action,reason,sources?}]`. Full mode requires exactly one entry for every question. Incremental mode requires every question in `context.focus` and `context.related`, plus every existing question whose evidence the result changes (including indirect parent/area/order changes, merges and removals). Semantic-only updates and automatic link cleanup on undelivered questions do not expand the audit. Other questions default to keep; explicit audits for additional fetched questions are allowed. Root, duplicate entries and unknown IDs are invalid. Actions are `keep|close|merge|remove|obsolete|restore`; the first three mutation actions must match `close`, `merge` and `remove`. Reasons are bounded to 400 characters and must be nonempty. `keep` can accompany `move` and retains any existing obsolete marker. Replacing an unanswered question uses `remove` plus `add` with a fresh ID. The server verifies coverage and consistency, not whether the semantic conclusion is correct.

`obsolete` and `restore` act directly through audit entries. Both require 1–20 unique `sources` IDs of existing nodes (including root) with an answer or user discussion. `obsolete` saves `{reason,sources:[{id,q}]}` on the node, preserving its text, answer, grade, chat and children; `restore` requires an existing marker and removes only that marker. Source titles are snapshots, so historical evidence remains identifiable after merges. Conflict cards cannot be obsoleted or restored through this mechanism. Obsolete cards cannot be closed/merged or used as the source of `close`. They remain in exports and are hidden on the map by default. The independent Obsolete toggle adds all historical cards regardless of the selected status; they never contribute to active counts/finish problems or the next open question. They may remain visible as ancestors of active descendants. `POST /api/answer` returns 409 for obsolete cards; discussions remain available. Answer and discussion ancestor projections, the discussion target, custom-question context, `more.mainQuestions`, and specification snapshots carry the marker; the duplicate guard excludes obsolete questions. The worker excludes historical decisions from active requirements and blockers.

`rereadResult.audit` saves `{id,action,reason}` for each reviewed card, including no-op runs; Summary displays the reasons. An audit alone does not count as a changed map or replace the pre-reread copy. Refusals with `error` may omit audit. Old clients without audit receive 400 with the job still open; update the worker/simulator and restart the server together.

All tree operations are optional. `{type:"reread",token,error}` refuses the run: the map stays unchanged, the lock is released and `rereadResult.error` is set, and apply returns `{ok:false,error}`. Otherwise apply returns `{ok:true,changed,closed,merged,added,moved,removed}`.

The operation-shape example above requires audit entries for all required question IDs under the selected mode, not just the two illustrated entries.

The server builds the candidate on a clone, so any 400 leaves the map and job unchanged. It enforces:

- `close`: the target has no answer and no `conflictOf`; the source is another question with an answer; a verdict is required. The server copies the source answer and sets `ok`. The link is only the verdict text.
- `merge`: at least two answered questions, a combined answer, a valid status and a verdict. Originals go to `keep.mergedFrom:[{id,q,answer,status,verdict,conflictOf?,conflictAnswers?}]`, chats join by time (more than 100 messages returns 400), children move to `keep`, and a `keep` below a merged card moves to the parent of its highest merged ancestor, with the cards between them becoming its children. Cards on record as disagreeing cannot be merged.
- `remove`: only a question with no answer, chat, `mergedFrom` or `conflictOf`. Children must be moved or removed too.
- `add`: unique `$key`, at least two options, at most 3 per run including `conflictOf`. `conflictOf` names at least two answered questions that remain distinct after this run's merges; the same cards with the same answers (stored as `conflictAnswers`, a map of card ID to answer that follows merges) cannot get a second card, including one recorded in `mergedFrom`; an edited answer may raise a new one. Merged IDs in `conflictOf` follow `keep`, and `keep.conflictOf` is the union of the merged cards' sets.
- `move`: no cycles or missing parents. Children take their main question's area.
- `order`: when present, it must list every final main question.
- Each existing card takes part in at most one closing, merge or removal. Every previous answer must remain as a card's answer or in `mergedFrom`.

A changed map first writes one copy, without the running job, to `<map directory>/state.before-reread.json`, replacing the last. Chat images are not copied. A brief change regenerates `session.md`. A map changed since delivery requeues the job and returns 409; an invalid token returns 409. `init` cancels the job and clears the result.

## Worker transport and context

`watch --inbox` atomically replaces `<map directory>/inbox.json` with the full delivered event before printing one compact line: `{"type":"answer","id":"n…","token":"delivery token","name":"arch","language":"en","inbox":"<absolute path>"}`. Only events with an id include `id`; answer, discuss, question, idea, reevaluate, reread and spec include `token`. More omits both; finish and knowledge carry their delivery token without a card ID. No full event is printed in this mode. In inbox mode, expired timeout lines also include `name`; it is null for a legacy map. Exit codes and plain watch output are unchanged; timeouts do not write the inbox. Without `--inbox`, watch does not write it. The next work event overwrites it; only one waiter/worker may serve a map.

`apply {"type":"notes","text":"..."}` replaces `S.notes` using `clean(text,3000)` and returns `{"ok":true}`. Empty text clears notes. No queued event is needed or consumed; thinking work and the queue stay unchanged. `/api/state` includes notes, but the UI does not render them. `init` resets notes.

The server atomically regenerates `<map directory>/session.md` on startup, init, notes updates, language updates and a changing reread. It contains:

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

`config` merges installed `skills/grill/config.default.json` then optional `<--dir>/config.json` (default `.grill/config.json`, shared across named maps). Output is `{"roles":{"griller":{"model":"inherit"}},"knowledge":{"rereadThreshold":5}}` by default. `knowledge.rereadThreshold` is an integer from 1 to 500 and controls changed answered cards needed for extraction after reread. Supported models: `inherit`, `opus`, `sonnet`, `haiku`. Missing fields inherit defaults; unknown keys are dropped. Invalid models, malformed structures, unreadable files or invalid JSON exit 1 with a Russian diagnostic naming the file. A model must be defined after merging; otherwise the command exits 1 and names both configuration paths. Only an absent project file is optional. Starting a stopped map validates configuration in the foreground before spawning the server; invalid configuration reports its exact path and cause, without a generic startup timeout. Model choice is consumed by dispatch; the server reads the knowledge threshold from the same merged configuration.

`GET /api/maps` is read-only and uses no request parameters for paths. It discovers only the root map and valid named directories within the server's `--dir`, probes with `alive()` (1.5-second timeout) and `/api/state`, and never starts or stops a server. Stopped maps have `url:null,listening:false`. The protected endpoint adds `current` without changing CLI list output.

On restart, saved custom-language dictionaries retain their existing translations and use English for newly missing UI phrases. Explicit locale files and API locale updates still require complete dictionaries. An explicit startup language/locale replaces the saved locale before its validation. Locale checks cover older dictionaries and replacement on restart.

## Recommendations, custom questions, and branch changes

Question objects on init, more, children, newRoot, custom question preparation and keyed additions accept optional `recommendation:null|{option,reason}`. Both strings are cleaned (120/260 characters); an exact match to an existing cleaned option and a nonempty reason are required, otherwise 400 with no partial tree write. Missing fields in legacy maps mean no recommendation. State returns the data; the UI highlights only that option, shows the reason and leaves selection/submission manual.

`POST /api/question {id,parentId,q}` requires a client request ID matching `^[a-zA-Z0-9-]{1,80}$`, a valid root/question parent, and nonempty text (220 characters). Admission returns the journal receipt. `actionId` identifies the command; `id` identifies the question preparation. Same preparation ID and identical content are idempotent when executed; conflicting reuse is 409. One request per parent, 20 per map. The pending array `questionRequests:[{id,parentId,q,stage,at,...}]` persists in state. No card exists until apply. The event is `{type:question,id,token,language,parentId,question,context}` with focused parent/ancestor context. Return `{type:question,id,token,question:{why,area,options,recommendation?}}`. At least two nonempty options are required. The server keeps the exact request text, sets `createdBy:user,requestId`, assigns `max(prio)+1` to main questions and inherits area for children. Missing/deleted parent or changed branch invalidates the result (409); unfinished delivery returns to queued on a new wait/restart. Parents with pending custom requests cannot be deleted by branch changes.

Answer events add `token`, focused `context` (complete affected subtree and ancestors), `capturedForSpec`, `protectedIds`, and `questionRequests` for pending custom children. Each delivery rotates the token. Apply requires the current token and unchanged branch revision, including ancestors, pending answers, discussions and custom requests. Stale branch content requeues the answer and returns 409; stale tokens cannot affect the newer delivery. Subtrees exceeding 500 nodes or 600000 serialized characters return 400 rather than a truncated grading context.

`apply answer` preserves descendants by default. `children` adds up to four children; `newRoot` adds a main question as before. Optional `branchChanges` contains:

```json
{"remove":["obsolete-id"],"move":[{"id":"kept-id","parentId":"$new"}],
 "add":[{"key":"$new","parentId":"graded-id","q":"New question","options":["A","B"]}]}
```

Keys match `^\$[a-zA-Z0-9-]{1,40}$` and are unique; additions/moves may reference forward keys. Every existing ID and target parent must belong to the graded subtree; the graded node itself cannot move or be removed. Removals are explicit node IDs, not an implicit subtree cascade: move or remove remaining children of a removed parent. A card with `conflictOf` cannot be removed. Cycles, missing parents, duplicate moves/removals, invalid recommendations and outside IDs reject the entire transaction. Existing question text/meaning cannot be rewritten through move: add a new open question instead. Moves retain IDs, answers, verdicts, chat and queued work; removals discard only deleted nodes’ events. Children retain the main branch area. No automatic/manual author distinction governs preservation.

The same structural transaction updates frozen `specJob.gradingNodes` and the document projection for captured grading. Unchanged captured grades and structure are preserved; later answers/chat/new cards are not copied from live nodes. `protectedIds` marks live nodes changed since capture: they cannot be removed. Captured payloads use frozen grading context; agents must not use later activity or discussions for specification decisions. Explicitly removed waiting IDs leave `waiting`; retained pending grades stay queued. The candidate live tree and frozen tree must both validate before state changes.

Root discussion uses the existing discuss/chatreset/apply routes with `id:root`. Its event has `scope:project`, project title as `question`, `priority:null`, `level:0`; root remains outside grading and counts. All discussion apply results now require the current delivery `token`. Explain-option sends a normal quoted discussion message; pure explanations leave answers and structure unchanged, while substantive new questions follow the discussion transaction contract. UI busy/error handling keeps unsent text and quote; HTTP 409 is never shown as success.

UI filter focus picks a matching question or idea with smallest X, then Y after layout; context ancestors are excluded. Centering uses the canvas left of the open drawer and does not open it or change zoom. Double-click isolation retains exactly the target and ancestors; an eye button restores the saved status filter. Explicit new filter choice exits isolation. Header, root menu and summary use the same whole-map Reread action; there is no competing add-three UI.

Page rendering also embeds `PAGE_DOUBLE_CLICK_MS` independently of persisted map state. It follows the local desktop preference plus a 100 ms guard so a slow recognized double click cannot run the single-click action first. Detection uses optional built-in desktop utilities, times out after three seconds, and falls back to 5000 ms. `GRILL_DOUBLE_CLICK_MS` can explicitly supply a positive interval up to 10000 ms on other desktops. Reload to reread preferences. No additional package is required.

GNOME timing detection runs only when `XDG_CURRENT_DESKTOP` explicitly identifies GNOME; other Linux desktops use the conservative fallback or explicit override. Pending single-card navigation is cancelled by a newer panel action, clicks outside map cards, or Escape. Unchanged card DOM is retained during polling so the browser can complete its native double-click gesture.

## Attached ideas

`kind:"idea"` nodes are root children: `{id,parentId:"root",kind:"idea",text,q,area,revision,status,verdict,chat,requestId,analysis?,reviewedAt?}`. `text` is full user content (1–3000 trimmed characters; oversized input is rejected), `q` its 220-character display/context prefix, `revision` starts at 1 and increases on text edits. Grades use `open|ok|weak|gap|verify`; Russian labels for open/ok are feminine. `analysis:null|{stage,reason,...}` is processing state, not a sixth grade. Legacy question/root data remains valid. Init resets ideas with the rest of the tree. State adds computed `deleteBlocked` to ideas; it is not persisted. Server question counters exclude ideas but include their active question descendants; UI status-filter counters additionally count matching ideas.

Protected POST routes:

| Route | Body | Behavior |
|---|---|---|
| `/api/idea` | `{id,text}` | Admit attachment and initial analysis; request ID is 1–80 Latin letters/digits/hyphens. Returns a journal receipt; executed result contains `{ok,id}`. Reusing the preparation ID with different text fails the action |
| `/api/idea/analyze` | `{id}` | Deduplicated analysis; blocked by a locked reread |
| `/api/idea/edit` | `{id,text,revision}` | Queue an edit, including during analysis/spec work; stale revision fails at execution; identical text is a no-op |
| `/api/idea/delete` | `{id,confirm:true}` | Queue deletion of the idea and all descendants/chats; missing confirmation returns 400; execution preserves the removed branch in the archive |

Creation, editing and deletion are admitted during reread and other work. Their reducers execute only after earlier actions and dependencies settle. Edits retain history and increment revision at execution; they do not invalidate earlier specs or active answers. Deletion archives the entire removed branch and retains referenced image/preview files. Operation-specific revision conflicts become visible action errors.

`wait` delivers `{type:"idea",id,token,language,capturedForSpec,reason,title,brief,arch,context}`. It supplies the full idea subtree, selected related cards and an index of remaining cards, with explicit context limits rather than truncation. `reason` is manual, answers, edit, reread, or snapshot. Live analysis waits for submitted answers, discussion and question preparation to settle; a whole-map content revision protects its result. Restart/new wait rotates unacknowledged deliveries.

Apply `{type:"idea",id,token,capturedForSpec,status,verdict,children?,audit?}`. Echo `capturedForSpec` exactly. A valid grade and nonempty verdict (400 characters) are mandatory. Up to four children use the ordinary question format, with at least two options; they attach under this idea. `audit:[{id,action,reason}]` must cover every descendant question exactly once when supplied, and is mandatory for edit events. Actions: keep, obsolete, restore, remove; reasons have 1–400 characters. Obsolete preserves content and cites the idea; restore requires an obsolete marker. Removal requires no answer/chat/merged history and no surviving orphan; conflict questions allow only keep. No automatic question moves or merges. An ok idea may not retain active open/gap/pending questions. Invalid transactions return 400 without partial mutation; stale token/context returns 409, with changed live context requeued. No percentages determine a grade.

After descendant answer grading or custom question creation, the server queues live idea reassessment. A changed reread queues reassessment only of ideas with analysisStarted or reviewedAt, leaving only legacy never-analyzed attachments idle; new attachments already queue initial analysis. Reread events carry an additional `ideas` array for context; their audit covers question cards in the selected reread mode, never idea cards. Finish carries `ideas` separately; more.mainQuestions excludes idea nodes. Discussion scope can be `idea`, with full text in `question`; discussion does not grade or start analysis.

Specs capture `ideaWaiting`, `ideaReasons`, and optional `ideaWork` as internal state. Captured answer grading precedes frozen idea evaluations; these use the same event/apply format with `capturedForSpec:true` and update only the frozen tree. Live evaluation remains separately queued. Spec delivery excludes the complete subtree of every non-ok idea, while keeping unrelated questions and risks under included ok ideas. Idea snapshots retain text/verdict and captured idea chat; ordinary question discussions remain omitted from the document projection. No later live evaluation can mutate a delivered snapshot. A later text edit waits until this request and its dependencies finish. `specPending.waiting` counts pending captured answers plus ideas.

UI status filters match both questions and ideas, including zero-result filters. Nonmatching ancestors are retained only as context and do not increase match counts; previews are context only. An empty result shows root alone. Hidden selection closes its panel with drafts preserved. Isolation remains a separate view mode. Drafts survive closing the drawer within a tab. Full reports/Markdown exports include every idea's complete text, grade, verdict, history and branch, independent of spec filtering. Editing/deletion have distinct menu entries; deletion has a separate whole-branch confirmation and explains work locks.

Answer/discussion ancestor context includes `kind:"idea",text` for idea ancestors, preserving the complete premise beyond the 220-character `q` prefix. Workers must read full `text` when present.

## Preview events and API

The [preview contract](preview.md#protocol) defines `type:preview` prepare/build deliveries, apply fields and protected `/api/preview/*` routes. The global body limit remains 1 MB. Manifests are at most 32 files / 700000 UTF-8 bytes, each string 250000 characters. Save is at most 65536 UTF-8 bytes. Preview cards are not questions. Answer payloads add `previews:[{id,commit,state}]`; specifications carry immutable preview purpose, commit and local snapshot links. `init` and agent removals require a recorded preview deletion policy when they remove a source.

## Reserve, coverage and ancestor reassessment

`init` accepts optional `reserve`: at most 100 concrete candidates shaped `{id,parentId,q,why,area,options,recommendation?}`. The skill displays the first five identified questions and saves the rest here. State stores `reserve:null` for unassessed legacy maps and an array for assessed maps, including empty. Candidates use normal question text/option limits, stable unique IDs (up to 80 characters) and current non-obsolete root/question/idea parents. Candidate options may be deferred until issuance, when the normal new-question requirements apply. `/api/state` computes `coverage:{shown,reserve,percent,stale}`: shown counts non-obsolete question cards including closed questions and follow-ups; reserve and percent are null before assessment. Percent is rounded `100 * shown / (shown + reserve)` or null with no displayed questions or a stale reserve assessment. `stale` indicates that current map evidence differs from the persisted `reserveRevision`; read receipts do not invalidate it. Reread reassesses the reserve against current evidence and refreshes that revision. Ideas, root, previews and filter state never affect this formula.

Reread events additionally deliver `reserve` and `coverage`. Successful apply may replace the complete reserve; omission preserves compatibility with older workers. Reread additions accept `reserveId` to identify a consumed delivered candidate. Candidate removal, new cards, reserve replacement and coverage commit atomically. All reread additions, including conflicts, are limited to three in total. The worker reviews reserve candidates against all current evidence and removes resolved, duplicate or obsolete candidates before issuance. A zero-add result is valid. With no active open questions, automatic reread waits for map-changing work to settle; weak/gap/verify do not block it. Finish stops automatic issuance, and unchanged empty reserve does not generate a loop.

A new `reevaluate` event delivers `{type,token,language,capturedForSpec,ids,nodes,title,brief,arch}` for answered question ancestors after descendant grading. Apply `{type:"reevaluate",token,capturedForSpec,assessments:[{id,status,verdict}]}` must assess exactly the supplied IDs. Status is `ok|weak|gap|verify`, verdict is 1–400 characters. Assess ancestors nearest-first using substantive branch evidence. Original user answers are immutable in this transaction. Complete grade history, including the current verdict, persists as `verdictHistory:[{status,verdict,at}]`, including report and browser Markdown export; more than 1000 history entries is refused rather than silently dropping history. Token/context validation rejects stale work. Frozen evaluations update only captured specification context; live work cannot silently enter the snapshot. Idea ancestors retain the existing separate idea evaluation path.

## Discussion read state and answer composition

Chat messages have stable `id` values and server-persisted `readAt` acknowledgements. Protected `POST /api/discuss/read {id,messageId}` acknowledges the exact agent message the client saw. A newer reply remains unread. The browser acknowledges only when that card's discussion is open and the tab is active; persisted state is shared by all browsers. Message badges count user plus agent messages, independently of unread highlighting.

Multi-select options and the comment are composed into the existing bounded answer string; the API shape and total answer limit do not change. I do not know is exclusive with ordinary choices, while comments persist. Contradictory ordinary choices remain available for agent clarification. Question explanation is a separate discussion request and never sends the existing draft or grades an answer. Copy actions target individual question, answer, verdict and chat blocks.


Parent reassessments deliver sparse affected ancestor branches in separate batches. The full cards, including context ancestors, are bounded to 500 nodes and 600000 characters; unrelated map branches are not included. Context-only ancestor nodes preserve premises (including attached idea text) and are not assessment IDs. All pending batches survive restart, and frozen batches remain isolated from live state. `queueLength`, CLI `status.queue` and map-list `queue` include pending internal ancestor reassessments (including frozen ones); only drain when this authoritative count is zero. Focused discussion/idea delivery validates the required focus and selected related evidence against these bounds, without counting unrelated indexed histories. Idea apply validates its resulting focused context. Incremental reread validates delivered questions, related questions, ideas and new project chat; full reread retains the whole-map bound. A reread exceeding these limits returns HTTP 400, records `rereadResult.error`, releases its job and answer lock, and suppresses automatic retries for the unchanged revision. Other queued events remain deliverable; a manual reread can retry after addressing the size. Context is never silently truncated. Merged-source answers, current verdicts and verdict histories remain visible in the drawer and both Markdown exports.

If required full branch evidence exceeds the limit, journal-owned reassessment fails its action and releases independent work. Legacy live reassessment returns HTTP 400, records `reevaluationError:{ids,error,at}` visible in the summary, and releases only that failed batch; independent batches and queued work remain deliverable. The grades stay unchanged. A new descendant answer retries those ancestors after the branch/context size is addressed. Frozen oversized reassessment cancels the specification with `specError` and releases snapshot locks; it never generates a specification from incomplete evidence. These are explicit failed operations, not successful assessments.

## Project knowledge

See [knowledge.md](knowledge.md) for the shared index, editable record schema, provenance, content-version checks, recovery guarantees, knowledge/finish lifecycle, explicit history import and generated-spec migration. Keep `knowledge.mjs`, `knowledge.md`, worker instructions, UI/locales and `dev/check-knowledge.mjs` synchronized. Run the knowledge check along with existing queue, spec, worker and map checks.

## Discussion questions and shared answers

Discussion delivery uses the focused context envelope above. The focus card's chat carries user message IDs; no separate whole-map nodes, messages or history copies are sent. Full context is bounded with explicit rejection, never silent truncation. `message`, `images`, `scope` and the delivery token remain available. A whole-map content revision now protects every discussion result, including reply-only results.

`apply discuss` additionally accepts:

```json
{"type":"discuss","id":"root","token":"...","reply":"Remaining questions are linked below.",
 "questions":[{"key":"$new","parentId":"existing-id","q":"How is recovery tested?","options":["Automated","Manual"]}],
 "links":["existing-id","$new"],
 "answers":[{"id":"existing-id","messageIds":["source-user-message-id"],"status":"verify","verdict":"The decision still needs testing."}]}
```

`questions` uses the usual question fields with a unique `$key` (1–40 Latin letters/digits/hyphens). Parents may be any existing current root/question/idea or a new key, including forward references. Missing parents, obsolete parents, invalid types and cycles reject the transaction. Main questions receive consecutive priorities; descendants inherit their main branch area. There is no discussion issuance quota; operation lists have a safety limit of 500 entries. The shared similarity guard rejects matching current questions atomically; after reading a match, a worker may explicitly acknowledge its ID in that question's `allowSimilar`. Semantic judgment and parent choice remain worker responsibilities.

`links` is a unique list of question IDs/keys, required for each new question. Stored assistant messages carry resolved `links:[{id,q}]` with the actual question text, not agent HTML. The UI escapes labels and navigates via temporary isolation, restoring the prior filter through the eye button. Deleted targets display a localized error. This also allows opening cards hidden by status or history settings without changing those settings.

`answers` targets unique current questions and copies the exact text of existing user messages from the source thread (joined by two newlines, up to 2000 characters). Each requires its own valid grade and nonempty verdict (400 characters). Pending answers or other pending discussions reject the entire result with 409. New questions can be targets. Root/idea/obsolete targets are rejected. A target cannot also receive legacy `assessment` in the same result. `answerSource:{id,q,messageIds,at}` records provenance; replaced answers enter `answerHistory:[{answer,status,verdict,source,at}]`, while `verdictHistory` retains assessments. Subsequent direct answer edits archive the previous answer and clear current discussion provenance. Reread merges retain provenance on the original entries in `mergedFrom` and clear it from synthesized combined text. Parent and idea reassessments are queued normally. No late discussion data is copied into `specJob`.

Validation completes before publishing any cards, answers or assistant reply. Stale map revisions requeue the discussion and invalidate staged parts; stale tokens return 409; completed tokens return saved receipts. Restart and a new wait rotate the token and discard staging on redelivery. Existing forward/reread commands and current-question assessment are still supported and validated before commit.

Large results may be sent as `part:0,more:true`, `part:1,more:true`, …, then a final part with `more:false`. Intermediate parts contain only questions/links/answers. Reply and legacy fields belong in the final part. Parts persist on the source node as internal staging, excluded from context revisions and specification projections. Identical intermediate retries return the same next part number. Intermediate acknowledgement is `{ok:true,staged:true,nextPart,committed:false}`; it is not a saved map result. Final apply combines parts and validates everything atomically. Limits are 500 parts / 600000 aggregate serialized characters, 500 per operation list, 2000 reply characters, existing per-question field limits, and the unchanged 1000000-character HTTP body limit. Oversize text/results fail explicitly; questions are never sliced to a quota. Failure leaves the map unchanged and must not be reported as success.

`/api/state.mapKey` is a SHA-256 identity of the absolute map directory (case-folded on Windows), independent of server port and distinct across projects with equal map names. The browser stores the Obsolete toggle under `grill:obsolete:<mapKey>` in localStorage, default false. Storage unavailability falls back to false. The status selection is unchanged by toggling. Rendering first selects current status matches plus historical cards when enabled, then adds ancestor chains as dim context. With no status filter, historical cards remain hidden unless needed as ancestors. Status counts and next-open navigation continue to exclude them. Show all fits the current visible tree without resetting filters/isolation.

An oversized focused discussion context returns HTTP 400, records `node.discussError`, and releases only that failed delivery so unrelated queued work can continue. The UI shows the error; all user messages remain saved. After addressing the context limit, send another message to retry the thread (all messages since the last agent reply are delivered together). Resetting the chat clears the error. This is a failed discussion, never a successful partial result.

Replacing an existing answer with different discussion text also queues an automatic reread, as a direct Answer-tab edit does, so decisions in other branches can be reconsidered. The replacement is already graded, so this reread is settled (not cancelable as a withdrawn pending answer). Identical text does not trigger an edit reread; finish-pending/finished maps retain the existing automatic-reread suppression.

`GET /api/state` also returns `currentWork:null|{type}` for the latest unfinished delivery on this map. Types: `answer`, `discuss`, `reread`, `reevaluate`, `question`, `idea`, `preview`, `spec`, `knowledge`, `more`, `finish`. It exposes no delivery credentials. Queued/blocked work is not active work. Staged discussion parts and notes keep the current task; completion or invalidation clears it. A new wait recovers unfinished work before redelivery. This field has no heartbeat timeout and is independent of `listening`; server restart clears it until another delivery. All delivered events, including `more`, require the returned token on apply.

## Release tooltip

The brand's release tooltip uses the map locale's `Версия` label (`Version` in English), followed by the installed numeric release. Release numbers are not dictionary keys and do not change the API or map state revision.

## Session token usage

The header shows whole-session Codex token usage, not usage attributable to one map. Hover over the single-line counter (or focus it with the keyboard) for a floating tooltip with cumulative input, uncached input, cached input, output and reasoning tokens. Leaving the counter, blurring it or pressing Escape hides the tooltip without changing header layout. Input counts repeated context on every request; it is not the current context size. Uncached input equals input minus cached input. Cached input is a subset of input; reasoning is a subset of output, so neither is added again to the total. Counts refresh with polling even when map state is unchanged. Missing data (including unsupported providers) and an offline map show no data, never an invented zero.

`GET /api/state` adds `sessionUsage: null | {provider:"codex",scope:"session",input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens}`. This is read-only telemetry, not persisted map state. Optional `last_input_tokens` drives rollover hints; aggregate snapshots/deltas are stored in context metrics. The existing maps-root session binding selects the session, so sibling maps show the same total. Explicit start rebinds the session. A resumed session includes its earlier work; child-agent sessions are not aggregated.

`usage.mjs` prefers the sum of `token_usage_record.payload.usage`, deduplicated by `response_id` for the bound thread, and falls back to the latest valid `event_msg/token_count` aggregate from that exact UUID's rollout under `<Codex home>/sessions/YYYY/MM/DD`. Start records the resolved `CODEX_HOME` (default `~/.codex`) in the private connection binding for server restarts. Older bindings use the server environment/default. Only numeric counters reach the browser, never transcript content, session paths or credentials. Reads are asynchronous, coalesced and cached for one second. Usage records are scanned incrementally from the start in 4 MiB chunks; the fallback aggregate uses the final 4 MiB; file discovery retries at most every ten seconds and does not traverse symlink directories. If no complete supported aggregate occurs in that window, data is unavailable. The rollout schema is internal and may change; this adapter deliberately fails closed instead of estimating. No App Server connection or additional model process is started. Claude Code usage is not yet supported.

## Resume clipboard context

Protected `GET /api/state` includes read-only `resume:{project,dir,name,state,session,skill,cli,language,shell,start}`. Paths are absolute and supplied by the serving process; `dir` is the maps root, `name` is null for legacy maps. `start` changes to the project directory and runs the exact CLI with the same root/name, using PowerShell on Windows or POSIX sh elsewhere with literal argument quoting. It preserves the saved locale and does not initialize state. No session credentials or host binding IDs are copied. This metadata does not change init, events, apply, or persisted state.

The header copy button appears on title/name hover or keyboard focus, and stays visible on touch devices. It copies localized continuation instructions plus JSON metadata and title. Copying has no server side effects. The instructions require reading the supplied skill/session context, preserving state, checking for another event consumer, and continuing the skill event loop after start. Clipboard failures offer a manual-copy dialog.


## Session cost contract

- `apply --rearm` sends `rearm:true,owner:<bound Codex thread>` to `/api/apply`. An existing subscription owned by that thread is required before mutation. Completed results (including knowledge clarification and deliberate reread refusal with `ok:false`) commit and arm atomically; the response includes `monitor` with the arm status. 400 does not arm; stale 409 returns `monitor` and retains/arms replacement work. Staged discussion parts do not arm. Notes do not finish a delivery. Finish with zero authoritative queued work returns `monitor:{phase:"stopped",drained:true}`; otherwise it arms. Restart clears subscriptions; re-arm explicitly to recover a new delivery before retrying. Other modes are unchanged.
- Answers deliver `ancestorIds` (answered current ancestor questions), `context.ancestorIndex` (direct children outside focus), and `context.questionTitles` (current question titles excluding full delivered cards). Question events also include titles. `ancestors:[{id,status,verdict}]` grades only listed ancestors atomically through verdict history; empty means checked, unchanged. Unknown/duplicate IDs and invalid grades reject the entire result. Inline answer results also check the highest answered ancestor branch revision, including sibling evidence. If only that revision changed, the card grade and branch changes commit normally, inline ancestor grades are discarded, and a separate ancestor review is queued (also for `ancestors:[]`). Invalid ancestor fields still reject atomically. A changed card/subtree or its directly included ancestors still returns 409 under the existing card branch check. Omitted ancestors or `reviewAncestors:true` retains separate review; combining both is invalid. Discussion `answers` entries support the same fields. Workers omit `ancestors` on captured answers; for compatibility the server still validates but ignores any supplied inline grades and keeps separate live/frozen reviews. Within legacy reducers, pending answers settle before separate reviews. Journal actions complete their internal reviews before the next user action.
- Separate reevaluation excludes root. Targets retain only three recent verdicts plus `verdictHistoryCount`; changed descendants carry full cards, with chat only if user chat changed. Other descendants appear in `index`. Without a prior verdict timestamp all descendants are conservatively full. Higher ancestors carry question/answer/status and full idea text only. The 500-node/600000-character failure limits apply to full cards, including higher ancestor context. Frozen events provide `readToken`; read endpoints accept it while `reviewWork` is current.
- `wait`, `watch`, `monitor --event` write events larger than 20000 serialized characters to the map's `inbox.json` and print `{type,id?,token?,name,language,characters,inbox,sections:[{key,characters}]}`. Arrays use one entry per line. `watch --inbox` always uses this output; `--inline` forces inline JSON. HTTP event responses remain full JSON.
- Existing knowledge files accept `{path,expected,body,meta?,sourcesAdd?}` instead of `text`. Body replaces prose after the metadata block, which body-only edits preserve byte for byte. Meta shallow-merges status/supersedes/conflicts only. New `{card,version}` sources receive current-map path/session/snapshots. Version, source, size and transactional write checks remain mandatory.
- `contextStats.recent` records CLI `requests` between delivery and next arm/wait (including fetch/read/apply/arm; browser polling and ping excluded via `x-grill-cli:1`). Per-type `totals.requests` aggregates these counts. Available telemetry adds `usageStart`, `usageEnd`, and nonnegative `usage` differences for input/cached/output, aggregated in totals. These are observational whole-session differences, not exact model-call or per-map attribution; rebinding suppresses cross-session deltas.
- Config `session.rolloverTokens` is a positive safe integer, default 120000. `/api/state.sessionHint` is null or `rollover`; events above threshold carry `sessionHint:"rollover"`. History size uses the last request input from usage records/last_token_usage, or consecutive cumulative input differences. Unsupported telemetry shows no hint. The UI places a localized hint near continuation controls; the agent applies current work and durable notes before suggesting a new session, never migrating automatically.
- Deliveries omit `answer` only when own-thread `answerSource.messageIds` are all delivered user messages and their joined text exactly equals the saved answer; `answerFromChat:true` marks this. Persisted answers, exports and source snapshots are unchanged.

### Project chat conversations

`POST /api/conversations` with `{}` creates and persists a conversation, returning `{id}` (maximum 100 including implicit `main`, otherwise 400). State exposes `projectConversations:[{id}]`; absence means `[{id:"main"}]`. Both `/api/discuss` and `/api/chatreset` accept optional `conversationId` for root, defaulting to `main`, with unknown IDs returning 404. Reset removes only that conversation’s messages. The 100-message send limit applies per conversation. Messages and resets for another conversation are accepted into the journal and execute in FIFO order; different conversations never share a group. Question/idea chats are unchanged. Root messages and replies carry `conversationId`; legacy untagged messages belong to `main`. Discussion delivery includes `conversationId` and only its history in root focus, while apply uses the existing root ID/token. Conversation creation does not enqueue work or invalidate a delivered reply. Reread retains all conversations.
