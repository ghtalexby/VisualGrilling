// Coverage is an explicit semantic assertion by the worker, validated structurally here.
export const problemGrade = status => ["weak", "gap", "verify"].includes(status);

export function coverageResult(nodes, id, input, { mkQ, clean }) {
  if (input === undefined) return;
  const bad = () => { throw [400, "Некорректная проверка пробелов; уточнения не сохранены"]; };
  const text = (s, limit) => { if (typeof s !== "string" || !s.trim() || s.trim().length > limit) bad(); return clean(s, limit); };
  const list = v => { if (!Array.isArray(v) || v.length > 500) bad(); return v; };
  const n = nodes.find(n => n.id === id);
  if (!n || n.kind !== "q" || n.obsolete || !input || typeof input.resolved !== "boolean") bad();
  const reason = text(input.reason, 2000), gaps = list(input.gaps), sources = list(input.sources), questions = list(input.questions || []);
  if (input.resolved !== (n.status === "ok") || input.resolved && gaps.length || !input.resolved && !gaps.length) bad();
  const refs = new Map(), additions = [];
  for (const o of questions) {
    if (!o || !/^\$[a-zA-Z0-9-]{1,40}$/.test(o.key) || refs.has(o.key)) bad();
    text(o.q, 220); text(o.why, 260);
    if (!Array.isArray(o.options) || o.options.length < 2 || o.options.length > 4) bad();
    o.options.forEach(s => text(s, 120));
    const q = mkQ({ ...o, area: n.area }, id); if (!q) bad();
    refs.set(o.key, q.id); additions.push(q);
  }
  const all = [...nodes, ...additions], used = new Set();
  const checked = gaps.map(g => {
    const gap = text(g?.gap, 1000), ids = list(g.questionIds).map(id => refs.get(id) || id);
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(target => !all.some(q => q.id === target && q.kind === "q" && !q.obsolete))) bad();
    ids.forEach(id => used.add(id)); return { gap, questionIds: ids };
  });
  if (additions.some(q => !used.has(q.id))) bad();
  const sourceIds = new Set();
  const supplements = sources.map(s => {
    const source = nodes.find(q => q.id === s?.id);
    if (!source || source.id === id || source.kind !== "q" || source.obsolete || !source.answer || source.pending || sourceIds.has(source.id) || s.answer !== source.answer) bad();
    sourceIds.add(source.id);
    return { id: source.id, q: source.q, answer: source.answer, status: source.status, contribution: text(s.contribution, 2000) };
  });
  if (JSON.stringify(n.supplements || []) !== JSON.stringify(supplements)) {
    if ((n.supplementHistory || []).length >= 1000) bad();
    if (n.supplements?.length) n.supplementHistory = [...(n.supplementHistory || []), { sources: n.supplements, at: Date.now() }];
    n.supplements = supplements;
  }
  const coverage = { resolved: input.resolved, reason, gaps: checked };
  const { at, ...oldCoverage } = n.gapCoverage || {};
  if (JSON.stringify(oldCoverage) !== JSON.stringify(coverage)) n.gapCoverage = { ...coverage, at: Date.now() };
  delete n.followup;
  nodes.push(...additions);
}
