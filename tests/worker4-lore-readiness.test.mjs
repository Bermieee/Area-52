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
