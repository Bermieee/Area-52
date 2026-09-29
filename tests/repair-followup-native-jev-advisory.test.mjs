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

// Installed end to end (closure round): the deployment's own Jev service behind an operator-connected JEV resource (fake
// OpenAI-compatible HTTP provider). Covers FINAL_HANDOFF acceptance item 8 on the fake host: advice only while a JEV
// resource is connected, consumed by the next turn that the conflict shapes, a failed live call (native fixture fallback)
// never presented as advice, disconnect stops requests.
function installedJevProvider({ fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'jev-mock' }] }) };
    const body = JSON.parse(init?.body ?? '{}'); calls.push(body);
    const user = String(body.messages?.at(-1)?.content ?? '');
    if (fail && /optionId/.test(user)) return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({ error: { message: 'down' } }) };
    const option = (user.match(/"optionId"\s*:\s*"([^"]+)"/) || [])[1] ?? 'CONTRADICTORY';
    const evidenceUsed = [...user.matchAll(/"evidenceId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]).slice(0, 4);
    const content = JSON.stringify({ outcome: 'DECIDED', decisionCode: 'CHOOSE_ONE', selectedOptionIds: [option], rejectedOptionIds: [], classification: null, reasonCodes: ['FAKE_PROVIDER'], evidenceUsed, unresolvedFactors: [], confidence: 0.8, abstained: false, escalationTarget: null, requiresOperator: false, explanation: 'fake' });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: 'jev-mock', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
  };
  return { calls, fetchImpl, jevCalls: () => calls.filter((b) => /optionId/.test(String(b.messages?.at(-1)?.content ?? ''))).length };
}
async function installedJevWorld({ fail = false } = {}) {
  const w = WORLDS[0];
  const h = makeInstalled({ chatId: w.chat });
  h.session.ingestLorebook(w.book());
  const provider = installedJevProvider({ fail });
  h.session.brain.resourceConnections.fetchImpl = provider.fetchImpl;
  const ask = async (text) => { h.user(text); await h.generate('normal', 'Nobody knows.'); await h.nativeBrain.drainBackgroundLearning({ maxCycles: 64 }); return h.nativeBrain.readTurn(h.nativeBrain.uiBindings().readSelection({ chatId: w.chat }).turnId); };
  return { h, w, provider, ask };
}

test('installed: a connected JEV resource produces a live advisory that the next conflicting turn consumes; disconnect stops requests', async () => {
  const { h, w, provider, ask } = await installedJevWorld();
  assert.equal(h.nativeBrain.readJevAdvisories().configured, false, 'precondition: idle without a JEV resource');
  await h.session.brain.connectOptionalResource({ kind: 'JEV', resourceId: 'jev', endpoint: 'https://jev.invalid/v1', modelId: 'jev-mock', apiKey: 'k' });
  assert.equal(h.nativeBrain.readJevAdvisories().configured, true);
  const first = await ask(w.ask);
  const rows = h.nativeBrain.readJevAdvisories().rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'ADVISED'); assert.equal(rows[0].current, true);
  assert.ok(provider.jevCalls() >= 1, 'the live provider was called');
  assert.equal(first.published.cognitiveChoiceReceipt?.jev?.advised ?? false, false, 'the requesting turn is not changed after its seal');
  const next = await ask('Where is the Sun Blade now? The reports still conflict.');
  const jev = next.published.cognitiveChoiceReceipt.jev;
  assert.equal(jev.action, 'PRESERVE_UNRESOLVED'); assert.equal(jev.advisory.id, rows[0].id); assert.equal(jev.advisory.destination, 'NEXT_TURN');
  assert.equal(jev.advisory.authorityGranted, false); assert.equal(jev.advisory.canonicalMutation, false);
  const hint = h.session.brain.loreIntelligence.brainInterface().sourceTruthHint('lore:ember-golden:blade-report-a')?.status;
  assert.equal(hint, 'UNRESOLVED', 'the advice resolves nothing in Lore');
  const before = provider.jevCalls();
  h.session.brain.resourceConnections.disconnectResource('jev');
  assert.equal(h.nativeBrain.readJevAdvisories().configured, false);
  await ask('Where can Eris find the Sun Blade? The accounts conflict again.');
  assert.equal(provider.jevCalls(), before, 'no Jev request after disconnect');
  h.session.destroy();
});

