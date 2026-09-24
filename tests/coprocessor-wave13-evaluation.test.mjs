import test from 'node:test';
import assert from 'node:assert/strict';
import {runCoprocessorWave13Evaluation} from '../evaluation/coprocessor-wave13-evaluator.mjs';

test('Wave 13 11-case cognitive choice corpus preserves authority, abstention and resource semantics',async()=>{
  const r=await runCoprocessorWave13Evaluation();
  assert.equal(r.corpusCases,11);
  assert.equal(r.correctness.falseCertainty,0);
  assert.equal(r.correctness.falseSelections,0);
  assert.equal(r.correctness.bladeFatePreservedUnresolved,true);
  assert.equal(r.correctness.hotOnlyOptionalNominations,0);
  assert.equal(r.correctness.mixedCorrectiveNominated,true);
  assert.equal(r.correctness.warmUsefulRequiresCoreRevalidation,true);
  assert.equal(r.correctness.providerFailureFallbackCorrect,true);
  assert.equal(r.correctness.allCoreAuthorityChecks,true);
  assert.equal(r.policyComparison.strictExternalDisposition,'SKIPPED');
  assert.equal(r.policyComparison.allowedExternalDisposition,'NOMINATED');
  assert.deepEqual(r.policyComparison.changedOptions,['external-grounding']);
  assert.equal(r.policyComparison.authorityChanged,false);
  assert.equal(r.pathComparison.deterministicOnly.outcome,'UNRESOLVED');
  assert.equal(r.pathComparison.optionalJev.outcome,'UNRESOLVED');
  assert.equal(r.pathComparison.optionalJev.changedDecision,false);
  assert.equal(r.pathComparison.providerFailure.fallbackContract,'PRESERVE_UNRESOLVED');
  assert.equal(r.pathComparison.providerFailure.fabricatedAuthority,false);
  assert.equal(r.work.semanticResourceParity,true);
  assert.ok(r.work.oneResourceCriticalPathEstimateMs>=r.work.multiResourceCriticalPathEstimateMs);
  assert.equal(r.providerConfiguration.liveProviderSmoke.status,'SKIPPED');
  assert.equal(r.providerConfiguration.fixtureProviderTiming,'SIMULATED_FIXTURE_ONLY');
  assert.equal(r.costAndTokens.status,'NOT_MEASURED');
  assert.ok(r.hostMeasurements.wallMs>=0);
  assert.ok(r.hostMeasurements.cpuMs?.total>=0);
  assert.equal(r.rows.find(x=>x.name==='optional-provider-failure').executionDegraded,true);
  assert.equal(r.rows.find(x=>x.name==='low-quality-abstain').ownerOutcome.memoryLongTerm,'ABSTAIN');
  assert.equal(r.rows.find(x=>x.name==='warm-fresh').warmCountedUseful,true);
  assert.equal(r.rows.find(x=>x.name==='warm-miss').warmCountedUseful,false);
  assert.equal(r.rows.find(x=>x.name==='warm-stale-late').warmCountedUseful,false);
});

test('Wave 13 evaluation exposes actual host measurements separately from fixture provider estimates',async()=>{
  const r=await runCoprocessorWave13Evaluation();
  assert.equal(r.hostMeasurements.measurementClass,'ACTUAL_NODE_HOST_PROCESS');
  assert.equal(r.providerConfiguration.fixtureProviderTiming,'SIMULATED_FIXTURE_ONLY');
  assert.equal(r.providerConfiguration.liveProviderSmoke.status,'SKIPPED');
  assert.equal(r.costAndTokens.status,'NOT_MEASURED');
  assert.ok(r.rows.every(x=>Number.isFinite(x.hostPolicyEvaluationMs)));
  assert.ok(r.rows.every(x=>Number.isFinite(x.fixtureCriticalPathEstimateMs)));
});
