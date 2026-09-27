export const SELECTED_TURN_CAUSAL_REPORT_VERSION='1.0.0';

const OPTIONAL_STAGES=new Set(['jev','sidecar','vectoring']);
const OPEN_OBLIGATION_STATES=new Set(['DUE','BLOCKED','FAILED','DEFERRED','STALE','LATE']);

export class SelectedTurnCausalReportReader{
  constructor({journal,selectionProvider=()=>({}),loadTraceProvider=null,now=()=>Date.now(),maxRows=128,maxExportBytes=98304}={}){
    if(!journal||typeof journal.readTurn!=='function')throw new TypeError('SelectedTurnCausalReportReader requires a bounded evidence journal');
    this.journal=journal;
    this.selectionProvider=typeof selectionProvider==='function'?selectionProvider:()=>({});
    this.loadTraceProvider=typeof loadTraceProvider==='function'?loadTraceProvider:null;
    this.now=typeof now==='function'?now:()=>Date.now();
    this.maxRows=Math.max(32,Math.min(256,Number(maxRows)||128));
    this.maxExportBytes=Math.max(16384,Number(maxExportBytes)||98304);
  }

  read({selection=null,operatorObservations=[]}={}){
    const selected=normalizeSelection(selection??this.selectionProvider?.()??{});
    const turn=selected.chatId&&selected.turnId&&selected.generationId?this.journal.readTurn(selected):null;
    const entries=Array.isArray(turn?.entries)?turn.entries:[];
    const connections=projectConnections(entries.filter(row=>row.type==='OWNER_EDGE').slice(-this.maxRows));
    const obligations=projectObligations(latest(entries,'OBLIGATION_RECONCILIATION'));
    const jobs=projectJobs(latest(entries,'JOB_AUDIT'));
    const optionalResources=projectOptionalResources(latest(entries,'OPTIONAL_RESOURCE_LIFECYCLE'));
    const gather=latest(entries,'GATHER'),seal=latest(entries,'CONTEXT_SEAL'),prompt=latest(entries,'PROMPT_PLAN'),delivery=latest(entries,'HOST_DELIVERY');
    const evidence=projectEvidence({gather,seal,connections});
    const deliveryRead=projectDelivery({seal,prompt,delivery,connections});
    const missingOrBlocked=[
      ...connections.rows.filter(row=>row.status==='NO_EVIDENCE').map(row=>({kind:'OWNER_EDGE',stage:row.stage,state:'NO_EVIDENCE',reasonCode:row.reasonCode})),
      ...obligations.items.filter(row=>OPEN_OBLIGATION_STATES.has(row.status)).map(row=>({kind:'EXPECTED_WORK',stage:row.owner||row.expectedId,state:row.status,reasonCode:row.reasonCode,missingEvidence:row.missingEvidence})),
    ].slice(0,this.maxRows);
    const uiLoad=projectUiLoad(safeLoadTrace(this.loadTraceProvider));
    const observations=normalizeOperatorObservations(operatorObservations);
    const generationOutcome=generationOutcomeFor(deliveryRead);
    const report={
      kind:'Area52SelectedTurnCausalReport',contractVersion:SELECTED_TURN_CAUSAL_REPORT_VERSION,generatedAt:Number(this.now()),selection:selected,
      state:turn?'AVAILABLE':'NO_EVIDENCE',generationOutcome,connections,obligations,jobs,optionalResources,evidence,
      missingOrBlocked,delivery:deliveryRead,timing:projectTiming(connections,uiLoad),uiLoad,operatorObservations:observations,
      retention:projectRetention(this.journal.status?.()),authority:{truth:false,settlement:false,contextSeal:false,mutation:false,scheduling:false},
      safety:{metadataOnly:true,rawPrompts:false,storyLoreBodies:false,providerResponses:false,apiKeys:false,credentials:false,hiddenReasoning:false,browserTaskManagerMemoryAutomatic:false},
    };
    report.pasteableSummary=buildSummary(report);
    return freezeClone(report);
  }

  summaryText(options={}){return this.read(options).pasteableSummary;}

  exportDetailed(options={}){
    const report=this.read(options);
    return freezeClone(boundExport({kind:'Area52SelectedTurnCausalReportExport',contractVersion:SELECTED_TURN_CAUSAL_REPORT_VERSION,exportedAt:Number(this.now()),report,safety:report.safety},this.maxExportBytes));
  }
}

