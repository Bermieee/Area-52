import {
  CORE_SETTLEMENT_COMPAT_VERSION,
  GREEN_ROOM_COMPAT_VERSION,
  HISTORIAN_COMPAT_VERSION,
  MEMORY_API_VERSION,
  MEMORY_CONTRACT_VERSION,
  MEMORY_HIERARCHY_API_VERSION,
  MEMORY_HIERARCHY_CONTRACT_VERSION,
  MEMORY_EVIDENCE_BRIDGE_API_VERSION,
  MEMORY_EVIDENCE_BRIDGE_CONTRACT_VERSION,
  MEMORY_UI_READ_MODEL_VERSION,
  MEMORY_CONSOLIDATION_WORK_VERSION,
  SCENE_MEMORY_HANDOFF_COMPAT_VERSION,
  deepClone,
} from './memory-contracts.js';

export const MEMORY_INTEGRATION_SURFACE_VERSION='1.0.0';

export function createMemoryIntegrationSurface(producer) {
  if (!producer || typeof producer.publicApi!=='function') throw new TypeError('MemoryTemporalProducer required');
  return {
    kind:'MemoryIntegrationSurface',
    contractVersion:MEMORY_INTEGRATION_SURFACE_VERSION,
    memoryApiVersion:MEMORY_API_VERSION,
    memoryContractVersion:MEMORY_CONTRACT_VERSION,
    compatibility:{
      coreSettlement:CORE_SETTLEMENT_COMPAT_VERSION,
      sceneMemoryHandoff:SCENE_MEMORY_HANDOFF_COMPAT_VERSION,
      greenRoom:GREEN_ROOM_COMPAT_VERSION,
      historian:HISTORIAN_COMPAT_VERSION,
      candidateNomination:'1.0.0',
      hierarchy:MEMORY_HIERARCHY_CONTRACT_VERSION,
      evidenceBridge:MEMORY_EVIDENCE_BRIDGE_CONTRACT_VERSION,
      uiReadModel:MEMORY_UI_READ_MODEL_VERSION,
      consolidationWork:MEMORY_CONSOLIDATION_WORK_VERSION,
    },
    adapters:{
      applyCoreSettlement:(envelope,options={})=>producer.applyCoreSettlement(envelope,options),
      applyMemoryNativeSettlement:(envelope)=>producer.applySettlement(envelope),
      admitExternalEvidenceMapping:(input)=>producer.admitExternalEvidenceMapping(input),
      invalidateExternalEvidenceMapping:(input)=>producer.invalidateExternalEvidenceMapping(input),
      acceptSceneOwnerEvent:(event,options={})=>producer.acceptSceneOwnerEvent(event,options),
      acceptSceneExperience:(proposal,options={})=>producer.ingestSceneExperience(proposal,options),
      acceptGreenRoomBatch:(batch,options={})=>producer.ingestGreenRoomBatch(batch,options),
      resolveHistorian:(request)=>producer.resolveHistorianMemoryRequest(request),
      queryHistorian:(request)=>producer.queryHistorian(request),
      drillDown:(nominationOrRecordRef,options={})=>producer.drillDown(nominationOrRecordRef,options),
      profileHierarchyQuery:(request,options={})=>producer.profileHierarchyQuery(request,options),
      readMemory:(selection={})=>producer.readMemoryUi(selection),
      subscribeMemory:(listener)=>producer.subscribeMemory(listener),
      createMemoryUiProducer:(options={})=>producer.createMemoryUiProducer(options),
      startConsolidation:(jobs=[],options={})=>producer.startConsolidation(jobs,options),
      consolidationWorkUnits:(sessionId,options={})=>producer.consolidationWorkUnits(sessionId,options),
      runConsolidation:(sessionId,options={})=>producer.runConsolidation(sessionId,options),
      defineSummaryScope:(input)=>producer.defineSummaryScope(input),
      runSummaryCompaction:(options={})=>producer.runSummaryCompaction(options),
      summaryWorkUnits:(options={})=>producer.summaryWorkUnits(options),
      compileSummaryWorkUnit:(workUnit,options={})=>producer.compileSummaryWorkUnit(workUnit,options),
      summaryArtifact:(scopeRef,options={})=>producer.summaryArtifact(scopeRef,options),
      summaryHistory:(scopeRef)=>producer.summaryHistory(scopeRef),
      summaryStatus:()=>producer.summaryStatus(),
      currentProjection:(options={})=>producer.currentProjection(options),
      asOf:(worldRevision)=>producer.asOf(worldRevision),
      snapshot:()=>producer.snapshot(),
    },
    directorAdapterNotes:[
      {
        seam:'SCENE_EVIDENCE_RESOLUTION',
        status:'MEMORY_BRIDGE_READY_FOR_ASSEMBLY',
        behavior:'Admit owner artifact + exact source/evidence mapping, route SCENE_BOUNDARY_CONFIRMED / SCENE_EPISODE_READY, then route SceneExperienceProposal. Memory withholds the episode until exact refs, source revisions and Scene boundary fences resolve.',
      },
      {
        seam:'CORE_SETTLEMENT_EVIDENCE',
        status:'MEMORY_BRIDGE_READY_FOR_ASSEMBLY',
        behavior:'Admit each Core owner evidence artifact through the exact bridge, then call applyCoreSettlement with explicit owner artifact descriptors. Mapping is prerequisite only; the existing proposal/decision/receipt validator remains the canonical gate.',
      },
      {
        seam:'GREEN_ROOM',
        status:'DIRECT_COMPATIBLE',
        behavior:'Jev GreenRoomBatch v1.1.0 is accepted without authority promotion.',
      },
      {
        seam:'SUMMARY_SCENE_BOUNDARIES',
        status:'MINIMAL_SCENE_ADAPTER_REQUIRED_AT_ASSEMBLY',
        behavior:'Scene/Core may register confirmed source ranges and parent/child scope edges. Memory compiles only from exact local evidence and validated child source ranges; Runtime owns when work units execute.',
      },
      {
        seam:'HISTORIAN',
        status:'DIRECT_COMPATIBLE',
        behavior:'Memory emits HistorianMemoryResolution v1.0.0 and CandidateNomination v1.0.0 compatible records. When assembly supplies a chat selection, exact and hierarchical candidates are fenced to that chat before ranking; summary nominations remain navigation-only.',
      },
      {
        seam:'UI_CORE_MEMORY',
        status:'LIVE_READ_SUBSCRIBE_READY',
        behavior:'Worker 3 may pass createMemoryUiProducer({readSelection}) as the Wave 11/12 generic memory producer and fan subscribeMemory into the host subscription. Reads are selected-chat scoped; retrieval receipts are selected turn/generation scoped; no UI widgets or UI-owned state are implemented here.',
      },
      {
        seam:'RUNTIME_SLEEP_CONSOLIDATION',
        status:'MEMORY_WORK_UNITS_READY',
        behavior:'Worker 2/Runtime may request bounded MemoryConsolidationWorkUnit records carrying source/world/scene plus generation fences. Runtime remains the only scheduler/yield owner. A sealed generation parks Memory work for NEXT_TURN rather than publishing into that generation.',
      },
    ],
    authority:{
      memoryOwnsCanonicalSettlement:false,
      memoryAcceptsValidatedOwnerSettlement:true,
      greenRoomCanonical:false,
      reflectionCanonical:false,
      historianAdmission:false,
      contextSeal:false,
      runtimeScheduling:false,
      summaryAuthority:false,
      summaryContextSeal:false,
      evidenceMappingAuthority:false,
      uiReadMutationAuthority:false,
      uiReadModelVersion:MEMORY_UI_READ_MODEL_VERSION,
      consolidationWorkVersion:MEMORY_CONSOLIDATION_WORK_VERSION,
      evidenceBridgeApiVersion:MEMORY_EVIDENCE_BRIDGE_API_VERSION,
    },
  };
}

export function createMemoryIntegrationFixture(producer) {
  const api=producer.publicApi();
  const status=producer.status();
  return {
    kind:'MemoryIntegrationFixture',
    contractVersion:MEMORY_INTEGRATION_SURFACE_VERSION,
    api:deepClone(api),
    revisionRefs:[...status.revisionRefs],
    currentProjection:producer.currentProjection({includeStale:true}),
    unresolvedSets:producer.unresolvedSets(),
    greenRoomShadow:producer.greenRoomShadow(),
    historianStatus:deepClone(status.historian),
    summaryHierarchyStatus:deepClone(status.summaryHierarchy),
    hierarchyApiVersion:MEMORY_HIERARCHY_API_VERSION,
    evidenceBridgeStatus:deepClone(status.evidenceBridge),
    evidenceBridgeApiVersion:MEMORY_EVIDENCE_BRIDGE_API_VERSION,
    memoryUiReadModelVersion:MEMORY_UI_READ_MODEL_VERSION,
    consolidationWorkVersion:MEMORY_CONSOLIDATION_WORK_VERSION,
    ownership:deepClone(api.ownership),
    adapters:deepClone(api.adapters),
  };
}
