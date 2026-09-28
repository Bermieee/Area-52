import test from 'node:test';
import assert from 'node:assert/strict';

import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {extractDevelopmentDeploymentScene} from '../src/deployment/sillytavern-live.js';
import {Area52NativeBrain} from '../src/native-brain.js';
import {createSceneOwnerGraphProvider} from '../src/deployment/owner-graph-adapters.js';
import {HostActivity,SceneRelationship} from '../src/scene/index.js';
import {Capability,ResourceKind} from '../src/coprocessor/index.js';

const host=(activity,id,content,extra={})=>({
  activity,chatId:extra.chatId??'chat:ft002-assembly',
  hostEventId:extra.hostEventId??`ft002:${id}:${activity}:r${extra.messageRevision??1}`,
  messageId:extra.messageId??id,messageRevision:extra.messageRevision??1,
  turnId:extra.turnId??`turn:${id}`,generationId:extra.generationId??`gen:${id}`,
  correlationId:extra.correlationId??`corr:turn:${id}`,causationId:extra.causationId??`cause:${id}`,
  content,role:extra.role??'user',...extra,
});

const ingest=(brain,input)=>brain.ingestSceneHostEvent(input,{
  extract:(e,scene)=>extractDevelopmentDeploymentScene(e.content,{
    revision:scene.revision+1,evidenceRef:e.sourceRevisionId,currentScene:scene,sceneRuntime:brain.scene,
  }),
});

function nativeFor(brain){
  return new Area52NativeBrain({
    memoryInterface:brain.memorySurface,
    memoryConsolidationInterface:brain.memorySurface,
    graphProviders:[createSceneOwnerGraphProvider(brain.scene)],
  });
}

async function assemble(brain,native,receipt,{query=receipt?.evidence?.content??'Continue.',suffix='x',intent='CURRENT'}={}){
  const chatId=receipt.chatId,turnId=`assembled:${suffix}`,generationId=`assembled-gen:${suffix}`;
  const correlationId=`corr:${turnId}`,causationId=`host:${suffix}`;
  const fanOut=await brain.assembleSceneFanOutForNativeTurn({
    chatId,turnId,generationId,correlationId,causationId,query,
    worldRevision:native.core.graph.revision,selectionGuard:()=>true,sealed:false,
  });
  const prepared=await native.prepareTurn({
    chatId,turnId,generationId,correlationId,query,intent,
    sceneSignal:receipt.signal,sceneTimeline:receipt.dispatchTimeline??[],sceneOwnerReceipt:receipt,
    sceneFanOut:fanOut.coreHandoff??null,executionLabel:'FT002_ASSEMBLED_TEST',
  });
  return{fanOut,prepared,selection:prepared.selection,ui:native.uiBindings()};
}

function seedCompletedMemory(brain,{chatId='chat:ft002-assembly'}={}){
  const sourceRevisionId='memory-seed@r1';
  const ownerArtifactRef={
    kind:'ArtifactReference',contractVersion:'1.0.0',artifactId:'native-seed:memory',artifactType:'NativeExperience',
    owner:'NATIVE_BRAIN',revision:1,storageDomain:'artifacts',sourceRevisionSet:[sourceRevisionId],sourceRevisionRefs:[sourceRevisionId],
    worldRevision:1,sceneRevision:1,contentHash:'seed-memory-content',sliceSelector:null,provenanceRef:null,expiry:null,
    authorityGranted:false,settlementAuthority:false,contextSealBypass:false,provenance:['seed:memory'],
  };
  const externalEvidenceRef='memory-evidence:seed';
  const mapping=brain.memory.admitExternalEvidenceMapping({
    kind:'MemoryExternalEvidenceMappingRequest',contractVersion:'1.0.0',ownerArtifactRef,externalEvidenceRef,
    source:{
      sourceId:'memory-source:seed',sourceRevisionId,
      exactContent:'Earlier in the selected story, Mara stored the glass compass in the observatory archive.',
      evidenceKind:'NARRATIVE_EXPERIENCE',occurredAt:1,worldRevision:1,sceneRevision:1,
      participants:['Mara','glass compass'],knownBy:['Mara'],perspective:'WORLD',
      metadata:{chatId},provenance:['seed:memory'],
    },
    revisionProof:{sourceRevisionId,ownerArtifactRevision:1,worldRevision:1,sceneRevision:1},
    provenanceRefs:['seed:memory:mapping'],
  });
  assert.equal(mapping.status,'ADMITTED');
  const completed=brain.memory.acceptCompletedTurn({
    ownerArtifactRef,externalEvidenceRef,sourceRevisionId,chatId,
    turnId:'memory-seed-turn',generationId:'memory-seed-generation',correlationId:'memory-seed-correlation',
    sceneId:'memory-seed-scene',sceneRevision:1,worldRevision:1,contextSealId:'memory-seed-seal',
  });
  assert.ok(['COMPLETED','REPLAYED'].includes(completed.status));
  return{mapping,completed};
}

