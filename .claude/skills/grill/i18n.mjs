import fs from "node:fs";
import { createHash } from "node:crypto";

const english = JSON.parse(fs.readFileSync(new URL("./locales/en.json", import.meta.url), "utf8"));
const phrase = /[А-Яа-яЁё]+(?:[ А-Яа-яЁё0-9.,:;!?…—–()«»%+-]*[А-Яа-яЁё0-9.!?…:»)])?/g;
export function locale(input = { language: "ru" }, stored = false) {
  let language;
  try { if (typeof input.language === "string") language = Intl.getCanonicalLocales(input.language)[0]; } catch {}
  if (!language) throw new Error("A valid language tag is required");
  const base = language.split("-")[0];
  const messages = {};
  for (const key of Object.keys(english)) {
    // Saved custom dictionaries can predate newly added UI phrases; explicit input stays strict.
    const value = input.messages?.[key] ?? (base === "ru" ? key : base === "en" || stored ? english[key] : undefined);
    // Plain text only: these phrases occur in both HTML attributes and JS-generated markup.
    if (typeof value !== "string" || !value.trim() || value.length > 2000 || /[<>\x00-\x1f&"]/.test(value)) throw new Error(`Missing or unsafe translation: ${key}`);
    messages[key] = value;
  }
  return { language, messages };
}
export const revision = l => createHash("sha256").update(JSON.stringify(l)).digest("hex");
export const translate = (l, text) => Object.hasOwn(l.messages, text) ? l.messages[text] : text;
export function page(source, l, doubleClickMs = 5000) {
  const { version } = JSON.parse(fs.readFileSync(new URL("./version.json", import.meta.url), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version");
  source = source.replace("__GRILL_VERSION__", version);
  const clickDelay = Number.isFinite(doubleClickMs) && doubleClickMs > 0 && doubleClickMs <= 10000 ? Math.ceil(doubleClickMs) + 100 : 5100;
  const parts = source.split(/(<script>|<\/script>)/);
  let script = false;
  const out = parts.map(part => {
    if (part === "<script>") { script = true; return part + `\nconst PAGE_LOCALE = "${revision(l)}";\nconst PAGE_DOUBLE_CLICK_MS = ${clickDelay};\n`; }
    if (part === "</script>") { script = false; return part; }
    return part.replace(phrase, text => {
      const value = translate(l, text);
      // Unicode escapes preserve single-, double-, and template-string boundaries.
      return script ? value.split("").map(c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join("") : value;
    });
  }).join("");
  return out.replace('<html lang="ru">', `<html lang="${l.language}" dir="${/^(ar|fa|he|ur)(-|$)/.test(l.language) ? "rtl" : "ltr"}">`);
}
