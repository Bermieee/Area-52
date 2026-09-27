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
import { LoreIntelligenceService } from '../lore-intelligence-service.js';
import { reviewLoreJevAdvisory } from '../lore-jev-owner-review.js';
import { LoreAuthoringService } from '../lore-authoring-service.js';
import { MemoryTemporalProducer } from '../memory-temporal-producer.js';
import { createMemoryIntegrationSurface } from '../memory-integration-surface.js';
import { LoreHierarchyRetrievalSystem } from '../lore-hierarchy-retrieval-system.js';
import { SceneLoreHandoffAdapter } from '../scene-lore-handoff.js';
import { SceneLifecycleRuntime } from '../scene/scene-lifecycle-runtime.js';
import { SceneStateExtractor } from '../scene/scene-state-extractor.js';
import { SceneEventPublisher } from '../scene/event-publisher.js';
import { SceneContextInvalidationPublisher } from '../scene/context-invalidation.js';
import { ObservationClass, createFieldState } from '../scene/contracts.js';
import { SceneEventType } from '../scene/lifecycle-contracts.js';
import { SceneJevOwnerAdjudicator, SceneOwnerDecision } from '../scene/jev-owner.js';
import { CAPABILITIES, CognitiveRuntimeHost, RuntimeResultClass, WorkerDirector } from '../runtime/index.js';
import { CausalReasonCode } from '../runtime/causal-receipts.js';
import { createJevDomainAdapterMatrix } from '../coprocessor/jev-adapter-matrix.js';
import { createCoprocessorResourceHost } from '../coprocessor/resource-host-adapter.js';
import { CoprocessorResourceConnections } from '../coprocessor/resource-connections.js';
import { NativeHotDeepScheduler } from '../coprocessor/native-hot-deep-scheduler.js';
import { Capability as CoprocessorCapability } from '../coprocessor/constants.js';
import { RuntimeDirectorAdmissionBridge, createResourceDirectorExecutor } from '../coprocessor/runtime-director-bridge.js';
import { createSceneObservationTask } from '../coprocessor/scene-observation-specialist.js';
import { createJevCognitiveTask, createJevProviderInput } from '../coprocessor/jev-decision-core.js';
import { adjudicateJevForOwner } from '../coprocessor/owner-integration.js';
import { ContinuousConsolidationWorker } from '../coprocessor/cognitive-worker-pipelines.js';
import { createConsolidationUnit } from '../coprocessor/continuous-consolidation.js';
import { createOwnerGraphProviders } from './owner-graph-adapters.js';
import { CoprocessorTelemetry } from '../coprocessor/telemetry.js';
import { JevDecisionShape, JevOutcome } from '../coprocessor/jev-contracts.js';
import { JevDomain } from '../coprocessor/jev-domain-adapter.js';
import { NativeSidecarSwarm } from '../coprocessor/native-sidecar-swarm.js';
import { plannerInputFromScene } from '../coprocessor/scene-signal-adapter.js';
import { LoreJevDecisionKind, LoreReconciliationClassification } from '../coprocessor/jev-lore-adapter.js';

