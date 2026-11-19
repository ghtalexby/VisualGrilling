// Offline experiment preparation. Never launches a server, model, or host session.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { fixture } from "./fixtures/single-session.mjs";

const hash = data => createHash("sha256").update(data).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
async function write(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value, { flag: "wx" }); }
export async function inventory(root) {
  const files = {};
  async function walk(relative) {
    for (const item of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = path.posix.join(relative, item.name);
      if (item.isSymbolicLink()) throw new Error(`Символическая ссылка запрещена: ${name}`);
      if (item.isDirectory()) await walk(name);
      else if (item.isFile()) files[name] = hash(await fs.readFile(path.join(root, name)));
      else throw new Error(`Необычный файл: ${name}`);
    }
  }
  await walk("");
  return { sha256: hash(json(files)), files };
}
async function runtime(root, commit) {
  const resolved = await fs.realpath(root);
  const content = await inventory(resolved);
  const version = JSON.parse(await fs.readFile(path.join(resolved, "version.json"), "utf8"));
  const defaults = JSON.parse(await fs.readFile(path.join(resolved, "config.default.json"), "utf8"));
  return { path: resolved, commit, version, defaults, ...content };
}
const metrics = () => ({ primary: null, descendants: null, telemetryComplete: null, observedWorkerSessions: null,
  input: null, cached: null, uncached: null, output: null, reasoning: null, modelResponses: null, toolCalls: null,
  cliRequests: null, applies: null, retries: null, elapsedMs: null, reads: null, duplicateReads: null, truncatedReads: null,
  compactions: null, transfers: null, contextGrowth: null, artifacts: null, events: null });
export async function prepare(options) {
  for (const key of ["baseline", "candidate", "baseCommit", "candidateCommit", "host", "hostVersion", "model", "effort", "mode"]) {
    if (typeof options[key] !== "string" || !options[key].trim()) throw new Error(`Нужен параметр ${key}.`);
  }
  if (!["hybrid", "monitor", "blocking"].includes(options.mode)) throw new Error("Неизвестный режим ожидания.");
  const A = await runtime(options.baseline, options.baseCommit), B = await runtime(options.candidate, options.candidateCommit);
  if (A.defaults.workerReuse?.enabled !== false) throw new Error("Baseline должен использовать fresh-worker defaults.");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grill-single-session-comparison-"));
  const manifest = { schemaVersion: 1, experimentId: path.basename(root), createdAt: new Date().toISOString(), status: "prepared-not-measured",
    environment: { host: options.host, hostVersion: options.hostVersion, model: options.model, effort: options.effort, language: "en", waitingMode: options.mode, providerCache: "uncontrolled; record observed counters", node: process.version, platform: process.platform },
    variants: { A, B }, fixtures: {}, runs: [], acceptance: { S11: "pending", reason: "No matched real host sessions or human semantic assessment have been performed." } };
  for (const workload of ["standard", "broad-substitute"]) {
    const data = fixture(workload), frozen = path.join(root, "fixtures", workload);
    for (const [file, content] of Object.entries(data.project)) await write(path.join(frozen, "project", file), content);
    await write(path.join(frozen, "project", ".grill", "comparison", "state.json"), json(data.state));
    // Identical explicit settings: baseline fresh-worker behavior; candidate legacy entry must be inert.
    await write(path.join(frozen, "project", ".grill", "config.json"), json({ workerReuse: { enabled: false }, knowledge: { rereadThreshold: 5 }, session: { rolloverTokens: 120000 } }));
    await write(path.join(frozen, "sequence.json"), json({ label: data.label, warmup: data.warmup, steps: data.steps, semanticChecklist: data.semanticChecklist }));
    manifest.fixtures[workload] = { path: frozen, label: data.label, ...await inventory(frozen), projectHash: (await inventory(path.join(frozen, "project"))).sha256,
      mapHash: hash(json(data.state)), knowledgeHash: hash(data.project["docs/contract.md"]), knowledgeFiles: ["docs/contract.md"] };
    for (const history of ["fresh", "warm"]) for (let pair = 1; pair <= 3; pair++) {
      const order = pair % 2 ? ["A", "B"] : ["B", "A"];
      for (const variant of order) {
        const runId = `${workload}-${history}-${pair}-${variant}`, directory = path.join(root, "runs", runId);
        await fs.mkdir(directory, { recursive: true });
        await fs.cp(path.join(frozen, "project"), path.join(directory, "project"), { recursive: true, errorOnExist: true, force: false });
        const run = { runId, workload, history, pair, variant, order: order.indexOf(variant) + 1, directory,
          project: path.join(directory, "project"), mapsRoot: path.join(directory, "project", ".grill"), mapName: "comparison", hubHome: path.join(directory, "hub"),
          initialProjectHash: manifest.fixtures[workload].projectHash, sequenceHash: manifest.fixtures[workload].files["sequence.json"] };
        manifest.runs.push(run);
        await write(path.join(directory, "measurement.template.json"), json({ runId, status: "not-run", sessionId: null, startedAt: null, exclusiveCutoff: null,
          observedEnvironment: null, providerCache: "unknown", warmHistoryEstablished: null, baselineFreshWorkerConfirmed: null, noOrdinaryChildrenConfirmed: null,
          prelude: metrics(), scenario: metrics(), wholeSession: metrics(), auditEvidence: [], semanticReview: { reviewer: null, outcome: "pending", cardCoverage: null, differences: null, unresolved: null }, failure: null }));
      }
    }
  }
  await write(path.join(root, "manifest.json"), json(manifest));
  return { root, manifest };
}
export async function verify(file, { initial = false } = {}) {
  const manifest = JSON.parse(await fs.readFile(file, "utf8"));
  for (const [name, entry] of Object.entries({ ...manifest.variants, ...manifest.fixtures })) {
    if ((await inventory(entry.path)).sha256 !== entry.sha256) throw new Error(`Изменён источник ${name}; подготовьте новый эксперимент.`);
  }
  if (initial) for (const run of manifest.runs) {
    if ((await inventory(run.project)).sha256 !== run.initialProjectHash) throw new Error(`Начальное состояние изменено: ${run.runId}`);
  }
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, file, flag] = process.argv.slice(2);
    if (command === "prepare" && file && !flag) console.log((await prepare(JSON.parse(await fs.readFile(file, "utf8")))).root);
    else if (command === "verify" && file && (!flag || flag === "--initial")) { await verify(file, { initial: flag === "--initial" }); console.log("Хеши подтверждены."); }
    else throw new Error("Использование: node dev/single-session-comparison.mjs prepare <options.json> | verify <manifest.json> [--initial]");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
