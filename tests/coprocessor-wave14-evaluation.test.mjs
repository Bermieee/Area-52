import test from 'node:test';
import assert from 'node:assert/strict';
import {runResourceConnectionWave14Evaluation} from '../evaluation/resource-connection-wave14-evaluator.mjs';

test('Wave 14 benchmark separates local deterministic transport from live-provider claims',async()=>{
  const r=await runResourceConnectionWave14Evaluation();
  assert.equal(r.benchmark,'AREA52_RESOURCE_CONNECTION_WAVE14');
  assert.equal(r.measurementClasses.ciProviderTransport,'LOCAL_DETERMINISTIC');
  assert.match(r.measurementClasses.externalLiveProvider,/SKIPPED/);
  assert.equal(r.measurementClasses.simulated,'NONE_IN_THIS_REPORT');
  assert.equal(r.correctness.noOptionalResourceRequired,true);
  assert.equal(r.correctness.connectionReady,true);
  assert.equal(r.correctness.twoSettingsExecuted,true);
  assert.equal(r.correctness.onePhysicalResourceMultipleJobs,true);
  assert.equal(r.correctness.jevClearSkipped,true);
  assert.equal(r.correctness.jevNoAuthority,true);
  assert.equal(r.correctness.malformedFallbackCorrect,true);
  assert.equal(r.correctness.timeoutTyped,true);
  assert.equal(r.failureFallback.malformedFirstFailure,'MALFORMED_OUTPUT');
  assert.equal(r.failureFallback.timeoutFailure,'PROVIDER_TIMEOUT');
  assert.equal(r.execution.unrelatedSettings.length,2);
  assert.equal(r.execution.graphUsageReceipt.cost.status,'MEASURED');
  assert.equal(r.execution.truthUsageReceipt.cost.status,'MEASURED');
  assert.ok(r.transportCalls.chatCalls>=3);
  assert.ok(r.hostMeasurements.wallMs>=0);
  assert.ok(r.hostMeasurements.cpuMs.total>=0);
});

test('Wave 14 benchmark keeps Jev abstention/unresolved legal and authority-free',async()=>{
  const r=await runResourceConnectionWave14Evaluation();
  assert.equal(r.jev.clearServiceStatus,'JEV_SKIPPED');
  assert.equal(r.jev.clearProviderCalled,false);
  assert.ok(['JEV_ABSTAINED','JEV_UNRESOLVED','JEV_DECIDED','JEV_PARTIAL'].includes(r.jev.ambiguousServiceStatus));
  assert.equal(r.jev.authorityGranted,false);
  assert.equal(r.jev.settlementPerformed,false);
  assert.equal(r.jev.measurementClass,'LOCAL_DETERMINISTIC');
});