function projectConnections(entries){
  const rows=entries.map(row=>{
    const metadata=row.metadata??{},status=state(row.status),stage=String(metadata.stage??row.subtype??'unknown');
    const optional=OPTIONAL_STAGES.has(stage);
    const exercised=optional
      ? metadata.physicalAttempt===true||metadata.returned===true||metadata.ownerAccepted===true||['ATTEMPTED','RETURNED','OWNER_ACCEPTED'].includes(status)
      : !['NO_EVIDENCE','UNAVAILABLE','CONFIGURED','QUALIFIED'].includes(status);
    return{
      stage,producer:text(metadata.producer,128),consumer:text(metadata.consumer,128),status,reasonCode:reason(metadata.reasonCode)??(status==='NO_EVIDENCE'?'NO_EVIDENCE':null),
      receiptId:text(row.receiptRef,256),parentReceiptId:text(metadata.parentReceiptId,256),correlationId:text(metadata.correlationId??row.selection?.correlationId,256),
      lifecycleState:state(metadata.lifecycleState??status),durationMs:finiteOrNull(metadata.durationMs),ownerAccepted:booleanOrNull(metadata.ownerAccepted),
      configured:booleanOrNull(metadata.configured),qualified:booleanOrNull(metadata.qualified),physicalAttempt:booleanOrNull(metadata.physicalAttempt),returned:booleanOrNull(metadata.returned),
      worldRevision:finiteOrNull(metadata.worldRevision),sceneRevision:finiteOrNull(metadata.sceneRevision),sourceRevisionRefs:refs(metadata.sourceRevisionRefs),exercised,
    };
  });
  return{
    expectedCount:rows.length,evidencedCount:rows.filter(row=>row.status!=='NO_EVIDENCE').length,exercisedCount:rows.filter(row=>row.exercised).length,
    missingCount:rows.filter(row=>row.status==='NO_EVIDENCE').length,ownerAcceptedCount:rows.filter(row=>row.ownerAccepted===true).length,ownerRejectedCount:rows.filter(row=>row.ownerAccepted===false).length,rows,
  };
}

function projectObligations(entry){
  const items=(entry?.metadata?.items??[]).slice(0,64).map(row=>({
    expectedId:text(row.expectedId,256),owner:text(row.owner,128),ownerSignalId:text(row.ownerSignalId,256),status:state(row.status),reasonCode:reason(row.reasonCode),
    taskId:text(row.taskId,256),lifecycleStatus:reason(row.lifecycleStatus),executionStatus:reason(row.executionStatus),missingEvidence:(row.missingEvidence??[]).map(reason).filter(Boolean).slice(0,16),
    blockedBy:(row.blockedBy??[]).map(value=>text(value,256)).filter(Boolean).slice(0,16),eventType:reason(row.eventType),producer:text(row.producer,128),consumer:text(row.consumer,128),
    correlationId:text(row.correlationId,256),worldRevision:finiteOrNull(row.worldRevision),sceneRevision:finiteOrNull(row.sceneRevision),sourceRevisionRefs:refs(row.sourceRevisionRefs),
    evidenceStages:(row.evidenceStages??[]).slice(-32).map(stage=>({id:text(stage.id,256),eventKind:reason(stage.eventKind),lifecycleState:reason(stage.lifecycleState),reasonCode:reason(stage.reasonCode),producerId:text(stage.producerId,128),consumerId:text(stage.consumerId,128),parentReceiptId:text(stage.parentReceiptId,256),ownerAccepted:booleanOrNull(stage.ownerAccepted),durationMs:finiteOrNull(stage.durationMs)})),
  }));
  const counts={DONE:0,DUE:0,BLOCKED:0,FAILED:0,SKIPPED_WITH_REASON:0,DEFERRED:0,STALE:0,LATE:0};
  for(const row of items)counts[row.status]=(counts[row.status]??0)+1;
  return{total:items.length,counts,items};
}

