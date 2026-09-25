import test from 'node:test';
import assert from 'node:assert/strict';
import {runKnowledgeWave5Stress} from './knowledge-wave5-stress-harness.js';

test('Wave 5 Knowledge Integration stress meets requested minimums and invariants',()=>{
  const r=runKnowledgeWave5Stress();
  assert.equal(r.pass,true,JSON.stringify(r,null,2));
  assert.ok(r.counts.knowledgeEvidenceValidations>=10000);
  assert.ok(r.counts.mixedLoreMemoryEvidenceSets>=5000);
  assert.ok(r.counts.revisionFreshnessChecks>=5000);
  assert.ok(r.counts.provenanceReconstructions>=2000);
  assert.ok(r.counts.dependencyInvalidationReceipts>=2000);
  assert.ok(r.counts.ft003MixedMemoryCases>=2000);
  assert.ok(r.counts.ft004LoreCases>=2000);
  assert.ok(r.counts.crossSourceContradictionSets>=1000);
  assert.ok(r.counts.contextCompilerMixedAuthorityPackets>=1000);
  assert.ok(r.counts.nexusShadowReplayObservations>=1000);
  assert.ok(r.counts.assemblyManifestEvaluations>=500);
});
