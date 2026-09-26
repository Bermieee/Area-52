import test from 'node:test';
import assert from 'node:assert/strict';
import {Area52NativeBrain} from '../src/native-brain.js';
import {createWave11LiveReceiptBinding} from '../src/ui-core/wave11-live-bindings.js';

const LIVE_CHAT='Akira Kagenou - 2026-09-16@18h19m27s303ms imported';
const LIVE_REF='sillytavern:'+LIVE_CHAT+':message:389:1f2b3f0b@1';

function liveScene({sceneRevision=1,sourceRevisionRef=LIVE_REF}={}){
  return{
    kind:'SceneIntegrationSignal',contractVersion:'1.0.0',
    chatNamespace:LIVE_CHAT,chatId:LIVE_CHAT,
    sceneId:'chat:'+LIVE_CHAT+':scene:1',sceneRevision,
    sourceRevisionRefs:[sourceRevisionRef],provenance:['host-message:389'],
    location:null,narrativeTime:null,activeCast:[],castObservations:[],activeThreads:[],
    objects:[],objectObservations:[],uncertainFields:[],conflictSignals:[],
    boundaryState:{status:'STABLE'},sceneRelationship:'CONTINUES',transitionType:'CONTINUES',
    previousSceneRef:null,resumedSceneRef:null,episodeRefs:[],prefetchRecommendations:[],
    objectTransitionRefs:[],health:{status:'ready',reasons:[]},diagnosticRefs:{},
    authority:'DESCRIPTIVE',authorityGranted:false,settlementAuthority:false,
    canonicalMutationAuthority:false,contextSealBypass:false,runtimeSchedulingAuthority:false,
  };
}

test('REPRO: selected native turn fence includes the host message revision used by Scene/Choice/Hot/Seal',async()=>{
  const brain=new Area52NativeBrain();
  const prepared=await brain.prepareTurn({
    chatId:LIVE_CHAT,
    turnId:'native-live:'+LIVE_CHAT+':389:1f2b3f0b:1',
    generationId:'native-live-gen:'+LIVE_CHAT+':389:1f2b3f0b:1',
    query:'*Akira looked to nanahoshi* "Kinda scary huh"',
    sceneSignal:liveScene(),
    executionLabel:'LIVE_SILLYTAVERN',
    budgetTokens:4096,
  });

  assert.ok(
    prepared.selection.sourceRevisionRefs.includes(LIVE_REF),
    'selected source fence must include the host message revision retained by Scene/Hot Cognition',
  );

  const live=createWave11LiveReceiptBinding(brain.uiBindings());
  const selected=live.selection();
  assert.equal(selected.turnId,prepared.selection.turnId);
  assert.doesNotThrow(()=>live.bridges.scene.readModel());
  assert.doesNotThrow(()=>live.bridges.cognition.readHotCognitionReadModel(selected));
  assert.doesNotThrow(()=>live.bridges.cognition.readCognitiveChoiceReceipt(selected));
  assert.doesNotThrow(()=>live.bridges.cognition.readContextSealReceipt(selected));
});
