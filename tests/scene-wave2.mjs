import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoundaryStatus, ClapperboardTransitionManager, NarrativeFeedAdapter, ObjectPresence, ObservationClass,
  SceneEpisodeCompiler, SceneEventPublisher, SceneEventType, SceneGraph, SceneGraphEdgeType, SceneIntelligenceRuntime,
  SceneLifecycleRuntime, ScenePrefetchTrigger, SceneRegistry, SceneRelationship, SceneRetrievalAdapter, SceneStack,
  TransitionStatus, createFieldState, exportSceneLifecycleState, importSceneLifecycleState,
} from '../src/scene/index.js';

const field=(value,revision=2,observationClass=ObservationClass.OBSERVED,confidence=1,evidenceRefs=['e:1'],metadata={})=>createFieldState({value,revision,observationClass,confidence,evidenceRefs,metadata});
const confirmed=(id='c1',boundaryType='EXPLICIT_BREAK')=>({status:BoundaryStatus.CONFIRMED,candidateId:id,boundaryType,evidenceRefs:[`e:${id}`]});

function deps(){
  const registry=new SceneRegistry();const stack=new SceneStack();const episodeCompiler=new SceneEpisodeCompiler();const graph=new SceneGraph();const events=[];const publisher=new SceneEventPublisher({sink:(e)=>events.push(e)});const prefetchTrigger=new ScenePrefetchTrigger();
  return {registry,stack,episodeCompiler,graph,publisher,prefetchTrigger,events};
}

test('Scene Stack suspends main scene for flashback and resumes same conceptual identity',()=>{
  const stack=new SceneStack();stack.open({sceneId:'main'});stack.open({sceneId:'flash',relationshipToPrior:SceneRelationship.FLASHBACK_OF,interruptedSceneId:'main'});
  assert.equal(stack.activeSceneId,'flash');assert.equal(stack.frames.find(x=>x.sceneId==='main').suspended,true);
  stack.close('flash');const resumed=stack.resume('main',{evidenceRefs:['e:return']});assert.equal(resumed.sceneId,'main');assert.equal(resumed.relationshipToPrior,SceneRelationship.RESUMES);assert.equal(stack.activeSceneId,'main');
});

test('parallel scene is represented as parallel and does not become PRECEDES',()=>{
  const stack=new SceneStack();stack.open({sceneId:'a'});stack.open({sceneId:'b',relationshipToPrior:SceneRelationship.PARALLEL_TO,interruptedSceneId:'a'});
  assert.equal(stack.frames.find(x=>x.sceneId==='b').relationshipToPrior,SceneRelationship.PARALLEL_TO);assert.equal(stack.frames.find(x=>x.sceneId==='a').suspended,true);
});

test('impossible resume of unknown scene is rejected',()=>{const stack=new SceneStack();assert.throws(()=>stack.resume('missing'),/unknown scene/)});
test('self interruption is rejected',()=>{const stack=new SceneStack();stack.open({sceneId:'a'});stack.close('a');assert.throws(()=>stack.open({sceneId:'a2',relationshipToPrior:SceneRelationship.INTERRUPTS,interruptedSceneId:'a2'}),/interrupt itself/)});

test('SceneEpisode is derived, provenance backed and preserves uncertainty',()=>{
  const registry=new SceneRegistry();const rt=new SceneIntelligenceRuntime({registry});rt.open({sceneId:'s1',sourceRevisionRefs:['chat:r1'],provenance:['e:open']});
  const objects=[{objectId:'Blade',state:ObjectPresence.HELD,holderId:'Eris',confidence:1,evidenceRefs:['e:blade'],durableProposal:{type:'OBJECT_STATE_CHANGE',state:'HELD',objectId:'Blade'}}];
  rt.observe({sceneId:'s1',proposalId:'p1',sourceRevisionRefs:['chat:r1'],evidenceRefs:['e:1'],fields:{
    activeCast:field([{characterId:'Eris',state:'PRESENT',confidence:1,evidenceRefs:['e:cast']}],2,ObservationClass.OBSERVED,1,['e:cast']),
    location:field({location:'Ember Tavern'},2,ObservationClass.OBSERVED,1,['e:loc']),
    immediateObjects:field(objects,2,ObservationClass.OBSERVED,1,['e:blade']),
    activeThreads:field(['Where is Mara?'],2,ObservationClass.UNRESOLVED,.5,['e:thread']),
    atmosphere:field({tension:{score:.7}},2,ObservationClass.INFERRED,.8,['e:vibe'])
  }});
  const scene=registry.current('s1');const compiler=new SceneEpisodeCompiler();const ep=compiler.compile({scene,record:registry.get('s1')});
  assert.equal(ep.authority,'DERIVED');assert.equal(ep.observationSummary.activeThreads.observationClass,ObservationClass.UNRESOLVED);assert.equal(ep.objectTransitions[0].authority,'OBSERVED_SCENE_ONLY');assert.equal(ep.atmosphereTrajectory[0].observationClass,ObservationClass.INFERRED);assert.ok(ep.provenance.includes('e:thread'));assert.equal(ep.artifactRef.artifactType,'SceneEpisode');
});

