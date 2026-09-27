import { createButton, createKeyValue, element, makeBadge } from './primitives.js';

export const TURN_LOG_DIAGNOSTICS_VERSION='1.1.0';
const DEFAULT_MAX_VISIBLE=96;
const DEFAULT_MAX_DETAIL_BYTES=12288;
const CATEGORY_ORDER=['HOST','EDGE','COGNITION','RUNTIME','RESOURCE','RESULT','GATHER','CONTEXT','DELIVERY','LEARNING','ERROR'];
const SEVERITY_ORDER=['ERROR','WARN','OK','INFO'];
const BLOCKED_KEYS=new Set(['rawprompt','prompt','prompttext','story','storytext','lorebody','contentbody','responsebody','reasoning','hiddenreasoning','apikey','api_key','authorization','credential','credentials','password','secret','access_token','refresh_token']);

export class SelectedTurnLogModel{
  constructor({journal,selectionProvider=()=>({}),now=()=>Date.now(),maxVisibleRows=DEFAULT_MAX_VISIBLE,maxDetailBytes=DEFAULT_MAX_DETAIL_BYTES}={}){
    this.journal=journal??null;
    this.selectionProvider=typeof selectionProvider==='function'?selectionProvider:()=>({});
    this.now=typeof now==='function'?now:()=>Date.now();
    this.maxVisibleRows=Math.max(16,Math.min(256,Number(maxVisibleRows)||DEFAULT_MAX_VISIBLE));
    this.maxDetailBytes=Math.max(2048,Math.min(65536,Number(maxDetailBytes)||DEFAULT_MAX_DETAIL_BYTES));
  }

  read({selection=null,filters={}}={}){
    const selected=normalizeSelection(selection??this.selectionProvider?.()??{});
    const turn=this.journal?.readTurn?.(selected)??null;
    const allRows=buildTurnRows(turn,selected);
    const normalizedFilters=normalizeFilters(filters,this.now());
    const filtered=allRows.filter(row=>matchesFilters(row,normalizedFilters));
    const truncated=filtered.length>this.maxVisibleRows;
    const rows=boundedVisibleRows(filtered,this.maxVisibleRows).map(stripPrivate);
    const status=this.journal?.status?.()??null;
    return safeClone({
      kind:'Area52SelectedTurnLog',contractVersion:TURN_LOG_DIAGNOSTICS_VERSION,selection:selected,
      current:Boolean(selected.chatId&&selected.turnId&&selected.generationId),firstSeenAt:turn?.firstSeenAt??null,lastUpdatedAt:turn?.lastUpdatedAt??null,
      filters:normalizedFilters,rows,totalRows:allRows.length,matchingRows:filtered.length,visibleRows:rows.length,truncated,
      availableCategories:CATEGORY_ORDER.filter(category=>allRows.some(row=>row.category===category)),
      availableSeverities:SEVERITY_ORDER.filter(severity=>allRows.some(row=>row.severity===severity)),
      summary:summarize(turn,allRows),retention:status,
      chronology:'OWNER_STAGE_ORDER_WITH_EXACT_TIMESTAMPS_WHEN_PUBLISHED',
      safety:{metadataOnly:true,rawPrompts:false,storyLoreBodies:false,credentials:false,hiddenReasoning:false,mutationAuthority:false},
    });
  }

  detail(rowId,{selection=null}={}){
    const selected=normalizeSelection(selection??this.selectionProvider?.()??{});
    const turn=this.journal?.readTurn?.(selected)??null;
    const row=buildTurnRows(turn,selected).map(stripPrivate).find(item=>item.id===rowId)??null;
    return row?detailPayload(this.journal,selected,row,this.maxDetailBytes):null;
  }

  exportMetadata({selection=null}={}){
    const selected=normalizeSelection(selection??this.selectionProvider?.()??{}),turn=this.journal?.readTurn?.(selected)??null;
    const rows=buildTurnRows(turn,selected).map(stripPrivate),details={};
    for(const row of rows){
      if(!row.sourceEntryIds?.length)continue;
      const detail=detailPayload(this.journal,selected,row,this.maxDetailBytes);
      if(detail)details[row.id]=detail;
    }
    return sanitize({
      kind:'Area52SelectedTurnLogExport',contractVersion:TURN_LOG_DIAGNOSTICS_VERSION,exportedAt:this.now(),
      selection:selected,summary:summarize(turn,rows),rows,details,retention:this.journal?.status?.()??null,
      chronology:'OWNER_STAGE_ORDER_WITH_EXACT_TIMESTAMPS_WHEN_PUBLISHED',
      safety:{metadataOnly:true,rawPrompts:false,storyLoreBodies:false,credentials:false,hiddenReasoning:false,mutationAuthority:false},
    });
  }

