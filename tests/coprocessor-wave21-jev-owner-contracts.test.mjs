import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JevDecisionCore,adjudicateJevForOwner,createCognitionUiReadModelReader,createJevDomainAdapterMatrix,
} from '../src/coprocessor/index.js';
import { currentFor,loreReconciliation,output,providerExecutor,retrievalTruth,sceneBoundary } from './wave9-fixtures.mjs';

function memoryInput(id,extra={}){
  return {domain:'MEMORY',decisionKind:'MEMORY_KNOWLEDGE_BELIEF_CLASSIFICATION',decisionId:id,turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,
    owner:'MEMORY_OWNER',characterRef:'Nia',sourceRevisionSet:['mem:1'],worldRevision:1,sceneRevision:2,characterStateRevision:3,memoryRevision:4,ownerRevision:5,freshnessToken:'fresh:'+id,
    deadline:Date.now()+10000,softDeadline:Date.now()+5000,options:[{optionId:'KNOWN',evidenceRefs:['mem:a']},{optionId:'UNCERTAIN',evidenceRefs:['mem:a','mem:b']},{optionId:'UNRESOLVED',evidenceRefs:['mem:b']}],
    evidence:[{evidenceId:'mem:a',summary:'direct evidence',metadata:{knownBy:['Nia']}},{evidenceId:'mem:b',summary:'conflicting hearsay',metadata:{knownBy:['Nia']}}],
    provenanceRefs:['mem:p1','mem:p2'],routing:{expectedDecisionValue:.9,latencyPenalty:0,costPenalty:0,uncertaintyPenalty:0,authorityRisk:0,minimumInvocationValue:.2},...extra};
}
function temporalInput(id,extra={}){
  return {domain:'TEMPORAL',decisionKind:'TEMPORAL_TRANSITION_CONTRADICTION',decisionId:id,turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,
    owner:'TEMPORAL_OWNER',sourceRevisionSet:['time:1'],worldRevision:1,sceneRevision:2,characterStateRevision:3,temporalRevision:4,ownerRevision:5,freshnessToken:'fresh:'+id,
    deadline:Date.now()+10000,softDeadline:Date.now()+5000,options:[{optionId:'TRANSITION',evidenceRefs:['time:a']},{optionId:'CONTRADICTION',evidenceRefs:['time:a','time:b']},{optionId:'TEMPORALLY_DISTINCT',evidenceRefs:['time:a','time:b']},{optionId:'UNRESOLVED',evidenceRefs:['time:b']}],
    evidence:[{evidenceId:'time:a',summary:'state before'},{evidenceId:'time:b',summary:'state after'}],provenanceRefs:['time:p1','time:p2'],
    routing:{expectedDecisionValue:.9,latencyPenalty:0,costPenalty:0,uncertaintyPenalty:0,authorityRisk:0,minimumInvocationValue:.2},...extra};
}
function currentMemory(input,patch={}){return{sourceRevisionSet:[...input.sourceRevisionSet],worldRevision:input.worldRevision,sceneRevision:input.sceneRevision,characterStateRevision:input.characterStateRevision,
  freshnessToken:input.freshnessToken,domainRevisions:{memory:patch.memoryRevision??input.memoryRevision,owner:input.ownerRevision}};}
function currentTemporal(input,patch={}){return{sourceRevisionSet:[...input.sourceRevisionSet],worldRevision:input.worldRevision,sceneRevision:input.sceneRevision,characterStateRevision:input.characterStateRevision,
  freshnessToken:input.freshnessToken,domainRevisions:{temporal:patch.temporalRevision??input.temporalRevision,owner:input.ownerRevision}};}
