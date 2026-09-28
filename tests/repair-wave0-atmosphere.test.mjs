import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentDeploymentBrain } from '../src/deployment/brain.js';
import { AtmosphereTracker } from '../src/scene/atmosphere.js';

// Audit D12: observeScene passed a free-text atmosphere string into the dimension tracker,
// throwing `Cannot use 'in' operator ... in Ash and rain`.

test('observeScene accepts free-text atmosphere without inventing dimensions', () => {
  const brain = new DevelopmentDeploymentBrain();
  const signal = brain.observeScene({ chatId: 'chat:atm', sourceRevisionId: 'src:atm:1', location: 'Ember Tavern', atmosphere: 'Ash and rain' });
  const scene = brain.scene.registry.current(signal.sceneId);
  const atm = scene.fields.atmosphere;
  assert.ok(atm, 'atmosphere field recorded');
  assert.deepEqual(atm.value, {}, 'free text must not become numeric dimensions');
  assert.equal(atm.observationClass, 'UNKNOWN');
  assert.equal(atm.metadata?.description, 'Ash and rain');
});

test('observeScene keeps documented dimension maps as INFERRED dimensions', () => {
  const brain = new DevelopmentDeploymentBrain();
  const signal = brain.observeScene({ chatId: 'chat:atm2', sourceRevisionId: 'src:atm:2', location: 'Ember Tavern', atmosphere: { tension: { score: .7, confidence: .8 } } });
  const atm = brain.scene.registry.current(signal.sceneId).fields.atmosphere;
  assert.equal(atm.observationClass, 'INFERRED');
  assert.equal(atm.value.tension.score, .7);
});

test('AtmosphereTracker rejects non-object dimension input explicitly', () => {
  const t = new AtmosphereTracker();
  for (const bad of ['Ash and rain', 42, ['tension']]) {
    const f = t.update({ revision: 1, evidenceRefs: ['e'], dimensions: bad });
    assert.deepEqual(f.value, {});
    assert.equal(f.observationClass, 'UNKNOWN');
    assert.equal(f.metadata?.rejectedDimensionInput, true);
  }
});
