import test from 'node:test';
import assert from 'node:assert/strict';
import {runWave17SidecarJevEvaluation} from '../evaluation/sidecar-jev-wave17-evaluator.mjs';

test('Wave17 report keeps owner admission and browser binding separate from measured-live evidence',async()=>{
  const report=await runWave17SidecarJevEvaluation();
  assert.equal(report.measurementClasses.browserNativeFetch,'LOCAL_DETERMINISTIC');
  assert.equal(report.measurementClasses.ownerAdmission,'LOCAL_DETERMINISTIC');
  assert.equal(report.measurementClasses.failureInjection,'SIMULATED_FAILURE');
  assert.equal(report.measurementClasses.externalOpenRouter,'NOT_MEASURED_IN_DEFAULT_CI');
  assert.equal(await report.browserFetchBinding.calledAfterInvoke,true);
  assert.equal(await report.browserFetchBinding.receiverCorrectAfterInvoke,true);
  assert.equal(report.nativeBrain.zeroResourcesUsable,true);
  assert.equal(report.nativeBrain.readyOptionalResources,0);
  assert.equal(report.ownerHandoff.ownerEligible,1);
  assert.equal(report.ownerHandoff.ownerAccepted,1);
  assert.equal(report.ownerHandoff.jevAutoAdmitted,false);
  assert.equal(report.liveEvidence.realProviderCallObserved,false);
  assert.equal(report.liveEvidence.ft005LivePass,false);
  assert.equal(report.liveEvidence.jevLivePass,false);
  assert.equal(report.liveEvidence.vectorLivePass,false);
  assert.equal(report.authority.finalChoice,false);
  assert.equal(report.authority.contextSeal,false);
});
