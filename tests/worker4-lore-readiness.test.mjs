import test from 'node:test';
import assert from 'node:assert/strict';

import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';
import {LoreOwnerRetrievalChannel} from '../src/owner-knowledge-channels.js';
import {Area52NativeBrain} from '../src/native-brain.js';
import {
  WORKER4_SELECTED_CHAT,
  WORKER4_UNBOUND_CHAT,
  worker4SelectedLorebook,
  worker4LargeCurrentLorebook,
  worker4TemporalLorebook,
  worker4UnacceptedLorebook,
} from './fixtures/worker4-lore-readiness-fixtures.mjs';

function worker4Scene(sceneId, sceneRevision) {
  return {
    sceneId,
    sceneRevision,
    location: 'Harbor Gate',
    narrativeTime: 'day ' + sceneRevision,
    activeCast: ['Warden'],
    activeThreads: [],
    objects: [],
    sceneRelationship: null,
    sourceRevisionRefs: [],
    provenance: ['worker4-scene:' + sceneId + ':' + sceneRevision],
  };
}

function readySelectedService() {
  const service = new LoreIntelligenceService();
  const accepted = service.acceptLorebook(worker4SelectedLorebook());
  assert.equal(accepted.storyScope.state, 'BOUND');
  assert.deepEqual(accepted.storyScope.readLorebookIds, ['worker4-harbor-lore']);
  const studied = service.runStudy({scope: 'DUE'});
  assert.equal(studied.results.length, 2);
  const status = service.status({chatId: WORKER4_SELECTED_CHAT});
  assert.equal(status.entries.every((row) => row.operatorState === 'READY'), true);
  assert.equal(status.entries.every((row) => row.eligibleForStoryRetrieval === true), true);
  return service;
}

test('Worker 4: discovery alone does not grant study or story read authority', () => {
  const service = new LoreIntelligenceService();
  const discovered = service.recordHostDiscovery({
    chatId: WORKER4_SELECTED_CHAT,
    lorebookId: 'worker4-harbor-lore',
    title: 'Worker 4 Harbor Lore',
    discovery: {kind: 'SillyTavernLorebookDiscoveryReceipt', exactAuthoredSource: true},
  });
  assert.equal(discovered.discovered, true);
  assert.equal(discovered.acceptedForStudy, false);
  assert.equal(discovered.readAuthorized, false);
  const status = service.status({chatId: WORKER4_SELECTED_CHAT});
  assert.equal(status.storyScope.state, 'BOUND');
  assert.equal(status.storyScope.acceptedForStudy.length, 0);
  assert.equal(status.storyScope.readLorebookIds.length, 0);
  assert.equal(status.storyAuthorizedReady, 0);
});

test('Worker 4: accepted/current/retrieval-ready Lore is eligible only for the exact bound chat', () => {
  const service = readySelectedService();
  const selected = service.queryForStory({chatId: WORKER4_SELECTED_CHAT, query: 'Harbor Gate', intent: 'NARROW'});
  assert.equal(selected.status, 'ELIGIBLE');
  assert.ok(selected.nominations.length > 0);
  assert.ok(selected.sourceRevisionFence.length > 0);
  assert.ok(selected.candidateReceipts.length > 0);
  assert.equal(selected.candidateReceipts.every((row) => row.decision === 'ELIGIBLE'), true);
  assert.equal(selected.candidateReceipts.every((row) => row.reason === 'AUTHORIZED_CURRENT_RETRIEVAL_MATCH'), true);
  assert.equal(selected.candidateReceipts.every((row) => row.authorityScope.chatId === WORKER4_SELECTED_CHAT), true);
  assert.equal(selected.candidateReceipts.every((row) => row.sourceEntries.length > 0), true);
  assert.equal(selected.candidateReceipts.every((row) => row.sourceEntries.every((entry) =>
    entry.sourceId && entry.lorebookId && entry.uid && entry.sourceRevisionId
  )), true);
  assert.equal(JSON.stringify(selected.candidateReceipts).includes('Only Harbor Wardens may open the Harbor Gate.'), false);
  assert.equal(selected.rawLoreIncludedInDiagnostics, false);

  const imported = service.queryForStory({chatId: WORKER4_UNBOUND_CHAT, query: 'Harbor Gate', intent: 'NARROW'});
  assert.equal(imported.status, 'EXCLUDED');
  assert.equal(imported.reason, 'LORE_STORY_SCOPE_REQUIRED');
  assert.deepEqual(imported.nominations, []);
  assert.deepEqual(imported.sourceRevisionFence, []);
});

test('Worker 4: globally learned but unaccepted Lore cannot inherit another story read scope', () => {
  const service = readySelectedService();
  service.acceptLorebook(worker4UnacceptedLorebook());
  service.runStudy({scope: 'DUE'});
  const global = service.status();
  assert.equal(global.entries.find((row) => row.lorebookId === 'worker4-unaccepted-lore')?.operatorState, 'READY');

  const scoped = service.status({chatId: WORKER4_SELECTED_CHAT});
  const archive = scoped.entries.find((row) => row.lorebookId === 'worker4-unaccepted-lore');
  assert.equal(archive.acceptedForStudy, false);
  assert.equal(archive.authorizedForStory, false);
  assert.equal(archive.eligibleForStoryRetrieval, false);

  const packet = service.queryForStory({chatId: WORKER4_SELECTED_CHAT, query: 'Quartz Archive', intent: 'NARROW'});
  assert.equal(packet.nominations.length, 0);
  assert.ok(packet.exclusionReceipts.some((row) =>
    row.lorebookId === 'worker4-unaccepted-lore' && row.reason === 'LOREBOOK_NOT_ACCEPTED_FOR_STUDY'
  ));
});

