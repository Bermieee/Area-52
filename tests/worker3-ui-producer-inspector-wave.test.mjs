import test from 'node:test';
import assert from 'node:assert/strict';

import { PromptPlanProductionUIAdapter, ForensicsProductionUIAdapter } from '../src/ui-core/wave6-production-adapters.js';
import { createWave11LiveReceiptBinding } from '../src/ui-core/wave11-live-bindings.js';

const selection={chatId:'chat:a',turnId:'turn:1',generationId:'gen:1',correlationId:'corr:1',worldRevision:7,sceneRevision:3,sourceRevisionRefs:['scene:a@3','lore:a@2']};

function promptPlan(){
  return {
    kind:'PromptPlanReadModel',promptPlanId:'plan:1',generationId:'gen:1',turnId:'turn:1',contextSealId:'seal:1',
    modelProfileId:'profile:test',modelProfileRevision:2,worldRevision:7,sceneRevision:3,sourceRevisionRefs:['scene:a@3','lore:a@2'],
    slotAllocation:[
      {slot:'SYSTEM_POLICY',representation:'FULL',estimatedTokens:20,required:true,protected:true},
      {slot:'LORE',representation:'SUMMARY',estimatedTokens:30,required:false,protected:false},
    ],
    sectionOrder:['SYSTEM_POLICY','LORE'],reuseDecisions:[{slot:'SYSTEM_POLICY',state:'REUSED'},{slot:'LORE',state:'REBUILD'}],
    dropped:[{slot:'MEMORY',reasonCode:'BUDGET'}],deferred:[],estimatedTokens:50,budget:{total:120,allocated:50},integrityStatus:'READY',
  };
}

test('PromptPlan UI separates planned, injected, and observed host evidence without retaining raw content',()=>{
  const adapter=new PromptPlanProductionUIAdapter({
    selectionProvider:()=>selection,
    readPromptPlanReadModel:()=>promptPlan(),
    readContextReceiptReadModel:()=>({
      kind:'ContextReceiptReadModel',turnId:'turn:1',generationId:'gen:1',contextSealId:'seal:1',promptPlanId:'plan:1',
      includedSections:['SYSTEM_POLICY','LORE'],omittedSections:[{slot:'MEMORY',reason:'BUDGET'}],deferredSections:[],
      modelProfileId:'profile:test',worldRevision:7,sceneRevision:3,sourceRevisionRefs:['scene:a@3','lore:a@2'],estimatedTokens:50,fallbackState:'NONE',
    }),
    readSealReceipt:()=>({id:'seal:1',turnId:'turn:1',sealedState:true,worldRevision:7,sceneRevision:3}),
    readPromptDeliveryReceipt:()=>({
      kind:'CorePromptDeliveryReceipt',contractVersion:1,status:'OBSERVED_MATCH',generationId:'gen:1',turnId:'turn:1',contextSealId:'seal:1',
      sealedPacketHash:'packet:abc',semanticManifestIdentity:'manifest:abc',plannedRoles:['system','user'],
      plannedSections:[{slot:'SYSTEM_POLICY'},{slot:'LORE'}],omissions:[{slot:'MEMORY',reason:'BUDGET'}],hostEvidenceRequired:true,
      observedHostDelivery:{kind:'ObservedHostPromptEvidence',host:'SILLYTAVERN',generationId:'gen:1',requestId:'req:1',observedRoles:['system','user'],observedSections:['SYSTEM_POLICY','LORE'],sealedPacketHash:'packet:abc',semanticManifestIdentity:'manifest:abc',promptFingerprint:'fp:1',matching:true,live:true,capturedAt:1234,rawPrompt:'DO NOT KEEP'},
      rawPrompt:'SECRET PROMPT',apiKey:'SECRET KEY',
    }),
  });
  const read=adapter.read();
  assert.equal(read.data.deliveryEvidence.planned.available,true);
  assert.equal(read.data.deliveryEvidence.injected.available,true);
  assert.equal(read.data.deliveryEvidence.observed.available,true);
  assert.equal(read.data.deliveryEvidence.observed.matching,true);
  assert.equal(read.data.deliveryEvidence.rawPromptIncluded,false);
  assert.equal(read.data.deliveryEvidence.secretsIncluded,false);
  assert.equal(read.data.modelProfileId,'profile:test');
  assert.deepEqual(read.data.sourceRevisionDependencies,['scene:a@3','lore:a@2']);
  assert.equal(read.data.seal.id,'seal:1');
  assert.doesNotMatch(JSON.stringify(read.data),/SECRET PROMPT|SECRET KEY|DO NOT KEEP/);
});

