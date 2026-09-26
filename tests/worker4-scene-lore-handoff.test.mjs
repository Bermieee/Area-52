import test from 'node:test';
import assert from 'node:assert/strict';

import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {extractDevelopmentDeploymentScene} from '../src/deployment/sillytavern-live.js';
import {HostActivity} from '../src/scene/index.js';
import {
  SceneLoreHandoffAdapter,
  SceneLoreHandoffStatus,
  SceneLoreNeedReason,
  createSceneLoreRetrievalNeed,
} from '../src/scene-lore-handoff.js';

const event = (activity, id, content, extra = {}) => ({
  activity,
  chatId: extra.chatId ?? 'chat:scene-lore',
  hostEventId: extra.hostEventId ?? `host:${id}:${activity}:r${extra.messageRevision ?? 1}`,
  messageId: extra.messageId ?? id,
  messageRevision: extra.messageRevision ?? 1,
  turnId: extra.turnId ?? `turn:${id}`,
  content,
  role: extra.role ?? 'user',
  ...extra,
});

const ingest = (brain, input) => brain.ingestSceneHostEvent(input, {
  extract: (e, scene) => extractDevelopmentDeploymentScene(e.content, {
    revision: scene.revision + 1,
    evidenceRef: e.sourceRevisionId,
    currentScene: scene,
    sceneRuntime: brain.scene,
  }),
});

function sceneLoreBook(chatId = 'chat:scene-lore') {
  return {
    id: 'scene-lore-book',
    title: 'Scene Lore Book',
    chatId,
    discovery: {
      kind: 'SillyTavernLorebookDiscoveryReceipt',
      contractVersion: 1,
      source: 'SILLYTAVERN_WORLD_INFO_EDITOR',
      lorebookId: 'scene-lore-book',
      title: 'Scene Lore Book',
      entryCount: 2,
      chatId,
      exactAuthoredSource: true,
    },
    fullSnapshot: true,
    entries: [
      {
        uid: 'north-gallery',
        content: 'The North Gallery is a restricted gallery.',
        metadata: {title: 'North Gallery', treePath: ['Places']},
      },
      {
        uid: 'mara',
        content: 'Mara knows North Gallery.',
        metadata: {title: 'Mara', treePath: ['People']},
      },
    ],
  };
}

function syntheticReceipt(overrides = {}) {
  return {
    kind: 'DeploymentSceneOwnerReceipt',
    contractVersion: 1,
    status: 'OBSERVED',
    noWorkReason: null,
    chatId: 'chat:scene-lore',
    sceneId: 'scene:1',
    sceneRevision: 4,
    sourceRevisionRefs: ['scene-src:4'],
    invalidatedSourceRevisionRefs: [],
    changedFields: ['location'],
    delta: {
      changedFields: {
        location: {
          before: {value: {location: 'Old Hall'}},
          after: {value: {location: 'North Gallery'}},
        },
      },
    },
    evidence: {
      chatId: 'chat:scene-lore',
      turnId: 'turn:scene',
      sourceRevisionId: 'scene-src:4',
      invalidates: [],
      replacesRevisionId: null,
    },
    eventIds: ['scene-event:4'],
    eventTypes: ['LOCATION_CHANGED'],
    transition: null,
    signal: {
      sceneId: 'scene:1',
      sceneRevision: 4,
      location: {location: 'North Gallery'},
      narrativeTime: null,
      activeCast: [],
      activeThreads: [],
      uncertainFields: [],
      conflictSignals: [],
      provenance: ['scene-src:4'],
    },
    authorityGranted: false,
    settlementAuthority: false,
    contextSealAuthority: false,
    ...overrides,
  };
}

