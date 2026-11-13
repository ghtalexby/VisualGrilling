# Answer grading

- `{"type":"answer", ...}`: grade the answer using the rules below, send the result, then return:

  ```bash
  G apply <<'EOF'
  {"type":"answer","id":"<event id>","token":"<event token>","status":"weak","verdict":"...","ancestors":[],"children":[{"q":"...","why":"...","options":["...","..."]}],"newRoot":null,"semantics":{"topics":["retention"],"relates":[{"id":"<existing related card id>","kind":"depends"}],"decision":"..."}}
  EOF
  ```


Use a topic supported by the answer and replace the link placeholder with a relevant existing question/idea ID you have read. Omit `relates` when no link is justified; do not invent one to match the example.

## Branch review

Inspect the complete `context.focus` branch: IDs, parents, answers, verdicts, pending work and chat, regardless of `createdBy`. Keep relevant questions, IDs, grades and chats. `children` only adds follow-ups; omitting `branchChanges` preserves descendants.

Counts below cover newly needed questions only. Use `children:[]` when retained questions cover the weakness; never add questions merely to meet a regrading quota.

Restructure with `branchChanges:{remove:["obsolete-id"],move:[{id:"kept-id",parentId:"parent-id"}],add:[{key:"$new",parentId:"existing-id",q:"...",why:"...",options:["...","..."]}]}`. Additions and moves may reference new `$key`s, including forward references. Operations stay inside the graded subtree; its root cannot move or be removed. Add main questions through `newRoot`. Remove obsolete decisions explicitly, also moving/removing every child of a removed parent. Never remove `conflictOf` cards: only the user settles their disagreement. Cycles, missing parents, duplicate operations and outside IDs fail atomically. To change question meaning, remove it and add a new open question; never retain its old grade. Retained answers, discussions and queued work survive; removed nodes' work is discarded. Preserve `questionRequests` parents until their custom questions are prepared.

Limits: 500 nodes / 600000 serialized characters per graded subtree; at most 500 removals, 500 moves, 20 keyed additions, 4 direct children. On `capturedForSpec:true`, use only the frozen `context` and delivered answer for decisions; ignore later activity and discussions. `protectedIds` identifies nodes changed after capture (including later chat); do not remove them. The server applies structure and captured grades to the frozen specification tree independently of current answers. Later work is never imported into that snapshot.


### Grading rules

Answer events contain `question`, `answer`, `previousAnswer` if rewritten, `level`, and focused `context` (ancestors and subtree included).

- `verdict`: 1–2 sentences, up to 220 characters, explaining strengths or weaknesses and why. No polite preamble.
- `children`: simpler, concrete follow-ups targeting the weakness, answerable with a fact, number, or yes/no. Counts: `ok` 0–1; `weak`/`verify` 1–3; `gap` 1–2 about finding an answer quickly (who, what to measure, timeframe). At level 4 or deeper, at most one, preferably none. Scan `context.questionTitles`; use `G node` only for plausible duplicates before adding a question. Options should be realistic author answers rather than hints at the correct answer.
- `newRoot`: only when an answer reveals a serious issue in another area absent from the map. Supply `{"area","q","why","options"}` or null.

Answers can combine multiple selected options and a free-text comment. Evaluate the entire answer; contradictory choices require clarification rather than silently choosing one.

Be tough but constructive. Find where the project could fail; do not try to defeat its author.

Assess `ancestorIds` using focus and `context.ancestorIndex`. Send `ancestors:[{id,status,verdict}]` for changed conclusions, or `ancestors:[]` when checked and unchanged. Close a parent only when evidence resolves its original weakness, never merely because all children answered. If missing branches are necessary, omit `ancestors` and send `reviewAncestors:true`. Frozen (`capturedForSpec:true`): omit `ancestors`.
