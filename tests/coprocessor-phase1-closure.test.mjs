import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CapabilityProfileRegistry, CoprocessorPlacementPolicy, CoprocessorTelemetry, DynamicFanOutPlanner,
  Freshness, GatherCoordinator, GreenRoomEphemeralStore, ResultClass, RetrievalQuality, TelemetryEvent,
  createCognitiveTask, createRevisionSet, createTurnEnvelope, createWorkerResult, emitTelemetry, estimateTokens,
  retrievalControlDecision, runFunctionTestTurn, sha256Hex, summarizeWave2Benchmarks, toRuntimeCapabilityDescriptor,
} from '../src/coprocessor/index.js';

function task({taskId='t',requiredCapabilities=['CAP'],capabilityRequests, fallbackCapabilitySets=[],resultClass=ResultClass.REQUIRED,
  placement='HOT',cognitiveLayer='L1',compilerLane='externalGrounding'}={}){
  return createCognitiveTask({taskId,taskType:'X',turnId:'turn',correlationId:'corr',requiredCapabilities,capabilityRequests,fallbackCapabilitySets,
    resultClass,placement,cognitiveLayer,softDeadline:50,hardDeadline:100,compilerLane,intentFingerprint:'intent',
    inputRevisionSet:createRevisionSet({sourceRevisionSet:['s'],worldRevision:1,sceneRevision:1,characterStateRevision:1})});
}

