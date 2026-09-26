import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoundaryStatus,
  HostActivity,
  ObservationClass,
  SceneGraph,
  SceneGraphEdgeType,
  SceneLifecycleRuntime,
  SceneOperatorService,
  SceneRelationship,
  benchmarkSceneEpisodeRetrieval,
  createFieldState,
} from '../src/scene/index.js';
import { NativeGraphNeighborhoodRetriever } from '../src/graph-neighborhood-retriever.js';
import { createSceneOwnerGraphProvider } from '../src/deployment/owner-graph-adapters.js';

const field=(value,revision,evidence,observationClass=ObservationClass.OBSERVED,confidence=1)=>createFieldState({
  value,revision,evidenceRefs:[evidence],observationClass,confidence,
});
const confirmed=(id='cut')=>({status:BoundaryStatus.CONFIRMED,candidateId:id,boundaryType:'LOCATION_CHANGE',evidenceRefs:['e:'+id]});

test('Scene Graph supports evidence-backed causal/supporting links without turning adjacency into causality',()=>{
  const graph=new SceneGraph();
  graph.addRelationship({fromSceneId:'scene:a',toSceneId:'scene:b',relationship:SceneRelationship.CONTINUES,evidenceRefs:['adj:1']});
  const adjacency=graph.relation('scene:a','scene:b');
  assert.equal(adjacency.causal,false);

  const caused=graph.addEvidenceLink({
    fromRef:'event:door-opened',toRef:'event:alarm',relation:'CAUSES',
    evidenceRefs:['cause:1'],provenance:['cause:1'],
  });
  assert.equal(caused.edgeType,SceneGraphEdgeType.EVIDENCE_CAUSES);
  assert.equal(caused.causal,true);
  assert.deepEqual(caused.evidenceRefs,['cause:1']);

  const supporting=graph.addEvidenceLink({
    fromRef:'claim:location',toRef:'episode:scene:b',relation:'SUPPORTS',
    evidenceRefs:['support:1'],provenance:['support:1'],
  });
  assert.equal(supporting.edgeType,SceneGraphEdgeType.EVIDENCE_SUPPORTS);
  assert.equal(supporting.causal,false);
  assert.throws(()=>graph.addEvidenceLink({fromRef:'x',toRef:'y',relation:'CAUSES'}),/evidence/i);
});

test('confirmed lifecycle transition emits a bounded handoff and an edited source invalidates only dependent handoff/prefetch artifacts',()=>{
  const runtime=new SceneLifecycleRuntime();
  const scene=runtime.ensureChatScene('chat:handoff',{sourceRevisionRefs:['bootstrap:1'],evidenceRefs:['bootstrap:1']});
  const original=runtime.ingestHostEvent({
    activity:HostActivity.USER_SEND,chatId:'chat:handoff',messageId:'m1',messageRevision:1,
    content:'We leave the tavern and enter the dungeon.',turnId:'turn:1',hostEventId:'host:1',
  });
  const source=original.evidence.sourceRevisionId;
  const result=runtime.transitionManager.transition({
    decision:confirmed('handoff'),fromSceneId:scene.sceneId,nextSceneId:'chat:handoff:scene:2',
    relationship:SceneRelationship.CONTINUES,evidenceRefs:[source],sourceRevisionRefs:[source],
    expectedSceneRevision:scene.revision,recentTailRefs:[source],
    destinationHints:{locationRefs:['Dungeon'],threadRefs:['find the relic']},
  });
  assert.equal(result.status,'COMPLETE');
  assert.equal(result.handoff.kind,'SceneTransitionContextHandoff');
  assert.equal(result.handoff.authority,'NOMINATION_ONLY');
  assert.deepEqual(result.handoff.destinationPrefetch.locationRefs,['Dungeon']);
  assert.deepEqual(result.handoff.continuity.recentTailRefs,[source]);

  const edited=runtime.ingestHostEvent({
    activity:HostActivity.EDIT,chatId:'chat:handoff',messageId:'m1',messageRevision:2,
    content:'We stay in the tavern.',turnId:'turn:1-edit',hostEventId:'host:2',
  });
  assert.ok(edited.invalidatedHandoffs.some(row=>row.handoffId===result.handoff.handoffId&&row.status==='INVALIDATED'));
  assert.ok(runtime.prefetchTrigger.active({sceneId:result.toSceneId,sceneRevision:result.nextSceneRevision}).length===0);
  assert.equal(runtime.registry.get(scene.sceneId).lifecycle,'CLOSED');
});

test('advanced Scene operator backend detects continuity gaps and emits review-only Memory promotion previews',()=>{
  const lifecycle=new SceneLifecycleRuntime();
  const scene=lifecycle.ensureChatScene('ops-gap',{sourceRevisionRefs:['ops:1'],evidenceRefs:['ops:1']});
  lifecycle.sceneRuntime.observe({
    sceneId:scene.sceneId,proposalId:'ops:state',sourceRevisionRefs:['ops:1'],evidenceRefs:['ops:1'],
    fields:{
      activeCast:field([{characterId:'Mara',state:'PRESENT'}],2,'ops:1'),
      immediateObjects:field([{objectId:'map',state:'PRESENT',evidenceRefs:['ops:1']}],2,'ops:1'),
      activeThreads:field(['find relic'],2,'ops:1'),
    },
  });
  const ops=new SceneOperatorService({runtime:lifecycle});
  const gaps=ops.detectContinuityGaps({sceneId:scene.sceneId,expectedCharacterRefs:['Mara','Eris'],expectedObjectRefs:['map','relic']});
  assert.deepEqual(gaps.missingCharacterRefs,['Eris']);
  assert.deepEqual(gaps.missingObjectRefs,['relic']);
  assert.equal(gaps.authority,'DIAGNOSTIC_ONLY');

  const memory=ops.previewMemoryPromotion({sceneId:scene.sceneId});
  assert.equal(memory.kind,'SceneMemoryPromotionPreview');
  assert.equal(memory.memoryMutationAuthority,false);
  assert.equal(memory.reviewRequired,true);
  assert.ok(memory.proposal?.sceneEpisodeRef);

  const character=ops.previewCharacterMemoryExtraction({sceneId:scene.sceneId,characterRefs:['Mara']});
  assert.equal(character.kind,'SceneCharacterMemoryExtractionPreview');
  assert.equal(character.memoryMutationAuthority,false);
  assert.equal(character.items[0].characterRef,'Mara');
  assert.deepEqual(character.items[0].unresolvedThreadRefs,['find relic']);
});

