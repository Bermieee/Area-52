const MAX_LAYERS=16;
const MAX_REASON=160;

export function createScatterLayerReceipt(input={}){
  return freeze({
    kind:'LayeredScatterLayerReceipt',contractVersion:'1.0.0',
    chatId:nullable(input.chatId),turnId:nullable(input.turnId),generationId:nullable(input.generationId),
    correlationId:nullable(input.correlationId),parentReceiptId:nullable(input.parentReceiptId),
    trigger:clip(input.trigger),layer:clip(input.layer),admission:clip(input.admission??'EXECUTED'),reason:clip(input.reason),
    startedAt:finite(input.startedAt),completedAt:finite(input.completedAt),durationMs:nonneg(input.durationMs),
    queueDepth:nonnegInt(input.queueDepth),peakConcurrency:nonnegInt(input.peakConcurrency),
    logicalJobCount:nonnegInt(input.logicalJobCount),physicalAttemptCount:nonnegInt(input.physicalAttemptCount),
    returnedCount:nonnegInt(input.returnedCount),fallbackCount:nonnegInt(input.fallbackCount),skippedCount:nonnegInt(input.skippedCount),
    failedCount:nonnegInt(input.failedCount),deferredCount:nonnegInt(input.deferredCount),
    retainedBytesEstimate:nonnegInt(input.retainedBytesEstimate),costClass:clip(input.costClass??'UNKNOWN'),
    contextSealAuthority:false,canonicalMutationAuthority:false,rawContentIncluded:false,hiddenReasoningIncluded:false,
  });
}

export function createLayeredScatterReceipt({
  chatId=null,turnId=null,generationId=null,correlationId=null,proposalId=null,layers=[],resourceStates=null,
  baseline=null,metrics={},
}={}){
  const rows=(layers??[]).slice(0,MAX_LAYERS).map(createScatterLayerReceipt);
  return freeze({
    kind:'LayeredScatterWaveReceipt',contractVersion:'1.0.0',chatId:nullable(chatId),turnId:nullable(turnId),generationId:nullable(generationId),
    correlationId:nullable(correlationId),proposalId:nullable(proposalId),layers:rows,
    resourceStates:resourceStates??emptyResourceStates(),
    metrics:freeze({
      logicalJobCount:nonnegInt(metrics.logicalJobCount),physicalAttemptCount:nonnegInt(metrics.physicalAttemptCount),
      physicalReturnedCount:nonnegInt(metrics.physicalReturnedCount),workAvoidedCount:nonnegInt(metrics.workAvoidedCount),
      fallbackCount:nonnegInt(metrics.fallbackCount),deferredCount:nonnegInt(metrics.deferredCount),
      peakLayerConcurrency:nonnegInt(metrics.peakLayerConcurrency),peakRetainedBytesEstimate:nonnegInt(metrics.peakRetainedBytesEstimate),
      timeToGatherCloseMs:nonneg(metrics.timeToGatherCloseMs),quorumSatisfied:Boolean(metrics.quorumSatisfied),
      lateAdmissionCount:nonnegInt(metrics.lateAdmissionCount),staleDropCount:nonnegInt(metrics.staleDropCount),
    }),
    baseline:baseline?freeze({
      executionModel:clip(baseline.executionModel??'UNLAYERED'),logicalJobCount:nonnegInt(baseline.logicalJobCount),
      estimatedPeakConcurrency:nonnegInt(baseline.estimatedPeakConcurrency),estimatedPeakRetainedBytes:nonnegInt(baseline.estimatedPeakRetainedBytes),
    }):null,
    rawPromptsIncluded:false,storyBodiesIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
    authority:freeze({runtimeScheduling:false,truth:false,settlement:false,canonicalMutation:false,contextSeal:false}),
  });
}

export function summarizeOptionalResourceStates({resources=[],records=[],jevExecution=null,ownerReceipts=[]}={}){
  const rows=Array.isArray(resources)?resources:[];
  const ownerByTask=new Map((ownerReceipts??[]).filter(Boolean).map(row=>[row.taskId,row]));
  const sidecarRecords=(records??[]).filter(row=>row?.taskType!=='JEV_DECISION');
  const vectorResources=rows.filter(row=>(row.activeCapabilities??row.declaredCapabilities??[]).includes('EMBED'));
  const jevResources=rows.filter(row=>(row.activeCapabilities??row.declaredCapabilities??[]).includes('SEMANTIC_JUDGMENT'));
  const sidecarResources=rows.filter(row=>!(row.activeCapabilities??row.declaredCapabilities??[]).every(cap=>cap==='EMBED'));
  return freeze({
    sidecar:stateRow(sidecarResources,sidecarRecords,ownerByTask),
    jev:jevStateRow(jevResources,jevExecution),
    vectoring:stateRow(vectorResources,(records??[]).filter(row=>row?.taskType==='EMBED'),ownerByTask),
  });
}

function stateRow(resources,records,ownerByTask){
  const configured=resources.length;
  const qualified=resources.filter(row=>Boolean(row.callable||row.qualification?.qualified)).length;
  const attempts=records.filter(row=>row.providerProfileId||row.providerId).reduce((sum,row)=>sum+Math.max(1,Number(row.attempt??1)),0);
  const returned=records.filter(row=>row.state==='READY_FOR_CORE').length;
  const failed=records.filter(row=>['FAILED','UNAVAILABLE','REJECTED_INVALID','REJECTED_LATE','REJECTED_STALE'].includes(row.state)).length;
  const skipped=records.filter(row=>row.state==='SKIPPED').length;
  let ownerAccepted=0,ownerKnown=0;
  for(const row of records){const receipt=ownerByTask.get(row.taskId);if(receipt){ownerKnown++;if(receipt.accepted||receipt.ownerAccepted)ownerAccepted++;}}
  return freeze({configured,qualified,physicalAttempts:attempts,returned,ownerAccepted,ownerAcceptanceKnown:ownerKnown,skipped,failed});
}
function jevStateRow(resources,execution){
  const configured=resources.length,qualified=resources.filter(row=>Boolean(row.callable||row.qualification?.qualified)).length;
  return freeze({configured,qualified,physicalAttempts:nonnegInt(execution?.physicalAttempts),returned:nonnegInt(execution?.returned),
    ownerAccepted:nonnegInt(execution?.ownerAccepted),ownerAcceptanceKnown:nonnegInt(execution?.ownerAcceptanceKnown),
    skipped:nonnegInt(execution?.skipped),failed:nonnegInt(execution?.failed)});
}
function emptyResourceStates(){return freeze({sidecar:stateRow([],[],new Map()),jev:jevStateRow([],null),vectoring:stateRow([],[],new Map())});}
function clip(v){return v==null?null:String(v).slice(0,MAX_REASON);}function nullable(v){return v==null?null:String(v).slice(0,256);}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}function nonneg(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,n):0;}
function nonnegInt(v){return Math.floor(nonneg(v));}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
