const freeze=(value)=>Object.freeze(value);
const enumValues=(value)=>new Set(Object.values(value));
const req=(v,n)=>{if(typeof v!=='string'||!v.length)throw new TypeError(`${n} must be a non-empty string`);return v;};
const strings=(v,n)=>{if(!Array.isArray(v)||v.some(x=>typeof x!=='string'))throw new TypeError(`${n} must be an array of strings`);return [...v];};
const serial=(v,n)=>{try{JSON.stringify(v);}catch{throw new TypeError(`${n} must be JSON-serializable`);}return structuredClone(v);};
const oneOf=(v,set,n)=>{if(!set.has(v))throw new TypeError(`${n} has unsupported value: ${v}`);return v;};

export const ResultDestination=freeze({
  FOREGROUND:'FOREGROUND',NEXT_TURN:'NEXT_TURN',BACKGROUND:'BACKGROUND',
  SETTLEMENT:'SETTLEMENT',CACHE:'CACHE',EVALUATION:'EVALUATION',
});
export const ResultClass=freeze({REQUIRED:'REQUIRED',OPPORTUNISTIC:'OPPORTUNISTIC',DEFERRED:'DEFERRED'});
export const ResultPayloadClass=freeze({PROPOSAL:'PROPOSAL',OBSERVATION:'OBSERVATION',DERIVED_DATA:'DERIVED_DATA'});
export const ResultFreshness=freeze({FRESH:'FRESH',STALE:'STALE',INVALID:'INVALID'});
export const RetrievalConfidence=freeze({HIGH:'HIGH',MIXED:'MIXED',LOW:'LOW'});
export const PrecisionFreshness=freeze({FRESH:'FRESH',STALE:'STALE'});
export const SealFallbackState=freeze({NONE:'NONE',PRECISION_FALLBACK:'PRECISION_FALLBACK',CORRECTIVE_EXHAUSTED:'CORRECTIVE_EXHAUSTED',CORRECTIVE_FAILED:'CORRECTIVE_FAILED',RICH_CONTEXT:'RICH_CONTEXT'});

const DEST=enumValues(ResultDestination), CLASS=enumValues(ResultClass), PAYLOAD=enumValues(ResultPayloadClass), FRESH=enumValues(ResultFreshness), CONF=enumValues(RetrievalConfidence), PFRESH=enumValues(PrecisionFreshness), FALLBACK=enumValues(SealFallbackState);

export function createCognitiveResult({
  id,taskId,turnId=null,correlationId,causationId=null,sourceSubsystem,workerId=null,
  destinationOwner=null,resultType,resultClass=ResultClass.REQUIRED,payloadClass=ResultPayloadClass.DERIVED_DATA,
  evidenceIds=[],provenance={},sourceRevisionIds=[],worldRevision=0,sceneRevision=0,
  authorityClass='UNRESOLVED',destination=ResultDestination.FOREGROUND,payload,timing={},freshness=ResultFreshness.FRESH,
  staleReason=null,rejectionReason=null,
}){
  return{
    kind:'CognitiveResult',id:req(id,'CognitiveResult.id'),taskId:req(taskId,'CognitiveResult.taskId'),
    turnId:turnId===null?null:req(turnId,'CognitiveResult.turnId'),correlationId:req(correlationId,'CognitiveResult.correlationId'),
    causationId:causationId===null?null:req(causationId,'CognitiveResult.causationId'),
    sourceSubsystem:req(sourceSubsystem,'CognitiveResult.sourceSubsystem'),workerId:workerId===null?null:req(workerId,'CognitiveResult.workerId'),
    destinationOwner:destinationOwner===null?null:req(destinationOwner,'CognitiveResult.destinationOwner'),
    resultType:req(resultType,'CognitiveResult.resultType'),resultClass:oneOf(resultClass,CLASS,'CognitiveResult.resultClass'),
    payloadClass:oneOf(payloadClass,PAYLOAD,'CognitiveResult.payloadClass'),evidenceIds:strings(evidenceIds,'CognitiveResult.evidenceIds'),
    provenance:serial(provenance,'CognitiveResult.provenance'),sourceRevisionIds:strings(sourceRevisionIds,'CognitiveResult.sourceRevisionIds'),
    worldRevision:Number(worldRevision),sceneRevision:Number(sceneRevision),authorityClass:req(authorityClass,'CognitiveResult.authorityClass'),
    destination:oneOf(destination,DEST,'CognitiveResult.destination'),payload:serial(payload,'CognitiveResult.payload'),
    timing:serial(timing,'CognitiveResult.timing'),freshness:oneOf(freshness,FRESH,'CognitiveResult.freshness'),
    staleReason:staleReason===null?null:req(staleReason,'CognitiveResult.staleReason'),
    rejectionReason:rejectionReason===null?null:req(rejectionReason,'CognitiveResult.rejectionReason'),
  };
}

