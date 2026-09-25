import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoundaryStatus, ClapperboardTransitionManager, HostActivity, NarrativeFeedAdapter, ObjectPresence, ObjectStateTracker,
  ObservationClass, SceneContextInvalidationPublisher, SceneEpisodeCompiler, SceneEventPublisher, SceneEventType,
  SceneGraph, SceneLifecycleRuntime, ScenePrefetchTrigger, SceneRegistry, SceneRelationship, SceneStack,
  SceneUiHealth, SillyTavernHostBridge, createFieldState, createGraphReferenceSetFromScene,
  createObjectStateTransitionProposal, createSceneAssemblyLaneManifest, createSceneExperienceProposal,
  createSceneIntegrationSignal, createSceneUiReadModel, createSceneWhyReferences, isSceneExperienceProposalFresh,
  isSceneUiReadModelFresh, toCoreAssemblyLaneEntry,
} from '../src/scene/index.js';

const field=(value,revision,evidenceRefs=['e:1'],observationClass=ObservationClass.OBSERVED,confidence=1,metadata={})=>createFieldState({value,revision,evidenceRefs,observationClass,confidence,metadata});
const confirmed=(id='c',boundaryType='LOCATION')=>({status:BoundaryStatus.CONFIRMED,candidateId:id,boundaryType});

test('SceneIntegrationSignal is immutable, descriptive and filters mentioned-only Fan-Out inputs',()=>{
  const signal=createSceneIntegrationSignal({
    sceneId:'s',sceneRevision:4,sourceRevisionRefs:['r4'],location:{location:'Tavern'},activeThreads:['Blade'],
    activeCast:[{characterId:'Mara',state:'PRESENT'},{characterId:'Lili',state:'MENTIONED_ONLY'}],
    objects:[{objectId:'Blade',state:'MENTIONED_ONLY'},{objectId:'Cup',state:'PRESENT'}],provenance:['e:mara'],
  });
  assert.deepEqual(signal.activeCast.map(x=>x.characterId),['Mara']);
  assert.deepEqual(signal.castObservations.map(x=>x.characterId),['Mara','Lili']);
  assert.deepEqual(signal.objects.map(x=>x.objectId),['Cup']);
  assert.deepEqual(signal.objectObservations.map(x=>x.objectId),['Blade','Cup']);
  assert.equal(signal.authority,'DESCRIPTIVE');assert.equal(signal.authorityGranted,false);assert.equal(signal.settlementAuthority,false);assert.equal(signal.contextSealBypass,false);assert.equal(signal.runtimeSchedulingAuthority,false);
  assert.ok(Object.isFrozen(signal));assert.ok(Object.isFrozen(signal.activeCast));
  assert.throws(()=>{signal.activeCast.push('x')},TypeError);
});

test('SceneIntegrationSignal rejects authority escalation',()=>{
  assert.throws(()=>createSceneIntegrationSignal({sceneId:'s',sceneRevision:1,authority:'SOURCE_CANON'}),/cannot grant authority/);
  assert.throws(()=>createSceneIntegrationSignal({sceneId:'s',sceneRevision:1,settlementAuthority:true}),/cannot grant authority/);
});

test('SceneLifecycleRuntime integration signal and Fan-Out input expose exact Scene-side planner seam',()=>{
  const rt=new SceneLifecycleRuntime();const scene=rt.ensureChatScene('fan',{sourceRevisionRefs:['src:1'],evidenceRefs:['src:1']});
  rt.sceneRuntime.observe({sceneId:scene.sceneId,proposalId:'fan:p',sourceRevisionRefs:['src:1'],evidenceRefs:['src:1'],fields:{
    location:field({location:'Ember Tavern'},2,['src:1']),
    activeCast:field([{characterId:'Mara',state:'PRESENT'},{characterId:'Eris',state:'MENTIONED_ONLY'}],2,['src:1']),
    activeThreads:field(['Find Sun Blade'],2,['src:1']),
  }});
  const signal=rt.integrationSignal('fan'),input=rt.fanOutInput('fan');
  assert.equal(signal.sceneRevision,2);assert.equal(input.sceneRevision,2);assert.equal(input.location.location,'Ember Tavern');
  assert.deepEqual(input.activeCast.map(x=>x.characterId),['Mara']);assert.deepEqual(input.activeThreads,['Find Sun Blade']);
  assert.ok(['HIGH','MIXED','LOW'].includes(input.retrievalQuality));assert.equal(input.authorityGranted,false);
});

