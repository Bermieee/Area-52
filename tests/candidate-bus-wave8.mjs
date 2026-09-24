import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CandidateBus} from '../src/candidate-bus.js';
import {RetrievalChannelRegistry} from '../src/retrieval-channel-registry.js';
import {createChannelNomination,createRetrievalChannelDescriptor,CandidateFreshness} from '../src/candidate-bus-contracts.js';
import {browserHostConformanceReport} from '../src/browser-host-conformance.js';
import {runWave8Acceptance,runWave8CandidateBusAcceptance,runWave8IndexLifecycleAcceptance} from './candidate-bus-wave8-harness.js';

test('Wave 8 Hybrid Sensory backbone production acceptance is green',()=>{
  const r=runWave8Acceptance();
  assert.equal(r.pass,true,JSON.stringify(r.metrics,null,2));
});

test('same evidence across channels dedupes while raw channel signals survive',()=>{
  const r=runWave8CandidateBusAcceptance(),candidate=r.longForm.candidates.find(x=>x.evidenceIdentity==='event:promise');
  assert.ok(candidate);
  assert.deepEqual(candidate.channelNominations.map(x=>x.channelId).sort(),['DENSE','GRAPH','HISTORIAN','SPARSE']);
  assert.equal(candidate.channelNominations.find(x=>x.channelId==='SPARSE').rankSignals.bm25Score,12.4);
  assert.equal(candidate.channelNominations.find(x=>x.channelId==='DENSE').rankSignals.cosineSimilarity,.86);
  assert.equal(candidate.channelNominations.find(x=>x.channelId==='GRAPH').graphMetadata.distance,2);
  assert.equal(candidate.truthStatusHint,'HISTORICAL');
});

test('distinct claims in the same source remain distinct evidence identities',()=>{
  const r=runWave8CandidateBusAcceptance();
  assert.equal(r.distinctClaims.candidateCount,2);
  assert.deepEqual(r.distinctClaims.candidates.map(x=>x.claimRefs[0]).sort(),['claim:distrusts','claim:owns']);
});

test('order and at-least-once replay do not change semantic candidate output',()=>{
  const r=runWave8CandidateBusAcceptance();
  assert.equal(r.metrics.orderIndependent,true);
  assert.equal(r.metrics.replayIdempotent,true);
  assert.equal(r.orderA.candidateCount,r.orderB.candidateCount);
});

test('Candidate Bus preserves conflict rather than selecting a winner',()=>{
  const r=runWave8CandidateBusAcceptance();
  assert.deepEqual(r.conflict.candidates.map(x=>x.evidenceIdentity).sort(),['claim:destroyed','claim:removed']);
  assert.deepEqual(r.conflict.candidates.map(x=>x.truthStatusHint).sort(),['CONTRADICTED','UNRESOLVED']);
});

test('retrieval strength and channel count cannot escalate owner authority or truth status',()=>{
  const r=runWave8CandidateBusAcceptance(),candidate=r.authority.candidates[0];
  assert.equal(candidate.authorityClass,'INFERRED');
  assert.equal(candidate.truthStatusHint,'UNRESOLVED');
  assert.equal(candidate.settlementAuthority,false);
  assert.equal(candidate.admissionAuthority,false);
});

test('stale source revision stays visibly stale and never masquerades as fresh',()=>{
  const r=runWave8CandidateBusAcceptance();
  assert.equal(r.stale.candidates[0].freshness,CandidateFreshness.STALE);
  assert.ok(r.stale.fusionReceipt.staleNominationCount>=1);
});

test('pool caps emit deterministic pruning receipts without mutating epistemic metadata',()=>{
  const r=runWave8CandidateBusAcceptance();
  assert.ok(r.bounded.candidateCount<=3);
  assert.ok(r.bounded.fusionReceipt.boundedOutCount>0);
  assert.ok(r.bounded.fusionReceipt.prunedCandidateIds.length>0||r.bounded.fusionReceipt.diagnostics.boundedNominationIds.length>0);
});

