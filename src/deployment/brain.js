import { Area52CognitiveCore } from '../cognitive-core.js';
import {
  CandidateFreshness,
  CandidateTruthStatus,
  RetrievalChannelCapability,
  RetrievalChannelHealth,
  createChannelNomination,
  createRetrievalChannelDescriptor,
} from '../candidate-bus-contracts.js';
import { LoreStudyRuntime } from '../lore-study-runtime.js';
import { LoreHierarchyRetrievalSystem } from '../lore-hierarchy-retrieval-system.js';
import { SceneLifecycleRuntime } from '../scene/scene-lifecycle-runtime.js';
import { ObservationClass, createFieldState } from '../scene/contracts.js';
import { CAPABILITIES, CognitiveRuntimeHost, RuntimeResultClass, WorkerDirector } from '../runtime/index.js';
import { createJevDomainAdapterMatrix } from '../coprocessor/jev-adapter-matrix.js';
import { JevDecisionShape, JevOutcome } from '../coprocessor/jev-contracts.js';
import { JevDomain } from '../coprocessor/jev-domain-adapter.js';
import { LoreJevDecisionKind, LoreReconciliationClassification } from '../coprocessor/jev-lore-adapter.js';

const CHANNEL_ID = 'NATIVE_LORE_RUNTIME';
const uniq = (values) => [...new Set((values ?? []).filter(Boolean).map(String))].sort();
const clone = (value) => value == null ? value : structuredClone(value);

function field(value, revision, evidenceRef, observationClass = ObservationClass.OBSERVED, confidence = 1) {
  return createFieldState({
    value,
    revision,
    evidenceRefs: observationClass === ObservationClass.UNKNOWN ? [] : [evidenceRef],
    observationClass,
    confidence,
    provenance: observationClass === ObservationClass.UNKNOWN ? [] : [evidenceRef],
  });
}

function localJevExecutor() {
  return {
    hasEligibleProvider() { return true; },
    async execute(request, { attempt = 1 } = {}) {
      const evidenceUsed = request.evidenceRefs.filter((row) => row.available !== false && row.stale !== true).map((row) => row.evidenceId).slice(0, 8);
      return {
        decision: {
          outcome: JevOutcome.ABSTAINED,
          decisionCode: JevDecisionShape.ABSTAIN,
          selectedOptionIds: [],
          rejectedOptionIds: [],
          classification: null,
          reasonCodes: ['BOUNDED_AMBIGUITY_PRESERVED'],
          evidenceUsed,
          unresolvedFactors: ['Owner evidence supports more than one unresolved Lore interpretation.'],
          confidence: 0.35,
          abstained: true,
          escalationTarget: null,
          requiresOperator: false,
          explanation: 'Jev abstained; Lore owner settlement remains authoritative.',
        },
        providerProvenance: {
          providerProfileId: 'area52.local.one-resource',
          providerId: 'area52.local',
          modelId: 'deterministic-bounded-jev',
          workerId: 'area52-local-resource',
          capability: CAPABILITIES.SEMANTIC_JUDGMENT,
          attempt,
        },
        latencyMetadata: { providerLatencyMs: 0, validationLatencyMs: 0, totalLatencyMs: 0, attempts: attempt },
        payloadBytes: JSON.stringify(request).length,
      };
    },
  };
}

class RuntimePreparedLoreChannel {
  constructor({ loreSystem, core, sourceMap }) {
    this.loreSystem = loreSystem;
    this.core = core;
    this.sourceMap = sourceMap;
    this.prepared = new Map();
    this.descriptor = createRetrievalChannelDescriptor({
      channelId: CHANNEL_ID,
      capabilities: [RetrievalChannelCapability.SPARSE, RetrievalChannelCapability.RAPTOR, RetrievalChannelCapability.GRAPHRAG_COMMUNITY],
      supportedIntentKinds: ['*'],
      maxCandidates: 64,
      health: RetrievalChannelHealth.HEALTHY,
      available: true,
      metadata: {
        source: 'LORE_WAVE3_RUNTIME_PREPARED',
        runtimeRequired: true,
        candidateBusAdmissionAuthority: false,
        settlementAuthority: false,
      },
    });
  }

