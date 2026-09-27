import { createButton, createKeyValue, element, makeBadge } from './primitives.js';
import { renderBrainDecisionExplanation } from './brain-decision-visibility.js';

export const TURN_LOG_DIAGNOSTICS_VERSION='1.2.0';
const DEFAULT_MAX_VISIBLE=96;
const DEFAULT_MAX_DETAIL_BYTES=12288;
const CATEGORY_ORDER=['HOST','EDGE','COGNITION','RUNTIME','RESOURCE','RESULT','GATHER','CONTEXT','DELIVERY','LEARNING','ERROR'];
const SEVERITY_ORDER=['ERROR','WARN','OK','INFO'];
const BLOCKED_KEYS=new Set(['rawprompt','prompt','prompttext','story','storytext','lorebody','contentbody','responsebody','reasoning','hiddenreasoning','apikey','api_key','authorization','credential','credentials','password','secret','access_token','refresh_token']);

export class SelectedTurnLogModel{
  constructor({journal,selectionProvider=()=>({}),decisionVisibility=null,now=()=>Date.now(),maxVisibleRows=DEFAULT_MAX_VISIBLE,maxDetailBytes=DEFAULT_MAX_DETAIL_BYTES}={}){
    this.journal=journal??null;this.decisionVisibility=decisionVisibility??null;
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
      summary:summarize(turn,allRows),brainDecision:safeDecisionRead(this.decisionVisibility,selected),retention:status,
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
      selection:selected,summary:summarize(turn,rows),brainDecision:safeDecisionRead(this.decisionVisibility,selected),rows,details,retention:this.journal?.status?.()??null,
      chronology:'OWNER_STAGE_ORDER_WITH_EXACT_TIMESTAMPS_WHEN_PUBLISHED',
      safety:{metadataOnly:true,rawPrompts:false,storyLoreBodies:false,credentials:false,hiddenReasoning:false,mutationAuthority:false},
    });
  }


  exportDiagnosticsBundle({selection=null,operationalSnapshot=null}={}){
    const selectedTurn=this.exportMetadata({selection}),exportedAt=this.now();
    const cleanOperational=sanitize(operationalSnapshot??null);
    const manifest=sanitize({
      kind:'Area52DiagnosticsBundleManifest',contractVersion:TURN_LOG_DIAGNOSTICS_VERSION,exportedAt,
      selection:selectedTurn.selection,
      sources:{
        selectedTurn:true,
        operationalSnapshot:Boolean(cleanOperational),
        brainDecision:Boolean(selectedTurn.brainDecision),
        eventTimeline:true,
        retention:Boolean(selectedTurn.retention),
      },
      chronology:selectedTurn.chronology,
      safety:selectedTurn.safety,
      note:'This bundle contains every bounded diagnostic surface currently retained by the Area-52 Diagnostics UI. Missing owner evidence remains explicitly missing and is never reconstructed.',
    });
    const files=[
      {path:'manifest.json',content:JSON.stringify(manifest,null,2)},
      {path:'selected-turn/diagnostics.json',content:JSON.stringify(selectedTurn,null,2)},
      {path:'selected-turn/timeline.json',content:JSON.stringify(selectedTurn.rows??[],null,2)},
      {path:'selected-turn/timeline.jsonl',content:(selectedTurn.rows??[]).map(row=>JSON.stringify(row)).join('\n')},
      {path:'selected-turn/brain-decision.json',content:JSON.stringify(selectedTurn.brainDecision??null,null,2)},
      {path:'session/operational-snapshot.json',content:JSON.stringify(cleanOperational??null,null,2)},
      {path:'session/retention.json',content:JSON.stringify(selectedTurn.retention??null,null,2)},
      {path:'README.txt',content:'Area-52 Diagnostics export\n\nThis archive is metadata-only. Raw prompts, story/Lore bodies, credentials, keys, and hidden reasoning are excluded. Missing evidence is reported as missing rather than inferred.\n'},
    ];
    return{kind:'Area52DiagnosticsBundle',contractVersion:TURN_LOG_DIAGNOSTICS_VERSION,exportedAt,selection:selectedTurn.selection,manifest,files};
  }

  downloadDiagnosticsBundle({selection=null,operationalSnapshot=null,document=globalThis.document??null,filename=null}={}){
    const bundle=this.exportDiagnosticsBundle({selection,operationalSnapshot});
    const BlobCtor=globalThis.Blob,URLApi=globalThis.URL;
    if(!document?.createElement||typeof BlobCtor!=='function'||typeof URLApi?.createObjectURL!=='function'||typeof globalThis.TextEncoder!=='function')return{ok:false,reason:'DOWNLOAD_API_UNAVAILABLE',bundle};
    const blob=createStoredZipBlob(bundle.files,{BlobCtor,TextEncoderCtor:globalThis.TextEncoder,exportedAt:bundle.exportedAt});
    if(!blob)return{ok:false,reason:'ZIP_BUILD_FAILED',bundle};
    const url=URLApi.createObjectURL(blob),a=document.createElement('a'),id=bundle.selection;
    a.href=url;a.download=filename??['area52-diagnostics',id?.chatId,id?.turnId,id?.generationId].filter(Boolean).map(filePart).join('-')+'.zip';a.style.display='none';document.body?.append?.(a);
    try{a.click?.();}finally{a.remove?.();URLApi.revokeObjectURL?.(url);}
    return{ok:true,filename:a.download,bundle};
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

export function installTurnLogDiagnosticsWorkspace(registry,{journal,selectionProvider=()=>({}),decisionVisibility=null,maxVisibleRows=DEFAULT_MAX_VISIBLE}={}){
  if(!registry||!journal)return null;
  const model=new SelectedTurnLogModel({journal,selectionProvider,decisionVisibility,maxVisibleRows});
  const filters={time:'ALL',category:'ALL',severity:'ALL',search:''};
  const id='turn-log';
  if(!registry.has(id))registry.register({
    id,title:'Diagnostics',icon:'⌁',category:'Product',navigation:{level:'product',order:85},views:['normal','detail','advanced'],supportedActions:['export-diagnostics','export-metadata','filter','drilldown'],
    render(host,ctx){renderTurnLogWorkspace(host,{...ctx,model,filters});},
  });
  return{model,release(){try{registry.unregister(id);}catch{}},filters};
}

export function buildSelectedTurnLog(turn,selection={}){
  return buildTurnRows(turn,normalizeSelection(selection)).map(stripPrivate);
}

function renderTurnLogWorkspace(host,{model,filters,scope,refresh,diagnostics,inspect}={}){
  const d=host.ownerDocument,snapshot=model.read({filters}),live=safeDiagnosticsRead(diagnostics),root=element(d,'section',{className:'a52-stack a52-turn-log a52-diagnostics-workspace',attrs:{'aria-label':'Area-52 diagnostics'}});
  const s=snapshot.selection??{},summary=snapshot.summary??{},health=diagnosticsHealth(live,snapshot);

  const hero=element(d,'section',{className:'a52-card a52-turn-log__hero'});
  const heroHead=element(d,'div',{className:'a52-wave13-section-head'});
  heroHead.append(element(d,'strong',{text:'Area-52 Diagnostics'}),makeBadge(d,health.label,health.status));
  const heroActions=element(d,'div',{className:'a52-wave13-resource-actions'});
  heroActions.append(createButton(d,{label:'Export Full Diagnostics',scope,size:'sm',variant:'primary',onPress:()=>model.downloadDiagnosticsBundle({selection:s,operationalSnapshot:live,document:d})}));
  if(refresh)heroActions.append(createButton(d,{label:'Refresh',scope,size:'sm',variant:'quiet',onPress:()=>refresh()}));
  heroHead.append(heroActions);
  hero.append(heroHead,element(d,'p',{className:'a52-muted',text:'One read-only console for selected-turn evidence, Brain decisions, runtime/jobs, resources, Lore/Memory, delivery, failures, and UI performance. Missing evidence stays missing; the UI never reconstructs owner decisions from nearby activity.'}));
  hero.append(createKeyValue(d,[
    {key:'Chat',value:s.chatId??'No chat selected'},{key:'Turn',value:s.turnId??'Waiting for turn'},{key:'Generation',value:s.generationId??'Waiting for generation'},
    {key:'Rows retained',value:snapshot.totalRows??0},{key:'Warnings / errors',value:health.issueCount},{key:'Last evidence update',value:snapshot.lastUpdatedAt?formatTime(snapshot.lastUpdatedAt):'Not retained'},
  ]));
  hero.append(element(d,'p',{className:'a52-muted',text:summary.explanation??'No selected-turn evidence is retained yet.'}));
  root.append(hero);

  const coordination=diagnosticSection(d,'Coordination snapshot',snapshot.current?'Selected turn correlated':'Waiting for selected turn',{status:snapshot.current?'ready':'historical',open:true});
  coordination.body.append(createKeyValue(d,[
    {key:'Correlation',value:s.correlationId??'unknown'},{key:'World / Scene revision',value:(s.worldRevision??'unknown')+' / '+(s.sceneRevision??'unknown')},
    {key:'Source revision fence',value:s.sourceRevisionRefs?.length?s.sourceRevisionRefs.join(', '):'unknown'},
    {key:'Causal owner edges',value:String(summary.ownerEvidenceEdges??0)+' evidenced / '+String(summary.missingOwnerEdges??0)+' no evidence'},
    {key:'Live-binding reads / rejected',value:live?(String(live.host?.liveBinding?.reads??0)+' / '+String(live.host?.liveBinding?.rejected??0)):'No operational snapshot'},
  ]));
  root.append(coordination.root);

  const brain=diagnosticSection(d,'Brain / cognition',snapshot.brainDecision?.state??'NO EVIDENCE',{status:snapshot.brainDecision&&snapshot.brainDecision.state!=='NO_EVIDENCE'?'ready':'historical'});
  if(snapshot.brainDecision)brain.body.append(renderBrainDecisionExplanation(d,snapshot.brainDecision,{compact:true,title:'Brain decision evidence'}));
  else brain.body.append(emptyDiagnostic(d,'No Brain decision receipt','No exact selected-turn Brain decision evidence is retained.'));
  const scatter=live?.cognition?.scatterTelemetry??[];
  if(Array.isArray(scatter)&&scatter.length){
    brain.body.append(element(d,'strong',{text:'Layered Scatter'}));
    for(const wave of scatter.slice(0,12))brain.body.append(compactStatusRow(d,wave.waveId??'Wave','INFO',[
      wave.trigger?'trigger '+wave.trigger:null,wave.durationMs!=null?wave.durationMs+' ms':null,wave.concurrency!=null?'concurrency '+wave.concurrency:null,
      wave.jobs!=null?'jobs '+wave.jobs:null,wave.deferred!=null?'deferred '+wave.deferred:null,
    ].filter(Boolean).join(' · ')||'Owner wave telemetry published.'));
  }
  root.append(brain.root);

  const runtime=live?.runtime?.summary??{},runtimeCounts=runtime.lifecycleCounts??{},copro=live?.coprocessor?.summary??{};
  const runtimeSection=diagnosticSection(d,'Runtime / jobs',String(summary.logicalJobs??0)+' jobs · '+String(runtimeCounts.ACTIVE??0)+' active',{status:(runtimeCounts.FAILED??0)>0?'warning':'historical'});
  runtimeSection.body.append(createKeyValue(d,[
    {key:'Logical jobs',value:summary.logicalJobs??0},{key:'Native resources',value:summary.nativeResources??0},{key:'Optional provider attempts',value:summary.optionalAttempts??0},
    {key:'Gather admitted',value:summary.gatherAdmitted??0},{key:'Rejected / late / stale',value:[summary.gatherRejected??0,summary.gatherLate??0,summary.gatherStale??0].join(' / ')},
    {key:'Queue by layer',value:Object.entries(runtime.queueDepth??{}).map(([key,value])=>key+': '+value).join(' · ')||'Not published'},
    {key:'Active / yielding',value:(runtimeCounts.ACTIVE??0)+' / '+(runtimeCounts.YIELDING??0)},{key:'Complete / failed',value:(runtimeCounts.COMPLETE??0)+' / '+(runtimeCounts.FAILED??0)},
    {key:'Coprocessor events',value:copro.totalEvents??0},{key:'Retries',value:copro.retry??0},
  ]));
  const jobRows=snapshot.rows.filter(row=>row.stage==='Fan-out job');
  if(jobRows.length){
    runtimeSection.body.append(element(d,'strong',{text:'Selected-turn jobs'}));
    for(const row of jobRows.slice(0,24))runtimeSection.body.append(renderRow(d,row,{model,selection:s,scope,inspect}));
  }else runtimeSection.body.append(emptyDiagnostic(d,'No owner-backed job audit','No selected-turn job audit is retained.'));
  root.append(runtimeSection.root);

  const resourcesSection=diagnosticSection(d,'Resources / connections',resourceHeadline(live),{status:resourceHealthStatus(live)});
  const wiringSpecs=[['Jev',live?.wiring?.jev],['Sidecar',live?.wiring?.sidecar],['Vectoring',live?.wiring?.vectoring]];
  for(const [name,spec] of wiringSpecs){
    const lane=spec?.lane??{},status=lane.connected>0?'CONNECTED':lane.configured>0?'CONFIGURED':'NOT CONNECTED';
    resourcesSection.body.append(compactStatusRow(d,name,status,[lane.configured??0,'configured ·',lane.connected??0,'connected ·',lane.attempted??0,'attempted ·',lane.succeeded??0,'succeeded'].join(' '),status==='CONNECTED'?'ready':status==='CONFIGURED'?'warning':'historical'));
  }
  const resourceEvents=live?.telemetry?.resourceEvents??[];
  if(resourceEvents.length){
    resourcesSection.body.append(element(d,'strong',{text:'Recent owner resource telemetry'}));
    for(const event of resourceEvents.slice(0,16)){
      const row=compactStatusRow(d,event.displayName??event.resourceId??'Resource',event.code??'EVENT',event.message??'',resourceEventStatus(event));
      if(inspect)scope?.listen?.(row,'click',()=>inspect({kind:'area52-resource-diagnostic',id:String(event.sequence??event.code??'event'),title:(event.displayName??event.resourceId??'Resource')+' · '+(event.code??'event'),payload:event}));
      resourcesSection.body.append(row);
    }
  }
  root.append(resourcesSection.root);

  const lore=live?.lore??{},memory=live?.memory??{},memoryCounts=memory.counts??{},memoryFresh=memory.freshness??{};
  const knowledge=diagnosticSection(d,'Lore / retrieval / memory','Lore '+String(lore.retrievalReady??0)+' ready · Memory '+String(memoryCounts.exactEvidence??0)+' exact',{status:'historical'});
  knowledge.body.append(element(d,'strong',{text:'Lore / retrieval'}),createKeyValue(d,[
    {key:'Accepted',value:lore.accepted??0},{key:'Learned/current',value:lore.learned??0},{key:'Retrieval-ready',value:lore.retrievalReady??0},
    {key:'Due / active / invalid',value:[lore.lifecycle?.due??0,lore.lifecycle?.active??lore.lifecycle?.counts?.ACTIVE??0,lore.lifecycle?.counts?.INVALID??0].join(' / ')},
  ]),element(d,'strong',{text:'Memory'}),createKeyValue(d,[
    {key:'Exact evidence',value:memoryCounts.exactEvidence??0},{key:'Current / historical / unresolved',value:[memoryCounts.current??0,memoryCounts.historical??0,memoryCounts.unresolved??0].join(' / ')},
    {key:'Episodes / reflections / summaries',value:[memoryCounts.episodes??0,memoryCounts.reflections??0,memoryCounts.summaries??0].join(' / ')},
    {key:'Fresh / stale summaries',value:[memoryFresh.freshSummaries??0,memoryFresh.staleSummaries??0].join(' / ')},{key:'Retrieval status',value:memory.retrievalStatus??'No selected-turn retrieval receipt'},
  ]));
  root.append(knowledge.root);

  const pipeline=live?.pipeline??{},producerStages=live?.producers?.stages??[];
  const evidence=diagnosticSection(d,'Delivery / owner evidence',String(summary.promptPlanState??'NOT OBSERVED')+' → '+String(summary.hostDeliveryState??'NOT OBSERVED'),{status:(summary.readErrors??0)>0?'warning':summary.hostDeliveryState&&summary.hostDeliveryState!=='NOT OBSERVED'?'ready':'historical'});
  evidence.body.append(createKeyValue(d,[
    {key:'PromptPlan',value:summary.promptPlanState??'NOT OBSERVED'},{key:'Host delivery',value:summary.hostDeliveryState??'NOT OBSERVED'},{key:'Source-fence/read errors',value:summary.readErrors??0},
    {key:'Registered producers',value:pipeline.registeredProducers??0},{key:'Execution receipt',value:pipeline.executionReceipt?'Published':'Not published'},
    {key:'Gather receipt',value:pipeline.resultReceipt?'Published':'Not published'},{key:'Context Seal receipt',value:pipeline.admissionReceipt?'Published':'Not published'},
  ]));
  if(producerStages.length){
    evidence.body.append(element(d,'strong',{text:'Producer receipts'}));
    for(const row of producerStages)evidence.body.append(compactStatusRow(d,row.label??row.id,row.state??'UNAVAILABLE',row.reason??'No additional detail.',producerStateStatus(row.state)));
  }
  const cognitionErrors=Object.entries(live?.cognition?.errors??{});
  if(cognitionErrors.length){
    evidence.body.append(element(d,'strong',{text:'Read / coherence issues'}));
    for(const [name,error] of cognitionErrors)evidence.body.append(compactStatusRow(d,name,error?.code??'READ ISSUE',error?.message??'Unknown cognition read failure.','warning'));
  }
  root.append(evidence.root);

  const uiLoad=live?.telemetry?.uiLoad??null,categories=uiLoad?.categories??{};
  const performance=diagnosticSection(d,'Performance / UI attribution',uiLoad?'Bounded samples available':'NO EVIDENCE',{status:uiLoad?'ready':'historical'});
  performance.body.append(createKeyValue(d,[
    {key:'Host event invalidations',value:formatLoadMetric(categories.HOST_EVENT_INVALIDATION)},
    {key:'Scatter / Gather owner read',value:formatLoadMetric(categories.OWNER_SCATTER_GATHER_READ)},
    {key:'Journal diagnostics read',value:formatLoadMetric(categories.UI_JOURNAL_DIAGNOSTICS_READ)},
    {key:'Journal processing',value:formatLoadMetric(categories.UI_JOURNAL_PROCESS)},
    {key:'Activity feed render',value:formatLoadMetric(categories.UI_ACTIVITY_FEED_RENDER)},
    {key:'Workspace refresh',value:formatLoadMetric(categories.UI_WORKSPACE_REFRESH)},
    {key:'Capture total',value:formatLoadMetric(categories.UI_CAPTURE_TOTAL)},
  ]));
  performance.body.append(element(d,'p',{className:'a52-muted',text:'These are bounded in-browser attribution samples, not heap or Long Task profiling.'}));
  root.append(performance.root);

  const timeline=element(d,'section',{className:'a52-card a52-turn-log__timeline',attrs:{'aria-label':'Diagnostics event timeline'}});
  const timelineHead=element(d,'div',{className:'a52-wave13-section-head'});
  timelineHead.append(element(d,'strong',{text:'Event timeline'}),makeBadge(d,String(snapshot.matchingRows??0)+' MATCHING','historical'));
  timeline.append(timelineHead);
  const controls=element(d,'div',{className:'a52-wave13-resource-actions'});
  const timeSelect=selectControl(d,'Time',filters.time,[['ALL','All retained'],['1M','Last 1 minute'],['5M','Last 5 minutes'],['15M','Last 15 minutes']]);
  const catSelect=selectControl(d,'Category',filters.category,[['ALL','All categories'],...snapshot.availableCategories.map(x=>[x,x])]);
  const sevSelect=selectControl(d,'Severity',filters.severity,[['ALL','All severities'],...snapshot.availableSeverities.map(x=>[x,x])]);
  const search=element(d,'input',{className:'a52-input',attrs:{type:'search',placeholder:'Search stage, reason, receipt, job, result…','aria-label':'Search diagnostics'}});search.value=filters.search??'';
  controls.append(timeSelect.wrap,catSelect.wrap,sevSelect.wrap,search);
  scope?.listen?.(timeSelect.input,'change',()=>{filters.time=timeSelect.input.value;refresh?.();});
  scope?.listen?.(catSelect.input,'change',()=>{filters.category=catSelect.input.value;refresh?.();});
  scope?.listen?.(sevSelect.input,'change',()=>{filters.severity=sevSelect.input.value;refresh?.();});
  scope?.listen?.(search,'change',()=>{filters.search=String(search.value??'').trim();refresh?.();});
  timeline.append(controls,element(d,'p',{className:'a52-muted',text:snapshot.truncated?'Visible row cap reached; narrow filters or export the full Diagnostics bundle for the complete bounded retained set.':'Showing '+snapshot.visibleRows+' of '+snapshot.matchingRows+' matching rows.'}));
  if(!snapshot.rows.length)timeline.append(emptyDiagnostic(d,'No retained events',snapshot.current?'No retained evidence matches these filters.':'Select a chat turn and generation to populate Diagnostics.'));
  for(const row of snapshot.rows)timeline.append(renderRow(d,row,{model,selection:s,scope,inspect}));
  root.append(timeline);

  const retention=snapshot.retention??{};
  const retained=diagnosticSection(d,'Retention / safety',String(retention.turnCount??0)+' turns · '+String(retention.entryCount??0)+' entries',{status:retention.available===false?'warning':'historical'});
  retained.body.append(createKeyValue(d,[
    {key:'Storage',value:retention.available===false?'DEGRADED: '+String(retention.lastError??'local storage unavailable'):String(retention.storageKind??'unknown')},
    {key:'Retained turns / entries',value:String(retention.turnCount??0)+' / '+String(retention.entryCount??0)},{key:'Serialized bytes / ceiling',value:String(retention.serializedBytes??0)+' / '+String(retention.maxStoredBytes??'unknown')},
    {key:'Storage writes / skipped redundant writes',value:String(retention.writes??0)+' / '+String(retention.skippedRedundantWrites??0)},{key:'Payload policy',value:'metadata only; no raw prompts, story/Lore bodies, credentials, or hidden reasoning'},
  ]));
  root.append(retained.root);
  host.append(root);
}

function diagnosticSection(d,title,summary,{status='historical',open=false}={}){
  const root=element(d,'details',{className:'a52-card a52-turn-log__section'});root.open=open;
  const head=element(d,'summary',{className:'a52-wave13-section-head'});
  head.append(element(d,'strong',{text:title}),element(d,'span',{className:'a52-muted',text:String(summary??'')}),makeBadge(d,status==='warning'?'ATTENTION':status==='ready'?'LIVE':'DETAIL',status));
  const body=element(d,'div',{className:'a52-stack a52-turn-log__section-body'});root.append(head,body);return{root,body};
}

function compactStatusRow(d,title,status,summary,tone='historical'){
  const row=element(d,'div',{className:'a52-wave13-flow-row a52-turn-log__compact-row'});
  row.append(element(d,'strong',{text:String(title??'Diagnostic')}),makeBadge(d,String(status??'UNKNOWN'),tone),element(d,'span',{className:'a52-muted',text:String(summary??'')}));
  return row;
}

function emptyDiagnostic(d,title,text){
  const row=element(d,'div',{className:'a52-wave13-flow-row'});
  row.append(element(d,'strong',{text:title}),element(d,'span',{className:'a52-muted',text:text}));return row;
}

function diagnosticsHealth(live,snapshot){
  const producerFailures=Number(live?.producers?.failures??0),resourceIssues=(live?.resources?.rows??[]).filter(row=>['DEGRADED','UNAVAILABLE','COOLDOWN'].includes(String(row.state??row.health??'').toUpperCase())).length;
  const readErrors=Number(snapshot?.summary?.readErrors??0),issueCount=producerFailures+resourceIssues+readErrors;
  if(issueCount>0)return{label:'ATTENTION',status:'warning',issueCount};
  if(!snapshot?.current)return{label:'WAITING',status:'historical',issueCount:0};
  return{label:'LIVE',status:'ready',issueCount:0};
}

function safeDiagnosticsRead(diagnostics){
  try{return diagnostics?.read?sanitize(diagnostics.read()):null;}catch(error){return sanitize({readError:{code:error?.code??'DIAGNOSTICS_READ_FAILED',message:error?.message??'Diagnostics owner read failed.'}});}
}

function resourceHeadline(live){
  const rows=live?.resources?.rows??[],healthy=rows.filter(row=>['READY','CONNECTED','HEALTHY'].includes(String(row.state??row.health??'').toUpperCase())).length;
  return healthy+' healthy / '+rows.length+' published';
}
function resourceHealthStatus(live){return(live?.resources?.rows??[]).some(row=>['DEGRADED','UNAVAILABLE','COOLDOWN'].includes(String(row.state??row.health??'').toUpperCase()))?'warning':'historical';}
function resourceEventStatus(event){const code=String(event?.code??'').toUpperCase();return/FAIL|ERROR|DEGRADED|UNAVAILABLE|TIMEOUT/.test(code)?'warning':/PASS|READY|CONNECTED|SUCCESS|CONFIGURED/.test(code)?'ready':'historical';}
function producerStateStatus(state){const value=String(state??'').toUpperCase();if(value==='LIVE'||value==='READY')return'ready';if(value==='DEGRADED'||value==='ERROR'||value==='FAILED')return'warning';return'historical';}
function formatLoadMetric(value){if(!value)return'NO_EVIDENCE';const count=value.count??value.samples??0,avg=value.avgMs??value.averageMs??value.avg??null,max=value.maxMs??value.max??null;return String(count)+' samples'+(avg!=null?' · '+Number(avg).toFixed(2)+' ms avg':'')+(max!=null?' · '+Number(max).toFixed(2)+' ms max':'');}

function renderRow(d,row,{model,selection,scope,inspect}={}){
  const details=element(d,'details',{className:'a52-wave13-flow-row a52-turn-log__row',dataset:{turnLogRow:row.id}}),summary=element(d,'summary',{className:'a52-inline-status'});
  summary.append(element(d,'span',{className:'a52-muted',text:displayTime(row)}),makeBadge(d,row.severity,severityStatus(row.severity)),element(d,'strong',{text:row.stage}),makeBadge(d,row.status,statusToken(row.status)));
  if(row.receiptId)summary.append(element(d,'code',{text:row.receiptId}));
  details.append(summary,element(d,'p',{text:row.summary}),element(d,'p',{className:'a52-muted',text:[row.reasonCode?'Reason '+row.reasonCode:null,row.jobId?'Job '+row.jobId:null,row.resourceId?'Resource '+row.resourceId:null,row.resultId?'Result '+row.resultId:null].filter(Boolean).join(' · ')||'No additional correlation identity published.'}));
  let loaded=false;
  scope?.listen?.(details,'toggle',()=>{
    if(!details.open||loaded)return;loaded=true;const payload=model.detail(row.id,{selection});details.append(renderDetail(d,row,payload));
    if(inspect)inspect({kind:'area52-diagnostic-event',id:row.id,title:row.stage,category:row.category,severity:row.severity,status:row.status,selection:{...selection},payload});
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


function createStoredZipBlob(files,{BlobCtor=globalThis.Blob,TextEncoderCtor=globalThis.TextEncoder,exportedAt=Date.now()}={}){
  try{
    const encoder=new TextEncoderCtor(),locals=[],centrals=[];let offset=0,centralSize=0;
    const stamp=dosDateTime(exportedAt);
    for(const file of files??[]){
      const name=encoder.encode(String(file.path??'diagnostic.txt')),data=encoder.encode(String(file.content??'')),crc=crc32(data),size=data.byteLength;
      const local=new Uint8Array(30+name.byteLength),lv=new DataView(local.buffer);
      lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x0800,true);lv.setUint16(8,0,true);lv.setUint16(10,stamp.time,true);lv.setUint16(12,stamp.date,true);
      lv.setUint32(14,crc,true);lv.setUint32(18,size,true);lv.setUint32(22,size,true);lv.setUint16(26,name.byteLength,true);lv.setUint16(28,0,true);local.set(name,30);
      locals.push(local,data);
      const central=new Uint8Array(46+name.byteLength),cv=new DataView(central.buffer);
      cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x0800,true);cv.setUint16(10,0,true);cv.setUint16(12,stamp.time,true);cv.setUint16(14,stamp.date,true);
      cv.setUint32(16,crc,true);cv.setUint32(20,size,true);cv.setUint32(24,size,true);cv.setUint16(28,name.byteLength,true);cv.setUint16(30,0,true);cv.setUint16(32,0,true);cv.setUint16(34,0,true);cv.setUint16(36,0,true);cv.setUint32(38,0,true);cv.setUint32(42,offset,true);central.set(name,46);
      centrals.push(central);offset+=local.byteLength+size;centralSize+=central.byteLength;
    }
    const end=new Uint8Array(22),ev=new DataView(end.buffer),count=centrals.length;
    ev.setUint32(0,0x06054b50,true);ev.setUint16(4,0,true);ev.setUint16(6,0,true);ev.setUint16(8,count,true);ev.setUint16(10,count,true);ev.setUint32(12,centralSize,true);ev.setUint32(16,offset,true);ev.setUint16(20,0,true);
    return new BlobCtor([...locals,...centrals,end],{type:'application/zip'});
  }catch{return null;}
}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function dosDateTime(value){const d=new Date(Number(value)||Date.now()),year=Math.max(1980,d.getFullYear());return{time:(d.getHours()<<11)|(d.getMinutes()<<5)|Math.floor(d.getSeconds()/2),date:((year-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate()};}

function safeDecisionRead(adapter,selection){try{return adapter?.read?.(selection)??null;}catch(error){return{kind:'BrainDecisionVisibilityReadModel',contractVersion:1,selection,state:'NO_EVIDENCE',identityState:'READ_FAILED',stages:[],sensoryNominations:[],choiceDecisions:[],lifecycleObligations:[],candidateFlow:[],delivery:{planned:{state:'UNAVAILABLE'},sealed:{state:'UNAVAILABLE'},observed:{state:'UNAVAILABLE'}},missingReceipts:['NativeBrainSelectedTurnReceipt'],errors:[{stage:'BrainDecisionVisibility',code:error?.code??'READ_FAILED'}],safety:{metadataOnly:true,rawPrompts:false,storyLoreBodies:false,credentials:false,hiddenReasoning:false,mutationAuthority:false}};}}
