import test from 'node:test';
import assert from 'node:assert/strict';

import { DevelopmentDeploymentBrain, createGoldenDeploymentLorebook } from '../src/deployment/index.js';
import { extractDevelopmentDeploymentScene } from '../src/deployment/sillytavern-live.js';
import { HostActivity, SceneEventType } from '../src/scene/lifecycle-contracts.js';
import { SpeculativeWarmCoordinator, WarmPacketCache, WarmState, createWarmPacket } from '../src/coprocessor/index.js';

function hostEvent({
  chatId='warm-chat',id='m1',revision=1,activity=HostActivity.USER_SEND,
  content='At Sun Blade Shrine, Mara enters and searches for the Sun Blade.',
  turnId='turn:warm-source',generationId='gen:warm-source',
}={}){
  return {
    activity,chatId,hostEventId:`host:${chatId}:${id}:r${revision}:${activity}`,
    messageId:id,messageRevision:revision,turnId,generationId,correlationId:'corr:'+turnId,
    causationId:'host-cause:'+turnId,content,role:'user',
  };
}

function ingestDeterministic(brain,input){
  return brain.ingestSceneHostEvent(input,{
    extract:(e,scene)=>extractDevelopmentDeploymentScene(e.content,{
      revision:scene.revision+1,evidenceRef:e.sourceRevisionId,currentScene:scene,sceneRuntime:brain.scene,
    }),
  });
}

function seeded(){
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  brain.ingestLorebook(createGoldenDeploymentLorebook());
  return brain;
}

function recommendationFrom(receipt){
  const event=receipt.dispatchTimeline.find((row)=>row.type==='EVENT'&&row.value?.eventType===SceneEventType.PREFETCH_RECOMMENDED)?.value;
  assert.ok(event,'expected production Scene prefetch recommendation');
  assert.equal(event.payload?.recommendation?.status,'ACTIVE');
  return {event,recommendation:event.payload.recommendation};
}

function predictionQuery(recommendation){
  const refs=[
    ...(recommendation.entityRefs??[]),...(recommendation.locationRefs??[]),
    ...(recommendation.threadRefs??[]),...(recommendation.sceneRefs??[]),
  ];
  return refs.length?`Tell me about ${refs.join(' ')}`:'Tell me about Mara at the Sun Blade Shrine';
}

test('#77 installed Scene recommendation schedules one Runtime warm obligation and duplicate publication does not repeat it',async()=>{
  const brain=seeded();
  const receipt=ingestDeterministic(brain,hostEvent({chatId:'warm-dedupe'}));
  const {event}=recommendationFrom(receipt);
  const tasks=()=>brain.runtimeDirector.ledger.list().filter((row)=>row.obligation?.taskType==='SPECULATIVE_CONTEXT_WARM');
  assert.equal(tasks().length,1);

  const args=brain.scene.publisher.runtimeEmitArgs(event);
  const duplicate=brain.runtimeDirector.events.emit(args.eventType,args.payload,args.meta);
  assert.equal(duplicate.eventId,event.eventId);
  assert.equal(tasks().length,1);

  await brain.flushSpeculativeWarmRuntime();
  const diagnostics=brain.diagnostics().speculativeWarm;
  assert.ok(diagnostics.receipts.some((row)=>row.stage==='SCHEDULING'&&['ADMITTED','DEDUPED'].includes(row.status)));
  assert.ok(diagnostics.receipts.some((row)=>row.stage==='EXECUTION_ATTEMPTED'&&row.physicallyAttempted));
  assert.ok(diagnostics.receipts.some((row)=>row.stage==='CACHE_PUBLICATION'&&row.status==='WARMED'));
  assert.equal(diagnostics.authorityGranted,false);
  assert.equal(diagnostics.contextSealAuthority,false);
});

test('#77 quiet/no recommendation path creates no speculative Runtime work',()=>{
  const brain=seeded();
  brain.ingestSceneHostEvent(hostEvent({
    chatId:'warm-quiet',id:'load',activity:HostActivity.CHAT_LOAD,content:'',
    turnId:'turn:load',generationId:'gen:load',
  }),{extract:()=>({fields:{}})});
  assert.equal(brain.runtimeDirector.ledger.list().some((row)=>row.obligation?.taskType==='SPECULATIVE_CONTEXT_WARM'),false);
});