  prepare(query, { intent = 'AUTO' } = {}) {
    const result = this.loreSystem.query({ query, intent });
    const nominations = result.nominations.map((row) => this.#toCoreNomination(row)).filter(Boolean);
    const prepared = Object.freeze({
      kind: 'RuntimePreparedLoreResult',
      query: String(query),
      laneResult: clone(result),
      nominations,
      sourceDrillbackAvailable: true,
      authorityGranted: false,
      candidateBusAdmissionAuthority: false,
      settlementAuthority: false,
    });
    this.prepared.set(String(query), prepared);
    return prepared;
  }

  retrieve(intent, context = {}) {
    const query = String(intent?.query ?? context.query ?? '');
    const prepared = this.prepared.get(query);
    if (!prepared) throw new Error('NATIVE_LORE_NOT_PREPARED_BY_RUNTIME');
    return prepared.nominations.map((row) => createChannelNomination({
      ...row,
      retrievalIntentIds: [intent.intentId],
      worldRevision: context.worldRevision ?? null,
      sceneRevision: context.sceneRevision ?? null,
    }));
  }

  drillDown(nomination) {
    const lane = nomination?.metadata?.laneNomination;
    return lane ? this.loreSystem.drillDown(lane) : [];
  }

  #toCoreNomination(lane) {
    const drill = this.loreSystem.drillDown(lane);
    const mappings = drill.map((row) => this.sourceMap.get(row.sourceId)).filter(Boolean);
    if (!mappings.length) return null;
    const claimRefs = uniq(mappings.flatMap((row) => row.claimIds));
    const sourceRevisionRefs = uniq(mappings.map((row) => row.coreRevisionId));
    if (!claimRefs.length) return null;
    const laneSourceRevisionRefs = uniq(drill.map((row) => row.sourceRevisionId));
    const truth = claimRefs.map((id) => this.core.graph.getClaim(id)?.status).filter(Boolean);
    const truthStatusHint = truth.includes('UNRESOLVED') || truth.includes('UNCERTAIN') || truth.includes('CONTRADICTED')
      ? CandidateTruthStatus.UNRESOLVED
      : truth.length && truth.every((x) => ['HISTORICAL', 'SUPERSEDED'].includes(x))
        ? CandidateTruthStatus.HISTORICAL
        : truth.includes('CURRENT')
          ? CandidateTruthStatus.CURRENT
          : CandidateTruthStatus.UNKNOWN;
    return {
      nominationId: CHANNEL_ID + ':' + lane.nominationId,
      channelId: CHANNEL_ID,
      candidateId: 'deployment:' + lane.candidateId,
      evidenceIdentity: lane.evidenceIdentity + ':core',
      artifactRef: lane.artifactRef,
      artifactRevision: lane.artifactRevision,
      sourceRevisionRefs,
      claimRefs,
      eventRefs: lane.eventRefs ?? [],
      entityRefs: lane.entityRefs ?? [],
      relationshipRefs: lane.relationshipRefs ?? [],
      rankSignals: { ...(lane.rankSignals ?? {}), runtimePrepared: true },
      normalizedRank: lane.normalizedRank,
      graphMetadata: lane.graphMetadata,
      temporalHints: lane.temporalHints ?? [],
      continuitySignals: lane.continuitySignals ?? [],
      authorityClass: lane.authorityClass === 'SOURCE_CANON' ? 'SOURCE_CANON' : 'UNRESOLVED',
      truthStatusHint,
      provenance: [
        ...(lane.provenance ?? []),
        ...drill.map((row) => ({ kind: 'LoreLaneSourceDrillback', sourceId: row.sourceId, sourceRevisionId: row.sourceRevisionId })),
      ],
      evidenceRefs: uniq([...(lane.evidenceRefs ?? []), ...laneSourceRevisionRefs]),
      dependencyRevisions: sourceRevisionRefs,
      freshness: CandidateFreshness.FRESH,
      representationRef: lane.representationRef,
      representationRevision: lane.representationRevision,
      representationText: lane.representationText,
      metadata: {
        ...(lane.metadata ?? {}),
        laneSourceRevisionRefs,
        laneNomination: clone(lane),
        runtimePrepared: true,
        sourceDrillbackAvailable: true,
        candidateBusAdmissionAuthority: false,
        settlementAuthority: false,
      },
    };
  }
}

