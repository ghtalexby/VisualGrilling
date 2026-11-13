import path from "node:path";
// Evidence is stable; semantic annotations only guide retrieval.
export function evidenceNode(n) {
  const { topics, relates, decision, chatDigest, semanticsStale, discuss, discussToken, discussRevision, discussMapRevision, discussDraft, pending, analysis, ...rest } = n;
  if (rest.job) { const { stage, token, ...job } = rest.job; rest.job = job; }
  if (rest.chat) rest.chat = rest.chat.map(({ readAt, ...m }) => m);
  return { ...rest, ...(pending ? { pending: { answer: pending.answer, at: pending.at } } : {}) };
}

export function deliveryNode(n, history = true, imageDirectory) {
  const out = { ...evidenceNode(n) };
  for (const key of ["topics", "relates", "decision", "chatDigest", "semanticsStale"]) if (n[key] !== undefined) out[key] = n[key];
  if (out.chat) out.chat = out.chat.map(({ at, ...m }) => ({ ...m, ...(imageDirectory && m.images ? { images: m.images.map(f => path.join(imageDirectory, path.basename(f))) } : {}) }));
  if (out.answer) {
    delete out.why; delete out.recommendation;
    if (out.options?.includes(out.answer)) delete out.options;
    const source = out.answerSource;
    if (source?.id === n.id && source.messageIds?.length) {
      const messages = source.messageIds.map(id => out.chat?.find(m => m.id === id && m.from === "user"));
      if (messages.every(Boolean) && messages.map(m => m.text).join("\n\n") === out.answer) {
        delete out.answer; out.answerFromChat = true;
      }
    }
  }
  if (!history && out.verdictHistory) { out.verdictHistoryCount = out.verdictHistory.length; delete out.verdictHistory; }
  for (const [key, value] of Object.entries(out)) if (value == null || value === "" || Array.isArray(value) && !value.length) delete out[key];
  return out;
}

