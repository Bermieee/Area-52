import assert from 'node:assert/strict';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';

const EVENTS=3000;
const EPISODES=1000;
const SCENES=100;
const ARCS=10;
const EXTERNAL_MAPPINGS=300;
const PROFILE_ITERATIONS=40;

const p50=(values)=>{
  const xs=[...values].sort((a,b)=>a-b);
  return xs[Math.max(0,Math.ceil(xs.length*.50)-1)]??0;
};
const p95=(values)=>{
  const xs=[...values].sort((a,b)=>a-b);
  return xs[Math.max(0,Math.ceil(xs.length*.95)-1)]??0;
};

let producer=new MemoryTemporalProducer();
const raw=[];

for(let i=0;i<EVENTS;i++){
  raw.push(producer.appendEvidence({
    id:'w3:ev:'+i,
    sourceId:'w3:source:'+i,
    sourceRevisionId:'w3:source:'+i+'@r1',
    exactContent:'Actor'+(i%50)+' crossed JourneyDistrict'+(i%25)+' during MemoryEvent'+i+'.',
    kind:'EXPERIENCE',
    occurredAt:i,
    worldRevision:i,
    sceneRevision:Math.floor(i/30)+1,
    participants:['Actor'+(i%50)],
    knownBy:['Actor'+(i%50)],
  }));
}

for(let i=0;i<EPISODES;i++){
  const ev=raw[i*3];
  producer.publishEpisode({
    logicalId:'w3:episode:'+i,
    sceneId:'w3:scene:'+Math.floor((i*3)/30),
    sceneRevision:Math.floor((i*3)/30)+1,
    sourceRevisionRefs:[ev.sourceRevisionId],
    evidenceRefs:[ev.id],
    participants:['Actor'+((i*3)%50)],
    knownBy:['Actor'+((i*3)%50)],
    significance:(i%10)/10,
    timeStart:ev.occurredAt,
    timeEnd:ev.occurredAt,
    summary:'Actor'+((i*3)%50)+' remembers MemoryEvent'+(i*3)+' in JourneyDistrict'+((i*3)%25)+'.',
  });
}

for(let s=0;s<SCENES;s++){
  producer.defineSummaryScope({
    level:'SCENE',
    scopeId:'w3-scene-'+s,
    parentScopeRefs:['ARC:w3-arc-'+Math.floor(s/10)],
    sourceSelector:{worldRevisionStart:s*30,worldRevisionEnd:s*30+29},
  });
}
for(let a=0;a<ARCS;a++){
  producer.defineSummaryScope({
    level:'ARC',
    scopeId:'w3-arc-'+a,
    parentScopeRefs:['STORY:w3-story'],
    childScopeRefs:Array.from({length:10},(_,j)=>'SCENE:w3-scene-'+(a*10+j)),
  });
}
producer.defineSummaryScope({
  level:'STORY',
  scopeId:'w3-story',
  childScopeRefs:Array.from({length:ARCS},(_,a)=>'ARC:w3-arc-'+a),
});

const buildStarted=performance.now();
let buildBatches=0;
while(producer.summaryStatus().pendingWorkUnits){
  producer.runSummaryCompaction({maxUnits:16});
  buildBatches+=1;
  if(buildBatches>50)throw new Error('Wave 3 hierarchy build did not converge');
}
const hierarchyBuildMs=performance.now()-buildStarted;
producer.rebuildHistorian();

const bridgeStarted=performance.now();
const bridgeReceipts=[];
for(let i=0;i<EXTERNAL_MAPPINGS;i++){
  const ownerRef={
    kind:'ArtifactReference',
    artifactId:'external-owner-artifact:'+i,
    artifactType:'KnowledgeEvidence',
    owner:'CORE',
    revision:1,
    domain:'KNOWLEDGE',
    sourceRevisionSet:['external-source:'+i+'@r1'],
    worldRevision:10000+i,
    sceneRevision:null,
    contentHash:null,
    provenanceRef:null,
    expiry:null,
    authorityGranted:false,
    settlementAuthority:false,
    contextSealAuthority:false,
  };
  bridgeReceipts.push(producer.admitExternalEvidenceMapping({
    kind:'MemoryExternalEvidenceMappingRequest',
    contractVersion:'1.0.0',
    ownerArtifactRef:ownerRef,
    externalEvidenceRef:'external-evidence:'+i,
    source:{
      sourceId:'external-source:'+i,
      sourceRevisionId:'external-source:'+i+'@r1',
      exactContent:'External exact evidence '+i+' for BridgeActor'+(i%30)+'.',
      evidenceKind:'OBSERVED_EXPERIENCE',
      occurredAt:10000+i,
      worldRevision:10000+i,
      participants:['BridgeActor'+(i%30)],
      knownBy:['BridgeActor'+(i%30)],
      perspective:'WORLD',
      provenance:['stress-external:'+i],
    },
    revisionProof:{
      sourceRevisionId:'external-source:'+i+'@r1',
      ownerArtifactRevision:1,
      worldRevision:10000+i,
    },
  }));
}
const bridgeAdmissionMs=performance.now()-bridgeStarted;
assert.equal(bridgeReceipts.filter((row)=>row.status==='ADMITTED').length,EXTERNAL_MAPPINGS);
assert.equal(producer.evidenceBridge.status().currentMappings,EXTERNAL_MAPPINGS);

