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


test('installed entry auto-starts the SillyTavern turn bridge without a visible demo arm/disarm harness', () => {
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const createAt = source.indexOf('session = createDevelopmentDeploymentSillyTavernSession');
  const startAt = source.indexOf('session.start();', createAt);
  const contractAt = source.indexOf('installProgrammaticContract();', startAt);
  assert.ok(createAt >= 0);
  assert.ok(startAt > createAt, 'installed session must start immediately after creation');
  assert.ok(contractAt > startAt, 'programmatic host controls must be published only after bridge startup is attempted');
  assert.doesNotMatch(source, /renderEvidence\s*\(/);
  assert.doesNotMatch(source, /Arm\s*\/\s*Disarm|Disarm\s*\/\s*Arm/i);
});
