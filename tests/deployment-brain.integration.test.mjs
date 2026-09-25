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
  const claims = brain.core.graph.allClaims();
  assert.ok(model.current.length > 0);
  assert.ok(claims.some((row) => row.predicate === 'state' && row.value === 'destroyed'));
  assert.ok(claims.some((row) => row.predicate === 'state' && row.value === 'intact' && ['HISTORICAL', 'SUPERSEDED'].includes(row.status)));
  assert.ok(model.unresolved.length >= 1);
  assert.equal(brain.diagnostics().remoteProviderRequired, false);
});


test('native Scene observation advances revision and exposes the narrative delta before cognition runs', () => {
  const brain = new DevelopmentDeploymentBrain({ resourceCount: 1 });
  brain.ingestLorebook(createGoldenDeploymentLorebook());
  const refs = brain.core.registry.activeRevisionIds();
  const before = brain.observeScene({
    chatId: 'chat:scene-delta',
    sourceRevisionId: refs[0],
    location: 'Ember Tavern',
    activeCast: ['Mara', 'Eris'],
    activeThreads: ['Find the Sun Blade'],
    objects: [{ objectId: 'Sun Blade', state: 'PRESENT', evidenceRefs: [refs[0]] }],
  });
  const after = brain.observeScene({
    chatId: 'chat:scene-delta',
    sourceRevisionId: refs[1] ?? refs[0],
    location: 'Ember Tavern Ruins',
    activeCast: ['Mara', 'Eris'],
    activeThreads: ['Determine the Sun Blade fate'],
    objects: [{ objectId: 'Sun Blade', state: 'UNCERTAIN', evidenceRefs: [refs[1] ?? refs[0]] }],
  });
  assert.equal(before.observationApplied, true);
  assert.equal(after.observationApplied, true);
  assert.ok(after.sceneRevision > before.sceneRevision);
  assert.equal(after.delta.fromRevision, before.sceneRevision);
  assert.equal(after.delta.toRevision, after.sceneRevision);
  assert.ok(after.delta.changedFields.location);
  assert.equal(after.location.location, 'Ember Tavern Ruins');
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
  assert.ok(
    result.published.candidateEnvelope.fusionReceipt.perChannelCounts.NATIVE_LORE_RUNTIME > 0,
    JSON.stringify({
      prepared: brain.loreChannel.prepared.get('Tell me about Mara and the Ember Tavern history'),
      channelReceipts: result.published.candidateEnvelope.metadata?.channelReceipts,
      channelErrors: result.published.candidateEnvelope.metadata?.channelErrors,
      runtimeResults: result.runtimeResults,
    }, null, 2),
  );
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
  assert.ok(result.jevProposal, JSON.stringify({ runtimeResults: result.runtimeResults, planning: result.planning }, null, 2));
  assert.equal(result.jevProposal.abstained, true);
  assert.equal(result.jevProposal.mutationAuthority, false);
  assert.equal(result.jevProposal.requiresOwnerPolicy, true);
  assert.equal(result.published.cognitiveChoiceReceipt.jev.considered, true);
  assert.equal(result.published.cognitiveChoiceReceipt.jev.abstained, true);
  const unresolved = brain.core.graph.unresolvedClaims().filter((row) => JSON.stringify(row).toLowerCase().includes('sun-blade'));
  assert.ok(unresolved.length >= 1);
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
  assert.equal(result.published.cognitiveChoiceReceipt.jev.unavailable, true, JSON.stringify(result.published.cognitiveChoiceReceipt.jev, null, 2));
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


test('sequential simple, retrieval and ambiguous turns dedupe rich fallback semantics before PromptPlan', async () => {
  const { brain } = seeded({ resourceCount: 1 });
  const simple = await brain.runTurn({
    chatId: 'chat:ember',
    turnId: 'turn:sequence-simple',
    generationId: 'gen:sequence-simple',
    query: 'Where are we?',
    mode: 'simple',
  });
  const retrieval = await brain.runTurn({
    chatId: 'chat:ember',
    turnId: 'turn:sequence-retrieval',
    generationId: 'gen:sequence-retrieval',
    query: 'Tell me about Mara and the Ember Tavern history',
    mode: 'retrieval',
  });
  const ambiguous = await brain.runTurn({
    chatId: 'chat:ember',
    turnId: 'turn:sequence-ambiguous',
    generationId: 'gen:sequence-ambiguous',
    query: 'What happened to the Sun Blade?',
    mode: 'ambiguous',
  });
  assert.equal(simple.delivery.ok, true);
  assert.equal(retrieval.delivery.ok, true);
  assert.equal(ambiguous.delivery.ok, true, JSON.stringify(ambiguous.delivery.failure ?? null));
  const semanticKeys = ambiguous.delivery.plan.sections.flatMap((section) => section.semanticManifest ?? []).map((entry) => entry.semanticKey);
  assert.equal(new Set(semanticKeys).size, semanticKeys.length);
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


test('Memory Wave 3 exact-evidence bridge is available without granting Core or Seal authority', () => {
  const { brain } = seeded();
  const input = {
    kind: 'MemoryExternalEvidenceMappingRequest',
    contractVersion: '1.0.0',
    ownerArtifactRef: {
      owner: 'SCENE_INTELLIGENCE',
      artifactId: 'scene-episode:ember:1',
      revision: 1,
      sourceRevisionSet: ['narrative:ember@1'],
      sceneRevision: 1,
    },
    externalEvidenceRef: 'scene-evidence:ember:1',
    observationState: 'OBSERVED',
    source: {
      sourceId: 'narrative:ember',
      sourceRevisionId: 'narrative:ember@1',
      exactContent: 'Mara and Eris stand in the Ember Tavern ruins while discussing the missing Sun Blade.',
      evidenceKind: 'NARRATIVE_EXPERIENCE',
      occurredAt: 1,
      worldRevision: 1,
      sceneRevision: 1,
      participants: ['Mara', 'Eris', 'Sun Blade', 'Ember Tavern'],
      knownBy: ['Mara', 'Eris'],
      perspective: 'WORLD',
      provenance: ['deployment-memory-bridge-test'],
    },
    revisionProof: {
      sourceRevisionId: 'narrative:ember@1',
      ownerArtifactRevision: 1,
      sceneRevision: 1,
    },
    provenanceRefs: ['scene-evidence:ember:1'],
  };
  const out = brain.admitMemoryEvidenceMapping(input);
  assert.equal(out.receipt.status, 'ADMITTED');
  assert.equal(out.evidence.exactContent, input.source.exactContent);
  assert.equal(out.evidence.sourceRevisionId, 'narrative:ember@1');
  assert.equal(out.authorityGranted, false);
  assert.equal(out.canonicalMutationAuthority, false);
  assert.equal(out.contextSealAuthority, false);
  const replay = brain.admitMemoryEvidenceMapping(input);
  assert.equal(replay.receipt.status, 'REPLAYED');
  assert.equal(replay.evidence.id, out.evidence.id);
});


test('deployment optional resource host feeds bounded coprocessor telemetry for Jev Sidecar and Vectoring controls', async () => {
  const brain = new DevelopmentDeploymentBrain({ resourceCount: 1 });
  const bindings = brain.hostBindings();
  assert.equal(bindings.coprocessorTelemetry, brain.coprocessorTelemetry);
  const configs = [
    { resourceId:'jev:telemetry', providerProfileId:'profile:jev:telemetry', providerId:'provider:jev:telemetry', modelId:'local-jev', workerId:'worker:jev:telemetry', kind:'DETERMINISTIC_LOCAL', capabilities:['SEMANTIC_JUDGMENT'] },
    { resourceId:'sidecar:telemetry', providerProfileId:'profile:sidecar:telemetry', providerId:'provider:sidecar:telemetry', modelId:'local-sidecar', workerId:'worker:sidecar:telemetry', kind:'DETERMINISTIC_LOCAL', capabilities:['STRUCTURED_EXTRACTION'] },
    { resourceId:'vector:telemetry', providerProfileId:'profile:vector:telemetry', providerId:'provider:vector:telemetry', modelId:'local-vector', workerId:'worker:vector:telemetry', kind:'DETERMINISTIC_LOCAL', capabilities:['RETRIEVAL','EMBED'] },
  ];
  for (const config of configs) {
    bindings.resourceHost.actions.addResource(config);
    await bindings.resourceHost.actions.connectResource(config.resourceId);
    const tested = await bindings.resourceHost.actions.testResource(config.resourceId);
    assert.equal(tested.result.ok, true);
  }
  const telemetry = bindings.coprocessorTelemetry.snapshot();
  assert.equal(telemetry.resources.configured, 3);
  assert.equal(telemetry.resources.testsPassed, 3);
  assert.ok(telemetry.resources.ready >= 3);
  assert.equal(telemetry.providerCalls.invoked, 0);
  assert.equal(brain.diagnostics().coprocessorTelemetry.totalEvents, telemetry.totalEvents);
  const model = bindings.resourceHost.read.resources();
  assert.equal(model.readyResourceCount, 3);
  assert.equal(model.nativePathRequired, false);
});

test('deployment host exports live resource controls, split Lore lifecycle, and selection-aware Memory reads', () => {
  const brain = new DevelopmentDeploymentBrain({ resourceCount: 1 });
  const bindings = brain.hostBindings();
  for (const key of ['listResources','connectResource','disconnectResource','testResource','acceptLorebook','runLoreStudy','readLoreStatus','readMemoryStatus']) {
    assert.equal(typeof bindings[key], 'function', key + ' binding missing');
  }
  assert.equal(bindings.listResources().resources.length, 0);

  const accepted = bindings.acceptLorebook({
    id: 'unrelated-live-lore',
    title: 'Unrelated Live Lore',
    entries: [
      { uid: 'archive', content: 'The Harbor Archive stores tide records.', metadata: { title: 'Harbor Archive', treePath: ['Places', 'Harbor'] } },
    ],
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.processed, false);
  assert.equal(accepted.retrievable, false);

  const studied = bindings.runLoreStudy({ scope: 'DUE' });
  assert.equal(studied.processed, true);
  assert.equal(studied.retrievable, true);
  assert.equal(studied.mappingCount, 1);
  assert.equal(studied.rawSourceOnlyCount + studied.semanticExtractionCount, 1);
  assert.ok(bindings.readLoreStatus());

  const memory = bindings.readMemoryStatus({ chatId: 'chat:unrelated', turnId: 'turn:unrelated', generationId: 'gen:unrelated' });
  assert.equal(memory.chatId, 'chat:unrelated');
  assert.equal(memory.turnId, 'turn:unrelated');
  assert.equal(memory.authorityGranted, false);
});