const query={query:'JourneyDistrict0 overview',mode:'EXPLICIT_HISTORY',resolutionHint:'ARC',maxCandidates:12};
const exactTimes=[];
let exactMaxExamined=0;
for(let i=0;i<PROFILE_ITERATIONS;i++){
  const t=performance.now();
  const result=producer.historian.query({query:query.query,mode:'EXPLICIT_HISTORY',maxCandidates:12});
  exactTimes.push(performance.now()-t);
  exactMaxExamined=Math.max(exactMaxExamined,result.diagnostics.examined);
  assert.ok(result.nominations.length>0);
}

const profile=producer.profileHierarchyQuery(query,{iterations:PROFILE_ITERATIONS,warmup:5});
assert.equal(profile.status,'MEASURED');
assert.ok(profile.before.artifactsExamined>=profile.afterIndexedCold.artifactsExamined);

producer.summaryHierarchy.clearQueryCache();
const broadColdStarted=performance.now();
const broadCold=producer.queryHistorian(query);
const broadColdMs=performance.now()-broadColdStarted;
assert.ok(broadCold.nominations.length>0);
assert.equal(broadCold.diagnostics.baseQueryUsed,false);
const broadWarmTimes=[];
for(let i=0;i<PROFILE_ITERATIONS;i++){
  const t=performance.now();
  const result=producer.queryHistorian(query);
  broadWarmTimes.push(performance.now()-t);
  assert.ok(result.nominations.length>0);
  assert.equal(result.diagnostics.profile.cacheHit,true);
}

const arc0Before=producer.summaryArtifact('ARC:w3-arc-0').id;
const arc9Before=producer.summaryArtifact('ARC:w3-arc-9').id;
producer.queryHistorian({query:'JourneyDistrict0 overview',resolutionHint:'ARC'});
producer.queryHistorian({query:'JourneyDistrict20 overview',resolutionHint:'ARC'});
const unrelatedWarmBefore=producer.queryHistorian({query:'JourneyDistrict20 overview',resolutionHint:'ARC'});
assert.equal(unrelatedWarmBefore.diagnostics.profile.cacheHit,true);

const updateStarted=performance.now();
const invalidation=producer.invalidateSourceRevision(raw[0].sourceRevisionId,{removed:true,reason:'W3_PROFILE_CORRECTION'});
let rebuildBatches=0;
while(producer.summaryStatus().pendingWorkUnits){
  producer.runSummaryCompaction({maxUnits:16});
  rebuildBatches+=1;
  if(rebuildBatches>50)throw new Error('Wave 3 hierarchy rebuild did not converge');
}
const updateRebuildMs=performance.now()-updateStarted;
assert.ok(invalidation.affectedSummaryScopeRefs.includes('SCENE:w3-scene-0'));
assert.ok(invalidation.affectedSummaryScopeRefs.includes('ARC:w3-arc-0'));
assert.equal(invalidation.affectedSummaryScopeRefs.includes('ARC:w3-arc-9'),false);
assert.notEqual(producer.summaryArtifact('ARC:w3-arc-0').id,arc0Before);
assert.equal(producer.summaryArtifact('ARC:w3-arc-9').id,arc9Before);

const unrelatedAfter=producer.queryHistorian({query:'JourneyDistrict20 overview',resolutionHint:'ARC'});
assert.ok(unrelatedAfter.nominations.length>0);
assert.equal(unrelatedAfter.diagnostics.profile.cacheHit,true);

const correctedQuery=producer.queryHistorian(query);
let staleNominations=0;
for(const nomination of correctedQuery.nominations){
  if((nomination.sourceRevisionRefs??[]).some((ref)=>!producer.graph.isSourceRevisionActive(ref)))staleNominations+=1;
}
assert.equal(staleNominations,0);

const bridgeInvalidationStarted=performance.now();
const bridgeInvalidation=producer.invalidateExternalEvidenceMapping({
  mappingId:bridgeReceipts[0].mappingId,
  removed:true,
  reason:'W3_EXTERNAL_SOURCE_EDIT',
});
const bridgeInvalidationMs=performance.now()-bridgeInvalidationStarted;
assert.equal(bridgeInvalidation.status,'INVALIDATED');
assert.equal(producer.evidenceBridge.resolveMapping({
  ownerArtifactRef:{
    kind:'ArtifactReference',
    artifactId:'external-owner-artifact:0',
    artifactType:'KnowledgeEvidence',
    owner:'CORE',
    revision:1,
    domain:'KNOWLEDGE',
    sourceRevisionSet:['external-source:0@r1'],
    worldRevision:10000,
  },
  externalEvidenceRef:'external-evidence:0',
  sourceRevisionId:'external-source:0@r1',
  worldRevision:10000,
}).ok,false);