test('installed: a failed live Jev call (native fixture fallback) is never presented or consumed as advice', async () => {
  const { h, w, provider, ask } = await installedJevWorld({ fail: true });
  await h.session.brain.connectOptionalResource({ kind: 'JEV', resourceId: 'jev', endpoint: 'https://jev.invalid/v1', modelId: 'jev-mock', apiKey: 'k' });
  await ask(w.ask);
  assert.ok(provider.jevCalls() >= 1, 'precondition: the live Jev call was attempted (and failed)');
  const rows = h.nativeBrain.readJevAdvisories().rows;
  assert.deepEqual(rows.map((row) => row.status), ['NOT_ADVISED_NO_LIVE_PROVIDER'], 'the fallback is recorded as no advice');
  const next = await ask('Where is the Sun Blade now? The reports still conflict.');
  assert.notEqual(next.published.cognitiveChoiceReceipt.jev.action, 'PRESERVE_UNRESOLVED', 'nothing standing to consume');
  h.session.destroy();
});

// Next-turn PROMPT consumption (closure final pass): the admitted advisory reaches the next conflicting turn's prompt as a
// labelled ADVISORY note in UNRESOLVED_EVIDENCE, sealed in that turn's packet, separate from canonical facts, fresh at
// consumption; the requesting turn's seal is never touched.
const canonicalRows = (packet) => JSON.stringify(['current', 'historical', 'unresolved', 'relevantLore', 'episodicMemory'].map((k) => packet?.[k] ?? []));
async function consumingWorld({ connect = true } = {}) {
  const env = await installedJevWorld();
  const requests = [];
  const ask = async (text) => { env.h.user(text); const r = await env.h.generate('normal', 'Nobody knows.'); requests.push(r.req); await env.h.nativeBrain.drainBackgroundLearning({ maxCycles: 64 }); return env.h.nativeBrain.readTurn(env.h.nativeBrain.uiBindings().readSelection({ chatId: env.w.chat }).turnId); };
  if (connect) await env.h.session.brain.connectOptionalResource({ kind: 'JEV', resourceId: 'jev', endpoint: 'https://jev.invalid/v1', modelId: 'jev-mock', apiKey: 'k' });
  return { ...env, ask, requests };
}

test('prompt consumption: the next conflicting turn carries a sealed, labelled ADVISORY note in UNRESOLVED_EVIDENCE; canonical rows are unchanged; the earlier seal is untouched', async () => {
  const withJev = await consumingWorld();
  const first = await withJev.ask(withJev.w.ask);
  const firstSeal = JSON.stringify(first.published.sealReceipt), firstPacket = JSON.stringify(first.published.packet);
  assert.equal(first.published.packet.advisories, undefined, 'the requesting turn has no advisory (it did not exist yet)');
  const next = await withJev.ask('Where is the Sun Blade now? The reports still conflict.');
  const advisory = withJev.h.nativeBrain.readJevAdvisories().rows[0];
  const notes = next.published.packet.advisories ?? [];
  assert.equal(notes.length, 1); const note = notes[0];
  assert.equal(note.a, 'ADVISORY'); assert.equal(note.advisoryOnly, true); assert.equal(note.canonical, false);
  assert.equal(note.advisoryId, advisory.id); assert.equal(note.classification, advisory.classification);
  assert.match(note.note, /ADVISORY ONLY/); assert.match(note.note, /not a fact and not a resolution/);
  assert.ok(note.relatesTo.length >= 2, 'tied to the conflicting accounts');
  for (const field of ['current', 'historical', 'unresolved', 'relevantLore']) assert.equal((next.published.packet[field] ?? []).some((row) => row.id === note.id), false, 'never mixed into ' + field);
  assert.deepEqual(next.published.packet.provenanceIndex[note.id], [...advisory.fence.sourceRevisionSet].sort());
  const section = next.delivery.plan.sections.find((s) => s.slot === 'UNRESOLVED_EVIDENCE');
  assert.ok(section && section.content.some((row) => row.id === note.id), 'rendered in UNRESOLVED_EVIDENCE');
  assert.equal(next.delivery.plan.sections.filter((s) => s.slot !== 'UNRESOLVED_EVIDENCE').some((s) => JSON.stringify(s.content ?? '').includes(note.id)), false, 'only there');
  assert.ok(JSON.stringify(withJev.requests.at(-1).chat).includes('ADVISORY ONLY'), 'reaches the injected prompt');
  assert.equal(next.published.cognitiveChoiceReceipt.jev.action, 'PRESERVE_UNRESOLVED', 'the alternatives stay unresolved');
  assert.equal(JSON.stringify(first.published.sealReceipt), firstSeal); assert.equal(JSON.stringify(first.published.packet), firstPacket, 'earlier seal and packet untouched');
  assert.equal(next.published.sealReceipt.packetHash != null, true);
  const without = await consumingWorld({ connect: false });
  await without.ask(without.w.ask);
  const plain = await without.ask('Where is the Sun Blade now? The reports still conflict.');
  assert.equal(plain.published.packet.advisories, undefined, 'no Jev resource: no advisory');
  assert.equal(canonicalRows(next.published.packet), canonicalRows(plain.published.packet), 'canonical rows identical with and without the advisory');
  withJev.h.session.destroy(); without.h.session.destroy();
});

