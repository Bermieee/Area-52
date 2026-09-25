const clone=(value)=>value==null?value:structuredClone(value);
const req=(value,name)=>{if(typeof value!=='string'||!value.trim())throw new TypeError(name+' must be a non-empty string');return value.trim();};
const strings=(value,name)=>{if(!Array.isArray(value)||value.some(x=>typeof x!=='string'))throw new TypeError(name+' must be an array of strings');return[...new Set(value)].sort();};
const serial=(value,name)=>{try{JSON.stringify(value);}catch{throw new TypeError(name+' must be JSON-serializable');}return clone(value);};
const nonNegative=(value,name)=>{const n=Number(value);if(!Number.isFinite(n)||n<0)throw new TypeError(name+' must be non-negative');return n;};
const enumSet=(value)=>new Set(Object.values(value));
const one=(value,set,name)=>{if(!set.has(value))throw new TypeError(name+' has unsupported value: '+value);return value;};
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}return value;}
const frozen=(value)=>deepFreeze(clone(value));

export const COGNITIVE_CHOICE_CONTRACT_VERSION='1.0.0';

export const CognitiveChoicePath=Object.freeze({
  HOT_ONLY:'HOT_ONLY',
  STANDARD_RETRIEVAL:'STANDARD_RETRIEVAL',
  MIXED_CORRECTION:'MIXED_CORRECTION',
  LOW_ABSTAIN:'LOW_ABSTAIN',
  BOUNDED_AMBIGUITY:'BOUNDED_AMBIGUITY',
});

export const CognitiveJob=Object.freeze({
  HOT_CONTEXT:'HOT_CONTEXT',
  RETRIEVAL:'RETRIEVAL',
  HISTORIAN:'HISTORIAN',
  GRAPH_WALKER:'GRAPH_WALKER',
  GREEN_ROOM:'GREEN_ROOM',
  CORRECTIVE_RETRIEVAL:'CORRECTIVE_RETRIEVAL',
  TRUTH:'TRUTH',
  JEV:'JEV',
  PRECISION:'PRECISION',
  EXTERNAL_GROUNDING:'EXTERNAL_GROUNDING',
  GATHER:'GATHER',
  CONTEXT_COMPILER:'CONTEXT_COMPILER',
  CONTEXT_SEAL:'CONTEXT_SEAL',
  DEEP_COGNITION:'DEEP_COGNITION',
});

export const CognitiveReason=Object.freeze({
  HOT_SUFFICIENT:'HOT_SUFFICIENT',
  RETRIEVAL_REQUIRED:'RETRIEVAL_REQUIRED',
  LOW_EXPECTED_VALUE:'LOW_EXPECTED_VALUE',
  NO_ACTIVE_ENTITY:'NO_ACTIVE_ENTITY',
  CACHE_FRESH:'CACHE_FRESH',
  CACHE_STALE:'CACHE_STALE',
  CHANNEL_UNAVAILABLE:'CHANNEL_UNAVAILABLE',
  RETRIEVAL_HIGH:'RETRIEVAL_HIGH',
  RETRIEVAL_MIXED:'RETRIEVAL_MIXED',
  RETRIEVAL_LOW:'RETRIEVAL_LOW',
  CORRECTION_REQUIRED:'CORRECTION_REQUIRED',
  CORRECTION_LIMIT_REACHED:'CORRECTION_LIMIT_REACHED',
  TRUTH_UNRESOLVED:'TRUTH_UNRESOLVED',
  JEV_NOT_REQUIRED:'JEV_NOT_REQUIRED',
  JEV_REQUIRED:'JEV_REQUIRED',
  JEV_UNAVAILABLE:'JEV_UNAVAILABLE',
  JEV_ABSTAINED:'JEV_ABSTAINED',
  PRECISION_NOT_REQUIRED:'PRECISION_NOT_REQUIRED',
  PRECISION_REQUIRED:'PRECISION_REQUIRED',
  PRECISION_UNAVAILABLE:'PRECISION_UNAVAILABLE',
  PRECISION_FALLBACK:'PRECISION_FALLBACK',
  DEFER_BACKGROUND:'DEFER_BACKGROUND',
  SEAL_CLOSED:'SEAL_CLOSED',
  STALE_RESULT:'STALE_RESULT',
  INVALID_RESULT:'INVALID_RESULT',
  DUPLICATE_PUBLICATION:'DUPLICATE_PUBLICATION',
});

