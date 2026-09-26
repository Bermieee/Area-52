const PROPOSAL_KINDS=Object.freeze([
  'CREATE_ENTRY','UPDATE_ENTRY','DELETE_ENTRY','MERGE_ENTRIES','SPLIT_ENTRY','MOVE_ENTRY','PLACE_ENTRY',
]);

export const LoreReviewProposalKind=Object.freeze(Object.fromEntries(PROPOSAL_KINDS.map(value=>[value,value])));
export const LoreReviewDecision=Object.freeze({APPROVE:'APPROVE',REJECT:'REJECT',DEFER:'DEFER'});
export const LoreReviewOwnerPath=Object.freeze({
  SOURCE_MUTATION:'SOURCE_MUTATION',
  TREE_REVIEW:'TREE_REVIEW',
  MERGE_REVIEW:'MERGE_REVIEW',
  OWNER_CONTRACT_MISSING:'OWNER_CONTRACT_MISSING',
});

const text=(value,max=240)=>value==null?null:String(value).slice(0,max);
const list=(value,max=32)=>Array.isArray(value)?value.slice(0,max):[];
const uniq=(value,max=32)=>[...new Set(list(value,max*2).filter(x=>x!=null).map(String))].slice(0,max);
const treePath=(value)=>{
  if(Array.isArray(value))return value.filter(Boolean).map(String).slice(0,12);
  if(typeof value==='string')return value.split(/[\\/>]+/).map(x=>x.trim()).filter(Boolean).slice(0,12);
  return[];
};
const titleOf=(entry)=>text(entry?.title??entry?.comment??entry?.name??entry?.metadata?.title??entry?.uid??'Lore entry',160);
const contentOf=(entry,max=1200)=>text(entry?.content??entry?.text??entry?.body??'',max)??'';

export function verifySelectedLorebook({selectedSnapshot=null,ownerBook=null}={}){
  if(!selectedSnapshot)return Object.freeze({kind:'LorebookVerification',state:'NO_SELECTION',verified:false,reason:'No selected SillyTavern Lorebook snapshot is loaded.',lorebookId:ownerBook?.lorebookId??null,entryCount:null,matchedEntries:0,missingOwnerUids:[]});
  if(!ownerBook)return Object.freeze({kind:'LorebookVerification',state:'OWNER_IDENTITY_MISSING',verified:false,reason:'Worker 4 has not published source identity for the selected Lorebook.',lorebookId:selectedSnapshot?.id??null,entryCount:selectedSnapshot?.entries?.length??0,matchedEntries:0,missingOwnerUids:[]});
  const selectedId=String(selectedSnapshot.id??'');
  const ownerId=String(ownerBook.lorebookId??'');
  if(!selectedId||selectedId!==ownerId)return Object.freeze({kind:'LorebookVerification',state:'LOREBOOK_MISMATCH',verified:false,reason:'The loaded SillyTavern Lorebook does not match the owner source surface.',lorebookId:selectedId||null,ownerLorebookId:ownerId||null,entryCount:selectedSnapshot?.entries?.length??0,matchedEntries:0,missingOwnerUids:[]});
  const selectedUids=new Set((selectedSnapshot.entries??[]).map(row=>String(row?.uid??'')).filter(Boolean));
  const ownerUids=(ownerBook.sources??[]).map(row=>String(row?.uid??'')).filter(Boolean);
  const missingOwnerUids=ownerUids.filter(uid=>!selectedUids.has(uid)).slice(0,64);
  const matchedEntries=ownerUids.filter(uid=>selectedUids.has(uid)).length;
  const persisted=ownerBook.discoveryIdentityPersisted!==false;
  const verified=missingOwnerUids.length===0&&persisted;
  return Object.freeze({
    kind:'LorebookVerification',
    state:verified?'VERIFIED':missingOwnerUids.length?'SOURCE_SET_MISMATCH':'DISCOVERY_UNVERIFIED',
    verified,
    reason:verified?'Selected SillyTavern Lorebook matches Worker 4 exact source identity.':missingOwnerUids.length?'One or more owner source UIDs are absent from the loaded SillyTavern Lorebook.':'The source set matches, but Worker 4 did not publish persisted discovery identity.',
    lorebookId:selectedId,title:text(selectedSnapshot.title??ownerBook.title,180),entryCount:selectedSnapshot.entries?.length??0,
    ownerSourceCount:ownerUids.length,matchedEntries,missingOwnerUids,discoveryIdentityPersisted:persisted,
  });
}