function packet({truthStatusHint = 'CURRENT', temporalHints = [], sourceId = 'lore:book:entry', sourceRevisionId = 'lore-rev:1'} = {}) {
  return {
    kind: 'LoreBrainRetrievalPacket',
    contractVersion: 1,
    status: 'ELIGIBLE',
    reason: 'AUTHORIZED_CURRENT_RETRIEVAL_MATCH',
    indexRevision: 'lore-index:1',
    ontologyRevision: 'lore-ontology:1',
    sourceRevisionFence: [sourceRevisionId],
    storyScope: {chatId: 'chat:scene-lore', state: 'BOUND', readLorebookIds: ['book']},
    candidateReceipts: [{
      candidateId: 'candidate:' + sourceId,
      retrievalRecordRef: 'retrieval:' + sourceId,
      evidenceRefs: ['evidence:' + sourceId],
      provenanceRefs: [sourceRevisionId],
      sourceEntries: [{sourceId, lorebookId: 'book', uid: sourceId.split(':').at(-1), sourceRevisionId}],
      authorityClass: 'SOURCE_CANON',
    }],
    exclusionReceipts: [],
    nominations: [{
      nomination: {
        candidateId: 'candidate:' + sourceId,
        representationRef: 'representation:' + sourceId,
        evidenceRefs: ['evidence:' + sourceId],
        provenance: [{sourceRevisionId}],
        truthStatusHint,
        temporalHints,
        authorityClass: 'SOURCE_CANON',
        metadata: {retrievalRecordRef: 'retrieval:' + sourceId},
      },
      drillback: [{
        sourceId,
        lorebookId: 'book',
        uid: sourceId.split(':').at(-1),
        sourceRevisionId,
        representationRef: 'representation:' + sourceId,
      }],
    }],
  };
}

test('assembled Scene owner receipt produces revision-fenced Lore candidates without Truth/Gather/Seal authority', async () => {
  const brain = new DevelopmentDeploymentBrain({resourceCount: 1, jevAvailable: false});
  brain.ingestLorebook(sceneLoreBook());

  const receipt = ingest(brain, event(
    HostActivity.USER_SEND,
    'scene-1',
    'At North Gallery, Mara enters.',
  ));
  assert.equal(receipt.kind, 'DeploymentSceneOwnerReceipt');
  assert.equal(receipt.status, 'OBSERVED');

  const result = await brain.runSceneLoreHandoff({
    sceneReceipt: receipt,
    generationId: 'generation:scene-1',
  });

  assert.equal(result.kind, 'SceneLoreRetrievalResult');
  assert.equal(result.status, SceneLoreHandoffStatus.SYNCED);
  assert.equal(result.need.chatId, 'chat:scene-lore');
  assert.equal(result.need.turnId, 'turn:scene-1');
  assert.equal(result.need.generationId, 'generation:scene-1');
  assert.equal(result.need.sceneRevision, receipt.sceneRevision);
  assert.ok(result.need.reasons.includes(SceneLoreNeedReason.PLACE_CHANGED));
  assert.ok(result.need.reasons.includes(SceneLoreNeedReason.CAST_CHANGED));
  assert.ok(result.candidateCount > 0);
  assert.ok(result.candidates.some((row) => row.lorebookId === 'scene-lore-book' && row.uid === 'north-gallery'));
  assert.ok(result.loreSourceRevisionFence.length > 0);
  assert.ok(result.sceneSourceRevisionFence.includes(receipt.evidence.sourceRevisionId));
  assert.ok(result.candidates.every((row) => row.readiness === 'RETRIEVAL_READY_CURRENT_REVISION'));
  assert.equal(result.truthAuthority, false);
  assert.equal(result.gatherAuthority, false);
  assert.equal(result.contextSealAuthority, false);
  assert.equal(result.promptInjectionAuthority, false);
  assert.equal(result.rawLoreIncluded, false);
});

test('quiet Scene turn produces NO_WORK and performs no Lore retrieval', async () => {
  const brain = new DevelopmentDeploymentBrain({resourceCount: 1, jevAvailable: false});
  brain.ingestLorebook(sceneLoreBook());

  ingest(brain, event(HostActivity.USER_SEND, 'scene-quiet-prime', 'At North Gallery, Mara enters.'));
  const quiet = brain.ingestSceneHostEvent(
    event(HostActivity.ASSISTANT_GENERATION_COMPLETE, 'scene-quiet', 'Nothing relevant changes.', {role: 'assistant'}),
    {extract: () => ({fields: {}})},
  );
  assert.equal(quiet.status, 'NO_WORK');

  const result = await brain.runSceneLoreHandoff({
    sceneReceipt: quiet,
    generationId: 'generation:quiet',
  });
  assert.equal(result.status, SceneLoreHandoffStatus.NO_WORK);
  assert.equal(result.queried, false);
  assert.equal(result.candidateCount, 0);
});

