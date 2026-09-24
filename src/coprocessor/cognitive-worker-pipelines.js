import { ResultClass, ResultDestination, TelemetryEvent } from './constants.js';
import {
  GreenRoomStore, createGreenRoomBatch, createGreenRoomTask, projectGreenRoomForGeneration,
} from './green-room.js';
import {
  ConsolidationBacklog, ConsolidationProposalDeduper, createConsolidationProposalBundle,
  createConsolidationTask, createConsolidationCheckpoint, createMemoryOwnerHandoff, consolidationFreshness,
} from './continuous-consolidation.js';
import { emitTelemetry } from './telemetry.js';

export class CharacterCognitionWorker {
  constructor({ executionLayer, store = new GreenRoomStore(), telemetry = null } = {}) {
    if (!executionLayer || typeof executionLayer.execute !== 'function') throw new TypeError('CharacterCognitionWorker requires SpecialistExecutionLayer');
    this.executionLayer = executionLayer;
    this.store = store;
    this.telemetry = telemetry;
  }

  async run({
    task = null,
    taskInput = null,
    turn,
    input = {},
    turnSequence = 0,
    sealed = false,
    profileId = null,
  } = {}) {
    const cognitiveTask = task ?? createGreenRoomTask({
      turnId: turn?.turnId,
      correlationId: turn?.correlationId,
      causationId: turn?.causationId ?? null,
      sceneRevision: turn?.sceneRevision ?? 0,
      worldRevision: turn?.worldRevision ?? 0,
      characterStateRevision: turn?.characterStateRevision ?? 0,
      sourceRevisionSet: turn?.sourceRevisionSet ?? [],
      activeCast: input.activeCast ?? input.characters ?? [],
      evidenceRefs: collectInputEvidenceRefs(input),
      relationshipEvidenceRefs: collectCategoryRefs(input, 'relationshipEvidenceRefs'),
      characterStateRefs: collectCategoryRefs(input, 'characterStateRefs'),
      unresolvedEvidenceRefs: collectCategoryRefs(input, 'unresolvedEvidenceRefs'),
      intentFingerprint: turn?.intentFingerprint ?? null,
      ...(taskInput ?? {}),
    });
    const activeCharacterRefs = cognitiveTask.metadata.activeCharacterRefs ?? [];
    emitTelemetry(this.telemetry, TelemetryEvent.GREEN_ROOM_BATCH_STARTED, {
      taskId: cognitiveTask.taskId, turnId: cognitiveTask.turnId, charactersEvaluated: activeCharacterRefs.length,
      sceneRevision: cognitiveTask.sceneRevision, resultClass: cognitiveTask.resultClass,
    });
    let result;
    try {
      result = await this.executionLayer.execute(cognitiveTask, { input, profileId });
    } catch (error) {
      emitTelemetry(this.telemetry, TelemetryEvent.VALIDATION_FAILED, {
        taskId: cognitiveTask.taskId, turnId: cognitiveTask.turnId, taskClass: 'GREEN_ROOM',
        reason: error?.code ?? 'GREEN_ROOM_UNAVAILABLE',
      });
      if (cognitiveTask.resultClass === ResultClass.REQUIRED) throw error;
      return Object.freeze({
        kind: 'CharacterCognitionResult',
        status: 'DEGRADED',
        task: cognitiveTask,
        failure: Object.freeze({ code: error?.code ?? 'GREEN_ROOM_UNAVAILABLE', message: error?.message ?? String(error) }),
        projection: null,
        reflectionCandidates: Object.freeze([]),
        destination: sealed ? ResultDestination.NEXT_TURN : ResultDestination.FOREGROUND,
        canonicalMutation: false,
      });
    }

    const batch = canonicalBatchFromExecutionPayload(result.payload, cognitiveTask);
    const destination = sealed ? ResultDestination.NEXT_TURN : ResultDestination.FOREGROUND;
    if (!sealed) this.store.putBatch(batch, { turnSequence, activeCharacterRefs });
    const projection = sealed ? projectGreenRoomForGeneration(batch, { sceneRevision: cognitiveTask.sceneRevision })
      : projectGreenRoomForGeneration(this.store, { sceneRevision: cognitiveTask.sceneRevision, turnSequence, activeCharacterRefs });
    const reflectionCandidates = sealed ? [] : activeCharacterRefs
      .map((characterRef) => this.store.createReflectionCandidate(characterRef))
      .filter(Boolean);
    for (const candidate of reflectionCandidates) emitTelemetry(this.telemetry, TelemetryEvent.GREEN_ROOM_REFLECTION_PROPOSED, {
      taskId: cognitiveTask.taskId, characterRef: candidate.characterRef, observationCount: candidate.observationCount,
    });
    emitTelemetry(this.telemetry, TelemetryEvent.GREEN_ROOM_BATCH_COMPLETED, {
      taskId: cognitiveTask.taskId, turnId: cognitiveTask.turnId, charactersEvaluated: batch.characters.length,
      destination, reflectionCandidates: reflectionCandidates.length,
    });
    return Object.freeze({
      kind: 'CharacterCognitionResult',
      status: 'SUCCESS',
      task: cognitiveTask,
      workerResult: result,
      batch,
      projection,
      reflectionCandidates: Object.freeze(reflectionCandidates),
      destination,
      canonicalMutation: false,
    });
  }