test('Worker 4: changed source revision invalidates learned/retrieval currentness until the new revision is studied', () => {
  const service = readySelectedService();
  const before = service.queryForStory({chatId: WORKER4_SELECTED_CHAT, query: 'Harbor Gate', intent: 'NARROW'});
  const oldRevision = before.sourceRevisionFence.find((ref) => ref.includes(':gate@'));
  assert.ok(oldRevision);

  const changed = service.acceptLorebook(worker4SelectedLorebook({state: 'closed'}));
  assert.equal(changed.sourceRevisionChanged, true);
  assert.equal(changed.maintenancePerformed, true);
  const staleStatus = service.status({chatId: WORKER4_SELECTED_CHAT});
  const gate = staleStatus.entries.find((row) => row.uid === 'gate');
  assert.equal(gate.freshness, 'STALE_OR_UNLEARNED');
  assert.equal(gate.retrievalReady, false);
  assert.equal(gate.eligibleForStoryRetrieval, false);

  const staleQuery = service.queryForStory({chatId: WORKER4_SELECTED_CHAT, query: 'Harbor Gate', intent: 'NARROW'});
  assert.equal(staleQuery.sourceRevisionFence.includes(oldRevision), false);
  assert.ok(staleQuery.exclusionReceipts.some((row) =>
    row.uid === 'gate' && row.reason === 'SOURCE_REVISION_NOT_LEARNED_CURRENT'
  ));

  service.runStudy({scope: 'DUE'});
  const current = service.queryForStory({chatId: WORKER4_SELECTED_CHAT, query: 'Harbor Gate', intent: 'NARROW'});
  const nextRevision = current.sourceRevisionFence.find((ref) => ref.includes(':gate@'));
  assert.ok(nextRevision);
  assert.notEqual(nextRevision, oldRevision);
  assert.equal(current.candidateReceipts.some((row) =>
    row.sourceEntries.some((entry) => entry.uid === 'gate' && entry.sourceRevisionId === nextRevision)
  ), true);
});

test('Worker 4: removed authored entry cannot remain current or retrieval-ready', () => {
  const service = readySelectedService();
  const removed = service.acceptLorebook(worker4SelectedLorebook({includeRule: false}));
  assert.equal(removed.sourceRevisionChanged, true);
  const status = service.status({chatId: WORKER4_SELECTED_CHAT});
  const rule = status.entries.find((row) => row.uid === 'rule');
  assert.equal(rule.sourceState, 'REMOVED');
  assert.equal(rule.retrievalReady, false);
  assert.equal(rule.eligibleForStoryRetrieval, false);

  const packet = service.queryForStory({chatId: WORKER4_SELECTED_CHAT, query: 'Harbor Wardens', intent: 'NARROW'});
  assert.equal(packet.nominations.some((row) => row.drillback.some((source) => source.uid === 'rule')), false);
  assert.ok(packet.exclusionReceipts.some((row) => row.uid === 'rule' && row.reason === 'SOURCE_REMOVED'));
});

test('Worker 4: identical accepted snapshot reuses current study/index instead of rebuilding Lore', () => {
  const service = readySelectedService();
  const dueBefore = service.runtime.dueObligations().length;
  const repeat = service.acceptLorebook(worker4SelectedLorebook());
  assert.equal(repeat.sourceRevisionChanged, false);
  assert.equal(repeat.maintenancePerformed, false);
  assert.equal(repeat.maintenanceReason, 'NO_SOURCE_REVISION_CHANGE');
  assert.equal(repeat.dueStudyObligations, 0);
  assert.equal(service.runtime.dueObligations().length, dueBefore);
  const after = service.status({chatId: WORKER4_SELECTED_CHAT});
  assert.equal(after.entries.every((row) => row.operatorState === 'READY'), true);
});

