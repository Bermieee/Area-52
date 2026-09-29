// Follow-up (audit D7): the temporal/conflict rules reach Truth through the installed path (fake SillyTavern host, golden
// Ember Tavern world). Every Lore-derived candidate path carries the owner's current hint; nothing is CURRENT on one path and
// UNRESOLVED on another. MOCK-HARNESS evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInstalled } from './helpers/installed-host.mjs';
import { createGoldenDeploymentLorebook } from '../src/deployment/brain.js';
import { STUDY_ENGINE_REVISION } from '../src/lore-study-engine.js';

const Q = 'Where can Eris find the Sun Blade now? The accounts are conflicting.';

async function goldenTurn(chatId) {
  const h = makeInstalled({ chatId });
  h.session.ingestLorebook({ ...createGoldenDeploymentLorebook(), chatId });
  h.user('Eris returns to the tavern.'); await h.generate('normal', 'Mara looks up.');
  h.user(Q); await h.generate('normal', 'Nobody knows.');
  const sel = h.nativeBrain.uiBindings().readSelection({ chatId });
  return { h, turn: h.nativeBrain.readTurn(sel.turnId) };
}
const loreOf = (h) => h.session.brain.loreIntelligence;

test('golden world: superseded state is HISTORICAL, reports and the conflicting fate are UNRESOLVED, per source', async () => {
  const { h } = await goldenTurn('chat:tj1');
  const iface = loreOf(h).brainInterface();
  const hint = (uid) => iface.sourceTruthHint('lore:ember-golden:' + uid)?.status;
  assert.equal(hint('tavern-intact'), 'HISTORICAL', 'superseded by the later burn-down on the same entity/property/timeline');
  assert.equal(hint('blade-report-a'), 'UNRESOLVED');
  assert.equal(hint('blade-report-b'), 'UNRESOLVED');
  assert.notEqual(hint('fire'), 'UNRESOLVED', 'an asserted source keeps its own status; the conflict is surfaced as a conflict set, not by demoting the asserted claim');
  assert.equal(hint('mara'), 'CURRENT');
  const conflicts = loreOf(h).runtime.store.conflicts(loreOf(h).runtime.registry);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].property, 'fate');
  assert.equal(conflicts[0].values.length, 3);
  h.session.destroy();
});

test('delivered Lore candidates agree with the owner hint on every path (contextual and sparse)', async () => {
  const { h, turn } = await goldenTurn('chat:tj2');
  const iface = loreOf(h).brainInterface();
  const cands = (turn.published.candidates ?? []).filter((c) => /^candidate:owner-(lore|sparse)/.test(c.candidateId));
  assert.ok(cands.length >= 6);
  const ownerHints = new Set(['HISTORICAL', 'UNRESOLVED', 'CURRENT']);
  for (const c of cands) assert.ok(ownerHints.has(c.truthStatusHint), c.candidateId + ' ' + c.truthStatusHint);
  const bySource = new Map();
  for (const c of cands) {
    const src = (c.sourceRevisionRefs ?? [])[0] ?? '';
    const uid = src.replace(/^lore:ember-golden:/, '').replace(/@r\d+$/, '');
    if (!bySource.has(uid)) bySource.set(uid, new Set());
    bySource.get(uid).add(c.truthStatusHint);
  }
  let compared = 0;
  for (const [uid, statuses] of bySource) {
    const owner = iface.sourceTruthHint('lore:ember-golden:' + uid)?.status;
    if (!owner) continue;
    compared += 1;
    assert.deepEqual([...statuses], [owner], `source ${uid}: paths disagree (${[...statuses]}) vs owner ${owner}`);
  }
  assert.ok(compared >= 4, 'compared ' + compared + ' sources');
  assert.ok([...bySource.values()].some((set) => set.has('UNRESOLVED')) && [...bySource.values()].some((set) => set.has('HISTORICAL')));
  h.session.destroy();
});

test('the unresolved alternatives reach the choice controller (Jev unavailable is reported, not skipped)', async () => {
  const { h, turn } = await goldenTurn('chat:tj3');
  const receipt = JSON.stringify(turn.published.cognitiveChoiceReceipt ?? {});
  assert.ok(/JEV_UNAVAILABLE/.test(receipt), 'ambiguity is visible to the choice controller: ' + receipt.slice(0, 200));
  assert.ok(!/JEV_NOT_REQUIRED/.test(receipt));
  h.session.destroy();
});

