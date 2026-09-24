import { nowMs } from './browser-compat.js';

export const PRECISION_INTENT_OPPOSITE_CORPUS = Object.freeze([
  fixture('enter-leave', 'Mara leaves the tavern', 'Mara leaves the tavern', 'Mara enters the tavern'),
  fixture('intact-destroyed', 'The bridge is intact', 'The bridge remains intact', 'The bridge was destroyed'),
  fixture('trust-distrust', 'Eris trusts Mara', 'Eris trusts Mara', 'Eris distrusts Mara'),
  fixture('carry-drop', 'Mara carries the blade', 'Mara carries the blade', 'Mara drops the blade'),
  fixture('heal-injure', 'The spell heals Eris', 'The spell heals Eris', 'The spell injures Eris'),
  fixture('present-departed', 'Mara is present', 'Mara is present in the room', 'Mara departed the room'),
  fixture('current-historical', 'current location of the blade', 'CURRENT: the blade is at Ember Tavern', 'HISTORICAL: the blade was at the old forge'),
]);

const OPPOSITES = Object.freeze(new Map([
  ['enter','leave'],['enters','leaves'],['entered','left'],['leave','enter'],['leaves','enters'],['left','entered'],
  ['intact','destroyed'],['destroyed','intact'],['trust','distrust'],['trusts','distrusts'],['distrust','trust'],['distrusts','trusts'],
  ['carry','drop'],['carries','drops'],['drop','carry'],['drops','carries'],['heal','injure'],['heals','injures'],['injure','heal'],['injures','heals'],
  ['present','departed'],['departed','present'],['current','historical'],['historical','current'],
]));

export class DeterministicPrecisionAdapter {
  constructor({ adapterId = 'deterministic-lexical-intent' } = {}) { this.adapterId = adapterId; }
  async rank({ query, candidates }) {
    return [...candidates].map((candidate) => ({ ref: candidate.ref, score: deterministicPrecisionScore(query, candidate.text) }))
      .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
  }
}

export function assertPrecisionAdapter(adapter) {
  if (!adapter || typeof adapter.adapterId !== 'string' || typeof adapter.rank !== 'function') throw new TypeError('precision adapter requires adapterId and rank()');
  return adapter;
}

export async function runPrecisionBenchmark({ adapter = new DeterministicPrecisionAdapter(), corpus = PRECISION_INTENT_OPPOSITE_CORPUS } = {}) {
  assertPrecisionAdapter(adapter);
  let correct = 0;
  const rows = [];
  const started = nowMs();
  for (const item of corpus) {
    const ranked = await adapter.rank({ query: item.query, candidates: item.candidates });
    const topRef = ranked?.[0]?.ref ?? null;
    const pass = topRef === item.expectedRef;
    if (pass) correct += 1;
    rows.push(Object.freeze({ id: item.id, expectedRef: item.expectedRef, topRef, pass, ranking: structuredClone(ranked ?? []) }));
  }
  const latencyMs = Math.max(0, nowMs() - started);
  return Object.freeze({ adapterId: adapter.adapterId, cases: corpus.length, correct, intentOppositeAccuracy: corpus.length ? correct / corpus.length : null, latencyMs, rows: Object.freeze(rows) });
}

export function deterministicPrecisionScore(query, candidate) {
  const q = tokens(query), c = new Set(tokens(candidate));
  let score = 0;
  for (const token of q) {
    if (c.has(token)) score += 2;
    const opposite = OPPOSITES.get(token);
    if (opposite && c.has(opposite)) score -= 4;
  }
  return score;
}

function fixture(id, query, relevant, opposite) {
  return Object.freeze({ id, query, expectedRef: `${id}:relevant`, candidates: Object.freeze([
    Object.freeze({ ref: `${id}:relevant`, text: relevant }), Object.freeze({ ref: `${id}:opposite`, text: opposite }),
  ]) });
}
function tokens(value) { return String(value).toLowerCase().match(/[a-z0-9]+/g) ?? []; }
