export const SWARM_OWNER_HANDOFF_VERSION='1.0.0';

export async function admitNativeSwarmContributionToOwner({
  contribution,gather,semanticValidator=null,arrivalAt=null,
}={}){
  if(contribution?.kind!=='NativeSidecarSwarmContribution')throw new TypeError('NativeSidecarSwarmContribution is required');
  if(!gather||typeof gather.accept!=='function'||typeof gather.bundle!=='function'||typeof gather.compilerInput!=='function')
    throw new TypeError('owner GatherCoordinator-compatible contract is required');

  const before=gather.bundle();
  const turnIdentity=before?.turnIdentity??{};
  if(turnIdentity.turnId&&turnIdentity.turnId!==contribution.turnId)throw new TypeError('swarm contribution turnId does not match owner gather');
  if(turnIdentity.correlationId&&turnIdentity.correlationId!==contribution.correlationId)throw new TypeError('swarm contribution correlationId does not match owner gather');

  const summaries=new Map((contribution.resultSummary??[]).map(row=>[row.resultId??row.taskId,row]));
  const executed=(contribution.resultSummary??[]).map(row=>Object.freeze({
    taskId:row.taskId,resultId:row.resultId??null,state:row.state,
    resourceId:row.resourceId??null,providerProfileId:row.providerProfileId??null,providerId:row.providerId??null,workerId:row.workerId??null,
    attempt:Number(row.attempt??1),failureCode:row.failureCode??null,late:Boolean(row.late),stale:Boolean(row.stale),invalid:Boolean(row.invalid),
  }));
  const admissions=[];
  for(const result of contribution.resultsForOwner??[]){
    const summary=summaries.get(result?.resultId)??summaries.get(result?.taskId)??null;
    const outcome=await gather.accept(result,{
      arrivalAt:result?.completedAt??arrivalAt??0,
      semanticValidator,
      attempt:Number(summary?.attempt??1),
    });
    admissions.push(Object.freeze({
      taskId:result?.taskId??summary?.taskId??null,resultId:result?.resultId??summary?.resultId??null,
      executed:true,eligibleForOwner:true,acceptedByOwner:Boolean(outcome?.accepted),
      destination:outcome?.destination??null,duplicate:Boolean(outcome?.duplicate||outcome?.duplicateTask),
      stale:Boolean(outcome?.stale),late:Boolean(outcome?.late),invalid:Boolean(outcome?.invalid),
      reason:outcome?.reason??outcome?.validation?.failure?.code??null,
      resourceId:summary?.resourceId??null,providerProfileId:summary?.providerProfileId??null,
      providerId:summary?.providerId??result?.providerId??null,workerId:summary?.workerId??result?.workerId??null,
    }));
  }
  const after=gather.bundle();
  const acceptedIds=[...(after.acceptedResultIds??[])];
  const eligibleIds=(contribution.resultsForOwner??[]).map(result=>result.resultId).filter(Boolean);
  const rejectedIds=eligibleIds.filter(id=>!acceptedIds.includes(id));
  const jev=contribution.jevReceipt?Object.freeze({
    present:true,receiptId:contribution.jevReceipt.receiptId??contribution.jevReceipt.decisionId??null,
    serviceStatus:contribution.jevReceipt.serviceStatus??null,outcome:contribution.jevReceipt.outcome??null,
    admittedByBridge:false,ownerAdapterRequired:true,authorityGranted:false,settlementPerformed:false,
  }):Object.freeze({present:false,receiptId:null,serviceStatus:null,outcome:null,admittedByBridge:false,ownerAdapterRequired:false,authorityGranted:false,settlementPerformed:false});

  return deepFreeze({
    kind:'NativeSidecarSwarmOwnerHandoffReceipt',contractVersion:SWARM_OWNER_HANDOFF_VERSION,
    turnId:contribution.turnId,correlationId:contribution.correlationId,proposalId:contribution.proposalId,
    executedResults:executed,eligibleResultIds:eligibleIds,admissions,
    acceptedResultIds:acceptedIds,rejectedAtOwnerResultIds:rejectedIds,
    ownerCompilerInput:gather.compilerInput(),ownerGather:after,jev,
    ownerAdmissionPerformed:true,
    authority:'OWNER_ADMISSION_RECEIPT_ONLY',
    truthAuthority:false,precisionAuthority:false,settlementAuthority:false,canonicalMutationAuthority:false,finalChoiceAuthority:false,contextSealAuthority:false,
  });
}

function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);return value;
}
