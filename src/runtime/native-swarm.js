import { EVENT_TYPES } from './constants.js';
import { ForegroundQuorumController, RuntimeResultClass } from './foreground-quorum.js';
import { ProviderExecutionRegistry } from './provider-execution.js';
import { immutableCopy } from './utils.js';

const RESULT_CLASSES = new Set(Object.values(RuntimeResultClass));

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTurnEnvelope(input = {}) {
  const turnId = requiredString(input.turnId, 'turnId');
  const eventType = requiredString(input.eventType ?? EVENT_TYPES.TURN_EVENT, 'eventType');
  if (eventType !== EVENT_TYPES.TURN_EVENT) throw new TypeError(`Expected ${EVENT_TYPES.TURN_EVENT}, received ${eventType}`);
  const sourceRevisionSet = [...new Set((input.sourceRevisionSet ?? []).map((item) => requiredString(item, 'sourceRevisionSet item')))].sort();
  return immutableCopy({
    schemaVersion: String(input.schemaVersion ?? '1.0.0'),
    kind: input.kind ?? 'TurnCorrelationEnvelope',
    turnId,
    eventId: requiredString(input.eventId ?? `turn-event:${turnId}`, 'eventId'),
    eventType,
    eventVersion: String(input.eventVersion ?? input.schemaVersion ?? '1.0'),
    causationId: input.causationId == null ? null : requiredString(input.causationId, 'causationId'),
    correlationId: requiredString(input.correlationId ?? `corr:${turnId}`, 'correlationId'),
    taskId: input.taskId == null ? null : requiredString(input.taskId, 'taskId'),
    sourceRevisionSet,
    worldRevision: finite(input.worldRevision, 0),
    sceneRevision: finite(input.sceneRevision, 0),
    characterStateRevision: finite(input.characterStateRevision, 0),
    freshnessToken: input.freshnessToken == null ? null : requiredString(input.freshnessToken, 'freshnessToken'),
    createdAt: finite(input.createdAt, 0),
    deadline: finite(input.deadline, 0),
    cognitiveLayer: requiredString(input.cognitiveLayer ?? 'L1', 'cognitiveLayer'),
    requiredCapabilities: [...new Set(input.requiredCapabilities ?? [])].sort(),
    deliveryAttempt: Math.max(1, Math.trunc(finite(input.deliveryAttempt, 1))),
    dedupeKey: requiredString(input.dedupeKey ?? `turn:${turnId}`, 'dedupeKey'),
  });
}

function normalizeJob(job, turn) {
  if (!job || typeof job !== 'object') throw new TypeError('admitted cognitive job must be an object');
  if (job.kind != null && job.kind !== 'CognitiveTask') throw new TypeError(`Unsupported cognitive job kind: ${job.kind}`);
  const resultClass = job.resultClass ?? RuntimeResultClass.REQUIRED;
  if (!RESULT_CLASSES.has(resultClass)) throw new TypeError(`Unsupported resultClass: ${resultClass}`);
  const taskId = requiredString(job.taskId, 'job.taskId');
  const requiredCapabilities = [...new Set(job.requiredCapabilities ?? [])];
  const capabilityRequests = structuredClone(job.capabilityRequests ?? []);
  if (!requiredCapabilities.length && !capabilityRequests.length) throw new TypeError(`Cognitive job ${taskId} must declare capability requirements`);
  const turnId = requiredString(job.turnId ?? turn.turnId, 'job.turnId');
  if (turnId !== turn.turnId) throw new TypeError(`Cognitive job ${taskId} turnId does not match TURN_EVENT`);
  const correlationId = requiredString(job.correlationId ?? turn.correlationId, 'job.correlationId');
  if (correlationId !== turn.correlationId) throw new TypeError(`Cognitive job ${taskId} correlationId does not match TURN_EVENT`);
  const sourceRevisionSet = [...new Set(job.sourceRevisionSet ?? job.inputRevisionSet?.sourceRevisionSet ?? turn.sourceRevisionSet ?? [])].sort();
  const hardDeadline = finite(job.hardDeadline, finite(turn.deadline, 0));
  const softDeadline = finite(job.softDeadline, hardDeadline);
  if (hardDeadline > 0 && softDeadline > hardDeadline) throw new TypeError(`Cognitive job ${taskId} softDeadline exceeds hardDeadline`);
  return immutableCopy({
    ...structuredClone(job),
    kind: 'CognitiveTask',
    taskId,
    taskType: requiredString(job.taskType, 'job.taskType'),
    turnId,
    correlationId,
    causationId: job.causationId ?? turn.eventId,
    cognitiveLayer: requiredString(job.cognitiveLayer ?? turn.cognitiveLayer ?? 'L1', 'job.cognitiveLayer'),
    resultClass,
    requiredCapabilities,
    capabilityRequests,
    fallbackCapabilitySets: structuredClone(job.fallbackCapabilitySets ?? []),
    sourceRevisionSet,
    worldRevision: finite(job.worldRevision ?? job.inputRevisionSet?.worldRevision, turn.worldRevision),
    sceneRevision: finite(job.sceneRevision ?? job.inputRevisionSet?.sceneRevision, turn.sceneRevision),
    characterStateRevision: finite(job.characterStateRevision ?? job.inputRevisionSet?.characterStateRevision, turn.characterStateRevision),
    freshnessToken: job.freshnessToken ?? job.inputRevisionSet?.freshnessToken ?? job.metadata?.freshnessToken ?? turn.freshnessToken ?? null,
    softDeadline,
    hardDeadline,
    dedupeKey: requiredString(job.dedupeKey ?? `task:${taskId}`, 'job.dedupeKey'),
    fallbackPolicy: structuredClone(job.fallbackPolicy ?? { type: 'DETERMINISTIC', maxRetries: 1 }),
    outputSchema: structuredClone(job.outputSchema ?? { type: 'object' }),
    metadata: structuredClone(job.metadata ?? {}),
  });
}

