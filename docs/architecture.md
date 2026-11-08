# Architecture

## Specification from answers

This flow is independent of `finish`: UI/CLI `spec` → persisted `specJob` snapshot → grading captured pending answers → `wait` delivers `spec` → agent writes a plan → `apply spec` saves Markdown. The snapshot excludes question discussions and later answers; idea chat is captured as context. Captured pending answers cannot be replaced or withdrawn before grading; their `apply` updates the snapshot, including explicit branch operations. Restart recovers the request; redelivery changes its token.

`specOwner` is a stable document-owner UUID; `specFile` is the path in `docs/specs`; `specUpdatedAt` records the last successful write; `specError` stores the latest error. `specJob` contains `stage, token, requestedAt, title, brief, arch, nodes, gradingNodes, waiting`. The UI receives only the stage and pending-grade count. Saving a specification does not change grades, summary, or completion. The writer checks ownership and regular directories/files, then replaces its file with a temporary-file rename. The server's working directory defines the project root independently of `--dir`.

## Components

```text
Browser (ui.html)                  grill.mjs serve                   Codex / Claude Code
poll GET /api/state  <---1.2s---    S in memory <-> state.json
POST /api/answer ----------------> S.queue -> pump() --------------> grill.mjs wait/watch
POST /api/discuss|more|finish|spec                                  grades answers, checks code
                                  apply() updates tree <---------- grill.mjs apply
```

`grill.mjs` has two roles:

- **`serve`**: an HTTP server (`http.createServer`) that holds `S` in memory and saves every change. Normally started by `start` as a detached child process.
- **CLI client**: `start`, `init`, `wait`, `watch`, `apply`, `spec`, `status`, `report`, `stop`, `list`, `config`. It locates the server using the map's `server.json`.

Paths resolve from the current working directory (`--dir` defaults to `.grill`), so run commands from the project being grilled.

## Per-map language

`S.locale` stores a canonical language tag and a complete dictionary. `start --lang en|ru` or `start --locale <file.json>` validates and applies it before opening the browser. A new `serve` gets the same arguments; a running server receives the protected `/api/locale` request. With no language arguments, existing locale data is preserved; legacy maps default to Russian. `init` preserves locale data.

`i18n.mjs` renders the trusted `ui.html` template on each page request, replacing Cyrillic source phrases using the dictionary. Inside script strings, replacement text is encoded as Unicode escapes to preserve JavaScript string boundaries. Dictionaries accept only bounded plain text and reject markup delimiters, double quotes, ampersands, and control characters because phrases also appear inside generated HTML attributes. User project content is never translated by this renderer; it still goes through `esc()`.

The initial page includes its locale revision. `/api/state` supplies `localeRevision`; an already open page reloads when the locale changes. The document `lang` and text direction follow the chosen language. Every delivered work event includes `language`, so the agent writes content in the same language. Server errors, report labels, and the specification warning use the dictionary. Existing stored questions and chat are not automatically rewritten when resuming in another language.

## Multiple maps

A map is a directory containing `state.json`. A named map (`--name arch`) uses `.grill/arch/`; an unnamed legacy map uses `.grill/`. Each has its own `serve` process and port (`start` tries 4777 and then the next available port). `SKILL.md` requires names for new maps. Levels 1/2 can serve multiple maps in one session; level 0 (including Codex) keeps a separate session per map. The dispatcher tracks each map and its watch task, routes by the short line's name and task root, and handles events sequentially with one foreground worker at a time. Other maps' watches stay armed during grading. Finished maps are unwatched after their queue drains, leaving their servers readable. Explicit continuation clears the dispatcher row's finished/drain flags and keeps it serving until the next applied finish. The persisted server `finished` flag and summary are retained and must not trigger dispatcher drain checks on their own.

A stale `server.json` may point to another map's port. `alive()` checks the `/api/ping` `pid` against the saved `pid`; this also works through `subst` or junction paths. Older servers without `pid` are checked by `dir`, case-insensitively on Windows. `api()` calls `alive()` before requests to avoid taking another map's events.

