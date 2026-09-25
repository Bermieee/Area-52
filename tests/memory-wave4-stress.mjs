import assert from 'node:assert/strict';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';
import {createMemoryIntegrationSurface} from '../src/memory-integration-surface.js';

const EVENTS_PER_CHAT=1200;
const SCENES_PER_CHAT=40;
const PROFILE_QUERIES=80;
const UI_READS=120;

const p=(values,q)=>{
  const rows=[...values].sort((a,b)=>a-b);
  return rows[Math.max(0,Math.ceil(rows.length*q)-1)]??0;
};

const producer=new MemoryTemporalProducer();
const surface=createMemoryIntegrationSurface(producer);
const chats=[
  {chatId:'stress:sky-archipelago',turnId:'turn:sky:1200',generationId:'gen:sky:1200',correlationId:'corr:sky:1200',prefix:'Sky',character:'Aven'},
  {chatId:'stress:deep-orchard',turnId:'turn:orchard:1200',generationId:'gen:orchard:1200',correlationId:'corr:orchard:1200',prefix:'Orchard',character:'Rin'},
];

const evidenceByChat=new Map(chats.map((x)=>[x.chatId,[]]));
const buildStart=performance.now();
for(const chat of chats){
  for(let i=0;i<EVENTS_PER_CHAT;i++){
    const scene=Math.floor(i/(EVENTS_PER_CHAT/SCENES_PER_CHAT));
    const id=chat.prefix.toLowerCase()+':event:'+i;
    const source=chat.prefix.toLowerCase()+':source:'+i+'@r1';
    const ev=producer.appendEvidence({
      id,
      sourceId:chat.prefix.toLowerCase()+':source:'+i,
      sourceRevisionId:source,
      exactContent:chat.character+' recorded Beacon passage '+i+' in '+chat.prefix+' District '+(i%16)+'.',
      kind:'EXPERIENCE',
      occurredAt:i,
      worldRevision:i,
      sceneRevision:scene+1,
      participants:[chat.character,chat.prefix+' District '+(i%16)],
      knownBy:[chat.character],
      metadata:{
        chatId:chat.chatId,
        turnId:'turn:'+chat.prefix.toLowerCase()+':'+i,
        generationId:'gen:'+chat.prefix.toLowerCase()+':'+i,
        correlationId:'corr:'+chat.prefix.toLowerCase()+':'+i,
      },
      provenance:['wave4-stress:'+chat.prefix],
    });
    evidenceByChat.get(chat.chatId).push(ev);
    if(i%3===0){
      producer.publishEpisode({
        logicalId:chat.prefix.toLowerCase()+':episode:'+i,
        sceneId:chat.prefix.toLowerCase()+':scene:'+scene,
        sceneRevision:scene+1,
        sourceRevisionRefs:[source],
        evidenceRefs:[id],
        participants:[chat.character],
        knownBy:[chat.character],
        significance:(i%10)/10,
        timeStart:i,timeEnd:i,
        summary:chat.character+' remembers Beacon passage '+i+' in '+chat.prefix+' District '+(i%16)+'.',
      });
    }
  }
  for(let scene=0;scene<SCENES_PER_CHAT;scene++){
    const start=scene*(EVENTS_PER_CHAT/SCENES_PER_CHAT);
    const end=start+(EVENTS_PER_CHAT/SCENES_PER_CHAT)-1;
    producer.defineSummaryScope({
      level:'SCENE',
      scopeId:chat.prefix.toLowerCase()+'-'+scene,
      parentScopeRefs:['ARC:'+chat.prefix.toLowerCase()+'-arc'],
      sourceSelector:{worldRevisionStart:start,worldRevisionEnd:end},
      provenance:['stress-chat:'+chat.chatId],
    });
  }
  producer.defineSummaryScope({
    level:'ARC',
    scopeId:chat.prefix.toLowerCase()+'-arc',
    childScopeRefs:Array.from({length:SCENES_PER_CHAT},(_,i)=>'SCENE:'+chat.prefix.toLowerCase()+'-'+i),
    provenance:['stress-chat:'+chat.chatId],
  });
}
let compactionBatches=0;
while(producer.summaryStatus().pendingWorkUnits){
  producer.runSummaryCompaction({maxUnits:16});
  compactionBatches+=1;
  if(compactionBatches>40)throw new Error('Wave 4 summary build did not converge');
}
producer.rebuildHistorian();
const buildMs=performance.now()-buildStart;

