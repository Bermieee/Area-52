import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryTransportExcerpt} from '../src/memory-transport-excerpt.js';
import {
  createConsolidationProviderInput,
  createConsolidationTask,
  createConsolidationUnit,
  createJevDecisionRequest,
  JevDecisionShape,
} from '../src/coprocessor/index.js';

const artifact={kind:'ArtifactReference',artifactId:'memory:episode:1',artifactType:'MemoryEpisode',owner:'MEMORY',revision:7,storageDomain:'episodes',provenanceRef:'memory-drillback:episode:1'};

test('row 65: bounded excerpt declares omissions and preserves owner drillback identity',()=>{
  const transport=createMemoryTransportExcerpt({
    text:'alpha '.repeat(500),
    maxCharacters:1200,
    artifactRef:artifact,
    sourceRevisionRefs:['source:a@1','source:b@2'],
    evidenceRefs:['evidence:a','evidence:b'],
    provenanceRef:'memory-drillback:episode:1',
    transportPurpose:'JEV_EVIDENCE',
  });
  assert.equal(transport.excerpt.length,1200);
  assert.equal(transport.coverage.coverageComplete,false);
  assert.equal(transport.coverage.exhaustiveEvidenceTransported,false);
  assert.ok(transport.coverage.omittedCharacters>0);
  assert.equal(transport.coverage.reasonCode,'MEMORY_TRANSPORT_EXCERPT_BOUND');
  assert.equal(transport.coverage.canonicalKnowledgeDropped,false);
  assert.equal(transport.drillback.artifactRevision,7);
  assert.deepEqual(transport.drillback.sourceRevisionRefs,['source:a@1','source:b@2']);
  assert.deepEqual(transport.drillback.evidenceRefs,['evidence:a','evidence:b']);
  assert.equal(transport.drillback.exactSourceDrillback,true);
});

test('row 65: complete short transport is explicitly complete but still not exhaustive-owner replacement',()=>{
  const transport=createMemoryTransportExcerpt({text:'short exact excerpt',maxCharacters:2400,artifactRef:artifact});
  assert.equal(transport.excerpt,'short exact excerpt');
  assert.equal(transport.coverage.coverageComplete,true);
  assert.equal(transport.coverage.omittedCharacters,0);
  assert.equal(transport.coverage.reasonCode,null);
  assert.equal(transport.coverage.exhaustiveEvidenceTransported,false);
});

test('row 65: consolidation bounded payload retains coverage and drillback structured facts',()=>{
  const transport=createMemoryTransportExcerpt({
    text:'memory detail '.repeat(300),maxCharacters:2400,artifactRef:artifact,
    sourceRevisionRefs:['source:a@1'],evidenceRefs:['evidence:a'],provenanceRef:'memory-drillback:episode:1',
    transportPurpose:'CONSOLIDATION_EVIDENCE',
  });
  const unit=createConsolidationUnit({
    unitId:'unit:transport',artifactRefs:[artifact],sourceRevisionSet:['source:a@1'],
    worldRevision:1,sceneRevision:1,characterStateRevision:0,priority:0,createdAt:0,resumeIdentity:'resume:transport',
  });
  const task=createConsolidationTask(unit);
  const payload=createConsolidationProviderInput(task,{
    unit,
    evidenceSlices:[{artifactRef:artifact,excerpt:transport.excerpt,structuredFacts:transport.structuredFacts,provenanceRef:'memory-drillback:episode:1'}],
  });
  const text=JSON.stringify(payload.selectedContext[0]);
  assert.match(text,/MemoryTransportCoverage/);
  assert.match(text,/MEMORY_TRANSPORT_EXCERPT_BOUND/);
  assert.match(text,/MemoryTransportDrillbackReference/);
  assert.match(text,/source:a@1/);
  assert.match(text,/exactSourceDrillback/);
});

test('row 65: Jev evidence metadata can retain the same omission and drillback receipt',()=>{
  const transport=createMemoryTransportExcerpt({
    text:'jev detail '.repeat(300),maxCharacters:1200,artifactRef:artifact,
    sourceRevisionRefs:['source:a@1'],evidenceRefs:['evidence:a'],provenanceRef:'memory-drillback:episode:1',
    transportPurpose:'JEV_EVIDENCE',
  });
  const request=createJevDecisionRequest({
    decisionId:'decision:transport',decisionType:'LORE_OVERLAP',decisionShape:JevDecisionShape.CHOOSE_ONE,
    turnId:'turn:transport',taskId:'task:transport',correlationId:'corr:transport',causationId:'cause:transport',
    evidenceRefs:[{evidenceId:'e:transport',sourceRef:'memory:episode:1',summary:transport.excerpt,revision:7,available:true,stale:false,
      provenanceRefs:['memory-drillback:episode:1'],metadata:{transportCoverage:transport.coverage,drillback:transport.drillback}}],
    provenanceRefs:['memory-drillback:episode:1'],
    options:[{optionId:'A',evidenceRefs:['e:transport'],payload:{meaning:'use bounded evidence'}}],
    allowedOutcomes:[JevDecisionShape.CHOOSE_ONE,JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN],
    constraints:[],authorityBoundary:{authorityClass:'ADVISORY',ownerId:'LORE'},sourceRevisionSet:['source:a@1'],
    worldRevision:1,sceneRevision:1,characterStateRevision:0,domainRevisions:{lore:1},freshnessToken:'fresh:transport',
    abstentionAllowed:true,deadline:10000,softDeadline:9000,resourceClass:'STANDARD',
    routing:{expectedDecisionValue:.8,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2},
  });
  const metadata=request.evidenceRefs[0].metadata;
  assert.equal(metadata.transportCoverage.coverageComplete,false);
  assert.equal(metadata.transportCoverage.omittedCharacters,transport.coverage.omittedCharacters);
  assert.equal(metadata.drillback.artifactRevision,7);
  assert.equal(metadata.drillback.exactSourceDrillback,true);
});
