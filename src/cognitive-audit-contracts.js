import {freeze,req,serial,strings} from './framework-utils.js';

export const CognitiveTransactionType=freeze({
  SOURCE_REVISION_ADMITTED:'SOURCE_REVISION_ADMITTED',PROPOSAL_CREATED:'PROPOSAL_CREATED',PROPOSAL_VALIDATED:'PROPOSAL_VALIDATED',PROPOSAL_REJECTED:'PROPOSAL_REJECTED',
  SETTLEMENT_ACCEPTED:'SETTLEMENT_ACCEPTED',SETTLEMENT_REJECTED:'SETTLEMENT_REJECTED',STATE_SUPERSEDED:'STATE_SUPERSEDED',STATE_CONTRADICTED:'STATE_CONTRADICTED',
  HYPOTHESIS_OPENED:'HYPOTHESIS_OPENED',HYPOTHESIS_RESOLVED:'HYPOTHESIS_RESOLVED',REFLECTION_CREATED:'REFLECTION_CREATED',REFLECTION_REVISED:'REFLECTION_REVISED',
  OPERATOR_OVERRIDE:'OPERATOR_OVERRIDE',CONTEXT_SEALED:'CONTEXT_SEALED',CONTEXT_DELIVERY_PLANNED:'CONTEXT_DELIVERY_PLANNED',ARTIFACT_INVALIDATED:'ARTIFACT_INVALIDATED',
  RECONSOLIDATION_APPLIED:'RECONSOLIDATION_APPLIED',RESULT_ROUTED:'RESULT_ROUTED',RESULT_STALE:'RESULT_STALE',RESULT_LATE:'RESULT_LATE',
});
export const RetentionClass=freeze({LIGHTWEIGHT_METADATA:'LIGHTWEIGHT_METADATA',BOUNDED_DIAGNOSTIC:'BOUNDED_DIAGNOSTIC',FORENSIC_REFERENCE:'FORENSIC_REFERENCE',LARGE_DEBUG_PAYLOAD:'LARGE_DEBUG_PAYLOAD',SENSITIVE_PAYLOAD:'SENSITIVE_PAYLOAD'});
export const DiagnosticStatus=freeze({OK:'OK',PARTIAL_RECONSTRUCTION:'PARTIAL_RECONSTRUCTION',DIAGNOSTIC_UNAVAILABLE:'DIAGNOSTIC_UNAVAILABLE',MISSING_REFERENCE:'MISSING_REFERENCE',EXPIRED_DETAIL:'EXPIRED_DETAIL',INVALID_QUERY:'INVALID_QUERY'});
export const DiagnosticEvidenceKind=freeze({RECORDED_FACT:'RECORDED_FACT',DERIVED_EXPLANATION:'DERIVED_EXPLANATION',MISSING_EVIDENCE:'MISSING_EVIDENCE',INFERRED_CAUSE:'INFERRED_CAUSE'});
export const FidelityStatus=freeze({PASS:'PASS',FAIL:'FAIL',PARTIAL:'PARTIAL'});

export function createCognitiveTransaction({
  transactionId,transactionType,sequence,timestamp=sequence,correlationId,causationId=null,turnId=null,taskId=null,generationId=null,
  subsystem='COGNITIVE_CORE',owner='COGNITIVE_CORE',beforeRevision=null,afterRevision=null,sourceRevisionIds=[],affectedArtifactIds=[],authorityContext=null,
  decision=null,outcome=null,receiptRefs=[],reasonCode='RECORDED',provenance={},metadata={},retentionClass=RetentionClass.LIGHTWEIGHT_METADATA,
}){
  if(!Number.isInteger(sequence)||sequence<1)throw new TypeError('CognitiveTransaction.sequence must be a positive integer');
  for(const [name,value] of [['causationId',causationId],['turnId',turnId],['taskId',taskId],['generationId',generationId]])if(value!==null)req(value,`CognitiveTransaction.${name}`);
  return{kind:'CognitiveTransaction',transactionId:req(transactionId,'CognitiveTransaction.transactionId'),transactionType:req(transactionType,'CognitiveTransaction.transactionType'),
    sequence,timestamp:Number(timestamp),correlationId:req(correlationId,'CognitiveTransaction.correlationId'),causationId,turnId,taskId,generationId,
    subsystem:req(subsystem,'CognitiveTransaction.subsystem'),owner:req(owner,'CognitiveTransaction.owner'),beforeRevision:beforeRevision===null?null:Number(beforeRevision),afterRevision:afterRevision===null?null:Number(afterRevision),
    sourceRevisionIds:strings(sourceRevisionIds,'CognitiveTransaction.sourceRevisionIds'),affectedArtifactIds:strings(affectedArtifactIds,'CognitiveTransaction.affectedArtifactIds'),
    authorityContext:serial(authorityContext,'CognitiveTransaction.authorityContext'),decision:serial(decision,'CognitiveTransaction.decision'),outcome:serial(outcome,'CognitiveTransaction.outcome'),
    receiptRefs:strings(receiptRefs,'CognitiveTransaction.receiptRefs'),reasonCode:req(reasonCode,'CognitiveTransaction.reasonCode'),provenance:serial(provenance,'CognitiveTransaction.provenance'),
    metadata:serial(metadata,'CognitiveTransaction.metadata'),retentionClass:req(retentionClass,'CognitiveTransaction.retentionClass')};
}

export function createDiagnosticEvidenceRef({kind=DiagnosticEvidenceKind.RECORDED_FACT,refType,refId,summary=null,metadata={}}){
  return{kind:'DiagnosticEvidenceRef',evidenceKind:req(kind,'DiagnosticEvidenceRef.evidenceKind'),refType:req(refType,'DiagnosticEvidenceRef.refType'),refId:req(refId,'DiagnosticEvidenceRef.refId'),summary:summary===null?null:String(summary),metadata:serial(metadata,'DiagnosticEvidenceRef.metadata')};
}
export function createDiagnosticResult({queryId,queryType,status=DiagnosticStatus.OK,targetId=null,explanation='',evidenceRefs=[],missingRefs=[],truncated=false,metadata={}}){
  return{kind:'DiagnosticResult',queryId:req(queryId,'DiagnosticResult.queryId'),queryType:req(queryType,'DiagnosticResult.queryType'),status:req(status,'DiagnosticResult.status'),targetId:targetId===null?null:String(targetId),explanation:String(explanation),evidenceRefs:serial(evidenceRefs,'DiagnosticResult.evidenceRefs'),missingRefs:strings(missingRefs,'DiagnosticResult.missingRefs'),truncated:Boolean(truncated),metadata:serial(metadata,'DiagnosticResult.metadata')};
}
