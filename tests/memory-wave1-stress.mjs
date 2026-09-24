import assert from 'node:assert/strict';
import {
  AuthorityClass,
  MEMORY_LIMITS,
  MutationType,
  SettlementDecisionType,
  stableStringify,
} from '../src/memory-contracts.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';

const EVENTS=2600;
const EPISODES=360;
const ENTITIES=120;
const STATE_CHANGES=5;
const REFLECTIONS=120;
const TARGETED_INVALIDATIONS=24;
const QUERIES=160;
let producer=new MemoryTemporalProducer();

function settlementEnvelope({ev,claimId,subjectId,value,worldRevision,decision}) {
  const proposalId='stress-proposal:'+claimId;
  const claim={
    id:claimId,subjectId,predicate:'state',value,
    temporal:{kind:'CURRENT',validFrom:worldRevision},
    authorityClass:AuthorityClass.OBSERVED,confidence:1,owner:'WORLD_STATE',
    provenance:{evidenceIds:[ev.id],sourceRevisionIds:[ev.sourceRevisionId]},
  };
  return {
    proposal:{id:proposalId,owner:'WORLD_STATE',mutationType:MutationType.SET_CLAIM,sourceRevisionIds:[ev.sourceRevisionId],evidenceIds:[ev.id],freshnessRevisionIds:[ev.sourceRevisionId],payload:{claim}},
    decision:{id:'stress-decision:'+claimId,proposalId,decision,owner:'WORLD_STATE',evidenceIds:[ev.id],sourceRevisionIds:[ev.sourceRevisionId],worldRevision,reason:'stress state transition'},
    receipt:{id:'stress-receipt:'+claimId,proposalId,owner:'WORLD_STATE',outcome:'SETTLED',settledArtifactIds:[claimId],supersededArtifactIds:[],revision:worldRevision},
  };
}

const raw=[];
for (let i=0;i<EVENTS;i++) {
  raw.push(producer.appendEvidence({
    id:'stress-ev:'+i,
    sourceId:'stress-source:'+i,
    sourceRevisionId:'stress-source:'+i+'@r1',
    exactContent:'Actor'+(i%ENTITIES)+' experienced MemoryEvent'+i+' at District'+(i%31)+'.',
    kind:'EXPERIENCE',
    occurredAt:i,
    worldRevision:i,
    sceneRevision:i%200,
    participants:['Actor'+(i%ENTITIES)],
    knownBy:['Actor'+(i%ENTITIES)],
    perspective:'WORLD',
  }));
}

let settlementCount=0;
for (let entity=0;entity<ENTITIES;entity++) {
  for (let change=0;change<STATE_CHANGES;change++) {
    const idx=entity*STATE_CHANGES+change;
    const ev=raw[idx];
    producer.applySettlement(settlementEnvelope({
      ev,
      claimId:'stress-claim:'+entity+':'+change,
      subjectId:'Actor'+entity,
      value:'STATE_'+change,
      worldRevision:idx+1,
      decision:change===0?SettlementDecisionType.ACCEPT_CURRENT:SettlementDecisionType.SUPERSEDE,
    }));
    settlementCount+=1;
  }
}

for (let i=0;i<EPISODES;i++) {
  const ev=raw[800+i];
  producer.publishEpisode({
    logicalId:'stress-episode:'+i,
    sceneId:'stress-scene:'+i,
    sceneRevision:i+1,
    sourceRevisionRefs:[ev.sourceRevisionId],
    evidenceRefs:[ev.id],
    participants:['Actor'+(i%ENTITIES)],
    knownBy:['Actor'+(i%ENTITIES)],
    significance:(i%10)/10,
    timeStart:ev.occurredAt,
    timeEnd:ev.occurredAt,
    summary:'Actor'+(i%ENTITIES)+' remembers MemoryEvent'+(800+i)+' in District'+((800+i)%31)+'.',
  });
}

for (let i=0;i<REFLECTIONS;i++) {
  const ev=raw[1200+i];
  producer.reviseReflection({
    reflectionKey:'stress-reflection:'+i,
    statement:'Actor'+(i%ENTITIES)+' recurring pattern MemoryEvent'+(1200+i)+'.',
    subjectRefs:['Actor'+(i%ENTITIES)],
    supportEvidenceRefs:[ev.id],
    confidence:0.5+(i%5)*0.08,
    action:'REINFORCE',
  });
}

producer.rebuildHistorian();
const initialRevisionRefs=producer.memoryRevisionRefs();
const initialProjection=producer.currentProjection();
assert.equal(initialProjection.length,ENTITIES);

const consolidationJobs=[];
for (let i=0;i<70;i++) {
  const ev=raw[1500+i];
  consolidationJobs.push({
    type:'REFLECTION',
    input:{
      reflectionKey:'stress-consolidated:'+Math.floor(i/2),
      statement:'Consolidated Actor'+(i%ENTITIES)+' observation '+i+'.',
      subjectRefs:['Actor'+(i%ENTITIES)],
      supportEvidenceRefs:[ev.id],
      confidence:0.55+(i%4)*0.05,
      action:i%2?'WEAKEN':'REINFORCE',
    },
  });
}
let session=producer.startConsolidation(consolidationJobs);
session=producer.runConsolidation(session.id,{maxUnits:11});
assert.equal(session.state,'CHECKPOINTED');
const interruptedCursor=session.checkpoint.cursor;
const snap=producer.snapshot();
producer=MemoryTemporalProducer.fromSnapshot(snap);
let resumeBatches=0;
while (session.state!=='COMPLETED') {
  session=producer.runConsolidation(session.id,{maxUnits:MEMORY_LIMITS.maxCheckpointWorkUnits});
  resumeBatches+=1;
}
assert.equal(session.publishedArtifactIds.length,70);
assert.equal(new Set(session.publishedArtifactIds).size,70);