test('Scene event publisher exposes Runtime/Core registry-compatible producer descriptors',()=>{
  const p=new SceneEventPublisher();const runtime=[];const core=[];
  p.registerWithRuntimeRegistry({register:(d)=>{runtime.push(d);return d;}});
  p.registerWithCoreRegistry({registerType:(d)=>{core.push(d);return d;}});
  assert.equal(runtime.length,Object.values(SceneEventType).length);assert.equal(core.length,Object.values(SceneEventType).length);
  assert.ok(runtime.every(x=>x.schemaVersion==='1.0'&&x.producer==='SCENE_INTELLIGENCE'));
  assert.ok(core.every(x=>x.eventVersion==='1.0.0'&&x.owner==='SCENE_INTELLIGENCE'));
});

test('Scene event compatibility rejects unknown event/payload major versions and authority bypass',()=>{
  const p=new SceneEventPublisher();
  const e=p.publish({eventType:SceneEventType.SCENE_OPENED,sceneId:'s',sceneRevision:1,sourceRevisionRefs:['r1'],payload:{ok:true},dedupeKey:'open'});
  assert.equal(p.validateCompatibility({...e,eventVersion:'2.0.0'}).code,'EVENT_VERSION_INCOMPATIBLE');
  assert.equal(p.validateCompatibility({...e,payloadSchemaVersion:'2.0.0'}).code,'EVENT_PAYLOAD_VERSION_INCOMPATIBLE');
  assert.equal(p.validateCompatibility({...e,eventType:'UNKNOWN'}).code,'EVENT_TYPE_UNKNOWN');
  assert.equal(p.validateCompatibility({...e,payload:{contextSealBypass:true}}).code,'EVENT_AUTHORITY_VIOLATION');
  assert.throws(()=>p.publish({eventType:SceneEventType.SCENE_STATE_DELTA,sceneId:'s',sceneRevision:1,payload:{contextSealBypass:true}}),(err)=>err.code==='EVENT_AUTHORITY_VIOLATION');
});

test('Scene event Runtime sink preserves envelope metadata and dedupe remains idempotent',()=>{
  const calls=[];const p=new SceneEventPublisher();const sink=p.runtimeSink({emit:(type,payload,meta)=>{calls.push({type,payload,meta});return {type,payload,meta};}});
  const event=p.publish({eventType:SceneEventType.LOCATION_CHANGED,sceneId:'s',sceneRevision:3,sourceRevisionRefs:['r3'],payload:{location:'Street'},dedupeKey:'loc3',correlationId:'corr',causationId:'cause',turnId:'t3'});
  sink(event);const duplicate=p.publish({eventType:SceneEventType.LOCATION_CHANGED,sceneId:'s',sceneRevision:3,sourceRevisionRefs:['r3'],payload:{location:'Street'},dedupeKey:'loc3'});
  assert.equal(calls.length,1);assert.equal(calls[0].meta.sceneRevision,3);assert.deepEqual(calls[0].meta.revisionFences.sourceRevisionIds,['r3']);assert.equal(duplicate.eventId,event.eventId);
});

test('stale Scene event is detectable after Scene revision advances',()=>{
  const p=new SceneEventPublisher();const e=p.publish({eventType:SceneEventType.SCENE_STATE_DELTA,sceneId:'s',sceneRevision:8,payload:{delta:true},dedupeKey:'r8'});
  assert.equal(p.isFresh(e,9),false);assert.equal(p.isFresh(e,8),true);
});

