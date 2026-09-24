import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Capability, DynamicFanOutPlanner, GatherCoordinator, ResultClass, TurnEventHub,
  createTurnEnvelope, createWorkerResult,
} from '../src/coprocessor/index.js';
import { createEmberPlannerInput, createEmberTurn } from './fixtures/ember-tavern-wave1.mjs';

test('2,100-task deterministic swarm stress contains duplicates, stale/future revisions, failures and deadlines without cross-turn leakage', async () => {
  const planner=new DynamicFanOutPlanner();
  const hub=new TurnEventHub({limit:100});
  let tasks=0,duplicates=0,stale=0,invalid=0,fallbacks=0;
  const turnCount=525;

  for(let i=0;i<turnCount;i+=1){
    const turn=createTurnEnvelope(createEmberTurn({
      turnId:`turn:stress:${i}`,eventId:`evt:stress:${i}`,correlationId:`corr:stress:${i}`,dedupeKey:`turn:stress:${i}`,
      worldRevision:100+i,sceneRevision:200+i,characterStateRevision:300+i,
    }));
    const published=hub.publish(turn); assert.equal(published.duplicate,false);
    if(i%17===0){const redelivery=hub.publish({...turn,deliveryAttempt:2});assert.equal(redelivery.duplicate,true);duplicates+=1;}
    const plan=planner.plan({turnEvent:turn,...createEmberPlannerInput()}); assert.equal(plan.tasks.length,4); tasks+=plan.tasks.length;
    const gather=new GatherCoordinator({turnEvent:turn,plan,currentRevisionSet:turn});

    for(const task of plan.tasks){
      const role=task.metadata.roleId;
      if(i%19===0&&role==='green-room') continue;
      if(i%23===0&&role==='graph-walker'){
        const fallback=fallbackResult(task,task.hardDeadline);gather.addFallback(task.taskId,fallback);fallbacks+=1;continue;
      }
      const revisions=structuredClone(task.inputRevisionSet);
      if(i%29===0&&role==='historian'){revisions.worldRevision-=1;stale+=1;}
      if(i%31===0&&role==='truth-precision'){revisions.worldRevision+=1;invalid+=1;}
      const result=createWorkerResult({
        resultId:`result:${task.taskId}`,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,
        workerId:`stress:${role}`,providerId:'stress-provider',capabilities:task.requiredCapabilities,status:'SUCCESS',
        payload:{evidence:[{id:`e:${task.taskId}`,semanticKey:`${task.turnId}:fact`,value:role}]},provenance:{stress:true},confidence:.9,
        freshnessIdentity:revisions,inputRevisionSet:task.inputRevisionSet,startedAt:0,completedAt:role==='green-room'?220:20,
      });
      const first=await gather.accept(result,{arrivalAt:result.completedAt});
      const second=await gather.accept(result,{arrivalAt:result.completedAt});
      assert.equal(second.duplicate,true);
      if(role==='green-room'&&result.completedAt>57) assert.ok(first.accepted||first.late||first.stale===true||first.validation?.failure);
    }

    for(const task of gather.missingRequired()){gather.addFallback(task.taskId,fallbackResult(task,task.hardDeadline));fallbacks+=1;}
    assert.equal(gather.quorumSatisfied(),true);
    const bundle=gather.close({at:57});
    assert.equal(bundle.turnIdentity.turnId,turn.turnId);
    assert.ok(bundle.acceptedResultIds.every(id=>id.includes(turn.turnId)));
    gather.markSealed({id:`seal:${turn.turnId}`});
  }

  assert.equal(tasks,2100);
  assert.ok(duplicates>0);assert.ok(stale>0);assert.ok(invalid>0);assert.ok(fallbacks>0);
  assert.equal(hub.list().length,100);
});

test('closed gather routes post-close opportunistic/deferred work forward/background and never reopens foreground', async () => {
  const turn=createTurnEnvelope(createEmberTurn({turnId:'turn:late-stress',eventId:'evt:late-stress',correlationId:'corr:late-stress',dedupeKey:'turn:late-stress'}));
  const plan=new DynamicFanOutPlanner().plan({turnEvent:turn,...createEmberPlannerInput()});
  const gather=new GatherCoordinator({turnEvent:turn,plan,currentRevisionSet:turn});
  for(const task of plan.tasks.filter(x=>x.resultClass===ResultClass.REQUIRED)) gather.addFallback(task.taskId,fallbackResult(task,57));
  gather.close({at:57});gather.markSealed({id:'seal'});
  const green=plan.tasks.find(x=>x.metadata.roleId==='green-room');
  const result=createWorkerResult({resultId:'late-green',taskId:green.taskId,turnId:green.turnId,correlationId:green.correlationId,workerId:'w',providerId:'p',capabilities:green.requiredCapabilities,payload:{},provenance:{},confidence:.7,freshnessIdentity:green.inputRevisionSet,inputRevisionSet:green.inputRevisionSet,startedAt:0,completedAt:220,authorityClass:'INFERRED'});
  const routed=await gather.accept(result,{arrivalAt:220}); assert.equal(routed.destination,'NEXT_TURN'); assert.equal(gather.bundle().greenRoom.length,0);
});

function fallbackResult(task,at){
  return createWorkerResult({resultId:`fallback:${task.taskId}`,taskId:task.taskId,turnId:task.turnId,correlationId:task.correlationId,workerId:'fallback',providerId:'deterministic',capabilities:task.requiredCapabilities,status:'FALLBACK',payload:{fallback:true},provenance:{},confidence:0,freshnessIdentity:task.inputRevisionSet,inputRevisionSet:task.inputRevisionSet,startedAt:at,completedAt:at});
}
