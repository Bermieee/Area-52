import { Capability, FailureCode, Placement, ResultClass } from './constants.js';
import { createCognitiveTask, createRevisionSet } from './contracts.js';
import { assertProviderPayloadBoundary, buildBoundedProviderPayload } from './provider-payload-boundary.js';

export const CONSOLIDATION_CONTRACT_VERSION = '1.1.0';
export const CONSOLIDATION_POLICY_VERSION = 'wave6-v1';

export const ConsolidationProposalKind = Object.freeze({
  EPISODE_SUMMARY: 'EPISODE_SUMMARY',
  CLAIM_CANDIDATE: 'CLAIM_CANDIDATE',
  RELATIONSHIP_UPDATE: 'RELATIONSHIP_UPDATE',
  REFLECTION_EVIDENCE: 'REFLECTION_EVIDENCE',
  STATE_CHANGE_PROPOSAL: 'STATE_CHANGE_PROPOSAL',
  COMPRESSED_REPRESENTATION: 'COMPRESSED_REPRESENTATION',
  CROSS_EPISODE_LINK: 'CROSS_EPISODE_LINK',
});
export const ConsolidationUnitStatus = Object.freeze({
  PENDING: 'PENDING',
  CHECKPOINTED: 'CHECKPOINTED',
  SUPERSEDED: 'SUPERSEDED',
  STALE: 'STALE',
  COMPLETE: 'COMPLETE',
});

export function createConsolidationUnit(input = {}) {
  const refs = normalizeArtifactRefs(input.artifactRefs ?? input.inputRefs ?? []);
  if (!refs.length) throw new TypeError('ConsolidationUnit requires at least one Artifact Reference');
  const sourceRevisionSet = uniqueStrings(input.sourceRevisionSet ?? []);
  const unitId = required(input.unitId, 'unitId');
  const policyVersion = required(input.policyVersion ?? CONSOLIDATION_POLICY_VERSION, 'policyVersion');
  return deepFreeze({
    kind: 'ConsolidationUnit',
    contractVersion: CONSOLIDATION_CONTRACT_VERSION,
    policyVersion,
    unitId,
    originalUnitId: input.originalUnitId ?? unitId,
    artifactRefs: refs,
    sourceRevisionSet,
    worldRevision: finite(input.worldRevision ?? 0, 'worldRevision'),
    sceneRevision: finite(input.sceneRevision ?? 0, 'sceneRevision'),
    characterStateRevision: finite(input.characterStateRevision ?? 0, 'characterStateRevision'),
    priority: finite(input.priority ?? 0, 'priority'),
    createdAt: finite(input.createdAt ?? 0, 'createdAt'),
    checkpoint: input.checkpoint == null ? null : structuredClone(input.checkpoint),
    resumeIdentity: required(input.resumeIdentity ?? 'consolidation:' + unitId, 'resumeIdentity'),
    provenance: structuredClone(input.provenance ?? {}),
    status: input.status ?? ConsolidationUnitStatus.PENDING,
    lineageId: input.lineageId ?? deriveConsolidationLineageId({ artifactRefs: refs, sourceRevisionSet, policyVersion }),
    dedupeKey: input.dedupeKey ?? deriveConsolidationUnitDedupeKey({ artifactRefs: refs, sourceRevisionSet, policyVersion }),
    authority: 'NONE',
    durableMutation: false,
  });
}

