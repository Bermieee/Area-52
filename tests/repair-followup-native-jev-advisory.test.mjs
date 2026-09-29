// Follow-up (audit D11): native-path Jev advice on ESTABLISHED Lore conflict sets, through the Runtime (NEARLINE obligation),
// the documented TEMPORAL adapter and the freshness contract, NEXT_TURN only. FAKE-HOST + fake provider evidence; no live Jev.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInstalled } from './helpers/installed-host.mjs';
import { createGoldenDeploymentLorebook } from '../src/deployment/brain.js';
import { createJevDomainAdapterMatrix } from '../src/coprocessor/jev-adapter-matrix.js';
import { JevOutcome, JevDecisionShape } from '../src/coprocessor/jev-contracts.js';

// A provider that decides, abstains, or runs a hook (to change the world while Jev is "thinking").
function makeProvider({ pick = 'CONTRADICTORY', abstain = false, before = null, live = true } = {}) {
  const calls = []; // closure state: the Jev core deep-freezes what it can reach from the provider object
  const provider = {
    count: () => calls.length,
    hasEligibleProvider: () => true,
    async execute(request) {
      calls.push(request.decisionId);
      if (before) await before(request);
      const evidenceUsed = request.evidenceRefs.map((row) => row.evidenceId).slice(0, 8);
      const decision = abstain
        ? { outcome: JevOutcome.ABSTAINED, decisionCode: JevDecisionShape.ABSTAIN, selectedOptionIds: [], rejectedOptionIds: [], classification: null, reasonCodes: ['TEST_ABSTAIN'], evidenceUsed, unresolvedFactors: ['test'], confidence: 0.3, abstained: true, escalationTarget: null, requiresOperator: false, explanation: 'abstained' }
        : { outcome: JevOutcome.DECIDED, decisionCode: JevDecisionShape.CHOOSE_ONE, selectedOptionIds: [pick], rejectedOptionIds: ['CONTRADICTORY', 'TEMPORALLY_DISTINCT', 'COMPLEMENTARY', 'UNRESOLVED'].filter((id) => id !== pick), classification: null, reasonCodes: ['TEST_DECIDED'], evidenceUsed, unresolvedFactors: [], confidence: 0.9, abstained: false, escalationTarget: null, requiresOperator: false, explanation: 'decided' };
      return { decision, providerProvenance: { providerProfileId: 'test.profile', providerId: 'test.provider', modelId: 'test-model', workerId: 'test-worker', capability: 'SEMANTIC_JUDGMENT', attempt: 1, measurementClass: 'LOCAL_DETERMINISTIC', evidenceClass: live ? 'TEST_PROVIDER' : 'DETERMINISTIC_LOCAL_FIXTURE' }, latencyMetadata: { providerLatencyMs: 0, validationLatencyMs: 0, totalLatencyMs: 0, attempts: 1 }, payloadBytes: 10 };
    },
  };
  return provider;
}
const serviceFor = (provider) => createJevDomainAdapterMatrix({ providerExecutor: provider }).service;

const WORLDS = [
  { name: 'tavern', chat: 'chat:jev-t', book: () => ({ ...createGoldenDeploymentLorebook(), chatId: 'chat:jev-t' }), ask: 'Where can Eris find the Sun Blade now? The accounts are conflicting.', member: 3 },
  {
    name: 'station', chat: 'chat:jev-s',
    book: () => ({
      id: 'station-book', title: 'Station', chatId: 'chat:jev-s', discovery: { kind: 'Fixture', stableId: 'station-book', exactAuthoredSource: true },
      entries: [
        { uid: 'manifest', content: 'The Cargo Pod was destroyed during the blackout.', metadata: { title: 'Cargo Manifest', at: 10, treePath: ['Ship', 'Cargo'] } },
        { uid: 'log', content: 'A dockhand says the Cargo Pod survived the blackout.', metadata: { title: 'Dock Log', at: 12, claimAt: 9, treePath: ['Ship', 'Cargo'] } },
        { uid: 'reactor', content: 'The Meridian Reactor is intact.', metadata: { title: 'Reactor', at: 2, treePath: ['Ship', 'Reactor'] } },
      ],
    }),
    ask: 'What happened to the Cargo Pod during the blackout? The accounts are conflicting.', member: 0,
  },
];

async function world(w, { provider = makeProvider(), configured = true, executionEvidence = null, attach = true } = {}) {
  const h = makeInstalled({ chatId: w.chat });
  h.session.ingestLorebook(w.book());
  if (attach) h.nativeBrain.attachJevAdvisory({ service: serviceFor(provider), isConfigured: () => configured, executionEvidence });
  const turn = async (user, reply) => {
    h.user(user); const r = await h.generate('normal', reply);
    await h.nativeBrain.drainBackgroundLearning({ maxCycles: 64 });
    const sel = h.nativeBrain.uiBindings().readSelection({ chatId: w.chat });
    return { r, turn: h.nativeBrain.readTurn(sel.turnId) };
  };
  return { h, turn, provider };
}
const advisoryTasks = (h) => h.nativeBrain.runtimeDirector.ledger.list().filter((r) => r.obligation.taskType === 'NATIVE_JEV_ADVISORY');

