import test from 'node:test';
import assert from 'node:assert/strict';
import {Area52NativeBrain} from '../src/native-brain.js';
import {ResultBus} from '../src/result-bus.js';
import {createDevelopmentDeploymentSillyTavernSession} from '../src/deployment/sillytavern-live.js';
import {DemoEvidenceJournal} from '../src/ui-core/index.js';

function scene(id='scene:perf',revision=1){
  return{sceneId:id,sceneRevision:revision,location:'Test Hall',narrativeTime:'tick '+revision,activeCast:[],activeThreads:[],objects:[],sourceRevisionRefs:['scene:'+id+'@'+revision],provenance:['test:'+id]};
}

test('Worker 1 performance: ResultBus payload projection preserves copy isolation without full result-route reads',()=>{
  const bus=new ResultBus({getWorldRevision:()=>1,getSceneRevision:()=>1,isSourceRevisionCurrent:()=>true});
  bus.receiveCandidate({
    candidateId:'candidate:projection',sourceRevisionRefs:[],claimIds:[],provenance:[],
    representationText:'bounded representation',metadata:{nested:{value:'original'}},
  },{
    taskId:'task:projection',turnId:'turn:projection',correlationId:'corr:projection',worldRevision:1,sceneRevision:1,
  });
  const first=bus.foregroundPayloads('turn:projection',{resultType:'RETRIEVAL_CANDIDATE'});
  assert.equal(first.length,1);first[0].metadata.nested.value='mutated';
  const second=bus.foregroundPayloads('turn:projection',{resultType:'RETRIEVAL_CANDIDATE'});
  assert.equal(second[0].metadata.nested.value,'original');
});

test('Worker 1 performance: selected-turn receipt reports bounded generation stages and no raw prompt/story bodies',async()=>{
  const secret='PERF_SECRET_BODY_MUST_NOT_APPEAR_IN_STAGE_RECEIPT';
  const brain=new Area52NativeBrain();
  const prepared=await brain.prepareTurn({
    chatId:'chat:perf',turnId:'turn:perf:1',generationId:'gen:perf:1',correlationId:'corr:perf:1',
    query:'Continue '+secret,scene:scene(),executionLabel:'DETERMINISTIC',
  });
  const receipt=brain.uiBindings().readSelectedTurnReceipt(prepared.selection),perf=receipt.performance;
  assert.equal(perf.kind,'NativeBrainGenerationPerformanceReceipt');
  const stages=new Map(perf.stages.map(row=>[row.stage,row]));
  for(const name of ['HOT_COGNITION','SCENE','COGNITIVE_CHOICE','CONTEXT_COMPILER','GATHER','CONTEXT_SEAL','PROMPT_PLAN','BRAIN_PREPARATION_TOTAL']){
    assert.ok(stages.has(name),name);
    const row=stages.get(name);assert.ok(row.wallMs===null||Number.isFinite(row.wallMs));assert.ok((row.wallMs??0)>=0);
  }
  assert.ok(perf.stages.length<=24);
  assert.equal(perf.rawPromptIncluded,false);assert.equal(perf.storyTextIncluded,false);assert.equal(perf.credentialsIncluded,false);assert.equal(perf.hiddenReasoningIncluded,false);
  assert.equal(JSON.stringify(perf).includes(secret),false);
});

test('Worker 1 Hot Cognition: post-response learned narrative stays outside the generation pre-seal fence',async()=>{
  const brain=new Area52NativeBrain();
  const prepared=await brain.prepareTurn({
    chatId:'chat:hot-fence',turnId:'turn:hot-fence:1',generationId:'gen:hot-fence:1',correlationId:'corr:hot-fence:1',
    query:'Continue the scene.',scene:scene('scene:hot-fence',2),executionLabel:'DETERMINISTIC',
  });
  await brain.completeTurn({turnId:'turn:hot-fence:1',response:'The assistant adds a learned post-response narrative revision.'});
  const record=brain.readTurn('turn:hot-fence:1'),learnedRef=record.experience?.sourceRevisionId;
  assert.ok(learnedRef);
  const live=brain.core.hotCognitionSnapshot('chat:hot-fence');
  const selected=brain.uiBindings().readHotCognition(prepared.selection);
  assert.ok(selected);assert.ok(live.sourceRevisionRefs.includes(learnedRef));
  assert.equal(selected.sourceRevisionRefs.includes(learnedRef),false);
  assert.equal(selected.generationFence.postResponseNarrativeExcluded,true);
  const turn=brain.uiBindings().readSelectedTurnReceipt(prepared.selection);
  assert.ok(turn.sourceRevisions.postResponseLearnedNarrativeRefs.includes(learnedRef));
  assert.equal(turn.sourceRevisions.generationPreSealRefs.includes(learnedRef),false);
});

