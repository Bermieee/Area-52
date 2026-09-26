import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('SillyTavern manifest preserves one-resource install and supported update checks', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.display_name, 'Area-52 Development Deployment');
  assert.equal(manifest.homePage, 'https://github.com/Bermieee/Area-52');
  assert.equal(manifest.auto_update, true);
  assert.deepEqual(manifest.requires, []);
  assert.deepEqual(manifest.optional, []);
  assert.match(manifest.version, /^0\.3\.1-development-deployment$/);
});

test('live adapter never imports the deterministic golden lore fixture', () => {
  const source = readFileSync(new URL('../src/deployment/sillytavern-live.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createGoldenDeploymentLorebook/);
});


test('installed entry auto-starts the SillyTavern turn bridge instead of requiring a hidden manual arm step', () => {
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const createAt = source.indexOf('session = createDevelopmentDeploymentSillyTavernSession');
  const startAt = source.indexOf('session.start();', createAt);
  const renderAt = source.indexOf('renderEvidence(root, session.exportEvidence())', createAt);
  assert.ok(createAt >= 0);
  assert.ok(startAt > createAt, 'installed session must start immediately after creation');
  assert.ok(renderAt > startAt, 'initial installed evidence must be rendered after the live event bridge is active');
});
