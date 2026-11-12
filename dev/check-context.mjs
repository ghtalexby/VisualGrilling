// Measure focused event payloads using a deterministic, disposable 40-question map.
import { evidenceNode, deliveryNode, focusedContext, indexText, vocabulary, applySemantics, validateDuplicates, reconcileLinks, validateLinks } from "../skills/grill/context.mjs";
import { digest } from "../skills/grill/knowledge.mjs";
import { circlePreview } from "./fixtures/preview.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grill-context-"));
const dir = path.join(cwd, "maps"), map = path.join(dir, "check"), stateFile = path.join(map, "state.json");
let server, url, fixture;
async function start() {
  server = spawn(process.execPath, [cli, "serve", "--dir", dir, "--name", "check", "--port", "0", "--lang", "en"], { cwd, windowsHide: true, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { const info = JSON.parse(fs.readFileSync(path.join(map, "server.json"))); if (info.pid === server.pid) { url = info.url; return; } } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("Server did not start");
}
async function api(route, body, expected = 200) {
  const response = await fetch(url + "api/" + route, { method: body === undefined ? "GET" : "POST", headers: { "x-grill": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const ended = new Promise(r => server.once("exit", r));
  await api("stop", {}); await ended;
}
async function reset() {
  await stop(); fs.writeFileSync(stateFile, JSON.stringify(fixture)); await start();
}
async function delivered(type, print = true) {
  const event = await api("wait?timeout=1");
  assert.equal(event.type, type);
  const stats = (await api("state")).contextStats, entry = stats.recent.at(-1);
  assert.equal(entry.type, type);
  assert.equal(entry.characters, JSON.stringify(event).length);
  assert.ok(entry.focus + entry.related + entry.index <= entry.characters);
  assert.equal("contextStats" in event, false);
  if (print) console.log(`${type}\t${entry.characters}\t${entry.focus}\t${entry.related}\t${entry.index}`);
  return event;
}
try {
  await start();
  assert.equal((await fetch(url + "api/state")).status, 403);
  await api("init", { title: "Context fixture", brief: "A local planning tool with saved decisions.", arch: "Browser, localhost server, JSON state.", questions: [{ q: "Seed?", options: ["Yes", "No"] }] });
  await stop();
  fixture = JSON.parse(fs.readFileSync(stateFile));
  fixture.contextStats = { recent: [], totals: {} };
  const chat = id => [
    { id: `${id}-user`, from: "user", text: "Keep the accepted decision and explain its consequences for this branch.", at: 1700000000000 },
    { id: `${id}-agent`, from: "claude", text: "The decision is recorded; remaining assumptions need an explicit check.", at: 1700000000001 }
  ];
  fixture.nodes = [{ id: "root", parentId: null, kind: "root", chat: chat("root") }, ...Array.from({ length: 40 }, (_, i) => ({
    id: `q${String(i).padStart(2, "0")}`, parentId: i < 5 ? "root" : `q0${(i - 5) % 5}`, kind: "q", prio: i < 5 ? i + 1 : undefined,
    q: `Decision ${String(i).padStart(2, "0")}: how will the project validate this requirement?`, why: "An explicit acceptance check prevents ambiguous implementation.", area: "Architecture",
    options: ["Measure the outcome", "Review it manually", "Defer the decision"], recommendation: "Measure the outcome",
    status: i === 39 ? "open" : ["ok", "weak", "gap", "verify"][i % 4], answer: i === 39 ? null : "Measure the outcome using a reproducible scenario and retain the result.",
    verdict: i === 39 ? null : "The decision is concrete; check the remaining dependency before implementation.", chat: chat(`q${String(i).padStart(2, "0")}`)
  }))];
  console.log("type\tcharacters\tfocus\trelated\tindex");
  const measured = {};
  for (const type of ["answer", "discuss", "question", "idea", "reevaluate", "reread", "more", "spec", "preview", "knowledge", "finish"]) {
    await reset();
    if (type === "answer" || type === "reevaluate") {
      await api("answer", { id: type === "answer" ? "q00" : "q05", answer: "Validate the decision with a reproducible acceptance scenario." });
      if (type === "reevaluate") {
        const e = await delivered("answer", false);
        await api("apply", { type: "answer", id: e.id, token: e.token, status: "ok", verdict: "Acceptance scenario confirmed." });
      }
    } else if (type === "discuss") await api("discuss", { id: "q00", message: "How does this decision affect the other branches?" });
    else if (type === "question") await api("question", { id: "custom-check", parentId: "q00", q: "What evidence should we retain?" });
    else if (type === "idea") await api("idea", { id: "idea-check", text: "Keep an acceptance log for each decision." });
    else if (type === "preview") await api("preview/prepare", { sourceId: "q00" });
    else if (type === "knowledge") await api("knowledge-import", {});
    else await api(type, {});
    if (type === "finish") {
      const e = await delivered("knowledge", false);
      await api("apply", { type: "knowledge", token: e.token, files: [] });
    }
    measured[type] = await delivered(type);
  }
  assert.ok(JSON.stringify(measured.discuss).length <= 39603 * 0.35);
  assert.ok(JSON.stringify(measured.idea).length <= 32696 * 0.35);
  assert.ok(JSON.stringify(measured.knowledge).length < 71422);
  for (const event of [measured.discuss, measured.idea]) {
    const deliveredIds = new Set([...event.context.focus, ...event.context.related].map(n => n.id));
    for (const n of fixture.nodes) assert.ok(deliveredIds.has(n.id) || event.context.index.split("\n").some(line => line.trimStart().startsWith(n.id + " ")), `Missing ${n.id}`);
  }
  // Read APIs are protected and do not change queue state, delivery state or revision.
  await reset();
  const beforeReads = await api("state");
  assert.equal((await api("node?id=q00&id=q01")).nodes.length, 2);
  assert.equal((await api("branch?id=q05")).nodes.length, 3);
  assert.equal((await api("index")).index.split("\n").length, 41);
  assert.ok((await api("search?text=validate%20requirement%20decision")).matches.length);
  await api("node?" + Array.from({ length: 21 }, (_, i) => "id=q" + String(i).padStart(2, "0")).join("&"), undefined, 400);
  await api("node?id=absent", undefined, 404);
  await api("node?id=q00&token=stale", undefined, 409);
  assert.equal((await fetch(url + "api/node?id=q00")).status, 403);
  assert.deepEqual(await api("state"), beforeReads);
  // An extra unrelated branch changes neither the focused answer nor its lexical candidates.
  const answerContext = focusedContext(fixture.nodes, "q00", "completely unique phrase");
  const expandedContext = focusedContext([...fixture.nodes, ...Array.from({ length: 50 }, (_, i) => ({ id: "extra" + i, kind: "q", parentId: "root", q: "Unrelated additional material", status: "open" }))], "q00", "completely unique phrase");
  assert.deepEqual(answerContext, expandedContext);
  const semantic = structuredClone(fixture.nodes);
  applySemantics(semantic, "q00", { topics: ["Storage", "storage"], relates: [{ id: "q01", kind: "depends" }], decision: "Summary", chatDigest: "Outcome" }, (s, n) => String(s).trim().slice(0, n));
  assert.deepEqual(semantic[1].topics, ["storage"]);
  assert.equal(JSON.stringify(evidenceNode(semantic[1])), JSON.stringify(evidenceNode(fixture.nodes[1])));
  assert.equal(deliveryNode({ ...semantic[1], answer: semantic[1].options[0] }).options, undefined);
  assert.equal(deliveryNode(semantic[1]).chat[0].at, undefined);
  assert.equal(deliveryNode({ ...semantic[1], verdictHistory: [{ status: "weak" }] }, false).verdictHistoryCount, 1);
  assert.equal(vocabulary(Array.from({ length: 250 }, (_, i) => ({ topics: ["topic" + i] }))).length, 200);
  const linked = [{ id: "root", kind: "root" }, { id: "focus", kind: "q", parentId: "root" }, ...Array.from({ length: 8 }, (_, i) => ({ id: "linked" + i, kind: "q", parentId: "root", answer: "x".repeat(6000), relates: [{ id: "focus", kind: "depends" }] }))];
  const limited = focusedContext(linked, "focus", "", { index: true });
  assert.ok(JSON.stringify(limited.related).length <= 20000);
  assert.equal(limited.related.length + limited.relatedOmitted.length, 8);
  assert.throws(() => indexText(Array.from({ length: 501 }, (_, i) => ({ id: String(i) }))));
  const cliRead = (command, args = []) => {
    const result = spawnSync(process.execPath, [cli, command, ...args, "--dir", dir, "--name", "check"], { cwd, windowsHide: true, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  assert.equal(JSON.parse(cliRead("node", ["q00", "q01"])).nodes.length, 2);
  assert.equal(JSON.parse(cliRead("branch", ["q05"])).nodes.length, 3);
  assert.equal(cliRead("index").split("\n").length, 41);
  assert.ok(JSON.parse(cliRead("search", ["validate requirement decision"])).matches.length);
  assert.deepEqual(JSON.parse(cliRead("related", ["q00"])), { related: [] });
  assert.deepEqual(JSON.parse(cliRead("search", ["--topic", "none"])), { matches: [] });
  const cleanText = (s, n) => String(s).trim().slice(0, n);
  for (const bad of [{ topics: Array(6).fill("topic") }, { topics: ["x".repeat(41)] }, { decision: "x".repeat(201) }, { chatDigest: "x".repeat(301) }, { relates: [{ id: "q00", kind: "depends" }] }, { relates: [{ id: "q01", kind: "unknown" }] }]) {
    const unchanged = structuredClone(semantic); assert.throws(() => applySemantics(semantic, "q00", bad, cleanText)); assert.deepEqual(semantic, unchanged);
  }
  // Navigation metadata cannot change either specification cards or knowledge source versions.
  await stop(); const annotated = structuredClone(fixture);
  annotated.nodes.forEach(n => Object.assign(n, { topics: ["metadata"], decision: "Navigation only", chatDigest: "Not evidence", semanticsStale: true, relates: n.id === "q00" ? [{ id: "q01", kind: "conflicts" }] : [] }));
  fs.writeFileSync(stateFile, JSON.stringify(annotated)); await start();
  await api("spec", {}); const annotatedSpec = await delivered("spec", false);
  assert.equal(JSON.stringify(annotatedSpec.nodes), JSON.stringify(measured.spec.nodes));
  await api("apply", { type: "spec", token: annotatedSpec.token, markdown: "# Metadata identity check" });
  await api("knowledge-import", {}); const annotatedKnowledge = await delivered("knowledge", false);
  assert.equal(JSON.stringify(annotatedKnowledge.sources), JSON.stringify(measured.knowledge.sources));
  await api("apply", { type: "knowledge", token: annotatedKnowledge.token, files: [] });
  await reset();
  // First reread is full. One subsequent main answer edit requires only its changed card.
  await api("reread", {});
  const full = await delivered("reread", false);
  assert.equal(full.context.mode, "full");
  const audit = event => [...event.context.focus, ...event.context.related].map(n => ({ id: n.id, action: "keep", reason: "Context check" }));
  await api("apply", { type: "reread", token: full.token, audit: audit(full) });
  const extraction = await delivered("knowledge", false);
  await api("apply", { type: "knowledge", token: extraction.token, files: [] });
  await api("answer", { id: "q00", answer: "A revised measured acceptance result." });
  const answer = await delivered("answer", false);
  assert.equal((await api("node?id=q00")).nodes[0].semanticsStale, true);
  await api("apply", { type: "answer", id: answer.id, token: answer.token, status: "ok", verdict: "Confirmed revised result.", semantics: { topics: ["acceptance"], relates: [{ id: "q01", kind: "same-object" }] } });
  assert.equal((await api("node?id=q00")).nodes[0].semanticsStale, undefined);
  assert.deepEqual((await api("related?id=q01")).related, [{ id: "q00", kinds: ["same-object"] }]);
  assert.equal((await api("search?topic=acceptance")).matches[0].id, "q00");
  const incremental = await delivered("reread", false);
  assert.equal(incremental.context.mode, "incremental");
  assert.ok(incremental.context.focus.some(n => n.id === "q00"));
  assert.ok(incremental.context.related.some(n => n.id === "q01"));
  assert.ok(JSON.stringify(incremental).length <= JSON.stringify(full).length * 0.4);
  console.log(`incremental reread\t${JSON.stringify(incremental).length}\tfull ${JSON.stringify(full).length}`);
  await api("apply", { type: "reread", token: incremental.token, audit: audit(incremental), semantics: [{ id: "q02", topics: ["unaudited"] }] }, 400);
  await api("apply", { type: "reread", token: incremental.token, audit: audit(incremental) });
  assert.equal((await api("state")).knowledgePending, null);
  await api("reread", {}); const manual = await delivered("reread", false);
  assert.equal(manual.context.mode, "full");
  await api("apply", { type: "reread", token: manual.token, audit: audit(manual) });
  // Preview evidence stays byte-identical after API-authored navigation annotations,
  // including prepared projects without a commit and immutable built snapshots.
  for (const built of [false, true]) {
    await reset();
    const { id } = await api("preview/prepare", { sourceId: "q00" });
    const prepared = await delivered("preview", false);
    const previewResult = event => ({ type: "preview", id, token: event.token, projectId: event.projectId, base: event.base });
    await api("apply", { ...previewResult(prepared), question: "Which visual?", options: ["UI", "Diagram"] });
    if (built) {
      await api("preview/build", { id, request: "Circle UI" });
      const build = await delivered("preview", false);
      await api("apply", { ...previewResult(build), files: circlePreview, purpose: "Circle" });
    }
    const annotatePreview = async semantics => {
      await api("reread", {}); const review = await delivered("reread", false);
      await api("apply", { type: "reread", token: review.token, audit: audit(review), ...(semantics ? { semantics: [{ id, ...semantics }] } : { brief: "Preview evidence fixture" }) });
      if ((await api("state")).knowledgePending) {
        const extraction = await delivered("knowledge", false);
        await api("apply", { type: "knowledge", token: extraction.token, files: [] });
      }
    };
    // Normalize preview reconciliation bookkeeping equally for both captures.
    await annotatePreview();
    const capture = async () => {
      await api("spec", {});
      const job = JSON.parse(fs.readFileSync(stateFile)).specJob;
      const event = await delivered("spec", false);
      await api("apply", { type: "spec", token: event.token, markdown: "# Preview evidence" });
      return { nodes: job.nodes, gradingNodes: job.gradingNodes, delivered: event.nodes };
    };
    const baseline = await capture();
    const previewEvidence = baseline.delivered.find(n => n.id === id);
    assert.equal(previewEvidence.sourceId, "q00");
    assert.equal(previewEvidence.parentId, "q00");
    if (built) {
      assert.match(previewEvidence.snapshot, /^[a-f0-9]{64}$/);
      assert.ok(previewEvidence.link.endsWith("#preview=" + previewEvidence.snapshot));
      assert.equal((await api("preview/snapshot?key=" + previewEvidence.snapshot)).purpose, "Circle");
    } else {
      assert.equal(previewEvidence.question, "Which visual?");
      assert.deepEqual(previewEvidence.options, ["UI", "Diagram"]);
      assert.equal(previewEvidence.link, null);
    }
    await annotatePreview({ topics: ["preview-navigation"], decision: "Navigation sentinel", chatDigest: "Digest sentinel", relates: [{ id: "q01", kind: "depends" }] });
    assert.equal((await api(`node?id=${id}`)).nodes[0].decision, "Navigation sentinel");
    const annotated = await capture();
    for (const key of Object.keys(baseline)) for (let i = 0; i < baseline[key].length; i++) assert.deepEqual(annotated[key][i], baseline[key][i]);
    assert.equal(JSON.stringify(annotated), JSON.stringify(baseline));
    for (const nodes of Object.values(annotated)) {
      const preview = nodes.find(n => n.id === id);
      for (const key of ["topics", "relates", "decision", "chatDigest", "semanticsStale"]) assert.equal(key in preview, false);
    }
  }
  // Near duplicate guards reject whole transactions, and explicit matching IDs allow intentional overlap.
  await reset();
  await api("init", { questions: [{ q: "Which authentication protocol protects account access?", options: ["Token", "Password"] }, { q: "How are database backups restored?", options: ["Manual", "Scheduled"] }] });
  let state = await api("state"); const auth = state.nodes.find(n => n.kind === "q"), backup = state.nodes.find(n => n.kind === "q" && n.id !== auth.id);
  const duplicate = { q: auth.q, options: ["Token", "Password"] };
  await api("apply", { type: "more", questions: [duplicate] }, 400);
  assert.deepEqual((await api("state")).nodes, state.nodes);
  await api("apply", { type: "more", questions: [{ ...duplicate, allowSimilar: [auth.id] }] });
  assert.equal((await api("state")).nodes.length, state.nodes.length + 1);
  // Unknown source versions are retryable 400s. Saved metadata receives exact captured evidence.
  await api("knowledge-import", {}); const job = await delivered("knowledge", false);
  const source = job.sources.find(n => n.card === auth.id);
  assert.equal(source.snapshot, undefined);
  const metadata = { id: "context-check", type: "technical", scope: "test", status: "current", sources: [{ path: job.sourcePath, session: job.session, ...source }] };
  const prose = "\n# Preserve this prose\n\nManual text remains byte-identical.\n";
  const document = record => "<!-- vgril:1 -->\n```json\n" + JSON.stringify(record) + "\n```\n" + prose;
  const file = { path: "docs/vgril/context-check.md", expected: null, text: document(metadata) };
  const badMeta = structuredClone(metadata); badMeta.sources[0].version = "unknown";
  await api("apply", { type: "knowledge", token: job.token, files: [{ ...file, text: document(badMeta) }] }, 400);
  assert.equal((await api("state")).knowledgePending.stage, "thinking");
  await api("apply", { type: "knowledge", token: job.token, files: [file] });
  const saved = fs.readFileSync(path.join(cwd, file.path), "utf8");
  assert.ok(saved.endsWith(prose));
  const savedMeta = JSON.parse(saved.match(/```json\n([\s\S]*?)\n```/)[1]);
  const captured = JSON.parse(savedMeta.sources[0].snapshot);
  assert.equal(captured.id, auth.id); assert.equal(digest(savedMeta.sources[0].snapshot), source.version);
  // A frozen answer exposes only token-bound captured reads; old tokens fail after apply/restart.
  await api("answer", { id: auth.id, answer: "Token credentials" });
  await api("spec", {}); const frozen = await delivered("answer", false);
  assert.equal(frozen.context.readToken, frozen.token);
  assert.equal((await api(`node?id=${auth.id}&token=${frozen.token}`)).nodes[0].pending.answer, "Token credentials");
  await api("apply", { type: "answer", id: auth.id, token: frozen.token, status: "ok", verdict: "Confirmed", semantics: { relates: [{ id: "absent", kind: "depends" }] } }, 400);
  await api("apply", { type: "answer", id: auth.id, token: frozen.token, status: "ok", verdict: "Confirmed", semantics: { topics: ["AUTH"], decision: "Credentials" } });
  await api(`node?id=${auth.id}&token=${frozen.token}`, undefined, 409);
  const spec = await delivered("spec", false);
  assert.equal(spec.nodes.find(n => n.id === auth.id).topics, undefined);
  assert.equal(spec.nodes.find(n => n.id === auth.id).decision, undefined);
  await api("apply", { type: "spec", token: spec.token, markdown: "# Fixture specification" });
  await api("answer", { id: backup.id, answer: "Manual backups" }); await api("spec", {});
  const restarting = await delivered("answer", false); await stop(); await start();
  await api(`node?id=${backup.id}&token=${restarting.token}`, undefined, 409);
  // Merged outgoing unions never silently drop links to fit the eight-link contract.
  const linkedCards = [{ id: "kept", relates: Array.from({ length: 5 }, (_, i) => ({ id: `target${i}`, kind: "depends" })) },
    { id: "merged", relates: Array.from({ length: 5 }, (_, i) => ({ id: `target${i + 4}`, kind: "depends" })) },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `target${i}` }))];
  const linkedResult = reconcileLinks(linkedCards, structuredClone(linkedCards.filter(n => n.id !== "merged")), new Map([["merged", "kept"]]));
  assert.equal(linkedResult[0].relates.length, 9);
  assert.throws(() => validateLinks(linkedResult));
  applySemantics(linkedResult, "kept", { relates: linkedResult[0].relates.slice(0, 8) }, (text, limit) => String(text).slice(0, limit));
  validateLinks(linkedResult);
  // Unrelated large histories must remain retrievable without blocking focused work.
  const standardFixture = fixture;
  const largeFixture = structuredClone(standardFixture);
  largeFixture.nodes = largeFixture.nodes.filter(n => n.id === "root" || /^q0[0-4]$/.test(n.id));
  for (const n of largeFixture.nodes.filter(n => n.kind === "q")) {
    n.q = `Unique card ${n.id}`; n.answer = null; n.status = "open";
    n.chat = n.id === "q04" ? [] : Array.from({ length: 90 }, (_, i) => ({ id: `${n.id}-${i}`, from: i % 2 ? "claude" : "user", text: "x".repeat(2000), at: i }));
  }
  fixture = largeFixture; await reset();
  await api("discuss", { id: "q04", message: "Explain this tiny card" });
  const smallDiscussion = await delivered("discuss", false);
  assert.ok(JSON.stringify(smallDiscussion).length < 20000);
  assert.equal((await api("node?id=q00")).nodes[0].chat.length, 90);
  await api("apply", { type: "discuss", id: "q04", token: smallDiscussion.token, reply: "Explanation" });
  await reset(); await api("idea", { id: "large-map-idea", text: "A tiny isolated proposal" });
  const smallIdea = await delivered("idea", false);
  await api("apply", { type: "idea", id: smallIdea.id, token: smallIdea.token, status: "weak", verdict: "Needs evidence" });
  fixture = structuredClone(largeFixture);
  fixture.rereadSeen = Object.fromEntries(fixture.nodes.map(n => [n.id, digest(JSON.stringify(evidenceNode(n)))]));
  fixture.nodes.find(n => n.id === "q04").answer = "New evidence";
  fixture.rereadJob = { stage: "queued", manual: false, edits: [], settled: true };
  fixture.queue = [{ type: "reread" }];
  await reset(); const smallReread = await delivered("reread", false);
  assert.equal(smallReread.context.mode, "incremental");
  assert.deepEqual(smallReread.context.focus.map(n => n.id), ["q04"]);
  await api("apply", { type: "reread", token: smallReread.token, audit: [{ id: "q04", action: "keep", reason: "Reviewed new evidence" }] });
  await api("reread", {}); await api("wait?timeout=1", undefined, 400);
  // The same histories inside the required focus still fail explicitly.
  fixture = structuredClone(largeFixture);
  fixture.nodes.filter(n => n.kind === "q" && n.id !== "q04").forEach(n => { n.parentId = "q04"; });
  await reset(); await api("discuss", { id: "q04", message: "Read the entire branch" });
  await api("wait?timeout=1", undefined, 400);
  fixture = structuredClone(largeFixture);
  fixture.nodes.push({ id: "large-idea", parentId: "root", kind: "idea", text: "Large proposal", q: "Large proposal", status: "open", analysis: { stage: "queued", reason: "manual" } });
  fixture.nodes.filter(n => n.kind === "q").forEach(n => { n.parentId = "large-idea"; });
  fixture.queue = [{ type: "idea", id: "large-idea" }];
  await reset(); await api("wait?timeout=1", undefined, 400);
  fixture = structuredClone(largeFixture);
  fixture.rereadSeen = {}; fixture.rereadJob = { stage: "queued", manual: false, edits: [], settled: true }; fixture.queue = [{ type: "reread" }];
  await reset(); await api("wait?timeout=1", undefined, 400);
  // Merges preserve the navigation graph; copied/combined evidence makes summaries stale.
  fixture = structuredClone(standardFixture);
  fixture.nodes = fixture.nodes.filter(n => n.id === "root" || /^q0[0-4]$/.test(n.id));
  for (const n of fixture.nodes) { n.chat = []; delete n.relates; }
  const card = id => fixture.nodes.find(n => n.id === id);
  card("q00").relates = [{ id: "q01", kind: "depends" }, { id: "q04", kind: "same-object" }];
  card("q00").decision = "Old combined summary";
  card("q01").relates = [{ id: "q02", kind: "same-object" }];
  card("q02").relates = [{ id: "q01", kind: "depends" }];
  card("q03").answer = null; card("q03").decision = "Old unanswered summary";
  card("q04").answer = null;
  await reset(); await api("reread", {}); const graphReview = await delivered("reread", false);
  const graphResult = { type: "reread", token: graphReview.token,
    merge: [{ ids: ["q00", "q01"], keep: "q00", answer: "Combined evidence", status: "ok", verdict: "Combined" }],
    close: [{ id: "q03", source: "q02", verdict: "Answered by q02" }], remove: ["q04"],
    audit: ["q00", "q01", "q02", "q03", "q04"].map(id => ({ id, action: id === "q03" ? "close" : id === "q04" ? "remove" : ["q00", "q01"].includes(id) ? "merge" : "keep", reason: "Reviewed evidence and graph" })) };
  await api("apply", graphResult);
  const graphState = (await api("state")).nodes;
  assert.deepEqual(graphState.find(n => n.id === "q00").relates, [{ id: "q02", kind: "same-object" }]);
  assert.deepEqual(graphState.find(n => n.id === "q02").relates, [{ id: "q00", kind: "depends" }]);
  assert.equal(graphState.find(n => n.id === "q00").semanticsStale, true);
  assert.equal(graphState.find(n => n.id === "q03").semanticsStale, true);
  // Indirect navigation rewrites still require audit in incremental mode, atomically.
  fixture.rereadSeen = Object.fromEntries(fixture.nodes.map(n => [n.id, digest(JSON.stringify(evidenceNode(n)))]));
  card("q00").answer = "Edited evidence";
  fixture.rereadJob = { stage: "queued", manual: false, edits: [], settled: true }; fixture.queue = [{ type: "reread" }];
  await reset(); const incrementalGraph = await delivered("reread", false);
  const graphBefore = (await api("state")).nodes;
  await api("apply", { ...graphResult, token: incrementalGraph.token, audit: graphResult.audit.filter(a => a.id !== "q02") }, 400);
  assert.deepEqual((await api("state")).nodes, graphBefore);
  await api("apply", { ...graphResult, token: incrementalGraph.token, semantics: [{ id: "q00", decision: "Combined evidence" }, { id: "q03", decision: "Copied evidence" }] });
  assert.equal((await api("state")).nodes.find(n => n.id === "q00").semanticsStale, undefined);
  // Answer branch removals reconcile live and captured trees atomically.
  fixture = structuredClone(standardFixture);
  fixture.nodes = fixture.nodes.filter(n => ["root", "q00", "q01", "q02"].includes(n.id));
  for (const n of fixture.nodes) n.chat = [];
  card("q01").parentId = "q00"; card("q01").answer = null;
  card("q02").relates = [{ id: "q01", kind: "depends" }];
  await reset(); await api("answer", { id: "q00", answer: "Keep the retained evidence" }); await api("spec", {});
  const deletingAnswer = await delivered("answer", false);
  const beforeDelete = (await api("state")).nodes;
  const answerDelete = { type: "answer", id: "q00", token: deletingAnswer.token, status: "ok", verdict: "Reviewed", branchChanges: { remove: ["q01"] } };
  await api("apply", { ...answerDelete, semantics: { relates: [{ id: "q01", kind: "depends" }] } }, 400);
  assert.deepEqual((await api("state")).nodes, beforeDelete);
  await api("apply", answerDelete);
  assert.deepEqual((await api("state")).nodes.find(n => n.id === "q02").relates, []);
  const deletingSpec = await delivered("spec", false);
  assert.equal(deletingSpec.nodes.some(n => n.id === "q01"), false);
  // Idea audit removals and explicit idea deletion both prune outside incoming links.
  fixture = structuredClone(standardFixture);
  fixture.nodes = fixture.nodes.filter(n => ["root", "q00", "q02"].includes(n.id));
  for (const n of fixture.nodes) n.chat = [];
  fixture.nodes.push({ id: "proposal", parentId: "root", kind: "idea", text: "Proposal", q: "Proposal", revision: 1, decision: "Old proposal", status: "weak", analysis: { stage: "queued", reason: "manual" } });
  card("q00").parentId = "proposal"; card("q00").answer = null;
  card("q02").relates = [{ id: "q00", kind: "depends" }, { id: "proposal", kind: "same-object" }];
  fixture.queue = [{ type: "idea", id: "proposal" }];
  await reset(); const deletingIdea = await delivered("idea", false);
  await api("apply", { type: "idea", id: "proposal", token: deletingIdea.token, status: "weak", verdict: "Reviewed", audit: [{ id: "q00", action: "remove", reason: "No longer needed" }] });
  assert.deepEqual((await api("state")).nodes.find(n => n.id === "q02").relates, [{ id: "proposal", kind: "same-object" }]);
  await api("idea/edit", { id: "proposal", revision: 1, text: "Edited proposal" });
  assert.equal((await api("state")).nodes.find(n => n.id === "proposal").semanticsStale, true);
  const editedIdea = await delivered("idea", false);
  await api("apply", { type: "idea", id: "proposal", token: editedIdea.token, status: "weak", verdict: "Reviewed again", audit: [], semantics: { decision: "Edited proposal" } });
  assert.equal((await api("state")).nodes.find(n => n.id === "proposal").semanticsStale, undefined);
  await api("idea/delete", { id: "proposal", confirm: true });
  assert.deepEqual((await api("state")).nodes.find(n => n.id === "q02").relates, []);
  fixture = standardFixture;
  // Redelivery is another measurement; polling is not. History survives recovery.
  await reset(); await api("more", {});
  for (let i = 0; i < 205; i++) await delivered("more", false);
  const stats = (await api("state")).contextStats;
  assert.equal(stats.recent.length, 200); assert.equal(stats.totals.more.count, 205);
  assert.equal(stats.totals.more.characters, stats.recent[0].characters * 205);
  await stop(); await start();
  assert.deepEqual((await api("state")).contextStats, stats);
  await delivered("more", false);
  assert.equal((await api("state")).contextStats.totals.more.count, 206);
  await api("init", { questions: [{ q: "Reset?", options: ["Yes", "No"] }] });
  assert.deepEqual((await api("state")).contextStats, { recent: [], totals: {} });
  console.log("Context accounting, bounded history, restart and reset checks passed");
} finally {
  await stop(); fs.rmSync(cwd, { recursive: true, force: true });
}