export function createConsolidationProposal(input = {}, context = {}) {
  if (input.authority != null && !['UNRESOLVED', 'INFERRED'].includes(input.authority)) {
    fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation proposal cannot claim canonical authority');
  }
  if (input.settlementAuthority === true || input.memoryMutation === true || input.deleteSourceTurns === true || input.durableMutation === true) {
    fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation proposal cannot mutate Memory, Settlement, or delete sources');
  }
  if (!Object.values(ConsolidationProposalKind).includes(input.proposalKind)) {
    fail(FailureCode.SCHEMA_INVALID, 'Unknown consolidation proposal kind: ' + input.proposalKind);
  }
  const sourceArtifactRefs = normalizeArtifactRefs(input.sourceArtifactRefs ?? context.sourceArtifactRefs ?? []);
  if (!sourceArtifactRefs.length) fail(FailureCode.SCHEMA_INVALID, 'Consolidation proposal requires sourceArtifactRefs');
  const sourceRevisionSet = uniqueStrings(input.sourceRevisionSet ?? context.sourceRevisionSet ?? []);
  const semanticIdentity = required(input.semanticIdentity ?? inferSemanticIdentity(input), 'semanticIdentity');
  const policyVersion = required(input.policyVersion ?? context.policyVersion ?? CONSOLIDATION_POLICY_VERSION, 'policyVersion');
  const payload = validateProposalPayload(input.proposalKind, input.payload ?? {}, input);
  const proposalId = required(input.proposalId ?? deriveConsolidationProposalIdentity({
    sourceArtifactRefs, proposalKind: input.proposalKind, semanticIdentity, policyVersion,
  }), 'proposalId');
  return deepFreeze({
    kind: 'ConsolidationProposal',
    contractVersion: CONSOLIDATION_CONTRACT_VERSION,
    policyVersion,
    proposalId,
    proposalKind: input.proposalKind,
    semanticIdentity,
    sourceArtifactRefs,
    supportingRefs: uniqueStrings(input.supportingRefs ?? payload.supportingRefs ?? []),
    contradictingRefs: uniqueStrings(input.contradictingRefs ?? payload.contradictingRefs ?? []),
    sourceRevisionSet,
    worldRevision: finite(input.worldRevision ?? context.worldRevision ?? 0, 'worldRevision'),
    sceneRevision: finite(input.sceneRevision ?? context.sceneRevision ?? 0, 'sceneRevision'),
    characterStateRevision: finite(input.characterStateRevision ?? context.characterStateRevision ?? 0, 'characterStateRevision'),
    temporal: normalizeTemporal(input.temporal ?? payload.temporal ?? null),
    payload,
    provenance: structuredClone(input.provenance ?? context.provenance ?? {}),
    confidence: unit(input.confidence ?? 1, 'confidence'),
    createdAt: finite(input.createdAt ?? 0, 'createdAt'),
    authority: input.authority ?? 'UNRESOLVED',
    settlementAuthority: false,
    memoryMutation: false,
    deleteSourceTurns: false,
    durableMutation: false,
    destination: 'MEMORY_SETTLEMENT_REVIEW',
  });
}

export function createConsolidationProposalBundle(input = {}, context = {}) {
  if (input.authority != null && !['UNRESOLVED', 'INFERRED'].includes(input.authority)) {
    fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation bundle cannot claim canonical authority');
  }
  if (input.settlementAuthority || input.memoryMutation || input.deleteSourceTurns || input.durableMutation) {
    fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation bundle attempted owner mutation');
  }
  if (!Array.isArray(input.proposals)) fail(FailureCode.SCHEMA_INVALID, 'Consolidation bundle proposals must be an array');
  const maxProposals = positiveInteger(context.maxProposals ?? 24, 'maxProposals');
  if (input.proposals.length > maxProposals) throw new RangeError('Consolidation bundle exceeds ' + maxProposals + ' proposals');
  const unitId = required(input.unitId ?? context.unitId ?? 'unknown-unit', 'unitId');
  const proposals = input.proposals.map((proposal) => createConsolidationProposal(proposal, {
    sourceArtifactRefs: context.sourceArtifactRefs,
    sourceRevisionSet: context.sourceRevisionSet,
    worldRevision: context.worldRevision,
    sceneRevision: context.sceneRevision,
    characterStateRevision: context.characterStateRevision,
    policyVersion: context.policyVersion,
    provenance: context.provenance,
  }));
  const seen = new Set();
  for (const proposal of proposals) {
    if (seen.has(proposal.proposalId)) fail(FailureCode.SCHEMA_INVALID, 'Duplicate consolidation proposal: ' + proposal.proposalId);
    seen.add(proposal.proposalId);
  }
  return deepFreeze({
    kind: 'ConsolidationProposalBundle',
    contractVersion: CONSOLIDATION_CONTRACT_VERSION,
    policyVersion: context.policyVersion ?? input.policyVersion ?? CONSOLIDATION_POLICY_VERSION,
    bundleId: required(input.bundleId ?? 'bundle:' + unitId + ':' + (context.policyVersion ?? CONSOLIDATION_POLICY_VERSION), 'bundleId'),
    unitId,
    sourceRevisionSet: uniqueStrings(input.sourceRevisionSet ?? context.sourceRevisionSet ?? []),
    proposals,
    provenance: structuredClone(input.provenance ?? context.provenance ?? {}),
    validationReceipt: structuredClone(input.validationReceipt ?? { syntax: 'PASS', schema: 'PASS', semantic: 'PASS' }),
    authority: 'UNRESOLVED',
    durableMutation: false,
    destination: 'MEMORY_SETTLEMENT_REVIEW',
  });
}

