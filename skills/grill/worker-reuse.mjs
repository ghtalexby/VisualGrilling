import { createHash } from "node:crypto";

export const workerReuseDefaults = Object.freeze({ enabled: false, maxEvents: 3, maxInputTokens: 60000, maxReadAmplification: 2 });
const maxManifestBytes = 4 * 1024 * 1024;
const bad = field => { throw new Error(`Некорректный контекст повторного worker: ${field}`); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const string = value => typeof value === "string" && value.length > 0;

export function validateWorkerReuseSettings(value = {}) {
  if (!record(value) || Object.keys(value).some(key => !Object.hasOwn(workerReuseDefaults, key))) bad("settings");
  const settings = { ...workerReuseDefaults, ...value };
  if (typeof settings.enabled !== "boolean") bad("enabled");
  if (!Number.isInteger(settings.maxEvents) || settings.maxEvents < 1 || settings.maxEvents > 5) bad("maxEvents");
  if (!Number.isSafeInteger(settings.maxInputTokens) || settings.maxInputTokens < 1) bad("maxInputTokens");
  if (!Number.isFinite(settings.maxReadAmplification) || settings.maxReadAmplification < 1) bad("maxReadAmplification");
  return settings;
}

// Hash complete JSON, including semantic navigation and cancellation/pending fields.
// Object order is immaterial; array order remains part of the contract.
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return bad("non-JSON value");
}
const hash = value => createHash("sha256").update(canonical(value)).digest("hex");

export function buildWorkerManifest(input) {
  const { processId, mapKey, nodes, brief, arch, language, ignoreRevision, knowledgeRevision, instructionRevision, event } = input;
  for (const [key, value] of Object.entries({ processId, mapKey, language, ignoreRevision, knowledgeRevision, instructionRevision })) if (!string(value)) bad(key);
  if (!Array.isArray(nodes) || nodes.length > 500) bad("nodes limit");
  if (!record(event) || !string(event.type) || !string(event.token)) bad("event");
  const serialized = canonical({ nodes, brief, arch });
  if (Buffer.byteLength(serialized) > maxManifestBytes) bad("manifest limit");
  const ids = new Set();
  for (const node of nodes) {
    if (!record(node) || !string(node.id) || ids.has(node.id)) bad("node id");
    ids.add(node.id);
  }
  const card = nodes.find(node => node.id === event.id);
  const cardRevisions = nodes.map(node => ({ id: node.id, revision: hash(node) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const navigation = nodes.map(node => Object.fromEntries(["id", "kind", "parentId", "q", "text", "obsolete", "topics", "relates", "decision", "chatDigest", "semanticsStale"].filter(key => Object.hasOwn(node, key)).map(key => [key, node[key]])));
  const identity = card ? Object.fromEntries(["id", "kind", "parentId", "q", "options", "why", "obsolete"].filter(key => Object.hasOwn(card, key)).map(key => [key, card[key]])) : null;
  const manifest = {
    version: 1, processId, mapKey, cardId: event.id ?? null,
    eligible: ["answer", "discuss"].includes(event.type) && card?.kind === "q" && !card.obsolete &&
      (event.capturedForSpec === undefined || event.capturedForSpec === false) &&
      (event.scope === undefined || event.scope === "live" || event.scope === "question") &&
      (event.contextScope === undefined || event.contextScope === "live") && !event.cancelled && !event.stale,
    cardRevisions, focusIdentityRevision: hash(identity), indexRevision: hash(navigation),
    mapRevision: hash(cardRevisions), projectRevision: hash({ brief, arch }), policyRevision: hash({ language, ignoreRevision, knowledgeRevision }), instructionRevision,
    event: { type: event.type, id: event.id ?? null, token: event.token, capturedForSpec: event.capturedForSpec ?? false, scope: event.scope ?? "live", contextScope: event.contextScope ?? "live" },
    evidencePolicy: "full-current-event; reread-external-and-code-references; manifest-is-not-evidence"
  };
  return { ...manifest, manifestRevision: hash(manifest) };
}

export function validateWorkerContextAck(ack, manifest, { final = false } = {}) {
  return final === true && record(ack) && Object.keys(ack).length === 2 &&
    string(manifest?.event?.token) && string(manifest?.manifestRevision) &&
    ack.deliveryToken === manifest.event.token && ack.manifestRevision === manifest.manifestRevision;
}

// Previous is a server-owned, successfully committed delivery, never a worker claim.
// Measurements must describe that exact worker's actual last completed response.
export function workerReuseDecision({ settings: rawSettings, current, previous, measurements }) {
  const settings = validateWorkerReuseSettings(rawSettings);
  const priorCards = new Map((previous?.manifest?.cardRevisions || []).map(card => [card.id, card.revision]));
  const currentCards = new Map((current?.cardRevisions || []).map(card => [card.id, card.revision]));
  const changedIds = [...currentCards].filter(([id, revision]) => priorCards.get(id) !== revision).map(([id]) => id);
  const removedIds = [...priorCards.keys()].filter(id => !currentCards.has(id));
  const fresh = reason => ({ reuse: false, reason, successfulEvents: 0, changedIds, removedIds });
  if (!settings.enabled) return fresh("disabled");
  if (!current?.eligible) return fresh("unsupported-event");
  if (!previous || previous.status !== "completed" || previous.cancelled || previous.stale || previous.failed) return fresh("previous-not-completed");
  const prior = previous.manifest;
  if (!prior?.eligible || !validateWorkerContextAck(previous.workerContextAck, prior, { final: true })) return fresh("previous-ack");
  if (!Number.isInteger(previous.successfulEvents) || previous.successfulEvents < 1 || previous.successfulEvents >= settings.maxEvents) return fresh("event-limit");
  for (const key of ["processId", "mapKey", "cardId", "projectRevision", "policyRevision", "instructionRevision", "focusIdentityRevision"]) {
    if (current[key] !== prior[key]) return fresh(`${key}-changed`);
  }
  if (current.event.token === prior.event.token) return fresh("same-delivery");
  const otherCards = manifest => manifest.cardRevisions.filter(card => card.id !== manifest.cardId);
  if (hash(otherCards(current)) !== hash(otherCards(prior))) return fresh("other-cards-changed");
  if (!record(measurements) || !Number.isSafeInteger(measurements.lastInputTokens) || measurements.lastInputTokens <= 0 ||
      !Number.isFinite(measurements.contextReadAmplification) || measurements.contextReadAmplification < 0) return fresh("unknown-measurements");
  if (measurements.lastInputTokens >= settings.maxInputTokens) return fresh("input-limit");
  if (measurements.contextReadAmplification > settings.maxReadAmplification) return fresh("read-amplification-limit");
  return { reuse: true, reason: "same-live-question", successfulEvents: previous.successfulEvents, changedIds, removedIds };
}