function projectJobs(entry){
  const rows=(entry?.metadata?.jobs??[]).slice(0,64).map(row=>({
    jobId:text(row.jobId,256),sequence:finiteOrNull(row.sequence),owner:text(row.owner,128),reasonCode:reason(row.reasonCode),outcome:state(row.outcome),
    assignedNativeResourceId:text(row.assignedNativeResourceId,256),assignedOptionalResourceId:text(row.assignedOptionalResourceId,256),
    physicalExecutionEvidence:state(row.physicalExecutionEvidence),providerAttempted:Boolean(row.providerAttempted),resultReturned:booleanOrNull(row.resultReturned),
    ownerAccepted:booleanOrNull(row.ownerAccepted),startAt:finiteOrNull(row.startAt),endAt:finiteOrNull(row.endAt),taskIds:(row.taskIds??[]).map(value=>text(value,256)).filter(Boolean).slice(0,16),
    resultIds:(row.resultIds??[]).map(value=>text(value,256)).filter(Boolean).slice(0,16),contextSealResultIds:(row.contextSealResultIds??[]).map(value=>text(value,256)).filter(Boolean).slice(0,16),
  }));
  return{
    logicalCount:Number(entry?.metadata?.logicalJobCount??rows.length),physicalAttemptCount:rows.filter(row=>row.physicalExecutionEvidence==='EVIDENCE').length,
    optionalProviderAttemptCount:rows.filter(row=>row.providerAttempted).length,returnedCount:rows.filter(row=>row.resultReturned===true).length,
    ownerAcceptedCount:rows.filter(row=>row.ownerAccepted===true).length,ownerRejectedCount:rows.filter(row=>row.ownerAccepted===false).length,rows,
  };
}

function projectOptionalResources(entry){
  const rows=(entry?.metadata?.resources??[]).slice(0,24).map(row=>({
    id:text(row.id,256),kind:state(row.kind),state:state(row.state),configured:Boolean(row.configured),qualified:Boolean(row.qualifiedCallable),
    physicalAttempted:Boolean(row.attempted),returned:booleanOrNull(row.returned),succeeded:Boolean(row.succeeded),failed:Boolean(row.failed),
    ownerAcceptanceState:reason(row.ownerAcceptanceState)??(typeof row.ownerAccepted==='boolean'?(row.ownerAccepted?'ACCEPTED':'REJECTED'):'NO_EVIDENCE'),
    ownerAccepted:(reason(row.ownerAcceptanceState)==='NO_EVIDENCE'?null:booleanOrNull(row.ownerAccepted)),ownerAcceptanceSource:text(row.ownerAcceptanceSource,128),skipReason:reason(row.skipReason),measurementClass:reason(row.measurementClass),
  }));
  return{
    configuredCount:rows.filter(row=>row.configured).length,qualifiedCount:rows.filter(row=>row.qualified).length,physicalAttemptCount:rows.filter(row=>row.physicalAttempted).length,
    returnedCount:rows.filter(row=>row.returned===true).length,ownerAcceptedCount:rows.filter(row=>row.ownerAccepted===true).length,ownerRejectedCount:rows.filter(row=>row.ownerAccepted===false).length,
    failedCount:rows.filter(row=>row.failed).length,rows,
  };
}

function projectEvidence({gather,seal,connections}){
  const counts=gather?.metadata?.counts??{};
  return{
    gather:{state:gather?state(gather.status):'NO_EVIDENCE',admitted:Number(counts.ADMITTED??0),rejected:Number(counts.REJECTED??0),invalid:Number(counts.INVALID??0),late:Number(counts.LATE??0),stale:Number(counts.STALE??0)},
    contextSeal:{state:seal?state(seal.status):'NO_EVIDENCE',admittedResultCount:Number(seal?.metadata?.admittedResultCount??0),rejectedResultCount:(seal?.metadata?.rejectedResultIds??[]).length,lateResultCount:(seal?.metadata?.lateResultIds??[]).length,staleResultCount:(seal?.metadata?.staleResultIds??[]).length},
    ownerAdmission:{accepted:connections.ownerAcceptedCount,rejected:connections.ownerRejectedCount,missing:connections.rows.filter(row=>row.ownerAccepted==null).length},
  };
}

function projectDelivery({seal,prompt,delivery,connections}){
  const sealEdge=connections?.rows?.find(row=>row.stage==='contextSeal'&&row.status!=='NO_EVIDENCE')??null;
  const promptEdge=connections?.rows?.find(row=>row.stage==='promptPlan'&&row.status!=='NO_EVIDENCE')??null;
  return{
    contextSeal:{state:seal?state(seal.status):sealEdge?'EVIDENCED':'NO_EVIDENCE',receiptId:text(seal?.receiptRef??sealEdge?.receiptId,256)},
    promptPlan:{state:prompt||promptEdge?'PLANNED':'NO_EVIDENCE',receiptId:text(prompt?.receiptRef??promptEdge?.receiptId,256)},
    observedHostDelivery:{state:delivery?state(delivery.status):'NO_EVIDENCE',receiptId:text(delivery?.receiptRef,256),requestId:text(delivery?.metadata?.requestId,256),matching:booleanOrNull(delivery?.metadata?.matching),live:booleanOrNull(delivery?.metadata?.live),responseCompleted:booleanOrNull(delivery?.metadata?.responseCompleted),reasonCode:reason(delivery?.metadata?.abortCode)},
  };
}