const queryTimes=[];
let falseCrossChatNominations=0;
let staleNominations=0;
let maxExamined=0;
for(let i=0;i<PROFILE_QUERIES;i++){
  const chat=chats[i%2];
  const selectedEvent=(i*13)%EVENTS_PER_CHAT;
  const selection={
    chatId:chat.chatId,
    turnId:'turn:'+chat.prefix.toLowerCase()+':'+selectedEvent,
    generationId:'gen:'+chat.prefix.toLowerCase()+':'+selectedEvent,
    correlationId:'corr:'+chat.prefix.toLowerCase()+':'+selectedEvent,
    worldRevision:selectedEvent,
  };
  const t=performance.now();
  const result=surface.adapters.queryHistorian({
    query:'Beacon passage '+selectedEvent,
    precisionRequired:true,
    maxCandidates:8,
    selection,
  });
  queryTimes.push(performance.now()-t);
  maxExamined=Math.max(maxExamined,Number(result.diagnostics?.examined??0));
  for(const nomination of result.nominations){
    const rows=surface.adapters.drillDown(nomination,{selection});
    if(!rows.length)continue;
    if(rows.some((row)=>row.metadata?.chatId!==chat.chatId))falseCrossChatNominations+=1;
    if((nomination.sourceRevisionRefs??[]).some((ref)=>!producer.graph.isSourceRevisionActive(ref)))staleNominations+=1;
  }
}
assert.equal(falseCrossChatNominations,0);
assert.equal(staleNominations,0);

const uiTimes=[];
let crossGenerationEvidenceRows=0;
for(let i=0;i<UI_READS;i++){
  const chat=chats[i%2];
  const selectedEvent=(i*7)%EVENTS_PER_CHAT;
  const selection={
    chatId:chat.chatId,
    turnId:'turn:'+chat.prefix.toLowerCase()+':'+selectedEvent,
    generationId:'gen:'+chat.prefix.toLowerCase()+':'+selectedEvent,
    correlationId:'corr:'+chat.prefix.toLowerCase()+':'+selectedEvent,
    worldRevision:selectedEvent,
  };
  const t=performance.now();
  const model=surface.adapters.readMemory(selection);
  uiTimes.push(performance.now()-t);
  for(const row of model.evidence){
    if(row.identity.chatId!==chat.chatId||row.identity.generationId!==selection.generationId)crossGenerationEvidenceRows+=1;
  }
}
assert.equal(crossGenerationEvidenceRows,0);

const skyArcBefore=surface.adapters.summaryArtifact('ARC:sky-arc').id;
const orchardArcBefore=surface.adapters.summaryArtifact('ARC:orchard-arc').id;
const corrected=evidenceByChat.get(chats[0].chatId)[0];
const correctionStart=performance.now();
const invalidation=producer.invalidateSourceRevision(corrected.sourceRevisionId,{removed:true,reason:'WAVE4_STRESS_CORRECTION'});
let rebuildBatches=0;
while(producer.summaryStatus().pendingWorkUnits){
  producer.runSummaryCompaction({maxUnits:16});
  rebuildBatches+=1;
  if(rebuildBatches>20)throw new Error('Wave 4 correction rebuild did not converge');
}
const correctionMs=performance.now()-correctionStart;
assert.ok(invalidation.affectedSummaryScopeRefs.includes('SCENE:sky-0'));
assert.ok(invalidation.affectedSummaryScopeRefs.includes('ARC:sky-arc'));
assert.equal(invalidation.affectedSummaryScopeRefs.includes('ARC:orchard-arc'),false);
assert.notEqual(surface.adapters.summaryArtifact('ARC:sky-arc').id,skyArcBefore);
assert.equal(surface.adapters.summaryArtifact('ARC:orchard-arc').id,orchardArcBefore);

const sleepEvidence=evidenceByChat.get(chats[1].chatId)[100];
const sleepSelection={
  chatId:chats[1].chatId,
  turnId:sleepEvidence.metadata.turnId,
  generationId:sleepEvidence.metadata.generationId,
  correlationId:sleepEvidence.metadata.correlationId,
};
const session=surface.adapters.startConsolidation([{
  type:'REFLECTION',
  input:{
    reflectionKey:'stress:orchard:beacon-routine',
    statement:'Rin may use repeated Beacon checks as a navigation routine.',
    subjectRefs:['Rin'],
    supportEvidenceRefs:[sleepEvidence.id],
    contradictionEvidenceRefs:[],
    episodeRefs:[],
    sourceRevisionRefs:[sleepEvidence.sourceRevisionId],
    confidence:0.6,
    action:'REINFORCE',
    provenance:['wave4-stress'],
  },
}],{
  selection:sleepSelection,
  generationFence:{...sleepSelection,contextSealId:'stress:seal'},
  sourceRevisionRefs:[sleepEvidence.sourceRevisionId],
  worldRevision:sleepEvidence.worldRevision,
  sceneRevision:sleepEvidence.sceneRevision,
});
const workUnits=surface.adapters.consolidationWorkUnits(session.id,{maxUnits:32});
assert.equal(workUnits.length,1);
const parked=surface.adapters.runConsolidation(session.id,{sealedGenerationIds:[sleepSelection.generationId]});
assert.equal(parked.state,'PARKED_AFTER_SEAL');
assert.equal(parked.cursor,0);
assert.equal(parked.publishedArtifactIds.length,0);