function handler({input}){
  const type=input.data.decisionType;
  if(type==='LORE_RECONCILIATION')return{payload:output({selected:['TEMPORALLY_DISTINCT'],rejected:['EXACT_DUPLICATE','CONTRADICTORY'],evidenceUsed:['lore:a','lore:b']})};
  if(type==='SCENE_BOUNDARY')return{payload:output({selected:['RESUME_PRIOR_SCENE'],rejected:['CONTINUE_SCENE','OPEN_NEW_SCENE','UNRESOLVED'],evidenceUsed:['scene:a','scene:b']})};
  if(type==='TRUTH_SEMANTIC_AMBIGUITY')return{payload:output({selected:['SUPPORT_A'],rejected:['SUPPORT_B','PRESERVE_UNRESOLVED','ABSTAIN','ESCALATE'],evidenceUsed:['rt:current']})};
  if(type==='MEMORY_KNOWLEDGE_BELIEF_CLASSIFICATION')return{payload:output({selected:['UNCERTAIN'],rejected:['KNOWN','UNRESOLVED'],evidenceUsed:['mem:a','mem:b']})};
  if(type==='TEMPORAL_TRANSITION_CONTRADICTION')return{payload:output({selected:['TEMPORALLY_DISTINCT'],rejected:['TRANSITION','CONTRADICTION','UNRESOLVED'],evidenceUsed:['time:a','time:b']})};
  throw new Error('unexpected decision type '+type);
}
async function accept(service,input,current){
  return adjudicateJevForOwner({service,input,currentRevisionState:current,ownerReview:async proposal=>{
    assert.equal(proposal.mutationAuthority,false);assert.equal(proposal.requiresOwnerPolicy,true);
    return{decision:'ACCEPTED',settlementPerformed:false,canonicalMutation:false};
  }});
}

test('all five existing Jev domains reach an explicit owner admission through bounded provider execution',async()=>{
  const matrix=createJevDomainAdapterMatrix({providerExecutor:providerExecutor(handler)});
  const inputs=[
    [loreReconciliation('owner-lore'),x=>currentFor(x)],
    [sceneBoundary('owner-scene'),x=>currentFor(x)],
    [retrievalTruth('owner-retrieval'),x=>currentFor(x)],
    [memoryInput('owner-memory'),x=>currentMemory(x)],
    [temporalInput('owner-temporal'),x=>currentTemporal(x)],
  ];
  const receipts=[];
  for(const [input,current] of inputs)receipts.push(await accept(matrix.service,input,current(input)));
  assert.deepEqual(receipts.map(x=>x.domain),['LORE','SCENE','RETRIEVAL_TRUTH','MEMORY','TEMPORAL']);
  for(const receipt of receipts){
    assert.equal(receipt.accepted,true);assert.equal(receipt.ownerReviewInvoked,true);assert.equal(receipt.jevSettlementPerformed,false);
    assert.equal(receipt.cognitiveTelemetry.invocation,'INVOKED');assert.equal(receipt.cognitiveTelemetry.physicalExecutionAttempted,true);
    assert.equal(receipt.cognitiveTelemetry.physicalExecutionSucceeded,true);assert.equal(receipt.cognitiveTelemetry.ownerAccepted,true);
    assert.equal(receipt.cognitiveTelemetry.mutationAuthority,false);assert.equal(receipt.cognitiveTelemetry.truthAuthority,false);
  }
});