test('Worker 1 Memory evidence distinguishes reader selection mismatch from an absent write',async()=>{
  const memory={
    contractVersion:'1.0.0',queryHistorian:()=>({nominations:[]}),drillDown:()=>[],
    admitExternalEvidenceMapping:()=>({kind:'MemoryExternalEvidenceMappingReceipt',status:'ADMITTED',receiptId:'memory:owner:admitted'}),
    readMemory:(selection)=>({kind:'MemoryUiReadModel',chatId:'chat:foreign',turnId:selection.turnId,generationId:selection.generationId,correlationId:selection.correlationId,sceneRevision:selection.sceneRevision,worldRevision:selection.worldRevision,episodes:[],reflections:[],summaries:[]}),
  };
  const brain=new Area52NativeBrain({memoryInterface:memory});
  const prepared=await brain.prepareTurn({
    chatId:'chat:memory-diag',turnId:'turn:memory-diag:1',generationId:'gen:memory-diag:1',correlationId:'corr:memory-diag:1',
    query:'Continue.',scene:scene('scene:memory-diag',1),executionLabel:'DETERMINISTIC',
  });
  const before=brain.uiBindings().readMemoryStatus(prepared.selection);
  assert.equal(before.evidenceDiagnosis.writeState,'WRITE_ABSENT');
  assert.equal(before.evidenceDiagnosis.state,'READER_SELECTION_MISMATCH');
  assert.ok(before.evidenceDiagnosis.mismatchFields.includes('chatId'));
  await brain.completeTurn({turnId:'turn:memory-diag:1',response:'Learn this response.'});
  const after=brain.uiBindings().readMemoryStatus(prepared.selection);
  assert.equal(after.evidenceDiagnosis.state,'READER_SELECTION_MISMATCH');
  assert.ok(after.evidenceDiagnosis.mismatchFields.includes('chatId'));
  const selected=brain.uiBindings().readSelectedTurnReceipt(prepared.selection);
  assert.equal(selected.producers.memory.metadata.readerDiagnosis.state,'READER_SELECTION_MISMATCH');
});

test('Worker 1 installed host assembly exports selected-turn and graph readers without replacing owner UI',async()=>{
  const brain=new Area52NativeBrain();
  const prepared=await brain.prepareTurn({
    chatId:'chat:host-bindings',turnId:'turn:host-bindings:1',generationId:'gen:host-bindings:1',correlationId:'corr:host-bindings:1',
    query:'Continue.',scene:scene('scene:host-bindings',1),executionLabel:'DETERMINISTIC',
  });
  const sillyTavern={getContext:()=>({chatId:'chat:host-bindings',chat:[]})};
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain:brain});
  const bindings=session.uiBindings();
  for(const name of ['readSelectedTurnReceipt','readGraphTraversal','readWorldGraphReferences','readExpectedWork','readPromptDeliveryReceipt'])assert.equal(typeof bindings[name],'function',name);
  const selected=bindings.readSelectedTurnReceipt(prepared.selection);
  assert.equal(selected.kind,'NativeBrainSelectedTurnReceipt');
  assert.equal(selected.selection?.generationId??selected.generationId,prepared.selection.generationId);
  assert.equal(selected.delivery.hostObserved.state,'UNAVAILABLE');
  session.destroy();
});

test('Worker 1 detailed host profiling is explicit opt-in and bounded metadata-only',()=>{
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern:{getContext:()=>({chatId:'chat:profile',chat:[]})},document:null,mountUi:false});
  const baseline=session.loadDiagnostics();
  assert.equal(baseline.generationProfiling.detailedEnabled,false);
  assert.equal(session.setDetailedGenerationProfiling(true),true);
  const enabled=session.loadDiagnostics();
  assert.equal(enabled.generationProfiling.detailedEnabled,true);
  assert.equal(enabled.retained.nativePerformance,0);
  assert.equal(enabled.bounds.nativePerformance,12);
  assert.equal(enabled.rawPromptCaptured,false);assert.equal(enabled.storyTextCaptured,false);assert.equal(enabled.credentialsCaptured,false);assert.equal(enabled.hiddenReasoningCaptured,false);
  session.destroy();
});


test('Worker 1 telemetry: QUALIFICATION_PROBE is visible as qualification but never as cognitive resource execution',()=>{
  const store=new Map(),storage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)};
  const selection={chatId:'chat:probe',turnId:'turn:probe',generationId:'gen:probe',correlationId:'corr:probe',worldRevision:1,sceneRevision:1,sourceRevisionRefs:[]};
  const journal=new DemoEvidenceJournal({storage,namespace:'worker1-probe',now:()=>100});
  const recorded=journal.recordSnapshot({
    selection,
    operations:{selection,stages:[],inspections:{}},
    diagnostics:{resources:{rows:[{
      id:'jev:probe',kind:'JEV',displayName:'Jev probe',callable:true,physicalExecutionAttempted:true,physicalExecutionSucceeded:true,
      lastExecution:{status:'SUCCESS',purpose:'QUALIFICATION_PROBE',latencyMs:12,receiptId:'probe:1'},
    }]}},
    cognition:{},promptPlan:null,
  });
  assert.equal(recorded.entries.some(row=>row.type==='RESOURCE_ATTEMPT'),false);
  const lifecycle=recorded.entries.find(row=>row.type==='OPTIONAL_RESOURCE_LIFECYCLE');
  assert.ok(lifecycle);
  const resource=lifecycle.metadata.resources.find(row=>row.id==='jev:probe');
  assert.equal(resource.qualificationProbe,true);assert.equal(resource.attempted,false);assert.equal(resource.skipReason,'QUALIFICATION_PROBE');
});
