import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LoreReviewOwnerPath,
  LoreReviewProposalKind,
  Wave13LoreAuthoringUIAdapter,
  buildExactLoreEntries,
  buildHumanLoreTree,
  compareMutationFences,
  createLoreReviewProposal,
  mutationRestudyProgress,
  proposalOwnerPath,
  renderLoreReviewWorkspace,
  toOwnerMutationRequest,
  verifySelectedLorebook,
} from '../src/ui-core/index.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

class Node extends FakeNode{
  constructor(tag,doc){super(tag,doc);this.value='';this.disabled=false;this.hidden=false;}
  setAttribute(name,value){super.setAttribute(name,value);if(name==='value')this.value=String(value);if(name==='disabled')this.disabled=true;}
}
class Doc extends FakeDocument{
  constructor(){super();this.body=new Node('body',this);this.documentElement=new Node('html',this);}
  createElement(tag){return new Node(tag,this);}
  createDocumentFragment(){return new Node('fragment',this);}
}
const walk=node=>[node,...(node?.children??[]).flatMap(walk)];
const allText=node=>walk(node).map(x=>String(x.textContent??'')).filter(Boolean).join(' | ');

function loreFixture(count=105){
  const entries=Array.from({length:count},(_,i)=>({
    uid:'uid-'+i,comment:'Entry '+i,content:'Exact authored content '+i,
    key:['key-'+i],metadata:{title:'Entry '+i,treePath:['World','District '+(i%5),'Topic '+(i%9)],temporalState:i%7===0?'HISTORICAL':'CURRENT',contradictionState:i%11===0?'UNRESOLVED':'NONE'},
  }));
  const sources=entries.map((row,i)=>({
    sourceId:'lore:book-1:'+row.uid,uid:row.uid,sourceRevisionId:'rev-'+i,contentHash:'hash-'+i,
    metadata:{title:row.comment,treePath:row.metadata.treePath,temporalState:row.metadata.temporalState,contradictionState:row.metadata.contradictionState,provenanceRefs:['prov-'+i]},
  }));
  return{snapshot:{id:'book-1',title:'Large World',entries},book:{lorebookId:'book-1',title:'Large World',discoveryIdentityPersisted:true,sources}};
}

function local(kind,overrides={}){
  return createLoreReviewProposal({
    proposalKind:kind,lorebookId:'book-1',sourceId:'lore:book-1:alpha',baseSourceRevisionId:'rev-alpha',uid:'alpha',
    targetUid:'target-alpha',targetSourceIds:['lore:book-1:beta'],title:'Alpha Target',content:'Exact proposed content',
    targetTreePath:['World','People'],reason:'operator reviewed',sourceMetadata:{title:'Alpha',treePath:['World','Old']},
    sourceRevisionFence:[{sourceId:'lore:book-1:alpha',sourceRevisionId:'rev-alpha',contentHash:'hash-alpha'}],
    evidenceSourceIds:['lore:book-1:alpha'],provenanceRefs:['claim:1'],scope:'chat-1',
    before:{title:'Alpha',content:'Before',sourceRevisionId:'rev-alpha',treePath:['World','Old']},
    after:{title:'Alpha Target',content:'Exact proposed content',treePath:['World','People']},
    outputs:[
      {lorebookId:'book-1',uid:'alpha-a',title:'Alpha A',content:'Split A',treePath:['World','People'],metadata:{title:'Alpha A',treePath:['World','People']}},
      {lorebookId:'book-1',uid:'alpha-b',title:'Alpha B',content:'Split B',treePath:['World','Rules'],metadata:{title:'Alpha B',treePath:['World','Rules']}},
    ],
    ...overrides,
  });
}