test('#77 fresh installed hit reuses owner-backed Lore preparation while Core still performs current Choice, Truth and Seal',async(t)=>{
  const cold=seeded();
  const coldReceipt=ingestDeterministic(cold,hostEvent({chatId:'warm-cold'}));
  const coldPrediction=recommendationFrom(coldReceipt).recommendation;
  const coldQuery=predictionQuery(coldPrediction);
  const coldStarted=performance.now();
  const coldResult=await cold.runTurn({
    chatId:'warm-cold',turnId:'turn:cold-send',generationId:'gen:cold-send',
    query:coldQuery,anchorEntityIds:[...(coldPrediction.entityRefs??[])],mode:'retrieval',
  });
  const coldMs=performance.now()-coldStarted;
  assert.equal(coldResult.scatter.jobs.some((row)=>row.taskType==='LORE_RETRIEVAL'),true);

  const warm=seeded();
  const warmReceipt=ingestDeterministic(warm,hostEvent({chatId:'warm-hit'}));
  const warmPrediction=recommendationFrom(warmReceipt).recommendation;
  await warm.flushSpeculativeWarmRuntime();
  const warmQuery=predictionQuery(warmPrediction);
  const warmStarted=performance.now();
  const warmResult=await warm.runTurn({
    chatId:'warm-hit',turnId:'turn:warm-send',generationId:'gen:warm-send',
    query:warmQuery,anchorEntityIds:[...(warmPrediction.entityRefs??[])],mode:'retrieval',
  });
  const warmMs=performance.now()-warmStarted;

  assert.equal(warmResult.speculativeWarm.status,WarmState.FRESH);
  assert.equal(warmResult.speculativeWarm.lorePreparationReused,true);
  assert.equal(warmResult.scatter.jobs.some((row)=>row.taskType==='LORE_RETRIEVAL'),false);
  assert.equal(warmResult.scatter.jobs.some((row)=>row.taskType==='GRAPH_LOOKUP'),true);
  assert.equal(warmResult.speculativeWarm.coreRevalidation.status,'CORE_REVALIDATED');
  assert.deepEqual(warmResult.speculativeWarm.coreRevalidation.avoidedWork,{retrieval:true,truth:false,precision:false,compile:false});
  assert.equal(warmResult.published.cognitiveChoiceReceipt.truth.considered,true);
  assert.equal(warm.core.publication.seal.verify('turn:warm-send').sealed,true);
  assert.equal(warmResult.delivery.ok,true);
  t.diagnostic(JSON.stringify({
    measurementClass:'LOCAL_DETERMINISTIC',coldSendMs:Number(coldMs.toFixed(3)),warmSendMs:Number(warmMs.toFixed(3)),
    avoidedForegroundWork:{lorePlanningQuery:1,runtimeLorePreparation:1,coreRetrieval:0,truth:0,precision:0,compile:0},
    speedupClaimed:false,
  }));
});

test('#77 dependency metadata limits partial salvage to refs whose source revisions remain current',()=>{
  const cache=new WarmPacketCache({capacity:4,maxCandidateRefs:64,defaultTtlTurns:3});
  const base={
    chatId:'partial-chat',sceneRevision:4,worldRevision:7,characterStateRevision:2,
    sourceRevisionSet:['src:scene:4','src:lore:1'],intentFingerprint:'intent:blade',retrievalPolicyRevision:'policy:1',
  };
  cache.put(createWarmPacket({
    identity:base,candidateRefs:['cand:scene','cand:lore'],evidenceRefs:['ev:scene','ev:lore'],createdAt:1,expiresAfterTurns:3,
    metadata:{refDependencies:{
      'cand:scene':['src:scene:4'],'ev:scene':['src:scene:4'],
      'cand:lore':['src:lore:1'],'ev:lore':['src:lore:1'],
    }},
  }),{turnSequence:1});
  const warmer=new SpeculativeWarmCoordinator({cache});
  const use=warmer.consumeForSend({
    identity:{...base,sourceRevisionSet:['src:scene:4','src:lore:2']},turnSequence:1,turnId:'turn:partial',
  });
  assert.equal(use.freshness,WarmState.PARTIALLY_STALE);
  assert.deepEqual(use.reusableRefs,['cand:scene','ev:scene']);
  assert.deepEqual(use.reusableCandidates.map((row)=>row.candidateId),['cand:scene','ev:scene']);
  assert.ok(use.requiredForegroundStages.includes('TRUTH_RECHECK'));
  assert.ok(use.requiredForegroundStages.includes('RECOMPILE'));
});

test('#77 source edit invalidates cached preparation and cancels obsolete pending warm work without touching Seal authority',async()=>{
  const brain=seeded();
  const first=ingestDeterministic(brain,hostEvent({chatId:'warm-edit',id:'story',revision:1}));
  recommendationFrom(first);
  await brain.flushSpeculativeWarmRuntime();
  assert.ok(brain.diagnostics().speculativeWarm.metrics.cache.size>=1);

  const edited=ingestDeterministic(brain,hostEvent({
    chatId:'warm-edit',id:'story',revision:2,activity:HostActivity.EDIT,
    content:'At Crystal Harbor, Mara leaves the Sun Blade Shrine behind.',
    turnId:'turn:warm-edit',generationId:'gen:warm-edit',
  }));
  assert.ok(edited.evidence.invalidates.length>=1||edited.evidence.replacesRevisionId);
  const diagnostics=brain.diagnostics().speculativeWarm;
  assert.ok(diagnostics.metrics.cache.size<=1);
  assert.ok(diagnostics.receipts.some((row)=>row.stage==='CANCELLATION'||row.stage==='ELIGIBILITY'));
  assert.equal(diagnostics.authorityGranted,false);
  assert.equal(diagnostics.contextSealAuthority,false);
});