export function buildExactLoreEntries({selectedSnapshot=null,ownerBook=null,query='',page=0,pageSize=32}={}){
  const ownerByUid=new Map((ownerBook?.sources??[]).map(row=>[String(row?.uid??''),row]));
  const needle=String(query??'').trim().toLowerCase();
  const rows=(selectedSnapshot?.entries??[]).map((entry,index)=>{
    const uid=String(entry?.uid??index),owner=ownerByUid.get(uid)??null;
    const path=treePath(entry?.metadata?.treePath??entry?.treePath??owner?.metadata?.treePath);
    return Object.freeze({
      kind:'ExactAuthoredLoreEntry',uid,index,title:titleOf(entry),content:contentOf(entry),
      keys:uniq(entry?.key??entry?.keys??entry?.keywords??[],16),treePath:path,
      sourceId:owner?.sourceId??null,sourceRevisionId:owner?.sourceRevisionId??null,revision:owner?.revision??null,
      sourceState:owner?.state??null,contentHash:owner?.contentHash??null,
      temporalState:text(entry?.metadata?.temporalState??entry?.temporalState??owner?.metadata?.temporalState,80),
      contradictionState:text(entry?.metadata?.contradictionState??entry?.contradictionState??owner?.metadata?.contradictionState,80),
      provenanceRefs:uniq(owner?.metadata?.provenanceRefs??entry?.metadata?.provenanceRefs??[],16),
      scope:text(owner?.metadata?.scope??entry?.metadata?.scope??entry?.metadata?.storyScope,180),
      exactSourceRecoverable:owner?.exactSourceRecoverable!==false,
    });
  }).filter(row=>!needle||[row.title,row.uid,row.sourceId,row.treePath.join(' / '),row.keys.join(' '),row.content].some(v=>String(v??'').toLowerCase().includes(needle)));
  const size=Math.max(8,Math.min(64,Number(pageSize)||32)),pages=Math.max(1,Math.ceil(rows.length/size)),safePage=Math.max(0,Math.min(pages-1,Number(page)||0));
  return Object.freeze({kind:'ExactLoreEntryPage',total:rows.length,page:safePage,pageSize:size,pages,rows:Object.freeze(rows.slice(safePage*size,(safePage+1)*size))});
}

export function buildHumanLoreTree(entries,{maxNodes=160}={}){
  const root={label:'Lorebook',path:[],entryUids:[],children:new Map()};
  const source=Array.isArray(entries)?entries:[];
  for(const entry of source){
    const path=treePath(entry?.treePath??entry?.metadata?.treePath);
    let node=root;
    for(const part of (path.length?path:['Unplaced'])){
      if(!node.children.has(part))node.children.set(part,{label:part,path:[...node.path,part],entryUids:[],children:new Map()});
      node=node.children.get(part);
    }
    node.entryUids.push(String(entry?.uid??entry?.sourceId??'unknown'));
  }
  let emitted=0;
  const flatten=(node,depth=0)=>{
    if(emitted>=maxNodes)return[];
    emitted+=1;
    const row=Object.freeze({kind:'HumanLoreTreeNode',label:node.label,path:Object.freeze([...node.path]),depth,entryUids:Object.freeze(node.entryUids.slice(0,64)),entryCount:node.entryUids.length,childCount:node.children.size});
    const children=[...node.children.values()].sort((a,b)=>a.label.localeCompare(b.label)).flatMap(child=>flatten(child,depth+1));
    return[row,...children];
  };
  const rows=flatten(root).slice(1);
  return Object.freeze({kind:'HumanLoreTree',nodeCount:rows.length,truncated:emitted>=maxNodes,rows:Object.freeze(rows)});
}

