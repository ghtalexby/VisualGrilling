// Keep the copied skill independent of the repository's package.json.
import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Ожидается версия в формате X.Y.Z");
fs.writeFileSync(new URL("../skills/grill/version.json", import.meta.url), JSON.stringify({ version }, null, 2) + "\n");
// Git tracks this mirror as files; locally it may instead be a junction to the source.
const mirror = new URL("../.claude/skills/grill/", import.meta.url);
if (fs.existsSync(mirror)) fs.writeFileSync(new URL("version.json", mirror), JSON.stringify({ version }, null, 2) + "\n");
