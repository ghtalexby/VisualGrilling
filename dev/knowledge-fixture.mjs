// Existing feature suites acknowledge the separate knowledge stage without semantic extraction.
// check-knowledge.mjs tests that stage directly, including errors and restart.
export function knowledgeFixture(request) {
  let finishToken;
  return async function call(route, body, expected = 200) {
    if (body?.type === "finish" && !body.token) body = { ...body, token: finishToken };
    let result = await request(route, body, expected);
    while (route.startsWith("wait?") && result.type === "knowledge") {
      const saved = await request("apply", { type: "knowledge", token: result.token, files: [] });
      if (!saved.ok) throw new Error(saved.error);
      result = await request(route, undefined, expected);
    }
    if (result.type === "finish") finishToken = result.token;
    return result;
  };
}
