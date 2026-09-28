import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Wave13DiagnosticsCenterAdapter,
  SelectedTurnLogModel,
  installTurnLogDiagnosticsWorkspace,
  WorkspaceRegistry,
  ResourceScope,
} from '../src/ui-core/index.js';
import { createDevelopmentDeploymentSillyTavernSession } from '../src/deployment/sillytavern-live.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

const selection={
  chatId:'chat:profile-ui',turnId:'turn:profile-ui:1',generationId:'gen:profile-ui:1',correlationId:'corr:profile-ui:1',
  worldRevision:7,sceneRevision:3,sourceRevisionRefs:['scene:profile-ui@3'],
};

function sessionBindings({heapSupported=true,longTaskSupported=true,foreignDetailed=false}={}){
  let enabled=false;
  const secret='PROFILE_SECRET_PROMPT_MUST_NOT_EXPORT';
  const selected={
    kind:'NativeBrainSelectedTurnReceipt',...selection,
    performance:{
      kind:'NativeBrainGenerationPerformanceReceipt',...selection,
      retrievalChannels:[{channelId:'SLOW_EMPTY',status:'OK',nominationCount:0,attemptedIntents:1,failedIntents:0,elapsedMs:61000,query:'PROFILE_SECRET_PROMPT_MUST_NOT_EXPORT'}],
      stages:[
        {stage:'BRAIN_PREPARATION_TOTAL',wallMs:31.5,queueWaitMs:0,inputCount:1,outputCount:1,outcome:'SEALED_FOR_GENERATION'},
        {stage:'HOST_PREPARATION',wallMs:4.25,queueWaitMs:0,inputCount:1,outputCount:1,outcome:'HOST_EVENT_PREPARED'},
        {stage:'HOST_INSERTION',wallMs:6.75,queueWaitMs:0,inputCount:3,outputCount:12,outcome:'OBSERVED_MATCH'},
        {stage:'PROVIDER_RESPONSE',wallMs:915,queueWaitMs:0,inputCount:1,outputCount:1,outcome:'RECEIVED'},
        {stage:'LEARNING',wallMs:22,queueWaitMs:0,inputCount:1,outputCount:1,outcome:'COMPLETED'},
      ],
      rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
    },
  };
  const detailed={
    kind:'NativeGenerationDetailedPerformanceProfile',
    ...(foreignDetailed?{...selection,chatId:'chat:foreign'}:selection),
    start:{at:1000,heapBytes:100*1048576,longTaskCount:2,longTaskTotalMs:90,longTaskMaxMs:60,diagnosticsUiRefreshCount:5,diagnosticsUiRefreshTotalMs:11,diagnosticsUiRefreshMaxMs:4,diagnosticsUiRefreshLastMs:2},
    afterInsertion:{at:1040,heapBytes:112*1048576,longTaskCount:3,longTaskTotalMs:145,longTaskMaxMs:60,diagnosticsUiRefreshCount:7,diagnosticsUiRefreshTotalMs:17,diagnosticsUiRefreshMaxMs:4,diagnosticsUiRefreshLastMs:3},
    end:{at:2000,heapBytes:138*1048576,longTaskCount:5,longTaskTotalMs:300,longTaskMaxMs:80,diagnosticsUiRefreshCount:12,diagnosticsUiRefreshTotalMs:33,diagnosticsUiRefreshMaxMs:5,diagnosticsUiRefreshLastMs:2},
    providerLatencyMs:915,
    deltas:{heapBytes:38*1048576,longTaskCount:3,longTaskTotalMs:210,diagnosticsUiRefreshCount:7,diagnosticsUiRefreshTotalMs:22},
    prompt:secret,providerBody:secret,hiddenReasoning:secret,api_key:secret,
  };
  const bindings={
    readSelection:()=>({...selection}),
    subscribe:()=>()=>{},
    readSelectedTurnReceipt:(requested)=>requested?.generationId===selection.generationId?structuredClone(selected):null,
    readNativeGenerationPerformance:(requested)=>requested?.generationId===selection.generationId?structuredClone(detailed):null,
    setDetailedGenerationProfiling:(next)=>{enabled=Boolean(next);return enabled;},
    loadDiagnostics:()=>({
      kind:'DevelopmentDeploymentLoadDiagnostics',
      heap:{supported:heapSupported,minBytes:null,maxBytes:null,lastBytes:null},
      longTasks:{supported:longTaskSupported,count:0,totalMs:0,maxMs:0},
      retained:{nativePerformance:1},
      generationProfiling:{detailedEnabled:enabled,retainedProfiles:1,latest:{prompt:secret}},
      bounds:{nativePerformance:12},
      rawPromptCaptured:false,storyTextCaptured:false,credentialsCaptured:false,hiddenReasoningCaptured:false,
    }),
  };
  return{bindings,secret,detailed,get enabled(){return enabled;}};
}

