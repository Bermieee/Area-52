import assert from 'node:assert/strict';
import { DevelopmentDeploymentBrain, createGoldenDeploymentLorebook } from '../src/deployment/index.js';

function prepare({ resourceCount = 1, jevAvailable = true, chatId = 'chat:deployment-demo' } = {}) {
  const brain = new DevelopmentDeploymentBrain({ resourceCount, jevAvailable });
  brain.ingestLorebook(createGoldenDeploymentLorebook());
  const refs = brain.core.registry.activeRevisionIds();

  const before = brain.observeScene({
    chatId,
    sourceRevisionId: refs[0],
    location: 'Ember Tavern',
    activeCast: ['Mara', 'Eris'],
    activeThreads: ['Find the Sun Blade'],
    objects: [{ objectId: 'Sun Blade', state: 'PRESENT', evidenceRefs: [refs[0]] }],
  });
  const after = brain.observeScene({
    chatId,
    sourceRevisionId: refs[1] ?? refs[0],
    location: 'Ember Tavern Ruins',
    activeCast: ['Mara', 'Eris'],
    activeThreads: ['Determine the Sun Blade fate'],
    objects: [{ objectId: 'Sun Blade', state: 'UNCERTAIN', evidenceRefs: [refs[1] ?? refs[0]] }],
    atmosphere: 'Ash and rain',
  });

  assert.equal(before.observationApplied, true);
  assert.equal(after.observationApplied, true);
  assert.ok(after.sceneRevision > before.sceneRevision);
  assert.equal(after.delta.toRevision, after.sceneRevision);
  assert.ok(after.delta.changedFields.location);

  return { brain, chatId, before, after };
}

function packetCounts(packet = {}) {
  return {
    current: packet.current?.length ?? 0,
    historical: packet.historical?.length ?? 0,
    unresolved: packet.unresolved?.length ?? 0,
    inferred: packet.inferred?.length ?? 0,
    derived: packet.derived?.length ?? 0,
  };
}

function summarize(brain, result) {
  const choice = result.published.cognitiveChoiceReceipt ?? {};
  const seal = brain.core.publication.seal.verify(result.turn.turnId);
  return {
    turnId: result.turn.turnId,
    generationId: result.selection.generationId,
    jobs: result.scatter.jobs.map((row) => ({
      taskType: row.taskType,
      resultClass: row.resultClass,
      capability: row.capability,
    })),
    resources: {
      count: result.scatter.resourceCount,
      ids: result.scatter.resourceIds,
    },
    cognitiveChoice: {
      paths: choice.paths ?? [],
      jev: choice.jev ?? null,
    },
    candidateCount: result.published.candidates?.length ?? 0,
    packet: packetCounts(result.published.packet),
    gather: {
      closedForForeground: result.published.gatherReceipt?.closedForForeground ?? false,
      includedResultCount: result.published.gatherReceipt?.includedResultCount ?? null,
      omittedResultCount: result.published.gatherReceipt?.omittedResultCount ?? null,
    },
    jev: result.jevProposal ? {
      status: result.jevProposal.status,
      abstained: result.jevProposal.abstained,
      unresolved: result.jevProposal.unresolved,
      mutationAuthority: result.jevProposal.mutationAuthority,
      requiresOwnerPolicy: result.jevProposal.requiresOwnerPolicy,
    } : null,
    seal: {
      sealed: seal.sealed,
      hashMatches: seal.hashMatches,
    },
    promptPlan: {
      generationId: result.delivery.plan?.generationId ?? null,
      ok: result.delivery.ok,
    },
  };
}

const live = prepare({ resourceCount: 1, jevAvailable: true });

const simple = await live.brain.runTurn({
  chatId: live.chatId,
  turnId: 'demo:simple',
  generationId: 'demo-gen:simple',
  query: 'Where are we?',
  mode: 'simple',
});
assert.equal(simple.scatter.jobs.length, 0);
assert.equal(simple.delivery.ok, true);

const retrieval = await live.brain.runTurn({
  chatId: live.chatId,
  turnId: 'demo:retrieval',
  generationId: 'demo-gen:retrieval',
  query: 'Tell me about Mara and the Ember Tavern history',
  mode: 'retrieval',
});
assert.equal(retrieval.scatter.resourceCount, 1);
assert.ok(retrieval.published.candidates.length > 0);
assert.equal(retrieval.published.gatherReceipt.closedForForeground, true);
assert.equal(retrieval.delivery.ok, true);

const ambiguous = await live.brain.runTurn({
  chatId: live.chatId,
  turnId: 'demo:ambiguous',
  generationId: 'demo-gen:ambiguous',
  query: 'What happened to the Sun Blade?',
  mode: 'ambiguous',
});
assert.ok(ambiguous.jevProposal);
assert.equal(ambiguous.jevProposal.abstained, true);
assert.equal(ambiguous.jevProposal.mutationAuthority, false);
assert.ok(ambiguous.published.packet.unresolved.length > 0);
assert.equal(ambiguous.delivery.ok, true, JSON.stringify({ status: ambiguous.delivery.status, failure: ambiguous.delivery.failure, integrityReceipt: ambiguous.delivery.integrityReceipt }, null, 2));

const degraded = prepare({ resourceCount: 1, jevAvailable: false, chatId: 'chat:deployment-demo-degraded' });
const noJev = await degraded.brain.runTurn({
  chatId: degraded.chatId,
  turnId: 'demo:degraded-no-jev',
  generationId: 'demo-gen:degraded-no-jev',
  query: 'What happened to the Sun Blade?',
  mode: 'ambiguous',
});
assert.equal(noJev.jevProposal, null);
assert.equal(noJev.published.cognitiveChoiceReceipt.jev.unavailable, true);
assert.equal(noJev.delivery.ok, true);

const report = {
  kind: 'DevelopmentDeploymentDemoEvidence',
  status: 'ASSEMBLY_CANDIDATE_LIVE_DEMO_PENDING',
  fixture: {
    lorebookId: 'ember-golden',
    characters: ['Mara', 'Eris'],
    location: 'Ember Tavern',
    item: 'Sun Blade',
  },
  sceneTransition: {
    fromRevision: live.before.sceneRevision,
    toRevision: live.after.sceneRevision,
    changedFields: Object.keys(live.after.delta.changedFields ?? {}).sort(),
    location: live.after.location,
  },
  turns: {
    simple: summarize(live.brain, simple),
    retrievalHeavy: summarize(live.brain, retrieval),
    ambiguous: summarize(live.brain, ambiguous),
    degradedNoJev: summarize(degraded.brain, noJev),
  },
  environment: {
    externalDatabaseRequired: live.brain.diagnostics().externalDatabaseRequired,
    externalOrchestrationRequired: live.brain.diagnostics().externalOrchestrationRequired,
    remoteProviderRequired: live.brain.diagnostics().remoteProviderRequired,
  },
  liveGate: {
    issue: 224,
    passed: false,
    reason: 'This deterministic harness does not substitute for a real SillyTavern/browser host session.',
  },
};

console.log(JSON.stringify(report, null, 2));
