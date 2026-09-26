import { ProductDetailLevel } from './wave5-product-model.js';
import { createButton, createKeyValue, createProgressBar, element, makeBadge } from './primitives.js';
import {
  LoreReviewOwnerPath, LoreReviewProposalKind, buildExactLoreEntries, buildHumanLoreTree,
  createLoreReviewProposal, loreRestudyProgress, proposalOwnerPath, summarizeLoreReviewAction,
  toOwnerSourceMutationProposal, verifySelectedLorebook,
} from './lore-review-workflow.js';

const SOURCE_KINDS=new Set(['CREATE_ENTRY','UPDATE_ENTRY','DELETE_ENTRY']);
const TREE_KINDS=new Set(['MOVE_ENTRY','PLACE_ENTRY']);
const ALL_KINDS=Object.values(LoreReviewProposalKind);
const PAGE_SIZE=24;
const REVIEW_PAGE_SIZE=12;

export function createLoreReviewUiState(){
  return{
    bookId:null,sourceId:null,secondSourceId:null,entryQuery:'',entryPage:0,reviewPage:0,
    proposalKind:'UPDATE_ENTRY',proposalTitle:'',proposalContent:'',proposalTreePath:'',proposalReason:'',
    queuedProposals:[],sessionId:null,settlementId:null,mergeBookId:null,mergeOutputId:'',status:'',
  };
}

export function renderLoreReviewWorkspace(host,{loreStudy,loreAuthoring,actionRouter,scope,refresh,productAdapter,draft=null}={}){
  const d=host.ownerDocument,state=ensureState(draft??createLoreReviewUiState()),detail=productAdapter?.getDetailLevel?.()??ProductDetailLevel.NORMAL;
  const section=element(d,'section',{className:'a52-lore-review-workspace',attrs:{'aria-label':'Lore authoring and review'}});
  const caps=loreAuthoring?.capabilities?.()??{},ownerSnapshot=loreAuthoring?.snapshot?.()??{last:{}};
  const discovery=valueOf(ownerSnapshot.last?.discovery),books=discovery?.books??[];
  const selected=loreStudy?.selectedLorebook?.()??{},selectedSnapshot=selected.snapshot??null;
  const loreRead=loreStudy?.read?.()??null;
  const chatId=loreRead?.source?.selection?.chatId??selected.selection?.chatId??null;

  section.append(workspaceHeader(d,caps));
  if(!loreAuthoring){
    section.append(message(d,'Owner authoring contract unavailable','Worker 4 authoring reads/actions are not exported by this assembly. No proposal can be approved or committed from the UI.','offline'));
    host.append(section);return;
  }

  const topActions=element(d,'div',{className:'a52-wave13-resource-actions'});
  topActions.append(createButton(d,{label:books.length?'Refresh owner source identity':'Load owner source identity',scope,size:'sm',variant:'quiet',disabled:!caps.discovery,onPress:async()=>{
    const route=await actionRouter.route({type:'wave13.loreAuthoring.discover',payload:{}});
    state.status=routeMessage(route,'Worker 4 source identity refreshed.');refresh?.();
  }}));
  section.append(topActions);
  if(!caps.sourceMutation)section.append(message(d,'Source-mutation integration pending','The active Worker 4 assembly does not currently export startSourceMutationBuild(). Create/update/delete proposals remain reviewable UI drafts but cannot enter an owner-reviewed mutation session until that contract is republished.','warning'));
  if(!caps.adaptiveNavigation)section.append(message(d,'Adaptive navigation read pending','The UI can browse the exact SillyTavern tree and Worker 4 Tree proposals. The richer adaptiveNavigation read model is not exported by this assembly yet.','historical'));

  if(!books.length){
    section.append(message(d,'No owner authoring sources loaded',state.status||'Load Worker 4 source identity after the selected SillyTavern Lorebook has been discovered and accepted.','historical'));
    host.append(section);return;
  }

  const selectedId=String(selectedSnapshot?.id??'');
  state.bookId=books.some(row=>row.lorebookId===state.bookId)?state.bookId:books.some(row=>String(row.lorebookId)===selectedId)?selectedId:books[0].lorebookId;
  const book=books.find(row=>row.lorebookId===state.bookId)??books[0],sources=book.sources??[];
  if(!sources.some(row=>row.sourceId===state.sourceId))state.sourceId=sources[0]?.sourceId??null;
  if(!sources.some(row=>row.sourceId===state.secondSourceId)||state.secondSourceId===state.sourceId)state.secondSourceId=sources.find(row=>row.sourceId!==state.sourceId)?.sourceId??null;
  const source=sources.find(row=>row.sourceId===state.sourceId)??null;
  const exact=selectedSnapshot?.id===book.lorebookId?(selectedSnapshot.entries??[]).find(row=>String(row.uid)===String(source?.uid)):null;
  syncProposalFields(state,source,exact);

  section.append(renderSourceBrowser(d,{state,book,books,sources,selectedSnapshot,scope,refresh,detail}));
  section.append(renderProposalComposer(d,{state,book,sources,source,exact,caps,chatId,actionRouter,scope,refresh}));
  section.append(renderOwnerImpactPreview(d,{state,source,loreAuthoring,actionRouter,scope,refresh,detail}));
  section.append(renderOwnerTreeBuilder(d,{state,book,loreAuthoring,actionRouter,scope,refresh,detail}));
  section.append(renderOwnerMergePreview(d,{state,book,books,loreAuthoring,actionRouter,scope,refresh,detail}));
  section.append(renderReviewLifecycle(d,{state,book,loreStudy,loreAuthoring,actionRouter,scope,refresh,detail,chatId}));

  if(state.status)section.append(element(d,'p',{className:'a52-wave13-form-status',attrs:{role:'status','aria-live':'polite'},text:state.status}));
  host.append(section);
}

