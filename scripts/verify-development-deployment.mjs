import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const rootManifest=JSON.parse(fs.readFileSync(path.join(root,'assembly','development-deployment.json'),'utf8'));

function gitBlobSha(filePath){
  const bytes=fs.readFileSync(filePath);
  return crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\\0'),bytes])).digest('hex');
}

let failed=false;
const summary=[];

try{
  execFileSync('git',['merge-base','--is-ancestor',rootManifest.deploymentBaseSha,'HEAD'],{cwd:root,stdio:'ignore'});
}catch{
  failed=true;
  console.error('Deployment base is not an ancestor of HEAD: '+rootManifest.deploymentBaseSha);
}

for(const lanePath of rootManifest.laneManifests){
  const lane=JSON.parse(fs.readFileSync(path.join(root,lanePath),'utf8'));
  if(lane.mode==='BASE_ANCESTRY'){
    summary.push({lane:lane.laneId,mode:lane.mode,exact:0,patched:0,missing:0,unexpected:0});
    continue;
  }
  const patches=new Map((lane.integrationOnlyPatches??[]).map(x=>[x.path,x]));
  let exact=0,patched=0,missing=0,unexpected=0;
  for(const row of lane.copiedPaths??[]){
    const target=path.join(root,row.path);
    if(!fs.existsSync(target)){missing++;failed=true;continue;}
    const observed=gitBlobSha(target);
    if(observed===row.sourceDigest){exact++;continue;}
    const patch=patches.get(row.path);
    if(patch&&observed===patch.expectedDigest){patched++;continue;}
    unexpected++;failed=true;
    console.error(JSON.stringify({lane:lane.laneId,path:row.path,sourceDigest:row.sourceDigest,observedDigest:observed,expectedPatchDigest:patch?.expectedDigest??null}));
  }
  for(const row of lane.renamedSourceCopies??[]){
    const target=path.join(root,row.integrationPath);
    if(!fs.existsSync(target)){missing++;failed=true;continue;}
    const observed=gitBlobSha(target);
    if(observed===row.expectedDigest&&observed===row.sourceDigest){exact++;continue;}
    unexpected++;failed=true;
    console.error(JSON.stringify({lane:lane.laneId,path:row.integrationPath,sourcePath:row.sourcePath,sourceDigest:row.sourceDigest,observedDigest:observed,expectedDigest:row.expectedDigest}));
  }
  summary.push({lane:lane.laneId,mode:lane.mode??'COPIED_CHECKPOINT',exact,patched,missing,unexpected});
}
const out={kind:'DevelopmentDeploymentDigestVerification',status:failed?'FAIL':'PASS',deploymentBaseSha:rootManifest.deploymentBaseSha,summary};
console.log(JSON.stringify(out,null,2));
if(failed)process.exitCode=1;
