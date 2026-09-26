import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';
import {LoreAuthoringService} from '../src/lore-authoring-service.js';

const PER_BOOK = 120;

function stressBook(id, prefix, side) {
  return {
    id,
    title: id,
    discovery: {kind: 'Wave7Stress', stableId: 'wave7-' + id},
    entries: Array.from({length: PER_BOOK}, (_, index) => {
      let content;
      if (index % 30 === 0) {
        content = 'Shared Person ' + index + ' knows Common Friend ' + index + '.';
      } else if (index % 40 === 0) {
        content = 'Relic ' + index + ' is ' + (side === 'A' ? 'intact' : 'destroyed') + '.';
      } else {
        content = 'Shared Person ' + index + ' knows ' + prefix + ' Friend ' + index + '.';
      }
      return {
        uid: 'entry-' + index,
        content,
        metadata: {title: 'Shared Person ' + index, treePath: [prefix, 'People'], order: index},
      };
    }),
    fullSnapshot: true,
  };
}

const intelligence0 = new LoreIntelligenceService();
const studyStart = performance.now();
intelligence0.acceptLorebook(stressBook('wave7-stress-a', 'Alpha', 'A'));
intelligence0.acceptLorebook(stressBook('wave7-stress-b', 'Beta', 'B'));
intelligence0.runStudy();
const initialStudyMs = performance.now() - studyStart;
assert.equal(intelligence0.status().entries.length, PER_BOOK * 2);
assert.equal(intelligence0.status().entries.every((row) => row.operatorState === 'READY'), true);

let intelligence = intelligence0;
let authoring = new LoreAuthoringService({intelligence});
const buildStart = performance.now();
const started = authoring.startMergeBuild({
  lorebookIds: ['wave7-stress-a', 'wave7-stress-b'],
  outputLorebookId: 'wave7-stress-merged',
  outputTitle: 'Wave 7 Stress Merged',
});
let progress = authoring.authoringProgress(started.sessionId);
let buildCheckpoints = 0;
while (progress.stage === 'BUILDING' || progress.stage === 'CHECKPOINTED') {
  authoring.resumeAuthoringBuild({sessionId: started.sessionId, maxActions: 37});
  buildCheckpoints += 1;
  progress = authoring.authoringProgress(started.sessionId);
}
const buildMs = performance.now() - buildStart;
assert.equal(progress.stage, 'DRAFT_REVIEW');

const reviewStart = performance.now();
const draft = authoring.draftReview({sessionId: started.sessionId});
for (const [index, action] of draft.actions.entries()) {
  authoring.recordDraftDecision({
    sessionId: started.sessionId,
    actionId: action.id,
    decision: 'ACCEPT',
    operatorDecisionId: 'wave7-stress-decision-' + index,
  });
}
const reviewMs = performance.now() - reviewStart;

const finalStart = performance.now();
const finalPreview = authoring.computeFinalPreview({sessionId: started.sessionId});
assert.equal(finalPreview.validation.ok, true);
authoring.approveFinalPreview({
  sessionId: started.sessionId,
  operatorApprovalId: 'wave7-stress-final-approval',
});
const finalPreviewMs = performance.now() - finalStart;

const settlementStart = performance.now();
let settlement = authoring.applySettlement({sessionId: started.sessionId, maxOperations: 41});
assert.equal(settlement.state, 'CHECKPOINTED');
const firstCheckpointCursor = settlement.cursor;

intelligence = LoreIntelligenceService.fromSnapshot(intelligence.snapshot());
authoring = LoreAuthoringService.fromSnapshot(authoring.snapshot(), {intelligence});
let settlementBatches = 1;
while (settlement.state !== 'SETTLED') {
  settlement = authoring.applySettlement({sessionId: started.sessionId, maxOperations: 41});
  settlementBatches += 1;
}
const settlementMs = performance.now() - settlementStart;

const outputSources = intelligence.runtime.registry.listEntries({includeRemoved: false})
  .filter((source) => source.lorebookId === 'wave7-stress-merged');
assert.equal(outputSources.length, finalPreview.output.entries.length);
assert.equal(intelligence.runtime.dueObligations().length, outputSources.length);
assert.equal(intelligence.runtime.dueObligations().every((row) => row.trigger === 'NEW_UID'), true);
assert.equal(settlement.receipts.length, outputSources.length);
assert.equal(settlement.receipts.length, new Set(settlement.receipts.map((row) => row.operationId)).size);
assert.equal(settlement.revisionEvents.length, outputSources.length);
assert.equal(settlement.invalidationReceipts.every((row) => row.unrelatedSourcesInvalidated === false), true);

for (const source of intelligence.runtime.registry.listEntries({includeRemoved: false})
  .filter((row) => ['wave7-stress-a', 'wave7-stress-b'].includes(row.lorebookId))) {
  assert.equal(intelligence.runtime.registry.currentRevision(source.sourceId).revision, 1);
}

console.log('LORE_WAVE7_STRESS ' + JSON.stringify({
  pass: true,
  inputSources: PER_BOOK * 2,
  crossBookPairs: PER_BOOK * PER_BOOK,
  exactDuplicateOutputsConsolidated: (PER_BOOK * 2) - outputSources.length,
  contradictionsRemainSeparate: finalPreview.output.contradictionsRemainSeparate,
  outputEntries: outputSources.length,
  buildActions: draft.actions.length,
  buildCheckpoints,
  firstSettlementCheckpointCursor: firstCheckpointCursor,
  settlementBatches,
  studyAndRepresentMs: Number(initialStudyMs.toFixed(2)),
  reviewBuildMs: Number(buildMs.toFixed(2)),
  decisionReviewMs: Number(reviewMs.toFixed(2)),
  finalPreviewMs: Number(finalPreviewMs.toFixed(2)),
  settlementMs: Number(settlementMs.toFixed(2)),
  dueStudyObligations: intelligence.runtime.dueObligations().length,
  duplicateSettlementReceipts: settlement.receipts.length - new Set(settlement.receipts.map((row) => row.operationId)).size,
  originalInputRevisionChanges: intelligence.runtime.registry.listEntries({includeRemoved: false})
    .filter((row) => ['wave7-stress-a', 'wave7-stress-b'].includes(row.lorebookId))
    .filter((row) => intelligence.runtime.registry.currentRevision(row.sourceId).revision !== 1).length,
}));