`list` and `GET /api/maps` share `listMaps()`: disk state provides metadata, and live server probes provide `url` and `listening`. The API adds `current`. The header switcher shows completion and activity separately (for example, Finished · Listening), fetches this list only when opened, links running maps in the same tab and shows a continuation hint for stopped maps. A finished, non-listening map shows a header notice; listening retains its three-minute activity grace period.

## State files

Files live in `.grill/` or `.grill/<name>/`:

| File | Contents |
|---|---|
| `state.json` | Complete map state; atomic temporary-file rename; `version++` on each save |
| `server.json` | `{port, pid, url}`; removed by `stop`, SIGINT, or SIGTERM |
| `state.before-reread.json` | Copy of the map from before the last changing reread; replaced by the next one |
| `session.md` | Server-generated title, language, brief, architecture and agent notes; atomic replacement |
| `inbox.json` | Full last event from `watch --inbox`; atomic replacement |
| `images/` | Images pasted into discussions; files without a chat reference are deleted |
| `report.md` | Report written by `grill.mjs report` |

## State model

```js
S = {
  version, title, brief, arch, notes, locale, reserve, reserveRevision, autoRereadRevision, reevaluation,
  nodes: [{ id: "root", parentId: null, kind: "root" }, /* questions */],
  queue: [/* answer, discuss, question, idea, more, reread, finish, spec events; reevaluation is separate state */],
  questionRequests: [/* persisted custom question preparation */],
  summary, finished, morePending, finishPending,
  specOwner, specFile, specUpdatedAt, specError, specJob,
  rereadJob, rereadResult
}
```

A question (`kind: "q"`):

```js
{ id: "n…", parentId: "root" /* or a question id */, kind: "q",
  status: "open|ok|weak|gap|verify", q, why, area, options: [/* up to 4 */],
  recommendation: null /* or {option, reason}, exact existing option */,
  prio,      // main questions only, 1..N
  addedFrom, // source question text for a main question added through newRoot
  pending: { answer, stage: "queued|thinking", at } /* or null */,
  answer, verdict, verdictHistory,
  chat: [{ from: "user|claude", text, quote, about, images, at }],
  discuss: "queued|thinking" /* or null */,
  conflictOf: [/* optional: cards whose answers disagree */],
  mergedFrom: [/* optional: original answers joined into this card */]
}
```

- The tree is flat, linked by `parentId`. Children inherit the parent's `area`.
- New main questions get `max(prio)+1`, through `more` or `newRoot`.
- `/api/state` omits `queue`, exposing `queueLength` and `listening` instead.

## Answer lifecycle

1. `POST /api/answer {id, answer}` sets `node.pending = {answer, stage:"queued"}` and queues `{type:"answer", id}`. Resubmission while queued replaces the text without adding an event; while thinking it returns 409. `/api/cancel` withdraws queued answers only. Answers captured by a specification are additionally locked until grading.
2. `wait` calls `takeEvent()`; `payload()` gathers context and sets `stage:"thinking"`. Obsolete events, such as withdrawn answers, are skipped.
3. `apply {type:"answer", id, token, status, verdict, children, branchChanges, newRoot}` validates the delivery token and branch revision, constructs a candidate tree, validates all parents and cycles, then commits it. Descendants survive unless explicitly removed; `children` adds new open questions. Moves retain IDs, answers, chat and pending work. `pending.answer` becomes `answer`; unsupported statuses become `weak`. Concurrent branch changes requeue grading and return 409.
4. The next UI poll detects the new `version`, redraws, and highlights new nodes with `fresh`.

## Discussion

The discussion tab sends messages without grading an answer. The root also has chat, opened through its project-question context menu; it never becomes a graded question:

1. `/api/discuss {id, message}` appends to `node.chat`, sets `discuss:"queued"`, and queues an event. Further queued messages append without a new event; thinking returns 409.
2. `wait` returns messages since the last agent reply in `message`, earlier messages in `history`, and sets `discuss:"thinking"`.
3. `apply {type:"discuss", id, token, reply}` appends an agent reply and clears `discuss`; status, verdict, and children stay unchanged. If the thread is no longer thinking, return 409 so stale replies cannot consume newer messages.

