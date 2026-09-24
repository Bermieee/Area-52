import {monotonicNow} from './browser-runtime-utils.js';

const clone=(v)=>v==null?v:structuredClone(v);
const req=(v,n)=>{if(typeof v!=='string'||!v.trim())throw new TypeError(n+' must be a non-empty string');return v.trim();};
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
const freezeDeep=(v)=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))freezeDeep(x);Object.freeze(v);}return v;};

export const IntegrationRefKind=Object.freeze({BRANCH_HEAD:'BRANCH_HEAD',ACCEPTED_CHECKPOINT:'ACCEPTED_CHECKPOINT'});
export const PatchValidationState=Object.freeze({VALID:'VALID',CONFLICT:'CONFLICT',STALE:'STALE'});
export const MeasurementState=Object.freeze({MEASURED:'MEASURED',REPLAYED:'REPLAYED',NOT_MEASURED:'NOT_MEASURED',NOT_APPLICABLE:'NOT_APPLICABLE'});

export function createAcceptedCheckpointRecord({
  lane,branch,branchHeadSha,acceptedCheckpointSha,acceptanceEvidenceRefs=[],acceptanceRun=null,accepted=true,notes=null,
}={}){
  return freezeDeep({
    kind:'AcceptedCheckpointRecord',lane:req(lane,'lane'),branch:req(branch??lane,'branch'),
    branchHeadSha:req(branchHeadSha,'branchHeadSha'),acceptedCheckpointSha:req(acceptedCheckpointSha,'acceptedCheckpointSha'),
    acceptanceEvidenceRefs:uniq(acceptanceEvidenceRefs),acceptanceRun:acceptanceRun==null?null:String(acceptanceRun),
    accepted:Boolean(accepted),headMatchesAccepted:String(branchHeadSha)===String(acceptedCheckpointSha),notes:notes==null?null:String(notes),
    defaultIntegrationRef:IntegrationRefKind.ACCEPTED_CHECKPOINT,
  });
}

export function resolveIntegrationCheckpoint(record,{requestedSha=null,refKind=IntegrationRefKind.ACCEPTED_CHECKPOINT,allowUnacceptedHead=false}={}){
  if(!record?.accepted)throw Object.assign(new Error('Integration checkpoint is not accepted'),{code:'CHECKPOINT_NOT_ACCEPTED'});
  const accepted=record.acceptedCheckpointSha,head=record.branchHeadSha;
  const selected=requestedSha??(refKind===IntegrationRefKind.BRANCH_HEAD?head:accepted);
  if(refKind===IntegrationRefKind.BRANCH_HEAD&&selected===head&&head!==accepted&&!allowUnacceptedHead){
    return freezeDeep({ok:false,code:'UNACCEPTED_BRANCH_HEAD',selectedSha:null,acceptedSha:accepted,branchHeadSha:head,refKind});
  }
  if(selected!==accepted&&!allowUnacceptedHead){
    return freezeDeep({ok:false,code:'CHECKPOINT_NOT_ACCEPTED',selectedSha:null,acceptedSha:accepted,branchHeadSha:head,requestedSha:selected,refKind});
  }
  return freezeDeep({ok:true,code:'ACCEPTED_CHECKPOINT_SELECTED',selectedSha:selected,acceptedSha:accepted,branchHeadSha:head,refKind});
}

export function createFileOriginReceipt({
  receiptId,lane,branch,acceptedSha,sourcePath,sourceDigest,integrationPath=sourcePath,integrationPatchId=null,acceptanceEvidenceRefs=[],
}={}){
  return freezeDeep({
    kind:'FileOriginReceipt',schemaVersion:'1.0.0',receiptId:req(receiptId,'receiptId'),lane:req(lane,'lane'),branch:req(branch,'branch'),
    acceptedSha:req(acceptedSha,'acceptedSha'),sourcePath:req(sourcePath,'sourcePath'),sourceDigest:req(sourceDigest,'sourceDigest'),
    integrationPath:req(integrationPath,'integrationPath'),integrationPatch:Boolean(integrationPatchId),integrationPatchId:integrationPatchId==null?null:req(integrationPatchId,'integrationPatchId'),
    acceptanceEvidenceRefs:uniq(acceptanceEvidenceRefs),
  });
}

