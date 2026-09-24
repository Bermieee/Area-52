import test from 'node:test';
import assert from 'node:assert/strict';
import {runSpeculativeWarmerWave12Benchmark} from '../evaluation/speculative-warmer-wave12-evaluator.mjs';

test('Wave 12 Ember Tavern / Sun Blade benchmark measures warm cost, saved Send work and fallback correctness',async()=>{
  const report=await runSpeculativeWarmerWave12Benchmark({latency:false});
  assert.equal(report.scenarioCount,4);
  assert.equal(report.predictionAttempts,4);
  assert.equal(report.usefulFreshHits,2);
  assert.equal(report.partialSalvage,1);
  assert.equal(report.staleInvalidDiscards,1);
  assert.equal(report.falseWarmHits,0);
  assert.ok(report.foregroundWorkAvoided.retrieval>=2);
  assert.ok(report.foregroundWorkAvoided.truth>=2);
  assert.ok(report.foregroundWorkAvoided.precision>=2);
  assert.ok(report.foregroundWorkAvoided.compile>=2);
  assert.equal(report.correctness.fallbackCorrect,true);
  assert.equal(report.correctness.bladeFateRemainedUnresolved,true);
  assert.equal(report.correctness.ambiguousWrongLocationAdmitted,false);
  assert.equal(report.correctness.zeroLatencyClaim,false);
  assert.ok(report.retainedPacketBytes>0);
  assert.ok(report.maxPacketBytes<=32768);
});

test('Wave 12 measured benchmark records non-zero warm preparation and foreground-only versus warmed Send latency',async()=>{
  const report=await runSpeculativeWarmerWave12Benchmark({latency:true});
  assert.ok(report.foregroundOnly.totalSendLatencyMs>0);
  assert.ok(report.warmed.totalPreparationLatencyMs>0);
  assert.ok(report.warmed.totalSendLatencyMs>0);
  assert.ok(report.sendLatencySavedMs>0);
  assert.equal(report.provider.externalProvider,false);
});