test('PromptPlan UI does not infer real host injection from a plan when observation receipts are absent',()=>{
  const adapter=new PromptPlanProductionUIAdapter({selectionProvider:()=>selection,readPromptPlanReadModel:()=>promptPlan()});
  const read=adapter.read();
  assert.equal(read.data.deliveryEvidence.planned.available,true);
  assert.equal(read.data.deliveryEvidence.injected.available,false);
  assert.equal(read.data.deliveryEvidence.observed.available,false);
  assert.equal(read.data.deliveryEvidence.observed.status,'UNAVAILABLE');
});

test('Wave11 binding rejects a prompt delivery receipt from another generation',()=>{
  const binding=createWave11LiveReceiptBinding({
    readSelection:()=>selection,
    readPromptDeliveryReceipt:()=>({kind:'CorePromptDeliveryReceipt',chatId:'chat:a',turnId:'turn:1',generationId:'gen:other',correlationId:'corr:1'}),
  });
  assert.throws(
    ()=>binding.bridges.promptPlan.readPromptDeliveryReceipt(selection),
    error=>error?.code==='LIVE_RECEIPT_IDENTITY_MISMATCH'
  );
  binding.destroy();
});

test('Forensic inspector is bounded and excludes foreign chat and regeneration transactions',()=>{
  let request=null;
  const rows=[
    ...Array.from({length:520},(_,i)=>({transactionId:'tx:'+i,sequence:i+1,transactionType:'CONTEXT_SECTION_COMPILED',chatId:'chat:a',turnId:'turn:1',generationId:'gen:1'})),
    {transactionId:'foreign-chat',sequence:900,transactionType:'RESULT_LATE',chatId:'chat:b',turnId:'turn:1',generationId:'gen:1'},
    {transactionId:'other-regeneration',sequence:901,transactionType:'RESULT_LATE',chatId:'chat:a',turnId:'turn:1',generationId:'gen:2'},
    {transactionId:'turn-only',sequence:902,transactionType:'CONTEXT_SEALED',chatId:'chat:a',turnId:'turn:1'},
  ];
  const adapter=new ForensicsProductionUIAdapter({
    selectionProvider:()=>selection,
    readForensicReadModel:q=>({kind:'ForensicReadModel',bundleId:'bundle:1',chatId:q.chatId,turnId:q.turnId,generationId:q.generationId,worldRevision:7,sceneRevision:3,complete:false,contextSealRef:'seal:1',promptPlanRef:'plan:1'}),
    listTransactions:q=>{request=q;return rows;},
  });
  const read=adapter.readGeneration('gen:1',{limit:10000});
  assert.equal(request.limit,512);
  assert.ok(read.data.transactions.length<=512);
  assert.equal(read.data.transactions.some(x=>x.transactionId==='foreign-chat'),false);
  assert.equal(read.data.transactions.some(x=>x.transactionId==='other-regeneration'),false);
  assert.equal(read.data.transactions.some(x=>x.transactionId==='turn-only'),true);
  assert.ok(read.data.transactions.every(x=>x.chatId==='chat:a'));
  assert.equal(read.data.timeline.chatId,'chat:a');
  assert.equal(read.data.timeline.generationId,'gen:1');
  assert.ok(read.data.timeline.missingStages.length>0);
});