  invalidate(reason = {}) {
    const count = this.store.invalidate(reason);
    emitTelemetry(this.telemetry, TelemetryEvent.GREEN_ROOM_INVALIDATED, { count, reason: lifecycleReason(reason) });
    return count;
  }
}

export class ContinuousConsolidationWorker {
  constructor({
    executionLayer,
    backlog = new ConsolidationBacklog(),
    deduper = new ConsolidationProposalDeduper(),
    telemetry = null,
  } = {}) {
    if (!executionLayer || typeof executionLayer.execute !== 'function') throw new TypeError('ContinuousConsolidationWorker requires SpecialistExecutionLayer');
    this.executionLayer = executionLayer;
    this.backlog = backlog;
    this.deduper = deduper;
    this.telemetry = telemetry;
  }

  enqueue(unit) {
    const stored = this.backlog.enqueue(unit);
    emitTelemetry(this.telemetry, TelemetryEvent.CONSOLIDATION_UNIT_QUEUED, {
      unitId: stored.unitId, lineageId: stored.lineageId, artifactCount: stored.artifactRefs.length,
    });
    return stored;
  }

  async processNext({ now = 0, currentRevisionSet = null, inputResolver, turnId = 'background', correlationId = 'background:consolidation', profileId = null } = {}) {
    if (typeof inputResolver !== 'function') throw new TypeError('ContinuousConsolidationWorker requires inputResolver for bounded evidence');
    const unit = this.backlog.pending({ now })[0];
    if (!unit) return Object.freeze({ kind: 'ConsolidationWorkerResult', status: 'IDLE', canonicalMutation: false });
    return this.processUnit(unit.unitId, { currentRevisionSet, inputResolver, turnId, correlationId, profileId });
  }

  async processUnit(unitId, { currentRevisionSet = null, inputResolver, turnId = 'background', correlationId = 'background:consolidation', profileId = null } = {}) {
    if (typeof inputResolver !== 'function') throw new TypeError('ContinuousConsolidationWorker requires inputResolver for bounded evidence');
    const unit = this.backlog.list().find((row) => row.unitId === unitId);
    if (!unit) throw new Error('Unknown consolidation unit: ' + unitId);
    if (currentRevisionSet && consolidationFreshness(unit, currentRevisionSet) !== 'FRESH') {
      this.backlog.discardStale(currentRevisionSet);
      emitTelemetry(this.telemetry, TelemetryEvent.CONSOLIDATION_STALE_REJECTED, { unitId, lineageId: unit.lineageId });
      return Object.freeze({ kind: 'ConsolidationWorkerResult', status: 'STALE', unitId, canonicalMutation: false });
    }

    const task = createConsolidationTask(unit, { turnId, correlationId });
    const input = await inputResolver(unit, { task });
    let result;
    try {
      result = await this.executionLayer.execute(task, { input, profileId });
    } catch (error) {
      emitTelemetry(this.telemetry, TelemetryEvent.PROVIDER_FAILED, {
        taskId: task.taskId, turnId: task.turnId, taskClass: 'CONSOLIDATION', reason: error?.code ?? 'CONSOLIDATION_FAILED',
      });
      return Object.freeze({
        kind: 'ConsolidationWorkerResult', status: 'DEGRADED', unitId,
        failure: Object.freeze({ code: error?.code ?? 'CONSOLIDATION_FAILED', message: error?.message ?? String(error) }),
        canonicalMutation: false,
      });
    }

    const bundle = result.payload?.kind === 'ConsolidationProposalBundle'
      ? result.payload
      : createConsolidationProposalBundle({
        unitId,
        sourceRevisionSet: unit.sourceRevisionSet,
        proposals: [result.payload],
        provenance: { legacySingleProposal: true },
      }, {
        unitId,
        sourceRevisionSet: unit.sourceRevisionSet,
        worldRevision: unit.worldRevision,
        sceneRevision: unit.sceneRevision,
        characterStateRevision: unit.characterStateRevision,
        sourceArtifactRefs: unit.artifactRefs,
        policyVersion: unit.policyVersion,
      });
    const dedupe = this.deduper.accept(bundle);
    const acceptedBundle = createConsolidationProposalBundle({
      ...bundle,
      bundleId: bundle.bundleId,
      proposals: dedupe.accepted,
      validationReceipt: bundle.validationReceipt,
    }, {
      unitId,
      sourceRevisionSet: unit.sourceRevisionSet,
      worldRevision: unit.worldRevision,
      sceneRevision: unit.sceneRevision,
      characterStateRevision: unit.characterStateRevision,
      sourceArtifactRefs: unit.artifactRefs,
      policyVersion: unit.policyVersion,
      maxProposals: Math.max(1, bundle.proposals.length),
    });
    const checkpoint = createConsolidationCheckpoint(unit, {
      completedArtifactRefs: unit.artifactRefs,
      completedProposalIds: acceptedBundle.proposals.map((proposal) => proposal.proposalId),
      nextOffset: unit.artifactRefs.length,
    });
    this.backlog.checkpoint(unitId, checkpoint);
    emitTelemetry(this.telemetry, TelemetryEvent.CONSOLIDATION_SLICE_CHECKPOINTED, {
      unitId, proposalCount: acceptedBundle.proposals.length, duplicateCount: dedupe.duplicateCount,
    });
    this.backlog.complete(unitId);
    emitTelemetry(this.telemetry, TelemetryEvent.CONSOLIDATION_PROPOSALS_EMITTED, {
      unitId, proposalCount: acceptedBundle.proposals.length, duplicateCount: dedupe.duplicateCount,
    });
    return Object.freeze({
      kind: 'ConsolidationWorkerResult',
      status: 'SUCCESS',
      task,
      workerResult: result,
      bundle: acceptedBundle,
      dedupe,
      checkpoint,
      memoryHandoff: createMemoryOwnerHandoff(acceptedBundle, { currentRevisionSet }),
      destination: ResultDestination.BACKGROUND,
      canonicalMutation: false,
    });
  }