test('Worker 4: 105 current entries stay current without repeated study or retrieval-index rebuild', () => {
  const service = new LoreIntelligenceService();
  const snapshot = worker4LargeCurrentLorebook({count: 105});
  const started = performance.now();
  const accepted = service.acceptLorebook(snapshot);
  const acceptedAt = performance.now();
  const study = service.runStudy({scope: 'DUE'});
  const studiedAt = performance.now();
  const status = service.status({chatId: WORKER4_SELECTED_CHAT});
  assert.equal(accepted.sourceRevisionChanged, true);
  assert.equal(study.results.length, 105);
  assert.equal(status.entries.length, 105);
  assert.equal(status.counts.READY, 105);
  assert.equal(status.entries.filter((row) => row.retrievalReady).length, 105);
  assert.equal(status.storyAuthorizedReady, 105);
  assert.equal(status.entries.every((row) => row.freshness === 'CURRENT'), true);
  assert.equal(status.entries.every((row) => row.eligibleForStoryRetrieval === true), true);
  assert.equal(service.runtime.dueObligations().length, 0);

  const noOpStudyStarted = performance.now();
  const noOpStudy = service.runStudy({scope: 'DUE'});
  const noOpStudyFinished = performance.now();
  assert.equal(noOpStudy.requested, 0);
  assert.equal(noOpStudy.maintenancePerformed, false);
  assert.equal(noOpStudy.maintenanceReason, 'NO_DUE_STUDY');
  assert.equal(service.runtime.dueObligations().length, 0);

  const repeatStarted = performance.now();
  const repeat = service.acceptLorebook(snapshot);
  const repeatFinished = performance.now();
  assert.equal(repeat.sourceRevisionChanged, false);
  assert.equal(repeat.maintenancePerformed, false);
  assert.equal(repeat.maintenanceReason, 'NO_SOURCE_REVISION_CHANGE');
  assert.equal(repeat.dueStudyObligations, 0);
  assert.equal(service.runtime.dueObligations().length, 0);

  const learnedBeforeEdit = new Map(status.entries.map((row) => [row.sourceId, row.learnedRevisionId]));
  const changedSnapshot = structuredClone(snapshot);
  changedSnapshot.entries[51].content += ' Revised marker W4-52-R2.';
  const incrementalStarted = performance.now();
  const incrementalAccept = service.acceptLorebook(changedSnapshot);
  const incrementalAcceptedAt = performance.now();
  assert.equal(incrementalAccept.sourceRevisionChanged, true);
  assert.equal(incrementalAccept.dueStudyObligations, 1);
  assert.equal(service.runtime.dueObligations().length, 1);

  const staleAfterSingleEdit = service.status({chatId: WORKER4_SELECTED_CHAT});
  assert.equal(staleAfterSingleEdit.entries.filter((row) => row.freshness === 'CURRENT').length, 104);
  assert.equal(staleAfterSingleEdit.entries.filter((row) => row.retrievalReady).length, 104);
  const editedRow = staleAfterSingleEdit.entries.find((row) => row.uid === '52');
  assert.equal(editedRow.freshness, 'STALE_OR_UNLEARNED');
  assert.equal(editedRow.retrievalReady, false);
  for (const row of staleAfterSingleEdit.entries.filter((entry) => entry.uid !== '52')) {
    assert.equal(row.learnedRevisionId, learnedBeforeEdit.get(row.sourceId), 'unrelated learned revisions must be retained');
  }

  const incrementalStudy = service.runStudy({scope: 'DUE'});
  const incrementalStudiedAt = performance.now();
  assert.equal(incrementalStudy.results.length, 1);
  assert.equal(service.runtime.dueObligations().length, 0);
  const afterSingleEdit = service.status({chatId: WORKER4_SELECTED_CHAT});
  assert.equal(afterSingleEdit.counts.READY, 105);
  assert.equal(afterSingleEdit.entries.every((row) => row.freshness === 'CURRENT' && row.retrievalReady), true);

  const persisted = service.snapshot();
  const snapshotCharacters = JSON.stringify(persisted).length;
  const snapshotCharactersBySection = Object.fromEntries(
    ['runtime', 'multiResolution', 'hierarchy', 'ontology', 'storyAuthority']
      .map((key) => [key, JSON.stringify(persisted[key] ?? null).length]),
  );
  const hierarchyCharactersBySection = Object.fromEntries(
    ['hierarchy', 'summaryRegistry', 'builder', 'retrievalIndex']
      .map((key) => [key, JSON.stringify(persisted.hierarchy?.[key] ?? null).length]),
  );
  const summarySnapshot = persisted.hierarchy?.summaryRegistry ?? {};
  const currentSummaryIds = new Set((summarySnapshot.currentByScope || []).map(([, id]) => id));
  const currentSummaries = (summarySnapshot.summaries || []).filter((row) => currentSummaryIds.has(row.id));
  const historicalSummaries = (summarySnapshot.summaries || []).filter((row) => !currentSummaryIds.has(row.id));
  const summaryRetention = {
    totalCount: (summarySnapshot.summaries || []).length,
    currentCount: currentSummaries.length,
    historicalCount: historicalSummaries.length,
    currentCharacters: JSON.stringify(currentSummaries).length,
    historicalCharacters: JSON.stringify(historicalSummaries).length,
    maxCurrentSummaryCharacters: currentSummaries.reduce((max, row) => Math.max(max, JSON.stringify(row).length), 0),
    maxHistoricalSummaryCharacters: historicalSummaries.reduce((max, row) => Math.max(max, JSON.stringify(row).length), 0),
  };
  assert.equal(persisted.hierarchy.retrievalIndex.recordsIncluded, false);
  assert.equal(persisted.hierarchy.retrievalIndex.records.length, 0);
  assert.equal((persisted.hierarchy.builder.sessions || []).some(([, session]) => session?.state === 'COMPLETED'), false);
  const reloadStarted = performance.now();
  const restored = LoreIntelligenceService.fromSnapshot(persisted);
  const restoredStatus = restored.status({chatId: WORKER4_SELECTED_CHAT});
  const reloadFinished = performance.now();
  assert.equal(restoredStatus.counts.READY, 105);
  assert.equal(restoredStatus.storyAuthorizedReady, 105);
  assert.equal(restored.runtime.dueObligations().length, 0);
  const reloadNoOp = restored.runStudy({scope: 'DUE'});
  assert.equal(reloadNoOp.requested, 0);
  assert.equal(reloadNoOp.maintenancePerformed, false);

  console.log('WORKER4_LORE_105_METRIC ' + JSON.stringify({
    entries: 105,
    initialAcceptMs: Number((acceptedAt - started).toFixed(2)),
    studyAndIndexMs: Number((studiedAt - acceptedAt).toFixed(2)),
    noOpDueStudyMs: Number((noOpStudyFinished - noOpStudyStarted).toFixed(2)),
    identicalReacceptMs: Number((repeatFinished - repeatStarted).toFixed(2)),
    singleEntryAcceptMs: Number((incrementalAcceptedAt - incrementalStarted).toFixed(2)),
    singleEntryRestudyAndIndexMs: Number((incrementalStudiedAt - incrementalAcceptedAt).toFixed(2)),
    reloadMs: Number((reloadFinished - reloadStarted).toFixed(2)),
    retainedCurrentAfterSingleEdit: 104,
    restudiedEntriesAfterSingleEdit: incrementalStudy.results.length,
    retainedCurrentAfterReload: restoredStatus.counts.READY,
    snapshotCharacters,
    snapshotCharactersBySection,
    hierarchyCharactersBySection,
    summaryRetention,
    dueAfterStudy: service.runtime.dueObligations().length,
    dueAfterReload: restored.runtime.dueObligations().length,
    noOpStudyMaintenancePerformed: noOpStudy.maintenancePerformed,
    repeatMaintenancePerformed: repeat.maintenancePerformed,
    reloadMaintenancePerformed: reloadNoOp.maintenancePerformed,
  }));
});

test('Worker 4: exact-chat eligible Lore survives Native Brain retrieval through Gather while unbound chat stays excluded', async () => {
  const service = readySelectedService();
  const brain = new Area52NativeBrain({loreInterface: service.brainInterface()});
  const prepared = await brain.prepareTurn({
    chatId: WORKER4_SELECTED_CHAT,
    turnId: 'worker4:gather:1',
    generationId: 'worker4:gather-gen:1',
    query: 'What is true about the Harbor Gate?',
    intent: 'CURRENT',
    scene: worker4Scene('worker4-harbor', 1),
    executionLabel: 'DETERMINISTIC',
    budgetTokens: 8192,
  });
  assert.equal(prepared.loreSync.status, 'SYNCED');
  assert.ok(prepared.loreSync.nominationCount > 0);
  assert.equal(prepared.loreSync.authorityScope.chatId, WORKER4_SELECTED_CHAT);
  assert.ok(prepared.loreSync.candidateReceipts.length > 0);
  assert.ok(prepared.gatherReceipt);
  assert.equal(prepared.gatherReceipt.authorityGranted, false);
  assert.equal(prepared.gatherReceipt.admittedResultIds.some((id) => id.includes('owner-lore')), true);
  assert.equal(prepared.gatherReceipt.rejectedResultIds.some((id) => id.includes('owner-lore')), false);
  const loreNominations = (prepared.candidateEnvelope?.candidates || [])
    .flatMap((candidate) => candidate.channelNominations || [])
    .filter((nomination) => nomination.channelId === 'OWNER_LORE');
  assert.ok(loreNominations.length > 0);
  assert.ok(prepared.truthAssessment, 'Truth/Precision publication must produce a truth assessment before Gather');
  assert.ok(prepared.contextSealReceipt, 'Gather output must be sealed before PromptPlan construction');
  assert.equal(prepared.loreSync.sourceRevisionFence.every((ref) => prepared.contextSealReceipt.sourceRevisionIds.includes(ref)), true);
  const loreSection = prepared.promptPlan?.sections?.find((row) => row.slot === 'RELEVANT_LORE');
  assert.ok(loreSection, 'PromptPlan must expose an explicit RELEVANT_LORE decision');
  assert.notEqual(loreSection.representation, 'OMITTED', 'small eligible Lore should fit the deterministic 8192-token fixture budget');
  assert.equal(prepared.loreSync.sourceRevisionFence.every((ref) => prepared.promptPlan.sourceRevisionDependencies.includes(ref)), true);
  assert.ok(prepared.promptDeliveryReceipt, 'internal prompt delivery must emit its receipt');
  // This proves deterministic Area-52 delivery planning, not installed SillyTavern host delivery.
  // Fusion is not the owner provenance surface. The owner receipt above carries
  // the bounded entry/revision/authority metadata; Gather proves admission by result id.

  const unboundBrain = new Area52NativeBrain({loreInterface: service.brainInterface()});
  const unbound = await unboundBrain.prepareTurn({
    chatId: WORKER4_UNBOUND_CHAT,
    turnId: 'worker4:gather:unbound',
    generationId: 'worker4:gather-gen:unbound',
    query: 'What is true about the Harbor Gate?',
    intent: 'CURRENT',
    scene: worker4Scene('worker4-unbound-harbor', 1),
    executionLabel: 'DETERMINISTIC',
  });
  assert.equal(unbound.loreSync.status, 'EXCLUDED');
  assert.equal(unbound.loreSync.reason, 'LORE_STORY_SCOPE_REQUIRED');
  assert.equal(unbound.gatherReceipt.admittedResultIds.some((id) => id.includes('owner-lore')), false);
});

