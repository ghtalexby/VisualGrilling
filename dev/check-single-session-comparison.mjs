import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepare, verify, inventory } from "./single-session-comparison.mjs";
import { fixture } from "./fixtures/single-session.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "grill-comparison-check-"));
let prepared, server;
async function stop() {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(resolve => server.once("exit", resolve)); server.kill(); await exited;
  }
}
try {
  for (const variant of ["A", "B"]) {
    await fs.mkdir(path.join(root, variant));
    await fs.writeFile(path.join(root, variant, "version.json"), '{"version":"fixture-only"}');
    await fs.writeFile(path.join(root, variant, "config.default.json"), JSON.stringify({ workerReuse: { enabled: false } }));
  }
  const options = { baseline: path.join(root, "A"), candidate: path.join(root, "B"), baseCommit: "test-base", candidateCommit: "test-candidate", host: "test-only", hostVersion: "test-only", model: "no-inference", effort: "none", mode: "hybrid" };
  await assert.rejects(prepare({ ...options, model: "" }), /model/);
  prepared = await prepare(options);
  const manifestFile = path.join(prepared.root, "manifest.json");
  const manifest = await verify(manifestFile, { initial: true });
  assert.equal(manifest.runs.length, 24);
  assert.equal(new Set(manifest.runs.map(run => run.project)).size, 24);
  assert.equal(fixture("standard").steps.filter(step => step.id.startsWith("answer-")).length, 12);
  assert.equal(fixture("broad-substitute").state.nodes.filter(node => node.kind === "q").length, 73);
  for (const workload of ["standard", "broad-substitute"]) for (const history of ["fresh", "warm"]) {
    assert.deepEqual(manifest.runs.filter(run => run.workload === workload && run.history === history).map(run => run.variant), ["A", "B", "B", "A", "A", "B"]);
  }
  for (const run of manifest.runs) {
    const measurement = JSON.parse(await fs.readFile(path.join(run.directory, "measurement.template.json"), "utf8"));
    assert.equal(measurement.wholeSession.input, null);
    assert.equal(measurement.semanticReview.outcome, "pending");
  }
  const first = manifest.runs[0];
  await fs.appendFile(path.join(first.project, "README.md"), "Changed run only.");
  await assert.rejects(verify(manifestFile, { initial: true }), /Начальное/);
  await verify(manifestFile);
  assert.equal((await inventory(manifest.runs[1].project)).sha256, first.initialProjectHash);
  await fs.appendFile(path.join(root, "A", "version.json"), " ");
  await assert.rejects(verify(manifestFile), /Изменён источник A/);
  await fs.writeFile(path.join(root, "A", "version.json"), '{"version":"fixture-only"}');
  await fs.appendFile(path.join(manifest.fixtures.standard.path, "sequence.json"), " ");
  await assert.rejects(verify(manifestFile), /Изменён источник standard/);

  // Real runtime load only: no host binding, model calls, user maps or synthetic grades.
  for (const workload of ["standard", "broad-substitute"]) {
    const run = manifest.runs.find(entry => entry.workload === workload && entry.variant === "B");
    const runtime = fileURLToPath(new URL("../skills/grill/grill.mjs", import.meta.url));
    server = spawn(process.execPath, [runtime, "serve", "--dir", run.mapsRoot, "--name", run.mapName, "--port", "0", "--lang", "en"], {
      cwd: run.project, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, GRILL_HUB_HOME: run.hubHome, CODEX_HOME: path.join(root, "empty-codex"), CODEX_THREAD_ID: "" }
    });
    let stderr = "", url;
    server.stderr.on("data", data => stderr += data);
    for (let attempt = 0; attempt < 100; attempt++) {
      try { const info = JSON.parse(await fs.readFile(path.join(run.mapsRoot, run.mapName, "server.json"), "utf8")); if (info.pid === server.pid) { url = info.url; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(url, stderr || "Server startup timeout");
    const state = await fetch(url + "api/state", { headers: { "x-grill": "1" }, signal: AbortSignal.timeout(5000) }).then(response => response.json());
    assert.equal(state.nodes.filter(node => node.kind === "q").length, workload === "standard" ? 12 : 73);
    assert.equal(state.locale.language, "en");
    assert.equal((await fetch(url + "api/state", { signal: AbortSignal.timeout(5000) })).status, 403);
    await stop();
  }
  console.log("Comparison preparation checks passed: 24 isolated runs, alternating pairs, null telemetry, immutable-source drift detection, runtime fixture loading and HTTP 403.");
} finally {
  await stop();
  // Both roots are created above by mkdtemp, never supplied by the caller.
  if (prepared) await fs.rm(prepared.root, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
}
