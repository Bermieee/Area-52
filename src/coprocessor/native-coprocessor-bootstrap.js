import { Capability, Placement, ResultClass, ResultDestination } from './constants.js';
import { CapabilityProfileRegistry } from './capability-profiles.js';
import { ProviderAdapterRegistry } from './provider-adapters.js';
import { createCognitiveTask, createRevisionSet, deepFreeze } from './contracts.js';
import { negotiateCapabilities } from './capability-negotiation.js';
import { classifyFreshness } from './validation.js';

export const NATIVE_COPROCESSOR_CONTRACT_VERSION = '11.0.0';
export const NativeSlotKind = Object.freeze({ JEV: 'JEV', SIDECAR: 'SIDECAR' });
export const NativeDegradedReason = Object.freeze({
  OPTIONAL_NOT_CONFIGURED:'OPTIONAL_NOT_CONFIGURED', ADAPTER_NOT_ATTACHED:'ADAPTER_NOT_ATTACHED', SLOT_DISABLED:'SLOT_DISABLED',
  SLOT_UNAVAILABLE:'SLOT_UNAVAILABLE', CAPABILITY_INCOMPATIBLE:'CAPABILITY_INCOMPATIBLE', DEADLINE_EXPIRED:'DEADLINE_EXPIRED',
  STALE_RESULT:'STALE_RESULT', CONTEXT_SEALED:'CONTEXT_SEALED', MALFORMED_PROPOSAL:'MALFORMED_PROPOSAL', AMBIGUOUS_NATIVE_RESULT:'AMBIGUOUS_NATIVE_RESULT',
});
const NATIVE_PROFILE_ID='area52-native-deterministic';
const NATIVE_PROVIDER_ID='area52-native';
const NATIVE_CAPABILITIES=Object.freeze([Capability.STRUCTURED_EXTRACTION,Capability.FAST_CLASSIFICATION,Capability.CHANGE_CLASSIFICATION]);

export function createNativeCoprocessorServices({ optionalSlots=[] }={}) {
  if(!Array.isArray(optionalSlots)) throw new TypeError('optionalSlots must be an array');
  const profiles=new CapabilityProfileRegistry(), adapters=new ProviderAdapterRegistry();
  profiles.register({profileId:NATIVE_PROFILE_ID,workerId:'area52-native',providerId:NATIVE_PROVIDER_ID,modelId:null,capabilities:NATIVE_CAPABILITIES,
    local:true,costClass:'FREE',latencyClass:'ULTRA_LOW',structuredOutput:true,foregroundEligible:true,backgroundEligible:true,maxConcurrency:1});
  const optional=[];
  for(const raw of optionalSlots){
    const slot=normalizeOptionalSlot(raw);let status='UNAVAILABLE',reason=null;
    if(!slot.enabled){reason=NativeDegradedReason.SLOT_DISABLED;}
    else if(!slot.available){reason=NativeDegradedReason.SLOT_UNAVAILABLE;}
    else if(!slot.adapter){reason=NativeDegradedReason.ADAPTER_NOT_ATTACHED;}
    else{
      profiles.register({profileId:slot.profileId,workerId:slot.slotId,providerId:slot.providerId,modelId:slot.modelId,capabilities:slot.capabilities,
        local:slot.local,costClass:slot.costClass,latencyClass:slot.latencyClass,structuredOutput:slot.structuredOutput,foregroundEligible:slot.foregroundEligible,
        backgroundEligible:slot.backgroundEligible,maxConcurrency:slot.maxConcurrency,currentLoad:slot.currentLoad,health:slot.health,available:true,
        supportedLayers:slot.supportedLayers,placements:slot.placements,maxContextTokens:slot.maxContextTokens,maxOutputTokens:slot.maxOutputTokens});
      adapters.register(slot.adapter);status=slot.health==='DEGRADED'?'DEGRADED':'AVAILABLE';reason=slot.health==='DEGRADED'?'PROVIDER_DEGRADED':null;
    }
    optional.push(deepFreeze({...slot,adapter:undefined,status,reason}));
  }
  const inventory=buildInventory(profiles,optional);
  return deepFreeze({kind:'Area52NativeCoprocessorServices',contractVersion:NATIVE_COPROCESSOR_CONTRACT_VERSION,profiles,adapters,inventory,
    networkRequired:false,externalPluginRequired:false,databaseRequired:false,orchestrationServiceRequired:false});
}

