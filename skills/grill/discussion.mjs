// Build a discussion transaction without mutating live state or frozen specifications.
export function discussionResult(nodes, sourceId, body, { mkQ, recordVerdict, clean }) {
  const next = structuredClone(nodes), byId = new Map(next.map(n => [n.id, n]));
  const source = byId.get(sourceId), refs = new Map(), added = [], edited = [], touched = new Set();
  const bad = message => { throw [400, message]; };
  const text = (value, limit) => {
    if (typeof value !== "string" || value.trim().length > limit) bad("Текст обсуждения превышает лимит или имеет неверный тип");
    return clean(value, limit);
  };
  for (const key of ["questions", "links", "answers"]) if (body[key] !== undefined && (!Array.isArray(body[key]) || body[key].length > 500)) bad("Некорректный список результата обсуждения");
  const known = new Set(nodes.filter(n => n.kind === "q" && !n.obsolete).map(n => n.q.toLocaleLowerCase()));
  for (const o of body.questions || []) {
    if (!o || !/^\$[a-zA-Z0-9-]{1,40}$/.test(o.key) || refs.has(o.key)) bad("Нужен уникальный ключ нового вопроса");
    const title = text(o.q, 220);
    if (!title || known.has(title.toLocaleLowerCase())) bad("Вопрос пуст или уже существует на карте");
    const q = mkQ(o, o.parentId);
    if (!q || q.options.length < 2 || byId.has(q.id)) bad("Новому вопросу нужны текст, уникальный ID и варианты");
    known.add(title.toLocaleLowerCase()); refs.set(o.key, q.id); byId.set(q.id, q); next.push(q); added.push(q);
  }
  const resolve = id => refs.get(id) || id;
  let priority = Math.max(0, ...nodes.map(n => n.prio || 0));
  for (const q of added) q.parentId = resolve(q.parentId);
  for (const q of added) {
    let p = q; const seen = new Set([q.id]);
    while (p.parentId !== null) {
      const parent = byId.get(p.parentId);
      if (!parent || !["root", "q", "idea"].includes(parent.kind) || p === q && parent.obsolete || seen.has(parent.id)) bad("Родитель не найден, устарел или обнаружен цикл");
      seen.add(parent.id); p = parent;
      if (p.parentId === "root") q.area = p.area;
    }
    if (q.parentId === "root") q.prio = ++priority;
    touched.add(q.id);
  }
  const links = (body.links || []).map(id => {
    const n = byId.get(resolve(id));
    if (!n || n.kind !== "q") bad("Ссылка должна вести к существующему вопросу");
    return { id: n.id, q: n.q };
  });
  if (new Set(links.map(l => l.id)).size !== links.length || added.some(q => !links.some(l => l.id === q.id))) bad("Каждому новому вопросу нужна уникальная ссылка");
  const targets = new Set();
  for (const a of body.answers || []) {
    const n = byId.get(resolve(a?.id));
    if (!n || n.kind !== "q" || n.obsolete || targets.has(n.id) || body.assessment && n.id === sourceId) bad("Некорректный адресат ответа");
    if (n.pending || n.id !== sourceId && n.discuss || n.analysis || n.job) throw [409, "Дождитесь обработки ответа или обсуждения адресата"];
    if (!Array.isArray(a.messageIds) || !a.messageIds.length || new Set(a.messageIds).size !== a.messageIds.length) bad("Нужны исходные сообщения пользователя");
    const messages = a.messageIds.map(id => source.chat?.find(m => m.id === id && m.from === "user"));
    if (messages.some(m => !m || !m.text)) bad("Исходное сообщение пользователя не найдено");
    const answer = text(messages.map(m => m.text).join("\n\n"), 2000), verdict = text(a.verdict, 400);
    if (!verdict || !["ok", "weak", "gap", "verify"].includes(a.status)) bad("Нужны отдельная оценка и вердикт для каждого ответа");
    const at = Date.now(), provenance = { id: sourceId, q: source.text || source.q || "", messageIds: [...a.messageIds], at };
    if (n.answer && n.answer !== answer) edited.push(n.id);
    if (n.answer) n.answerHistory = [...(n.answerHistory || []), { answer: n.answer, status: n.status, verdict: n.verdict, source: n.answerSource || null, at }];
    n.answer = answer; n.answerSource = provenance;
    recordVerdict(n, a.status, verdict); targets.add(n.id); touched.add(n.id);
  }
  return { nodes: next, links, edited, touched: [...touched], added: added.length };
}

// Parts are persisted staging only. The final part validates and commits everything together.
export function discussionParts(node, body) {
  if (body.part === undefined) {
    if (node.discussDraft) throw [400, "Завершите передачу частей обсуждения"];
    return { body };
  }
  if (!Number.isInteger(body.part) || body.part < 0 || typeof body.more !== "boolean") throw [400, "Нужны номер части и more"];
  const parts = node.discussDraft || [], { type, id, token, part, more, ...data } = body;
  if (more && Object.keys(data).some(k => !["questions", "links", "answers"].includes(k))) throw [400, "Текст ответа и команды передаются в последней части"];
  for (const key of ["questions", "links", "answers"]) if (data[key] !== undefined && !Array.isArray(data[key])) throw [400, "Некорректная часть обсуждения"];
  if (part < parts.length && more && JSON.stringify(parts[part]) === JSON.stringify(data)) return { staged: parts };
  if (part !== parts.length) throw [409, "Неверная последовательность частей обсуждения"];
  const all = [...parts, data];
  if (all.length > 500 || JSON.stringify(all).length > 600000) throw [400, "Результат обсуждения слишком большой; ничего не применено"];
  if (more) return { staged: all };
  return { body: { ...body, questions: all.flatMap(p => p.questions || []), links: all.flatMap(p => p.links || []), answers: all.flatMap(p => p.answers || []) } };
}
