import {
  CORE_SETTLEMENT_COMPAT_VERSION,
  GREEN_ROOM_COMPAT_VERSION,
  HISTORIAN_COMPAT_VERSION,
  MEMORY_API_VERSION,
  MEMORY_CONTRACT_VERSION,
  MEMORY_HIERARCHY_API_VERSION,
  MEMORY_HIERARCHY_CONTRACT_VERSION,
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
    },
    adapters:{
      applyCoreSettlement:(envelope)=>producer.applySettlement(envelope),
      acceptSceneExperience:(proposal,options={})=>producer.ingestSceneExperience(proposal,options),
      acceptGreenRoomBatch:(batch,options={})=>producer.ingestGreenRoomBatch(batch,options),
      resolveHistorian:(request)=>producer.resolveHistorianMemoryRequest(request),
      queryHistorian:(request)=>producer.queryHistorian(request),
      drillDown:(nominationOrRecordRef)=>producer.drillDown(nominationOrRecordRef),
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
        status:'ADAPTER_REQUIRED_AT_ASSEMBLY_IF_SCENE_REFS_ARE_NOT_ALREADY_IN_MEMORY_EVIDENCE',
        behavior:'Memory admits reference-first SceneExperienceProposal records but withholds them from fresh Historian retrieval until every evidence/source revision resolves.',
      },
      {
        seam:'CORE_SETTLEMENT_EVIDENCE',
        status:'EXACT_EVIDENCE_REQUIRED',
        behavior:'Memory accepts canonical mutation only after the owner Settlement envelope refers to evidence/source revisions already admitted into Memory.',
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
        behavior:'Memory emits HistorianMemoryResolution v1.0.0 and CandidateNomination v1.0.0 compatible records, with resolution-aware summary nominations remaining navigation-only.',
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
    ownership:deepClone(api.ownership),
    adapters:deepClone(api.adapters),
  };
}