test('PrefetchRecommendation matches Coprocessor warmer input and supersedes on next Scene revision',()=>{
  const p=new ScenePrefetchTrigger();const r=p.recommend({sceneId:'s',sceneRevision:14,trigger:'LOCATION',entityRefs:['Mara'],locationRefs:['Tavern'],threadRefs:['Blade'],sceneRefs:['old'],priority:'HIGH',evidenceRefs:['e14'],sourceRevisionRefs:['src14']});
  for(const key of ['recommendationId','sceneId','sceneRevision','trigger','entityRefs','locationRefs','threadRefs','sceneRefs','priority','expiryRevision','evidenceRefs','authority','status'])assert.ok(key in r);
  assert.equal(r.authority,'NONE');assert.deepEqual(r.sourceRevisionSet,['src14']);assert.equal(p.isFresh(r,{sceneId:'s',sceneRevision:14}),true);
  p.cancelSuperseded({sceneId:'s',sceneRevision:15});const stored=p.pending.get(r.recommendationId);assert.equal(stored.status,'CANCELLED');assert.equal(p.isFresh(stored,{sceneId:'s',sceneRevision:15}),false);
});

test('Context invalidation signal is idempotent and never deletes evidence or mutates Core',()=>{
  const seen=[];const p=new SceneContextInvalidationPublisher({sink:(x)=>seen.push(x)});
  const input={fromSceneId:'a',fromRevision:8,toSceneId:'b',toRevision:1,relationship:'CONTINUES',sourceRevisionRefs:['r'],evidenceRefs:['e']};
  const a=p.publish(input),b=p.publish(input);assert.equal(a.invalidationId,b.invalidationId);assert.equal(seen.length,1);assert.equal(p.size(),1);
  assert.equal(a.deleteEvidence,false);assert.equal(a.contextMutationAuthority,false);assert.ok(a.invalidatedScopes.includes('SCENE_COMPILED_CONTEXT'));
});

test('Clapperboard emits resume invalidation with same conceptual resumed Scene revision change',()=>{
  const registry=new SceneRegistry(),stack=new SceneStack(),episodeCompiler=new SceneEpisodeCompiler(),graph=new SceneGraph(),publisher=new SceneEventPublisher(),prefetchTrigger=new ScenePrefetchTrigger(),seen=[];
  const contextInvalidationPublisher=new SceneContextInvalidationPublisher({sink:(x)=>seen.push(x)});
  registry.openScene({sceneId:'A',sourceRevisionRefs:['a1']});stack.open({sceneId:'A'});
  const tm=new ClapperboardTransitionManager({registry,stack,episodeCompiler,graph,publisher,prefetchTrigger,contextInvalidationPublisher});
  tm.transition({decision:confirmed('int'),fromSceneId:'A',nextSceneId:'B',relationship:SceneRelationship.INTERRUPTS,evidenceRefs:['e:int'],sourceRevisionRefs:['b1']});
  const suspendedRevision=registry.current('A').revision;
  const ret=tm.transition({decision:confirmed('ret'),fromSceneId:'B',nextSceneId:'A',relationship:SceneRelationship.RESUMES,evidenceRefs:['e:return'],sourceRevisionRefs:['a2']});
  const signal=seen.at(-1);assert.equal(ret.toSceneId,'A');assert.equal(signal.sameConceptualSceneResumed,true);assert.equal(signal.resumedSceneRef.sceneId,'A');assert.equal(signal.resumedSceneRef.fromRevision,suspendedRevision);assert.equal(signal.resumedSceneRef.toRevision,registry.current('A').revision);
});

test('Scene Graph Memory handoff uses references rather than copied graph payloads',()=>{
  const graph=new SceneGraph();graph.addRelationship({fromSceneId:'a',toSceneId:'b',relationship:SceneRelationship.PRECEDES,evidenceRefs:['e:rel']});graph.addMembership({sceneId:'b',refId:'Mara',kind:'ENTITY',evidenceRefs:['e:m']});
  const scene={sceneId:'b',revision:2,sourceRevisionRefs:['r2'],provenance:['e:m']};const set=createGraphReferenceSetFromScene({graph,scene,episodeRefs:[{artifactId:'ep:b',revision:2}]});
  assert.ok(set.relationshipRefs.some(x=>x.includes('SCENE_PRECEDES')));assert.ok(set.entityMembershipRefs.some(x=>x.includes('ENTITY_IN_SCENE')));assert.equal('edges' in set,false);assert.equal(set.memoryMutationAuthority,false);
});

