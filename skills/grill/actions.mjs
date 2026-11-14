import { randomUUID, createHash } from "node:crypto";

// The journal is never compacted: request identities and original inputs survive completion.
export const actionRoutes = new Set(["answer", "discuss", "chatreset", "question", "more", "reread", "spec", "finish", "idea", "idea/analyze", "idea/edit", "idea/delete", "knowledge-import", "spec-migrate", "preview/prepare", "preview/build", "preview/policy", "preview/delete", "preview/save", "preview/restore"].map(x => "/api/" + x));
export const initializeActions = s => { s.actions ||= []; s.archive ||= []; s.replacements ||= {}; s.actionPaused ??= false; };
export const waitingActions = s => s.actions.filter(a => a.status === "queued");
export const activeActions = s => s.actions.filter(a => a.status === "running");
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
export function actionGroup(s, action) {
  if (!action || action.status !== "queued") throw [409, "Действие уже начато"];
  if (action.retryOf || action.resume || !["/api/discuss", "/api/answer"].includes(action.route)) return [action];
  const matches = a => a.status === "queued" && !a.retryOf && !a.resume && a.route === action.route && a.body.id === action.body.id && (a.body.conversationId || "main") === (action.body.conversationId || "main");
  const at = s.actions.indexOf(action); let first = at, last = at;
  while (first && matches(s.actions[first - 1])) first--;
  while (last + 1 < s.actions.length && matches(s.actions[last + 1])) last++;
  return s.actions.slice(first, last + 1);
}
export function cancellation(s, id) {
  const group = actionGroup(s, s.actions.find(a => a.id === id)), ids = new Set(group.map(a => a.id));
  for (let count = -1; count !== ids.size;) {
    count = ids.size;
    for (const a of s.actions) if (a.dependencies.some(d => ids.has(d))) {
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
  for (const a of s.actions) if (plan.ids.includes(a.id)) { a.status = "cancelled"; a.completedAt = Date.now(); }
  return plan;
}
export function archiveChanges(s, before) {
  for (const node of before) {
    const current = s.nodes.find(n => n.id === node.id);
    if (!current) s.archive.push({ id: randomUUID(), at: Date.now(), reason: "removed", node: structuredClone(node), replacement: s.replacements[node.id] || null });
    else if (node.chat?.some(m => !current.chat?.some(c => c.id === m.id))) s.archive.push({ id: randomUUID(), at: Date.now(), reason: "chat-reset", node: structuredClone(node) });
  }
}