test('SceneEpisode compilation is deterministic and idempotent for same revision/source set',()=>{
  const registry=new SceneRegistry();registry.openScene({sceneId:'s1',sourceRevisionRefs:['r1']});const compiler=new SceneEpisodeCompiler();const scene=registry.current('s1');const a=compiler.compile({scene,record:registry.get('s1')});const b=compiler.compile({scene,record:registry.get('s1')});assert.deepEqual(a,b);assert.equal(compiler.list().length,1);
});

test('source edit creates a new episode revision rather than rewriting prior episode',()=>{
  const registry=new SceneRegistry();registry.openScene({sceneId:'s1',sourceRevisionRefs:['r1']});const compiler=new SceneEpisodeCompiler();const first=compiler.compile({scene:registry.current('s1'),record:registry.get('s1')});
  registry.reviseSource('s1',{sourceRevisionRef:'r2',affectedFields:[],evidenceRefs:['edit:r2']});const second=compiler.compile({scene:registry.current('s1'),record:registry.get('s1')});
  assert.notEqual(first.episodeId,second.episodeId);assert.equal(first.sceneRevision,1);assert.equal(second.sceneRevision,2);
});

test('Scene Graph adjacency never implies causality',()=>{
  const graph=new SceneGraph();const e=graph.addRelationship({fromSceneId:'a',toSceneId:'b',relationship:SceneRelationship.PRECEDES,evidenceRefs:['e:order']});
  assert.equal(e.edgeType,SceneGraphEdgeType.SCENE_PRECEDES);assert.equal(e.causal,false);assert.equal('causedBy' in e,false);
});

test('Scene Graph membership carries evidence',()=>{
  const graph=new SceneGraph();const e=graph.addMembership({sceneId:'a',refId:'Eris',kind:'ENTITY',evidenceRefs:['e:eris'],provenance:['episode:a']});assert.deepEqual(e.evidenceRefs,['e:eris']);assert.equal(e.edgeType,SceneGraphEdgeType.ENTITY_IN_SCENE);
});

test('Scene retrieval returns bounded references and drill-down metadata',()=>{
  const graph=new SceneGraph();graph.addRelationship({fromSceneId:'old',toSceneId:'current',relationship:SceneRelationship.PRECEDES,evidenceRefs:['e:rel']});
  const episodes=[{episodeId:'episode:old:2',sceneId:'old',sceneRevision:2,sourceRange:{start:1,end:5},sourceRevisionRefs:['r1'],participants:[{characterId:'Eris'}],location:{value:{location:'Ember Tavern'}},threadsCarried:['Sun Blade'],compactSummary:'Eris searched Ember Tavern for Sun Blade',artifactRef:{artifactId:'episode:old:2',artifactType:'SceneEpisode',revision:2}}];
  const retrieval=new SceneRetrievalAdapter({episodeProvider:episodes,graph});const out=retrieval.retrieve({query:'Sun Blade at Ember Tavern',activeEntityRefs:['Eris'],locationRef:'Ember Tavern',currentSceneId:'current'});
  assert.equal(out.length,1);assert.equal(out[0].episodeRef.artifactId,'episode:old:2');assert.deepEqual(out[0].sourceRange,{start:1,end:5});assert.ok(out[0].scoreSignals.semantic>0);assert.equal(out[0].relationshipToCurrentScene,SceneGraphEdgeType.SCENE_PRECEDES);
});

test('stale episode source revision is rejected from retrieval',()=>{
  const episodes=[{episodeId:'e1',sceneId:'s1',sceneRevision:1,sourceRange:{},sourceRevisionRefs:['old'],participants:[],threadsCarried:[],compactSummary:'hello',artifactRef:{artifactId:'e1',artifactType:'SceneEpisode',revision:1}}];
  const r=new SceneRetrievalAdapter({episodeProvider:episodes,isSourceRevisionCurrent:(x)=>x!=='old'});assert.equal(r.retrieve({query:'hello'}).length,0);
});

