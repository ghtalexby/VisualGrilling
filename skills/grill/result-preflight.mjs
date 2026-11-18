// Worker-local structural checks only; the server remains authoritative.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateWorkerContextAck } from "./worker-reuse.mjs";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const bad = field => { throw new Error(`Некорректный результат: ${field}`); };
const text = (value, field, max = Infinity) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) bad(field);
};
const list = (value, field) => {
  if (!Array.isArray(value) || value.length > 500) bad(field);
  return value;
};
function coverage(value, field, status) {
  if (!object(value) || typeof value.resolved !== "boolean") bad(`${field}.resolved`);
  text(value.reason, `${field}.reason`, 2000);
  for (const source of list(value.sources, `${field}.sources`)) {
    if (!object(source)) bad(`${field}.sources`);
    for (const key of ["id", "answer", "contribution"]) text(source[key], `${field}.sources.${key}`, key === "contribution" ? 2000 : Infinity);
  }
  const gaps = list(value.gaps, `${field}.gaps`);
  for (const gap of gaps) {
    if (!object(gap)) bad(`${field}.gaps`);
    text(gap.gap, `${field}.gaps.gap`, 1000);
    if (!list(gap.questionIds, `${field}.gaps.questionIds`).length) bad(`${field}.gaps.questionIds`);
    for (const id of gap.questionIds) text(id, `${field}.gaps.questionIds`);
  }
  if (value.questions !== undefined) list(value.questions, `${field}.questions`);
  if (value.resolved ? gaps.length || status && status !== "ok" : !gaps.length || status === "ok") bad(`${field}: resolved/status/gaps`);
}
function grade(entry, field, intent = false, frozen = false) {
  if (!object(entry) || !["ok", "weak", "gap", "verify"].includes(entry.status)) bad(`${field}.status`);
  text(entry.verdict, `${field}.verdict`, 400);
  coverage(entry.coverage, `${field}.coverage`, entry.status);
  if (!intent) return;
  const inline = Object.hasOwn(entry, "ancestors"), review = Object.hasOwn(entry, "reviewAncestors");
  if (frozen) {
    if (inline || review) bad(`${field}: frozen ancestors`);
    return;
  }
  if (inline === review || review && entry.reviewAncestors !== true) bad(`${field}: ancestors или reviewAncestors:true`);
  if (inline) for (const ancestor of list(entry.ancestors, `${field}.ancestors`)) {
    text(ancestor?.id, `${field}.ancestors.id`);
    grade(ancestor, `${field}.ancestors`);
  }
}
export function validateResults(inbox, results, expected) {
  text(expected, "token");
  if (!object(inbox) || inbox.token !== expected || !Array.isArray(results) || !results.length || results.length > 500) bad("inbox/token/files");
  const multipart = results.length > 1 || results.some(result => object(result) && (Object.hasOwn(result, "part") || Object.hasOwn(result, "more")));
  let total = 0;
  for (const [index, result] of results.entries()) {
    if (!object(result) || result.token !== expected || result.hubEpoch !== inbox.hubEpoch ||
        result.type !== "failure" && (result.type !== inbox.type || result.id !== inbox.id)) bad("identity/type/id/token/hubEpoch");
    if (["reevaluate", "followup", "idea"].includes(result.type)) {
      for (const value of [inbox, result]) {
        if (Object.hasOwn(value, "capturedForSpec") && typeof value.capturedForSpec !== "boolean") bad("capturedForSpec");
      }
      if ((result.capturedForSpec === true) !== (inbox.capturedForSpec === true)) bad("capturedForSpec scope");
    }
    if (inbox.workerContext?.manifest && !(result.type === "discuss" && Number.isInteger(result.part) && result.part >= 0 && result.more === true) &&
        !validateWorkerContextAck(result.workerContextAck, inbox.workerContext.manifest, { final: true })) bad("workerContextAck");
    if (multipart) {
      if (inbox.type !== "discuss" || result.type !== "discuss" || result.part !== index || result.more !== (index < results.length - 1)) bad("part/more/order");
      if (result.more) for (const key of Object.keys(result)) {
        if (!["type", "id", "token", "hubEpoch", "part", "more", "questions", "links", "answers"].includes(key)) bad(`part.${key}`);
      }
    }
    total += JSON.stringify(result).length;
    if (result.type === "answer") grade(result, "answer", true, inbox.capturedForSpec === true);
    if (result.type === "followup") grade(result, "followup");
    if (result.type === "discuss") {
      if (result.assessment !== undefined) grade(result.assessment, "assessment", true);
      if (result.answers !== undefined) for (const entry of list(result.answers, "answers")) grade(entry, "answers", true);
    }
    if (["reevaluate", "reread"].includes(result.type) && result.assessments !== undefined) {
      for (const entry of list(result.assessments, "assessments")) grade(entry, "assessments");
    }
    if (result.type === "reread" && result.audit !== undefined) for (const entry of list(result.audit, "audit")) {
      if (entry?.coverage !== undefined) coverage(entry.coverage, "audit.coverage");
    }
  }
  if (inbox.type === "discuss" && total > 600000) bad("discussion size");
  return { ok: true, files: results.length };
}
function readJSON(file, result = false) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > (result ? 4000000 : 16000000)) bad("file/size");
  const value = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  if (result && value.length > 1000000) bad("file/size");
  return JSON.parse(value);
}
export function preflightFiles({ inbox, files, token }) {
  if (!inbox || !files?.length || files.some(file => path.resolve(file) === path.resolve(inbox))) bad("files/inbox");
  return validateResults(readJSON(inbox), files.map(file => readJSON(file, true)), token);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = { files: [] }, args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      if (!["--inbox", "--token", "--file"].includes(args[i]) || !args[i + 1]) bad("arguments");
      if (args[i] === "--file") options.files.push(args[i + 1]);
      else options[args[i].slice(2)] = args[i + 1];
    }
    console.log(JSON.stringify(preflightFiles(options)));
  } catch (error) {
    console.error(`Проверка результата не пройдена: ${error.message}`);
    process.exitCode = 1;
  }
}
