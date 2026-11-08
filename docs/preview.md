# Visual explanations

Preview cards are local explanatory projects, not changes to the application under review. Use Create preview on a project or card menu, choose an existing instance or a separate project, then ask the agent for options. Root requests require explicit branch selection. Choose an option or enter a request to build. Generation shares the sequential event queue; it does not run in parallel with grading.

Double-click a preview to open the full-screen viewer. Polling retains the iframe and its controls. A published replacement is offered through Refresh viewer; this also protects an open version while values are unsaved. Save values stores settings for the displayed commit without enqueuing agent work, including when publication has selected a newer commit. Unknown or deleted projects/commits are rejected; restore still requires the selected commit and epoch. Create new version starts with model defaults; Restore selects an old commit and that commit's last saved settings. Closing, refreshing, restoring, deleting or rebuilding the open instance offers Save / Continue without saving / Cancel. Closing the browser tab uses its native unsaved-changes prompt, which cannot offer a custom asynchronous Save button.

## Supported project format

The manifest is an object of file names to strings, at most 32 files and 700000 UTF-8 bytes serialized. Each string is at most 250000 characters. `index.html` and `script.js` are required; `style.css` is optional. Local raster pictures use `images/<name>.png|jpg|gif|webp` with base64 content and verified signatures. Names contain only ASCII letters, digits, underscores and hyphens (1–60 characters). No packages, imports, build, dev server, SVG assets or arbitrary paths.

HTML is an inert fragment sanitized by a trusted renderer. It accepts common structural/text/table/form controls and SVG diagram shapes; scripts, frames, links, forms, event attributes and inline styles are removed. Style the fragment through `style.css` and classes. Pictures reference a manifest image name in `src`; the renderer embeds data URLs. CSS imports, URL functions and escape sequences are rejected; external resources are also blocked by CSP. Put local images in HTML img elements.

JavaScript is a **worker state reducer**, not a DOM script:

```js
const initialState = { diameter: 120 };
function update(state, event) {
  return event.type === "input" ? { ...state, [event.name]: event.value } : state;
}
```

State is a flat JSON object with string, finite numeric, boolean or null values (60000 serialized characters maximum). `data-bind="diameter"` on an input/select binds a value; `data-text` binds text, `data-width` / `data-height` / `data-radius` bind pixel sizes (clamped to 0–10000), and `data-color` binds a six-digit hex background color. Buttons use `data-action` and receive `{type:"action",name}`. Inputs produce `{type:"input",name,value}`. Unknown HTML attributes are removed. SVG diagrams use static shapes/text, with viewer zoom and camera controls. The agent edits blocks, labels and relationships; this is not a manual diagram editor. The circle fixture in `dev/fixtures/preview.mjs` demonstrates the format.

Only trusted code executes in the iframe window. Project JavaScript executes in a Blob worker inside a sandbox iframe (`allow-scripts`, no `allow-same-origin`). It has no document or navigation API. The iframe's nonce CSP allows its trusted script, inline CSS, embedded raster images and Blob workers; network, frames, objects, forms and base URLs are forbidden. Fetch/imports are unsupported. The worker has a three-second response deadline. Parent/iframe messages validate source window, random viewer instance, request ID and payload size. No message can invoke an arbitrary map API or submit an answer. Save has a five-second timeout; failure retains dirty state.

Export SVG downloads a static picture of the current view, with computed styles, raster data and control values embedded and no project JavaScript. Open it in a browser supporting SVG foreignObject. It is not an interactive project export. The viewer's zoom/camera is included; export is viewport-sized.

## Version, state and retention decisions

Each preview has a server-generated project UUID separate from its map node ID and placement. `<map>/previews/<UUID>/` is a private Git repository, with concrete source files and a committed manifest. API reads always use the selected commit's manifest, never partially written working files. Publication validates the whole manifest, commits, then atomically saves the map's commit pointer. Interrupted or failed commits do not replace the visible version. Git is required and is never installed automatically; fixed argv, no shell, empty hooks/templates, no signing or remote operations, and isolated Git environment/configuration are used.

The state file stores ordered versions, their captured source hashes, and each commit's latest `savedState` and `stateRevision`. Restore changes the selected pointer and operation epoch without deleting newer history. Work captures context at request time and validates delivery token, project ID, base commit and epoch. Answer changes can complete with a stale marker; restore/deletion invalidate delivery. Restart/new wait requeues pending preview operations with new tokens.

Staleness compares actual source projections, including submitted pending answers and discussion, rather than global map version. Obsolete answers are excluded. A question preview uses its ancestor line and any unambiguous single-child continuation; new answers there mark it stale, and a successful refinement moves it to the captured last question; root preview uses only selected branches plus root discussion. Saved values are included in subsequent relevant answer and build events. A branch split copies the ancestor's complete repository and per-commit saved state to independent child instances. A persisted branch record prevents a deliberately deleted copy from being recreated by later grading. A linear extension can move the selected instance; choosing a branch across a split makes an independent copy.

Before source deletion, set Keep separately or Delete together in each dependent preview drawer. All agent tree deletion paths reject a missing decision. Kept projects move to root and show a lost-source label; independent previews are unaffected. Explicit preview deletion removes its working repository. Snapshot storage is separate and never garbage-collected: a specification captures files, purpose, commit, state revision and a copy of saved values under a SHA-256 key. Its local map URL opens those immutable bytes even after preview deletion. URLs require that local map server; they are not portable document attachments. Later generation, Save and restore cannot change a snapshot. Transfer the static SVG for recipients without the map.

## Protocol

All routes are protected by Host validation and `x-grill: 1`, with the unchanged 1 MB request limit.

| Route | Request / result |
|---|---|
| `POST /api/preview/prepare` | `{sourceId,id?,branches?:[]}`; existing ID chooses refinement, omitted ID creates separately; returns preview node ID |
| `POST /api/preview/build` | `{id,request}` (1–3000 characters); queues build after prepared options |
| `GET /api/preview?id=…` | Public card, committed files and that commit's saved state |
| `GET /api/preview/document?id=…&instance=…` | Prepared srcdoc, commit, epoch; `key` instead of `id` loads an immutable snapshot |
| `GET /api/preview/snapshot?key=…` | Immutable snapshot manifest/state |
| `POST /api/preview/save` | `{id,commit,epoch,state}`; bounded 65536-byte JSON, increments that commit’s state revision even if a newer version was published, no event |
| `POST /api/preview/restore` | `{id,commit,epoch,target}`; target must belong to this project's history |
| `POST /api/preview/policy` | `{id,policy:"keep"|"delete"}`; records the user's source-deletion decision |
| `POST /api/preview/delete` | `{id,confirm:true}`; deletes the selected project, retaining snapshots |

`wait` delivers `{type:"preview",id,token,language,projectId,base,phase:"prepare"|"build",sourceId,branches,request,context,files,savedState}`. Apply must repeat `type,id,token,projectId,base`. Preparation returns `{question,options}` (question 500 characters, 2–4 options × 300). Build returns `{purpose,files}` (purpose 500). Either phase may return `{error}` (1000). Invalid results leave the operation available for correction; stale deliveries return 409. At most 20 preview jobs are pending. `init` uses the same source-deletion policy rather than silently discarding projects.

Preview nodes have no grade and are excluded from question counts/audits. Reports, Markdown export and specification snapshots include their purpose/version. Original maps need no migration or reset. Agent instructions are in [worker.md](../skills/grill/worker.md).