export function createResultRoute({
  id,resultId,accepted,effectiveDestination,freshness,late=false,reason=null,turnId=null,correlationId,sequence,
}){
  if(!Number.isInteger(sequence)||sequence<1)throw new TypeError('ResultRoute.sequence must be a positive integer');
  return{kind:'ResultRoute',id:req(id,'ResultRoute.id'),resultId:req(resultId,'ResultRoute.resultId'),accepted:Boolean(accepted),
    effectiveDestination:oneOf(effectiveDestination,DEST,'ResultRoute.effectiveDestination'),freshness:oneOf(freshness,FRESH,'ResultRoute.freshness'),
    late:Boolean(late),reason:reason===null?null:req(reason,'ResultRoute.reason'),turnId:turnId===null?null:req(turnId,'ResultRoute.turnId'),
    correlationId:req(correlationId,'ResultRoute.correlationId'),sequence};
}

export function createCorrectiveRetrievalRequest({
  id,reason,requestedAction='RETRIEVE_CORRECTIVE_EVIDENCE',originalQuery,intent,sourceRevisionIds=[],worldRevision=0,sceneRevision=0,
  priorCandidateIds=[],missingEvidenceType=null,maxAttempts=1,attempt=1,
}){
  if(!Number.isInteger(maxAttempts)||maxAttempts<1)throw new TypeError('CorrectiveRetrievalRequest.maxAttempts must be positive');
  if(!Number.isInteger(attempt)||attempt<1||attempt>maxAttempts)throw new TypeError('CorrectiveRetrievalRequest.attempt must be within bounds');
  return{kind:'CorrectiveRetrievalRequest',id:req(id,'CorrectiveRetrievalRequest.id'),reason:req(reason,'CorrectiveRetrievalRequest.reason'),
    requestedAction:req(requestedAction,'CorrectiveRetrievalRequest.requestedAction'),originalQuery:req(originalQuery,'CorrectiveRetrievalRequest.originalQuery'),
    intent:req(intent,'CorrectiveRetrievalRequest.intent'),sourceRevisionIds:strings(sourceRevisionIds,'CorrectiveRetrievalRequest.sourceRevisionIds'),
    worldRevision:Number(worldRevision),sceneRevision:Number(sceneRevision),priorCandidateIds:strings(priorCandidateIds,'CorrectiveRetrievalRequest.priorCandidateIds'),
    missingEvidenceType:missingEvidenceType===null?null:req(missingEvidenceType,'CorrectiveRetrievalRequest.missingEvidenceType'),
    maxAttempts,attempt};
}

export function createTruthAssessment({
  id,query,intent,confidence,truthResults=[],correctiveRequest=null,reason,admittedCandidateIds=[],supportCandidateIds=[],
}){
  return{kind:'TruthAssessment',id:req(id,'TruthAssessment.id'),query:req(query,'TruthAssessment.query'),intent:req(intent,'TruthAssessment.intent'),
    confidence:oneOf(confidence,CONF,'TruthAssessment.confidence'),truthResults:serial(truthResults,'TruthAssessment.truthResults'),
    correctiveRequest:correctiveRequest===null?null:serial(correctiveRequest,'TruthAssessment.correctiveRequest'),reason:req(reason,'TruthAssessment.reason'),
    admittedCandidateIds:strings(admittedCandidateIds,'TruthAssessment.admittedCandidateIds'),supportCandidateIds:strings(supportCandidateIds,'TruthAssessment.supportCandidateIds')};
}

