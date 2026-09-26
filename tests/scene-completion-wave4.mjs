import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AtmosphereConsumptionPolicy,
  AtmosphereTracker,
  ObjectPresence,
  ObjectStateTracker,
  ObservationClass,
  SceneGraph,
  SceneIntelligenceRuntime,
  SceneJevOwnerAdjudicator,
  SceneLifecycleRuntime,
  SceneOperatorService,
  SceneQueryPlanner,
  SceneRelationship,
  SceneRetrievalAdapter,
  SceneSmartSnapshotSelector,
  SceneTransitionHandoffBuilder,
  TemporalStateTracker,
  createFieldState,
} from '../src/scene/index.js';
import {Area52NativeBrain} from '../src/native-brain.js';
import {SceneProductionUIAdapter} from '../src/ui-core/wave6-production-adapters.js';
import {createSceneOwnerGraphProvider} from '../src/deployment/owner-graph-adapters.js';

const field=(value,revision,evidence,observationClass=ObservationClass.OBSERVED,confidence=1)=>createFieldState({value,revision,evidenceRefs:[evidence],observationClass,confidence});

test('native Scene live-state stays incremental, smart snapshots are field-bounded, and operator correction fences stale inference',()=>{
  const runtime=new SceneIntelligenceRuntime();
  runtime.open({sceneId:'scene:live',sourceRevisionRefs:['src:0'],provenance:['src:0']});
  const first=runtime.observe({sceneId:'scene:live',proposalId:'obs:1',sourceRevisionRefs:['src:1'],evidenceRefs:['src:1'],fields:{
    location:field({location:'Atrium'},2,'src:1',ObservationClass.INFERRED,.6),
    activeCast:field([{characterId:'Mara',state:'PRESENT'}],2,'src:1'),
  }});
  assert.equal(first.applied,true);
  const corrected=runtime.correct({sceneId:'scene:live',fieldName:'location',fieldState:field({location:'Library'},3,'operator:1'),evidenceRefs:['operator:1']});
  assert.equal(corrected.scene.fields.location.value.location,'Library');
  const stale=runtime.observe({sceneId:'scene:live',proposalId:'obs:stale',sourceRevisionRefs:['src:1'],evidenceRefs:['src:1'],fields:{
    location:field({location:'Atrium'},4,'src:1',ObservationClass.INFERRED,.7),
  }});
  assert.equal(stale.applied,false);
  assert.deepEqual(stale.blockedFields,['location']);
  assert.equal(runtime.registry.current('scene:live').fields.location.value.location,'Library');
  const fresh=runtime.observe({sceneId:'scene:live',proposalId:'obs:2',sourceRevisionRefs:['src:2'],evidenceRefs:['src:2'],fields:{
    location:field({location:'Courtyard'},4,'src:2'),
  }});
  assert.equal(fresh.applied,true);
  const selection=new SceneSmartSnapshotSelector().select({record:runtime.registry.get('scene:live'),affectedFields:['location']});
  assert.equal(selection.scope,'FIELD_SLICE');
  assert.deepEqual(Object.keys(selection.fields),['location']);
  assert.equal(selection.sceneRevision,runtime.registry.current('scene:live').revision);
});

test('temporal intent preserves flashback, parallel, resumed, recalled and hypothetical semantics without current-world promotion',()=>{
  const tracker=new TemporalStateTracker();
  for(const mode of ['FLASHBACK','PARALLEL','RESUMED','RECALLED','HYPOTHETICAL','TIME_SKIP']){
    const state=tracker.update({sceneId:'scene:t',previous:null,revision:1,evidenceRefs:['time:'+mode],proposal:{mode,anchor:mode,explicit:true}});
    assert.equal(state.metadata.intentClass,mode);
    assert.equal(state.metadata.currentWorldApplicable,mode==='TIME_SKIP');
    if(['FLASHBACK','PARALLEL','RECALLED','HYPOTHETICAL'].includes(mode))assert.equal(state.metadata.historicalOrCounterfactual,true);
  }
});

