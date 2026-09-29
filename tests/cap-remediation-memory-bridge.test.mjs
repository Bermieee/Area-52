// Cap remediation, cap ledger row 54 (owner handoff "External Memory Evidence"). A reply longer than ~32K characters made
// the bridge throw MEMORY_BRIDGE_RAW_INPUT_LIMIT_EXCEEDED after it had appended the evidence and retired the prior mapping
// (STALE, replacedByMappingId 'pending'). Contract now: the exact content is admitted in full; only the diagnostic audit
// copy is bounded (content-addressed stubs); a re-mapping keeps the bridge consistent; small inputs keep an exact copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentDeploymentBrain } from '../src/deployment/brain.js';
import { MEMORY_LIMITS } from '../src/memory-contracts.js';

function map(brain, { i = 0, text, revision = 1 }) {
  const sourceRevisionId = `msg${i}@r${revision}`;
  const ownerArtifactRef = { kind: 'ArtifactReference', contractVersion: '1.0.0', artifactId: `native:${i}`, artifactType: 'NativeExperience', owner: 'NATIVE_BRAIN', revision, storageDomain: 'artifacts', sourceRevisionSet: [sourceRevisionId], sourceRevisionRefs: [sourceRevisionId], worldRevision: 1, sceneRevision: 1, contentHash: 'h' + i + ':' + revision, sliceSelector: null, provenanceRef: null, expiry: null, authorityGranted: false, settlementAuthority: false, contextSealBypass: false, provenance: ['t'] };
  const externalEvidenceRef = `memory-evidence:${i}`;
  const mapping = brain.memory.admitExternalEvidenceMapping({ kind: 'MemoryExternalEvidenceMappingRequest', contractVersion: '1.0.0', ownerArtifactRef, externalEvidenceRef,
    source: { sourceId: `memory-source:${i}`, sourceRevisionId, exactContent: text, evidenceKind: 'NARRATIVE_EXPERIENCE', occurredAt: 1, worldRevision: 1, sceneRevision: 1, participants: ['Mara'], knownBy: ['Mara'], perspective: 'WORLD', metadata: { chatId: 'chat:a' }, provenance: ['t'] },
    revisionProof: { sourceRevisionId, ownerArtifactRevision: revision, worldRevision: 1, sceneRevision: 1 }, provenanceRefs: ['t'] });
  return { mapping, ownerArtifactRef, externalEvidenceRef, sourceRevisionId };
}
const long = (n, tag) => (`Mara walks the long corridor ${tag}. `).repeat(Math.ceil(n / 30)).slice(0, n);

for (const n of [MEMORY_LIMITS.maxExternalRawInputCharacters - 2000, MEMORY_LIMITS.maxExternalRawInputCharacters, MEMORY_LIMITS.maxExternalRawInputCharacters + 1, 2 * MEMORY_LIMITS.maxExternalRawInputCharacters, 200000]) {
  test(`a ${n}-character reply is admitted with its exact content and completes the turn`, () => {
    const brain = new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: false });
    const text = long(n, 'A');
    const { mapping, ownerArtifactRef, externalEvidenceRef, sourceRevisionId } = map(brain, { text });
    assert.equal(mapping.status, 'ADMITTED');
    const evidence = brain.memory.graph.evidenceRecord(mapping.memoryEvidenceId);
    assert.equal(evidence.exactContent, text, 'exact content kept in full');
    const done = brain.memory.acceptCompletedTurn({ ownerArtifactRef, externalEvidenceRef, sourceRevisionId, chatId: 'chat:a', turnId: 't0', generationId: 'g0', correlationId: 'c0', sceneId: 's', sceneRevision: 1, worldRevision: 1, contextSealId: 'seal' });
    assert.equal(done.status, 'COMPLETED');
    const stored = [...brain.memory.evidenceBridge.mappings.values()].find((row) => row.id === mapping.mappingId);
    assert.ok(JSON.stringify(stored.rawOwnerInput).length <= MEMORY_LIMITS.maxExternalRawInputCharacters + 512, 'audit copy bounded');
  });
}

test('a small input keeps an exact audit copy; re-mapping a long reply keeps the bridge consistent', () => {
  const brain = new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: false });
  const small = map(brain, { i: 1, text: 'Mara lit the lamp.' });
  const smallRow = brain.memory.evidenceBridge.mappings.get(small.mapping.mappingId);
  assert.equal(smallRow.rawOwnerInput.source.exactContent, 'Mara lit the lamp.');
  const first = map(brain, { i: 2, text: long(50000, 'A') });
  const second = map(brain, { i: 2, text: long(50000, 'B'), revision: 2 });
  assert.equal(second.mapping.status, 'ADMITTED');
  const firstRow = brain.memory.evidenceBridge.mappings.get(first.mapping.mappingId);
  assert.equal(firstRow.state, 'HISTORICAL');
  assert.equal(firstRow.replacedByMappingId, second.mapping.mappingId, 'no dangling "pending" replacement');
  const a = brain.memory.evidenceBridge.mappings.get(second.mapping.mappingId).rawOwnerInput;
  assert.notEqual(JSON.stringify(a), JSON.stringify(firstRow.rawOwnerInput), 'different content, different audit stubs');
});
