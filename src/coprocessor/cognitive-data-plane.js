import { nowMs, utf8ByteLength } from './browser-compat.js';
import { artifactReferenceFromEnvelope, createArtifactReference, resolveArtifactReference } from './artifact-reference.js';

export const TransportCompatibility = Object.freeze({
  BROWSER_NATIVE: 'BROWSER_NATIVE', NODE_SIDECAR_ONLY: 'NODE_SIDECAR_ONLY', PYTHON_SIDECAR_ONLY: 'PYTHON_SIDECAR_ONLY', LOCAL_SERVICE: 'LOCAL_SERVICE', NOT_APPROPRIATE: 'NOT_APPROPRIATE',
});

export class CognitiveDataPlane {
  constructor({ repository } = {}) {
    if (!repository || typeof repository.get !== 'function') throw new TypeError('CognitiveDataPlane requires repository.get(domain,id,{revision})');
    this.repository = repository;
  }
  reference(input) { return input?.kind === 'ArtifactEnvelope' ? artifactReferenceFromEnvelope(input) : createArtifactReference(input); }
  resolve(reference, options = {}) { return resolveArtifactReference(reference, { repository: this.repository, ...options }); }
}

export function benchmarkReferenceTransfer({ payload, reference, iterations = 25 } = {}) {
  const safeIterations = Math.max(1, Math.min(1000, Number(iterations) || 25));
  const payloadText = JSON.stringify(payload ?? null);
  const referenceText = JSON.stringify(reference ?? null);
  const payloadBytes = utf8ByteLength(payloadText);
  const referenceBytes = utf8ByteLength(referenceText);
  const payloadJsonMs = benchmark(() => JSON.parse(JSON.stringify(payload ?? null)), safeIterations);
  const referenceJsonMs = benchmark(() => JSON.parse(JSON.stringify(reference ?? null)), safeIterations);
  const payloadCloneMs = benchmark(() => structuredClone(payload ?? null), safeIterations);
  const referenceCloneMs = benchmark(() => structuredClone(reference ?? null), safeIterations);
  return Object.freeze({
    iterations: safeIterations,
    serializedBytes: measured({ payload: payloadBytes, reference: referenceBytes, saved: Math.max(0, payloadBytes - referenceBytes) }),
    savingsRatio: measured(payloadBytes ? Math.max(0, (payloadBytes - referenceBytes) / payloadBytes) : 0),
    jsonRoundTripMs: measured({ payload: payloadJsonMs, reference: referenceJsonMs }),
    structuredCloneMs: measured({ payload: payloadCloneMs, reference: referenceCloneMs }),
    copies: notMeasured('JavaScript does not expose implementation copy counts'),
    retrievalLatency: notMeasured('requires an owning repository/runtime transport'),
    memoryPressure: notMeasured('requires host memory instrumentation'),
    browserCompatibility: measured('BROWSER_NATIVE'),
    nodeCompatibility: measured('BROWSER_NATIVE_CONTRACT'),
    pythonInteroperability: notApplicable('in-process JavaScript reference benchmark'),
  });
}

export function transportCandidateMatrix() {
  return Object.freeze([
    Object.freeze({ transport: 'STRUCTURED_CLONE_JSON', classification: TransportCompatibility.BROWSER_NATIVE, adopted: true, note: 'baseline payload transport' }),
    Object.freeze({ transport: 'IN_PROCESS_ARTIFACT_REFERENCE', classification: TransportCompatibility.BROWSER_NATIVE, adopted: true, note: 'default Sidecar data-plane contract' }),
    Object.freeze({ transport: 'ARROW_IPC_RECORDBATCH', classification: TransportCompatibility.LOCAL_SERVICE, adopted: false, note: 'optional adapter benchmark; no browser dependency added' }),
    Object.freeze({ transport: 'LOCAL_SOCKET', classification: TransportCompatibility.NODE_SIDECAR_ONLY, adopted: false, note: 'not available to browser-local extension code' }),
    Object.freeze({ transport: 'SHARED_MEMORY_MMAP', classification: TransportCompatibility.NODE_SIDECAR_ONLY, adopted: false, note: 'requires external process/runtime support' }),
    Object.freeze({ transport: 'ZEROMQ', classification: TransportCompatibility.LOCAL_SERVICE, adopted: false, note: 'external service candidate, not browser-local transport' }),
  ]);
}

function benchmark(fn, iterations) {
  const started = nowMs();
  for (let index = 0; index < iterations; index += 1) fn();
  return Math.max(0, nowMs() - started) / iterations;
}
function measured(value) { return Object.freeze({ status: 'MEASURED', value }); }
function notMeasured(reason) { return Object.freeze({ status: 'NOT_MEASURED', value: null, reason }); }
function notApplicable(reason) { return Object.freeze({ status: 'NOT_APPLICABLE', value: null, reason }); }
