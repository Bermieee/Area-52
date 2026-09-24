import assert from 'node:assert/strict';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';

const EVENTS=3000;
const EPISODES=1000;
const SCENES=100;
const ARCS=10;
let producer=new MemoryTemporalProducer();
const raw=[];

for(let i=0;i<EVENTS;i++){
  raw.push(producer.appendEvidence({
    id:'w2:ev:'+i,
    sourceId:'w2:source:'+i,
    sourceRevisionId:'w2:source:'+i+'@r1',
    exactContent:'Actor'+(i%50)+' crossed JourneyDistrict'+(i%25)+' during MemoryEvent'+i+'.',
    kind:'EXPERIENCE',
    occurredAt:i,
    worldRevision:i,
    sceneRevision:Math.floor(i/30),
    participants:['Actor'+(i%50)],
    knownBy:['Actor'+(i%50)],
  }));
}
for(let i=0;i<EPISODES;i++){
  const ev=raw[i*3];
  producer.publishEpisode({
    logicalId:'w2:episode:'+i,
    sceneId:'w2:scene:'+Math.floor((i*3)/30),
    sceneRevision:Math.floor((i*3)/30),
    sourceRevisionRefs:[ev.sourceRevisionId],
    evidenceRefs:[ev.id],
    participants:['Actor'+((i*3)%50)],
    knownBy:['Actor'+((i*3)%50)],
    significance:(i%10)/10,
    timeStart:ev.occurredAt,
    timeEnd:ev.occurredAt,
    summary:'Actor'+((i*3)%50)+' remembers MemoryEvent'+(i*3)+' during the long journey.',
  });
}

for(let s=0;s<SCENES;s++){
  producer.defineSummaryScope({
    level:'SCENE',
    scopeId:'w2-scene-'+s,
    parentScopeRefs:['ARC:w2-arc-'+Math.floor(s/10)],
    sourceSelector:{worldRevisionStart:s*30,worldRevisionEnd:s*30+29},
  });
}
for(let a=0;a<ARCS;a++){
  producer.defineSummaryScope({
    level:'ARC',
    scopeId:'w2-arc-'+a,
    parentScopeRefs:['STORY:w2-story'],
    childScopeRefs:Array.from({length:10},(_,j)=>'SCENE:w2-scene-'+(a*10+j)),
  });
}
producer.defineSummaryScope({
  level:'STORY',
  scopeId:'w2-story',
  childScopeRefs:Array.from({length:ARCS},(_,a)=>'ARC:w2-arc-'+a),
});

const buildStarted=performance.now();
let batches=0;
let maxPending=producer.summaryStatus().pendingWorkUnits;
while(producer.summaryStatus().pendingWorkUnits){
  const result=producer.runSummaryCompaction({maxUnits:16});
  batches+=1;
  maxPending=Math.max(maxPending,result.pendingWorkUnits);
  if(batches>50) throw new Error('Wave 2 compaction did not converge');
}
const buildMs=performance.now()-buildStarted;
producer.rebuildHistorian();

const baselineStarted=performance.now();
const baseline=producer.historian.query({
  query:'MemoryEvent long journey history',
  mode:'EXPLICIT_HISTORY',
  maxCandidates:48,
});
const baselineMs=performance.now()-baselineStarted;

const hierarchicalStarted=performance.now();
const hierarchical=producer.queryHistorian({
  query:'MemoryEvent long journey history',
  mode:'EXPLICIT_HISTORY',
  breadth:'BROAD',
  maxCandidates:12,
});
const hierarchicalMs=performance.now()-hierarchicalStarted;

assert.ok(baseline.nominations.length>0);
assert.ok(hierarchical.nominations.length>0);
assert.equal(hierarchical.diagnostics.baseQueryUsed,false);
assert.ok(hierarchical.diagnostics.examined<baseline.diagnostics.examined);
assert.ok(hierarchical.nominations.some((row)=>['STORY','ARC'].includes(row.metadata.resolutionLevel)));

