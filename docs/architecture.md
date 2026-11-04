# Architecture

## Specification from answers

This flow is independent of `finish`: UI/CLI `spec` → persisted `specJob` snapshot → grading captured pending answers → `wait` delivers `spec` → agent writes a plan → `apply spec` saves Markdown. The snapshot excludes discussions and later answers. Captured pending answers cannot be replaced or withdrawn before grading; their `apply` updates the snapshot, including explicit branch operations. Restart recovers the request; redelivery changes its token.

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
| `session.md` | Server-generated title, language, brief, architecture and agent notes; atomic replacement |
| `inbox.json` | Full last event from `watch --inbox`; atomic replacement |
| `report.md` | Report written by `grill.mjs report` |

## State model

```js
S = {
  version, title, brief, arch, notes, locale,
  nodes: [{ id: "root", parentId: null, kind: "root" }, /* questions */],
  queue: [/* answer, discuss, question, more, finish, spec events */],
  questionRequests: [/* persisted custom question preparation */],
  summary, finished, morePending, finishPending,
  specOwner, specFile, specUpdatedAt, specError, specJob
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
  answer, verdict,
  chat: [{ from: "user|claude", text, quote, about, at }],
  discuss: "queued|thinking" /* or null */
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

Reset chat, with confirmation, calls `/api/chatreset`: deletes chat and its queued event; thinking returns 409. Enter sends; Ctrl/Cmd+Enter or Shift+Enter inserts a newline.

Chat belongs to a node: regrading and moves preserve it; explicit deletion removes only deleted nodes’ chats and events. Obsolete descendant events are skipped. `more` and `finish` use pending flags for deduplication; `apply` resets them.

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
- `render()` lays out the tree left to right: 252-pixel nodes, `HG=64`, `VG=14`. SVG Bézier edges use status colors; open edges are dashed. Zoom ranges from 0.3 to 2.
- Header status counters filter by status while retaining ancestor chains (`ctx`) and the open panel's question. A second click resets the filter. `focusFilter()` chooses the matching question with minimum X, then Y; `centerNode()` centers it without opening a panel or changing zoom. `centerMap()` animates centering in the visible canvas left of the drawer; wide maps align their root left. Manual movement interrupts animation. Filter state `flt` lives only in the browser.
- `nodePanel()` shows ancestors, Answer/Discuss tabs (`panel.tab`, `discussTab()`), verdict, children, and answer input. Editing warns that the agent will review the branch and may remove obsolete decisions. `summaryPanel()` shows counts, problem groups, more/finish/spec controls, and Markdown export.
- `panelSig()` prevents unnecessary redraws and input loss. `drafts` stores answers and `"d:"+id` discussion drafts. `renderPanel()` preserves focus, cursor, and scroll, scrolling chat down when messages arrive.
- A newly finished map opens the summary automatically.
- Browser `toMarkdown()` and server `report()` are similar but separate export implementations.

## Security

- Bind only to `127.0.0.1`.
- Accept only `127.0.0.1` or `localhost` as Host to prevent DNS rebinding.
- Require `x-grill: 1` on every `/api/*` request, including locale updates, to prevent CSRF.
- Limit request bodies to 1 MB.
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

`POST /api/question {id,parentId,q}` persists a preparation request and deduplicates retries by client request ID, including completed requests stored on cards. Only one request per parent and 20 total can wait. A tokenized `question` event supplies parent context; apply validates it and the current branch revision, keeps the exact user text, and requires at least two prepared options. Main cards get the next priority, children inherit area, and both carry `createdBy:user,requestId`. Restart/redelivery requeues unfinished requests; deletion cannot remove their parents. The header and custom-question panel show waiting state. Both add-three controls call `/api/more`.

Double click delays single-click opening by the local desktop interval plus a short guard, centers the target, and displays only it and its ancestor chain. `isolated` holds the target and previous filter. An eye button restores the previous filter; choosing a new filter exits isolation and uses that filter. Polling never restores the open drawer’s unrelated node during isolation. If the target disappears, restore the filter safely. Root right-click opens general project discussion; ordinary card right-click opens child creation. Option explanations submit a separate quoted discussion without submitting an unfinished user draft. They retain unsent message/quote on errors or while busy; completion of an earlier request cannot erase later drafts or explanations.

For a spec request, `gradingNodes` freezes full grading context at capture. Captured grades apply the same moves/removals/additions to this context, while unrelated live changes are excluded. The document `nodes` projection strips discussion/options/pending text. Changed-after-capture nodes cannot be removed by captured grading. The waiter prioritizes captured pending answers and removes explicitly deleted IDs from `waiting`.

The served page embeds `PAGE_DOUBLE_CLICK_MS`. The server reads the local desktop interval on page load (Windows GetDoubleClickTime through built-in PowerShell, macOS NSEvent through osascript, explicitly identified GNOME sessions through gsettings), with a three-second bound and hidden Windows helpers. Unavailable settings use a conservative 5000 ms fallback. `GRILL_DOUBLE_CLICK_MS` (positive milliseconds, up to 10000) overrides detection for other desktops or accessibility settings; reload after changing the system preference. The renderer adds a 100 ms guard and validates numeric injection. A second mousedown cancels pending opening before its mouseup, including held second clicks. Keyboard activation stays immediate.

Map rendering reuses visible card buttons and their unchanged markup across polls to retain native gesture targets and focus. A newer panel action, outside pointerdown or Escape cancels a pending single-card timer. On regrading, retained follow-ups can satisfy the worker’s question counts without adding new children.