function basePriority(job) {
  const byClass = {
    [RuntimeResultClass.REQUIRED]: 10,
    [RuntimeResultClass.OPPORTUNISTIC]: 35,
    [RuntimeResultClass.DEFERRED]: 70,
  };
  const qualityWeight = Number(job.metadata?.qualityWeight ?? job.qualityWeight ?? 0);
  return Math.max(0, Math.min(100, Number(job.metadata?.priority ?? byClass[job.resultClass]) - Math.min(10, Math.max(0, qualityWeight))));
}

function deterministicFallback(job) {
  if (job.deterministicFallback != null) return structuredClone(job.deterministicFallback);
  if (job.metadata?.deterministicFallback != null) return structuredClone(job.metadata.deterministicFallback);
  if (job.fallbackPolicy?.type === 'DETERMINISTIC' && ('result' in job.fallbackPolicy || 'payload' in job.fallbackPolicy)) {
    return structuredClone(job.fallbackPolicy.result ?? job.fallbackPolicy.payload);
  }
  return null;
}

export class NativeTurnRuntime {
  constructor({ director, providers = null, now = () => Date.now(), maxJobsPerTurn = 128 } = {}) {
    if (!director) throw new TypeError('NativeTurnRuntime requires a WorkerDirector');
    this.director = director;
    this.providers = providers ?? new ProviderExecutionRegistry({ director, now });
    this.quorum = new ForegroundQuorumController({ director, now });
    this.maxJobsPerTurn = maxJobsPerTurn;
    this.turns = new Map();
    this.unsubscribe = director.events.subscribe(EVENT_TYPES.TURN_EVENT, (event) => this.#consumeEvent(event));
    this.#recoverNativeRecords();
  }

  registerExecutionResource(resource) {
    return this.providers.registerResource(resource);
  }

  setExecutionResourceAvailability(workerId, available) {
    return this.providers.setAvailability(workerId, available);
  }

  setExecutionResourceHealth(workerId, health) {
    return this.providers.setHealth(workerId, health);
  }

  publishTurn(turnInput, admittedJobs = []) {
    if (!Array.isArray(admittedJobs)) throw new TypeError('admittedJobs must be an array');
    if (admittedJobs.length > this.maxJobsPerTurn) throw new RangeError(`TURN_EVENT admitted job set exceeds ${this.maxJobsPerTurn}`);
    const turn = normalizeTurnEnvelope(turnInput);
    const jobs = admittedJobs.map((job) => normalizeJob(job, turn));
    const event = this.director.events.emit(EVENT_TYPES.TURN_EVENT, { turn, admittedJobs: jobs }, {
      eventId: turn.eventId,
      schemaVersion: turn.eventVersion,
      producer: 'COGNITIVE_COPROCESSOR',
      causationId: turn.causationId,
      correlationId: turn.correlationId,
      turnId: turn.turnId,
      taskId: turn.taskId,
      revisionFences: {
        sourceRevisionIds: turn.sourceRevisionSet,
        worldRevision: turn.worldRevision,
        sceneRevision: turn.sceneRevision,
        characterStateRevision: turn.characterStateRevision,
      },
      sourceRevisions: { sourceRevisionSet: turn.sourceRevisionSet },
      worldRevision: turn.worldRevision,
      sceneRevision: turn.sceneRevision,
      createdAt: turn.createdAt,
      dedupeKey: turn.dedupeKey,
    });
    return { event, cohort: this.snapshotTurn(turn.turnId) };
  }

  consumeTurnEvent(event) {
    return this.#consumeEvent(event);
  }

  async awaitForeground(turnId, options = {}) {
    const cohort = this.turns.get(turnId);
    if (!cohort) throw new Error(`Unknown native turn: ${turnId}`);
    return this.quorum.awaitTurn(cohort, options);
  }

  cancelTask(taskId, reason = 'cancelled') {
    this.providers.cancelTask(taskId, reason);
    return this.director.cancelTask(taskId, reason);
  }

  snapshotTurn(turnId) {
    const cohort = this.turns.get(turnId);
    return cohort ? structuredClone(cohort) : null;
  }

  close() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  #consumeEvent(event) {
    if (!event || event.eventType !== EVENT_TYPES.TURN_EVENT) return null;
    const turn = normalizeTurnEnvelope(event.payload?.turn ?? event);
    const rawJobs = event.payload?.admittedJobs ?? [];
    if (!Array.isArray(rawJobs)) throw new TypeError('TURN_EVENT admittedJobs must be an array');
    if (rawJobs.length > this.maxJobsPerTurn) throw new RangeError(`TURN_EVENT admitted job set exceeds ${this.maxJobsPerTurn}`);
    const cohort = this.turns.get(turn.turnId) ?? {
      turnId: turn.turnId,
      correlationId: turn.correlationId,
      eventId: turn.eventId,
      required: [],
      opportunistic: [],
      deferred: [],
      rejected: [],
      taskIds: [],
    };
    this.turns.set(turn.turnId, cohort);

    for (const raw of rawJobs) {
      try {
        const job = normalizeJob(raw, turn);
        const admission = this.#submitJob(job, turn);
        if (!cohort.taskIds.includes(job.taskId)) cohort.taskIds.push(job.taskId);
        const bucket = job.resultClass === RuntimeResultClass.REQUIRED
          ? cohort.required
          : job.resultClass === RuntimeResultClass.OPPORTUNISTIC
            ? cohort.opportunistic
            : cohort.deferred;
        if (!bucket.includes(job.taskId)) bucket.push(job.taskId);
        this.director.telemetry.emit(admission.deduped ? 'NATIVE_SWARM_JOB_DEDUPED' : 'NATIVE_SWARM_JOB_ADMITTED', {
          turnId: turn.turnId,
          taskId: job.taskId,
          resultClass: job.resultClass,
          cognitiveLayer: job.cognitiveLayer,
        });
      } catch (error) {
        const taskId = raw?.taskId ?? null;
        cohort.rejected.push({ taskId, reason: error?.message ?? String(error) });
        this.director.telemetry.emit('NATIVE_SWARM_JOB_REJECTED', { turnId: turn.turnId, taskId, reason: error?.message ?? String(error) });
      }
    }
    this.director.telemetry.emit('NATIVE_TURN_ACCEPTED', {
      turnId: turn.turnId,
      correlationId: turn.correlationId,
      admittedJobs: cohort.taskIds.length,
      rejectedJobs: cohort.rejected.length,
    });
    return structuredClone(cohort);
  }