export function createIntegrationPatchRecord({
  patchId,targetPath,sourceLane,acceptedSourceSha,reason,expectedBeforeDigest,expectedAfterDigest,hostIntegrationOnly=true,
}={}){
  return freezeDeep({
    kind:'IntegrationPatchRecord',schemaVersion:'1.0.0',patchId:req(patchId,'patchId'),targetPath:req(targetPath,'targetPath'),
    sourceLane:req(sourceLane,'sourceLane'),acceptedSourceSha:req(acceptedSourceSha,'acceptedSourceSha'),reason:req(reason,'reason'),
    expectedBeforeDigest:req(expectedBeforeDigest,'expectedBeforeDigest'),expectedAfterDigest:req(expectedAfterDigest,'expectedAfterDigest'),
    hostIntegrationOnly:Boolean(hostIntegrationOnly),
  });
}

export function validateIntegrationPatch(patch,{sourceLane,acceptedSourceSha,beforeDigest,afterDigest,targetPath=patch?.targetPath}={}){
  if(!patch)return freezeDeep({kind:'IntegrationPatchValidation',state:PatchValidationState.CONFLICT,reason:'PATCH_MISSING'});
  if(String(sourceLane)!==patch.sourceLane||String(acceptedSourceSha)!==patch.acceptedSourceSha)return freezeDeep({kind:'IntegrationPatchValidation',state:PatchValidationState.STALE,reason:'SOURCE_CHECKPOINT_MISMATCH',patchId:patch.patchId});
  if(String(targetPath)!==patch.targetPath)return freezeDeep({kind:'IntegrationPatchValidation',state:PatchValidationState.CONFLICT,reason:'TARGET_PATH_MISMATCH',patchId:patch.patchId});
  if(String(beforeDigest)!==patch.expectedBeforeDigest)return freezeDeep({kind:'IntegrationPatchValidation',state:PatchValidationState.STALE,reason:'BEFORE_DIGEST_MISMATCH',patchId:patch.patchId});
  if(String(afterDigest)!==patch.expectedAfterDigest)return freezeDeep({kind:'IntegrationPatchValidation',state:PatchValidationState.CONFLICT,reason:'AFTER_DIGEST_MISMATCH',patchId:patch.patchId});
  return freezeDeep({kind:'IntegrationPatchValidation',state:PatchValidationState.VALID,reason:'DOCUMENTED_PATCH_MATCH',patchId:patch.patchId});
}

