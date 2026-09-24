import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {HotUpdateStatus} from '../src/hot-cognition-contracts.js';
import {browserHostConformanceReport} from '../src/browser-host-conformance.js';

const signal=({sceneId='scene:a',sceneRevision=1,source='chat:m1@1',place='room',cast=['mara'],mentioned=[],relationship='CONTINUES',time={mode:'CONTINUOUS',anchor:'now'}}={})=>({
 kind:'SceneIntegrationSignal',contractVersion:'1.0.0',sceneId,sceneRevision,sourceRevisionRefs:[source],sourceRevisionSet:[source],
 location:{value:{location:place},observationClass:'OBSERVED',confidence:1,evidenceRefs:[source]},narrativeTime:{value:time,observationClass:'OBSERVED',confidence:1,evidenceRefs:[source]},
 activeCast:cast.map(characterId=>({characterId,state:'PRESENT',observationClass:'OBSERVED',confidence:1,evidenceRefs:[source]})),castObservations:[...cast.map(characterId=>({characterId,state:'PRESENT'})),...mentioned.map(characterId=>({characterId,state:'MENTIONED_ONLY'}))],activeThreads:[],objects:[],objectObservations:[],uncertainFields:[],conflictSignals:[],boundaryState:{status:'STABLE'},sceneRelationship:relationship,transitionType:relationship,previousSceneRef:null,resumedSceneRef:relationship==='RESUMES'?{sceneId,sceneRevision}:null,episodeRefs:[],retrievalQuality:'HIGH',prefetchRecommendations:[],objectTransitionRefs:[],atmosphere:null,health:{status:'ready',reasons:[]},provenance:[source],diagnosticRefs:{evidenceRefs:[source],eventIds:[]},authority:'DESCRIPTIVE',authorityGranted:false,settlementAuthority:false,canonicalMutationAuthority:false,contextSealBypass:false,runtimeSchedulingAuthority:false,
});

function core(){const c=new Area52CognitiveCore();c.activateHotCognitionChat('chat');return c;}

test('Wave 10 bridge accepts public Scene signal and excludes mentioned-only anchors',()=>{
 const c=core(),r=c.consumeSceneSignal(signal({sceneRevision:1,mentioned:['eris']}));
 assert.equal(r.status,HotUpdateStatus.APPLIED);assert.deepEqual(c.sceneIntegrationSnapshot().activeAnchorIds,['mara']);assert.deepEqual(c.sceneIntegrationSnapshot().mentionedOnlyIds,['eris']);
 const hot=c.hotCognitionSnapshot();assert.deepEqual(hot.segments.ACTIVE_CAST.value.map(x=>x.id),['mara']);
});

test('native SceneDelta FieldState collections normalize through the public event bridge',()=>{
 const c=core();c.consumeSceneSignal(signal({sceneRevision:1,cast:['mara']}));
 const source='chat:m2@1',event={kind:'CognitiveEventEnvelope',eventId:'delta:native:2',eventType:'SCENE_STATE_DELTA',eventVersion:'1.0.0',producer:'SCENE_INTELLIGENCE',correlationId:'corr:native:2',causationId:'host:m2',turnId:'turn:m2',sceneId:'scene:a',sceneRevision:2,sourceRevisionSet:[source],dedupeIdentity:'delta:native:2',payload:{delta:{kind:'SceneDelta',sceneId:'scene:a',fromRevision:1,toRevision:2,changedFields:{activeCast:{before:null,after:{value:[{characterId:'mara',state:'PRESENT'},{characterId:'eris',state:'PRESENT'}],confidence:1,evidenceRefs:[source],observationClass:'OBSERVED',revision:2}},activeThreads:{before:null,after:{value:['native-thread'],confidence:1,evidenceRefs:[source],observationClass:'OBSERVED',revision:2}},immediateObjects:{before:null,after:{value:[{objectRef:'blade',state:'PRESENT'}],confidence:1,evidenceRefs:[source],observationClass:'OBSERVED',revision:2}}}}},payloadSchemaVersion:'1.0.0'};
 const r=c.consumeCognitiveEvent(event),hot=c.hotCognitionSnapshot();assert.notEqual(r.status,HotUpdateStatus.REJECTED);assert.deepEqual(hot.segments.ACTIVE_CAST.value.map(x=>x.id),['eris','mara']);assert.deepEqual(hot.segments.ACTIVE_THREADS.value.map(x=>x.threadId),['native-thread']);assert.deepEqual(hot.segments.ACTIVE_ENTITIES.value.map(x=>x.id),['blade']);
});