test('Worker 4: live Lore owner channel forwards exact chat scope and retains bounded provenance metadata', () => {
  const service = readySelectedService();
  const evidence = [];
  const channel = new LoreOwnerRetrievalChannel({
    getInterface: () => service.brainInterface(),
    evidenceSink: (row) => evidence.push(row),
  });
  channel.beginTurn({
    selection: {
      chatId: WORKER4_SELECTED_CHAT,
      turnId: 'turn:worker4',
      generationId: 'gen:worker4',
      correlationId: 'corr:worker4',
    },
  });
  const producerPacket = service.queryForStory({
    chatId: WORKER4_SELECTED_CHAT,
    query: 'Harbor Gate',
    intent: 'NARROW',
    intentId: 'intent:worker4',
  });
  const producerRanks = new Set(producerPacket.nominations.map((row) => row.nomination.normalizedRank));
  const rows = channel.retrieve({
    intentId: 'intent:worker4',
    intentKind: 'NARROW',
    query: 'Harbor Gate',
  }, {worldRevision: 1, sceneRevision: 2});
  assert.ok(rows.length > 0);
  assert.ok(evidence.length > 0);
  assert.equal(rows.every((row) => producerRanks.has(row.normalizedRank)), true);
  assert.equal(rows.every((row) => row.metadata.retrievalRankAuthority === false), true);
  assert.equal(rows.every((row) => row.metadata.producerNormalizedRank === row.normalizedRank), true);
  assert.equal(rows.every((row) => row.sourceRevisionRefs.length > 0), true);
  assert.equal(rows.every((row) => row.evidenceRefs.length > 0), true);
  assert.equal(rows.every((row) => row.metadata.authorityScope.chatId === WORKER4_SELECTED_CHAT), true);
  assert.equal(rows.every((row) => row.metadata.authorityDecision === 'ELIGIBLE'), true);
  const receipt = channel.receipt();
  assert.equal(receipt.status, 'SYNCED');
  assert.equal(receipt.authorityScope.chatId, WORKER4_SELECTED_CHAT);
  assert.ok(receipt.candidateReceipts.length > 0);
  assert.equal(receipt.rawLoreIncluded, false);

  const unbound = new LoreOwnerRetrievalChannel({getInterface: () => service.brainInterface()});
  unbound.beginTurn({selection: {chatId: WORKER4_UNBOUND_CHAT}});
  const blocked = unbound.retrieve({intentId: 'intent:unbound', intentKind: 'NARROW', query: 'Harbor Gate'});
  assert.deepEqual(blocked, []);
  assert.equal(unbound.receipt().status, 'EXCLUDED');
  assert.equal(unbound.receipt().reason, 'LORE_STORY_SCOPE_REQUIRED');

  const missing = new LoreOwnerRetrievalChannel({getInterface: () => service.brainInterface()});
  missing.beginTurn({selection: {}});
  const missingScope = missing.retrieve({intentId: 'intent:missing', intentKind: 'NARROW', query: 'Harbor Gate'});
  assert.deepEqual(missingScope, []);
  assert.equal(missing.receipt().status, 'EXCLUDED');
  assert.equal(missing.receipt().reason, 'LORE_STORY_SCOPE_REQUIRED');
  assert.equal(missing.receipt().queried, false);
});


test('Worker 4: temporal and ambiguous Lore semantics survive drilldown and owner admission', () => {
  const service = new LoreIntelligenceService();
  service.acceptLorebook(worker4TemporalLorebook());
  const study = service.runStudy({scope: 'DUE'});
  assert.equal(study.results.length, 3);

  const current = service.queryForStory({
    chatId: WORKER4_SELECTED_CHAT,
    query: 'Tavern Fire',
    intent: 'NARROW',
  });
  const currentEntry = current.candidateReceipts
    .flatMap((row) => row.sourceEntries || [])
    .find((row) => row.uid === 'current-tavern');
  assert.equal(currentEntry?.truthStatusHint, 'CURRENT');

  const historical = service.queryForStory({
    chatId: WORKER4_SELECTED_CHAT,
    query: 'Historical Blade Fate',
    intent: 'NARROW',
  });
  const historicalEntry = historical.candidateReceipts
    .flatMap((row) => row.sourceEntries || [])
    .find((row) => row.uid === 'historical-blade');
  assert.equal(historicalEntry?.truthStatusHint, 'HISTORICAL');

  const ambiguous = service.queryForStory({
    chatId: WORKER4_SELECTED_CHAT,
    query: 'Ambiguous Blade Fate',
    intent: 'NARROW',
  });
  const ambiguousEntry = ambiguous.candidateReceipts
    .flatMap((row) => row.sourceEntries || [])
    .find((row) => row.uid === 'ambiguous-blade');
  assert.equal(ambiguousEntry?.truthStatusHint, 'UNRESOLVED');

  const evidence = [];
  const channel = new LoreOwnerRetrievalChannel({
    getInterface: () => service.brainInterface(),
    evidenceSink: (row) => evidence.push(row),
  });
  channel.beginTurn({selection: {chatId: WORKER4_SELECTED_CHAT}});
  const historicalRows = channel.retrieve({
    intentId: 'intent:worker4:historical',
    intentKind: 'NARROW',
    query: 'Historical Blade Fate',
  });
  const historicalNomination = historicalRows.find((row) => row.metadata?.uid === 'historical-blade');
  const historicalEvidence = evidence.find((row) => row.loreRef?.uid === 'historical-blade');
  assert.equal(historicalNomination?.truthStatusHint, 'HISTORICAL');
  assert.equal(historicalEvidence?.temporalStatus, 'HISTORICAL');

  channel.beginTurn({selection: {chatId: WORKER4_SELECTED_CHAT}});
  const ambiguousRows = channel.retrieve({
    intentId: 'intent:worker4:ambiguous',
    intentKind: 'NARROW',
    query: 'Ambiguous Blade Fate',
  });
  const ambiguousNomination = ambiguousRows.find((row) => row.metadata?.uid === 'ambiguous-blade');
  const ambiguousEvidence = evidence.find((row) => row.loreRef?.uid === 'ambiguous-blade');
  assert.equal(ambiguousNomination?.truthStatusHint, 'UNRESOLVED');
  assert.equal(ambiguousEvidence?.temporalStatus, 'UNRESOLVED');
});