for (const w of WORLDS) {
  test(`[${w.name}] Jev advises on the established conflict through the Runtime; the sealed turn and Lore are untouched; the next turn reports it`, async () => {
    const { h, turn, provider } = await world(w);
    await turn('Something ordinary happens.', 'Nothing much.');
    const { turn: t2 } = await turn(w.ask, 'Nobody knows.');
    const sealBefore = JSON.stringify(t2.published.sealReceipt), packetBefore = JSON.stringify(t2.published.packet);
    const rows = h.nativeBrain.readJevAdvisories().rows;
    assert.equal(rows.length, 1, JSON.stringify(h.nativeBrain.jevAdvisory.diagnostics()));
    const row = rows[0];
    assert.equal(row.status, 'ADVISED');
    assert.equal(row.classification, 'CONTRADICTORY');
    assert.equal(row.destination, 'NEXT_TURN');
    assert.equal(row.authorityGranted, false); assert.equal(row.canonicalMutation, false); assert.equal(row.contextSealMutated, false); assert.equal(row.loreMutated, false);
    assert.equal(row.sourceSealId, t2.published.sealReceipt.id);
    // Runtime path: a NEARLINE obligation on the Work Ledger, executed, with an owner decision recorded.
    const tasks = advisoryTasks(h);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].obligation.runtimeClass, 'NEARLINE');
    assert.equal(tasks[0].executionStatus, 'COMPLETE');
    assert.equal(provider.count(), 1);
    // The requested turn is byte-identical after the advisory.
    const again = h.nativeBrain.readTurn(t2.turnId ?? h.nativeBrain.uiBindings().readSelection({ chatId: w.chat }).turnId);
    assert.equal(JSON.stringify(again.published.sealReceipt), sealBefore);
    assert.equal(JSON.stringify(again.published.packet), packetBefore);
    assert.equal(again.published.cognitiveChoiceReceipt.jev.advised, undefined, 'the requested turn is not rewritten with the advice');
    // NEXT turn: the controller reports the standing fresh advisory; alternatives remain unresolved; no second provider call.
    const { turn: t3 } = await turn(w.ask, 'Still unclear.');
    const jev = t3.published.cognitiveChoiceReceipt.jev;
    assert.equal(jev.action, 'PRESERVE_UNRESOLVED');
    assert.equal(jev.advisory.id, row.id);
    assert.equal(jev.advisory.classification, 'CONTRADICTORY');
    assert.equal(jev.advisory.authorityGranted, false);
    assert.ok((t3.published.candidates ?? []).some((c) => c.truthStatusHint === 'UNRESOLVED'), 'the alternatives stay unresolved');
    assert.equal(provider.count(), 1, 'no repeat request against an unchanged fence');
    h.session.destroy();
  });

  test(`[${w.name}] nothing is requested unless Jev is attached and configured`, async () => {
    for (const cfg of [{ attach: false }, { configured: false }]) {
      const { h, turn, provider } = await world(w, cfg);
      const { turn: t } = await turn(w.ask, 'Nobody knows.');
      assert.equal(advisoryTasks(h).length, 0);
      assert.equal(provider.count(), 0);
      assert.equal(t.published.cognitiveChoiceReceipt.jev.action, 'JEV_UNAVAILABLE');
      h.session.destroy();
    }
  });

  test(`[${w.name}] a result whose fence moved while Jev ran is rejected as stale and never advises`, async () => {
    const provider = makeProvider({ before: async () => {
      const book = w.book();
      book.entries[w.member] = { ...book.entries[w.member], content: book.entries[w.member].content + ' It was later confirmed twice.' };
      h.session.ingestLorebook(book);
    } });
    const { h, turn } = await world(w, { provider });
    const { turn: t } = await turn(w.ask, 'Nobody knows.');
    const rows = h.nativeBrain.readJevAdvisories().rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'REJECTED_STALE');
    const { turn: next } = await turn(w.ask, 'Still unclear.');
    assert.notEqual(next.published.cognitiveChoiceReceipt.jev.action, 'PRESERVE_UNRESOLVED');
    void t;
    h.session.destroy();
  });

  test(`[${w.name}] an advisory stops applying when a member source changes afterwards (freshness at consumption)`, async () => {
    const { h, turn } = await world(w);
    await turn(w.ask, 'Nobody knows.');
    assert.equal(h.nativeBrain.readJevAdvisories().rows[0].status, 'ADVISED');
    const book = w.book();
    book.entries[w.member] = { ...book.entries[w.member], content: book.entries[w.member].content.replace('destroyed', 'lost') };
    h.session.ingestLorebook(book);
    const alternatives = [{ candidateId: 'x', claimIds: h.nativeBrain.readJevAdvisories().rows[0].memberClaimIds }];
    assert.equal(h.nativeBrain.jevAdvisory.lookup(alternatives, { loreInterface: h.nativeBrain.loreInterface }), null);
    h.session.destroy();
  });

  test(`[${w.name}] abstention, a local-fixture fallback and provider failure are never presented as advice`, async () => {
    const abst = await world(w, { provider: makeProvider({ abstain: true }) });
    await abst.turn(w.ask, 'Nobody knows.');
    assert.equal(abst.h.nativeBrain.readJevAdvisories().rows[0].status, 'UNRESOLVED');
    const t = await abst.turn(w.ask, 'Still unclear.');
    assert.notEqual(t.turn.published.cognitiveChoiceReceipt.jev.action, 'PRESERVE_UNRESOLVED');
    abst.h.session.destroy();
    const fallback = await world(w, { executionEvidence: () => ({ status: 'LIVE_PROVIDER_FAILED_NATIVE_FALLBACK', fallbackUsed: true }) });
    await fallback.turn(w.ask, 'Nobody knows.');
    assert.equal(fallback.h.nativeBrain.readJevAdvisories().rows[0].status, 'NOT_ADVISED_NO_LIVE_PROVIDER');
    fallback.h.session.destroy();
    const broken = await world(w, { provider: { hasEligibleProvider: () => true, execute: async () => { throw new Error('provider down'); } } });
    await broken.turn(w.ask, 'Nobody knows.');
    const row = broken.h.nativeBrain.readJevAdvisories().rows[0];
    assert.ok(['UNRESOLVED', 'FAILED'].includes(row.status), row.status);
    assert.notEqual(row.status, 'ADVISED');
    broken.h.session.destroy();
  });
}

