import { randomUUID, createHash } from "node:crypto";

// The journal is never compacted: request identities and original inputs survive completion.
export const actionRoutes = new Set(["answer", "discuss", "chatreset", "question", "more", "reread", "spec", "finish", "idea", "idea/analyze", "idea/edit", "idea/delete", "knowledge-import", "spec-migrate", "preview/prepare", "preview/build", "preview/policy", "preview/delete", "preview/save", "preview/restore"].map(x => "/api/" + x));
export const initializeActions = s => { s.actions ||= []; s.archive ||= []; s.replacements ||= {}; s.actionPaused ??= false; };
export const waitingActions = s => s.actions.filter(a => a.status === "queued");
export const activeActions = s => s.actions.filter(a => a.status === "running");
// Admitting a finish forms the boundary (`finishHold` = its sequence): earlier actions still run, later ones wait, also
// if that finish fails. A finish (retry or a new request) and work on the clarification cards a failed finish asked
// for pass; explicit continuation releases the rest.
const passesHold = (s, a) => {
  let origin = a;
  while (origin.retryOf) { const previous = s.actions.find(x => x.id === origin.retryOf); if (!previous) break; origin = previous; }
  return origin.sequence < s.finishHold || origin.internal && origin.resume?.type === "followup" || a.route === "/api/finish" || ["/api/answer", "/api/discuss"].includes(a.route) && !!s.knowledgeResult?.questions?.includes(a.body.id);
};
export const executableActions = s => s.actionPaused ? [] : s.finishHold ? waitingActions(s).filter(a => passesHold(s, a)) : waitingActions(s);
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function acceptAction(s, route, input) {
  const { actionId = randomUUID(), ...body } = input;
  if (typeof actionId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(actionId)) throw [400, "Некорректный ID действия"];
  const hash = fingerprint([route, body]), old = s.actions.find(a => a.id === actionId);
  if (old) { if (old.hash !== hash) throw [409, "Идентификатор уже использован"]; return old; }
  if (waitingActions(s).length >= 20) throw [429, "В очереди уже 20 действий"];
  const action = { id: actionId, sequence: s.actions.length + 1, route, body: structuredClone(body), hash, status: "queued", at: Date.now(), dependencies: ["/api/spec", "/api/reread", "/api/finish"].includes(route) ? s.actions.filter(a => ["queued", "running"].includes(a.status)).map(a => a.id) : [] };
  s.actions.push(action);
  return action;
}
export function actionGroup(s, action, eligible = () => true) {
  if (action?.status === "needs-decision") return [action];
  if (!action || action.status !== "queued") throw [409, "Действие уже начато"];
  // Work resumed after an agent failure stays alone; inputs stopped before delivery group like new ones.
  if (action.resume || !["/api/discuss", "/api/answer"].includes(action.route)) return [action];
  const matches = a => eligible(a) && a.status === "queued" && !a.resume && a.route === action.route && a.body.id === action.body.id && (a.body.conversationId || "main") === (action.body.conversationId || "main");
  const at = s.actions.indexOf(action); let first = at, last = at;
  while (first && matches(s.actions[first - 1])) first--;
  while (last + 1 < s.actions.length && matches(s.actions[last + 1])) last++;
  return s.actions.slice(first, last + 1);
}
export function cancellation(s, id) {
  const group = actionGroup(s, s.actions.find(a => a.id === id)), ids = new Set(group.map(a => a.id));
  const latestId = id => { let a = s.actions.find(a => a.id === id); while (a?.retriedBy) a = s.actions.find(x => x.id === a.retriedBy); return a?.id || id; };
  // A needs-decision input never blocks later work (its data is archived), so its cancellation does not cascade.
  for (let count = group.some(a => a.status === "needs-decision") ? ids.size : -1; count !== ids.size;) {
    count = ids.size;
    for (const a of s.actions) if (a.dependencies.some(d => ids.has(latestId(d)))) {
      if (a.status === "running") throw [409, "Зависимая работа уже начата"];
      if (a.status === "queued") ids.add(a.id);
    }
  }
  const actions = s.actions.filter(a => ids.has(a.id));
  return { ids: [...ids], confirmation: fingerprint(actions.map(a => [a.id, a.status, a.hash])) };
}
export function cancelActions(s, id, confirmation) {
  const plan = cancellation(s, id);
  if (confirmation !== plan.confirmation) throw [409, "Подтвердите актуальный состав отмены"];
  for (const a of s.actions) if (plan.ids.includes(a.id)) { a.cancelledFrom = a.status; a.status = "cancelled"; a.completedAt = Date.now(); }
  for (const entry of s.archive) if (entry.reason === "missing-target" && !entry.resolution && plan.ids.includes(entry.actionId)) entry.resolution = { id: entry.id, action: "cancelled", at: Date.now() };
  return plan;
}
export function archiveChanges(s, before) {
  for (const node of before) {
    const current = s.nodes.find(n => n.id === node.id);
    if (!current) s.archive.push({ id: randomUUID(), at: Date.now(), reason: "removed", node: structuredClone(node), replacement: s.replacements[node.id] || null });
    else if (node.chat?.some(m => !current.chat?.some(c => c.id === m.id))) s.archive.push({ id: randomUUID(), at: Date.now(), reason: "chat-reset", node: structuredClone(node) });
  }
}