export const CognitiveDisposition=Object.freeze({
  ADMITTED:'ADMITTED',
  SKIPPED:'SKIPPED',
  DEFERRED:'DEFERRED',
});

export const CognitiveDeadlineClass=Object.freeze({
  FOREGROUND_REQUIRED:'FOREGROUND_REQUIRED',
  FOREGROUND_OPPORTUNISTIC:'FOREGROUND_OPPORTUNISTIC',
  DEFERRED:'DEFERRED',
});

export const CognitiveFreshnessRequirement=Object.freeze({
  TURN_CURRENT:'TURN_CURRENT',
  SCENE_CURRENT:'SCENE_CURRENT',
  WORLD_CURRENT:'WORLD_CURRENT',
  SOURCE_CURRENT:'SOURCE_CURRENT',
  PERSPECTIVE_ACCESSIBLE:'PERSPECTIVE_ACCESSIBLE',
  NONE:'NONE',
});

export const JevAction=Object.freeze({
  SKIP_JEV:'SKIP_JEV',
  INVOKE_JEV:'INVOKE_JEV',
  JEV_UNAVAILABLE:'JEV_UNAVAILABLE',
  JEV_ABSTAINED:'JEV_ABSTAINED',
  REQUEST_OPERATOR:'REQUEST_OPERATOR',
  PRESERVE_UNRESOLVED:'PRESERVE_UNRESOLVED',
});

const PATHS=enumSet(CognitiveChoicePath),JEV_ACTIONS=enumSet(JevAction),DISPOSITIONS=enumSet(CognitiveDisposition),DEADLINES=enumSet(CognitiveDeadlineClass),FRESHNESS=enumSet(CognitiveFreshnessRequirement);
const countShape=(value={})=>({
  nominated:nonNegative(value.nominated??0,'candidateCounts.nominated'),
  normalized:nonNegative(value.normalized??0,'candidateCounts.normalized'),
  deduplicated:nonNegative(value.deduplicated??0,'candidateCounts.deduplicated'),
  truthAdmitted:nonNegative(value.truthAdmitted??0,'candidateCounts.truthAdmitted'),
  precisionAdmitted:nonNegative(value.precisionAdmitted??0,'candidateCounts.precisionAdmitted'),
  finalGenerationFacing:nonNegative(value.finalGenerationFacing??0,'candidateCounts.finalGenerationFacing'),
});

export function createCognitiveFunctionDecision({
  capability,disposition,reasonCode,expectedValue=0,resourceCost={},freshnessRequirement=CognitiveFreshnessRequirement.TURN_CURRENT,
  deadlineClass=CognitiveDeadlineClass.FOREGROUND_OPPORTUNISTIC,requiredCapabilities=[],channelIds=[],metadata={},
}={}){
  const d=one(disposition,DISPOSITIONS,'CognitiveFunctionDecision.disposition');
  const fresh=one(freshnessRequirement,FRESHNESS,'CognitiveFunctionDecision.freshnessRequirement');
  const deadline=one(deadlineClass,DEADLINES,'CognitiveFunctionDecision.deadlineClass');
  const value=Number(expectedValue);if(!Number.isFinite(value)||value<0||value>1)throw new TypeError('CognitiveFunctionDecision.expectedValue must be 0..1');
  return frozen({
    kind:'CognitiveFunctionDecision',capability:req(capability,'CognitiveFunctionDecision.capability'),disposition:d,
    reasonCode:req(reasonCode,'CognitiveFunctionDecision.reasonCode'),expectedValue:value,
    resourceCost:serial(resourceCost,'CognitiveFunctionDecision.resourceCost'),freshnessRequirement:fresh,deadlineClass:deadline,
    requiredCapabilities:strings(requiredCapabilities,'CognitiveFunctionDecision.requiredCapabilities'),channelIds:strings(channelIds,'CognitiveFunctionDecision.channelIds'),
    metadata:serial(metadata,'CognitiveFunctionDecision.metadata'),authorityGranted:false,canonicalMutationAuthority:false,
  });
}

