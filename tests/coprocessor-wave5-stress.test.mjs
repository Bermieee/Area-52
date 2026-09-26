import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CapabilityProfileRegistry, DynamicFanOutPlanner, ExecutionAdmissionGuard, NativeEventSpineBaseline, Placement,
  ProviderHealthModel, ResultClass, createCognitiveTask, createDeepCheckpoint, createForegroundQuorumPlan,
  createRevisionSet, createTurnEnvelope, evaluateDeepResume, evaluateForegroundQuorum, executionPlacementPolicy,
  hardDeadlineDisposition, negotiateCapabilities, normalizeProviderTransportResult,
} from '../src/coprocessor/index.js';

function revision(n=1){return createRevisionSet({sourceRevisionSet:['s:'+n],worldRevision:n,sceneRevision:n,characterStateRevision:n});}
function makeTask(i,{requiredCapabilities=['CAP'],fallbackCapabilities=[],resultClass=ResultClass.REQUIRED,placement=Placement.HOT,layer='L1'}={}){
  return createCognitiveTask({
    taskId:'task:'+i,taskType:'STRESS',turnId:'turn:'+i,correlationId:'corr:'+i,requiredCapabilities,fallbackCapabilities,
    resultClass,placement,cognitiveLayer:layer,inputRevisionSet:revision(i),softDeadline:50,hardDeadline:100,
    compilerLane:'externalGrounding',intentFingerprint:'intent:'+i,
    batchMetadata:placement===Placement.DEEP?{batchable:true,yieldSafety:'CHECKPOINT_ONLY'}:{},
  });
}

