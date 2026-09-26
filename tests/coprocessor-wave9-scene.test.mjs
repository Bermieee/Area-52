import test from 'node:test';
import assert from 'node:assert/strict';
import { JevDecisionCore, createJevDomainAdapterMatrix } from '../src/coprocessor/index.js';
import { currentFor, output, providerExecutor, sceneBoundary } from './wave9-fixtures.mjs';

function matrix(handler) { return createJevDomainAdapterMatrix({ core: new JevDecisionCore({ providerExecutor: handler ? providerExecutor(handler) : null }) }); }

test('Scene doorway with no real boundary deterministically continues and skips Jev', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output() }; });
  const input = sceneBoundary('scene-doorway', { boundarySignals: { doorwayOnly: true, realLocationChange: false, majorTimeShift: false, flashbackAmbiguous: false } });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 0);
  assert.equal(proposal.proposedOutcome, 'CONTINUE_SCENE');
  assert.equal(proposal.path, 'DETERMINISTIC');
});

test('Scene observed real location change may deterministically open new Scene', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output() }; });
  const input = sceneBoundary('scene-location', { boundarySignals: { realLocationChange: true, observed: true, flashbackAmbiguous: false } });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 0);
  assert.equal(proposal.proposedOutcome, 'OPEN_NEW_SCENE');
  assert.equal(proposal.details.createSceneRevision, false);
});

test('Scene ambiguous flashback/resume invokes shared Jev and remains owner proposal', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output({ selected: ['RESUME_PRIOR_SCENE'], rejected: ['CONTINUE_SCENE', 'OPEN_NEW_SCENE', 'UNRESOLVED'], evidenceUsed: ['scene:a', 'scene:b'] }) }; });
  const input = sceneBoundary('scene-flashback');
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 1);
  assert.equal(proposal.proposedOutcome, 'RESUME_PRIOR_SCENE');
  assert.equal(proposal.requiresOwnerPolicy, true);
  assert.equal(proposal.details.createSceneRevision, false);
});

test('Scene MENTIONED_ONLY character cannot become PRESENT through Jev', async () => {
  let calls = 0;
  const m = matrix(() => { calls += 1; return { payload: output() }; });
  const input = sceneBoundary('scene-mentioned', {
    mentionedOnlyRefs: ['char:eris'],
    options: [
      { optionId: 'CONTINUE_SCENE', evidenceRefs: ['scene:a'] },
      { optionId: 'OPEN_NEW_SCENE', evidenceRefs: ['scene:b'], payload: { presenceClaims: [{ characterRef: 'char:eris', status: 'PRESENT' }] } },
    ],
  });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(calls, 0);
  assert.equal(proposal.proposedOutcome, 'CONTINUE_SCENE');
  assert.equal(proposal.details.mentionedOnlyPromoted, false);
});

test('Scene inferred location cannot be upgraded to OBSERVED by Jev', async () => {
  const m = matrix(() => ({ payload: output() }));
  const input = sceneBoundary('scene-inferred', {
    inferredLocationRefs: ['loc:ember'],
    options: [
      { optionId: 'CONTINUE_SCENE', evidenceRefs: ['scene:a'] },
      { optionId: 'OPEN_NEW_SCENE', evidenceRefs: ['scene:b'], payload: { locationClaim: { locationRef: 'loc:ember', status: 'OBSERVED' } } },
    ],
  });
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(proposal.proposedOutcome, 'CONTINUE_SCENE');
  assert.equal(proposal.details.inferredLocationPromoted, false);
});

test('Scene competing cast/location interpretations may remain unresolved and preserve accepted Scene state', async () => {
  const m = matrix(() => ({ payload: output({ outcome: 'ABSTAINED', decisionCode: 'ABSTAIN', selected: [], rejected: [], evidenceUsed: ['scene:a', 'scene:b'], confidence: .2, abstained: true }) }));
  const input = sceneBoundary('scene-abstain');
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input) });
  assert.equal(proposal.proposedOutcome, 'UNRESOLVED');
  assert.equal(proposal.abstained, true);
  assert.equal(proposal.details.preserveCurrentScene, true);
});

test('Scene stale revision is rejected before owner interpretation', async () => {
  const m = matrix(() => ({ payload: output({ selected: ['CONTINUE_SCENE'], rejected: ['OPEN_NEW_SCENE', 'RESUME_PRIOR_SCENE', 'UNRESOLVED'], evidenceUsed: ['scene:a'] }) }));
  const input = sceneBoundary('scene-stale');
  const proposal = await m.service.adjudicate(input, { currentRevisionState: currentFor(input, { sceneRevision: 6, domainRevisions: { scene: 6, owner: 2 } }) });
  assert.equal(proposal.staleState, 'STALE');
  assert.equal(proposal.proposedOutcome, 'UNRESOLVED');
  assert.equal(proposal.details.preserveCurrentScene, true);
});