  download({selection=null,document=globalThis.document??null,filename=null}={}){
    const payload=this.exportMetadata({selection}),json=JSON.stringify(payload,null,2);
    const BlobCtor=globalThis.Blob,URLApi=globalThis.URL;
    if(!document?.createElement||typeof BlobCtor!=='function'||typeof URLApi?.createObjectURL!=='function')return{ok:false,reason:'DOWNLOAD_API_UNAVAILABLE',payload,json};
    const blob=new BlobCtor([json],{type:'application/json'}),url=URLApi.createObjectURL(blob),a=document.createElement('a'),id=payload.selection;
    a.href=url;a.download=filename??['area52-turn-log',id?.chatId,id?.turnId,id?.generationId].filter(Boolean).map(filePart).join('-')+'.json';a.style.display='none';document.body?.append?.(a);
    try{a.click?.();}finally{a.remove?.();URLApi.revokeObjectURL?.(url);}
    return{ok:true,filename:a.download,payload,json};
  }
}

export function installTurnLogDiagnosticsWorkspace(registry,{journal,selectionProvider=()=>({}),maxVisibleRows=DEFAULT_MAX_VISIBLE}={}){
  if(!registry||!journal)return null;
  const model=new SelectedTurnLogModel({journal,selectionProvider,maxVisibleRows});
  const filters={time:'ALL',category:'ALL',severity:'ALL',search:''};
  const id='turn-log';
  if(!registry.has(id))registry.register({
    id,title:'Turn Log',icon:'⌁',category:'Product',navigation:{level:'product',order:85},views:['normal','detail','advanced'],supportedActions:['export-metadata','filter','drilldown'],
    render(host,ctx){renderTurnLogWorkspace(host,{...ctx,model,filters});},
  });
  return{model,release(){try{registry.unregister(id);}catch{}},filters};
}

export function buildSelectedTurnLog(turn,selection={}){
  return buildTurnRows(turn,normalizeSelection(selection)).map(stripPrivate);
}