export function createLoreReviewProposal(input={}){
  const proposalKind=String(input.proposalKind??input.action??'').toUpperCase();
  if(!PROPOSAL_KINDS.includes(proposalKind))throw new TypeError('Unsupported Lore proposal kind: '+proposalKind);
  const payload={
    kind:'LoreUiReviewProposal',contractVersion:1,
    proposalId:text(input.proposalId??['ui-lore',proposalKind,input.lorebookId,input.sourceId,input.uid,Date.now()].filter(Boolean).join(':'),220),
    proposalKind,lorebookId:text(input.lorebookId,180),sourceId:text(input.sourceId,220),baseSourceRevisionId:text(input.baseSourceRevisionId,220),uid:text(input.uid,180),
    targetSourceIds:Object.freeze(uniq(input.targetSourceIds,16)),targetTreePath:Object.freeze(treePath(input.targetTreePath)),
    title:text(input.title,180),content:contentOf(input,1600),reason:text(input.reason,600),
    evidenceSourceIds:Object.freeze(uniq(input.evidenceSourceIds,32)),provenanceRefs:Object.freeze(uniq(input.provenanceRefs,32)),
    scope:text(input.scope,220),temporalState:text(input.temporalState,100),contradictionState:text(input.contradictionState,100),
    before:boundedPreview(input.before),after:boundedPreview(input.after),
    mutationAuthority:false,commitState:'DRAFT_NOT_SUBMITTED',operatorDecision:null,
  };
  return Object.freeze(payload);
}

export function proposalOwnerPath(proposal,capabilities={}){
  const kind=String(proposal?.proposalKind??proposal?.action??'').toUpperCase();
  if(['CREATE_ENTRY','UPDATE_ENTRY','DELETE_ENTRY'].includes(kind))return capabilities.sourceMutation?LoreReviewOwnerPath.SOURCE_MUTATION:LoreReviewOwnerPath.OWNER_CONTRACT_MISSING;
  if(['MOVE_ENTRY','PLACE_ENTRY'].includes(kind))return capabilities.lifecycle&&capabilities.tree?LoreReviewOwnerPath.TREE_REVIEW:LoreReviewOwnerPath.OWNER_CONTRACT_MISSING;
  if(kind==='MERGE_ENTRIES')return capabilities.mergeLifecycle?LoreReviewOwnerPath.MERGE_REVIEW:LoreReviewOwnerPath.OWNER_CONTRACT_MISSING;
  return LoreReviewOwnerPath.OWNER_CONTRACT_MISSING;
}

export function toOwnerSourceMutationProposal(proposal){
  const kind=String(proposal?.proposalKind??'').toUpperCase();
  if(!['CREATE_ENTRY','UPDATE_ENTRY','DELETE_ENTRY'].includes(kind))throw new TypeError(kind+' is not published by Worker 4 source-mutation contract');
  const out={action:kind,evidenceSourceIds:[...(proposal.evidenceSourceIds??[])]};
  if(kind==='CREATE_ENTRY'){out.lorebookId=proposal.lorebookId;out.uid=proposal.uid;out.content=proposal.content;out.metadata={title:proposal.title??proposal.uid,treePath:[...(proposal.targetTreePath??[])]};}
  else{out.sourceId=proposal.sourceId;if(kind==='UPDATE_ENTRY'){out.content=proposal.content;out.metadata={title:proposal.title??null,treePath:[...(proposal.targetTreePath??[])]};}else out.reason=proposal.reason??'operator-reviewed deletion proposal';}
  if(proposal.baseSourceRevisionId)out.expectedSourceRevisionId=proposal.baseSourceRevisionId;
  return Object.freeze(out);
}