const unrelatedBefore=producer.summaryArtifact('ARC:w2-arc-9').id;
let invalidations=0;
for(let i=0;i<10;i++){
  const receipt=producer.invalidateSourceRevision(raw[i].sourceRevisionId,{removed:true,reason:'W2_STRESS_CORRECTION'});
  invalidations+=receipt.staleSummaryArtifactIds.length;
}
assert.equal(producer.summaryArtifact('ARC:w2-arc-9').id,unrelatedBefore);
const duringRebuild=producer.queryHistorian({
  query:'MemoryEvent long journey history',
  mode:'EXPLICIT_HISTORY',
  breadth:'BROAD',
  maxCandidates:12,
});
let staleNominations=0;
for(const nomination of duringRebuild.nominations){
  if(nomination.metadata?.summaryArtifactId){
    const artifact=producer.summaryHierarchy.artifacts.get(nomination.metadata.summaryArtifactId);
    if(!artifact||!producer.summaryHierarchy.artifactIsFresh(artifact)) staleNominations+=1;
  }else if((nomination.sourceRevisionRefs??[]).some((ref)=>!producer.graph.isSourceRevisionActive(ref))){
    staleNominations+=1;
  }
}
assert.equal(staleNominations,0);

let rebuildBatches=0;
while(producer.summaryStatus().pendingWorkUnits){
  producer.runSummaryCompaction({maxUnits:16});
  rebuildBatches+=1;
  if(rebuildBatches>50) throw new Error('Wave 2 rebuild did not converge');
}

const snap=producer.snapshot();
const rawBeforeReload=producer.graph.evidence.size;
producer=MemoryTemporalProducer.fromSnapshot(snap);
assert.equal(producer.graph.evidence.size,rawBeforeReload);
assert.equal(producer.summaryStatus().pendingWorkUnits,0);
assert.equal(producer.summaryArtifact('ARC:w2-arc-9').id,unrelatedBefore);

const status=producer.summaryStatus();
const story=producer.summaryArtifact('STORY:w2-story');
assert.ok(story);
assert.equal(story.exactEvidenceRefs.length,EVENTS-10);
assert.ok(story.exactSourceRevisionSet.every((ref)=>producer.graph.isSourceRevisionActive(ref)));
assert.equal(status.providerRequired,false);
assert.equal(status.externalDatabaseRequired,false);

console.log('MEMORY_WAVE2_STRESS '+JSON.stringify({
  pass:true,
  rawEvents:EVENTS,
  episodes:EPISODES,
  scopes:status.scopes,
  retainedArtifactRevisions:status.retainedArtifactRevisions,
  freshCurrentArtifacts:status.freshCurrentArtifacts,
  buildBatches:batches,
  rebuildBatches,
  buildMs:Number(buildMs.toFixed(2)),
  baselineQueryMs:Number(baselineMs.toFixed(3)),
  hierarchicalQueryMs:Number(hierarchicalMs.toFixed(3)),
  baselineExactExamined:baseline.diagnostics.examined,
  hierarchicalSummaryExamined:hierarchical.diagnostics.examined,
  retrievalExaminedReduction:baseline.diagnostics.examined-hierarchical.diagnostics.examined,
  hierarchicalBaseQueryUsed:hierarchical.diagnostics.baseQueryUsed,
  staleNominations,
  invalidatedSummaryArtifacts:invalidations,
  unrelatedArcIdentityPreserved:producer.summaryArtifact('ARC:w2-arc-9').id===unrelatedBefore,
  rawEvidenceLoss:EVENTS-producer.graph.evidence.size,
  pendingWorkUnits:status.pendingWorkUnits,
  estimatedRetainedUtf16Bytes:status.estimatedRetainedUtf16Bytes,
  compileEvidenceExamined:status.costCounters.compileEvidenceExamined,
  historianSummaryArtifactsExamined:status.costCounters.historianSummaryArtifactsExamined,
  historianBaseQueriesAvoided:status.costCounters.historianBaseQueriesAvoided,
}));
