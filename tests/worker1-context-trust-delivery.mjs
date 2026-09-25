import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeContextRetirementPolicy,contextRetirementContract} from '../src/context-retirement-policy.js';
import {ContextDeliveryEngine} from '../src/adaptive-context-runtime.js';
import {GenerationContextSeal} from '../src/context-seal.js';

function messages(){
  return Array.from({length:12},(_,index)=>({
    messageId:'m'+(index+1),sequence:index+1,role:index%2?'assistant':'user',
    content:'Turn '+(index+1)+' narrative content '+('detail '.repeat(index+2)),
    sourceRevisionRefs:['chat:r'+(index+1)],provenanceRefs:['prov:m'+(index+1)],
    tags:index===2?['OPERATOR_PINNED']:index===3?['HARD_RULE']:index===4?['UNRESOLVED_THREAD']:index===5?['RELATIONSHIP_CHANGE']:[],
  }));
}
function coverage(rows,{chatId='chat:alpha',probe='PASS',stale=false,committed=true}={}){
  return rows.map(row=>({
    kind:'SceneEpisode',coverageId:'episode:'+row.messageId,committed,durable:true,chatId,
    coversMessageIds:[row.messageId],sourceRevisionRefs:['episode:r1'],coveredSourceRevisionRefs:[...row.sourceRevisionRefs],
    provenanceRefs:['episode:prov',...row.sourceRevisionRefs],stale,
    retrievalProbe:{status:probe,chatId,sourceRevisionRefs:['episode:r1']},
  }));
}

test('DETERMINISTIC: context retirement requires durable retrieval proof and preserves protected/raw context',()=>{
  const policy=new NativeContextRetirementPolicy({defaultRecentWindow:3,transitionTail:2}),rows=messages();
  const proven=coverage(rows.slice(0,9));
  const first=policy.evaluate({
    chatId:'chat:alpha',messages:rows,coverage:proven,recentWindow:3,
    sceneTransition:{previousSceneId:'scene:a',destinationSceneId:'scene:b',prefetchHints:['destination participants','destination rules']},
  });
  assert.equal(first.hostHistoryMutation,false);
  assert.ok(first.retireEligibleMessageIds.includes('m1'));
  for(const id of ['m3','m4','m5','m6','m10','m11','m12'])assert.ok(first.keptRawMessageIds.includes(id),id+' must remain raw');
  assert.ok(first.measurements.exactByteSavings>0);
  assert.equal(first.sceneTransition.destinationSceneId,'scene:b');
  assert.equal(first.sceneTransition.prefetchDestination,true);
  assert.ok(first.sceneTransition.compactPreviousSceneTail.length<=2);

  const failedProbe=coverage(rows.slice(0,9),{probe:'FAIL'});
  const regressed=policy.evaluate({chatId:'chat:alpha',messages:rows,coverage:failedProbe,recentWindow:3});
  assert.equal(regressed.retireEligibleMessageIds.length,0);
  assert.ok(regressed.decisions.find(row=>row.messageId==='m1').reasons.includes('RETRIEVAL_PROBE_FAILED'));

  const stale=policy.evaluate({chatId:'chat:alpha',messages:rows,coverage:coverage(rows.slice(0,9),{stale:true}),recentWindow:3});
  assert.equal(stale.retireEligibleMessageIds.length,0);
  assert.ok(stale.decisions.find(row=>row.messageId==='m1').reasons.includes('COVERAGE_STALE'));

  const revisionFencedPolicy=new NativeContextRetirementPolicy({defaultRecentWindow:3,isSourceRevisionCurrent:(ref)=>ref==='episode:r2'});
  const staleRevision=revisionFencedPolicy.evaluate({chatId:'chat:alpha',messages:rows,coverage:proven,recentWindow:3});
  assert.equal(staleRevision.retireEligibleMessageIds.length,0);
  assert.ok(staleRevision.decisions.find(row=>row.messageId==='m1').reasons.includes('COVERAGE_SOURCE_REVISION_STALE'));

  const wrongChat=policy.evaluate({chatId:'chat:imported',messages:rows,coverage:proven,recentWindow:3});
  assert.equal(wrongChat.retireEligibleMessageIds.length,0);
  assert.ok(wrongChat.decisions.find(row=>row.messageId==='m1').reasons.includes('CHAT_IDENTITY_MISMATCH'));

  const summaryFailure=policy.evaluate({chatId:'chat:alpha',messages:rows,coverage:coverage(rows.slice(0,9),{committed:false}),recentWindow:3});
  assert.equal(summaryFailure.retireEligibleMessageIds.length,0);
  assert.ok(summaryFailure.decisions.find(row=>row.messageId==='m1').reasons.includes('COVERAGE_NOT_COMMITTED'));

  const correctedRows=structuredClone(rows);
  correctedRows[0].content='Corrected Lore: the gate is closed, replacing the earlier open-state account.';
  correctedRows[0].sourceRevisionRefs=['chat:r1:corrected'];
  const corrected=policy.evaluate({chatId:'chat:alpha',messages:correctedRows,coverage:proven,recentWindow:3});
  assert.ok(corrected.keptRawMessageIds.includes('m1'));
  assert.ok(corrected.decisions.find(row=>row.messageId==='m1').reasons.includes('MESSAGE_SOURCE_REVISION_NOT_PROVEN'));

  const mistakenBelief=first.decisions.find(row=>row.messageId==='m5');
  assert.equal(mistakenBelief.action,'KEEP_RAW');
  assert.ok(mistakenBelief.reasons.includes('PROTECTED_CONTEXT'));

  const replay=policy.evaluate({chatId:'chat:alpha',messages:rows,coverage:proven,recentWindow:3});
  const regeneration=policy.evaluate({chatId:'chat:alpha',messages:rows,coverage:proven,recentWindow:3});
  const reload=new NativeContextRetirementPolicy({defaultRecentWindow:3}).evaluate({chatId:'chat:alpha',messages:rows,coverage:proven,recentWindow:3});
  assert.equal(replay.receiptId,regeneration.receiptId);
  assert.deepEqual(replay.retireEligibleMessageIds,reload.retireEligibleMessageIds);
  assert.equal(contextRetirementContract().regressionBehavior,'REVERSE_OR_ABSTAIN');

  console.log('WORKER1_CONTEXT_TRUST_METRIC',JSON.stringify({
    messages:rows.length,retired:first.measurements.retiredMessages,retained:first.measurements.retainedMessages,
    rawBytes:first.measurements.rawBytes,retainedBytes:first.measurements.retainedBytes,
    exactByteSavings:first.measurements.exactByteSavings,failedProbeRetired:regressed.measurements.retiredMessages,
  }));
});

