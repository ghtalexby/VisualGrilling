#!/usr/bin/env node
// Stop all test workspace map servers, unnamed and named, and delete test-project/.grill.
//
//   node dev/reset.mjs [--keep-state]   preserve state and stop servers only

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CWD = path.join(ROOT, "test-project");
const DIR = path.join(CWD, ".grill");

if (fs.existsSync(DIR)) {
  const names = [null, ...fs.readdirSync(DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)];
  for (const n of names) {
    if (!fs.existsSync(path.join(DIR, n || "", "server.json"))) continue;
    const r = spawnSync(process.execPath, [path.join(ROOT, "skills", "grill", "grill.mjs"), "stop", ...(n ? ["--name", n] : [])], { cwd: CWD, encoding: "utf8" });
    console.log((r.stdout || r.stderr).trim());
  }
}
if (!process.argv.includes("--keep-state")) {
  // Allow the server to exit and remove server.json after its 100 ms delay.
  await new Promise(r => setTimeout(r, 300));
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log("Удалено: " + DIR);
}
