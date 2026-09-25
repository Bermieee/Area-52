import test from 'node:test';
import assert from 'node:assert/strict';
import {runHotCognitionWave7Stress} from './hot-cognition-wave7-stress-harness.js';

test('Wave 7 Hot Cognition focused stress meets required minimums and invariants',()=>{
  const r=runHotCognitionWave7Stress();
  assert.equal(r.pass,true,JSON.stringify({invariants:r.invariants,metrics:r.metrics,failures:r.failures},null,2));
  assert.ok(r.counts.incrementalHotUpdates>=5000);
  assert.ok(r.counts.castLocationTransitions>=999);
  assert.ok(r.counts.duplicateEvents+r.counts.staleEvents>=1000);
  assert.ok(r.counts.targetedInvalidations>=500);
  assert.ok(r.counts.reloadReconstructionCycles>=250);
  assert.ok(r.counts.continuousSceneReplayEvents>=1);
});
