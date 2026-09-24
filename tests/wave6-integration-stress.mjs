import test from 'node:test';
import assert from 'node:assert/strict';
import {runWave6Stress} from './wave6-integration-stress-harness.js';

test('Wave 6 shared-contract/integration stress meets required minimums',()=>{
  const r=runWave6Stress();
  assert.equal(r.pass,true,JSON.stringify(r,null,2));
  assert.ok(r.counts.eventRegistryValidations>=10000);
  assert.ok(r.counts.contractDriftComparisons>=5000);
  assert.ok(r.counts.dependencyStateTransitions>=5000);
  assert.ok(r.counts.integrationRehearsalTurns>=5000);
  assert.ok(r.counts.staleResultCases>=2000);
  assert.ok(r.counts.duplicateEventCases>=2000);
  assert.ok(r.counts.providerFallbackCases>=2000);
  assert.ok(r.counts.assemblyManifestValidations>=2000);
  assert.ok(r.counts.integrationPatchValidations>=1000);
  assert.ok(r.counts.diagnosticReconstructions>=1000);
  assert.ok(r.counts.multiTurnFt006ReplaySequences>=1000);
});
