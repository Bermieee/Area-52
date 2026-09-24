import {
  MEMORY_API_VERSION,
  MEMORY_CONTRACT_VERSION,
  MEMORY_LIMITS,
  deepClone,
} from './memory-contracts.js';
import {TemporalStateGraph} from './temporal-state-graph.js';
import {MemoryGreenRoomStore} from './memory-green-room.js';
import {MemoryExperienceStore} from './memory-experience-store.js';
import {MemoryHistorianIndex} from './memory-historian.js';

export class MemoryTemporalProducer {
  constructor({
    graph=new TemporalStateGraph(),
    greenRoom=new MemoryGreenRoomStore(),
    experienceStore=null,
    historian=null,
    snapshot=null,
  }={}) {
    this.graph=graph;
    this.greenRoom=greenRoom;
    this.experienceStore=experienceStore??new MemoryExperienceStore({graph});
    this.historian=historian??new MemoryHistorianIndex({graph,experienceStore:this.experienceStore});
    this.diagnostics=[];
    if (snapshot) this.restore(snapshot);
  }

  appendEvidence(input) {
    return this.graph.appendEvidence(input);
  }

  appendRawExperience(input) {
    return this.experienceStore.appendRawExperience(input);
  }

  ingestSceneExperience(proposal,options={}) {
    return this.experienceStore.ingestSceneExperience(proposal,options);
  }

  publishEpisode(input) {
    return this.experienceStore.publishEpisode(input);
  }

  applySettlement(envelope) {
    const result=this.graph.applySettlement(envelope);
    this.historian.build();
    return result;
  }

  currentProjection(options={}) {
    return this.graph.currentProjection(options);
  }

  historicalClaims(options={}) {
    return this.graph.historicalClaims(options);
  }

  asOf(worldRevision) {
    return this.graph.asOf(worldRevision);
  }

  traverseEntity(entityId,options={}) {
    return this.graph.traverseEntity(entityId,options);
  }

  unresolvedSets(options={}) {
    return this.graph.unresolvedSets(options);
  }

  ingestGreenRoomBatch(batch,options={}) {
    return this.greenRoom.ingestBatch(batch,options);
  }

  expireGreenRoom(context={}) {
    return this.greenRoom.expire(context);
  }

  greenRoomShadow(context={}) {
    return this.greenRoom.compactShadow(context);
  }

  greenRoomReflectionProposal(characterRef,options={}) {
    return this.greenRoom.createReflectionProposal(characterRef,options);
  }

  reflectionFromGreenRoomProposal(proposal,options={}) {
    const reflection=this.experienceStore.reflectionFromGreenRoomProposal(proposal,options);
    this.historian.build();
    return reflection;
  }

  reviseReflection(input) {
    const reflection=this.experienceStore.reviseReflection(input);
    this.historian.build();
    return reflection;
  }

  invalidateSourceRevision(sourceRevisionId,options={}) {
    const graphResult=this.graph.invalidateSourceRevision(sourceRevisionId,options);
    const greenRoomResult=this.greenRoom.expire({invalidatedSourceRevisionRefs:[sourceRevisionId]});
    const derived=this.experienceStore.refreshFreshness();
    this.historian.build();
    const receipt={
      kind:'MemoryDependencyInvalidationReceipt',
      sourceRevisionId,
      graphTransitionId:graphResult.event.id,
      expiredGreenRoom:greenRoomResult.expired,
      staleEpisodeIds:derived.staleEpisodes,
      staleReflectionIds:derived.staleReflections,
      memoryRevisionRefs:this.memoryRevisionRefs(),
      unrelatedMemoryMutation:false,
    };
    this.pushDiagnostic(receipt);
    return receipt;
  }

  rebuildHistorian() {
    return this.historian.build();
  }

  queryHistorian(request) {
    try {
      return this.historian.query(request);
    } catch (error) {
      this.pushDiagnostic({kind:'MemoryHistorianDegraded',reason:error?.message??String(error)});
      return this.historian.degradedResult({query:request?.query??'',mode:request?.mode??'EXPLICIT_HISTORY',reason:error?.message??'HISTORIAN_FAILED'});
    }
  }

  resolveHistorianMemoryRequest(request) {
    try {
      return this.historian.resolveHistorianMemoryRequest(request);
    } catch (error) {
      this.pushDiagnostic({kind:'MemoryHistorianResolverDegraded',reason:error?.message??String(error)});
      return {
        kind:'HistorianMemoryResolution',
        contractVersion:'1.0.0',
        status:'DEGRADED',
        artifacts:[],
        unavailableChannels:['MEMORY_RESOLVER_FAILED'],
        memoryRevisionRefs:[...(request?.memoryRevisionRefs??[])],
        perspectiveStatus:request?.perspectiveConstraint?.scope??'WORLD',
        evidenceBytes:0,
        authorityGranted:false,
        memoryMutation:false,
      };
    }
  }

