import test from 'node:test';
import assert from 'node:assert/strict';

import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {DevelopmentDeploymentSillyTavernSession} from '../src/deployment/sillytavern-live.js';
import {Wave13LoreAuthoringUIAdapter} from '../src/ui-core/wave13-operator-adapters.js';

function harborBook({tideglass='intact',miraExtra=''}={}){
  return {
    id:'harbor-authored',
    title:'Harbor Authored',
    discovery:{kind:'SillyTavernLorebookDiscoveryReceipt',stableId:'assembly-harbor',lorebookId:'harbor-authored',exactAuthoredSource:true},
    entries:[
      {uid:'mira',content:'Mira owns the Lantern Hall. Mira knows Oren.'+(miraExtra?' '+miraExtra:''),metadata:{title:'Mira',treePath:['Harbor','People'],order:1}},
      {uid:'oren',content:'Oren knows Mira.',metadata:{title:'Oren',treePath:['Harbor',' people '],order:2}},
      {uid:'tideglass',content:'The Tideglass is '+tideglass+'.',metadata:{title:'Tideglass',treePath:['Harbor','Relics'],order:3}},
      {uid:'vault-law',content:'Only Lantern Wardens may enter the Tide Vault.',metadata:{title:'Vault Law',treePath:['Harbor','Rules'],order:4}},
    ],
    fullSnapshot:true,
  };
}

function archiveBook(){
  return {
    id:'mirror-archive',
    title:'Mirror Archive',
    discovery:{kind:'SillyTavernLorebookDiscoveryReceipt',stableId:'assembly-archive',lorebookId:'mirror-archive',exactAuthoredSource:true},
    entries:[
      {uid:'mira',content:'Mira carries the Tideglass. Mira knows Lio.',metadata:{title:'Mira',treePath:['Archive','Cast'],order:1}},
      {uid:'tideglass',content:'The Tideglass is destroyed.',metadata:{title:'Tideglass',treePath:['Archive','Relics'],order:2}},
      {uid:'vault-law',content:'Only Lantern Wardens may enter the Tide Vault.',metadata:{title:'Vault Law',treePath:['Archive','Rules'],order:3}},
    ],
    fullSnapshot:true,
  };
}

function unrelatedBook(){
  return {
    id:'sky-ledger',
    title:'Sky Ledger',
    discovery:{kind:'SillyTavernLorebookDiscoveryReceipt',stableId:'assembly-sky',lorebookId:'sky-ledger',exactAuthoredSource:true},
    entries:[{uid:'aerie',content:'Aerie knows Kestrel.',metadata:{title:'Aerie',treePath:['Sky','People'],order:1}}],
    fullSnapshot:true,
  };
}

function unwrap(result){
  assert.equal(result?.ok,true,result?.error?.message??'owner action failed');
  return result.value;
}

function readyBrain(){
  const brain=new DevelopmentDeploymentBrain({resourceCount:1});
  const host=brain.hostBindings();
  host.loreStudyHost.actions.acceptLorebook(harborBook());
  host.loreStudyHost.actions.acceptLorebook(archiveBook());
  host.loreStudyHost.actions.acceptLorebook(unrelatedBook());
  host.loreStudyHost.actions.runLoreStudy({scope:'DUE'});
  assert.equal(brain.loreIntelligence.status().entries.every(row=>row.operatorState==='READY'),true);
  return brain;
}

function finishBuild(authoring,sessionId,batch=2){
  let progress=unwrap(authoring.read.progress({sessionId}));
  while(progress.stage==='BUILDING'||progress.stage==='CHECKPOINTED'){
    unwrap(authoring.actions.resumeAuthoringBuild({sessionId,maxActions:batch}));
    progress=unwrap(authoring.read.progress({sessionId}));
  }
  return progress;
}

function decideAll(authoring,sessionId,decision='ACCEPT',prefix='assembly-decision'){
  const draft=unwrap(authoring.read.draftReview({sessionId}));
  draft.actions.forEach((action,index)=>{
    if(action.decision)return;
    unwrap(authoring.actions.recordDraftDecision({
      sessionId,
      actionId:action.id,
      decision,
      operatorDecisionId:prefix+'-'+index,
    }));
  });
  return unwrap(authoring.read.draftReview({sessionId}));
}