function generationOutcomeFor(delivery){
  const host=delivery.observedHostDelivery.state;
  if(host!=='NO_EVIDENCE')return{state:host,evidence:'OBSERVED_HOST_DELIVERY',reasonCode:delivery.observedHostDelivery.reasonCode};
  if(delivery.promptPlan.state==='PLANNED')return{state:'PLANNED_ONLY',evidence:'PROMPT_PLAN_ONLY',reasonCode:'HOST_DELIVERY_NOT_OBSERVED'};
  return{state:'NO_EVIDENCE',evidence:'NO_EVIDENCE',reasonCode:'HOST_DELIVERY_NOT_OBSERVED'};
}

function projectTiming(connections,uiLoad){
  const durations=connections.rows.map(row=>row.durationMs).filter(value=>value!=null);
  return{ownerReceiptDurationMs:{measuredCount:durations.length,total:round(durations.reduce((sum,value)=>sum+value,0)),max:durations.length?round(Math.max(...durations)):null},telemetryOverhead:uiLoad.telemetryOverhead};
}

function safeLoadTrace(provider){
  if(!provider)return null;
  try{return provider()??null;}catch{return null;}
}
function projectUiLoad(snapshot){
  const stat=(name)=>{
    const row=snapshot?.categories?.[name];
    if(!row)return{measurementClass:'NO_EVIDENCE',count:0,avgMs:null,peakMs:null,lastMs:null};
    return{measurementClass:'MEASURED_UI_TRACE',count:Number(row.count??0),avgMs:finiteOrNull(row.avgMs),peakMs:finiteOrNull(row.maxMs),lastMs:finiteOrNull(row.lastMs)};
  };
  return{
    measurementClass:snapshot?'MEASURED_UI_TRACE':'NO_EVIDENCE',retainedSamples:Number(snapshot?.retainedSamples??0),
    workspaceRefresh:stat('UI_WORKSPACE_REFRESH'),
    telemetryOverhead:{journalProcess:stat('UI_JOURNAL_PROCESS'),captureTotal:stat('UI_CAPTURE_TOTAL'),ownerSelectedTurnRead:stat('OWNER_SELECTED_TURN_READ')},
    browserTaskManagerMemory:{measurementClass:'UNAVAILABLE_BY_CONTRACT',automatic:false},
  };
}

function normalizeOperatorObservations(rows){
  if(!Array.isArray(rows))return[];
  return rows.slice(0,16).map(row=>({
    metric:text(row?.metric,128)??'operator-observation',value:finiteOrNull(row?.value),unit:text(row?.unit,24),
    source:'OPERATOR',measurementClass:'OPERATOR_OBSERVATION',causalAttribution:'UNPROVEN',
  }));
}

function projectRetention(value){
  return{available:value?.available??null,storageKind:text(value?.storageKind,64),turnCount:Number(value?.turnCount??0),entryCount:Number(value?.entryCount??0),
    serializedBytes:Number(value?.serializedBytes??0),maxStoredBytes:Number(value?.maxStoredBytes??0),criticalDeliveryProtected:Boolean(value?.criticalDeliveryProtected),revisionFenceAware:Boolean(value?.revisionFenceAware)};
}

