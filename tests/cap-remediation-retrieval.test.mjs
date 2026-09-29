// Cap remediation, cap ledger rows 16-18 (Lore retrieval) and 36-37, 39 (Memory historian). Contract:
//  - a long query is served through a bounded representation of the whole input instead of throwing (limit-1 .. stress);
//  - a term that only appears late in a long Lore entry is searchable (the index kept the first 192 unique terms);
//  - the examined page is filled with records the story may read (scope filter used to run after the 512 cap);
//  - short queries are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LoreStudyRuntime as Runtime } from '../src/lore-study-runtime.js';
import { LORE_WAVE3_LIMITS } from '../src/lore-navigation-contracts.js';
import { LoreHierarchyRetrievalSystem } from '../src/lore-hierarchy-retrieval-system.js';
import { MemoryTemporalProducer } from '../src/memory-temporal-producer.js';
import { MEMORY_LIMITS } from '../src/memory-contracts.js';

function add(runtime, { book = 'caps', uid, content, title = null, treePath = [] }) {
  runtime.registerLorebook({ id: book, title: book });
  const result = runtime.upsertEntry({ lorebookId: book, uid, content, metadata: { title: title || String(uid), treePath } });
  let r; do { r = runtime.run(result.obligation.id, { maxUnits: 64 }); } while (r.checkpointed && !r.failed);
  return 'lore:' + book + ':' + uid;
}
function system(runtime) {
  const s = new LoreHierarchyRetrievalSystem({ runtime });
  s.refreshHierarchy();
  s.buildAll({ maxUnits: 64 });
  return s;
}
// Distinct alphabetic words (the tokenizer may not keep digits): tag + base-26 letters of i.
const letters = (i) => { let out = ''; do { out = String.fromCharCode(97 + (i % 26)) + out; i = Math.floor(i / 26); } while (i > 0); return out; };
const words = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${letters(i)}q`).join(' ');

test('Lore: queries at, just under and over the limit are served; a long query still finds what it names', () => {
  const runtime = new Runtime();
  add(runtime, { uid: 1, title: 'Ember Tavern', content: 'Mara owns the Ember Tavern.' });
  add(runtime, { uid: 2, title: 'Sun Blade', content: 'Eris carried the Sun Blade.' });
  const s = system(runtime);
  const limit = LORE_WAVE3_LIMITS.maxQueryCharacters;
  const base = s.query({ query: 'Where is the Sun Blade?' });
  for (const n of [limit - 1, limit, limit + 1, 2 * limit, 20000]) {
    const filler = 'the quiet evening goes on and '.repeat(Math.ceil(n / 30)).slice(0, Math.max(0, n - 24));
    const q = (filler + ' Where is the Sun Blade?').slice(-n);
    const result = s.query({ query: q });
    assert.equal(result.kind, 'LoreRetrievalResult', 'served at ' + n);
    assert.equal(result.diagnostics.queryDerived, q.length > limit);
    assert.ok(result.nominations.length <= LORE_WAVE3_LIMITS.maxTotalNominations);
    assert.ok(result.nominations.some((row) => base.nominations.some((b) => b.candidateId === row.candidateId)), 'finds the Sun Blade at ' + n);
  }
  // Within the limit the result is exactly as before (no derivation).
  assert.equal(base.diagnostics.queryDerived, false);
});

test('Lore: a term that appears only at the end of a long entry is searchable', () => {
  const runtime = new Runtime();
  add(runtime, { uid: 1, title: 'Chronicle', content: words(400, 'filler') + '. at the very end, the smokeglass lantern was hidden.' });
  add(runtime, { uid: 2, title: 'Other', content: 'Nothing about that here.' });
  const s = system(runtime);
  const result = s.query({ query: 'smokeglass' });
  assert.ok(result.nominations.length > 0, 'the tail term is indexed');
  assert.ok(result.nominations.some((row) => JSON.stringify(row).includes('lore:caps:1')));
});

test('Lore: the examined page is filled with in-scope records', () => {
  const runtime = new Runtime();
  const n = LORE_WAVE3_LIMITS.maxExaminedEntries + 40;
  for (let i = 0; i < n; i += 1) add(runtime, { book: 'other', uid: i, title: 'Harbor ' + i, content: `The harbor lamp ${i} burns.` });
  const inScope = add(runtime, { book: 'zz-mine', uid: 1, title: 'My Harbor', content: 'The harbor lamp of Mira burns.' });
  const s = system(runtime);
  const result = s.hierarchy ? s.retrievalIndex.query({ query: 'harbor lamp', allowedSourceIds: [inScope] }) : null;
  assert.ok(result.nominations.length > 0, 'the in-scope record is found even though 552 out-of-scope records share its terms');
  assert.ok(result.nominations.every((row) => JSON.stringify(row).includes(inScope)));
});

function memoryWithLongEpisodes() {
  const producer = new MemoryTemporalProducer();
  const tail = words(400, 'padding') + ' Finally Mara buried the silver compass under the old oak.';
  producer.appendEvidence({ id: 'ev:1', sourceId: 'ev:1', sourceRevisionId: 'ev:1@r1', exactContent: tail, kind: 'EXPERIENCE', occurredAt: 1, worldRevision: 1, sceneRevision: null, participants: ['Mara'], knownBy: ['Mara'], perspective: 'WORLD', provenance: ['t'] });
  return producer;
}

test('Memory historian: long requests are served, not rejected; short ones unchanged', () => {
  const producer = memoryWithLongEpisodes();
  const limit = MEMORY_LIMITS.maxHistorianQueryCharacters;
  for (const n of [limit - 1, limit, limit + 1, 2 * limit, 20000]) {
    const q = ('and so the evening went on quietly '.repeat(Math.ceil(n / 35)) + 'silver compass').slice(-n);
    const result = producer.historian.query({ query: q });
    assert.notEqual(result.status, 'FAILED');
    assert.equal(result.diagnostics.queryDerived ?? false, q.length > limit, 'derived only over the limit (' + n + ')');
  }
});
