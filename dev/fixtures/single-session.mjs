// Synthetic evidence only. This is not a captured Languages map or a grading oracle.
const topics = [
  ["Locale selection", "Which locale wins when URL and account settings differ?", "The explicit URL locale wins; account preference is the fallback."],
  ["Path encoding", "How are slashes inside translation keys represented?", "Encode a slash inside a key as %2F; hierarchy separators remain literal slashes."],
  ["Fallback", "What happens when a translation is missing?", "Use the default-language value and record the missing key."],
  ["Concurrency", "How are simultaneous translation edits protected?", "Require an expected revision; reject stale writes without changing content."],
  ["Security", "Who can publish translations?", "Only a project editor can publish after tenant authorization."],
  ["Retention", "How long are deleted translations retained?", "Keep recoverable tombstones for 30 days, then require an explicit cleanup operation."],
  ["Import", "How is a malformed import handled?", "Validate all rows before committing any row; return indexed errors."],
  ["Export", "Can export modify translations?", "Export is read-only and uses one captured project revision."],
  ["Audit", "What information is recorded for edits?", "Record actor, revision, timestamp and changed keys without secrets."],
  ["Rollback", "Does rollback erase later history?", "Rollback creates a new revision and preserves prior revisions."],
  ["Performance", "What proves the latency target?", "We target p95 below 200 ms but have no representative load measurement yet."],
  ["Operations", "How are restore procedures validated?", "No restore exercise has been run; the owner and schedule are undecided."]
];
export function fixture(workload) {
  if (!["standard", "broad-substitute"].includes(workload)) throw new Error("Неизвестный сценарий.");
  const broad = workload === "broad-substitute";
  const cards = Array.from({ length: broad ? 73 : 12 }, (_, i) => {
    const [area, q, answer] = topics[i % topics.length];
    return { id: `q${i + 1}`, parentId: i < 12 ? "root" : `q${i % 12 + 1}`, kind: "q", status: "open",
      area, q: i < 12 ? q : `${q} (tenant profile ${i + 1})`, why: "Check the authored contract and identify missing evidence.", options: [],
      ...(broad ? { answer: i < 12 ? answer : `Tenant profile ${i + 1}: ${answer}`, verdict: "Synthetic starting evidence; requires substantive reread." } : {}) };
  });
  const post = (id, route, body) => ({ id, route, body, drainBeforeNext: true });
  const answers = topics.map(([, , answer], i) => post(`answer-${i + 1}`, "answer", { id: `q${i + 1}`, answer }));
  const steps = [
    ...(broad ? [post("full-reread-initial", "reread", {})] : answers),
    post("root-discussion", "discuss", { id: "root", message: "Check all decisions against docs/contract.md. Explain unresolved evidence, required clarifications and cross-branch conflicts; preserve sources." }),
    post("correction", "answer", { id: "q2", answer: "Correction: a slash inside a key is encoded as ~1. Literal slashes separate hierarchy segments. The earlier %2F statement is superseded." }),
    post("cross-branch-conflict", "answer", { id: "q8", answer: "Export must decode %2F inside keys, despite the updated path-encoding decision using ~1. We have not resolved this disagreement." }),
    post("card-discussion", "discuss", { id: "q2", message: "Compare the export answer with this corrected decision. Preserve both statements and ask only the necessary conflict clarification." }),
    post("full-reread-final", "reread", {}),
    post("specification", "spec", {}),
    post("finish-with-knowledge", "finish", {})
  ];
  return {
    label: broad ? "Synthetic 73-card broad-evidence substitute; NOT historical Languages replay" : "Synthetic standard 12-answer workload",
    project: { "README.md": "# Translation service fixture\n\nDisposable authored evidence for matched sessions. Read docs/contract.md; no implementation or performance measurements exist.\n",
      "docs/contract.md": "# Translation decisions\n\n" + topics.map(([area, , answer], i) => `## ${area}\n\n${i === 1 ? "Current contract: encode a slash within a key as ~1. Earlier %2F guidance is obsolete." : answer}\n`).join("\n") },
    state: { version: 0, title: "Translation fixture", brief: "Review a translation service; distinguish requirements from measured evidence.", arch: "Versioned tenant-scoped store and read-only exports.", notes: "", reserve: null, reserveRevision: null, reevaluation: null,
      nodes: [{ id: "root", parentId: null, kind: "root" }, ...cards], queue: [], questionRequests: [], summary: null, finished: false, morePending: false, finishPending: false, rereadJob: null, rereadResult: null },
    steps,
    warmup: Array.from({ length: 8 }, (_, i) => post(`warmup-${i + 1}`, "discuss", { id: "root", message: `Warm-history review ${i + 1}: inspect ${topics[i][0]} in the full authoritative contract and map. Explain dependencies, open questions and evidence limits. Do not change decisions without evidence.` })),
    semanticChecklist: ["Review every initial and added card", "Preserve superseded %2F answer and corrected ~1 decision", "Expose unresolved export conflict", "Do not claim measured latency or tested restore", "Check required clarification coverage and ancestor assessments", "Check knowledge provenance and specification coverage", "Record A/B differences and unresolved review questions"]
  };
}
