// Exercise display projection without mutating durable worker evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../skills/grill/ui.html", import.meta.url), "utf8");
const source = html.slice(html.indexOf("function projectQueuedState("), html.indexOf("async function poll(force)"));
const project = vm.runInThisContext("(" + source.trim() + ")");
const base = {
  nodes: [
    { id: "root", kind: "root", chat: [{ id: "old", from: "user", text: "Old", conversationId: "main" }] },
    { id: "q", parentId: "root", kind: "q", status: "ok", answer: "Original", pending: { answer: "Active", stage: "thinking" } },
    { id: "idea", parentId: "root", kind: "idea", text: "Original idea", q: "Original idea", revision: 1, status: "ok" },
    { id: "child", parentId: "idea", kind: "q", q: "Child?", status: "open" },
    { id: "preview", parentId: "idea", sourceId: "idea", kind: "preview", deletionPolicy: "keep", commit: "saved" }
  ], questionRequests: []
};
const effect = (type, input, actionId = type) => ({ type, input, actionId, images: [], at: 1 });
const view = effects => project({ ...structuredClone(base), actionQueue: { effects } });
const original = JSON.stringify(base);
let s = view([
  effect("answer", { id: "q", answer: "First" }, "a"),
  effect("discuss", { id: "root", message: "Before reset" }),
  effect("answer", { id: "q", answer: "Latest" }, "b"),
  effect("discuss", { id: "root", conversationId: "other", message: "Other" }, "other"),
  effect("chatreset", { id: "root" }),
  effect("discuss", { id: "root", message: "After reset" }, "after")
]);
assert.deepEqual(s.nodes.find(n => n.id === "q").pending, { answer: "Latest", stage: "queued" });
assert.deepEqual(s.nodes[0].chat.map(m => m.text), ["Other", "After reset"]);
assert.equal(JSON.stringify(base), original);
assert.deepEqual(view([]).nodes.find(n => n.id === "q").pending, { answer: "Active", stage: "thinking" });
s = view([effect("idea/edit", { id: "idea", text: "Edited" }), effect("preview/build", { id: "preview", request: "New rendering" }), effect("preview/policy", { id: "preview", policy: "delete" })]);
assert.equal(s.nodes.find(n => n.id === "idea").text, "Edited");
assert.equal(s.nodes.find(n => n.id === "idea").revision, 1);
assert.equal(s.nodes.find(n => n.id === "preview").request, "New rendering");
assert.equal(s.nodes.find(n => n.id === "preview").commit, "saved");
assert.equal(s.nodes.find(n => n.id === "preview").deletionPolicy, "delete");
s = view([effect("idea/delete", { id: "idea" })]);
assert.deepEqual(s.nodes.map(n => n.id), ["root", "q", "preview"]);
assert.equal(s.nodes.at(-1).parentId, "root");
assert.equal(s.nodes.at(-1).orphaned, true);
s = view([effect("preview/delete", { id: "preview" })]);
assert.equal(s.nodes.some(n => n.id === "preview"), false);
s = view([effect("idea", { id: "new-idea", text: "New" }), effect("question", { id: "new-question", parentId: "root", q: "New?" }), effect("preview/prepare", { sourceId: "q" })]);
assert.equal(s.nodes.filter(n => n.queuedCreation).length, 3);
assert.equal(s.questionRequests[0].q, "New?");
const types = ["more", "finish", "spec", "reread", "knowledge-import", "spec-migrate", "preview/save", "preview/restore"];
s = view(types.map(type => effect(type, type.startsWith("preview/") ? { id: "preview" } : {})));
for (const field of ["morePending", "finishPending", "specPending", "rereadPending", "knowledgePending"]) assert.ok(s[field], field);
assert.equal(s.nodes.find(n => n.id === "preview").commit, "saved");
assert.deepEqual(s.nodes.flatMap(n => n.queuedActions || []).map(a => a.type).sort(), types.sort());
console.log("Queued view checks passed: FIFO display, cancellation restoration, edits, deletes, placeholders and work indicators");