function diagnosticsAdapter(session){
  return new Wave13DiagnosticsCenterAdapter({
    hostBindings:session.bindings,
    liveReceiptBinding:{selection:()=>({...selection}),diagnostics:()=>({reads:1,rejected:0})},
  });
}

function emptyJournal(){
  return{
    readTurn:()=>null,status:()=>({turnCount:0,entryCount:0,storageKind:'memory'}),
    exportEvidence:()=>({kind:'DemoEvidenceJournalExport',turns:[],safety:{rawPromptsPersisted:false}}),
  };
}

test('missing detailed profile reports its exact capture state without borrowing another generation',()=>{
  const session=sessionBindings();
  session.bindings.readNativeGenerationPerformance=()=>null;
  const load=session.bindings.loadDiagnostics;
  session.bindings.loadDiagnostics=()=>({...load(),generationProfiling:{...load().generationProfiling,captureStates:[{...selection,status:'CHECKPOINT_PENDING',updatedAt:2000},{...selection,generationId:'foreign',status:'AVAILABLE'}]}});
  const profile=diagnosticsAdapter(session).read().generationPerformance;
  assert.equal(profile.detailed,null);
  assert.equal(profile.capture.reasonCode,'PROFILE_CHECKPOINT_PENDING');
  assert.equal(profile.capture.status,'CHECKPOINT_PENDING');
});

function allNodes(node){return[node,...(node.children??[]).flatMap(allNodes)];}

test('Worker 3 generation profiler control is session-only, default-off, and reads exact selected generation',()=>{
  const first=sessionBindings(),second=sessionBindings(),adapter=diagnosticsAdapter(first);
  let read=adapter.read().generationPerformance;
  assert.equal(read.control.enabled,false);
  assert.equal(read.control.defaultOff,true);
  assert.equal(read.control.sessionScoped,true);
  assert.equal(read.control.persisted,false);
  assert.equal(read.exactSelection,true);
  assert.equal(read.status,'DETAILED_AVAILABLE');
  assert.equal(read.brainStages.find(row=>row.stage==='BRAIN_PREPARATION_TOTAL').wallMs,31.5);
  assert.deepEqual(read.retrievalChannels,[{channelId:'SLOW_EMPTY',status:'OK',nominationCount:0,attemptedIntents:1,failedIntents:0,elapsedMs:61000}]);
  assert.equal(read.detailed.providerLatencyMs,915);
  assert.equal(read.retention.maxProfiles,12);
  assert.equal(adapter.setGenerationProfiling(true).ok,true);
  assert.equal(first.enabled,true);
  assert.equal(second.enabled,false);
  read=adapter.read().generationPerformance;
  assert.equal(read.control.enabled,true);
});

test('Worker 3 generation profiler rejects foreign identity and marks unsupported browser metrics NO_EVIDENCE',()=>{
  const foreign=sessionBindings({heapSupported:false,longTaskSupported:false,foreignDetailed:true});
  const read=diagnosticsAdapter(foreign).read().generationPerformance;
  assert.equal(read.status,'NO_EVIDENCE');
  assert.match(read.selectionError,/IDENTITY_MISMATCH|belongs to chatId/);
  assert.equal(read.detailed,null);

  const unsupported=sessionBindings({heapSupported:false,longTaskSupported:false});
  const safe=diagnosticsAdapter(unsupported).read().generationPerformance;
  assert.equal(safe.support.heap,'NO_EVIDENCE');
  assert.equal(safe.support.longTasks,'NO_EVIDENCE');
  assert.equal(safe.detailed.deltas.heapBytes,null);
  assert.equal(safe.detailed.deltas.longTaskCount,null);
  assert.equal(safe.detailed.phases.overall.heapBytes,null);
  assert.equal(safe.detailed.phases.overall.longTaskTotalMs,null);
  assert.equal(safe.detailed.deltas.diagnosticsUiRefreshCount,7);
});