test('Scene provider executes through the existing bounded Core Graph Walker beside another provider without gaining truth authority',()=>{
  const lifecycle=new SceneLifecycleRuntime();
  const scene=lifecycle.ensureChatScene('graph',{sourceRevisionRefs:['scene:r1'],evidenceRefs:['scene:r1']});
  lifecycle.graph.addMembership({sceneId:scene.sceneId,refId:'Mara',kind:'ENTITY',evidenceRefs:['scene:r1'],provenance:['scene:r1']});
  const sceneProvider=createSceneOwnerGraphProvider(lifecycle);
  const walker=new NativeGraphNeighborhoodRetriever({
    temporalGraph:{allClaims:()=>[]},
    isSourceRevisionCurrent:ref=>['scene:r1','memory:r1'].includes(ref),
    limits:{maxDepth:2,maxNodes:8,maxEdges:8,maxCandidates:8,latencyBudgetMs:100},
  });
  walker.registerProvider(sceneProvider);
  walker.registerProvider({
    providerId:'MEMORY_TEST',owner:'MEMORY_TEMPORAL',semanticsVersion:'MEMORY_TEST_V1',
    isRevisionCurrent:ref=>ref==='memory:r1',
    query:()=>({providerRevision:1,edges:[{
      edgeId:'memory:friend',fromEntityId:'Mara',toEntityId:'Eris',edgeMeaning:'REMEMBERS_ALLY',
      sourceKind:'MEMORY_OWNER',temporalStatus:'HISTORICAL',authorityClass:'OBSERVED',
      sourceRevisionRefs:['memory:r1'],provenanceRefs:['memory:r1'],evidenceRefs:['memory:r1'],
      artifactRef:{artifactId:'memory:friend',artifactType:'MemoryEvidence',revision:1},
    }]}),
  });
  const nominations=walker.retrieve({intentId:'scene-graph-intent',intentKind:'HISTORICAL',entityRefs:['Mara'],query:'Mara'},{
    worldRevision:1,sceneRevision:scene.revision,sourceRevisionSet:['scene:r1','memory:r1'],
  });
  const providers=new Set(nominations.map(row=>row.graphMetadata?.graphProvider).filter(Boolean));
  assert.ok(providers.has('SCENE_OWNER_GRAPH'));
  assert.ok(providers.has('MEMORY_TEST'));
  assert.ok(nominations.every(row=>row.channelId==='ZZ_NATIVE_GRAPH_WALKER'));
  assert.equal(walker.lastReceipt.authority.truth,false);
  assert.ok(walker.lastReceipt.traversedEdgeCount<=8);
});

test('SceneRAG-style benchmark compares semantic episodes against naive fixed chunks with deterministic metrics',()=>{
  const corpus=[
    {id:'turn:1',text:'At the Ember Tavern, Mara asks Eris about the Sun Blade.'},
    {id:'turn:2',text:'They agree to search the old vault beneath the city.'},
    {id:'turn:3',text:'Hours later they enter the Moonlit Vault and find the sealed door.'},
    {id:'turn:4',text:'Inside the vault, Eris gives Mara the brass key.'},
    {id:'turn:5',text:'A flashback recalls Mara meeting Eris at the harbor years earlier.'},
    {id:'turn:6',text:'Back in the Moonlit Vault, Mara uses the brass key on the sealed door.'},
  ];
  const semanticEpisodes=[
    {episodeId:'tavern',sourceIds:['turn:1','turn:2'],summary:'Ember Tavern: Mara and Eris plan to search the old vault for the Sun Blade.',temporalKind:'CURRENT'},
    {episodeId:'vault',sourceIds:['turn:3','turn:4','turn:6'],summary:'Moonlit Vault: Eris gives Mara the brass key; Mara later uses it on the sealed door.',temporalKind:'CURRENT'},
    {episodeId:'harbor-flashback',sourceIds:['turn:5'],summary:'Historical flashback: Mara met Eris at the harbor years earlier.',temporalKind:'FLASHBACK'},
  ];
  const queries=[
    {query:'Who gave Mara the brass key and where?',expectedSourceIds:['turn:4']},
    {query:'Where did Mara meet Eris years earlier?',expectedSourceIds:['turn:5']},
    {query:'What did Mara use on the sealed vault door?',expectedSourceIds:['turn:4','turn:6']},
  ];
  const report=benchmarkSceneEpisodeRetrieval({corpus,semanticEpisodes,queries,fixedChunkSize:2});
  assert.equal(report.kind,'SceneEpisodeRetrievalBenchmark');
  assert.equal(report.queryCount,3);
  assert.ok(report.semantic.eventCompleteness>=report.fixed.eventCompleteness);
  assert.ok(report.semantic.temporalCorrectness>=report.fixed.temporalCorrectness);
  assert.ok(report.semantic.sourceTraceability>=report.fixed.sourceTraceability);
  assert.ok(report.semantic.rebuildScopeAfterSingleEdit<=report.fixed.rebuildScopeAfterSingleEdit);
});