test('turn receipt distinguishes deterministic skip, stale evidence abstention, outage, owner rejection, replay and post-seal arrival',async()=>{
  let calls=0;
  const matrix=createJevDomainAdapterMatrix({providerExecutor:providerExecutor((ctx)=>{calls+=1;return handler(ctx);})});

  const deterministic=loreReconciliation('skip-lore',{exactDuplicate:true});
  const skipped=await accept(matrix.service,deterministic,currentFor(deterministic));
  assert.equal(skipped.cognitiveTelemetry.invocation,'SKIPPED_DETERMINISTIC');
  assert.equal(skipped.cognitiveTelemetry.physicalExecutionAttempted,false);

  const staleEvidence=sceneBoundary('stale-evidence',{evidence:[
    {evidenceId:'scene:a',summary:'stale a',available:false,stale:true},
    {evidenceId:'scene:b',summary:'stale b',available:false,stale:true},
  ]});
  const abstained=await adjudicateJevForOwner({service:matrix.service,input:staleEvidence,currentRevisionState:currentFor(staleEvidence),ownerReview:async()=>({decision:'UNRESOLVED'})});
  assert.equal(abstained.cognitiveTelemetry.invocation,'ABSTAINED');
  assert.equal(abstained.cognitiveTelemetry.physicalExecutionAttempted,false);

  const outageInput=sceneBoundary('outage-scene',{maxRetries:0});
  const outageMatrix=createJevDomainAdapterMatrix({providerExecutor:providerExecutor(()=>{const e=new Error('fixture outage');e.code='PROVIDER_UNAVAILABLE';throw e;})});
  const outage=await adjudicateJevForOwner({service:outageMatrix.service,input:outageInput,currentRevisionState:currentFor(outageInput),ownerReview:async()=>({decision:'UNRESOLVED'})});
  assert.equal(outage.cognitiveTelemetry.invocation,'INVOKED');
  assert.equal(outage.cognitiveTelemetry.physicalExecutionAttempted,true);
  assert.equal(outage.cognitiveTelemetry.physicalExecutionSucceeded,false);

  const rejectedInput=sceneBoundary('owner-reject');
  const rejected=await adjudicateJevForOwner({service:matrix.service,input:rejectedInput,currentRevisionState:currentFor(rejectedInput),ownerReview:async()=>({decision:'REJECTED',reasonCode:'OWNER_POLICY'})});
  assert.equal(rejected.accepted,false);assert.equal(rejected.rejected,true);assert.equal(rejected.cognitiveTelemetry.ownerAccepted,false);

  const replayInput=sceneBoundary('owner-replay');
  const first=await accept(matrix.service,replayInput,currentFor(replayInput));
  const second=await accept(matrix.service,replayInput,currentFor(replayInput));
  assert.equal(first.cognitiveTelemetry.invocation,'INVOKED');
  assert.equal(second.cognitiveTelemetry.invocation,'REPLAY');
  assert.equal(second.cognitiveTelemetry.providerAttempts,0);

  const sealedInput=sceneBoundary('owner-post-seal');
  let reviews=0;
  const sealed=await adjudicateJevForOwner({service:matrix.service,input:sealedInput,currentRevisionState:currentFor(sealedInput),sealed:true,ownerReview:async()=>{reviews+=1;return{decision:'ACCEPTED'};}});
  assert.equal(sealed.status,'REJECTED_POST_SEAL');assert.equal(sealed.ownerReviewInvoked,false);assert.equal(reviews,0);
  assert.equal(sealed.cognitiveTelemetry.postSeal,true);assert.equal(sealed.cognitiveTelemetry.ownerAccepted,false);
  assert.ok(calls>=3);
});

test('turn cognition read model exposes only bounded Jev metadata and owner acceptance',async()=>{
  const matrix=createJevDomainAdapterMatrix({providerExecutor:providerExecutor(handler)});
  const input=sceneBoundary('read-model-scene',{chatId:'chat:jev',generationId:'gen:jev'});
  const receipt=await accept(matrix.service,input,currentFor(input));
  const reader=createCognitionUiReadModelReader({ownerReceipts:()=>[receipt]});
  const read=reader.read({chatId:'chat:jev',turnId:input.turnId,generationId:'gen:jev',correlationId:input.correlationId});
  assert.equal(read.jevDecisions.length,1);
  const decision=read.jevDecisions[0];
  assert.equal(decision.decisionId,input.decisionId);assert.equal(decision.domain,'SCENE');assert.equal(decision.ownerAccepted,true);
  assert.equal(decision.physicalExecutionAttempted,true);assert.equal(decision.contextSealAuthority,false);
  const text=JSON.stringify(read);
  for(const forbidden of ['Eris remembers','ruined Ember Tavern','apiKey','rawPrompt','messages'])assert.equal(text.includes(forbidden),false,forbidden);
});