export class IntegrationPatchRegistry{
  #patches=new Map();
  register(record){
    const row=record?.kind==='IntegrationPatchRecord'?record:createIntegrationPatchRecord(record);
    if(this.#patches.has(row.patchId))throw new Error('Duplicate integration patch: '+row.patchId);
    this.#patches.set(row.patchId,row);return clone(row);
  }
  get(id){const x=this.#patches.get(id);return x?clone(x):null;}
  list(){return [...this.#patches.values()].map(clone).sort((a,b)=>a.patchId.localeCompare(b.patchId));}
  validate(id,input){return validateIntegrationPatch(this.#patches.get(id),input);}
}

export function createWave6AssemblyRehearsalPlan({checkpointRecords=[],originReceipts=[],patches=[],contractChecks=[],browserGates=[],functionTests=[]}={}){
  const records=[...checkpointRecords].sort((a,b)=>a.lane.localeCompare(b.lane)),steps=[];let sequence=0,blocked=false;
  for(const record of records){
    const lock=resolveIntegrationCheckpoint(record);
    if(!lock.ok){blocked=true;steps.push({sequence:++sequence,action:'BLOCK',lane:record.lane,code:lock.code});continue;}
    for(const receipt of originReceipts.filter(x=>x.lane===record.lane).sort((a,b)=>a.integrationPath.localeCompare(b.integrationPath))){
      steps.push({sequence:++sequence,action:'COPY',lane:record.lane,path:receipt.sourcePath,integrationPath:receipt.integrationPath,acceptedSha:record.acceptedCheckpointSha});
      steps.push({sequence:++sequence,action:'VERIFY_DIGEST',lane:record.lane,path:receipt.integrationPath,expectedDigest:receipt.sourceDigest});
    }
    for(const patch of patches.filter(x=>x.sourceLane===record.lane).sort((a,b)=>a.patchId.localeCompare(b.patchId))){
      steps.push({sequence:++sequence,action:'APPLY_DOCUMENTED_PATCH',lane:record.lane,patchId:patch.patchId,path:patch.targetPath,expectedBeforeDigest:patch.expectedBeforeDigest,expectedAfterDigest:patch.expectedAfterDigest});
    }
  }
  for(const row of contractChecks)steps.push({sequence:++sequence,action:'CHECK_CONTRACT_VERSION',...clone(row)});
  for(const gate of browserGates)steps.push({sequence:++sequence,action:'RUN_BROWSER_GATE',gate:String(gate)});
  for(const test of functionTests)steps.push({sequence:++sequence,action:'RUN_FUNCTION_TEST',test:String(test)});
  return freezeDeep({kind:'Wave6AssemblyRehearsalPlan',schemaVersion:'1.0.0',mainMutationAllowed:false,mutationTarget:'NONE',blocked,steps});
}

export const HostLifecycleAction=Object.freeze({
  FRESH_EXTENSION_LOAD:'FRESH_EXTENSION_LOAD',CHAT_ALREADY_OPEN:'CHAT_ALREADY_OPEN',RELOAD:'RELOAD',EXTENSION_UPDATE:'EXTENSION_UPDATE',CHAT_SWITCH:'CHAT_SWITCH',HOST_RECONNECT:'HOST_RECONNECT',
});
export function createCleanInstallReloadModel(){
  const restore={
    [HostLifecycleAction.FRESH_EXTENSION_LOAD]:['Framework services','Event registrations','accepted-checkpoint catalog','read-only UI model registry'],
    [HostLifecycleAction.CHAT_ALREADY_OPEN]:['active chat identity','Scene/turn revision refs','sealed-generation history references'],
    [HostLifecycleAction.RELOAD]:['source revisions','Scene revision identity','dedupe windows where persisted','pending/late result ownership','diagnostic refs'],
    [HostLifecycleAction.EXTENSION_UPDATE]:['contract versions','manifest origin receipts','integration patch registry','migration compatibility state'],
    [HostLifecycleAction.CHAT_SWITCH]:['chat namespace','active Scene identity','turn correlation identity','Nexus shadow namespace'],
    [HostLifecycleAction.HOST_RECONNECT]:['provider/service availability','Runtime capability discovery','pending obligations','read-only shadow readers'],
  };
  return freezeDeep({kind:'CleanInstallReloadModel',schemaVersion:'1.0.0',actions:Object.values(HostLifecycleAction).map(action=>({action,restore:[...restore[action]],mustNotRestore:['stale foreground admission','post-seal mutation authority']}))});
}

export function measureStage(stage,fn,{evidenceRefs=[]}={}){
  const start=monotonicNow();const value=fn();const end=monotonicNow();
  return{value,measurement:freezeDeep({kind:'IntegrationPerformanceMeasurement',stage:req(stage,'stage'),state:MeasurementState.MEASURED,latencyMs:Math.max(0,Number(end-start)),evidenceRefs:uniq(evidenceRefs)})};
}
export function createPerformanceReceipt({measurements=[],notMeasuredStages=[]}={}){
  const rows=[...measurements.map(clone),...uniq(notMeasuredStages).map(stage=>({kind:'IntegrationPerformanceMeasurement',stage,state:MeasurementState.NOT_MEASURED,latencyMs:null,evidenceRefs:[]}))];
  return freezeDeep({kind:'IntegrationPerformanceReceipt',schemaVersion:'1.0.0',measurements:rows.sort((a,b)=>a.stage.localeCompare(b.stage))});
}