test('assembled host exposes Wave 7 owner lifecycle while Worker 3 UI remains explicitly preview-only',()=>{
  const brain=readyBrain();
  const bindings=brain.hostBindings();
  const owner=bindings.loreAuthoringHost;
  assert.equal(owner.kind,'LoreAuthoringOperatorContract');
  for(const name of [
    'startTreeBuild','startMergeBuild','resumeAuthoringBuild','recordDraftDecision',
    'reclassifyAfterTaxonomyEdit','computeFinalPreview','approveFinalPreview',
    'applySettlement','restoreSettlement',
  ]) assert.equal(typeof owner.actions[name],'function',name+' owner action missing');
  for(const name of ['sourceDiscoveryIdentity','progress','draftReview','finalPreview','settlement','worker1Receipts']){
    assert.equal(typeof owner.read[name],'function',name+' owner read model missing');
  }
  const available=owner.read.availability();
  assert.equal(available.available,true);
  assert.equal(available.blocked,false);

  const worker3=new Wave13LoreAuthoringUIAdapter({bindings});
  assert.equal(worker3.capabilities().destructiveApply,false);
  assert.equal(worker3.capabilities().tree,true);
  assert.equal(worker3.capabilities().merge,true);

  const absent=new Wave13LoreAuthoringUIAdapter({bindings:{}});
  const unavailable=absent.sourceDiscoveryIdentity({});
  assert.equal(unavailable.ok,false);
  assert.equal(unavailable.error.safe,true);
});

test('assembled source discovery preserves selected Lore identity and exact source revisions',()=>{
  const brain=readyBrain();
  const authoring=brain.hostBindings().loreAuthoringHost;
  const discovery=unwrap(authoring.read.sourceDiscoveryIdentity({lorebookId:'harbor-authored'}));
  const harbor=discovery.books.find(row=>row.lorebookId==='harbor-authored');
  assert.ok(harbor);
  assert.equal(harbor.discoveryIdentityPersisted,true);
  assert.equal(harbor.sources.length,4);
  assert.equal(harbor.sources.every(row=>row.sourceRevisionId&&row.contentHash),true);
  assert.equal(harbor.sources.every(row=>row.lorebookId==='harbor-authored'),true);
});

test('assembled Tree review honors reject/defer, authoritative preflight, stale source fence, and targeted study obligation',()=>{
  const brain=readyBrain();
  let authoring=brain.hostBindings().loreAuthoringHost;
  const unrelatedBefore=brain.loreIntelligence.status().entries.find(row=>row.sourceId==='lore:sky-ledger:aerie');

  const first=unwrap(authoring.actions.startTreeBuild({lorebookIds:['harbor-authored']}));
  finishBuild(authoring,first.sessionId,1);
  const draft=unwrap(authoring.read.draftReview({sessionId:first.sessionId}));
  draft.actions.forEach((action,index)=>{
    unwrap(authoring.actions.recordDraftDecision({
      sessionId:first.sessionId,
      actionId:action.id,
      decision:index===0?'REJECT':'DEFER',
      operatorDecisionId:'assembly-review-'+index,
    }));
  });
  const reviewed=unwrap(authoring.read.draftReview({sessionId:first.sessionId}));
  assert.equal(reviewed.actions.some(row=>row.decision==='REJECT'),draft.actions.length>0);
  assert.equal(reviewed.actions.every(row=>['REJECT','DEFER'].includes(row.decision)),true);

  unwrap(authoring.actions.reclassifyAfterTaxonomyEdit({
    sessionId:first.sessionId,
    sourceIds:['lore:harbor-authored:mira'],
    toPath:['Harbor','Characters'],
    operatorDecisionId:'assembly-taxonomy-mira',
  }));
  const finalPreview=unwrap(authoring.actions.computeFinalPreview({sessionId:first.sessionId}));
  assert.equal(finalPreview.validation.ok,true);
  assert.equal(finalPreview.operations.length,1);
  assert.equal(finalPreview.operations[0].semanticPreflight.semanticChange.invalidationPlan.authoritativePreflight,true);

  brain.acceptLorebook(harborBook({miraExtra:'Mira carries the Tideglass.'}));
  brain.runLoreStudy({scope:'DUE'});
  const stale=unwrap(authoring.actions.approveFinalPreview({
    sessionId:first.sessionId,
    operatorApprovalId:'assembly-stale-approval',
  }));
  assert.equal(stale.readyForApproval,false);
  assert.equal(stale.stale.reason,'SOURCE_REVISION_FENCE_CHANGED');
  assert.equal(unwrap(authoring.read.progress({sessionId:first.sessionId})).stage,'DRAFT_REVIEW');

  const second=unwrap(authoring.actions.startTreeBuild({lorebookIds:['harbor-authored']}));
  finishBuild(authoring,second.sessionId,2);
  decideAll(authoring,second.sessionId,'REJECT','assembly-reject-system');
  unwrap(authoring.actions.reclassifyAfterTaxonomyEdit({
    sessionId:second.sessionId,
    sourceIds:['lore:harbor-authored:mira'],
    toPath:['Harbor','Characters'],
    operatorDecisionId:'assembly-targeted-move',
  }));
  const currentFinal=unwrap(authoring.actions.computeFinalPreview({sessionId:second.sessionId}));
  assert.equal(currentFinal.validation.ok,true);
  unwrap(authoring.actions.approveFinalPreview({sessionId:second.sessionId,operatorApprovalId:'assembly-tree-approve'}));
  const settled=unwrap(authoring.actions.applySettlement({sessionId:second.sessionId,maxOperations:8}));
  assert.equal(settled.state,'SETTLED');
  const due=brain.lore.dueObligations();
  assert.deepEqual(due.map(row=>row.sourceId),['lore:harbor-authored:mira']);
  const worker1=unwrap(authoring.read.worker1Receipts({settlementId:settled.settlementId}));
  assert.equal(worker1.revisionEvents.length,1);
  assert.equal(worker1.invalidationReceipts[0].authoritativePreflight,true);
  assert.equal(worker1.unrelatedSourcesInvalidated,false);

  const unrelatedAfter=brain.loreIntelligence.status().entries.find(row=>row.sourceId==='lore:sky-ledger:aerie');
  assert.equal(unrelatedAfter.sourceRevisionId,unrelatedBefore.sourceRevisionId);
  assert.equal(unrelatedAfter.operatorState,'READY');
  brain.runLoreStudy({scope:'DUE'});
  assert.equal(brain.loreIntelligence.status().entries.find(row=>row.sourceId==='lore:harbor-authored:mira').operatorState,'READY');
});

