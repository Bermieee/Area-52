import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LoreReviewOwnerPath,
  LoreReviewProposalKind,
  Wave13LoreAuthoringUIAdapter,
  buildExactLoreEntries,
  buildHumanLoreTree,
  createLoreReviewProposal,
  loreRestudyProgress,
  proposalOwnerPath,
  renderLoreReviewWorkspace,
  summarizeLoreReviewAction,
  toOwnerSourceMutationProposal,
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

test('selected SillyTavern Lorebook verification, paging, and human tree stay exact for a large book',()=>{
  const {snapshot,book}=loreFixture();
  const verification=verifySelectedLorebook({selectedSnapshot:snapshot,ownerBook:book});
  assert.equal(verification.verified,true);
  assert.equal(verification.matchedEntries,105);
  const page=buildExactLoreEntries({selectedSnapshot:snapshot,ownerBook:book,page:3,pageSize:24});
  assert.equal(page.total,105);
  assert.equal(page.rows.length,24);
  assert.equal(page.rows[0].sourceRevisionId,'rev-72');
  assert.equal(page.rows[0].content,'Exact authored content 72');
  const tree=buildHumanLoreTree(snapshot.entries,{maxNodes:160});
  assert.ok(tree.nodeCount>10);
  assert.ok(tree.rows.some(row=>row.path.join('/')==='World/District 0/Topic 0'));
});

test('UI proposal model covers all seven requested operations without granting mutation authority',()=>{
  const caps={sourceMutation:true,lifecycle:true,tree:true,mergeLifecycle:true};
  const paths=new Map();
  for(const proposalKind of Object.values(LoreReviewProposalKind)){
    const proposal=createLoreReviewProposal({
      proposalKind,lorebookId:'book-1',sourceId:'lore:book-1:alpha',baseSourceRevisionId:'rev-alpha',
      uid:'alpha',targetSourceIds:['lore:book-1:beta'],title:'Alpha',content:'bounded after content',
      targetTreePath:['World','People'],reason:'reviewed proposal',evidenceSourceIds:['lore:book-1:alpha'],
      provenanceRefs:['claim:1'],scope:'chat-1',temporalState:'CURRENT',contradictionState:'UNRESOLVED',
      before:{title:'Alpha',content:'before content',sourceRevisionId:'rev-alpha',treePath:['World','Old']},
      after:{title:'Alpha',content:'after content',treePath:['World','People']},
    });
    assert.equal(proposal.mutationAuthority,false);
    assert.equal(proposal.commitState,'DRAFT_NOT_SUBMITTED');
    paths.set(proposalKind,proposalOwnerPath(proposal,caps));
  }
  assert.equal(paths.get('CREATE_ENTRY'),LoreReviewOwnerPath.SOURCE_MUTATION);
  assert.equal(paths.get('UPDATE_ENTRY'),LoreReviewOwnerPath.SOURCE_MUTATION);
  assert.equal(paths.get('DELETE_ENTRY'),LoreReviewOwnerPath.SOURCE_MUTATION);
  assert.equal(paths.get('MOVE_ENTRY'),LoreReviewOwnerPath.TREE_REVIEW);
  assert.equal(paths.get('PLACE_ENTRY'),LoreReviewOwnerPath.TREE_REVIEW);
  assert.equal(paths.get('MERGE_ENTRIES'),LoreReviewOwnerPath.MERGE_REVIEW);
  assert.equal(paths.get('SPLIT_ENTRY'),LoreReviewOwnerPath.OWNER_CONTRACT_MISSING);
});

test('typed adapter calls Worker 4 reviewed source-mutation seam and never invents a direct canon writer',()=>{
  const calls=[];
  const host={
    contractVersion:2,
    read:{
      sourceDiscoveryIdentity:()=>({kind:'LoreSourceDiscoverySurface',books:[]}),
      reviewStates:()=>({kind:'LoreAuthoringReviewStateContract'}),
      worker1InvalidationContract:()=>({kind:'LoreSourceRevisionRetrievalInvalidationContract'}),
      worker3AuthoringContract:()=>({kind:'LoreAuthoringOperatorContract',contractVersion:2}),
      progress:()=>({stage:'DRAFT_REVIEW'}),draftReview:()=>({actions:[]}),finalPreview:()=>null,settlement:()=>null,
      adaptiveNavigation:()=>({kind:'AdaptiveLoreNavigationPreview',previewOnly:true}),
    },
    actions:{
      previewEditImpact:()=>({kind:'LoreEditImpactPreview'}),proposeTree:()=>({kind:'LoreStructurePlan'}),previewMerge:()=>({kind:'LoreMergePreview'}),
      startSourceMutationBuild:(payload)=>{calls.push(['source',payload]);return{sessionId:'source-session'};},
      rebuildAffectedNavigation:(payload)=>{calls.push(['rebuild',payload]);return{affectedScopeIds:['tree:people']};},
      startTreeBuild:()=>({sessionId:'tree-session'}),startMergeBuild:()=>({sessionId:'merge-session'}),resumeAuthoringBuild:()=>({}),
      recordDraftDecision:(payload)=>{calls.push(['decision',payload]);return{decision:payload.decision};},
      reclassifyAfterTaxonomyEdit:()=>({}),computeFinalPreview:()=>({validation:{ok:true}}),approveFinalPreview:()=>({readyForApproval:true}),
      applySettlement:()=>({settlementId:'settle-1',state:'SETTLED'}),restoreSettlement:()=>({state:'RESTORED'}),
    },
  };
  const adapter=new Wave13LoreAuthoringUIAdapter({bindings:{loreAuthoringHost:host}});
  assert.equal(adapter.capabilities().sourceMutation,true);
  assert.equal(adapter.capabilities().adaptiveNavigation,true);
  assert.equal(adapter.capabilities().incrementalNavigationRebuild,true);
  const proposal=createLoreReviewProposal({proposalKind:'UPDATE_ENTRY',lorebookId:'book-1',sourceId:'lore:book-1:alpha',baseSourceRevisionId:'rev-a',content:'new text',title:'Alpha',targetTreePath:['World'],evidenceSourceIds:['lore:book-1:alpha']});
  const owner=toOwnerSourceMutationProposal(proposal);
  const started=adapter.startSourceMutationBuild({chatId:'chat-1',proposals:[owner]});
  assert.equal(started.ok,true);
  assert.equal(started.value.sessionId,'source-session');
  assert.equal(calls[0][1].proposals[0].expectedSourceRevisionId,'rev-a');
  assert.equal(typeof host.actions.writeLorebook,'undefined');
  assert.equal(typeof host.actions.updateEntry,'undefined');
  adapter.recordDecision({sessionId:'source-session',actionId:'a1',decision:'ACCEPT'});
  assert.equal(calls.at(-1)[1].decision,'ACCEPT');
});

