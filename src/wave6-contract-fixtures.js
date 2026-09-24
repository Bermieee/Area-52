import {createPublicContractSnapshot} from './contract-drift-detector.js';
import {createAcceptedCheckpointRecord} from './integration-control-plane.js';

export const Wave6CheckpointCatalog=Object.freeze({
  core:createAcceptedCheckpointRecord({
    lane:'CORE',branch:'Development-Nexus',
    branchHeadSha:'eabf052b95d67752236365252420286d6323791f',acceptedCheckpointSha:'eabf052b95d67752236365252420286d6323791f',
    acceptanceRun:'35964450102',acceptanceEvidenceRefs:['Cognitive Core CI:35964450102'],
  }),
  coprocessor:createAcceptedCheckpointRecord({
    lane:'COPROCESSOR',branch:'Development-Sidecar/Jev',
    branchHeadSha:'d9b195332671d802639e6f9e7174de74f23a4b1e',acceptedCheckpointSha:'d9b195332671d802639e6f9e7174de74f23a4b1e',
    acceptanceRun:'35963531808',acceptanceEvidenceRefs:['COPROCESSOR_WAVE4_ACCEPTANCE','Cognitive Coprocessor Wave 4:35963531808','historical implementation checkpoint:8eca22f0ae474a77914d8606148e433965aff205'],
    notes:'d9b1953 is the Director-accepted Wave 4 checkpoint; 8eca22f remains the historical green implementation checkpoint immediately beneath it',
  }),
  scene:createAcceptedCheckpointRecord({
    lane:'SCENE',branch:'Development-Scene-Scanner',
    branchHeadSha:'bee29f03de586e7f77728a5a1b6b50dbec0fdf8b',acceptedCheckpointSha:'5ad7567225720292d759d4a75afe84479deb6c1a',
    acceptanceRun:'35958003150',acceptanceEvidenceRefs:['Scene Intelligence Wave 1+2 validation:35958003150'],
    notes:'newer Wave 3 moving head is green but not promoted by Worker 1',
  }),
  runtime:createAcceptedCheckpointRecord({
    lane:'RUNTIME',branch:'Development-Worker-Director',
    branchHeadSha:'890f8576bcfcc4c056b959271027242dc6af7d7c',acceptedCheckpointSha:'890f8576bcfcc4c056b959271027242dc6af7d7c',
    acceptanceRun:'WAVE6_HANDOFF_ACCEPTED',acceptanceEvidenceRefs:['Wave 6 accepted cross-lane handoff'],
  }),
  ui:createAcceptedCheckpointRecord({
    lane:'UI',branch:'Development-UI',
    branchHeadSha:'14259dbd25601d2984846edd2d75b5ef4ec6a6d2',acceptedCheckpointSha:'14259dbd25601d2984846edd2d75b5ef4ec6a6d2',
    acceptanceRun:'WAVE6_HANDOFF_ACCEPTED',acceptanceEvidenceRefs:['Wave 6 accepted cross-lane handoff'],
  }),
  memory:createAcceptedCheckpointRecord({
    lane:'MEMORY',branch:'Development-Memory',
    branchHeadSha:'f3d2a4970fb159095b0bae12f5002d3ba2d2b598',acceptedCheckpointSha:'f3d2a4970fb159095b0bae12f5002d3ba2d2b598',
    acceptanceRun:'FOUNDATION_ONLY',acceptanceEvidenceRefs:['Wave 6 foundation observation'],accepted:false,
  }),
  lore:createAcceptedCheckpointRecord({
    lane:'LORE',branch:'Development-Lorebook-Editor',
    branchHeadSha:'f3d2a4970fb159095b0bae12f5002d3ba2d2b598',acceptedCheckpointSha:'f3d2a4970fb159095b0bae12f5002d3ba2d2b598',
    acceptanceRun:'FOUNDATION_ONLY',acceptanceEvidenceRefs:['Wave 6 foundation observation'],accepted:false,
  }),
});

