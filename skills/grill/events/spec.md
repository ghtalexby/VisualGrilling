# Specification from answers

Create spec / Update spec is available at any stage, except while a reread is running (409). An explicit user request can also enqueue it with `G spec`. It waits for answers submitted before the request to be graded. Without an agent it remains queued; duplicate clicks are deduplicated.

The event contains `token`, `path`, `requestedAt`, `title`, `brief`, `arch`, and `nodes`: a request-time snapshot supplemented by captured pending grades. Use only this snapshot for decisions and project code for checking technical facts. Nodes with `obsolete` are historical context, not active requirements or unanswered blockers; inspect their non-obsolete descendants independently. Do not mix in later answers, an old spec, or discussions outside the supplied snapshot. Do not edit the destination file directly; the server writes it through `apply`.

Write Markdown in the event's language with six localized sections: Goal, Requirements, Component steps, Dependencies, Checks, Open questions. Produce an actionable plan rather than a transcript. Link decisions to question IDs or text and include child clarifications. Mark `weak` and `verify` as weak decisions / untested assumptions. Treat `gap`, `open`, missing answers, and `awaiting` as gaps blocking dependent steps. Do not invent requirements, deadlines, or agreed decisions. With no answers, produce a scaffold of open questions and blockers.

Send `{"type":"spec","token":"<event token>","markdown":"<complete document>"}` through `G apply` using UTF-8 stdin. Limit Markdown to 100000 characters. If generation is impossible, supply `error` (up to 1000 characters) instead. Check `{ok,path,error?}`: if `ok:false`, report the error and do not claim the file was saved. A 409 means a stale result; return the stale error to the dispatcher.

The server saves `docs/vgril/specs/grill-<name>.md` relative to the project's working directory, or `grill-legacy.md` for an unnamed map. One file per map; an unrelated-file collision is an error. Rebuilding replaces the whole file, including manual edits, and excludes deleted branches. Do not bypass ownership checks or delete another document. Briefly report the saved path in your one-line result.

Captured ungraded answers cannot be changed or withdrawn until graded (409). Later answers belong to the next update. The request and snapshot survive restart; redelivery via `wait` uses a new token. Never retrieve another event yourself.

Between calls, do not repeat questions and answers in the terminal. A short localized status such as Reviewed P2: weak, +2 follow-ups is sufficient.

Before grading code claims such as retries, vaulted keys, or migrations, verify them in project files. State discrepancies directly in the verdict.


Specification events are already filtered to include only ok ideas and their complete subtrees. All other idea branches are absent; do not add them back from live state or an earlier document. Preserve risks of weak/verify questions within an included ok idea. Idea text, verdict and captured chat are available in the snapshot; use those captured discussions only as context, not later discussions. A requested spec waits for captured answers and dependent idea evaluations. Editing idea text cancels an affected spec, waits for live reassessment, then captures a new snapshot with a new delivery token. Later ordinary answers alone do not replace a snapshot.


Specification preview nodes carry purpose and immutable `link`/commit: include those supplied links and explain that they require the local map server. Never replace them with live versions or later saved state. Preview nodes have no grade and are outside question audits/counts. Do not move previews with question operations or add questions beneath them; the server manages their placement through the preview lifecycle.