test('Wave 5 production stress totals and invariants',()=>{
  const totals={
    turnEvents:0,capabilityNegotiations:0,fanOutPlans:0,taskClassifications:0,quorumEvaluations:0,
    providerFallbackCases:0,providerOutages:0,malformedProviderResults:0,cancellationSupersessionCases:0,
    duplicateDeliveries:0,deepYieldResumeCycles:0,providerHealthTransitions:0,oneKeyGoldenReplays:0,
  };

  for(let i=0;i<10000;i++){
    createTurnEnvelope({turnId:'t:'+i,eventId:'e:'+i,correlationId:'c:'+i,dedupeKey:'d:'+i,worldRevision:i,sceneRevision:i,characterStateRevision:i});
    totals.turnEvents++;
  }

  const registry=new CapabilityProfileRegistry();
  registry.register({profileId:'a',providerId:'A',capabilities:['CAP'],maxConcurrency:4});
  registry.register({profileId:'b',providerId:'B',capabilities:['CAP','ALT'],maxConcurrency:4});
  const base=makeTask(1);
  for(let i=0;i<20000;i++){
    const n=negotiateCapabilities(registry,base);assert.ok(n.eligibleProfiles.length>=1);totals.capabilityNegotiations++;
  }

  const planner=new DynamicFanOutPlanner();
  for(let i=0;i<10000;i++){
    const turn=createTurnEnvelope({turnId:'fan:'+i,eventId:'fan-e:'+i,correlationId:'fan-c:'+i,dedupeKey:'fan-d:'+i,createdAt:0,deadline:120});
    const plan=planner.plan({turnEvent:turn,text:i%2===0?'thanks':'Where is the blade?',queryIntent:i%2===0?null:'LOCATION',hotStateSufficient:i%2===0});
    assert.ok(plan.tasks.length<=16);totals.fanOutPlans++;
  }

  for(let i=0;i<25000;i++){
    const deep=i%5===0;
    const t=makeTask(i,{resultClass:deep?ResultClass.DEFERRED:ResultClass.REQUIRED,placement:deep?Placement.DEEP:Placement.HOT,layer:deep?'L3':'L1'});
    assert.equal(executionPlacementPolicy(t).runtimeDecisionAuthority,false);totals.taskClassifications++;
  }

  const qTasks=[makeTask(1),makeTask(2)],qPlan=createForegroundQuorumPlan(qTasks);
  for(let i=0;i<10000;i++){
    const q=evaluateForegroundQuorum(qPlan,{completedTaskIds:i%2?['task:1','task:2']:['task:1'],now:i%2?20:120});
    assert.ok(['FOREGROUND_QUORUM','HARD_DEADLINE'].includes(q.closeReason));totals.quorumEvaluations++;
  }

  const fallbackTask=makeTask(3,{requiredCapabilities:['PRIMARY'],fallbackCapabilities:['ALT']});
  for(let i=0;i<5000;i++){
    registry.setAvailability('a',false);
    const n=negotiateCapabilities(registry,fallbackTask);
    assert.equal(n.status,'DEGRADED');assert.equal(n.eligibleProfiles[0].profileId,'b');
    registry.setAvailability('a',true);assert.equal(hardDeadlineDisposition(fallbackTask).action,'BOUNDED_FALLBACK');
    totals.providerFallbackCases++;
  }

  for(let i=0;i<2000;i++){
    registry.setAvailability('a',false);assert.equal(negotiateCapabilities(registry,base).eligibleProfiles[0].profileId,'b');
    registry.setAvailability('a',true);totals.providerOutages++;
  }

  for(let i=0;i<2000;i++){
    assert.throws(()=>normalizeProviderTransportResult({providerId:'A'},{providerProfileId:'a'}),/text/);
    totals.malformedProviderResults++;
  }

  for(let i=0;i<2000;i++){
    const t=makeTask(100000+i),guard=new ExecutionAdmissionGuard();guard.register(t);
    if(i%2)guard.cancel(t.taskId);else guard.supersede(t.taskId);
    const admitted=guard.admit({taskId:t.taskId,resultId:'r:'+i,freshnessIdentity:t.inputRevisionSet},{currentRevisionSet:t.inputRevisionSet});
    assert.equal(admitted.accepted,false);totals.cancellationSupersessionCases++;
  }

  const spine=new NativeEventSpineBaseline();
  for(let i=0;i<2000;i++){
    const event={eventId:'dup:'+i,eventType:'TURN_EVENT',dedupeKey:'dup:'+i};
    assert.equal(spine.publish(event).duplicate,false);assert.equal(spine.replay(event).duplicate,true);totals.duplicateDeliveries++;
  }

  for(let i=0;i<2000;i++){
    const t=makeTask(200000+i,{resultClass:ResultClass.DEFERRED,placement:Placement.DEEP,layer:'L3'});
    const checkpoint=createDeepCheckpoint(t,{completedUnits:5,remainingUnits:5});
    assert.equal(evaluateDeepResume(checkpoint,t.inputRevisionSet).action,'RESUME_FROM_CHECKPOINT');totals.deepYieldResumeCycles++;
  }

  const health=new ProviderHealthModel({windowSize:4,degradedFailureRate:.25,cooldownFailureRate:.5,cooldownMs:1});
  health.register('health',{maxConcurrency:2});
  for(let i=0;i<1000;i++){health.setConcurrency('health',i%3===0?2:0,{now:i});totals.providerHealthTransitions++;}

  for(let i=0;i<1000;i++){
    const turn=createTurnEnvelope({
      turnId:'gold:'+i,eventId:'gold-e:'+i,correlationId:'gold-c:'+i,dedupeKey:'gold-d:'+i,createdAt:0,deadline:120,
      sourceRevisionSet:['gold'],worldRevision:1,sceneRevision:1,characterStateRevision:1,
    });
    const plan=planner.plan({turnEvent:turn,text:'Where was the blade before the tavern burned?',queryIntent:'CURRENT_STATE',activeThreads:['blade fate'],conflictSignals:['historical/current']});
    const qp=createForegroundQuorumPlan(plan.tasks),q=evaluateForegroundQuorum(qp,{completedTaskIds:qp.requiredTaskIds,now:60});
    assert.equal(q.satisfied,true);totals.oneKeyGoldenReplays++;
  }

  assert.deepEqual(totals,{
    turnEvents:10000,capabilityNegotiations:20000,fanOutPlans:10000,taskClassifications:25000,quorumEvaluations:10000,
    providerFallbackCases:5000,providerOutages:2000,malformedProviderResults:2000,cancellationSupersessionCases:2000,
    duplicateDeliveries:2000,deepYieldResumeCycles:2000,providerHealthTransitions:1000,oneKeyGoldenReplays:1000,
  });
  console.log(JSON.stringify({stress:'wave5',...totals}));
});