Right-click an answer option to discuss or select it. Right-click a verdict (`[data-verdict]`) to discuss it. Existing text selection keeps the browser's copy menu; selection is captured on `pointerdown` because macOS may select a word on right-click. Discussion attaches `panel.quote = {about, text}` as `quote` and `about`.

Reset chat, with confirmation, calls `/api/chatreset`: deletes chat, its queued event and its images; thinking returns 409. Enter sends; Ctrl/Cmd+Enter or Shift+Enter inserts a newline.

Pasting an image into the discussion input adds a removable thumbnail held in memory (`draftImages`) until it is sent with the message. A clipboard that also holds text pastes the text. The agent receives saved file paths in the event's `images`. The browser reuses fetched image blob URLs and revokes them when a state update removes their last chat reference; pending fetches cannot recreate removed URLs. Answer, discussion and custom-question inputs grow with their text up to 40% of the window height.

Chat belongs to a node: regrading and moves preserve it; explicit deletion removes only deleted nodes’ chats and events. Obsolete descendant events are skipped. `more` and `finish` use pending flags for deduplication; `apply` resets them.

## Reread

The header Reread button and summary control call `/api/reread`; editing an existing answer queues the same job automatically. The agent reads the whole map after submitted work settles and returns one transaction. This is the only operation that crosses branches: `branchChanges` stays limited to the graded subtree and `init` still wipes answers.

The Reread button disables immediately on submission and shows a spinner until the queued or running job completes. Both controls share the submission guard. Request errors appear in a dismissible floating alert without opening or switching the drawer and restore the control; reduced-motion preferences keep the spinner static.

All action errors and input validation messages use the same floating alert, including answers, discussions, ideas, question creation, image attachments, clipboard access, map loading and preview controls. Alerts dismiss automatically after ten seconds; a shrinking ring around the close button shows the remaining time (static with reduced motion). Each new error restarts the timer and ring; manual dismissal cancels both. Starting another action or switching discussion tabs clears the alert. Failed header spec/finish requests retain the current drawer. Preview save errors remain visible and dismissible inside the modal unsaved-changes dialog. Newly observed background spec, reread, reassessment and preview errors also trigger an alert once per change; persisted errors remain available in their existing result panels and do not repeat on every poll or initial load. Background connectivity and image-loading indicators remain local to their controls. Generic API 404 `not found` responses explain that the command is unavailable and suggest restarting the map server and reloading the page; reread has a specific message.

The browser translates known terse errors into explanations with a recovery action: unavailable cards/versions, queue limits, preview failures, image restrictions, duplicate submissions and file-access failures. The same explanations appear in persisted result panels, without rewriting stored diagnostics. The API helper explains connection failures, rejects malformed success responses, and replaces raw server failures or HTML responses with guidance; meaningful validation and conflict messages remain intact. CLI diagnostics and server protocol strings are unchanged. Error phrases and their English translations are maintained together in `ui.html` and `locales/en.json`.

The server validates the candidate on a clone, independently confirms that every previous answer survives, keeps one copy in `state.before-reread.json`, then commits. It cannot judge meaning, so chain coherence is the agent's check; an unsure agent returns `error`, which unlocks the map unchanged. A manual job locks answers while an agent is listening, and any delivered job locks them until its result. Recovery uses the same mechanism as other tokenized work, so a crash needs no timeout. The map's idea is the brief, shown on the root card and rewritable by this transaction. Rules and formats are in `worker.md` and [contract.md](contract.md).

## Recovery

- `watch` is a client loop around the unchanged `/api/wait`: it swallows server timeout replies and exits on one event. When `--max-wait` expires, it aborts the outstanding request and prints a timeout body with `expired:true`. A host with automatic background completion wake-up can end the agent turn while it runs, then re-arm after applying an event or silently after expiry. Codex keeps the blocking `wait --timeout 50` loop. The active request keeps the map connected. An event taken at the cancellation boundary but not printed is returned to the queue by the next `wait` or `watch`.

