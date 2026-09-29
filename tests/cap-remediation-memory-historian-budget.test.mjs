import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryHistorianIndex} from '../src/memory-historian.js';
import {PerspectiveScope} from '../src/memory-contracts.js';

const bytes=(value)=>new TextEncoder().encode(JSON.stringify(value)).length;

function historianFixture(){
  const graph={
    revisionRef:()=> 'graph:r1',
    exactEvidence:()=>null,
  };
  const experienceStore={
    memoryRevisionRefs:()=>['memory:r1'],
  };
  const historian=new MemoryHistorianIndex({graph,experienceStore});
  for(const [index,significance] of [[1,0.9],[2,0.8],[3,0.7]]){
    historian.addRecord({
      kind:'MemoryHistorianRecord',
      id:'historian:test:'+index,
      artifactId:'episode:test:'+index,
      artifactRevision:1,
      artifactType:'SCENE_EPISODE',
      channel:'SCENE_EPISODE',
      representationText:'ember '+String(index)+' '+(index===1?'🔥'.repeat(80)+' ':'')+('detail '.repeat(90)),
      tokens:['ember','detail',String(index)],
      sourceRevisionRefs:['source:test:'+index+'@r1'],
      evidenceRefs:['evidence:test:'+index],
      claimRefs:[],relationshipRefs:[],eventRefs:[],entityRefs:[],participants:[],knownBy:[],
      timeBounds:{start:null,end:null},
      authorityClass:'OBSERVED',
      truthStatusHint:'HISTORICAL',
      significance,
      sequence:10,
      sceneRevision:index,
      worldRevision:index,
      provenance:[{ref:'test:'+index}],
      dependencyRevisions:['source:test:'+index+'@r1'],
      freshness:'FRESH',
      exactDrillbackRefs:['evidence:test:'+index],
    });
  }
  historian.addRecord({
    kind:'MemoryHistorianRecord',
    id:'historian:test:stale',
    artifactId:'episode:test:stale',
    artifactRevision:1,
    artifactType:'SCENE_EPISODE',
    channel:'SCENE_EPISODE',
    representationText:'ember detail stale should never return',
    tokens:['ember','detail','stale'],
    sourceRevisionRefs:['source:test:stale@r1'],
    evidenceRefs:['evidence:test:stale'],
    claimRefs:[],relationshipRefs:[],eventRefs:[],entityRefs:[],participants:[],knownBy:[],
    timeBounds:{start:null,end:null},authorityClass:'OBSERVED',truthStatusHint:'HISTORICAL',
    significance:1,sequence:11,sceneRevision:99,worldRevision:99,
    provenance:[{ref:'test:stale'}],dependencyRevisions:['source:test:stale@r1'],
    freshness:'STALE',exactDrillbackRefs:['evidence:test:stale'],
  });
  historian.revision='memory-historian:test';
  return historian;
}

function request(maxEvidenceBytes){
  return {
    kind:'HistorianMemoryRequest',
    contractVersion:'1.0.0',
    retrievalIntents:[{intentId:'intent:ember',query:'ember detail',mode:'EXPLICIT_HISTORY'}],
    activeEntityIds:[],
    perspectiveConstraint:{scope:PerspectiveScope.WORLD},
    limits:{maxArtifacts:3,maxEvidenceBytes},
  };
}

test('historian evidence budget uses UTF-8 bytes and excludes stale source records before packing',()=>{
  const historian=historianFixture();
  const complete=historian.resolveHistorianMemoryRequest(request(1_000_000));
  assert.equal(complete.artifacts.length,3);
  assert.equal(complete.artifacts.some((row)=>row.artifactRef.artifactId==='episode:test:stale'),false);
  const json=JSON.stringify(complete.artifacts);
  assert.equal(complete.evidenceBytes,new TextEncoder().encode(json).length);
  assert.ok(complete.evidenceBytes>json.length,'multi-byte representation must be counted as UTF-8 bytes');
});