export function summarizeLoreReviewAction(action,{contentLimit=900}={}){
  const receipt=action?.evidenceReceipt??{},proposed=action?.proposedOutput??{},before=action?.before??proposed?.before??receipt?.before??null,after=action?.after??proposed?.after??receipt?.after??proposed??null;
  return Object.freeze({
    kind:'LoreReviewActionSummary',actionId:text(action?.id??action?.actionId,220),action:text(action?.action??action?.type??proposed?.action,100),
    decision:text(action?.decision,80),previewOnly:!action?.materialized,materialized:Boolean(action?.materialized),
    before:boundedPreview(before,contentLimit),after:boundedPreview(after,contentLimit),
    sourceRevisionRefs:Object.freeze(uniq(action?.inputSourceRevisions??receipt?.exactSourceRevisions??receipt?.sourceRevisionRefs??[],32)),
    provenanceRefs:Object.freeze(uniq(receipt?.provenanceRefs??receipt?.learnedEvidenceRefs??action?.evidenceRefs??[],32)),
    scope:text(receipt?.scope??receipt?.storyScope?.chatId??action?.scope,220),
    temporalState:text(receipt?.temporalState??proposed?.temporalState??action?.temporalState,100),
    contradictionState:text(receipt?.contradictionState??proposed?.contradictionState??action?.contradictionState,100),
    affectedTreeNodes:Object.freeze(uniq(action?.affectedTreeNodes??proposed?.affectedTreeNodes??[],32)),
    dependencyArea:Object.freeze(uniq(action?.dependencyArea??action?.invalidationTargets??proposed?.invalidationTargets??receipt?.invalidationTargets??[],32)),
    rationale:text(action?.rationale??proposed?.rationale,700),
  });
}

export function loreRestudyProgress(read){
  const data=read?.data??read??{},counts=data.operatorCounts??{},entries=Array.isArray(data.entries)?data.entries:[];
  const accepted=Number(counts.ACCEPTED??entries.filter(x=>String(x.operatorState).toUpperCase()==='ACCEPTED').length)||0;
  const studying=Number(counts.STUDYING??entries.filter(x=>String(x.operatorState).toUpperCase()==='STUDYING').length)||0;
  const ready=Number(counts.READY??entries.filter(x=>String(x.operatorState).toUpperCase()==='READY').length)||0;
  const failed=Number(counts.FAILED??entries.filter(x=>String(x.operatorState).toUpperCase()==='FAILED').length)||0;
  const stale=entries.filter(x=>String(x.freshness??'').toUpperCase().includes('STALE')).length;
  const total=Math.max(entries.length,accepted+studying+ready+failed);
  return Object.freeze({kind:'LoreRestudyProgress',accepted,studying,ready,failed,stale,total,complete:total>0&&ready===total&&failed===0&&studying===0&&accepted===0});
}

function boundedPreview(value,max=1200){
  if(value==null)return null;
  if(typeof value==='string')return Object.freeze({text:text(value,max)});
  if(typeof value!=='object')return Object.freeze({value:text(value,max)});
  return Object.freeze({
    title:titleOf(value),uid:text(value.uid,180),sourceId:text(value.sourceId,220),sourceRevisionId:text(value.sourceRevisionId??value.revisionId,220),
    content:contentOf(value,max),treePath:Object.freeze(treePath(value.treePath??value.metadata?.treePath)),
    keys:Object.freeze(uniq(value.key??value.keys??value.keywords??[],16)),
    scope:text(value.scope??value.storyScope?.chatId??value.metadata?.scope,220),
    temporalState:text(value.temporalState??value.metadata?.temporalState,100),
    contradictionState:text(value.contradictionState??value.metadata?.contradictionState,100),
  });
}