test('object continuity distinguishes mention, possession, transfer and destruction while durable truth remains a proposal',()=>{
  const tracker=new ObjectStateTracker();
  let state=tracker.update({revision:2,evidenceRefs:['obj:1'],observations:[tracker.pickup('relic','mara','obj:1',{sceneId:'scene:o',sceneRevision:2,sourceRevisionRefs:['obj:1']})]});
  assert.equal(state.value[0].state,ObjectPresence.HELD);
  state=tracker.update({previous:state.value,revision:3,evidenceRefs:['obj:2'],observations:[tracker.mention('relic','obj:2')]});
  assert.equal(state.value[0].state,ObjectPresence.HELD);
  state=tracker.update({previous:state.value,revision:4,evidenceRefs:['obj:3'],observations:[tracker.transfer({sceneId:'scene:o',sceneRevision:4,objectId:'relic',fromHolderId:'mara',toHolderId:'eris',evidenceRef:'obj:3',sourceRevisionRefs:['obj:3']})]});
  assert.equal(state.value[0].holderId,'eris');
  const destroyed=tracker.destroy({sceneId:'scene:o',sceneRevision:5,objectId:'relic',before:state.value[0],evidenceRef:'obj:4',sourceRevisionRefs:['obj:4']});
  assert.equal(destroyed.durableProposal.after.state,ObjectPresence.DESTROYED);
  assert.equal(destroyed.durableProposal.directSettlement,false);
  assert.equal(destroyed.durableProposal.settlementAuthority,false);
});

test('Scene Query Planner emits bounded provenance-bearing intents without admission or scheduling authority',()=>{
  const scene={sceneId:'scene:q',revision:9,sourceRevisionRefs:['q:1'],provenance:['q:1'],fields:{
    location:field({location:'Archive'},9,'q:1'),
    activeCast:field([{characterId:'Mara',state:'PRESENT'},{characterId:'Eris',state:'MENTIONED_ONLY'}],9,'q:1'),
    activeThreads:field(['missing relic'],9,'q:1'),
    activeRelationships:field([{from:'Mara',to:'Eris',kind:'ALLY'}],9,'q:1'),
    immediateObjects:field([{objectId:'relic',state:'MISSING'}],9,'q:1'),
    atmosphere:field({danger:{score:.8,confidence:.7,evidenceRefs:['q:1']}},9,'q:1',ObservationClass.INFERRED,.7),
  }};
  const plan=new SceneQueryPlanner({maxIntents:7}).plan({scene,userInput:'Where did the relic go?',intent:'CURRENT'});
  assert.ok(plan.intents.length>=4&&plan.intents.length<=7);
  assert.ok(plan.intents.some(x=>x.intentKind==='OBJECT_PROVENANCE'));
  assert.ok(plan.intents.some(x=>x.intentKind==='LOCATION_CONTEXT'));
  assert.ok(plan.intents.every(x=>x.sceneRevision===9&&x.sourceRevisionRefs.includes('q:1')));
  assert.ok(plan.intents.every(x=>x.runtimeSchedulingAuthority===false&&x.finalAdmissionAuthority===false&&x.truthAuthority===false));
  assert.equal(plan.activeCastRefs.includes('Eris'),false);
});

test('confirmed transition handoff nominates compact continuity and destination prefetch without deleting dialogue or deciding prompt inclusion',()=>{
  const builder=new SceneTransitionHandoffBuilder({maxTailRefs:4,ttlRevisions:3});
  const handoff=builder.build({
    transition:{status:'COMPLETE',fromSceneId:'scene:tavern',toSceneId:'scene:dungeon',relationship:SceneRelationship.CONTINUES},
    priorScene:{sceneId:'scene:tavern',revision:7,sourceRevisionRefs:['t:5','t:6','t:7']},
    nextScene:{sceneId:'scene:dungeon',revision:1,sourceRevisionRefs:['d:1']},
    episode:{episodeId:'episode:tavern:7',artifactRef:{artifactId:'episode:tavern:7',artifactType:'SceneEpisode',revision:7},compactSummary:'Tavern | Mara | unanswered map question',sourceRevisionRefs:['t:5','t:6','t:7']},
    recentTailRefs:['t:4','t:5','t:6','t:7','t:8'],
    destinationHints:{locationRefs:['Dungeon'],entityRefs:['Mara'],threadRefs:['unanswered map question']},
    evidenceRefs:['travel:1'],sourceRevisionRefs:['travel:1'],
  });
  assert.equal(handoff.status,'ACTIVE');
  assert.equal(handoff.continuity.promptInclusionAuthority,false);
  assert.equal(handoff.continuity.rawDialogueDeletionAuthority,false);
  assert.equal(handoff.continuity.recentTailRefs.length,4);
  assert.deepEqual(handoff.destinationPrefetch.locationRefs,['Dungeon']);
  assert.equal(handoff.authority,'NOMINATION_ONLY');
  const invalidated=builder.invalidate(handoff,{sourceRevisionRef:'travel:1',replacementRef:'travel:2'});
  assert.equal(invalidated.status,'INVALIDATED');
  assert.deepEqual(invalidated.invalidators,['travel:2']);
});