test('prefetch recommendations expire and superseded revisions cancel',()=>{
  const p=new ScenePrefetchTrigger({defaultTtlRevisions:2});const a=p.recommend({sceneId:'s1',sceneRevision:2,trigger:'LOCATION',locationRefs:['Tavern'],evidenceRefs:['e:loc']});assert.equal(p.active({sceneId:'s1',sceneRevision:2}).length,1);p.cancelSuperseded({sceneId:'s1',sceneRevision:3});assert.equal(p.active({sceneId:'s1',sceneRevision:3}).length,0);const b=p.recommend({sceneId:'s1',sceneRevision:4,trigger:'THREAD',threadRefs:['Blade'],evidenceRefs:['e:t']});p.expire({sceneId:'s1',sceneRevision:7});assert.equal(p.active({sceneId:'s1',sceneRevision:7}).length,0);assert.notEqual(a.recommendationId,b.recommendationId);
});

test('Scene event publication is immutable and deduplicated',()=>{
  const events=[];const p=new SceneEventPublisher({sink:(e)=>events.push(e)});const input={eventType:SceneEventType.SCENE_OPENED,sceneId:'s1',sceneRevision:1,sourceRevisionRefs:['r1'],payload:{x:1},dedupeKey:'open:s1'};const a=p.publish(input);const b=p.publish(input);assert.equal(events.length,1);assert.equal(a.eventId,b.eventId);assert.ok(Object.isFrozen(a));assert.ok(Object.isFrozen(a.payload));assert.throws(()=>{a.payload.x=2},TypeError);
});

test('Scene event envelope maps cleanly to Runtime Event Spine metadata',()=>{
  const p=new SceneEventPublisher();const e=p.publish({eventType:SceneEventType.SCENE_STATE_DELTA,sceneId:'s1',sceneRevision:4,sourceRevisionRefs:['r4'],payload:{deltaId:'d4'},dedupeKey:'d4',correlationId:'corr',causationId:'cause',turnId:'t4'});const args=p.runtimeEmitArgs(e);assert.equal(args.eventType,SceneEventType.SCENE_STATE_DELTA);assert.equal(args.meta.sceneRevision,4);assert.equal(args.meta.dedupeKey,'d4');assert.equal(args.meta.correlationId,'corr');
});

test('linear transition compiles one episode, closes old scene and opens next',()=>{
  const d=deps();d.registry.openScene({sceneId:'a',sourceRevisionRefs:['r1']});d.stack.open({sceneId:'a'});const tm=new ClapperboardTransitionManager(d);const result=tm.transition({decision:confirmed('c-linear'),fromSceneId:'a',nextSceneId:'b',relationship:SceneRelationship.CONTINUES,evidenceRefs:['e:cut'],sourceRevisionRefs:['r2'],expectedSceneRevision:1});
  assert.equal(result.status,TransitionStatus.COMPLETE);assert.equal(d.registry.get('a').lifecycle,'CLOSED');assert.equal(d.registry.get('b').lifecycle,'OPEN');assert.equal(d.episodeCompiler.list().length,1);assert.ok(d.graph.relation('a','b'));assert.equal(d.stack.activeSceneId,'b');
});

test('duplicate transition confirmation cannot duplicate episode, scene or graph edge',()=>{
  const d=deps();d.registry.openScene({sceneId:'a'});d.stack.open({sceneId:'a'});const tm=new ClapperboardTransitionManager(d);const decision=confirmed('same');const a=tm.transition({decision,fromSceneId:'a',nextSceneId:'b',relationship:SceneRelationship.CONTINUES,evidenceRefs:['e'],sourceRevisionRefs:['r']});const b=tm.transition({decision,fromSceneId:'a',nextSceneId:'b',relationship:SceneRelationship.CONTINUES,evidenceRefs:['e'],sourceRevisionRefs:['r']});assert.equal(a.status,TransitionStatus.COMPLETE);assert.equal(b.status,TransitionStatus.DUPLICATE);assert.equal(d.episodeCompiler.list().length,1);assert.equal(d.registry.list().length,2);assert.equal(d.graph.neighbors('a').filter(x=>x.edgeType===SceneGraphEdgeType.SCENE_CONTINUES).length,1);
});

test('stale transition result is revision fenced',()=>{
  const d=deps();d.registry.openScene({sceneId:'a'});d.stack.open({sceneId:'a'});const scene=d.registry.current('a');scene.revision=2;d.registry.commit(scene);const tm=new ClapperboardTransitionManager(d);const r=tm.transition({decision:confirmed('stale'),fromSceneId:'a',nextSceneId:'b',relationship:SceneRelationship.CONTINUES,expectedSceneRevision:1});assert.equal(r.status,TransitionStatus.STALE);assert.equal(d.registry.get('b'),null);
});