test('native field-specific Scene change events unwrap delta after-state',()=>{
 const c=core();c.consumeSceneSignal(signal({sceneRevision:1,cast:['mara']}));const source='chat:m2@1';
 const event={kind:'CognitiveEventEnvelope',eventId:'cast:native:2',eventType:'ACTIVE_CAST_CHANGED',eventVersion:'1.0.0',producer:'SCENE_INTELLIGENCE',correlationId:'corr:cast:2',causationId:'delta:native:2',turnId:'turn:m2',sceneId:'scene:a',sceneRevision:2,sourceRevisionSet:[source],dedupeIdentity:'cast:native:2',payload:{field:'activeCast',change:{before:null,after:{value:[{characterId:'mara',state:'PRESENT'},{characterId:'eris',state:'PRESENT'}],confidence:1,evidenceRefs:[source],observationClass:'OBSERVED',revision:2}}},payloadSchemaVersion:'1.0.0'};
 const r=c.consumeCognitiveEvent(event);assert.notEqual(r.status,HotUpdateStatus.REJECTED);assert.deepEqual(c.hotCognitionSnapshot().segments.ACTIVE_CAST.value.map(x=>x.id),['eris','mara']);assert.ok(c.sceneIntegrationSnapshot().activeAnchorIds.includes('eris'));
});

test('Scene revision fence is per Scene identity, so new Scene r1 can follow old Scene r9',()=>{
 const c=core();c.consumeSceneSignal(signal({sceneId:'scene:a',sceneRevision:9,source:'a@9'}));
 const opened=c.consumeCognitiveEvent({kind:'CognitiveEventEnvelope',eventId:'open:b',eventType:'SCENE_OPENED',eventVersion:'1.0.0',producer:'SCENE_INTELLIGENCE',correlationId:'corr:b',causationId:'boundary:a',turnId:'turn:b',sceneId:'scene:b',sceneRevision:1,sourceRevisionSet:['b@1'],revisionFences:{sourceRevisionIds:['b@1'],sceneRevision:1},dedupeIdentity:'open:b',payload:{relationship:'CONTINUES',fromSceneId:'scene:a'},payloadSchemaVersion:'1.0.0'});
 assert.notEqual(opened.status,HotUpdateStatus.STALE);assert.equal(c.sceneIntegrationSnapshot().sceneId,'scene:b');assert.equal(c.sceneIntegrationSnapshot().sceneRevision,1);
 const next=c.consumeSceneSignal(signal({sceneId:'scene:b',sceneRevision:1,source:'b@1'}));assert.notEqual(next.status,HotUpdateStatus.STALE);assert.equal(c.publication.sceneRevision,1);
});

test('duplicate, stale and conflicting same-revision Scene artifacts are contained',()=>{
 const c=core(),s=signal({sceneRevision:3,source:'m@3'});const first=c.consumeSceneSignal(s),dup=c.consumeSceneSignal(s),conflict=c.consumeSceneSignal({...s,location:{...s.location,value:{location:'elsewhere'}}}),stale=c.consumeSceneSignal(signal({sceneRevision:2,source:'m@2'}));
 assert.equal(first.status,HotUpdateStatus.APPLIED);assert.equal(dup.status,HotUpdateStatus.DUPLICATE);assert.equal(conflict.status,HotUpdateStatus.REJECTED);assert.equal(stale.status,HotUpdateStatus.STALE);assert.equal(c.sceneIntegrationSnapshot().sceneRevision,3);
});

