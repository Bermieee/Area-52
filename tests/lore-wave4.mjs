import test from 'node:test';
import assert from 'node:assert/strict';

import {LoreStudyEngine} from '../src/lore-study-engine.js';
import {LoreStudyRuntime} from '../src/lore-study-runtime.js';
import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';

function harborBook() {
  return {
    id: 'st-world-harbor',
    title: 'Harbor Chronicle',
    discovery: {
      kind: 'SillyTavernCurrentLorebook',
      source: 'WORLD_INFO',
      name: 'Harbor Chronicle',
    },
    metadata: {storyId: 'story-harbor'},
    entries: [
      {
        uid: 'captain-mira',
        content: 'Captain Mira owns the Harbor Lantern. Captain Mira knows Archivist Sol. A witness reports that the Tideglass was removed before the fire.',
        metadata: {
          title: 'Captain Mira',
          treePath: ['People', 'Harbor'],
          order: 10,
          sillyTavernPosition: 'before_char',
        },
      },
      {
        uid: 'harbor-rule',
        content: 'Only members of the Lantern Guild may enter the Harbor Vault. The Harbor Vault is ancient.',
        metadata: {
          title: 'Harbor Vault',
          treePath: ['Places', 'Harbor'],
          order: 20,
        },
      },
    ],
    fullSnapshot: true,
  };
}

function moonBook() {
  return {
    id: 'st-world-moon',
    title: 'Moon Archive',
    discovery: {
      kind: 'SillyTavernCurrentLorebook',
      source: 'WORLD_INFO',
      name: 'Moon Archive',
    },
    metadata: {storyId: 'story-moon'},
    entries: [
      {
        uid: 'scholar-neri',
        content: 'Scholar Neri owns the Moon Archive. Scholar Neri carries the Star Key. The Star Key is silver.',
        metadata: {
          title: 'Scholar Neri',
          treePath: ['People', 'Moon Archive'],
          order: 1,
          sillyTavernPosition: 'after_char',
        },
      },
    ],
    fullSnapshot: true,
  };
}

test('accepts exact discovered SillyTavern lore, preserves metadata, studies two unrelated books, and publishes broad/detail Brain retrieval', () => {
  const service = new LoreIntelligenceService();

  const harborAccept = service.acceptLorebook(harborBook());
  assert.equal(harborAccept.kind, 'LoreSourceAcceptanceReceipt');
  assert.equal(harborAccept.lorebookId, 'st-world-harbor');
  assert.equal(harborAccept.exactSourcePreserved, true);
  assert.equal(harborAccept.status.counts.ACCEPTED, 2);

  const firstRevision = service.runtime.registry.currentRevision('lore:st-world-harbor:captain-mira');
  assert.equal(firstRevision.exactContent, harborBook().entries[0].content);
  assert.deepEqual(firstRevision.metadata.treePath, ['People', 'Harbor']);
  assert.equal(firstRevision.metadata.extra.sillyTavernPosition, 'before_char');

  service.acceptLorebook(moonBook());
  const studied = service.runStudy();
  assert.equal(studied.results.length, 3);
  assert.equal(studied.compilations.length, 3);

  const status = service.status();
  assert.equal(status.counts.READY, 3);
  assert.equal(status.counts.FAILED, 0);
  assert.equal(status.exactSourcePreserved, true);
  assert.equal(status.derivedArtifactsAreCanon, false);

  const ambiguousArtifacts = service.runtime.publicSurface().artifacts.filter((row) => (
    row.sourceId === 'lore:st-world-harbor:captain-mira' && row.unresolved
  ));
  assert.ok(ambiguousArtifacts.length > 0, 'ambiguous report must remain unresolved rather than silently canonized');

  const narrow = service.queryForBrain({query: 'Harbor Lantern', intent: 'NARROW'});
  assert.equal(narrow.kind, 'LoreBrainRetrievalPacket');
  assert.equal(narrow.intent, 'NARROW');
  assert.equal(narrow.desiredProfile, 'HEAVY');
  assert.ok(narrow.nominations.length > 0);
  assert.ok(narrow.nominations.some((row) => row.drillback.some((source) => (
    source.sourceId === 'lore:st-world-harbor:captain-mira'
    && source.exactAuthoredText.includes('Harbor Lantern')
    && source.selectedRepresentation?.profile === 'HEAVY'
  ))));

  const broad = service.queryForBrain({query: 'Moon Archive', intent: 'BROAD'});
  assert.equal(broad.intent, 'BROAD');
  assert.equal(broad.desiredProfile, 'LEAN');
  assert.ok(broad.nominations.length > 0);
  assert.ok(broad.nominations.some((row) => row.nomination.metadata.loreResolution !== 'EXACT_SOURCE'));
  assert.ok(broad.sourceRevisionFence.every((id) => id.includes('@r')));

  const brain = service.brainInterface();
  assert.equal(brain.kind, 'LoreBrainRetrievalInterface');
  assert.equal(brain.query({query: 'Star Key', intent: 'NARROW'}).nominations.length > 0, true);

  const operator = service.operatorInterface();
  assert.equal(operator.kind, 'LoreStudyOperatorHost');
  assert.equal(operator.read.status().counts.READY, 3);
  assert.equal(typeof operator.actions.acceptLorebook, 'function');
  assert.equal(typeof operator.actions.runLoreStudy, 'function');
  assert.equal(typeof operator.actions.retryLoreStudy, 'function');
});

