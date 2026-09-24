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

export const JevAction=Object.freeze({
  SKIP_JEV:'SKIP_JEV',
  INVOKE_JEV:'INVOKE_JEV',
  JEV_UNAVAILABLE:'JEV_UNAVAILABLE',
  JEV_ABSTAINED:'JEV_ABSTAINED',
  REQUEST_OPERATOR:'REQUEST_OPERATOR',
  PRESERVE_UNRESOLVED:'PRESERVE_UNRESOLVED',
});

const PATHS=enumSet(CognitiveChoicePath),JEV_ACTIONS=enumSet(JevAction);
const countShape=(value={})=>({
  nominated:nonNegative(value.nominated??0,'candidateCounts.nominated'),
  normalized:nonNegative(value.normalized??0,'candidateCounts.normalized'),
  deduplicated:nonNegative(value.deduplicated??0,'candidateCounts.deduplicated'),
  truthAdmitted:nonNegative(value.truthAdmitted??0,'candidateCounts.truthAdmitted'),
  precisionAdmitted:nonNegative(value.precisionAdmitted??0,'candidateCounts.precisionAdmitted'),
  finalGenerationFacing:nonNegative(value.finalGenerationFacing??0,'candidateCounts.finalGenerationFacing'),
});

export function createCognitiveChoiceReceipt({
  id,receiptRevision=1,turnId,turnRevision=0,correlationId,paths=[],
  consideredCognitionOptions=[],admittedJobs=[],skippedJobs=[],deferredJobs=[],reasonCodes=[],
  retrievalIntents=[],sensoryChannelsRequested=[],sensoryChannelsUsed=[],candidateCounts={},
  retrievalQuality=null,correctiveRetrieval={},truthGate={},jev={},precision={},finalEvidenceRefs=[],
  abstained=false,unresolved=false,latencyResourceBudget={},revisions={},freshness={},seal={},
  lateResultIds=[],staleResultIds=[],invalidResultIds=[],metadata={},
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
    metadata:serial(metadata,'CognitiveChoiceReceipt.metadata'),
    truthAuthority:false,settlementAuthority:false,canonicalMutationAuthority:false,contextSealBypass:false,
  };
  return frozen(receipt);
}
