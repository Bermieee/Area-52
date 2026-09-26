import {array,enumSet,freeze,normalizeNamedList,oneOf,req,serial,strings} from './framework-utils.js';

export const FrameworkContractVersion='1.0.0';
export const SubsystemLifecycle=freeze({EXPERIMENTAL:'EXPERIMENTAL',SHADOW:'SHADOW',ACTIVE:'ACTIVE',DEPRECATED:'DEPRECATED'});
export const DependencyKind=freeze({REQUIRED:'REQUIRED',OPTIONAL:'OPTIONAL'});
export const CompatibilityStatus=freeze({
  EXACT:'EXACT',COMPATIBLE:'COMPATIBLE',DEPRECATED:'DEPRECATED',MIGRATION_REQUIRED:'MIGRATION_REQUIRED',
  INCOMPATIBLE:'INCOMPATIBLE',UNSUPPORTED_FUTURE:'UNSUPPORTED_FUTURE',INVALID_VERSION:'INVALID_VERSION',
});
export const AuthorityPermission=freeze({
  PROPOSE_CANONICAL_MUTATION:'PROPOSE_CANONICAL_MUTATION',AFFECT_FOREGROUND:'AFFECT_FOREGROUND',
  EMIT_EVALUATION:'EMIT_EVALUATION',READ_CANONICAL:'READ_CANONICAL',READ_LIVE_EVIDENCE:'READ_LIVE_EVIDENCE',
});
export const AssemblyState=freeze({EXACT:'EXACT',INTEGRATION_PATCHED:'INTEGRATION_PATCHED',STALE_COPY:'STALE_COPY',MISSING:'MISSING',UNEXPECTED_DRIFT:'UNEXPECTED_DRIFT'});
export const FrameworkFailureCode=freeze({
  MALFORMED_MANIFEST:'MALFORMED_MANIFEST',DUPLICATE_SERVICE:'DUPLICATE_SERVICE',INCOMPATIBLE_CONTRACT:'INCOMPATIBLE_CONTRACT',
  UNDECLARED_AUTHORITY:'UNDECLARED_AUTHORITY',UNKNOWN_ARTIFACT_TYPE:'UNKNOWN_ARTIFACT_TYPE',ARTIFACT_VERSION_INCOMPATIBLE:'ARTIFACT_VERSION_INCOMPATIBLE',
  ARTIFACT_PAYLOAD_INVALID:'ARTIFACT_PAYLOAD_INVALID',EVENT_TYPE_UNKNOWN:'EVENT_TYPE_UNKNOWN',EVENT_VERSION_INCOMPATIBLE:'EVENT_VERSION_INCOMPATIBLE',
  DEPENDENCY_REQUIRED_MISSING:'DEPENDENCY_REQUIRED_MISSING',DEPENDENCY_CYCLE:'DEPENDENCY_CYCLE',LIFECYCLE_TRANSITION_INVALID:'LIFECYCLE_TRANSITION_INVALID',
  LIFECYCLE_AUTHORITY_BLOCKED:'LIFECYCLE_AUTHORITY_BLOCKED',CERTIFICATION_REQUIRED:'CERTIFICATION_REQUIRED',SETTLEMENT_REQUIRED:'SETTLEMENT_REQUIRED',
  CONTEXT_SEAL_REQUIRED:'CONTEXT_SEAL_REQUIRED',MISSING_PROVENANCE:'MISSING_PROVENANCE',STALE_RESULT:'STALE_RESULT',
  MIGRATION_MISSING:'MIGRATION_MISSING',MIGRATION_OUTPUT_INVALID:'MIGRATION_OUTPUT_INVALID',MIGRATION_PROTECTED_FIELD_CHANGED:'MIGRATION_PROTECTED_FIELD_CHANGED',
});
const LIFE=enumSet(SubsystemLifecycle), AUTHORITY_PERMISSION=enumSet(AuthorityPermission);

