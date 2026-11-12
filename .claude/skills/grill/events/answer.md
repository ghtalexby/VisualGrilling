# Answer grading

- `{"type":"answer", ...}`: grade the answer using the rules below, send the result, then return:

  ```bash
  G apply <<'EOF'
  {"type":"answer","id":"<event id>","token":"<event token>","status":"weak","verdict":"...","children":[{"q":"...","why":"...","options":["...","..."]}],"newRoot":null,"semantics":{"topics":[],"relates":[],"decision":"..."}}
  EOF
  ```


## Branch review

For an answer, inspect the complete `context.focus` branch (IDs, parents, answers, verdicts, pending work, and chat). Review all affected questions regardless of `createdBy`. Keep relevant questions, their IDs, grades and chats. `children` now ADDS follow-ups and never implicitly deletes existing descendants. Omitted `branchChanges` preserves existing descendants.

Follow-up counts below apply only to newly needed questions. Use `children:[]` when retained questions already cover the weakness; do not add questions just to meet a minimum count on regrading.

Use `branchChanges:{remove:["obsolete-id"],move:[{id:"kept-id",parentId:"parent-id"}],add:[{key:"$new",parentId:"existing-id",q:"...",why:"...",options:["...","..."]}]}` for semantic restructuring. Additions can reference other additions by their `$key`, including forward references. Moves can also reference those keys. All operations are confined to the graded subtree; the graded node itself cannot move or be removed. `newRoot` remains the separate route to add a main question. Remove obsolete decisions explicitly; a removed parent’s children must also be explicitly removed or moved. Never remove a card with `conflictOf`: it records a disagreement only the user settles, and the server rejects that. Cycles, missing parents, duplicate operations and outside IDs are rejected atomically. Do not rewrite existing question meaning while keeping its grade: remove it and add a new open question instead. Retained answers, discussions and queued work survive; removed nodes’ work is discarded. Preserve parents listed in `questionRequests` until their custom questions have been prepared.

Limits: 500 nodes / 600000 serialized characters per graded subtree; at most 500 removals, 500 moves, 20 keyed additions, 4 direct children. On `capturedForSpec:true`, use only the frozen `context` and delivered answer for decisions; ignore later activity and discussions. `protectedIds` identifies nodes changed after capture (including later chat); do not remove them. The server applies structure and captured grades to the frozen specification tree independently of current answers. Later work is never imported into that snapshot.


### Grading rules

Answer events contain `question`, `answer`, `previousAnswer` if rewritten, `level`, and focused `context` (ancestors and subtree included).

- `verdict`: 1–2 sentences, up to 220 characters, explaining strengths or weaknesses and why. No polite preamble.
- `children`: simpler, concrete follow-ups targeting the weakness, answerable with a fact, number, or yes/no. Counts: `ok` 0–1; `weak`/`verify` 1–3; `gap` 1–2 about finding an answer quickly (who, what to measure, timeframe). At level 4 or deeper, at most one, preferably none. Run `G index --questions` and read plausible semantic duplicate candidates before adding a question. Options should be realistic author answers rather than hints at the correct answer.
- `newRoot`: only when an answer reveals a serious issue in another area absent from the map. Supply `{"area","q","why","options"}` or null.

Answers can combine multiple selected options and a free-text comment. Evaluate the entire answer; contradictory choices require clarification rather than silently choosing one.

Be tough but constructive. Find where the project could fail; do not try to defeat its author.