  yield(unitId, checkpoint) {
    const result = this.backlog.checkpoint(unitId, checkpoint);
    emitTelemetry(this.telemetry, TelemetryEvent.CONSOLIDATION_YIELDED, { unitId, resumeIdentity: result.resumeIdentity });
    return result;
  }

  resume(unitId, currentRevisionSet) {
    const decision = this.backlog.resume(unitId, currentRevisionSet);
    emitTelemetry(this.telemetry, TelemetryEvent.CONSOLIDATION_RESUMED, { unitId, action: decision.action });
    return decision;
  }
}

function canonicalBatchFromExecutionPayload(payload, task) {
  if (payload?.kind === 'GreenRoomBatch') return payload;
  const characters = (payload?.characters ?? []).map((row) => ({
    characterRef: row.characterRef ?? row.characterId,
    sceneRevision: row.sceneRevision ?? task.sceneRevision,
    evidenceRefs: row.evidenceRefs ?? row.directEvidenceRefs ?? [],
    priorInferenceRefs: row.priorInferenceRefs ?? [],
    sourceRevisionSet: row.sourceRevisionSet ?? task.sourceRevisionSet,
    confidence: row.confidence,
    dimensions: row.dimensions ?? pickDimensions(row),
    expiryCondition: row.expiry ?? row.expiryCondition ?? {},
    createdAt: row.createdAt ?? 0,
    updatedAt: row.updatedAt ?? row.createdAt ?? 0,
  }));
  return createGreenRoomBatch({ sceneRevision: task.sceneRevision, characters, sourceRevisionSet: task.sourceRevisionSet });
}
function pickDimensions(row) {
  const out = {};
  for (const key of ['guardedness','warmth','anger','trustTrend','anxiety','latentIntent','attentionTarget','socialPressure','uncertainty']) {
    if (key in row) out[key] = row[key];
  }
  return out;
}
function collectInputEvidenceRefs(input) {
  return [...new Set((input.characters ?? input.activeCast ?? []).flatMap((item) => {
    if (!item || typeof item === 'string') return [];
    return [
      ...(item.evidenceRefs ?? []), ...(item.sceneEvidenceRefs ?? []), ...(item.relationshipEvidenceRefs ?? []),
      ...(item.characterStateRefs ?? []), ...(item.unresolvedEvidenceRefs ?? []),
    ];
  }))];
}
function collectCategoryRefs(input, key) {
  return [...new Set((input.characters ?? input.activeCast ?? []).flatMap((item) => item && typeof item === 'object' ? item[key] ?? [] : []))];
}
function lifecycleReason(reason) {
  return Object.keys(reason).filter((key) => Boolean(reason[key])).sort().join('+') || 'UNSPECIFIED';
}
