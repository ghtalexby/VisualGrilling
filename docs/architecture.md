# Architecture

## Specification from answers

This flow is independent of `finish`: UI/CLI `spec` → durable action journal → completion of prior commands and internal work → execution-time `specJob` snapshot → `wait` delivers `spec` → agent writes a plan → `apply spec` saves Markdown. The snapshot excludes question discussions and later answers; idea chat is captured as context. Recovered legacy jobs may still grade captured pending answers into their saved snapshot. New commands do not mutate active deliveries. Restart recovers the request; redelivery changes its token.

`specOwner` is a stable document-owner UUID; `specFile` is the path in `docs/vgril/specs`; `specUpdatedAt` records the last successful write; `specError` stores the latest error. `specJob` contains `stage, token, requestedAt, title, brief, arch, nodes, gradingNodes, waiting`. The UI receives only the stage and pending-grade count. Saving a specification does not change grades, summary, or completion. The writer checks ownership and regular directories/files, then replaces its file with a temporary-file rename. The server's working directory defines the project root independently of `--dir`.

## Components

```text
Browser (ui.html)                  grill.mjs serve                   Codex / Claude Code
poll GET /api/state  <---1.2s---    S in memory <-> state.json
POST /api/answer ----------------> S.actions → S.queue -> pump() --------------> grill.mjs wait/watch
POST /api/discuss|more|finish|spec                                  grades answers, checks code
                                  apply() updates tree <---------- grill.mjs apply
```

`grill.mjs` has two roles:

- **`serve`**: an HTTP server (`http.createServer`) that holds `S` in memory and saves every change. Normally started by `start` as a detached child process.
- **CLI client**: `start`, `init`, `wait`, `watch`, `apply`, `spec`, `status`, `report`, `stop`, `list`, `config`. It locates the server using the map's `server.json`.

Paths resolve from the current working directory (`--dir` defaults to `.grill`), so run commands from the project being grilled.

## Boards Hub and lifecycle

`skills/grill/hub/registry.mjs` registers each started map using its persistent `board.json` ID, independent of port. Per-ID records live under `%LOCALAPPDATA%/VisualGrilling/Hub/boards` or `GRILL_HUB_HOME`. Registry writes use an interprocess lock and atomic replacement. Duplicate IDs at another path are rejected; explicit rebind verifies the same identity at the destination. Missing paths remain listed. The sibling `/api/maps` endpoint remains a read-only view of one maps root, separate from this cross-project registry.

Chrome's extension in `hub/extension/` uses native messaging to `com.visualgrilling.hub`. The Windows launcher and `hub/native.mjs` validate the installed extension origin, bind installation credentials and start the installed `skills/grill/hub/service.mjs` on demand. The service exposes authenticated loopback health/command endpoints with exact Origin, Host, `x-grill`, secret and installation-epoch checks. `hub/codex.mjs` inside the skill manages Codex app-server transport, owned background sessions and chat/login/approval requests. See [native installation and trust](../hub/README.md).

The service combines persisted completion/counts with separate server and agent observations and their timestamps. Active filtering uses completion only. Provider/thread identity comes from adapter state or a validated per-map Codex/Claude binding, independently of connectivity; knowing the provider does not establish a live consumer. Open reuses a server; concurrent Play requests for one board join one operation until Stop or rebind is admitted, including across independent clients. Agent connectivity requires evidence of active map consumption, not merely process creation or queued resume. Connection certainty is reported as connected, disconnected or unconfirmed. Current owned transport failure overrides a lingering waiter; a live RPC proves ongoing work only for the attached thread and epoch with a current board delivery. Failed observations preserve stale data explicitly.