test('an older-engine learned revision is re-studied by the installed Lore study and gains the new evidence', async () => {
  const { h } = await goldenTurn('chat:tj4');
  const svc = loreOf(h), rt = svc.runtime;
  for (const learned of rt.store.learnedRevisions.values()) learned.engineRevision = 'lore-study-engine-v1';
  assert.ok(rt.store.sourceIdsWithStaleEngine(rt.registry, STUDY_ENGINE_REVISION).length >= 6);
  await h.session.brain.runLoreStudy?.({ chatId: 'chat:tj4' });
  assert.equal(rt.store.sourceIdsWithStaleEngine(rt.registry, STUDY_ENGINE_REVISION).length, 0);
  assert.equal(svc.brainInterface().sourceTruthHint('lore:ember-golden:tavern-intact')?.status, 'HISTORICAL');
  h.session.destroy();
});

// The Brain's Lore channel asks the owner for `includeNavigation:false` (it never reads summaries, conflicts or communities
// from the retrieval packet). Truth's conflict handling does not depend on those packet fields: the unresolved hints travel on
// the nominations and conflict sets are read from the owner directly. This compares a whole installed turn with the flag
// honoured against the owner forced to return the full packet: candidates (truth hint, truth/temporal status, freshness,
// fences), Truth assessment and corrective receipts, the sealed packet, the choice controller and the delivered plan must be
// identical, for an unresolved conflict and for a source edited after study (stale, not yet re-studied).
// Wall-clock fields only (case-sensitive camelCase suffixes plus exact names); everything else is compared.
const TIME_KEY = /(At|Ms|Timestamp|Duration|Latency)$|^(at|ms|now|elapsed|timestamp|deadline|performance|timing|performanceReceipt)$/;
const withoutTiming = (v) => Array.isArray(v) ? v.map(withoutTiming) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !TIME_KEY.test(k)).map(([k, x]) => [k, withoutTiming(x)])) : v;
async function turnWithNavigation(forceFullPacket, { editAfterStudy = false } = {}) {
  const chatId = 'chat:nav-ab';
  const h = makeInstalled({ chatId });
  const svc = loreOf(h);
  const requests = [];
  const original = svc.queryForStory.bind(svc);
  svc.queryForStory = (request = {}) => { requests.push(request.includeNavigation); return original(forceFullPacket ? { ...request, includeNavigation: true } : request); };
  const book = { ...createGoldenDeploymentLorebook(), chatId };
  h.session.ingestLorebook(book);
  if (editAfterStudy) h.session.brain.acceptLorebook({ ...book, entries: book.entries.map((e) => e.uid === 'mara' ? { ...e, content: e.content + ' She has moved to the harbor.' } : e) });
  h.user('Eris returns to the tavern.'); await h.generate('normal', 'Mara looks up.');
  h.user(Q); await h.generate('normal', 'Nobody knows.');
  const turn = h.nativeBrain.readTurn(h.nativeBrain.uiBindings().readSelection({ chatId }).turnId);
  const out = withoutTiming(JSON.parse(JSON.stringify({ published: turn.published, delivery: turn.delivery, loreSync: turn.loreSync,
    sourceRevisionSet: turn.sourceRevisionSet, ownerSourceRevisionSet: turn.ownerSourceRevisionSet, conflictSets: svc.brainInterface().conflictSets({ chatId }),
    status: svc.retrievalEligibility({ chatId }) })));
  h.session.destroy();
  return { out, requests };
}
for (const editAfterStudy of [false, true]) {
  test(`channel includeNavigation:false leaves retrieval, freshness and unresolved-conflict evidence unchanged (${editAfterStudy ? 'stale source' : 'unresolved conflict'})`, async () => {
    const lean = await turnWithNavigation(false, { editAfterStudy });
    const full = await turnWithNavigation(true, { editAfterStudy });
    assert.ok(lean.requests.includes(false), 'the channel explicitly asks for includeNavigation:false');
    assert.ok(lean.requests.every((flag) => flag === false || flag === undefined), 'other callers keep the default');
    const cands = lean.out.published.candidates.filter((c) => /^candidate:owner-(lore|sparse)/.test(c.candidateId));
    assert.ok(cands.some((c) => c.truthStatusHint === 'UNRESOLVED'), 'unresolved Lore evidence reaches Truth');
    assert.equal(lean.out.conflictSets.length, 1, 'the owner conflict set is still readable');
    if (editAfterStudy) {
      const mara = lean.out.status.entries.find((row) => row.uid === 'mara');
      assert.equal(mara.freshness, 'STALE_OR_UNLEARNED'); assert.equal(mara.eligibleForStoryRetrieval, false);
      assert.equal(cands.some((c) => (c.sourceRevisionRefs ?? []).some((r) => r.startsWith(mara.sourceId + '@') && r !== mara.sourceRevisionId)), false, 'no candidate from the superseded revision');
    }
    assert.deepEqual(lean.out, full.out);
  });
}