function renderTurnLogWorkspace(host,{model,filters,scope,refresh}={}){
  const d=host.ownerDocument,snapshot=model.read({filters}),root=element(d,'section',{className:'a52-stack a52-turn-log',attrs:{'aria-label':'Selected turn diagnostics log'}});
  root.append(element(d,'h1',{text:'Selected Turn Log'}),element(d,'p',{className:'a52-muted',text:'Correlated, metadata-only owner evidence for the current chat / turn / generation. Connection and planning states never count as execution or host delivery proof.'}));
  const s=snapshot.selection??{};
  const head=element(d,'section',{className:'a52-card'});
  head.append(element(d,'div',{className:'a52-wave13-section-head'},element(d,'strong',{text:'Current selected turn'}),makeBadge(d,snapshot.current?'SELECTED':'WAITING',snapshot.current?'ready':'historical')),
    createKeyValue(d,[{key:'Chat',value:s.chatId??'unknown'},{key:'Turn',value:s.turnId??'unknown'},{key:'Generation',value:s.generationId??'unknown'},{key:'Correlation',value:s.correlationId??'unknown'},{key:'World / Scene revision',value:(s.worldRevision??'unknown')+' / '+(s.sceneRevision??'unknown')},{key:'Source revision fence',value:s.sourceRevisionRefs?.length?s.sourceRevisionRefs.join(', '):'unknown'}]));
  const summary=snapshot.summary??{};
  head.append(element(d,'p',{className:'a52-muted',text:summary.explanation??'No selected-turn evidence is retained yet.'}));
  const actions=element(d,'div',{className:'a52-wave13-resource-actions'});
  actions.append(createButton(d,{label:'Export selected-turn metadata',scope,size:'sm',variant:'quiet',onPress:()=>model.download({selection:s,document:d})}));
  head.append(actions);root.append(head);

  root.append(element(d,'section',{className:'a52-card'},element(d,'h2',{text:'Execution profile'}),createKeyValue(d,[
    {key:'Causal owner edges',value:String(summary.ownerEvidenceEdges??0)+' evidenced / '+String(summary.missingOwnerEdges??0)+' no evidence'},{key:'Logical jobs',value:summary.logicalJobs??0},{key:'Native resources',value:summary.nativeResources??0},{key:'Optional provider attempts',value:summary.optionalAttempts??0},
    {key:'Gather admitted',value:summary.gatherAdmitted??0},{key:'Gather rejected / late / stale',value:[summary.gatherRejected??0,summary.gatherLate??0,summary.gatherStale??0].join(' / ')},
    {key:'PromptPlan',value:summary.promptPlanState??'NOT OBSERVED'},{key:'Host delivery',value:summary.hostDeliveryState??'NOT OBSERVED'},{key:'Source-fence/read errors',value:summary.readErrors??0},
  ])));

  const filterCard=element(d,'section',{className:'a52-card'});filterCard.append(element(d,'h2',{text:'Filters'}));
  const controls=element(d,'div',{className:'a52-wave13-resource-actions'});
  const timeSelect=selectControl(d,'Time',filters.time,[['ALL','All retained'],['1M','Last 1 minute'],['5M','Last 5 minutes'],['15M','Last 15 minutes']]);
  const catSelect=selectControl(d,'Category',filters.category,[['ALL','All categories'],...snapshot.availableCategories.map(x=>[x,x])]);
  const sevSelect=selectControl(d,'Severity',filters.severity,[['ALL','All severities'],...snapshot.availableSeverities.map(x=>[x,x])]);
  const search=element(d,'input',{attrs:{type:'search',placeholder:'Search stage, reason, receipt, job, result…','aria-label':'Search turn log'}});search.value=filters.search??'';
  controls.append(timeSelect.wrap,catSelect.wrap,sevSelect.wrap,search);
  scope?.listen?.(timeSelect.input,'change',()=>{filters.time=timeSelect.input.value;refresh?.();});
  scope?.listen?.(catSelect.input,'change',()=>{filters.category=catSelect.input.value;refresh?.();});
  scope?.listen?.(sevSelect.input,'change',()=>{filters.severity=sevSelect.input.value;refresh?.();});
  scope?.listen?.(search,'change',()=>{filters.search=String(search.value??'').trim();refresh?.();});
  filterCard.append(controls,element(d,'p',{className:'a52-muted',text:snapshot.truncated?'Visible row cap reached; narrow filters or export the selected-turn metadata for the bounded retained set.':'Showing '+snapshot.visibleRows+' of '+snapshot.matchingRows+' matching rows.'}));root.append(filterCard);

  const jobRows=snapshot.rows.filter(row=>row.stage==='Fan-out job');
  const jobs=element(d,'section',{className:'a52-card',attrs:{'aria-label':'Selected turn job drilldown'}});jobs.append(element(d,'h2',{text:'Jobs · resource → return → Gather → Seal'}));
  if(!jobRows.length)jobs.append(element(d,'p',{className:'a52-muted',text:'No owner-backed job audit is retained for this selected turn.'}));
  for(const row of jobRows)jobs.append(renderRow(d,row,{model,selection:s,scope}));
  root.append(jobs);

  const list=element(d,'section',{className:'a52-card',attrs:{'aria-label':'Correlated turn path'}});list.append(element(d,'h2',{text:'Producer → consumer causal path'}));
  const pathRows=snapshot.rows.filter(row=>row.stage!=='Fan-out job');
  if(!pathRows.length)list.append(element(d,'p',{className:'a52-muted',text:snapshot.current?'No retained evidence matches these filters.':'Select a chat turn and generation to populate this log.'}));
  for(const row of pathRows)list.append(renderRow(d,row,{model,selection:s,scope}));
  root.append(list);

  const retention=snapshot.retention??{};
  root.append(element(d,'section',{className:'a52-card'},element(d,'h2',{text:'Retention / safety'}),createKeyValue(d,[
    {key:'Storage',value:retention.available===false?'DEGRADED: '+String(retention.lastError??'local storage unavailable'):String(retention.storageKind??'unknown')},
    {key:'Retained turns / entries',value:String(retention.turnCount??0)+' / '+String(retention.entryCount??0)},{key:'Serialized bytes / ceiling',value:String(retention.serializedBytes??0)+' / '+String(retention.maxStoredBytes??'unknown')},
    {key:'Storage writes / skipped redundant writes',value:String(retention.writes??0)+' / '+String(retention.skippedRedundantWrites??0)},{key:'Payload policy',value:'metadata only; no raw prompts, story/Lore bodies, credentials, or hidden reasoning'},
  ])));
  host.append(root);
}

function renderRow(d,row,{model,selection,scope}={}){
  const details=element(d,'details',{className:'a52-wave13-flow-row a52-turn-log__row',dataset:{turnLogRow:row.id}}),summary=element(d,'summary',{className:'a52-inline-status'});
  summary.append(element(d,'span',{className:'a52-muted',text:displayTime(row)}),makeBadge(d,row.severity,severityStatus(row.severity)),element(d,'strong',{text:row.stage}),makeBadge(d,row.status,statusToken(row.status)));
  if(row.receiptId)summary.append(element(d,'code',{text:row.receiptId}));
  details.append(summary,element(d,'p',{text:row.summary}),element(d,'p',{className:'a52-muted',text:[row.reasonCode?'Reason '+row.reasonCode:null,row.jobId?'Job '+row.jobId:null,row.resourceId?'Resource '+row.resourceId:null,row.resultId?'Result '+row.resultId:null].filter(Boolean).join(' · ')||'No additional correlation identity published.'}));
  let loaded=false;
  scope?.listen?.(details,'toggle',()=>{
    if(!details.open||loaded)return;loaded=true;const payload=model.detail(row.id,{selection});details.append(renderDetail(d,row,payload));
  });
  return details;
}