function runtimeWorker(workerId) {
  return {
    workerId,
    capabilities: [CAPABILITIES.CPU_ANALYSIS, CAPABILITIES.GRAPH, CAPABILITIES.SEMANTIC_JUDGMENT],
    supportedLayers: ['L0', 'L1', 'L2', 'L3', 'L4'],
    resourceProfile: { CPU: 1 },
    concurrencyCapacity: 1,
    latencyScore: 1,
    provider: 'area52-local',
    implementationId: 'deployment-native-resource',
    model: 'local-deterministic',
    foregroundEligible: true,
    backgroundEligible: true,
    available: true,
  };
}

function taskFor({ turn, suffix, taskType, capability, resultClass = RuntimeResultClass.REQUIRED, metadata = {} }) {
  const now = Date.now();
  return {
    schemaVersion: '1.0.0',
    kind: 'CognitiveTask',
    taskId: 'task:' + turn.turnId + ':' + suffix,
    taskType,
    turnId: turn.turnId,
    correlationId: turn.correlationId,
    requiredCapabilities: [capability],
    capabilityRequests: [{ id: capability, minVersion: 1, preferredVersion: 1 }],
    fallbackCapabilitySets: [],
    cognitiveLayer: resultClass === RuntimeResultClass.DEFERRED ? 'L3' : 'L1',
    resultClass,
    sourceRevisionSet: [...turn.sourceRevisionSet],
    worldRevision: turn.worldRevision,
    sceneRevision: turn.sceneRevision,
    characterStateRevision: turn.characterStateRevision,
    softDeadline: now + 3000,
    hardDeadline: now + 6000,
    dedupeKey: 'deployment:' + turn.turnId + ':' + suffix,
    fallbackPolicy: { type: 'DETERMINISTIC', maxRetries: 1, result: { value: 'UNAVAILABLE_SAFE_FALLBACK' } },
    outputSchema: { type: 'object', required: ['value'] },
    contextSealPolicy: 'BEFORE_SEAL_ONLY',
    compilerLane: 'externalGrounding',
    intentFingerprint: 'deployment:' + turn.turnId + ':' + suffix,
    metadata: {
      freshnessToken: 'fresh:' + turn.turnId + ':' + suffix,
      requestedDestination: resultClass === RuntimeResultClass.DEFERRED ? 'BACKGROUND' : 'FOREGROUND',
      ...metadata,
    },
  };
}

function attachIdentity(value, selection) {
  if (value == null) return null;
  if (typeof value !== 'object') return value;
  return {
    ...clone(value),
    chatId: value.chatId ?? selection.chatId,
    turnId: value.turnId ?? selection.turnId,
    generationId: value.generationId ?? selection.generationId,
    correlationId: value.correlationId ?? selection.correlationId,
    worldRevision: value.worldRevision ?? selection.worldRevision,
    sceneRevision: value.sceneRevision ?? selection.sceneRevision,
    sourceRevisionRefs: value.sourceRevisionRefs ?? selection.sourceRevisionRefs,
  };
}