test('boundary candidate is descriptive and does not reset current Scene',()=>{
 const c=core();c.consumeSceneSignal(signal({sceneRevision:4}));const before=c.hotCognitionSnapshot();const r=c.consumeCognitiveEvent({kind:'CognitiveEventEnvelope',eventId:'candidate:1',eventType:'SCENE_BOUNDARY_CANDIDATE',eventVersion:'1.0.0',producer:'SCENE_INTELLIGENCE',correlationId:'corr',causationId:null,turnId:'turn',sceneId:'scene:a',sceneRevision:4,sourceRevisionSet:['chat:m1@1'],dedupeIdentity:'candidate:1',payload:{candidate:{candidateId:'c1'}},payloadSchemaVersion:'1.0.0'});const after=c.hotCognitionSnapshot();
 assert.equal(r.reasonCode,'SCENE_BOUNDARY_CANDIDATE_ONLY');assert.equal(after.sceneId,before.sceneId);assert.equal(after.segments.LOCATION.value.location,before.segments.LOCATION.value.location);
});

test('Scene context invalidation is targeted, idempotent, and never deletes evidence',()=>{
 const c=core();c.consumeSceneSignal(signal({sceneRevision:2,source:'chat:m2@1'}));const sig={kind:'SceneContextInvalidationSignal',contractVersion:'1.0.0',invalidationId:'inv:1',fromSceneRef:{sceneId:'scene:a',sceneRevision:2},toSceneRef:{sceneId:'scene:b',sceneRevision:1},resumedSceneRef:null,relationship:'CONTINUES',invalidatedScopes:['SCENE_COMPILED_CONTEXT','SCENE_RETRIEVAL_CONTEXT'],sourceRevisionRefs:['chat:m2@1'],evidenceRefs:['ev:2'],reason:'SCENE_TRANSITION',activeSceneIdentityChanged:true,sameConceptualSceneResumed:false,deleteEvidence:false,authority:'NONE',authorityGranted:false,contextMutationAuthority:false,contextSealBypass:false};
 const r=c.consumeSceneContextInvalidation(sig),dup=c.consumeSceneContextInvalidation(sig);assert.equal(r.details.deleteEvidence,false);assert.ok(r.invalidatedSegments.includes('SCENE'));assert.ok(r.invalidatedSegments.includes('CONTINUITY'));assert.equal(dup.status,HotUpdateStatus.DUPLICATE);
});

test('real Scene trace reaches Cognitive Choice, Seal, PromptPlan and read model',()=>{
 const c=core();c.consumeSceneSignal(signal({sceneRevision:1,source:'chat:m1@1'}));const published=c.publishGenerationContext({turnId:'turn:1',correlationId:'corr:1',query:'Continue the current scene.',intent:'CURRENT',anchorEntityIds:[],sealedAt:1});const delivered=c.deliverGenerationContext({published,generationId:'gen:1',modelProfileId:'RECENCY_WEIGHTED',userInput:'Continue the current scene.'});const read=c.observation.contextReceipt({published,delivery:delivered});
 assert.equal(published.sceneIntegration.sceneId,'scene:a');assert.equal(published.gatherReceipt.sceneRevision,1);assert.equal(published.sealReceipt.sceneRevision,1);assert.equal(delivered.plan.sceneRevision,1);assert.equal(delivered.plan.diagnosticReceipt.sceneIntegration.sceneId,'scene:a');assert.equal(read.sceneId,'scene:a');assert.ok(published.packet.sceneIntegration.provenanceRefs.includes('chat:m1@1'));
});

test('Wave 10 production bridge remains browser-host safe',()=>{
 const paths=['src/scene-core-integration.js','src/hot-cognition-runtime.js','src/cognitive-core.js','src/generation-publication.js','src/cognitive-choice-controller.js'];const report=browserHostConformanceReport(paths.map(path=>({path,source:readFileSync(new URL('../'+path,import.meta.url),'utf8')})));assert.equal(report.pass,true,JSON.stringify(report.results,null,2));
});
