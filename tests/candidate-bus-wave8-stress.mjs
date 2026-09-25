import test from 'node:test';
import assert from 'node:assert/strict';
import {runWave8Stress} from './candidate-bus-wave8-stress-harness.js';

test('Wave 8 focused Candidate Bus and index lifecycle stress remains bounded and truthful',()=>{
  const r=runWave8Stress();
  assert.equal(r.pass,true,JSON.stringify({invariants:r.invariants,metrics:r.metrics,failures:r.failureDetails},null,2));
  assert.ok(r.counts.candidateNominations>=10000);
  assert.ok(r.counts.duplicateNominations>=5000);
  assert.ok(r.counts.orderPermutations>=5000);
  assert.ok(r.counts.staleRevisionCases>=2000);
  assert.ok(r.counts.partialChannelFailureCases>=2000);
  assert.ok(r.counts.indexInserts>=2000);
  assert.ok(r.counts.indexUpdates>=2000);
  assert.ok(r.counts.indexInvalidations>=1000);
  assert.ok(r.counts.indexTombstones>=1000);
  assert.ok(r.counts.rebuilds>=500);
  assert.ok(r.counts.verifyCycles>=500);
  assert.ok(r.counts.tornStateRecoveryCases>=250);
});