test('Scene retrieval exposes bounded temporal paths and Scene graph provider preserves provenance without truth authority',()=>{
  const graph=new SceneGraph();
  graph.addScene({sceneId:'a',revision:1});graph.addScene({sceneId:'b',revision:1});graph.addScene({sceneId:'c',revision:1});
  graph.addRelationship({fromSceneId:'a',toSceneId:'b',relationship:SceneRelationship.CONTINUES,evidenceRefs:['ab:1'],provenance:['ab:1']});
  graph.addRelationship({fromSceneId:'b',toSceneId:'c',relationship:SceneRelationship.CONTINUES,evidenceRefs:['bc:1'],provenance:['bc:1']});
  const episodes=[
    {episodeId:'ea',sceneId:'a',sceneRevision:1,sourceRevisionRefs:['a:1'],participants:[],threadsCarried:[],compactSummary:'alpha',artifactRef:{artifactId:'ea',artifactType:'SceneEpisode',revision:1}},
    {episodeId:'eb',sceneId:'b',sceneRevision:1,sourceRevisionRefs:['b:1'],participants:[],threadsCarried:[],compactSummary:'beta',artifactRef:{artifactId:'eb',artifactType:'SceneEpisode',revision:1}},
    {episodeId:'ec',sceneId:'c',sceneRevision:1,sourceRevisionRefs:['c:1'],participants:[],threadsCarried:[],compactSummary:'gamma',artifactRef:{artifactId:'ec',artifactType:'SceneEpisode',revision:1}},
  ];
  const retrieval=new SceneRetrievalAdapter({episodeProvider:episodes,graph});
  const path=retrieval.temporalPath({fromSceneId:'a',toSceneId:'c',maxHops:3});
  assert.equal(path.status,'FOUND');
  assert.equal(path.edges.length,2);
  assert.equal(path.truthAuthority,false);
  const provider=createSceneOwnerGraphProvider({graph,registry:{list:()=>[{sceneId:'a'},{sceneId:'b'},{sceneId:'c'}],current:id=>({sceneId:id,revision:1,sourceRevisionRefs:[id+':1'],fields:{}})}});
  const response=provider.query({maxEdges:1,allowedEdgeMeanings:['SCENE_CONTINUES']});
  assert.equal(response.edges.length,1);
  assert.equal(response.edges[0].sourceRevisionRefs.length>0,true);
  assert.equal(provider.metadata.authority,'REFERENCE_ONLY');
});

test('atmosphere consumption is expiring, optional, inferred, evidence-backed and cannot recursively validate prose style',()=>{
  const atmosphere=new AtmosphereTracker({ttlRevisions:2}).update({revision:5,evidenceRefs:['narrative:5'],dimensions:{tension:{score:.9,confidence:.8}}});
  assert.equal(atmosphere.observationClass,ObservationClass.INFERRED);
  const disabled=new AtmosphereConsumptionPolicy({enabled:false}).consume({atmosphere,currentSceneRevision:5});
  assert.equal(disabled.status,'DISABLED');
  const policy=new AtmosphereConsumptionPolicy({enabled:true,maxAgeRevisions:2});
  const active=policy.consume({atmosphere,currentSceneRevision:6});
  assert.equal(active.status,'AVAILABLE');
  assert.equal(active.proseStyleAuthority,false);
  assert.equal(active.factCreationAuthority,false);
  const recursive=policy.consume({atmosphere,currentSceneRevision:6,generationDerivedEvidenceRefs:['narrative:5']});
  assert.equal(recursive.status,'REJECTED_RECURSIVE_EVIDENCE');
  const expired=policy.consume({atmosphere,currentSceneRevision:8});
  assert.equal(expired.status,'EXPIRED');
});

