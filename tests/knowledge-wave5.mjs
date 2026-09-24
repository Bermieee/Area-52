import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {AuthorityClass} from '../src/contracts.js';
import {
  KnowledgeAuthorityOrigin,KnowledgeContractError,KnowledgeSourceClass,KnowledgeTemporalStatus,
  classifyKnowledgeEvidenceFreshness,createKnowledgeEvidence,knowledgeContractCompatibility,
} from '../src/knowledge-evidence.js';
import {applyPrecisionResult,knowledgeEvidenceFromRetrievalCandidate} from '../src/knowledge-integration-spine.js';
import {browserHostConformanceReport} from '../src/browser-host-conformance.js';
import {runKnowledgeWave5Acceptance} from './knowledge-wave5-harness.js';

test('Wave 5 Knowledge Integration Spine acceptance is green without claiming live FT003/FT004',()=>{
  const r=runKnowledgeWave5Acceptance();
  assert.equal(r.pass,true,JSON.stringify(r.metrics,null,2));
  assert.equal(r.fixture.ft003.liveAcceptance,false);
  assert.equal(r.fixture.ft004.liveAcceptance,false);
});

test('compatible KnowledgeEvidence minor versions accept and preserve unknown optional fields safely',()=>{
  const e=createKnowledgeEvidence({contractVersion:'1.7.4',evidenceId:'v1',artifactRef:{id:'a'},sourceClass:'SOURCE_LORE',authorityClass:'SOURCE_CANON',authorityOrigin:'SOURCE',temporalStatus:'CURRENT',futureOptional:{x:1}});
  assert.equal(knowledgeContractCompatibility('1.7.4').compatible,true);
  assert.deepEqual(e.extensions.futureOptional,{x:1});
  assert.equal(e.contractVersion,'1.0.0');
});

test('incompatible KnowledgeEvidence major version rejects with typed failure',()=>{
  assert.throws(()=>createKnowledgeEvidence({contractVersion:'2.0.0',evidenceId:'v2',artifactRef:{id:'a'},sourceClass:'SOURCE_LORE',authorityClass:'SOURCE_CANON',authorityOrigin:'SOURCE',temporalStatus:'CURRENT'}),error=>error instanceof KnowledgeContractError&&error.code==='KNOWLEDGE_CONTRACT_INCOMPATIBLE_MAJOR');
});

test('missing authority and unknown temporal status reject instead of coercing',()=>{
  assert.throws(()=>createKnowledgeEvidence({evidenceId:'missing-auth',artifactRef:{id:'a'},sourceClass:'SOURCE_LORE',authorityOrigin:'SOURCE',temporalStatus:'CURRENT'}),error=>error.code==='KNOWLEDGE_AUTHORITY_REQUIRED');
  assert.throws(()=>createKnowledgeEvidence({evidenceId:'bad-time',artifactRef:{id:'a'},sourceClass:'SOURCE_LORE',authorityClass:'SOURCE_CANON',authorityOrigin:'SOURCE',temporalStatus:'PROBABLY_CURRENT'}),error=>error.code==='KNOWLEDGE_TEMPORAL_STATUS_UNSUPPORTED');
});

test('RAPTOR/derived representation cannot claim SOURCE_CANON',()=>{
  assert.throws(()=>createKnowledgeEvidence({evidenceId:'raptor',artifactRef:{id:'r'},sourceClass:KnowledgeSourceClass.DERIVED_REPRESENTATION,authorityClass:AuthorityClass.SOURCE_CANON,authorityOrigin:KnowledgeAuthorityOrigin.INFERENCE,temporalStatus:KnowledgeTemporalStatus.CURRENT}),error=>error.code==='KNOWLEDGE_AUTHORITY_ESCALATION');
});

test('Reflection cannot claim OBSERVED authority',()=>{
  assert.throws(()=>createKnowledgeEvidence({evidenceId:'reflection',artifactRef:{id:'r'},sourceClass:KnowledgeSourceClass.REFLECTION,authorityClass:AuthorityClass.OBSERVED,authorityOrigin:KnowledgeAuthorityOrigin.INFERENCE,temporalStatus:KnowledgeTemporalStatus.UNCERTAIN}),error=>error.code==='KNOWLEDGE_AUTHORITY_ESCALATION');
});