function workspaceHeader(d,caps){
  const root=element(d,'div',{className:'a52-lore-review-workspace__header'});
  const head=element(d,'div',{className:'a52-wave13-section-head'});
  head.append(element(d,'h2',{text:'Lore authoring review'}),makeBadge(d,'PREVIEW · NOT COMMITTED','historical'),makeBadge(d,caps.lifecycle?'OWNER-REVIEWED FLOW':'REVIEW CONTRACT PARTIAL',caps.lifecycle?'ready':'warning'));
  root.append(head,element(d,'p',{className:'a52-muted',text:'Browse exact SillyTavern-authored Lore, prepare evidence-led proposals, and send approvals only through Worker 4’s revision-fenced review/Settlement contract. Preview cards are never committed canon.'}));
  return root;
}

function renderSourceBrowser(d,{state,book,books,sources,selectedSnapshot,scope,refresh,detail}){
  const root=element(d,'section',{className:'a52-card a52-lore-browser'});
  root.append(element(d,'div',{className:'a52-wave13-section-head'},element(d,'h3',{text:'1. Source identity · selected Lorebook · exact entries · human tree'}),makeBadge(d,'AUTHORED SOURCE','observed')));
  const verification=verifySelectedLorebook({selectedSnapshot,ownerBook:book});
  root.append(message(d,verification.verified?'Selected Lorebook verified':'Lorebook verification incomplete',verification.reason,verification.verified?'ready':verification.state==='LOREBOOK_MISMATCH'||verification.state==='SOURCE_SET_MISMATCH'?'warning':'historical'));
  root.append(createKeyValue(d,[
    {key:'SillyTavern Lorebook',value:selectedSnapshot?.title??selectedSnapshot?.id??'Not loaded'},
    {key:'Owner Lorebook',value:book.title??book.lorebookId},{key:'Lorebook ID',value:book.lorebookId},
    {key:'Exact authored entries',value:selectedSnapshot?.entries?.length??'Not loaded'},{key:'Owner source identities',value:sources.length},
    {key:'Matched source UIDs',value:verification.matchedEntries??0},{key:'Discovery receipt persisted',value:book.discoveryIdentityPersisted?'Yes':'No'},
  ]));

  const controls=element(d,'div',{className:'a52-lore-browser__controls'});
  const bookSelect=field(d,'select','Lorebook to review');for(const row of books)bookSelect.append(option(d,row.lorebookId,row.title??row.lorebookId));bookSelect.value=book.lorebookId;
  const search=field(d,'input','Filter exact Lore entries',{type:'search',placeholder:'Filter title, UID, path, key, or text'});search.value=state.entryQuery??'';
  listen(scope,bookSelect,'change',()=>{state.bookId=bookSelect.value;state.sourceId=null;state.secondSourceId=null;state.entryPage=0;state.proposalSourceId=null;refresh?.();});
  listen(scope,search,'input',()=>{state.entryQuery=String(search.value??'');state.entryPage=0;refresh?.();});
  controls.append(labelWrap(d,'Lorebook',bookSelect),labelWrap(d,'Filter entries',search));root.append(controls);

  const page=buildExactLoreEntries({selectedSnapshot:selectedSnapshot?.id===book.lorebookId?selectedSnapshot:null,ownerBook:book,query:state.entryQuery,page:state.entryPage,pageSize:PAGE_SIZE});
  const tree=buildHumanLoreTree(selectedSnapshot?.id===book.lorebookId?(selectedSnapshot.entries??[]):[],{maxNodes:200});
  const split=element(d,'div',{className:'a52-lore-browser__split'});
  const treePanel=element(d,'section',{className:'a52-lore-browser__tree'});
  treePanel.append(element(d,'strong',{text:'Human tree'}),element(d,'p',{className:'a52-muted',text:'Author-facing organization only. One source may participate in additional semantic/navigation paths without this tree becoming truth.'}));
  if(tree.rows.length){
    const list=element(d,'div',{className:'a52-lore-tree-list',attrs:{role:'tree'}});
    for(const row of tree.rows){const node=element(d,'div',{className:'a52-lore-tree-row',attrs:{role:'treeitem','aria-level':String(row.depth+1)},dataset:{depth:String(row.depth)}});node.append(element(d,'span',{text:'›'.repeat(Math.min(row.depth,5))+' '+row.label}),makeBadge(d,String(row.entryCount),'observed'));list.append(node);}treePanel.append(list);
  }else treePanel.append(element(d,'p',{className:'a52-muted',text:'Load the matching selected SillyTavern Lorebook to browse its authored tree.'}));

  const entryPanel=element(d,'section',{className:'a52-lore-browser__entries'});
  const pager=element(d,'div',{className:'a52-wave13-section-head'});pager.append(element(d,'strong',{text:'Exact authored entries · '+page.total}));
  const pagerActions=element(d,'div',{className:'a52-wave13-resource-actions'});
  pagerActions.append(createButton(d,{label:'Previous',scope,size:'sm',variant:'quiet',disabled:page.page<=0,onPress:()=>{state.entryPage=Math.max(0,page.page-1);refresh?.();}}),createButton(d,{label:'Next',scope,size:'sm',variant:'quiet',disabled:page.page>=page.pages-1,onPress:()=>{state.entryPage=Math.min(page.pages-1,page.page+1);refresh?.();}}));
  pager.append(pagerActions);entryPanel.append(pager,element(d,'p',{className:'a52-muted',text:'Page '+String(page.page+1)+' / '+String(page.pages)+'. Content is bounded in the review window; authored canon is not copied into telemetry/export.'}));
  const list=element(d,'div',{className:'a52-lore-entry-table'});
  for(const row of page.rows){
    const button=element(d,'button',{className:'a52-lore-entry-row',attrs:{type:'button','aria-label':'Select authored Lore entry '+row.title},dataset:{selected:String(row.sourceId===state.sourceId)}});
    button.append(element(d,'strong',{text:row.title}),element(d,'span',{text:row.treePath.join(' / ')||'Unplaced'}),element(d,'code',{text:detail===ProductDetailLevel.ADVANCED?(row.sourceRevisionId??row.uid):row.uid}));
    listen(scope,button,'click',()=>{if(row.sourceId){state.sourceId=row.sourceId;state.proposalSourceId=null;refresh?.();}});list.append(button);
  }
  entryPanel.append(list);split.append(treePanel,entryPanel);root.append(split);
  return root;
}

