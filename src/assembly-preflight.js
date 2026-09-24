const clone=(v)=>structuredClone(v);
const req=(v,n)=>{if(typeof v!=='string'||!v.length)throw new TypeError(`${n} must be a non-empty string`);return v;};
export const AssemblyPreflightState=Object.freeze({READY_TO_COPY:'READY_TO_COPY',STALE_SOURCE:'STALE_SOURCE',CONFLICT:'CONFLICT',MISSING_ACCEPTANCE:'MISSING_ACCEPTANCE',MISSING_PATH:'MISSING_PATH',INTEGRATION_PATCH_REQUIRED:'INTEGRATION_PATCH_REQUIRED'});
export function createIntegrationLaneManifest({branch,acceptedSha,acceptanceRun=null,copiedPaths=[],browserRuntimePaths=[],nodeOnlyToolPaths=[],requiredWebApis=[],optionalWebApis=[],hostCapabilities=[],integrationAdapters=[],integrationOnlyPatches=[],knownConflicts=[],supersededAssemblyRevision=null}={}){
  return{kind:'IntegrationLaneManifest',schemaVersion:'2',branch:req(branch,'branch'),acceptedSha:req(acceptedSha,'acceptedSha'),acceptanceRun:acceptanceRun==null?null:String(acceptanceRun),
    copiedPaths:copiedPaths.map(x=>typeof x==='string'?{path:x,sourceDigest:null}:{path:req(x.path,'copiedPath.path'),sourceDigest:x.sourceDigest??null}).sort((a,b)=>a.path.localeCompare(b.path)),
    browserRuntimePaths:[...new Set(browserRuntimePaths)].sort(),nodeOnlyToolPaths:[...new Set(nodeOnlyToolPaths)].sort(),requiredWebApis:[...new Set(requiredWebApis)].sort(),optionalWebApis:[...new Set(optionalWebApis)].sort(),hostCapabilities:[...new Set(hostCapabilities)].sort(),
    integrationAdapters:integrationAdapters.map(clone),integrationOnlyPatches:integrationOnlyPatches.map(x=>({path:req(x.path,'patch.path'),expectedDigest:req(x.expectedDigest,'patch.expectedDigest'),reason:req(x.reason,'patch.reason')})).sort((a,b)=>a.path.localeCompare(b.path)),knownConflicts:knownConflicts.map(clone),supersededAssemblyRevision};
}
export function preflightAssemblyLane(manifest,{sourceHeadSha=manifest.acceptedSha,sourceFiles={},integrationFiles={}}={}){
  const rows=[];let laneState=AssemblyPreflightState.READY_TO_COPY;
  if(!manifest.acceptanceRun)laneState=AssemblyPreflightState.MISSING_ACCEPTANCE;else if(sourceHeadSha!==manifest.acceptedSha)laneState=AssemblyPreflightState.STALE_SOURCE;else if(manifest.knownConflicts.length)laneState=AssemblyPreflightState.CONFLICT;
  const patchByPath=new Map(manifest.integrationOnlyPatches.map(x=>[x.path,x]));
  for(const file of manifest.copiedPaths){const source=sourceFiles[file.path],integrated=integrationFiles[file.path];let state=AssemblyPreflightState.READY_TO_COPY,reason='SOURCE_ACCEPTED';
    if(!source){state=AssemblyPreflightState.MISSING_PATH;reason='SOURCE_PATH_MISSING';}
    else if(file.sourceDigest!==null&&source.digest!==file.sourceDigest){state=AssemblyPreflightState.STALE_SOURCE;reason='SOURCE_DIGEST_CHANGED';}
    else if(integrated&&integrated.digest!==source.digest){const patch=patchByPath.get(file.path);if(patch&&integrated.digest===patch.expectedDigest){state=AssemblyPreflightState.INTEGRATION_PATCH_REQUIRED;reason='DOCUMENTED_INTEGRATION_PATCH';}else{state=AssemblyPreflightState.CONFLICT;reason='INTEGRATION_LOCAL_DRIFT_UNDOCUMENTED';}}
    rows.push({path:file.path,state,reason,sourceDigest:source?.digest??null,integrationDigest:integrated?.digest??null});
  }
  const severity=[AssemblyPreflightState.CONFLICT,AssemblyPreflightState.MISSING_PATH,AssemblyPreflightState.MISSING_ACCEPTANCE,AssemblyPreflightState.STALE_SOURCE];
  for(const s of severity)if(rows.some(x=>x.state===s)){laneState=s;break;}
  if(laneState===AssemblyPreflightState.READY_TO_COPY&&rows.some(x=>x.state===AssemblyPreflightState.INTEGRATION_PATCH_REQUIRED))laneState=AssemblyPreflightState.INTEGRATION_PATCH_REQUIRED;
  return{kind:'AssemblyLanePreflight',branch:manifest.branch,acceptedSha:manifest.acceptedSha,sourceHeadSha,state:laneState,rows,knownConflicts:clone(manifest.knownConflicts),acceptanceRun:manifest.acceptanceRun};
}
export function createDryAssemblyPlan(entries,{verificationGates=[]}={}){
  const sorted=[...entries].sort((a,b)=>a.manifest.branch.localeCompare(b.manifest.branch)),steps=[];let sequence=0,blocked=false;
  for(const {manifest,preflight} of sorted){if([AssemblyPreflightState.CONFLICT,AssemblyPreflightState.MISSING_PATH,AssemblyPreflightState.MISSING_ACCEPTANCE,AssemblyPreflightState.STALE_SOURCE].includes(preflight.state)){blocked=true;steps.push({sequence:++sequence,action:'BLOCK',branch:manifest.branch,state:preflight.state});continue;}
    for(const file of manifest.copiedPaths)steps.push({sequence:++sequence,action:'COPY',branch:manifest.branch,path:file.path,expectedSourceDigest:file.sourceDigest});
    for(const patch of manifest.integrationOnlyPatches)steps.push({sequence:++sequence,action:'APPLY_DOCUMENTED_PATCH',branch:manifest.branch,path:patch.path,expectedDigest:patch.expectedDigest,reason:patch.reason});
    steps.push({sequence:++sequence,action:'VERIFY_LANE_DIGESTS',branch:manifest.branch,acceptedSha:manifest.acceptedSha});
  }
  for(const gate of verificationGates)steps.push({sequence:++sequence,action:'RUN_GATE',gate:String(gate)});
  return{kind:'DryAssemblyPlan',mutationTarget:'NONE',mainMutationAllowed:false,blocked,steps};
}
