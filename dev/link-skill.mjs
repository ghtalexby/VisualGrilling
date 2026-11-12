#!/usr/bin/env node
// Link skills/grill into test-project and, with --global, the user's skill directory.
// A junction or symlink makes working-copy edits available without recopying.
//
//   node dev/link-skill.mjs [--codex] [--global]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "skills", "grill");
// Link the whole package: event rules and mode workflows are loaded on demand.
const required = ["SKILL.md", "worker.md", "knowledge.md", "preview-format.md", "monitor.md", "dispatcher.md", "parallel-maps.md",
  ...["answer", "discuss", "question", "reread", "reevaluate", "idea", "spec", "finish"].map(name => `events/${name}.md`)];
for (const file of required) {
  if (!fs.existsSync(path.join(SKILL, file))) {
    console.error(`Неполный скилл: отсутствует ${path.join(SKILL, file)}`);
    process.exit(1);
  }
}
const args = process.argv.slice(2);
if (args.some(a => !["--codex", "--global"].includes(a))) {
  console.error("Использование: node dev/link-skill.mjs [--codex] [--global]");
  process.exit(1);
}
const config = args.includes("--codex") ? ".agents" : ".claude";
const targets = [path.join(ROOT, "test-project", config, "skills", "grill")];
if (args.includes("--global")) targets.push(path.join(os.homedir(), config, "skills", "grill"));

for (const t of targets) {
  fs.mkdirSync(path.dirname(t), { recursive: true });
  const st = fs.lstatSync(t, { throwIfNoEntry: false });
  if (st) {
    if (st.isSymbolicLink() && fs.existsSync(t) && fs.realpathSync(t) === fs.realpathSync(SKILL)) {
      console.log(`Скилл уже подключён: ${t}`);
      continue;
    }
    console.error(`Пропускаю ${t}: путь уже занят. Сохраните его содержимое и освободите путь вручную.`);
    process.exitCode = 1;
    continue;
  }
  // Windows junctions do not require administrator privileges.
  fs.symlinkSync(SKILL, t, process.platform === "win32" ? "junction" : "dir");
  console.log(`Скилл подключён: ${t} -> ${SKILL}`);
}
