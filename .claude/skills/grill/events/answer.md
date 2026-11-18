# Answer grading

Return `{type:"answer",id,token,status,verdict,coverage,ancestors,semantics}`. Use [coverage.md](../coverage.md) for all missing clarifications and [shell-json.md](../shell-json.md) to pass JSON safely. Semantics must describe actual evidence; omit unjustified links.

## Branch review

Inspect the complete `context.focus` branch: IDs, parents, answers, verdicts, pending work and chat, regardless of `createdBy`. Keep relevant questions, IDs, grades and chats. `children` only adds follow-ups; omitting `branchChanges` preserves descendants.

Counts below cover newly needed questions only. Use `children:[]` when retained questions cover the weakness; never add questions merely to meet a regrading quota.

Restructure with `branchChanges:{remove:["obsolete-id"],move:[{id:"kept-id",parentId:"parent-id"}],add:[{key:"$new",parentId:"existing-id",q:"...",why:"...",options:["...","..."]}]}`. Additions and moves may reference new `$key`s, including forward references. Operations stay inside the graded subtree; its root cannot move or be removed. Add main questions through `newRoot`. Remove obsolete decisions explicitly, also moving/removing every child of a removed parent. Never remove `conflictOf` cards: only the user settles their disagreement. Cycles, missing parents, duplicate operations and outside IDs fail atomically. To change question meaning, remove it and add a new open question; never retain its old grade. Retained answers, discussions and queued work survive; removed nodes' work is discarded. Preserve `questionRequests` parents until their custom questions are prepared.

Limits: 500 nodes / 600000 serialized characters per graded subtree; at most 500 removals, 500 moves, 500 keyed additions, 500 direct children (subject to the total branch limit). On `capturedForSpec:true`, use only the frozen `context` and delivered answer for decisions; ignore later activity and discussions. `protectedIds` identifies nodes changed after capture (including later chat); do not remove them. The server applies structure and captured grades to the frozen specification tree independently of current answers. Later work is never imported into that snapshot.


### Grading rules

Answer events contain `question`, `answer`, `previousAnswer` if rewritten, `level`, and focused `context` (ancestors and subtree included).

- `verdict`: 1–2 sentences, up to 220 characters, explaining strengths or weaknesses and why. No polite preamble.
- `children`: concrete follow-ups targeting every uncovered weakness at any depth. Prefer `coverage.questions` to identify which gap each new question covers. Reuse suitable existing questions anywhere on the map; never add a duplicate to meet a quota. See the shared coverage procedure. Options are realistic author answers.
- `newRoot`: only when an answer reveals a serious issue in another area absent from the map. Supply `{"area","q","why","options"}` or null.

Answers can combine multiple selected options and a free-text comment. Evaluate the entire answer; contradictory choices require clarification rather than silently choosing one.

Be tough but constructive. Find where the project could fail; do not try to defeat its author.

Assess `ancestorIds` using focus and `context.ancestorIndex`. Send `ancestors:[{id,status,verdict}]` for changed conclusions, or `ancestors:[]` when checked and unchanged. Close a parent only when evidence resolves its original weakness, never merely because all children answered. If missing branches are necessary, omit `ancestors` and send `reviewAncestors:true`. Frozen (`capturedForSpec:true`): omit both fields.