export function createNativeTurnTask({turnId='turn:native',correlationId=`corr:${turnId}`,taskId=`task:${turnId}`,softDeadline=50,hardDeadline=75,
  sourceRevisionSet=['native:source'],worldRevision=0,sceneRevision=0,characterStateRevision=0}={}){
  return createCognitiveTask({taskId,taskType:'NATIVE_BOUNDED_TURN',turnId,correlationId,requiredCapabilities:[Capability.FAST_CLASSIFICATION],cognitiveLayer:'L1',
    resultClass:ResultClass.REQUIRED,placement:Placement.HOT,softDeadline,hardDeadline,inputRevisionSet:{sourceRevisionSet,worldRevision,sceneRevision,characterStateRevision},
    outputSchema:{type:'object'},fallbackPolicy:{type:'DETERMINISTIC',maxRetries:0},metadata:{resourceClass:'NATIVE',latencyClass:'ULTRA_LOW',requireStructuredOutput:true}});
}

export function executeNativeTurn({task=createNativeTurnTask(),candidates=[],hardRejectedOptionIds=[],sealed=false,currentRevisionState=null}={}){
  const started=monotonicNow();
  if(!Array.isArray(candidates)||!Array.isArray(hardRejectedOptionIds))throw new TypeError('candidates and hardRejectedOptionIds must be arrays');
  const current=createRevisionSet(currentRevisionState??task.inputRevisionSet);const freshness=classifyFreshness(task.inputRevisionSet,current);
  if(freshness!=='FRESH')return nativeResult(task,{outcome:'UNRESOLVED',reason:NativeDegradedReason.STALE_RESULT,freshness,started,sealed});
  const rejected=new Set(hardRejectedOptionIds);const viable=candidates.filter(x=>x&&typeof x.optionId==='string'&&x.available!==false&&!x.stale&&!rejected.has(x.optionId));
  if(viable.length===1)return nativeResult(task,{outcome:'DECIDED',selectedOptionIds:[viable[0].optionId],evidenceUsed:[...(viable[0].evidenceRefs??[])],reason:'ONLY_ONE_VALID_OPTION',freshness,started,sealed});
  if(viable.length===0)return nativeResult(task,{outcome:'UNRESOLVED',reason:'NO_SAFE_DECISION',freshness,started,sealed});
  return nativeResult(task,{outcome:'UNRESOLVED',reason:NativeDegradedReason.AMBIGUOUS_NATIVE_RESULT,freshness,started,sealed,optionalCapabilitySuggested:Capability.SEMANTIC_JUDGMENT});
}

export function createOptionalCapabilityTask({taskId,turnId,correlationId,capability=Capability.SEMANTIC_JUDGMENT,placement=Placement.HOT,resultClass=ResultClass.OPPORTUNISTIC,
  cognitiveLayer='L1',softDeadline,hardDeadline,inputRevisionSet,resourceClass='STANDARD',latencyClass='LOW',requireStructuredOutput=true,expectedOutputTokens=700}={}){
  return createCognitiveTask({taskId,taskType:'OPTIONAL_COGNITIVE_PROPOSAL',turnId,correlationId,requiredCapabilities:[capability],cognitiveLayer,resultClass,placement,
    softDeadline,hardDeadline,inputRevisionSet,outputSchema:{type:'object'},fallbackPolicy:{type:'DETERMINISTIC',maxRetries:0},
    metadata:{resourceClass,latencyClass,requireStructuredOutput,expectedOutputTokens,backgroundEligible:placement===Placement.DEEP}});
}

