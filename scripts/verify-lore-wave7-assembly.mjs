import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const manifest=JSON.parse(readFileSync('assembly/lanes/lore.json','utf8'));
const hashBlob=(path)=>{
  const bytes=readFileSync(path);
  return createHash('sha1').update('blob '+bytes.length+'\\0').update(bytes).digest('hex');
};

assert.equal(manifest.kind,'IntegrationLaneManifest');
assert.equal(manifest.laneId,'lore');
assert.equal(manifest.branch,'Development-Lorebook-Editor');
assert.equal(manifest.candidateSourceSha,'f983d4de9168ce3a6add1ec002a3372b96b873b9');
assert.equal(manifest.assemblyCandidate.branch,'Integration-Lore-Wave7');
assert.equal(manifest.assemblyCandidate.baseMainSha,'c671fbf7ff603b04311f9fe7e82ca050049354f2');
assert.equal(manifest.assemblyCandidate.worker3UiFilesModified,false);

const patches=new Map((manifest.integrationOnlyPatches??[]).map(row=>[row.path,row]));
const rows=[];
for(const row of manifest.copiedPaths??[]){
  const observed=hashBlob(row.path);
  const patch=patches.get(row.path);
  const allowed=observed===row.sourceDigest||Boolean(patch&&observed===patch.expectedDigest);
  rows.push({path:row.path,observed,sourceDigest:row.sourceDigest,patched:patch?patch.expectedDigest:null,allowed});
  assert.equal(allowed,true,'Lore assembly drift: '+row.path);
}
for(const row of manifest.integrationAdapterDigests??[]){
  const observed=hashBlob(row.path);
  assert.equal(observed,row.expectedDigest,'Lore integration adapter drift: '+row.path);
}

const authoring=manifest.assembledContracts?.authoringOwner;
for(const action of ['startTreeBuild','startMergeBuild','resumeAuthoringBuild','recordDraftDecision','computeFinalPreview','approveFinalPreview','applySettlement','restoreSettlement']){
  assert.equal(authoring.actions.includes(action),true,'Missing assembled authoring action '+action);
}
for(const read of ['sourceDiscoveryIdentity','draftReview','finalPreview','settlement','worker1Receipts','availability']){
  assert.equal(authoring.reads.includes(read),true,'Missing assembled authoring read '+read);
}
assert.equal(manifest.assembledContracts.worker1.backlogOwner,'LoreStudyRuntime');
assert.equal(manifest.assembledContracts.worker1.duplicateAuthoringQueue,false);
assert.equal(manifest.assembledContracts.worker3.currentUiState,'PREVIEW_ONLY_UNTIL_WORKER3_CONSUMES_SETTLEMENT_ACTIONS');

console.log('LORE_ASSEMBLY_VERIFY '+JSON.stringify({
  pass:true,
  sourceSha:manifest.candidateSourceSha,
  baseMainSha:manifest.assemblyCandidate.baseMainSha,
  copiedPaths:rows.length,
  integrationPatches:[...patches.keys()],
  integrationAdapters:(manifest.integrationAdapterDigests??[]).map(row=>row.path),
  worker3UiFilesModified:manifest.assemblyCandidate.worker3UiFilesModified,
}));