  drillDown(nominationOrRecordRef) {
    return this.historian.drillDown(nominationOrRecordRef);
  }

  memoryRevisionRefs() {
    return this.historian.memoryRevisionRefs();
  }

  startConsolidation(jobs=[]) {
    return this.experienceStore.startConsolidation(jobs);
  }

  runConsolidation(sessionId,options={}) {
    const result=this.experienceStore.runConsolidation(sessionId,options);
    if (result.publishedArtifactIds.length) this.historian.build();
    return result;
  }

  checkpoint({cursor=0,pendingWork=[]}={}) {
    return this.experienceStore.checkpoint({cursor,pendingWork});
  }

  publicApi() {
    return {
      kind:'MemoryTemporalProducerApi',
      apiVersion:MEMORY_API_VERSION,
      contractVersion:MEMORY_CONTRACT_VERSION,
      revisionRefs:this.memoryRevisionRefs(),
      capabilities:[
        'APPEND_EVIDENCE',
        'INGEST_SCENE_EXPERIENCE',
        'APPLY_OWNER_SETTLEMENT',
        'CURRENT_PROJECTION',
        'AS_OF_HISTORY',
        'ENTITY_TRAVERSAL',
        'GREEN_ROOM_SHADOW',
        'REFLECTION_DERIVATION',
        'BOUNDED_CONSOLIDATION_CHECKPOINT',
        'HISTORIAN_QUERY',
        'HISTORIAN_RESOLVER',
        'EXACT_EVIDENCE_DRILLBACK',
        'SNAPSHOT_RELOAD',
      ],
      bounds:deepClone(MEMORY_LIMITS),
      ownership:{
        canonicalMutation:'CORE_OWNER_SETTLEMENT_ONLY',
        scenePersistence:'MEMORY_ADMISSION_OF_REFERENCE_FIRST_SCENE_PROPOSALS',
        greenRoom:'INFERRED_EXPIRING',
        reflection:'INFERRED_DURABLE',
        historian:'NOMINATION_ONLY',
        candidateBusAdmission:false,
        truthGate:false,
        settlement:false,
        contextSeal:false,
        runtimeScheduling:false,
      },
      adapters:{
        coreSettlement:'Core MutationProposal + SettlementDecision/Receipt',
        scene:'SceneExperienceProposal v1.0.0',
        greenRoom:'GreenRoomBatch v1.1.0',
        historian:'HistorianMemoryResolution v1.0.0 + CandidateNomination v1.0.0',
      },
    };
  }

  status() {
    return {
      kind:'MemoryTemporalProducerStatus',
      revisionRefs:this.memoryRevisionRefs(),
      evidenceCount:this.graph.evidence.size,
      settlementJournalCount:this.graph.settlementJournal.length,
      currentProjectionCount:this.graph.currentProjection({includeStale:true}).length,
      unresolvedSetCount:this.graph.unresolvedSets().length,
      activeGreenRoomCount:this.greenRoom.activeByCharacter.size,
      episodeCount:this.experienceStore.episodes.size,
      reflectionCount:this.experienceStore.reflections.size,
      historian:this.historian.status(),
      diagnostics:deepClone(this.diagnostics),
    };
  }

  pushDiagnostic(row) {
    this.diagnostics.push(deepClone(row));
    if (this.diagnostics.length>MEMORY_LIMITS.maxDiagnostics) this.diagnostics.splice(0,this.diagnostics.length-MEMORY_LIMITS.maxDiagnostics);
  }

  snapshot() {
    return {
      kind:'MemoryTemporalProducerSnapshot',
      apiVersion:MEMORY_API_VERSION,
      graph:this.graph.snapshot(),
      greenRoom:this.greenRoom.snapshot(),
      experienceStore:this.experienceStore.snapshot(),
      historian:this.historian.snapshot(),
      diagnostics:deepClone(this.diagnostics),
    };
  }

  restore(snapshot) {
    this.graph.restore(snapshot?.graph??null);
    this.greenRoom.restore(snapshot?.greenRoom??null);
    this.experienceStore=new MemoryExperienceStore({graph:this.graph,snapshot:snapshot?.experienceStore??null});
    this.historian=new MemoryHistorianIndex({graph:this.graph,experienceStore:this.experienceStore,snapshot:snapshot?.historian??null});
    this.diagnostics=deepClone(snapshot?.diagnostics??[]).slice(-MEMORY_LIMITS.maxDiagnostics);
  }

  static fromSnapshot(snapshot) {
    return new MemoryTemporalProducer({snapshot});
  }
}
