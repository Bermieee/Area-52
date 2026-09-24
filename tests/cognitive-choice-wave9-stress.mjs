import test from 'node:test';
import assert from 'node:assert/strict';
import {runCognitiveChoiceWave9Stress} from './cognitive-choice-wave9-stress-harness.js';

test('Wave 9 Cognitive Choice focused stress stays bounded and truthful',()=>{
  const r=runCognitiveChoiceWave9Stress();
  assert.equal(r.pass,true,JSON.stringify({invariants:r.invariants,failures:r.failures,counts:r.counts},null,2));
  assert.ok(r.counts.highTurns>=10);
  assert.ok(r.counts.mixedTurns>=10);
  assert.ok(r.counts.hotTurns>=15);
  assert.ok(r.counts.burstNominations>=50);
  assert.ok(r.counts.replays>=20);
});