test('#177 real Scene prefetch can execute a physical Historian resource and only owner-admitted candidates enter Core Result Bus/Gather/Seal',async()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  seedCompletedMemory(brain);

  let historianCalls=0;
  brain.resourceConnections.addResource({
    resourceId:'ft002-historian',providerProfileId:'ft002-historian-profile',providerId:'ft002-historian-provider',
    workerId:'ft002-historian-worker',kind:ResourceKind.DETERMINISTIC_LOCAL,modelId:'ft002-historian-model',
    capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT],maxConcurrency:1,latencyClass:'LOW',
    handlers:{
      HISTORIAN_RETRIEVAL:({input})=>{
        historianCalls+=1;
        const candidates=input?.data?.candidates??input?.candidates??[];
        const first=candidates[0];
        if(!first)return{refs:[],relevance:[],uncertainty:'UNRESOLVED',reasoningSummary:'No selected-chat Memory candidate was available.'};
        return{refs:[first.candidateId],relevance:[{ref:first.candidateId,score:.97}],uncertainty:'LOW',reasoningSummary:'Selected one bounded Memory candidate from the provided owner evidence.'};
      },
    },
  });
  const resource=await brain.resourceConnections.connectResource('ft002-historian');
  assert.equal(resource.state,'READY');

  const sceneReceipt=ingest(brain,host(HostActivity.USER_SEND,'physical','At Moonlit Observatory, Mara arrives and searches for the glass compass.'));
  assert.equal(sceneReceipt.status,'OBSERVED');
  assert.ok(sceneReceipt.eventTypes.includes('LOCATION_CHANGED'));
  const native=nativeFor(brain);
  const {fanOut,prepared,ui,selection}=await assemble(brain,native,sceneReceipt,{query:'Where was the glass compass stored earlier?',suffix:'physical',intent:'HISTORICAL'});

  assert.equal(fanOut.receipt.status,'ASSEMBLED');
  assert.equal(fanOut.receipt.plannerConsidered,true);
  assert.ok(fanOut.receipt.physicalExecutionCount>=1);
  assert.ok(historianCalls>=1);
  assert.ok(fanOut.receipt.admittedResultIds.length>=1);
  assert.ok(fanOut.receipt.candidateIds.length>=1);
  assert.ok(fanOut.coreHandoff?.candidates?.length>=1);
  assert.equal(fanOut.coreHandoff.chatId,selection.chatId);
  assert.equal(fanOut.coreHandoff.turnId,selection.turnId);
  assert.equal(fanOut.coreHandoff.generationId,selection.generationId);
  assert.equal(fanOut.coreHandoff.sceneRevision,selection.sceneRevision);

  assert.equal(prepared.sceneFanOutIngress.status,'ADMITTED_FOR_RESULT_BUS');
  assert.ok(prepared.sceneFanOutIngress.candidateCount>=1);
  assert.equal(prepared.sceneFanOutResultBusReceipt.status,'BOUND');
  assert.ok(prepared.sceneFanOutResultBusReceipt.boundCandidateIds.length>=1);
  const boundRow=prepared.sceneFanOutResultBusReceipt.rows.find(row=>row.status==='BOUND');
  assert.ok(boundRow?.resultId);
  assert.ok(boundRow?.upstreamResultId);
  assert.ok(fanOut.receipt.admittedResultIds.includes(boundRow.upstreamResultId));
  assert.ok(prepared.sceneFanOutResultBusReceipt.selectionResultIds.includes(boundRow.upstreamResultId));
  assert.ok(prepared.sceneFanOutResultBusReceipt.gatheredSelectionResultIds.includes(boundRow.upstreamResultId));
  assert.ok(prepared.gatherReceipt.admittedCandidateIds.includes(boundRow.candidateId));
  assert.ok(prepared.gatherReceipt.admittedResultIds.includes(boundRow.resultId));
  assert.ok(prepared.gatherReceipt.admittedResultIds.includes(boundRow.upstreamResultId));
  assert.ok(prepared.contextSealReceipt.admittedResultIds.includes(boundRow.resultId));
  assert.ok(prepared.contextSealReceipt.admittedResultIds.includes(boundRow.upstreamResultId));
  assert.equal(prepared.contextSealReceipt.sealedState,true);
  assert.equal(prepared.promptPlan.turnId,selection.turnId);
  assert.equal(prepared.promptPlan.generationId,selection.generationId);

  const selected=ui.readSelectedTurnReceipt(selection);
  assert.equal(selected.sceneFlow.observation.state,'OBSERVED');
  assert.equal(selected.sceneFlow.readModel.state,'PUBLISHED');
  assert.equal(selected.sceneFlow.readModel.sceneId,selection.sceneId);
  assert.equal(selected.sceneFlow.fanOut.ingressStatus,'ADMITTED_FOR_RESULT_BUS');
  assert.equal(selected.sceneFlow.fanOut.plannerConsidered,true);
  assert.equal(selected.sceneFlow.fanOut.physicalExecutionCount,fanOut.receipt.physicalExecutionCount);
  assert.deepEqual(selected.sceneFlow.fanOut.admittedResultIds,fanOut.receipt.admittedResultIds);
  assert.equal(selected.sceneFlow.fanOut.coreBinding.status,'BOUND');
  assert.ok(selected.sceneFlow.fanOut.coreBinding.boundCandidateIds.includes(boundRow.candidateId));
  assert.ok(selected.sceneFlow.fanOut.coreBinding.selectionResultIds.includes(boundRow.upstreamResultId));
  assert.ok(selected.sceneFlow.fanOut.coreBinding.gatheredSelectionResultIds.includes(boundRow.upstreamResultId));
  assert.ok(selected.sceneFlow.fanOut.candidateCount>=1);
  assert.ok(['ADMITTED_RESULTS','PUBLISHED_NO_WORK'].includes(selected.sceneFlow.gather.state));
  assert.equal(selected.sceneFlow.contextSeal.state,'SEALED');
  assert.equal(selected.sceneFlow.promptPlan.state,'PLANNED');
  assert.equal(selected.producers.sidecar.physicalExecutionClaimed,false);
  assert.equal(selected.sceneFences.sceneReadModelMatchesSelection,true);

  const expected=ui.readExpectedWork(selection);
  const fakePhysical=(expected?.items??[]).flatMap(row=>row?.causalReceipts??[]).filter(row=>row.kind==='PHYSICAL_EXECUTION_STARTED');
  assert.equal(fakePhysical.length,0,'Scene expected-work reconciliation must not invent physical execution evidence');
});