function renderProposalComposer(d,{state,book,sources,source,exact,caps,chatId,actionRouter,scope,refresh}){
  const root=element(d,'section',{className:'a52-card a52-lore-proposal-composer'});
  root.append(element(d,'div',{className:'a52-wave13-section-head'},element(d,'h3',{text:'2. Evidence-led proposal queue'}),makeBadge(d,'PREVIEW · NOT COMMITTED','historical')),
    element(d,'p',{className:'a52-muted',text:'Draft create/update/delete/merge/split/move/place proposals locally. Approval is disabled unless Worker 4 publishes the matching owner-reviewed action path.'}));

  const grid=element(d,'div',{className:'a52-lore-proposal-form'});
  const kind=field(d,'select','Proposal operation');for(const value of ALL_KINDS)kind.append(option(d,value,human(value)));kind.value=state.proposalKind;
  const sourceSelect=field(d,'select','Primary source');for(const row of sources)sourceSelect.append(option(d,row.sourceId,row.metadata?.title??row.uid??row.sourceId));sourceSelect.value=source?.sourceId??'';
  const second=field(d,'select','Secondary source');second.append(option(d,'','None'));for(const row of sources.filter(x=>x.sourceId!==source?.sourceId))second.append(option(d,row.sourceId,row.metadata?.title??row.uid??row.sourceId));second.value=state.secondSourceId??'';
  const title=field(d,'input','Proposed title',{type:'text',placeholder:'Title'});title.value=state.proposalTitle??'';
  const path=field(d,'input','Target human tree path',{type:'text',placeholder:'World / Region / Topic'});path.value=state.proposalTreePath??'';
  const reason=field(d,'input','Proposal reason',{type:'text',placeholder:'Why this change is being proposed'});reason.value=state.proposalReason??'';
  const content=field(d,'textarea','Proposed authored content',{rows:'6',placeholder:'Proposed authored text. This local preview never writes SillyTavern.'});content.value=state.proposalContent??'';
  listen(scope,kind,'change',()=>{state.proposalKind=kind.value;syncProposalFields(state,source,exact,true);refresh?.();});
  listen(scope,sourceSelect,'change',()=>{state.sourceId=sourceSelect.value;state.proposalSourceId=null;refresh?.();});
  listen(scope,second,'change',()=>{state.secondSourceId=second.value||null;});
  listen(scope,title,'input',()=>state.proposalTitle=String(title.value??''));listen(scope,path,'input',()=>state.proposalTreePath=String(path.value??''));listen(scope,reason,'input',()=>state.proposalReason=String(reason.value??''));listen(scope,content,'input',()=>state.proposalContent=String(content.value??''));
  grid.append(labelWrap(d,'Operation',kind),labelWrap(d,'Primary source',sourceSelect),labelWrap(d,'Secondary source',second),labelWrap(d,'Title',title),labelWrap(d,'Target tree path',path),labelWrap(d,'Reason',reason),labelWrap(d,'Proposed content',content));

  const queue=createButton(d,{label:'Queue proposal for review',scope,onPress:()=>{
    try{
      const current=sources.find(row=>row.sourceId===state.sourceId)??source,entry=exact;
      const proposal=createLoreReviewProposal({
        proposalKind:state.proposalKind,lorebookId:book.lorebookId,sourceId:current?.sourceId,baseSourceRevisionId:current?.sourceRevisionId,uid:state.proposalKind==='CREATE_ENTRY'?(state.proposalUid||state.proposalTitle||'new-entry'):current?.uid,
        targetSourceIds:[state.secondSourceId].filter(Boolean),title:state.proposalTitle,content:state.proposalContent,targetTreePath:state.proposalTreePath,reason:state.proposalReason,
        evidenceSourceIds:[current?.sourceId,state.secondSourceId].filter(Boolean),provenanceRefs:current?.metadata?.provenanceRefs??[],scope:chatId,
        temporalState:current?.metadata?.temporalState,contradictionState:current?.metadata?.contradictionState,
        before:entry?{...entry,sourceId:current?.sourceId,sourceRevisionId:current?.sourceRevisionId}:null,
        after:state.proposalKind==='DELETE_ENTRY'?null:{title:state.proposalTitle||entry?.comment||entry?.title,uid:current?.uid,sourceId:current?.sourceId,sourceRevisionId:current?.sourceRevisionId,content:state.proposalContent,treePath:state.proposalTreePath},
      });
      state.queuedProposals=[...state.queuedProposals,proposal].slice(-80);state.status='Queued '+human(proposal.proposalKind)+' as a preview. No owner mutation has occurred.';refresh?.();
    }catch(error){state.status='Proposal draft failed: '+String(error?.message??error);refresh?.();}
  }});
  grid.append(queue);root.append(grid);

  if(state.queuedProposals.length){
    const queueList=element(d,'div',{className:'a52-lore-proposal-queue'});
    for(const proposal of state.queuedProposals.slice(-40)){
      const pathState=proposalOwnerPath(proposal,caps),card=element(d,'article',{className:'a52-card a52-lore-proposal-card'});
      card.append(element(d,'div',{className:'a52-wave13-section-head'},element(d,'strong',{text:human(proposal.proposalKind)}),makeBadge(d,'PREVIEW · NOT COMMITTED','historical')),
        createKeyValue(d,[
          {key:'Source revision',value:proposal.baseSourceRevisionId??'New source'},{key:'Owner path',value:human(pathState)},
          {key:'Scope',value:proposal.scope??'Not published'},{key:'Temporal',value:proposal.temporalState??'Not published'},{key:'Contradiction',value:proposal.contradictionState??'Not published'},
          {key:'Target tree',value:proposal.targetTreePath?.join(' / ')||'Unchanged / owner decides'},{key:'Provenance refs',value:proposal.provenanceRefs?.length??0},
        ]));
      const compare=element(d,'div',{className:'a52-lore-before-after'});
      compare.append(previewBox(d,'Before',proposal.before),previewBox(d,'After',proposal.after));card.append(compare);
      if(pathState===LoreReviewOwnerPath.OWNER_CONTRACT_MISSING)card.append(message(d,'Owner action unavailable','This proposal remains a UI draft. Worker 3 will not translate it into a direct Lorebook write or a different owner action.','warning'));
      queueList.append(card);
    }
    const queueActions=element(d,'div',{className:'a52-wave13-resource-actions'});
    const sourceProposals=state.queuedProposals.filter(row=>SOURCE_KINDS.has(row.proposalKind));
    queueActions.append(createButton(d,{label:'Start owner-reviewed source session',scope,disabled:!caps.sourceMutation||!sourceProposals.length||Boolean(state.sessionId),onPress:async()=>{
      let payload;try{payload=sourceProposals.map(toOwnerSourceMutationProposal);}catch(error){state.status=String(error?.message??error);refresh?.();return;}
      const route=await actionRouter.route({type:'wave13.loreAuthoring.startSourceMutationBuild',payload:{chatId,proposals:payload}});
      const value=routeValue(route);if(value?.sessionId)state.sessionId=value.sessionId;state.status=routeMessage(route,'Worker 4 source-mutation review session started. Canon is still unchanged.');refresh?.();
    }}),createButton(d,{label:'Clear local proposal queue',scope,size:'sm',variant:'quiet',onPress:()=>{state.queuedProposals=[];state.status='Cleared local proposals. No owner state was changed.';refresh?.();}}));
    root.append(queueList,queueActions);
  }
  return root;
}