test('Scene Jev owner call site explicitly accepts, rejects or leaves advisory proposals unresolved and preserves state on unavailable/stale output',async()=>{
  const currentScene={sceneId:'scene:j',revision:4};
  const acceptedService={adjudicate:async()=>({proposedOutcome:'RESUME_PRIOR_SCENE',staleState:'FRESH',requiresOwnerPolicy:true,receipt:{receiptId:'jev:1'}})};
  const owner=new SceneJevOwnerAdjudicator({service:acceptedService});
  const accepted=await owner.adjudicate({decisionId:'j1',sceneRevision:4},{currentScene,validateProposal:proposal=>proposal.proposedOutcome==='RESUME_PRIOR_SCENE'});
  assert.equal(accepted.ownerDecision,'ACCEPTED');
  assert.equal(accepted.sceneMutationApplied,false);
  const rejected=await owner.adjudicate({decisionId:'j2',sceneRevision:4},{currentScene,validateProposal:()=>false});
  assert.equal(rejected.ownerDecision,'REJECTED');
  const staleOwner=new SceneJevOwnerAdjudicator({service:{adjudicate:async()=>({proposedOutcome:'OPEN_NEW_SCENE',staleState:'STALE'})}});
  assert.equal((await staleOwner.adjudicate({decisionId:'j3',sceneRevision:4},{currentScene})).ownerDecision,'UNRESOLVED');
  const unavailable=new SceneJevOwnerAdjudicator({service:{adjudicate:async()=>{throw new Error('provider offline');}}});
  const fallback=await unavailable.adjudicate({decisionId:'j4',sceneRevision:4},{currentScene});
  assert.equal(fallback.ownerDecision,'UNRESOLVED');
  assert.equal(fallback.preserveCurrentScene,true);
});

test('advanced scanner backend exposes bounded review/correction/repair/carryover/history contracts without settlement authority',()=>{
  const lifecycle=new SceneLifecycleRuntime();
  const scene=lifecycle.ensureChatScene('ops',{sourceRevisionRefs:['ops:1'],evidenceRefs:['ops:1']});
  lifecycle.sceneRuntime.observe({sceneId:scene.sceneId,proposalId:'ops:observe',sourceRevisionRefs:['ops:1'],evidenceRefs:['ops:1'],fields:{
    location:field({location:'Dock'},2,'ops:1'),activeThreads:field(['unpaid debt'],2,'ops:1'),
  }});
  const ops=new SceneOperatorService({runtime:lifecycle,maxHistoryRows:20});
  const caps=ops.capabilities();
  for(const key of ['rescan','compare','correct','mergeSplitReview','episodeRepair','carryover','history'])assert.equal(caps[key],true);
  const comparison=ops.compare({sceneId:scene.sceneId,fromRevision:1,toRevision:2});
  assert.ok(comparison.changedFields.includes('location'));
  const merge=ops.proposeMergeSplit({sceneIds:[scene.sceneId],mode:'SPLIT',evidenceRefs:['operator:split']});
  assert.equal(merge.authority,'REVIEW_ONLY');
  assert.equal(merge.settlementAuthority,false);
  const carry=ops.carryover({sceneId:scene.sceneId});
  assert.deepEqual(carry.unresolvedThreadRefs,['unpaid debt']);
  assert.equal(carry.memoryMutationAuthority,false);
  const history=ops.history({offset:0,limit:10});
  assert.ok(history.total>=1&&history.items.length<=10);
});

test('native Brain readScene publishes the shared SceneUiReadModel contract accepted by the installed UI adapter',async()=>{
  const brain=new Area52NativeBrain();
  const prepared=await brain.prepareTurn({
    chatId:'chat:ui',turnId:'turn:ui',generationId:'gen:ui',query:'Continue.',
    scene:{sceneId:'scene:ui',sceneRevision:1,sourceRevisionRefs:['scene-src:1'],location:{value:{location:'Hall'},observationClass:'OBSERVED',confidence:1,evidenceRefs:['scene-src:1']},activeCast:[{characterId:'Mara',state:'PRESENT'}],provenance:['scene-src:1']},
  });
  const bindings=brain.uiBindings(),model=bindings.readScene(prepared.selection);
  assert.equal(model.kind,'SceneUiReadModel');
  assert.equal(model.sceneId,'scene:ui');
  const adapter=new SceneProductionUIAdapter({readModel:bindings.readScene,selectionProvider:()=>prepared.selection});
  const read=adapter.read();
  assert.notEqual(read.source.operationalState,'DEGRADED');
  assert.equal(read.data.id,'scene:ui');
});