test('advisories survive a Brain snapshot and stay fenced on restore', async () => {
  const w = WORLDS[0];
  const { h, turn } = await world(w);
  await turn(w.ask, 'Nobody knows.');
  const snapshot = JSON.parse(JSON.stringify(h.nativeBrain.snapshot()));
  assert.equal(snapshot.jevAdvisories.rows.length, 1);
  const { Area52NativeBrain } = await import('../src/native-brain.js');
  const restored = Area52NativeBrain.fromSnapshot(snapshot);
  assert.equal(restored.readJevAdvisories().rows[0].status, 'ADVISED');
  assert.equal(restored.readJevAdvisories().configured, false, 'no Jev service is attached to a restored Brain until the host attaches one');
  h.session.destroy();
});

test('story isolation: a conflict set from another story is never requested or applied', async () => {
  const a = WORLDS[0], b = WORLDS[1];
  const { h, turn } = await world(a);
  await turn(a.ask, 'Nobody knows.');
  assert.equal(h.nativeBrain.readJevAdvisories().rows.length, 1);
  const iface = h.nativeBrain.loreInterface;
  assert.equal(iface.conflictSets({ chatId: b.chat }).length, 0, 'the other chat has no read scope over story A');
  h.session.destroy();
});

test('installed wiring: the deployment Jev service is attached but reports not configured without an operator JEV resource, so nothing runs', async () => {
  const w = WORLDS[0];
  const h = makeInstalled({ chatId: w.chat });
  h.session.ingestLorebook(w.book());
  const state = h.nativeBrain.readJevAdvisories();
  assert.equal(state.attached, true, 'the session attaches the deployment Jev service');
  assert.equal(state.configured, false, 'no connected JEV resource: Jev stays optional and idle');
  h.user(w.ask); await h.generate('normal', 'Nobody knows.');
  await h.nativeBrain.drainBackgroundLearning({ maxCycles: 64 });
  assert.equal(advisoryTasks(h).length, 0);
  assert.equal(h.nativeBrain.readJevAdvisories().rows.length, 0);
  h.session.destroy();
});

for (const w of WORLDS) {
  test(`[${w.name}] the operator's Lore status shows the conflict set with its Jev advisory, display only, and marks it stale after an edit`, async () => {
    const { h, turn } = await world(w);
    await turn(w.ask, 'Nobody knows.');
    const bindings = h.session.uiBindings();
    const host = bindings.loreStudyHost ?? bindings.loreOperatorHost ?? bindings.loreHost;
    const status = () => { const raw = host.read.status(); return raw.study ?? raw; };
    const conflict = status().conflicts.find((row) => row.certainty === 'ESTABLISHED');
    assert.ok(conflict, 'the established conflict set is visible');
    assert.equal(conflict.jevAdvisory.classification, 'CONTRADICTORY');
    assert.equal(conflict.jevAdvisory.ownerDecision, 'ACCEPTED');
    assert.equal(conflict.jevAdvisory.current, true);
    assert.equal(conflict.jevAdvisory.advisoryOnly, true);
    assert.equal(conflict.status, 'UNRESOLVED', 'the conflict itself stays unresolved');
    const book = w.book();
    book.entries[w.member] = { ...book.entries[w.member], content: book.entries[w.member].content + ' Twice confirmed.' };
    h.session.ingestLorebook(book);
    const after = status().conflicts.find((row) => row.jevAdvisory);
    // The edit changes the source revision: the old advisory is no longer current (or its set is gone) and is never applied.
    assert.ok(!after || after.jevAdvisory.current === false, 'a stale advisory is not shown as current');
    h.session.destroy();
  });
}
