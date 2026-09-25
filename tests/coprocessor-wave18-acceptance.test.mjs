import test from 'node:test';
import assert from 'node:assert/strict';

import {
  JevDomain,
  createDefaultJevDomainAdapterRegistry,
  createMemoryConsolidationDeepWork,
  admitGreenRoomBatchToMemoryOwner,
} from '../src/coprocessor/index.js';
import { evaluateCoprocessorWave18 } from '../evaluation/coprocessor-wave18-evaluator.mjs';

test('Wave18 two-story native path chooses useful work, skips quiet work, and preserves zero-resource native behavior',async()=>{
  const report=await evaluateCoprocessorWave18();
  assert.equal(report.kind,'CoprocessorWave18Evaluation');
  assert.equal(report.evidenceClass,'LOCAL_DETERMINISTIC');
  assert.equal(report.stories.length,2);

  const a=report.stories.find(x=>x.storyId==='story-a-ember-road');
  assert.equal(a.quietTurn.nativeOutcome,'DECIDED');
  assert.equal(a.quietTurn.optionalResourceCount,0);
  assert.equal(a.quietTurn.placement,'SKIP');
  assert.equal(a.fastSceneChange.placement,'RUN_HOT');
  assert.equal(a.fastSceneChange.discardStatus,'FOREGROUND_FALLBACK');
  assert.equal(a.fastSceneChange.discardFreshness,'STALE');
  assert.equal(a.fastSceneChange.cancelledPreparations,1);
  assert.equal(a.fastSceneChange.cancelledStatus,'CANCELLED');
  assert.equal(a.likelyNextLocation.prepareStatus,'WARMED');
  assert.equal(a.likelyNextLocation.reuseCandidateStatus,'REVALIDATE_FOR_CORE_ADMISSION');
  assert.equal(a.likelyNextLocation.ownerRevalidatedStatus,'CORE_REVALIDATED');

  const b=report.stories.find(x=>x.storyId==='story-b-harbor-siege');
  assert.equal(b.multiCharacter.proposalCount,2);
  assert.equal(b.multiCharacter.ownerStatus,'ACCEPTED');
  assert.equal(b.multiCharacter.missingOwnerStatus,'OWNER_CONTRACT_UNAVAILABLE');
  assert.equal(b.multiCharacter.authority,'INFERRED');
  assert.equal(b.longConversation.placement,'QUEUE_DEEP');
  assert.equal(b.longConversation.yieldedStatus,'YIELDED');
  assert.equal(b.longConversation.firstStatus,'CHECKPOINTED');
  assert.equal(b.longConversation.finalStatus,'COMPLETED');
  assert.equal(b.longConversation.ownerAccepted,true);

  assert.equal(report.nativeFallback.zeroOptionalResources,true);
  assert.equal(report.nativeFallback.nativeOutcome,'DECIDED');
  assert.equal(report.nativeFallback.resourceHostResourceCount,0);
  assert.equal(report.nativeFallback.externalDatabaseRequired,false);
  assert.equal(report.nativeFallback.orchestrationServiceRequired,false);
});

test('Wave18 measurements report queue/execution/reuse/discard/foreground impact without zero-latency claims',async()=>{
  const report=await evaluateCoprocessorWave18();
  assert.ok(report.measurements.prefetch.totalExecutionTimeMs>0);
  assert.ok(report.measurements.prefetch.usefulFreshHits>=1);
  assert.ok(report.measurements.prefetch.staleDiscards>=1);
  assert.ok(report.measurements.prefetch.preparationsCancelled>=1);
  assert.equal(report.measurements.prefetch.falseWarmHits,0);

  assert.equal(report.measurements.scheduler.totalDeepExecutionMs,24);
  assert.equal(report.measurements.scheduler.totalDeepQueueMs,5);
  assert.equal(report.measurements.scheduler.deepYields,1);
  assert.equal(report.measurements.scheduler.deepResumes,1);
  assert.equal(report.measurements.scheduler.deepCompleted,1);
  assert.equal(report.measurements.scheduler.foregroundBlockedMs,0);
});

test('Wave18 Jev matrix adds bounded Memory and Temporal with deterministic skip, abstention, owner review, conflict, and post-seal rejection',async()=>{
  const registry=createDefaultJevDomainAdapterRegistry();
  assert.equal(JevDomain.MEMORY,'MEMORY');
  assert.equal(JevDomain.TEMPORAL,'TEMPORAL');
  assert.equal(registry.resolve('MEMORY','MEMORY_KNOWLEDGE_BELIEF_CLASSIFICATION').adapterId,'jev.adapter.memory.v1');
  assert.equal(registry.resolve('TEMPORAL','TEMPORAL_TRANSITION_CONTRADICTION').adapterId,'jev.adapter.temporal.v1');

  const report=await evaluateCoprocessorWave18();
  assert.equal(report.jev.deterministicMemory.path,'DETERMINISTIC');
  assert.equal(report.jev.deterministicMemory.outcome,'KNOWN');
  assert.equal(report.jev.uncertainMemory.abstained,true);
  assert.equal(report.jev.uncertainMemory.outcome,'UNRESOLVED');
  assert.equal(report.jev.uncertainMemory.ownerDecision,'UNRESOLVED');
  assert.equal(report.jev.conflictingTemporal.outcome,'TEMPORALLY_DISTINCT');
  assert.equal(report.jev.conflictingTemporal.ownerDecision,'ACCEPTED');
  assert.equal(report.jev.postSeal.late,true);
  assert.equal(report.jev.postSeal.foregroundEligible,false);
  assert.equal(report.jev.postSeal.ownerDecision,'REJECTED');
});

test('Wave18 absent owners stay explicitly pending instead of manufacturing Memory acceptance',()=>{
  const batch={kind:'GreenRoomBatch',sceneRevision:1,characters:[]};
  const green=admitGreenRoomBatchToMemoryOwner({batch,memoryOwner:null});
  assert.equal(green.status,'OWNER_CONTRACT_UNAVAILABLE');
  assert.equal(green.ownerAccepted,false);
  assert.equal(green.pendingOwnerIntegration,true);

  const consolidation=createMemoryConsolidationDeepWork({memoryOwner:null,jobs:[{jobId:'long-chat'}]});
  assert.equal(consolidation.status,'OWNER_CONTRACT_UNAVAILABLE');
  assert.equal(consolidation.available,false);
  assert.equal(consolidation.pendingOwnerIntegration,true);
  assert.equal(consolidation.work,null);
});

test('Wave18 bounded read model exposes operational state but not prompts, credentials, or raw evidence bodies',async()=>{
  const report=await evaluateCoprocessorWave18();
  const text=JSON.stringify(report.readModel);
  assert.equal(report.readModel.kind,'Wave18CoprocessorReadModel');
  assert.equal(report.readModel.authority.mutation,false);
  assert.equal(report.readModel.authority.truth,false);
  assert.equal(report.readModel.authority.settlement,false);
  assert.equal(report.readModel.greenRoom.proposals.length,2);
  assert.equal(report.readModel.consolidation[0].status,'COMPLETED');
  assert.equal(report.readModel.ownerAcceptance.some(x=>x.pendingOwnerIntegration),true);
  assert.doesNotMatch(text,/apiKey|authorization|credential|rawPrompt|systemPrompt|fullConversation/i);
  assert.doesNotMatch(text,/Nia heard the warning directly|The harbor gate was closed before dusk/i);
  assert.equal(report.live.externalProviderObserved,false);
  assert.equal(report.live.status,'REQUIRES_OPERATOR_CONFIGURED_PROVIDER');
});