test('episode compiler failure leaves recoverable closed scene and opens next with EPISODE_PENDING',()=>{
  const d=deps();d.registry.openScene({sceneId:'a'});d.stack.open({sceneId:'a'});d.episodeCompiler.compile=()=>{throw new Error('compile failed')};const tm=new ClapperboardTransitionManager(d);const r=tm.transition({decision:confirmed('partial'),fromSceneId:'a',nextSceneId:'b',relationship:SceneRelationship.CONTINUES,evidenceRefs:['e']});assert.equal(r.status,TransitionStatus.EPISODE_PENDING);assert.equal(d.registry.get('a').lifecycle,'CLOSED');assert.equal(d.registry.get('b').lifecycle,'OPEN');
});

test('flashback transition suspends main scene without advancing its current-world time',()=>{
  const d=deps();d.registry.openScene({sceneId:'main'});d.stack.open({sceneId:'main'});const mainBefore=d.registry.current('main');const tm=new ClapperboardTransitionManager(d);const r=tm.transition({decision:confirmed('flash','FLASHBACK'),fromSceneId:'main',nextSceneId:'past',relationship:SceneRelationship.FLASHBACK_OF,evidenceRefs:['e:flash']});assert.equal(r.status,TransitionStatus.COMPLETE);assert.equal(d.registry.get('main').lifecycle,'SUSPENDED');assert.equal(d.stack.activeSceneId,'past');assert.equal(d.registry.current('main').fields.narrativeTime.value,mainBefore.fields.narrativeTime.value);assert.equal(d.graph.relation('main','past').edgeType,SceneGraphEdgeType.SCENE_FLASHBACK);
});

test('interrupted scene resumes same conceptual ID after temporary scene closes',()=>{
  const d=deps();d.registry.openScene({sceneId:'main'});d.stack.open({sceneId:'main'});const tm=new ClapperboardTransitionManager(d);tm.transition({decision:confirmed('int'),fromSceneId:'main',nextSceneId:'interrupt',relationship:SceneRelationship.INTERRUPTS,evidenceRefs:['e:int']});const r=tm.transition({decision:confirmed('ret'),fromSceneId:'interrupt',nextSceneId:'main',relationship:SceneRelationship.RESUMES,evidenceRefs:['e:return']});assert.equal(r.toSceneId,'main');assert.equal(r.resumed,true);assert.equal(d.registry.get('main').lifecycle,'OPEN');assert.equal(d.stack.activeSceneId,'main');assert.equal(d.registry.list().filter(x=>x.sceneId==='main').length,1);
});

test('Scene lifecycle export/import preserves stack, registry, episodes and graph',()=>{
  const d=deps();d.registry.openScene({sceneId:'a'});d.stack.open({sceneId:'a'});const tm=new ClapperboardTransitionManager(d);tm.transition({decision:confirmed('save'),fromSceneId:'a',nextSceneId:'b',relationship:SceneRelationship.CONTINUES,evidenceRefs:['e']});const state=exportSceneLifecycleState({...d,transitionManager:tm,narrativeFeed:new NarrativeFeedAdapter()});const json=JSON.parse(JSON.stringify(state));const restored=importSceneLifecycleState(json);assert.equal(restored.registry.get('a').lifecycle,'CLOSED');assert.equal(restored.registry.get('b').lifecycle,'OPEN');assert.equal(restored.stack.activeSceneId,'b');assert.equal(restored.episodeCompiler.list().length,1);assert.ok(restored.graph.relation('a','b'));
});

test('SceneLifecycleRuntime exposes provider-neutral lifecycle signal artifact',()=>{
  const rt=new SceneLifecycleRuntime();rt.ensureChatScene('chat1',{sourceRevisionRefs:['r1'],evidenceRefs:['r1']});const s=rt.publicSignalArtifact('chat1');assert.equal(s.sceneRevision,1);assert.ok('sceneRelationship' in s);assert.ok(Array.isArray(s.episodeRefs));assert.ok(Object.values({HIGH:'HIGH',MIXED:'MIXED',LOW:'LOW'}).includes(s.retrievalQuality));
});