function buildSummary(report){
  const s=report.selection,c=report.connections,o=report.obligations,j=report.jobs,e=report.evidence,d=report.delivery.observedHostDelivery,u=report.uiLoad.workspaceRefresh;
  const missing=c.rows.filter(row=>row.status==='NO_EVIDENCE').map(row=>row.stage).slice(0,8);
  const parts=[
    'Area-52 selected-turn causal report',
    'Selection: '+[s.chatId,s.turnId,s.generationId].map(value=>value??'unknown').join(' / ')+'.',
    'Generation outcome: '+report.generationOutcome.state+' (host delivery '+d.state+'; PromptPlan '+report.delivery.promptPlan.state+'; Context Seal '+report.delivery.contextSeal.state+').',
    'Connections: '+c.exercisedCount+' exercised, '+c.evidencedCount+' evidenced, '+c.missingCount+' NO_EVIDENCE.',
    'Jobs: '+j.logicalCount+' logical, '+j.physicalAttemptCount+' physical-start evidence, '+j.returnedCount+' returned, '+j.ownerAcceptedCount+' owner-accepted.',
    'Expected work: '+o.total+' total; '+o.counts.DONE+' done, '+o.counts.DUE+' due, '+o.counts.BLOCKED+' blocked, '+o.counts.FAILED+' failed, '+o.counts.SKIPPED_WITH_REASON+' skipped.',
    'Gather: '+e.gather.admitted+' admitted, '+e.gather.rejected+' rejected, '+e.gather.late+' late, '+e.gather.stale+' stale.',
  ];
  if(missing.length)parts.push('Missing owner evidence: '+missing.join(', ')+(c.missingCount>missing.length?' …':'')+'.');
  if(u.measurementClass==='MEASURED_UI_TRACE')parts.push('UI workspace refresh: avg '+formatMs(u.avgMs)+', peak '+formatMs(u.peakMs)+' across '+u.count+' retained sample(s).');
  for(const row of report.operatorObservations)parts.push('Operator observation: '+row.metric+' '+([row.value,row.unit].filter(v=>v!=null).join(' ')||'value not supplied')+'; causal attribution unproven.');
  return parts.join('\n');
}

function boundExport(value,maxBytes){
  const out=clone(value);
  let json=JSON.stringify(out);
  const arrays=[
    ()=>out.report?.connections?.rows,
    ()=>out.report?.obligations?.items,
    ()=>out.report?.jobs?.rows,
    ()=>out.report?.optionalResources?.rows,
    ()=>out.report?.missingOrBlocked,
  ];
  while(json.length>maxBytes){
    let changed=false;
    for(const get of arrays){
      const rows=get();if(Array.isArray(rows)&&rows.length>4){rows.splice(Math.ceil(rows.length/2));changed=true;}
    }
    if(!changed)break;
    out.truncated=true;json=JSON.stringify(out);
  }
  if(json.length>maxBytes)return{kind:out.kind,contractVersion:out.contractVersion,exportedAt:out.exportedAt,truncated:true,report:{kind:out.report.kind,contractVersion:out.report.contractVersion,selection:out.report.selection,generationOutcome:out.report.generationOutcome,pasteableSummary:out.report.pasteableSummary,safety:out.report.safety},safety:out.safety};
  return out;
}

function latest(entries,type){const rows=entries.filter(row=>row.type===type);return rows.length?rows.reduce((a,b)=>Number(a?.at??0)>=Number(b?.at??0)?a:b):null;}
function normalizeSelection(value={}){return{chatId:text(value.chatId,256),turnId:text(value.turnId,256),generationId:text(value.generationId,256),correlationId:text(value.correlationId,256),worldRevision:finiteOrNull(value.worldRevision),sceneRevision:finiteOrNull(value.sceneRevision),sourceRevisionRefs:refs(value.sourceRevisionRefs)};}
function refs(value){return[...new Set((Array.isArray(value)?value:[]).map(row=>text(row,256)).filter(Boolean))].slice(0,32).sort();}
function reason(value){const x=value==null?'':String(value).trim().toUpperCase();return /^[A-Z0-9_:-]{1,128}$/.test(x)?x:null;}
function state(value){return reason(value)??'UNKNOWN';}
function text(value,limit=256){if(value==null)return null;let out=String(value);out=out.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi,'$1[REDACTED]').replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g,'[REDACTED]');return out.slice(0,limit)||null;}
function finiteOrNull(value){if(value==null)return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function booleanOrNull(value){return typeof value==='boolean'?value:null;}
function round(value){return Math.round(Number(value)*1000)/1000;}
function formatMs(value){return value==null?'NO_EVIDENCE':round(value)+' ms';}
function clone(value){if(value==null)return value;if(typeof structuredClone==='function')return structuredClone(value);return JSON.parse(JSON.stringify(value));}
function freezeClone(value){const out=clone(value);return typeof Object.freeze==='function'?deepFreeze(out):out;}
function deepFreeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;for(const row of Object.values(value))deepFreeze(row);return Object.freeze(value);}