export class DevelopmentDeploymentBrain {
  constructor({ resourceCount = 1, jevAvailable = true } = {}) {
    if (!Number.isInteger(resourceCount) || resourceCount < 1 || resourceCount > 8) throw new TypeError('resourceCount must be 1-8');
    this.resourceCount = resourceCount;
    this.jevAvailable = Boolean(jevAvailable);
    this.core = new Area52CognitiveCore();
    this.lore = new LoreStudyRuntime();
    this.loreSystem = new LoreHierarchyRetrievalSystem({ runtime: this.lore });
    this.scene = new SceneLifecycleRuntime();
    this.sourceMap = new Map();
    this.loreChannel = new RuntimePreparedLoreChannel({ loreSystem: this.loreSystem, core: this.core, sourceMap: this.sourceMap });
    this.core.registerRetrievalChannel(this.loreChannel);
    this.jev = createJevDomainAdapterMatrix({ providerExecutor: localJevExecutor() });
    this.runtimeResults = [];
    this.turns = new Map();
    this.listeners = new Set();
    this.selectedTurnId = null;
    this.runtimeDirector = new WorkerDirector({
      persistence: null,
      capacity: { CPU: resourceCount },
      foregroundReserve: { CPU: 1 },
      batch: { base: 1, max: 1 },
      maxRetries: 1,
      isTurnSealed: (turnId) => this.core.publication.seal.isTurnSealed(turnId),
      resultSink: (result) => this.runtimeResults.push(clone(result)),
    });
    this.runtime = new CognitiveRuntimeHost({ director: this.runtimeDirector });
    const adapter = { invoke: (ctx) => this.#invokeRuntime(ctx) };
    for (let i = 0; i < resourceCount; i += 1) this.runtime.registerExecutionResource({ worker: runtimeWorker('area52-local-' + (i + 1)), adapter });
    this.core.registerJevAdapter({
      invoke: (request) => {
        const proposal = this.turns.get(request.turnId)?.jevProposal ?? this.pendingJev?.get?.(request.turnId) ?? null;
        if (!proposal) throw new Error('Runtime Jev proposal unavailable for this turn');
        return {
          status: proposal.abstained ? 'ABSTAINED' : proposal.status,
          abstained: Boolean(proposal.abstained),
          decisionId: proposal.jevReceiptRef ?? proposal.sourceRequestRef ?? ('jev:' + request.turnId),
          decisionRevision: proposal.revisionFence?.domainRevisions?.lore ?? null,
        };
      },
    });
    this.pendingJev = new Map();
  }

  ingestLorebook({ id = 'golden', title = 'Golden Lore', entries = [] } = {}) {
    const rows = this.lore.ingestLorebook({ id, title, entries, fullSnapshot: true });
    for (const row of rows) {
      if (!row.revision || row.revision.state === 'REMOVED') continue;
      if (row.obligation) this.lore.run(row.obligation.id);
      const sourceId = row.revision.sourceId;
      const entry = entries.find((candidate) => String(candidate.uid) === String(row.revision.uid ?? this.lore.registry.getEntry(sourceId)?.uid));
      const content = row.revision.exactContent;
      const at = Number(entry?.metadata?.at ?? row.revision.metadata?.at ?? 0);
      if (this.core.registry.getSource(sourceId)) {
        this.core.editAndRelearn(sourceId, content);
      } else {
        this.core.importAndLearn({
          id: sourceId,
          sourceType: 'LOREBOOK_ENTRY',
          content,
          at,
          metadata: { ...(row.revision.metadata ?? {}), lorebookId: id, uid: this.lore.registry.getEntry(sourceId)?.uid ?? null, laneRevisionId: row.revision.id },
        });
      }
      const coreRevision = this.core.registry.getActiveRevision(sourceId);
      const claimIds = this.core.graph.allClaims()
        .filter((claim) => (claim.provenance?.sourceRevisionIds ?? []).includes(coreRevision.id))
        .map((claim) => claim.id)
        .sort();
      this.sourceMap.set(sourceId, { laneRevisionId: row.revision.id, coreRevisionId: coreRevision.id, claimIds });
    }
    this.loreSystem.rebuild();
    return {
      lane: this.lore.publicSurface(),
      retrieval: this.loreSystem.diagnostics(),
      coreWorld: this.core.currentWorldModel(),
      mappingCount: this.sourceMap.size,
    };
  }

  observeScene({ chatId, sourceRevisionId, location, activeCast = [], activeThreads = [], objects = [], atmosphere = null } = {}) {
    const evidenceRef = String(sourceRevisionId);
    const scene = this.scene.ensureChatScene(String(chatId), { sourceRevisionRefs: [evidenceRef], evidenceRefs: [evidenceRef] });
    const nextRevision = scene.revision + 1;
    const fields = {
      location: field(typeof location === 'string' ? { location } : location, nextRevision, evidenceRef),
      activeCast: field(activeCast.map((id) => typeof id === 'string' ? { characterId: id, state: 'PRESENT' } : id), nextRevision, evidenceRef),
      activeThreads: field(activeThreads, nextRevision, evidenceRef),
      immediateObjects: field(objects, nextRevision, evidenceRef),
    };
    if (atmosphere != null) fields.atmosphere = field(atmosphere, nextRevision, evidenceRef, ObservationClass.INFERRED, 0.6);
    this.scene.sceneRuntime.observe({
      sceneId: scene.sceneId,
      proposalId: 'deployment-scene:' + evidenceRef,
      fields,
      sourceRevisionRefs: [evidenceRef],
      evidenceRefs: [evidenceRef],
    });
    const signal = this.scene.integrationSignal(String(chatId));
    if (this.core.hotCognition.activeChatNamespace !== String(chatId)) this.core.activateHotCognitionChat(String(chatId));
    this.core.consumeSceneSignal(signal, { chatNamespace: String(chatId) });
    return signal;
  }

  async runTurn({
    chatId = 'chat:deployment',
    turnId,
    generationId,
    query,
    intent = 'CURRENT',
    mode = 'retrieval',
    anchorEntityIds = [],
  } = {}) {
    if (!turnId || !generationId || !query) throw new TypeError('turnId, generationId and query are required');
    const sceneSignal = this.scene.integrationSignal(String(chatId));
    if (!sceneSignal) throw new Error('A native Scene must be observed before running a turn');
    const sourceRevisionSet = this.core.registry.activeRevisionIds();
    const turn = {
      schemaVersion: '1.0.0',
      kind: 'TurnCorrelationEnvelope',
      turnId: String(turnId),
      eventId: 'turn-event:' + turnId,
      eventType: 'TURN_EVENT',
      eventVersion: '1.0.0',
      correlationId: 'corr:' + turnId,
      causationId: 'host:' + turnId,
      sourceRevisionSet,
      worldRevision: this.core.graph.revision,
      sceneRevision: sceneSignal.sceneRevision,
      characterStateRevision: 0,
      createdAt: Date.now(),
      deadline: 0,
      cognitiveLayer: 'L1',
      deliveryAttempt: 1,
      dedupeKey: 'turn:' + turnId,
    };

    let planning = null;
    const jobs = [];
    if (mode !== 'simple') {
      planning = this.loreSystem.query({ query, intent: 'AUTO' });
      jobs.push(taskFor({ turn, suffix: 'lore', taskType: 'LORE_RETRIEVAL', capability: CAPABILITIES.CPU_ANALYSIS, metadata: { query, intent: 'AUTO' } }));
      jobs.push(taskFor({ turn, suffix: 'graph', taskType: 'GRAPH_LOOKUP', capability: CAPABILITIES.GRAPH, metadata: { query } }));
      if (mode === 'ambiguous' && this.jevAvailable) {
        jobs.push(taskFor({
          turn,
          suffix: 'jev',
          taskType: 'JEV_DECISION',
          capability: CAPABILITIES.SEMANTIC_JUDGMENT,
          resultClass: RuntimeResultClass.OPPORTUNISTIC,
          metadata: { jevInput: this.#makeJevInput({ turn, query, planning }) },
        }));
      }
    }

    const publishedRuntime = this.runtime.publishTurn(turn, jobs);
    const foreground = await this.runtime.native.awaitForeground(turn.turnId);
    await this.runtimeDirector.drain();

    const published = this.core.publishGenerationContext({
      turnId: turn.turnId,
      turnRevision: 1,
      correlationId: turn.correlationId,
      generationId: String(generationId),
      query,
      intent,
      anchorEntityIds,
      channelIds: mode === 'simple' ? null : [CHANNEL_ID],
      budgetBytes: 3000,
      activeThreads: sceneSignal.activeThreads ?? [],
    });
    const delivery = this.core.deliverGenerationContext({
      published,
      generationId: String(generationId),
      modelProfileId: 'CACHE_STABLE',
      userInput: query,
    });

    const selection = {
      chatId: String(chatId),
      turnId: turn.turnId,
      generationId: String(generationId),
      correlationId: turn.correlationId,
      worldRevision: published.worldRevision,
      sceneRevision: published.sceneRevision,
      sourceRevisionRefs: [...sourceRevisionSet],
    };
    const runtimeResultRows = this.runtimeResults.filter((row) => row.turnId === turn.turnId);
    const resourceIds = uniq(runtimeResultRows.map((row) => row.providerProvenance?.workerId).filter(Boolean));
    const scatter = attachIdentity({
      kind: 'DeploymentRuntimeScatterReceipt',
      jobs: jobs.map((job) => ({ taskId: job.taskId, taskType: job.taskType, resultClass: job.resultClass, capability: job.requiredCapabilities[0] })),
      admittedJobCount: jobs.length,
      resourceCount: resourceIds.length || (jobs.length ? this.resourceCount : 0),
      resourceIds,
      requiredSatisfied: foreground.requiredSatisfied,
      requiredFallback: foreground.requiredFallback,
      opportunisticReady: foreground.opportunisticReady,
      opportunisticPending: foreground.opportunisticPending,
      deferred: foreground.deferred,
      authorityGranted: false,
    }, selection);

    const record = {
      selection,
      turn,
      runtimeEvent: publishedRuntime.event,
      runtimeCohort: publishedRuntime.cohort,
      foreground,
      runtimeResults: runtimeResultRows,
      scatter,
      scene: this.scene.uiReadModel(String(chatId)),
      loreStatus: {
        kind: 'DeploymentLoreStatus',
        ...this.loreSystem.diagnostics(),
        study: this.lore.publicSurface(),
        channelId: CHANNEL_ID,
        externalServiceRequired: false,
      },
      planning,
      jevProposal: this.pendingJev.get(turn.turnId) ?? null,
      published,
      delivery,
    };
    this.turns.set(turn.turnId, record);
    this.selectedTurnId = turn.turnId;
    this.#emit({ type: 'TURN_COMMITTED', selection });
    return clone(record);
  }

  hostBindings() {
    const get = (selection = null) => {
      const turnId = selection?.turnId ?? this.selectedTurnId;
      return turnId ? this.turns.get(String(turnId)) ?? null : null;
    };
    return {
      readSelection: () => clone(get()?.selection ?? {}),
      subscribe: (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); },
      readScene: (selection) => attachIdentity(get(selection)?.scene, get(selection)?.selection ?? {}),
      readPromptPlan: (selection) => attachIdentity(get(selection)?.delivery?.plan, get(selection)?.selection ?? {}),
      readContextReceipt: (selection) => attachIdentity(get(selection)?.published?.compilerReceipt, get(selection)?.selection ?? {}),
      readContextSeal: (selection) => attachIdentity(get(selection)?.published?.sealReceipt, get(selection)?.selection ?? {}),
      readIntegrityReceipt: (selection) => attachIdentity(get(selection)?.delivery?.integrityReceipt, get(selection)?.selection ?? {}),
      readCognitiveChoice: (selection) => attachIdentity(get(selection)?.published?.cognitiveChoiceReceipt, get(selection)?.selection ?? {}),
      readScatter: (selection) => clone(get(selection)?.scatter ?? null),
      readSensoryTrace: (selection) => attachIdentity(get(selection)?.published?.candidateEnvelope, get(selection)?.selection ?? {}),
      readCandidateBusEnvelope: (selection) => attachIdentity(get(selection)?.published?.candidateEnvelope, get(selection)?.selection ?? {}),
      readCandidateFusionReceipt: (selection) => attachIdentity(get(selection)?.published?.candidateEnvelope?.fusionReceipt, get(selection)?.selection ?? {}),
      readTruth: (selection) => attachIdentity(get(selection)?.published?.assessment, get(selection)?.selection ?? {}),
      readCorrectiveRetrieval: (selection) => attachIdentity(get(selection)?.published?.corrective, get(selection)?.selection ?? {}),
      readJev: (selection) => attachIdentity(get(selection)?.jevProposal, get(selection)?.selection ?? {}),
      readPrecision: (selection) => attachIdentity({
        kind: 'DeploymentPrecisionReceipt',
        resultCount: get(selection)?.published?.precisionResults?.length ?? 0,
        failed: Boolean(get(selection)?.published?.precisionFailed),
      }, get(selection)?.selection ?? {}),
      readGather: (selection) => attachIdentity(get(selection)?.published?.gatherReceipt, get(selection)?.selection ?? {}),
      readLoreStatus: (selection) => attachIdentity(get(selection)?.loreStatus, get(selection)?.selection ?? {}),
    };
  }

  selectTurn(turnId) {
    if (!this.turns.has(String(turnId))) throw new Error('Unknown deployment turn: ' + turnId);
    this.selectedTurnId = String(turnId);
    this.#emit({ type: 'SELECTION_CHANGED', selection: this.turns.get(this.selectedTurnId).selection });
    return clone(this.turns.get(this.selectedTurnId).selection);
  }

  diagnostics() {
    return {
      kind: 'DevelopmentDeploymentDiagnostics',
      resourceCount: this.resourceCount,
      jevAvailable: this.jevAvailable,
      selectedTurnId: this.selectedTurnId,
      turnCount: this.turns.size,
      lore: this.loreSystem.diagnostics(),
      sceneCount: this.scene.registry.list().length,
      runtime: this.runtimeDirector.diagnostics?.() ?? null,
      sensory: this.core.sensoryDiagnostics(),
      externalDatabaseRequired: false,
      externalOrchestrationRequired: false,
      remoteProviderRequired: false,
      mainMutationAuthority: false,
    };
  }

  async #invokeRuntime({ task }) {
    if (task.taskType === 'LORE_RETRIEVAL') {
      const prepared = this.loreChannel.prepare(task.metadata.query, { intent: task.metadata.intent ?? 'AUTO' });
      return { value: 'LORE_PREPARED', nominationCount: prepared.nominations.length, retrievalIntentId: prepared.laneResult.retrievalIntentId };
    }
    if (task.taskType === 'GRAPH_LOOKUP') {
      const model = this.core.currentWorldModel();
      return { value: 'GRAPH_SNAPSHOT', worldRevision: model.revision, currentCount: model.current.length, unresolvedCount: model.unresolved.length };
    }
    if (task.taskType === 'JEV_DECISION') {
      const input = task.metadata.jevInput;
      const currentRevisionState = {
        sourceRevisionSet: input.sourceRevisionSet,
        worldRevision: input.worldRevision,
        sceneRevision: input.sceneRevision,
        characterStateRevision: input.characterStateRevision,
        domainRevisions: { lore: input.loreRevision, owner: input.ownerRevision },
        freshnessToken: input.freshnessToken,
      };
      const proposal = await this.jev.service.adjudicate(input, {
        currentRevisionState,
        sealed: () => this.core.publication.seal.isTurnSealed(task.turnId),
      });
      this.pendingJev.set(task.turnId, clone(proposal));
      return { value: proposal.proposedOutcome, proposal };
    }
    return { value: 'NO_OP', taskType: task.taskType };
  }