test('Worker 4: bounded operator read model keeps Lore lifecycle stages distinct without raw canon', () => {
  const service = readySelectedService();
  service.queryForStory({chatId: WORKER4_SELECTED_CHAT, query: 'Harbor Gate', intent: 'NARROW'});
  const read = service.operatorReadModel({chatId: WORKER4_SELECTED_CHAT, maxEntries: 1, maxReceipts: 4});
  assert.equal(read.kind, 'LoreOperatorReadModel');
  assert.equal(read.entryCountTotal, 2);
  assert.equal(read.entries.length, 1);
  assert.equal(read.entriesTruncated, true);
  assert.equal(read.rawLoreIncluded, false);
  assert.equal(read.entries[0].lifecycle.discoveredForStory, true);
  assert.equal(read.entries[0].lifecycle.acceptedForStudy, true);
  assert.equal(read.entries[0].lifecycle.studiedCurrent, true);
  assert.equal(read.entries[0].lifecycle.retrievalReady, true);
  assert.equal(read.entries[0].lifecycle.selectedChatAuthorized, true);
  assert.equal(read.entries[0].lifecycle.eligibleForNomination, true);
  assert.equal(read.entries[0].lifecycle.producerNomination, 'NOMINATED');
  assert.equal(read.entries[0].lifecycle.truthPrecision, 'DOWNSTREAM_NOT_OBSERVED_BY_LORE');
  assert.equal(read.entries[0].lifecycle.gather, 'DOWNSTREAM_NOT_OBSERVED_BY_LORE');
  assert.equal(read.entries[0].lifecycle.contextSeal, 'DOWNSTREAM_NOT_OBSERVED_BY_LORE');
  assert.equal(read.entries[0].lifecycle.promptPlan, 'DOWNSTREAM_NOT_OBSERVED_BY_LORE');
  assert.equal(read.entries[0].lifecycle.hostDelivery, 'DOWNSTREAM_NOT_OBSERVED_BY_LORE');
  assert.equal(JSON.stringify(read).includes('Only Harbor Wardens may open the Harbor Gate.'), false);
  assert.deepEqual(read.entries[0].treePath, ['Harbor', 'Places']);
});

test('Worker 4: unavailable and degraded Lore owners fail observably without fabricating candidates', () => {
  const unavailable = new LoreOwnerRetrievalChannel({getInterface: () => null});
  unavailable.beginTurn({selection: {chatId: WORKER4_SELECTED_CHAT}});
  assert.deepEqual(unavailable.retrieve({intentId: 'intent:missing-owner', intentKind: 'NARROW', query: 'Harbor Gate'}), []);
  assert.equal(unavailable.receipt().status, 'NOT_ATTACHED');
  assert.equal(unavailable.receipt().nominationCount, 0);

  const degraded = new LoreOwnerRetrievalChannel({
    getInterface: () => ({
      query: () => {
        const error = new Error('LORE_SOURCE_UNAVAILABLE');
        error.code = 'LORE_SOURCE_UNAVAILABLE';
        throw error;
      },
    }),
  });
  degraded.beginTurn({selection: {chatId: WORKER4_SELECTED_CHAT}});
  assert.throws(
    () => degraded.retrieve({intentId: 'intent:degraded-owner', intentKind: 'NARROW', query: 'Harbor Gate'}),
    /LORE_SOURCE_UNAVAILABLE/,
  );
  assert.equal(degraded.receipt().status, 'DEGRADED');
  assert.equal(degraded.receipt().nominationCount, 0);
  assert.deepEqual(degraded.receipt().sourceRevisionFence, []);
});

test('Lean retrievalEligibility() equals the matching status() fields for every entry, chat and state (per-turn hydration read)', () => {
  const pick = (row) => ({sourceId: row.sourceId, lorebookId: row.lorebookId, uid: row.uid, sourceRevisionId: row.sourceRevisionId,
    sourceState: row.sourceState, freshness: row.freshness, retrievalReady: row.retrievalReady, eligibleForStoryRetrieval: row.eligibleForStoryRetrieval});
  const service = readySelectedService();
  service.acceptLorebook(worker4UnacceptedLorebook());
  service.runStudy({scope: 'DUE'});
  const check = (label) => {
    for (const chatId of [WORKER4_SELECTED_CHAT, WORKER4_UNBOUND_CHAT, null]) {
      const lean = service.retrievalEligibility({chatId}).entries;
      assert.deepEqual(lean, service.status({chatId}).entries.map(pick), label + ' / ' + chatId);
      assert.deepEqual(service.brainInterface().retrievalEligibility({chatId}).entries, lean, 'exposed through the brain interface');
    }
  };
  check('ready + unaccepted');
  const scoped = service.retrievalEligibility({chatId: WORKER4_SELECTED_CHAT}).entries;
  assert.ok(scoped.some((row) => row.eligibleForStoryRetrieval === true) && scoped.some((row) => row.eligibleForStoryRetrieval === false), 'both outcomes present');
  service.acceptLorebook(worker4SelectedLorebook({state: 'closed'}));
  check('stale revision');
  assert.equal(service.retrievalEligibility({chatId: WORKER4_SELECTED_CHAT}).entries.find((row) => row.uid === 'gate').eligibleForStoryRetrieval, false);
  service.runStudy({scope: 'DUE'});
  check('restudied');
});

