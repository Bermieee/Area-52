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
import { createExperienceProposalFromScene } from '../scene/scene-memory-handoff.js';
import { SceneLifecycleRuntime } from '../scene/scene-lifecycle-runtime.js';
import { SceneStateExtractor } from '../scene/scene-state-extractor.js';
import { SceneEventPublisher } from '../scene/event-publisher.js';
import { SceneContextInvalidationPublisher } from '../scene/context-invalidation.js';
import { SceneOperatorService } from '../scene/operator-service.js';
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
import { GatherCoordinator } from '../coprocessor/gather-coordinator.js';
import { createTurnEnvelope } from '../coprocessor/contracts.js';
import { plannerInputFromScene } from '../coprocessor/scene-signal-adapter.js';
import { LoreJevDecisionKind, LoreReconciliationClassification } from '../coprocessor/jev-lore-adapter.js';
import { ResultDestination, ResultPayloadClass, createCognitiveResult } from '../publication-contracts.js';
import { SpeculativeWarmCoordinator } from '../coprocessor/speculative-warmer-coordinator.js';
import { sha256Hex } from '../coprocessor/browser-compat.js';

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
const SCENE_EXACT_REVISION_OBLIGATION_EVENT_TYPES=new Set([
  SceneEventType.SCENE_STATE_DELTA,SceneEventType.LOCATION_CHANGED,SceneEventType.TIME_SHIFT_DETECTED,
  SceneEventType.ACTIVE_CAST_CHANGED,SceneEventType.RELATIONSHIP_SIGNAL,SceneEventType.SCENE_BOUNDARY_CANDIDATE,
  SceneEventType.SCENE_BOUNDARY_CONFIRMED,SceneEventType.SCENE_CLOSED,SceneEventType.SCENE_OPENED,
  SceneEventType.VIBE_CHANGED,SceneEventType.PREFETCH_RECOMMENDED,SceneEventType.OBJECT_TRANSITION,
]);
const SCENE_ACTIVE_AT_EXECUTION_EVENT_TYPES=new Set([
  SceneEventType.SCENE_STATE_DELTA,SceneEventType.LOCATION_CHANGED,SceneEventType.TIME_SHIFT_DETECTED,
  SceneEventType.ACTIVE_CAST_CHANGED,SceneEventType.RELATIONSHIP_SIGNAL,SceneEventType.SCENE_BOUNDARY_CANDIDATE,
  SceneEventType.SCENE_BOUNDARY_CONFIRMED,SceneEventType.SCENE_OPENED,SceneEventType.VIBE_CHANGED,
  SceneEventType.PREFETCH_RECOMMENDED,SceneEventType.OBJECT_TRANSITION,
]);
const SCENE_MEMORY_OWNER_PRODUCER_ID='MEMORY_SCENE_LIFECYCLE_OWNER';
const SCENE_MEMORY_ELIGIBLE_EVENT_TYPES=new Set([SceneEventType.SCENE_EPISODE_READY]);
const SCENE_MEMORY_HISTORICAL_EVENT_TYPES=new Set([
  SceneEventType.SCENE_BOUNDARY_CONFIRMED,SceneEventType.SCENE_EPISODE_READY,SceneEventType.SCENE_CLOSED,
]);
const sameRefs=(left,right)=>JSON.stringify(uniq(left).sort())===JSON.stringify(uniq(right).sort());


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
  constructor({ loreSystem, core, sourceMap, maxPrepared = 64 }) {
    this.loreSystem = loreSystem;
    this.core = core;
    this.sourceMap = sourceMap;
    this.prepared = new Map();
    this.speculativePrepared = new Map();
    this.maxPrepared = Math.max(8, Number(maxPrepared) || 64);
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
    this.#remember(this.prepared, String(query), prepared);
    return prepared;
  }

  prepareSpeculative(preparationRef, query, { intent = 'NARROW' } = {}) {
    const ref=String(preparationRef??'').trim();
    if(!ref)throw new TypeError('speculative lore preparation ref is required');
    const prepared=this.prepare(query,{intent});
    this.#remember(this.speculativePrepared,ref,prepared);
    return prepared;
  }

  activateSpeculative(preparationRef, query) {
    const ref=String(preparationRef??'').trim();
    const prepared=this.speculativePrepared.get(ref);
    if(!ref||!prepared)return null;
    this.#remember(this.prepared,String(query),prepared);
    return prepared;
  }

  discardSpeculative(preparationRef) {
    return this.speculativePrepared.delete(String(preparationRef??''));
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
    this.#remember(this.prepared,String(query),Object.freeze({ ...original, nominations: [...byId.values()] }));
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

  #remember(map,key,value){
    map.delete(key);
    map.set(key,value);
    while(map.size>this.maxPrepared)map.delete(map.keys().next().value);
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
    this.sceneMemoryLifecycleReceipts = [];
    const sceneTimelineSink = (type) => (value) => {
      this.sceneOwnerTimeline.push({ type, value: clone(value) });
      if (this.sceneOwnerTimeline.length > 256) this.sceneOwnerTimeline.splice(0, this.sceneOwnerTimeline.length - 256);
    };
    const sceneTimelineEventSink=sceneTimelineSink('EVENT');
    this.scene = new SceneLifecycleRuntime({
      publisher: new SceneEventPublisher({ sink: sceneTimelineEventSink }),
      contextInvalidationPublisher: new SceneContextInvalidationPublisher({ sink: sceneTimelineSink('INVALIDATION') }),
    });
    const coreRevisionCurrent=this.core.publication.resultBus.isSourceRevisionCurrent.bind(this.core.publication.resultBus);
    this.core.publication.resultBus.isSourceRevisionCurrent=(revisionId)=>{
      const id=String(revisionId),chatId=String(this.core.hotCognition?.activeChatNamespace??'');
      if(chatId&&(this.scene.narrativeFeed.currentEvidence(chatId)??[]).some(row=>String(row.sourceRevisionId)===id))return true;
      return coreRevisionCurrent(id);
    };
    this.sceneOperator = new SceneOperatorService({ runtime: this.scene });
    this.sceneObservationExtractor = new SceneStateExtractor({ agent: 'area52-cognitive-resource' });
    this.sceneObservationReceipts = [];
    this.memory = new MemoryTemporalProducer({ snapshot: memoryOwnerSnapshot });
    this.memorySurface = createMemoryIntegrationSurface(this.memory);
    this.#installSceneMemoryRetrievalObserver();
    this.sourceMap = new Map();
    this.loreChannel = new RuntimePreparedLoreChannel({ loreSystem: this.loreSystem, core: this.core, sourceMap: this.sourceMap });
    this.core.registerRetrievalChannel(this.loreChannel);
    this.coprocessorTelemetry = new CoprocessorTelemetry({ limit: 2000 });
    this.resourceConnections = new CoprocessorResourceConnections({ telemetry: this.coprocessorTelemetry });
    this.scenePrefetchSwarm = new NativeSidecarSwarm({ connections: this.resourceConnections, telemetry: this.coprocessorTelemetry });
    this.scenePrefetchConsiderations = [];
    this.sceneFanOutAssemblies = [];
    this.resourceDirectorResults = [];
    this.resourceOwnerReceipts = [];
    this.resourceDirector = new WorkerDirector({
      persistence: null,
      capacity: { CPU: Math.max(1, Number(resourceCount) || 1) },
      foregroundReserve: { CPU: 1 },
      batch: { base: 1, max: 1 },
      maxRetries: 0,
      isTurnSealed: (turnId) => this.core.publication.seal.isTurnSealed(turnId),
      resultSink: (result) => {
        this.resourceDirectorResults.push(clone(result));
        if(this.resourceDirectorResults.length>256)this.resourceDirectorResults.splice(0,this.resourceDirectorResults.length-256);
        if(result?.taskType==='SCENE_OBSERVATION')void this.#considerSceneObservationRuntimeResult(result).catch(error=>{
          this.#retainSceneObservationReceipt({
            kind:'DeploymentSceneObservationRuntimeReceipt',contractVersion:1,status:'FAILED',
            reasonCode:error?.code??'SCENE_RESULT_CONSIDERATION_FAILED',workId:result.taskId??null,
            errorMessage:String(error?.message??error).slice(0,240),
            rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
            authorityGranted:false,canonicalMutation:false,settlementPerformed:false,contextSealAuthority:false,
          });
        });
        this.#pumpResourceDirector();
      },
    });
    this.sceneRuntimePumpScheduled=false;
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
      const foreground=request.operation==='EMBED_QUERY';
      if(!vector)return{status:'UNAVAILABLE',reasonCode:'VECTOR_PROVIDER_UNAVAILABLE',requestPurpose:'COGNITIVE_EXECUTION',foregroundBudgetMs:foreground?1200:null,providerAttempted:false,providerReturned:false};
      const executeEmbedding=async()=>{
        const controller=foreground?new AbortController():null;
        const timer=foreground?setTimeout(()=>controller.abort('MEMORY_VECTOR_QUERY_BUDGET_EXCEEDED'),1200):null;
        try{
          const result=await this.resourceConnections.executeEmbedding(vector.resourceId,{input:request.input,signal:controller?.signal??null,
            origin:{operation:request.operation,selection:request.selection??{chatId:request.chatId??null},workId:request.workId??null,artifactId:request.artifactId??null,artifactRevision:request.artifactRevision??null}});
          return{...result,providerAttempted:true,providerReturned:Boolean(Array.isArray(result?.embeddings)&&result.embeddings.length)};
        }catch(error){
          if(foreground&&controller.signal.aborted)return{status:'UNAVAILABLE',executionId:error?.executionId??null,reasonCode:'VECTOR_QUERY_BUDGET_EXCEEDED',requestPurpose:'COGNITIVE_EXECUTION',foregroundBudgetMs:1200,providerAttempted:true,providerReturned:false};
          if(error&&typeof error==='object')error.providerAttempted=true;
          throw error;
        }finally{
          if(timer)clearTimeout(timer);
        }
      };
      if(!foreground)return executeEmbedding();
      const selection=request.selection??{};
      const workId='memory-dense-query:'+String(selection.turnId??'turn')+':'+String(selection.generationId??'generation');
      const hot=await this.resourcePlacementScheduler.runHot(workId,executeEmbedding,{metadata:{operation:'EMBED_QUERY',resultClass:'OPPORTUNISTIC',chatId:selection.chatId??null,turnId:selection.turnId??null,generationId:selection.generationId??null}});
      return{...(hot.result??{}),foregroundBudgetMs:1200,foregroundQueueWaitMs:hot.queueMs,providerExecutionMs:hot.executionMs,foregroundBlockedMs:Math.max(0,Number(hot.queueMs??0)+Number(hot.executionMs??0))};
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
    this.speculativeWarmReceipts=[];
    this.speculativeWarmTurnSequence=0;
    this.speculativeWarmPumpScheduled=false;
    this.speculativeWarmPumpPromise=Promise.resolve();
    this.speculativeWarmer=new SpeculativeWarmCoordinator({
      adapters:this.#createInstalledSpeculativeWarmAdapters(),
      telemetry:this.coprocessorTelemetry,
    });
    this.speculativeWarmOwnerRelease=this.#installSpeculativeWarmOwner();
    this.sceneMemoryOwnerRelease=this.#installSceneMemoryOwnerMapping();
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
    if (atmosphere != null) {
      // Public rehearsal/operator boundary: a dimension map (or {value: map}) is atmosphere
      // evidence; free text is retained only as a description and never becomes dimensions.
      const description = typeof atmosphere === 'string' ? atmosphere : null;
      const dimensions = description == null ? (atmosphere?.value ?? atmosphere) : {};
      fields.atmosphere = this.scene.atmosphereTracker.update({revision:nextRevision,evidenceRefs:[evidenceRef],dimensions,metadata:description==null?{}:{description}});
    }
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
    phase='FOREGROUND_USER',parentWorkId=null,foregroundBudgetMs=1200,hostEvent=null,
  }={}){
    const chat=String(chatId??'').trim(),turn=String(turnId??'').trim(),generation=String(generationId??'').trim();
    const sourceRef=String(sourceRevisionId??'').trim(),text=String(narrative??'').trim().slice(0,6000);
    if(!chat||!turn||!generation||!sourceRef||!text)throw new TypeError('Scene observation work requires chatId, turnId, generationId, sourceRevisionId, and narrative');
    const correlation=String(correlationId??('corr:'+generation));
    const current=this.scene.ensureChatScene(chat,{sourceRevisionRefs:[sourceRef],evidenceRefs:[sourceRef]});
    const task=createSceneObservationTask({
      chatId:chat,turnId:turn,generationId:generation,correlationId:correlation,sourceRevisionId:sourceRef,
      sceneId:current.sceneId,sceneRevision:current.revision,worldRevision:this.core.graph.revision,phase,parentWorkId,
      hostIdentity:hostEvent?{
        activity:hostEvent.activity??null,messageId:hostEvent.messageId??null,messageRevision:hostEvent.messageRevision??null,
        causationId:hostEvent.causationId??null,
      }:null,
      foregroundBudgetMs,now:Date.now(),narrative:text,
      sceneWorkload:{cast:current.fields?.activeCast?.value?.length??0,objects:current.fields?.immediateObjects?.value?.length??0,relationships:current.fields?.activeRelationships?.value?.length??0,threads:current.fields?.activeThreads?.value?.length??0},
    });
    this.#cancelSceneObservationTasks({chatId:chat,phase,exceptTaskId:task.taskId,reason:'SCENE_OBSERVATION_SUPERSEDED'});
    this.#syncOptionalDirectorProfiles();
    const baseExecutor=createResourceDirectorExecutor({
      connections:this.resourceConnections,task,
      inputResolver:()=>({
        narrative:text,phase,sceneId:current.sceneId,baseRevision:current.revision,
        evidenceRef:sourceRef,sourceRevisionId:sourceRef,
      }),
    });
    const contextTokens=Math.max(1,Math.ceil(new TextEncoder().encode(text).length/4));
    const admission=this.resourceDirectorBridge.admit(task,{
      executor:baseExecutor,units:[{id:task.taskId+':unit',payload:{sourceRevisionId:sourceRef,sceneRevision:current.revision,phase}}],
      constraints:{contextTokens,expectedOutputTokens:task.metadata.expectedOutputTokens,maxCostClass:'HIGH',requireStructuredOutput:true},
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
    const deduped=Boolean(admission.directorAdmission?.deduped);
    const receipt=this.#sceneObservationExecutionReceipt({
      task,admission,status:deduped?'DEDUPED':'QUEUED',reasonCode:deduped?'SCENE_OBSERVATION_RUNTIME_DEDUPED':'SCENE_OBSERVATION_RUNTIME_QUEUED',
      attempted:false,returned:false,workerResult:null,sourceRevisionId:sourceRef,sceneRevision:current.revision,parentWorkId,
    });
    receipt.foregroundDisposition=phase==='POST_RESPONSE'?'BACKGROUND':'DETERMINISTIC_FALLBACK_AND_FORWARD_RESULT';
    this.#retainSceneObservationReceipt(receipt);
    this.#pumpResourceDirector();
    return{
      kind:'SceneObservationWorkResult',status:deduped?'DEDUPED':'QUEUED',proposal:null,boundarySignals:{},executionReceipt:receipt,
      foregroundDisposition:phase==='POST_RESPONSE'?'BACKGROUND':'DETERMINISTIC_FALLBACK_AND_FORWARD_RESULT',
    };
  }

  #pumpResourceDirector(){
    if(this.sceneRuntimePumpScheduled)return;
    this.sceneRuntimePumpScheduled=true;
    setTimeout(()=>{
      this.sceneRuntimePumpScheduled=false;
      void this.resourceDirector.runCycle({waitForTaskIds:[]}).catch(error=>{
        this.#retainSceneObservationReceipt({
          kind:'DeploymentSceneObservationRuntimeReceipt',contractVersion:1,status:'FAILED',reasonCode:error?.code??'SCENE_RUNTIME_PUMP_FAILED',
          errorMessage:String(error?.message??error).slice(0,240),authorityGranted:false,canonicalMutation:false,settlementPerformed:false,contextSealAuthority:false,
        });
      });
    },0);
  }

  #cancelSceneObservationTasks({chatId=null,phase=null,sourceRevisionRefs=[],exceptTaskId=null,taskId=null,foreignToChat=null,reason='SCENE_OBSERVATION_CANCELLED'}={}){
    const refs=new Set((sourceRevisionRefs??[]).filter(Boolean).map(String)),cancelled=[];
    for(const record of this.resourceDirector.ledger.list()){
      if(record?.obligation?.taskType!=='SCENE_OBSERVATION')continue;
      if(['SATISFIED','SUPERSEDED','CANCELLED'].includes(String(record.lifecycleStatus)))continue;
      const task=record.obligation?.payload?.cognitiveTask??null,meta=task?.metadata??{};
      if(exceptTaskId&&record.taskId===exceptTaskId)continue;
      let match=false;
      if(taskId)match=record.taskId===String(taskId);
      else if(foreignToChat)match=String(meta.chatId??'')!==String(foreignToChat);
      else if(refs.size)match=(task?.sourceRevisionSet??task?.inputRevisionSet?.sourceRevisionSet??[]).some(ref=>refs.has(String(ref)));
      else if(chatId)match=String(meta.chatId??'')===String(chatId)&&(!phase||String(meta.phase??'')===String(phase));
      if(!match)continue;
      const physical=this.resourceConnections.cancelTask?.(record.taskId,{reason})??false;
      const runtime=this.resourceDirector.cancelTask(record.taskId,reason);
      const receipt={
        kind:'DeploymentSceneObservationExecutionReceipt',contractVersion:1,status:'CANCELLED',reasonCode:reason,workId:record.taskId,
        chatId:meta.chatId??null,turnId:task?.turnId??null,generationId:meta.generationId??null,correlationId:task?.correlationId??null,
        sourceRevisionId:meta.sourceRevisionId??null,sourceRevisionRefs:[...(task?.sourceRevisionSet??task?.inputRevisionSet?.sourceRevisionSet??[])],
        sceneRevision:task?.sceneRevision??null,phase:meta.phase??null,attempted:Boolean(record.startedCount),returned:false,
        physicalCancellationRequested:Boolean(physical),runtimeCancellationRecorded:Boolean(runtime),cancelled:true,stale:refs.size>0||Boolean(foreignToChat),
        rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
        authorityGranted:false,canonicalMutation:false,settlementPerformed:false,contextSealAuthority:false,
      };
      this.#retainSceneObservationReceipt(receipt);cancelled.push(receipt);
    }
    return clone(cancelled);
  }

  cancelSceneObservationWork({taskId,reason='SCENE_OBSERVATION_OPERATOR_CANCELLED'}={}){
    return this.#cancelSceneObservationTasks({taskId,reason});
  }

  #sceneObservationWorkFromRuntime(task,workerResult,executionReceipt){
    const sourceRef=String(task?.metadata?.sourceRevisionId??task?.sourceRevisionSet?.[0]??'');
    const sceneId=String(task?.metadata?.sceneId??'');
    const record=sceneId?this.scene.registry.get(sceneId):null;
    const dispatchedScene=(record?.snapshots??[]).find(row=>Number(row?.revision)===Number(task?.sceneRevision))??null;
    if(!sourceRef||!dispatchedScene)throw Object.assign(new Error('Scene runtime result no longer has its exact source/Scene base snapshot'),{code:'SCENE_PROPOSAL_STALE_REVISION'});
    const fields={};
    for(const [name,row] of Object.entries(workerResult?.payload?.fields??{})){
      const observationClass=row?.observationClass??ObservationClass.UNKNOWN;
      fields[name]={
        value:clone(row?.value??null),confidence:Number(row?.confidence??0),observationClass,
        evidenceRefs:observationClass===ObservationClass.UNKNOWN?[]:[sourceRef],
        provenance:observationClass===ObservationClass.UNKNOWN?[]:['area52-cognitive-resource:'+sourceRef],
      };
    }
    const proposal=this.sceneObservationExtractor.propose({
      scene:dispatchedScene,evidence:{id:sourceRef,sourceRevisionId:sourceRef},fields,
      provider:String(workerResult?.providerId??'area52-cognitive-resource'),
    });
    return{
      kind:'SceneObservationWorkResult',status:'RETURNED',proposal,
      boundarySignals:clone(workerResult?.payload?.boundarySignals??{}),ambiguities:clone(workerResult?.payload?.ambiguities??[]),
      executionReceipt,
    };
  }

  async #considerSceneObservationRuntimeResult(envelope){
    const record=this.resourceDirector.ledger.get(String(envelope?.taskId??'')),task=record?.obligation?.payload?.cognitiveTask??null;
    if(!task||task.taskType!=='SCENE_OBSERVATION')return null;
    const meta=task.metadata??{},sourceRef=String(meta.sourceRevisionId??task.sourceRevisionSet?.[0]??'');
    if(envelope.executionOutcome!=='COMPLETED'){
      const receipt=this.#sceneObservationExecutionReceipt({
        task,admission:null,status:'FAILED',reasonCode:envelope.providerFailure?.code??'SCENE_OBSERVATION_EXECUTION_FAILED',
        attempted:true,returned:false,workerResult:null,sourceRevisionId:sourceRef,sceneRevision:task.sceneRevision,parentWorkId:meta.parentWorkId,
      });
      receipt.providerFailure=clone(envelope.providerFailure??null);this.#retainSceneObservationReceipt(receipt);return receipt;
    }
    const workerResult=envelope.opaqueResult;
    if(!workerResult||workerResult.kind!=='CognitiveWorkerResult'||workerResult.status!=='SUCCESS'||workerResult.taskId!==task.taskId){
      this.resourceDirector.recordOwnerAdmission(task.taskId,{accepted:false,reasonCode:CausalReasonCode.OWNER_REJECTED,consumerId:'SCENE_OWNER'});
      const receipt=this.#sceneObservationExecutionReceipt({
        task,admission:null,status:'INVALID',reasonCode:'SCENE_RUNTIME_RESULT_CONTRACT_INVALID',
        attempted:true,returned:Boolean(workerResult),workerResult,sourceRevisionId:sourceRef,sceneRevision:task.sceneRevision,parentWorkId:meta.parentWorkId,invalid:true,
      });
      this.#retainSceneObservationReceipt(receipt);return receipt;
    }
    const executionReceipt=this.#sceneObservationExecutionReceipt({
      task,admission:null,status:'RETURNED',reasonCode:'SCENE_OBSERVATION_PHYSICAL_COMPLETION',
      attempted:true,returned:true,workerResult,sourceRevisionId:sourceRef,sceneRevision:task.sceneRevision,parentWorkId:meta.parentWorkId,
      fieldNames:Object.keys(workerResult.payload?.fields??{}),ambiguityCount:(workerResult.payload?.ambiguities??[]).length,
    });
    executionReceipt.completedAfterForegroundDeadline=Number(envelope?.timing?.completedAt??0)>Number(task.hardDeadline??Number.MAX_SAFE_INTEGER);
    this.#retainSceneObservationReceipt(executionReceipt);

    const requestedDestination=meta.phase==='POST_RESPONSE'?ResultDestination.BACKGROUND:ResultDestination.NEXT_TURN;
    const cognitiveResult=createCognitiveResult({
      id:'scene-observation-result:'+String(workerResult.resultId??task.taskId),taskId:task.taskId,turnId:task.turnId,
      correlationId:task.correlationId,causationId:task.causationId??null,sourceSubsystem:'SCENE_OBSERVATION',
      workerId:workerResult.workerId??null,destinationOwner:'SCENE_OWNER',resultType:'SCENE_OBSERVATION_PROPOSAL',
      resultClass:task.resultClass,payloadClass:ResultPayloadClass.PROPOSAL,evidenceIds:[sourceRef],
      provenance:{physicalResultId:workerResult.resultId??null,providerId:workerResult.providerId??null,modelId:workerResult.modelId??null,sceneId:meta.sceneId??null,originalTurnId:task.turnId,originalGenerationId:meta.generationId??null},
      sourceRevisionIds:[sourceRef],worldRevision:task.worldRevision,sceneRevision:task.sceneRevision,authorityClass:'UNRESOLVED',
      destination:requestedDestination,payload:{fields:clone(workerResult.payload?.fields??{}),boundarySignals:clone(workerResult.payload?.boundarySignals??{}),ambiguities:clone(workerResult.payload?.ambiguities??[])},
      timing:{providerLatencyMs:workerResult.latency??envelope?.timing?.providerLatencyMs??null,completedAt:envelope?.timing?.completedAt??null,foregroundQuorumDeadline:task.hardDeadline??null},
    });
    const routed=this.core.publication.receiveResult(cognitiveResult);
    const routeReceipt={
      kind:'DeploymentSceneObservationRouteReceipt',contractVersion:1,status:routed.route.accepted?'ROUTED':'REJECTED',
      reasonCode:routed.route.reason??null,workId:task.taskId,resultId:cognitiveResult.id,physicalResultId:workerResult.resultId??null,
      chatId:meta.chatId??null,turnId:task.turnId,generationId:meta.generationId??null,correlationId:task.correlationId,
      sourceRevisionRefs:[sourceRef],sceneRevision:task.sceneRevision,resultClass:task.resultClass,
      requestedDestination,effectiveDestination:routed.route.effectiveDestination,freshness:routed.route.freshness,
      late:Boolean(routed.route.late),duplicate:Boolean(routed.duplicate),ownerConsideration:routed.duplicate?'SUPPRESSED_DUPLICATE':'PENDING',
      authorityGranted:false,canonicalMutation:false,settlementPerformed:false,contextSealAuthority:false,
    };
    this.#retainSceneObservationReceipt(routeReceipt);
    if(routed.duplicate)return routeReceipt;
    if(!routed.route.accepted||routed.route.freshness!=='FRESH'||![ResultDestination.NEXT_TURN,ResultDestination.BACKGROUND].includes(routed.route.effectiveDestination)){
      this.resourceDirector.recordOwnerAdmission(task.taskId,{accepted:false,reasonCode:CausalReasonCode.STALE_RESULT,consumerId:'SCENE_OWNER'});
      const owner=this.#sceneObservationOwnerReceipt({execution:executionReceipt,accepted:false,reasonCode:'SCENE_RESULT_BUS_'+String(routed.route.freshness??'REJECTED'),stale:routed.route.freshness!=='FRESH',invalid:!routed.route.accepted});
      this.#retainSceneObservationReceipt(owner);return owner;
    }
    let work;
    try{work=this.#sceneObservationWorkFromRuntime(task,workerResult,executionReceipt);}
    catch(error){
      this.resourceDirector.recordOwnerAdmission(task.taskId,{accepted:false,reasonCode:CausalReasonCode.STALE_RESULT,consumerId:'SCENE_OWNER'});
      const owner=this.#sceneObservationOwnerReceipt({execution:executionReceipt,accepted:false,reasonCode:error?.code??'SCENE_PROPOSAL_CONTRACT_INVALID',stale:true,invalid:error?.code!=='SCENE_PROPOSAL_STALE_REVISION'});
      this.#retainSceneObservationReceipt(owner);return owner;
    }
    const stored=this.scene.narrativeFeed.findSourceRevision(String(meta.chatId??''),sourceRef);
    const hostIdentity=meta.hostIdentity??{};
    const hostEvent={
      activity:hostIdentity.activity??stored?.activity??null,chatId:meta.chatId,messageId:hostIdentity.messageId??stored?.messageId??null,
      messageRevision:hostIdentity.messageRevision??stored?.messageRevision??null,turnId:task.turnId,generationId:meta.generationId,
      correlationId:task.correlationId,causationId:hostIdentity.causationId??task.causationId??null,sourceRevisionId:sourceRef,
      content:stored?.content??'',role:stored?.role??null,
    };
    const currentSelection=()=>{
      const active=String(this.core.hotCognition?.activeChatNamespace??'');
      return active===String(meta.chatId??'')&&(this.scene.narrativeFeed.currentEvidence(active)??[]).some(row=>String(row.sourceRevisionId)===sourceRef);
    };
    let jevAdvice=null;
    if(Array.isArray(work.ambiguities)&&work.ambiguities.length&&typeof this.adjudicateSceneObservationAmbiguity==='function'){
      jevAdvice=await this.adjudicateSceneObservationAmbiguity({
        work,hostEvent,currentSelection,turnSealed:()=>this.core.publication.seal.isTurnSealed(task.turnId),ownerRoute:routed.route.effectiveDestination,
      });
    }
    const admission=this.admitSceneObservationProposal({
      work,hostEvent,currentSelection:currentSelection(),turnSealed:this.core.publication.seal.isTurnSealed(task.turnId),
      jevAdvice,ownerRoute:routed.route.effectiveDestination,existingEvidence:true,
    });
    routeReceipt.ownerConsideration=admission.accepted?'ADMITTED':'REJECTED';
    this.#emit({type:'SCENE_OBSERVATION_RESULT_CONSIDERED',route:clone(routeReceipt),admission:clone(admission.receipt??null)});
    return admission.receipt??routeReceipt;
  }

  async adjudicateSceneObservationAmbiguity({
    work,hostEvent,currentSelection=true,turnSealed=false,ownerRoute=null,
  }={}){
    const proposal=work?.proposal,execution=work?.executionReceipt??null;
    const ambiguity=Array.isArray(work?.ambiguities)?work.ambiguities[0]??null:null;
    const selected=()=>typeof currentSelection==='function'?Boolean(currentSelection()):Boolean(currentSelection);
    const sealed=()=>typeof turnSealed==='function'?Boolean(turnSealed()):Boolean(turnSealed);
    const futureRoute=[ResultDestination.NEXT_TURN,ResultDestination.BACKGROUND].includes(ownerRoute);
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
    if(!futureRoute&&phase!=='POST_RESPONSE'&&sealed())return finish('UNRESOLVED','SCENE_JEV_LATE_AFTER_SEAL',{late:true});
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
      adapterMetadata:{sceneId:proposal.sceneId,field:String(ambiguity.field),sourceRevisionId:hostSource,selection:{chatId:execution?.chatId??null,generationId:execution?.generationId??null}},
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
          &&(futureRoute||phase==='POST_RESPONSE'||!sealed())
          &&Number(ownerScene?.revision)===Number(proposal.baseRevision)
          &&optionIds.has(String(jevProposal?.proposedOutcome??''))
        ),
      });
    }catch(error){
      return finish('UNRESOLVED','JEV_EXECUTION_UNAVAILABLE',{degraded:true,errorCode:String(error?.code??'JEV_EXECUTION_UNAVAILABLE')});
    }
    const currentAfter=this.scene.registry.current(proposal.sceneId);
    if(!selected())return finish('UNRESOLVED','SCENE_JEV_SELECTION_SUPERSEDED',{stale:true,ownerReview:clone(review)});
    if(!futureRoute&&phase!=='POST_RESPONSE'&&sealed())return finish('UNRESOLVED','SCENE_JEV_LATE_AFTER_SEAL',{late:true,ownerReview:clone(review)});
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
    work,hostEvent,currentSelection=true,turnSealed=false,jevAdvice=null,ownerRoute=null,existingEvidence=false,
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
    const futureRoute=[ResultDestination.NEXT_TURN,ResultDestination.BACKGROUND].includes(ownerRoute);
    if(!futureRoute&&phase!=='POST_RESPONSE'&&turnSealed)return reject('SCENE_PROPOSAL_LATE_AFTER_SEAL',{late:true});
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
      ownerReceipt=this.ingestSceneHostEvent(hostEvent,{existingEvidence,extract:()=>({
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

  readSceneObservationRuntime(selection={}){
    const tasks=this.resourceDirector.ledger.list().filter(row=>{
      const task=row.obligation?.payload?.cognitiveTask;
      return row.obligation?.taskType==='SCENE_OBSERVATION'
        &&(!selection.chatId||task?.metadata?.chatId===selection.chatId)
        &&(!selection.generationId||task?.metadata?.generationId===selection.generationId);
    }).slice(-64).map(row=>({
      taskId:row.taskId,lifecycleStatus:row.lifecycleStatus,executionStatus:row.executionStatus,
      executionReason:row.executionReason,startedCount:row.startedCount,resumeCount:row.resumeCount,
      layer:row.obligation.layer,foreground:row.obligation.foreground,
      requiredCapabilities:[...row.obligation.requiredCapabilities],
      negotiation:clone(row.negotiation),dependencyState:clone(row.dependencyState),
      executorAttached:this.resourceDirector.executors.has(row.taskId),
      inflight:this.resourceDirector.inflight.has(row.taskId),
    }));
    return{
      kind:'SceneObservationRuntimeReadModel',tasks,
      queueDepth:this.resourceDirector.scheduler.depthByLayer(),
      resources:this.resourceDirector.governor.snapshot(),pumpScheduled:this.sceneRuntimePumpScheduled,
      workers:this.resourceDirector.registry.snapshot().slice(0,32).map(row=>({
        workerId:row.workerId,capabilities:row.capabilities,supportedLayers:row.supportedLayers,
        resourceProfile:row.resourceProfile,available:row.available,health:row.health,
        foregroundEligible:row.foregroundEligible,backgroundEligible:row.backgroundEligible,
        currentLoad:row.currentLoad,concurrencyCapacity:row.concurrencyCapacity,
      })),
      metadataOnly:true,authorityGranted:false,
    };
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

  #sceneEventObligationGuard(event,{execution=false,ownerPolicy=null}={}){
    if(event?.producer!=='SCENE_INTELLIGENCE')return{accepted:false,reasonCode:'SCENE_EVENT_PRODUCER_MISMATCH'};
    if(!event?.chatId)return{accepted:false,reasonCode:'SCENE_EVENT_CHAT_ID_MISSING'};
    const sealed=Boolean(event.turnId&&this.core.publication.seal.isTurnSealed(event.turnId));
    const resolvedPolicy=typeof ownerPolicy==='function'?ownerPolicy(clone(event),{execution,sealed}):(ownerPolicy??null);
    const historicalLifecycle=Boolean(
      resolvedPolicy?.historicalLifecycle===true
      &&SCENE_MEMORY_HISTORICAL_EVENT_TYPES.has(event.eventType)
      &&String(resolvedPolicy?.destination??'').toUpperCase()==='BACKGROUND'
    );
    const activeChat=String(this.core.hotCognition?.activeChatNamespace??this.scene.narrativeFeed.activeChatId??'');
    if(!historicalLifecycle&&activeChat&&String(event.chatId)!==activeChat)return{accepted:false,reasonCode:'SCENE_EVENT_FOREIGN_CHAT'};
    if(sealed&&!historicalLifecycle)return{accepted:false,reasonCode:'SCENE_EVENT_POST_SEAL'};
    const refs=uniq(event.revisionFences?.sourceRevisionIds??Object.keys(event.sourceRevisions??{}));
    for(const ref of refs){
      const source=this.scene.narrativeFeed.findSourceRevision(String(event.chatId),String(ref));
      if(!source||source.current!==true)return{accepted:false,reasonCode:'SCENE_EVENT_STALE_SOURCE'};
    }
    if(historicalLifecycle){
      const record=this.scene.registry.get(String(event.sceneId??''));
      const snapshot=(record?.snapshots??[]).find(row=>Number(row?.revision)===Number(event.sceneRevision))??null;
      if(!snapshot)return{accepted:false,reasonCode:'SCENE_EVENT_STALE_SCENE_REVISION'};
      const snapshotRefs=uniq(snapshot.sourceRevisionRefs??[]);
      for(const ref of snapshotRefs){
        const source=this.scene.narrativeFeed.findSourceRevision(String(event.chatId),String(ref));
        if(!source||source.current!==true)return{accepted:false,reasonCode:'SCENE_EVENT_HISTORICAL_SOURCE_INVALID'};
      }
      if(event.eventType===SceneEventType.SCENE_EPISODE_READY){
        const episodeRef=event.payload?.episodeRef??null;
        const episode=episodeRef?.artifactId?this.scene.episodeCompiler.get(String(episodeRef.artifactId)):null;
        if(!episode)return{accepted:false,reasonCode:'SCENE_EVENT_EPISODE_UNAVAILABLE'};
        if(String(episode.sceneId)!==String(event.sceneId)||Number(episode.sceneRevision)!==Number(event.sceneRevision))return{accepted:false,reasonCode:'SCENE_EVENT_EPISODE_REVISION_MISMATCH'};
        if(Number(episodeRef.revision)!==Number(episode.artifactRef?.revision)||!sameRefs(episodeRef.sourceRevisionSet??[],episode.artifactRef?.sourceRevisionSet??[]))return{accepted:false,reasonCode:'SCENE_EVENT_EPISODE_REF_MISMATCH'};
        for(const ref of uniq(episode.sourceRevisionRefs??episodeRef.sourceRevisionSet??[])){
          const source=this.scene.narrativeFeed.findSourceRevision(String(event.chatId),String(ref));
          if(!source||source.current!==true)return{accepted:false,reasonCode:'SCENE_EVENT_EPISODE_SOURCE_INVALID'};
        }
      }
    }else if(SCENE_EXACT_REVISION_OBLIGATION_EVENT_TYPES.has(event.eventType)){
      const current=this.scene.registry.current(String(event.sceneId??''));
      if(!current||Number(current.revision)!==Number(event.sceneRevision))return{accepted:false,reasonCode:'SCENE_EVENT_STALE_SCENE_REVISION'};
    }
    if(!historicalLifecycle&&execution&&SCENE_ACTIVE_AT_EXECUTION_EVENT_TYPES.has(event.eventType)){
      const activeSceneId=this.scene.chatScenes.get(String(event.chatId))??null;
      if(activeSceneId&&String(activeSceneId)!==String(event.sceneId??''))return{accepted:false,reasonCode:'SCENE_EVENT_SUPERSEDED_SCENE'};
    }
    return{accepted:true,reasonCode:historicalLifecycle?'SCENE_EVENT_HISTORICAL_BACKGROUND_ALLOWED':'SCENE_EVENT_CURRENT',historicalLifecycle,destination:resolvedPolicy?.destination??null};
  }

  bindSceneEventObligationOwner({producer,eventTypes,mapEvent,executorFactory,ownerPolicy=null,onDisposition=null}={}){
    const producerId=String(producer?.producerId??'').trim();
    if(!producerId)throw new TypeError('Scene event obligation owner requires producer.producerId');
    if(typeof mapEvent!=='function')throw new TypeError('Scene event obligation owner requires mapEvent');
    if(typeof executorFactory!=='function')throw new TypeError('Scene event obligation owner requires executorFactory');
    if(onDisposition!==null&&typeof onDisposition!=='function')throw new TypeError('Scene event obligation owner onDisposition must be a function');
    if(!this.runtime.producers.list().some(row=>row.producerId===producerId))this.runtime.registerProducer(producer);
    const types=uniq(eventTypes??[]);
    if(!types.length)throw new TypeError('Scene event obligation owner requires eventTypes');
    for(const eventType of types)if(!Object.values(SceneEventType).includes(eventType))throw new TypeError('Unsupported Scene event obligation type: '+eventType);
    const releases=types.map(eventType=>this.runtime.producers.bindEvent({
      eventType,producerId,
      guardEvent:(event)=>this.#sceneEventObligationGuard(event,{ownerPolicy}),
      mapEvent:(event)=>{
        const request=mapEvent(clone(event));
        if(!request)return null;
        const sourceRevisionIds=uniq(event.revisionFences?.sourceRevisionIds??Object.keys(event.sourceRevisions??{}));
        return{
          ...clone(request),
          sceneRevision:event.sceneRevision,
          sourceRevisions:clone(event.sourceRevisions??{}),
          sourceRevisionIds,
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
            const guard=this.#sceneEventObligationGuard(event,{execution:true,ownerPolicy});
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
        try{onDisposition?.(clone({...entry,reasonCode,producerId}));}catch{}
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

  #speculativeWarmPolicyRevision(){
    const manifest=this.core.sensoryManifest?.()??{};
    const channels=(manifest.channels??[]).map((row)=>({
      channelId:row.channelId,available:row.available!==false,health:row.health??null,
      capabilities:[...(row.capabilities??[])].sort(),
    })).sort((a,b)=>String(a.channelId).localeCompare(String(b.channelId)));
    return 'retrieval-policy:'+sha256Hex(JSON.stringify({channelId:CHANNEL_ID,channels})).slice(0,20);
  }

  #speculativeWarmIntentFingerprint(recommendation){
    return 'scene-intent:'+sha256Hex(JSON.stringify({
      sceneId:recommendation?.sceneId??null,sceneRevision:Number(recommendation?.sceneRevision??0),
      trigger:recommendation?.trigger??null,
      entityRefs:uniq(recommendation?.entityRefs??[]),locationRefs:uniq(recommendation?.locationRefs??[]),
      threadRefs:uniq(recommendation?.threadRefs??[]),sceneRefs:uniq(recommendation?.sceneRefs??[]),
    })).slice(0,24);
  }

  #speculativeWarmPreparationRef(event,recommendation){
    return 'lore-warm:'+sha256Hex(JSON.stringify({
      chatId:event?.chatId??null,sceneId:recommendation?.sceneId??event?.sceneId??null,
      sceneRevision:Number(recommendation?.sceneRevision??event?.sceneRevision??0),
      fingerprint:this.#speculativeWarmIntentFingerprint(recommendation),
      sourceRevisionRefs:uniq(recommendation?.sourceRevisionRefs??event?.sourceRevisionSet??[]),
    })).slice(0,24);
  }

  #speculativeWarmRetrievalQuery(recommendation){
    const refs=uniq([
      ...(recommendation?.entityRefs??[]),...(recommendation?.locationRefs??[]),
      ...(recommendation?.threadRefs??[]),...(recommendation?.sceneRefs??[]),
    ]);
    return refs.map((ref)=>String(ref).replace(/[:/_\-.]+/g,' ')).join(' ').trim()||String(recommendation?.trigger??'scene context');
  }

  #speculativeWarmIdentity({chatId,recommendation,sceneSignal=null}={}){
    const scene=sceneSignal??this.scene.integrationSignal(String(chatId));
    return{
      chatId:String(chatId),sceneRevision:Number(recommendation?.sceneRevision??scene?.sceneRevision??0),
      worldRevision:Number(this.core.graph.revision??0),characterStateRevision:0,
      sourceRevisionSet:uniq([
        ...this.core.registry.activeRevisionIds(),
        ...(scene?.sourceRevisionRefs??scene?.sourceRevisionSet??[]),
        ...(recommendation?.sourceRevisionRefs??recommendation?.sourceRevisionSet??[]),
      ]),
      intentFingerprint:this.#speculativeWarmIntentFingerprint(recommendation),
      retrievalPolicyRevision:this.#speculativeWarmPolicyRevision(),
    };
  }

  #speculativeWarmCompatible({recommendation,query,anchorEntityIds=[],sceneSignal}={}){
    if(!recommendation||recommendation.status!=='ACTIVE')return false;
    if(Number(recommendation.sceneRevision)!==Number(sceneSignal?.sceneRevision))return false;
    const recommendationEntities=new Set(uniq(recommendation.entityRefs??[]));
    const anchors=uniq(anchorEntityIds);
    const anchorCompatible=!anchors.length||anchors.every((ref)=>recommendationEntities.has(String(ref)));
    const text=String(query??'').toLowerCase();
    const tokens=uniq([
      ...(recommendation.entityRefs??[]),...(recommendation.locationRefs??[]),
      ...(recommendation.threadRefs??[]),...(recommendation.sceneRefs??[]),
    ]).flatMap((ref)=>String(ref).toLowerCase().split(/[^a-z0-9]+/g))
      .filter((token)=>token.length>=3&&!['char','character','loc','location','thread','scene','story','ref'].includes(token));
    return anchorCompatible&&tokens.some((token)=>text.includes(token));
  }

  #createInstalledSpeculativeWarmAdapters(){
    const retrievalContext=(recommendation,identity,context)=>{
      const query=this.#speculativeWarmRetrievalQuery(recommendation);
      const sceneInput=this.scene.fanOutInput(String(identity.chatId));
      const sourceSet=new Set(identity.sourceRevisionSet??[]);
      return{query,sceneInput,sourceSet,preparationRef:String(context?.preparationRef??'')};
    };
    const retrievalEnvelope=(recommendation,identity,context)=>{
      const {query}=retrievalContext(recommendation,identity,context);
      return this.core.retrieval.retrieveEnvelope(query,{
        intent:'CURRENT',anchorEntityIds:recommendation.entityRefs??[],
        worldRevision:identity.worldRevision,sceneRevision:identity.sceneRevision,channelIds:[CHANNEL_ID],candidateBudget:48,latencyBudgetMs:100,
      });
    };
    return{
      providerMode:'INSTALLED_OWNER_BACKED',
      retrieve:async({recommendation,identity,context})=>{
        const {query,sceneInput,sourceSet,preparationRef}=retrievalContext(recommendation,identity,context);
        if(!preparationRef)throw Object.assign(new Error('speculative Lore preparation ref unavailable'),{code:'WARM_PREPARATION_REF_UNAVAILABLE'});
        const lore=this.loreChannel.prepareSpeculative(preparationRef,query,{intent:'NARROW'});
        const memory=this.memorySurface.adapters.queryHistorian({
          query,mode:'CONTINUITY_RECALL',activeEntityIds:recommendation.entityRefs??[],maxCandidates:24,
          selection:{chatId:identity.chatId,sceneId:recommendation.sceneId,sceneRevision:identity.sceneRevision},
        });
        const graphRows=this.scene.graph.references?.({sceneId:recommendation.sceneId,limit:32})??[];
        const candidateRefs=[],evidenceRefs=uniq(recommendation.evidenceRefs??[]),refDependencies={};
        const admit=(ref,deps=[])=>{
          const id=String(ref??'').trim(),revisions=uniq(deps);
          if(!id||!revisions.length||revisions.some((revisionId)=>!sourceSet.has(revisionId)))return;
          candidateRefs.push(id);refDependencies[id]=revisions;
        };
        for(const row of lore?.nominations??[])admit(row.candidateId,row.sourceRevisionRefs??[]);
        for(const row of memory?.nominations??[])admit(row.candidateId,row.sourceRevisionRefs??[]);
        for(const row of graphRows)admit(row.ref??row.edgeId??row.id,row.sourceRevisionRefs??recommendation.sourceRevisionRefs??[]);
        for(const ref of evidenceRefs){
          const deps=uniq(recommendation.sourceRevisionRefs??recommendation.sourceRevisionSet??[]);
          if(deps.length&&deps.every((revisionId)=>sourceSet.has(revisionId)))refDependencies[ref]=deps;
        }
        return{
          status:'OWNER_BACKED',candidateRefs:uniq(candidateRefs),evidenceRefs,refDependencies,
          receipt:{
            status:'OWNER_BACKED',semanticRetrievalExecuted:true,loreCandidateCount:lore?.nominations?.length??0,
            memoryCandidateCount:memory?.nominations?.length??0,graphReferenceCount:graphRows.length,
            preparedOwners:['LORE','MEMORY','GRAPH'],preparedArtifactRefs:[preparationRef],
            unavailableChannels:[],authority:'NONE',
          },
        };
      },
      evaluateQuality:async(referenceBundle)=>({
        status:'ASSESSED',quality:referenceBundle.candidateRefs.length?'HIGH':'LOW',
        candidateRefCount:referenceBundle.candidateRefs.length,evidenceRefCount:referenceBundle.evidenceRefs.length,authority:'NONE',
      }),
      truthCheck:async(_referenceBundle,{recommendation,identity,context})=>{
        const envelope=retrievalEnvelope(recommendation,identity,context);
        const candidates=(envelope?.candidates??[]).filter((row)=>row.freshness===CandidateFreshness.FRESH);
        const assessment=this.core.publication.truth.assess(candidates,{
          query:this.#speculativeWarmRetrievalQuery(recommendation),intent:'CURRENT',
          worldRevision:identity.worldRevision,sceneRevision:identity.sceneRevision,attempt:0,maxCorrectiveAttempts:0,candidateEnvelope:envelope,
        });
        return{
          status:'ASSESSED',quality:assessment?.confidence??'LOW',checked:true,
          candidateCount:candidates.length,admittedCount:assessment?.admittedCandidateIds?.length??0,
          supportCount:assessment?.supportCandidateIds?.length??0,
          unresolved:Boolean((assessment?.truthResults??[]).some((row)=>['CONTRADICTED','UNCERTAIN','UNRESOLVED'].includes(String(row.classification)))),
          authority:'NONE',
        };
      },
      precisionRank:async(_referenceBundle,{recommendation,identity,context})=>{
        const envelope=retrievalEnvelope(recommendation,identity,context);
        const candidates=(envelope?.candidates??[]).filter((row)=>row.freshness===CandidateFreshness.FRESH);
        let ranked=[],failed=false;
        try{ranked=this.core.publication.precision.rank(candidates,{query:this.#speculativeWarmRetrievalQuery(recommendation),intent:'CURRENT',worldRevision:identity.worldRevision,sceneRevision:identity.sceneRevision});}
        catch{failed=true;}
        return{status:failed?'UNAVAILABLE':'RANKED',ranked:!failed,count:ranked.length,authority:'NONE'};
      },
      compile:async({recommendation,identity})=>{
        const result=this.core.query(this.#speculativeWarmRetrievalQuery(recommendation),{
          intent:'CURRENT',anchorEntityIds:recommendation.entityRefs??[],worldRevision:identity.worldRevision,
          sceneRevision:identity.sceneRevision,channelIds:[CHANNEL_ID],candidateBudget:48,
        });
        return{
          status:'COMPILED',packetHash:sha256Hex(JSON.stringify(result?.packet??{})),
          evidenceCount:(result?.candidates??[]).length,truthQuality:result?.assessment?.confidence??null,
          reusable:false,authority:'NONE',
        };
      },
    };
  }

  #retainSpeculativeWarmReceipt(input={}){
    const receipt=Object.freeze({
      kind:'DeploymentSpeculativeWarmReceipt',contractVersion:1,stage:String(input.stage??'UNKNOWN'),
      status:String(input.status??'UNKNOWN'),reasonCode:input.reasonCode??null,
      recommendationId:input.recommendationId??null,preparationId:input.preparationId??null,packetId:input.packetId??null,
      taskId:input.taskId??null,chatId:input.chatId??null,turnId:input.turnId??null,generationId:input.generationId??null,
      sceneId:input.sceneId??null,sceneRevision:input.sceneRevision??null,
      sourceRevisionRefs:uniq(input.sourceRevisionRefs??[]),preparedOwners:uniq(input.preparedOwners??[]),
      dependencyRefCount:Number(input.dependencyRefCount??0),physicallyAttempted:Boolean(input.physicallyAttempted),
      reusedStages:clone(input.reusedStages??null),remainingForegroundStages:uniq(input.remainingForegroundStages??[]),
      foregroundWorkAvoided:clone(input.foregroundWorkAvoided??null),lateDestination:Boolean(input.lateDestination),
      unavailable:Boolean(input.unavailable),cancelled:Boolean(input.cancelled),superseded:Boolean(input.superseded),
      rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
      authorityGranted:false,canonicalMutation:false,settlementAuthority:false,contextSealAuthority:false,
    });
    this.speculativeWarmReceipts.push(receipt);
    if(this.speculativeWarmReceipts.length>256)this.speculativeWarmReceipts.splice(0,this.speculativeWarmReceipts.length-256);
    return receipt;
  }

  #installSpeculativeWarmOwner(){
    return this.bindSceneEventObligationOwner({
      producer:{
        producerId:'SPECULATIVE_CONTEXT_WARM_OWNER',obligationType:'SPECULATIVE_CONTEXT_WARM',requestedLayer:'L2',
        requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],priority:60,
        resultContract:{resultClass:RuntimeResultClass.DEFERRED,requestedDestination:'BACKGROUND'},
      },
      eventTypes:[SceneEventType.PREFETCH_RECOMMENDED],
      mapEvent:(event)=>{
        const recommendation=event.payload?.recommendation??null;
        this.#retainSpeculativeWarmReceipt({
          stage:'RECOMMENDATION_RECEIVED',status:recommendation?.status==='ACTIVE'?'RECEIVED':'REJECTED',
          reasonCode:recommendation?.status==='ACTIVE'?'SCENE_RECOMMENDATION_RECEIVED':'SCENE_RECOMMENDATION_INACTIVE',
          recommendationId:recommendation?.recommendationId??null,chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,
          sceneId:event.sceneId,sceneRevision:event.sceneRevision,sourceRevisionRefs:event.sourceRevisionSet??[],
        });
        if(!recommendation||recommendation.status!=='ACTIVE'||!(recommendation.evidenceRefs?.length))return null;
        const sceneSignal=this.scene.integrationSignal(String(event.chatId));
        const identity=this.#speculativeWarmIdentity({chatId:event.chatId,recommendation,sceneSignal});
        const preparationRef=this.#speculativeWarmPreparationRef(event,recommendation);
        const plan=this.speculativeWarmer.createRuntimePlan({
          recommendation,identity,turnSequence:this.speculativeWarmTurnSequence,
          context:{preparationRef,createdAt:Number(event.createdSequence??0),expiresAfterTurns:2,originEventId:event.eventId,originTurnId:event.turnId??null},
        });
        if(plan.status!=='PLANNED'){
          this.#retainSpeculativeWarmReceipt({
            stage:'ELIGIBILITY',status:'REJECTED',reasonCode:plan.reason??'WARM_PLAN_REJECTED',recommendationId:recommendation.recommendationId,
            chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,sceneId:event.sceneId,sceneRevision:event.sceneRevision,sourceRevisionRefs:event.sourceRevisionSet??[],
          });
          return null;
        }
        this.#retainSpeculativeWarmReceipt({
          stage:'ELIGIBILITY',status:'ELIGIBLE',reasonCode:'SCENE_PREFETCH_OWNER_ELIGIBLE',recommendationId:recommendation.recommendationId,
          preparationId:plan.preparationId,chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,
          sceneId:event.sceneId,sceneRevision:event.sceneRevision,sourceRevisionRefs:event.sourceRevisionSet??[],
        });
        return{
          owner:'CORE_PREPARATION',requestedLayer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],foreground:false,speculative:true,
          resultContract:{resultClass:RuntimeResultClass.DEFERRED,requestedDestination:'BACKGROUND'},
          dedupeKey:'speculative-warm:'+plan.dedupeKey,conflictKey:'speculative-warm-chat:'+String(event.chatId),
          revision:Number(event.sceneRevision??0),checkpointPolicy:{maxUnitsPerCheckpoint:1},batchHint:{maxSliceUnits:1},
          payload:{warmPlan:plan,chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,correlationId:event.correlationId,resultClass:RuntimeResultClass.DEFERRED,requestedDestination:'BACKGROUND'},
          units:plan.units,
        };
      },
      executorFactory:(event,request)=>{
        const plan=request.payload?.warmPlan;
        const base=this.speculativeWarmer.createRuntimeExecutor(plan);
        return{
          execute:async(context)=>{
            const stage=String(context?.units?.[0]?.payload?.stage??'UNKNOWN');
            this.#retainSpeculativeWarmReceipt({
              stage:'EXECUTION_ATTEMPTED',status:stage,reasonCode:'RUNTIME_STAGE_ATTEMPTED',recommendationId:event.payload?.recommendation?.recommendationId??null,
              preparationId:plan.preparationId,taskId:context?.task?.taskId??null,chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,
              sceneId:event.sceneId,sceneRevision:event.sceneRevision,sourceRevisionRefs:event.sourceRevisionSet??[],physicallyAttempted:true,
            });
            return base.execute(context);
          },
          validate:base.validate,
          commit:async(context)=>{
            const result=await base.commit(context);
            const stage=String(context?.output?.stage??'UNKNOWN');
            if(stage==='PUBLISH'){
              this.#retainSpeculativeWarmReceipt({
                stage:'CACHE_PUBLICATION',status:result?.status??'UNKNOWN',reasonCode:result?.status==='WARMED'?'DEPENDENCY_FENCED_PACKET_PUBLISHED':result?.status,
                recommendationId:event.payload?.recommendation?.recommendationId??null,preparationId:plan.preparationId,packetId:result?.packetId??null,
                taskId:context?.task?.taskId??null,chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,
                sceneId:event.sceneId,sceneRevision:event.sceneRevision,sourceRevisionRefs:event.sourceRevisionSet??[],
                preparedOwners:result?.preparedOwners??[],lateDestination:result?.usableForTargetTurn===false,
              });
            }
            return result;
          },
        };
      },
      onDisposition:(entry)=>{
        const event=entry.event??{},recommendation=event.payload?.recommendation??null;
        this.#retainSpeculativeWarmReceipt({
          stage:'SCHEDULING',status:entry.status,reasonCode:entry.reasonCode,recommendationId:recommendation?.recommendationId??null,
          taskId:entry.admission?.task?.taskId??null,chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,
          sceneId:event.sceneId,sceneRevision:event.sceneRevision,sourceRevisionRefs:event.sourceRevisionSet??[],
        });
        if(['ADMITTED','DEDUPED','COALESCED'].includes(entry.status))this.#pumpSpeculativeWarmRuntime();
      },
    });
  }

  #pumpSpeculativeWarmRuntime(){
    if(this.speculativeWarmPumpScheduled||this.runtimeDirector.governor.snapshot().generationActive)return;
    this.speculativeWarmPumpScheduled=true;
    const timer=setTimeout(()=>{
      this.speculativeWarmPumpScheduled=false;
      if(this.runtimeDirector.governor.snapshot().generationActive)return;
      const run=this.runtimeDirector.drain({maxCycles:256}).catch((error)=>{
        this.#retainSpeculativeWarmReceipt({stage:'RUNTIME_PUMP',status:'FAILED',reasonCode:String(error?.code??error?.message??'SPECULATIVE_WARM_RUNTIME_FAILED'),unavailable:true});
      });
      this.speculativeWarmPumpPromise=run;
    },0);
    timer?.unref?.();
  }

  async flushSpeculativeWarmRuntime({maxCycles=256}={}){
    await this.speculativeWarmPumpPromise.catch(()=>{});
    if(this.runtimeDirector.governor.snapshot().generationActive)return{status:'FOREGROUND_ACTIVE'};
    await this.runtimeDirector.drain({maxCycles});
    return{status:'DRAINED',metrics:this.speculativeWarmer.metrics()};
  }

  #consumeSpeculativeWarmForSend({chatId,query,anchorEntityIds=[],sceneSignal,turn}={}){
    const recommendations=(this.scene.fanOutInput(String(chatId))?.prefetchRecommendations??[])
      .filter((row)=>this.#speculativeWarmCompatible({recommendation:row,query,anchorEntityIds,sceneSignal}));
    for(const recommendation of recommendations){
      const identity=this.#speculativeWarmIdentity({chatId,recommendation,sceneSignal});
      const use=this.speculativeWarmer.consumeForSend({identity,turnSequence:this.speculativeWarmTurnSequence,turnId:turn?.turnId??null});
      if(use.status==='REVALIDATE_FOR_CORE_ADMISSION'){
        const preparationRef=(use.preparedArtifactRefs??[]).find((ref)=>String(ref).startsWith('lore-warm:'))??null;
        const preparedLore=preparationRef?this.loreChannel.activateSpeculative(preparationRef,String(query)):null;
        if(!preparedLore){
          if(use.consumptionId)this.speculativeWarmer.recordCoreRevalidation({consumptionId:use.consumptionId,accepted:false,reason:'LORE_PREPARATION_REFERENCE_UNAVAILABLE'});
          this.#retainSpeculativeWarmReceipt({
            stage:'PRE_SEND_CONSUMPTION',status:'MISS',reasonCode:'LORE_PREPARATION_REFERENCE_UNAVAILABLE',packetId:use.packetId,
            recommendationId:recommendation.recommendationId,chatId,turnId:turn?.turnId??null,sceneId:recommendation.sceneId,sceneRevision:recommendation.sceneRevision,
            remainingForegroundStages:['RETRIEVAL','TRUTH','PRECISION','COMPILE','CORE_ADMISSION'],
          });
          continue;
        }
        this.#retainSpeculativeWarmReceipt({
          stage:'PRE_SEND_CONSUMPTION',status:'FRESH_HIT',reasonCode:'FRESH_DEPENDENCY_FENCED_PREPARATION',packetId:use.packetId,
          recommendationId:recommendation.recommendationId,chatId,turnId:turn?.turnId??null,sceneId:recommendation.sceneId,sceneRevision:recommendation.sceneRevision,
          preparedOwners:use.preparedOwners??[],reusedStages:['LORE_PREPARATION'],remainingForegroundStages:['CORE_RETRIEVAL','TRUTH','PRECISION','COMPILE','SEAL'],
        });
        return{recommendation,identity,use,preparedLore,reuseLorePreparation:true};
      }
      this.#retainSpeculativeWarmReceipt({
        stage:'PRE_SEND_CONSUMPTION',status:use.freshness==='PARTIALLY_STALE'?'PARTIAL_SALVAGE':use.reason==='MISS'?'MISS':'STALE_DISCARD',
        reasonCode:use.reason??use.status,packetId:use.packetId??null,recommendationId:recommendation.recommendationId,
        chatId,turnId:turn?.turnId??null,sceneId:recommendation.sceneId,sceneRevision:recommendation.sceneRevision,
        remainingForegroundStages:use.requiredForegroundStages??['NORMAL_FOREGROUND_RETRIEVAL','TRUTH','COMPILE','CORE_ADMISSION'],
      });
      if(use.freshness==='PARTIALLY_STALE')return{recommendation,identity,use,preparedLore:null,reuseLorePreparation:false};
    }
    return null;
  }

  #cancelSpeculativeWarmTasks({chatId=null,sourceRevisionRefs=[],foreignToChat=null,currentSceneId=null,currentSceneRevision=null,reason='SPECULATIVE_WARM_CANCELLED'}={}){
    const refs=new Set(uniq(sourceRevisionRefs)),cancelled=[];
    for(const record of this.runtimeDirector.ledger.list()){
      if(record?.obligation?.taskType!=='SPECULATIVE_CONTEXT_WARM')continue;
      if(['SATISFIED','SUPERSEDED','CANCELLED'].includes(String(record.lifecycleStatus)))continue;
      const cause=record.obligation?.cause??{},sourceRefs=record.obligation?.sourceRevisionIds??[];
      const warmSceneId=record.obligation?.payload?.warmPlan?.request?.recommendation?.sceneId??null;
      const sceneSuperseded=currentSceneRevision!=null&&chatId&&String(cause.chatId??'')===String(chatId)&&(
        (currentSceneId!=null&&String(warmSceneId??'')!==String(currentSceneId))
        ||Number(record.obligation?.sceneRevision)!==Number(currentSceneRevision)
      );
      const match=foreignToChat?String(cause.chatId??'')!==String(foreignToChat)
        :refs.size?sourceRefs.some((ref)=>refs.has(String(ref)))
          :sceneSuperseded
            ?true
            :chatId&&currentSceneId==null&&currentSceneRevision==null?String(cause.chatId??'')===String(chatId):false;
      if(!match)continue;
      const didCancel=this.runtimeDirector.cancelTask(record.taskId,reason);
      if(didCancel){
        cancelled.push(record.taskId);
        this.#retainSpeculativeWarmReceipt({
          stage:'CANCELLATION',status:'CANCELLED',reasonCode:reason,taskId:record.taskId,chatId:cause.chatId??null,
          turnId:cause.turnId??null,generationId:cause.generationId??null,sceneRevision:record.obligation?.sceneRevision??null,
          sourceRevisionRefs:sourceRefs,cancelled:true,superseded:reason.includes('SUPERSEDED'),
        });
      }
    }
    return cancelled;
  }

  #installSceneMemoryRetrievalObserver(){
    const adapters=this.memorySurface?.adapters??null;
    if(!adapters)return;
    for(const method of ['queryHistorian','resolveHistorian']){
      const original=adapters[method];
      if(typeof original!=='function')continue;
      adapters[method]=(...args)=>{
        const result=original(...args);
        if(result&&typeof result.then==='function')return result.then((value)=>{this.#recordSceneMemoryRetrieval(value,args[0],method);return value;});
        this.#recordSceneMemoryRetrieval(result,args[0],method);
        return result;
      };
    }
  }

  #recordSceneMemoryRetrieval(result,request,method='queryHistorian'){
    const rows=[...(result?.nominations??[]),...(result?.artifacts??[])];
    const seen=new Set();
    const selection=request?.selection??{};
    for(const row of rows){
      const artifactId=row?.artifactRef?.artifactId??row?.episodeId??null;
      if(!artifactId||seen.has(String(artifactId)))continue;
      seen.add(String(artifactId));
      const episode=this.memory.experienceStore.artifact(String(artifactId));
      if(!episode||episode.admissionSource!=='SCENE_EXPERIENCE_PROPOSAL')continue;
      if(selection?.chatId!=null&&episode.chatId!=null&&String(selection.chatId)!==String(episode.chatId))continue;
      this.#retainSceneMemoryLifecycleReceipt({
        stage:'EXPERIENCE_RETRIEVED',status:'RETRIEVED',reasonCode:'SCENE_MEMORY_HISTORIAN_RETRIEVED',
        chatId:episode.chatId??selection?.chatId??null,turnId:selection?.turnId??null,generationId:selection?.generationId??null,
        correlationId:selection?.correlationId??null,sceneId:episode.sceneId,sceneRevision:episode.sceneRevision,
        sourceRevisionRefs:episode.sourceRevisionRefs??[],episodeRef:episode.sceneEpisodeRef??null,memoryEpisode:episode,
        destination:'FOREGROUND_CANDIDATE',deduplicationOutcome:method,
      });
    }
  }

  #retainSceneMemoryLifecycleReceipt(input={}){
    const event=input.event??null,proposal=input.proposal??null,memoryEpisode=input.memoryEpisode??null;
    const receipt=Object.freeze({
      kind:'DeploymentSceneMemoryLifecycleReceipt',contractVersion:1,
      stage:String(input.stage??'UNKNOWN'),status:String(input.status??'UNKNOWN'),reasonCode:input.reasonCode==null?null:String(input.reasonCode),
      eventId:event?.eventId??input.eventId??null,eventType:event?.eventType??input.eventType??null,
      chatId:event?.chatId??input.chatId??null,turnId:event?.turnId??input.turnId??null,generationId:event?.generationId??input.generationId??null,
      correlationId:event?.correlationId??input.correlationId??null,causationId:event?.causationId??input.causationId??null,
      sceneId:event?.sceneId??proposal?.sceneId??input.sceneId??null,sceneRevision:event?.sceneRevision??proposal?.sceneRevision??input.sceneRevision??null,
      sourceRevisionRefs:uniq(input.sourceRevisionRefs??proposal?.sourceRevisionRefs??event?.sourceRevisionSet??event?.revisionFences?.sourceRevisionIds??[]),
      episodeRef:clone(input.episodeRef??proposal?.sceneEpisodeRef??null),proposalId:proposal?.proposalId??input.proposalId??null,
      taskId:input.taskId??null,destination:input.destination??'BACKGROUND',deduplicationOutcome:input.deduplicationOutcome??null,
      mappingIds:uniq(input.mappingIds??[]),memoryEvidenceIds:uniq(input.memoryEvidenceIds??[]),
      memoryEpisodeId:memoryEpisode?.id??input.memoryEpisodeId??null,memoryEpisodeRevision:memoryEpisode?.revision??input.memoryEpisodeRevision??null,
      experiencePersisted:Boolean(input.experiencePersisted),sealedGeneration:Boolean(input.sealedGeneration),
      rawStoryTextIncluded:false,providerBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
      authorityGranted:false,canonicalMutation:false,settlementAuthority:false,contextSealAuthority:false,
    });
    this.sceneMemoryLifecycleReceipts.push(clone(receipt));
    if(this.sceneMemoryLifecycleReceipts.length>256)this.sceneMemoryLifecycleReceipts.splice(0,this.sceneMemoryLifecycleReceipts.length-256);
    return receipt;
  }

  readSceneMemoryLifecycleReceipts({limit=64}={}){
    const n=Math.max(1,Math.min(256,Number(limit)||64));
    return clone(this.sceneMemoryLifecycleReceipts.slice(-n));
  }

  #sceneOwnerEventById(eventId){
    const id=String(eventId??'');
    for(let i=this.sceneOwnerTimeline.length-1;i>=0;i-=1){
      const row=this.sceneOwnerTimeline[i];
      if(row?.type==='EVENT'&&String(row?.value?.eventId??'')===id)return clone(row.value);
    }
    return null;
  }

  #sceneMemoryOwnerPolicy(event){
    const historicalLifecycle=SCENE_MEMORY_HISTORICAL_EVENT_TYPES.has(event?.eventType);
    return{historicalLifecycle,destination:historicalLifecycle?'BACKGROUND':null};
  }

  #resolveSceneMemoryLifecycleEvidence(event){
    if(!SCENE_MEMORY_ELIGIBLE_EVENT_TYPES.has(event?.eventType))return{ok:false,status:'NO_WORK',reasonCode:'SCENE_MEMORY_EVENT_NOT_ELIGIBLE'};
    const ownerEvent=this.#sceneOwnerEventById(event.eventId);
    if(!ownerEvent)return{ok:false,status:'DEFERRED',reasonCode:'SCENE_MEMORY_OWNER_EVENT_UNAVAILABLE'};
    const episodeRef=ownerEvent.payload?.episodeRef??null;
    if(!episodeRef?.artifactId)return{ok:false,status:'NO_WORK',reasonCode:'SCENE_MEMORY_EPISODE_REF_MISSING'};
    const episode=this.scene.episodeCompiler.get(String(episodeRef.artifactId));
    if(!episode)return{ok:false,status:'DEFERRED',reasonCode:'SCENE_MEMORY_EPISODE_UNAVAILABLE'};
    const record=this.scene.registry.get(String(ownerEvent.sceneId??''));
    const scene=(record?.snapshots??[]).find(row=>Number(row?.revision)===Number(ownerEvent.sceneRevision))??null;
    if(!scene)return{ok:false,status:'REJECTED',reasonCode:'SCENE_MEMORY_SCENE_REVISION_UNAVAILABLE'};
    if(String(episode.sceneId)!==String(scene.sceneId)||Number(episode.sceneRevision)!==Number(scene.revision))return{ok:false,status:'REJECTED',reasonCode:'SCENE_MEMORY_EPISODE_SCENE_FENCE_MISMATCH'};
    if(String(episodeRef.artifactId)!==String(episode.artifactRef?.artifactId)||Number(episodeRef.revision)!==Number(episode.artifactRef?.revision)||!sameRefs(episodeRef.sourceRevisionSet??[],episode.artifactRef?.sourceRevisionSet??[]))return{ok:false,status:'REJECTED',reasonCode:'SCENE_MEMORY_EPISODE_REF_MISMATCH'};
    const boundaryRuntime=[...this.runtimeDirector.events.events].reverse().find(row=>
      row.eventType===SceneEventType.SCENE_BOUNDARY_CONFIRMED
      &&String(row.sceneId)===String(ownerEvent.sceneId)
      &&Number(row.sceneRevision)===Number(ownerEvent.sceneRevision)
      &&String(row.chatId??'')===String(ownerEvent.chatId??'')
    )??null;
    const boundaryEvent=boundaryRuntime?this.#sceneOwnerEventById(boundaryRuntime.eventId):null;
    if(!boundaryEvent)return{ok:false,status:'DEFERRED',reasonCode:'SCENE_MEMORY_BOUNDARY_EVENT_UNAVAILABLE'};
    const sourceRefs=uniq([...(episode.sourceRevisionRefs??[]),...(ownerEvent.sourceRevisionSet??[]),...(boundaryEvent.sourceRevisionSet??[])]);
    for(const ref of sourceRefs){
      const source=this.scene.narrativeFeed.findSourceRevision(String(ownerEvent.chatId),String(ref));
      if(!source||source.current!==true)return{ok:false,status:'REJECTED',reasonCode:'SCENE_MEMORY_SOURCE_REVISION_INVALID',sourceRevisionRefs:sourceRefs};
    }
    return{ok:true,status:'PREPARED',event:ownerEvent,boundaryEvent,episode,scene,episodeRef,sourceRevisionRefs:sourceRefs};
  }

  #sceneMemoryMappingRequest({event,episode,externalEvidenceRef,sourceRevisionId,sealedGeneration=false}={}){
    const source=this.scene.narrativeFeed.findSourceRevision(String(event.chatId),String(sourceRevisionId));
    if(!source||source.current!==true)return null;
    const participants=uniq((episode.participants??[]).map(row=>typeof row==='string'?row:row?.characterId??row?.entityId??null).filter(Boolean));
    return{
      kind:'MemoryExternalEvidenceMappingRequest',contractVersion:'1.0.0',
      ownerArtifactRef:clone(episode.artifactRef),externalEvidenceRef:String(externalEvidenceRef),
      sealedGeneration:Boolean(sealedGeneration),lateForSealedGeneration:Boolean(sealedGeneration),historicalLifecycle:true,destination:'BACKGROUND',
      source:{
        sourceId:'scene-narrative:'+String(event.chatId)+':'+String(source.messageId??sourceRevisionId),
        sourceRevisionId:String(sourceRevisionId),exactContent:String(source.content??''),evidenceKind:'NARRATIVE_EXPERIENCE',
        occurredAt:Number(source.sequence??event.createdSequence??0),sceneRevision:Number(event.sceneRevision),
        participants,knownBy:[],perspective:'WORLD',
        metadata:{chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,correlationId:event.correlationId,messageId:source.messageId??null,messageRevision:source.messageRevision??null,role:source.role??null},
        provenance:['scene-owner:'+String(event.sceneId),'scene-event:'+String(event.eventId)],
      },
      revisionProof:{sourceRevisionId:String(sourceRevisionId),ownerArtifactRevision:Number(episode.artifactRef.revision),sceneRevision:Number(event.sceneRevision)},
      provenanceRefs:['scene-memory-owner:'+String(event.eventId)],
    };
  }

  #installSceneMemoryOwnerMapping(){
    return this.bindSceneEventObligationOwner({
      producer:{
        producerId:SCENE_MEMORY_OWNER_PRODUCER_ID,obligationType:'MEMORY_SCENE_LIFECYCLE_ADMISSION',requestedLayer:'L2',
        requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],priority:42,
        resultContract:{resultClass:RuntimeResultClass.DEFERRED,requestedDestination:'BACKGROUND'},
      },
      eventTypes:[...SCENE_MEMORY_ELIGIBLE_EVENT_TYPES],
      ownerPolicy:(event)=>this.#sceneMemoryOwnerPolicy(event),
      mapEvent:(event)=>{
        const episodeRef=event.payload?.episodeRef??null;
        if(!episodeRef?.artifactId){
          this.#retainSceneMemoryLifecycleReceipt({stage:'EVENT_PUBLISHED',status:'NO_WORK',reasonCode:'SCENE_MEMORY_EPISODE_REF_MISSING',event,destination:'BACKGROUND'});
          return null;
        }
        this.#retainSceneMemoryLifecycleReceipt({stage:'EVENT_PUBLISHED',status:'ELIGIBLE',reasonCode:'SCENE_MEMORY_EPISODE_READY',event,episodeRef,destination:'BACKGROUND'});
        const stableKey=['scene-memory',event.chatId,episodeRef.artifactId,episodeRef.revision].join(':');
        return{
          owner:'MEMORY',requestedLayer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],foreground:false,
          resultContract:{resultClass:RuntimeResultClass.DEFERRED,requestedDestination:'BACKGROUND'},
          dedupeKey:stableKey,batchHint:{maxSliceUnits:1},resourceLimits:{maxSliceUnits:1},
          payload:{chatId:event.chatId,turnId:event.turnId,generationId:event.generationId,correlationId:event.correlationId,sceneId:event.sceneId,sceneRevision:event.sceneRevision,episodeRef:clone(episodeRef),resultClass:RuntimeResultClass.DEFERRED,requestedDestination:'BACKGROUND'},
          units:[{id:stableKey+':unit',payload:{eventId:event.eventId,episodeRef:clone(episodeRef)}}],
        };
      },
      executorFactory:(event)=>this.#sceneMemoryOwnerExecutor(event),
      onDisposition:(entry)=>{
        const stage=entry.status==='SKIPPED'?'NO_WORK':'WORK_SCHEDULED';
        const status=entry.status==='ADMITTED'?'SCHEDULED':entry.status;
        this.#retainSceneMemoryLifecycleReceipt({
          stage,status,reasonCode:entry.reasonCode,event:entry.event,taskId:entry.admission?.task?.taskId??null,
          episodeRef:entry.event?.payload?.episodeRef??null,destination:'BACKGROUND',
          deduplicationOutcome:entry.status==='DEDUPED'?'REPLAY_DEDUPED':entry.status==='COALESCED'?'COALESCED':entry.status==='ADMITTED'?'NEW_OBLIGATION':null,
          sealedGeneration:Boolean(entry.event?.turnId&&this.core.publication.seal.isTurnSealed(entry.event.turnId)),
        });
      },
    });
  }

  #sceneMemoryOwnerExecutor(event){
    return{
      execute:async({task}={})=>{
        this.#retainSceneMemoryLifecycleReceipt({stage:'EXECUTION_ATTEMPTED',status:'ATTEMPTED',reasonCode:'SCENE_MEMORY_EXECUTION_STARTED',event,taskId:task?.taskId??null,destination:'BACKGROUND',sealedGeneration:Boolean(event.turnId&&this.core.publication.seal.isTurnSealed(event.turnId))});
        const resolved=this.#resolveSceneMemoryLifecycleEvidence(event);
        if(!resolved.ok){
          this.#retainSceneMemoryLifecycleReceipt({stage:'EXECUTION_ATTEMPTED',status:resolved.status,reasonCode:resolved.reasonCode,event,taskId:task?.taskId??null,destination:'BACKGROUND',sourceRevisionRefs:resolved.sourceRevisionRefs??[]});
          return{kind:'DeploymentSceneMemoryPreparedWork',status:resolved.status,reasonCode:resolved.reasonCode,eventId:event.eventId,taskId:task?.taskId??null};
        }
        const proposal=createExperienceProposalFromScene({
          scene:resolved.scene,episode:resolved.episode,graph:this.scene.graph,
          proposalId:'scene-experience:'+String(event.chatId)+':'+String(resolved.scene.sceneId)+':'+String(resolved.scene.revision),
        });
        this.#retainSceneMemoryLifecycleReceipt({stage:'PROPOSAL_CREATED',status:'PREPARED',reasonCode:'SCENE_MEMORY_PROPOSAL_PREPARED',event,proposal,taskId:task?.taskId??null,episodeRef:resolved.episodeRef,destination:'BACKGROUND'});
        return{kind:'DeploymentSceneMemoryPreparedWork',status:'PREPARED',reasonCode:null,eventId:event.eventId,taskId:task?.taskId??null,proposal,boundaryEventId:resolved.boundaryEvent.eventId,episodeRef:clone(resolved.episodeRef)};
      },
      validate:async({output})=>Boolean(output?.kind==='DeploymentSceneMemoryPreparedWork'&&['PREPARED','DEFERRED','REJECTED','NO_WORK'].includes(output.status)),
      commit:async({output,task}={})=>{
        if(output?.status!=='PREPARED'){
          const decision={kind:'DeploymentSceneMemoryOwnerDecision',status:output?.status??'DEFERRED',reasonCode:output?.reasonCode??'SCENE_MEMORY_PREPARATION_INCOMPLETE',eventId:event.eventId,destination:'BACKGROUND',authorityGranted:false,canonicalMutation:false};
          this.#retainSceneMemoryLifecycleReceipt({stage:'MEMORY_OWNER_DECISION',status:decision.status,reasonCode:decision.reasonCode,event,taskId:task?.taskId??output?.taskId??null,destination:'BACKGROUND'});
          return decision;
        }
        const guard=this.#sceneEventObligationGuard(event,{execution:true,ownerPolicy:(row)=>this.#sceneMemoryOwnerPolicy(row)});
        if(!guard.accepted){
          const decision={kind:'DeploymentSceneMemoryOwnerDecision',status:'REJECTED',reasonCode:guard.reasonCode,eventId:event.eventId,destination:'BACKGROUND',authorityGranted:false,canonicalMutation:false};
          this.#retainSceneMemoryLifecycleReceipt({stage:'MEMORY_OWNER_DECISION',status:decision.status,reasonCode:decision.reasonCode,event,proposal:output.proposal,taskId:task?.taskId??output.taskId??null,destination:'BACKGROUND'});
          return decision;
        }
        return this.#commitSceneMemoryLifecycle(event,output,{taskId:task?.taskId??output.taskId??null});
      },
    };
  }

  #commitSceneMemoryLifecycle(runtimeEvent,prepared,{taskId=null}={}){
    const resolved=this.#resolveSceneMemoryLifecycleEvidence(runtimeEvent);
    if(!resolved.ok){
      const decision={kind:'DeploymentSceneMemoryOwnerDecision',status:resolved.status,reasonCode:resolved.reasonCode,eventId:runtimeEvent.eventId,destination:'BACKGROUND',authorityGranted:false,canonicalMutation:false};
      this.#retainSceneMemoryLifecycleReceipt({stage:'MEMORY_OWNER_DECISION',status:decision.status,reasonCode:decision.reasonCode,event:runtimeEvent,proposal:prepared.proposal,taskId,destination:'BACKGROUND'});
      return decision;
    }
    const adapters=this.memorySurface?.adapters??null;
    if(typeof adapters?.admitExternalEvidenceMapping!=='function'||typeof adapters?.acceptSceneOwnerEvent!=='function'||typeof adapters?.acceptSceneExperience!=='function'){
      const decision={kind:'DeploymentSceneMemoryOwnerDecision',status:'DEFERRED',reasonCode:'SCENE_MEMORY_OWNER_UNAVAILABLE',eventId:runtimeEvent.eventId,destination:'BACKGROUND',authorityGranted:false,canonicalMutation:false};
      this.#retainSceneMemoryLifecycleReceipt({stage:'MEMORY_OWNER_DECISION',status:decision.status,reasonCode:decision.reasonCode,event:runtimeEvent,proposal:prepared.proposal,taskId,destination:'BACKGROUND'});
      return decision;
    }
    const sealedGeneration=Boolean(runtimeEvent.turnId&&this.core.publication.seal.isTurnSealed(runtimeEvent.turnId));
    const proposal=prepared.proposal;
    const mappingReceipts=[];
    const sourceRefs=uniq(proposal.sourceRevisionRefs??[]);
    const evidenceRefs=uniq(proposal.evidenceRefs??[]);
    const mappingPlan=[];
    for(const externalEvidenceRef of evidenceRefs){
      const sourceRevisionId=sourceRefs.includes(String(externalEvidenceRef))?String(externalEvidenceRef):String(externalEvidenceRef);
      mappingPlan.push({externalEvidenceRef:String(externalEvidenceRef),sourceRevisionId});
    }
    for(const sourceRevisionId of sourceRefs)if(!mappingPlan.some(row=>row.sourceRevisionId===String(sourceRevisionId)))mappingPlan.push({externalEvidenceRef:String(sourceRevisionId),sourceRevisionId:String(sourceRevisionId)});
    for(const row of mappingPlan){
      const request=this.#sceneMemoryMappingRequest({event:resolved.event,episode:resolved.episode,...row,sealedGeneration});
      if(!request){
        const decision={kind:'DeploymentSceneMemoryOwnerDecision',status:'DEFERRED',reasonCode:'SCENE_MEMORY_EXACT_SOURCE_UNAVAILABLE',eventId:runtimeEvent.eventId,destination:'BACKGROUND',authorityGranted:false,canonicalMutation:false};
        this.#retainSceneMemoryLifecycleReceipt({stage:'MEMORY_OWNER_DECISION',status:decision.status,reasonCode:decision.reasonCode,event:resolved.event,proposal,taskId,destination:'BACKGROUND',sourceRevisionRefs:sourceRefs,sealedGeneration});
        return decision;
      }
      try{mappingReceipts.push(adapters.admitExternalEvidenceMapping(request));}
      catch(error){
        const decision={kind:'DeploymentSceneMemoryOwnerDecision',status:'REJECTED',reasonCode:String(error?.code??error?.message??'SCENE_MEMORY_MAPPING_REJECTED'),eventId:runtimeEvent.eventId,destination:'BACKGROUND',authorityGranted:false,canonicalMutation:false};
        this.#retainSceneMemoryLifecycleReceipt({stage:'MEMORY_OWNER_DECISION',status:decision.status,reasonCode:decision.reasonCode,event:resolved.event,proposal,taskId,destination:'BACKGROUND',sourceRevisionRefs:sourceRefs,sealedGeneration});
        return decision;
      }
    }
    const ownerOptions={currentSceneRevision:null,sealedGeneration,historicalLifecycle:true,destination:'BACKGROUND'};
    const boundaryReceipt=adapters.acceptSceneOwnerEvent(resolved.boundaryEvent,ownerOptions);
    const readyReceipt=adapters.acceptSceneOwnerEvent(resolved.event,ownerOptions);
    const rejectedEvent=[boundaryReceipt,readyReceipt].find(row=>['REJECTED','STALE'].includes(String(row?.status??'').toUpperCase()));
    if(rejectedEvent){
      const decision={kind:'DeploymentSceneMemoryOwnerDecision',status:'REJECTED',reasonCode:rejectedEvent.reasonCode??'SCENE_MEMORY_OWNER_EVENT_REJECTED',eventId:runtimeEvent.eventId,destination:'BACKGROUND',authorityGranted:false,canonicalMutation:false};
      this.#retainSceneMemoryLifecycleReceipt({stage:'MEMORY_OWNER_DECISION',status:decision.status,reasonCode:decision.reasonCode,event:resolved.event,proposal,taskId,destination:'BACKGROUND',mappingIds:mappingReceipts.map(row=>row?.mappingId).filter(Boolean),memoryEvidenceIds:mappingReceipts.map(row=>row?.memoryEvidenceId).filter(Boolean),sealedGeneration});
      return decision;
    }
    const participants=uniq((resolved.episode.participants??[]).map(row=>typeof row==='string'?row:row?.characterId??row?.entityId??null).filter(Boolean));
    let memoryEpisode;
    try{
      memoryEpisode=adapters.acceptSceneExperience(proposal,{
        chatId:resolved.event.chatId,turnId:resolved.event.turnId,generationId:resolved.event.generationId,correlationId:resolved.event.correlationId,
        summary:resolved.episode.compactSummary??'',participants,knownBy:[],significance:0.65,timeStart:null,timeEnd:null,currentSceneRevision:null,
      });
    }catch(error){
      const decision={kind:'DeploymentSceneMemoryOwnerDecision',status:'REJECTED',reasonCode:String(error?.code??error?.message??'SCENE_MEMORY_PROPOSAL_REJECTED'),eventId:runtimeEvent.eventId,destination:'BACKGROUND',authorityGranted:false,canonicalMutation:false};
      this.#retainSceneMemoryLifecycleReceipt({stage:'MEMORY_OWNER_DECISION',status:decision.status,reasonCode:decision.reasonCode,event:resolved.event,proposal,taskId,destination:'BACKGROUND',mappingIds:mappingReceipts.map(row=>row?.mappingId).filter(Boolean),memoryEvidenceIds:mappingReceipts.map(row=>row?.memoryEvidenceId).filter(Boolean),sealedGeneration});
      return decision;
    }
    const accepted=memoryEpisode?.freshness==='FRESH'&&memoryEpisode?.bridgeResolutionStatus==='RESOLVED';
    const decision={
      kind:'DeploymentSceneMemoryOwnerDecision',status:accepted?'ACCEPTED':'DEFERRED',reasonCode:accepted?'SCENE_MEMORY_EXPERIENCE_ACCEPTED':(memoryEpisode?.bridgeReasonCodes?.[0]??'SCENE_MEMORY_EXPERIENCE_WITHHELD'),
      eventId:runtimeEvent.eventId,proposalId:proposal.proposalId,episodeId:memoryEpisode?.id??null,episodeRevision:memoryEpisode?.revision??null,
      mappingIds:mappingReceipts.map(row=>row?.mappingId).filter(Boolean),memoryEvidenceIds:mappingReceipts.map(row=>row?.memoryEvidenceId).filter(Boolean),
      destination:'BACKGROUND',sealedGeneration,authorityGranted:false,canonicalMutation:false,settlementAuthority:false,contextSealAuthority:false,
    };
    this.#retainSceneMemoryLifecycleReceipt({stage:'MEMORY_OWNER_DECISION',status:decision.status,reasonCode:decision.reasonCode,event:resolved.event,proposal,memoryEpisode,taskId,destination:'BACKGROUND',mappingIds:decision.mappingIds,memoryEvidenceIds:decision.memoryEvidenceIds,sealedGeneration,experiencePersisted:accepted});
    this.#retainSceneMemoryLifecycleReceipt({stage:'EXPERIENCE_PERSISTED',status:accepted?'PERSISTED':'NOT_PERSISTED',reasonCode:decision.reasonCode,event:resolved.event,proposal,memoryEpisode,taskId,destination:'BACKGROUND',mappingIds:decision.mappingIds,memoryEvidenceIds:decision.memoryEvidenceIds,sealedGeneration,experiencePersisted:accepted,deduplicationOutcome:mappingReceipts.every(row=>row?.status==='REPLAYED')?'REPLAYED':'OWNER_ADMITTED'});
    return decision;
  }

  admitSceneGraphEvidenceLinks(input={}){
    const result=this.scene.admitGraphEvidenceLinks(input);
    return clone({
      kind:'DeploymentSceneGraphEvidenceAdmission',
      ...result,
      authorityGranted:false,
      canonicalMutationAuthority:false,
      truthAuthority:false,
      temporalStateAuthority:false,
      memoryMutationAuthority:false,
      contextSealAuthority:false,
    });
  }

  ingestSceneHostEvent(input = {}, { extract = null, existingEvidence = false } = {}) {
    const start = this.sceneOwnerTimeline.length;
    const spineStart=this.sceneEventSpineReceipts.length,obligationStart=this.sceneEventObligationReceipts.length;
    const requestedChatId=String(input?.chatId??'').trim(),priorActiveChat=String(this.core.hotCognition.activeChatNamespace??'');
    if(requestedChatId&&this.core.hotCognition.activeChatNamespace!==requestedChatId)this.core.activateHotCognitionChat(requestedChatId);
    let extracted = null;
    const wrappedExtract = typeof extract === 'function'
      ? (e, scene) => { extracted = extract(e, scene) ?? {}; return extracted; }
      : null;
    const outcome = existingEvidence
      ? this.scene.applyExistingEvidence(input,{extract:wrappedExtract})
      : this.scene.ingestHostEvent(input,{extract:wrappedExtract});
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
    const invalidatedTransitionHandoffs=clone(outcome?.invalidatedHandoffs??[]);
    const handoffReceipts=[];
    const signal = chatId ? this.scene.integrationSignal(chatId) : null;
    const signalReceipt = signal ? this.core.consumeSceneSignal(signal, { chatNamespace: chatId }) : null;
    if(chatId){
      for(const handoff of invalidatedTransitionHandoffs)handoffReceipts.push(this.core.consumeSceneTransitionHandoff(handoff,{chatNamespace:chatId}));
      if(outcome?.transition?.handoff)handoffReceipts.push(this.core.consumeSceneTransitionHandoff(outcome.transition.handoff,{chatNamespace:chatId}));
    }
    const changedFields = Object.keys(outcome?.delta?.changedFields ?? {}).sort();
    const eventRows = timeline.filter((row) => row.type === 'EVENT');
    const invalidationRows = timeline.filter((row) => row.type === 'INVALIDATION');
    const invalidatedSourceRevisionRefs = [...new Set([
      ...(evidence?.invalidates ?? []),
      evidence?.replacesRevisionId,
    ].filter(Boolean).map(String))].sort();
    if(priorActiveChat&&requestedChatId&&priorActiveChat!==requestedChatId){
      this.#cancelSceneObservationTasks({foreignToChat:requestedChatId,reason:'SCENE_OBSERVATION_CHAT_SUPERSEDED'});
      this.#cancelSpeculativeWarmTasks({foreignToChat:requestedChatId,reason:'SPECULATIVE_WARM_CHAT_SUPERSEDED'});
      this.speculativeWarmer.cache.invalidate({chatId:priorActiveChat});
    }
    if(invalidatedSourceRevisionRefs.length){
      this.#cancelSceneObservationTasks({sourceRevisionRefs:invalidatedSourceRevisionRefs,reason:'SCENE_OBSERVATION_SOURCE_INVALIDATED'});
      this.#cancelSpeculativeWarmTasks({sourceRevisionRefs:invalidatedSourceRevisionRefs,reason:'SPECULATIVE_WARM_SOURCE_INVALIDATED'});
      this.speculativeWarmer.cache.invalidate({chatId,sourceRevisionIds:invalidatedSourceRevisionRefs});
    }
    if(chatId&&signal?.sceneRevision!=null){
      this.#cancelSpeculativeWarmTasks({chatId,currentSceneId:signal.sceneId,currentSceneRevision:signal.sceneRevision,reason:'SPECULATIVE_WARM_SCENE_SUPERSEDED'});
      this.speculativeWarmer.cache.invalidate({chatId,sceneId:signal.sceneId,sceneRevision:signal.sceneRevision});
    }
    const sourceRevisionRefs = [...new Set(signal?.sourceRevisionRefs ?? signal?.sourceRevisionSet ?? [])].sort();
    const memoryInvalidations=[];
    for(const sourceRevisionId of invalidatedSourceRevisionRefs){
      try{
        const replacementRef=evidence?.sourceRevisionId&&String(evidence.sourceRevisionId)!==String(sourceRevisionId)?String(evidence.sourceRevisionId):null;
        const removed=String(evidence?.activity??'').toUpperCase()==='DELETE';
        const receipt=this.memory.invalidateSourceRevision(sourceRevisionId,{
          replacedBy:replacementRef,removed,reason:removed?'SCENE_SOURCE_DELETED':'SCENE_SOURCE_REVISION_INVALIDATED',
        });
        memoryInvalidations.push(clone(receipt));
        this.#retainSceneMemoryLifecycleReceipt({
          stage:'SOURCE_INVALIDATED',status:'INVALIDATED',reasonCode:removed?'SCENE_SOURCE_DELETED':'SCENE_SOURCE_REVISION_INVALIDATED',
          chatId,turnId:evidence?.turnId??null,generationId:evidence?.generationId??null,correlationId:evidence?.correlationId??null,
          sceneId:signal?.sceneId??outcome?.scene?.sceneId??null,sceneRevision:signal?.sceneRevision??outcome?.scene?.revision??null,
          sourceRevisionRefs:[sourceRevisionId],destination:'BACKGROUND',
        });
      }catch(error){
        memoryInvalidations.push({kind:'MemoryDependencyInvalidationReceipt',sourceRevisionId,status:'REJECTED',reasonCode:String(error?.code??error?.message??error),unrelatedMemoryMutation:false});
      }
    }
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
      memoryInvalidations:clone(memoryInvalidations),
      changedFields,
      delta: clone(outcome?.delta ?? null),
      dispatchTimeline: clone(timeline),
      boundary: clone(outcome?.boundary ?? null),
      boundarySignals: clone(extracted?.boundarySignals ?? null),
      transition: clone(outcome?.transition ?? null),
      transitionHandoff: clone(outcome?.transition?.handoff ?? null),
      invalidatedTransitionHandoffs,
      handoffReceipts: clone(handoffReceipts),
      graphEvidenceAdmission: outcome?.graphEvidenceAdmission ? {
        kind: outcome.graphEvidenceAdmission.kind ?? 'SceneGraphEvidenceAdmission',
        status: outcome.graphEvidenceAdmission.status ?? null,
        reasonCode: outcome.graphEvidenceAdmission.reasonCode ?? null,
        sceneId: outcome.graphEvidenceAdmission.sceneId ?? null,
        sceneRevision: outcome.graphEvidenceAdmission.sceneRevision ?? null,
        sourceRevisionId: outcome.graphEvidenceAdmission.sourceRevisionId ?? null,
        receipts: clone((outcome.graphEvidenceAdmission.receipts ?? []).slice(0,32)),
        authorityGranted:false,canonicalMutationAuthority:false,truthAuthority:false,temporalStateAuthority:false,memoryMutationAuthority:false,
      } : null,
      graphInvalidations: clone((outcome?.invalidatedGraph ?? []).slice(0,64).map((row)=>({
        edgeId:row.edgeId??null,edgeType:row.edgeType??null,status:row.status??null,temporalStatus:row.temporalStatus??null,
        retiredSourceRevisionId:row.retiredSourceRevisionId??null,invalidatedBy:row.invalidatedBy??null,
      }))),
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

  runSceneOperatorAction(input = {}) {
    const action=String(input.action??'').trim().toUpperCase();
    const chatId=String(input.chatId??'').trim();
    const currentSceneId=chatId?this.scene.chatScenes.get(chatId)??null:null;
    const sceneId=String(input.sceneId??currentSceneId??'').trim()||null;
    const start=this.sceneOwnerTimeline.length;
    const unavailable=(reason,error=null)=>clone({
      kind:'DeploymentSceneOwnerReceipt',contractVersion:1,status:'UNAVAILABLE',noWorkReason:reason,
      operator:{action,operationStatus:'UNAVAILABLE',reason,error:error?String(error?.message??error).slice(0,400):null},
      chatId,sceneId,sceneRevision:sceneId?this.scene.registry.current(sceneId)?.revision??null:null,
      sourceRevisionRefs:[],invalidatedSourceRevisionRefs:[],changedFields:[],delta:null,dispatchTimeline:[],
      boundary:null,boundarySignals:null,transition:null,eventIds:[],eventTypes:[],invalidationIds:[],
      coreReceipts:[],signalReceipt:null,signal:chatId?this.scene.integrationSignal(chatId):null,prefetchRecommendations:[],
      changeSummary:null,authority:'DESCRIPTIVE',authorityGranted:false,canonicalMutationAuthority:false,
      settlementAuthority:false,contextSealAuthority:false,contextSealBypass:false,rawNarrativeIncluded:false,
    });
    if(!action)return unavailable('SCENE_OPERATOR_ACTION_REQUIRED');
    const methods={
      RESCAN:'rescan',REBUILD:'rebuild',CORRECT:'correct',
      RECOVER_MISSED_ENTITIES:'recoverMissedEntities',CARRYOVER:'applyCarryover',
      MERGE_SPLIT_PROPOSE:'proposeMergeSplit',MERGE_SPLIT_REVIEW:'reviewMergeSplit',
      EPISODE_REPAIR:'repairEpisode',COMPARE:'compare',CONTINUITY_GAPS:'detectContinuityGaps',
    };
    const method=methods[action];
    if(!method||typeof this.sceneOperator?.[method]!=='function')return unavailable('SCENE_OPERATOR_ACTION_UNSUPPORTED');
    if(!sceneId&&!['MERGE_SPLIT_PROPOSE','MERGE_SPLIT_REVIEW'].includes(action))return unavailable('SCENE_OPERATOR_SCENE_UNAVAILABLE');

    let result;
    try{
      const args={...input};
      delete args.action;
      if(sceneId&&!args.sceneId&&action!=='CARRYOVER')args.sceneId=sceneId;
      if(action==='CARRYOVER'){
        args.toSceneId=String(args.toSceneId??sceneId??'').trim();
        args.fromSceneId=String(args.fromSceneId??'').trim();
        if(!args.fromSceneId||!args.toSceneId)return unavailable('SCENE_CARRYOVER_SCENE_REFS_REQUIRED');
      }
      result=this.sceneOperator[method](args);
    }catch(error){
      return unavailable('SCENE_OPERATOR_INPUT_UNAVAILABLE',error);
    }

    const timeline=this.sceneOwnerTimeline.slice(start).map((row)=>clone(row));
    const coreReceipts=[];
    if(chatId){
      if(this.core.hotCognition.activeChatNamespace!==chatId)this.core.activateHotCognitionChat(chatId);
      for(const row of timeline){
        const receipt=row.type==='INVALIDATION'
          ?this.core.consumeSceneContextInvalidation(row.value,{chatNamespace:chatId})
          :this.core.consumeCognitiveEvent(row.value,{chatNamespace:chatId});
        coreReceipts.push({
          type:row.type,ref:row.value?.eventId??row.value?.invalidationId??null,
          eventType:row.value?.eventType??null,status:receipt?.status??null,
          coreHandling:receipt?.coreHandling??null,reason:receipt?.reason??receipt?.reasonCode??null,
        });
      }
    }
    const signal=chatId?this.scene.integrationSignal(chatId):null;
    const signalReceipt=signal&&chatId?this.core.consumeSceneSignal(signal,{chatNamespace:chatId}):null;
    const eventRows=timeline.filter((row)=>row.type==='EVENT');
    const invalidationRows=timeline.filter((row)=>row.type==='INVALIDATION');
    const changedFields=[...new Set(result?.changeSummary?.changedFields??Object.keys(result?.delta?.changedFields??{}))].sort();
    const sourceRevisionRefs=[...new Set([
      ...(signal?.sourceRevisionRefs??signal?.sourceRevisionSet??[]),
      ...(result?.changeSummary?.why?.sourceRevisionRefs??[]),
      ...(input.sourceRevisionRefs??[]),
    ].filter(Boolean).map(String))].sort();
    const operationStatus=result?.status??(result?.applied?'APPLIED':'NO_CHANGE');
    const status=result?.applied||operationStatus==='REPAIRED'?'OBSERVED'
      :operationStatus==='STALE'?'STALE'
      :operationStatus==='UNAVAILABLE'?'UNAVAILABLE'
      :'NO_WORK';
    return clone({
      kind:'DeploymentSceneOwnerReceipt',contractVersion:1,status,
      noWorkReason:status==='NO_WORK'?(result?.reason??operationStatus):status==='UNAVAILABLE'?(result?.reason??operationStatus):null,
      operator:{
        action,operationStatus,operation:result?.operation??action,
        reviewDecision:result?.ownerDecision??null,reviewRequired:Boolean(result?.reviewRequired),
        mutationApplied:Boolean(result?.mutationApplied??result?.applied),
        automaticSimilarityDecision:Boolean(result?.automaticSimilarityDecision),
        resultKind:result?.kind??null,
      },
      evidence:null,chatId,
      sceneId:signal?.sceneId??result?.sceneId??sceneId,
      sceneRevision:signal?.sceneRevision??result?.sceneRevision??result?.scene?.revision??null,
      sourceRevisionRefs,invalidatedSourceRevisionRefs:[],
      changedFields,delta:clone(result?.delta??null),changeSummary:clone(result?.changeSummary??null),
      operatorResult:clone(result),dispatchTimeline:clone(timeline),
      boundary:null,boundarySignals:null,transition:null,
      eventIds:eventRows.map((row)=>row.value?.eventId).filter(Boolean),
      eventTypes:[...new Set(eventRows.map((row)=>row.value?.eventType).filter(Boolean))],
      invalidationIds:invalidationRows.map((row)=>row.value?.invalidationId).filter(Boolean),
      coreReceipts,
      signalReceipt:signalReceipt?{status:signalReceipt.status??null,coreHandling:signalReceipt.coreHandling??null,reason:signalReceipt.reason??signalReceipt.reasonCode??null}:null,
      signal,prefetchRecommendations:clone(signal?.prefetchRecommendations??[]),
      authority:'DESCRIPTIVE',authorityGranted:false,canonicalMutationAuthority:false,
      settlementAuthority:false,contextSealAuthority:false,contextSealBypass:false,rawNarrativeIncluded:false,
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

  #sceneFanOutTaskInput(task,{sceneInput,query,gather}={}){
    const activeEntityIds=uniq(sceneInput?.sceneEntities??[]);
    if(task.taskType==='HISTORIAN_RETRIEVAL'){
      const result=this.memorySurface.adapters.queryHistorian({
        query:String(query??''),mode:'CONTINUITY_RECALL',activeEntityIds,maxCandidates:24,
        selection:{chatId:sceneInput?.chatId??null,sceneId:sceneInput?.sceneId??null,sceneRevision:sceneInput?.sceneRevision??null},
      });
      const candidates=(result?.nominations??[]).slice(0,24).map(row=>({
        candidateId:row.candidateId,summary:row.representationText??'',value:row.representationText??null,
        semanticKey:row.evidenceIdentity??row.candidateId,temporalStatus:row.truthStatusHint??'UNRESOLVED',
        authority:row.authorityClass??'UNRESOLVED',retrievalIntentIds:[...(row.retrievalIntentIds??[])],
        entityRefs:[...(row.entityRefs??[])],relationshipRefs:[...(row.relationshipRefs??[])],
        eventRefs:[...(row.eventRefs??[])],claimRefs:[...(row.claimRefs??[])],temporalHints:[...(row.temporalHints??[])],
        authorityClass:row.authorityClass??'UNRESOLVED',truthStatusHint:row.truthStatusHint??'UNRESOLVED',
        perspective:clone(row.metadata?.perspective??{scope:'WORLD'}),evidenceRefs:[...(row.evidenceRefs??[])],
        sourceRevisionRefs:[...(row.sourceRevisionRefs??[])],channel:row.metadata?.historianChannel??'EPISODIC_MEMORY',
        representationText:row.representationText??'',
      }));
      return{intent:'CONTINUITY_RECALL',activeEntities:activeEntityIds,sceneRefs:[sceneInput?.sceneId].filter(Boolean),candidates,maxRefs:Math.min(8,candidates.length||8)};
    }
    if(task.taskType==='GRAPH_WALK'){
      const refs=this.scene.graph.references?.({sceneId:sceneInput?.sceneId,limit:64})??[];
      const nodes=new Map(),edges=[],states=[];
      for(const row of refs){
        const from=row.fromRef??row.fromSceneId??null,to=row.toRef??row.toSceneId??null;
        if(from)nodes.set(String(from),{ref:String(from),type:row.edgeType?.startsWith('SCENE_')?'SCENE':'ENTITY'});
        if(to)nodes.set(String(to),{ref:String(to),type:row.edgeType?.startsWith('SCENE_')?'SCENE':'ENTITY'});
        if(from&&to)edges.push({ref:String(row.edgeId),from:String(from),to:String(to),relation:String(row.edgeType??'RELATED')});
        if(row.observedState){
          states.push({ref:String(row.edgeId)+':state',entityRef:String(row.fromRef??from??row.edgeId),temporalStatus:String(row.temporalStatus??'UNRESOLVED'),summary:JSON.stringify(row.observedState).slice(0,600)});
        }
      }
      return{nodes:[...nodes.values()].slice(0,64),edges:edges.slice(0,64),states:states.slice(0,64),conflicts:[]};
    }
    if(task.taskType==='GREEN_ROOM'){
      return{characters:(sceneInput?.activeCast??[]).map(row=>typeof row==='string'?{characterRef:row,presence:'PRESENT',sceneEvidenceRefs:[...(sceneInput?.sourceRevisionSet??[])]}:{...clone(row),characterRef:row.characterRef??row.characterId??row.ref,presence:row.presence??row.state??'PRESENT',sceneEvidenceRefs:uniq([...(row.sceneEvidenceRefs??row.evidenceRefs??[]),...(sceneInput?.sourceRevisionSet??[])])}).filter(row=>row.characterRef),sceneRevision:sceneInput?.sceneRevision,expiry:{onSceneRevisionChange:true,ttlTurns:1,onCharacterExit:true}};
    }
    if(task.taskType==='TRUTH_PRECISION'){
      const compiler=gather.compilerInput(),evidence=[];
      for(const payload of compiler.evidence??[])for(const row of payload?.evidence??[]){
        const ref=row?.id??row?.ref;if(!ref)continue;
        evidence.push({ref:String(ref),statement:String(row.statement??row.value??row.representationText??''),semanticKey:row.semanticKey??null,temporalStatus:row.temporalStatus??'UNRESOLVED',authority:row.authority??'UNRESOLVED'});
      }
      return{intent:'SCENE_FANOUT',evidence:evidence.slice(0,64),conflictSets:[],requiredRefs:evidence.slice(0,16).map(row=>row.ref)};
    }
    return{};
  }

  async assembleSceneFanOutForNativeTurn({
    chatId,turnId,generationId,correlationId=null,causationId=null,query,worldRevision=0,characterStateRevision=0,
    foregroundBudgetMs=1200,selectionGuard=null,sealed=false,
  }={}){
    const chat=String(chatId??''),turnRef=String(turnId??''),generationRef=String(generationId??''),q=String(query??'');
    if(!chat||!turnRef||!generationRef||!q)throw new TypeError('chatId, turnId, generationId and query are required');
    const guard=()=>typeof selectionGuard==='function'?Boolean(selectionGuard()):true;
    const sceneInput=this.scene.fanOutInput(chat);
    if(!sceneInput?.sceneId)throw new Error('SCENE_FANOUT_SELECTED_SCENE_REQUIRED');
    const corr=String(correlationId??('corr:'+turnRef)),cause=String(causationId??('scene-owner:'+sceneInput.sceneId+':r'+sceneInput.sceneRevision));
    const selected=guard();
    if(!selected)return{kind:'DeploymentSceneFanOutAssembly',receipt:{kind:'DeploymentSceneFanOutAssemblyReceipt',status:'REJECTED',reasonCode:'SCENE_SELECTION_SUPERSEDED',chatId:chat,turnId:turnRef,generationId:generationRef,correlationId:corr,causationId:cause,sceneId:sceneInput.sceneId,sceneRevision:sceneInput.sceneRevision,sourceRevisionSet:uniq(sceneInput.sourceRevisionSet??[]),plannerConsidered:false,physicalExecutionCount:0,admittedResultIds:[],rejectedResultIds:[],staleResultIds:[],candidateIds:[],authorityGranted:false,truthAuthority:false,contextSealAuthority:false},coreHandoff:null};
    const now=Date.now(),turn=createTurnEnvelope({
      turnId:turnRef,eventId:cause,eventType:'SCENE_FANOUT',correlationId:corr,causationId:cause,
      sourceRevisionSet:uniq(sceneInput.sourceRevisionSet??[]),worldRevision:Number(worldRevision)||0,
      sceneRevision:Number(sceneInput.sceneRevision)||0,characterStateRevision:Number(characterStateRevision)||0,
      createdAt:now,deadline:now+Math.max(50,Number(foregroundBudgetMs)||1200),cognitiveLayer:'L1',dedupeKey:'scene-fanout:'+generationRef,
    });
    const plannerInput=plannerInputFromScene({publicSignals:sceneInput,base:{text:q,queryIntent:'CURRENT',trigger:'SCENE_FT002_ASSEMBLY',selection:{chatId:chat,turnId:turnRef,generationId:generationRef,correlationId:corr}}});
    const prepared=this.scenePrefetchSwarm.prepareTurn({turnEvent:turn,plannerInput});
    const gather=new GatherCoordinator({turnEvent:turn,plan:prepared.fanOutPlan,currentRevisionSet:turn});
    const currentRevisionState=()=>({
      sourceRevisionSet:uniq(this.scene.fanOutInput(chat)?.sourceRevisionSet??[]),
      worldRevision:Number(worldRevision)||0,sceneRevision:Number(this.scene.fanOutInput(chat)?.sceneRevision??0),
      characterStateRevision:Number(characterStateRevision)||0,
    });
    const execution=await this.scenePrefetchSwarm.executeCheckpoint(prepared.checkpoint,{
      inputResolver:(task)=>this.#sceneFanOutTaskInput(task,{sceneInput,query:q,gather}),
      currentRevisionState,sealed:()=>typeof sealed==='function'?Boolean(sealed()):Boolean(sealed),
      selection:{chatId:chat,turnId:turnRef,generationId:generationRef,correlationId:corr},gather,
    });
    const bundle=gather.close({at:Date.now(),reason:gather.quorumSatisfied()?'FOREGROUND_QUORUM':'ASSEMBLY_EXECUTION_COMPLETE'});
    const selectionCurrent=guard();
    const historianTaskIds=new Set((prepared.fanOutPlan.tasks??[]).filter(task=>task.taskType==='HISTORIAN_RETRIEVAL').map(task=>task.taskId));
    const historianSummary=(execution.contribution?.resultSummary??[]).filter(row=>historianTaskIds.has(row.taskId));
    const acceptedHistorianTaskIds=new Set(historianSummary.filter(row=>row.ownerAdmissionAttempted&&row.ownerAccepted).map(row=>row.taskId));
    const historianTaskId=[...acceptedHistorianTaskIds][0]??null;
    const historianWorker=historianSummary.find(row=>row.taskId===historianTaskId)??null;
    const candidates=selectionCurrent?(bundle.loreEvidence??[]).flatMap(row=>row?.candidateSet?.candidates??row?.candidates??[]).slice(0,64):[];
    const resultSummary=execution.contribution?.resultSummary??[];
    const admittedResultIds=uniq((execution.contribution?.continuousOwnerAdmissions??[]).filter(row=>row.acceptedByOwner).map(row=>row.resultId));
    const rejectedResultIds=uniq(resultSummary.filter(row=>row.ownerAdmissionAttempted&&!row.ownerAccepted&&!row.stale).map(row=>row.resultId).filter(Boolean));
    const staleResultIds=uniq(resultSummary.filter(row=>row.stale||row.state==='REJECTED_STALE').map(row=>row.resultId).filter(Boolean));
    const physicalExecutionCount=resultSummary.filter(row=>row.providerProfileId&&row.startedAt!=null).length;
    const receipt=Object.freeze({
      kind:'DeploymentSceneFanOutAssemblyReceipt',contractVersion:1,status:selectionCurrent?'ASSEMBLED':'REJECTED',reasonCode:selectionCurrent?null:'SCENE_SELECTION_SUPERSEDED_AFTER_EXECUTION',
      chatId:chat,turnId:turnRef,generationId:generationRef,correlationId:corr,causationId:cause,
      sceneId:sceneInput.sceneId,sceneRevision:sceneInput.sceneRevision,sourceRevisionSet:uniq(sceneInput.sourceRevisionSet??[]),
      plannedTaskIds:(prepared.fanOutPlan.tasks??[]).map(task=>task.taskId),plannedRoles:uniq((prepared.fanOutPlan.nominations??[]).map(row=>row.roleId)),
      physicalExecutionCount,executionResults:resultSummary.slice(0,32).map(row=>({taskId:row.taskId,taskType:row.taskType,resultId:row.resultId,state:row.state,providerProfileId:row.providerProfileId,workerId:row.workerId,ownerAdmissionAttempted:row.ownerAdmissionAttempted,ownerAccepted:row.ownerAccepted,ownerDestination:row.ownerDestination,failureCode:row.failureCode})),
      admittedResultIds,rejectedResultIds,staleResultIds,candidateIds:uniq(candidates.map(row=>row.candidateId)),
      gather:{acceptedResultIds:[...(bundle.acceptedResultIds??[])],rejectedResultIds:[...(bundle.rejectedResultIds??[])],staleResultIds:[...(bundle.staleResultIds??[])],missingRequired:[...(bundle.missingRequired??[])]},
      plannerConsidered:true,workerExecutionAttempted:physicalExecutionCount>0,checkpointExecutionPerformed:true,selectionCurrentAfterExecution:selectionCurrent,
      authorityGranted:false,retrievalAuthority:false,truthAuthority:false,contextSealAuthority:false,canonicalMutation:false,settlementAuthority:false,
    });
    this.sceneFanOutAssemblies.push(clone(receipt));if(this.sceneFanOutAssemblies.length>128)this.sceneFanOutAssemblies.splice(0,this.sceneFanOutAssemblies.length-128);
    this.#emit({type:'SCENE_FT002_ASSEMBLED',receipt:clone(receipt)});
    const coreHandoff=selectionCurrent?Object.freeze({
      kind:'SceneFanOutCoreHandoff',contractVersion:1,chatId:chat,turnId:turnRef,generationId:generationRef,correlationId:corr,causationId:cause,
      sceneId:sceneInput.sceneId,sceneRevision:sceneInput.sceneRevision,sourceRevisionSet:uniq(sceneInput.sourceRevisionSet??[]),
      assemblyStatus:receipt.status,assemblyReasonCode:receipt.reasonCode??null,plannerConsidered:true,physicalExecutionCount,
      admittedResultIds:[...admittedResultIds],rejectedResultIds:[...rejectedResultIds],staleResultIds:[...staleResultIds],
      candidates:historianTaskId?candidates.map(candidate=>({candidate:clone(candidate),taskId:historianTaskId,upstreamResultId:historianWorker?.resultId??null,causationId:cause,sourceSubsystem:'SCENE_FANOUT_HISTORIAN',workerId:historianWorker?.workerId??'scene-fanout',resultClass:historianWorker?.resultClass??'OPPORTUNISTIC',timing:{latencyMs:historianWorker?.latencyMs??null}})):[],
      authorityGranted:false,admissionAuthority:false,truthAuthority:false,contextSealAuthority:false,
    }):null;
    return{kind:'DeploymentSceneFanOutAssembly',receipt:clone(receipt),coreHandoff};
  }

  readSceneFanOutAssemblies({limit=32}={}){
    const count=Math.max(1,Math.min(128,Number(limit)||32));
    return this.sceneFanOutAssemblies.slice(-count).map(clone);
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
    this.speculativeWarmTurnSequence+=1;
    const warmConsumption=mode==='simple'?null:this.#consumeSpeculativeWarmForSend({
      chatId:String(chatId),query,anchorEntityIds,sceneSignal,turn,
    });
    const warmPreparedLore=warmConsumption?.reuseLorePreparation?warmConsumption.preparedLore:null;
    const warmPartialCandidates=(warmConsumption?.use?.reusableCandidates??[]).map((row,index)=>({
      taskId:'warm-salvage:'+turn.turnId+':'+index,
      candidateId:row.candidateId,
      sourceRevisionRefs:[...(row.sourceRevisionRefs??[])],
      resultClass:RuntimeResultClass.OPPORTUNISTIC,
      authorityGranted:false,
    }));
    const generationMeta={
      chatId:String(chatId),turnId:turn.turnId,generationId:String(generationId),correlationId:turn.correlationId,
      sceneId:sceneSignal.sceneId??null,sceneRevision:sceneSignal.sceneRevision,sourceRevisionSet:[...sourceRevisionSet],
    };
    this.speculativeWarmer.onForegroundStart({turnId:turn.turnId});
    this.runtimeDirector.beginGeneration(generationMeta);
    try{
      await this.speculativeWarmPumpPromise.catch(()=>{});

    let planning = null;
    const jobs = [];
    if (mode !== 'simple') {
      planning = warmPreparedLore?.laneResult ?? this.loreSystem.query({ query, intent: 'AUTO' });
      if(!warmPreparedLore)jobs.push(taskFor({ turn, suffix: 'lore', taskType: 'LORE_RETRIEVAL', capability: CAPABILITIES.CPU_ANALYSIS, metadata: { query, intent: 'AUTO' } }));
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
      externalRetrievalCandidates:warmPartialCandidates,
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
    this.speculativeWarmer.markTurnSealed(turn.turnId);
    let warmCoreRevalidation=null;
    if(warmConsumption?.use?.consumptionId){
      const currentWarmIdentity=this.#speculativeWarmIdentity({chatId:String(chatId),recommendation:warmConsumption.recommendation,sceneSignal:this.scene.integrationSignal(String(chatId))});
      const accepted=JSON.stringify(currentWarmIdentity)===JSON.stringify(warmConsumption.identity)
        &&Number(published.worldRevision)===Number(warmConsumption.identity.worldRevision)
        &&Number(published.sceneRevision)===Number(warmConsumption.identity.sceneRevision);
      warmCoreRevalidation=this.speculativeWarmer.recordCoreRevalidation({
        consumptionId:warmConsumption.use.consumptionId,accepted,
        reason:accepted?null:'CORE_SEND_FENCES_CHANGED',
        reusedStages:{retrieval:Boolean(warmPreparedLore),truth:false,precision:false,compile:false},
      });
      this.#retainSpeculativeWarmReceipt({
        stage:'CORE_REVALIDATION',status:accepted?'ACCEPTED':'REJECTED',reasonCode:accepted?'CORE_FENCES_REVALIDATED':'CORE_SEND_FENCES_CHANGED',
        recommendationId:warmConsumption.recommendation?.recommendationId??null,packetId:warmConsumption.use.packetId??null,
        chatId:String(chatId),turnId:turn.turnId,generationId:String(generationId),sceneId:warmConsumption.recommendation?.sceneId??null,
        sceneRevision:warmConsumption.recommendation?.sceneRevision??null,reusedStages:warmPreparedLore?['LORE_PREPARATION']:[],
        remainingForegroundStages:['CORE_RETRIEVAL','TRUTH','PRECISION','COMPILE','SEAL'],
        foregroundWorkAvoided:{lorePlanningQuery:Boolean(warmPreparedLore),runtimeLorePreparation:Boolean(warmPreparedLore),coreRetrieval:false,truth:false,precision:false,compile:false},
      });
    }

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
      speculativeWarm:{
        status:warmConsumption?.use?.freshness??(warmConsumption?'MISS':'NOT_CONSIDERED'),
        packetId:warmConsumption?.use?.packetId??null,recommendationId:warmConsumption?.recommendation?.recommendationId??null,
        reusableRefs:[...(warmConsumption?.use?.reusableRefs??[])],partialSalvageCount:warmPartialCandidates.length,
        lorePreparationReused:Boolean(warmPreparedLore),coreRevalidation:clone(warmCoreRevalidation),
        foregroundWorkAvoided:{lorePlanningQuery:Boolean(warmPreparedLore),runtimeLorePreparation:Boolean(warmPreparedLore),coreRetrieval:false,truth:false,precision:false,compile:false},
        authorityGranted:false,canonicalMutationAuthority:false,truthAuthority:false,contextSealAuthority:false,
      },
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
    }finally{
      this.speculativeWarmer.onForegroundEnd();
      this.runtimeDirector.completeGeneration(generationMeta);
      this.#pumpSpeculativeWarmRuntime();
    }
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
      completeOptionalResourceGeneration: (meta) => {
        const result=this.resourceDirectorBridge.completeGeneration(meta);
        this.#pumpResourceDirector();
        return result;
      },
      readOptionalResourceRuntime: () => clone(this.resourceDirector.snapshot()),
      readMemoryExecutionReceipts: () => clone(this.memoryNearlineReceipts),
      readMemoryVectorReceipts: () => this.memory.vectorIndex.readReceipts({limit:128}),
      readSceneObservationReceipts: () => this.readSceneObservationReceipts({limit:128}),
      readSceneObservationRuntime: (selection) => this.readSceneObservationRuntime(selection),
      readSceneMemoryLifecycleReceipts: () => this.readSceneMemoryLifecycleReceipts({limit:128}),
      readSpeculativeWarm: () => clone({
        metrics:this.speculativeWarmer.metrics(),receipts:this.speculativeWarmReceipts.slice(-128),
        diagnostics:this.speculativeWarmer.diagnostics().slice(-128),
      }),
      flushSpeculativeWarmRuntime: (input={}) => this.flushSpeculativeWarmRuntime(input),
      cancelSceneObservationWork: (input={}) => this.cancelSceneObservationWork(input),
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
      sceneObservation: {
        receipts:clone(this.sceneObservationReceipts.slice(-128)),
        counts:Object.fromEntries(['QUEUED','DEDUPED','RETURNED','ROUTED','ADMITTED','REJECTED','FAILED','CANCELLED','INVALID','SKIPPED'].map(status=>[status,this.sceneObservationReceipts.filter(row=>row.status===status).length])),
        runtimeOpen:this.resourceDirector.ledger.list().filter(row=>row?.obligation?.taskType==='SCENE_OBSERVATION'&&!['SATISFIED','SUPERSEDED','CANCELLED'].includes(String(row.lifecycleStatus))).length,
        runtimeStates:this.resourceDirector.ledger.list().filter(row=>row?.obligation?.taskType==='SCENE_OBSERVATION').slice(-64).map(row=>({
          taskId:row.taskId,lifecycleStatus:row.lifecycleStatus,executionStatus:row.executionStatus,startedCount:row.startedCount,
          chatId:row.obligation?.payload?.cognitiveTask?.metadata?.chatId??null,turnId:row.obligation?.payload?.cognitiveTask?.turnId??null,
          generationId:row.obligation?.payload?.cognitiveTask?.metadata?.generationId??null,phase:row.obligation?.payload?.cognitiveTask?.metadata?.phase??null,
          deadline:row.obligation?.deadline??null,resultClass:row.obligation?.resultContract?.resultClass??null,
        })),
        authorityGranted:false,canonicalMutationAuthority:false,contextSealAuthority:false,
      },
      sceneFanOut: {
        assemblyCount:this.sceneFanOutAssemblies.length,
        last:clone(this.sceneFanOutAssemblies.at(-1)??null),
        physicalExecutionCount:this.sceneFanOutAssemblies.reduce((n,row)=>n+Number(row.physicalExecutionCount??0),0),
        admittedResultCount:this.sceneFanOutAssemblies.reduce((n,row)=>n+(row.admittedResultIds?.length??0),0),
        rejectedResultCount:this.sceneFanOutAssemblies.reduce((n,row)=>n+(row.rejectedResultIds?.length??0),0),
        staleResultCount:this.sceneFanOutAssemblies.reduce((n,row)=>n+(row.staleResultIds?.length??0),0),
        authorityGranted:false,canonicalMutationAuthority:false,truthAuthority:false,contextSealAuthority:false,
      },
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
      sceneMemory: {
        retainedReceipts:this.sceneMemoryLifecycleReceipts.length,
        eventPublished:this.sceneMemoryLifecycleReceipts.filter(row=>row.stage==='EVENT_PUBLISHED'&&row.status==='ELIGIBLE').length,
        workScheduled:this.sceneMemoryLifecycleReceipts.filter(row=>row.stage==='WORK_SCHEDULED'&&['SCHEDULED','DEDUPED','COALESCED'].includes(row.status)).length,
        executionAttempted:this.sceneMemoryLifecycleReceipts.filter(row=>row.stage==='EXECUTION_ATTEMPTED'&&row.status==='ATTEMPTED').length,
        memoryAccepted:this.sceneMemoryLifecycleReceipts.filter(row=>row.stage==='MEMORY_OWNER_DECISION'&&row.status==='ACCEPTED').length,
        experiencePersisted:this.sceneMemoryLifecycleReceipts.filter(row=>row.stage==='EXPERIENCE_PERSISTED'&&row.status==='PERSISTED').length,
        experienceRetrieved:this.sceneMemoryLifecycleReceipts.filter(row=>row.stage==='EXPERIENCE_RETRIEVED'&&row.status==='RETRIEVED').length,
        rejected:this.sceneMemoryLifecycleReceipts.filter(row=>row.status==='REJECTED').length,
        deferred:this.sceneMemoryLifecycleReceipts.filter(row=>row.status==='DEFERRED').length,
        noWork:this.sceneMemoryLifecycleReceipts.filter(row=>row.status==='NO_WORK').length,
        last:clone(this.sceneMemoryLifecycleReceipts.at(-1)??null),
        rawStoryTextIncluded:false,providerBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
        authorityGranted:false,canonicalMutationAuthority:false,contextSealAuthority:false,
      },
      speculativeWarm: {
        metrics:this.speculativeWarmer.metrics(),
        receipts:clone(this.speculativeWarmReceipts.slice(-128)),
        coordinatorDiagnostics:this.speculativeWarmer.diagnostics().slice(-128),
        runtimeOpen:this.runtimeDirector.ledger.list().filter(row=>row?.obligation?.taskType==='SPECULATIVE_CONTEXT_WARM'&&!['SATISFIED','SUPERSEDED','CANCELLED'].includes(String(row.lifecycleStatus))).length,
        runtimeStates:this.runtimeDirector.ledger.list().filter(row=>row?.obligation?.taskType==='SPECULATIVE_CONTEXT_WARM').slice(-64).map(row=>({
          taskId:row.taskId,lifecycleStatus:row.lifecycleStatus,executionStatus:row.executionStatus,startedCount:row.startedCount,
          chatId:row.obligation?.cause?.chatId??null,turnId:row.obligation?.cause?.turnId??null,generationId:row.obligation?.cause?.generationId??null,
          sceneRevision:row.obligation?.sceneRevision??null,sourceRevisionRefs:[...(row.obligation?.sourceRevisionIds??[])],
          checkpoint:clone(row.checkpoint??null),supersession:clone(row.supersession??null),
        })),
        recovery:{persistenceConfigured:false,reloadBehavior:'COLD_START',duplicateListenerGuard:'INSTANCE_SCOPED_CONSTRUCTION'},
        rawPromptsIncluded:false,storyBodiesIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
        authorityGranted:false,canonicalMutationAuthority:false,truthAuthority:false,contextSealAuthority:false,
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
    const resources=this.resourceConnections.readModel().resources??[];
    const directResource=workerResult?resources.find(row=>
      (workerResult.workerId&&row.workerId===workerResult.workerId)
      ||(workerResult.providerId&&row.providerId===workerResult.providerId&&(!workerResult.modelId||row.actualModelId===workerResult.modelId||row.modelId===workerResult.modelId))
    )??null:null;
    const profileId=workerResult?.workerId
      ? admission?.plan?.capabilityAdmission?.candidates?.find(row=>row.sourceWorkerId===workerResult.workerId)?.profileId??directResource?.providerProfileId??admission?.plan?.capabilityAdmission?.candidates?.[0]?.profileId??null
      : directResource?.providerProfileId??admission?.plan?.capabilityAdmission?.candidates?.[0]?.profileId??null;
    const resource=directResource??resources.find(row=>row.providerProfileId===profileId)??null;
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
      generationBudget:clone(workerResult?.providerMetadata?.generationBudget??resource?.lastExecution?.generationBudget??null),
      foregroundQuorumDeadline:task?.hardDeadline??task?.metadata?.foregroundQuorumDeadline??null,
      providerLifetimePolicy:task?.metadata?.providerLifetimePolicy??null,
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