export function validateConsolidationProviderOutput(value, context = {}) {
  const object = typeof value === 'string' ? parseStrictObject(value) : value;
  if (!object || typeof object !== 'object' || Array.isArray(object)) fail(FailureCode.SCHEMA_INVALID, 'Consolidation output must be an object');
  if (object.authority != null && !['UNRESOLVED', 'INFERRED'].includes(object.authority)) fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation output authority escalation');
  if (object.settlementAuthority || object.memoryMutation || object.deleteSourceTurns || object.durableMutation) {
    fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation output attempted owner mutation');
  }
  const knownArtifacts = context.knownArtifactRefs == null ? null : new Map(
    normalizeArtifactRefs(context.knownArtifactRefs).map((ref) => [artifactIdentity(ref), ref]),
  );
  const normalized = Array.isArray(object.proposals)
    ? createConsolidationProposalBundle(object, context)
    : createConsolidationProposal({
      ...object,
      sourceRevisionSet: object.sourceRevisionSet ?? context.sourceRevisionSet,
      worldRevision: object.worldRevision ?? context.worldRevision,
      sceneRevision: object.sceneRevision ?? context.sceneRevision,
      characterStateRevision: object.characterStateRevision ?? context.characterStateRevision,
    }, context);
  const proposals = normalized.kind === 'ConsolidationProposalBundle' ? normalized.proposals : [normalized];
  for (const proposal of proposals) {
    if (context.currentRevisionSet && consolidationFreshness(proposal, context.currentRevisionSet) !== 'FRESH') {
      fail(FailureCode.STALE_RESULT, 'Consolidation output revision is stale');
    }
    if (knownArtifacts) {
      for (const ref of proposal.sourceArtifactRefs) {
        if (!knownArtifacts.has(artifactIdentity(ref))) fail(FailureCode.UNKNOWN_REFERENCE, 'Unknown consolidation source artifact: ' + artifactIdentity(ref));
      }
    }
  }
  return normalized;
}

export function createConsolidationTask(unitInput, {
  taskId = null,
  turnId = 'background',
  correlationId = 'background:consolidation',
  causationId = null,
  softDeadline = 60_000,
  hardDeadline = 300_000,
  maxSliceUnits = 16,
  maxUnitsPerCheckpoint = 16,
} = {}) {
  const unit = unitInput?.kind === 'ConsolidationUnit' ? unitInput : createConsolidationUnit(unitInput);
  const revisions = createRevisionSet({
    sourceRevisionSet: unit.sourceRevisionSet,
    worldRevision: unit.worldRevision,
    sceneRevision: unit.sceneRevision,
    characterStateRevision: unit.characterStateRevision,
  });
  return createCognitiveTask({
    taskId: taskId ?? 'consolidate:' + unit.unitId,
    taskType: 'CONSOLIDATION',
    turnId,
    correlationId,
    causationId,
    requiredCapabilities: [Capability.CONSOLIDATION, Capability.COMPRESSION],
    optionalCapabilities: [Capability.REFLECTION, Capability.STRUCTURED_EXTRACTION, Capability.DEEP_REASONING],
    capabilityRequests: [Capability.CONSOLIDATION, Capability.COMPRESSION],
    cognitiveLayer: 'L3',
    resultClass: ResultClass.DEFERRED,
    placement: Placement.DEEP,
    inputRevisionSet: revisions,
    softDeadline,
    hardDeadline,
    compilerLane: 'consolidationProposals',
    intentFingerprint: 'consolidation:' + unit.unitId + ':' + unit.resumeIdentity,
    batchMetadata: {
      batchable: true,
      slicePolicy: 'ADAPTIVE',
      checkpointBoundary: 'SLICE',
      yieldSafety: 'CHECKPOINT_ONLY',
      partialResultSemantics: 'PRESERVE_VALID_SLICES',
    },
    fallbackPolicy: { type: 'PARK_OR_RECOMPUTE', maxRetries: 0 },
    metadata: {
      resourceClass: 'DEEP_BACKGROUND',
      resourceHints: { borrowIdleCapacity: true, foregroundPreemptible: true },
      resumeIdentity: unit.resumeIdentity,
      lineageId: unit.lineageId,
      policyVersion: unit.policyVersion,
      checkpoint: unit.checkpoint,
      maxSliceUnits,
      maxUnitsPerCheckpoint,
      batchSlice: { unitId: unit.unitId, artifactRefs: unit.artifactRefs },
      sourceRecoverabilityRequired: true,
      durableMutationAllowed: false,
      expectedOutputTokens: 1800,
    },
  });
}