const snapshot=producer.snapshot();
const rawEvidenceBeforeReload=producer.graph.evidence.size;
producer=MemoryTemporalProducer.fromSnapshot(snapshot);
assert.equal(producer.graph.evidence.size,rawEvidenceBeforeReload);
assert.equal(producer.evidenceBridge.status().mappings,EXTERNAL_MAPPINGS);
assert.equal(producer.evidenceBridge.status().currentMappings,EXTERNAL_MAPPINGS-1);
assert.equal(producer.summaryStatus().pendingWorkUnits,0);

const reloadQuery=producer.queryHistorian({query:'JourneyDistrict20 overview',resolutionHint:'ARC'});
assert.ok(reloadQuery.nominations.length>0);

const status=producer.summaryStatus();
const bridgeStatus=producer.evidenceBridge.status();
const exactP50=p50(exactTimes),exactP95=p95(exactTimes);
const warmP50=p50(broadWarmTimes),warmP95=p95(broadWarmTimes);

assert.equal(staleNominations,0);
assert.equal(EVENTS+EXTERNAL_MAPPINGS-producer.graph.evidence.size,0);
assert.equal(status.externalDatabaseRequired,false);
assert.equal(bridgeStatus.externalDatabaseRequired,false);
assert.equal(bridgeStatus.backgroundServiceRequired,false);

console.log('MEMORY_WAVE3_STRESS '+JSON.stringify({
  pass:true,
  rawNarrativeEvents:EVENTS,
  externalExactMappings:EXTERNAL_MAPPINGS,
  totalExactEvidence:producer.graph.evidence.size,
  episodes:EPISODES,
  scopes:status.scopes,
  retainedSummaryRevisions:status.retainedArtifactRevisions,
  hierarchyBuildBatches:buildBatches,
  hierarchyBuildMs:Number(hierarchyBuildMs.toFixed(3)),
  bridgeAdmissionMs:Number(bridgeAdmissionMs.toFixed(3)),
  bridgeAdmissionPerMappingMs:Number((bridgeAdmissionMs/EXTERNAL_MAPPINGS).toFixed(4)),
  exactBaseline:{
    p50Ms:Number(exactP50.toFixed(4)),
    p95Ms:Number(exactP95.toFixed(4)),
    maxArtifactsExamined:exactMaxExamined,
  },
  hierarchyLegacyBefore:{
    p50Ms:Number(profile.before.p50Ms.toFixed(4)),
    p95Ms:Number(profile.before.p95Ms.toFixed(4)),
    artifactsExamined:profile.before.artifactsExamined,
  },
  hierarchyIndexedCold:{
    p50Ms:Number(profile.afterIndexedCold.p50Ms.toFixed(4)),
    p95Ms:Number(profile.afterIndexedCold.p95Ms.toFixed(4)),
    artifactsExamined:profile.afterIndexedCold.artifactsExamined,
  },
  hierarchyWarmCache:{
    p50Ms:Number(warmP50.toFixed(4)),
    p95Ms:Number(warmP95.toFixed(4)),
    profileP50Ms:Number(profile.afterWarmCache.p50Ms.toFixed(4)),
    profileP95Ms:Number(profile.afterWarmCache.p95Ms.toFixed(4)),
    cacheEntries:status.queryCache.entries,
  },
  firstBroadColdMs:Number(broadColdMs.toFixed(4)),
  updateRebuildMs:Number(updateRebuildMs.toFixed(3)),
  rebuildBatches,
  bridgeInvalidationMs:Number(bridgeInvalidationMs.toFixed(4)),
  staleNominations,
  unrelatedArcIdentityPreserved:producer.summaryArtifact('ARC:w3-arc-9').id===arc9Before,
  unrelatedCachedViewPreserved:unrelatedAfter.diagnostics.profile.cacheHit===true,
  rawEvidenceLoss:EVENTS+EXTERNAL_MAPPINGS-producer.graph.evidence.size,
  bridgeMappingsRetained:bridgeStatus.mappings,
  bridgeCurrentMappings:bridgeStatus.currentMappings,
  bridgeRawAuditCharacters:bridgeStatus.rawAuditCharacters,
  summaryEstimatedUtf16Bytes:status.estimatedRetainedUtf16Bytes,
  queryIndexEstimatedUtf16Bytes:status.queryIndex.estimatedUtf16Bytes,
  queryCacheEstimatedUtf16Bytes:status.queryCache.estimatedUtf16Bytes,
  queryIndexTerms:status.queryIndex.indexedTerms,
  queryCacheEntries:status.queryCache.entries,
  queryIndexBuilds:status.costCounters.queryIndexBuilds,
  queryIndexBuildMs:Number(status.costCounters.queryIndexBuildMs.toFixed(3)),
  queryCacheHits:status.costCounters.queryCacheHits,
  queryCacheMisses:status.costCounters.queryCacheMisses,
  queryCacheEvictions:status.costCounters.queryCacheEvictions,
  providerRequired:false,
  externalDatabaseRequired:false,
  backgroundServiceRequired:false,
}));