function packet(){
  return{
    kind:'GenerationContextPacket',id:'packet:worker1',intent:'TEMPORAL',
    current:[{id:'fact:current',e:'gate',p:'state',v:'closed',a:'SETTLED',t:'CURRENT',sourceRevisionIds:['lore:r2']}],
    historical:[{id:'fact:historical',e:'gate',p:'state',v:'open',a:'OBSERVED',t:'HISTORICAL',sourceRevisionIds:['memory:r1']}],
    unresolved:[{id:'fact:unresolved',e:'omen',p:'meaning',v:'disputed',a:'UNRESOLVED',t:'UNRESOLVED',sourceRevisionIds:['memory:r2']}],
    relevantLore:[{id:'fact:rule',e:'gate',p:'exceptionRule',v:'closed during eclipse',a:'SOURCE_CANON',t:'CURRENT',hardRule:true,semantic:{predicate:'EXCEPTION_RULE'},sourceRevisionIds:['lore:r2']}],
    episodicMemory:[],activeThreads:[],dependencies:['lore:r2','memory:r1','memory:r2'],
  };
}
function sealed(){
  const seal=new GenerationContextSeal(),p=packet();
  return{p,seal,row:seal.seal({turnId:'turn:worker1',correlationId:'corr:worker1',packet:p,sourceRevisionIds:p.dependencies,worldRevision:2,sceneRevision:3})};
}

