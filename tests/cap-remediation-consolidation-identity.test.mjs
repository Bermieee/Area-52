// Cap remediation, cap ledger row 63. A consolidation proposal without an explicit semantic identity got one from the
// first 256 characters of its claim (or 512 of its payload), so two different long claims sharing that prefix were
// deduplicated as the same claim. Contract: within the bound the identity is unchanged; past it, different values get
// different identities and equal values the same one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsolidationProposal, ConsolidationProposalKind } from '../src/coprocessor/continuous-consolidation.js';

const artifact = { kind: 'ArtifactReference', artifactId: 'episode:1', artifactType: 'SceneEpisode', owner: 'SCENE_INTELLIGENCE', revision: 1, storageDomain: 'episodes', provenanceRef: 'prov:episode:1' };
const make = (hypotheses) => createConsolidationProposal({ proposalKind: ConsolidationProposalKind.CROSS_EPISODE_LINK, sourceArtifactRefs: [artifact], confidence: 0.4, authority: 'UNRESOLVED', payload: { hypotheses, causalCertainty: 'UNRESOLVED' } }, { sourceRevisionSet: ['src:1'], worldRevision: 1, sceneRevision: 1, characterStateRevision: 1 });

test('short payloads keep their exact identity', () => {
  const p = make(['Mara hid the key']);
  assert.ok(!p.semanticIdentity.includes('#'));
});

test('long payloads that share a 512-character prefix get different identities', () => {
  const prefix = 'The long account of the night the harbor burned and everyone ran. '.repeat(10);
  const a = make([prefix + 'Mara hid the key to protect Eris.']);
  const b = make([prefix + 'Mara hid the key for leverage.']);
  const c = make([prefix + 'Mara hid the key to protect Eris.']);
  assert.notEqual(a.semanticIdentity, b.semanticIdentity);
  assert.equal(a.semanticIdentity, c.semanticIdentity);
});