test('late Episode compiled for prior revision is rejected as stale after source edit',()=>{
  const registry=new SceneRegistry();registry.openScene({sceneId:'late',sourceRevisionRefs:['r1']});const compiler=new SceneEpisodeCompiler();const old=compiler.compile({scene:registry.current('late'),record:registry.get('late')});registry.reviseSource('late',{sourceRevisionRef:'r2',affectedFields:[],evidenceRefs:['e:r2']});const current=registry.current('late');assert.equal(compiler.validateFreshness(old,current),false);const fresh=compiler.compile({scene:current,record:registry.get('late')});assert.equal(compiler.validateFreshness(fresh,current),true);
});

test('interrupt -> reload -> temporary close -> resume preserves same Scene identity and no duplicate Episode',()=>{
  const d=deps();d.registry.openScene({sceneId:'A',sourceRevisionRefs:['a:r1']});d.stack.open({sceneId:'A'});const tm=new ClapperboardTransitionManager(d);
  tm.transition({decision:confirmed('interrupt-reload'),fromSceneId:'A',nextSceneId:'B',relationship:SceneRelationship.INTERRUPTS,evidenceRefs:['e:int'],sourceRevisionRefs:['b:r1']});
  const state=JSON.parse(JSON.stringify(exportSceneLifecycleState({...d,transitionManager:tm,narrativeFeed:new NarrativeFeedAdapter()})));const restored=importSceneLifecycleState(state);
  const events=[];const publisher=new SceneEventPublisher({sink:(e)=>events.push(e)});const deps2={registry:restored.registry,stack:restored.stack,episodeCompiler:restored.episodeCompiler,graph:restored.graph,publisher,prefetchTrigger:restored.prefetchTrigger};
  const tm2=ClapperboardTransitionManager.importState(restored.transitionState,deps2);
  const r=tm2.transition({decision:confirmed('resume-reload'),fromSceneId:'B',nextSceneId:'A',relationship:SceneRelationship.RESUMES,evidenceRefs:['e:return'],sourceRevisionRefs:['a:r2']});
  assert.equal(r.toSceneId,'A');assert.equal(restored.registry.get('A').lifecycle,'OPEN');assert.equal(restored.stack.activeSceneId,'A');assert.equal(restored.registry.list().filter(x=>x.sceneId==='A').length,1);assert.equal(restored.episodeCompiler.list().filter(x=>x.sceneId==='B').length,1);
});

test('Scene event publisher exposes descriptors compatible with Runtime EventTypeRegistry registration',()=>{
  const p=new SceneEventPublisher();const descriptors=p.descriptors();assert.ok(descriptors.some(x=>x.eventType===SceneEventType.SCENE_CLOSED));assert.ok(descriptors.every(x=>x.schemaVersion==='1.0'&&x.producer==='SCENE_INTELLIGENCE'&&x.payloadSchema.allowUnknown===true));
});

test('SceneEpisode ArtifactReference matches shared Cognitive Data Plane 1.0 vocabulary',()=>{
  const registry=new SceneRegistry();registry.openScene({sceneId:'ref-scene',sourceRevisionRefs:['src:r1']});const compiler=new SceneEpisodeCompiler();const ep=compiler.compile({scene:registry.current('ref-scene'),record:registry.get('ref-scene')});const ref=ep.artifactRef;
  assert.equal(ref.kind,'ArtifactReference');assert.equal(ref.contractVersion,'1.0.0');assert.equal(ref.owner,'SCENE_INTELLIGENCE');assert.equal(ref.storageDomain,'artifacts');assert.equal(ref.sceneRevision,ep.sceneRevision);assert.deepEqual(ref.sourceRevisionSet,['src:r1']);assert.equal(ref.contentHash,ref.digest);assert.equal(ref.authorityGranted,false);assert.equal(ref.settlementAuthority,false);assert.equal(ref.contextSealBypass,false);
});

test('Scene event envelope carries both Runtime and CognitiveEventEnvelope revision vocabulary',()=>{
  const p=new SceneEventPublisher();const e=p.publish({eventType:SceneEventType.SCENE_OPENED,sceneId:'evt-scene',sceneRevision:3,sourceRevisionRefs:['src:3'],payload:{opened:true},dedupeKey:'evt-open'});
  assert.equal(e.kind,'CognitiveEventEnvelope');assert.equal(e.eventVersion,'1.0.0');assert.equal(e.payloadSchemaVersion,'1.0.0');assert.deepEqual(e.sourceRevisionSet,['src:3']);assert.deepEqual(e.revisionFences.sourceRevisionIds,['src:3']);assert.equal(e.revisionFences.sceneRevision,3);assert.equal(e.dedupeIdentity,'evt-open');
});
