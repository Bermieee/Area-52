import {createContractDeclaration,IntegrationContractFamily as F} from './integration-contract-matrix.js';
const C=(family,{version='1.0.0',features=[],requiredFeatures=[],adapterRequired=false,liveAccepted=true,notes=null}={})=>({family,version,features,requiredFeatures,adapterRequired,liveAccepted,notes});
export function createPhase1ContractDeclarations({
 coreCheckpoint='aa3cb9d2bd447dc545df23468880dd1e26b7e23b',
 sceneCheckpoint='131bdaa1b3a9340b35e2b86519a0271e51d7125a',sceneAccepted=false,
 coprocessorCheckpoint='c51b35b0766d12616bfa357494988a37fb36deac',
 runtimeCheckpoint='890f8576bcfcc4c056b959271027242dc6af7d7c',
 uiCheckpoint='14259dbd25601d2984846edd2d75b5ef4ec6a6d2',
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
  ]});
  const scene=createContractDeclaration({lane:'Development-Scene-Scanner',checkpoint:sceneCheckpoint,accepted:sceneAccepted,contracts:[
    C(F.ARTIFACT_REFERENCE,{features:['artifactId','artifactType','revision','owner','provenance','sourceRevision']}),
    C(F.COGNITIVE_EVENT,{features:eventFeatures,requiredFeatures:eventFeatures}),
    C(F.REVISION_FENCES,{features:revision,requiredFeatures:revision}),
    C(F.IDENTITY,{features:identity,requiredFeatures:identity}),
    C(F.RESULT_BUS,{features:['sceneSignal'],adapterRequired:true,liveAccepted:false}),
    C(F.CONTEXT_SEAL,{features:['sceneRevision','sourceRevision'],adapterRequired:true,liveAccepted:false}),
    C(F.DIAGNOSTIC_FORENSIC,{features:['sceneWhyRefs'],adapterRequired:true,liveAccepted:false}),
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
  ]});
  const runtime=createContractDeclaration({lane:'Development-Worker-Director',checkpoint:runtimeCheckpoint,accepted:true,contracts:[
    C(F.COGNITIVE_EVENT,{features:['eventId','eventType','version','producer','correlationId','causationId','turnId','revisionFence','dedupeIdentity','payload'],requiredFeatures:eventFeatures,adapterRequired:true,liveAccepted:false}),
    C(F.REVISION_FENCES,{features:revision,requiredFeatures:revision}),
    C(F.IDENTITY,{features:identity,requiredFeatures:identity}),
    C(F.RESULT_BUS,{features:['executionReceipt'],adapterRequired:true,liveAccepted:false}),
    C(F.DEPENDENCY_STATE,{features:['required','optional','degraded','recovery'],liveAccepted:false}),
    C(F.DIAGNOSTIC_FORENSIC,{features:['workLedger','runtimeTelemetry'],adapterRequired:true,liveAccepted:false}),
  ]});
  const ui=createContractDeclaration({lane:'Development-UI',checkpoint:uiCheckpoint,accepted:true,contracts:[
    C(F.REVISION_FENCES,{features:revision,requiredFeatures:revision,adapterRequired:true,liveAccepted:false}),
    C(F.IDENTITY,{features:identity,requiredFeatures:identity,adapterRequired:true,liveAccepted:false}),
    C(F.CONTEXT_SEAL,{features:['contextSealId','revisionFence'],adapterRequired:true,liveAccepted:false}),
    C(F.PROMPT_PLAN,{features:['promptPlanId','contextSealId','generationId','turnId','revisionIdentity'],adapterRequired:true,liveAccepted:false}),
    C(F.DIAGNOSTIC_FORENSIC,{features:['transactions','forensicRefs','whyQueries','readModels'],adapterRequired:true,liveAccepted:false}),
  ]});
  return{core,scene,coprocessor,runtime,ui};
}
export const RepresentativePhase1EventTypes=Object.freeze(['TURN_EVENT','SCENE_STATE_DELTA','SCENE_OPENED','SCENE_CLOSED','PREFETCH_RECOMMENDED','WORK_RESULT','CONTEXT_SEALED']);