test('Memory proposal stale SceneEpisode reference is detectable',()=>{
  const graphSet={kind:'SceneGraphReferenceSet',sceneId:'s',sceneRevision:4};
  const p=createSceneExperienceProposal({proposalId:'mp1',sceneId:'s',sceneRevision:4,sceneEpisodeRef:{artifactId:'ep:s:4',sourceRevisionSet:['r4']},graphReferenceSet:graphSet,sourceRevisionRefs:['r4'],evidenceRefs:['e4']});
  assert.equal(isSceneExperienceProposalFresh(p,{sceneRevision:4,sourceRevisionRefs:['r4']}),true);
  assert.equal(isSceneExperienceProposalFresh(p,{sceneRevision:5,sourceRevisionRefs:['r5']}),false);assert.equal(p.memoryMutationAuthority,false);assert.equal(p.settlementAuthority,false);
});

test('Scene Graph adjacency remains non-causal in Memory handoff',()=>{
  const graph=new SceneGraph();const edge=graph.addRelationship({fromSceneId:'a',toSceneId:'b',relationship:SceneRelationship.PRECEDES,evidenceRefs:['order']});assert.equal(edge.causal,false);assert.equal('causedBy' in edge,false);
});

test('Object mention never creates possession or durable proposal',()=>{
  const tracker=new ObjectStateTracker();const mention=tracker.mention('Sun Blade','e:q');assert.equal(mention.state,ObjectPresence.MENTIONED_ONLY);assert.equal(mention.durableProposal,null);assert.equal(mention.holderId,undefined);
});

test('Object transfer proposal preserves Eris -> Mara holder transition with evidence',()=>{
  const tracker=new ObjectStateTracker();const obs=tracker.transfer({sceneId:'s',sceneRevision:7,objectId:'Blade',fromHolderId:'Eris',toHolderId:'Mara',evidenceRef:'e:give',sourceRevisionRefs:['r7']});
  const p=obs.durableProposal;assert.equal(p.before.holderId,'Eris');assert.equal(p.after.holderId,'Mara');assert.equal(p.after.state,ObjectPresence.HELD);assert.deepEqual(p.evidenceRefs,['e:give']);assert.equal(p.directSettlement,false);
});

test('Object destruction and uncertain/hidden proposals remain proposal-only',()=>{
  const tracker=new ObjectStateTracker();const destroyed=tracker.destroy({sceneId:'s',sceneRevision:8,objectId:'Blade',evidenceRef:'e:break',sourceRevisionRefs:['r8']});assert.equal(destroyed.durableProposal.after.state,ObjectPresence.DESTROYED);
  const uncertain=tracker.uncertain({sceneId:'s',sceneRevision:9,objectId:'Blade',evidenceRef:'e:rubble',sourceRevisionRefs:['r9'],confidence:.4});assert.equal(uncertain.state,ObjectPresence.UNCERTAIN);assert.equal(uncertain.observationClass,ObservationClass.UNRESOLVED);assert.equal(uncertain.durableProposal.observationClass,ObservationClass.UNRESOLVED);
  const hidden=tracker.hide({sceneId:'s',sceneRevision:10,objectId:'Blade',evidenceRef:'e:hide'});assert.equal(hidden.state,ObjectPresence.HIDDEN);
});

test('Object proposal rejects direct Settlement authority',()=>{
  assert.throws(()=>createObjectStateTransitionProposal({proposalId:'p',sceneId:'s',sceneRevision:1,objectRef:'Blade',after:{state:'HELD'},settlementAuthority:true}),/cannot grant authority/);
});

test('Atmosphere anti-feedback: prior tense Scene does not seed neutral next Scene',async()=>{
  const {AtmosphereTracker}=await import('../src/scene/atmosphere.js');const t=new AtmosphereTracker();
  const prior=t.update({revision:2,evidenceRefs:['e:tension'],dimensions:{tension:{score:.9,confidence:.9}}});assert.equal(prior.observationClass,ObservationClass.INFERRED);
  const next=t.nextScene({revision:1,evidenceRefs:[],dimensions:{}});assert.equal(next.observationClass,ObservationClass.UNKNOWN);assert.deepEqual(next.value,{});
});

