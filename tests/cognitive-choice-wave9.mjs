import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {browserHostConformanceReport} from '../src/browser-host-conformance.js';
import {CognitiveChoiceController,isHotCognitionSufficient} from '../src/cognitive-choice-controller.js';
import {CognitiveReason} from '../src/cognitive-choice-contracts.js';
import {runCognitiveChoiceWave9Acceptance} from './cognitive-choice-wave9-harness.js';

test('Wave 9 Cognitive Choice Controller acceptance is green',()=>{
  const r=runCognitiveChoiceWave9Acceptance();
  assert.equal(r.pass,true,JSON.stringify(r.metrics,null,2));
});

test('Cognitive Choice receipt is structured, revision fenced, and authority-free',()=>{
  const r=runCognitiveChoiceWave9Acceptance(),receipt=r.mixed.cognitiveChoiceReceipt;
  assert.equal(receipt.kind,'CognitiveChoiceReceipt');
  assert.ok(receipt.turnId&&receipt.correlationId);
  assert.ok(Array.isArray(receipt.consideredCognitionOptions));
  assert.ok(Array.isArray(receipt.admittedJobs));
  assert.ok(Array.isArray(receipt.skippedJobs));
  assert.ok(Array.isArray(receipt.deferredJobs));
  assert.ok(receipt.candidateCounts.nominated>=receipt.candidateCounts.deduplicated);
  assert.equal(receipt.correctiveRetrieval.maxCorrections,1);
  assert.equal(receipt.truthAuthority,false);
  assert.equal(receipt.settlementAuthority,false);
  assert.equal(receipt.contextSealBypass,false);
});

test('hot-only policy is conservative and cannot hide anchored long-term lookup',()=>{
  const controller=new CognitiveChoiceController();
  const fake={
    snapshotId:'hot:1',worldRevision:1,sceneRevision:2,invalidationState:[],
    segments:{SCENE:{freshness:'FRESH',value:{scene:'room'}}},
  };
  assert.equal(isHotCognitionSufficient({snapshot:fake,query:'Continue the current scene.',intent:'CURRENT',anchorEntityIds:[],worldRevision:1,sceneRevision:2}),true);
  assert.equal(isHotCognitionSufficient({snapshot:fake,query:'Continue the current scene.',intent:'CURRENT',anchorEntityIds:['mara'],worldRevision:1,sceneRevision:2}),false);
  assert.equal(isHotCognitionSufficient({snapshot:fake,query:'Who owned the blade?',intent:'HISTORICAL',anchorEntityIds:[],worldRevision:1,sceneRevision:2}),false);
  assert.ok(controller);
});

test('post-seal observations only revise the decision receipt, never the sealed packet',()=>{
  const r=runCognitiveChoiceWave9Acceptance();
  assert.ok(r.lateReceipt.receiptRevision>r.high.cognitiveChoiceReceipt.receiptRevision);
  assert.ok(r.lateReceipt.reasonCodes.includes(CognitiveReason.SEAL_CLOSED));
  assert.equal(r.high.sealReceipt.packetHash,r.high.cognitiveChoiceReceipt.seal.packetHash);
});

test('Wave 9 production modules remain browser-host safe',()=>{
  const paths=['src/cognitive-choice-contracts.js','src/cognitive-choice-controller.js','src/generation-publication.js','src/cognitive-core.js'];
  const rows=paths.map(path=>({path,source:readFileSync(new URL('../'+path,import.meta.url),'utf8')}));
  const report=browserHostConformanceReport(rows);
  assert.equal(report.pass,true,JSON.stringify(report.results,null,2));
});
