// Cap remediation, cap ledger row 48 (owner handoff "Memory Summary / Hierarchy"). SESSION and ARC summary scopes used
// to list every current episode of the chat; the 513th completed turn exceeded the 512-entry scope bound, threw after the
// episode was published, and every later turn lost its summary, reflections and vector work. Contract now: pages of at
// most 256 episodes per SCENE page and 256 scene pages per SESSION page, ARC over session pages; every episode stays
// reachable (summary evidence covers all of them) and no completed turn fails because of chat length.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentDeploymentBrain } from '../src/deployment/brain.js';

function turn(brain, chatId, i, sceneId) {
  const sourceRevisionId = `msg${i}@r1`;
  const ownerArtifactRef = { kind: 'ArtifactReference', contractVersion: '1.0.0', artifactId: `native:${i}`, artifactType: 'NativeExperience', owner: 'NATIVE_BRAIN', revision: 1, storageDomain: 'artifacts', sourceRevisionSet: [sourceRevisionId], sourceRevisionRefs: [sourceRevisionId], worldRevision: 1, sceneRevision: 1, contentHash: 'h' + i, sliceSelector: null, provenanceRef: null, expiry: null, authorityGranted: false, settlementAuthority: false, contextSealBypass: false, provenance: ['t'] };
  const externalEvidenceRef = `memory-evidence:${i}`;
  brain.memory.admitExternalEvidenceMapping({ kind: 'MemoryExternalEvidenceMappingRequest', contractVersion: '1.0.0', ownerArtifactRef, externalEvidenceRef,
    source: { sourceId: `memory-source:${i}`, sourceRevisionId, exactContent: `Turn ${i}: Mara moved the glass compass ${i} to room ${i % 17}.`, evidenceKind: 'NARRATIVE_EXPERIENCE', occurredAt: i + 1, worldRevision: 1, sceneRevision: 1, participants: ['Mara'], knownBy: ['Mara'], perspective: 'WORLD', metadata: { chatId }, provenance: ['t'] },
    revisionProof: { sourceRevisionId, ownerArtifactRevision: 1, worldRevision: 1, sceneRevision: 1 }, provenanceRefs: ['t'] });
  return brain.memory.acceptCompletedTurn({ ownerArtifactRef, externalEvidenceRef, sourceRevisionId, chatId, turnId: `t${i}`, generationId: `g${i}`, correlationId: `c${i}`, sceneId, sceneRevision: 1, worldRevision: 1, contextSealId: 's' + i });
}
function hierarchy(brain) { return brain.memory.summaryHierarchy; }

test('a chat past 512 completed turns keeps completing turns, with every episode reachable from the paged hierarchy', { timeout: 600000 }, () => {
  const brain = new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: false });
  const chatId = 'chat:long';
  const receipts = [];
  for (let i = 0; i < 530; i += 1) receipts.push(turn(brain, chatId, i, 'scene-a'));
  for (const i of [510, 511, 512, 513, 529]) assert.equal(receipts[i].status, 'COMPLETED', 'turn ' + i + ': ' + receipts[i].reasonCode);
  // Pages: 530 episodes of one scene = scene pages p0 (256), p1 (256), p2 (18); one session page; the ARC.
  const last = receipts.at(-1);
  assert.deepEqual(last.summaryScopeRefs, ['SCENE:brain:chat:long:scene-a:p2', 'SESSION:brain:chat:long', 'ARC:brain:chat:long']);
  const h = hierarchy(brain);
  assert.ok(h, 'summary hierarchy reachable');
  const scene0 = h.scope('SCENE:brain:chat:long:scene-a');
  assert.equal(scene0.episodeLogicalIds.length, 256);
  const pages = ['SCENE:brain:chat:long:scene-a', 'SCENE:brain:chat:long:scene-a:p1', 'SCENE:brain:chat:long:scene-a:p2'];
  const covered = new Set(pages.flatMap((ref) => h.scope(ref).episodeLogicalIds));
  assert.equal(covered.size, 530, 'every episode is in exactly one scene page');
  assert.deepEqual(h.scope('SESSION:brain:chat:long').childScopeRefs.sort(), [...pages].sort());
  assert.deepEqual(h.scope('SESSION:brain:chat:long').episodeLogicalIds, [], 'SESSION reaches episodes through its children');
  assert.deepEqual(h.scope('ARC:brain:chat:long').childScopeRefs, ['SESSION:brain:chat:long']);
});

test('a short chat keeps its original scope ids and its SESSION evidence equals the episodes\' evidence', () => {
  const brain = new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: false });
  const receipts = [];
  for (let i = 0; i < 12; i += 1) receipts.push(turn(brain, 'chat:short', i, i < 6 ? 'scene-a' : 'scene-b'));
  assert.ok(receipts.every((row) => row.status === 'COMPLETED'));
  assert.deepEqual(receipts.at(-1).summaryScopeRefs, ['SCENE:brain:chat:short:scene-b', 'SESSION:brain:chat:short', 'ARC:brain:chat:short']);
  const h = hierarchy(brain);
  // Compile bottom-up and check the SESSION summary is grounded in all twelve episodes' evidence.
  for (let i = 0; i < 20 && h.pendingWork().length; i += 1) brain.memory.runSummaryCompaction({ maxUnits: 8 });
  const session = h.currentArtifact('SESSION:brain:chat:short', { freshOnly: false });
  assert.ok(session, "SESSION summary compiled");
  assert.equal(new Set(session.exactEvidenceRefs).size, 12);
});