function buildTurnRows(turn,selection){
  const entries=Array.isArray(turn?.entries)?turn.entries:[],rows=[];
  const add=(value)=>rows.push(normalizeRow(value,selection));
  add({id:'HOST_EVENT:'+selectionKey(selection),phase:10,stage:'Host event',category:'HOST',severity:'INFO',status:'UNKNOWN',reasonCode:'HOST_EVENT_TYPE_NOT_RETAINED',time:null,observedAt:turn?.firstSeenAt??null,summary:selection.generationId?'The selected generation is known, but this metadata journal does not retain the exact triggering SillyTavern event type.':'No selected generation host event is available.',sourceEntryIds:[]});

  const producers=entries.filter(e=>e.type==='PRODUCER');
  const choice=latest(producers.filter(e=>e.subtype==='choice'));
  if(choice)add(fromEntry(choice,{phase:20,stage:'Cognitive Choice',category:'COGNITION',severity:severityFromEntry(choice),status:choice.status,reasonCode:choice.metadata?.errorCode??null,summary:choice.summary}));

  const readErrors=entries.filter(e=>e.type==='READ_ERROR');
  for(const entry of readErrors)add(fromEntry(entry,{phase:phaseForStage(entry.subtype),stage:(entry.subtype?label(entry.subtype)+' inspection':'Owner read')+' error',category:'ERROR',severity:'ERROR',status:'BLOCKED',reasonCode:entry.metadata?.code??entry.status,summary:entry.summary}));

  for(const edge of entries.filter(e=>e.type==='OWNER_EDGE')){
    const missing=String(edge.status??'').toUpperCase()==='NO_EVIDENCE';
    add(fromEntry(edge,{phase:Number(edge.metadata?.phase??phaseForStage(edge.subtype)),stage:edge.title??('Causal edge · '+label(edge.subtype)),category:'EDGE',severity:missing?'WARN':severityFromEntry(edge),status:edge.status,reasonCode:edge.metadata?.reasonCode??null,summary:edge.summary}));
  }

  const scatter=latest(entries.filter(e=>e.type==='SCATTER'));
  if(scatter)add(fromEntry(scatter,{phase:30,stage:'Fan-out plan',category:'RUNTIME',severity:'OK',status:scatter.status,summary:scatter.summary}));

  const audit=latest(entries.filter(e=>e.type==='JOB_AUDIT'));
  const resultToJob=new Map();
  for(const job of audit?.metadata?.jobs??[])for(const adm of job.gatherAdmissions??[])if(adm?.resultId&&!resultToJob.has(String(adm.resultId)))resultToJob.set(String(adm.resultId),job.jobId??null);
  for(const job of audit?.metadata?.jobs??[]){
    const resourceId=job.assignedOptionalResourceId??job.assignedNativeResourceId??null;
    const resourceKind=job.assignedOptionalResourceId?'optional':job.assignedNativeResourceId?'native':'unknown';
    add({id:'JOB:'+selectionKey(selection)+':'+String(job.jobId??job.sequence??rows.length),phase:40,stage:'Fan-out job',category:'RUNTIME',severity:job.outcome&&/FAIL|ERROR/i.test(String(job.outcome))?'ERROR':'OK',status:job.outcome??'UNKNOWN',reasonCode:job.reasonCode??null,time:job.startAt??job.endAt??null,observedAt:audit?.at??null,receiptId:audit?.receiptRef??null,correlationId:selection.correlationId??null,jobId:job.jobId??null,resourceId,resultId:null,summary:(job.jobId??'Logical job')+' → '+(resourceId??'resource attribution unknown')+' ('+resourceKind+'). '+(job.resultIds?.length?job.resultIds.length+' attributable result(s).':'Result attribution unknown or not published.'),sourceEntryIds:[audit.id]});
  }

  const lifecycle=latest(entries.filter(e=>e.type==='OPTIONAL_RESOURCE_LIFECYCLE'));
  for(const resource of lifecycle?.metadata?.resources??[]){
    const status=resource.skipReason&&!resource.attempted?'SKIPPED':resource.failed?'FAILED':resource.succeeded?(resource.ownerAccepted?'SUCCEEDED_ACCEPTED':'SUCCEEDED_OWNER_NOT_ACCEPTED'):resource.attempted?'ATTEMPTED':resource.qualifiedCallable?'QUALIFIED':'CONFIGURED';
    const severity=resource.failed?'ERROR':resource.attempted&&!resource.succeeded?'WARN':resource.succeeded?'OK':'INFO';
    const summary=resource.skipReason&&!resource.attempted
      ? label(resource.kind)+' was intentionally skipped: '+resource.skipReason+'. No provider attempt occurred.'
      : resource.attempted
        ? label(resource.kind)+' provider execution '+(resource.succeeded?'succeeded':'did not succeed')+(resource.succeeded&&!resource.ownerAccepted?'; owner acceptance is not evidenced.':'.')
        : label(resource.kind)+' is '+(resource.qualifiedCallable?'qualified/callable':'configured')+' but was not executed for this turn.';
    add({id:'RESOURCE:'+selectionKey(selection)+':'+String(resource.id??resource.kind),phase:50,stage:'Optional resource',category:'RESOURCE',severity,status,reasonCode:resource.skipReason??null,time:null,observedAt:lifecycle?.at??null,receiptId:lifecycle?.receiptRef??null,correlationId:selection.correlationId??null,resourceId:resource.id??null,summary,sourceEntryIds:[lifecycle.id]});
  }
  for(const entry of entries.filter(e=>e.type==='RESOURCE_ATTEMPT'))add(fromEntry(entry,{phase:50,stage:'Provider attempt',category:'RESOURCE',severity:entry.status==='FAILED'?'ERROR':'OK',status:entry.status,resourceId:entry.metadata?.resourceId??null,summary:entry.summary}));

  const gather=latest(entries.filter(e=>e.type==='GATHER'));
  const seal=latest(entries.filter(e=>e.type==='CONTEXT_SEAL'));
  const sealed=new Set((seal?.metadata?.admittedResultIds??[]).map(String));
  if(gather){
    for(const result of gather.metadata?.results??[]){
      const resultId=result.resultId??null,jobId=result.taskId??result.jobId??(resultId?resultToJob.get(String(resultId))??null:null),state=String(result.status??(result.accepted?'ADMITTED':'RETURNED')).toUpperCase();
      const admitted=state==='ADMITTED'||result.accepted===true,late=state==='LATE',stale=state==='STALE',rejected=['REJECTED','INVALID'].includes(state),sealedResult=Boolean(resultId&&sealed.has(String(resultId)));
      add({id:'RESULT:'+selectionKey(selection)+':'+String(resultId??rows.length),phase:60,stage:'Result',category:'RESULT',severity:rejected?'ERROR':late||stale?'WARN':admitted?'OK':'INFO',status:state,reasonCode:result.reasonCode??null,time:result.at??result.completedAt??null,observedAt:gather.at??null,receiptId:gather.receiptRef??null,correlationId:selection.correlationId??null,jobId,resourceId:result.resourceId??null,resultId,summary:(resultId??'Returned result')+' · '+(jobId?'job '+jobId:'job attribution unknown')+(result.destination?' → '+result.destination:' → destination unknown')+' · Gather '+state+(sealedResult?' · admitted by Context Seal':' · not evidenced in Context Seal'),sourceEntryIds:[gather.id,...(seal?[seal.id]:[])]});
    }
    add(fromEntry(gather,{phase:70,stage:'Gather',category:'GATHER',severity:(gather.metadata?.counts?.REJECTED??0)||(gather.metadata?.counts?.INVALID??0)?'WARN':'OK',status:gather.status,summary:gather.summary}));
  }
  if(seal)add(fromEntry(seal,{phase:80,stage:'Context Seal',category:'CONTEXT',severity:seal.status==='SEALED'?'OK':'WARN',status:seal.status,summary:seal.summary}));

  const prompt=latest(entries.filter(e=>e.type==='PROMPT_PLAN'));
  if(prompt)add(fromEntry(prompt,{phase:90,stage:'PromptPlan',category:'DELIVERY',severity:'INFO',status:'PLANNED',summary:prompt.summary}));
  const delivery=latest(entries.filter(e=>e.type==='HOST_DELIVERY'));
  if(delivery)add(fromEntry(delivery,{phase:100,stage:'Observed host delivery',category:'DELIVERY',severity:delivery.status==='ABORTED'?'ERROR':delivery.status==='PREPARED'?'WARN':'OK',status:delivery.status,reasonCode:delivery.metadata?.abortCode??null,time:delivery.metadata?.requestInjectedAt??delivery.metadata?.completedAt??delivery.metadata?.preparedAt??null,summary:delivery.summary}));
  else if(prompt)add({id:'HOST_DELIVERY:'+selectionKey(selection)+':unknown',phase:100,stage:'Observed host delivery',category:'DELIVERY',severity:'WARN',status:'UNKNOWN',reasonCode:'HOST_DELIVERY_NOT_OBSERVED',time:null,observedAt:prompt.at??turn?.lastUpdatedAt??null,receiptId:null,correlationId:selection.correlationId??null,summary:'PromptPlan exists, but no exact SillyTavern host-boundary delivery receipt is retained for this generation.',sourceEntryIds:[prompt.id]});

  const learning=latest(entries.filter(e=>e.type==='LEARNING'));
  if(learning)add(fromEntry(learning,{phase:110,stage:'Post-response learning',category:'LEARNING',severity:'OK',status:learning.status,summary:learning.summary}));

  return rows.sort((a,b)=>a.phase-b.phase||numericTime(a.time)-numericTime(b.time)||numericTime(a.observedAt)-numericTime(b.observedAt)||a.id.localeCompare(b.id));
}

