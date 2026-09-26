import test from 'node:test';
import assert from 'node:assert/strict';
import { runWave15NativeSwarmEvaluation } from '../evaluation/native-sidecar-swarm-wave15-evaluator.mjs';

test('Wave 15 benchmark labels local deterministic timing separately from measured live provider evidence',async()=>{
  const report=await runWave15NativeSwarmEvaluation();
  assert.equal(report.measurementClasses.swarmTiming,'LOCAL_DETERMINISTIC');
  assert.equal(report.measurementClasses.externalProvider,'NOT_MEASURED_IN_DEFAULT_CI');
  assert.equal(report.liveProviderRequirement.status,'REQUIRES_OPERATOR_CONFIGURED_ENDPOINT');
  assert.equal(report.nativeSwarm.sameLogicalTaskSet,true);
  assert.equal(report.nativeSwarm.secondResourceOptional,true);
  assert.equal(report.nativeSwarm.oneResource.readyResults,2);
  assert.equal(report.nativeSwarm.twoResources.readyResults,2);
});

test('Wave 15 Jev evaluation shows deterministic skip and bounded local usefulness without authority escalation',async()=>{
  const report=await runWave15NativeSwarmEvaluation();
  assert.equal(report.jev.clearStatus,'SKIPPED');
  assert.equal(report.jev.clearProviderRan,false);
  assert.equal(report.jev.deterministicBaseline,'UNRESOLVED');
  assert.equal(report.jev.optionalOutcome,'DECIDED');
  assert.deepEqual(report.jev.selectedOptionIds,['option-a']);
  assert.equal(report.jev.changedDecision,true);
  assert.equal(report.jev.authorityGranted,false);
  assert.equal(report.jev.settlementPerformed,false);
  assert.equal(report.authority.finalChoice,false);
  assert.equal(report.authority.contextSeal,false);
});
