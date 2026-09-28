import test from 'node:test';
import assert from 'node:assert/strict';
import {Area52NativeBrain} from '../src/native-brain.js';
import {createWave12SillyTavernHostBindings} from '../src/ui-core/wave12-sillytavern-host.js';
import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';
import {Wave13LoreStudyUIAdapter,Wave13OperationalStatusAdapter} from '../src/ui-core/wave13-operator-adapters.js';
import {worker4SelectedLorebook,WORKER4_SELECTED_CHAT} from './fixtures/worker4-lore-readiness-fixtures.mjs';
import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';

test('Diagnostics distinguishes admitted Scene work from resource-blocked execution',async()=>{
  const brain=new DevelopmentDeploymentBrain();
  brain.optionalResources.actions.addResource({resourceId:'scene:blocked',kind:'DETERMINISTIC_LOCAL',capabilities:['STRUCTURED_EXTRACTION'],resourceProfile:{GPU:1},handlers:{SCENE_OBSERVATION:()=>{throw new Error('blocked worker must not execute');}}});
  await brain.optionalResources.actions.connectResource('scene:blocked');
  const event={activity:'USER_SEND',chatId:'chat:blocked',messageId:'m1',messageRevision:1,turnId:'turn:blocked',generationId:'gen:blocked',correlationId:'corr:blocked',content:'Mira waits.',role:'user'};
  event.sourceRevisionId=brain.scene.narrativeFeed.sourceRevisionIdFor(event);
  brain.ingestSceneHostEvent(event,{extract:()=>({})});
  const work=await brain.runSceneObservationWork({...event,narrative:event.content});
  assert.equal(work.status,'QUEUED');
  await brain.resourceDirector.runCycle({waitForTaskIds:[]});
  const host=createWave12SillyTavernHostBindings({getContext:()=>({chatId:event.chatId}),hostBindings:brain.hostBindings()});
  try{
    const status=new Wave13OperationalStatusAdapter({hostBindings:host.hostBindings,liveReceiptBinding:{selection:()=>event}}).read();
    const runtime=status.pipeline.sceneObservation.runtime;
    assert.equal(runtime.tasks[0].executionStatus,'BLOCKED');
    assert.equal(runtime.tasks[0].executionReason,'no-compatible-provider-or-resource');
    assert.equal(runtime.tasks[0].startedCount,0);
    assert.equal(runtime.workers[0].resourceProfile.GPU,1);
    assert.equal(runtime.resources.capacity.GPU,undefined);
    assert.equal(brain.resourceConnections.readResource('scene:blocked').lastExecution,null);
    assert.doesNotMatch(JSON.stringify(runtime),/Mira waits/);
  }finally{host.destroy();}
});

test('installed UI forwards exact Scene observation owner receipts',()=>{
  const receipts=[{kind:'DeploymentSceneObservationOwnerReceipt',status:'ADMITTED',chatId:'chat:test',turnId:'turn:1',generationId:'gen:1'}];
  const host=createWave12SillyTavernHostBindings({getContext:()=>({chatId:'chat:test'}),hostBindings:{readSceneObservationReceipts:()=>structuredClone(receipts)}});
  try{assert.deepEqual(host.hostBindings.readSceneObservationReceipts?.(),receipts);}finally{host.destroy();}
});

test('selected-turn Scene remains its pre-seal snapshot after later observations',async()=>{
  const brain=new Area52NativeBrain();
  const signal={sceneId:'scene:test',sceneRevision:1,location:'First Hall',sourceRevisionRefs:[],activeCast:[],objects:[]};
  const prepared=await brain.prepareTurn({chatId:'chat:test',turnId:'turn:1',generationId:'gen:1',query:'Look around.',sceneSignal:signal});
  const selection=prepared.selection,ui=brain.uiBindings(),before=ui.readScene(selection);
  brain.observeScene('chat:test',{...signal,sceneRevision:2,location:'Second Hall'});
  assert.deepEqual(ui.readScene(selection),before);
  assert.equal(ui.readSelectedTurnReceipt(selection).sceneFlow.readModel.sceneRevision,selection.sceneRevision);
});

test('Lore metadata status avoids artifact bodies while preserving owner counts',()=>{
  const service=new LoreIntelligenceService();
  service.acceptLorebook(worker4SelectedLorebook());service.runStudy({scope:'DUE'});
  const full=service.status({chatId:WORKER4_SELECTED_CHAT});
  service.runtime.store.currentArtifacts=()=>{throw new Error('full artifacts must not be read');};
  service.ontology.current=()=>{throw new Error('ontology must not be read');};
  const summary=service.status({chatId:WORKER4_SELECTED_CHAT,metadataOnly:true});
  assert.deepEqual(summary.counts,full.counts);
  assert.equal(summary.storyAuthorizedReady,full.storyAuthorizedReady);
  assert.deepEqual(summary.entries.map(x=>x.operatorState),full.entries.map(x=>x.operatorState));
  assert.equal(summary.metadataOnly,true);
});

test('routine operational reads use Lore metadata instead of its full study surface',()=>{
  const service=new LoreIntelligenceService();service.acceptLorebook(worker4SelectedLorebook());service.runStudy({scope:'DUE'});
  const host=service.operatorInterface();
  const loreStudy=new Wave13LoreStudyUIAdapter({bindings:{loreStudyHost:{...host,read:{...host.read,surface:()=>{throw new Error('full surface not needed');}}}},selectionProvider:()=>({chatId:WORKER4_SELECTED_CHAT})});
  const read=new Wave13OperationalStatusAdapter({loreStudy,liveReceiptBinding:{selection:()=>({chatId:WORKER4_SELECTED_CHAT})}}).read();
  assert.equal(read.stages.find(row=>row.id==='lore').state,'LIVE');
});
