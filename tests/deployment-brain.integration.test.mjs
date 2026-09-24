import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentDeploymentBrain, createGoldenDeploymentLorebook } from '../src/deployment/index.js';
import { createWave11LiveReceiptBinding } from '../src/ui-core/index.js';

function seeded(options = {}) {
  const brain = new DevelopmentDeploymentBrain(options);
  const ingest = brain.ingestLorebook(createGoldenDeploymentLorebook());
  const sourceRevisionId = brain.core.registry.activeRevisionIds()[0];
  brain.observeScene({
    chatId: 'chat:ember',
    sourceRevisionId,
    location: 'Ember Tavern Ruins',
    activeCast: ['Mara', 'Eris'],
    activeThreads: ['Determine the Sun Blade fate'],
    objects: [{ objectId: 'Sun Blade', state: 'UNCERTAIN', evidenceRefs: [sourceRevisionId] }],
    atmosphere: 'Ash and rain',
  });
  return { brain, ingest };
}

test('deployment golden lore is studied exactly and mirrored through Core settlement without external services', () => {
  const { brain, ingest } = seeded();
  assert.equal(ingest.mappingCount, 6);
  assert.equal(ingest.retrieval.sourceDrillbackAvailable, true);
  assert.equal(ingest.retrieval.retrieval.externalEmbeddingRequired, false);
  assert.equal(ingest.retrieval.retrieval.externalDatabaseRequired, false);
  assert.equal(ingest.retrieval.retrieval.orchestrationServiceRequired, false);
  const model = brain.core.currentWorldModel();
  assert.ok(model.current.some((row) => row.subjectId.includes('Ember Tavern') || String(row.value).includes('Ember Tavern')));
  assert.ok(model.unresolved.length >= 1);
  assert.equal(brain.diagnostics().remoteProviderRequired, false);
});

test('simple turn uses native Scene Hot Cognition and reaches a sealed PromptPlan without expensive retrieval or Jev', async () => {
  const { brain } = seeded();
  const result = await brain.runTurn({
    chatId: 'chat:ember',
    turnId: 'turn:simple',
    generationId: 'gen:simple',
    query: 'Where are we?',
    mode: 'simple',
  });
  assert.equal(result.scatter.jobs.length, 0);
  assert.ok(result.published.cognitiveChoiceReceipt.paths.includes('HOT_ONLY'));
  assert.equal(result.published.cognitiveChoiceReceipt.jev.skipped, true);
  assert.equal(brain.core.publication.seal.verify('turn:simple').sealed, true);
  assert.equal(result.delivery.ok, true);
  assert.equal(result.delivery.plan.generationId, 'gen:simple');
});

test('retrieval-heavy turn executes Lore and Graph on one resource before Candidate Bus/Truth/Gather/Seal', async () => {
  const { brain } = seeded({ resourceCount: 1 });
  const result = await brain.runTurn({
    chatId: 'chat:ember',
    turnId: 'turn:retrieval',
    generationId: 'gen:retrieval',
    query: 'Tell me about Mara and the Ember Tavern history',
    mode: 'retrieval',
  });
  assert.equal(result.scatter.jobs.length, 2);
  assert.equal(result.scatter.resourceCount, 1);
  assert.ok(result.published.candidateEnvelope.fusionReceipt.perChannelCounts.NATIVE_LORE_RUNTIME > 0);
  assert.ok(result.published.candidates.some((row) => row.sourceRevisionRefs.length > 0));
  assert.equal(result.published.gatherReceipt.closedForForeground, true);
  assert.equal(brain.core.publication.seal.verify('turn:retrieval').hashMatches, true);
  assert.equal(result.delivery.ok, true);
  const prepared = brain.loreChannel.prepared.get('Tell me about Mara and the Ember Tavern history');
  assert.ok(prepared.nominations.length > 0);
  const laneNomination = prepared.nominations[0].metadata.laneNomination;
  const drill = brain.loreSystem.drillDown(laneNomination);
  assert.ok(drill.length > 0);
  assert.ok(drill.every((row) => typeof row.exactAuthoredText === 'string' && row.exactAuthoredText.length > 0));
});