test('stale Scene revision and chat switch fail closed before returning Lore candidates', async () => {
  const brain = new DevelopmentDeploymentBrain({resourceCount: 1, jevAvailable: false});
  brain.ingestLorebook(sceneLoreBook());

  const oldReceipt = ingest(brain, event(HostActivity.USER_SEND, 'old', 'At North Gallery, Mara enters.'));
  const freshReceipt = ingest(brain, event(HostActivity.USER_SEND, 'fresh', 'At South Gallery, Mara enters.'));
  assert.ok(freshReceipt.sceneRevision > oldReceipt.sceneRevision);

  const stale = await brain.runSceneLoreHandoff({sceneReceipt: oldReceipt, generationId: 'generation:old'});
  assert.equal(stale.status, SceneLoreHandoffStatus.STALE);
  assert.equal(stale.reason, 'SCENE_REVISION_STALE');
  assert.equal(stale.candidateCount, 0);

  brain.ingestSceneHostEvent(event(HostActivity.CHAT_SWITCH, 'switch', '', {chatId: 'chat:other'}));
  const switched = await brain.runSceneLoreHandoff({sceneReceipt: freshReceipt, generationId: 'generation:fresh'});
  assert.equal(switched.status, SceneLoreHandoffStatus.LATE);
  assert.equal(switched.reason, 'CHAT_SWITCHED');
  assert.equal(switched.candidateCount, 0);
});

test('need builder covers relationship, unresolved-thread and correction reasons with bounded queries', () => {
  const receipt = syntheticReceipt({
    changedFields: ['activeRelationships', 'activeThreads', 'location'],
    invalidatedSourceRevisionRefs: ['scene-src:3'],
    evidence: {
      chatId: 'chat:scene-lore',
      turnId: 'turn:scene',
      sourceRevisionId: 'scene-src:4',
      replacesRevisionId: 'scene-src:3',
      invalidates: ['scene-src:3'],
    },
    delta: {
      changedFields: {
        location: {before: {value: {location: 'Old Hall'}}, after: {value: {location: 'North Gallery'}}},
        activeRelationships: {
          before: {value: [{subjectId: 'Mara', predicate: 'trusts', objectId: 'Eris'}]},
          after: {value: [{subjectId: 'Mara', predicate: 'distrusts', objectId: 'Eris'}]},
        },
        activeThreads: {
          before: {value: []},
          after: {value: [{threadId: 'missing-map', objective: 'Who moved the map?'}]},
        },
      },
    },
    signal: {
      sceneId: 'scene:1',
      sceneRevision: 4,
      location: {location: 'North Gallery'},
      activeCast: [{characterId: 'Mara', state: 'PRESENT'}],
      activeThreads: [{threadId: 'missing-map', objective: 'Who moved the map?'}],
      uncertainFields: ['activeThreads'],
      conflictSignals: ['activeThreads'],
      provenance: ['scene-src:4'],
    },
  });

  const need = createSceneLoreRetrievalNeed({sceneReceipt: receipt, generationId: 'generation:4'});
  assert.ok(need.reasons.includes(SceneLoreNeedReason.RELATIONSHIP_CHANGED));
  assert.ok(need.reasons.includes(SceneLoreNeedReason.UNRESOLVED_THREAD_CHANGED));
  assert.ok(need.reasons.includes(SceneLoreNeedReason.CORRECTION));
  assert.ok(need.queries.length <= 6);
  assert.ok(need.queries.every((row) => row.query.length <= 320));
  assert.deepEqual(need.correctionInvalidatedSourceRevisionRefs, ['scene-src:3']);
  assert.equal(need.truthAuthority, false);
});