function ownerHost(){
  const calls=[],proposals=new Map(),audits=new Map();
  let seq=0;
  const create=(request)=>{
    const proposalId='owner:'+(++seq),sourceRevisionFence=[];
    for(const sourceId of request.sourceIds??(request.sourceId?[request.sourceId]:[]))sourceRevisionFence.push({sourceId,sourceRevisionId:sourceId.endsWith(':beta')?'rev-beta':'rev-alpha',contentHash:'hash'});
    const row={kind:'LoreMutationProposalReadModel',proposalId,operation:request.operation,state:'REVIEW_READY',scope:{scopeMode:'CHAT',chatId:request.chatId},sourceRevisionFence,targetExpectations:[],
      preview:{before:[{sourceId:request.sourceId??null,sourceRevisionId:sourceRevisionFence[0]?.sourceRevisionId??null,content:'Before',contentIncluded:true}],after:[{sourceId:'target',state:'PROPOSED',content:'After',contentIncluded:true}]},
      evidence:{sourceRevisionRefs:sourceRevisionFence.map(x=>x.sourceRevisionId),artifactRefs:['artifact:1'],claimRefs:['claim:1'],explicitEvidenceRefs:request.evidenceRefs??[]},
      semanticImpact:[{impact:{required:[{target:'STUDY_ARTIFACTS'},{target:'RETRIEVAL_INDEX'}],direct:['dep:1'],transitive:[]}}],impactSummary:{sourcePlans:1,semanticChangeRows:2,directDependents:1,transitiveDependents:0,requiredActions:2,unrelatedSourcesInvalidated:false},
      affectedTreePaths:[['World','People']],approval:null,rejection:null,commit:null,restoration:null,recovery:null,revisionEvents:[],studyObligationIds:[],lastError:null,
      authority:{sourceMutationAuthority:false,modelMutationAuthority:false,jevMutationAuthority:false},auditId:'audit:'+proposalId};
    proposals.set(proposalId,row);audits.set(proposalId,{kind:'LoreMutationAuditReadModel',proposalId,eventCountTotal:1,events:[{kind:'LoreMutationProposedAudit'}],reconstruction:{sources:[],appendOnlyRestoration:true},rawReconstructionIncluded:false});
    calls.push(['create',request]);return structuredClone(row);
  };
  const read=(id)=>structuredClone(proposals.get(id));
  const scopeCheck=(row,p)=>assert.equal(p.chatId,row.scope.chatId);
  return{
    calls,proposals,
    host:{
      kind:'LoreAuthoringOperatorContract',contractVersion:2,mutationExtensionVersion:1,
      read:{
        sourceDiscoveryIdentity:()=>({kind:'LoreSourceDiscoverySurface',books:[]}),
        reviewStates:()=>({}),worker1InvalidationContract:()=>({}),worker3AuthoringContract:()=>({kind:'LoreAuthoringOperatorContract',contractVersion:2,mutationExtensionVersion:1}),
        mutationProposal:({proposalId})=>read(proposalId),mutationQueue:()=>({kind:'LoreMutationQueueReadModel',items:[...proposals.values()].map(row=>structuredClone(row)),itemCount:proposals.size,bounds:{limit:32},rawReconstructionIncluded:false}),
        semanticImpactPreview:(request)=>({kind:'LoreEditImpactPreview',baseSourceRevisionId:'rev-alpha',request}),
        mutationAudit:({proposalId})=>structuredClone(audits.get(proposalId)),
        progress:()=>({stage:'DRAFT_REVIEW'}),draftReview:()=>({actions:[]}),finalPreview:()=>null,settlement:()=>null,
      },
      actions:{
        previewEditImpact:()=>({}),proposeTree:()=>({}),previewMerge:()=>({}),startTreeBuild:()=>({sessionId:'tree'}),startMergeBuild:()=>({sessionId:'merge'}),resumeAuthoringBuild:()=>({}),
        recordDraftDecision:()=>({}),reclassifyAfterTaxonomyEdit:()=>({}),computeFinalPreview:()=>({}),approveFinalPreview:()=>({}),applySettlement:()=>({}),restoreSettlement:()=>({}),
        createMutationProposal:create,
        approveMutationProposal:(p)=>{const row=proposals.get(p.proposalId);scopeCheck(row,p);row.state='APPROVED';row.approval={operatorDecisionId:p.operatorDecisionId,explicitOperatorApproval:true};calls.push(['approve',p]);return structuredClone(row);},
        rejectMutationProposal:(p)=>{const row=proposals.get(p.proposalId);scopeCheck(row,p);row.state='REJECTED';row.rejection={operatorDecisionId:p.operatorDecisionId};calls.push(['reject',p]);return structuredClone(row);},
        commitMutationProposal:(p)=>{const row=proposals.get(p.proposalId);scopeCheck(row,p);assert.equal(p.operatorDecisionId,row.approval.operatorDecisionId);row.state='COMMITTED';row.commit={operatorDecisionId:p.operatorDecisionId,committedSequence:8};row.revisionEvents=[{sourceId:'target',previousSourceRevisionId:null,sourceRevisionId:'rev-new',studyObligationId:'study:new'}];row.studyObligationIds=['study:new'];row.authority.sourceMutationAuthority=true;audits.get(row.proposalId).events.push({kind:'LoreMutationCommittedAudit'});audits.get(row.proposalId).eventCountTotal=2;calls.push(['commit',p]);return structuredClone(row);},
        restoreMutationProposal:(p)=>{const row=proposals.get(p.proposalId);scopeCheck(row,p);row.state='RESTORED';row.restoration={operatorDecisionId:p.operatorDecisionId,studyObligationIds:['study:restore'],appendOnlyCompensatingRevisions:true};calls.push(['restore',p]);return structuredClone(row);},
      },
    }
  };
}