test('Per-source representation index returns exactly what a full scan returns (before and after edits and restore)', async () => {
  const {LoreRepresentationRegistry} = await import('../src/lore-representation-registry.js');
  const service = readySelectedService();
  service.acceptLorebook(worker4LargeCurrentLorebook());
  service.runStudy({scope: 'DUE'});
  const registry = service.multiResolution.registry, sources = service.runtime.registry;
  const reference = (reg, sourceId, metadataOnly) => {
    const source = sources.currentRevision(sourceId, {allowMissing: true});
    return [...reg.representations.values()]
      .filter((row) => row.sourceId === sourceId && row.state === 'CURRENT' && source && source.state !== 'REMOVED' && row.sourceRevisionId === source.id)
      .map((row) => metadataOnly ? {id: row.id, profile: row.profile, capCharacters: row.capCharacters, size: structuredClone(row.size), sourceRevisionId: row.sourceRevisionId, representationRevision: row.representationRevision, retentionReceipt: {status: row.retentionReceipt.status}} : structuredClone(row))
      .sort((a, b) => a.profile.localeCompare(b.profile) || (a.capCharacters || 0) - (b.capCharacters || 0));
  };
  const check = (reg, label) => {
    const ids = [...new Set([...reg.representations.values()].map((row) => row.sourceId))];
    assert.ok(ids.length > 2, 'several sources');
    for (const sourceId of [...ids, 'missing-source']) for (const metadataOnly of [false, true]) {
      assert.deepEqual(reg.activeForSource(sourceId, sources, {metadataOnly}), reference(reg, sourceId, metadataOnly), label + ' ' + sourceId);
    }
  };
  check(registry, 'studied');
  assert.ok([...registry.representations.values()].some((row) => row.state === 'CURRENT'));
  service.acceptLorebook(worker4SelectedLorebook({state: 'closed'}));
  check(registry, 'stale source, not yet restudied');
  service.runStudy({scope: 'DUE'});
  check(registry, 'restudied (new rows appended)');
  const restored = new LoreRepresentationRegistry(registry.snapshot());
  check(restored, 'restored');
});

test('Lore owner channel stops at maxCandidates: same kept nominations, evidence only for kept ones, bounded-out count reported', () => {
  const groups = 3, perGroup = 40;
  const packet = {kind: 'LoreBrainRetrievalPacket', contractVersion: 1, status: 'ELIGIBLE', reason: 'AUTHORIZED_CURRENT_RETRIEVAL_MATCH',
    storyScope: {chatId: 'chat:cap', state: 'BOUND', acceptedForStudy: [], readLorebookIds: ['book']}, sourceRevisionFence: [], candidateReceipts: [], exclusionReceipts: [],
    nominations: Array.from({length: groups}, (_, g) => ({
      nomination: {candidateId: 'c' + g, normalizedRank: 1 - g / 10, rankSignals: {}},
      drillback: Array.from({length: perGroup}, (_, i) => ({sourceId: `s${g}-${i}`, sourceRevisionId: `s${g}-${i}@1`, lorebookId: 'book', uid: `u${g}-${i}`, exactAuthoredText: `Entry ${g}-${i} text.`})),
    }))};
  packet.sourceRevisionFence = packet.nominations.flatMap((row) => row.drillback.map((s) => s.sourceRevisionId));
  const owner = {query: () => structuredClone(packet), queryScoped: () => structuredClone(packet)};
  const run = (maxCandidates) => {
    const evidence = [];
    const channel = new LoreOwnerRetrievalChannel({getInterface: () => owner, evidenceSink: (row) => evidence.push(row), maxCandidates});
    const rows = channel.retrieve({intentId: 'i', intentKind: 'NARROW', query: 'q'}, {chatId: 'chat:cap'});
    return {rows, evidence, receipt: channel.receipt()};
  };
  const capped = run(48), unbounded = run(4096);
  assert.equal(unbounded.rows.length, groups * perGroup, 'precondition: fan-out exceeds the cap');
  assert.equal(capped.rows.length, 48);
  assert.deepEqual(capped.rows.map((row) => row.nominationId), unbounded.rows.slice(0, 48).map((row) => row.nominationId), 'kept set equals what the registry kept before');
  assert.equal(capped.evidence.length, 48, 'evidence only for kept nominations');
  assert.deepEqual(capped.rows.map((row) => row.metadata.knowledgeEvidenceId), capped.evidence.map((row) => row.evidenceId));
  assert.equal(capped.receipt.nominationCount, 48);
  assert.equal(capped.receipt.boundedOutCount, groups * perGroup - 48);
  assert.equal(unbounded.receipt.boundedOutCount, 0);
});

test('Packet summaries filtered before cloning equal the old clone-then-filter result (story and brain queries)', () => {
  const service = readySelectedService();
  service.acceptLorebook(worker4LargeCurrentLorebook());
  service.runStudy({scope: 'DUE'});
  const all = service.summarySurface().summaries;
  assert.ok(all.length > 1, 'precondition: several summaries');
  let nonEmpty = 0;
  for (const query of ['Harbor Gate', 'Warden', 'archive ledger', 'nothing-matches-this']) {
    const story = service.queryForStory({chatId: WORKER4_SELECTED_CHAT, query, intent: 'AUTO'});
    const fence = story.sourceRevisionFence;
    assert.deepEqual(story.summaries, all.filter((s) => s.sourceRevisionRefs.some((r) => fence.includes(r)) && s.sourceRevisionRefs.every((r) => fence.includes(r))), 'story ' + query);
    const brain = service.queryForBrain({query, intent: 'AUTO'});
    assert.deepEqual(brain.summaries, all.filter((s) => s.sourceRevisionRefs.some((r) => brain.sourceRevisionFence.includes(r))), 'brain ' + query);
    nonEmpty += story.summaries.length > 0 ? 1 : 0;
  }
  assert.ok(nonEmpty > 0, 'at least one query returns summaries');
});