test('assembled guarded merge preserves originals, resumes after owner reload, keeps contradiction separate, and restores',()=>{
  let brain=readyBrain();
  let bindings=brain.hostBindings();
  let authoring=bindings.loreAuthoringHost;
  const sourceIds=brain.lore.registry.listEntries({includeRemoved:false})
    .filter(row=>['harbor-authored','mirror-archive'].includes(row.lorebookId))
    .map(row=>row.sourceId);
  const before=new Map(sourceIds.map(sourceId=>[sourceId,brain.lore.registry.currentRevision(sourceId).id]));
  const mergePreview=unwrap(authoring.actions.previewMerge({lorebookIds:['harbor-authored','mirror-archive']}));
  assert.equal(mergePreview.classifications.exactDuplicates.length>0,true);
  assert.equal(mergePreview.classifications.complementary.length>0,true);
  assert.equal(mergePreview.classifications.unresolvedContradictions.length>0,true);

  const started=unwrap(authoring.actions.startMergeBuild({
    lorebookIds:['harbor-authored','mirror-archive'],
    outputLorebookId:'assembled-reviewed-merge',
    outputTitle:'Assembled Reviewed Merge',
  }));
  finishBuild(authoring,started.sessionId,2);
  decideAll(authoring,started.sessionId,'ACCEPT','assembly-merge-accept');
  const finalPreview=unwrap(authoring.actions.computeFinalPreview({sessionId:started.sessionId}));
  assert.equal(finalPreview.validation.ok,true);
  assert.equal(finalPreview.validation.authoritativeSourcePreflight,true);
  assert.equal(finalPreview.output.contradictionsRemainSeparate,true);
  assert.equal(finalPreview.output.reconstructionManifest.reconstructsExactAuthoredInputs,true);
  unwrap(authoring.actions.approveFinalPreview({sessionId:started.sessionId,operatorApprovalId:'assembly-merge-approve'}));

  const partial=unwrap(authoring.actions.applySettlement({sessionId:started.sessionId,maxOperations:1}));
  assert.equal(partial.state,'CHECKPOINTED');
  assert.equal(partial.cursor,1);
  const snapshot=brain.snapshotLoreOwner();

  brain=new DevelopmentDeploymentBrain({resourceCount:1,loreOwnerSnapshot:snapshot});
  bindings=brain.hostBindings();
  authoring=bindings.loreAuthoringHost;
  const resumed=unwrap(authoring.actions.applySettlement({sessionId:started.sessionId,maxOperations:128}));
  assert.equal(resumed.state,'SETTLED');
  assert.equal(resumed.receipts.length,finalPreview.output.entries.length);
  for(const [sourceId,revisionId] of before)assert.equal(brain.lore.registry.currentRevision(sourceId).id,revisionId);
  assert.equal(brain.lore.dueObligations().every(row=>row.trigger==='NEW_UID'),true);
  assert.equal(brain.lore.dueObligations().length,finalPreview.output.entries.length);

  const worker1=unwrap(authoring.read.worker1Receipts({settlementId:resumed.settlementId}));
  assert.equal(worker1.revisionEvents.length,finalPreview.output.entries.length);
  assert.equal(worker1.unrelatedSourcesInvalidated,false);
  const eventFenceCount=brain.loreSettlementEvents.length;
  unwrap(authoring.actions.applySettlement({sessionId:started.sessionId,maxOperations:128}));
  assert.equal(brain.loreSettlementEvents.length,eventFenceCount);

  brain.runLoreStudy({scope:'DUE'});
  const outputSources=brain.lore.registry.listEntries({includeRemoved:false}).filter(row=>row.lorebookId==='assembled-reviewed-merge');
  assert.equal(outputSources.every(source=>brain.loreIntelligence.status().entries.find(row=>row.sourceId===source.sourceId)?.operatorState==='READY'),true);

  const restored=unwrap(authoring.actions.restoreSettlement({
    settlementId:resumed.settlementId,
    restorationId:'assembly-merge-restore',
    maxOperations:128,
  }));
  assert.equal(restored.state,'RESTORED');
  for(const source of outputSources)assert.equal(brain.lore.registry.currentRevision(source.sourceId).state,'REMOVED');
  for(const [sourceId,revisionId] of before)assert.equal(brain.lore.registry.currentRevision(sourceId).id,revisionId);
});