test('source edit produces semantic diff and invalidates only affected source representations', () => {
  const service = new LoreIntelligenceService();
  service.acceptLorebook(harborBook());
  service.acceptLorebook(moonBook());
  service.runStudy();

  const moonBefore = service.status().entries.find((row) => row.sourceId === 'lore:st-world-moon:scholar-neri');
  const harborBefore = service.status().entries.find((row) => row.sourceId === 'lore:st-world-harbor:captain-mira');
  const moonRepresentationIds = moonBefore.representations.map((row) => row.representationRef).sort();
  const harborRepresentationIds = harborBefore.representations.map((row) => row.representationRef).sort();

  const edited = harborBook();
  edited.entries[0] = {
    ...edited.entries[0],
    content: 'Captain Mira formerly owned the Harbor Lantern. Captain Oren owns the Harbor Lantern. Captain Mira knows Archivist Sol.',
  };
  const acceptance = service.acceptLorebook(edited);
  const change = acceptance.changes.find((row) => row.sourceId === 'lore:st-world-harbor:captain-mira');
  assert.equal(change.changed, true);
  assert.notEqual(change.previousSourceRevisionId, change.sourceRevisionId);
  assert.deepEqual(change.invalidatedRepresentationIds.sort(), harborRepresentationIds);

  const afterAccept = service.status();
  assert.equal(afterAccept.entries.find((row) => row.sourceId === 'lore:st-world-harbor:captain-mira').operatorState, 'ACCEPTED');
  assert.equal(afterAccept.entries.find((row) => row.sourceId === 'lore:st-world-moon:scholar-neri').operatorState, 'READY');
  assert.deepEqual(
    afterAccept.entries.find((row) => row.sourceId === 'lore:st-world-moon:scholar-neri').representations.map((row) => row.representationRef).sort(),
    moonRepresentationIds,
  );

  const rerun = service.runStudy();
  const harborCompile = rerun.compilations.find((row) => row.sourceId === 'lore:st-world-harbor:captain-mira');
  assert.ok(harborCompile.semanticDiff.meaningChanged);
  assert.ok(harborCompile.semanticDiff.changed.length > 0 || harborCompile.semanticDiff.addedSemanticIds.length > 0 || harborCompile.semanticDiff.removedSemanticIds.length > 0);

  const ready = service.status().entries.find((row) => row.sourceId === 'lore:st-world-harbor:captain-mira');
  assert.equal(ready.operatorState, 'READY');
  assert.notEqual(ready.sourceRevisionId, harborBefore.sourceRevisionId);
  assert.equal(ready.semanticDiff.meaningChanged, true);
});