export function evaluateOptionalCapability(services,task,{maxLatencyClass=null,maxLatencyMs=null,resourceClass=null,preferLocal=false}={}){
  if(services?.kind!=='Area52NativeCoprocessorServices')throw new TypeError('Area52NativeCoprocessorServices is required');
  const negotiation=negotiateCapabilities(services.profiles,task,{maxLatencyClass,maxLatencyMs,resourceClass,preferLocal,requireStructuredOutput:task.metadata?.requireStructuredOutput!==false});
  const optionalEligible=negotiation.eligibleImplementations.filter(x=>x.profileId!==NATIVE_PROFILE_ID);
  const noOptional=services.inventory.optional.length===0;const constrained=negotiation.missingCapabilities.length||negotiation.constraintFailures.length||negotiation.incompatibilities.length;const reason=optionalEligible.length?null:(noOptional?NativeDegradedReason.OPTIONAL_NOT_CONFIGURED:constrained?NativeDegradedReason.CAPABILITY_INCOMPATIBLE:NativeDegradedReason.OPTIONAL_NOT_CONFIGURED);
  return deepFreeze({kind:'Area52OptionalCapabilityEligibility',contractVersion:NATIVE_COPROCESSOR_CONTRACT_VERSION,taskId:task.taskId,status:optionalEligible.length?'ELIGIBLE':'DEGRADED',
    eligible:optionalEligible,reason,negotiation,authorityGranted:false,schedulingDecision:null});
}

export function admitOptionalProposal({task,proposal,currentRevisionState,sealed=false,now=null}={}){
  if(!task||!proposal||typeof proposal!=='object')return degradedAdmission(NativeDegradedReason.MALFORMED_PROPOSAL,sealed);
  const time=now==null?Date.now():Number(now);if(Number.isFinite(task.hardDeadline)&&time>task.hardDeadline)return degradedAdmission(NativeDegradedReason.DEADLINE_EXPIRED,sealed);
  const freshness=classifyFreshness(task.inputRevisionSet,createRevisionSet(currentRevisionState??task.inputRevisionSet));
  if(freshness!=='FRESH')return degradedAdmission(NativeDegradedReason.STALE_RESULT,sealed,freshness);
  if(sealed)return degradedAdmission(NativeDegradedReason.CONTEXT_SEALED,true,freshness);
  return deepFreeze({kind:'Area52OptionalProposalAdmission',contractVersion:NATIVE_COPROCESSOR_CONTRACT_VERSION,accepted:true,foregroundEligible:true,destination:ResultDestination.FOREGROUND,
    degradedReason:null,freshness,authorityGranted:false,canonicalMutation:false,settlementPerformed:false});
}

export function createAssemblySeam({task,services,nativeResult:result=null,proposal=null,jevReceipt=null,sealed=false,degradedReason=null,telemetry={}}={}){
  return deepFreeze({kind:'Area52CoprocessorAssemblySeam',contractVersion:NATIVE_COPROCESSOR_CONTRACT_VERSION,taskRequest:task??null,capabilityInventory:services?.inventory??null,
    nativeResult:result,optionalProposal:proposal,jevReceipt,contextSeal:{sealed:Boolean(sealed),foregroundEligible:!sealed},degradedReason,
    revisionFence:task?.inputRevisionSet??null,telemetry:structuredClone(telemetry),authority:{proposalOnly:true,ownerSettlementRequired:true,canonicalMutation:false},
    runtimeDirectorInstantiated:false,candidateBusInstantiated:false,truthGateInstantiated:false,ownerSettlementInstantiated:false});
}

