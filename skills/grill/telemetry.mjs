// Observational delivery telemetry; these values never authorize work.
export const usageFields = ["input_tokens", "cached_input_tokens", "output_tokens"];
export function finishUsage(entry, latest, identity) {
  entry.closedAt = Date.now();
  if (!entry.usageStart) return entry.usageDeltaStatus = "missing-start";
  if (!latest) return entry.usageDeltaStatus = "missing-end";
  if (entry.usageSession !== identity) return entry.usageDeltaStatus = "session-changed";
  entry.usageEnd = Object.fromEntries(usageFields.map(k => [k, latest[k]]));
  if (!usageFields.every(k => Number.isSafeInteger(entry.usageEnd[k]) && entry.usageEnd[k] >= entry.usageStart[k])) return entry.usageDeltaStatus = "counter-reset";
  entry.usage = Object.fromEntries(usageFields.map(k => [k, entry.usageEnd[k] - entry.usageStart[k]]));
  return entry.usageDeltaStatus = entry.usageTreeComplete === false || latest.tree?.complete === false ? "incomplete-tree" : "observed";
}
export function workerDeclaration(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => k !== "workerSessionId") || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.workerSessionId || "")) throw [400, "Некорректная телеметрия работника"];
  return value.workerSessionId.toLowerCase();
}
export function fieldChanges(before, after) {
  const a = new Map(before.map(n => [n.id, n])), b = new Map(after.map(n => [n.id, n]));
  const fields = { status: n => n?.status, answer: n => n?.answer, verdictText: n => n?.verdict, topology: n => n && [n.parentId, n.kind, n.obsolete] };
  return Object.fromEntries(Object.entries(fields).map(([key, select]) => {
    const ids = [...new Set([...a.keys(), ...b.keys()])].filter(id => JSON.stringify(select(a.get(id))) !== JSON.stringify(select(b.get(id))));
    return [key, { count: ids.length, ids }];
  }));
}
