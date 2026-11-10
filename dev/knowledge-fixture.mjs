import assert from "node:assert/strict";
// Existing feature suites acknowledge the separate knowledge stage without semantic extraction.
// check-knowledge.mjs tests that stage directly, including errors and restart.
export function knowledgeFixture(request) {
  let finishToken;
  return async function call(route, body, expected = 200) {
    if (body?.type === "finish" && !body.token) body = { ...body, token: finishToken };
    const before = route === "apply" ? (await request("state")).currentWork : null;
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
