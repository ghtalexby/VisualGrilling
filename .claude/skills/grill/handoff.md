# Codex file handoff

Hub-managed maps: preserve the supplied `hubEpoch`; include `--hub-epoch <captured epoch>` in every `G` command and copy it into every apply JSON, including notes and staged replies. On an epoch/Stop rejection, end this map loop; never claim or read a replacement epoch. Play preserves state and replays unfinished work; never initialize it.

Use `G wait --timeout 15 --inbox` or `G monitor --event <delivery> --inbox`. Pass the returned header (type, id, token, inbox path) to one fresh worker, without loading the full event in the parent. Timeout stays inline. Do not use --inline for delegated work.

The worker reads session.md, inbox and current rules, checks identity, prepares ordinary apply JSON and writes UTF-8 without BOM to `<map directory>/result-<token>.json`. This is an authorized map-state write; never overwrite inbox/session. Return only `{type,id?,token,resultFile}` and optional bounded proposed notes; never echo the full result. Use separate token-specific files for multipart discussion, returning ordered paths. The main session alone applies each part; only the final part may rearm. On failure return a concise error; the parent inspects current work before fallback.

The parent keeps the expected token from the original header and runs `G apply --file "<resultFile>" --token "<expected>"` (add --rearm only in pure monitor). The CLI validates file size, inbox type/id/token and the expected token; the server validates current ownership and freshness. Failure results may use type failure with the same token. Do not apply a worker-supplied token without comparing it to the original header. Notes remain a separate ordinary apply notes operation. Use the selected waiting mode's ordering and do not rearm during preparation or multipart apply.

A 400 requires correcting the same result file; a 409 discards stale work under the mode's recovery rules. Keep token-specific files for diagnosis; never delete user map evidence as cleanup. Existing stdin apply and HTTP consumers remain supported.