test('includeNavigation:false omits only summaries, conflicts and communities; the Lore channel output is unchanged by it', () => {
  const service = readySelectedService();
  service.acceptLorebook(worker4LargeCurrentLorebook());
  service.runStudy({scope: 'DUE'});
  const strip = ({summaries, conflicts, thematicCommunities, navigationOmitted, ...rest}) => rest;
  for (const query of ['Harbor Gate', 'Warden']) {
    const full = service.queryForStory({chatId: WORKER4_SELECTED_CHAT, query, intent: 'AUTO', intentId: 'i1'});
    const lean = service.queryForStory({chatId: WORKER4_SELECTED_CHAT, query, intent: 'AUTO', intentId: 'i1', includeNavigation: false});
    assert.equal(full.navigationOmitted, false); assert.equal(lean.navigationOmitted, true);
    assert.deepEqual([lean.summaries, lean.conflicts, lean.thematicCommunities], [[], [], []]);
    assert.deepEqual(strip(lean), strip(full), query);
  }
  const run = (wrap) => {
    const channel = new LoreOwnerRetrievalChannel({getInterface: () => wrap(service.brainInterface())});
    return channel.retrieve({intentId: 'i2', intentKind: 'AUTO', query: 'Harbor Gate'}, {chatId: WORKER4_SELECTED_CHAT});
  };
  const withFlag = run((b) => b);
  const ignoringFlag = run((b) => ({...b, queryScoped: ({includeNavigation, ...request}) => b.queryScoped(request)}));
  assert.ok(withFlag.length > 0);
  assert.deepEqual(withFlag, ignoringFlag, 'channel nominations identical whether or not the owner honours the flag');
});

test('Read-only artifact views in the index build, truth hints and ontology give identical results and never alter stored artifacts', () => {
  const service = readySelectedService();
  service.acceptLorebook(worker4LargeCurrentLorebook());
  service.acceptLorebook(worker4TemporalLorebook());
  service.runStudy({scope: 'DUE'});
  const store = service.runtime.store;
  const storedBefore = JSON.stringify([...store.artifacts.entries()]);
  const capture = () => {
    const ontology = service.ontology.rebuild();
    service.hierarchy.refreshRetrieval();
    const index = service.hierarchy.retrievalIndex;
    const hints = service.runtime.registry.listEntries({includeRemoved: false}).map((e) => [e.sourceId, service.brainInterface().sourceTruthHint(e.sourceId)]);
    return JSON.parse(JSON.stringify({ontology, records: [...index.records.entries()], sourceRecordIds: [...index.sourceRecordIds.entries()], hints}));
  };
  const readOnly = capture();
  const saved = store.artifactsForLearnedRevisionReadOnly;
  store.artifactsForLearnedRevisionReadOnly = undefined; // forces the cloning path everywhere
  try { assert.deepEqual(capture(), readOnly); } finally { store.artifactsForLearnedRevisionReadOnly = saved; }
  assert.ok(readOnly.records.length > 3 && readOnly.hints.some(([, h]) => h?.status === 'UNRESOLVED' || h?.status === 'HISTORICAL'), 'non-trivial corpus with temporal hints');
  assert.equal(JSON.stringify([...store.artifacts.entries()]), storedBefore, 'stored artifacts untouched');
});

test('activeIdsForSource equals activeForSource ids; acceptance lists exactly each source\'s stale representations', () => {
  const service = readySelectedService();
  service.acceptLorebook(worker4LargeCurrentLorebook());
  service.runStudy({scope: 'DUE'});
  const reg = service.multiResolution.registry, sources = service.runtime.registry;
  const ids = [...new Set([...reg.representations.values()].map((row) => row.sourceId))];
  for (const sourceId of [...ids, 'missing']) assert.deepEqual(reg.activeIdsForSource(sourceId, sources), reg.activeForSource(sourceId, sources).map((row) => row.id));
  // The old per-result rule, applied to the exact stale ids the acceptance computed, is the expected value (order included).
  let staleIds = null; const refresh = service.multiResolution.refreshFreshness.bind(service.multiResolution);
  service.multiResolution.refreshFreshness = (...args) => (staleIds = refresh(...args));
  const receipt = service.acceptLorebook(worker4SelectedLorebook({state: 'closed'}));
  assert.ok(staleIds && staleIds.length > 0, 'precondition: the edit made representations stale');
  for (const change of receipt.changes) {
    assert.deepEqual(change.invalidatedRepresentationIds, staleIds.filter((id) => reg.get(id)?.sourceId === change.sourceId), change.sourceId);
  }
  assert.ok(receipt.changes.some((c) => c.invalidatedRepresentationIds.length > 0));
});