export function createConsolidationProviderInput(task, input = {}, limits = {}) {
  const maxEvidenceSlices = positiveInteger(limits.maxEvidenceSlices ?? 32, 'maxEvidenceSlices');
  const maxExcerptChars = positiveInteger(limits.maxExcerptChars ?? 2400, 'maxExcerptChars');
  const unit = input.unit?.kind === 'ConsolidationUnit'
    ? input.unit
    : createConsolidationUnit({
      ...(task.metadata?.batchSlice??{}),
      ...(input.unit??input),
      unitId:input.unit?.unitId??input.unitId??task.metadata?.batchSlice?.unitId??task.taskId,
      sourceRevisionSet:input.unit?.sourceRevisionSet??input.sourceRevisionSet??task.sourceRevisionSet,
      worldRevision:input.unit?.worldRevision??input.worldRevision??task.worldRevision,
      sceneRevision:input.unit?.sceneRevision??input.sceneRevision??task.sceneRevision,
      characterStateRevision:input.unit?.characterStateRevision??input.characterStateRevision??task.characterStateRevision,
      resumeIdentity:input.unit?.resumeIdentity??input.resumeIdentity??task.metadata?.resumeIdentity??('resume:'+task.taskId),
      policyVersion:input.unit?.policyVersion??input.policyVersion??task.metadata?.policyVersion??CONSOLIDATION_POLICY_VERSION,
    });
  const allowed = new Set(unit.artifactRefs.map((ref) => artifactIdentity(ref)));
  const evidenceSlices = [];
  for (const slice of input.evidenceSlices ?? input.artifactSlices ?? []) {
    const ref = normalizeArtifactRefs([slice.ref ?? slice.artifactRef ?? slice])[0];
    if (!allowed.has(artifactIdentity(ref))) fail(FailureCode.UNKNOWN_REFERENCE, 'Consolidation slice references unknown artifact: ' + artifactIdentity(ref));
    evidenceSlices.push({
      ref: artifactIdentity(ref),
      revision: ref.revision,
      excerpt: typeof slice.excerpt === 'string' ? slice.excerpt.slice(0, maxExcerptChars) : null,
      structuredFacts: boundedStructuredFacts(slice.structuredFacts ?? slice.facts ?? [], 64),
      provenanceRef: slice.provenanceRef ?? null,
    });
    if (evidenceSlices.length > maxEvidenceSlices) throw new RangeError('Consolidation evidence slices exceed ' + maxEvidenceSlices);
  }
  const payload = buildBoundedProviderPayload({
    taskSlice: {
      taskId: task.taskId,
      unitId: unit.unitId,
      policyVersion: unit.policyVersion,
      sourceRevisionSet: unit.sourceRevisionSet,
      worldRevision: unit.worldRevision,
      sceneRevision: unit.sceneRevision,
      characterStateRevision: unit.characterStateRevision,
      proposalKinds: Object.values(ConsolidationProposalKind),
      checkpoint: input.checkpoint ?? unit.checkpoint,
      semanticGoals: input.semanticGoals ?? [
        'episode-summary',
        'atomic-claims',
        'relationship-or-state-observations',
        'reflection-evidence',
        'compressed-representation',
        'cross-episode-links',
      ],
    },
    sourceReferences: unit.artifactRefs,
    selectedContext: evidenceSlices,
    diagnosticMetadata: { cognitiveLayer: task.cognitiveLayer, placement: task.placement, resultClass: task.resultClass },
  });
  assertProviderPayloadBoundary(payload);
  return payload;
}

export function createConsolidationCheckpoint(unitInput, {
  completedArtifactRefs = [],
  completedProposalIds = [],
  nextOffset = 0,
  remainingArtifactRefs = null,
  createdAt = 0,
} = {}) {
  const unit = unitInput?.kind === 'ConsolidationUnit' ? unitInput : createConsolidationUnit(unitInput);
  const completed = normalizeArtifactRefs(completedArtifactRefs);
  const remaining = remainingArtifactRefs == null
    ? unit.artifactRefs.filter((ref) => !new Set(completed.map(artifactIdentity)).has(artifactIdentity(ref)))
    : normalizeArtifactRefs(remainingArtifactRefs);
  return deepFreeze({
    kind: 'ConsolidationCheckpoint',
    contractVersion: CONSOLIDATION_CONTRACT_VERSION,
    unitId: unit.unitId,
    resumeIdentity: unit.resumeIdentity,
    lineageId: unit.lineageId,
    policyVersion: unit.policyVersion,
    completedArtifactRefs: completed,
    completedProposalIds: uniqueStrings(completedProposalIds),
    remainingArtifactRefs: remaining,
    nextOffset: nonNegativeInteger(nextOffset, 'nextOffset'),
    sourceRevisionSet: [...unit.sourceRevisionSet],
    worldRevision: unit.worldRevision,
    sceneRevision: unit.sceneRevision,
    characterStateRevision: unit.characterStateRevision,
    createdAt: finite(createdAt, 'createdAt'),
    durableMutation: false,
  });
}

export function evaluateConsolidationResume(checkpoint, currentRevisionSet = {}) {
  const freshness = consolidationFreshness(checkpoint, currentRevisionSet);
  return deepFreeze(freshness === 'FRESH'
    ? { action: 'RESUME_FROM_CHECKPOINT', freshness, resume: true, replan: false, checkpoint: structuredClone(checkpoint) }
    : { action: 'INVALIDATE_AND_REPLAN', freshness, resume: false, replan: true, checkpoint: null });
}