function renderOwnerImpactPreview(d,{state,source,loreAuthoring,actionRouter,scope,refresh,detail}){
  const root=element(d,'section',{className:'a52-card a52-lore-owner-impact'});
  root.append(element(d,'div',{className:'a52-wave13-section-head'},element(d,'h3',{text:'3. Edit-impact preview'}),makeBadge(d,'OWNER PREVIEW · NOT COMMITTED','historical')),
    element(d,'p',{className:'a52-muted',text:'Ask Worker 4 to evaluate the currently drafted source edit. This preview may describe semantic/invalidation impact but cannot mutate authored canon.'}));
  const caps=loreAuthoring.capabilities();
  root.append(createButton(d,{label:'Preview edit impact with Worker 4',scope,size:'sm',disabled:!caps.previewEdit||!source||!String(state.proposalContent??'').trim(),onPress:async()=>{
    const route=await actionRouter.route({type:'wave13.loreAuthoring.previewEdit',payload:{sourceId:source.sourceId,content:String(state.proposalContent??'')}});
    state.status=routeMessage(route,'Worker 4 edit-impact preview refreshed. No source revision was applied.');refresh?.();
  }}));
  const preview=valueOf(loreAuthoring.snapshot?.().last?.edit);
  if(preview){
    const change=preview.semanticChange??{},claims=change.claims??{},rels=change.relationships??{},plan=change.invalidationPlan??{};
    root.append(createKeyValue(d,[
      {key:'Base source revision',value:preview.baseSourceRevisionId??source?.sourceRevisionId??'Not published'},
      {key:'Proposed revision',value:preview.proposedSourceRevisionId??'Preview only'},
      {key:'Claims added / altered / superseded',value:[claims.added?.length??0,claims.altered?.length??0,claims.superseded?.length??0].join(' / ')},
      {key:'Relationships added / removed',value:[rels.added?.length??0,rels.removed?.length??0].join(' / ')},
      {key:'Dependency / rebuild area',value:(plan.targets??[]).map(row=>row?.target??row).slice(0,20).join(', ')||'None published'},
      {key:'Unrelated ready sources remain ready',value:preview.allPreviouslyReadyUnrelatedSourcesRemainReady?'Yes':'No / not proven'},
    ]));
    if(detail===ProductDetailLevel.ADVANCED&&preview.semanticChange?.provenanceRefs)root.append(createKeyValue(d,[{key:'Provenance refs',value:preview.semanticChange.provenanceRefs.slice(0,24).join(', ')}]));
  }
  return root;
}