export function createPrecisionResult({
  candidateId,rawScore,normalizedScore,finalRank,modelProfileId='deterministic-reference',
  modelProfileRevision='1',runtimeProfile='REFERENCE',latencyMs=0,truncation={},freshness=PrecisionFreshness.FRESH,
  sourceRevisionIds=[],worldRevision=0,sceneRevision=0,
}){
  if(!Number.isInteger(finalRank)||finalRank<1)throw new TypeError('PrecisionResult.finalRank must be positive');
  return{kind:'PrecisionResult',candidateId:req(candidateId,'PrecisionResult.candidateId'),rawScore:Number(rawScore),normalizedScore:Number(normalizedScore),
    finalRank,modelProfileId:req(modelProfileId,'PrecisionResult.modelProfileId'),modelProfileRevision:req(modelProfileRevision,'PrecisionResult.modelProfileRevision'),
    runtimeProfile:req(runtimeProfile,'PrecisionResult.runtimeProfile'),latencyMs:Number(latencyMs),truncation:serial(truncation,'PrecisionResult.truncation'),
    freshness:oneOf(freshness,PFRESH,'PrecisionResult.freshness'),sourceRevisionIds:strings(sourceRevisionIds,'PrecisionResult.sourceRevisionIds'),
    worldRevision:Number(worldRevision),sceneRevision:Number(sceneRevision)};
}

export function createCompilerReceipt({
  id,packetId,representation='COMPACT',rawBytes=0,compiledBytes=0,budgetBytes=null,budgetExceeded=false,
  fallbackUsed=false,factualRetention=1,temporalRetention=1,contradictionRetention=1,provenanceRetention=1,relationshipRetention=1,
  admittedClaimIds=[],droppedClaimIds=[],reason='compiled safely',semanticSizing=null,semanticPriority=[],representationEligibility={},threadDiagnostics={},
}){
  return{kind:'CompilerReceipt',id:req(id,'CompilerReceipt.id'),packetId:req(packetId,'CompilerReceipt.packetId'),representation:req(representation,'CompilerReceipt.representation'),
    rawBytes:Number(rawBytes),compiledBytes:Number(compiledBytes),budgetBytes:budgetBytes===null?null:Number(budgetBytes),budgetExceeded:Boolean(budgetExceeded),
    fallbackUsed:Boolean(fallbackUsed),factualRetention:Number(factualRetention),temporalRetention:Number(temporalRetention),
    contradictionRetention:Number(contradictionRetention),provenanceRetention:Number(provenanceRetention),relationshipRetention:Number(relationshipRetention),
    admittedClaimIds:strings(admittedClaimIds,'CompilerReceipt.admittedClaimIds'),droppedClaimIds:strings(droppedClaimIds,'CompilerReceipt.droppedClaimIds'),
    reason:req(reason,'CompilerReceipt.reason'),semanticSizing:serial(semanticSizing,'CompilerReceipt.semanticSizing'),semanticPriority:serial(semanticPriority,'CompilerReceipt.semanticPriority'),representationEligibility:serial(representationEligibility,'CompilerReceipt.representationEligibility'),threadDiagnostics:serial(threadDiagnostics,'CompilerReceipt.threadDiagnostics')};
}
export function createContextSealReceipt({
  id,turnId,correlationId,packetId,packetHash,sourceRevisionIds=[],worldRevision=0,sceneRevision=0,
  admittedResultIds=[],rejectedResultIds=[],staleResultIds=[],fallbackState=SealFallbackState.NONE,
  deadline=null,sequence,sealedAt=null,dependencies=[],immutable=true,
}){
  if(!Number.isInteger(sequence)||sequence<1)throw new TypeError('ContextSealReceipt.sequence must be positive');
  return{kind:'ContextSealReceipt',id:req(id,'ContextSealReceipt.id'),turnId:req(turnId,'ContextSealReceipt.turnId'),
    correlationId:req(correlationId,'ContextSealReceipt.correlationId'),packetId:req(packetId,'ContextSealReceipt.packetId'),
    packetHash:req(packetHash,'ContextSealReceipt.packetHash'),sourceRevisionIds:strings(sourceRevisionIds,'ContextSealReceipt.sourceRevisionIds'),
    worldRevision:Number(worldRevision),sceneRevision:Number(sceneRevision),admittedResultIds:strings(admittedResultIds,'ContextSealReceipt.admittedResultIds'),
    rejectedResultIds:strings(rejectedResultIds,'ContextSealReceipt.rejectedResultIds'),staleResultIds:strings(staleResultIds,'ContextSealReceipt.staleResultIds'),
    fallbackState:oneOf(fallbackState,FALLBACK,'ContextSealReceipt.fallbackState'),deadline:serial(deadline,'ContextSealReceipt.deadline'),
    sequence,sealedAt,sealedState:Boolean(immutable),dependencies:strings(dependencies,'ContextSealReceipt.dependencies')};
}