test('selected SillyTavern Lorebook verification, paging, and human tree stay exact for a large book',()=>{
  const {snapshot,book}=loreFixture();
  const verification=verifySelectedLorebook({selectedSnapshot:snapshot,ownerBook:book});
  assert.equal(verification.verified,true);assert.equal(verification.matchedEntries,105);
  const page=buildExactLoreEntries({selectedSnapshot:snapshot,ownerBook:book,page:3,pageSize:24});
  assert.equal(page.total,105);assert.equal(page.rows.length,24);assert.equal(page.rows[0].sourceRevisionId,'rev-72');
  const tree=buildHumanLoreTree(snapshot.entries,{maxNodes:160});assert.ok(tree.nodeCount>10);assert.ok(tree.rows.some(row=>row.path.join('/')==='World/District 0/Topic 0'));
});

test('all seven UI operations map to mutationExtensionVersion:1 requests',()=>{
  const expected={CREATE_ENTRY:'CREATE',UPDATE_ENTRY:'UPDATE',DELETE_ENTRY:'DELETE',MERGE_ENTRIES:'MERGE',SPLIT_ENTRY:'SPLIT',MOVE_ENTRY:'MOVE',PLACE_ENTRY:'TREE_ASSIGN'};
  for(const [kind,operation] of Object.entries(expected)){
    const proposal=local(kind);
    const request=toOwnerMutationRequest(proposal,{chatId:'chat-1'});
    assert.equal(request.operation,operation,kind);
    assert.equal(request.chatId,'chat-1');
    assert.equal(proposalOwnerPath(proposal,{reviewedMutation:true,mutationExtensionVersion:1}),LoreReviewOwnerPath.REVIEWED_MUTATION);
    assert.equal(proposal.mutationAuthority,false);assert.equal(proposal.commitState,'DRAFT_NOT_SUBMITTED');
    if(kind==='CREATE_ENTRY')assert.equal(request.target.uid,'target-alpha');
    if(kind==='UPDATE_ENTRY')assert.equal(request.after.content,'Exact proposed content');
    if(kind==='DELETE_ENTRY')assert.equal(request.sourceId,'lore:book-1:alpha');
    if(kind==='MERGE_ENTRIES'){assert.equal(request.sourceIds.length,2);assert.equal(request.target.uid,'target-alpha');}
    if(kind==='SPLIT_ENTRY')assert.deepEqual(request.outputs.map(x=>x.uid),['alpha-a','alpha-b']);
    if(kind==='MOVE_ENTRY')assert.equal(request.target.uid,'target-alpha');
    if(kind==='PLACE_ENTRY')assert.deepEqual(request.treePath,['World','People']);
  }
});