test('provider or derived output cannot self-claim SETTLED authority',()=>{
  assert.throws(()=>createKnowledgeEvidence({evidenceId:'provider-settled',artifactRef:{id:'p'},sourceClass:KnowledgeSourceClass.DERIVED_REPRESENTATION,authorityClass:AuthorityClass.SETTLED,authorityOrigin:KnowledgeAuthorityOrigin.INFERENCE,temporalStatus:KnowledgeTemporalStatus.CURRENT,providerAuthority:true}),error=>error.code==='KNOWLEDGE_AUTHORITY_ESCALATION');
});

test('Tree nomination cannot manufacture source authority',()=>{
  assert.throws(()=>createKnowledgeEvidence({evidenceId:'tree',artifactRef:{id:'tree-summary'},sourceClass:KnowledgeSourceClass.DERIVED_REPRESENTATION,authorityClass:AuthorityClass.SOURCE_CANON,authorityOrigin:KnowledgeAuthorityOrigin.INFERENCE,temporalStatus:KnowledgeTemporalStatus.CURRENT,candidateLineage:{nominationChannels:['TREE']}}),error=>error.code==='KNOWLEDGE_AUTHORITY_ESCALATION');
});

test('retrieval rank cannot upgrade DERIVED source authority',()=>{
  const e=knowledgeEvidenceFromRetrievalCandidate({candidateId:'ranked',artifactRef:{id:'derived'},sourceRevisionRefs:['src@1'],channel:'DENSE',rankSignals:{dense:999},authorityClass:'DERIVED',truthStatus:'CURRENT'});
  assert.equal(e.authorityClass,'INFERRED');
  assert.equal(e.retrievalMetadata.rankSignals.dense,999);
});

test('stale Precision result is rejected for active admission',()=>{
  const e=knowledgeEvidenceFromRetrievalCandidate({candidateId:'stale-c',artifactRef:{id:'x'},sourceRevisionRefs:['src@1'],channel:'DENSE',authorityClass:'DERIVED',truthStatus:'CURRENT'});
  assert.throws(()=>applyPrecisionResult(e,{candidateId:'stale-c',freshness:'STALE',sourceRevisionIds:['src@1']}),error=>error.code==='KNOWLEDGE_STALE_PRECISION');
});

test('revision freshness fences source and dependency revisions independently',()=>{
  const e=createKnowledgeEvidence({evidenceId:'freshness',artifactRef:{id:'a'},sourceClass:'EPISODIC_MEMORY',authorityClass:'OBSERVED',authorityOrigin:'CARRIED',sourceAuthorityClass:'OBSERVED',temporalStatus:'CURRENT',sourceRevisionRefs:['experience@5'],dependencyRevisionRefs:['episode@3']});
  assert.equal(classifyKnowledgeEvidenceFreshness(e,{activeSourceRevisionRefs:['experience@6'],activeDependencyRevisionRefs:['episode@3']}),'STALE');
  assert.equal(classifyKnowledgeEvidenceFreshness(e,{activeSourceRevisionRefs:['experience@5'],activeDependencyRevisionRefs:['episode@4']}),'STALE');
  assert.equal(classifyKnowledgeEvidenceFreshness(e,{activeSourceRevisionRefs:['experience@5'],activeDependencyRevisionRefs:['episode@3']}),'FRESH');
});

test('source retirement preserves history while invalidating active derived representations',()=>{
  const core=new Area52CognitiveCore();
  core.importAndLearn({id:'retire:lore',sourceType:'LORE',content:'The Lantern is silver.',at:0});
  core.registry.registerDerivedArtifact({artifactId:'retire:child',artifact:{kind:'Derived',id:'retire:child'},sourceRevisionIds:['retire:lore@1'],activity:'TEST',agent:'test'});
  const retired=core.registry.retireSource('retire:lore',{reason:'SOURCE_REMOVED'});
  assert.equal(retired.changed,true);
  assert.equal(core.registry.isSourceRetired('retire:lore'),true);
  assert.equal(core.registry.isActiveRevision('retire:lore@1'),false);
  assert.equal(core.registry.isArtifactValid('retire:child'),false);
  assert.ok(core.registry.getRevision('retire:lore@1'));
  assert.match(core.registry.getRevision('retire:lore@1').exactContent,/Lantern/);
});

test('new browser-visible knowledge modules have no forbidden Node host assumptions',()=>{
  const paths=['src/knowledge-evidence.js','src/knowledge-integration-spine.js','src/nexus-shadow-adapter.js'];
  const rows=paths.map(path=>({path,source:readFileSync(new URL('../'+path,import.meta.url),'utf8')}));
  const report=browserHostConformanceReport(rows);
  assert.equal(report.results.every(x=>x.pass),true,JSON.stringify(report.results,null,2));
});