test('active Worker 4 partial contract is explicit when source mutation is absent',()=>{
  const adapter=new Wave13LoreAuthoringUIAdapter({bindings:{loreAuthoringHost:{contractVersion:2,read:{sourceDiscoveryIdentity:()=>({books:[]})},actions:{proposeTree:()=>({})}}}});
  assert.equal(adapter.capabilities().sourceMutation,false);
  const result=adapter.startSourceMutationBuild({chatId:'chat-1',proposals:[]});
  assert.equal(result.ok,false);
  assert.equal(result.error.code,'LORE_AUTHORING_SOURCE_MUTATION_UNAVAILABLE');
});

test('before/after evidence summary is bounded and preserves revision/provenance/scope/conflict/rebuild metadata',()=>{
  const long='x'.repeat(5000);
  const summary=summarizeLoreReviewAction({
    id:'action-1',action:'UPDATE_ENTRY',inputSourceRevisions:['rev-a'],
    affectedTreeNodes:['tree:people'],dependencyArea:['summary:people','index:alpha'],
    evidenceReceipt:{exactSourceRevisions:['rev-a'],learnedEvidenceRefs:['claim:alpha'],scope:'chat-1',temporalState:'CURRENT',contradictionState:'UNRESOLVED'},
    before:{title:'Alpha',content:long,sourceRevisionId:'rev-a',treePath:['World','Old']},
    proposedOutput:{after:{title:'Alpha',content:'after',treePath:['World','People']}},
  },{contentLimit:300});
  assert.equal(summary.before.content.length,300);
  assert.deepEqual(summary.sourceRevisionRefs,['rev-a']);
  assert.deepEqual(summary.provenanceRefs,['claim:alpha']);
  assert.equal(summary.scope,'chat-1');
  assert.equal(summary.contradictionState,'UNRESOLVED');
  assert.deepEqual(summary.dependencyArea,['summary:people','index:alpha']);
  assert.equal(summary.previewOnly,true);
});

test('restudy progress distinguishes successful commit follow-up from ready state',()=>{
  const pending=loreRestudyProgress({data:{operatorCounts:{ACCEPTED:1,STUDYING:1,READY:2,FAILED:0},entries:[{},{},{},{}]}});
  assert.equal(pending.complete,false);
  const ready=loreRestudyProgress({data:{operatorCounts:{ACCEPTED:0,STUDYING:0,READY:4,FAILED:0},entries:[{},{},{},{}]}});
  assert.equal(ready.complete,true);
});

test('rendered workflow labels missing owner source-mutation contract and never presents preview as committed',()=>{
  const {snapshot,book}=loreFixture(12);
  const doc=new Doc(),host=new Node('div',doc);
  const loreStudy={
    selectedLorebook:()=>({selection:{selected:true,chatId:'chat-1'},snapshot}),
    read:()=>({source:{selection:{chatId:'chat-1'}},data:{entries:[],operatorCounts:{ACCEPTED:0,STUDYING:0,READY:0,FAILED:0}}}),
    capabilities:()=>({run:true}),
  };
  const loreAuthoring={
    capabilities:()=>({discovery:true,sourceMutation:false,adaptiveNavigation:false,tree:true,lifecycle:true,settlement:true,mergeLifecycle:true}),
    snapshot:()=>({last:{discovery:{ok:true,value:{books:[book]}},tree:null}}),
    authoringProgress:()=>({ok:false}),draftReview:()=>({ok:false}),finalPreview:()=>({ok:false}),settlement:()=>({ok:false}),
  };
  renderLoreReviewWorkspace(host,{loreStudy,loreAuthoring,actionRouter:{route:async()=>({ok:true,result:{ok:true,value:{}}})},scope:{listen:(node,type,fn)=>node.addEventListener(type,fn)},refresh:()=>{},productAdapter:{getDetailLevel:()=> 'NORMAL'}});
  const text=allText(host);
  assert.match(text,/Lore authoring review/);
  assert.match(text,/Selected Lorebook verified/);
  assert.match(text,/Source-mutation integration pending/);
  assert.match(text,/PREVIEW · NOT COMMITTED/);
  assert.doesNotMatch(text,/COMMITTED BY OWNER/);
});