Service-owned `sessions/<boardId>.json` metadata records the background thread and ownership. Play restores ownership only when that trusted record matches the selected provider and thread; an `owned` field in the map binding cannot promote a terminal session. An available owned thread resumes through a dedicated standalone app-server with level 0 waiting, preserving its thread across Stop/Play and service restart. Unknown availability remains an error, not permission to create a replacement session. Native connections admit at most 16 pending responses and coalesce overlapping Play commands with identical board/credentials, including their shared failure; Stop/rebind delimit sharing and retain arrival order. See [native transport details](../hub/README.md#transport-and-trust).

Identity-checked rebind also supports renaming a named map directory: the destination basename must satisfy CLI map-name rules, and dir/base/name change atomically while the board ID stays fixed. Legacy maps retain name:null. The original directory must be absent; an explicitly configured project path is preserved.

Probes verify routing (canonical directory, maps root and name) as well as ID. For a live moved map, the controller validates the destination first, stops the endpoint verified against the original route, confirms it is gone, writes a paused lifecycle fence at the verified destination, then commits the new registry route and restarts from its durable journal. The old process never writes its in-memory tree to the destination. A missing original directory allows write-free Stop; failed shutdown is an error, not a successful rebind. Moving a default project records its verified old/new paths; an available thread with a control transport can use this evidence to resume with the new cwd, and the adapter verifies the returned cwd. Unrelated project mismatches remain rejected. For an available queue-only external terminal at the verified old cwd, the controller preserves that terminal, fences the old board lifecycle, and creates one owned replacement. Before creation it persists the relocation decision and a creating marker; the first confirmed thread ID is saved before any turn. Restart before attach prefers that owned thread over the old map binding. A creating marker without a confirmed thread ID blocks automatic retry; a known login-only state may safely restart login.

Play matches existing adapter epoch and attached thread to the live lifecycle. A map-only crash retires the stale owned transport, waits for its process exit, and resumes the saved thread under a new claim. Stale terminal adapters are retired through scoped Stop, preserving the terminal and interrupting only an identified grilling turn before availability is checked. After helper restart, persisted owned metadata or a lingering HTTP waiter does not establish a live model: availability must be verified, and the old server is fenced before resumption. Unknown or busy availability never authorizes a duplicate consumer.

Server launches and agent prompts use the runtime bundled beside the running helper. A registry CLI path is provenance, not a dependency on a checkout that may have moved or been deleted after installation.

Hub lifecycle state in `hub-lifecycle.json` carries a durable epoch. Claim and Stop fence prior consumers; managed event results echo their delivered `hubEpoch`. Stop commits its fence before server exit, preserves accepted receipts and requeues unfinished work on the next Play. Workers keep the epoch issued to their session rather than reading a replacement from disk. Session transfer preserves this fence. Hub Stop does not invoke finish: it stops this board's server and owned background process while retaining terminal sessions, answers, journal and summary. The map header's finish action remains separate.

## Per-map language

`S.locale` stores a canonical language tag and a complete dictionary. `start --lang en|ru` or `start --locale <file.json>` validates and applies it before opening the browser. A new `serve` gets the same arguments; a running server receives the protected `/api/locale` request. With no language arguments, existing locale data is preserved; legacy maps default to Russian. `init` preserves locale data.

`i18n.mjs` renders the trusted `ui.html` template on each page request, replacing Cyrillic source phrases using the dictionary. Inside script strings, replacement text is encoded as Unicode escapes to preserve JavaScript string boundaries. Dictionaries accept only bounded plain text and reject markup delimiters, double quotes, ampersands, and control characters because phrases also appear inside generated HTML attributes. User project content is never translated by this renderer; it still goes through `esc()`.

The initial page includes its locale revision. `/api/state` supplies `localeRevision`; an already open page reloads when the locale changes. The document `lang` and text direction follow the chosen language. Every delivered work event includes `language`, so the agent writes content in the same language. Server errors, report labels, and the specification warning use the dictionary. Existing stored questions and chat are not automatically rewritten when resuming in another language.

## Multiple maps

A map is a directory containing `state.json`. A named map (`--name arch`) uses `.grill/arch/`; an unnamed legacy map uses `.grill/`. Each has its own `serve` process and port (`start` tries 4777 and then the next available port). `SKILL.md` requires names for new maps. Level 1 can serve multiple maps in one session; level 0 and Codex monitor mode keep a separate session per map. The dispatcher tracks each map and its watch task, routes by the short line's name and task root, and handles events sequentially with one event at a time in the primary session. Other maps' watches stay armed during grading. Finished maps are unwatched at the persisted finish boundary, including failed finish, leaving their servers readable. Explicit continuation clears the session row's finished flag and keeps it serving until the next applied finish. The persisted server `finished` flag and summary are retained and must not trigger completion checks on their own.

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
| `inbox.json` | Full last event from inbox-mode watch or large wait/watch/monitor output; atomic replacement |
| `images/` | Images pasted into discussions; files without a chat reference are deleted |
| `report.md` | Report written by `grill.mjs report` |

## State model

`contextStats` records event sizes at the shared delivery boundary used by wait/watch and monitor reservation, including ancestor reviews and captured work. It persists the last 200 measurements and cumulative totals by event type; restart preserves it and `init` resets it. Measurements use the final event including `knowledge` and `language`, without modifying its content. `/api/state` exposes these read-only diagnostics. Repeated reads of a reserved monitor event do not count again; recovery/redelivery does. See the section definitions in [contract.md](contract.md).

```js
S = {
  version, title, brief, arch, notes, locale, reserve, reserveRevision, autoRereadRevision, reevaluation,
  nodes: [{ id: "root", parentId: null, kind: "root" }, /* questions */],
  queue: [/* answer, discuss, question, idea, more, reread, finish, spec events; reevaluation is separate state */],
  questionRequests: [/* persisted custom question preparation */],
  summary, finished, morePending, finishPending,
  specOwner, specFile, specUpdatedAt, specError, specJob,
  rereadJob, rereadResult, rereadSeen
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

## Focused event context

`state.json` remains the sole source of truth. `context.mjs` derives compact delivery cards, the depth-first index, lexical ranking and semantic graph from the current or explicitly frozen nodes. Answer, question, discussion and idea events send full focus evidence and selected related cards, with other cards discoverable through an inline index or `G index`. Only graph neighbours enter full related context; lexical candidates use compact `relatedIndex` rows, or relevance-ordered `relatedIds` pointing into the inline discussion/idea index. Protected read-only `node`, `branch`, `index`, `search` and `related` commands fetch more context without consuming events or changing listening state.

Topics, typed outgoing links, decision summaries and discussion digests guide retrieval only. Incoming links are computed, not written to destination cards. The graph and vocabulary never establish user decisions; frozen specifications, knowledge provenance and exports exclude semantic fields. New user evidence marks annotations stale until a result supplies updated semantics. Question additions pass the shared atomic similarity guard; intentional overlap requires reading the match and declaring `allowSimilar`.

Successful rereads persist evidence digests in `rereadSeen`. First and manually requested reviews retain full evidence and audit coverage. Later automatic reviews deliver changed cards and graph neighbours in full, with an index for the remainder; every fully delivered or modified question requires an audit. Unchanged, unaudited questions default to keep. Project-chat changes, reserve, coverage and ideas remain available. Reread knowledge extraction is deferred until the configured number of answered cards have changed (default five); finish still requires extraction. Knowledge source snapshots are injected from the captured job at save time, avoiding a second serialized copy in each event and agent result.

## Answer lifecycle

1. `POST /api/answer {id, answer, actionId?}` persists an action. When its turn arrives, its reducer sets `node.pending` and queues an answer event. Adjacent unstarted revisions execute the last version; all versions remain in the journal. Running work is unchanged by new submissions.
2. `wait` calls `takeEvent()`; `payload()` gathers context and sets `stage:"thinking"`. Obsolete events, such as withdrawn answers, are skipped.
3. `apply {type:"answer", id, token, status, verdict, children, branchChanges, newRoot}` validates the delivery token and branch revision, constructs a candidate tree, validates all parents and cycles, then commits it. Descendants survive unless explicitly removed; `children` adds new open questions. Moves retain IDs, answers, chat and pending work. `pending.answer` becomes `answer`; unsupported statuses become `weak`. Concurrent branch changes requeue grading and return 409.
4. The next UI poll detects the new `version`, redraws, and highlights new nodes with `fresh`.

## Discussion

The discussion tab sends messages and can settle a question directly. The root also has chat, opened through its project-question context menu; it never becomes a graded question:

1. `/api/discuss {id, message, actionId?}` persists a message action. At execution, adjacent messages for the same conversation append to chat and create one delivery. New messages during thinking remain queued for the next response.
2. `wait` returns messages since the last agent reply in `message`, the complete canonical thread in the focus card's `chat`, and sets `discuss:"thinking"`.
3. `apply {type:"discuss", id, token, reply, assessment?}` appends an agent reply and clears `discuss`. An optional question assessment records status/verdict and seeds a missing answer from the accepted decision; existing answers and children survive. It validates the delivered branch revision, queues ancestor/idea reassessment, and leaves frozen spec snapshots unchanged. Reply-only results preserve grades. Explicit commands may also include `reread:true` or `forward:{id,message}`: after validation, the same apply saves the reply and queues a manual whole-map review or the requested other-question discussion. Forwarded decisions are evaluated in a subsequent delivery with the target branch context. If the thread is no longer thinking, return 409 so stale replies cannot consume newer messages.

Right-click an answer option to discuss or select it. Right-click a verdict (`[data-verdict]`) to discuss it. Existing text selection keeps the browser's copy menu; selection is captured on `pointerdown` because macOS may select a word on right-click. Discussion attaches `panel.quote = {about, text}` as `quote` and `about`.

Reset chat, with confirmation, calls `/api/chatreset`: queues a reset after earlier work. Removed chat and images remain in the archive. Enter sends; Ctrl/Cmd+Enter or Shift+Enter inserts a newline.

Pasting an image into the discussion input adds a removable thumbnail held in memory (`draftImages`) until it is sent with the message. A clipboard that also holds text pastes the text. The agent receives saved file paths in the event's `images`. The browser reuses fetched image blob URLs and revokes them when a state update removes their last chat reference; pending fetches cannot recreate removed URLs. Answer, discussion and custom-question inputs grow with their text up to 40% of the window height.

Chat belongs to a node: regrading and moves preserve it; explicit deletion removes only deleted nodes’ chats and events. Obsolete descendant events are skipped. `more` and `finish` use pending flags for deduplication; `apply` resets them.

## Reread

Reread reviews the usefulness and completeness of the question set against current answers and discussions. The manual button carries this instruction without extra user wording. Workers identify useful retained decisions, redundant or irrelevant open questions, resolved questions and missing decisions/consequences, then select supported changes while preserving evidence. A consistent map may still need new questions; a no-op must follow this broader review. The three ordinary additions include replacements, with deferred gaps kept in reserve. Detailed audit reasons and the summary explain the result; the server validates operations rather than semantic quality.

The header Reread button and root-menu action call `/api/reread`; editing an existing answer queues the same job automatically. After submitted work settles, first/manual rereads review the whole map; later automatic rereads review changed evidence and semantic neighbours with the rest indexed. The agent returns one transaction: `branchChanges` stays limited to the graded subtree and `init` still wipes answers.

The Reread button shows progress while allowing later requests to enter the journal. Both controls share the submission guard. Request errors appear in a dismissible floating alert without opening or switching the drawer and restore the control; reduced-motion preferences keep the spinner static.

All action errors and input validation messages use the same floating alert, including answers, discussions, ideas, question creation, image attachments, clipboard access, map loading and preview controls. Alerts dismiss automatically after ten seconds; a shrinking ring around the close button shows the remaining time (static with reduced motion). Each new error restarts the timer and ring; manual dismissal cancels both. Starting another action or switching discussion tabs clears the alert. Failed header spec/finish requests retain the current drawer. Preview save errors remain visible and dismissible inside the modal unsaved-changes dialog. Newly observed background spec, reread, reassessment and preview errors also trigger an alert once per change; persisted errors remain available in their existing result panels and do not repeat on every poll or initial load. Background connectivity and image-loading indicators remain local to their controls. Generic API 404 `not found` responses explain that the command is unavailable and suggest restarting the map server and reloading the page; reread has a specific message.

The browser translates known terse errors into explanations with a recovery action: unavailable cards/versions, queue limits, preview failures, image restrictions, duplicate submissions and file-access failures. The same explanations appear in persisted result panels, without rewriting stored diagnostics. The API helper explains connection failures, rejects malformed success responses, and replaces raw server failures or HTML responses with guidance; meaningful validation and conflict messages remain intact. CLI diagnostics and server protocol strings are unchanged. Error phrases and their English translations are maintained together in `ui.html` and `locales/en.json`.

The server validates the candidate on a clone, independently confirms that every previous answer survives, keeps one copy in `state.before-reread.json`, then commits. It cannot judge meaning, so chain coherence is the agent's check; an unsure agent returns `error`, which unlocks the map unchanged. Reducer-level locks protect the active snapshot; admission remains available because later mutations wait in the journal. Recovery uses the same mechanism as other tokenized work, so a crash needs no timeout. The map's idea is the brief, shown on the root card and rewritable by this transaction. Rules and formats are in `events/reread.md` and [contract.md](contract.md).

## Recovery

- `watch` is a client loop around the unchanged `/api/wait`: it swallows server timeout replies and exits on one event. When `--max-wait` expires, it aborts the outstanding request and prints a timeout body with `expired:true`. A host with automatic background completion wake-up can end the agent turn while it runs, then re-arm after applying an event or silently after expiry. Codex defaults to hybrid (`wait --timeout 15`, then monitor only on timeout); pure monitor remains selectable; the blocking `wait --timeout 50` loop is reserved for an explicit user request, a confirmed standalone (--no-daemon) host, or a diagnosed host/transport failure. The active request keeps the map connected. An event taken at the cancellation boundary but not printed is returned to the queue by the next `wait` or `watch`.

- On restart, pending answers and discussions return to queued; no messages are lost.
- `start` checks `/api/ping` with a 1.5-second timeout and matching `pid`. A dead server is replaced; readiness is checked for up to 6 seconds. `EADDRINUSE` advances the port, up to 20 retries, and saves the actual port.
- Each new `wait` requeues unfinished thinking work at the front. Only one agent session may listen to a map.
- `wait` holds the request for 5–290 seconds, default 280, then returns `{type:"timeout",waitingAnswers:N,waitingDiscussions:M}`. The skill uses `--timeout 15` for hybrid and `--timeout 50` for level 0; wait for a still-running shell process before starting another call.
- Agent connected means a live waiter or activity within 180 seconds.

## UI

`ui.html` contains CSS tokens, light/dark themes through `prefers-color-scheme`, markup, and JavaScript. Google Fonts is its only external resource.

- `poll()` requests `/api/state` every 1.2 seconds. It redraws after version/listening changes or reconnection, and displays server-offline state when disconnected.
- `render()` lays out the tree left to right: 252-pixel nodes, `HG=64`, `VG=14`. SVG Bézier edges use status colors; open edges are dashed. Manual zoom ranges from 0.1 to 2; automatic map fitting can go below 0.1.
- Header status counters filter by status for questions and ideas while retaining ancestor chains (`ctx`). A hidden panel closes and saves its draft; panel selection never overrides filters. A second click resets the filter. `focusFilter()` chooses the matching question or idea with minimum X, then Y; `centerNode()` centers it without opening a panel or changing zoom. `centerMap()` animates centering in the visible canvas left of the drawer; wide maps align their root left. Manual movement interrupts animation. Filter state `flt` lives only in the browser.
- `nodePanel()` shows ancestors, Answer/Discuss tabs (`panel.tab`, `discussTab()`), verdict, children, and answer input. Editing warns that the agent will review the branch, may remove obsolete decisions, and will then reread the whole map. `summaryPanel()` is read-only: counts, problem groups, operation results, document viewing and Markdown export. The header split control submits spec requests through its main button and opens Summary through its independent arrow, including during generation. Stop remains separate. Knowledge recovery actions live in Knowledge files and refresh as their job state changes.
- `panelSig()` prevents unnecessary redraws and input loss. `drafts` stores answers and `"d:"+id` discussion drafts. `renderPanel()` preserves focus, cursor, and scroll, scrolling chat down when messages arrive.
- The drawer and its resize grip are positioned inside `main`, below the full dynamic header height, including on narrow screens. The header remains above the canvas stacking context.
- `#panelGrip` resizes the drawer by dragging or with Left/Right arrow keys, from 320 px up to the window width minus 120 px. It is a sibling of `#panel`, so re-renders do not drop its pointer capture. The width is kept per browser in `localStorage` (`grill.panelWidth`), which is per origin, so maps served on different ports remember separate widths. CSS caps a saved width to the current window; at 560 px and below the drawer is full-width and the grip is hidden.
- Check connection, Stop and specification requests preserve the current drawer. Finishing updates the summary data without opening or switching the drawer; the user opens Summary explicitly.
- Browser `toMarkdown()` and server `report()` are similar but separate export implementations.

## Security

- Bind only to `127.0.0.1`.
- Accept only `127.0.0.1` or `localhost` as Host to prevent DNS rebinding.
- Require `x-grill: 1` on every `/api/*` request, including locale updates, to prevent CSRF.
- Limit request bodies to 1 MB, except `/api/discuss`, which allows about 44 MB for its images.
- Escape user content with `esc()`; validate translation dictionaries before persisting or rendering.

## Single-session event preparation

```text
Browser -> queue -> wait/watch/monitor -> inbox.json
                   bound primary session -> local result -> preflight -> apply
```

The same session consumes, prepares and applies every event. It reads `worker.md`, the routed event rules and complete required inbox evidence. Level 2 is retired; other hosts retain inline levels 0/1. Never fetch another event during preparation. Hybrid uses a 15-second wait then monitor only on timeout; pure monitor is explicitly selectable. No child UUID or model dispatch is needed.

`S.notes` is a bounded complete replacement, independent of queued work. Update only changed durable facts; remove stale unfinished-artifact statements after completion. The server writes session context at startup, init, notes updates and locale changes; init clears notes. Configuration contains knowledge/session settings; validated legacy griller/reuse entries are inactive. Project overrides remain `<--dir>/config.json`, shared across maps.

On restart, saved custom-language dictionaries retain their existing translations and use English for newly missing UI phrases. Explicit locale files and API locale updates still require complete dictionaries. An explicit startup language/locale replaces the saved locale before its validation. Locale checks cover older dictionaries and replacement on restart.

## Custom questions and isolation

`POST /api/question {id,parentId,q}` persists a preparation request and deduplicates retries by client request ID, including completed requests stored on cards. Only one request per parent and 20 total can wait. A tokenized `question` event supplies parent context; apply validates it and the current branch revision, keeps the exact user text, and requires at least two prepared options. Main cards get the next priority, children inherit area, and both carry `createdBy:user,requestId`. Restart/redelivery requeues unfinished requests; deletion cannot remove their parents. The root menu opens custom main-question creation; opening it while pending displays the existing request in the custom-question panel. The root menu uses the same Reread action as the header; `/api/more` remains a compatibility API.

Double click delays single-click opening by the local desktop interval plus a short guard, centers the target, and displays only it and its ancestor chain. `isolated` holds the target and previous filter. An eye button restores the previous filter; choosing a new filter exits isolation and uses that filter. Polling never restores the open drawer’s unrelated node during isolation. If the target disappears, restore the filter safely. Root right-click opens general project discussion; ordinary card right-click opens child creation. Option explanations submit a separate quoted discussion without submitting an unfinished user draft. They retain unsent message/quote on errors or while busy; completion of an earlier request cannot erase later drafts or explanations.

For a spec request, `gradingNodes` freezes full grading context at capture. Captured grades apply the same moves/removals/additions to this context, while unrelated live changes are excluded. The document `nodes` projection strips discussion/options/pending text. Changed-after-capture nodes cannot be removed by captured grading. The waiter prioritizes captured pending answers and removes explicitly deleted IDs from `waiting`.

The served page embeds `PAGE_DOUBLE_CLICK_MS`. The server reads the local desktop interval on page load (Windows GetDoubleClickTime through built-in PowerShell, macOS NSEvent through osascript, explicitly identified GNOME sessions through gsettings), with a three-second bound and hidden Windows helpers. Unavailable settings use a conservative 5000 ms fallback. `GRILL_DOUBLE_CLICK_MS` (positive milliseconds, up to 10000) overrides detection for other desktops or accessibility settings; reload after changing the system preference. The renderer adds a 100 ms guard and validates numeric injection. A second mousedown cancels pending opening before its mouseup, including held second clicks. Keyboard activation stays immediate.

Map rendering reuses visible card buttons and their unchanged markup across polls to retain native gesture targets and focus. A newer panel action, outside pointerdown or Escape cancels a pending single-card timer. On regrading, retained follow-ups can satisfy the worker’s question counts without adding new children.

## Reread coverage and obsolete premises

A finish request waits behind previous actions and their automatic reread dependencies. Automatic rereads, including answer-edit reviews, stay disabled while finish is pending or the map is finished, including after restart. Submitted grading and ancestor reassessment still drain. Explicit manual rereads remain available, including automatic jobs upgraded to manual before the finish request.

The worker compares every question, explanation, option and parent chain with current decisions and explicitly withdrawn assumptions. Successful rereads require a complete per-card audit; the server validates coverage and agreement with operations atomically. An explicit replacement decision is distinct from an unresolved disagreement.

An obsolete card with user history stays in the tree with `obsolete:{reason,sources:[{id,q}]}`; its grade and history remain unchanged. Counts and finish problems exclude it, while reports and specification snapshots carry the marker. UI status filters do not match it, next-question navigation skips it and answering returns 409. Discussion and reread restoration remain available. Children are reviewed independently. A question without history can instead be removed and replaced by a new, currently meaningful question. Summary exposes the saved audit reasons.

## Attached idea lifecycle

Ideas are root children in the existing flat tree; their questions keep ordinary `kind:q`. The idea's full `text`, numeric content `revision`, five-valued `status`, explanation and chat persist. Separate `analysis` holds queue progress. Creation is idempotent and atomically queues analysis; Analyze idea, text edits, descendant grades and changing rereads of previously analyzed ideas use the tokenized idea event. Editing requests a per-question premise audit, preserving history. Context revisions cover the whole map because other branches may supply decisive evidence.

Recovered legacy specification jobs may add frozen idea evaluations after captured answer grades. These update only `specJob.gradingNodes` and its projection; live idea work remains separate to avoid overwriting later activity. Only ok idea subtrees are delivered to the document worker. Text edits wait in the action journal until the earlier spec completes. Legacy recovered spec jobs can still use their refresh stage. Ordinary late answers do not recapture a snapshot. Recovery restores both live and frozen work.

Deletion and editing enter the journal during active work and execute in order. Deletion archives the subtree and retains its images; editing starts a fresh analysis after prior deliveries complete. UI filters count and match ideas and questions by status, retaining only matching cards and their context ancestors. Previews appear only as required context under a filter. Exports preserve all ideas regardless of spec inclusion. See the attached-ideas section in contract.md for exact routes, limits and audit shapes.

Answer/discussion ancestor context includes `kind:"idea",text` for idea ancestors, preserving the complete premise beyond the 220-character `q` prefix. Workers must read full `text` when present.

## Preview projects

`preview.mjs` separates project identity, card placement, captured source revisions, Git publication and per-commit saved settings. `preview-view.mjs` renders sanitized HTML/CSS and executes project reducers in a network-isolated worker inside a sandbox iframe. Polling retains the viewer. Immutable spec snapshots have separate retention. See [preview.md](preview.md) for lifecycle and trust boundaries.

## Completeness and parent evidence

The persisted reserve distinguishes `null` (unassessed legacy map) from an empty assessed array. Reread receives the full current map and candidate list; one validated transaction updates the reserve, performs restructuring and issues at most three questions. Computed coverage counts current question cards independently of filters and grades. `reserveRevision` records the evidence used for the last assessment; new map evidence makes the percentage unknown until reassessed, while read receipts do not. `autoRereadRevision` prevents an unchanged settled map from repeatedly requesting empty work. Automatic issuance waits for all map-changing work and no active open question; finished maps and unchanged empty reserves do not loop.

Descendant grades schedule tokenized `reevaluate` work for answered question ancestors. These evaluations preserve user answers and append previous verdicts to `verdictHistory`; idea ancestors use their existing evaluation path. The worker judges evidence rather than completion counts. Frozen specification evaluations use their own captured context and cannot import later live data. Read receipts identify an exact agent chat message, so an acknowledgement cannot mark a concurrently newer reply read.

Camera actions run after layout and account for the drawer. Double-clicking empty canvas (outside cards and connection strokes) performs the same fit as Show all. The Show all icon fits currently rendered cards without changing filters, isolation or the open drawer. Manual zoom clamps at 10% even after an automatic fit below that threshold. Under an empty status filter only root remains; previews never create independent matches.


Parent reassessments deliver targets and changed descendants in full, unchanged descendants as index rows, and higher ancestors without chat/history. Full cards are bounded to 500 nodes and 600000 characters; unrelated map branches are not included. Context-only ancestor nodes preserve premises (including attached idea text) and are not assessment IDs. All pending batches survive restart, and frozen batches remain isolated from live state. `queueLength`, CLI `status.queue` and map-list `queue` include pending internal ancestor reassessments (including frozen ones); only drain when this authoritative count is zero. A whole-map reread exceeding these limits returns HTTP 400, records `rereadResult.error`, releases its job and answer lock, and suppresses automatic retries for the unchanged revision. Other queued events remain deliverable; a manual reread can retry after addressing the size. Context is never silently truncated. Merged-source answers, current verdicts and verdict histories remain visible in the drawer and both Markdown exports.

If required full branch evidence exceeds the limit, journal-owned reassessment fails its action and releases independent work. Legacy live reassessment returns HTTP 400, records `reevaluationError:{ids,error,at}` visible in the summary, and releases only that failed batch; independent batches and queued work remain deliverable. The grades stay unchanged. A new descendant answer retries those ancestors after the branch/context size is addressed. Frozen oversized reassessment cancels the specification with `specError` and releases snapshot locks; it never generates a specification from incomplete evidence. These are explicit failed operations, not successful assessments.

The header brand icon shows map-wide pending work independently of the open drawer: answers, discussions, custom questions, ideas, previews, rereads, ancestor reassessment, specifications, more questions and finish. Its accent ring rotates while the agent is connected or a job is marked thinking; queued work without an agent and server outages remain static. An uninitialized map uses the same indicator. The tooltip and accessible label describe activity, waiting or disconnection. Reduced-motion preferences keep the ring static. This uses existing state fields and does not add a heartbeat or processing timeout.

## Host session connection

Codex hybrid waits up to 15 seconds, then arms `monitor` on timeout. Pure monitor arms immediately only on request. `pump()` reserves one event through `takeEvent()`, keeps its payload in memory and sends a fixed notification through `connection.mjs`. The bound session fetches the exact delivery with `--inbox`, prepares and preflights local files, then applies. Hybrid stops the completed subscription before another wait; pure monitor uses final `--rearm`. Idle armed time needs no model calls. Protected `/api/monitor` exposes status; browser state contains no delivery credentials.

Subscription identity guards asynchronous transport completion: a late queue result cannot change a newer subscription. Failed or warned submissions are not retried automatically. Restart drops the subscription and existing recovery requeues work, so old notifications cannot fetch a new event. The original bound thread owns arming; rebinding is detected before dispatch and event retrieval. See [contract.md](contract.md#codex-event-monitor) for lifecycle and recovery details.

`connection.mjs` connects Check connection to an existing host session. An explicit CLI `start` binds the selected map to its Codex thread from `CODEX_THREAD_ID`, or to the local Claude channel when Claude host environment markers are present. Each map has its own `agent-connection.json`; starting a sibling preserves other bindings. A legacy root binding migrates to a named map only when it is the sole state-bearing map and no unnamed map exists. Ambiguous roots require an explicit start from the intended session.

`POST /api/resume` sends only a fixed continuation request for the server's own map. Codex uses argument-array execution of `codex queue --thread <id> --message <request> --resume`; queue success does not prove the local host resumed. Claude uses a dependency-free MCP stdio channel with `claude/channel` capability and `notifications/claude/channel` notifications. It reads validated requests only from its configured maps root and never relays browser-supplied text. No second model process is launched.

Per-map `agent-connection.json` selects a host; maps-root `claude-connection.json` carries the shared channel's private identity and heartbeat. Each map's `resume-request.json` records the target connection, request ID/time and transport delivery. These generated files stay outside `state.json` and survive server restart. Requests are coalesced for ten seconds; Check connection does not modify `finished`, summaries, queues or the listening heartbeat. A delivery flag means sent to the host transport, not processed by the model. Closed Claude channels reject requests after their heartbeat expires; a new channel gets a new ID and never consumes old-session requests. The UI reports request submission separately from existing listening status.

## Project knowledge

See [knowledge.md](knowledge.md) for the shared index, editable record schema, provenance, content-version checks, recovery guarantees, knowledge/finish lifecycle, explicit history import and generated-spec migration. Keep `knowledge.mjs`, `knowledge.md`, worker instructions, UI/locales and `dev/check-knowledge.mjs` synchronized. Run the knowledge check along with existing queue, spec, worker and map checks.

## Atomic discussion results

`discussion.mjs` builds a candidate tree for discussion questions, resolved card links and multi-target user answers. `grill.mjs` validates the whole-map delivery revision and legacy fields before committing the candidate with the assistant reply. Large results can be staged in numbered parts; staging is persisted but excluded from semantic context and specification projections. New deliveries invalidate old staging. All transfers refer to source user message IDs and preserve previous answers/provenance in answerHistory alongside verdictHistory. Existing parent/idea evaluation queues handle affected ancestors. Captured specifications remain independent.

Discussion links are structured card references, rendered with escaped text. Hidden targets open in temporary isolation; missing targets produce an error. The independent Obsolete preference uses a map-directory identity and localStorage. Rendering takes the union of active status matches and requested historical cards, then adds context ancestors; context never contributes to active status counts.

Replacing an existing answer with different discussion text also queues an automatic reread, as a direct Answer-tab edit does, so decisions in other branches can be reconsidered. The replacement is already graded, so this reread is settled (not cancelable as a withdrawn pending answer). Identical text does not trigger an edit reread; finish-pending/finished maps retain the existing automatic-reread suppression.

The connection line uses process-local delivery identity (`type`, target, token and frozen/live scope), projected as `currentWork:{type}` or null. All delivery paths, including frozen idea/ancestor work, register it before saving the new version. Each save validates that the same job/token is still executing; completion, cancellation and requeue therefore clear it without treating staged discussion or notes as completion. New wait clears the marker before recovery; restart never restores active execution from disk. Pending more-question work is recovered alongside the other jobs. The label has no time limit and is not a process-liveness guarantee. Offline HTTP still takes precedence.

## Session token usage

The header shows whole-session Codex token usage, not usage attributable to one map. Hover over the single-line counter (or focus it with the keyboard) for a floating tooltip with cumulative input, uncached input, cached input, output and reasoning tokens. Leaving the counter, blurring it or pressing Escape hides the tooltip without changing header layout. Input counts repeated context on every request; it is not the current context size. Uncached input equals input minus cached input. Cached input is a subset of input; reasoning is a subset of output, so neither is added again to the total. Counts refresh with polling even when map state is unchanged. Missing data (including unsupported providers) and an offline map show no data, never an invented zero.

`usage.mjs` reads bound-session Codex rollout telemetry: unique `token_usage_record` responses, falling back to token_count aggregates. Incremental reads are cached for one second. `last_input_tokens` drives the configurable rollover hint; missing telemetry stays unavailable. Context diagnostics store CLI request counts and cumulative usage snapshots/deltas by delivery type. See [Session cost contract](contract.md#session-cost-contract) for counting boundaries, sparse ancestor evidence, atomic apply/rearm and inbox output.


Context limits apply to delivered focused evidence, not unrelated indexed histories. Incremental rereads bound delivered questions, neighbours, ideas and new project chat; full rereads retain the whole-map limit. Structural transactions reconcile semantic links independently in each candidate tree: prune deleted targets, redirect merged targets, union outgoing links, remove self-links/duplicates and validate the final eight-link bound. Reread audits cover evidence changes; graph-only maintenance and semantic backfills do not expand the audit.

Project chat conversations share the root message log: messages carry `conversationId`, with missing IDs treated as `main`. `projectConversations` stores bounded conversation IDs outside the tree. Browser selection and drafts are local to each conversation; the root has one pending discussion at a time. Delivery filters root history to the pending conversation, and replies inherit its ID. Reread and image retention still see every conversation.


## Action journal and archive

`actions.mjs` owns persistent admission identities, grouping, cancellation plans and archive projections. `grill.mjs` serializes reducer activation, generated dependencies, result receipts and finish boundaries. See [the durable action contract](contract.md#durable-user-actions). Pending actions never mutate the evidence of active work. Legacy reducers recover before newly queued actions. State writes capture removed records before image pruning. The header queue separates current work, waiting messages/internal tasks and problems; hover opens temporarily, click pins, Close dismisses. Root exposes Archive.

The browser replays `actionQueue.effects` into each fresh state response to show admitted answers, chat, edits, additions, deletions and pending work immediately. These display-only changes never enter worker evidence or revisions before their FIFO action executes. Images are fetched on demand through the protected image endpoint.

The Notifications button immediately before the agent status shows the number of active header notices (connection result, finished map, queue acknowledgement and session rollover hint). Clicking opens their list without expanding the header or changing the drawer. It starts closed, updates while open, and closes on outside click or Escape. With zero notices the button is hidden and any open list closes; the count is active notices, not unread history. Submission errors retain their existing toast.


Mandatory clarification coverage is implemented in `followups.mjs`, called by every question grading reducer. A missing check saves its grade with a node-owned durable followup job; save synchronizes queued jobs with the existing internal queue. These tasks are dependencies of the originating action, recover on restart/redelivery and keep spec/finish behind unresolved work. Workers make semantic judgments; the server validates explicit gap-to-question coverage, provenance and atomic tree bounds. Frozen jobs operate only on gradingNodes with token-scoped reads. Supplements preserve original user text and are included in evidence, exports and snapshots. See [contract.md](contract.md#mandatory-clarification-coverage).


## Worker context and session-tree cost

See [the contract](contract.md#worker-context-and-session-tree-cost) and [resumable task](plans/TokenEfficiency/TASK.md). Agent navigation uses a compact index; the primary session reads inbox evidence and prepares local result files; usage sums observed descendant sessions with explicit partial-data reporting. Discovery runs in the background with bounded filesystem concurrency so metadata scans do not hold server startup.

## Fresh-session transfer

The connection dropdown sends a control request to the existing Codex session through connection.mjs. The server persists sessionTransfer and pauses further event delivery while allowing the reserved result and notes to complete. The old session prepares a file handoff, creates one fresh host task using create_thread, and ends its map loop. The new session claims the same map, updates the binding and resumes the normal loop. The browser URL, state and action journal remain intact. Persisted sessionOwner fences old wait/monitor/apply/init/stop requests. Creation is performed by the host agent, not a nested CLI model process; host failures remain visible and never trigger an automatic duplicate. See contract.md and skills/grill/session-transfer.md.

## Bounded session preparation and conservative assessment scheduling

The bound session canonicalizes instruction aliases and reads its routed rules once per known version/context. After compaction or uncertain coverage it reloads bounded relevant sections. It inspects field sizes before reading complete required evidence; truncation must be repaired. Local structural errors are corrected and preflighted before apply. Complete multipart results are preflighted before their first apply. Uncertain apply outcomes require status/receipt inspection; successful apply is never replayed for a later note/report failure.

Discussion can assess ancestors in its existing atomic transaction through `assessment.ancestors`, as already supported for `answers[]`. Explicit unchanged acknowledgements avoid a redundant separate ancestor assessment; omitted intent and `reviewAncestors:true` retain it. Newly created clarification branches still schedule review, and actual answer edits still request automatic reread. This narrow optimization does not introduce revision receipts, dependency coalescing, persistent workers or direct worker publication. Frozen specification and persisted finish boundaries remain unchanged.

Delivery traces correlate action IDs, scheduling causes, live-map revision hashes and declared worker UUIDs with bounded context statistics. `telemetry.mjs` closes observational usage windows and computes objective committed field changes; it does not control scheduling or ownership. Response counts in `usage.mjs` remain null when unavailable or incomplete. The offline `dev/session-audit.mjs` writes aggregate-only reports with an exclusive cutoff and explicit snapshot limitations; see [the contract](contract.md#observational-delivery-traces).

Per-event workers and reuse activation are retired. Historical lifecycle experiments remain documented in the audit records; they do not authorize delegation. Current processing uses the bound primary session. Fixed WebSocket transport and explicit user-requested transfer remain supported; context growth never triggers automatic transfer.
