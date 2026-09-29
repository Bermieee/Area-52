// Cap remediation, cap ledger row 55 (owner handoff "External Mapping / Event Retention"). The bridge journals refused new
// entries at fixed counts: the 33rd edit of one message, or the 8,193rd mapping of a chat, threw permanently, and owner
// events were REJECTED past 4,096. Contract: lineage is kept (no refusals); past the counts, only the diagnostic audit copy
// of older HISTORICAL entries is compacted; the current mapping and the replacement chain stay intact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentDeploymentBrain } from '../src/deployment/brain.js';
import { MEMORY_LIMITS } from '../src/memory-contracts.js';

function map(brain, revision) {
  const sourceRevisionId = `msg0@r${revision}`;
  const ownerArtifactRef = { kind: 'ArtifactReference', contractVersion: '1.0.0', artifactId: 'native:0', artifactType: 'NativeExperience', owner: 'NATIVE_BRAIN', revision, storageDomain: 'artifacts', sourceRevisionSet: [sourceRevisionId], sourceRevisionRefs: [sourceRevisionId], worldRevision: 1, sceneRevision: 1, contentHash: 'h:' + revision, sliceSelector: null, provenanceRef: null, expiry: null, authorityGranted: false, settlementAuthority: false, contextSealBypass: false, provenance: ['t'] };
  return brain.memory.admitExternalEvidenceMapping({ kind: 'MemoryExternalEvidenceMappingRequest', contractVersion: '1.0.0', ownerArtifactRef, externalEvidenceRef: 'memory-evidence:0',
    source: { sourceId: 'memory-source:0', sourceRevisionId, exactContent: 'Edit ' + revision + ' of the same message.', evidenceKind: 'NARRATIVE_EXPERIENCE', occurredAt: 1, worldRevision: 1, sceneRevision: 1, participants: ['Mara'], knownBy: ['Mara'], perspective: 'WORLD', metadata: { chatId: 'chat:a' }, provenance: ['t'] },
    revisionProof: { sourceRevisionId, ownerArtifactRevision: revision, worldRevision: 1, sceneRevision: 1 }, provenanceRefs: ['t'] });
}

test('one message edited past the per-identity history count keeps mapping, with an intact lineage', () => {
  const brain = new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: false });
  const limit = MEMORY_LIMITS.maxExternalMappingHistoryPerIdentity;
  const receipts = [];
  for (let r = 1; r <= 2 * limit + 3; r += 1) receipts.push(map(brain, r));
  assert.ok(receipts.every((row) => row.status === 'ADMITTED'), 'no refusal at ' + (limit + 1));
  const bridge = brain.memory.evidenceBridge;
  const ids = [...bridge.historyByIdentity.values()][0];
  assert.equal(ids.length, 2 * limit + 3, 'the whole lineage is kept');
  const rows = ids.map((id) => bridge.mappings.get(id));
  assert.equal(rows.at(-1).state, 'CURRENT');
  assert.ok(rows.slice(0, -1).every((row, i) => row.replacedByMappingId === rows[i + 1].id), 'replacement chain intact');
  const compacted = rows.filter((row) => row.rawOwnerInput?.$area52Elided === 'COMPACTED_HISTORY');
  assert.equal(compacted.length, ids.length - limit, 'only the oldest audit copies are compacted');
  assert.ok(rows.at(-1).rawOwnerInput.source, 'the current mapping keeps its audit copy');
});