  #submitJob(job, turn) {
    const fallback = deterministicFallback(job);
    const freshnessToken = job.freshnessToken ?? job.metadata?.freshnessToken ?? turn.freshnessToken ?? job.intentFingerprint ?? job.dedupeKey;
    const requestedDestination = job.requestedDestination ?? job.metadata?.requestedDestination ?? null;
    const inputPayload = job.metadata?.providerInput ?? job.metadata?.input ?? {
      taskId: job.taskId,
      taskType: job.taskType,
      turnId: job.turnId,
      correlationId: job.correlationId,
    };
    const obligation = {
      taskId: job.taskId,
      taskType: job.taskType,
      owner: job.owner ?? job.metadata?.owner ?? job.taskType,
      producerId: job.producerId ?? job.metadata?.producerId ?? 'COGNITIVE_COPROCESSOR',
      runtimeClass: 'NATIVE_COGNITIVE',
      layer: job.cognitiveLayer,
      requiredCapabilities: job.requiredCapabilities,
      capabilityRequests: job.capabilityRequests,
      fallbackCapabilitySets: job.fallbackCapabilitySets,
      sourceRevisions: { sourceRevisionSet: job.sourceRevisionSet },
      sourceRevisionIds: job.sourceRevisionSet,
      worldRevision: job.worldRevision,
      sceneRevision: job.sceneRevision,
      revision: job.revision ?? job.metadata?.revision ?? Math.max(job.worldRevision ?? 0, job.sceneRevision ?? 0, job.characterStateRevision ?? 0),
      priority: Number.isFinite(job.priority) ? job.priority : basePriority(job),
      deadline: job.hardDeadline > 0 ? job.hardDeadline : null,
      deadlineClass: job.deadlineClass ?? job.metadata?.deadlineClass ?? job.resultClass,
      foreground: job.resultClass !== RuntimeResultClass.DEFERRED,
      foregroundSensitivity: job.foregroundSensitivity ?? job.metadata?.foregroundSensitivity ?? (job.resultClass !== RuntimeResultClass.DEFERRED),
      resourceLimits: structuredClone(job.metadata?.resourceLimits ?? {}),
      batchHint: { maxSliceUnits: 1, ...(job.batchHint ?? {}) },
      checkpointPolicy: { maxUnitsPerCheckpoint: 1 },
      yieldPolicy: structuredClone(job.metadata?.yieldPolicy ?? {}),
      dedupeKey: `native:${turn.dedupeKey}:${job.dedupeKey}`,
      conflictKey: job.metadata?.conflictKey ?? null,
      speculative: job.resultClass !== RuntimeResultClass.REQUIRED,
      resultContract: {
        kind: 'CognitiveWorkerResult',
        schemaVersion: job.schemaVersion ?? '1.0.0',
        resultClass: job.resultClass,
        requestedDestination,
        compilerLane: job.compilerLane ?? null,
        contextSealPolicy: job.contextSealPolicy ?? 'BEFORE_SEAL_ONLY',
        outputSchema: structuredClone(job.outputSchema),
        authorityGranted: false,
      },
      payload: {
        turnId: job.turnId,
        correlationId: job.correlationId,
        causationId: job.causationId,
        freshnessToken,
        resultClass: job.resultClass,
        softDeadline: job.softDeadline,
        hardDeadline: job.hardDeadline,
        qualityWeight: Number(job.qualityWeight ?? job.metadata?.qualityWeight ?? 0),
        deterministicFallback: fallback,
        fallbackPolicy: structuredClone(job.fallbackPolicy),
        providerTimeoutMs: job.providerTimeoutMs ?? job.metadata?.providerTimeoutMs ?? null,
        requestedDestination,
        intentFingerprint: job.intentFingerprint ?? null,
        characterStateRevision: job.characterStateRevision,
        outputSchema: structuredClone(job.outputSchema),
        cognitiveTask: structuredClone(job),
      },
    };
    return this.director.submit(obligation, {
      units: [{ id: `${job.taskId}:provider`, payload: structuredClone(inputPayload) }],
      ...this.providers.executorFor(job),
    });
  }

  #recoverNativeRecords() {
    for (const record of this.director.ledger.list()) {
      if (record.obligation.runtimeClass !== 'NATIVE_COGNITIVE') continue;
      const job = record.obligation.payload?.cognitiveTask;
      if (!job) continue;
      try {
        this.director.attachExecutor(record.taskId, this.providers.executorFor(job));
      } catch {
        // Completed records do not need an executor; malformed persisted payloads remain visible in the ledger.
      }
      const turnId = record.obligation.payload?.turnId;
      if (!turnId) continue;
      const cohort = this.turns.get(turnId) ?? {
        turnId,
        correlationId: record.obligation.payload?.correlationId ?? null,
        eventId: null,
        required: [], opportunistic: [], deferred: [], rejected: [], taskIds: [],
      };
      if (!cohort.taskIds.includes(record.taskId)) cohort.taskIds.push(record.taskId);
      const resultClass = record.obligation.payload?.resultClass ?? RuntimeResultClass.REQUIRED;
      const bucket = resultClass === RuntimeResultClass.REQUIRED ? cohort.required : resultClass === RuntimeResultClass.OPPORTUNISTIC ? cohort.opportunistic : cohort.deferred;
      if (!bucket.includes(record.taskId)) bucket.push(record.taskId);
      this.turns.set(turnId, cohort);
    }
  }
}
