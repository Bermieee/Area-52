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
  assert.equal(status.operatorCounts.READY, 105);
  assert.equal(status.retrievalReady, 105);
  assert.equal(status.storyAuthorizedReady, 105);
  assert.equal(status.entries.every((row) => row.freshness === 'CURRENT'), true);
  assert.equal(status.entries.every((row) => row.eligibleForStoryRetrieval === true), true);
  assert.equal(service.runtime.dueObligations().length, 0);

  const repeatStarted = performance.now();
  const repeat = service.acceptLorebook(snapshot);
  const repeatFinished = performance.now();
  assert.equal(repeat.sourceRevisionChanged, false);
  assert.equal(repeat.maintenancePerformed, false);
  assert.equal(repeat.maintenanceReason, 'NO_SOURCE_REVISION_CHANGE');
  assert.equal(repeat.dueStudyObligations, 0);
  assert.equal(service.runtime.dueObligations().length, 0);

  console.log('WORKER4_LORE_105_METRIC ' + JSON.stringify({
    entries: 105,
    initialAcceptMs: Number((acceptedAt - started).toFixed(2)),
    studyAndIndexMs: Number((studiedAt - acceptedAt).toFixed(2)),
    identicalReacceptMs: Number((repeatFinished - repeatStarted).toFixed(2)),
    dueAfterStudy: service.runtime.dueObligations().length,
    repeatMaintenancePerformed: repeat.maintenancePerformed,
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
  assert.equal(loreNominations.every((row) => row.sourceRevisionRefs.length > 0), true);
  assert.equal(loreNominations.every((row) => row.evidenceRefs.length > 0), true);
  assert.equal(loreNominations.every((row) => row.metadata.authorityScope.chatId === WORKER4_SELECTED_CHAT), true);

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
});