function summarize(turn,rows){
  const entries=Array.isArray(turn?.entries)?turn.entries:[],audit=latest(entries.filter(e=>e.type==='JOB_AUDIT')),gather=latest(entries.filter(e=>e.type==='GATHER')),lifecycle=latest(entries.filter(e=>e.type==='OPTIONAL_RESOURCE_LIFECYCLE')),prompt=latest(entries.filter(e=>e.type==='PROMPT_PLAN')),delivery=latest(entries.filter(e=>e.type==='HOST_DELIVERY'));
  const ownerEdges=entries.filter(e=>e.type==='OWNER_EDGE'),ownerEvidenceEdges=ownerEdges.filter(e=>String(e.status??'').toUpperCase()!=='NO_EVIDENCE').length,missingOwnerEdges=ownerEdges.length-ownerEvidenceEdges;
  const logicalJobs=Number(audit?.metadata?.logicalJobCount??0),nativeResources=(audit?.metadata?.nativeResourceIds??[]).length,resources=lifecycle?.metadata?.resources??[],optionalAttempts=resources.filter(r=>r.attempted).length,counts=gather?.metadata?.counts??{};
  const gatherAdmitted=Number(counts.ADMITTED??0),gatherRejected=Number(counts.REJECTED??0)+Number(counts.INVALID??0),gatherLate=Number(counts.LATE??0),gatherStale=Number(counts.STALE??0),readErrors=rows.filter(r=>r.category==='ERROR').length;
  const jobText=logicalJobs?logicalJobs+' logical job'+(logicalJobs===1?'':'s')+' recorded across '+nativeResources+' native resource'+(nativeResources===1?'':'s')+'; '+optionalAttempts+' optional provider attempt'+(optionalAttempts===1?'':'s')+'.':'No selected-turn job audit is retained.';
  const edgeText=ownerEdges.length?' '+ownerEvidenceEdges+' causal owner edge'+(ownerEvidenceEdges===1?'':'s')+' have evidence; '+missingOwnerEdges+' explicitly have no evidence.':' Causal owner receipts are not retained yet.';
  return{logicalJobs,nativeResources,optionalAttempts,gatherAdmitted,gatherRejected,gatherLate,gatherStale,promptPlanState:prompt?'PLANNED':'NOT OBSERVED',hostDeliveryState:delivery?.status??'NOT OBSERVED',readErrors,ownerEvidenceEdges,missingOwnerEdges,explanation:jobText+edgeText+' Connection/qualification alone is not execution evidence.'};
}