test('typed adapter binds all #261 mutation reads/actions and keeps approval separate from commit/restoration',()=>{
  const {host,calls}=ownerHost(),adapter=new Wave13LoreAuthoringUIAdapter({bindings:{loreAuthoringHost:host}});
  const caps=adapter.capabilities();
  assert.equal(caps.mutationExtensionVersion,1);assert.equal(caps.reviewedMutation,true);
  const created=adapter.createMutationProposal(toOwnerMutationRequest(local('UPDATE_ENTRY'),{chatId:'chat-1'}));
  assert.equal(created.ok,true);assert.equal(created.value.state,'REVIEW_READY');assert.equal(created.value.authority.sourceMutationAuthority,false);
  const id=created.value.proposalId;
  assert.equal(adapter.mutationProposal({proposalId:id}).value.state,'REVIEW_READY');
  assert.equal(adapter.mutationQueue({chatId:'chat-1'}).value.itemCount,1);
  assert.equal(adapter.semanticImpactPreview({sourceId:'lore:book-1:alpha',content:'Preview'}).ok,true);
  assert.equal(adapter.mutationAudit({proposalId:id}).value.eventCountTotal,1);
  const approved=adapter.approveMutationProposal({proposalId:id,operatorDecisionId:'approve:'+id,chatId:'chat-1'});
  assert.equal(approved.value.state,'APPROVED');assert.equal(approved.value.authority.sourceMutationAuthority,false);
  const committed=adapter.commitMutationProposal({proposalId:id,operatorDecisionId:'approve:'+id,chatId:'chat-1'});
  assert.equal(committed.value.state,'COMMITTED');assert.equal(committed.value.authority.sourceMutationAuthority,true);assert.equal(committed.value.revisionEvents[0].sourceRevisionId,'rev-new');
  const restored=adapter.restoreMutationProposal({proposalId:id,operatorDecisionId:'restore:'+id,restorationId:'restore-1',chatId:'chat-1'});
  assert.equal(restored.value.state,'RESTORED');assert.equal(restored.value.restoration.appendOnlyCompensatingRevisions,true);
  assert.deepEqual(calls.map(x=>x[0]),['create','approve','commit','restore']);
  assert.equal(typeof host.actions.writeLorebook,'undefined');assert.equal(typeof host.actions.updateEntry,'undefined');
});

test('partial mutation contract is explicit and old startSourceMutationBuild seam is gone',()=>{
  const adapter=new Wave13LoreAuthoringUIAdapter({bindings:{loreAuthoringHost:{contractVersion:2,mutationExtensionVersion:1,read:{mutationProposal:()=>null},actions:{createMutationProposal:()=>({})}}}});
  assert.equal(adapter.capabilities().reviewedMutation,false);assert.equal(adapter.capabilities().mutationCreate,true);assert.equal(adapter.capabilities().mutationCommit,false);
  assert.equal(typeof adapter.startSourceMutationBuild,'undefined');
  const result=adapter.commitMutationProposal({proposalId:'missing',chatId:'chat-1'});
  assert.equal(result.ok,false);assert.equal(result.error.code,'LORE_MUTATION_COMMIT_UNAVAILABLE');
});

