import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runWave6Acceptance} from './wave6-integration-harness.js';
import {ContractDriftStatus,comparePublicContractSnapshots,createPublicContractSnapshot} from '../src/contract-drift-detector.js';
import {IntegrationRefKind,resolveIntegrationCheckpoint} from '../src/integration-control-plane.js';
import {Wave6CheckpointCatalog} from '../src/wave6-contract-fixtures.js';
import {createIntegrationLaneManifest,preflightAssemblyLane,AssemblyPreflightState} from '../src/assembly-preflight.js';
import {knowledgeEvidenceFromRetrievalCandidate} from '../src/knowledge-integration-spine.js';
import {dedupeKnowledgeEvidence} from '../src/knowledge-evidence.js';
import {browserHostConformanceReport} from '../src/browser-host-conformance.js';

test('Wave 6 shared-contract and integration rehearsal acceptance is green without live claims',()=>{
  const r=runWave6Acceptance();
  assert.equal(r.pass,true,JSON.stringify(r.metrics,null,2));
  assert.equal(r.gate.state,'BLOCKED');
  assert.equal(r.gate.phase2PromotionAllowed,false);
  assert.equal(r.ft002.summary.liveAcceptance,false);
  assert.equal(r.ft005.summary.liveAcceptance,false);
});

test('accepted-checkpoint lock defaults to accepted SHA and refuses a newer moving head',()=>{
  const record=Wave6CheckpointCatalog.scene;
  assert.notEqual(record.branchHeadSha,record.acceptedCheckpointSha);
  assert.equal(resolveIntegrationCheckpoint(record).selectedSha,record.acceptedCheckpointSha);
  const moving=resolveIntegrationCheckpoint(record,{refKind:IntegrationRefKind.BRANCH_HEAD});
  assert.equal(moving.ok,false);
  assert.equal(moving.code,'UNACCEPTED_BRANCH_HEAD');
});

test('contract drift detector emits only the five allowed deterministic states',()=>{
  const base=createPublicContractSnapshot({lane:'x',checkpoint:'a',accepted:true,contracts:[{contractId:'X',version:'1.0.0',requiredFields:['a'],optionalFields:['b']}]});
  const same=createPublicContractSnapshot({lane:'x',checkpoint:'b',contracts:[{contractId:'X',version:'1.0.0',requiredFields:['a'],optionalFields:['b']}]});
  const extension=createPublicContractSnapshot({lane:'x',checkpoint:'c',contracts:[{contractId:'X',version:'1.1.0',requiredFields:['a'],optionalFields:['b','c']}]});
  const adapter=createPublicContractSnapshot({lane:'x',checkpoint:'d',contracts:[{contractId:'X',version:'1.0.0',requiredFields:['a','c'],optionalFields:['b']}]});
  const breaking=createPublicContractSnapshot({lane:'x',checkpoint:'e',contracts:[{contractId:'X',version:'2.0.0',requiredFields:['a'],optionalFields:['b']}]});
  assert.equal(comparePublicContractSnapshots(base,same).status,ContractDriftStatus.NO_CHANGE);
  assert.equal(comparePublicContractSnapshots(base,extension).status,ContractDriftStatus.COMPATIBLE_EXTENSION);
  assert.equal(comparePublicContractSnapshots(base,adapter).status,ContractDriftStatus.REQUIRES_ADAPTER);
  assert.equal(comparePublicContractSnapshots(base,breaking).status,ContractDriftStatus.BREAKING_CHANGE);
  assert.equal(comparePublicContractSnapshots(base,null).status,ContractDriftStatus.UNKNOWN);
});

test('undocumented integration patch remains CONFLICT',()=>{
  const m=createIntegrationLaneManifest({branch:'lane',acceptedSha:'accepted',acceptanceRun:'run',copiedPaths:[{path:'src/a.js',sourceDigest:'A'}]});
  const p=preflightAssemblyLane(m,{sourceHeadSha:'accepted',sourceFiles:{'src/a.js':{digest:'A'}},integrationFiles:{'src/a.js':{digest:'LOCAL'}}});
  assert.equal(p.state,AssemblyPreflightState.CONFLICT);
});

test('three retrieval channels nominate one evidence identity without multiplying facts',()=>{
  const rows=['BM25','DENSE','RAPTOR'].map((channel,i)=>knowledgeEvidenceFromRetrievalCandidate({
    candidateId:'c:'+i,evidenceIdentity:'shared:evidence',artifactRef:{artifactId:'artifact:shared',revision:1},sourceRevisionRefs:['source@1'],
    channel,nominatedBy:[channel],authorityClass:'SOURCE_CANON',truthStatus:'HISTORICAL',provenance:[{ref:'source@1'}],
  }));
  const d=dedupeKnowledgeEvidence(rows);
  assert.equal(d.evidence.length,1);
  assert.equal(d.duplicateNominations,2);
  assert.deepEqual(d.evidence[0].candidateLineage.nominationChannels,['BM25','DENSE','RAPTOR']);
  assert.equal(d.evidence[0].temporalStatus,'HISTORICAL');
});

test('new Wave 6 browser-visible modules contain no forbidden Node assumptions',()=>{
  const paths=[
    'src/contract-drift-detector.js','src/integration-control-plane.js','src/coprocessor-precision-contract-adapter.js',
    'src/shared-contract-adapters.js','src/phase1-readiness-v2.js','src/wave6-contract-fixtures.js','src/integration-rehearsal-contracts.js',
  ];
  const report=browserHostConformanceReport(paths.map(path=>({path,source:readFileSync(new URL('../'+path,import.meta.url),'utf8')})));
  assert.equal(report.results.every(x=>x.pass),true,JSON.stringify(report.results,null,2));
});
