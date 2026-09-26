import {AssemblyState} from './framework-contracts.js';
import {clone,req} from './framework-utils.js';
export function createAssemblyLaneEntry({sourceBranch,sourceSha,copiedPaths=[],integrationOnlyPatches=[],acceptanceEvidence=[],integrationSha=null,supersedingSha=null}={}){
  return{sourceBranch:req(sourceBranch,'sourceBranch'),sourceSha:req(sourceSha,'sourceSha'),copiedPaths:copiedPaths.map(x=>typeof x==='string'?{path:x,sourceDigest:null}:{path:req(x.path,'copiedPaths.path'),sourceDigest:x.sourceDigest??null}),integrationOnlyPatches:integrationOnlyPatches.map(x=>({path:req(x.path,'integrationOnlyPatches.path'),expectedDigest:req(x.expectedDigest,'integrationOnlyPatches.expectedDigest'),reason:x.reason??null})),acceptanceEvidence:clone(acceptanceEvidence),integrationSha,supersedingSha};
}
export function verifyAssemblyLane(entry,{sourceHeadSha=entry.sourceSha,observedFiles={}}={}){
  const patches=new Map(entry.integrationOnlyPatches.map(x=>[x.path,x]));const rows=[];
  for(const file of entry.copiedPaths){const observed=observedFiles[file.path];let state;if(!observed)state=AssemblyState.MISSING;else if(sourceHeadSha!==entry.sourceSha&&observed.digest===file.sourceDigest)state=AssemblyState.STALE_COPY;else if(file.sourceDigest!==null&&observed.digest===file.sourceDigest)state=AssemblyState.EXACT;else if(patches.has(file.path)&&observed.digest===patches.get(file.path).expectedDigest)state=AssemblyState.INTEGRATION_PATCHED;else state=AssemblyState.UNEXPECTED_DRIFT;rows.push({path:file.path,state,observedDigest:observed?.digest??null,sourceDigest:file.sourceDigest});}
  return{sourceBranch:entry.sourceBranch,sourceSha:entry.sourceSha,sourceHeadSha,rows,counts:Object.fromEntries(Object.values(AssemblyState).map(s=>[s,rows.filter(x=>x.state===s).length])),reconstructable:rows.every(x=>[AssemblyState.EXACT,AssemblyState.INTEGRATION_PATCHED].includes(x.state))};
}