const beforeReloadEvidence=producer.graph.evidence.size;
const snapshot=producer.snapshot();
let restored=MemoryTemporalProducer.fromSnapshot(snapshot);
let restoredSurface=createMemoryIntegrationSurface(restored);
assert.equal(restored.graph.evidence.size,beforeReloadEvidence);
const resumed=restoredSurface.adapters.runConsolidation(session.id,{sealedGenerationIds:[]});
assert.equal(resumed.state,'COMPLETED');
assert.equal(resumed.publishedArtifactIds.length,1);
const replay=restoredSurface.adapters.runConsolidation(session.id,{sealedGenerationIds:[]});
assert.deepEqual(replay.publishedArtifactIds,resumed.publishedArtifactIds);

const status=restored.status();
const uiSnapshotBytes=JSON.stringify(restored.uiReadModel.snapshot()).length*2;
const producerSnapshotBytes=JSON.stringify(restored.snapshot()).length*2;
const finalQuery=restoredSurface.adapters.queryHistorian({
  query:'Beacon passage 100',
  precisionRequired:true,
  selection:{
    chatId:chats[1].chatId,
    turnId:'turn:orchard:100',
    generationId:'gen:orchard:100',
    correlationId:'corr:orchard:100',
    worldRevision:100,
  },
});
for(const nomination of finalQuery.nominations){
  const rows=restoredSurface.adapters.drillDown(nomination,{selection:{chatId:chats[1].chatId}});
  if(rows.some((row)=>row.metadata?.chatId!==chats[1].chatId))falseCrossChatNominations+=1;
  if((nomination.sourceRevisionRefs??[]).some((ref)=>!restored.graph.isSourceRevisionActive(ref)))staleNominations+=1;
}
assert.equal(falseCrossChatNominations,0);
assert.equal(staleNominations,0);

console.log('MEMORY_WAVE4_STRESS '+JSON.stringify({
  pass:true,
  chats:2,
  rawEvents:EVENTS_PER_CHAT*2,
  episodes:restored.experienceStore.episodes.size,
  scopes:status.summaryHierarchy.scopes,
  buildMs:Number(buildMs.toFixed(3)),
  compactionBatches,
  selectedHistorian:{
    queries:PROFILE_QUERIES,
    p50Ms:Number(p(queryTimes,.5).toFixed(4)),
    p95Ms:Number(p(queryTimes,.95).toFixed(4)),
    maxExamined,
    falseCrossChatNominations,
    staleNominations,
  },
  uiReads:{
    reads:UI_READS,
    p50Ms:Number(p(uiTimes,.5).toFixed(4)),
    p95Ms:Number(p(uiTimes,.95).toFixed(4)),
    crossGenerationEvidenceRows,
  },
  correction:{
    ms:Number(correctionMs.toFixed(3)),
    rebuildBatches,
    unrelatedArcIdentityPreserved:restoredSurface.adapters.summaryArtifact('ARC:orchard-arc').id===orchardArcBefore,
  },
  consolidation:{
    workUnits:workUnits.length,
    sealedState:parked.state,
    sealedPublished:parked.publishedArtifactIds.length,
    resumedPublished:resumed.publishedArtifactIds.length,
    duplicatePublications:replay.publishedArtifactIds.length-resumed.publishedArtifactIds.length,
  },
  rawEvidenceLoss:EVENTS_PER_CHAT*2-restored.graph.evidence.size,
  uiRetrievalHistory:status.uiReadModel.retrievalHistory,
  uiSnapshotUtf16Bytes:uiSnapshotBytes,
  producerSnapshotUtf16Bytes:producerSnapshotBytes,
  summaryEstimatedUtf16Bytes:status.summaryHierarchy.estimatedRetainedUtf16Bytes,
  queryIndexEstimatedUtf16Bytes:status.summaryHierarchy.queryIndex.estimatedUtf16Bytes,
  providerRequired:false,
  externalDatabaseRequired:false,
  backgroundServiceRequired:false,
}));