test('Lore historical and UNRESOLVED temporal semantics survive the adapter unchanged', async () => {
  const receipt = syntheticReceipt();
  const packets = [
    packet({
      truthStatusHint: 'HISTORICAL',
      temporalHints: [{artifactId: 'claim:h', temporalClass: 'HISTORICAL', unresolved: false}],
      sourceId: 'lore:book:historical',
      sourceRevisionId: 'lore-rev:h',
    }),
    packet({
      truthStatusHint: 'UNRESOLVED',
      temporalHints: [{artifactId: 'claim:u', temporalClass: 'CONFLICTING', unresolved: true}],
      sourceId: 'lore:book:unresolved',
      sourceRevisionId: 'lore-rev:u',
    }),
  ];
  let index = 0;
  const current = new Map([
    ['lore:book:historical', {id: 'lore-rev:h', state: 'CURRENT'}],
    ['lore:book:unresolved', {id: 'lore-rev:u', state: 'CURRENT'}],
  ]);
  const adapter = new SceneLoreHandoffAdapter({
    getLoreInterface: () => ({
      kind: 'LoreBrainRetrievalInterface',
      contractVersion: 1,
      queryScoped: async () => packets[Math.min(index++, packets.length - 1)],
      sourceRevision: async (sourceId) => current.get(sourceId),
    }),
    getCurrentContext: () => ({activeChatId: 'chat:scene-lore', sceneId: 'scene:1', sceneRevision: 4}),
    isTurnSealed: () => false,
  });

  const result = await adapter.retrieve({sceneReceipt: receipt, generationId: 'generation:temporal'});
  assert.equal(result.status, SceneLoreHandoffStatus.SYNCED);
  assert.ok(result.candidates.some((row) => row.temporalStatus === 'HISTORICAL'));
  assert.ok(result.candidates.some((row) => row.temporalStatus === 'UNRESOLVED'));
  assert.ok(result.candidates.every((row) => row.truthAuthority === false));
});

test('edited or removed Lore is excluded by post-query owner revision revalidation', async () => {
  const receipt = syntheticReceipt();
  for (const ownerRevision of [
    {id: 'lore-rev:new', state: 'CURRENT'},
    {id: 'lore-rev:old', state: 'REMOVED'},
  ]) {
    const adapter = new SceneLoreHandoffAdapter({
      getLoreInterface: () => ({
        kind: 'LoreBrainRetrievalInterface',
        contractVersion: 1,
        queryScoped: async () => packet({sourceRevisionId: 'lore-rev:old'}),
        sourceRevision: async () => ownerRevision,
      }),
      getCurrentContext: () => ({activeChatId: 'chat:scene-lore', sceneId: 'scene:1', sceneRevision: 4}),
    });
    const result = await adapter.retrieve({sceneReceipt: receipt, generationId: 'generation:stale-lore'});
    assert.equal(result.candidateCount, 0);
    assert.ok(result.exclusions.some((row) => ['LORE_SOURCE_REVISION_STALE_AFTER_QUERY', 'LORE_SOURCE_REMOVED_AFTER_QUERY'].includes(row.reason)));
  }
});

test('unavailable Lore and results arriving after Seal degrade or become late without candidates', async () => {
  const receipt = syntheticReceipt();
  const unavailable = new SceneLoreHandoffAdapter({
    getLoreInterface: () => null,
    getCurrentContext: () => ({activeChatId: 'chat:scene-lore', sceneId: 'scene:1', sceneRevision: 4}),
  });
  const degraded = await unavailable.retrieve({sceneReceipt: receipt, generationId: 'generation:unavailable'});
  assert.equal(degraded.status, SceneLoreHandoffStatus.DEGRADED);
  assert.equal(degraded.candidateCount, 0);

  let sealed = false;
  const late = new SceneLoreHandoffAdapter({
    getLoreInterface: () => ({
      kind: 'LoreBrainRetrievalInterface',
      contractVersion: 1,
      queryScoped: async () => {
        sealed = true;
        return packet();
      },
      sourceRevision: async () => ({id: 'lore-rev:1', state: 'CURRENT'}),
    }),
    getCurrentContext: () => ({activeChatId: 'chat:scene-lore', sceneId: 'scene:1', sceneRevision: 4}),
    isTurnSealed: () => sealed,
  });
  const lateResult = await late.retrieve({sceneReceipt: receipt, generationId: 'generation:late'});
  assert.equal(lateResult.status, SceneLoreHandoffStatus.LATE);
  assert.equal(lateResult.reason, 'TURN_ALREADY_SEALED');
  assert.equal(lateResult.candidateCount, 0);
  assert.ok(lateResult.discardedCandidateCount >= 1);
});