test('full SillyTavern snapshot removal retires only removed UID and removes it from Brain retrieval', () => {
  const service = new LoreIntelligenceService();
  service.acceptLorebook(harborBook());
  service.runStudy();

  const next = harborBook();
  next.entries = [next.entries[0]];
  const accepted = service.acceptLorebook(next);
  const removal = accepted.changes.find((row) => row.uid === 'harbor-rule');
  assert.equal(removal.changed, true);
  assert.equal(removal.sourceState, 'REMOVED');

  service.runStudy();
  const removed = service.status().entries.find((row) => row.sourceId === 'lore:st-world-harbor:harbor-rule');
  assert.equal(removed.operatorState, 'REMOVED');
  assert.equal(removed.exactSourceRecoverable, false);

  const packet = service.queryForBrain({query: 'Harbor Vault', intent: 'NARROW'});
  assert.equal(packet.nominations.some((row) => row.drillback.some((source) => source.sourceId === 'lore:st-world-harbor:harbor-rule')), false);

  const history = service.runtime.registry.revisionHistory('lore:st-world-harbor:harbor-rule');
  assert.equal(history[0].exactContent, harborBook().entries[1].content);
  assert.equal(history.at(-1).state, 'REMOVED');
});

test('failed study job is visible, retains safe checkpoint, and can be retried without publishing partial knowledge', () => {
  class FailOnceEngine extends LoreStudyEngine {
    constructor() {
      super();
      this.failed = false;
    }
    step(session) {
      if (!this.failed && session.unitIndex === 2) {
        this.failed = true;
        const error = new Error('injected study worker failure');
        error.code = 'INJECTED_STUDY_FAILURE';
        throw error;
      }
      return super.step(session);
    }
  }

  const runtime = new LoreStudyRuntime({engine: new FailOnceEngine()});
  const service = new LoreIntelligenceService({runtime});
  const book = moonBook();
  service.acceptLorebook(book);

  const first = service.runStudy();
  assert.equal(first.results[0].failed, true);
  assert.equal(first.results[0].obligation.state, 'FAILED');
  assert.equal(first.results[0].error.code, 'INJECTED_STUDY_FAILURE');
  assert.equal(service.runtime.store.currentLearnedRevision('lore:st-world-moon:scholar-neri'), null);
  assert.equal(service.status().entries[0].operatorState, 'FAILED');

  const retry = service.retryStudy({sourceId: 'lore:st-world-moon:scholar-neri'});
  assert.equal(retry.obligation.state, 'CHECKPOINTED');
  assert.equal(retry.obligation.retryCount, 1);

  const second = service.runStudy();
  assert.equal(second.results[0].obligation.state, 'COMPLETED');
  const ready = service.status().entries[0];
  assert.equal(ready.operatorState, 'READY');
  assert.equal(ready.studyAttempts, 2);
  assert.equal(ready.studyError, null);
  assert.ok(ready.representations.length >= 3);
});

test('service refuses invented/default identifiers at the Worker 3 handoff boundary', () => {
  const service = new LoreIntelligenceService();
  assert.throws(
    () => service.acceptLorebook({entries: [{uid: 'x', content: 'The Gate is ancient.'}]}),
    (error) => error.code === 'LORE_DISCOVERY_ID_REQUIRED',
  );
  assert.throws(
    () => service.acceptLorebook({id: 'book', entries: [{content: 'The Gate is ancient.'}]}),
    (error) => error.code === 'LORE_DISCOVERY_UID_REQUIRED',
  );
});


test('checkpointed study survives service snapshot reconstruction and resumes on the same source revision', () => {
  const service = new LoreIntelligenceService();
  service.acceptLorebook(moonBook());
  const partial = service.runStudy({maxUnitsPerObligation: 2, rebuildRetrieval: false});
  assert.equal(partial.results[0].checkpointed, true);
  assert.equal(partial.results[0].obligation.state, 'CHECKPOINTED');

  const snapshot = service.snapshot();
  const restored = LoreIntelligenceService.fromSnapshot(snapshot);
  const before = restored.status().entries[0];
  assert.equal(before.operatorState, 'STUDYING');
  assert.equal(before.sourceRevisionId, 'lore:st-world-moon:scholar-neri@r1');

  const resumed = restored.runStudy();
  assert.equal(resumed.results[0].obligation.state, 'COMPLETED');
  assert.equal(restored.status().entries[0].operatorState, 'READY');
  assert.equal(restored.runtime.registry.currentRevision('lore:st-world-moon:scholar-neri').id, before.sourceRevisionId);
});