// Stall work (closure final pass): yielding, fenced rebuilds that publish atomically; nothing stale served as current.
const indexView = (index) => JSON.parse(JSON.stringify({
  revision: index.revision, key: index.builtResolutionKey, records: [...index.records.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  inverted: [...index.inverted.entries()].map(([k, v]) => [k, [...v].sort()]).sort((a, b) => a[0].localeCompare(b[0])),
  sources: [...index.sourceRecordIds.entries()].sort(), summaries: [...index.summaryRecordIds.entries()].sort(),
}));
async function goldenService() {
  const {createGoldenDeploymentLorebook} = await import('../src/deployment/brain.js');
  const service = new LoreIntelligenceService();
  const book = {...createGoldenDeploymentLorebook(), chatId: 'chat:fence'};
  service.acceptLorebook(book);
  service.runStudy({scope: 'DUE'});
  return {service, book, chatId: 'chat:fence'};
}

test('buildAsync publishes exactly the index build() produces, and a query mid-build sees the previous complete index', async () => {
  const {service} = await goldenService();
  const index = service.hierarchy.retrievalIndex;
  const before = indexView(index);
  service.hierarchy.refreshRetrieval();
  const syncView = indexView(index);
  let midQuery = null, yields = 0;
  const result = await service.hierarchy.refreshRetrievalYielding({sliceSize: 1, yieldToHost: async () => {
    yields += 1;
    if (yields === 2) midQuery = {revision: index.revision, records: index.records.size, nominations: index.query({query: 'Sun Blade', intent: 'NARROW'}).nominations.length};
  }});
  assert.equal(result.status, 'PUBLISHED'); assert.ok(yields > 3, 'the build yielded to the host');
  assert.deepEqual(indexView(index), syncView, 'identical to the synchronous build');
  assert.deepEqual(before.records.map(([id]) => id), syncView.records.map(([id]) => id));
  assert.equal(midQuery.revision, syncView.revision); assert.equal(midQuery.records, syncView.records.length, 'no partial index was ever visible');
  assert.ok(midQuery.nominations > 0);
});

test('a fence that moves during the build blocks publication; a build that keeps being superseded leaves the fenced old index serving', async () => {
  const {service, book} = await goldenService();
  const index = service.hierarchy.retrievalIndex;
  const oldRevision = index.revision;
  // Every host turn moves the resolution fence: study one due obligation (a new learned revision) if there is one, otherwise
  // edit the next source (its learned revision stops being current). Re-editing an already-excluded source would not move it.
  const order = ['mara', 'eris', 'fire', 'tavern-intact', 'blade-report-a', 'blade-report-b'];
  let edits = 0; const content = new Map();
  const move = () => {
    const due = service.dueObligationIds();
    if (due.length) { service.studyObligation(due[0], {maxUnits: Infinity}); return; }
    const uid = order[edits % order.length]; edits += 1; content.set(uid, (content.get(uid) ?? 0) + 1);
    service.acceptLorebook({...book, entries: book.entries.map((e) => content.has(e.uid) ? {...e, content: e.content + ' Edit ' + content.get(e.uid) + '.'} : e)}, {deferRetrievalIndex: true});
  };
  let moved = 0;
  const superseded = await service.hierarchy.refreshRetrievalYielding({sliceSize: 1, maxAttempts: 2, yieldToHost: async () => { const k = service.runtime.store.resolutionKey(service.runtime.registry); move(); if (service.runtime.store.resolutionKey(service.runtime.registry) !== k) moved += 1; }});
  assert.ok(moved > 2, 'the fence moved during the build');
  assert.equal(superseded.status, 'SUPERSEDED'); assert.equal(index.revision, oldRevision, 'nothing published');
  assert.equal(service.retrievalEligibility({chatId: 'chat:fence'}).entries.find((row) => row.uid === 'mara').retrievalReady, false, 'the edited source is not served from the old index');
  const published = await service.hierarchy.refreshRetrievalYielding({sliceSize: 4});
  assert.equal(published.status, 'PUBLISHED'); assert.equal(index.fenceMoved(), false);
});

test('between a deferred accept and the rebuild: an edited source is never served, and every served hint is the owner\'s CURRENT hint', async () => {
  const {service, book, chatId} = await goldenService();
  const iface = service.brainInterface();
  const before = iface.sourceTruthHint('lore:ember-golden:blade-report-a').status;
  assert.equal(before, 'UNRESOLVED', 'precondition: report A is in the established conflict');
  // Report B changes and is not yet re-studied: the conflict loses a member, so A's owner hint moves.
  assert.equal(iface.sourceTruthHint('lore:ember-golden:tavern-intact').status, 'HISTORICAL', 'precondition: superseded by the fire');
  const builtHint = (sourceId) => [...service.hierarchy.retrievalIndex.records.values()].find((r) => r.resolution === 'EXACT_SOURCE' && r.sourceIds[0] === sourceId)?.truthStatusHint;
  // Report B and the fire change and are not yet re-studied: the conflict loses a member and the supersession of the intact
  // tavern disappears, so the owner's hint for the (unchanged) intact-tavern source moves from HISTORICAL to CURRENT.
  const receipt = service.acceptLorebook({...book, entries: book.entries.map((e) => e.uid === 'blade-report-b' ? {...e, content: 'The Sun Blade hangs in the Ember Tavern cellar.'} : e.uid === 'fire' ? {...e, content: e.content + ' Or so the old song says.'} : e)}, {deferRetrievalIndex: true});
  assert.equal(receipt.retrievalIndexDeferred, true);
  const index = service.hierarchy.retrievalIndex;
  assert.equal(index.fenceMoved(), true, 'precondition: the index is older than the owner state');
  assert.equal(builtHint('lore:ember-golden:tavern-intact'), 'HISTORICAL'); assert.notEqual(iface.sourceTruthHint('lore:ember-golden:tavern-intact').status, 'HISTORICAL', 'precondition: the owner hint moved');
  const packet = service.queryForStory({chatId, query: 'Where is the Sun Blade? The accounts conflict. Is the Ember Tavern intact?', intent: 'NARROW'});
  const served = packet.nominations.flatMap((row) => row.drillback);
  assert.ok(served.length > 0, 'unchanged sources are still served');
  assert.ok(served.some((src) => src.sourceId === 'lore:ember-golden:tavern-intact'), 'precondition: the source whose hint moved is served');
  for (const row of packet.nominations) assert.ok(index.recordCurrent(index.records.get(row.nomination.metadata?.retrievalRecordRef)), 'every nominated record (source or summary) is current: ' + row.nomination.metadata?.retrievalRecordRef);
  const raw = index.query({query: 'Sun Blade Ember Tavern fire song cellar intact', intent: 'BROAD'});
  assert.ok(raw.diagnostics.staleFiltered > 0, 'records built from moved revisions are filtered at query time');
  assert.ok(raw.nominations.every((n) => index.recordCurrent(index.records.get(n.metadata.retrievalRecordRef))));
  assert.equal(served.some((src) => src.sourceId === 'lore:ember-golden:blade-report-b'), false, 'the edited source is never served from its old record');
  for (const src of served) assert.equal(src.truthStatusHint, iface.sourceTruthHint(src.sourceId).status, src.sourceId + ': hint is the owner\'s current one');
  assert.equal(service.retrievalEligibility({chatId}).entries.find((row) => row.uid === 'blade-report-b').retrievalReady, false);
  // After re-study and the fenced rebuild everything is current again.
  service.runStudy({scope: 'DUE'});
  assert.equal(index.fenceMoved(), false);
  assert.ok(service.queryForStory({chatId, query: 'Sun Blade cellar', intent: 'NARROW'}).nominations.flatMap((row) => row.drillback).some((src) => src.sourceId === 'lore:ember-golden:blade-report-b'));
});

test('an index restored from a snapshot saved before fences existed is rebuilt once at restore, not served unfenced or dropped', async () => {
  const {service} = await goldenService();
  const snap = service.hierarchy.snapshot();
  delete snap.retrievalIndex.builtResolutionKey;
  for (const row of snap.retrievalIndex.records) delete row.learnedFence;
  const {LoreHierarchyRetrievalSystem} = await import('../src/lore-hierarchy-retrieval-system.js');
  const restored = new LoreHierarchyRetrievalSystem({runtime: service.runtime, snapshot: snap});
  assert.equal(restored.retrievalIndex.fenceMoved(), false, 'rebuilt against the current resolution');
  assert.ok([...restored.retrievalIndex.records.values()].every((row) => Array.isArray(row.learnedFence)));
  assert.equal(restored.retrievalIndex.revision, service.hierarchy.retrievalIndex.revision);
});