function renderOwnerTreeBuilder(d,{state,book,loreAuthoring,actionRouter,scope,refresh,detail}){
  const root=element(d,'section',{className:'a52-card a52-lore-owner-tree'});
  root.append(element(d,'div',{className:'a52-wave13-section-head'},element(d,'h3',{text:'4. Tree Builder proposal'}),makeBadge(d,'OWNER PROPOSALS','observed')),
    element(d,'p',{className:'a52-muted',text:'Worker 4 owns taxonomy/placement generation and revision fences. The UI reviews proposals; Tree placement remains author-facing navigation rather than semantic truth.'}));
  const caps=loreAuthoring.capabilities();
  const actions=element(d,'div',{className:'a52-wave13-resource-actions'});
  actions.append(createButton(d,{label:'Refresh Tree proposal',scope,disabled:!caps.tree,onPress:async()=>{const route=await actionRouter.route({type:'wave13.loreAuthoring.proposeTree',payload:{lorebookIds:[book.lorebookId]}});state.status=routeMessage(route,'Worker 4 Tree proposal refreshed.');refresh?.();}}));
  if(caps.lifecycle)actions.append(createButton(d,{label:'Start reviewed Tree build',scope,disabled:Boolean(state.sessionId),onPress:async()=>{const route=await actionRouter.route({type:'wave13.loreAuthoring.startTreeBuild',payload:{lorebookIds:[book.lorebookId]}});const value=routeValue(route);if(value?.sessionId)state.sessionId=value.sessionId;state.status=routeMessage(route,'Worker 4 Tree review session started.');refresh?.();}}));
  root.append(actions);
  const treePlan=valueOf(loreAuthoring.snapshot?.().last?.tree);
  if(treePlan){
    root.append(createKeyValue(d,[{key:'Proposal count',value:treePlan.proposals?.length??0},{key:'Review items',value:treePlan.reviewItems?.length??0},{key:'Revision fence',value:(treePlan.sourceRevisionFence??[]).length},{key:'Mutation authority',value:treePlan.mutationAuthority?'Unexpectedly granted':'Not granted'}]));
    const list=element(d,'div',{className:'a52-lore-tree-proposals'});
    for(const row of (treePlan.proposals??[]).slice(0,40)){
      const card=element(d,'article',{className:'a52-wave13-flow-row'});
      card.append(makeBadge(d,human(row.state??'NEEDS_REVIEW'),'historical'),element(d,'strong',{text:human(row.action)}),element(d,'span',{text:row.rationale??'Owner proposal'}));list.append(card);
    }root.append(list);
    if(detail===ProductDetailLevel.ADVANCED)root.append(createKeyValue(d,[{key:'Plan ID',value:treePlan.planId??'—'},{key:'Fence refs',value:(treePlan.sourceRevisionFence??[]).slice(0,20).join(', ')||'none'}]));
  }
  return root;
}

function renderOwnerMergePreview(d,{state,book,books,loreAuthoring,actionRouter,scope,refresh,detail}){
  const root=element(d,'section',{className:'a52-card a52-lore-owner-merge'});
  root.append(element(d,'div',{className:'a52-wave13-section-head'},element(d,'h3',{text:'5. Merge / reconciliation preview'}),makeBadge(d,'OWNER PREVIEW · NOT COMMITTED','historical')),
    element(d,'p',{className:'a52-muted',text:'Compare studied Lorebooks through Worker 4. Similarity and reconciliation are advisory until the reviewed lifecycle reaches a successful owner Settlement.'}));
  const others=(books??[]).filter(row=>row.lorebookId!==book.lorebookId),select=field(d,'select','Merge comparison lorebook');
  select.append(option(d,'','Choose second Lorebook'));for(const row of others)select.append(option(d,row.lorebookId,row.title??row.lorebookId));select.value=state.mergeBookId??'';
  const button=createButton(d,{label:'Preview merge reconciliation',scope,disabled:!loreAuthoring.capabilities().merge||!state.mergeBookId,onPress:async()=>{
    const route=await actionRouter.route({type:'wave13.loreAuthoring.previewMerge',payload:{lorebookIds:[book.lorebookId,state.mergeBookId]}});
    state.status=routeMessage(route,'Worker 4 merge reconciliation preview refreshed. No source was committed.');refresh?.();
  }});
  listen(scope,select,'change',()=>{state.mergeBookId=select.value||null;button.disabled=!loreAuthoring.capabilities().merge||!state.mergeBookId;});
  root.append(labelWrap(d,'Compare with',select),button);
  const preview=valueOf(loreAuthoring.snapshot?.().last?.merge);
  if(preview){
    const cls=preview.classifications??{},validation=preview.validation??{};
    root.append(createKeyValue(d,[
      {key:'Unique semantic facts retained',value:validation.retainedEverySemanticFact?'Yes':'No'},
      {key:'Every current source mapped',value:validation.mappedEveryCurrentSource?'Yes':'No'},
      {key:'Contradictions kept separate',value:validation.preservedContradictionsSeparately?'Yes':'No'},
      {key:'Exact duplicates',value:cls.exactDuplicates?.length??0},{key:'Likely overlap',value:cls.likelyOverlap?.length??0},
      {key:'Complementary',value:cls.complementary?.length??0},{key:'Title/key collisions',value:cls.titleKeyCollisions?.length??0},
      {key:'Unresolved contradictions',value:cls.unresolvedContradictions?.length??0},
    ]));
    if(detail===ProductDetailLevel.ADVANCED)root.append(createKeyValue(d,[{key:'Preview ID',value:preview.previewId??'—'},{key:'Source revision fence',value:(preview.sourceRevisionFence??[]).slice(0,24).join(', ')||'none'}]));
  }
  if(!loreAuthoring.capabilities().lifecycle)root.append(message(d,'No destructive Apply action','This assembly exposes proposal/reconciliation previews only. Worker 3 intentionally offers no direct Apply path without Worker 4 Draft Review → Final Preview → Settlement.','historical'));
  return root;
}

