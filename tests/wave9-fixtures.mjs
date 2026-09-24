import {
  Capability,
  CapabilityProfileRegistry,
  DeterministicProviderAdapter,
  JevProviderExecutor,
  ProviderAdapterRegistry,
} from '../src/coprocessor/index.js';

export function providerExecutor(handler, { providerId = 'wave9-provider', workerId = 'shared-cognition-slot', modelId = 'wave9-fixture' } = {}) {
  const profiles = new CapabilityProfileRegistry();
  profiles.register({ profileId: `profile:${providerId}`, workerId, providerId, modelId, capabilities: [Capability.SEMANTIC_JUDGMENT, Capability.PROPOSAL_REVIEW, Capability.CONFLICT_INTERPRETATION], foregroundEligible: true, backgroundEligible: true, placements: ['HOT', 'DEEP'], supportedLayers: ['L1', 'L2', 'L3', 'L4'], maxContextTokens: 200000, maxOutputTokens: 4000 });
  const adapters = new ProviderAdapterRegistry();
  adapters.register(new DeterministicProviderAdapter({ providerId, modelId, capabilities: [Capability.SEMANTIC_JUDGMENT], handlers: { JEV_DECISION: handler } }));
  return new JevProviderExecutor({ profiles, adapters });
}

export function output({ selected = [], rejected = [], evidenceUsed = [], outcome = 'DECIDED', decisionCode = 'CHOOSE_ONE', classification = null, reasonCodes = ['SUPPORTED'], unresolvedFactors = [], confidence = .8, abstained = false, escalationTarget = null, requiresOperator = false, explanation = 'bounded Wave 9 decision' } = {}) {
  return { outcome, decisionCode, selectedOptionIds: selected, rejectedOptionIds: rejected, classification, reasonCodes, evidenceUsed, unresolvedFactors, confidence, abstained, escalationTarget, requiresOperator, explanation };
}

export function base(domain, decisionKind, id, extra = {}) {
  const domainRevisions = domain === 'LORE' ? { lore: 7, owner: 3 } : domain === 'SCENE' ? { scene: 5, owner: 2 } : { candidateSet: 9, truthOwner: 4 };
  return {
    domain,
    decisionKind,
    decisionId: id,
    turnId: `turn:${id}`,
    taskId: `task:${id}`,
    correlationId: `corr:${id}`,
    owner: `${domain}_OWNER`,
    sourceRevisionSet: ['src:1'],
    worldRevision: 11,
    sceneRevision: domain === 'SCENE' ? 5 : 4,
    characterStateRevision: 6,
    domainRevisions,
    loreRevision: domainRevisions.lore,
    ownerRevision: domainRevisions.owner ?? domainRevisions.truthOwner,
    candidateSetRevision: domainRevisions.candidateSet,
    freshnessToken: `fresh:${id}`,
    deadline: 10000,
    softDeadline: 9000,
    routing: { expectedDecisionValue: .9, latencyPenalty: 0, costPenalty: 0, uncertaintyPenalty: 0, authorityRisk: 0, minimumInvocationValue: .2 },
    ...extra,
  };
}

export function currentFor(input, patch = {}) {
  const domainRevisions = input.domain === 'LORE'
    ? { lore: input.loreRevision ?? input.domainRevisions?.lore ?? 7, owner: input.ownerRevision ?? input.domainRevisions?.owner ?? 3 }
    : input.domain === 'SCENE'
      ? { scene: input.sceneRevision ?? 5, owner: input.ownerRevision ?? input.domainRevisions?.owner ?? 2 }
      : { candidateSet: input.candidateSetRevision ?? input.domainRevisions?.candidateSet ?? 9, truthOwner: input.ownerRevision ?? input.domainRevisions?.truthOwner ?? 4 };
  return {
    sourceRevisionSet: input.sourceRevisionSet ?? ['src:1'],
    worldRevision: input.worldRevision ?? 11,
    sceneRevision: input.sceneRevision ?? 4,
    characterStateRevision: input.characterStateRevision ?? 6,
    domainRevisions,
    freshnessToken: input.freshnessToken,
    ...patch,
  };
}