test('#177 assembled real-narrative scenarios preserve Scene semantics through Native Gather/Seal/PromptPlan',async()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const native=nativeFor(brain);
  let n=0;
  const run=async(content,extra={})=>{
    const id='scenario-'+(++n);
    const receipt=ingest(brain,host(extra.activity??HostActivity.USER_SEND,id,content,extra));
    const result=await assemble(brain,native,receipt,{query:content,suffix:id});
    assert.equal(result.prepared.sceneFanOutIngress.status,'ADMITTED_FOR_RESULT_BUS');
    assert.equal(result.prepared.sceneFanOutIngress.plannerConsidered,true);
    assert.equal(result.prepared.sceneFanOutIngress.candidateCount,0);
    assert.equal(result.prepared.contextSealReceipt.sealedState,true);
    assert.equal(result.prepared.promptPlan.turnId,result.selection.turnId);
    assert.equal(result.ui.readScene(result.selection)?.sceneId,result.selection.sceneId);
    const selected=result.ui.readSelectedTurnReceipt(result.selection);
    assert.equal(selected?.sceneFences.sceneReadModelMatchesSelection,true);
    assert.equal(selected?.sceneFlow.fanOut.state,'NO_WORK');
    assert.equal(selected?.sceneFlow.fanOut.ingressStatus,'ADMITTED_FOR_RESULT_BUS');
    return{receipt,...result};
  };

  const initial=await run('At North Gallery, Mara waits beside the door.');
  const initialScene=initial.receipt.sceneId;

  const continuation=await run('Mara studies the same door and continues waiting.');
  assert.equal(continuation.receipt.sceneId,initialScene);
  assert.equal(continuation.receipt.transition,null);

  const falseCut=await run('Mara pauses in the doorway.');
  assert.equal(falseCut.receipt.sceneId,initialScene);
  assert.equal(falseCut.receipt.transition,null);
  assert.equal(falseCut.receipt.noWorkReason,'BOUNDARY_NOT_CONFIRMED');

  const cast=await run('At North Gallery, Eris enters beside Mara.');
  assert.equal(cast.receipt.sceneId,initialScene);
  assert.ok(cast.receipt.changedFields.includes('activeCast'));
  assert.ok(cast.receipt.eventTypes.includes('ACTIVE_CAST_CHANGED'));

  const time=await run('At North Gallery, three hours later, Mara and Eris are still here.');
  assert.ok(time.receipt.changedFields.includes('narrativeTime'));
  assert.ok(time.receipt.eventTypes.includes('TIME_SHIFT_DETECTED'));

  const transition=await run('We arrive at South Courtyard.');
  assert.notEqual(transition.receipt.sceneId,initialScene);
  assert.equal(transition.receipt.transition?.status,'COMPLETE');

  const presentScene=transition.receipt.sceneId;
  const flashback=await run('Years earlier, at Old Hall, Mara waited.');
  assert.notEqual(flashback.receipt.sceneId,presentScene);
  assert.equal(flashback.receipt.signal.sceneRelationship,SceneRelationship.FLASHBACK_OF);

  const resumed=await run('Back in the present, Mara resumes in South Courtyard.');
  assert.equal(resumed.receipt.sceneId,presentScene);
  assert.equal(resumed.receipt.signal.sceneRelationship,SceneRelationship.RESUMES);

  const beforeEdit=await run('At South Courtyard, Mara carries the brass key.',{messageId:'editable',messageRevision:1});
  const corrected=await run('At South Courtyard, Mara carries the silver key.',{
    activity:HostActivity.EDIT,messageId:'editable',messageRevision:2,
  });
  assert.notEqual(corrected.receipt.evidence.sourceRevisionId,beforeEdit.receipt.evidence.sourceRevisionId);
  assert.equal(corrected.receipt.evidence.replacesRevisionId,beforeEdit.receipt.evidence.sourceRevisionId);
  assert.ok(corrected.receipt.invalidatedSourceRevisionRefs.includes(beforeEdit.receipt.evidence.sourceRevisionId));
  assert.equal(corrected.prepared.contextSealReceipt.sourceRevisionIds.includes(beforeEdit.receipt.evidence.sourceRevisionId),false);
});