let narrowQueries=0;
let maxExamined=0;
let maxReturned=0;
for (let i=0;i<QUERIES;i++) {
  const actor='Actor'+(i%ENTITIES);
  const event=800+(i%EPISODES);
  const result=producer.queryHistorian({
    query:actor+' MemoryEvent'+event,
    mode:'EXPLICIT_HISTORY',
    activeEntityIds:[actor],
  });
  assert.ok(result.nominations.length>0);
  assert.ok(result.nominations.length<=MEMORY_LIMITS.maxHistorianCandidates);
  maxExamined=Math.max(maxExamined,result.diagnostics.examined);
  maxReturned=Math.max(maxReturned,result.nominations.length);
  narrowQueries+=1;
}

const unrelatedEpisode=producer.experienceStore.currentEpisodes().find((row)=>row.logicalId==='stress-episode:200');
assert.ok(unrelatedEpisode);
const unrelatedId=unrelatedEpisode.id;
let invalidatedEpisodes=0;
let invalidatedReflections=0;
for (let i=0;i<TARGETED_INVALIDATIONS;i++) {
  const ev=raw[800+i];
  const receipt=producer.invalidateSourceRevision(ev.sourceRevisionId,{replacedBy:ev.sourceRevisionId.replace('@r1','@r2')});
  invalidatedEpisodes+=receipt.staleEpisodeIds.length;
  invalidatedReflections+=receipt.staleReflectionIds.length;
}
assert.equal(producer.experienceStore.currentEpisodes().find((row)=>row.logicalId==='stress-episode:200').id,unrelatedId);

const postQueries=producer.queryHistorian({query:'Actor80 MemoryEvent1000',mode:'EXPLICIT_HISTORY',activeEntityIds:['Actor80']});
assert.ok(postQueries.nominations.length>0);
assert.equal(postQueries.nominations.some((row)=>row.sourceRevisionRefs.some((ref)=>producer.graph.isSourceRevisionActive(ref)===false)),false);

const projectionBeforeReload=stableStringify(producer.currentProjection({includeStale:true}));
const historyBeforeReload=stableStringify(producer.historicalClaims({includeUnresolved:true,includeStale:true}));
const evidenceCountBeforeReload=producer.graph.evidence.size;
const finalSnapshot=producer.snapshot();
producer=MemoryTemporalProducer.fromSnapshot(finalSnapshot);
assert.equal(stableStringify(producer.currentProjection({includeStale:true})),projectionBeforeReload);
assert.equal(stableStringify(producer.historicalClaims({includeUnresolved:true,includeStale:true})),historyBeforeReload);
assert.equal(producer.graph.evidence.size,evidenceCountBeforeReload);

const currentProjection=producer.currentProjection({includeStale:true});
const staleCurrentClaims=currentProjection.filter((row)=>row.freshness!=='FRESH').length;
const canonicalInference=currentProjection.filter((row)=>row.authorityClass===AuthorityClass.INFERRED).length;
const duplicateReflectionPublications=producer.experienceStore.reflections.size-new Set(producer.experienceStore.reflections.keys()).size;
const historianStatus=producer.historian.status();

assert.ok(maxExamined<=MEMORY_LIMITS.maxHistorianExaminedArtifacts);
assert.ok(maxReturned<=MEMORY_LIMITS.maxHistorianCandidates);
assert.equal(canonicalInference,0);
assert.equal(duplicateReflectionPublications,0);
assert.equal(producer.greenRoom.activeByCharacter.size,0);
assert.equal(historianStatus.providerRequired,false);
assert.equal(historianStatus.embeddingRequired,false);
assert.equal(historianStatus.externalDatabaseRequired,false);

console.log('MEMORY_WAVE1_STRESS '+JSON.stringify({
  pass:true,
  rawEvents:EVENTS,
  sourceRevisions:EVENTS,
  settlements:settlementCount,
  projectionSlots:currentProjection.length,
  historicalClaims:producer.historicalClaims({includeUnresolved:true,includeStale:true}).length,
  episodesTotal:producer.experienceStore.episodes.size,
  currentFreshEpisodes:producer.experienceStore.currentEpisodes().length,
  reflectionsTotal:producer.experienceStore.reflections.size,
  currentFreshReflections:producer.experienceStore.currentReflections().length,
  consolidationJobs:consolidationJobs.length,
  interruptedCursor,
  resumeBatches,
  historianQueries:narrowQueries+1,
  maxExamined,
  maxReturned,
  targetedInvalidations:TARGETED_INVALIDATIONS,
  invalidatedEpisodes,
  invalidatedReflections,
  unrelatedEpisodeIdentityPreserved:producer.experienceStore.currentEpisodes().some((row)=>row.id===unrelatedId),
  staleCurrentClaims,
  canonicalInference,
  duplicateReflectionPublications,
  rawEvidenceLoss:EVENTS-producer.graph.evidence.size,
  historianRecords:historianStatus.records,
  indexedTerms:historianStatus.indexedTerms,
  retainedDiagnostics:producer.status().diagnostics.length,
  maxCheckpointWorkUnits:MEMORY_LIMITS.maxCheckpointWorkUnits,
  initialRevisionRefCount:initialRevisionRefs.length,
}));