- On restart, pending answers and discussions return to queued; no messages are lost.
- `start` checks `/api/ping` with a 1.5-second timeout and matching `pid`. A dead server is replaced; readiness is checked for up to 6 seconds. `EADDRINUSE` advances the port, up to 20 retries, and saves the actual port.
- Each new `wait` requeues unfinished thinking work at the front. Only one agent session may listen to a map.
- `wait` holds the request for 5–290 seconds, default 280, then returns `{type:"timeout",waitingAnswers:N,waitingDiscussions:M}`. The skill uses `--timeout 50`; wait for a still-running shell process before starting another call.
- Agent connected means a live waiter or activity within 180 seconds.

## UI

`ui.html` contains CSS tokens, light/dark themes through `prefers-color-scheme`, markup, and JavaScript. Google Fonts is its only external resource.

- `poll()` requests `/api/state` every 1.2 seconds. It redraws after version/listening changes or reconnection, and displays server-offline state when disconnected.
- `render()` lays out the tree left to right: 252-pixel nodes, `HG=64`, `VG=14`. SVG Bézier edges use status colors; open edges are dashed. Manual zoom ranges from 0.1 to 2; automatic map/branch fitting can go below 0.1.
- Header status counters filter by status for questions and ideas while retaining ancestor chains (`ctx`). A hidden panel closes and saves its draft; panel selection never overrides filters. A second click resets the filter. `focusFilter()` chooses the matching question or idea with minimum X, then Y; `centerNode()` centers it without opening a panel or changing zoom. `centerMap()` animates centering in the visible canvas left of the drawer; wide maps align their root left. Manual movement interrupts animation. Filter state `flt` lives only in the browser.
- `nodePanel()` shows ancestors, Answer/Discuss tabs (`panel.tab`, `discussTab()`), verdict, children, and answer input. Editing warns that the agent will review the branch, may remove obsolete decisions, and will then reread the whole map. `summaryPanel()` shows counts, problem groups, reread/finish/spec controls, and Markdown export.
- `panelSig()` prevents unnecessary redraws and input loss. `drafts` stores answers and `"d:"+id` discussion drafts. `renderPanel()` preserves focus, cursor, and scroll, scrolling chat down when messages arrive.
- `#panelGrip` resizes the drawer by dragging or with Left/Right arrow keys, from 320 px up to the window width minus 120 px. It is a sibling of `#panel`, so re-renders do not drop its pointer capture. The width is kept per browser in `localStorage` (`grill.panelWidth`), which is per origin, so maps served on different ports remember separate widths. CSS caps a saved width to the current window; at 560 px and below the drawer is full-width and the grip is hidden.
- A newly finished map opens the summary automatically.
- Browser `toMarkdown()` and server `report()` are similar but separate export implementations.

## Security

- Bind only to `127.0.0.1`.
- Accept only `127.0.0.1` or `localhost` as Host to prevent DNS rebinding.
- Require `x-grill: 1` on every `/api/*` request, including locale updates, to prevent CSRF.
- Limit request bodies to 1 MB, except `/api/discuss`, which allows about 44 MB for its images.
- Escape user content with `esc()`; validate translation dictionaries before persisting or rendering.

## Per-event workers

```text
Browser -> queue -> watch --inbox -> inbox.json
                         | short event line
                         v
                    Dispatcher -> foreground worker -> apply / report
                         ^              |
                         +-- one line --+
```

Level 2 requires verified background completion wake-up and a foreground subagent with shell access. Each event gets a fresh worker reading `worker.md`, `session.md` and inbox; the dispatcher reads only the compact line. A worker must finish before the dispatcher re-arms: a new waiter requeues thinking work. There is no lease; a second session can still steal events. Hosts without these capabilities retain level 1/0, using the same worker rules in the main session.

`S.notes` is a bounded complete replacement, independent of queued work. The server writes session context at startup, init, notes updates and locale changes; init clears notes. Model configuration is dispatcher-only: installed `config.default.json`, overridden by project `<--dir>/config.json`, never a per-map file.