test('DETERMINISTIC: presentation profiles preserve one sealed semantic identity and remain host-evidence honest',()=>{
  const {p,row,seal}=sealed();
  const engine=new ContextDeliveryEngine();
  const common={sealedPacket:row.packet,sealReceipt:row.receipt,generationId:'gen:worker1',turnId:'turn:worker1',budgetTokens:2048,userInput:'What is true now and what was true before?'};
  const stable=engine.deliver({...common,modelProfileId:'CACHE_STABLE'});
  const generic=engine.deliver({...common,modelProfileId:null,providerId:'unknown-provider',modelId:'mystery'});
  const openA=engine.deliver({...common,modelProfileId:null,providerId:'OpenRouter',modelId:'provider/model-a',routeId:'route:a'});
  const openB=engine.deliver({...common,modelProfileId:null,providerId:'OpenRouter',modelId:'provider/model-a',routeId:'route:b'});
  for(const result of [stable,generic,openA,openB])assert.equal(result.ok,true);
  assert.equal(stable.plan.sealedPacketHash,generic.plan.sealedPacketHash);
  assert.equal(stable.receipt.semanticManifestIdentity,generic.receipt.semanticManifestIdentity);
  assert.equal(openA.receipt.semanticManifestIdentity,openB.receipt.semanticManifestIdentity);
  assert.equal(generic.receipt.profileChoice,'GENERIC_SAFE');
  assert.equal(openA.receipt.profileChoice,'OPENROUTER_CONSERVATIVE');
  assert.equal(openA.receipt.cacheAssumption,'ROUTE_DEPENDENT_UNMEASURED');
  assert.equal(openA.receipt.status,'PLANNED_NOT_OBSERVED');
  assert.equal(openA.receipt.providerChatTemplateTokensEmitted,false);
  assert.equal(openA.receipt.semanticSelectionAuthority,false);

  for(const result of [stable,generic,openA]){
    const text=JSON.stringify(result.plan.sections);
    assert.match(text,/fact:current/);assert.match(text,/fact:historical/);assert.match(text,/fact:unresolved/);assert.match(text,/fact:rule/);
    assert.equal(result.plan.sealedPacketHash,row.receipt.packetHash);
  }

  const observed=engine.attachObservedHostEvidence(openA.receipt,{
    host:'SILLYTAVERN',generationId:'gen:worker1',requestId:'request:1',
    observedRoles:['system','context','user'],observedSections:openA.plan.ordering,
    sealedPacketHash:openA.receipt.sealedPacketHash,semanticManifestIdentity:openA.receipt.semanticManifestIdentity,live:false,
  });
  assert.equal(observed.status,'OBSERVED_MATCH');
  assert.equal(observed.observedHostDelivery.live,false);
  const mismatch=engine.attachObservedHostEvidence(openA.receipt,{host:'SILLYTAVERN',semanticManifestIdentity:'tampered'});
  assert.equal(mismatch.status,'OBSERVED_MISMATCH');

  const roleCollision=engine.deliver({...common,contributions:[{
    id:'bad-role',slot:'RECENT_NARRATIVE',sourceCategory:'GENERATION_ENVELOPE',owner:'GENERATION_ENVELOPE',
    semantic:false,semanticRefs:[],content:'bad role',sourceRevisionIds:[],role:'user',required:false,priority:1,metadata:{},
  }]});
  assert.equal(roleCollision.ok,false);
  assert.match(String(roleCollision.failure?.code),/requires role context/);

  let pressure=null;
  for(const budgetTokens of [512,640,768,896,1024,1280,1536]){
    const attempt=engine.deliver({...common,budgetTokens,contributions:[{
      id:'optional-recent-narrative',slot:'RECENT_NARRATIVE',sourceCategory:'GENERATION_ENVELOPE',owner:'GENERATION_ENVELOPE',
      semantic:false,semanticRefs:[],content:'optional prior-scene prose '.repeat(220),sourceRevisionIds:[],role:'context',required:false,priority:1,metadata:{},
    }]});
    if(attempt.ok&&((attempt.plan.dropped?.length??0)+(attempt.plan.deferred?.length??0)>0)){pressure=attempt;break;}
  }
  assert.ok(pressure,'satisfiable pressure case should omit optional presentation material');
  assert.equal(pressure.receipt.semanticManifestIdentity,stable.receipt.semanticManifestIdentity);
  const pressureText=JSON.stringify(pressure.plan.sections);
  for(const id of ['fact:current','fact:historical','fact:unresolved','fact:rule'])assert.match(pressureText,new RegExp(id));
  assert.ok((pressure.plan.dropped??[]).some(row=>row.slot==='RECENT_NARRATIVE')||(pressure.plan.deferred??[]).some(row=>row.slot==='RECENT_NARRATIVE'));

  const overflow=engine.deliver({...common,budgetTokens:270});
  assert.equal(overflow.ok,false);
  assert.equal(overflow.status,'DELIVERY_BUDGET_UNSATISFIABLE');

  const restoredSeal=new GenerationContextSeal();restoredSeal.restoreState(seal.exportState());
  const restoredPacket=restoredSeal.getPacket('turn:worker1'),restoredReceipt=restoredSeal.getReceipt('turn:worker1');
  const reloaded=new ContextDeliveryEngine().deliver({...common,sealedPacket:restoredPacket,sealReceipt:restoredReceipt,modelProfileId:null,providerId:'OpenRouter',routeId:'route:reload'});
  assert.equal(reloaded.ok,true);
  assert.equal(reloaded.receipt.semanticManifestIdentity,openA.receipt.semanticManifestIdentity);
  assert.equal(reloaded.receipt.sealedPacketHash,openA.receipt.sealedPacketHash);

  console.log('WORKER1_PROMPT_DELIVERY_METRIC',JSON.stringify({
    profiles:[stable.receipt.profileChoice,generic.receipt.profileChoice,openA.receipt.profileChoice],
    sealedPacketHash:openA.receipt.sealedPacketHash,semanticManifestIdentity:openA.receipt.semanticManifestIdentity,
    stableAllocated:stable.plan.budget.allocated,genericAllocated:generic.plan.budget.allocated,openRouterAllocated:openA.plan.budget.allocated,
    openRouterCacheAssumption:openA.receipt.cacheAssumption,observedStatus:observed.status,
  }));
});