function renderReviewLifecycle(d,{state,book,loreStudy,loreAuthoring,actionRouter,scope,refresh,detail,chatId}){
  const root=element(d,'section',{className:'a52-card a52-lore-review-lifecycle'});
  root.append(element(d,'div',{className:'a52-wave13-section-head'},element(d,'h3',{text:'6. Draft Review → Final Preview → owner Settlement'}),makeBadge(d,state.sessionId?'REVIEW SESSION':'NO ACTIVE SESSION',state.sessionId?'observed':'historical')),
    element(d,'p',{className:'a52-muted',text:'Approve means “record ACCEPT with Worker 4.” It does not mean committed. Only a successful owner Settlement receipt is shown as committed.'}));
  if(!state.sessionId){root.append(message(d,'No active reviewed session','Queue owner-supported source proposals or start Worker 4 Tree Builder above.','historical'));return root;}

  const progress=valueOf(loreAuthoring.authoringProgress({sessionId:state.sessionId}));
  if(!progress){root.append(message(d,'Review session unavailable','Worker 4 did not return progress. No approval or apply control is enabled.','warning'));return root;}
  if(progress.settlement?.settlementId)state.settlementId=progress.settlement.settlementId;
  const stale=progress.stale?.reason??null;
  root.append(createKeyValue(d,[
    {key:'Session',value:state.sessionId},{key:'Type',value:progress.type??'—'},{key:'Stage',value:human(progress.stage??'UNKNOWN')},
    {key:'Build',value:String(progress.build?.cursor??0)+' / '+String(progress.build?.total??progress.totalActions??0)},
    {key:'Draft revision',value:progress.draftRevision??'—'},{key:'Revision/scope fence',value:stale?'STALE · '+stale:'Current'},
  ]));
  if(stale)root.append(message(d,'Revision or scope conflict',String(stale)+'. Revalidation has failed; the previous preview cannot be treated as approved or committed.','warning'));
  if(progress.lastError)root.append(message(d,'Owner review failure',progress.lastError.message??progress.lastError.code??'Worker 4 reported an authoring failure.','warning'));

  if(['BUILDING','CHECKPOINTED'].includes(String(progress.stage))&&!progress.settlement)root.append(createButton(d,{label:'Resume owner build checkpoint',scope,onPress:async()=>{const route=await actionRouter.route({type:'wave13.loreAuthoring.resumeBuild',payload:{sessionId:state.sessionId,maxActions:32}});state.status=routeMessage(route,'Owner build checkpoint advanced.');refresh?.();}}));

  const draft=valueOf(loreAuthoring.draftReview({sessionId:state.sessionId}));
  if(draft?.actions?.length){
    const pages=Math.max(1,Math.ceil(draft.actions.length/REVIEW_PAGE_SIZE));state.reviewPage=Math.max(0,Math.min(pages-1,state.reviewPage||0));
    const visible=draft.actions.slice(state.reviewPage*REVIEW_PAGE_SIZE,(state.reviewPage+1)*REVIEW_PAGE_SIZE);
    const nav=element(d,'div',{className:'a52-wave13-section-head'});
    nav.append(element(d,'strong',{text:'Draft Review · '+draft.actions.length+' proposals · page '+String(state.reviewPage+1)+' / '+String(pages)}));
    const navActions=element(d,'div',{className:'a52-wave13-resource-actions'});
    navActions.append(createButton(d,{label:'Previous',scope,size:'sm',variant:'quiet',disabled:state.reviewPage===0,onPress:()=>{state.reviewPage--;refresh?.();}}),createButton(d,{label:'Next',scope,size:'sm',variant:'quiet',disabled:state.reviewPage>=pages-1,onPress:()=>{state.reviewPage++;refresh?.();}}));nav.append(navActions);root.append(nav);

    const batch=element(d,'div',{className:'a52-wave13-resource-actions'});
    for(const [label,decision] of [['Approve page','ACCEPT'],['Reject page','REJECT'],['Defer page','DEFER']])batch.append(createButton(d,{label,scope,size:'sm',variant:decision==='ACCEPT'?'primary':'quiet',disabled:!visible.some(row=>!row.decision),onPress:async()=>{
      for(const action of visible.filter(row=>!row.decision)){
        const route=await actionRouter.route({type:'wave13.loreAuthoring.recordDecision',payload:{sessionId:state.sessionId,actionId:action.id,decision,operatorDecisionId:'ui:'+state.sessionId+':'+action.id+':'+decision}});
        if(!route?.ok||route.result?.ok===false){state.status=routeMessage(route,'');refresh?.();return;}
      }
      state.status=human(decision)+' recorded for the undecided proposals on this page. This is still review state, not a commit.';refresh?.();
    }}));root.append(batch);

    const list=element(d,'div',{className:'a52-lore-review-cards'});
    for(const action of visible){
      const summary=summarizeLoreReviewAction(action),card=element(d,'article',{className:'a52-card a52-lore-review-card'});
      card.append(element(d,'div',{className:'a52-wave13-section-head'},element(d,'strong',{text:human(summary.action??'Authoring action')}),makeBadge(d,action.decision?human(action.decision):'DECISION REQUIRED',action.decision?'observed':'warning'),makeBadge(d,summary.materialized?'MATERIALIZED BY OWNER':'PREVIEW · NOT COMMITTED',summary.materialized?'ready':'historical')));
      card.append(createKeyValue(d,[
        {key:'Source revision refs',value:summary.sourceRevisionRefs.length?summary.sourceRevisionRefs.join(', '):'NO_EVIDENCE'},
        {key:'Provenance / evidence refs',value:summary.provenanceRefs.length},{key:'Scope',value:summary.scope??chatId??'Not published'},
        {key:'Temporal',value:summary.temporalState??'Not published'},{key:'Contradiction',value:summary.contradictionState??'Not published'},
        {key:'Affected tree nodes',value:summary.affectedTreeNodes.join(', ')||'None published'},{key:'Dependency / rebuild area',value:summary.dependencyArea.join(', ')||'Not published'},
      ]));
      card.append(element(d,'p',{className:'a52-muted',text:summary.rationale??'Review this owner proposal against its exact source and dependency fences.'}));
      const compare=element(d,'div',{className:'a52-lore-before-after'});compare.append(previewBox(d,'Before',summary.before),previewBox(d,'After',summary.after));card.append(compare);
      if(!action.decision){
        const buttons=element(d,'div',{className:'a52-wave13-resource-actions'});
        for(const [label,decision] of [['Approve','ACCEPT'],['Reject','REJECT'],['Defer','DEFER']])buttons.append(createButton(d,{label,scope,size:'sm',variant:decision==='ACCEPT'?'primary':'quiet',onPress:async()=>{const route=await actionRouter.route({type:'wave13.loreAuthoring.recordDecision',payload:{sessionId:state.sessionId,actionId:action.id,decision,operatorDecisionId:'ui:'+state.sessionId+':'+action.id+':'+decision}});state.status=routeMessage(route,label+' recorded with Worker 4. No commit has occurred.');refresh?.();}}));card.append(buttons);
      }
      if(detail===ProductDetailLevel.ADVANCED&&summary.actionId)card.append(element(d,'code',{text:summary.actionId}));list.append(card);
    }root.append(list);
  }

  const allDecided=Boolean(draft?.actions?.length)&&draft.actions.every(action=>Boolean(action.decision));
  if(String(progress.stage)==='DRAFT_REVIEW'&&allDecided&&!stale)root.append(createButton(d,{label:'Compute revision-fenced Final Preview',scope,onPress:async()=>{const route=await actionRouter.route({type:'wave13.loreAuthoring.computeFinalPreview',payload:{sessionId:state.sessionId}});state.status=routeMessage(route,'Final Preview recomputed from current owner fences. Still not committed.');refresh?.();}}));

  const finalPreview=valueOf(loreAuthoring.finalPreview({sessionId:state.sessionId}));
  if(finalPreview){
    root.append(element(d,'div',{className:'a52-wave13-section-head'},element(d,'h4',{text:'Final Preview'}),makeBadge(d,'PREVIEW · NOT COMMITTED','historical')),
      createKeyValue(d,[{key:'Validation',value:finalPreview.validation?.ok?'PASS':'FAIL'},{key:'Operations',value:finalPreview.operations?.length??0},{key:'Semantic preflight',value:finalPreview.authoritativeSemanticPreflight?'PASS':'Not published / failed'},{key:'Explicit approval required',value:finalPreview.explicitApprovalRequired?'Yes':'No'},{key:'Final Preview ID',value:finalPreview.finalPreviewId??'—'}]));
    if(finalPreview.validation?.failures?.length)root.append(message(d,'Commit-time revalidation blocked',finalPreview.validation.failures.join(', '),'warning'));
  }
  if(String(progress.stage)==='FINAL_PREVIEW'&&finalPreview?.validation?.ok&&!stale)root.append(createButton(d,{label:'Approve current Final Preview',scope,onPress:async()=>{const route=await actionRouter.route({type:'wave13.loreAuthoring.approveFinalPreview',payload:{sessionId:state.sessionId,operatorApprovalId:'ui:final:'+state.sessionId+':'+String(progress.draftRevision??1)}});const value=routeValue(route);state.status=value?.readyForApproval===false?'Worker 4 rejected approval during revalidation: '+String(value?.stale?.reason??'owner revalidation failed') : routeMessage(route,'Worker 4 accepted the approval. Canon is still unchanged until Settlement succeeds.');refresh?.();}}));

  if(loreAuthoring.capabilities().settlement&&(String(progress.stage)==='READY_TO_SETTLE'||progress.settlement?.state==='CHECKPOINTED'))root.append(createButton(d,{label:progress.settlement?'Resume approved Settlement':'Apply approved Settlement',scope,onPress:async()=>{const route=await actionRouter.route({type:'wave13.loreAuthoring.applySettlement',payload:{sessionId:state.sessionId,maxOperations:32}});const value=routeValue(route);if(value?.settlementId)state.settlementId=value.settlementId;state.status=routeMessage(route,'Worker 4 processed approved Settlement operations.');refresh?.();}}));

  const settlementId=state.settlementId??progress.settlement?.settlementId??null,settlement=settlementId?valueOf(loreAuthoring.settlement({settlementId})):null;
  if(settlement){
    const committed=String(settlement.state)==='SETTLED';
    root.append(element(d,'div',{className:'a52-wave13-section-head'},element(d,'h4',{text:'Owner Settlement receipt'}),makeBadge(d,committed?'COMMITTED BY OWNER':human(settlement.state??'PENDING'),committed?'ready':'warning')),
      createKeyValue(d,[{key:'State',value:human(settlement.state??'UNKNOWN')},{key:'Applied',value:String(settlement.cursor??0)+' / '+String(settlement.operationCount??0)},{key:'Revision events',value:settlement.revisionEvents?.length??0},{key:'Invalidation receipts',value:settlement.invalidationReceipts?.length??0},{key:'Reconstructable',value:settlement.reconstructable?'Yes':'No'}]));
    if(settlement.lastError)root.append(message(d,'Settlement / commit failure',settlement.lastError.message??settlement.lastError.code??'Worker 4 rejected or failed the commit.','warning'));
    if(committed){
      if(loreAuthoring.capabilities().restoration)root.append(createButton(d,{label:'Restore settled revisions',scope,size:'sm',variant:'quiet',onPress:async()=>{const route=await actionRouter.route({type:'wave13.loreAuthoring.restoreSettlement',payload:{settlementId,restorationId:'ui:restore:'+settlementId,maxOperations:32}});state.status=routeMessage(route,'Worker 4 restoration processed the committed Settlement.');refresh?.();}}));
      const restudy=loreRestudyProgress(loreStudy?.read?.());
      const pct=restudy.total?Math.round(restudy.ready/restudy.total*100):0;
      root.append(element(d,'h4',{text:'Post-commit restudy'}),createKeyValue(d,[{key:'Accepted / due',value:restudy.accepted},{key:'Studying',value:restudy.studying},{key:'Ready',value:restudy.ready},{key:'Failed',value:restudy.failed},{key:'Stale',value:restudy.stale}]),createProgressBar(d,{value:pct,label:'Post-commit Lore readiness'}));
      root.append(createButton(d,{label:'Run pending restudy',scope,size:'sm',variant:'quiet',disabled:!loreStudy?.capabilities?.().run,onPress:async()=>{const route=await actionRouter.route({type:'wave13.lore.run',payload:{scope:'DUE'}});state.status=routeMessage(route,'Requested due Lore restudy after committed source revisions.');refresh?.();}}));
    }
  }
  return root;
}