export function createSubsystemManifest({
  subsystemId,version,contractVersion=FrameworkContractVersion,owner,lifecycleState=SubsystemLifecycle.EXPERIMENTAL,
  consumedEvents=[],producedEvents=[],consumedArtifactTypes=[],producedArtifactTypes=[],providedCapabilities=[],requiredCapabilities=[],optionalCapabilities=[],
  requiredDependencies=[],optionalDependencies=[],authorityPermissions=[],runtimeRequirements={},invalidationRules=[],repositoryRequirements=[],
  uiContributions=[],evaluationRequirements=[],failureBehavior={},compatibility={},diagnostics={},metadata={},
}){
  return{
    kind:'SubsystemManifest',subsystemId:req(subsystemId,'SubsystemManifest.subsystemId'),version:req(version,'SubsystemManifest.version'),
    contractVersion:req(contractVersion,'SubsystemManifest.contractVersion'),owner:req(owner,'SubsystemManifest.owner'),
    lifecycleState:oneOf(lifecycleState,LIFE,'SubsystemManifest.lifecycleState'),
    consumedEvents:normalizeNamedList(consumedEvents,'SubsystemManifest.consumedEvents'),producedEvents:normalizeNamedList(producedEvents,'SubsystemManifest.producedEvents'),
    consumedArtifactTypes:normalizeNamedList(consumedArtifactTypes,'SubsystemManifest.consumedArtifactTypes'),producedArtifactTypes:normalizeNamedList(producedArtifactTypes,'SubsystemManifest.producedArtifactTypes'),
    providedCapabilities:strings(providedCapabilities,'SubsystemManifest.providedCapabilities'),requiredCapabilities:strings(requiredCapabilities,'SubsystemManifest.requiredCapabilities'),
    optionalCapabilities:strings(optionalCapabilities,'SubsystemManifest.optionalCapabilities'),requiredDependencies:normalizeNamedList(requiredDependencies,'SubsystemManifest.requiredDependencies'),
    optionalDependencies:normalizeNamedList(optionalDependencies,'SubsystemManifest.optionalDependencies'),authorityPermissions:strings(authorityPermissions,'SubsystemManifest.authorityPermissions').map(v=>oneOf(v,AUTHORITY_PERMISSION,'SubsystemManifest.authorityPermissions')),
    runtimeRequirements:serial(runtimeRequirements,'SubsystemManifest.runtimeRequirements'),invalidationRules:array(invalidationRules,'SubsystemManifest.invalidationRules'),
    repositoryRequirements:normalizeNamedList(repositoryRequirements,'SubsystemManifest.repositoryRequirements'),uiContributions:array(uiContributions,'SubsystemManifest.uiContributions'),
    evaluationRequirements:array(evaluationRequirements,'SubsystemManifest.evaluationRequirements'),failureBehavior:serial(failureBehavior,'SubsystemManifest.failureBehavior'),
    compatibility:serial(compatibility,'SubsystemManifest.compatibility'),diagnostics:serial(diagnostics,'SubsystemManifest.diagnostics'),metadata:serial(metadata,'SubsystemManifest.metadata'),
  };
}

export function createArtifactEnvelope({
  artifactId,artifactType,schemaVersion='1.0.0',owner,authority='UNRESOLVED',provenance,revision=1,dependencies=[],invalidators=[],status='VALID',payload,
}){
  if(!Number.isInteger(Number(revision))||Number(revision)<0)throw new TypeError('ArtifactEnvelope.revision must be a non-negative integer');
  if(!provenance||typeof provenance!=='object')throw new TypeError('ArtifactEnvelope.provenance is required');
  return{
    kind:'ArtifactEnvelope',artifactId:req(artifactId,'ArtifactEnvelope.artifactId'),artifactType:req(artifactType,'ArtifactEnvelope.artifactType'),
    schemaVersion:req(schemaVersion,'ArtifactEnvelope.schemaVersion'),owner:req(owner,'ArtifactEnvelope.owner'),authority:req(authority,'ArtifactEnvelope.authority'),
    provenance:serial(provenance,'ArtifactEnvelope.provenance'),revision:Number(revision),dependencies:strings(dependencies,'ArtifactEnvelope.dependencies'),
    invalidators:strings(invalidators,'ArtifactEnvelope.invalidators'),status:req(status,'ArtifactEnvelope.status'),payload:serial(payload,'ArtifactEnvelope.payload'),
  };
}

export function createCognitiveEventEnvelope({
  eventId,eventType,eventVersion='1.0.0',producer,causationId=null,correlationId,turnId=null,taskId=null,sourceRevisionSet=[],worldRevision=null,
  sceneRevision=null,sequence=0,time=0,dedupeIdentity=eventId,payload,payloadSchemaVersion='1.0.0',
}){
  if(causationId!==null)req(causationId,'CognitiveEventEnvelope.causationId');
  if(turnId!==null)req(turnId,'CognitiveEventEnvelope.turnId');if(taskId!==null)req(taskId,'CognitiveEventEnvelope.taskId');
  return{
    kind:'CognitiveEventEnvelope',eventId:req(eventId,'CognitiveEventEnvelope.eventId'),eventType:req(eventType,'CognitiveEventEnvelope.eventType'),
    eventVersion:req(eventVersion,'CognitiveEventEnvelope.eventVersion'),producer:req(producer,'CognitiveEventEnvelope.producer'),causationId,correlationId:req(correlationId,'CognitiveEventEnvelope.correlationId'),
    turnId,taskId,sourceRevisionSet:strings(sourceRevisionSet,'CognitiveEventEnvelope.sourceRevisionSet'),worldRevision:worldRevision===null?null:Number(worldRevision),
    sceneRevision:sceneRevision===null?null:Number(sceneRevision),sequence:Number(sequence),time:Number(time),dedupeIdentity:req(dedupeIdentity,'CognitiveEventEnvelope.dedupeIdentity'),
    payload:serial(payload,'CognitiveEventEnvelope.payload'),payloadSchemaVersion:req(payloadSchemaVersion,'CognitiveEventEnvelope.payloadSchemaVersion'),
  };
}