test('historian evidence budget returns the best-ranked prefix and addressable continuation instead of empty overflow',()=>{
  const historian=historianFixture();
  const complete=historian.resolveHistorianMemoryRequest(request(1_000_000));
  assert.equal(complete.status,'OK');
  assert.equal(complete.artifacts.length,3);

  const firstBytes=bytes([complete.artifacts[0]]);
  const bounded=historian.resolveHistorianMemoryRequest(request(firstBytes));

  assert.equal(bounded.status,'DEGRADED');
  assert.equal(bounded.artifacts.length,1);
  assert.equal(bounded.artifacts[0].artifactRef.artifactId,complete.artifacts[0].artifactRef.artifactId);
  assert.equal(bounded.evidenceBytes,firstBytes);
  assert.equal(bounded.processed,1);
  assert.equal(bounded.remaining,2);
  assert.equal(bounded.coverageComplete,false);
  assert.equal(bounded.continuationAvailable,true);
  assert.equal(bounded.limitType,'RANK');
  assert.equal(bounded.canonicalKnowledgeDropped,false);
  assert.equal(bounded.reasonCode,'EVIDENCE_BUDGET_EXCEEDED');
  assert.equal(bounded.boundedOut.length,2);
  assert.deepEqual(
    bounded.boundedOut.map((row)=>row.artifactRef.artifactId),
    complete.artifacts.slice(1).map((row)=>row.artifactRef.artifactId),
  );
  assert.equal(bounded.continuationCursor.nextCandidateId,bounded.boundedOut[0].candidateId);
});

test('historian reports one oversized top artifact honestly without losing its identity',()=>{
  const historian=historianFixture();
  const complete=historian.resolveHistorianMemoryRequest(request(1_000_000));
  const firstBytes=bytes([complete.artifacts[0]]);

  const bounded=historian.resolveHistorianMemoryRequest(request(firstBytes-1));

  assert.equal(bounded.status,'DEGRADED');
  assert.equal(bounded.artifacts.length,0);
  assert.equal(bounded.evidenceBytes,2);
  assert.equal(bounded.processed,0);
  assert.equal(bounded.remaining,3);
  assert.equal(bounded.reasonCode,'EVIDENCE_ARTIFACT_EXCEEDS_BUDGET');
  assert.equal(bounded.continuationAvailable,true);
  assert.equal(bounded.continuationCursor.afterCandidateId,null);
  assert.equal(bounded.boundedOut[0].artifactRef.artifactId,complete.artifacts[0].artifactRef.artifactId);
  assert.equal(bounded.canonicalKnowledgeDropped,false);
});

test('historian candidate transport remains bounded when the owner record uses segmented-scale refs',()=>{
  const graph={revisionRef:()=> 'graph:r1',exactEvidence:()=>null};
  const experienceStore={memoryRevisionRefs:()=>['memory:r1']};
  const historian=new MemoryHistorianIndex({graph,experienceStore});
  const sourceRevisionRefs=Array.from({length:65},(_,i)=>'source:overflow:'+i+'@1');
  const evidenceRefs=Array.from({length:129},(_,i)=>'evidence:overflow:'+i);
  historian.addRecord({
    kind:'MemoryHistorianRecord',id:'historian:overflow',artifactId:'episode:overflow',artifactRevision:1,
    artifactType:'SCENE_EPISODE',channel:'SCENE_EPISODE',representationText:'overflowmanifest evidence',
    tokens:['overflowmanifest','evidence'],sourceRevisionRefs,evidenceRefs,claimRefs:[],relationshipRefs:[],eventRefs:[],
    entityRefs:[],participants:[],knownBy:[],timeBounds:{start:null,end:null},authorityClass:'OBSERVED',
    truthStatusHint:'HISTORICAL',significance:.8,sequence:1,sceneRevision:1,worldRevision:1,provenance:[{ref:'overflow'}],
    dependencyRevisions:[...sourceRevisionRefs,'episode:overflow'],freshness:'FRESH',exactDrillbackRefs:[...evidenceRefs],
  });
  historian.revision='memory-historian:overflow';
  const result=historian.query({query:'overflowmanifest',perspectiveConstraint:{scope:PerspectiveScope.WORLD},maxCandidates:4});
  assert.equal(result.nominations.length,1);
  const nomination=result.nominations[0];
  assert.equal(nomination.sourceRevisionRefs.length,64);
  assert.equal(nomination.evidenceRefs.length,64);
  assert.equal(nomination.dependencyRevisions.length,64);
  assert.equal(nomination.metadata.sourceRevisionRefCount,65);
  assert.equal(nomination.metadata.sourceRevisionRefsComplete,false);
  assert.equal(nomination.metadata.evidenceRefCount,129);
  assert.equal(nomination.metadata.evidenceRefsComplete,false);
  assert.equal(nomination.metadata.transportReferencesBounded,true);
  assert.equal(nomination.metadata.exactSourceDrillback,true);
  assert.equal(nomination.metadata.canonicalKnowledgeDropped,false);
});