test('Scene UI read model is read-only, revision-fenced and preserves epistemic distinctions',()=>{
  const scene={sceneId:'ui',revision:7,lifecycle:'OPEN',sourceRevisionRefs:['r7'],provenance:['e:ui'],unresolvedFields:['immediateObjects'],fields:{
    location:field({location:'Tavern'},7,['e:loc']),narrativeTime:field({label:'Late'},7,['e:t']),
    activeCast:field([{characterId:'Mara',state:'PRESENT'},{characterId:'Eris',state:'MENTIONED_ONLY'}],7,['e:c']),
    activeThreads:field(['Blade'],7,['e:th']),
    immediateObjects:field([{objectId:'Blade',state:ObjectPresence.UNCERTAIN,observationClass:ObservationClass.UNRESOLVED}],7,['e:o'],ObservationClass.UNRESOLVED,.4),
    atmosphere:field({tension:{score:.7}},7,['e:a'],ObservationClass.INFERRED,.8),
    boundaryState:field(null,7,[],ObservationClass.UNKNOWN,0),
  }};
  const model=createSceneUiReadModel({scene,relationshipToPrior:'CONTINUES',prefetchRecommendations:[]});
  assert.equal(model.revision,7);assert.equal(isSceneUiReadModelFresh(model,{sceneId:'ui',revision:8}),false);assert.equal(model.health.state,SceneUiHealth.DEGRADED);assert.equal(model.health.generalStatus,'warning');assert.equal(model.health.productHealth,'DEGRADED');
  assert.equal(model.activeCast[1].state,'MENTIONED_ONLY');assert.equal(model.objects[0].state,ObjectPresence.UNCERTAIN);assert.equal(model.atmosphere.inferred,true);assert.equal(model.atmosphere.canonical,false);
  assert.equal(model.mutationAuthority,false);assert.ok(Object.isFrozen(model));assert.throws(()=>{model.lifecycle='CLOSED'},TypeError);
});

test('UI read model missing provenance reports degraded health',()=>{
  const scene={sceneId:'ui2',revision:1,lifecycle:'OPEN',sourceRevisionRefs:[],provenance:[],unresolvedFields:[],fields:{}};const model=createSceneUiReadModel({scene});assert.equal(model.health.state,SceneUiHealth.DEGRADED);assert.ok(model.health.reasons.includes('PROVENANCE_MISSING'));
});

test('Scene Why references carry evidence/revision/proposal/transition/event/artifact refs only',()=>{
  const refs=createSceneWhyReferences({evidenceRefs:['e'],sourceRevisionRefs:['r'],proposalIds:['p'],transitionIds:['t'],eventIds:['evt'],artifactRefs:[{artifactId:'ep'}]});assert.deepEqual(refs.evidenceRefs,['e']);assert.equal(refs.artifactRefs[0].artifactId,'ep');assert.equal('explanation' in refs,false);
});

test('SillyTavern host bridge reports unavailable capability instead of pretending support',()=>{
  const bridge=new SillyTavernHostBridge({eventsByActivity:{USER_SEND:'ST_USER_SENT'}});assert.equal(bridge.capability(HostActivity.USER_SEND).status,'HOST_CAPABILITY_AVAILABLE');assert.equal(bridge.capability(HostActivity.DELETE).status,'HOST_CAPABILITY_UNAVAILABLE');assert.equal(bridge.toCanonical('MISSING').status,'HOST_CAPABILITY_UNAVAILABLE');
});

test('Host reattach is source-revision idempotent even independent of event dedupe lookup',()=>{
  const bridge=new SillyTavernHostBridge();const adapter=new NarrativeFeedAdapter({maxDedupe:1});const messages=[{messageId:'m1',messageRevision:1,role:'user',content:'hello'},{messageId:'m2',messageRevision:1,role:'assistant',content:'world'}];
  bridge.reattach(adapter,{chatId:'c',messages});for(let i=0;i<8;i++)adapter.normalize({activity:HostActivity.USER_SEND,chatId:'other',hostEventId:`noise:${i}`,messageId:`n${i}`,messageRevision:1,content:'noise'});
  const again=bridge.reattach(adapter,{chatId:'c',messages});assert.equal(adapter.currentEvidence('c').length,2);assert.equal(again.filter(x=>x.status==='DUPLICATE').length,3);
});

