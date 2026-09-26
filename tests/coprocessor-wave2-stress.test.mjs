import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DynamicFanOutPlanner, GatherCoordinator, ResultClass, createTurnEnvelope, createWorkerResult,
} from '../src/coprocessor/index.js';

test('Wave 2 stress exceeds 1,000 turns / 5,000 tasks with bounded fan-out, mixed providers, stale/future, late, fallback and zero-worker paths',async()=>{
  const planner=new DynamicFanOutPlanner({maxWorkers:8});let tasks=0,zero=0,stale=0,future=0,late=0,fallback=0,malformed=0;
  const providers=['provider:A','provider:B','provider:C'];
  for(let i=0;i<1400;i++){
    const event=createTurnEnvelope({turnId:`v2:${i}`,eventId:`evt:v2:${i}`,correlationId:`corr:v2:${i}`,dedupeKey:`v2:${i}`,
      sourceRevisionSet:[`src:${i}`],worldRevision:1000+i,sceneRevision:2000+i,characterStateRevision:3000+i,createdAt:0,deadline:120});
    const trivial=i%20===0;
    const plan=planner.plan({turnEvent:event,text:trivial?'Thanks!':'Eris returns to the ruined Tavern looking for the Blade while speaking to Mara.',
      queryIntent:trivial?null:'CURRENT_STATE',activeCast:trivial?[]:['Eris','Mara'],activeThreads:trivial?[]:['blade'],conflictSignals:trivial?[]:['fate'],
      maxFanOut:4,resourceConstraint:{maxForegroundWorkers:4}});
    assert.ok(plan.tasks.length<=4);tasks+=plan.tasks.length;if(!plan.tasks.length){zero++;continue;}
    const gather=new GatherCoordinator({turnEvent:event,plan,currentRevisionSet:event});
    for(let j=0;j<plan.tasks.length;j++){
      const task=plan.tasks[j];if(i%37===0&&j===0){malformed++;continue;}
      const freshness=structuredClone(task.inputRevisionSet);if(i%41===0&&j===1){freshness.worldRevision-=1;stale++;}if(i%43===0&&j===2){freshness.worldRevision+=1;future++;}
      const completedAt=task.metadata.roleId==='green-room'?240:40+j*10;if(completedAt>70&&task.resultClass===ResultClass.OPPORTUNISTIC)late++;
      const result=createWorkerResult({resultId:`r:${task.taskId}`,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,
        workerId:`w:${j}`,providerId:providers[(i+j)%providers.length],capabilities:task.requiredCapabilities,status:'SUCCESS',
        payload:{evidence:[{id:`e:${task.taskId}`,semanticKey:`${task.turnId}:shared`,value:j%2?'A':'B'}]},provenance:{stress:true},confidence:.8,
        freshnessIdentity:freshness,inputRevisionSet:task.inputRevisionSet,intentFingerprint:task.intentFingerprint,startedAt:0,completedAt});
      const out=await gather.accept(result,{arrivalAt:completedAt});
      const dup=await gather.accept(result,{arrivalAt:completedAt});assert.equal(dup.duplicate,true);
      if(out.stale||out.validation?.failure?.code==='FUTURE_REVISION')continue;
    }
    for(const task of gather.missingRequired()){
      const result=createWorkerResult({resultId:`fallback:${task.taskId}`,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,
        workerId:'fallback',providerId:'deterministic',capabilities:task.requiredCapabilities,status:'FALLBACK',payload:{evidence:[]},provenance:{fallback:true},
        confidence:0,freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,intentFingerprint:task.intentFingerprint,startedAt:120,completedAt:120});
      gather.addFallback(task.taskId,result);fallback++;
    }
    assert.equal(gather.quorumSatisfied(),true);const bundle=gather.close({at:70});
    assert.ok(bundle.acceptedResultIds.every(id=>id.includes(event.turnId)));assert.ok(bundle.acceptedResultIds.length<=4);
    gather.markSealed({id:`seal:${i}`});
  }
  assert.ok(tasks>5000,`expected >5000 tasks, got ${tasks}`);assert.ok(zero>0&&stale>0&&future>0&&late>0&&fallback>0&&malformed>0);
});
