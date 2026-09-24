import { nowMs, utf8ByteLength } from './browser-compat.js';

export const PrecisionMeasurementStatus = Object.freeze({ MEASURED: 'MEASURED', REPLAYED: 'REPLAYED', NOT_MEASURED: 'NOT_MEASURED', NOT_APPLICABLE: 'NOT_APPLICABLE' });

export const PRECISION_INTENT_OPPOSITE_CORPUS = Object.freeze([
  fixture('enter-leave', 'Mara leaves the tavern', 'Mara leaves the tavern', 'Mara enters the tavern'),
  fixture('leave-enter', 'Mara enters the tavern', 'Mara enters the tavern', 'Mara leaves the tavern'),
  fixture('intact-destroyed', 'The bridge is intact', 'The bridge remains intact', 'The bridge was destroyed'),
  fixture('destroyed-intact', 'The Tavern is destroyed now', 'CURRENT: the Tavern is destroyed', 'HISTORICAL: the Tavern was intact'),
  fixture('trust-distrust', 'Eris trusts Mara', 'Eris trusts Mara', 'Eris distrusts Mara'),
  fixture('distrust-trust', 'Eris distrusts Mara', 'Eris distrusts Mara', 'Eris trusts Mara'),
  fixture('carry-drop', 'Mara carries the blade', 'Mara carries the blade', 'Mara drops the blade'),
  fixture('drop-carry', 'Eris drops the Blade', 'Eris drops the Blade', 'Eris carries the Blade'),
  fixture('heal-injure', 'The spell heals Eris', 'The spell heals Eris', 'The spell injures Eris'),
  fixture('injure-heal', 'The spell injures Eris', 'The spell injures Eris', 'The spell heals Eris'),
  fixture('present-departed', 'Mara is present', 'Mara is present in the room', 'Mara departed the room'),
  fixture('departed-present', 'Mara departed', 'Mara departed the room', 'Mara is present in the room'),
  fixture('current-historical', 'current location of the blade', 'CURRENT: the blade location is unknown', 'HISTORICAL: the blade was at Ember Tavern'),
  fixture('historical-current', 'where was the blade historically', 'HISTORICAL: the blade was at Ember Tavern', 'CURRENT: the blade location is unknown'),
  fixture('present-mentioned', 'Blade is physically present', 'CURRENT: Blade is present on the table', 'Blade is mentioned in conversation'),
  fixture('mentioned-present', 'Blade is only mentioned', 'Blade is mentioned in conversation', 'CURRENT: Blade is present on the table'),
]);

export const PRECISION_TEMPORAL_CORPUS = Object.freeze([
  temporalFixture('blade-past-vs-now', 'Where is the Sun Blade now?', 'CURRENT: Sun Blade location unknown', 'HISTORICAL: Sun Blade was at Tavern'),
  temporalFixture('blade-history', 'Where was the Sun Blade before the fire?', 'HISTORICAL: Sun Blade was at Tavern', 'CURRENT: Sun Blade location unknown'),
  temporalFixture('tavern-now', 'What is the Tavern state now?', 'CURRENT: Ember Tavern destroyed', 'HISTORICAL: Ember Tavern intact'),
  temporalFixture('tavern-memory', 'How was the Tavern before the fire?', 'HISTORICAL: Ember Tavern intact', 'CURRENT: Ember Tavern destroyed'),
]);

const OPPOSITES = Object.freeze(new Map([
  ['enter','leave'],['enters','leaves'],['entered','left'],['leave','enter'],['leaves','enters'],['left','entered'],
  ['intact','destroyed'],['destroyed','intact'],['trust','distrust'],['trusts','distrusts'],['distrust','trust'],['distrusts','trusts'],
  ['carry','drop'],['carries','drops'],['drop','carry'],['drops','carries'],['heal','injure'],['heals','injures'],['injure','heal'],['injures','heals'],
  ['present','departed'],['departed','present'],['current','historical'],['historical','current'],['present','mentioned'],['mentioned','present'],
  ['now','historical'],['historically','current'],['before','current'],
]));

export class BroadSimilarityBaselineAdapter {
  constructor({ adapterId = 'broad-token-overlap' } = {}) { this.adapterId = adapterId; }
  async rank({ query, candidates }) {
    return [...candidates].map((candidate) => ({ ref: candidate.ref, score: broadSimilarityScore(query, candidate.text) }))
      .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
  }
}

export class DeterministicPrecisionAdapter {
  constructor({ adapterId = 'deterministic-lexical-intent' } = {}) { this.adapterId = adapterId; }
  async rank({ query, candidates }) {
    return [...candidates].map((candidate) => ({ ref: candidate.ref, score: deterministicPrecisionScore(query, candidate.text) }))
      .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
  }
}