test('assembled live host forwards only new Settlement revision events to an attached native Brain',()=>{
  const brain=readyBrain();
  const invalidations=[];
  const loreInterfaces=[];
  const nativeBrain={
    async runTurn(){return{};},
    uiBindings(){return{};},
    attachLoreInterface(value){loreInterfaces.push(value);return{attached:Boolean(value),contractVersion:value?.contractVersion??null};},
    acceptLoreRevisionChange(event){
      invalidations.push(structuredClone(event));
      return{
        kind:'NativeBrainLoreRevisionInvalidationReceipt',
        status:'ACCEPTED',
        sourceId:event.sourceId,
        lorebookId:event.lorebookId,
        uid:event.uid,
        previousSourceRevisionId:event.previousSourceRevisionId,
        sourceRevisionId:event.sourceRevisionId,
        nextRevisionTrusted:true,
        revisionTrustStatus:'CURRENT',
      };
    },
  };
  const session=new DevelopmentDeploymentSillyTavernSession({brain,nativeBrain,mountUi:false});
  assert.equal(loreInterfaces.length,1);
  assert.equal(loreInterfaces[0]?.kind,'LoreBrainRetrievalInterface');

  const authoring=brain.hostBindings().loreAuthoringHost;
  const started=unwrap(authoring.actions.startTreeBuild({lorebookIds:['harbor-authored']}));
  finishBuild(authoring,started.sessionId,2);
  decideAll(authoring,started.sessionId,'REJECT','live-forward-reject');
  unwrap(authoring.actions.reclassifyAfterTaxonomyEdit({
    sessionId:started.sessionId,
    sourceIds:['lore:harbor-authored:mira'],
    toPath:['Harbor','Characters'],
    operatorDecisionId:'live-forward-move',
  }));
  assert.equal(unwrap(authoring.actions.computeFinalPreview({sessionId:started.sessionId})).validation.ok,true);
  unwrap(authoring.actions.approveFinalPreview({sessionId:started.sessionId,operatorApprovalId:'live-forward-approve'}));
  const settled=unwrap(authoring.actions.applySettlement({sessionId:started.sessionId,maxOperations:8}));
  assert.equal(settled.state,'SETTLED');
  assert.equal(invalidations.length,1);
  assert.equal(invalidations[0].sourceId,'lore:harbor-authored:mira');

  unwrap(authoring.actions.applySettlement({sessionId:started.sessionId,maxOperations:8}));
  assert.equal(invalidations.length,1);

  const restored=unwrap(authoring.actions.restoreSettlement({
    settlementId:settled.settlementId,
    restorationId:'live-forward-restore',
    maxOperations:8,
  }));
  assert.equal(restored.state,'RESTORED');
  assert.equal(invalidations.length,2);
  assert.equal(invalidations[1].restoration,true);
  session.destroy();
});