test('ambiguous Sun Blade turn invokes bounded Jev through Runtime and preserves owner authority', async () => {
  const { brain } = seeded({ resourceCount: 1 });
  const result = await brain.runTurn({
    chatId: 'chat:ember',
    turnId: 'turn:ambiguous',
    generationId: 'gen:ambiguous',
    query: 'What happened to the Sun Blade?',
    mode: 'ambiguous',
  });
  assert.equal(result.scatter.jobs.some((row) => row.taskType === 'JEV_DECISION'), true);
  assert.ok(result.jevProposal);
  assert.equal(result.jevProposal.abstained, true);
  assert.equal(result.jevProposal.mutationAuthority, false);
  assert.equal(result.jevProposal.requiresOwnerPolicy, true);
  assert.equal(result.published.cognitiveChoiceReceipt.jev.considered, true);
  assert.equal(result.published.cognitiveChoiceReceipt.jev.abstained, true);
  const unresolved = brain.core.graph.unresolvedClaims().filter((row) => /Sun Blade/i.test(JSON.stringify(row)));
  assert.ok(unresolved.length >= 2);
  assert.ok(result.published.packet.unresolved.length >= 1);
  assert.equal(result.delivery.ok, true);
});

test('missing optional Jev degrades safely while Truth, Gather, Seal and PromptPlan remain usable', async () => {
  const { brain } = seeded({ resourceCount: 1, jevAvailable: false });
  const result = await brain.runTurn({
    chatId: 'chat:ember',
    turnId: 'turn:no-jev',
    generationId: 'gen:no-jev',
    query: 'What happened to the Sun Blade?',
    mode: 'ambiguous',
  });
  assert.equal(result.scatter.jobs.some((row) => row.taskType === 'JEV_DECISION'), false);
  assert.equal(result.jevProposal, null);
  assert.equal(result.published.cognitiveChoiceReceipt.jev.unavailable, true);
  assert.equal(brain.core.publication.seal.verify('turn:no-jev').sealed, true);
  assert.equal(result.delivery.ok, true);
  assert.ok(result.published.gatherReceipt);
});

test('one versus several local resources changes placement, not sealed semantic evidence', async () => {
  const one = seeded({ resourceCount: 1 }).brain;
  const many = seeded({ resourceCount: 3 }).brain;
  const input = {
    chatId: 'chat:ember',
    query: 'Tell me about Mara and the Ember Tavern history',
    mode: 'retrieval',
  };
  const a = await one.runTurn({ ...input, turnId: 'turn:one', generationId: 'gen:one' });
  const b = await many.runTurn({ ...input, turnId: 'turn:many', generationId: 'gen:many' });
  assert.equal(a.scatter.resourceCount, 1);
  assert.ok(b.scatter.resourceCount >= 1 && b.scatter.resourceCount <= 3);
  assert.deepEqual(
    a.published.packet.current.map((x) => [x.subjectId, x.predicate, x.value, x.status]),
    b.published.packet.current.map((x) => [x.subjectId, x.predicate, x.value, x.status]),
  );
  assert.deepEqual(
    a.published.packet.historical.map((x) => [x.subjectId, x.predicate, x.value, x.status]),
    b.published.packet.historical.map((x) => [x.subjectId, x.predicate, x.value, x.status]),
  );
  assert.deepEqual(
    a.published.packet.unresolved.map((x) => [x.subjectId, x.predicate, x.value, x.status]),
    b.published.packet.unresolved.map((x) => [x.subjectId, x.predicate, x.value, x.status]),
  );
});

test('Wave 11 binding reads the same selected deployment turn/generation and does not use fixtures', async () => {
  const { brain } = seeded();
  await brain.runTurn({
    chatId: 'chat:ember',
    turnId: 'turn:ui-a',
    generationId: 'gen:ui-a',
    query: 'Tell me about Mara and the Ember Tavern history',
    mode: 'retrieval',
  });
  await brain.runTurn({
    chatId: 'chat:ember',
    turnId: 'turn:ui-b',
    generationId: 'gen:ui-b',
    query: 'What happened to the Sun Blade?',
    mode: 'ambiguous',
  });
  const binding = createWave11LiveReceiptBinding(brain.hostBindings());
  assert.equal(binding.selection().turnId, 'turn:ui-b');
  assert.equal(binding.selection().generationId, 'gen:ui-b');
  assert.equal(binding.bridges.cognition.readGatherReceipt().turnId, 'turn:ui-b');
  assert.equal(binding.bridges.cognition.readContextSealReceipt().turnId, 'turn:ui-b');
  assert.equal(binding.bridges.promptPlan.readPromptPlanReadModel().generationId, 'gen:ui-b');
  assert.ok(binding.bridges.scene.readModel());
  brain.selectTurn('turn:ui-a');
  binding.refreshSelection();
  assert.equal(binding.selection().turnId, 'turn:ui-a');
  assert.equal(binding.bridges.cognition.readCognitiveChoiceReceipt().turnId, 'turn:ui-a');
  binding.destroy();
});