test('prompt consumption: an advisory that went stale before consumption is not attached, and a turn without the conflict evidence gets no note', async () => {
  const env = await consumingWorld();
  await env.ask(env.w.ask);
  assert.equal(env.h.nativeBrain.readJevAdvisories().rows[0].status, 'ADVISED');
  // Evidence rule, on a real consuming packet: remove one conflict member's row and the note is not attached.
  const { attachJevAdvisoryToPacket } = await import('../src/jev-advisory-packet.js');
  const consuming = await env.ask('Where is the Sun Blade now? The reports still conflict.');
  const note = consuming.published.packet.advisories?.[0];
  assert.ok(note, 'precondition: attached when the members are present');
  const advisory = { ...consuming.published.cognitiveChoiceReceipt.jev.advisory };
  const base = { ...consuming.published.packet }; delete base.advisories;
  // Every row carrying one member's revision is removed (the contextual and sparse paths can both deliver it).
  const member = advisory.sourceRevisionSet[0];
  const carries = (row) => (base.provenanceIndex[row.id] ?? []).includes(member);
  assert.ok(base.relevantLore.some(carries));
  const missing = { ...base, relevantLore: base.relevantLore.filter((row) => !carries(row)), current: (base.current ?? []).filter((row) => !carries(row)), historical: (base.historical ?? []).filter((row) => !carries(row)), unresolved: (base.unresolved ?? []).filter((row) => !carries(row)) };
  const result = attachJevAdvisoryToPacket(missing, advisory);
  assert.equal(result.attached, false); assert.equal(result.reason, 'ADVISORY_MEMBERS_NOT_IN_PACKET');
  assert.equal(attachJevAdvisoryToPacket(base, { ...advisory, authorityGranted: true }).attached, false, 'anything claiming authority is refused');
  // A member source changes: the advisory's fence moves, so it must not reach the next prompt as current advice.
  const book = env.w.book();
  env.h.session.ingestLorebook({ ...book, entries: book.entries.map((e) => e.uid === 'blade-report-a' ? { ...e, content: e.content + ' The dockhand later recanted.' } : e) });
  const after = await env.ask('Where is the Sun Blade now? The reports still conflict.');
  assert.equal(after.published.packet.advisories, undefined, 'stale advisory not attached');
  assert.equal(JSON.stringify(env.requests.at(-1).chat).includes('ADVISORY ONLY'), false);
  env.h.session.destroy();
});

test('prompt consumption: freshness is re-checked at attachment; a fence that moves after the lookup blocks the note', async () => {
  const env = await consumingWorld();
  await env.ask(env.w.ask);
  const advisory = env.h.nativeBrain.jevAdvisory;
  const realIsFresh = advisory.isFresh.bind(advisory);
  let calls = 0;
  // First call (choice-controller lookup) sees a fresh advisory; the re-check at attachment sees the fence moved.
  advisory.isFresh = (row, iface) => { calls += 1; return calls === 1 ? realIsFresh(row, iface) : false; };
  const next = await env.ask('Where is the Sun Blade now? The reports still conflict.');
  assert.ok(calls >= 2, 'looked up, then re-checked');
  assert.equal(next.published.packet.advisories, undefined, 'not attached');
  assert.equal(next.published.cognitiveChoiceReceipt.jev.advisory?.promptAttachment?.reason ?? 'ADVISORY_STALE_AT_CONSUMPTION', 'ADVISORY_STALE_AT_CONSUMPTION');
  assert.equal(JSON.stringify(env.requests.at(-1).chat).includes('ADVISORY ONLY'), false);
  env.h.session.destroy();
});