function previewBox(d,label,value){
  const box=element(d,'section',{className:'a52-lore-preview-box'});
  box.append(element(d,'strong',{text:label}));
  if(!value){box.append(element(d,'p',{className:'a52-muted',text:'None / not applicable'}));return box;}
  if(value.title||value.sourceRevisionId||value.treePath?.length)box.append(createKeyValue(d,[{key:'Title',value:value.title??'—'},{key:'Revision',value:value.sourceRevisionId??'—'},{key:'Tree path',value:value.treePath?.join(' / ')||'—'}]));
  const body=value.content??value.text??value.value;if(body)box.append(element(d,'pre',{className:'a52-lore-preview-text',text:String(body).slice(0,1200)}));
  return box;
}

function syncProposalFields(state,source,exact,force=false){
  const token=String(source?.sourceId??'')+'|'+String(state.proposalKind??'');
  if(!force&&state.proposalSourceId===token)return;
  state.proposalSourceId=token;
  state.proposalTitle=exact?.comment??exact?.title??source?.metadata?.title??'';
  state.proposalContent=state.proposalKind==='DELETE_ENTRY'?'':String(exact?.content??'');
  state.proposalTreePath=(exact?.metadata?.treePath??exact?.treePath??source?.metadata?.treePath??[]).join?.(' / ')??'';
  state.proposalReason='';
}