const eventFields=['eventId','eventType','version','producer','causationId','correlationId','turnId','revisionFence','sequence','dedupeIdentity','payload'];
const precisionFields=['candidateId','score','reasonCodes','sourceRevisionRefs','truthStatus','authorityClass'];
const sceneAcceptedContracts=[
  {contractId:'SCENE_EVENT',version:'1.0.0',requiredFields:eventFields,optionalFields:['taskId','payloadSchemaVersion'],authorityRules:['NO_SETTLEMENT_AUTHORITY'],semantics:['DUPLICATE_IDEMPOTENT','SCENE_REVISION_FENCED']},
  {contractId:'CURRENT_SCENE',version:'1.0.0',requiredFields:['sceneId','revision','sourceRevisionRefs','fields','unresolvedFields'],optionalFields:['lifecycle','sourceRange','provenance'],authorityRules:['OBSERVATION_CLASS_PRESERVED'],semantics:['CURRENT_SCENE_SINGLE_ACTIVE']},
  {contractId:'ARTIFACT_REFERENCE',version:'1.0.0',requiredFields:['artifactId','artifactType','revision','owner','sourceRevisionSet'],optionalFields:['sceneRevision','contentHash','sliceSelector','expiry'],authorityRules:['REFERENCE_ONLY']},
];
const sceneMovingContracts=[...sceneAcceptedContracts,
  {contractId:'SCENE_INTEGRATION_SIGNAL',version:'1.0.0',requiredFields:['sceneId','sceneRevision','sourceRevisionRefs','activeCast','castObservations'],optionalFields:['location','narrativeTime','activeThreads','objects','sceneRelationship','diagnosticRefs'],authorityRules:['DESCRIPTIVE_ONLY','NO_RUNTIME_SCHEDULING_AUTHORITY','NO_CONTEXT_SEAL_BYPASS'],semantics:['MENTIONED_ONLY_NOT_ACTIVE']},
  {contractId:'SCENE_CONTEXT_INVALIDATION',version:'1.0.0',requiredFields:['invalidationId','fromSceneRef','toSceneRef','invalidatedScopes'],optionalFields:['resumedSceneRef','sourceRevisionRefs','reason'],authorityRules:['NO_CONTEXT_MUTATION_AUTHORITY'],semantics:['DELETE_EVIDENCE_FALSE']},
];