export const tokens = text => new Set((String(text || "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).map(s => [...s].slice(0, 5).join("")));
const semanticCard = n => n?.kind === "q" || n?.kind === "idea";
export function ranking(nodes, text) {
  const query = tokens(text), documents = nodes.map(n => tokens(`${n.q || n.text || ""} ${n.answer || ""}`));
  const frequencies = new Map();
  for (const words of documents) for (const word of words) frequencies.set(word, (frequencies.get(word) || 0) + 1);
  return nodes.map((node, i) => ({ node, score: [...query].reduce((sum, word) => sum + (documents[i].has(word) ? Math.log(1 + nodes.length / frequencies.get(word)) : 0), 0) }))
    .filter(x => x.score >= 2).sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
}

export function neighbours(nodes, ids) {
  const selected = new Set(ids), result = new Map();
  for (const n of nodes.filter(semanticCard)) for (const link of n.relates || []) {
    if (!nodes.some(x => x.id === link.id && semanticCard(x))) continue;
    if (selected.has(n.id) && !selected.has(link.id)) result.set(link.id, [...(result.get(link.id) || []), link.kind]);
    if (selected.has(link.id) && !selected.has(n.id)) result.set(n.id, [...(result.get(n.id) || []), link.kind]);
  }
  return [...result].map(([id, kinds]) => ({ id, kinds: [...new Set(kinds)] }));
}

export function vocabulary(nodes) {
  const counts = new Map();
  for (const n of nodes) for (const topic of n.topics || []) counts.set(topic, (counts.get(topic) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 200);
}

export function indexText(nodes, omitted = new Set(), questionsOnly = false, bounded = true) {
  if (bounded && !questionsOnly && nodes.length > 500) throw [400, "Индекс превышает 500 карточек", "context-limit"];
  const lines = [], seen = new Set();
  const line = text => String(text || "").replace(/\s+/g, " ");
  function visit(n, depth) {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    if (!omitted.has(n.id)) {
      if (questionsOnly) { if (n.kind === "q" && !n.obsolete) lines.push(`${n.id} | ${line(n.q)}`); }
      else lines.push(`${"  ".repeat(depth)}${n.id} ${n.status || n.kind} ${[n.obsolete && "obsolete", n.conflictOf?.length && "conflict", n.pending && "pending", n.kind === "idea" && "idea"].filter(Boolean).join(" ")} | ${line(n.q || n.text).slice(0, 140)} | = ${line(n.decision || n.answer).slice(0, n.decision ? 200 : 160)} | ${(n.topics || []).map(t => "#" + t).join(" ")} | chat:${n.chat?.length || 0}`);
    }
    for (const child of nodes.filter(c => c.parentId === n.id)) visit(child, depth + 1);
  }
  for (const root of nodes.filter(n => !n.parentId || !nodes.some(p => p.id === n.parentId))) visit(root, 0);
  for (const n of nodes) if (!seen.has(n.id)) visit(n, 0);
  return lines.join("\n");
}

export function branchIds(nodes, id, descendants = true, ancestors = true) {
  const ids = new Set([id]);
  if (descendants) for (let size = -1; size !== ids.size;) { size = ids.size; for (const n of nodes) if (ids.has(n.parentId)) ids.add(n.id); }
  if (ancestors) for (let n = nodes.find(x => x.id === id); n?.parentId;) { n = nodes.find(x => x.id === n.parentId); if (!n || ids.has(n.id)) break; ids.add(n.id); }
  return ids;
}

export function focusedContext(nodes, id, text, { index = false, titles = false, descendants = true, ancestors = true, imageDirectory } = {}) {
  const ids = branchIds(nodes, id, descendants, ancestors);
  // Project chat is evidence only when root itself is the requested focus.
  for (const n of nodes) if (n.kind === "root" && n.id !== id) ids.delete(n.id);
  const focus = nodes.filter(n => ids.has(n.id)).map(n => deliveryNode(n, n.id === id, imageDirectory));
  const candidates = neighbours(nodes, [id]).map(x => x.id);
  const related = [], relatedOmitted = []; let size = 2;
  for (const candidate of new Set(candidates)) {
    if (ids.has(candidate)) continue;
    const card = deliveryNode(nodes.find(n => n.id === candidate), false, imageDirectory), length = JSON.stringify(card).length + (related.length ? 1 : 0);
    if (size + length <= 20000) { related.push(card); size += length; } else relatedOmitted.push(candidate);
  }
  const delivered = new Set([...ids, ...related.map(n => n.id)]);
  // Lexical hits are navigation, not an invitation to read five unrelated chats.
  const hits = ranking(nodes.filter(semanticCard), text).filter(x => !delivered.has(x.node.id)).slice(0, 5).map(x => x.node);
  return { mode: "focused", focus, related, relatedOmitted, ...(titles ? { questionTitles: indexText(nodes, delivered, true) } : {}), ...(index ? { index: indexText(nodes, delivered), relatedIds: hits.map(n => n.id) } : { relatedIndex: indexText(hits), indexAvailable: true }), vocabulary: vocabulary(nodes) };
}

// Sparse reassessment evidence: missing timestamps conservatively mean changed.
export function reviewContext(nodes, ids, imageDirectory) {
  const targets = new Set(ids), descendants = new Set(), cutoffs = new Map();
  const byId = new Map(nodes.map(n => [n.id, n])), children = new Map();
  for (const n of nodes) { if (!children.has(n.parentId)) children.set(n.parentId, []); children.get(n.parentId).push(n.id); }
  for (const id of ids) {
    const since = byId.get(id)?.verdictHistory?.at(-1)?.at || 0, seen = new Set(), pending = [id];
    while (pending.length) {
      const child = pending.pop(); if (seen.has(child)) continue;
      seen.add(child); descendants.add(child);
      cutoffs.set(child, Math.min(cutoffs.get(child) ?? Infinity, since));
      pending.push(...children.get(child) || []);
    }
  }
  const full = [], omitted = new Set();
  for (const n of nodes.filter(n => descendants.has(n.id) && n.kind !== "root")) {
    const since = cutoffs.get(n.id);
    const chatChanged = (n.chat || []).some(m => m.from === "user" && (!m.at || m.at > since));
    const changed = !since || n.pending || (n.verdictHistory?.at(-1)?.at || n.reviewedAt || 0) > since || (n.answerHistory?.at(-1)?.at || 0) > since || (n.answerSource?.at || 0) > since || chatChanged;
    if (!targets.has(n.id) && !changed) { omitted.add(n.id); continue; }
    const card = deliveryNode(n, true, imageDirectory);
    if (!targets.has(n.id) && !chatChanged) {
      delete card.chat;
      if (card.answerFromChat) { delete card.answerFromChat; card.answer = n.answer; }
    }
    if (card.verdictHistory) { card.verdictHistoryCount = card.verdictHistory.length; card.verdictHistory = card.verdictHistory.slice(-3); }
    full.push(card);
  }
  const ancestors = new Set();
  for (const id of ids) for (let n = byId.get(id); n && !ancestors.has(n.id); n = byId.get(n.parentId)) ancestors.add(n.id);
  for (const n of nodes.filter(n => ancestors.has(n.id) && !descendants.has(n.id) && n.kind !== "root")) {
    full.push({ id: n.id, parentId: n.parentId, kind: n.kind, q: n.q, answer: n.answer, status: n.status, ...(n.kind === "idea" ? { text: n.text } : {}) });
  }
  return { nodes: full, index: indexText(nodes.filter(n => omitted.has(n.id)), new Set(), false, false) };
}

export function applySemantics(nodes, id, input, clean) {
  if (input === undefined) return;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw [400, "Некорректная семантика"];
  const node = nodes.find(n => n.id === id);
  if (!node) throw [400, "Карточка семантики не найдена"];
  const update = {};
  for (const [key, limit] of [["decision", 200], ["chatDigest", 300]]) if (input[key] !== undefined) {
    if (typeof input[key] !== "string" || input[key].trim().length > limit || /[\r\n]/.test(input[key])) throw [400, "Некорректная семантика"];
    update[key] = clean(input[key], limit);
  }
  if (input.topics !== undefined) {
    if (!Array.isArray(input.topics) || input.topics.length > 5 || input.topics.some(t => typeof t !== "string" || !t.trim() || t.trim().length > 40 || /[\r\n]/.test(t))) throw [400, "Некорректные темы"];
    update.topics = [...new Set(input.topics.map(t => clean(t.toLowerCase(), 40)))];
  }
  if (input.relates !== undefined) {
    if (!Array.isArray(input.relates) || input.relates.length > 8 || input.relates.some(l => !l || l.id === id || !nodes.some(n => n.id === l.id && semanticCard(n)) || !["depends", "conflicts", "same-object", "supersedes"].includes(l.kind))) throw [400, "Некорректные связи"];
    update.relates = input.relates.map(l => ({ id: clean(l.id, 80), kind: clean(l.kind, 20) }));
  }
  Object.assign(node, update); delete node.semanticsStale;
}

// Structural transactions reconcile each tree independently, including frozen evidence.
export function reconcileLinks(before, after, merged = new Map()) {
  const ids = new Set(after.filter(semanticCard).map(n => n.id));
  for (const node of after) {
    const inherited = before.filter(n => merged.get(n.id) === node.id).flatMap(n => n.relates || []);
    if (!node.relates && !inherited.length) continue;
    const links = new Map();
    for (const link of [...(node.relates || []), ...inherited]) {
      const id = merged.get(link.id) || link.id;
      if (ids.has(id) && id !== node.id) links.set(`${id}:${link.kind}`, { id, kind: link.kind });
    }
    node.relates = [...links.values()];
  }
  return after;
}

export function validateLinks(nodes) {
  for (const node of nodes) if (node.relates && (node.relates.length > 8 || node.relates.some(link => link.id === node.id || !nodes.some(n => n.id === link.id && semanticCard(n)) || !["depends", "conflicts", "same-object", "supersedes"].includes(link.kind)))) throw [400, "Некорректные связи"];
}

// Jaccard >= 0.85 rejects near-identical stem sets; explicit IDs acknowledge intentional overlap.
export function validateDuplicates(before, after) {
  const old = new Set(before.map(n => n.id)), questions = after.filter(n => n.kind === "q" && !n.obsolete);
  for (const n of questions.filter(n => !old.has(n.id))) {
    const allowed = Object.hasOwn(n, "_allowSimilar") ? n._allowSimilar : [], words = tokens(n.q);
    if (!Array.isArray(allowed) || allowed.some(id => typeof id !== "string" || !questions.some(q => q.id === id))) throw [400, "Некорректный allowSimilar"];
    const matches = questions.filter(other => {
      if (other.id === n.id || allowed.includes(other.id)) return false;
      const theirs = tokens(other.q), union = new Set([...words, ...theirs]);
      return n.q.trim().toLowerCase() === other.q.trim().toLowerCase() || union.size > 0 && [...words].filter(w => theirs.has(w)).length / union.size >= 0.85;
    });
    if (matches.length) throw [400, "Похожий вопрос уже существует: " + matches.map(q => q.id).join(", ")];
  }
  for (const n of after) delete n._allowSimilar;
}
