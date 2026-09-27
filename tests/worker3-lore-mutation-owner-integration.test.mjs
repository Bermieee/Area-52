import test from 'node:test';
import assert from 'node:assert/strict';

import {LoreIntelligenceService} from '../src/lore-intelligence-service.js';
import {LoreAuthoringService} from '../src/lore-authoring-service.js';
import {Wave13LoreAuthoringUIAdapter,createLoreReviewProposal,toOwnerMutationRequest} from '../src/ui-core/index.js';

const CHAT='chat:worker3-owner-integration';

function book(){
  return{id:'worker3-owner-book',title:'Worker 3 Owner Fixture',discovery:{kind:'SillyTavernLorebookDiscoveryReceipt',source:'WORKER3_ASSEMBLED_FIXTURE',lorebookId:'worker3-owner-book',entryCount:3,chatId:CHAT,exactAuthoredSource:true},fullSnapshot:true,entries:[
    {uid:'alpha',content:'Alpha owns the Ember Hall.',metadata:{title:'Alpha',treePath:['People','Alpha']}},
    {uid:'beta',content:'Beta keeps the bronze key.',metadata:{title:'Beta',treePath:['People','Beta']}},
    {uid:'gamma',content:'Gamma watches the north gate.',metadata:{title:'Gamma',treePath:['People','Gamma']}},
  ]};
}
function assembled(){
  const intelligence=new LoreIntelligenceService();intelligence.acceptLorebook(book());intelligence.runStudy({scope:'DUE'});
  const authoring=new LoreAuthoringService({intelligence}),host=authoring.operatorContract(),adapter=new Wave13LoreAuthoringUIAdapter({bindings:{loreAuthoringHost:host}});
  assert.equal(host.contractVersion,2);assert.equal(host.mutationExtensionVersion,1);assert.equal(adapter.capabilities().reviewedMutation,true);
  return{intelligence,authoring,adapter};
}
function src(uid){return'lore:worker3-owner-book:'+uid;}
function localFor(kind,intelligence){
  const alpha=intelligence.runtime.registry.currentRevision(src('alpha')),beta=intelligence.runtime.registry.currentRevision(src('beta'));
  const base={proposalKind:kind,lorebookId:'worker3-owner-book',sourceId:src('alpha'),baseSourceRevisionId:alpha.id,uid:'alpha',targetUid:'target-'+kind.toLowerCase(),title:'Target '+kind,content:'Exact '+kind+' authored output.',targetTreePath:['Reviewed',kind],
    sourceMetadata:{title:'Alpha',treePath:['People','Alpha']},targetMetadata:{title:'Target '+kind,treePath:['Reviewed',kind]},scope:CHAT,
    sourceRevisionFence:[{sourceId:src('alpha'),sourceRevisionId:alpha.id,contentHash:alpha.contentHash}],targetSourceIds:[src('beta')],
    outputs:[
      {lorebookId:'worker3-owner-book',uid:'split-a',title:'Split A',content:'Alpha owns the Ember Hall.',treePath:['Reviewed','Split'],metadata:{title:'Split A',treePath:['Reviewed','Split']}},
      {lorebookId:'worker3-owner-book',uid:'split-b',title:'Split B',content:'Alpha keeps a silver token.',treePath:['Reviewed','Split'],metadata:{title:'Split B',treePath:['Reviewed','Split']}},
    ]};
  if(kind==='MERGE_ENTRIES')base.sourceRevisionFence.push({sourceId:src('beta'),sourceRevisionId:beta.id,contentHash:beta.contentHash});
  return createLoreReviewProposal(base);
}
function run(kind){
  const {intelligence,adapter}=assembled(),local=localFor(kind,intelligence),request=toOwnerMutationRequest(local,{chatId:CHAT});
  const created=adapter.createMutationProposal(request);assert.equal(created.ok,true,kind);assert.equal(created.value.state,'REVIEW_READY',kind);assert.equal(created.value.authority.sourceMutationAuthority,false,kind);
  const id=created.value.proposalId;
  assert.equal(adapter.mutationProposal({proposalId:id}).value.state,'REVIEW_READY');
  assert.ok(adapter.mutationQueue({chatId:CHAT,limit:32}).value.items.some(row=>row.proposalId===id));
  assert.ok(adapter.mutationAudit({proposalId:id}).value.events.some(row=>row.kind==='LoreMutationProposedAudit'));
  const approved=adapter.approveMutationProposal({proposalId:id,operatorDecisionId:'approve:'+kind,chatId:CHAT});
  assert.equal(approved.ok,true);assert.equal(approved.value.state,'APPROVED');assert.equal(approved.value.authority.sourceMutationAuthority,false,'approval cannot look committed');
  const committed=adapter.commitMutationProposal({proposalId:id,operatorDecisionId:'approve:'+kind,chatId:CHAT});
  assert.equal(committed.ok,true);assert.equal(committed.value.state,'COMMITTED');assert.equal(committed.value.authority.sourceMutationAuthority,true);
  assert.ok(committed.value.revisionEvents.length>=1);assert.ok(committed.value.studyObligationIds.length>=1);
  assert.ok(adapter.mutationAudit({proposalId:id}).value.events.some(row=>row.kind==='LoreMutationCommittedAudit'));
  return{intelligence,adapter,committed:committed.value,id};
}