export function createMemoryOwnerHandoff(bundleInput, { currentRevisionSet = null } = {}) {
  const bundle = bundleInput?.kind === 'ConsolidationProposalBundle'
    ? bundleInput
    : createConsolidationProposalBundle(bundleInput);
  if (currentRevisionSet) {
    for (const proposal of bundle.proposals) {
      if (consolidationFreshness(proposal, currentRevisionSet) !== 'FRESH') fail(FailureCode.STALE_RESULT, 'Memory handoff contains stale proposal');
    }
  }
  return deepFreeze({
    kind: 'MemoryConsolidationProposalHandoff',
    contractVersion: CONSOLIDATION_CONTRACT_VERSION,
    bundleId: bundle.bundleId,
    unitId: bundle.unitId,
    proposalRefs: bundle.proposals.map((proposal) => ({
      proposalId: proposal.proposalId,
      proposalKind: proposal.proposalKind,
      semanticIdentity: proposal.semanticIdentity,
      authority: proposal.authority,
      confidence: proposal.confidence,
    })),
    sourceArtifactRefs: uniqueArtifactRefs(bundle.proposals.flatMap((proposal) => proposal.sourceArtifactRefs)),
    provenanceRefs: [...new Set(bundle.proposals.flatMap((proposal) => collectProvenanceRefs(proposal.provenance)))].sort(),
    sourceRevisionSet: [...bundle.sourceRevisionSet],
    validationReceipt: structuredClone(bundle.validationReceipt),
    uncertainty: bundle.proposals.map((proposal) => ({
      proposalId: proposal.proposalId,
      confidence: proposal.confidence,
      contradictingRefs: proposal.contradictingRefs,
    })),
    destination: 'MEMORY_SETTLEMENT_REVIEW',
    durableMutation: false,
    memoryPersistence: false,
    temporalSettlement: false,
    reflectionAdmission: false,
    sourceDeletion: false,
  });
}

export function consolidationFreshness(value, currentRevisionSet = {}) {
  const source = new Set(currentRevisionSet.sourceRevisionSet ?? []);
  const requiredSources = value.sourceRevisionSet ?? [];
  if (Number(value.worldRevision) !== Number(currentRevisionSet.worldRevision ?? value.worldRevision)) return 'STALE';
  if (Number(value.sceneRevision) !== Number(currentRevisionSet.sceneRevision ?? value.sceneRevision)) return 'STALE';
  if (Number(value.characterStateRevision) !== Number(currentRevisionSet.characterStateRevision ?? value.characterStateRevision)) return 'STALE';
  if (requiredSources.some((id) => !source.has(id))) return 'STALE';
  return 'FRESH';
}

export class ConsolidationProposalDeduper {
  #proposalIds = new Set();
  #semanticKeys = new Set();

  accept(bundleInput) {
    const bundle = bundleInput?.kind === 'ConsolidationProposalBundle' ? bundleInput : createConsolidationProposalBundle(bundleInput);
    const accepted = [], duplicates = [];
    for (const proposal of bundle.proposals) {
      const semanticKey = proposalDedupeKey(proposal);
      if (this.#proposalIds.has(proposal.proposalId) || this.#semanticKeys.has(semanticKey)) {
        duplicates.push(proposal.proposalId);
        continue;
      }
      this.#proposalIds.add(proposal.proposalId);
      this.#semanticKeys.add(semanticKey);
      accepted.push(proposal);
    }
    return deepFreeze({ accepted, duplicates, acceptedCount: accepted.length, duplicateCount: duplicates.length });
  }

