import { ResourceScope } from './lifecycle.js';
import { element } from './primitives.js';

export const DEMO_EVIDENCE_JOURNAL_VERSION='1.0.0';
const DEFAULT_NAMESPACE='area52.demo.evidence.v1';
const STAGES=['scene','runtime','coprocessor','choice','truth','jev','gather','seal','promptPlan','generation','learning'];

class MemoryStorage{
  #data=new Map();
  getItem(key){return this.#data.has(key)?this.#data.get(key):null;}
  setItem(key,value){this.#data.set(key,String(value));}
  removeItem(key){this.#data.delete(key);}
}

export class DemoEvidenceJournal{
  constructor({storage=null,namespace=DEFAULT_NAMESPACE,maxTurns=48,maxEntriesPerTurn=64,now=()=>Date.now()}={}){
    this.storage=storage??globalThis.localStorage??new MemoryStorage();
    this.namespace=String(namespace||DEFAULT_NAMESPACE);
    this.maxTurns=Math.max(4,Number(maxTurns)||48);
    this.maxEntriesPerTurn=Math.max(8,Number(maxEntriesPerTurn)||64);
    this.now=typeof now==='function'?now:()=>Date.now();
    this.lastError=null;
  }

  recordSnapshot({selection={},operations=null,diagnostics=null,cognition=null,promptPlan=null}={}){
    const identity=normalizeSelection(selection);
    if(!identity.chatId||!identity.turnId||!identity.generationId)return null;
    const state=this.#load();
    const key=selectionKey(identity);
    let turn=state.turns.find(row=>row.key===key);
    const at=this.now();
    if(!turn){
      turn={key,selection:identity,firstSeenAt:at,lastUpdatedAt:at,entries:[]};
      state.turns.push(turn);
    }
    turn.lastUpdatedAt=at;
    const entries=deriveEntries({selection:identity,operations,diagnostics,cognition,promptPlan,at});
    for(const entry of entries){
      const index=turn.entries.findIndex(row=>row.identityKey===entry.identityKey);
      if(index>=0){
        const prior=turn.entries[index];
        if(!sameEvidence(prior,entry))turn.entries[index]=entry;
      }else turn.entries.push(entry);
    }
    turn.entries.sort((a,b)=>Number(a.at??0)-Number(b.at??0));
    if(turn.entries.length>this.maxEntriesPerTurn)turn.entries.splice(0,turn.entries.length-this.maxEntriesPerTurn);
    state.turns.sort((a,b)=>Number(a.lastUpdatedAt??0)-Number(b.lastUpdatedAt??0));
    if(state.turns.length>this.maxTurns)state.turns.splice(0,state.turns.length-this.maxTurns);
    state.updatedAt=at;
    this.#save(state);
    return clone(turn);
  }

  readTurn(selection={}){
    const identity=normalizeSelection(selection);
    if(!identity.chatId||!identity.turnId||!identity.generationId)return null;
    const turn=this.#load().turns.find(row=>row.key===selectionKey(identity));
    return turn?clone(turn):null;
  }

  listEntries(selection={}, {limit=64}={}){
    const turn=this.readTurn(selection);
    return turn?[...turn.entries].slice(-Math.max(1,Number(limit)||64)): [];
  }

  exportEvidence({selection=null}={}){
    const state=this.#load();
    const identity=selection?normalizeSelection(selection):null;
    const turns=identity?.chatId&&identity?.turnId&&identity?.generationId
      ? state.turns.filter(row=>row.key===selectionKey(identity))
      : state.turns;
    return {
      kind:'Area52DemoEvidenceExport',contractVersion:DEMO_EVIDENCE_JOURNAL_VERSION,exportedAt:this.now(),
      selection:identity,turns:clone(turns),
      safety:{rawPromptsPersisted:false,storyTextPersisted:false,credentialsPersisted:false,hiddenReasoningPersisted:false,externalDatabaseUsed:false},
    };
  }

  download({selection=null,document=globalThis.document??null,filename=null}={}){
    const payload=this.exportEvidence({selection}),json=JSON.stringify(payload,null,2);
    const BlobCtor=globalThis.Blob,URLApi=globalThis.URL;
    if(!document?.createElement||typeof BlobCtor!=='function'||typeof URLApi?.createObjectURL!=='function')return{ok:false,reason:'DOWNLOAD_API_UNAVAILABLE',payload,json};
    const blob=new BlobCtor([json],{type:'application/json'}),url=URLApi.createObjectURL(blob),a=document.createElement('a');
    const id=payload.selection;
    a.href=url;a.download=filename??['area52-evidence',id?.chatId,id?.turnId,id?.generationId].filter(Boolean).map(filePart).join('-')+'.json';
    a.style.display='none';document.body?.append?.(a);
    try{a.click?.();}finally{a.remove?.();URLApi.revokeObjectURL?.(url);}
    return{ok:true,filename:a.download,payload,json};
  }

  clear(){try{this.storage.removeItem(this.namespace);return true;}catch(error){this.lastError=error;return false;}}

  #load(){
    try{
      const raw=this.storage.getItem(this.namespace);
      if(!raw)return emptyState();
      const parsed=JSON.parse(raw);
      if(parsed?.kind!=='Area52DemoEvidenceJournal'||!Array.isArray(parsed.turns))return emptyState();
      return parsed;
    }catch(error){this.lastError=error;return emptyState();}
  }
  #save(state){try{this.storage.setItem(this.namespace,JSON.stringify(state));this.lastError=null;}catch(error){this.lastError=error;}}
}

export class DemoActivityFeedController{
  constructor({host,journal,selectionProvider=()=>({}),inspect=null,maxVisible=5}={}){
    this.host=host;this.journal=journal;this.selectionProvider=selectionProvider;this.inspect=typeof inspect==='function'?inspect:null;
    this.maxVisible=Math.max(2,Number(maxVisible)||5);this.scope=new ResourceScope();this.renderScope=new ResourceScope();
  }
  mount(){this.host?.classList?.add?.('a52-activity-feed-host');this.render();return this;}
  render(){
    if(!this.host||!this.journal)return;
    this.renderScope.cleanup();this.renderScope=new ResourceScope();
    const selection=normalizeSelection(this.selectionProvider?.()??{}),entries=this.journal.listEntries(selection,{limit:this.maxVisible});
    const d=this.host.ownerDocument,root=element(d,'div',{className:'a52-activity-feed',attrs:{'aria-label':'Current turn activity'}});
    if(!entries.length){
      root.append(element(d,'span',{className:'a52-activity-feed__empty',text:selection.turnId?'No selected-turn owner evidence recorded yet.':'Waiting for a selected turn.'}));
      this.host.replaceChildren(root);return;
    }
    entries.forEach((entry,index)=>{
      const age=entries.length-1-index;
      const button=element(d,'button',{className:'a52-activity-feed__item',attrs:{type:'button','aria-label':entry.title+': '+entry.summary,title:entry.detail??entry.summary},dataset:{status:entry.status,age:String(age),entryId:entry.id}});
      button.append(element(d,'strong',{text:entry.title}),element(d,'span',{className:'a52-activity-feed__summary',text:entry.summary}),element(d,'span',{className:'a52-activity-feed__detail',text:entry.detail??entry.summary}));
      this.renderScope.listen(button,'click',()=>this.#activate(entry));
      root.append(button);
    });
    this.host.replaceChildren(root);
  }
  destroy(){this.renderScope.cleanup();this.scope.cleanup();this.host?.replaceChildren?.();}
  #activate(entry){
    const current=normalizeSelection(this.selectionProvider?.()??{});
    if(selectionKey(current)!==selectionKey(entry.selection)){this.render();return false;}
    this.inspect?.({kind:'wave14-activity-evidence',id:entry.id,title:entry.title,available:true,selection:clone(entry.selection),receiptRef:entry.receiptRef??null,payload:clone(entry)});
    return true;
  }
}

function deriveEntries({selection,operations,diagnostics,cognition,promptPlan,at}){
  const out=[],op=operations??{},diag=diagnostics??{},path=cognition?.data??cognition??{},pipeline=op.pipeline??{};
  const stages=new Map((op.stages??[]).map(row=>[row.id,row]));
  const inspections=op.inspections??{};
  for(const id of STAGES){
    const row=stages.get(id);if(!row)continue;
    const inspection=inspections[id]??null;
    const ref=inspection?.receiptRef??null;
    if(!inspection?.available&&['runtime','coprocessor','choice','truth','jev','gather','seal','promptPlan','generation','learning'].includes(id)&&['UNAVAILABLE','DISCONNECTED','WAITING_FOR_TURN'].includes(String(row.state)))continue;
    const detail=producerDetail(id,path,pipeline,row);
    out.push(entry({
      type:'PRODUCER',subtype:id,status:row.state??'UNKNOWN',title:row.label??label(id),summary:detail.summary,
      detail:detail.detail,receiptRef:ref,selection,at,identitySuffix:ref??row.state??'status',
      metadata:{producerId:id,errorCode:row.errorCode??null,freshness:row.freshness??null},
    }));
  }

  const scatter=path.scatter??null;
  if(scatter){
    const jobs=scatter.jobs??[],ids=[...new Set(jobs.map(row=>row.resourceId).filter(Boolean))];
    out.push(entry({
      type:'SCATTER',status:'MAPPED',title:'Runtime fan-out',
      summary:jobs.length+' logical job'+(jobs.length===1?'':'s')+' mapped to '+ids.length+' resource identit'+(ids.length===1?'y':'ies')+'.',
      detail:'Scatter proves logical mapping only. It is not evidence that any mapped resource physically executed.',
      receiptRef:scatter.receiptId??null,selection,at,identitySuffix:scatter.receiptId??String(jobs.length)+':'+ids.join(','),
      metadata:{logicalJobCount:jobs.length,mappedResourceCount:ids.length,mappedResourceIds:ids,jobs:jobs.map(row=>({jobId:row.jobId??row.taskId??null,capability:row.capability??null,resourceId:row.resourceId??null,state:row.state??null}))},
    }));
  }

  for(const row of diag.resources?.rows??[]){
    if(!row.physicalExecutionAttempted&&!row.lastExecution)continue;
    const succeeded=Boolean(row.physicalExecutionSucceeded??row.lastExecution?.status==='SUCCESS');
    out.push(entry({
      type:'RESOURCE_ATTEMPT',status:succeeded?'SUCCEEDED':'FAILED',title:'Physical resource attempt',
      summary:String(row.displayName??row.id??'Resource')+' '+(succeeded?'completed a physical execution attempt.':'reported a physical execution failure.'),
      detail:'This evidence comes from the resource execution read model, not connection or configuration state.',
      receiptRef:row.lastExecution?.receiptId??row.lastExecution?.executionId??null,selection,at,
      identitySuffix:String(row.id??'resource')+':'+String(row.lastExecution?.at??row.lastExecution?.completedAt??row.lastExecution?.status??succeeded),
      metadata:{resourceId:row.id??null,providerId:row.providerId??null,modelId:row.modelId??null,workerId:row.workerId??null,measurementClass:row.measurementClass??null,succeeded,latencyMs:finite(row.lastExecution?.latencyMs)},
    }));
  }

  const gather=path.gather??null;
  if(gather){
    const counts=gather.counts??{},returned=Object.values(counts).reduce((sum,value)=>sum+(Number(value)||0),0);
    out.push(entry({
      type:'GATHER',status:gather.state??'COMPLETE',title:'Gather returned',
      summary:returned+' result'+(returned===1?'':'s')+' recorded; '+Number(counts.ADMITTED??0)+' admitted by Gather.',
      detail:'Gather disposition is recorded independently from Context Seal admission.',
      receiptRef:gather.receiptId??null,selection,at,identitySuffix:gather.receiptId??JSON.stringify(counts),
      metadata:{counts:{ADMITTED:Number(counts.ADMITTED??0),LATE:Number(counts.LATE??0),STALE:Number(counts.STALE??0),REJECTED:Number(counts.REJECTED??0),INVALID:Number(counts.INVALID??0)},results:(gather.results??[]).map(row=>({resultId:row.resultId??null,status:row.status??null,resourceId:row.resourceId??null,destination:row.destination??null,capability:row.capability??null}))},
    }));
  }

  const seal=path.seal??null;
  if(seal){
    const admitted=[...(seal.effectiveAdmittedResultIds??seal.admittedResultIds??[])];
    out.push(entry({
      type:'CONTEXT_SEAL',status:seal.sealedState===false?'UNSEALED':'SEALED',title:'Context Seal',
      summary:admitted.length+' result id'+(admitted.length===1?'':'s')+' admitted by the Context Seal owner.',
      detail:'Only owner-published admitted result IDs are counted as sealed context contributions.',
      receiptRef:seal.sealId??seal.receiptId??null,selection,at,identitySuffix:seal.sealId??seal.receiptId??admitted.join(','),
      metadata:{admittedResultCount:admitted.length,admittedResultIds:admitted,rejectedResultIds:[...(seal.rejectedResultIds??[])],lateResultIds:[...(seal.lateResultIds??[])],staleResultIds:[...(seal.staleResultIds??[])]},
    }));
  }

  const pp=promptPlan?.data??promptPlan??path.promptPlan??null;
  if(pp){
    out.push(entry({
      type:'PROMPT_PLAN',status:pp.status??'PUBLISHED',title:'Prompt delivery plan',
      summary:'PromptPlan '+String(pp.promptPlanId??'receipt')+' was published for this generation.',
      detail:'A PromptPlan proves owner context preparation; it does not prove SillyTavern received or used the prompt.',
      receiptRef:pp.promptPlanId??null,selection,at,identitySuffix:pp.promptPlanId??String(pp.generationId??selection.generationId),
      metadata:{promptPlanId:pp.promptPlanId??null,totalTokens:finite(pp.totalTokens),budgetTotal:finite(pp.budgetTotal),sealState:pp.seal?.sealedState??null},
    }));
  }

  if(pipeline.learningReceipt){
    const learning=inspections.learning?.payload??null;
    out.push(entry({
      type:'LEARNING',status:'RECORDED',title:'Post-response learning',
      summary:'The owner published a learning receipt for this completed generation.',
      detail:'Only receipt identity and status are persisted; no response text or hidden reasoning is stored.',
      receiptRef:inspections.learning?.receiptRef??learning?.id??learning?.kind??null,selection,at,identitySuffix:inspections.learning?.receiptRef??learning?.id??learning?.kind??'learning',
      metadata:{kind:learning?.kind??pipeline.learningKind??null,status:learning?.status??'RECORDED'},
    }));
  }
  return out;
}

function producerDetail(id,path,pipeline,row){
  if(id==='runtime')return{summary:pipeline.mappingReceipt?String(pipeline.logicalJobsMapped??0)+' logical jobs mapped.':'Runtime owner status updated.',detail:pipeline.mappingReceipt?'Mapping is visible; physical execution requires separate execution telemetry.':row.reason};
  if(id==='coprocessor')return{summary:pipeline.executionReceipt?String(pipeline.physicalExecutionAttempts??0)+' physical attempts · '+String(pipeline.physicalExecutionSucceeded??0)+' succeeded.':'No selected-turn physical execution receipt.',detail:'Configured or connected resources are not counted as executed.'};
  if(id==='choice')return{summary:path.choice?String(path.choice.admitted?.length??0)+' admitted · '+String(path.choice.skipped?.length??0)+' skipped.':row.reason,detail:'Cognitive Choice is shown from the selected-turn owner receipt.'};
  if(id==='truth')return{summary:path.truth?'Truth owner published '+sumCounts(path.truth.counts)+' classified result(s).':row.reason,detail:'Truth status comes from the selected-turn Truth assessment.'};
  if(id==='jev')return{summary:path.jev?'Jev '+String(path.jev.outcome??path.jev.state??'receipt')+'.':row.reason,detail:'Jev connection state is not execution evidence; this notice exists only when the selected-turn cognition path publishes Jev state.'};
  if(id==='gather')return{summary:path.gather?'Gather owner receipt published.':row.reason,detail:'Returned and contained results remain distinct from Context Seal admission.'};
  if(id==='seal')return{summary:path.seal?'Context Seal owner receipt published.':row.reason,detail:'Only explicit admitted result IDs count as sealed contributions.'};
  if(id==='promptPlan')return{summary:path.promptPlan?'PromptPlan prepared for generation.':row.reason,detail:'PromptPlan is not proof of SillyTavern prompt receipt.'};
  if(id==='learning')return{summary:pipeline.learningReceipt?'Post-response learning receipt recorded.':row.reason,detail:'Learning is recorded after response completion.'};
  return{summary:row.reason||label(id)+' owner status updated.',detail:'Selected-turn owner status; no raw narrative content is retained.'};
}

function sameEvidence(a,b){
  if(!a||!b)return false;
  return a.status===b.status&&a.summary===b.summary&&a.detail===b.detail&&a.receiptRef===b.receiptRef&&JSON.stringify(a.metadata??{})===JSON.stringify(b.metadata??{});
}
function entry({type,subtype=null,status,title,summary,detail,receiptRef=null,selection,at,identitySuffix='',metadata={}}){
  const id=[type,subtype??'',selection.chatId,selection.turnId,selection.generationId,String(identitySuffix)].join(':');
  return{
    kind:'Area52DemoEvidenceEntry',contractVersion:DEMO_EVIDENCE_JOURNAL_VERSION,id,identityKey:id,type,subtype,status:String(status??'UNKNOWN'),title:String(title??type),
    summary:String(summary??''),detail:String(detail??summary??''),receiptRef:receiptRef==null?null:String(receiptRef),selection:clone(selection),at:Number(at??0),metadata:clone(metadata),
    rawPromptIncluded:false,storyTextIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
  };
}
function normalizeSelection(value={}){return{chatId:text(value.chatId),turnId:text(value.turnId),generationId:text(value.generationId),correlationId:text(value.correlationId),worldRevision:numberOrNull(value.worldRevision),sceneRevision:numberOrNull(value.sceneRevision)};}
function selectionKey(value={}){const x=normalizeSelection(value);return[x.chatId??'',x.turnId??'',x.generationId??''].join('|');}
function emptyState(){return{kind:'Area52DemoEvidenceJournal',contractVersion:DEMO_EVIDENCE_JOURNAL_VERSION,updatedAt:null,turns:[]};}
function sumCounts(value={}){return Object.values(value??{}).reduce((sum,row)=>sum+(Number(row)||0),0);}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function numberOrNull(value){const n=Number(value);return value==null||!Number.isFinite(n)?null:n;}
function text(value){const x=value==null?'':String(value).trim();return x||null;}
function label(value){return String(value??'producer').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\b\w/g,m=>m.toUpperCase());}
function filePart(value){return String(value??'').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,80)||'unknown';}
function clone(value){if(value==null)return value;if(typeof structuredClone==='function')return structuredClone(value);return JSON.parse(JSON.stringify(value));}