test('Worker 3 Diagnostics switch is visible and exported profile stays bounded and sanitized',()=>{
  const session=sessionBindings(),adapter=diagnosticsAdapter(session),journal=emptyJournal();
  const registry=new WorkspaceRegistry();
  const mounted=installTurnLogDiagnosticsWorkspace(registry,{journal,selectionProvider:()=>({...selection}),diagnostics:adapter});
  const d=new FakeDocument(),host=new FakeNode('section',d),scope=new ResourceScope();
  let refreshes=0;
  registry.get('turn-log').render(host,{scope,refresh:()=>{refreshes+=1;}});
  const nodes=allNodes(host),visible=nodes.map(node=>node.textContent??'').join(' ');
  assert.match(visible,/Performance \/ generation profiling/);
  assert.match(visible,/Detailed generation profiling/);
  assert.match(visible,/Brain pre-generation/);
  assert.match(visible,/Host insertion/);
  assert.match(visible,/Provider wait/);
  assert.match(visible,/Response \/ learning/);
  assert.match(visible,/Diagnostics\/UI refresh/);
  assert.match(visible,/Retrieval channels/);
  assert.match(visible,/SLOW_EMPTY/);
  const toggle=nodes.find(node=>node.tagName==='BUTTON'&&/Turn profiling ON/.test(node.textContent??''));
  assert.ok(toggle);
  assert.equal(toggle.attributes?.role,'switch');
  assert.equal(toggle.attributes?.['aria-checked'],'false');
  toggle.dispatch('click');
  assert.equal(session.enabled,true);
  assert.equal(refreshes,1);

  const model=mounted.model;
  const exported=model.exportDiagnostics();
  const serialized=JSON.stringify(exported);
  assert.equal(serialized.includes(session.secret),false);
  assert.equal(exported.operationalSnapshot.generationPerformance.brainStages.length,5);
  assert.equal(exported.operationalSnapshot.generationPerformance.detailed.providerLatencyMs,915);
  assert.equal(exported.operationalSnapshot.generationPerformance.retrievalChannels[0].elapsedMs,61000);
  const download=model.downloadFullDiagnostics({document:null});
  assert.equal(download.ok,false);
  assert.ok(download.files.some(file=>file.path.endsWith('/performance/generation-profile.json')));
  const profileFile=download.files.find(file=>file.path.endsWith('/performance/generation-profile.json'));
  assert.equal(profileFile.content.includes(session.secret),false);
  assert.equal(JSON.parse(profileFile.content).retrievalChannels[0].channelId,'SLOW_EMPTY');
  scope.cleanup();mounted.release();
});

test('Worker 1 live session publishes profiler controls through UI bindings and does not persist ON into another session',()=>{
  const host={getContext:()=>({chatId:'chat:session-scope',chat:[]})};
  const first=createDevelopmentDeploymentSillyTavernSession({sillyTavern:host,document:null,mountUi:false});
  const second=createDevelopmentDeploymentSillyTavernSession({sillyTavern:host,document:null,mountUi:false});
  const bindings=first.uiBindings();
  for(const name of ['readNativeGenerationPerformance','setDetailedGenerationProfiling','loadDiagnostics'])assert.equal(typeof bindings[name],'function',name);
  assert.equal(bindings.loadDiagnostics().generationProfiling.detailedEnabled,false);
  assert.equal(bindings.setDetailedGenerationProfiling(true),true);
  assert.equal(bindings.loadDiagnostics().generationProfiling.detailedEnabled,true);
  assert.equal(second.loadDiagnostics().generationProfiling.detailedEnabled,false);
  first.destroy();second.destroy();
});


test('Diagnostics exports bounded long-task intervals without browser attribution URLs',()=>{
  const fixture=sessionBindings();
  fixture.detailed.longTasks=[{startAt:1020,durationMs:75,phase:'PRE_INSERTION',name:'PRIVATE_URL'}];
  const read=diagnosticsAdapter(fixture).read();
  assert.equal(read.generationPerformance.detailed.longTasks[0].durationMs,75);
  assert.doesNotMatch(JSON.stringify(read.generationPerformance),/PRIVATE_URL/);
});