export function loreReconciliation(id = 'lore', extra = {}) {
  return base('LORE', 'LORE_RECONCILIATION', id, {
    options: [
      { optionId: 'EXACT_DUPLICATE', evidenceRefs: ['lore:a', 'lore:b'] },
      { optionId: 'TEMPORALLY_DISTINCT', evidenceRefs: ['lore:a', 'lore:b'] },
      { optionId: 'CONTRADICTORY', evidenceRefs: ['lore:a', 'lore:b'] },
    ],
    evidence: [
      { evidenceId: 'lore:a', sourceRef: 'uid:41', summary: 'Sun Blade was lost when Ember Tavern fell.', provenanceRefs: ['src:chronicle'] },
      { evidenceId: 'lore:b', sourceRef: 'uid:87', summary: 'Later testimony places the Sun Blade with Eris after the fire.', provenanceRefs: ['src:testimony'] },
    ],
    provenanceRefs: ['src:chronicle', 'src:testimony'],
    artifactRefs: ['uid:41', 'uid:87'],
    ...extra,
  });
}

export function sceneBoundary(id = 'scene', extra = {}) {
  return base('SCENE', 'SCENE_BOUNDARY', id, {
    options: [
      { optionId: 'CONTINUE_SCENE', evidenceRefs: ['scene:a'] },
      { optionId: 'OPEN_NEW_SCENE', evidenceRefs: ['scene:b'] },
      { optionId: 'RESUME_PRIOR_SCENE', evidenceRefs: ['scene:a', 'scene:b'] },
      { optionId: 'UNRESOLVED', evidenceRefs: ['scene:a', 'scene:b'] },
    ],
    evidence: [
      { evidenceId: 'scene:a', sourceRef: 'episode:12', summary: 'Eris remembers the ruined Ember Tavern.', provenanceRefs: ['scene:episode:12'] },
      { evidenceId: 'scene:b', sourceRef: 'turn:later', summary: 'Narration also describes physical Tavern rubble around Eris.', provenanceRefs: ['turn:later'] },
    ],
    provenanceRefs: ['scene:episode:12', 'turn:later'],
    episodeRefs: ['episode:12'],
    boundarySignals: { flashbackAmbiguous: true },
    ...extra,
  });
}

export function retrievalTruth(id = 'retrieval', extra = {}) {
  return base('RETRIEVAL_TRUTH', 'TRUTH_SEMANTIC_AMBIGUITY', id, {
    options: [
      { optionId: 'SUPPORT_A', evidenceRefs: ['rt:current'], payload: { temporalClass: 'CURRENT' } },
      { optionId: 'SUPPORT_B', evidenceRefs: ['rt:historical'], payload: { temporalClass: 'HISTORICAL' } },
      { optionId: 'PRESERVE_UNRESOLVED', evidenceRefs: ['rt:current', 'rt:historical'] },
      { optionId: 'ABSTAIN', evidenceRefs: [] },
      { optionId: 'ESCALATE', evidenceRefs: [] },
    ],
    evidence: [
      { evidenceId: 'rt:current', sourceRef: 'claim:tavern-destroyed', summary: 'Current evidence says Ember Tavern is destroyed.', provenanceRefs: ['claim:current'] },
      { evidenceId: 'rt:historical', sourceRef: 'claim:blade-tavern', summary: 'Historical evidence places the Sun Blade at the Tavern before destruction.', provenanceRefs: ['claim:historical'] },
    ],
    provenanceRefs: ['claim:current', 'claim:historical'],
    candidateSetId: 'candidate-set:ember',
    retrievalQuality: 'MIXED',
    ...extra,
  });
}