test('real #261 owner contract completes CREATE UPDATE DELETE MERGE SPLIT MOVE TREE_ASSIGN only after approval + commit',()=>{
  const kinds=['CREATE_ENTRY','UPDATE_ENTRY','DELETE_ENTRY','MERGE_ENTRIES','SPLIT_ENTRY','MOVE_ENTRY','PLACE_ENTRY'];
  const committed=new Map(kinds.map(kind=>[kind,run(kind)]));
  assert.ok(committed.get('CREATE_ENTRY').intelligence.runtime.registry.currentRevision('lore:worker3-owner-book:target-create_entry'));
  assert.match(committed.get('UPDATE_ENTRY').intelligence.runtime.registry.currentRevision(src('alpha')).exactContent,/UPDATE_ENTRY/);
  assert.equal(committed.get('DELETE_ENTRY').intelligence.runtime.registry.currentRevision(src('alpha')).state,'REMOVED');
  assert.ok(committed.get('MERGE_ENTRIES').intelligence.runtime.registry.currentRevision('lore:worker3-owner-book:target-merge_entries'));
  assert.ok(committed.get('SPLIT_ENTRY').intelligence.runtime.registry.currentRevision('lore:worker3-owner-book:split-a'));
  assert.equal(committed.get('SPLIT_ENTRY').intelligence.runtime.registry.currentRevision(src('alpha')).state,'CURRENT');
  assert.ok(committed.get('MOVE_ENTRY').intelligence.runtime.registry.currentRevision('lore:worker3-owner-book:target-move_entry'));
  assert.equal(committed.get('MOVE_ENTRY').intelligence.runtime.registry.currentRevision(src('alpha')).state,'REMOVED');
  assert.deepEqual(committed.get('PLACE_ENTRY').intelligence.runtime.registry.currentRevision(src('alpha')).metadata.treePath,['Reviewed','PLACE_ENTRY']);
});

test('real #261 approval/rejection/stale/restore paths preserve owner authority boundaries',()=>{
  {
    const {intelligence,adapter}=assembled(),local=localFor('UPDATE_ENTRY',intelligence);
    const created=adapter.createMutationProposal(toOwnerMutationRequest(local,{chatId:CHAT})).value;
    const rejected=adapter.rejectMutationProposal({proposalId:created.proposalId,operatorDecisionId:'reject:1',chatId:CHAT}).value;
    assert.equal(rejected.state,'REJECTED');assert.equal(rejected.authority.sourceMutationAuthority,false);
    assert.equal(intelligence.runtime.registry.currentRevision(src('alpha')).id,local.baseSourceRevisionId);
  }
  {
    const {intelligence,adapter}=assembled(),local=localFor('UPDATE_ENTRY',intelligence);
    const created=adapter.createMutationProposal(toOwnerMutationRequest(local,{chatId:CHAT})).value;
    const approved=adapter.approveMutationProposal({proposalId:created.proposalId,operatorDecisionId:'approve:stale',chatId:CHAT}).value;assert.equal(approved.state,'APPROVED');
    const before=intelligence.runtime.registry.currentRevision(src('alpha'));
    intelligence.runtime.upsertEntry({lorebookId:'worker3-owner-book',uid:'alpha',content:before.exactContent+' External edit.',metadata:before.metadata});
    const stale=adapter.commitMutationProposal({proposalId:created.proposalId,operatorDecisionId:'approve:stale',chatId:CHAT}).value;
    assert.equal(stale.state,'STALE');assert.equal(stale.lastError.code,'LORE_MUTATION_SOURCE_STALE');assert.equal(stale.authority.sourceMutationAuthority,false);
  }
  {
    const {intelligence,adapter,committed,id}=run('DELETE_ENTRY');
    const beforeRestore=intelligence.runtime.registry.currentRevision(src('alpha'));assert.equal(beforeRestore.state,'REMOVED');
    const restored=adapter.restoreMutationProposal({proposalId:id,restorationId:'restore:'+id,operatorDecisionId:'restore-decision:'+id,chatId:CHAT}).value;
    assert.equal(restored.state,'RESTORED');assert.equal(restored.restoration.explicitOperatorApproval,true);assert.equal(restored.restoration.appendOnlyCompensatingRevisions,true);
    assert.equal(intelligence.runtime.registry.currentRevision(src('alpha')).state,'CURRENT');
    assert.notEqual(intelligence.runtime.registry.currentRevision(src('alpha')).id,beforeRestore.id);
    assert.ok(committed.commit);
  }
});