export const Wave6AcceptedContractSnapshots=Object.freeze({
  core:createPublicContractSnapshot({lane:'CORE',checkpoint:Wave6CheckpointCatalog.core.acceptedCheckpointSha,accepted:true,contracts:[
    {contractId:'COGNITIVE_EVENT',version:'1.0.0',requiredFields:eventFields,optionalFields:['taskId','payloadSchemaVersion'],authorityRules:['REGISTRY_ONLY'],semantics:['UNKNOWN_TYPED_FAILURE','DUPLICATE_IDEMPOTENT']},
    {contractId:'STRUCTURED_OUTPUT',version:'1.0.0',requiredFields:['parse','type','semantic','normalize','canonicalReady'],optionalFields:['retryable','fallbackEligible'],authorityRules:['PROVIDER_NEUTRAL'],semantics:['FAIL_BEFORE_CANONICAL_READY']},
    {contractId:'DEPENDENCY_STATE',version:'1.0.0',requiredFields:['required','optional','degraded','recovery','cycle'],authorityRules:['CAPABILITY_SEPARATE'],semantics:['OPTIONAL_CAN_DEGRADE','REQUIRED_BLOCKS']},
    {contractId:'KNOWLEDGE_EVIDENCE',version:'1.0.0',requiredFields:['sourceClass','authorityClass','temporalStatus','sourceRevisionRefs'],optionalFields:['dependencyRevisionRefs','provenanceRefs','candidateLineage'],authorityRules:['NO_AUTHORITY_ESCALATION'],semantics:['REVISION_FENCED']},
  ]}),
  coprocessor:createPublicContractSnapshot({lane:'COPROCESSOR',checkpoint:Wave6CheckpointCatalog.coprocessor.acceptedCheckpointSha,accepted:true,contracts:[
    {contractId:'PRECISION_PROVIDER_RESULT',version:'1.0.0',requiredFields:precisionFields,optionalFields:['stageSummary'],authorityRules:['PROVIDER_ID_NON_AUTHORITATIVE','PRECISION_CANNOT_CHANGE_AUTHORITY'],semantics:['UNKNOWN_CANDIDATE_REJECTED','HISTORICAL_NOT_PROMOTED']},
    {contractId:'CANDIDATE_BUS',version:'1.0.0',requiredFields:['candidateId','evidenceIdentity','sourceRevisionRefs'],optionalFields:['artifactRef','channels','rankSignals','sceneRelevance','authorityClass','truthStatus','provenance'],authorityRules:['RANKING_NOT_AUTHORITY'],semantics:['MULTI_CHANNEL_DEDUPE']},
    {contractId:'RUNTIME_OBLIGATION',version:'1.1.0',requiredFields:['taskId','requiredCapabilities','fallbackCapabilitySets','sourceRevisionIds','worldRevision','sceneRevision'],optionalFields:['resourceHints','deadlineBudget','yieldPolicy'],authorityRules:['SCHEDULING_DECISION_NULL','NO_AUTHORITY_GRANTED']},
  ]}),
  scene:createPublicContractSnapshot({lane:'SCENE',checkpoint:Wave6CheckpointCatalog.scene.acceptedCheckpointSha,accepted:true,contracts:sceneAcceptedContracts}),
  runtime:createPublicContractSnapshot({lane:'RUNTIME',checkpoint:Wave6CheckpointCatalog.runtime.acceptedCheckpointSha,accepted:true,contracts:[
    {contractId:'DEPENDENCY_GRAPH',version:'1.0.0',requiredFields:['serviceId','dependencies','available','degraded'],optionalFields:['metadata'],authorityRules:['CAPABILITY_SEPARATE'],semantics:['REQUIRED_BLOCKS','OPTIONAL_DEGRADES','CYCLE_REJECTED']},
    {contractId:'EVENT_REGISTRY',version:'1.0.0',requiredFields:['eventType','schemaVersion','producer','payloadSchema'],authorityRules:['DELIVERY_SEPARATE'],semantics:['EXTENSIBLE_REGISTRY','UNKNOWN_REJECTED','COMPATIBLE_MAJOR']},
    {contractId:'EVENT_SPINE',version:'1.0.0',requiredFields:['eventId','eventType','schemaVersion','producer','causationId','correlationId','revisionFences','dedupeKey','payload'],optionalFields:['turnId','taskId'],authorityRules:['NO_COGNITIVE_AUTHORITY'],semantics:['DEDUPE_IDEMPOTENT']},
  ]}),
  ui:createPublicContractSnapshot({lane:'UI',checkpoint:Wave6CheckpointCatalog.ui.acceptedCheckpointSha,accepted:true,contracts:[
    {contractId:'CORE_READ_MODEL',version:'1.0.0',requiredFields:['modelId','version','revisionIdentity','health','mutationAuthority'],optionalFields:['authority','freshness'],authorityRules:['READ_ONLY'],semantics:['STALE_DETECTABLE']},
  ]}),
});

export const Wave6MovingContractSnapshots=Object.freeze({
  core:createPublicContractSnapshot({...Wave6AcceptedContractSnapshots.core,checkpoint:Wave6CheckpointCatalog.core.branchHeadSha,accepted:false}),
  coprocessor:createPublicContractSnapshot({...Wave6AcceptedContractSnapshots.coprocessor,checkpoint:Wave6CheckpointCatalog.coprocessor.branchHeadSha,accepted:false}),
  scene:createPublicContractSnapshot({lane:'SCENE',checkpoint:Wave6CheckpointCatalog.scene.branchHeadSha,accepted:false,contracts:sceneMovingContracts}),
  runtime:createPublicContractSnapshot({...Wave6AcceptedContractSnapshots.runtime,checkpoint:Wave6CheckpointCatalog.runtime.branchHeadSha,accepted:false}),
  ui:createPublicContractSnapshot({...Wave6AcceptedContractSnapshots.ui,checkpoint:Wave6CheckpointCatalog.ui.branchHeadSha,accepted:false}),
});
