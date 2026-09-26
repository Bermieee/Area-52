import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWave22JevValue } from '../evaluation/jev-wave22-value-evaluator.mjs';

test('Jev usefulness report separates deterministic fixtures from authenticated live execution',async()=>{
  const report=await evaluateWave22JevValue();
  assert.equal(report.kind,'JEV_WAVE22_VALUE_REPORT');
  assert.ok(report.comparison.deterministicOnly.cases>0);
  assert.equal(report.comparison.jevAssisted.cases,report.comparison.deterministicOnly.cases);
  assert.ok(Number.isFinite(report.comparison.delta.correctnessRate));
  assert.ok(Number.isFinite(report.comparison.delta.latencyMs));
  assert.ok(Number.isFinite(report.comparison.delta.tokenProxyCost));
  assert.equal(report.executionEvidence.fixtureMeasurementClass,'LOCAL_DETERMINISTIC');
  assert.ok(report.executionEvidence.fixturePhysicalProviderAttempts>=0);
  assert.equal(report.executionEvidence.authenticatedLiveProviderPhysicalAttempts,0);
  assert.equal(report.executionEvidence.authenticatedOwnerAcceptedExecutions,0);
  assert.equal(report.executionEvidence.liveLatencyMeasured,false);
  assert.equal(report.executionEvidence.liveCostMeasured,false);
  assert.equal(report.executionEvidence.fixturesCountAsLive,false);
  assert.match(report.executionEvidence.ft005Status,/OPEN_PENDING/);
  assert.equal(report.safety.aggregateScoreCanOverrideSafetyFailure,false);
});