test('#177 source edit rejects a pre-edit Fan-Out handoff before Core publication',async()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const native=nativeFor(brain);
  const before=ingest(brain,host(HostActivity.USER_SEND,'edit-race','At North Gallery, Mara carries the brass key.',{messageId:'edit-race',messageRevision:1}));
  const turnId='edit-race-turn',generationId='edit-race-generation',correlationId='corr:edit-race-turn';
  const staleFanOut=await brain.assembleSceneFanOutForNativeTurn({
    chatId:before.chatId,turnId,generationId,correlationId,causationId:'host:edit-race',
    query:'What key is Mara carrying?',worldRevision:native.core.graph.revision,selectionGuard:()=>true,sealed:false,
  });
  assert.ok(staleFanOut.coreHandoff);
  const oldSource=before.evidence.sourceRevisionId;
  assert.ok(staleFanOut.coreHandoff.sourceRevisionSet.includes(oldSource));

  const corrected=ingest(brain,host(HostActivity.EDIT,'edit-race','At North Gallery, Mara carries the silver key.',{
    messageId:'edit-race',messageRevision:2,turnId:'turn:edit-race:2',generationId:'gen:edit-race:2',correlationId:'corr:turn:edit-race:2',
  }));
  assert.equal(corrected.evidence.replacesRevisionId,oldSource);
  assert.ok(corrected.invalidatedSourceRevisionRefs.includes(oldSource));
  assert.equal(corrected.signal.sourceRevisionRefs.includes(oldSource),false);

  const prepared=await native.prepareTurn({
    chatId:corrected.chatId,turnId,generationId,correlationId,query:'What key is Mara carrying?',
    sceneSignal:corrected.signal,sceneTimeline:corrected.dispatchTimeline??[],sceneOwnerReceipt:corrected,
    sceneFanOut:staleFanOut.coreHandoff,executionLabel:'FT002_SOURCE_EDIT_RACE',
  });
  assert.equal(prepared.sceneFanOutIngress.status,'REJECTED');
  assert.equal(prepared.sceneFanOutIngress.reasonCode,'SCENE_FANOUT_SELECTION_FENCE_MISMATCH');
  assert.ok(prepared.sceneFanOutIngress.identityMismatch.includes('sourceRevisionSet'));
  assert.equal(prepared.contextSealReceipt.sourceRevisionIds.includes(oldSource),false);
});

