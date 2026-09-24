const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
const freezeDeep=(v)=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))freezeDeep(x);Object.freeze(v);}return v;};

export const RehearsalStatus=Object.freeze({
  ASSEMBLY_REHEARSAL_GREEN:'ASSEMBLY_REHEARSAL_GREEN',
  LIVE_PENDING:'LIVE_PENDING',
  BLOCKED:'BLOCKED',
});

export function createIntegrationRehearsalReceipt({
  rehearsalId,checkpointRefs=[],steps=[],packet=null,sealReceipt=null,promptPlan=null,diagnosticRefs=[],
  status=RehearsalStatus.ASSEMBLY_REHEARSAL_GREEN,liveAcceptance=false,
}={}){
  return freezeDeep({kind:'IntegrationRehearsalReceipt',schemaVersion:'1.0.0',rehearsalId:String(rehearsalId),
    checkpointRefs:uniq(checkpointRefs),steps:clone(steps),packetRef:packet?.id??null,sealRef:sealReceipt?.id??null,promptPlanRef:promptPlan?.promptPlanId??null,
    diagnosticRefs:uniq(diagnosticRefs),status,liveAcceptance:Boolean(liveAcceptance),mainMutationAllowed:false});
}

export function createFunctionTestRehearsalReceipt({testId,checks={},livePendingReason,status=RehearsalStatus.ASSEMBLY_REHEARSAL_GREEN}={}){
  const pass=Object.values(checks).every(Boolean);
  return freezeDeep({kind:'FunctionTestRehearsalReceipt',testId:String(testId),status:pass?status:RehearsalStatus.BLOCKED,checks:clone(checks),
    liveAcceptance:false,livePendingReason:String(livePendingReason??'live execution pending')});
}

export function createCrossSystemIncidentReceipt({
  incidentId,sceneResult,lateOptionalResult,historicalLore,currentObservedCorrection,sealReceipt,
}={}){
  const decisions=[];
  const staleScene=sceneResult?.freshness==='STALE'||Number(sceneResult?.sceneRevision??0)<Number(sealReceipt?.sceneRevision??0);
  decisions.push({item:'sceneResult',outcome:staleScene?'REJECTED':'ENTERED',reason:staleScene?'STALE_SCENE_REVISION':'FRESH_SCENE_REVISION',refs:uniq([sceneResult?.resultId,sceneResult?.eventId])});
  const late=Boolean(lateOptionalResult?.late);
  decisions.push({item:'lateOptionalResult',outcome:late?'DEFERRED':'ENTERED',reason:late?'TURN_ALREADY_SEALED':'ARRIVED_BEFORE_SEAL',refs:uniq([lateOptionalResult?.resultId])});
  decisions.push({item:'historicalLore',outcome:'ENTERED',reason:'HISTORICAL_SUPPORT_ONLY',refs:uniq([historicalLore?.evidenceId,...(historicalLore?.sourceRevisionRefs??[])])});
  decisions.push({item:'currentObservedCorrection',outcome:'ENTERED',reason:'CURRENT_OBSERVED_EVIDENCE',refs:uniq([currentObservedCorrection?.evidenceId,...(currentObservedCorrection?.sourceRevisionRefs??[])])});
  if(historicalLore?.semantic?.predicate===currentObservedCorrection?.semantic?.predicate&&JSON.stringify(historicalLore?.semantic?.value)!==JSON.stringify(currentObservedCorrection?.semantic?.value)){
    decisions.push({item:'crossTemporalDisagreement',outcome:'UNRESOLVED_OR_TEMPORALLY_DISTINGUISHED',reason:'HISTORICAL_EVIDENCE_DOES_NOT_OVERRIDE_CURRENT_OBSERVATION',refs:uniq([historicalLore?.evidenceId,currentObservedCorrection?.evidenceId])});
  }
  return freezeDeep({kind:'CrossSystemIncidentReceipt',incidentId:String(incidentId),decisions,sealRef:sealReceipt?.id??null,explainable:decisions.every(x=>Boolean(x.reason)),mutationAuthority:false});
}

export function createHostRecoveryCase({caseId,input,expectedState,actualState,evidenceRefs=[]}={}){
  return freezeDeep({kind:'HostRecoveryCase',caseId:String(caseId),input:clone(input),expectedState:String(expectedState),actualState:String(actualState),
    pass:String(expectedState)===String(actualState),evidenceRefs:uniq(evidenceRefs)});
}
export function createHostRecoveryReport(cases=[]){
  const rows=cases.map(clone);return freezeDeep({kind:'HostRecoveryReport',cases:rows,pass:rows.every(x=>x.pass),counts:{total:rows.length,pass:rows.filter(x=>x.pass).length,fail:rows.filter(x=>!x.pass).length}});
}