test('unknown incompatible candidate and channel versions fail safely',()=>{
  const bus=new CandidateBus();
  const envelope=bus.fuse({nominations:[{kind:'CandidateNomination',contractVersion:'2.0.0',nominationId:'bad',channelId:'BAD'}],retrievalIntents:['i']});
  assert.equal(envelope.candidateCount,0);
  assert.equal(envelope.fusionReceipt.invalidNominationCount,1);
  const registry=new RetrievalChannelRegistry();
  assert.throws(()=>registry.register({descriptor:{channelId:'X',channelVersion:'2.0.0',capabilities:[],supportedIntentKinds:['GENERAL'],maxCandidates:1,revisionRequirements:[],health:'HEALTHY',available:true},retrieve:()=>[]}));
});

test('unknown artifact refs and malformed nominations fail bounded without poisoning the pool',()=>{
  const bus=new CandidateBus({isArtifactKnown:(artifactId)=>artifactId==='known'});
  const unknown=bus.fuse({nominations:[createChannelNomination({nominationId:'unknown:1',channelId:'SPARSE',candidateId:'unknown',evidenceIdentity:'unknown:evidence',artifactRef:{artifactId:'missing',revision:1},sourceRevisionRefs:['s@1'],retrievalIntentIds:['i'],rankSignals:{bm25Score:1},authorityClass:'OBSERVED',truthStatusHint:'CURRENT'})],retrievalIntents:['i'],currentRevisionSet:{sourceRevisionSet:['s@1']}});
  const malformed=bus.fuse({nominations:[null],retrievalIntents:['i'],currentRevisionSet:{sourceRevisionSet:['s@1']}});
  assert.equal(unknown.candidateCount,0);
  assert.equal(unknown.fusionReceipt.invalidNominationCount,1);
  assert.equal(unknown.fusionReceipt.diagnostics.invalidNominations[0].code,'UNKNOWN_ARTIFACT_REF');
  assert.equal(malformed.candidateCount,0);
  assert.equal(malformed.fusionReceipt.invalidNominationCount,1);
});

test('index lifecycle proves sparse+dense revision, tombstone, rebuild, migration and torn recovery',()=>{
  const r=runWave8IndexLifecycleAcceptance();
  assert.equal(r.pass,true,JSON.stringify(r.metrics,null,2));
  assert.equal(r.metrics.sourceEditSmallCone,true);
  assert.equal(r.metrics.rebuildIdentityStable,true);
  assert.equal(r.metrics.migrationCandidateIdentityStable,true);
  assert.equal(r.metrics.tornDetected,true);
  assert.equal(r.metrics.tornNotFresh,true);
});

test('Candidate Bus retains compact receipts, not historic candidate payload sets',()=>{
  const bus=new CandidateBus({limits:{maxReceiptHistory:2}});
  for(let i=0;i<5;i++)bus.fuse({candidateSetId:'set:'+i,nominations:[createChannelNomination({nominationId:'n:'+i,channelId:'SPARSE',candidateId:'c:'+i,evidenceIdentity:'e:'+i,artifactRef:{artifactId:'a:'+i,revision:1},sourceRevisionRefs:['s@1'],retrievalIntentIds:['i'],rankSignals:{bm25Score:i+1},authorityClass:'OBSERVED',truthStatusHint:'CURRENT'})],retrievalIntents:['i'],currentRevisionSet:{sourceRevisionSet:['s@1']}});
  const d=bus.diagnostics();
  assert.equal(d.recentReceipts.length,2);
  assert.equal(d.retainsCandidatePayloadHistory,false);
  assert.equal('candidates' in d,false);
});

test('Wave 8 generation-facing production modules remain browser-host safe',()=>{
  const paths=[
    'src/candidate-bus-contracts.js','src/candidate-bus.js','src/retrieval-channel-registry.js','src/sensory-net-channels.js','src/sensory-net-backbone.js',
    'src/retrieval-index-contracts.js','src/retrieval-representation-provider.js','src/retrieval-index-adapters.js','src/retrieval-index-lifecycle.js',
  ];
  const report=browserHostConformanceReport(paths.map(path=>({path,source:readFileSync(new URL('../'+path,import.meta.url),'utf8')})));
  assert.equal(report.pass,true,JSON.stringify(report.results,null,2));
});