const CHANNEL_ID = 'NATIVE_LORE_RUNTIME';
const uniq = (values) => [...new Set((values ?? []).filter(Boolean).map(String))].sort();
const clone = (value) => value == null ? value : structuredClone(value);
const payloadSizeClass=(n)=>n<512?'XS':n<2048?'S':n<8192?'M':n<32768?'L':'XL';
const heapSample=()=>Number(globalThis.performance?.memory?.usedJSHeapSize??0)||null;
const sceneCausalAdmissionReason=(reasonCode,accepted)=>{
  if(accepted)return CausalReasonCode.OWNER_ACCEPTED;
  if(reasonCode==='SCENE_PROPOSAL_STALE_REVISION')return CausalReasonCode.STALE_RESULT;
  if(reasonCode==='SCENE_PROPOSAL_LATE_AFTER_SEAL')return CausalReasonCode.LATE_RESULT;
  if(reasonCode==='SCENE_PROPOSAL_SELECTION_SUPERSEDED')return CausalReasonCode.SUPERSEDED;
  return CausalReasonCode.OWNER_REJECTED;
};
const unsupportedDeterministicStudy = (error) => /^RuleBasedStudyAdapter has no deterministic extractor for:/.test(String(error?.message ?? error));
const SCENE_CURRENT_OBLIGATION_EVENT_TYPES=new Set([
  SceneEventType.SCENE_STATE_DELTA,SceneEventType.LOCATION_CHANGED,SceneEventType.TIME_SHIFT_DETECTED,
  SceneEventType.ACTIVE_CAST_CHANGED,SceneEventType.RELATIONSHIP_SIGNAL,SceneEventType.SCENE_BOUNDARY_CANDIDATE,
  SceneEventType.SCENE_BOUNDARY_CONFIRMED,SceneEventType.SCENE_CLOSED,SceneEventType.SCENE_OPENED,
  SceneEventType.VIBE_CHANGED,SceneEventType.PREFETCH_RECOMMENDED,SceneEventType.OBJECT_TRANSITION,
]);


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
          unresolvedFactors: ['Owner evidence supports more than one unresolved interpretation.'],
          confidence: 0.35,
          abstained: true,
          escalationTarget: null,
          requiresOperator: false,
          explanation: 'Jev abstained; domain-owner settlement remains authoritative.',
        },
        providerProvenance: {
          providerProfileId: 'area52.local.one-resource',
          providerId: 'area52.local',
          modelId: 'deterministic-bounded-jev',
          workerId: 'area52-local-resource',
          capability: CAPABILITIES.SEMANTIC_JUDGMENT,
          attempt,
          measurementClass: 'LOCAL_DETERMINISTIC',
          evidenceClass: 'DETERMINISTIC_LOCAL_FIXTURE',
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

  admitSceneCandidates(query, handoff) {
    const original = this.prepared.get(String(query));
    if (!original || handoff?.status !== 'SYNCED') return 0;
    const allowed = new Set((handoff.candidates ?? []).map((row) => `${row.sourceId}|${row.sourceRevisionId}`));
    const admitted = [];
    for (const request of handoff.need?.queries ?? []) {
      const result = this.loreSystem.query({ query: request.query, intent: 'NARROW' });
      for (const lane of result.nominations ?? []) {
        const drill = this.loreSystem.drillDown(lane);
        if (!drill.length || !drill.every((row) => allowed.has(`${row.sourceId}|${row.sourceRevisionId}`))) continue;
        const nomination = this.#toCoreNomination(lane);
        if (!nomination) continue;
        nomination.metadata.sceneLoreNeedId = handoff.need.needId;
        nomination.metadata.sceneLoreQueryId = request.queryId;
        admitted.push(nomination);
      }
    }
    const byId = new Map(original.nominations.map((row) => [row.nominationId, row]));
    for (const row of admitted) byId.set(row.nominationId, row);
    this.prepared.set(String(query), Object.freeze({ ...original, nominations: [...byId.values()] }));
    return admitted.length;
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
        semanticExtraction: mappings.every((row) => row.extractionMode === 'SEMANTIC') ? 'SEMANTIC' : 'RAW_SOURCE_ONLY',
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
  constructor({ resourceCount = 1, jevAvailable = true, loreOwnerSnapshot = null, memoryOwnerSnapshot = null, loreJevOwnerReview = null } = {}) {
    if (!Number.isInteger(resourceCount) || resourceCount < 1 || resourceCount > 8) throw new TypeError('resourceCount must be 1-8');
    if (loreJevOwnerReview !== null && typeof loreJevOwnerReview !== 'function') throw new TypeError('loreJevOwnerReview must be a function');
    this.resourceCount = resourceCount;
    this.jevAvailable = Boolean(jevAvailable);
    this.loreJevOwnerReview = loreJevOwnerReview ?? ((proposal) => reviewLoreJevAdvisory(proposal, {
      currentLoreRevision: this.loreSystem.diagnostics().hierarchyRevision ?? 'lore:1',
    }));
    this.core = new Area52CognitiveCore();
    if (loreOwnerSnapshot?.intelligence) {
      this.loreIntelligence = LoreIntelligenceService.fromSnapshot(loreOwnerSnapshot.intelligence);
      this.lore = this.loreIntelligence.runtime;
      this.loreSystem = this.loreIntelligence.hierarchy;
      this.loreAuthoring = loreOwnerSnapshot.authoring
        ? LoreAuthoringService.fromSnapshot(loreOwnerSnapshot.authoring, { intelligence: this.loreIntelligence })
        : new LoreAuthoringService({ intelligence: this.loreIntelligence });
    } else {
      this.lore = new LoreStudyRuntime();
      this.loreSystem = new LoreHierarchyRetrievalSystem({ runtime: this.lore });
      this.loreIntelligence = new LoreIntelligenceService({ runtime: this.lore, hierarchy: this.loreSystem });
      this.loreAuthoring = new LoreAuthoringService({ intelligence: this.loreIntelligence });
    }
    this.loreSettlementEvents = clone(loreOwnerSnapshot?.settlementEvents ?? []);
    this.sceneOwnerTimeline = [];
    this.sceneEventSpineReceipts = [];
    this.sceneEventObligationReceipts = [];
    const sceneTimelineSink = (type) => (value) => {
      this.sceneOwnerTimeline.push({ type, value: clone(value) });
      if (this.sceneOwnerTimeline.length > 256) this.sceneOwnerTimeline.splice(0, this.sceneOwnerTimeline.length - 256);
    };
    const sceneTimelineEventSink=sceneTimelineSink('EVENT');
    this.scene = new SceneLifecycleRuntime({
      publisher: new SceneEventPublisher({ sink: sceneTimelineEventSink }),
      contextInvalidationPublisher: new SceneContextInvalidationPublisher({ sink: sceneTimelineSink('INVALIDATION') }),
    });
    this.sceneObservationExtractor = new SceneStateExtractor({ agent: 'area52-cognitive-resource' });
    this.sceneObservationReceipts = [];
    this.memory = new MemoryTemporalProducer({ snapshot: memoryOwnerSnapshot });
    this.memorySurface = createMemoryIntegrationSurface(this.memory);
    this.sourceMap = new Map();
    this.loreChannel = new RuntimePreparedLoreChannel({ loreSystem: this.loreSystem, core: this.core, sourceMap: this.sourceMap });
    this.core.registerRetrievalChannel(this.loreChannel);
    this.coprocessorTelemetry = new CoprocessorTelemetry({ limit: 2000 });
    this.resourceConnections = new CoprocessorResourceConnections({ telemetry: this.coprocessorTelemetry });
    this.scenePrefetchSwarm = new NativeSidecarSwarm({ connections: this.resourceConnections, telemetry: this.coprocessorTelemetry });
    this.scenePrefetchConsiderations = [];
    this.resourceDirectorResults = [];
    this.resourceOwnerReceipts = [];
    this.resourceDirector = new WorkerDirector({
      persistence: null,
      capacity: { CPU: Math.max(1, Number(resourceCount) || 1) },
      foregroundReserve: { CPU: 1 },
      batch: { base: 1, max: 1 },
      maxRetries: 0,
      isTurnSealed: (turnId) => this.core.publication.seal.isTurnSealed(turnId),
      resultSink: (result) => this.resourceDirectorResults.push(clone(result)),
    });
    this.resourcePlacementScheduler = new NativeHotDeepScheduler({
      resourceSlots: Math.max(1, Number(resourceCount) || 1),
      foregroundReserve: 1,
      maxDeepQueue: Math.max(2, Number(resourceCount) || 1),
    });
    this.resourceDirectorBridge = new RuntimeDirectorAdmissionBridge({
      director: this.resourceDirector,
      capabilityRegistry: this.resourceConnections.profiles,
      placementScheduler: this.resourcePlacementScheduler,
    });
    this.optionalResources = createCoprocessorResourceHost({
      connections: this.resourceConnections,
      telemetry: this.coprocessorTelemetry,
      scheduler: this.resourcePlacementScheduler,
      ownerReceipts: () => this.resourceOwnerReceipts,
    });
    this.memoryNearlineReceipts=[];
    this.memory.attachVectorExecutor(async(request)=>{
      const resources=this.resourceConnections.readModel().resources??[];
      const vector=resources.find((row)=>row.transportMode==='EMBEDDINGS'&&row.callable===true&&row.selectedModelQualified===true);
      if(!vector)return{status:'UNAVAILABLE',reasonCode:'VECTOR_PROVIDER_UNAVAILABLE',requestPurpose:'COGNITIVE_EXECUTION',foregroundBudgetMs:request.operation==='EMBED_QUERY'?1200:null};
      const foreground=request.operation==='EMBED_QUERY';
      const controller=foreground?new AbortController():null;
      const timer=foreground?setTimeout(()=>controller.abort('MEMORY_VECTOR_QUERY_BUDGET_EXCEEDED'),1200):null;
      try{
        return await this.resourceConnections.executeEmbedding(vector.resourceId,{input:request.input,signal:controller?.signal??null,
          origin:{operation:request.operation,selection:request.selection??{chatId:request.chatId??null},workId:request.workId??null,artifactId:request.artifactId??null,artifactRevision:request.artifactRevision??null}});
      }catch(error){
        if(foreground&&controller.signal.aborted)return{status:'UNAVAILABLE',executionId:error?.executionId??null,reasonCode:'VECTOR_QUERY_BUDGET_EXCEEDED',requestPurpose:'COGNITIVE_EXECUTION',foregroundBudgetMs:1200};
        throw error;
      }finally{
        if(timer)clearTimeout(timer);
      }
    });
    this.memory.subscribeMemory((event)=>{
      if(event?.type==='MEMORY_COMPLETED_TURN_ADMITTED')this.#scheduleMemoryVectorMaintenance('MEMORY_COMPLETED_TURN_ADMITTED');
    });
    this.jevExecution = new Map();
    const liveJevExecutor = this.optionalResources.execution.createJevProviderExecutor();
    const fixtureJevExecutor = localJevExecutor();
    this.jev = createJevDomainAdapterMatrix({
      providerExecutor: {
        hasEligibleProvider: (request, prefilter) => liveJevExecutor.hasEligibleProvider(request, prefilter) || fixtureJevExecutor.hasEligibleProvider(request, prefilter),
        execute: async (request, options = {}) => {
          const turnId = String(request?.turnId ?? request?.decisionId ?? 'unknown');
          if (liveJevExecutor.hasEligibleProvider(request, options.prefilter)) {
            try {
              const result = await this.#executeLiveJevThroughDirector(liveJevExecutor, request, options);
              this.jevExecution.set(turnId, {
                kind: 'DeploymentJevExecutionEvidence',
                status: 'LIVE_PROVIDER',
                fallbackUsed: false,
                providerProvenance: clone(result.providerProvenance ?? null),
                failure: null,
              });
              return result;
            } catch (error) {
              this.jevExecution.set(turnId, {
                kind: 'DeploymentJevExecutionEvidence',
                status: 'LIVE_PROVIDER_FAILED_NATIVE_FALLBACK',
                fallbackUsed: true,
                providerProvenance: null,
                failure: { code: error?.code ?? 'PROVIDER_FAILURE', message: String(error?.message ?? error) },
              });
            }
          }
          const result = await fixtureJevExecutor.execute(request, options);
          const prior = this.jevExecution.get(turnId);
          this.jevExecution.set(turnId, {
            kind: 'DeploymentJevExecutionEvidence',
            status: prior?.status ?? 'DETERMINISTIC_LOCAL_FIXTURE',
            fallbackUsed: Boolean(prior?.fallbackUsed),
            providerProvenance: clone(result.providerProvenance ?? null),
            failedLiveAttempt: clone(prior?.failure ?? null),
          });
          return result;
        },
      },
    });
    this.sceneJevOwner = new SceneJevOwnerAdjudicator({ service: this.jev.service });
    this.runtimeResults = [];
    this.turns = new Map();
    this.listeners = new Set();
    this.selectedTurnId = null;
    this.sceneLoreHandoff = new SceneLoreHandoffAdapter({
      getLoreInterface: () => this.loreIntelligence.brainInterface(),
      getCurrentContext: (need) => {
        const signal = this.scene.integrationSignal(String(need.chatId));
        const knownTurn = this.turns.get(String(need.turnId))?.selection ?? null;
        return {
          activeChatId: this.core.hotCognition?.activeChatNamespace ?? null,
          sceneId: signal?.sceneId ?? null,
          sceneRevision: signal?.sceneRevision ?? null,
          turnId: knownTurn?.turnId ?? null,
          generationId: knownTurn?.generationId ?? null,
        };
      },
      isTurnSealed: (turnId) => Boolean(this.core.publication.seal.isTurnSealed(turnId)),
    });
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
    this.scene.publisher.registerWithRuntimeRegistry(this.runtimeDirector.eventTypes);
    const sceneRuntimeSink=this.scene.publisher.runtimeSink(this.runtimeDirector.events);
    this.scene.publisher.sink=(event)=>{
      sceneTimelineEventSink(event);
      try{
        const runtimeEvent=sceneRuntimeSink(event);
        this.#retainSceneEventSpineReceipt({
          status:'ACCEPTED',reasonCode:'EVENT_SPINE_ACCEPTED',event,runtimeEvent,
        });
        return runtimeEvent;
      }catch(error){
        this.#retainSceneEventSpineReceipt({
          status:'REJECTED',reasonCode:String(error?.code??'EVENT_SPINE_REJECTED'),event,errorMessage:String(error?.message??error).slice(0,240),
        });
        return null;
      }
    };
    const adapter = { invoke: (ctx) => this.#invokeRuntime(ctx) };
    for (let i = 0; i < resourceCount; i += 1) this.runtime.registerExecutionResource({ worker: runtimeWorker('area52-local-' + (i + 1)), adapter });
    this.core.registerJevAdapter({
      invoke: (request) => {
        const proposal = this.turns.get(request.turnId)?.jevProposal ?? this.pendingJev?.get?.(request.turnId) ?? null;
        const admission = this.turns.get(request.turnId)?.jevOwnerAdmission ?? this.pendingJevAdmission?.get?.(request.turnId) ?? null;
        if (!proposal) throw new Error('Runtime Jev proposal unavailable for this turn');
        return {
          status: admission?.accepted ? proposal.status : admission?.status ?? 'PENDING_OWNER_CONTRACT',
          abstained: !admission?.accepted || Boolean(proposal.abstained),
          decisionId: proposal.jevReceiptRef ?? proposal.sourceRequestRef ?? ('jev:' + request.turnId),
          decisionRevision: proposal.revisionFence?.domainRevisions?.lore ?? null,
        };
      },
    });
    this.pendingJev = new Map();
    this.pendingJevAdmission = new Map();
  }

  acceptLorebook(input = {}) {
    const ownerReceipt = this.loreIntelligence.acceptLorebook(input);
    this.loreSystem = this.loreIntelligence.hierarchy;
    const result = {
      kind: 'DeploymentLoreAcceptanceReceipt',
      accepted: true,
      processed: false,
      retrievable: false,
      lorebookId: ownerReceipt.lorebookId,
      entryCount: ownerReceipt.acceptedEntryCount,
      changedCount: ownerReceipt.changes.filter((row) => row.changed !== false).length,
      ownerReceipt: clone(ownerReceipt),
      study: this.lore.publicSurface(),
      intelligence: this.loreIntelligence.status(),
      retrieval: this.loreSystem.diagnostics(),
    };
    this.#emit({ type: 'LORE_ACCEPTED', result });
    return clone(result);
  }

  runLoreStudy({ scope = 'DUE' } = {}) {
    const ownerReceipt = this.loreIntelligence.runStudy({ scope });
    for (const entry of this.lore.registry.listEntries({ includeRemoved: false })) {
      const revision = this.lore.registry.currentRevision(entry.sourceId, { allowMissing: true });
      if (!revision || revision.state === 'REMOVED') continue;
      this.#syncLoreRevision(revision);
    }
    this.loreSystem = this.loreIntelligence.hierarchy;
    const diagnostics = this.loreSystem.diagnostics();
    const result = {
      kind: 'DeploymentLoreStudyReceipt',
      accepted: this.lore.registry.listEntries({ includeRemoved: true }).length > 0,
      processed: true,
      requestedScope: String(scope),
      completedObligationCount: ownerReceipt.results?.length ?? 0,
      retrievable: this.sourceMap.size > 0,
      ownerReceipt: clone(ownerReceipt),
      lane: this.lore.publicSurface(),
      intelligence: this.loreIntelligence.status(),
      retrieval: diagnostics,
      coreWorld: this.core.currentWorldModel(),
      mappingCount: this.sourceMap.size,
      rawSourceOnlyCount: [...this.sourceMap.values()].filter((row) => row.extractionMode === 'RAW_SOURCE_ONLY').length,
      semanticExtractionCount: [...this.sourceMap.values()].filter((row) => row.extractionMode === 'SEMANTIC').length,
    };
    this.#emit({ type: 'LORE_STUDIED', result });
    return clone(result);
  }

  ingestLorebook(input = {}) {
    this.acceptLorebook(input);
    return this.runLoreStudy({ scope: 'DUE' });
  }

  snapshotLoreOwner() {
    return {
      kind: 'DevelopmentDeploymentLoreOwnerSnapshot',
      contractVersion: 1,
      intelligence: this.loreIntelligence.snapshot(),
      authoring: this.loreAuthoring.snapshot(),
      settlementEvents: clone(this.loreSettlementEvents),
    };
  }

  snapshotMemoryOwner() {
    return this.memory.snapshot();
  }

  ensureScene({ chatId, sourceRevisionId } = {}) {
    const chat = String(chatId ?? '').trim();
    const evidenceRef = String(sourceRevisionId ?? '').trim();
    if (!chat) throw new TypeError('chatId is required');
    if (!evidenceRef) throw new TypeError('sourceRevisionId is required');
    this.scene.ensureChatScene(chat, { sourceRevisionRefs: [evidenceRef], evidenceRefs: [evidenceRef] });
    const signal = this.scene.integrationSignal(chat);
    if (this.core.hotCognition.activeChatNamespace !== chat) this.core.activateHotCognitionChat(chat);
    this.core.consumeSceneSignal(signal, { chatNamespace: chat });
    return clone(signal);
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
    const observed = this.scene.sceneRuntime.observe({
      sceneId: scene.sceneId,
      proposalId: 'deployment-scene:' + evidenceRef,
      fields,
      sourceRevisionRefs: [evidenceRef],
      evidenceRefs: [evidenceRef],
    });
    const signal = this.scene.integrationSignal(String(chatId));
    if (this.core.hotCognition.activeChatNamespace !== String(chatId)) this.core.activateHotCognitionChat(String(chatId));
    this.core.consumeSceneSignal(signal, { chatNamespace: String(chatId) });
    return {
      ...signal,
      observationApplied: Boolean(observed.applied),
      delta: clone(observed.delta ?? null),
    };
  }

  async runSceneObservationWork({
    chatId,turnId,generationId,correlationId=null,sourceRevisionId,narrative,
    phase='FOREGROUND_USER',parentWorkId=null,foregroundBudgetMs=1200,
  }={}){
    const chat=String(chatId??'').trim(),turn=String(turnId??'').trim(),generation=String(generationId??'').trim();
    const sourceRef=String(sourceRevisionId??'').trim(),text=String(narrative??'').trim();
    if(!chat||!turn||!generation||!sourceRef||!text)throw new TypeError('Scene observation work requires chatId, turnId, generationId, sourceRevisionId, and narrative');
    const correlation=String(correlationId??('corr:'+generation));
    const current=this.scene.ensureChatScene(chat,{sourceRevisionRefs:[sourceRef],evidenceRefs:[sourceRef]});
    const dispatchedScene=clone(current);
    const task=createSceneObservationTask({
      chatId:chat,turnId:turn,generationId:generation,correlationId:correlation,sourceRevisionId:sourceRef,
      sceneRevision:current.revision,worldRevision:this.core.graph.revision,phase,parentWorkId,
      foregroundBudgetMs,now:Date.now(),
    });
    this.#syncOptionalDirectorProfiles();
    let workerResult=null,executionError=null;
    const baseExecutor=createResourceDirectorExecutor({
      connections:this.resourceConnections,task,
      inputResolver:()=>({
        narrative:text,phase,sceneId:dispatchedScene.sceneId,baseRevision:dispatchedScene.revision,
        evidenceRef:sourceRef,sourceRevisionId:sourceRef,
      }),
    });
    const executor={
      ...baseExecutor,
      execute:async(context)=>{
        try{workerResult=await baseExecutor.execute(context);return workerResult;}
        catch(error){executionError=error;throw error;}
      },
    };
    const contextTokens=Math.max(1,Math.ceil(new TextEncoder().encode(text).length/4));
    const admission=this.resourceDirectorBridge.admit(task,{
      executor,units:[{id:task.taskId+':unit',payload:{sourceRevisionId:sourceRef,sceneRevision:current.revision,phase}}],
      constraints:{contextTokens,expectedOutputTokens:700,maxCostClass:'HIGH',requireStructuredOutput:true},
      owner:'SCENE_OBSERVATION_WORKER',
    });
    if(admission.status!=='ADMITTED'){
      const receipt=this.#sceneObservationExecutionReceipt({
        task,admission,status:'SKIPPED',reasonCode:'SCENE_OBSERVATION_'+String(admission.status??'UNAVAILABLE'),
        attempted:false,returned:false,workerResult:null,sourceRevisionId:sourceRef,sceneRevision:current.revision,parentWorkId,
      });
      this.#retainSceneObservationReceipt(receipt);
      return{kind:'SceneObservationWorkResult',status:'SKIPPED',proposal:null,boundarySignals:{},executionReceipt:receipt};
    }
    await this.resourceDirector.runCycle({waitForTaskIds:[task.taskId]});
    const directorRecord=this.resourceDirector.ledger.get(task.taskId);
    const complete=directorRecord?.executionStatus==='COMPLETE'&&workerResult?.status==='SUCCESS';
    if(!complete){
      const receipt=this.#sceneObservationExecutionReceipt({
        task,admission,status:'DEGRADED',reasonCode:executionError?.code??directorRecord?.lastError?.code??'SCENE_OBSERVATION_EXECUTION_FAILED',
        attempted:true,returned:false,workerResult:null,sourceRevisionId:sourceRef,sceneRevision:current.revision,parentWorkId,
      });
      this.#retainSceneObservationReceipt(receipt);
      return{kind:'SceneObservationWorkResult',status:'DEGRADED',proposal:null,boundarySignals:{},executionReceipt:receipt};
    }
    let proposal;
    try{
      const fields={};
      for(const [name,row] of Object.entries(workerResult.payload?.fields??{})){
        const observationClass=row?.observationClass??ObservationClass.UNKNOWN;
        fields[name]={
          value:clone(row?.value??null),confidence:Number(row?.confidence??0),observationClass,
          evidenceRefs:observationClass===ObservationClass.UNKNOWN?[]:[sourceRef],
          provenance:observationClass===ObservationClass.UNKNOWN?[]:['area52-cognitive-resource:'+sourceRef],
        };
      }
      proposal=this.sceneObservationExtractor.propose({
        scene:dispatchedScene,evidence:{id:sourceRef,sourceRevisionId:sourceRef},fields,
        provider:String(workerResult.providerId??'area52-cognitive-resource'),
      });
    }catch(error){
      this.resourceDirector.recordOwnerAdmission(task.taskId,{accepted:false,reasonCode:'SCENE_PROPOSAL_CONTRACT_INVALID',consumerId:'SCENE_OWNER'});
      const receipt=this.#sceneObservationExecutionReceipt({
        task,admission,status:'INVALID',reasonCode:error?.code??'SCENE_PROPOSAL_CONTRACT_INVALID',
        attempted:true,returned:true,workerResult,sourceRevisionId:sourceRef,sceneRevision:current.revision,parentWorkId,invalid:true,
      });
      this.#retainSceneObservationReceipt(receipt);
      return{kind:'SceneObservationWorkResult',status:'INVALID',proposal:null,boundarySignals:{},executionReceipt:receipt};
    }
    const receipt=this.#sceneObservationExecutionReceipt({
      task,admission,status:'RETURNED',reasonCode:'SCENE_OBSERVATION_PROPOSAL_RETURNED',
      attempted:true,returned:true,workerResult,sourceRevisionId:sourceRef,sceneRevision:current.revision,parentWorkId,
      fieldNames:Object.keys(proposal.fields??{}),ambiguityCount:(workerResult.payload?.ambiguities??[]).length,
    });
    this.#retainSceneObservationReceipt(receipt);
    return{
      kind:'SceneObservationWorkResult',status:'RETURNED',proposal,
      boundarySignals:clone(workerResult.payload?.boundarySignals??{}),ambiguities:clone(workerResult.payload?.ambiguities??[]),executionReceipt:receipt,
    };
  }

  async adjudicateSceneObservationAmbiguity({
    work,hostEvent,currentSelection=true,turnSealed=false,
  }={}){
    const proposal=work?.proposal,execution=work?.executionReceipt??null;
    const ambiguity=Array.isArray(work?.ambiguities)?work.ambiguities[0]??null:null;
    const selected=()=>typeof currentSelection==='function'?Boolean(currentSelection()):Boolean(currentSelection);
    const sealed=()=>typeof turnSealed==='function'?Boolean(turnSealed()):Boolean(turnSealed);
    const finish=(status,reasonCode,extra={})=>{
      const receipt={
        kind:'DeploymentSceneJevAdvisoryReceipt',contractVersion:1,status,reasonCode,
        chatId:execution?.chatId??null,turnId:execution?.turnId??null,generationId:execution?.generationId??null,correlationId:execution?.correlationId??null,
        workId:execution?.workId??null,sourceRevisionId:execution?.sourceRevisionId??null,
        sceneId:proposal?.sceneId??null,sceneRevision:proposal?.baseRevision??execution?.sceneRevision??null,
        ambiguityId:ambiguity?.ambiguityId??null,decisionKind:ambiguity?.decisionKind??null,field:ambiguity?.field??null,
        alternativeCount:Array.isArray(ambiguity?.alternatives)?ambiguity.alternatives.length:0,
        accepted:status==='ADVISED',unresolved:status!=='ADVISED',
        authority:'ADVISORY',authorityGranted:false,canonicalMutation:false,settlementPerformed:false,contextSealAuthority:false,
        rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
        ...clone(extra),
      };
      this.#retainSceneObservationReceipt(receipt);
      return receipt;
    };
    if(!proposal||proposal.kind!=='SceneObservationProposal'||!ambiguity)return finish('SKIPPED','SCENE_JEV_NO_BOUNDED_AMBIGUITY');
    if(!selected())return finish('UNRESOLVED','SCENE_JEV_SELECTION_SUPERSEDED',{stale:true});
    const phase=execution?.phase??'FOREGROUND_USER';
    if(phase!=='POST_RESPONSE'&&sealed())return finish('UNRESOLVED','SCENE_JEV_LATE_AFTER_SEAL',{late:true});
    if(!this.jevAvailable)return finish('UNRESOLVED','JEV_SERVICE_UNAVAILABLE',{degraded:true});
    const current=this.scene.registry.current(proposal.sceneId);
    if(!current||Number(current.revision)!==Number(proposal.baseRevision))return finish('UNRESOLVED','SCENE_JEV_STALE_REVISION',{stale:true});
    const hostSource=String(hostEvent?.sourceRevisionId??'').trim();
    if(!hostSource||!(proposal.sourceRevisionRefs??[]).includes(hostSource)||!(proposal.evidenceRefs??[]).includes(hostSource))return finish('UNRESOLVED','SCENE_JEV_SOURCE_FENCE_MISMATCH',{invalid:true});
    const alternatives=Array.isArray(ambiguity.alternatives)?ambiguity.alternatives:[];
    if(alternatives.length<2||alternatives.length>4)return finish('UNRESOLVED','SCENE_JEV_INVALID_ALTERNATIVES',{invalid:true});
    const optionIds=new Set(alternatives.map(row=>String(row.optionId)));
    const now=Date.now();
    const freshnessToken=['scene',proposal.sceneId,proposal.baseRevision,hostSource,ambiguity.ambiguityId].join(':');
    const input={
      domain:JevDomain.SCENE,decisionKind:String(ambiguity.decisionKind),
      decisionId:['scene-jev',execution?.generationId??execution?.turnId??'unknown',ambiguity.ambiguityId].join(':'),
      turnId:String(execution?.turnId??'scene-turn'),taskId:['task',execution?.workId??execution?.turnId??'scene','jev',ambiguity.ambiguityId].join(':'),
      correlationId:String(execution?.correlationId??('corr:'+(execution?.turnId??'scene'))),causationId:execution?.workId??null,
      owner:'SCENE_OWNER',
      options:alternatives.map(row=>({
        optionId:String(row.optionId),label:String(row.label??row.optionId).slice(0,160),
        evidenceRefs:[hostSource],provenanceRefs:[hostSource],
        payload:{field:String(ambiguity.field),candidateValue:clone(row.value),candidateConfidence:Number(row.confidence??0)},
      })),
      evidence:[{evidenceId:hostSource,sourceRef:hostSource,summary:'Bounded Scene ambiguity evidence.',provenanceRefs:[hostSource],revision:proposal.baseRevision,available:true,stale:false}],
      provenanceRefs:[hostSource],sourceRevisionSet:[hostSource],worldRevision:this.core.graph.revision,
      sceneRevision:proposal.baseRevision,characterStateRevision:0,ownerRevision:proposal.baseRevision,
      freshnessToken,deadline:now+1200,softDeadline:now+900,maxRetries:0,
      adapterMetadata:{sceneId:proposal.sceneId,field:String(ambiguity.field),sourceRevisionId:hostSource},
    };
    let review;
    try{
      review=await this.sceneJevOwner.adjudicate(input,{
        currentScene:current,
        currentRevisionState:{
          sourceRevisionSet:[hostSource],worldRevision:input.worldRevision,sceneRevision:proposal.baseRevision,characterStateRevision:0,
          domainRevisions:{scene:proposal.baseRevision,owner:proposal.baseRevision},freshnessToken,
        },
        validateProposal:(jevProposal,ownerScene)=>(
          selected()
          &&(phase==='POST_RESPONSE'||!sealed())
          &&Number(ownerScene?.revision)===Number(proposal.baseRevision)
          &&optionIds.has(String(jevProposal?.proposedOutcome??''))
        ),
      });
    }catch(error){
      return finish('UNRESOLVED','JEV_EXECUTION_UNAVAILABLE',{degraded:true,errorCode:String(error?.code??'JEV_EXECUTION_UNAVAILABLE')});
    }
    const currentAfter=this.scene.registry.current(proposal.sceneId);
    if(!selected())return finish('UNRESOLVED','SCENE_JEV_SELECTION_SUPERSEDED',{stale:true,ownerReview:clone(review)});
    if(phase!=='POST_RESPONSE'&&sealed())return finish('UNRESOLVED','SCENE_JEV_LATE_AFTER_SEAL',{late:true,ownerReview:clone(review)});
    if(!currentAfter||Number(currentAfter.revision)!==Number(proposal.baseRevision))return finish('UNRESOLVED','SCENE_JEV_STALE_REVISION',{stale:true,ownerReview:clone(review)});
    if(review?.ownerDecision!==SceneOwnerDecision.ACCEPTED)return finish('UNRESOLVED',review?.reasonCode??'JEV_UNRESOLVED',{ownerReview:clone(review)});
    const chosen=alternatives.find(row=>String(row.optionId)===String(review?.proposal?.proposedOutcome??''))??null;
    if(!chosen)return finish('UNRESOLVED','SCENE_JEV_OWNER_RESULT_INVALID',{invalid:true,ownerReview:clone(review)});
    return finish('ADVISED','SCENE_JEV_OWNER_ADVISED',{
      ownerReview:clone(review),selectedOptionId:String(chosen.optionId),
      selectedAlternative:{optionId:String(chosen.optionId),label:String(chosen.label??chosen.optionId).slice(0,160),value:clone(chosen.value),confidence:Number(chosen.confidence??0)},
      remainingAmbiguityCount:Math.max(0,(work.ambiguities?.length??1)-1),
    });
  }

  admitSceneObservationProposal({
    work,hostEvent,currentSelection=true,turnSealed=false,jevAdvice=null,
  }={}){
    const proposal=work?.proposal,execution=work?.executionReceipt??null;
    const taskId=execution?.workId??null;
    const reject=(reasonCode,{stale=false,late=false,invalid=false}={})=>{
      if(taskId&&this.resourceDirector.ledger.get(taskId))this.resourceDirector.recordOwnerAdmission(taskId,{accepted:false,reasonCode:sceneCausalAdmissionReason(reasonCode,false),consumerId:'SCENE_OWNER'});
      const receipt=this.#sceneObservationOwnerReceipt({execution,accepted:false,reasonCode,stale,late,invalid,ownerReceipt:null});
      this.#retainSceneObservationReceipt(receipt);this.resourceOwnerReceipts.push(clone(receipt));while(this.resourceOwnerReceipts.length>128)this.resourceOwnerReceipts.shift();
      return{kind:'SceneObservationAdmissionResult',accepted:false,reasonCode,ownerReceipt:null,receipt};
    };
    if(!proposal||proposal.kind!=='SceneObservationProposal')return reject('SCENE_PROPOSAL_CONTRACT_INVALID',{invalid:true});
    if(!currentSelection)return reject('SCENE_PROPOSAL_SELECTION_SUPERSEDED',{stale:true});
    const phase=execution?.phase??'FOREGROUND_USER';
    if(phase!=='POST_RESPONSE'&&turnSealed)return reject('SCENE_PROPOSAL_LATE_AFTER_SEAL',{late:true});
    const current=this.scene.registry.current(proposal.sceneId);
    if(!current)return reject('SCENE_PROPOSAL_SCENE_UNAVAILABLE',{stale:true});
    if(Number(current.revision)!==Number(proposal.baseRevision))return reject('SCENE_PROPOSAL_STALE_REVISION',{stale:true});
    const hostSource=String(hostEvent?.sourceRevisionId??'').trim();
    if(!hostSource||!(proposal.sourceRevisionRefs??[]).includes(hostSource)||!(proposal.evidenceRefs??[]).includes(hostSource))return reject('SCENE_PROPOSAL_SOURCE_FENCE_MISMATCH',{invalid:true});
    const fields=clone(proposal.fields??{});
    let appliedJevAdvice=null;
    if(jevAdvice?.accepted===true){
      const ambiguity=(work?.ambiguities??[]).find(row=>row?.ambiguityId===jevAdvice?.ambiguityId)??null;
      if(!ambiguity||Number(jevAdvice?.sceneRevision)!==Number(proposal.baseRevision)||String(jevAdvice?.sourceRevisionId??'')!==hostSource)return reject('SCENE_JEV_ADVICE_FENCE_MISMATCH',{stale:true});
      const selectedAlternative=jevAdvice?.selectedAlternative??null;
      if(!selectedAlternative)return reject('SCENE_JEV_ADVICE_INVALID',{invalid:true});
      const existing=fields[ambiguity.field]??null;
      if(existing&&!['UNRESOLVED','UNKNOWN'].includes(String(existing.observationClass??'')))return reject('SCENE_JEV_CONFLICTS_WITH_SUPPORTED_OBSERVATION',{invalid:true});
      fields[ambiguity.field]=createFieldState({
        value:clone(selectedAlternative.value),revision:current.revision+1,evidenceRefs:[hostSource],
        observationClass:ObservationClass.INFERRED,confidence:Math.max(0,Math.min(.95,Number(selectedAlternative.confidence??0))),
        provenance:[hostSource,'jev-advisory:'+String(jevAdvice.ambiguityId)],
      });
      appliedJevAdvice={
        ambiguityId:String(jevAdvice.ambiguityId),decisionKind:String(jevAdvice.decisionKind??ambiguity.decisionKind),
        field:String(ambiguity.field),selectedOptionId:String(jevAdvice.selectedOptionId??selectedAlternative.optionId),
        sceneRevision:proposal.baseRevision,sourceRevisionId:hostSource,authority:'ADVISORY',settlementAuthority:false,
      };
    }
    let ownerReceipt;
    try{
      ownerReceipt=this.ingestSceneHostEvent(hostEvent,{extract:()=>({
        fields,boundarySignals:clone(work?.boundarySignals??{}),
      })});
      if(appliedJevAdvice)ownerReceipt={...ownerReceipt,jevAdvisory:appliedJevAdvice};

    }catch(error){
      return reject(error?.code??'SCENE_OWNER_REJECTED_PROPOSAL',{invalid:true});
    }
    const accepted=ownerReceipt?.status==='OBSERVED';
    const reasonCode=accepted?'SCENE_OWNER_ADMITTED':ownerReceipt?.noWorkReason??'SCENE_OWNER_NO_CHANGE';
    if(taskId&&this.resourceDirector.ledger.get(taskId))this.resourceDirector.recordOwnerAdmission(taskId,{accepted,reasonCode:sceneCausalAdmissionReason(reasonCode,accepted),consumerId:'SCENE_OWNER'});
    const receipt=this.#sceneObservationOwnerReceipt({execution,accepted,reasonCode,ownerReceipt});
    this.#retainSceneObservationReceipt(receipt);this.resourceOwnerReceipts.push(clone(receipt));while(this.resourceOwnerReceipts.length>128)this.resourceOwnerReceipts.shift();
    return{kind:'SceneObservationAdmissionResult',accepted,reasonCode,ownerReceipt,receipt};
  }

  readSceneObservationReceipts({limit=64}={}){
    const n=Math.max(1,Math.min(128,Number(limit)||64));return clone(this.sceneObservationReceipts.slice(-n));
  }

  #retainSceneEventSpineReceipt(input={}){
    const event=input.event??null,runtimeEvent=input.runtimeEvent??null;
    const receipt=Object.freeze({
      kind:'DeploymentSceneEventSpineReceipt',contractVersion:1,
      status:String(input.status??'REJECTED'),reasonCode:String(input.reasonCode??'EVENT_SPINE_UNKNOWN'),
      eventId:event?.eventId??runtimeEvent?.eventId??null,eventType:event?.eventType??runtimeEvent?.eventType??null,
      chatId:event?.chatId??runtimeEvent?.chatId??null,turnId:event?.turnId??runtimeEvent?.turnId??null,
      generationId:event?.generationId??runtimeEvent?.generationId??null,correlationId:event?.correlationId??runtimeEvent?.correlationId??null,
      causationId:event?.causationId??runtimeEvent?.causationId??null,sceneId:event?.sceneId??runtimeEvent?.sceneId??null,
      sceneRevision:event?.sceneRevision??runtimeEvent?.sceneRevision??null,
      sourceRevisionRefs:uniq(event?.sourceRevisionSet??Object.keys(runtimeEvent?.sourceRevisions??{})),
      dedupeKey:event?.dedupeKey??runtimeEvent?.dedupeKey??null,
      runtimeSequence:runtimeEvent?.createdSequence??null,errorMessage:input.errorMessage??null,
      authorityGranted:false,canonicalMutation:false,settlementAuthority:false,contextSealAuthority:false,
    });
    this.sceneEventSpineReceipts.push(clone(receipt));
    if(this.sceneEventSpineReceipts.length>256)this.sceneEventSpineReceipts.splice(0,this.sceneEventSpineReceipts.length-256);
    return receipt;
  }

  #retainSceneEventObligationReceipt(input={}){
    const event=input.event??null,admission=input.admission??null;
    const receipt=Object.freeze({
      kind:'DeploymentSceneEventObligationReceipt',contractVersion:1,
      status:String(input.status??'REJECTED'),reasonCode:String(input.reasonCode??'SCENE_EVENT_OBLIGATION_REJECTED'),
      producerId:input.producerId??null,eventId:event?.eventId??null,eventType:event?.eventType??null,
      chatId:event?.chatId??null,turnId:event?.turnId??null,generationId:event?.generationId??null,
      correlationId:event?.correlationId??null,sceneId:event?.sceneId??null,sceneRevision:event?.sceneRevision??null,
      sourceRevisionRefs:uniq(event?.revisionFences?.sourceRevisionIds??Object.keys(event?.sourceRevisions??{})),
      taskId:admission?.task?.taskId??null,deduped:Boolean(admission?.deduped),coalesced:Boolean(admission?.coalesced),
      authorityGranted:false,canonicalMutation:false,settlementAuthority:false,contextSealAuthority:false,
    });
    this.sceneEventObligationReceipts.push(clone(receipt));
    if(this.sceneEventObligationReceipts.length>256)this.sceneEventObligationReceipts.splice(0,this.sceneEventObligationReceipts.length-256);
    return receipt;
  }

  #sceneEventObligationGuard(event){
    if(event?.producer!=='SCENE_INTELLIGENCE')return{accepted:false,reasonCode:'SCENE_EVENT_PRODUCER_MISMATCH'};
    if(!event?.chatId)return{accepted:false,reasonCode:'SCENE_EVENT_CHAT_ID_MISSING'};
    const activeChat=String(this.core.hotCognition?.activeChatNamespace??this.scene.narrativeFeed.activeChatId??'');
    if(activeChat&&String(event.chatId)!==activeChat)return{accepted:false,reasonCode:'SCENE_EVENT_FOREIGN_CHAT'};
    if(event.turnId&&this.core.publication.seal.isTurnSealed(event.turnId))return{accepted:false,reasonCode:'SCENE_EVENT_POST_SEAL'};
    const refs=uniq(event.revisionFences?.sourceRevisionIds??Object.keys(event.sourceRevisions??{}));
    const currentSources=new Set(this.scene.narrativeFeed.currentEvidence(String(event.chatId)).map(row=>String(row.sourceRevisionId)));
    if(refs.length&&refs.some(ref=>!currentSources.has(String(ref))))return{accepted:false,reasonCode:'SCENE_EVENT_STALE_SOURCE'};
    if(SCENE_CURRENT_OBLIGATION_EVENT_TYPES.has(event.eventType)){
      const current=this.scene.registry.current(String(event.sceneId??''));
      if(!current||Number(current.revision)!==Number(event.sceneRevision))return{accepted:false,reasonCode:'SCENE_EVENT_STALE_SCENE_REVISION'};
    }
    return{accepted:true,reasonCode:'SCENE_EVENT_CURRENT'};
  }

  bindSceneEventObligationOwner({producer,eventTypes,mapEvent,executorFactory}={}){
    const producerId=String(producer?.producerId??'').trim();
    if(!producerId)throw new TypeError('Scene event obligation owner requires producer.producerId');
    if(typeof mapEvent!=='function')throw new TypeError('Scene event obligation owner requires mapEvent');
    if(typeof executorFactory!=='function')throw new TypeError('Scene event obligation owner requires executorFactory');
    if(!this.runtime.producers.list().some(row=>row.producerId===producerId))this.runtime.registerProducer(producer);
    const types=uniq(eventTypes??[]);
    if(!types.length)throw new TypeError('Scene event obligation owner requires eventTypes');
    for(const eventType of types)if(!Object.values(SceneEventType).includes(eventType))throw new TypeError('Unsupported Scene event obligation type: '+eventType);
    const releases=types.map(eventType=>this.runtime.producers.bindEvent({
      eventType,producerId,
      guardEvent:(event)=>this.#sceneEventObligationGuard(event),
      mapEvent:(event)=>{
        const request=mapEvent(clone(event));
        if(!request)return null;
        const sourceRevisionIds=uniq(event.revisionFences?.sourceRevisionIds??Object.keys(event.sourceRevisions??{}));
        return{
          ...clone(request),
          sceneRevision:request.sceneRevision??event.sceneRevision,
          sourceRevisions:request.sourceRevisions??clone(event.sourceRevisions??{}),
          sourceRevisionIds:request.sourceRevisionIds??sourceRevisionIds,
          dedupeKey:request.dedupeKey??['scene-event',producerId,event.eventId].join(':'),
          cause:{...clone(request.cause??{}),eventId:event.eventId,eventType:event.eventType,chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,correlationId:event.correlationId,causationId:event.causationId,sceneId:event.sceneId,sceneRevision:event.sceneRevision},
        };
      },
      executorFactory:(event,request)=>{
        const ownerExecutor=executorFactory(clone(event),clone(request));
        if(typeof ownerExecutor?.execute!=='function')throw new TypeError('Scene event owner executor must expose execute()');
        return{
          ...ownerExecutor,
          execute:async(context={})=>{
            const guard=this.#sceneEventObligationGuard(event);
            if(!guard.accepted){
              const reasonCode=guard.reasonCode+':BEFORE_EXECUTION';
              this.#retainSceneEventObligationReceipt({status:'REJECTED',reasonCode,producerId,event});
              this.runtimeDirector.telemetry.emit('SCENE_EVENT_OBLIGATION_DISPOSITION',{
                producerId,eventId:event.eventId,eventType:event.eventType,status:'REJECTED',reasonCode,
                chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,sceneId:event.sceneId,sceneRevision:event.sceneRevision,
                taskId:context?.task?.taskId??null,authorityGranted:false,canonicalMutation:false,
              });
              const error=new Error(reasonCode);error.code=reasonCode;throw error;
            }
            return ownerExecutor.execute(context);
          },
        };
      },
      onDisposition:(entry)=>{
        const reasonCode=entry.status==='SKIPPED'&&entry.reasonCode==='OWNER_DECLARED_NO_WORK'
          ?'SCENE_EVENT_OWNER_DECLARED_NO_WORK'
          :entry.status==='ADMITTED'||entry.status==='DEDUPED'||entry.status==='COALESCED'
            ?'SCENE_EVENT_OWNER_ADMITTED'
            :String(entry.reasonCode??'SCENE_EVENT_OBLIGATION_REJECTED');
        this.#retainSceneEventObligationReceipt({
          status:entry.status,reasonCode,producerId,event:entry.event,admission:entry.admission,
        });
        this.runtimeDirector.telemetry.emit('SCENE_EVENT_OBLIGATION_DISPOSITION',{
          producerId,eventId:entry.event?.eventId??null,eventType:entry.event?.eventType??eventType,
          status:entry.status,reasonCode,chatId:entry.event?.chatId??null,turnId:entry.event?.turnId??null,
          generationId:entry.event?.generationId??null,sceneId:entry.event?.sceneId??null,sceneRevision:entry.event?.sceneRevision??null,
          taskId:entry.admission?.task?.taskId??null,authorityGranted:false,canonicalMutation:false,
        });
      },
    }));
    return()=>{for(const release of releases)try{release();}catch{}};
  }

  readSceneEventSpineReceipts({limit=64}={}){
    const n=Math.max(1,Math.min(256,Number(limit)||64));
    return clone(this.sceneEventSpineReceipts.slice(-n));
  }

  readSceneEventObligationReceipts({limit=64}={}){
    const n=Math.max(1,Math.min(256,Number(limit)||64));
    return clone(this.sceneEventObligationReceipts.slice(-n));
  }

  ingestSceneHostEvent(input = {}, { extract = null } = {}) {
    const start = this.sceneOwnerTimeline.length;
    const spineStart=this.sceneEventSpineReceipts.length,obligationStart=this.sceneEventObligationReceipts.length;
    const requestedChatId=String(input?.chatId??'').trim();
    if(requestedChatId&&this.core.hotCognition.activeChatNamespace!==requestedChatId)this.core.activateHotCognitionChat(requestedChatId);
    let extracted = null;
    const wrappedExtract = typeof extract === 'function'
      ? (e, scene) => { extracted = extract(e, scene) ?? {}; return extracted; }
      : null;
    const outcome = this.scene.ingestHostEvent(input, { extract: wrappedExtract });
    const evidence = outcome?.evidence ?? null;
    const chatId = String(evidence?.chatId ?? input?.chatId ?? '').trim();
    const timeline = this.sceneOwnerTimeline.slice(start).map((row) => clone(row));
    const coreReceipts = [];
    if (chatId) {
      if (this.core.hotCognition.activeChatNamespace !== chatId) this.core.activateHotCognitionChat(chatId);
      for (const row of timeline) {
        const receipt = row.type === 'INVALIDATION'
          ? this.core.consumeSceneContextInvalidation(row.value, { chatNamespace: chatId })
          : this.core.consumeCognitiveEvent(row.value, { chatNamespace: chatId });
        coreReceipts.push({
          type: row.type,
          ref: row.value?.eventId ?? row.value?.invalidationId ?? null,
          eventType: row.value?.eventType ?? null,
          status: receipt?.status ?? null,
          coreHandling: receipt?.coreHandling ?? null,
          reason: receipt?.reason ?? receipt?.reasonCode ?? null,
        });
      }
    }
    const signal = chatId ? this.scene.integrationSignal(chatId) : null;
    const signalReceipt = signal ? this.core.consumeSceneSignal(signal, { chatNamespace: chatId }) : null;
    const changedFields = Object.keys(outcome?.delta?.changedFields ?? {}).sort();
    const eventRows = timeline.filter((row) => row.type === 'EVENT');
    const invalidationRows = timeline.filter((row) => row.type === 'INVALIDATION');
    const invalidatedSourceRevisionRefs = [...new Set([
      ...(evidence?.invalidates ?? []),
      evidence?.replacesRevisionId,
    ].filter(Boolean).map(String))].sort();
    const sourceRevisionRefs = [...new Set(signal?.sourceRevisionRefs ?? signal?.sourceRevisionSet ?? [])].sort();
    const boundaryStatus = outcome?.boundary?.decision?.status ?? null;
    const status = changedFields.length || outcome?.transition ? 'OBSERVED' : 'NO_WORK';
    const boundaryCueObserved = Boolean(extracted?.boundarySignals && Object.keys(extracted.boundarySignals).length);
    const noWorkReason = status === 'NO_WORK'
      ? (boundaryCueObserved && boundaryStatus !== 'CONFIRMED' ? 'BOUNDARY_NOT_CONFIRMED' : 'NO_EXPLICIT_SCENE_CHANGE')
      : null;
    return clone({
      kind: 'DeploymentSceneOwnerReceipt',
      contractVersion: 1,
      status,
      noWorkReason,
      evidence: evidence ? {
        activity: evidence.activity ?? null,
        chatId: evidence.chatId ?? null,
        messageId: evidence.messageId ?? null,
        messageRevision: evidence.messageRevision ?? null,
        turnId: evidence.turnId ?? null,
        generationId: evidence.generationId ?? null,
        correlationId: evidence.correlationId ?? null,
        causationId: evidence.causationId ?? null,
        sourceRevisionId: evidence.sourceRevisionId ?? null,
        replacesRevisionId: evidence.replacesRevisionId ?? null,
        invalidates: [...(evidence.invalidates ?? [])],
        current: Boolean(evidence.current),
      } : null,
      chatId,
      sceneId: signal?.sceneId ?? outcome?.scene?.sceneId ?? null,
      sceneRevision: signal?.sceneRevision ?? outcome?.scene?.revision ?? null,
      sourceRevisionRefs,
      invalidatedSourceRevisionRefs,
      changedFields,
      delta: clone(outcome?.delta ?? null),
      dispatchTimeline: clone(timeline),
      boundary: clone(outcome?.boundary ?? null),
      boundarySignals: clone(extracted?.boundarySignals ?? null),
      transition: clone(outcome?.transition ?? null),
      eventIds: eventRows.map((row) => row.value?.eventId).filter(Boolean),
      eventTypes: [...new Set(eventRows.map((row) => row.value?.eventType).filter(Boolean))],
      invalidationIds: invalidationRows.map((row) => row.value?.invalidationId).filter(Boolean),
      coreReceipts,
      eventSpineReceipts:clone(this.sceneEventSpineReceipts.slice(spineStart)),
      eventObligationReceipts:clone(this.sceneEventObligationReceipts.slice(obligationStart)),
      signalReceipt: signalReceipt ? {
        status: signalReceipt.status ?? null,
        coreHandling: signalReceipt.coreHandling ?? null,
        reason: signalReceipt.reason ?? signalReceipt.reasonCode ?? null,
      } : null,
      signal,
      prefetchRecommendations: clone(signal?.prefetchRecommendations ?? []),
      authority: 'DESCRIPTIVE',
      authorityGranted: false,
      canonicalMutationAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
      contextSealBypass: false,
      rawNarrativeIncluded: false,
    });
  }

  async runSceneLoreHandoff({ sceneReceipt, chatId = null, turnId = null, generationId } = {}) {
    const result = await this.sceneLoreHandoff.retrieve({ sceneReceipt, chatId, turnId, generationId });
    this.#emit({ type: 'SCENE_LORE_HANDOFF', result: clone(result) });
    return clone(result);
  }
  admitMemoryEvidenceMapping(input = {}) {
    const receipt = this.memorySurface.adapters.admitExternalEvidenceMapping(input);
    const evidence = receipt.memoryEvidenceId ? this.memory.graph.evidenceRecord(receipt.memoryEvidenceId) : null;
    return {
      receipt,
      evidence,
      status: this.memory.status(),
      authorityGranted: false,
      canonicalMutationAuthority: false,
      contextSealAuthority: false,
    };
  }

  #considerScenePrefetch({chatId,turn,query}={}){
    const sceneInput=this.scene.fanOutInput(String(chatId));
    const recommendations=sceneInput?.prefetchRecommendations??[];
    if(!recommendations.length){
      return Object.freeze({
        kind:'DeploymentScenePrefetchConsiderationReceipt',contractVersion:1,status:'SKIPPED',reasonCode:'NO_ACTIVE_SCENE_PREFETCH_RECOMMENDATION',
        chatId:String(chatId),turnId:turn?.turnId??null,correlationId:turn?.correlationId??null,
        sceneId:sceneInput?.sceneId??null,sceneRevision:sceneInput?.sceneRevision??null,
        recommendationIds:[],freshRecommendationCount:0,plannedTaskCount:0,nominatedRoles:[],
        plannerConsidered:false,workerExecutionAttempted:false,authorityGranted:false,retrievalAuthority:false,truthAuthority:false,contextSealAuthority:false,
      });
    }
    const plannerInput=plannerInputFromScene({publicSignals:sceneInput});
    const considerationTurn=Object.freeze({
      ...clone(turn),
      sourceRevisionSet:uniq([...(turn?.sourceRevisionSet??[]),...(sceneInput.sourceRevisionSet??[])]),
      sceneRevision:Number(sceneInput.sceneRevision??turn?.sceneRevision??0),
    });
    let prepared;
    try{
      prepared=this.scenePrefetchSwarm.prepareTurn({
        turnEvent:considerationTurn,
        plannerInput:{...plannerInput,text:String(query??''),trigger:'SCENE_PREFETCH_RECOMMENDATION'},
      });
    }catch(error){
      const receipt=Object.freeze({
        kind:'DeploymentScenePrefetchConsiderationReceipt',contractVersion:1,status:'DEGRADED',reasonCode:String(error?.code??'SCENE_PREFETCH_PLANNER_UNAVAILABLE').slice(0,96),
        chatId:String(chatId),turnId:turn?.turnId??null,correlationId:turn?.correlationId??null,
        sceneId:sceneInput.sceneId??null,sceneRevision:sceneInput.sceneRevision??null,
        sourceRevisionSet:uniq(sceneInput.sourceRevisionSet??[]),recommendationIds:uniq(recommendations.map(row=>row.recommendationId)),
        freshRecommendationCount:0,rejectedRecommendationCount:recommendations.length,plannedTaskCount:0,nominatedRoles:[],
        plannerConsidered:true,workerExecutionAttempted:false,checkpointExecutionPerformed:false,
        authorityGranted:false,retrievalAuthority:false,truthAuthority:false,contextSealAuthority:false,canonicalMutation:false,settlementAuthority:false,
      });
      this.scenePrefetchConsiderations.push(clone(receipt));
      if(this.scenePrefetchConsiderations.length>128)this.scenePrefetchConsiderations.splice(0,this.scenePrefetchConsiderations.length-128);
      this.#emit({type:'SCENE_PREFETCH_CONSIDERED',receipt:clone(receipt)});
      return receipt;
    }
    const recommendationIds=uniq(recommendations.map(row=>row.recommendationId));
    const nominatedRoles=uniq((prepared.fanOutPlan?.nominations??[])
      .filter(row=>(row.reasonCodes??[]).includes('SCENE_PREFETCH_RECOMMENDATION'))
      .map(row=>row.roleId));
    const plannedTaskCount=(prepared.checkpoint?.pendingTasks??[])
      .filter(task=>(task.metadata?.reasonCodes??[]).includes('SCENE_PREFETCH_RECOMMENDATION')).length;
    const receipt=Object.freeze({
      kind:'DeploymentScenePrefetchConsiderationReceipt',contractVersion:1,status:'CONSIDERED',reasonCode:null,
      chatId:String(chatId),turnId:turn?.turnId??null,correlationId:turn?.correlationId??null,
      sceneId:sceneInput.sceneId??null,sceneRevision:sceneInput.sceneRevision??null,
      sourceRevisionSet:uniq(sceneInput.sourceRevisionSet??[]),recommendationIds,
      freshRecommendationCount:Number(prepared.fanOutPlan?.inputSignals?.freshPrefetchRecommendationCount??0),
      rejectedRecommendationCount:Number(prepared.fanOutPlan?.inputSignals?.rejectedPrefetchRecommendationCount??0),
      plannedTaskCount,nominatedRoles,
      plannerConsidered:true,workerExecutionAttempted:false,checkpointExecutionPerformed:false,
      authorityGranted:false,retrievalAuthority:false,truthAuthority:false,contextSealAuthority:false,canonicalMutation:false,settlementAuthority:false,
    });
    this.scenePrefetchConsiderations.push(clone(receipt));
    if(this.scenePrefetchConsiderations.length>128)this.scenePrefetchConsiderations.splice(0,this.scenePrefetchConsiderations.length-128);
    this.#emit({type:'SCENE_PREFETCH_CONSIDERED',receipt:clone(receipt)});
    return receipt;
  }

  readScenePrefetchConsiderations({limit=32}={}){
    const count=Math.max(1,Math.min(128,Number(limit)||32));
    return this.scenePrefetchConsiderations.slice(-count).map(clone);
  }

  async runTurn({
    chatId = 'chat:deployment',
    turnId,
    generationId,
    query,
    intent = 'CURRENT',
    mode = 'retrieval',
    anchorEntityIds = [],
    sceneReceipt = null,
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
    const scenePrefetchConsideration=this.#considerScenePrefetch({chatId,turn,query});

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
          metadata: { jevInput: this.#makeJevInput({ turn, query, planning, chatId }) },
        }));
      }
    }

    const publishedRuntime = this.runtime.publishTurn(turn, jobs);
    const foreground = await this.runtime.native.awaitForeground(turn.turnId);
    await this.runtimeDirector.drain();

    const sceneLore = sceneReceipt && mode !== 'simple'
      ? await this.runSceneLoreHandoff({ sceneReceipt, chatId, turnId, generationId })
      : null;
    const sceneLoreAdmittedCount = sceneLore?.status === 'SYNCED'
      ? this.loreChannel.admitSceneCandidates(query, sceneLore)
      : 0;

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
      activeThreads: (sceneSignal.activeThreads ?? []).map((thread, index) => {
        if (thread && typeof thread === 'object' && thread.threadId) return thread;
        const objective = typeof thread === 'string' ? thread : JSON.stringify(thread);
        return {
          threadId: 'scene-thread:' + (index + 1) + ':' + objective.slice(0, 80),
          objective,
          status: 'ACTIVE',
          priority: 8,
          sourceRevisionIds: [...(sceneSignal.sourceRevisionRefs ?? sceneSignal.sourceRevisionSet ?? [])],
          sceneRevision: sceneSignal.sceneRevision,
          evidenceRefs: [...(sceneSignal.provenanceRefs ?? sceneSignal.provenance ?? [])].slice(0, 16),
        };
      }),
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
      scenePrefetchConsideration: clone(scenePrefetchConsideration),
      loreStatus: {
        kind: 'DeploymentLoreStatus',
        ...this.loreSystem.diagnostics(),
        study: this.lore.publicSurface(),
        channelId: CHANNEL_ID,
        externalServiceRequired: false,
      },
      planning,
      sceneLoreHandoff: sceneLore,
      sceneLoreAdmittedCount,
      jevProposal: this.pendingJev.get(turn.turnId) ?? null,
      jevOwnerAdmission: this.pendingJevAdmission.get(turn.turnId) ?? null,
      jevExecution: this.jevExecution.get(turn.turnId) ?? null,
      published,
      delivery,
    };
    this.turns.set(turn.turnId, record);
    this.selectedTurnId = turn.turnId;
    this.#emit({ type: 'TURN_COMMITTED', selection });
    return clone(record);
  }

  readLoreStatus(selection = {}) {
    const active = selection?.turnId ? this.turns.get(String(selection.turnId)) ?? null : null;
    const identity = active?.selection ?? selection ?? {};
    return attachIdentity(active?.loreStatus ?? {
      kind: 'DeploymentLoreStatus',
      ...this.loreSystem.diagnostics(),
      study: this.lore.publicSurface(),
      channelId: CHANNEL_ID,
      externalServiceRequired: false,
    }, identity);
  }

  listOptionalResources() {
    const model = this.optionalResources.read.resources();
    return {
      ...clone(model),
      resources: (model.resources ?? []).map((row) => ({
        ...clone(row),
        kind: (row.declaredCapabilities ?? []).includes(CAPABILITIES.SEMANTIC_JUDGMENT) ? 'JEV' : 'SIDECAR',
        capabilities: [...(row.activeCapabilities?.length ? row.activeCapabilities : row.declaredCapabilities ?? [])],
        connected: ['READY', 'DEGRADED'].includes(String(row.state)),
      })),
    };
  }

  async connectOptionalResource(config = {}) {
    const existingId = typeof config === 'string' ? String(config) : null;
    const kind = String(typeof config === 'object' && config ? (config.kind ?? config.role ?? 'SIDECAR') : 'SIDECAR').toUpperCase();
    const resourceId = existingId ?? String(config.resourceId ?? config.id ?? config.profileId ?? ('optional-' + (this.listOptionalResources().resources.length + 1)));
    const exists = this.listOptionalResources().resources.some((row) => row.resourceId === resourceId || row.id === resourceId);
    if (!exists) {
      if (typeof config !== 'object' || !config) throw new Error('Unknown optional resource: ' + resourceId);
      const capabilities = Array.isArray(config.capabilities) && config.capabilities.length
        ? [...config.capabilities]
        : kind === 'JEV'
          ? [CoprocessorCapability.SEMANTIC_JUDGMENT]
          : kind === 'VECTOR'
            ? [CoprocessorCapability.RETRIEVAL,CoprocessorCapability.EMBED]
            : [CoprocessorCapability.STRUCTURED_EXTRACTION,CoprocessorCapability.SEMANTIC_JUDGMENT,CoprocessorCapability.GRAPH,CoprocessorCapability.CONSOLIDATION,CoprocessorCapability.COMPRESSION,CoprocessorCapability.REFLECTION];
      this.optionalResources.actions.addResource({
        resourceId,
        kind: config.transportKind ?? 'OPENAI_COMPATIBLE',
        displayName: config.displayName ?? resourceId,
        providerProfileId: String(config.providerProfileId ?? config.profileId ?? ('profile:' + resourceId)),
        providerId: String(config.providerId ?? ('provider:' + resourceId)),
        modelId: String(config.modelId ?? 'model'),
        workerId: String(config.workerId ?? ('resource:' + resourceId)),
        endpoint: config.endpoint,
        apiKey: config.apiKey ?? null,
        headers: config.headers ?? {},
        capabilities,
        transportMode: config.transportMode ?? (kind === 'VECTOR' ? 'EMBEDDINGS' : 'CHAT_COMPLETIONS'),
        local: config.local !== false,
        timeoutMs: config.timeoutMs ?? 30000,
        healthTimeoutMs: config.healthTimeoutMs ?? 10000,
      });
      this.#syncOptionalDirectorProfiles();
    }
    const result = await this.optionalResources.actions.connectResource(resourceId);
    this.#syncOptionalDirectorProfiles();
    const connected=this.resourceConnections.readResource(resourceId);
    if(connected.transportMode==='EMBEDDINGS'&&connected.callable)this.#scheduleMemoryVectorMaintenance('VECTOR_RESOURCE_CONNECTED');
    this.#emit({ type: 'OPTIONAL_RESOURCE_CHANGED', resourceId, action: 'CONNECT' });
    return clone(result);
  }

  async disconnectOptionalResource(resource = {}) {
    const resourceId = String(typeof resource === 'string' ? resource : resource.id ?? resource.resourceId ?? resource.profileId ?? '');
    if (!resourceId) throw new TypeError('resource id is required');
    const result = await this.optionalResources.actions.disconnectResource(resourceId);
    this.#syncOptionalDirectorProfiles();
    this.#emit({ type: 'OPTIONAL_RESOURCE_CHANGED', resourceId, action: 'DISCONNECT' });
    return clone(result);
  }

  async proposeMemoryConsolidation(input = {}) {
    const selection=input.selection??input;
    const chatId=String(selection.chatId??'').trim();
    const turnId=String(selection.turnId??'').trim();
    const generationId=String(selection.generationId??'').trim();
    const correlationId=String(selection.correlationId??('memory-consolidation:'+generationId)).trim();
    if(!chatId||!turnId||!generationId)throw new TypeError('Memory consolidation proposal requires chatId, turnId and generationId');
    const maxEpisodes=Math.max(2,Math.min(8,Number(input.maxEpisodes??6)||6));
    const episodes=this.memory.experienceStore.currentEpisodes({freshOnly:true})
      .filter((row)=>row.chatId===chatId)
      .sort((a,b)=>a.createdSequence-b.createdSequence)
      .slice(-maxEpisodes);
    if(episodes.length<2)return Object.freeze({
      kind:'DeploymentMemoryConsolidationProposalReceipt',contractVersion:'1.0.0',
      status:'SKIPPED',reasonCode:'MEMORY_CONSOLIDATION_REPETITION_WINDOW_INSUFFICIENT',
      chatId,turnId,generationId,selection:clone(selection),episodeId:input.episodeId??null,episodeCount:episodes.length,bundle:null,memoryHandoff:null,
      providerAttempted:false,rawChatIncluded:false,canonicalMutation:false,settlementAuthority:false,
    });
    const artifactRefs=episodes.map((episode)=>Object.freeze({
      kind:'ArtifactReference',artifactId:episode.id,artifactType:'MemoryEpisode',owner:'MEMORY',
      revision:episode.revision,storageDomain:'episodes',provenanceRef:'memory:'+episode.id,
    }));
    const sourceRevisionSet=uniq(episodes.flatMap((row)=>row.sourceRevisionRefs??[]));
    const worldRevision=Number(selection.worldRevision??Math.max(...episodes.map((row)=>Number(row.worldRevision??0)),0));
    const sceneRevision=Number(selection.sceneRevision??episodes.at(-1)?.sceneRevision??0);
    const unit=createConsolidationUnit({
      unitId:'memory-cognition:'+chatId+':'+generationId,
      artifactRefs,sourceRevisionSet,worldRevision,sceneRevision,characterStateRevision:0,
      priority:0,createdAt:0,resumeIdentity:'memory-cognition:'+chatId+':'+generationId,
      provenance:{producer:'DEVELOPMENT_DEPLOYMENT_BRAIN',episodeIds:episodes.map((row)=>row.id)},
    });
    const worker=new ContinuousConsolidationWorker({
      executionLayer:this.resourceConnections.executionLayer,
      telemetry:this.coprocessorTelemetry,
    });
    const sidecarQueuedAt=Date.now(),heapBefore=heapSample();let dispatchedPayloadCharacters=0;
    worker.enqueue(unit);
    const currentRevisionSet={sourceRevisionSet,worldRevision,sceneRevision,characterStateRevision:0},sidecarDispatchedAt=Date.now();
    const result=await worker.processUnit(unit.unitId,{
      currentRevisionSet,turnId,correlationId,
      inputResolver:async(storedUnit)=>({
        unit:storedUnit,
        evidenceSlices:storedUnit.artifactRefs.map((ref)=>{
          const episode=episodes.find((row)=>row.id===ref.artifactId);
          const exact=episode?this.memory.experienceStore.exactDrillback(episode.id):[];
          const excerpt=exact.map((row)=>String(row?.exactContent??row?.content??'')).filter(Boolean).join('\n').slice(0,2400);
          dispatchedPayloadCharacters+=excerpt.length;
          return {ref,excerpt,structuredFacts:[],provenanceRef:'memory-drillback:'+ref.artifactId};
        }),
        semanticGoals:['reflection-evidence','cross-episode-links','episode-summary'],
      }),
    });
    if(result.status!=='SUCCESS')return Object.freeze({
      kind:'DeploymentMemoryConsolidationProposalReceipt',contractVersion:'1.0.0',
      status:result.status==='STALE'?'STALE':'DEFERRED',
      reasonCode:result.status==='STALE'?'MEMORY_CONSOLIDATION_INPUT_STALE':(result.failure?.code??'MEMORY_CONSOLIDATION_PROVIDER_UNAVAILABLE'),
      chatId,turnId,generationId,selection:clone(selection),episodeId:input.episodeId??null,episodeCount:episodes.length,bundle:null,memoryHandoff:null,
      providerAttempted:result.status!=='IDLE',failure:clone(result.failure??null),
      rawChatIncluded:false,canonicalMutation:false,settlementAuthority:false,
    });
    const workerResult=result.workerResult??null;
    const executionReceipt=Object.freeze({
      kind:'MemorySidecarExecutionReceipt',contractVersion:'1.0.0',requestPurpose:'COGNITIVE_EXECUTION',
      jobId:result.task?.taskId??unit.unitId,dispatchStatus:'DISPATCHED',providerRequestId:workerResult?.providerMetadata?.requestId??null,
      providerId:workerResult?.providerId??null,modelId:workerResult?.modelId??null,returnStatus:'RETURNED',
      ownerDestination:'MEMORY_OWNER_REVIEW',gatherDestination:'NOT_ELIGIBLE_POST_TURN',sealDestination:'NOT_ELIGIBLE_POST_TURN',
      usageReceipt:clone(workerResult?.providerMetadata?.usageReceipt??null),providerLatencyMs:workerResult?.latency??null,
      queueWaitMs:Math.max(0,sidecarDispatchedAt-sidecarQueuedAt),foregroundBlockedMs:0,
      usageClass:workerResult?.providerMetadata?.usageReceipt?.measurementClass??workerResult?.providerMetadata?.measurementClass??null,
      costClass:workerResult?.providerMetadata?.usageReceipt?.cost?.status??null,payloadSizeClass:payloadSizeClass(dispatchedPayloadCharacters),
      heapBefore,heapAfter:heapSample(),payloadBodyRetained:false,hiddenReasoningRetained:false,canonicalMutation:false,settlementAuthority:false,
    });
    this.resourceOwnerReceipts.push(clone(executionReceipt));
    return Object.freeze({
      kind:'DeploymentMemoryConsolidationProposalReceipt',contractVersion:'1.0.0',
      status:'PROPOSED',reasonCode:null,chatId,turnId,generationId,selection:clone(selection),episodeId:input.episodeId??null,episodeCount:episodes.length,
      bundle:clone(result.bundle),memoryHandoff:clone(result.memoryHandoff),executionReceipt,
      providerAttempted:true,rawChatIncluded:false,canonicalMutation:false,settlementAuthority:false,
    });
  }

  #scheduleMemoryVectorMaintenance(reason){
    const queuedAt=Date.now();
    setTimeout(async()=>{
      let receipt;
      try{receipt=await this.memory.runVectorMaintenance({maxUnits:1});}
      catch(error){receipt={kind:'MemoryVectorMaintenanceReceipt',status:'UNAVAILABLE',reasonCode:error?.code??'VECTOR_MAINTENANCE_FAILED',pending:this.memory.vectorIndex.status().pendingCount};}
      this.memoryNearlineReceipts.push({reason,queueWaitMs:Math.max(0,Date.now()-queuedAt),...clone(receipt),foregroundBlockedMs:0});
      if(this.memoryNearlineReceipts.length>128)this.memoryNearlineReceipts.splice(0,this.memoryNearlineReceipts.length-128);
      this.#emit({type:'MEMORY_VECTOR_MAINTENANCE',receipt:clone(this.memoryNearlineReceipts.at(-1))});
    },0);
  }

  async testOptionalResource(resource = {}) {
    const resourceId = String(typeof resource === 'string' ? resource : resource.id ?? resource.resourceId ?? resource.profileId ?? '');
    if (!resourceId) throw new TypeError('resource id is required');
    const result = await this.optionalResources.actions.testResource(resourceId);
    this.#syncOptionalDirectorProfiles();
    return clone(result);
  }

  hostBindings() {
    const get = (selection = null) => {
      const turnId = selection?.turnId ?? this.selectedTurnId;
      return turnId ? this.turns.get(String(turnId)) ?? null : null;
    };
    const subscribeOwner = (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    };
    const loreStudyHost = Object.freeze({
      ...this.loreIntelligence.operatorInterface(),
      kind: 'DevelopmentDeploymentLoreStudyHost',
      read: Object.freeze({
        status: (selection) => this.readLoreStatus(selection),
        surface: (selection) => this.readLoreStatus(selection),
        loreStudy: (selection) => this.readLoreStatus(selection),
        intelligence: () => this.loreIntelligence.status(),
      }),
      actions: Object.freeze({
        acceptLorebook: (input) => this.acceptLorebook(input),
        submitLorebook: (input) => this.acceptLorebook(input),
        ingestLorebook: (input) => this.acceptLorebook(input),
        runLoreStudy: (input) => this.runLoreStudy(input),
        startLoreStudy: (input) => this.runLoreStudy(input),
        retryLoreStudy: (input) => this.loreIntelligence.retryStudy(input || {}),
      }),
      subscribe: subscribeOwner,
    });
    const baseAuthoringHost = this.loreAuthoring.operatorContract();
    const settlementAction = (name) => (request) => {
      const result = baseAuthoringHost.actions[name](request);
      if (result?.ok && result.value?.settlementId) this.#recordLoreSettlement(result.value);
      return result;
    };
    const loreAuthoringHost = Object.freeze({
      ...baseAuthoringHost,
      read: Object.freeze({
        ...baseAuthoringHost.read,
        availability: () => ({
          kind: 'LoreAuthoringAvailability',
          contractVersion: 1,
          available: true,
          blocked: false,
          integrationStatus: baseAuthoringHost.integrationStatus,
          sourceBranch: 'Development-Lorebook-Editor',
        }),
      }),
      actions: Object.freeze({
        ...baseAuthoringHost.actions,
        applySettlement: settlementAction('applySettlement'),
        restoreSettlement: settlementAction('restoreSettlement'),
      }),
    });
    return {
      readSelection: () => clone(get()?.selection ?? {}),
      subscribe: subscribeOwner,
      resourceHost: this.optionalResources,
      coprocessorResourceHost: this.optionalResources,
      coprocessorTelemetry: this.coprocessorTelemetry,
      loreIntelligenceService: this.loreIntelligence,
      loreStudyService: this.loreIntelligence,
      loreOperatorHost: loreStudyHost,
      loreStudyHost,
      loreHost: loreStudyHost,
      loreBrainInterface: this.loreIntelligence.brainInterface(),
      sceneLoreHandoff: (request = {}) => this.runSceneLoreHandoff(request),
      memoryIntegrationSurface: this.memorySurface,
      memoryConsolidationProducer: Object.freeze({
        kind:'DeploymentMemoryConsolidationProducer',contractVersion:'1.0.0',
        propose:(input)=>this.proposeMemoryConsolidation(input),
        authorityGranted:false,canonicalMutationAuthority:false,settlementAuthority:false,
      }),
      sceneRuntime: this.scene,
      graphProviders: createOwnerGraphProviders({
        loreInterface: this.loreIntelligence.brainInterface(),
        memoryInterface: this.memorySurface,
        sceneRuntime: this.scene,
      }),
      resourceDirectorBridge: this.resourceDirectorBridge,
      beginOptionalResourceGeneration: (meta) => this.resourceDirectorBridge.beginGeneration(meta),
      completeOptionalResourceGeneration: (meta) => this.resourceDirectorBridge.completeGeneration(meta),
      readOptionalResourceRuntime: () => clone(this.resourceDirector.snapshot()),
      readMemoryExecutionReceipts: () => clone(this.memoryNearlineReceipts),
      readMemoryVectorReceipts: () => this.memory.vectorIndex.readReceipts({limit:128}),
      readSceneObservationReceipts: () => this.readSceneObservationReceipts({limit:128}),
      loreAuthoringService: this.loreAuthoring,
      loreAuthoringHost,
      loreAuthoringOperator: loreAuthoringHost,
      snapshotLoreOwner: () => this.snapshotLoreOwner(),
      snapshotMemoryOwner: () => this.snapshotMemoryOwner(),
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
      readJev: (selection) => {
        const record = get(selection);
        if (!record?.jevProposal) return null;
        const admission = record.jevOwnerAdmission;
        return attachIdentity({
          ...record.jevProposal,
          ownerAdmission: admission ? {
            kind: admission.kind,
            status: admission.status,
            ownerDecision: admission.ownerDecision,
            accepted: admission.accepted,
            rejected: admission.rejected,
            reasonCode: admission.reasonCode,
            ownerReviewInvoked: admission.ownerReviewInvoked,
            settlementPerformed: admission.settlementPerformed,
            canonicalMutation: admission.canonicalMutation,
          } : null,
        }, record.selection);
      },
      readPrecision: (selection) => attachIdentity({
        kind: 'DeploymentPrecisionReceipt',
        resultCount: get(selection)?.published?.precisionResults?.length ?? 0,
        failed: Boolean(get(selection)?.published?.precisionFailed),
      }, get(selection)?.selection ?? {}),
      readGather: (selection) => attachIdentity(get(selection)?.published?.gatherReceipt, get(selection)?.selection ?? {}),
      readLoreStatus: (selection) => this.readLoreStatus(selection),
      acceptLorebook: (input) => this.acceptLorebook(input),
      runLoreStudy: (input) => this.runLoreStudy(input),
      readMemoryStatus: (selection) => {
        const identity = get(selection)?.selection ?? selection ?? {};
        const live = this.memorySurface.adapters.readMemory(identity);
        return attachIdentity({
          kind: 'DeploymentMemoryStatus',
          ...clone(live),
          status: this.memory.status(),
          authorityGranted: false,
          canonicalMutationAuthority: false,
          contextSealAuthority: false,
        }, identity);
      },
      listResources: () => this.listOptionalResources(),
      listResourceProfiles: () => this.listOptionalResources(),
      addResource: (config) => this.optionalResources.actions.addResource(config),
      connectResource: (config) => this.connectOptionalResource(config),
      disconnectResource: (resource) => this.disconnectOptionalResource(resource),
      testResource: (resource) => this.testOptionalResource(resource),
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
      loreIntelligence: this.loreIntelligence.status(),
      loreAuthoring: {
        contract: this.loreAuthoring.worker3AuthoringContract(),
        settlementEventCount: this.loreSettlementEvents.length,
      },
      sceneCount: this.scene.registry.list().length,
      sceneEvents: {
        publishedAccepted: this.sceneEventSpineReceipts.filter(row=>row.status==='ACCEPTED').length,
        publishedRejected: this.sceneEventSpineReceipts.filter(row=>row.status==='REJECTED').length,
        obligationsAdmitted: this.sceneEventObligationReceipts.filter(row=>['ADMITTED','DEDUPED','COALESCED'].includes(row.status)).length,
        obligationsRejected: this.sceneEventObligationReceipts.filter(row=>row.status==='REJECTED').length,
        obligationsSkipped: this.sceneEventObligationReceipts.filter(row=>row.status==='SKIPPED').length,
        lastPublicationReason: this.sceneEventSpineReceipts.at(-1)?.reasonCode??null,
        lastObligationReason: this.sceneEventObligationReceipts.at(-1)?.reasonCode??null,
        runtimeSubscriberFailureCount: this.runtimeDirector.events.subscriberFailures.length,
        authorityGranted: false,
        canonicalMutationAuthority: false,
      },
      runtime: this.runtimeDirector.diagnostics?.() ?? null,
      sensory: this.core.sensoryDiagnostics(),
      externalDatabaseRequired: false,
      externalOrchestrationRequired: false,
      remoteProviderRequired: false,
      optionalResources: this.listOptionalResources(),
      coprocessorTelemetry: this.coprocessorTelemetry.snapshot(),
      memory: this.memory.status(),
      mainMutationAuthority: false,
    };
  }

  #recordLoreSettlement(readModel) {
    const settlementId = readModel?.settlementId;
    if (!settlementId) return null;
    const worker1 = this.loreAuthoring.worker1SettlementReceipts({ settlementId });
    const seen = new Set(this.loreSettlementEvents.map((row) => row.eventKey));
    const accepted = [];
    for (const event of worker1.revisionEvents ?? []) {
      const eventKey = [event.settlementId, event.operationKind, event.restoration ? 'RESTORE' : 'APPLY', event.sourceId, event.sourceRevisionId].join('|');
      if (seen.has(eventKey)) continue;
      seen.add(eventKey);
      this.sourceMap.delete(event.sourceId);
      if (event.sourceState === 'REMOVED') {
        const source = this.core.registry.getSource(event.sourceId);
        if (source && !this.core.registry.isSourceRetired(event.sourceId)) {
          this.core.registry.retireSource(event.sourceId, { reason: 'lore-owner:' + event.operationKind });
        }
      }
      const row = { eventKey, event: clone(event), settlementId };
      this.loreSettlementEvents.push(row);
      accepted.push(clone(event));
    }
    this.loreSystem = this.loreIntelligence.hierarchy;
    const result = {
      kind: 'DevelopmentDeploymentLoreSettlementReceipt',
      contractVersion: 1,
      settlementId,
      state: readModel.state,
      acceptedRevisionEvents: accepted,
      worker1: clone(worker1),
      studyDue: this.lore.dueObligations().map((row) => row.id),
      unrelatedSourcesInvalidated: Boolean(worker1.unrelatedSourcesInvalidated),
    };
    this.#emit({ type: 'LORE_AUTHORING_SETTLEMENT', result });
    return result;
  }

  #syncLoreRevision(revision) {
    const sourceId = revision.sourceId;
    const content = revision.exactContent;
    const metadata = { ...(revision.metadata ?? {}), lorebookId: revision.lorebookId ?? null, uid: revision.uid ?? null, laneRevisionId: revision.id };
    const at = Number(metadata.at ?? 0);
    let extractionMode = 'SEMANTIC';
    try {
      const existing = this.core.registry.getSource(sourceId);
      const active = existing ? this.core.registry.getActiveRevision(sourceId) : null;
      if (!existing) {
        this.core.importAndLearn({ id: sourceId, sourceType: 'LOREBOOK_ENTRY', content, at, metadata });
      } else if (active?.exactContent !== content) {
        this.core.editAndRelearn(sourceId, content);
      }
    } catch (error) {
      if (!unsupportedDeterministicStudy(error)) throw error;
      extractionMode = 'RAW_SOURCE_ONLY';
      const existing = this.core.registry.getSource(sourceId);
      if (!existing) {
        this.core.registry.importSource({ id: sourceId, sourceType: 'LOREBOOK_ENTRY', content, metadata: { ...metadata, at } });
      } else {
        const active = this.core.registry.getActiveRevision(sourceId);
        if (active.exactContent !== content) this.core.registry.replaceSource(sourceId, content);
      }
    }
    const coreRevision = this.core.registry.getActiveRevision(sourceId);
    const claimIds = this.core.graph.allClaims()
      .filter((claim) => (claim.provenance?.sourceRevisionIds ?? []).includes(coreRevision.id))
      .map((claim) => claim.id)
      .sort();
    this.sourceMap.set(sourceId, { laneRevisionId: revision.id, coreRevisionId: coreRevision.id, claimIds, extractionMode });
    return this.sourceMap.get(sourceId);
  }

  #sceneObservationExecutionReceipt({
    task,admission,status,reasonCode,attempted,returned,workerResult,sourceRevisionId,sceneRevision,parentWorkId,
    fieldNames=[],ambiguityCount=0,invalid=false,
  }={}){
    const profileId=workerResult?.workerId
      ? admission?.plan?.capabilityAdmission?.candidates?.find(row=>row.sourceWorkerId===workerResult.workerId)?.profileId??admission?.plan?.capabilityAdmission?.candidates?.[0]?.profileId??null
      : admission?.plan?.capabilityAdmission?.candidates?.[0]?.profileId??null;
    const resource=(this.resourceConnections.readModel().resources??[]).find(row=>row.providerProfileId===profileId)??null;
    return{
      kind:'DeploymentSceneObservationExecutionReceipt',contractVersion:1,
      status,reasonCode,workId:task?.taskId??null,parentWorkId:parentWorkId??task?.metadata?.parentWorkId??null,
      chatId:task?.metadata?.chatId??null,turnId:task?.turnId??null,generationId:task?.metadata?.generationId??null,correlationId:task?.correlationId??null,
      sourceRevisionId,sourceRevisionRefs:[sourceRevisionId].filter(Boolean),sceneRevision:Number(sceneRevision??task?.sceneRevision??0)||null,
      phase:task?.metadata?.phase??null,attempted:Boolean(attempted),returned:Boolean(returned),ownerAdmitted:null,
      invalid:Boolean(invalid),stale:false,late:false,degraded:status==='DEGRADED',skipped:status==='SKIPPED',
      resultId:workerResult?.resultId??null,resourceId:resource?.resourceId??null,providerProfileId:profileId,
      providerId:workerResult?.providerId??resource?.providerId??null,workerId:workerResult?.workerId??resource?.workerId??null,modelId:workerResult?.modelId??resource?.actualModelId??resource?.modelId??null,
      latencyMs:Number.isFinite(Number(workerResult?.latency))?Number(workerResult.latency):null,
      fieldNames:[...new Set(fieldNames)].sort().slice(0,16),ambiguityCount:Math.max(0,Math.min(4,Number(ambiguityCount)||0)),
      rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
      authorityGranted:false,canonicalMutation:false,settlementPerformed:false,contextSealAuthority:false,
    };
  }

  #sceneObservationOwnerReceipt({execution,accepted,reasonCode,stale=false,late=false,invalid=false,ownerReceipt=null}={}){
    return{
      kind:'DeploymentSceneObservationOwnerReceipt',contractVersion:1,
      chatId:execution?.chatId??null,turnId:execution?.turnId??null,generationId:execution?.generationId??null,correlationId:execution?.correlationId??null,
      workId:execution?.workId??null,parentWorkId:execution?.parentWorkId??null,
      sourceRevisionId:execution?.sourceRevisionId??null,sceneRevision:ownerReceipt?.sceneRevision??execution?.sceneRevision??null,
      phase:execution?.phase??null,attempted:Boolean(execution?.attempted),returned:Boolean(execution?.returned),
      ownerDecision:accepted?'ADMITTED':'REJECTED',ownerAdmissionPerformed:true,ownerAdmitted:Boolean(accepted),
      status:accepted?'ADMITTED':'REJECTED',reasonCode,stale:Boolean(stale),late:Boolean(late),invalid:Boolean(invalid),
      degraded:Boolean(execution?.degraded),skipped:Boolean(execution?.skipped),latencyMs:execution?.latencyMs??null,
      admissions:[{
        taskId:execution?.workId??null,resultId:execution?.resultId??null,resourceId:execution?.resourceId??null,
        providerProfileId:execution?.providerProfileId??null,providerId:execution?.providerId??null,workerId:execution?.workerId??null,
        acceptedByOwner:Boolean(accepted),destination:'SCENE_OWNER',stale:Boolean(stale),late:Boolean(late),invalid:Boolean(invalid),reason:reasonCode,
      }],
      changedFields:[...(ownerReceipt?.changedFields??[])].slice(0,16),
      rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
      settlementPerformed:false,canonicalMutation:false,authorityGranted:false,
    };
  }

  #retainSceneObservationReceipt(receipt){
    this.sceneObservationReceipts.push(clone(receipt));
    if(this.sceneObservationReceipts.length>128)this.sceneObservationReceipts.splice(0,this.sceneObservationReceipts.length-128);
    return receipt;
  }

  #syncOptionalDirectorProfiles() {
    const profiles = this.resourceConnections.profiles.list();
    this.resourceDirectorBridge.registerProfiles({ profiles });
    for (const profile of profiles) this.resourceDirectorBridge.syncProfileState(profile.profileId);
    return profiles;
  }

  async #executeLiveJevThroughDirector(liveJevExecutor, request, options = {}) {
    const baseTask = createJevCognitiveTask(request, { prefilter: options.prefilter ?? null });
    const input = createJevProviderInput(request, options.prefilter ?? null);
    const attempt = Math.max(1, Number(options.attempt ?? 1));
    const task = Object.freeze({
      ...baseTask,
      taskId: baseTask.taskId + ':optional-resource:' + attempt,
      dedupeKey: (baseTask.dedupeKey ?? baseTask.taskId) + ':optional-resource:' + attempt,
    });
    const contextTokens = Math.max(1, Math.ceil(new TextEncoder().encode(JSON.stringify(input)).length / 4));
    this.#syncOptionalDirectorProfiles();

    let execution = null;
    let executionError = null;
    const executor = {
      execute: async (context = {}) => {
        try {
          execution = await liveJevExecutor.execute(request, {
            ...options,
            profileId: context?.worker?.workerId ?? null,
            leaseHeld: true,
            signal: context?.signal ?? options.signal ?? null,
          });
          return execution;
        } catch (error) {
          executionError = error;
          throw error;
        }
      },
      validate: ({ output } = {}) => Boolean(output?.decision && output?.providerProvenance),
      commit: ({ output } = {}) => ({
        kind: 'DeploymentOptionalResourceCommitReceipt',
        taskId: task.taskId,
        providerExecution: clone(output?.providerProvenance ?? null),
        authorityGranted: false,
        canonicalMutation: false,
        settlementPerformed: false,
      }),
    };
    const admission = this.resourceDirectorBridge.admit(task, {
      executor,
      constraints: {
        contextTokens,
        expectedOutputTokens: Number(task.metadata?.expectedOutputTokens ?? 700),
        maxCostClass: 'HIGH',
        requireStructuredOutput: true,
        resourceClass: task.metadata?.resourceClass ?? null,
      },
      owner: 'JEV_OPTIONAL_RESOURCE',
    });
    if (admission.status !== 'ADMITTED') {
      const error = new Error('Optional resource was not admitted by the Runtime Director: ' + admission.status);
      error.code = 'OPTIONAL_RESOURCE_DIRECTOR_' + admission.status;
      throw error;
    }

    await this.resourceDirector.runCycle({ waitForTaskIds: [task.taskId] });
    this.#syncOptionalDirectorProfiles();
    if (executionError) throw executionError;
    const directorRecord = this.resourceDirector.ledger.get(task.taskId);
    if (directorRecord?.executionStatus !== 'COMPLETE') {
      const error = new Error('Optional resource execution was not completed by the Runtime Director: ' + String(directorRecord?.executionStatus ?? 'UNKNOWN'));
      error.code = 'OPTIONAL_RESOURCE_DIRECTOR_INCOMPLETE';
      throw error;
    }
    if (!execution) {
      const error = new Error('Optional resource execution did not produce a provider result: ' + String(directorRecord?.executionStatus ?? 'UNKNOWN'));
      error.code = 'OPTIONAL_RESOURCE_EXECUTION_MISSING';
      throw error;
    }

    const provenance = execution.providerProvenance ?? {};
    this.resourceOwnerReceipts.push({
      kind: 'DeploymentOptionalResourceOwnerReceipt',
      turnId: request?.turnId ?? null,
      correlationId: request?.correlationId ?? null,
      ownerDecision: 'ACCEPTED_FOR_JEV_REVIEW',
      ownerAdmissionPerformed: true,
      settlementPerformed: false,
      canonicalMutation: false,
      admissions: [{
        taskId: task.taskId,
        resultId: execution?.decision?.decisionId ?? null,
        resourceId: provenance.resourceId ?? null,
        providerProfileId: provenance.providerProfileId ?? null,
        providerId: provenance.providerId ?? null,
        workerId: provenance.workerId ?? null,
        acceptedByOwner: true,
        destination: 'JEV_DECISION_CORE',
        stale: false,
        late: false,
        invalid: false,
        reason: 'OWNER_REVIEW_ACCEPTED',
      }],
    });
    while (this.resourceOwnerReceipts.length > 128) this.resourceOwnerReceipts.shift();
    return execution;
  }

  async #invokeRuntime({ task, job }) {
    const cognitiveTask = job ?? task;
    if (cognitiveTask.taskType === 'LORE_RETRIEVAL') {
      const prepared = this.loreChannel.prepare(cognitiveTask.metadata.query, { intent: cognitiveTask.metadata.intent ?? 'AUTO' });
      return { value: 'LORE_PREPARED', nominationCount: prepared.nominations.length, retrievalIntentId: prepared.laneResult.retrievalIntentId };
    }
    if (cognitiveTask.taskType === 'GRAPH_LOOKUP') {
      const model = this.core.currentWorldModel();
      return { value: 'GRAPH_SNAPSHOT', worldRevision: model.revision, currentCount: model.current.length, unresolvedCount: model.unresolved.length };
    }
    if (cognitiveTask.taskType === 'JEV_DECISION') {
      const input = cognitiveTask.metadata.jevInput;
      const currentRevisionState = () => ({
        sourceRevisionSet: this.core.registry.activeRevisionIds(),
        worldRevision: this.core.graph.revision,
        sceneRevision: this.scene.uiReadModel(input.chatId)?.sceneRevision ?? input.sceneRevision,
        characterStateRevision: input.characterStateRevision,
        domainRevisions: {
          lore: this.loreSystem.diagnostics().hierarchyRevision ?? 'lore:1',
          owner: this.core.graph.revision,
        },
        freshnessToken: input.freshnessToken,
      });
      const admission = await adjudicateJevForOwner({
        service: this.jev.service,
        input,
        currentRevisionState,
        sealed: () => this.core.publication.seal.isTurnSealed(cognitiveTask.turnId),
        ownerReview: async (proposal) => {
          if (proposal.abstained || proposal.unresolved || proposal.staleState === 'STALE') {
            return { decision: 'UNRESOLVED', reasonCode: 'JEV_PROPOSAL_NOT_DECISIVE' };
          }
          const review = await this.loreJevOwnerReview(proposal);
          return { ...review, settlementPerformed: false, canonicalMutation: false };
        },
      });
      const proposal = admission.proposal;
      const executionEvidence = clone(this.jevExecution.get(String(cognitiveTask.turnId)) ?? null);
      const enriched = { ...clone(proposal), executionEvidence };
      this.pendingJev.set(cognitiveTask.turnId, enriched);
      this.pendingJevAdmission.set(cognitiveTask.turnId, clone(admission));
      return { value: admission.accepted ? proposal.proposedOutcome : 'UNRESOLVED', proposal: enriched, ownerAdmission: clone(admission), executionEvidence };
    }
    return { value: 'NO_OP', taskType: cognitiveTask.taskType };
  }

  #makeJevInput({ turn, query, planning, chatId }) {
    const rows = (planning?.nominations ?? []).slice(0, 8);
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
      chatId: String(chatId),
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

// Deterministic regression fixture only. Live SillyTavern execution must ingest operator-selected lore instead.
export function createGoldenDeploymentLorebook() {
  return {
    id: 'ember-golden',
    title: 'Ember Tavern Golden',
    discovery: { kind: 'DevelopmentDeploymentFixture', stableId: 'ember-golden', exactAuthoredSource: true },
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