function renderDetail(d,row,payload){
  if(!payload)return element(d,'p',{className:'a52-muted',text:'No additional safe detail is retained for this row.'});
  const wrap=element(d,'div',{className:'a52-stack',attrs:{'aria-label':'Bounded metadata-only turn-log detail'}});
  wrap.append(createKeyValue(d,[
    {key:'Category',value:row.category},{key:'Status',value:row.status},{key:'Reason',value:row.reasonCode??'not published'},
    {key:'Correlation',value:row.correlationId??'unknown'},{key:'Receipt',value:row.receiptId??'unknown'},
    {key:'Job',value:row.jobId??'not attributed'},{key:'Resource',value:row.resourceId??'not attributed'},{key:'Result',value:row.resultId??'not attributed'},
  ]));
  for(const source of payload.sources??[]){
    const values=detailPairs(source,row);
    if(values.length)wrap.append(element(d,'strong',{text:label(source.type??'Evidence')}),createKeyValue(d,values));
  }
  if(payload.truncated)wrap.append(element(d,'p',{className:'a52-muted',text:'Additional metadata was clipped to the bounded detail limit.'}));
  return wrap;
}

function detailPairs(source,row){
  const value=source.job??source.result??source.resource??source.metadata??null,pairs=[];
  if(source.summary)pairs.push({key:'Summary',value:source.summary});
  if(source.detail)pairs.push({key:'Detail',value:source.detail});
  if(!value||typeof value!=='object')return pairs;
  const preferred=['producer','consumer','edgeClass','parentReceiptId','correlationId','durationMs','lifecycleState','worldRevision','sceneRevision','sourceRevisionRefs','owner','sequence','reasonCode','assignedNativeResourceId','assignedOptionalResourceId','startAt','endAt','outcome','providerAttempted','resultId','taskId','jobId','status','accepted','resourceId','destination','capability','at','configured','qualifiedCallable','attempted','succeeded','failed','ownerAccepted','ownerAcceptanceSource','skipReason','measurementClass'];
  for(const key of preferred){
    const v=value[key];if(v==null||v===''||(Array.isArray(v)&&!v.length))continue;
    pairs.push({key:label(key),value:Array.isArray(v)?v.join(', '):String(v)});
  }
  if(source.contextSeal)pairs.push({key:'Context Seal',value:Object.entries(source.contextSeal).filter(([,v])=>v).map(([k])=>label(k)).join(', ')||'not admitted'});
  if(value.resultIds?.length)pairs.push({key:'Attributable results',value:value.resultIds.join(', ')});
  if(value.gatherAdmissions?.length)pairs.push({key:'Gather admissions',value:value.gatherAdmissions.map(x=>x.resultId??x.status??'receipt').join(', ')});
  if(value.contextSealResultIds?.length)pairs.push({key:'Context Seal results',value:value.contextSealResultIds.join(', ')});
  return pairs.slice(0,24);
}