test('browser compatibility SHA-256 matches the standard vector',()=>{
  assert.equal(sha256Hex('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('token estimation remains browser-safe when Node Buffer is unavailable',()=>{
  const original=globalThis.Buffer;
  try{globalThis.Buffer=undefined;assert.ok(estimateTokens({text:'héllo 世界'})>0);}
  finally{globalThis.Buffer=original;}
});

test('Function Test 001 executes with Node Buffer unavailable',async()=>{
  const original=globalThis.Buffer;
  try{
    globalThis.Buffer=undefined;
    const report=await runFunctionTestTurn();
    assert.equal(report.foregroundQuorumReceipt.satisfied,true);
    assert.equal(report.foregroundQuorumReceipt.closedAt,70);
    assert.equal(report.lateResults[0].destination,'NEXT_TURN');
  } finally { globalThis.Buffer=original; }
});

test('integration-visible Coprocessor runtime files contain no Node-only Buffer or node:* dependency',async()=>{
  for(const rel of [
    '../src/coprocessor/provider-execution.js','../src/coprocessor/integration-adapters.js','../src/coprocessor/telemetry.js',
    '../src/coprocessor/validation.js','../src/coprocessor/swarm.js','../src/coprocessor/function-test-001.js',
  ]){
    const text=await readFile(new URL(rel,import.meta.url),'utf8');
    assert.doesNotMatch(text,/\bBuffer\b/,`${rel} must not depend on Buffer`);
    assert.doesNotMatch(text,/from\s+['"]node:/,`${rel} must not import node:* built-ins`);
  }
});

test('capability discovery negotiates a fallback set without choosing Runtime resources',()=>{
  const registry=new CapabilityProfileRegistry();
  registry.register({profileId:'fallback',workerId:'slot',providerId:'provider',capabilities:['FALLBACK'],capabilityVersions:{FALLBACK:2}});
  const t=task({requiredCapabilities:['PRIMARY'],capabilityRequests:[{id:'PRIMARY',minVersion:1,preferredVersion:1}],
    fallbackCapabilitySets:[[{id:'FALLBACK',minVersion:2,preferredVersion:2}]]});
  const discovery=registry.discover(t);
  assert.equal(discovery.degraded,true);assert.equal(discovery.fallbackIndex,0);
  assert.deepEqual(discovery.profiles.map(x=>x.profileId),['fallback']);
  assert.equal('schedule' in discovery,false);assert.equal('execute' in discovery,false);
});

test('capability discovery enforces foreground/background eligibility, health, load, latency and structured output',()=>{
  const registry=new CapabilityProfileRegistry();
  registry.register({profileId:'fg',capabilities:['CAP'],foregroundEligible:true,backgroundEligible:false,latencyClass:'LOW'});
  registry.register({profileId:'bg',capabilities:['CAP'],foregroundEligible:false,backgroundEligible:true,latencyClass:'LOW'});
  registry.register({profileId:'slow',capabilities:['CAP'],foregroundEligible:true,backgroundEligible:true,latencyClass:'HIGH'});
  registry.register({profileId:'plain',capabilities:['CAP'],foregroundEligible:true,backgroundEligible:true,structuredOutput:false,latencyClass:'LOW'});
  assert.deepEqual(registry.discover(task(),{maxLatencyClass:'MEDIUM'}).profiles.map(x=>x.profileId),['fg']);
  assert.deepEqual(registry.discover(task({resultClass:ResultClass.DEFERRED}),{maxLatencyClass:'MEDIUM'}).profiles.map(x=>x.profileId),['bg']);
  registry.setHealth('fg','unhealthy');assert.equal(registry.discover(task(),{maxLatencyClass:'MEDIUM'}).profiles.length,0);
  registry.setHealth('fg','healthy');registry.setLoad('fg',1);assert.equal(registry.discover(task(),{maxLatencyClass:'MEDIUM'}).profiles.length,0);
});

test('Runtime capability descriptor exposes negotiation metadata without scheduling authority',()=>{
  const registry=new CapabilityProfileRegistry();
  const p=registry.register({profileId:'p',workerId:'w',providerId:'provider',modelId:'m',capabilities:['CAP'],fallbackCapabilities:['ALT'],
    placements:['HOT'],latencyClass:'LOW',reliability:.9,structuredOutput:true,maxContextTokens:4096,maxOutputTokens:512,local:true,costClass:'LOW'});
  const d=toRuntimeCapabilityDescriptor(p);
  assert.deepEqual(d.fallbackCapabilities,['ALT']);assert.deepEqual(d.placements,['HOT']);
  assert.equal(d.structuredOutput,true);assert.equal(d.maxContextTokens,4096);assert.equal(d.maxOutputTokens,512);
  assert.equal(d.local,true);assert.equal(d.reliability,.9);assert.equal('schedule' in d,false);assert.equal('execute' in d,false);
});

test('Gather compiler input includes an explicit precisionResults lane',async()=>{
  const event=createTurnEnvelope({turnId:'precision-turn',eventId:'precision-event',correlationId:'precision-corr',dedupeKey:'precision',
    sourceRevisionSet:['s'],worldRevision:1,sceneRevision:1,characterStateRevision:1});
  const t=createCognitiveTask({taskId:'precision-task',taskType:'PRECISION',turnId:event.turnId,correlationId:event.correlationId,
    requiredCapabilities:['RERANK'],resultClass:ResultClass.REQUIRED,softDeadline:50,hardDeadline:100,compilerLane:'precisionResults',
    inputRevisionSet:event,intentFingerprint:'precision-intent'});
  const plan={tasks:[t]};const gather=new GatherCoordinator({turnEvent:event,plan,currentRevisionSet:event});
  const r=createWorkerResult({resultId:'precision-result',taskId:t.taskId,turnId:t.turnId,correlationId:t.correlationId,workerId:'w',providerId:'p',
    capabilities:['RERANK'],payload:{ranking:[{ref:'A',score:.9}]},provenance:{},confidence:.9,freshnessIdentity:t.inputRevisionSet,
    inputRevisionSet:t.inputRevisionSet,intentFingerprint:t.intentFingerprint,startedAt:0,completedAt:10});
  assert.equal((await gather.accept(r)).accepted,true);
  assert.deepEqual(gather.compilerInput().precisionResults,[{ranking:[{ref:'A',score:.9}]}]);
});

test('Phase 1 placement policy explicitly separates HOT generation cognition from DEEP deferred cognition',()=>{
  assert.deepEqual(CoprocessorPlacementPolicy.HISTORIAN_RETRIEVAL,{placement:'HOT',layers:['L1'],resultClass:'REQUIRED'});
  assert.equal(CoprocessorPlacementPolicy.GREEN_ROOM.resultClass,'OPPORTUNISTIC');
  for(const type of ['CONSOLIDATION','REFLECTION','LORE_STUDY']){
    assert.equal(CoprocessorPlacementPolicy[type].placement,'DEEP');assert.equal(CoprocessorPlacementPolicy[type].resultClass,'DEFERRED');
  }
});

test('Dynamic Fan-Out remains bounded with forty eligible semantic roles',()=>{
  const catalog=Array.from({length:40},(_,i)=>({roleId:`role-${i}`,taskType:`TYPE_${i}`,compilerLane:'externalGrounding',
    requiredCapabilities:[`CAP_${i}`],resultClass:ResultClass.OPPORTUNISTIC,placement:'HOT',cognitiveLayer:'L1'}));
  const event=createTurnEnvelope({turnId:'forty',eventId:'forty-event',correlationId:'forty-corr',dedupeKey:'forty'});
  const expectedValue=Object.fromEntries(catalog.map(x=>[x.roleId,.9]));
  const plan=new DynamicFanOutPlanner({roleCatalog:catalog,maxWorkers:40}).plan({turnEvent:event,text:'complex continuation',expectedValue,maxFanOut:4,
    resourceConstraint:{maxForegroundWorkers:4}});
  assert.equal(plan.tasks.length,4);assert.equal(plan.boundedFanOut,4);
});

test('dialogue can select Historian and Green Room without Graph Walker',()=>{
  const event=createTurnEnvelope({turnId:'dialogue',eventId:'dialogue-event',correlationId:'dialogue-corr',dedupeKey:'dialogue'});
  const roles=new DynamicFanOutPlanner().plan({turnEvent:event,text:'Mara speaks quietly to Eris.',activeCast:['Mara','Eris']}).tasks.map(x=>x.metadata.roleId);
  assert.ok(roles.includes('historian'));assert.ok(roles.includes('green-room'));assert.equal(roles.includes('graph-walker'),false);
});

test('physical/location query selects Historian, Graph Walker and Truth Precision',()=>{
  const event=createTurnEnvelope({turnId:'physical',eventId:'physical-event',correlationId:'physical-corr',dedupeKey:'physical'});
  const roles=new DynamicFanOutPlanner().plan({turnEvent:event,text:'Where is the Blade?',queryIntent:'LOCATION'}).tasks.map(x=>x.metadata.roleId);
  assert.ok(roles.includes('historian'));assert.ok(roles.includes('graph-walker'));assert.ok(roles.includes('truth-precision'));
});

test('Green Room expires departed characters without durable-state mutation',()=>{
  const store=new GreenRoomEphemeralStore();store.put({characters:[{characterId:'Mara',sceneRevision:3,expiry:{ttlTurns:5,onCharacterExit:true},confidence:.7}]},{turnSequence:10});
  assert.equal(store.get('Mara',{sceneRevision:3,turnSequence:11,activeCharacterIds:['Eris']}),null);assert.equal(store.size(),0);
});

test('telemetry recursively removes raw material, clips large values and remains ring-bounded',()=>{
  const telemetry=new CoprocessorTelemetry({limit:2,bounds:{maxString:64,maxArray:4,maxKeys:8,maxDepth:4}});
  telemetry.emit(TelemetryEvent.PROVIDER_INVOKED,{providerId:'p',nested:{rawResponse:'SECRET',label:'x'.repeat(500)}});
  telemetry.emit(TelemetryEvent.PROVIDER_SELECTED,{providerId:'p2'});
  telemetry.emit(TelemetryEvent.PROVIDER_FAILED,{providerId:'p3'});
  const events=telemetry.list();assert.equal(events.length,2);
  const first=new CoprocessorTelemetry({limit:2,bounds:{maxString:64}});first.emit(TelemetryEvent.PROVIDER_INVOKED,{nested:{rawResponse:'SECRET',label:'x'.repeat(500)}});
  assert.equal('rawResponse' in first.list()[0].payload.nested,false);assert.match(first.list()[0].payload.nested.label,/clipped/);
});

test('telemetry failures and subscriber failures cannot stop cognition callers',()=>{
  const telemetry=new CoprocessorTelemetry();telemetry.subscribe(()=>{throw new Error('observer failed');});
  assert.doesNotThrow(()=>telemetry.emit(TelemetryEvent.TASK_STARTED,{taskId:'x'}));
  const broken={emit(){throw new Error('transport failed');}};
  assert.equal(emitTelemetry(broken,TelemetryEvent.TASK_STARTED,{taskId:'x'}),null);
});

test('benchmark summary exposes closure metrics only when measured',()=>{
  const summary=summarizeWave2Benchmarks({malformedOutputChecks:[true,true],fallbackChecks:[true],zeroWorkerChecks:[true],providerInterchangeChecks:[true,false]});
  assert.equal(summary.malformedOutputRejection,1);assert.equal(summary.fallbackCorrectness,1);assert.equal(summary.zeroWorkerCorrectness,1);
  assert.equal(summary.providerInterchangeability,.5);assert.equal(summary.cpuMs,null);assert.equal(summary.llmInputTokens,null);
});

test('CRAG/Self-RAG Sidecar policy is bounded and may refuse long-term memory',()=>{
  assert.equal(retrievalControlDecision({quality:RetrievalQuality.HIGH}).action,'PROCEED');
  assert.equal(retrievalControlDecision({quality:RetrievalQuality.MIXED,correctiveAttempt:0,maxCorrectiveAttempts:1}).action,'CORRECTIVE_RETRIEVAL');
  assert.equal(retrievalControlDecision({quality:RetrievalQuality.MIXED,correctiveAttempt:1,maxCorrectiveAttempts:1}).action,'NO_LONG_TERM_MEMORY');
  assert.equal(retrievalControlDecision({quality:RetrievalQuality.LOW}).allowLongTermMemory,false);
  assert.equal(retrievalControlDecision({quality:RetrievalQuality.HIGH,simpleTurn:true}).action,'SKIP');
});

test('provider identity JEV never escalates worker authority',()=>{
  const t=task();const r=createWorkerResult({resultId:'jev-result',taskId:t.taskId,turnId:t.turnId,correlationId:t.correlationId,workerId:'jev-worker',
    providerId:'JEV',capabilities:['CAP'],payload:{classification:'advisory'},provenance:{},confidence:1,freshnessIdentity:t.inputRevisionSet,
    inputRevisionSet:t.inputRevisionSet,intentFingerprint:t.intentFingerprint,startedAt:0,completedAt:1});
  assert.equal(r.providerId,'JEV');assert.equal(r.authorityClass,'UNRESOLVED');assert.equal(r.status,'SUCCESS');
});
