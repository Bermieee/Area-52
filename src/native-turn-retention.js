// Native Brain turn-record retention (audit H3).
//
// A NativeBrainTurnRecord is a selected-turn diagnostic/read projection. Owner evidence (Lore,
// Memory, Scene, Core source revisions), the Runtime ledger and the sealed packet remain the
// authoritative stores. Older terminal records are therefore compacted into reference form:
// identities, counts, hashes, the Context Seal receipt and the sealed packet are retained; large
// duplicated candidate bodies, provider result payloads and rendered prompt text are not.
// Compaction never changes cognition, Truth, Settlement or a sealed packet.
import { stableHash } from './browser-runtime-utils.js';

export const TURN_RETENTION_CONTRACT_VERSION = '1.0.0';
export const DEFAULT_FULL_DETAIL_TURNS = 4;

const clone = (v) => (v == null ? v : structuredClone(v));
const bytes = (v) => { try { return JSON.stringify(v ?? null).length; } catch { return 0; } };
const hashOf = (v) => stableHash(v ?? null, { length: 16 });
const take = (list, n) => (Array.isArray(list) ? list.slice(0, n) : []);

function channelIds(candidate) {
  return [...new Set((candidate?.channelNominations ?? []).map((row) => row?.channelId).filter(Boolean))].sort();
}
function candidateRef(c) {
  if (!c || typeof c !== 'object') return c;
  return {
    candidateId: c.candidateId ?? c.id ?? null, evidenceIdentity: c.evidenceIdentity ?? null,
    channels: channelIds(c), truthStatusHint: c.truthStatusHint ?? null, authorityClass: c.authorityClass ?? null,
    freshness: c.freshness ?? null,
    sourceRevisionRefCount: Array.isArray(c.sourceRevisionRefs) ? c.sourceRevisionRefs.length : 0,
    contentHash: hashOf(c), retainedAs: 'REFERENCE',
  };
}
function envelopeRef(e) {
  if (!e || typeof e !== 'object') return e;
  return {
    kind: e.kind ?? null, candidateSetId: e.candidateSetId ?? e.id ?? null, fusionReceipt: primitiveFields(e.fusionReceipt ?? null),
    candidateIds: (e.candidates ?? []).map((c) => c?.candidateId ?? c?.id ?? null), sourceRevisionSetCount: Array.isArray(e.sourceRevisionSet) ? e.sourceRevisionSet.length : 0,
    unavailableChannels: clone(e.unavailableChannels ?? []), contentHash: hashOf(e), retainedAs: 'REFERENCE',
  };
}
function truthRef(a) {
  if (!a || typeof a !== 'object') return a;
  return {
    kind: a.kind ?? null, id: a.id ?? null, query: a.query ?? null, intent: a.intent ?? null, confidence: a.confidence ?? null,
    truthResultCount: (a.truthResults ?? []).length,
    classificationCounts: (a.truthResults ?? []).reduce((acc, r) => { const k = String(r?.classification ?? 'UNKNOWN') + (r?.usableForIntent ? ':USABLE' : ':NOT_USABLE'); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
    truthResults: take(a.truthResults, 8).map((r) => ({ candidateId: r?.candidateId ?? null, classification: r?.classification ?? null, usableForIntent: r?.usableForIntent ?? null, reasons: take(r?.reasons, 3) })),
    contentHash: hashOf(a), retainedAs: 'REFERENCE',
  };
}
function primitiveFields(o, limit = 12) {
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const [k, v] of Object.entries(o).slice(0, 64)) {
    if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = typeof v === 'string' ? v.slice(0, 240) : v;
    else if (Array.isArray(v) && v.every((x) => x == null || ['string', 'number', 'boolean'].includes(typeof x))) out[k] = v.slice(0, limit);
  }
  return out;
}
function routeRef(r) { return { ...primitiveFields(r), contentHash: hashOf(r), retainedAs: 'REFERENCE' }; }
function stub(v) { return { retainedAs: 'REFERENCE_ONLY', bytes: bytes(v), contentHash: hashOf(v) }; }

const PUBLISHED_COMPACTORS = {
  candidates: (v) => (v ?? []).map(candidateRef),
  primaryCandidates: (v) => (v ?? []).map((c) => ({ candidateId: c?.candidateId ?? c?.id ?? null, retainedAs: 'ID' })),
  candidateEnvelope: envelopeRef,
  candidateEnvelopes: (v) => (v ?? []).map(envelopeRef),
  resultRoutes: (v) => (v ?? []).map(routeRef),
  assessment: truthRef,
  publicationAssessment: truthRef,
  corrective: (v) => (v && typeof v === 'object' ? { ...primitiveFields(v), assessment: truthRef(v.assessment), contentHash: hashOf(v), retainedAs: 'REFERENCE' } : v),
  cognitiveChoiceReceipt: (v) => (v && typeof v === 'object' ? {
    ...primitiveFields(v), skippedJobs: clone(v.skippedJobs ?? []), deferredJobs: clone(v.deferredJobs ?? []), reasonCodes: clone(v.reasonCodes ?? []),
    jev: clone(v.jev ?? null), precision: clone(v.precision ?? null), contentHash: hashOf(v), retainedAs: 'REFERENCE',
  } : v),
};
// Kept verbatim: the seal and the sealed packet are the immutable publication record.
const PUBLISHED_KEEP = new Set(['worldRevision', 'sceneRevision', 'sealReceipt', 'packet', 'compilerReceipt', 'precisionFailed', 'hotFreshnessReceipt']);
const INLINE_LIMIT_BYTES = 2048;

export function compactPublished(published) {
  if (!published || typeof published !== 'object') return published;
  const out = {};
  for (const [key, value] of Object.entries(published)) {
    if (PUBLISHED_KEEP.has(key)) out[key] = value;
    else if (PUBLISHED_COMPACTORS[key]) out[key] = PUBLISHED_COMPACTORS[key](value);
    else out[key] = bytes(value) <= INLINE_LIMIT_BYTES ? value : (Array.isArray(value) ? value.slice(0, 8).map((x) => (bytes(x) <= 1024 ? x : stub(x))) : stub(value));
  }
  return out;
}

export function compactDelivery(delivery) {
  if (!delivery || typeof delivery !== 'object') return delivery;
  const plan = delivery.plan && typeof delivery.plan === 'object' ? {
    ...delivery.plan,
    sections: (delivery.plan.sections ?? []).map((s) => ({ slot: s.slot, representation: s.representation, allocatedTokens: s.allocatedTokens ?? null, sourceRevisionIds: take(s.sourceRevisionIds, 16), textHash: hashOf(s.text ?? null), textBytes: bytes(s.text ?? null), retainedAs: 'REFERENCE' })),
  } : delivery.plan;
  const rendered = delivery.rendered ? { format: delivery.rendered.format ?? null, sealedPacketHash: delivery.rendered.sealedPacketHash ?? null, messageMap: clone(delivery.rendered.messageMap ?? []), contentHash: hashOf(delivery.rendered), retainedAs: 'REFERENCE_ONLY' } : delivery.rendered;
  const receipt = delivery.receipt && typeof delivery.receipt === 'object' && bytes(delivery.receipt) > INLINE_LIMIT_BYTES
    ? { ...primitiveFields(delivery.receipt), phases: primitiveFields(delivery.receipt.phases ?? null), hostRequestStatus: delivery.receipt.phases?.hostRequest?.status ?? null, contentHash: hashOf(delivery.receipt), retainedAs: 'REFERENCE' }
    : delivery.receipt;
  return { ...delivery, plan, rendered, receipt };
}

export function compactContextRetirement(r) {
  if (!r || typeof r !== 'object') return r;
  const ids = (rows) => (rows ?? []).map((m) => (m && typeof m === 'object' ? { messageId: m.messageId ?? null, role: m.role ?? null, sequence: m.sequence ?? null } : m));
  return { ...primitiveFields(r), retainedMessages: ids(r.retainedMessages), retiredMessages: ids(r.retiredMessages), contentHash: hashOf(r), retainedAs: 'REFERENCE' };
}

const RECORD_KEEP = new Set(['published', 'delivery', 'contextRetirement', 'experience', 'response', 'retention']);
function boundRecordFields(out) {
  for (const [key, value] of Object.entries(out)) {
    if (RECORD_KEEP.has(key) || value == null || typeof value !== 'object' || value.retainedAs || bytes(value) <= INLINE_LIMIT_BYTES) continue;
    out[key] = { ...primitiveFields(value), contentHash: hashOf(value), bytes: bytes(value), retainedAs: 'REFERENCE' };
  }
  return out;
}

/** Re-bounds record-level fields attached after compaction (late learning receipts). Published
 *  content is not re-compacted, so candidate identities survive. */
export function reboundCompactedTurnRecord(record) {
  if (!record || record.retention?.state !== 'COMPACTED') return record;
  const out = boundRecordFields({ ...record });
  out.retention = { ...record.retention, bytesAfter: bytes(out), reboundCount: Number(record.retention.reboundCount ?? 0) + 1 };
  return out;
}

/** Returns a compacted copy of a terminal turn record. The input is not mutated. */
export function compactTurnRecord(record, { reason = 'RETENTION_WINDOW', sequence = null } = {}) {
  if (!record || record.retention?.state === 'COMPACTED') return record;
  const before = bytes(record);
  const out = {
    ...record,
    published: compactPublished(record.published),
    delivery: compactDelivery(record.delivery),
    contextRetirement: compactContextRetirement(record.contextRetirement),
  };
  // Any other oversized top-level diagnostic field keeps its scalar fields and a hash.
  boundRecordFields(out);
  if (out.delivery?.plan && bytes(out.delivery.plan) > INLINE_LIMIT_BYTES) {
    out.delivery = { ...out.delivery, plan: { ...primitiveFields(out.delivery.plan), sections: out.delivery.plan.sections, contentHash: hashOf(record.delivery?.plan), retainedAs: 'REFERENCE' } };
  }
  out.retention = { kind: 'NativeTurnRetention', contractVersion: TURN_RETENTION_CONTRACT_VERSION, state: 'COMPACTED', reason, compactedAtSequence: sequence, bytesBefore: before, bytesAfter: bytes(out), ownerEvidenceAuthoritative: true, sealedPacketRetained: Boolean(out.published?.packet) };
  return out;
}