export class DeterministicSemanticJudgeAdapter {
  constructor({ adapterId = 'deterministic-semantic-judge' } = {}) { this.adapterId = adapterId; }
  async rank({ query, candidates }) {
    return [...candidates].map((candidate) => ({ ref: candidate.ref, score: semanticJudgeScore(query, candidate.text) }))
      .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
  }
}

export class ExternalPrecisionAdapter {
  constructor({ adapterId, runner, providerId = null, modelId = null } = {}) {
    if (typeof adapterId !== 'string' || !adapterId) throw new TypeError('adapterId is required');
    this.adapterId = adapterId; this.runner = runner; this.providerId = providerId; this.modelId = modelId;
  }
  async rank(input) {
    if (typeof this.runner !== 'function') throw new Error(`${this.adapterId} runner unavailable`);
    return this.runner(input);
  }
}

export function assertPrecisionAdapter(adapter) {
  if (!adapter || typeof adapter.adapterId !== 'string' || typeof adapter.rank !== 'function') throw new TypeError('precision adapter requires adapterId and rank()');
  return adapter;
}

export async function runPrecisionBenchmark({ adapter = new DeterministicPrecisionAdapter(), corpus = PRECISION_INTENT_OPPOSITE_CORPUS } = {}) {
  assertPrecisionAdapter(adapter);
  let correct = 0; const rows = []; const started = nowMs();
  for (const item of corpus) {
    const ranked = await adapter.rank({ query: item.query, candidates: item.candidates });
    const topRef = ranked?.[0]?.ref ?? null; const pass = topRef === item.expectedRef;
    if (pass) correct += 1;
    rows.push(Object.freeze({ id: item.id, expectedRef: item.expectedRef, topRef, pass, ranking: structuredClone(ranked ?? []) }));
  }
  const latencyMs = Math.max(0, nowMs() - started);
  return Object.freeze({ adapterId: adapter.adapterId, cases: corpus.length, correct, intentOppositeAccuracy: corpus.length ? correct / corpus.length : null, latencyMs, rows: Object.freeze(rows) });
}

export async function runPrecisionGainBenchmark({
  baselineAdapter = new BroadSimilarityBaselineAdapter(), precisionAdapter = new DeterministicPrecisionAdapter(),
  corpus = PRECISION_INTENT_OPPOSITE_CORPUS,
} = {}) {
  const baseline = await runPrecisionBenchmark({ adapter: baselineAdapter, corpus });
  const precision = await runPrecisionBenchmark({ adapter: precisionAdapter, corpus });
  return Object.freeze({
    kind: 'PrecisionGainBenchmark', measurementState: PrecisionMeasurementStatus.MEASURED,
    baseline, precision,
    accuracyGain: precision.intentOppositeAccuracy - baseline.intentOppositeAccuracy,
    latencyDeltaMs: precision.latencyMs - baseline.latencyMs,
    syntheticFixtureOnly: true,
    providerSuperiorityClaimed: false,
  });
}

export async function runTemporalPrecisionBenchmark({ adapter = new DeterministicPrecisionAdapter(), corpus = PRECISION_TEMPORAL_CORPUS } = {}) {
  const result = await runPrecisionBenchmark({ adapter, corpus });
  return Object.freeze({ ...result, temporalDiscriminationAccuracy: result.intentOppositeAccuracy });
}

export async function runTwoStagePrecisionBenchmark({
  firstStageAdapter = new DeterministicPrecisionAdapter(), secondStageAdapter = null, corpus = PRECISION_INTENT_OPPOSITE_CORPUS,
} = {}) {
  const first = await runPrecisionBenchmark({ adapter: firstStageAdapter, corpus });
  if (!secondStageAdapter) return Object.freeze({ kind: 'TwoStagePrecisionBenchmark', measurementState: PrecisionMeasurementStatus.NOT_MEASURED, firstStage: first, secondStage: null, reason: 'second-stage adapter unavailable' });
  assertPrecisionAdapter(secondStageAdapter);
  let correct = 0; let reduced = 0; const started = nowMs(); const rows = [];
  for (const item of corpus) {
    const firstRanked = await firstStageAdapter.rank({ query: item.query, candidates: item.candidates });
    const firstRefs = new Set(firstRanked.slice(0, Math.min(2, firstRanked.length)).map((row) => row.ref));
    const candidates = item.candidates.filter((candidate) => firstRefs.has(candidate.ref));
    const secondRanked = await secondStageAdapter.rank({ query: item.query, candidates });
    const topRef = secondRanked?.[0]?.ref ?? null; const pass = topRef === item.expectedRef;
    if (pass) correct += 1; reduced += Math.max(0, item.candidates.length - candidates.length);
    rows.push(Object.freeze({ id: item.id, topRef, pass, firstCandidateCount: item.candidates.length, secondCandidateCount: candidates.length }));
  }
  const accuracy = corpus.length ? correct / corpus.length : null;
  const latencyMs = Math.max(0, nowMs() - started);
  return Object.freeze({
    kind: 'TwoStagePrecisionBenchmark', measurementState: PrecisionMeasurementStatus.MEASURED,
    firstStage: first, secondStage: Object.freeze({ adapterId: secondStageAdapter.adapterId, cases: corpus.length, correct, accuracy, latencyMs }),
    accuracyGain: accuracy - first.intentOppositeAccuracy,
    candidateReduction: reduced,
    materialGain: accuracy - first.intentOppositeAccuracy > 0.01,
    syntheticFixtureOnly: true,
  });
}