  exportState() { return structuredClone({ proposalIds: [...this.#proposalIds], semanticKeys: [...this.#semanticKeys] }); }
  importState(state = {}) { this.#proposalIds = new Set(state.proposalIds ?? []); this.#semanticKeys = new Set(state.semanticKeys ?? []); return this; }
  size() { return this.#proposalIds.size; }
}

export class ConsolidationBacklog {
  #units = new Map();
  #dedupe = new Map();
  #metrics = { enqueued: 0, duplicateEnqueue: 0, checkpointed: 0, superseded: 0, staleDiscarded: 0, completed: 0, evicted: 0, resumed: 0 };

  constructor({ capacity = 512 } = {}) { this.capacity = positiveInteger(capacity, 'capacity'); }

  enqueue(unitInput) {
    let unit = unitInput?.kind === 'ConsolidationUnit' ? unitInput : createConsolidationUnit(unitInput);
    const existingId = this.#dedupe.get(unit.dedupeKey);
    if (existingId && this.#units.has(existingId)) {
      this.#metrics.duplicateEnqueue += 1;
      return structuredClone(this.#units.get(existingId));
    }
    if (this.#units.has(unit.unitId) && this.#units.get(unit.unitId).dedupeKey !== unit.dedupeKey) {
      const old = this.#units.get(unit.unitId);
      this.#units.set(old.unitId, deepFreeze({ ...old, status: ConsolidationUnitStatus.SUPERSEDED, supersededBy: unit.lineageId }));
      this.#metrics.superseded += 1;
      unit = deepFreeze({ ...unit, originalUnitId: unit.unitId, unitId: unit.unitId + '@' + lineageSuffix(unit) });
    }
    this.#units.set(unit.unitId, unit);
    this.#dedupe.set(unit.dedupeKey, unit.unitId);
    this.#metrics.enqueued += 1;
    this.#enforceCapacity();
    return structuredClone(unit);
  }

  checkpoint(unitId, checkpoint) {
    const current = this.#required(unitId);
    const normalized = checkpoint?.kind === 'ConsolidationCheckpoint'
      ? checkpoint
      : createConsolidationCheckpoint(current, {
        completedArtifactRefs: checkpoint?.completedArtifactRefs ?? [],
        completedProposalIds: checkpoint?.completedProposalIds ?? [],
        nextOffset: checkpoint?.nextOffset ?? checkpoint?.offset ?? checkpoint?.slice ?? 0,
        remainingArtifactRefs: checkpoint?.remainingArtifactRefs ?? null,
        createdAt: checkpoint?.createdAt ?? 0,
      });
    return this.#update(unitId, { checkpoint: normalized, status: ConsolidationUnitStatus.CHECKPOINTED }, 'checkpointed');
  }

  resume(unitId, currentRevisionSet) {
    const current = this.#required(unitId);
    if (!current.checkpoint) return deepFreeze({ action: 'RESTART_SLICE', unit: structuredClone(current), checkpoint: null });
    const decision = evaluateConsolidationResume(current.checkpoint, currentRevisionSet);
    if (!decision.resume) {
      this.#units.set(unitId, deepFreeze({ ...current, status: ConsolidationUnitStatus.STALE }));
      this.#metrics.staleDiscarded += 1;
      return decision;
    }
    this.#metrics.resumed += 1;
    return deepFreeze({ ...decision, unit: structuredClone(current) });
  }

  supersede(unitId, supersededBy = null) { return this.#update(unitId, { status: ConsolidationUnitStatus.SUPERSEDED, supersededBy }, 'superseded'); }
  complete(unitId) { return this.#update(unitId, { status: ConsolidationUnitStatus.COMPLETE }, 'completed'); }

  discardStale(currentRevisionSet) {
    let count = 0;
    for (const [id, unit] of [...this.#units]) {
      if (consolidationFreshness(unit, currentRevisionSet) === 'STALE' && ![ConsolidationUnitStatus.COMPLETE, ConsolidationUnitStatus.SUPERSEDED].includes(unit.status)) {
        this.#units.set(id, deepFreeze({ ...unit, status: ConsolidationUnitStatus.STALE }));
        this.#metrics.staleDiscarded += 1;
        count += 1;
      }
    }
    return count;
  }

  pending({ now = 0 } = {}) {
    return this.list()
      .filter((unit) => [ConsolidationUnitStatus.PENDING, ConsolidationUnitStatus.CHECKPOINTED].includes(unit.status))
      .map((unit) => deepFreeze({ ...unit, age: Math.max(0, Number(now) - unit.createdAt) }));
  }

  list() {
    return [...this.#units.values()]
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt || a.unitId.localeCompare(b.unitId))
      .map((unit) => structuredClone(unit));
  }

  exportState() {
    return structuredClone({ capacity: this.capacity, units: [...this.#units], dedupe: [...this.#dedupe], metrics: this.#metrics });
  }

  importState(state = {}) {
    this.#units = new Map(state.units ?? []);
    this.#dedupe = new Map(state.dedupe ?? []);
    this.#metrics = { ...this.#metrics, ...(state.metrics ?? {}) };
    this.#enforceCapacity();
    return this;
  }

  metrics({ now = 0 } = {}) {
    const pending = this.pending({ now });
    return deepFreeze({
      ...this.#metrics,
      pendingUnits: pending.length,
      oldestPendingAge: pending.length ? Math.max(...pending.map((unit) => unit.age)) : 0,
      capacity: this.capacity,
      storedUnits: this.#units.size,
    });
  }

  #required(unitId) {
    const current = this.#units.get(unitId);
    if (!current) throw new Error('Unknown consolidation unit: ' + unitId);
    return current;
  }

  #update(unitId, patch, metric) {
    const current = this.#required(unitId);
    const next = deepFreeze({ ...current, ...patch });
    this.#units.set(unitId, next);
    this.#metrics[metric] += 1;
    return structuredClone(next);
  }

  #enforceCapacity() {
    while (this.#units.size > this.capacity) {
      const terminal = this.list().filter((unit) => [ConsolidationUnitStatus.STALE, ConsolidationUnitStatus.SUPERSEDED, ConsolidationUnitStatus.COMPLETE].includes(unit.status));
      const candidate = terminal.at(-1) ?? this.list().at(-1);
      this.#units.delete(candidate.unitId);
      if (this.#dedupe.get(candidate.dedupeKey) === candidate.unitId) this.#dedupe.delete(candidate.dedupeKey);
      this.#metrics.evicted += 1;
    }
  }
}

export function sourceFactRetention({ sourceFacts = [], proposalFacts = [] } = {}) {
  const source = new Set(sourceFacts.map(stableFact));
  const proposal = new Set(proposalFacts.map(stableFact));
  const retained = [...source].filter((fact) => proposal.has(fact));
  return deepFreeze({
    total: source.size,
    retained: retained.length,
    lost: source.size - retained.length,
    ratio: source.size ? retained.length / source.size : 1,
    pass: retained.length === source.size,
  });
}

export function deriveConsolidationUnitDedupeKey({ artifactRefs = [], sourceRevisionSet = [], policyVersion = CONSOLIDATION_POLICY_VERSION } = {}) {
  const refs = normalizeArtifactRefs(artifactRefs).map(artifactIdentity).sort().join('|');
  return ['consolidation-unit', policyVersion, refs, uniqueStrings(sourceRevisionSet).join('|')].join(':');
}

export function deriveConsolidationLineageId(input = {}) {
  return 'lineage:' + deriveConsolidationUnitDedupeKey(input);
}

export function deriveConsolidationProposalIdentity({ sourceArtifactRefs = [], proposalKind, semanticIdentity, policyVersion = CONSOLIDATION_POLICY_VERSION } = {}) {
  return ['consolidation-proposal', policyVersion, required(proposalKind, 'proposalKind'), required(semanticIdentity, 'semanticIdentity'),
    normalizeArtifactRefs(sourceArtifactRefs).map(artifactIdentity).sort().join('|')].join(':');
}

function validateProposalPayload(kind, payloadInput, topLevel = {}) {
  if (!payloadInput || typeof payloadInput !== 'object' || Array.isArray(payloadInput)) fail(FailureCode.SCHEMA_INVALID, 'Consolidation proposal payload must be an object');
  const payload = structuredClone(payloadInput);
  if (payload.authority === 'SETTLED' || payload.authority === 'SOURCE_CANON' || payload.memoryMutation || payload.deleteSourceTurns) {
    fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation payload attempted authority escalation');
  }
  if (payload.temporalStatus === 'CURRENT' && payload.sourceTemporalStatus === 'HISTORICAL') {
    fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation cannot promote HISTORICAL evidence to CURRENT');
  }
  if (payload.causalCertainty === 'CERTAIN' && !(payload.directCausalEvidenceRefs ?? []).length) {
    fail(FailureCode.AUTHORITY_VIOLATION, 'Unsupported causal certainty requires direct causal evidence refs');
  }
  if (kind === ConsolidationProposalKind.EPISODE_SUMMARY) {
    if (payload.participants != null && !Array.isArray(payload.participants)) fail(FailureCode.SCHEMA_INVALID, 'Episode participants must be an array');
    if (payload.salientEvents != null && !Array.isArray(payload.salientEvents)) fail(FailureCode.SCHEMA_INVALID, 'Episode salientEvents must be an array');
    if (payload.unresolvedOutcomes != null && !Array.isArray(payload.unresolvedOutcomes)) fail(FailureCode.SCHEMA_INVALID, 'Episode unresolvedOutcomes must be an array');
    if (payload.sourceRanges != null && !Array.isArray(payload.sourceRanges)) fail(FailureCode.SCHEMA_INVALID, 'Episode sourceRanges must be an array');
  }
  if (kind === ConsolidationProposalKind.CLAIM_CANDIDATE) {
    const structured = payload.subjectRef != null || payload.predicate != null || payload.object != null;
    if (!structured && typeof payload.claim !== 'string') fail(FailureCode.SCHEMA_INVALID, 'Claim candidate requires claim text or subject/predicate/object');
    if (structured && (!payload.subjectRef || !payload.predicate)) fail(FailureCode.SCHEMA_INVALID, 'Structured claim requires subjectRef and predicate');
  }
  if (kind === ConsolidationProposalKind.REFLECTION_EVIDENCE) {
    for (const key of ['directObservations', 'repeatedPatterns', 'inferredInterpretations', 'contradictingEvidence']) {
      if (payload[key] != null && !Array.isArray(payload[key])) fail(FailureCode.SCHEMA_INVALID, 'Reflection ' + key + ' must be an array');
    }
  }
  if (topLevel.authority === 'SETTLED' || topLevel.authority === 'SOURCE_CANON') {
    fail(FailureCode.AUTHORITY_VIOLATION, 'Consolidation proposal authority escalation');
  }
  return deepFreeze(payload);
}

function inferSemanticIdentity(input) {
  const payload = input.payload ?? {};
  if (typeof payload.semanticIdentity === 'string' && payload.semanticIdentity) return payload.semanticIdentity;
  if (typeof payload.claim === 'string' && payload.claim) return 'claim:' + payload.claim.slice(0, 256);
  if (payload.subjectRef && payload.predicate) return ['claim', payload.subjectRef, payload.predicate, stableFact(payload.object ?? payload.value ?? null)].join(':');
  if (payload.fromRef && payload.toRef && payload.relation) return ['relationship', payload.fromRef, payload.relation, payload.toRef].join(':');
  if (payload.entityRef && payload.changeType) return ['state', payload.entityRef, payload.changeType, stableFact(payload.to ?? payload.value ?? null)].join(':');
  return [input.proposalKind ?? 'UNKNOWN', stableFact(payload).slice(0, 512)].join(':');
}
function proposalDedupeKey(proposal) {
  return [proposal.policyVersion, proposal.proposalKind, proposal.semanticIdentity,
    proposal.sourceArtifactRefs.map(artifactIdentity).sort().join('|')].join(':');
}
function normalizeTemporal(value) {
  if (value == null) return null;
  if (typeof value === 'string') return deepFreeze({ status: value });
  if (typeof value !== 'object' || Array.isArray(value)) fail(FailureCode.SCHEMA_INVALID, 'temporal must be object/string/null');
  return deepFreeze(structuredClone(value));
}
function normalizeArtifactRefs(values) {
  if (!Array.isArray(values)) throw new TypeError('Artifact References must be an array');
  return values.map((value) => {
    const ref = value?.kind === 'ArtifactReference' || value?.kind === 'ArtifactRef'
      ? value
      : value?.artifactId ? { kind: 'ArtifactReference', ...value } : null;
    if (!ref) throw new TypeError('Consolidation inputs must use Artifact References');
    const artifactId = required(ref.artifactId, 'artifactId');
    const artifactType = required(ref.artifactType, 'artifactType');
    const revision = positiveInteger(ref.revision, 'revision');
    return deepFreeze({
      kind: ref.kind,
      artifactId,
      artifactType,
      revision,
      owner: ref.owner ?? null,
      storageDomain: ref.storageDomain ?? ref.repositoryDomain ?? 'artifacts',
      sliceSelector: ref.sliceSelector ?? ref.sliceIdentity ?? null,
      contentHash: ref.contentHash ?? ref.digest ?? null,
      provenanceRef: ref.provenanceRef ?? null,
    });
  });
}
function uniqueArtifactRefs(values) {
  const map = new Map();
  for (const ref of normalizeArtifactRefs(values)) map.set(artifactIdentity(ref), ref);
  return [...map.values()];
}
function artifactIdentity(ref) { return ref.artifactId + '@' + ref.revision; }
function boundedStructuredFacts(values, max) {
  if (!Array.isArray(values)) fail(FailureCode.SCHEMA_INVALID, 'structuredFacts must be an array');
  if (values.length > max) throw new RangeError('structuredFacts exceeds ' + max);
  return values.map((value) => {
    if (value == null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value !== 'object' || Array.isArray(value)) return String(value);
    const out = {};
    for (const [key, raw] of Object.entries(value).slice(0, 24)) {
      if (raw == null || ['number', 'boolean', 'string'].includes(typeof raw)) out[key] = typeof raw === 'string' ? raw.slice(0, 1000) : raw;
    }
    return out;
  });
}
function collectProvenanceRefs(value) {
  const refs = [];
  const visit = (item) => {
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if ((key === 'ref' || key.endsWith('Ref')) && typeof child === 'string') refs.push(child);
      else if (key.endsWith('Refs') && Array.isArray(child)) refs.push(...child.filter((x) => typeof x === 'string'));
      else visit(child);
    }
  };
  visit(value);
  return refs;
}
function lineageSuffix(unit) {
  return unit.artifactRefs.map((ref) => String(ref.revision)).join('-') + '-' + unit.sourceRevisionSet.join('-');
}
function parseStrictObject(text) {
  if (typeof text !== 'string') fail(FailureCode.MALFORMED_OUTPUT, 'Consolidation output must be JSON text');
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) fail(FailureCode.MALFORMED_OUTPUT, 'Consolidation output must contain one JSON object');
  try { return JSON.parse(trimmed); } catch (error) { fail(FailureCode.MALFORMED_OUTPUT, 'Consolidation JSON parse failed: ' + error.message); }
}
function stableFact(value) { return typeof value === 'string' ? value.trim() : JSON.stringify(value); }
function uniqueStrings(values) {
  if (!Array.isArray(values)) throw new TypeError('expected array');
  return [...new Set(values.map((value) => required(value, 'reference')))].sort();
}
function required(value, name) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' must be a non-empty string'); return value.trim(); }
function finite(value, name) { const number = Number(value); if (!Number.isFinite(number)) throw new TypeError(name + ' must be finite'); return number; }
function nonNegativeInteger(value, name) { const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new TypeError(name + ' must be a non-negative integer'); return number; }
function positiveInteger(value, name) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new TypeError(name + ' must be a positive integer'); return number; }
function unit(value, name) { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 1) fail(FailureCode.SCHEMA_INVALID, name + ' must be within 0..1'); return number; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
