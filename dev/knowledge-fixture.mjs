import assert from "node:assert/strict";
// Existing feature suites acknowledge the separate knowledge stage without semantic extraction.
// check-knowledge.mjs tests that stage directly, including errors and restart.
export function knowledgeFixture(request) {
  let finishToken;
  return async function call(route, body, expected = 200) {
    if (body?.type === "finish" && !body.token) body = { ...body, token: finishToken };
    const snapshot = route === "apply" ? await request("state") : null;
    // Transport fixtures explicitly account for gap coverage; semantic quality is tested by real agents.
    if (route === "apply" && expected === 200) {
      body = structuredClone(body);
      const cover = (a, id) => {
        if (!a || a.coverage !== undefined || !["ok", "weak", "gap", "verify"].includes(a.status)) return;
        if (a.status === "ok") { a.coverage = { resolved: true, reason: "Fixture closure", gaps: [], sources: [] }; return; }
        const other = snapshot.nodes.find(n => n.kind === "q" && !n.obsolete && n.id !== id);
        if (!other && a.children?.length) {
          a.coverage = { resolved: false, reason: "Fixture child clarification", sources: [], gaps: [{ gap: "Fixture uncertainty", questionIds: a.children.map((_, i) => "$fixture" + i) }], questions: a.children.map((q, i) => ({ why: "Fixture evidence", options: ["Yes", "No"], ...q, key: "$fixture" + i })) }; delete a.children;
        }
        if (other) a.coverage = { resolved: false, reason: "Transport fixture reuses another question", gaps: [{ gap: "Fixture uncertainty", questionIds: [other.id] }], sources: [] };
      };
      if (body.type === "reread") for (const a of body.audit || []) {
        const n = snapshot.nodes.find(n => n.id === a.id);
        if (a.action === "keep" && n && ["weak", "gap", "verify"].includes(n.status)) { const assessment = { status: n.status }; cover(assessment, n.id); if (assessment.coverage) a.coverage = assessment.coverage; }
      }
      if (body.type === "answer") cover(body, body.id);
      cover(body.assessment, body.id);
      for (const a of [...(body.answers || []), ...(body.assessments || []), ...(body.ancestors || [])]) { cover(a, a.id); for (const parent of a.ancestors || []) cover(parent, parent.id); }
    }
    const before = snapshot?.currentWork;
    const deliver = async () => {
      const result = await request(route, body, expected);
      if (route.startsWith("wait?") && expected === 200 && result.type !== "timeout") {
        assert.deepEqual((await request("state")).currentWork, { type: result.type });
      }
      return result;
    };
    let result = await deliver();
    if (route === "apply" && expected === 200 && result.ok && before) {
      const after = (await request("state")).currentWork;
      if (body.type === "notes" || result.committed === false) assert.deepEqual(after, before);
      else if (body.type === before.type) assert.equal(after, null);
    }
    while (route.startsWith("wait?") && result.type === "knowledge") {
      const saved = await request("apply", { type: "knowledge", token: result.token, files: [] });
      if (!saved.ok) throw new Error(saved.error);
      result = await deliver();
    }
    if (result.type === "finish") finishToken = result.token;
    return result;
  };
}