  #makeJevInput({ turn, query, planning }) {
    const sourceNominations = (planning?.nominations ?? []).filter((row) => /sun blade/i.test(row.representationText ?? '')).slice(0, 8);
    const rows = sourceNominations.length >= 2 ? sourceNominations : (planning?.nominations ?? []).slice(0, 8);
    const evidence = rows.map((row, index) => ({
      evidenceId: 'lore-evidence:' + turn.turnId + ':' + index,
      sourceRef: row.representationRef,
      summary: String(row.representationText ?? query).slice(0, 1200),
      provenanceRefs: uniq([...(row.sourceRevisionRefs ?? []), ...(row.evidenceRefs ?? [])]).slice(0, 16),
      revision: row.representationRevision ?? 1,
      available: true,
      stale: false,
    }));
    const refs = evidence.map((row) => row.evidenceId);
    return {
      domain: JevDomain.LORE,
      decisionKind: LoreJevDecisionKind.RECONCILIATION,
      decisionId: 'deployment-jev:' + turn.turnId,
      turnId: turn.turnId,
      taskId: 'task:' + turn.turnId + ':jev',
      correlationId: turn.correlationId,
      causationId: turn.eventId,
      owner: 'LORE_OWNER',
      options: [
        { optionId: LoreReconciliationClassification.TEMPORALLY_DISTINCT, evidenceRefs: refs, label: 'Preserve temporal distinction' },
        { optionId: LoreReconciliationClassification.CONTRADICTORY, evidenceRefs: refs, label: 'Preserve contradiction' },
      ],
      evidence,
      provenanceRefs: uniq(rows.flatMap((row) => row.sourceRevisionRefs ?? [])),
      sourceRevisionSet: [...turn.sourceRevisionSet],
      worldRevision: turn.worldRevision,
      sceneRevision: turn.sceneRevision,
      characterStateRevision: turn.characterStateRevision,
      loreRevision: this.loreSystem.diagnostics().hierarchyRevision ?? 'lore:1',
      ownerRevision: turn.worldRevision,
      freshnessToken: 'deployment-jev-fresh:' + turn.turnId,
      deadline: Date.now() + 5000,
      softDeadline: Date.now() + 3000,
      maxRetries: 0,
      exactDuplicate: false,
    };
  }

  #emit(event) {
    for (const listener of [...this.listeners]) listener(clone(event));
  }
}