function ensureState(state){
  const defaults=createLoreReviewUiState();for(const [key,value] of Object.entries(defaults))if(state[key]===undefined)state[key]=Array.isArray(value)?[...value]:value;return state;
}
function valueOf(result){return result?.ok===true?result.value??null:null;}
function routeValue(route){return route?.ok===true&&route.result?.ok===true?route.result.value??null:null;}
function routeMessage(route,success){
  if(!route?.ok)return'UI routing failed: '+String(route?.error??'unknown error');
  if(route.result?.ok===false)return'Worker 4 action failed: '+String(route.result.error?.message??route.result.error?.code??'unknown error');
  return success;
}
function listen(scope,node,type,handler){if(scope?.listen)scope.listen(node,type,handler);else node?.addEventListener?.(type,handler);}
function field(d,tag,label,attrs={}){return element(d,tag,{className:'a52-input',attrs:{'aria-label':label,...attrs}});}
function option(d,value,label){return element(d,'option',{text:label,attrs:{value}});}
function labelWrap(d,label,node){const root=element(d,'label',{className:'a52-wave13-field'});root.append(element(d,'span',{text:label}),node);return root;}
function message(d,title,body,status='historical'){const root=element(d,'section',{className:'a52-state-message',attrs:{role:status==='error'?'alert':'status'},dataset:{status}});root.append(element(d,'strong',{text:title}),element(d,'span',{text:String(body??'')}));return root;}
function human(value){return String(value??'').toLowerCase().replace(/(^|_)([a-z])/g,(_,space,letter)=>(space?' ':'')+letter.toUpperCase());}
