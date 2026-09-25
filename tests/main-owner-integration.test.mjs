import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Area52NativeBrain } from '../src/native-brain.js';
import { DevelopmentDeploymentBrain } from '../src/deployment/brain.js';
import { createDevelopmentDeploymentSillyTavernSession } from '../src/deployment/sillytavern-live.js';

function host(){
  return { getContext(){ return { chatId:'integration-host', chat:[], eventTypes:{}, eventSource:{on(){},removeListener(){}}, async setExtensionPrompt(){} }; } };
}

function providerIds(brain){
  return (brain.graphWalkerDiagnostics()?.providers??[]).map(row=>row.providerId).sort();
}

test('integrated owner graph callbacks attach to Native Brain and are reattached after snapshot restore',()=>{
  const deployment=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:true});
  const native=new Area52NativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({
    sillyTavern:host(),document:null,mountUi:false,brain:deployment,nativeBrain:native,
  });

  const expected=['LORE_OWNER_GRAPH','MEMORY_OWNER_GRAPH','SCENE_OWNER_GRAPH'];
  assert.deepEqual(providerIds(native),expected);
  const first=session.exportEvidence().nativeBrainIntegration.ownerKnowledgeAttachments.graphProviders;
  assert.deepEqual(first.filter(row=>row.attached).map(row=>row.providerId).sort(),expected);

  const snapshot=native.snapshot();
  session.destroy();

  const restored=Area52NativeBrain.fromSnapshot(snapshot);
  assert.deepEqual(providerIds(restored),[],'external provider callbacks must not be serialized');
  const restoredSession=createDevelopmentDeploymentSillyTavernSession({
    sillyTavern:host(),document:null,mountUi:false,brain:deployment,nativeBrain:restored,
  });
  assert.deepEqual(providerIds(restored),expected,'host must reattach owner callbacks after restore');
  const second=restoredSession.exportEvidence().nativeBrainIntegration.ownerKnowledgeAttachments.graphProviders;
  assert.deepEqual(second.filter(row=>row.attached).map(row=>row.providerId).sort(),expected);
  restoredSession.destroy();
});

test('installed owner bindings expose exact Lore lifecycle and Runtime Director seams without making optional services mandatory',()=>{
  const deployment=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:true});
  const bindings=deployment.hostBindings();
  assert.equal(typeof bindings.loreAuthoringHost?.actions?.computeFinalPreview,'function');
  assert.equal(typeof bindings.loreAuthoringHost?.actions?.approveFinalPreview,'function');
  assert.equal(typeof bindings.loreAuthoringHost?.actions?.applySettlement,'function');
  assert.equal(typeof bindings.loreAuthoringHost?.actions?.restoreSettlement,'function');
  assert.equal(typeof bindings.resourceDirectorBridge?.admit,'function');
  assert.equal(typeof bindings.beginOptionalResourceGeneration,'function');
  assert.equal(typeof bindings.completeOptionalResourceGeneration,'function');
  assert.deepEqual(bindings.graphProviders.map(row=>row.providerId).sort(),['LORE_OWNER_GRAPH','MEMORY_OWNER_GRAPH','SCENE_OWNER_GRAPH']);

  const native=new Area52NativeBrain();
  assert.deepEqual(native.diagnostics().nativeRequirements,{
    jevRequired:false,sidecarRequired:false,externalDatabaseRequired:false,sqlRequired:false,remoteModelRequired:false,userOrchestratorRequired:false,
  });
  assert.equal(bindings.listResources().resources.length,0);
});

test('Lore Settlement invalidation has one host forwarder and no direct subscription bypass',()=>{
  const source=readFileSync(new URL('../src/deployment/sillytavern-live.js',import.meta.url),'utf8');
  const attach=source.slice(source.indexOf('#attachNativeKnowledgeOwners(){'),source.indexOf('#uiHostBindings(){'));
  assert.match(attach,/this\.#[r]outeLoreRevisionEvents\(event\?\.result\)/);
  assert.doesNotMatch(attach,/acceptLoreRevisionChange\(/);
  const route=source.slice(source.indexOf('#routeLoreRevisionEvents(result){'),source.indexOf('#recordHostNarrativeEvent',source.indexOf('#routeLoreRevisionEvents(result){')));
  assert.match(route,/acceptedRevisionEvents/);
  assert.match(route,/acceptLoreRevisionChange\(event\)/);
});

test('Connections evidence model keeps configured, qualified, physical execution, and owner acceptance separate',async()=>{
  const deployment=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:true});
  const hostBindings=deployment.hostBindings();
  const state=hostBindings.resourceHost.read.ui({});
  assert.ok(Array.isArray(state.resources));
  assert.equal(state.lifecycle.configured,0);
  assert.equal(state.lifecycle.physicallyExecuted,0);
  assert.equal(state.lifecycle.ownerAccepted,0);
  assert.deepEqual(state.physicalExecution,{attempts:0,succeeded:0,failed:0});
});
