# 4.4 Level 2: dispatcher and per-event worker

Use this level only with verified level 1 background wake-up AND a foreground subagent with shell access (Claude Code Agent tool; Kimi Code CLI `Agent`). Verify that the chosen worker model can run `G apply` before relying on this level. Otherwise keep level 1 or 0. Codex monitor uses its own prepare-only worker procedure in monitor.md; the main session owns apply. Level 0 handles events in-session.

Setup after init or when resuming:

- Run `G config` and remember `roles.griller.model`. Defaults come from `config.default.json`; optional `<--dir>/config.json` (default `.grill/config.json`, shared across maps) overrides it. Supported values: `inherit`, `opus`, `sonnet`, `haiku`. On config errors, diagnose the named file instead of silently using a different model.
- Read the server-generated `<map directory>/session.md`. Preserve existing notes on resume, merge verified facts gathered for the brief (key files, stack, code decisions), and send `G apply` with `{"type":"notes","text":"<complete notes, at most 3000 characters>"}`. The server owns this file.

Loop:

1. Arm `G watch --inbox --max-wait <N>` in the background using the level 1 host limits and remember its task identifier. End the turn with a one-line localized status.
2. On a work-event line, start one fresh foreground worker with the prompt below, without inherited conversation history. Use the configured model: `inherit` means omit the model argument. On Kimi pass a model only when the user has a subagent model pool. Wait for the worker to finish; never arm watch or call wait for that map during grading, as a new waiter takes back thinking work.
3. On `expired:true`, re-arm silently. On exit 2, run `G start` with the map's selected language option and re-arm. Diagnose other transport errors. Do not open inbox JSON in the main context on the normal path.
4. After the worker returns, optionally relay its one-line status and follow [parallel-maps.md](parallel-maps.md) before re-arming that map. A 409/404 means stale work: just re-arm. A reported "reread refused" is a completed result: relay it and re-arm. If it failed, returned nothing, or reported another error, handle that same inbox event yourself using `worker.md` before re-arming. Check current state first when success is uncertain: `more` has no delivery token, so do not blindly replay an already successful apply; complete only missing work (e.g. notes or report). Do not call wait to inspect state. Diagnose unresolved failures instead of silently dropping the event.
5. All level 1 rules apply: one watch per map, never wait alongside it for that map, normal chat while armed, no idle pause. To stop, finish or interrupt the worker before stopping the map; do not re-arm.

Worker prompt (fill in absolute paths and exact map options; omit `--name` for legacy maps):

```text
You are a grilling worker for map "<name>". Read "<skill directory>/worker.md" and only its routed rules file for this event, and follow them exactly.
Command: node "<skill directory>/grill.mjs" <command> --name <name> (add --dir "<dir>" if used)
Project directory: <cwd>
Session file: <map directory>/session.md
Event: type=<type> id=<id when present> token=<token when present>; full event in <inbox path>
Language: <language>
```
