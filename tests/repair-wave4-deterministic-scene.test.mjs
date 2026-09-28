// Wave 4 (audit D5): the deterministic Scene extractor may only claim "clear host evidence".
// Weak regex hits must not pre-empt semantic extraction nor be recorded as OBSERVED at confidence 1.
// Synthetic lines; FAKE-HOST evidence only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDevelopmentDeploymentScene } from '../src/deployment/sillytavern-live.js';

const parse = (text) => extractDevelopmentDeploymentScene(text, { revision: 2, evidenceRef: 'ev' });
const loc = (r) => r.fields.location ?? null;

test('clear host evidence still takes the deterministic owner path as OBSERVED', () => {
  for (const text of ['At North Gallery, Mara waits near marker one.', 'We arrive at South Courtyard.', 'Inside The Gilded Lantern, music spills over the crowd.']) {
    const r = parse(text);
    assert.equal(r.explicit, true, text);
    assert.equal(loc(r).observationClass, 'OBSERVED', text);
    assert.equal(loc(r).confidence, 1, text);
  }
  assert.equal(parse('Lyra steps in, shaking snow from her cloak.').explicit, true);
  assert.equal(parse('Years earlier, at Old Hall, Mara waited.').explicit, true);
});

test('mid-sentence prepositions before a name do not pre-empt semantic extraction or record OBSERVED locations', () => {
  for (const text of ['Mara glances at Eris and sets down her rag.', 'I look at Kael, waiting for an answer.', 'I sit near Tomas and keep my voice low.', 'He smiles at Anya, then turns back to the map.', 'I stare at The Map for a long moment.']) {
    const r = parse(text);
    assert.equal(r.explicit, false, 'must be left to semantic extraction: ' + text);
    const l = loc(r);
    assert.ok(!l || (l.observationClass !== 'OBSERVED' && l.confidence < 1), 'no OBSERVED@1 location from: ' + text);
    assert.ok(!/\b(and|of|the)$/i.test(l?.value?.location ?? ''), 'no dangling connector: ' + JSON.stringify(l?.value));
  }
});

test('time-of-day words are not locations', () => {
  const r = parse('At Dawn, the bells of Saint Veyra ring out over the harbor.');
  assert.equal(loc(r), null);
});

test('atmosphere-only and prefetch-only lines are not clear scene evidence', () => {
  for (const text of ['Eris laughs and slides a coin across the counter.', 'Her hand trembles; the tension in the room is unbearable.', 'We will head to the Silver Keep tomorrow.']) {
    assert.equal(parse(text).explicit, false, text);
  }
});

test('installed path: a weak-evidence line schedules the Sidecar instead of being pre-empted', async () => {
  const { EV, makeInstalled } = await import('./helpers/installed-host.mjs');
  const h = makeInstalled({ chatId: 'chat:w4d5' });
  h.session.brain.resourceConnections.fetchImpl = async (url) => {
    if (String(url).endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'glm-mock' }] }) };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: 'glm-mock', choices: [{ message: { content: '{"fields":{},"boundarySignals":{}}' }, finish_reason: 'stop' }], usage: {} }) };
  };
  h.session.brain.optionalResources.actions.addResource({ resourceId: 'glm', kind: 'OPENAI_COMPATIBLE', endpoint: 'https://glm.invalid', modelId: 'glm-mock', apiKey: 'k', capabilities: ['STRUCTURED_EXTRACTION'] });
  await h.session.brain.optionalResources.actions.connectResource('glm');
  h.user('I look at Kael, waiting for an answer.');
  await h.emit(EV.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
  const receipts = h.session.brain.readSceneObservationReceipts({ limit: 32 });
  assert.ok(receipts.some((r) => r.phase === 'FOREGROUND_USER' && ['QUEUED', 'RETURNED'].includes(r.status)), 'Sidecar work scheduled: ' + JSON.stringify(receipts.map((r) => r.phase + '/' + r.status)));
  h.session.destroy();
});