test('Scene assembly manifest is explicit and Core-lane convertible without mutating main',()=>{
  const m=createSceneAssemblyLaneManifest({sourceSha:'abc123',acceptanceEvidence:[{run:'green'}]});assert.equal(m.sourceBranch,'Development-Scene-Scanner');assert.ok(m.productionPaths.includes('src/scene/scene-lifecycle-runtime.js'));assert.ok(m.productionPaths.includes('src/scene/scene-assembly-manifest.js'));assert.ok(m.browserVisiblePaths.includes('src/scene/host-bridge.js'));assert.ok(m.expectedIntegrationAdapters.some(x=>x.includes('Dynamic')||x.includes('Coprocessor')));
  const core=toCoreAssemblyLaneEntry(m);assert.equal(core.sourceSha,'abc123');assert.equal(core.integrationSha,null);assert.equal(core.copiedPaths.length,m.productionPaths.length);
});


test('Scene retrieval exact Episode summary outranks newer near-duplicate with repeated cast context',async()=>{
  const {SceneRetrievalAdapter}=await import('../src/scene/scene-retrieval.js');
  const cast=Array.from({length:40},(_,i)=>({characterId:`C${i}`}));
  const episodes=[
    {episodeId:'old-exact',sceneId:'s10',sceneRevision:10,sourceRange:{},sourceRevisionRefs:['r10'],participants:cast,location:{value:{location:'Zone:10'}},threadsCarried:['thread:10:19'],compactSummary:`Zone:10 | ${cast.map(x=>x.characterId).join(', ')} | thread:10:19`,artifactRef:{artifactId:'old-exact',artifactType:'SceneEpisode',revision:10}},
    {episodeId:'new-near',sceneId:'s99',sceneRevision:99,sourceRange:{},sourceRevisionRefs:['r99'],participants:cast,location:{value:{location:'Zone:99'}},threadsCarried:['thread:99:19'],compactSummary:`Zone:99 | ${cast.map(x=>x.characterId).join(', ')} | thread:99:19`,artifactRef:{artifactId:'new-near',artifactType:'SceneEpisode',revision:99}},
  ];
  const retrieval=new SceneRetrievalAdapter({episodeProvider:episodes});const out=retrieval.retrieve({query:episodes[0].compactSummary,limit:2});
  assert.equal(out[0].sceneId,'s10');assert.equal(out[0].scoreSignals.exactSemantic,1);assert.equal(out[1].scoreSignals.exactSemantic,0);
});


test('Scene publisher sink receives deeply immutable envelope',()=>{
  let sinkEvent=null;const p=new SceneEventPublisher({sink:(e)=>{sinkEvent=e;}});
  p.publish({eventType:SceneEventType.SCENE_OPENED,sceneId:'deep-freeze',sceneRevision:1,sourceRevisionRefs:['r1'],payload:{nested:{value:1}},dedupeKey:'deep-freeze'});
  assert.ok(Object.isFrozen(sinkEvent));assert.ok(Object.isFrozen(sinkEvent.payload));assert.ok(Object.isFrozen(sinkEvent.payload.nested));assert.throws(()=>{sinkEvent.payload.nested.value=2},TypeError);
});

test('rejected boundary decision remains referenceable for diagnostics Why chain',()=>{
  const rt=new SceneLifecycleRuntime();const scene=rt.ensureChatScene('why',{sourceRevisionRefs:['why:r1'],evidenceRefs:['why:r1']});
  const boundary=rt.sceneRuntime.boundary({sceneId:scene.sceneId,evidenceRefs:['why:e1'],signals:{doorway:1,locationTransition:.2}});
  assert.equal(boundary.decision.status,'PENDING');
  const rejected=rt.sceneRuntime.boundaryVerifier.observe(boundary.candidate.candidateId,{contradict:1,evidenceRefs:['why:continue']});assert.equal(rejected.status,'REJECTED');
  const signal=rt.integrationSignal('why');const ref=signal.diagnosticRefs.boundaryDecisionRefs.find((x)=>x.candidateId===boundary.candidate.candidateId);
  assert.equal(ref.status,'REJECTED');assert.equal(ref.reasonCode,'confirmation-window-contradicted');assert.ok(signal.diagnosticRefs.proposalIds.includes(boundary.candidate.candidateId));
});