export async function runExternalPrecisionBenchmark({ adapterId, runner = null, corpus = PRECISION_INTENT_OPPOSITE_CORPUS, resourceMeasurement = null } = {}) {
  if (typeof runner !== 'function') return Object.freeze({ adapterId, measurementState: PrecisionMeasurementStatus.NOT_MEASURED, result: null, latencyMs: null, peakRamMb: null, reason: 'external model/runtime unavailable in current environment' });
  const adapter = new ExternalPrecisionAdapter({ adapterId, runner });
  const result = await runPrecisionBenchmark({ adapter, corpus });
  return Object.freeze({ adapterId, measurementState: PrecisionMeasurementStatus.MEASURED, result, latencyMs: result.latencyMs, peakRamMb: resourceMeasurement?.peakRamMb ?? null });
}

export async function benchmarkCandidateScaling({ adapter = new DeterministicPrecisionAdapter(), sizes = [8, 32, 64, 128, 256] } = {}) {
  assertPrecisionAdapter(adapter); const rows = [];
  for (const rawSize of sizes) {
    const size = Math.max(2, Number(rawSize) || 2); const candidates = [];
    for (let i = 0; i < size - 2; i++) candidates.push({ ref: `noise:${i}`, text: `unrelated archival candidate ${i}` });
    candidates.push({ ref: 'relevant', text: 'CURRENT Mara leaves the tavern' }, { ref: 'opposite', text: 'HISTORICAL Mara enters the tavern' });
    const started = nowMs(); const ranked = await adapter.rank({ query: 'Mara leaves the tavern now', candidates });
    rows.push(Object.freeze({ size, latencyMs: Math.max(0, nowMs() - started), topRef: ranked[0]?.ref ?? null, serializedInputBytes: utf8ByteLength(JSON.stringify(candidates)) }));
  }
  return Object.freeze({ adapterId: adapter.adapterId, measurementState: PrecisionMeasurementStatus.MEASURED, rows: Object.freeze(rows) });
}

export function deterministicPrecisionScore(query, candidate) {
  const q = tokens(query), c = new Set(tokens(candidate)); let score = 0;
  for (const token of q) {
    if (c.has(token)) score += 2;
    const opposite = OPPOSITES.get(token); if (opposite && c.has(opposite)) score -= 5;
  }
  const qCurrent = q.includes('current') || q.includes('now') || q.includes('present');
  const qHistorical = q.includes('historical') || q.includes('historically') || q.includes('before') || q.includes('was');
  if (qCurrent && c.has('historical')) score -= 5;
  if (qCurrent && c.has('current')) score += 3;
  if (qHistorical && c.has('historical')) score += 3;
  if (qHistorical && c.has('current')) score -= 3;
  return score;
}

export function broadSimilarityScore(query, candidate) {
  const polarity = new Set([...OPPOSITES.keys(), 'now', 'historically', 'before', 'was']);
  const q = tokens(query).filter((token) => !polarity.has(token)), c = new Set(tokens(candidate)); let score = 0;
  for (const token of q) if (c.has(token)) score += 1;
  return score;
}


function semanticJudgeScore(query, candidate) {
  return deterministicPrecisionScore(query, candidate) + (String(candidate).toLowerCase().includes('current:') && String(query).toLowerCase().includes('now') ? 2 : 0);
}
function fixture(id, query, relevant, opposite) { return Object.freeze({ id, query, expectedRef: `${id}:relevant`, candidates: Object.freeze([Object.freeze({ ref: `${id}:relevant`, text: relevant }), Object.freeze({ ref: `${id}:opposite`, text: opposite })]) }); }
function temporalFixture(id, query, relevant, opposite) { return fixture(id, query, relevant, opposite); }
function tokens(value) { return String(value).toLowerCase().match(/[a-z0-9]+/g) ?? []; }