function detailPayload(journal,selection,row,maxDetailBytes){
  const sources=(row.sourceEntryIds??[]).map(id=>journal?.readEntry?.(selection,id)).filter(Boolean);
  const detail=sources.map(entry=>detailForRow(row,entry));
  return boundObject(sanitize({kind:'Area52TurnLogDetail',contractVersion:TURN_LOG_DIAGNOSTICS_VERSION,row,sources:detail,safety:{metadataOnly:true}}),maxDetailBytes);
}

function detailForRow(row,entry){
  const base={entryId:entry.id,type:entry.type,subtype:entry.subtype,status:entry.status,receiptRef:entry.receiptRef,observedAt:entry.at,selection:entry.selection};
  if(row.jobId&&entry.type==='JOB_AUDIT')return{...base,job:(entry.metadata?.jobs??[]).find(x=>String(x.jobId??'')===String(row.jobId))??null};
  if(row.resultId&&entry.type==='GATHER')return{...base,result:(entry.metadata?.results??[]).find(x=>String(x.resultId??'')===String(row.resultId))??null,counts:entry.metadata?.counts??null};
  if(row.resultId&&entry.type==='CONTEXT_SEAL')return{...base,contextSeal:{admitted:(entry.metadata?.admittedResultIds??[]).includes(row.resultId),rejected:(entry.metadata?.rejectedResultIds??[]).includes(row.resultId),late:(entry.metadata?.lateResultIds??[]).includes(row.resultId),stale:(entry.metadata?.staleResultIds??[]).includes(row.resultId)}};
  if(row.resourceId&&entry.type==='OPTIONAL_RESOURCE_LIFECYCLE')return{...base,resource:(entry.metadata?.resources??[]).find(x=>String(x.id??'')===String(row.resourceId))??null};
  return{...base,summary:entry.summary,detail:entry.detail,metadata:entry.metadata};
}

