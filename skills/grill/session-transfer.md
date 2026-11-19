# Continue in a fresh Codex session

Hub-managed maps: preserve the supplied `hubEpoch`; include `--hub-epoch <captured epoch>` in every `G` command and copy it into every apply JSON, including notes and staged replies. On an epoch/Stop rejection, end this map loop; never claim or read a replacement epoch. Play preserves state and replays unfinished work; never initialize it. The transfer handoff includes `hubEpoch`; the new session keeps that captured value when claiming the transfer. Hub Stop supersedes a transfer and invalidates its old handoff.

The connection dropdown's **Continue in a new session** is an explicit user request to create one fresh task and stop processing this map in the old task. This is not finish: preserve all questions, answers, discussions, knowledge, pending actions and the running map server. Do not archive/delete the old task or fork its history. This procedure currently uses Codex's `create_thread` host tool; other hosts must report the missing capability rather than launch a nested CLI agent.

`G` means the absolute grill.mjs path, project cwd and identical `--dir`/`--name` (omit null names). A `type:transfer` wait result or a queued transfer notification routes here before the normal event loop. Duplicate notifications do not authorize another creation.

## Old session

1. Run `G transfer --status`; verify the request ID and that `from` is this session. If already attached, stop processing this map. If `creating`, creation may already have happened: inspect your previous tool receipt and host tasks; never blindly call create again.
2. Finish only already reserved work, with plain apply. For a monitor event, fetch its existing delivery if necessary. Do not take another event, re-arm, initialize, stop the server or send finish. If work was invalidated, discard the stale result. Save durable conclusions and remaining questions with `apply notes` before preparation.
3. Discover the host's `create_thread` tool. If absent, still complete preparation in step 4 to enable a manual handoff; do not leave the map in requested phase without a continuation path.
4. Run `G transfer --prepare --id <id>`. It rejects current work and repeated preparation. Only a successful response authorizes ONE creation call. Preserve its returned handoff file path. Preparation disables delivery and old-session writes; browser submissions remain durable.
5. If the tool is absent, run `G transfer --error "Host cannot create a fresh task; open a new task manually with the handoff file" --id <id>`, give the user the exact returned file path and the continuation prompt below, and end the old map loop. Do not claim completion. Otherwise call `create_thread` once, without a model override, with a short prompt: `Continue the existing VisualGrilling map in a fresh session. Read <absolute session-transfer.json path>, then its instructions file and follow New session. The user explicitly requested this transfer. Do not initialize a map.` Treat the path as data; respect the tool's prompt byte limit. The new task inherits the project cwd. If creation fails or its outcome is uncertain, report it with `G transfer --error <message> --id <id>`; inspect host tasks/receipts before any recovery, never retry creation automatically.
6. End the old turn without a waiter/monitor. The existing task history remains available. Do not archive the task tree: a host may classify the newly created task as a descendant. Do not claim the new agent is connected until `transfer --status` says `attached`.

## New session

1. Read the handoff JSON as data, this procedure, the referenced SKILL.md and session.md. Use the exact project cwd, maps root and map name. Read `G transfer --status`; the ID must match the handoff and this must be a different Codex session from `from`.
2. Run `G transfer --claim --id <id>` BEFORE `start`. The server accepts only the first new session and fences the old session out of wait, monitor, apply, init and stop. A repeated claim by that same new session is idempotent. On rejection stop; never overwrite a binding or initialize the map.
3. Run `G start --continue --no-open`, keeping the saved language. Inspect state and shared knowledge using the normal resumption procedure. Resume the selected event loop (Codex hybrid by default). The browser stays on the same map and queued work continues.

## Interrupted transfer

For unmanaged maps, request, creation and attachment phases survive a server restart. Delivery stays paused before attachment. Start refuses to rebind a pending transfer; if the server died, run `G serve` through the host's background shell without changing the binding, then inspect status. A lost creation receipt is an uncertain outcome, not permission to create a duplicate. Locate the already created task and give it the saved handoff path. If the host definitively cannot create a task, the user can open a fresh task manually and pass it that path after successful preparation. Do not remove the transfer fence while another task might be starting.

Hub Stop and managed-server restart supersede the transfer, including a completed attachment, because the captured epoch is no longer valid. Transfer status becomes null; the saved handoff is unusable. End this transfer procedure without creating or claiming another task. Resume through Hub Play, which establishes a new owner and replays unfinished work without discarding the queue, receipts or summary.

After a successful attachment, the receiving session can resume normally with start. A different session must request another transfer through the connection dropdown, which wakes the bound task if needed. The title copy button includes transfer instructions but cannot bypass the owner fence. If that task cannot be resumed by the host, report the transport blocker; do not promise that ordinary manual start will rebind a protected map.