test('#177 Scene Fan-Out handoff fails closed on selected-turn identity mismatch before Core publication',async()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const receipt=ingest(brain,host(HostActivity.USER_SEND,'mismatch','At North Gallery, Mara waits.'));
  const native=nativeFor(brain);
  const chatId=receipt.chatId,turnId='mismatch-turn',generationId='mismatch-generation',correlationId='corr:mismatch-turn';
  const fanOut=await brain.assembleSceneFanOutForNativeTurn({
    chatId,turnId,generationId,correlationId,causationId:'cause:mismatch',query:'Continue.',
    worldRevision:native.core.graph.revision,selectionGuard:()=>true,sealed:false,
  });
  const forged=fanOut.coreHandoff?{...fanOut.coreHandoff,generationId:'foreign-generation'}:{
    kind:'SceneFanOutCoreHandoff',chatId,turnId,generationId:'foreign-generation',correlationId,causationId:'cause:mismatch',
    sceneId:receipt.sceneId,sceneRevision:receipt.sceneRevision,sourceRevisionSet:[...(receipt.sourceRevisionRefs??[])],candidates:[],
  };
  const prepared=await native.prepareTurn({
    chatId,turnId,generationId,correlationId,query:'Continue.',sceneSignal:receipt.signal,
    sceneTimeline:receipt.dispatchTimeline??[],sceneOwnerReceipt:receipt,sceneFanOut:forged,
  });
  assert.equal(prepared.sceneFanOutIngress.status,'REJECTED');
  assert.equal(prepared.sceneFanOutIngress.reasonCode,'SCENE_FANOUT_SELECTION_FENCE_MISMATCH');
  assert.ok(prepared.sceneFanOutIngress.identityMismatch.includes('generationId'));
  assert.equal(prepared.contextSealReceipt.sealedState,true);
});
