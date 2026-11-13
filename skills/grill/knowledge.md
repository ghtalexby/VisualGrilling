# Project knowledge worker protocol

Read this file before handling `knowledge`, with the shared worker procedure.

## Context selection

Use the shared [worker context-selection rules](worker.md#context-selection).

## Extraction

The server queues `knowledge` after successful rereads when the `knowledge.rereadThreshold` changed-answer threshold is met (default five), and always before finish. Its nodes include all current questions, historical cards, answers and discussions. Compare the full delivered evidence with existing knowledge and relevant external documents. Repeated evidence must update the existing stable ID, not create another entry. Reuse an existing document path even if the term's spelling changed.

Organize by architectural topic, not a copy of the source tree. Use a shared glossary for common terms and topic glossaries for local meanings. Merge compatible local definitions when promoting a common term, retaining superseded records and their sources. Preserve incompatible meanings and ask people. Keep decisions, hypotheses, ideas, technical descriptions and notes distinct. `ok` is a question grade, not factual verification or acceptance of an agent suggestion. A decision requires explicit user acceptance in an answer/discussion. Silence never counts.

Compare with code, existing specs and other definitions. Never resolve conflicts by recency or author seniority. Preserve both grounds as `conflict`; ask on the map and propose a new focused grilling to settle the definition. A settled definition must reference that session and the superseded IDs. Do not resurrect superseded definitions when importing history. Current extraction must not change a frozen specification snapshot.

## Editable format

One record per Markdown file, in a topical directory, for example `docs/vgril/settings/terms/profile.md`. Use lowercase ASCII path segments and `.md`. The first block is machine-readable; the rest is freely editable prose:

````markdown
<!-- vgril:1 -->
```json
{"id":"settings-profile","type":"term","scope":"settings","status":"current","supersedes":[],"conflicts":[],"author":{"name":"Name","session":"session-id","date":"2026-11-09"},"sources":[{"path":".grill/settings/state.json","map":"settings","card":"n123","session":"session-id","version":"sha256"}]}
```

# Profile

Definition, evidence, limitations and links in the map language.
````

Types: `term|technical|decision|hypothesis|idea|note`. Statuses: `current|superseded|conflict`. Keep stable `id`, `scope`, `supersedes` and `conflicts` ID arrays. Preserve prior sources when revising a record. Saved sources have `path`, SHA-256 `version`, and an exact `snapshot` (at most 30000 characters). For current-map entries use delivered `sources:[{card,version}]`, adding `path:sourcePath`, `map`, and `session`; omit `snapshot` in your output, as in the example. On apply the server injects the exact captured snapshot for matching current-session versions and rejects unknown versions with 400. Never reconstruct it from live state or semantic summaries. Preserve prior sources and manual refinements, including their snapshots. Saved files embed evidence even when `.grill` is absent; semantic annotations are excluded from source snapshots and version hashes. Label local map links as local-only; display absent sources honestly. For external documents use their project-relative path, SHA-256 of the complete UTF-8 text, and an exact quoted excerpt. Do not invent a historical author; use `author:null` when unknown.

For a newly introduced term, use the event's effective Git `author`, session and date. Never use the last committer. If absent, ask on the board how to record the author, then reuse that explicit answer only within this map session. Read that answer from the next delivered snapshot. Do not assign the importer's name to old terms. Imported unknown authors stay null and may be clarified on the board without inventing history.

Before writing, reread every target file and preserve manual refinements. Use its SHA-256 as `expected`, or null for a new file. A malformed metadata block is an explicit error: keep the original untouched and explain the parse problem. Ordinary user Markdown never becomes generator-owned because it is in `docs/vgril/`.

Apply `{type:"knowledge",token,files:[{path,expected,text}]}`. Maximum 30 files, 200000 characters per file, subject to the existing 1 MB request limit. `files:[]` means a substantive comparison found no updates; do not use it to bypass an error, missing context or unresolved author. A successful response includes operation ID and paths. On failure, report `{ok:false,error}` honestly.

To request clarification use `{type:"knowledge",token,error:"localized reason",questions:[{q,why,options,area}]}` with up to three questions. The job blocks, including during finish. Questions use the ordinary answer/discussion flow; after all have answers the job is delivered again. For a conflict needing a separate session, explain that requirement and keep the save blocked until the needed evidence exists or the user explicitly skips. Do not repeatedly add the same question. A blocked job offers browser Retry; use `G knowledge-retry` only after addressing the cause. A new delivery invalidates old analysis. Retry reconciles partial on-disk results and keeps backups; read them and all changed targets before proposing another update.

Finish arrives only after other work drains and knowledge is saved, or the user explicitly chooses Finish without saving knowledge. Only a direct user request authorizes `G knowledge-skip`; never choose it for convenience. Echo the finish token. Skipped saving is recorded as skipped, never success. Do not end the dispatch loop on a knowledge failure: answers and clarification discussions must still be processed.

## Import and generated specifications

Run `G knowledge-import` only for an explicit request to seed memory from old maps/specs. First inventory the refreshed index, then read selected archives and specs, compare all definitions and expose conflicts. For an archived card, use the raw saved node JSON and its SHA-256; preserve unknown authors. This is a separate semantic review, not automatic extraction on startup.

Generated specs live in `docs/vgril/specs/`. `G spec-migrate` migrates the selected map's old generated spec after ownership, collision and version checks, rebases its outgoing relative links, and updates `specFile`. The old file is retained as a compatibility snapshot so existing incoming links still resolve; report it and update references to the new canonical path during the requested migration review. It is not a second actively generated spec. Inventory and migrate each old map explicitly when doing a project-wide import. User documents remain theirs. Migration preserves the full old text including manual edits; a later explicit Update spec still replaces the generated spec, as the UI warns.

For an existing managed document, use `{path,expected,body,meta?,sourcesAdd?}` instead of `text`. `body` replaces prose after the metadata fence. Omitted metadata is preserved; `meta` shallow-merges only status/supersedes/conflicts. `sourcesAdd:[{card,version}]` appends current-event sources with server-injected path, session and snapshots. Body-only edits preserve the metadata block byte for byte. Full `text` is still supported; do not combine it with `body`.