export function createCognitiveChoiceReceipt({
  id,receiptRevision=1,turnId,turnRevision=0,correlationId,paths=[],
  consideredCognitionOptions=[],admittedJobs=[],skippedJobs=[],deferredJobs=[],reasonCodes=[],
  retrievalIntents=[],sensoryChannelsRequested=[],sensoryChannelsUsed=[],candidateCounts={},
  retrievalQuality=null,correctiveRetrieval={},truthGate={},jev={},precision={},finalEvidenceRefs=[],
  abstained=false,unresolved=false,latencyResourceBudget={},revisions={},freshness={},seal={},
  lateResultIds=[],staleResultIds=[],invalidResultIds=[],functionDecisions=[],executionPlan={},measurements={},degradedState={},metadata={},
}={}){
  if(!Number.isInteger(receiptRevision)||receiptRevision<1)throw new TypeError('CognitiveChoiceReceipt.receiptRevision must be positive');
  if(!Number.isInteger(Number(turnRevision))||Number(turnRevision)<0)throw new TypeError('CognitiveChoiceReceipt.turnRevision must be a non-negative integer');
  const normalizedPaths=strings(paths,'CognitiveChoiceReceipt.paths');for(const path of normalizedPaths)one(path,PATHS,'CognitiveChoiceReceipt.paths');
  const jevAction=jev.action??JevAction.SKIP_JEV;one(jevAction,JEV_ACTIONS,'CognitiveChoiceReceipt.jev.action');
  const receipt={
    kind:'CognitiveChoiceReceipt',contractVersion:COGNITIVE_CHOICE_CONTRACT_VERSION,
    id:req(id,'CognitiveChoiceReceipt.id'),receiptRevision,turnId:req(turnId,'CognitiveChoiceReceipt.turnId'),
    turnRevision:Number(turnRevision),correlationId:req(correlationId,'CognitiveChoiceReceipt.correlationId'),
    paths:normalizedPaths,consideredCognitionOptions:strings(consideredCognitionOptions,'CognitiveChoiceReceipt.consideredCognitionOptions'),
    admittedJobs:strings(admittedJobs,'CognitiveChoiceReceipt.admittedJobs'),skippedJobs:strings(skippedJobs,'CognitiveChoiceReceipt.skippedJobs'),
    deferredJobs:strings(deferredJobs,'CognitiveChoiceReceipt.deferredJobs'),reasonCodes:strings(reasonCodes,'CognitiveChoiceReceipt.reasonCodes'),
    retrievalIntents:strings(retrievalIntents,'CognitiveChoiceReceipt.retrievalIntents'),
    sensoryChannelsRequested:strings(sensoryChannelsRequested,'CognitiveChoiceReceipt.sensoryChannelsRequested'),
    sensoryChannelsUsed:strings(sensoryChannelsUsed,'CognitiveChoiceReceipt.sensoryChannelsUsed'),
    candidateCounts:countShape(candidateCounts),retrievalQuality:retrievalQuality==null?null:req(retrievalQuality,'CognitiveChoiceReceipt.retrievalQuality'),
    correctiveRetrieval:serial(correctiveRetrieval,'CognitiveChoiceReceipt.correctiveRetrieval'),
    truthGate:serial(truthGate,'CognitiveChoiceReceipt.truthGate'),
    jev:{...serial(jev,'CognitiveChoiceReceipt.jev'),action:jevAction},
    precision:serial(precision,'CognitiveChoiceReceipt.precision'),finalEvidenceRefs:strings(finalEvidenceRefs,'CognitiveChoiceReceipt.finalEvidenceRefs'),
    abstained:Boolean(abstained),unresolved:Boolean(unresolved),
    latencyResourceBudget:serial(latencyResourceBudget,'CognitiveChoiceReceipt.latencyResourceBudget'),
    revisions:serial(revisions,'CognitiveChoiceReceipt.revisions'),freshness:serial(freshness,'CognitiveChoiceReceipt.freshness'),
    seal:serial(seal,'CognitiveChoiceReceipt.seal'),lateResultIds:strings(lateResultIds,'CognitiveChoiceReceipt.lateResultIds'),
    staleResultIds:strings(staleResultIds,'CognitiveChoiceReceipt.staleResultIds'),invalidResultIds:strings(invalidResultIds,'CognitiveChoiceReceipt.invalidResultIds'),
    functionDecisions:(functionDecisions??[]).map((row)=>row?.kind==='CognitiveFunctionDecision'?frozen(row):createCognitiveFunctionDecision(row)),
    executionPlan:serial(executionPlan,'CognitiveChoiceReceipt.executionPlan'),measurements:serial(measurements,'CognitiveChoiceReceipt.measurements'),
    degradedState:serial(degradedState,'CognitiveChoiceReceipt.degradedState'),metadata:serial(metadata,'CognitiveChoiceReceipt.metadata'),
    truthAuthority:false,settlementAuthority:false,canonicalMutationAuthority:false,contextSealBypass:false,
  };
  return frozen(receipt);
}