On restart, saved custom-language dictionaries retain their existing translations and use English for newly missing UI phrases. Explicit locale files and API locale updates still require complete dictionaries. An explicit startup language/locale replaces the saved locale before its validation. Locale checks cover older dictionaries and replacement on restart.

## Custom questions and isolation

`POST /api/question {id,parentId,q}` persists a preparation request and deduplicates retries by client request ID, including completed requests stored on cards. Only one request per parent and 20 total can wait. A tokenized `question` event supplies parent context; apply validates it and the current branch revision, keeps the exact user text, and requires at least two prepared options. Main cards get the next priority, children inherit area, and both carry `createdBy:user,requestId`. Restart/redelivery requeues unfinished requests; deletion cannot remove their parents. Summary opens custom main-question creation and shows its waiting state; opening it while pending displays the existing request in the custom-question panel. Summary uses the same Reread action as the header; `/api/more` remains a compatibility API.

Double click delays single-click opening by the local desktop interval plus a short guard, centers the target, and displays only it and its ancestor chain. `isolated` holds the target and previous filter. An eye button restores the previous filter; choosing a new filter exits isolation and uses that filter. Polling never restores the open drawer’s unrelated node during isolation. If the target disappears, restore the filter safely. Root right-click opens general project discussion; ordinary card right-click opens child creation. Option explanations submit a separate quoted discussion without submitting an unfinished user draft. They retain unsent message/quote on errors or while busy; completion of an earlier request cannot erase later drafts or explanations.

For a spec request, `gradingNodes` freezes full grading context at capture. Captured grades apply the same moves/removals/additions to this context, while unrelated live changes are excluded. The document `nodes` projection strips discussion/options/pending text. Changed-after-capture nodes cannot be removed by captured grading. The waiter prioritizes captured pending answers and removes explicitly deleted IDs from `waiting`.

The served page embeds `PAGE_DOUBLE_CLICK_MS`. The server reads the local desktop interval on page load (Windows GetDoubleClickTime through built-in PowerShell, macOS NSEvent through osascript, explicitly identified GNOME sessions through gsettings), with a three-second bound and hidden Windows helpers. Unavailable settings use a conservative 5000 ms fallback. `GRILL_DOUBLE_CLICK_MS` (positive milliseconds, up to 10000) overrides detection for other desktops or accessibility settings; reload after changing the system preference. The renderer adds a 100 ms guard and validates numeric injection. A second mousedown cancels pending opening before its mouseup, including held second clicks. Keyboard activation stays immediate.

Map rendering reuses visible card buttons and their unchanged markup across polls to retain native gesture targets and focus. A newer panel action, outside pointerdown or Escape cancels a pending single-card timer. On regrading, retained follow-ups can satisfy the worker’s question counts without adding new children.

## Reread coverage and obsolete premises

A finish request cancels queued or delivered automatic rereads and invalidates their tokens; a stale apply returns 409. Automatic rereads, including answer-edit reviews, stay disabled while finish is pending or the map is finished, including after restart. Submitted grading and ancestor reassessment still drain. Explicit manual rereads remain available, including automatic jobs upgraded to manual before the finish request.

The worker compares every question, explanation, option and parent chain with current decisions and explicitly withdrawn assumptions. Successful rereads require a complete per-card audit; the server validates coverage and agreement with operations atomically. An explicit replacement decision is distinct from an unresolved disagreement.

An obsolete card with user history stays in the tree with `obsolete:{reason,sources:[{id,q}]}`; its grade and history remain unchanged. Counts and finish problems exclude it, while reports and specification snapshots carry the marker. UI status filters do not match it, next-question navigation skips it and answering returns 409. Discussion and reread restoration remain available. Children are reviewed independently. A question without history can instead be removed and replaced by a new, currently meaningful question. Summary exposes the saved audit reasons.

## Attached idea lifecycle

Ideas are root children in the existing flat tree; their questions keep ordinary `kind:q`. The idea's full `text`, numeric content `revision`, five-valued `status`, explanation and chat persist. Separate `analysis` holds queue progress. Creation is idempotent and atomically queues analysis; Analyze idea, text edits, descendant grades and changing rereads of previously analyzed ideas use the tokenized idea event. Editing requests a per-question premise audit, preserving history. Context revisions cover the whole map because other branches may supply decisive evidence.

