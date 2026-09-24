import {createContractDeclaration,IntegrationContractFamily as F} from './integration-contract-matrix.js';
const C=(family,{version='1.0.0',features=[],requiredFeatures=[],adapterRequired=false,liveAccepted=true,notes=null}={})=>({family,version,features,requiredFeatures,adapterRequired,liveAccepted,notes});

export function createPhase1ContractDeclarations({
  coreCheckpoint='eabf052b95d67752236365252420286d6323791f',
  sceneCheckpoint='5ad7567225720292d759d4a75afe84479deb6c1a',sceneAccepted=true,
  coprocessorCheckpoint='8eca22f0ae474a77914d8606148e433965aff205',
  runtimeCheckpoint='890f8576bcfcc4c056b959271027242dc6af7d7c',
  uiCheckpoint='14259dbd25601d2984846edd2d75b5ef4ec6a6d2',
  memoryCheckpoint='f3d2a4970fb159095b0bae12f5002d3ba2d2b598',
  loreCheckpoint='f3d2a4970fb159095b0bae12f5002d3ba2d2b598',
}={}){
  const eventFeatures=['eventId','eventType','version','producer','correlationId','causationId','turnId','revisionFence','dedupeIdentity','payload'];
  const revision=['sourceRevision','worldRevision','sceneRevision'];
  const identity=['turnId','correlationId','causationId'];

  const core=createContractDeclaration({lane:'Development-Nexus',checkpoint:coreCheckpoint,accepted:true,contracts:[
    C(F.ARTIFACT_REFERENCE,{features:['artifactId','artifactType','revision','owner','provenance','sourceRevision']}),
    C(F.COGNITIVE_EVENT,{features:eventFeatures,requiredFeatures:eventFeatures}),
    C(F.REVISION_FENCES,{features:revision,requiredFeatures:revision}),
    C(F.IDENTITY,{features:identity,requiredFeatures:identity}),
    C(F.RESULT_BUS,{features:['freshness','lateRouting','destination','authorityNeutral'],liveAccepted:false}),
    C(F.STRUCTURED_OUTPUT,{features:['parse','type','semantic','normalize','canonicalReady','retryable','fallbackEligible'],liveAccepted:false}),
    C(F.DEPENDENCY_STATE,{features:['required','optional','degraded','recovery','cycle'],liveAccepted:false}),
    C(F.CONTEXT_SEAL,{features:['immutable','admittedResults','staleResults','revisionFence'],liveAccepted:false}),
    C(F.PROMPT_PLAN,{features:['promptPlanId','contextSealId','generationId','turnId','revisionIdentity']}),
    C(F.DIAGNOSTIC_FORENSIC,{features:['transactions','forensicRefs','whyQueries','readModels']}),
    C(F.KNOWLEDGE_EVIDENCE,{features:['sourceClass','authorityClass','temporalStatus','sourceRevisionRefs','dependencyRevisionRefs','provenanceRefs','candidateLineage']}),
    C(F.CHECKPOINT_PROVENANCE,{features:['acceptedCheckpoint','branchHead','acceptanceEvidence','originReceipt']}),
  ]});

  const scene=createContractDeclaration({lane:'Development-Scene-Scanner',checkpoint:sceneCheckpoint,accepted:sceneAccepted,contracts:[
    C(F.ARTIFACT_REFERENCE,{features:['artifactId','artifactType','revision','owner','provenance','sourceRevision']}),
    C(F.COGNITIVE_EVENT,{features:eventFeatures,requiredFeatures:eventFeatures,adapterRequired:true,liveAccepted:false}),
    C(F.REVISION_FENCES,{features:revision,requiredFeatures:revision}),
    C(F.IDENTITY,{features:identity,requiredFeatures:identity}),
    C(F.RESULT_BUS,{features:['sceneSignal'],adapterRequired:true,liveAccepted:false}),
    C(F.CONTEXT_SEAL,{features:['sceneRevision','sourceRevision'],adapterRequired:true,liveAccepted:false}),
    C(F.DIAGNOSTIC_FORENSIC,{features:['sceneWhyRefs'],adapterRequired:true,liveAccepted:false}),
    C(F.KNOWLEDGE_EVIDENCE,{features:['observationClass','sourceRevisionRefs','sceneRevision'],adapterRequired:true,liveAccepted:false}),
    C(F.CHECKPOINT_PROVENANCE,{features:['acceptedCheckpoint','sourcePath','sourceDigest'],adapterRequired:true,liveAccepted:false}),
  ]});

  const coprocessor=createContractDeclaration({lane:'Development-Sidecar/Jev',checkpoint:coprocessorCheckpoint,accepted:true,contracts:[
    C(F.ARTIFACT_REFERENCE,{features:['artifactId','artifactType','revision','owner','provenance','sourceRevision']}),
    C(F.COGNITIVE_EVENT,{features:eventFeatures,requiredFeatures:eventFeatures,adapterRequired:true,liveAccepted:false}),
    C(F.REVISION_FENCES,{features:revision,requiredFeatures:revision}),
    C(F.IDENTITY,{features:identity,requiredFeatures:identity}),
    C(F.RESULT_BUS,{features:['freshness','destination','authorityNeutral'],liveAccepted:false}),
    C(F.STRUCTURED_OUTPUT,{features:['parse','type','semantic','normalize','canonicalReady','providerNeutral'],liveAccepted:false}),
    C(F.DEPENDENCY_STATE,{features:['capabilityDiscovery','fallbackCapabilitySets'],adapterRequired:true,liveAccepted:false}),
    C(F.CONTEXT_SEAL,{features:['postSealNextTurn','revisionFence'],liveAccepted:false}),
    C(F.DIAGNOSTIC_FORENSIC,{features:['telemetryRefs','qualificationStates'],adapterRequired:true,liveAccepted:false}),
    C(F.KNOWLEDGE_EVIDENCE,{features:['candidateId','evidenceIdentity','sourceRevisionRefs','authorityClass','truthStatus','provenance'],adapterRequired:true,liveAccepted:false}),
    C(F.CHECKPOINT_PROVENANCE,{features:['acceptedCheckpoint','acceptanceRun','sourceDigest'],adapterRequired:true,liveAccepted:false}),
  ]});

  const runtime=createContractDeclaration({lane:'Development-Worker-Director',checkpoint:runtimeCheckpoint,accepted:true,contracts:[
    C(F.COGNITIVE_EVENT,{features:eventFeatures,requiredFeatures:eventFeatures,adapterRequired:true,liveAccepted:false}),
    C(F.REVISION_FENCES,{features:revision,requiredFeatures:revision}),
    C(F.IDENTITY,{features:identity,requiredFeatures:identity}),
    C(F.RESULT_BUS,{features:['executionReceipt'],adapterRequired:true,liveAccepted:false}),
    C(F.DEPENDENCY_STATE,{features:['required','optional','degraded','recovery','cycle'],liveAccepted:false}),
    C(F.DIAGNOSTIC_FORENSIC,{features:['workLedger','runtimeTelemetry'],adapterRequired:true,liveAccepted:false}),
    C(F.CHECKPOINT_PROVENANCE,{features:['acceptedCheckpoint','serviceDependencyState'],adapterRequired:true,liveAccepted:false}),
  ]});

  const ui=createContractDeclaration({lane:'Development-UI',checkpoint:uiCheckpoint,accepted:true,contracts:[
    C(F.REVISION_FENCES,{features:revision,requiredFeatures:revision,adapterRequired:true,liveAccepted:false}),
    C(F.IDENTITY,{features:identity,requiredFeatures:identity,adapterRequired:true,liveAccepted:false}),
    C(F.CONTEXT_SEAL,{features:['contextSealId','revisionFence'],adapterRequired:true,liveAccepted:false}),
    C(F.PROMPT_PLAN,{features:['promptPlanId','contextSealId','generationId','turnId','revisionIdentity'],adapterRequired:true,liveAccepted:false}),
    C(F.DIAGNOSTIC_FORENSIC,{features:['transactions','forensicRefs','whyQueries','readModels'],adapterRequired:true,liveAccepted:false}),
    C(F.KNOWLEDGE_EVIDENCE,{features:['KnowledgeTraceReadModel'],adapterRequired:true,liveAccepted:false}),
    C(F.CHECKPOINT_PROVENANCE,{features:['revisionIdentity'],adapterRequired:true,liveAccepted:false}),
  ]});

  const memory=createContractDeclaration({lane:'Development-Memory',checkpoint:memoryCheckpoint,accepted:false,contracts:[
    C(F.REVISION_FENCES,{features:revision,requiredFeatures:revision,liveAccepted:false}),
    C(F.KNOWLEDGE_EVIDENCE,{features:['experienceRef','authorityClass','temporalStatus','sourceRevisionRefs','provenanceRefs'],liveAccepted:false}),
    C(F.CHECKPOINT_PROVENANCE,{features:['acceptedCheckpoint'],liveAccepted:false}),
  ]});

  const lore=createContractDeclaration({lane:'Development-Lorebook-Editor',checkpoint:loreCheckpoint,accepted:false,contracts:[
    C(F.REVISION_FENCES,{features:revision,requiredFeatures:revision,liveAccepted:false}),
    C(F.KNOWLEDGE_EVIDENCE,{features:['exactSourceRef','authorityClass','temporalStatus','sourceRevisionRefs','provenanceRefs'],liveAccepted:false}),
    C(F.CHECKPOINT_PROVENANCE,{features:['acceptedCheckpoint'],liveAccepted:false}),
  ]});

  return{core,scene,coprocessor,runtime,ui,memory,lore};
}

export const RepresentativePhase1EventTypes=Object.freeze([
  'TURN_EVENT','SCENE_STATE_DELTA','LOCATION_CHANGED','ACTIVE_CAST_CHANGED','SCENE_OPENED','SCENE_CLOSED',
  'PREFETCH_RECOMMENDED','WORK_RESULT','KNOWLEDGE_INVALIDATED','CONTEXT_SEALED',
]);
