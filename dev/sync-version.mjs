// Keep the copied skill independent of the repository's package.json.
import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Ожидается версия в формате X.Y.Z");
// Git tracks this mirror as files; locally it may instead be a junction to the source.
const mirror = new URL("../.claude/skills/grill/", import.meta.url);
const directories = [new URL("../skills/grill/", import.meta.url), ...(fs.existsSync(mirror) ? [mirror] : [])];
const updates = directories.map(directory => {
  const file = new URL("ui.html", directory);
  const source = fs.readFileSync(file, "utf8");
  const target = /(<span id="brandVersion" title=")[^"]*(")/;
  if (!target.test(source)) throw new Error("Не найден заголовок с версией скилла");
  return { directory, file, source: source.replace(target, `$1${version}$2`) };
});
for (const { directory, file, source } of updates) {
  fs.writeFileSync(new URL("version.json", directory), JSON.stringify({ version }, null, 2) + "\n");
  fs.writeFileSync(file, source);
}