Specification processing adds frozen idea evaluations after captured answer grades. These update only `specJob.gradingNodes` and its projection; live idea work remains separate to avoid overwriting later activity. Only ok idea subtrees are delivered to the document worker. Text edits are an explicit invalidation boundary: the old spec token is canceled, a persisted refresh stage waits for live reassessment, and a new snapshot/request is captured. Ordinary late answers do not recapture a snapshot. Recovery restores both live and frozen work.

Deletion checks pending branch work, rereads and spec references before deleting the entire subtree and its unused images. Editing instead remains available during work and invalidates outdated deliveries. UI filters count and match ideas and questions by status, retaining only matching cards and their context ancestors. Previews appear only as required context under a filter. Exports preserve all ideas regardless of spec inclusion. See the attached-ideas section in contract.md for exact routes, limits and audit shapes.

Answer/discussion ancestor context includes `kind:"idea",text` for idea ancestors, preserving the complete premise beyond the 220-character `q` prefix. Workers must read full `text` when present.

## Preview projects

`preview.mjs` separates project identity, card placement, captured source revisions, Git publication and per-commit saved settings. `preview-view.mjs` renders sanitized HTML/CSS and executes project reducers in a network-isolated worker inside a sandbox iframe. Polling retains the viewer. Immutable spec snapshots have separate retention. See [preview.md](preview.md) for lifecycle and trust boundaries.

## Completeness and parent evidence

The persisted reserve distinguishes `null` (unassessed legacy map) from an empty assessed array. Reread receives the full current map and candidate list; one validated transaction updates the reserve, performs restructuring and issues at most three questions. Computed coverage counts current question cards independently of filters and grades. `reserveRevision` records the evidence used for the last assessment; new map evidence makes the percentage unknown until reassessed, while read receipts do not. `autoRereadRevision` prevents an unchanged settled map from repeatedly requesting empty work. Automatic issuance waits for all map-changing work and no active open question; finished maps and unchanged empty reserves do not loop.

Descendant grades schedule tokenized `reevaluate` work for answered question ancestors. These evaluations preserve user answers and append previous verdicts to `verdictHistory`; idea ancestors use their existing evaluation path. The worker judges evidence rather than completion counts. Frozen specification evaluations use their own captured context and cannot import later live data. Read receipts identify an exact agent chat message, so an acknowledgement cannot mark a concurrently newer reply read.

Camera actions run after layout and account for the drawer. Show all clears filter/isolation and fits every card. Zoom selected is disabled without a selected node, clears filter/isolation and fits its entire branch while leaving others visible. Manual zoom clamps at 10% even after an automatic fit below that threshold. Under an empty status filter only root remains; previews never create independent matches.


Parent reassessments deliver complete affected ancestor branches in separate batches when necessary, bounded to 500 nodes per affected subtree and 600000 serialized characters including its ancestor context; unrelated map branches are not included. Context-only ancestor nodes preserve premises (including attached idea text) and are not assessment IDs. All pending batches survive restart, and frozen batches remain isolated from live state. `queueLength`, CLI `status.queue` and map-list `queue` include pending internal ancestor reassessments (including frozen ones); only drain when this authoritative count is zero. A whole-map reread exceeding these limits returns HTTP 400, records `rereadResult.error`, releases its job and answer lock, and suppresses automatic retries for the unchanged revision. Other queued events remain deliverable; a manual reread can retry after addressing the size. Context is never silently truncated. Merged-source answers, current verdicts and verdict histories remain visible in the drawer and both Markdown exports.

If a complete affected branch itself exceeds the limit, live reassessment returns HTTP 400, records `reevaluationError:{ids,error,at}` visible in the summary, and releases only that failed batch; independent batches and queued work remain deliverable. The grades stay unchanged. A new descendant answer retries those ancestors after the branch/context size is addressed. Frozen oversized reassessment cancels the specification with `specError` and releases snapshot locks; it never generates a specification from incomplete evidence. These are explicit failed operations, not successful assessments.