function normalizeOptionalSlot(raw={}){
  if(![NativeSlotKind.JEV,NativeSlotKind.SIDECAR].includes(raw.kind))throw new TypeError('optional slot kind must be JEV or SIDECAR');
  if(typeof raw.slotId!=='string'||!raw.slotId)throw new TypeError('optional slotId is required');if(typeof raw.profileId!=='string'||!raw.profileId)throw new TypeError('optional profileId is required');
  if(typeof raw.providerId!=='string'||!raw.providerId)throw new TypeError('optional providerId is required');if(!Array.isArray(raw.capabilities)||!raw.capabilities.length)throw new TypeError('optional capabilities are required');
  if(raw.adapter&&raw.adapter.providerId!==raw.providerId)throw new TypeError('optional adapter providerId must match slot providerId');
  return {kind:raw.kind,slotId:raw.slotId,profileId:raw.profileId,providerId:raw.providerId,modelId:raw.modelId??null,capabilities:[...new Set(raw.capabilities)],adapter:raw.adapter??null,
    enabled:raw.enabled!==false,available:raw.available!==false,local:Boolean(raw.local),costClass:raw.costClass??'MEDIUM',latencyClass:raw.latencyClass??'MEDIUM',structuredOutput:raw.structuredOutput!==false,
    foregroundEligible:raw.foregroundEligible!==false,backgroundEligible:raw.backgroundEligible!==false,maxConcurrency:Math.max(1,Number(raw.maxConcurrency??1)),currentLoad:Math.max(0,Number(raw.currentLoad??0)),
    health:raw.health??'HEALTHY',supportedLayers:[...(raw.supportedLayers??['L0','L1','L2','L3','L4'])],placements:[...(raw.placements??[Placement.HOT,Placement.DEEP])],
    maxContextTokens:Number(raw.maxContextTokens??Number.MAX_SAFE_INTEGER),maxOutputTokens:Number(raw.maxOutputTokens??Number.MAX_SAFE_INTEGER)};
}
function buildInventory(profiles,optional){return deepFreeze({kind:'Area52CapabilityInventory',contractVersion:NATIVE_COPROCESSOR_CONTRACT_VERSION,native:{profileId:NATIVE_PROFILE_ID,providerId:NATIVE_PROVIDER_ID,status:'AVAILABLE',capabilities:[...NATIVE_CAPABILITIES],externalDependency:false},optional:optional.map(x=>({kind:x.kind,slotId:x.slotId,profileId:x.profileId,providerId:x.providerId,status:x.status,reason:x.reason,local:x.local,capabilities:[...x.capabilities]})),profileCount:profiles.list().length});}
function nativeResult(task,{outcome,selectedOptionIds=[],evidenceUsed=[],reason,freshness='FRESH',started,sealed=false,optionalCapabilitySuggested=null}){const late=Boolean(sealed);return deepFreeze({kind:'Area52NativeTurnResult',contractVersion:NATIVE_COPROCESSOR_CONTRACT_VERSION,taskId:task.taskId,outcome,selectedOptionIds,evidenceUsed,reasonCodes:[reason],freshness,
  optionalCapabilitySuggested,latencyMs:Math.max(0,monotonicNow()-started),degraded:outcome!=='DECIDED',foregroundEligible:!late,destination:late?ResultDestination.NEXT_TURN:ResultDestination.FOREGROUND,
  authorityGranted:false,canonicalMutation:false,settlementPerformed:false});}
function degradedAdmission(reason,sealed=false,freshness='FRESH'){return deepFreeze({kind:'Area52OptionalProposalAdmission',contractVersion:NATIVE_COPROCESSOR_CONTRACT_VERSION,accepted:false,foregroundEligible:false,
  destination:sealed?ResultDestination.NEXT_TURN:ResultDestination.DIAGNOSTIC_ONLY,degradedReason:reason,freshness,authorityGranted:false,canonicalMutation:false,settlementPerformed:false});}
function monotonicNow(){return globalThis.performance?.now?.()??Date.now();}