function fromEntry(entry,overrides={}){return{id:overrides.id??entry.id,phase:overrides.phase??50,stage:overrides.stage??entry.title,category:overrides.category??'COGNITION',severity:overrides.severity??severityFromEntry(entry),status:overrides.status??entry.status,reasonCode:overrides.reasonCode??entry.metadata?.errorCode??null,time:overrides.time??null,observedAt:entry.at??null,receiptId:overrides.receiptId??entry.receiptRef??null,correlationId:entry.selection?.correlationId??null,jobId:overrides.jobId??null,resourceId:overrides.resourceId??null,resultId:overrides.resultId??null,summary:overrides.summary??entry.summary,sourceEntryIds:[entry.id]};}
function normalizeRow(row,selection){return{...row,correlationId:row.correlationId??selection.correlationId??null,sourceEntryIds:[...(row.sourceEntryIds??[])].filter(Boolean),summary:safeText(row.summary,1024),reasonCode:row.reasonCode?String(row.reasonCode):null,status:String(row.status??'UNKNOWN'),severity:String(row.severity??'INFO'),category:String(row.category??'COGNITION'),stage:String(row.stage??'Stage'),time:finite(row.time),observedAt:finite(row.observedAt),phase:Number(row.phase??50)};}
function stripPrivate(row){const {phase,...out}=row;return safeClone(out);}
function boundedVisibleRows(rows,limit){
  if(rows.length<=limit)return rows;
  const head=Math.ceil(limit/2),tail=Math.floor(limit/2);
  return [...rows.slice(0,head),...rows.slice(-tail)];
}
function latest(rows){return rows.length?rows.reduce((a,b)=>Number(a?.at??0)>=Number(b?.at??0)?a:b):null;}
function severityFromEntry(entry){const status=String(entry?.status??'').toUpperCase(),code=String(entry?.metadata?.errorCode??'').toUpperCase();if(/FAIL|ERROR|DEGRADED|ABORT/.test(status)||/ERROR|STALE|FUTURE|MISMATCH/.test(code))return'ERROR';if(/WAIT|LATE|STALE|REJECT|INVALID|UNAVAILABLE/.test(status))return'WARN';if(/COMPLETE|LIVE|READY|SEALED|SUCCEEDED|RECORDED|MAPPED/.test(status))return'OK';return'INFO';}
function phaseForStage(stage){const x=String(stage??'').toLowerCase();if(x.includes('choice')||x.includes('hot'))return 20;if(x.includes('runtime')||x.includes('scatter'))return 30;if(x.includes('gather'))return 70;if(x.includes('seal'))return 80;if(x.includes('prompt'))return 90;if(x.includes('generation')||x.includes('delivery'))return 100;return 25;}
function normalizeFilters(filters,now){const time=String(filters?.time??'ALL').toUpperCase(),category=String(filters?.category??'ALL').toUpperCase(),severity=String(filters?.severity??'ALL').toUpperCase(),search=String(filters?.search??'').trim();const windowMs=time==='1M'?60000:time==='5M'?300000:time==='15M'?900000:null;return{time:['ALL','1M','5M','15M'].includes(time)?time:'ALL',category,severity,search,since:windowMs==null?null:Number(now)-windowMs};}
function matchesFilters(row,filters){if(filters.category!=='ALL'&&row.category!==filters.category)return false;if(filters.severity!=='ALL'&&row.severity!==filters.severity)return false;if(filters.since!=null){const t=row.time??row.observedAt;if(t==null||t<filters.since)return false;}if(filters.search){const hay=[row.stage,row.status,row.reasonCode,row.receiptId,row.correlationId,row.jobId,row.resourceId,row.resultId,row.summary].filter(Boolean).join(' ').toLowerCase();if(!hay.includes(filters.search.toLowerCase()))return false;}return true;}
function normalizeSelection(value={}){return{chatId:text(value.chatId),turnId:text(value.turnId),generationId:text(value.generationId),correlationId:text(value.correlationId),worldRevision:numberOrNull(value.worldRevision),sceneRevision:numberOrNull(value.sceneRevision),sourceRevisionRefs:[...new Set((value.sourceRevisionRefs??[]).map(text).filter(Boolean))].slice(0,32)};}
function selectionKey(value={}){return[value.chatId??'',value.turnId??'',value.generationId??''].join('|');}
function selectControl(d,labelText,value,options){const wrap=element(d,'label',{className:'a52-stack'}),labelNode=element(d,'span',{className:'a52-muted',text:labelText}),input=element(d,'select',{attrs:{'aria-label':labelText+' filter'}});for(const [id,label] of options){const opt=element(d,'option',{attrs:{value:id},text:label});if(id===value)opt.selected=true;input.append(opt);}wrap.append(labelNode,input);return{wrap,input};}
function displayTime(row){if(row.time!=null)return formatTime(row.time);if(row.observedAt!=null)return'Time unknown · observed '+formatTime(row.observedAt);return'Time unknown';}
function formatTime(value){try{return new Date(Number(value)).toLocaleTimeString();}catch{return'unknown';}}
function severityStatus(value){return value==='ERROR'?'warning':value==='WARN'?'warning':value==='OK'?'ready':'historical';}
function statusToken(value){const x=String(value??'').toUpperCase();if(/FAIL|ERROR|ABORT|REJECT|INVALID/.test(x))return'warning';if(/COMPLETE|LIVE|READY|SEALED|SUCCESS|ADMITTED|RECORDED|MAPPED|INJECTED/.test(x))return'ready';return'historical';}
function label(value){return String(value??'unknown').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\b\w/g,m=>m.toUpperCase());}
function text(value){const x=value==null?'':String(value).trim();return x||null;}
function finite(value){const n=Number(value);return value==null||!Number.isFinite(n)?null:n;}
function numericTime(value){const n=Number(value);return Number.isFinite(n)?n:Number.MAX_SAFE_INTEGER;}
function numberOrNull(value){const n=Number(value);return value==null||!Number.isFinite(n)?null:n;}
function filePart(value){return String(value??'').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,80)||'unknown';}
function safeText(value,limit=2048){let out=String(value??'');out=out.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi,'$1[REDACTED]');out=out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g,'[REDACTED]');out=out.replace(/(\b(?:api[_-]?key|authorization|credential|secret|password|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*)([^\s,;&]+)/gi,'$1[REDACTED]');return out.length>limit?out.slice(0,limit)+'…[clipped]':out;}
function sanitize(value,depth=0,key=''){if(depth>7)return'[depth-clipped]';const k=String(key??'').toLowerCase();if(BLOCKED_KEYS.has(k))return'[REDACTED]';if(value==null||typeof value==='number'||typeof value==='boolean')return value;if(typeof value==='string')return safeText(value);if(Array.isArray(value))return value.slice(0,64).map(v=>sanitize(v,depth+1,key));if(typeof value==='object'){const out={};for(const [name,v] of Object.entries(value)){const clean=sanitize(v,depth+1,name);if(clean!==undefined)out[name]=clean;}return out;}return safeText(value);}
function boundObject(value,maxBytes){let clean=sanitize(value),json=JSON.stringify(clean);if(json.length<=maxBytes)return clean;return{kind:clean?.kind??'Area52TurnLogDetail',contractVersion:TURN_LOG_DIAGNOSTICS_VERSION,row:clean?.row??null,sources:(clean?.sources??[]).slice(0,4).map(source=>({entryId:source.entryId,type:source.type,subtype:source.subtype,status:source.status,receiptRef:source.receiptRef,summary:safeText(source.summary??'Detail clipped to bounded export size.',512)})),truncated:true,maxBytes,safety:{metadataOnly:true}};}
function safeClone(value){if(value==null)return value;if(typeof structuredClone==='function')return structuredClone(value);return JSON.parse(JSON.stringify(value));}