export function createGoldenDeploymentLorebook() {
  return {
    id: 'ember-golden',
    title: 'Ember Tavern Golden',
    entries: [
      { uid: 'mara', content: 'Mara opens the Ember Tavern at River District.', metadata: { title: 'Mara and Ember Tavern', at: 1, treePath: ['People', 'Mara'] } },
      { uid: 'eris', content: 'The Sun Blade was left inside the Ember Tavern.', metadata: { title: 'Eris and Sun Blade', at: 2, treePath: ['Objects', 'Sun Blade'] } },
      { uid: 'tavern-intact', content: 'The Ember Tavern is intact.', metadata: { title: 'Ember Tavern Before Fire', at: 3, treePath: ['Places', 'Ember Tavern'] } },
      { uid: 'fire', content: 'The Ember Tavern burns down. The Sun Blade is destroyed in the fire.', metadata: { title: 'Ember Tavern Fire', at: 10, treePath: ['Events', 'Fire'] } },
      { uid: 'blade-report-a', content: 'A recovered journal claims someone removed the Sun Blade shortly before the fire.', metadata: { title: 'Sun Blade Removed Report', at: 12, claimAt: 9, treePath: ['Reports', 'Sun Blade'] } },
      { uid: 'blade-report-b', content: 'A later recovered journal claims the Sun Blade survived the fire.', metadata: { title: 'Sun Blade Survival Report', at: 13, claimAt: 10, treePath: ['Reports', 'Sun Blade'] } },
    ],
  };
}

export const DEVELOPMENT_DEPLOYMENT_CHANNEL_ID = CHANNEL_ID;