test('local and owner revision fences report changed targets without silently rewriting the draft',()=>{
  const localProposal=local('UPDATE_ENTRY');
  const match=compareMutationFences(localProposal,{sourceRevisionFence:[{sourceId:'lore:book-1:alpha',sourceRevisionId:'rev-alpha'}]});
  assert.equal(match.matches,true);
  const changed=compareMutationFences(localProposal,{sourceRevisionFence:[{sourceId:'lore:book-1:alpha',sourceRevisionId:'rev-external'}]});
  assert.equal(changed.matches,false);assert.equal(changed.changed[0].ownerSourceRevisionId,'rev-external');
});

test('restudy follows exact commit and restoration obligation IDs rather than whole-book readiness',()=>{
  const read={data:{entries:[
    {studyObligationId:'study:new',operatorState:'READY'},{studyObligationId:'unrelated',operatorState:'FAILED'},{studyObligationId:'study:restore',operatorState:'STUDYING'},
  ]}};
  const committed=mutationRestudyProgress({state:'COMMITTED',studyObligationIds:['study:new']},read);
  assert.equal(committed.complete,true);assert.equal(committed.failed,0);
  const restored=mutationRestudyProgress({state:'RESTORED',studyObligationIds:['study:new'],restoration:{studyObligationIds:['study:restore']}},read);
  assert.equal(restored.state,'IN_PROGRESS');assert.equal(restored.studying,1);assert.equal(restored.matched,1);
});

test('rendered owner queue labels REVIEW_READY and APPROVED as not committed and surfaces recovery truthfully',()=>{
  const {snapshot,book}=loreFixture(12),doc=new Doc(),hostNode=new Node('div',doc),fixture=ownerHost();
  const approved=fixture.host.actions.createMutationProposal({operation:'UPDATE',chatId:'chat-1',sourceId:'lore:book-1:uid-0',after:{content:'After',metadata:{}}});
  fixture.proposals.get(approved.proposalId).sourceRevisionFence=[{sourceId:'lore:book-1:uid-0',sourceRevisionId:'rev-0'}];
  fixture.host.actions.approveMutationProposal({proposalId:approved.proposalId,operatorDecisionId:'approve:'+approved.proposalId,chatId:'chat-1'});
  const failed=fixture.host.actions.createMutationProposal({operation:'MOVE',chatId:'chat-1',sourceId:'lore:book-1:uid-1',target:{lorebookId:'book-1',uid:'uid-moved'}});
  const failedRow=fixture.proposals.get(failed.proposalId);failedRow.state='FAILED';failedRow.lastError={code:'LORE_MUTATION_COMMIT_FAILED',message:'write failed'};failedRow.recovery={status:'COMPENSATED',partialRevisionEvents:[{sourceRevisionId:'partial'}],compensationRevisionEvents:[{sourceRevisionId:'restore'}]};
  const adapter=new Wave13LoreAuthoringUIAdapter({bindings:{loreAuthoringHost:{...fixture.host,read:{...fixture.host.read,sourceDiscoveryIdentity:()=>({books:[book]})}}}});
  adapter.sourceDiscoveryIdentity();
  const loreStudy={selectedLorebook:()=>({selection:{selected:true,chatId:'chat-1'},snapshot}),read:()=>({source:{selection:{chatId:'chat-1'}},data:{entries:[],operatorCounts:{}}}),capabilities:()=>({run:true})};
  renderLoreReviewWorkspace(hostNode,{loreStudy,loreAuthoring:adapter,actionRouter:{route:async()=>({ok:true,result:{ok:true,value:{}}})},scope:{listen:(node,type,fn)=>node.addEventListener(type,fn)},refresh:()=>{},productAdapter:{getDetailLevel:()=> 'NORMAL'}});
  const visible=allText(hostNode);
  assert.match(visible,/Approved · not committed/i);assert.doesNotMatch(visible,/COMMITTED BY OWNER/);
  assert.match(visible,/Multi-write recovery/i);assert.match(visible,/COMPENSATED/i);assert.match(visible,/partial revisions 1/i);
  assert.match(visible,/Source revision/i);assert.match(visible,/Semantic impact/i);assert.match(visible,/Owner audit/i);
});
