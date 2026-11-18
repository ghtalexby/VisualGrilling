// Process-local reuse decisions; this module never consumes or applies events.
import { randomUUID } from "node:crypto";
import { buildWorkerManifest, workerReuseDecision, validateWorkerContextAck } from "./worker-reuse.mjs";

export function workerRuntime(settings, readWorker) {
  const processId = randomUUID();
  let previous = null, active = null, generation = 0;
  const discard = () => { generation++; previous = null; active = null; };
  return {
    discard,
    invalidateBaseline() { generation++; previous = null; },
    deliver(event, input) {
      if (!settings.enabled) return;
      generation++;
      try {
        const manifest = buildWorkerManifest({ ...input, processId, event });
        const measurements = previous?.measurements || null;
        const decision = workerReuseDecision({ settings, current: manifest, previous, measurements });
        if (previous?.unsafeReads) Object.assign(decision, { reuse: false, reason: "repeated-or-crossbranch-reads", successfulEvents: 0 });
        event.workerContext = { ...decision, manifest, previousWorkerSessionId: decision.reuse ? previous.workerSessionId : null,
          measurements, measurementScope: "protected-context-api-only; filesystem reads unmeasured",
          prerequisites: { parentOnlyApply: true, completedChild: true, followupTask: true, fullCurrentEvidence: true }, limits: settings };
        active = { manifest, successfulEvents: decision.successfulEvents, candidateWorker: decision.reuse ? previous.workerSessionId : null, priorResponses: decision.reuse ? previous.measurements?.modelResponses : null, reads: new Set(), readBytes: 0,
          deliveredBytes: Buffer.byteLength(JSON.stringify(event)), unsafeReads: false };
        previous = null;
      } catch (error) {
        discard();
        event.workerContext = { reuse: false, reason: "manifest-unavailable", reuseUnavailable: error.message, successfulEvents: 0 };
      }
    },
    read(route, ids, body) {
      if (!active) return;
      const key = JSON.stringify([route, ids]);
      if (active.reads.has(key) || ids.some(id => id !== active.manifest.cardId) || route === "/api/branch" && body.nodes?.some(node => node.id !== active.manifest.cardId)) active.unsafeReads = true;
      active.reads.add(key);
      active.readBytes += Buffer.byteLength(JSON.stringify(body));
    },
    validate(body, currentInput) {
      if (!active || body.type === "notes") return;
      if (body.token !== active.manifest.event.token) throw [409, "Результат устарел, получите событие через wait"];
      if (currentInput) {
        let current;
        try { current = buildWorkerManifest({ ...currentInput(), processId, event: active.manifest.event }); } catch {}
        if (!current || ["policyRevision", "instructionRevision", "projectRevision"].some(key => current[key] !== active.manifest[key])) {
          const error = [409, "Политика или инструкции изменились, получите событие заново"];
          error.workerContextStale = true;
          throw error;
        }
      }
      if (body.type === "discuss" && Number.isInteger(body.part) && body.part >= 0 && body.more === true) {
        if (body.workerContextAck !== undefined) throw [400, "workerContextAck допускается только в последней части"];
      } else if (!validateWorkerContextAck(body.workerContextAck, active.manifest, { final: true })) throw [400, "Некорректный workerContextAck"];
    },
    async complete(body, result, workerSessionId) {
      if (body.type === "notes" || result.staged) return;
      const completed = active;
      discard();
      const completingGeneration = generation;
      if (!completed || result.ok === false || body.type === "failure" || !workerSessionId) return;
      let usage;
      try { usage = await readWorker(workerSessionId); } catch { return; }
      if (generation !== completingGeneration) return;
      const sameWorker = completed.candidateWorker === workerSessionId;
      previous = { status: "completed", manifest: completed.manifest, workerContextAck: body.workerContextAck,
        workerSessionId, successfulEvents: (sameWorker ? completed.successfulEvents : 0) + 1, unsafeReads: completed.unsafeReads,
        measurements: { lastInputTokens: usage && (!sameWorker || usage.modelResponses > completed.priorResponses) ? usage.lastInputTokens : null, modelResponses: usage?.modelResponses ?? null,
          contextReadAmplification: completed.readBytes / completed.deliveredBytes } };
    }
  };
}
