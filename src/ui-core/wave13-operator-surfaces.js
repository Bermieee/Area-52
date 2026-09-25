import { ProductDetailLevel } from './wave5-product-model.js';
import { OperatorProducerState, parseLoreSubmission } from './wave13-operator-adapters.js';
import { createButton, createKeyValue, createProgressBar, element, makeBadge, makeHealthPill } from './primitives.js';

export function installWave13OperatorSurfaces(registry,{operations=null,resources=null,loreStudy=null,diagnostics=null,actionRouter=null,cognition=null,frontFacePresentation=null}={}){
  const releases=[];
  if(registry.has('home')){
    const current=registry.get('home');
    registry.update('home',{render(host,ctx){current.render?.(host,ctx);if(operations)renderOperationalSummary(host,{...ctx,operations});}});
  }
  if(registry.has('brain')){
    const current=registry.get('brain');
    registry.update('brain',{render(host,ctx){current.render?.(host,ctx);if(operations&&ctx.productAdapter.getDetailLevel()!==ProductDetailLevel.NORMAL)renderOperationalDetail(host,{...ctx,operations});}});
  }
  if(!registry.has('connections'))registry.register({
    id:'connections',title:'Connections',icon:'⇄',category:'Product',navigation:{level:'product',order:70},views:['normal','detail','advanced'],supportedActions:['inspect','connect','disconnect','test'],
    render(host,ctx){
      host.append(header(host.ownerDocument,'Connections','Connect Jev, Sidecar, and Vectoring resources separately, then watch owner-reported fan-out and Gather without exposing raw prompts.'));
      if(resources)renderResourceSurface(host,{...ctx,resources,actionRouter});
      else host.append(message(host.ownerDocument,'Connections unavailable','Worker 2 resource host is not exported by this assembly. Native Brain operation remains available.','offline'));
      renderFanoutGatherSurface(host,{...ctx,cognition});
    },
  });
  if(!registry.has('settings'))registry.register({
    id:'settings',title:'Settings',icon:'⚙',category:'Product',navigation:{level:'product',order:80},views:['normal','detail','advanced'],supportedActions:['display-preferences','inspect'],
    render(host,ctx){renderSettingsSurface(host,{...ctx,frontFacePresentation,diagnostics});},
  });
  if(registry.has('lore')){
    const current=registry.get('lore');
    registry.update('lore',{render(host,ctx){renderLoreStudySurface(host,{...ctx,loreStudy,actionRouter,fallbackRender:current.render});}});
  }
  return()=>{for(const release of releases)try{release();}catch{}};
}

export function registerWave13OperatorActions(actionRouter,{resources=null,loreStudy=null}={}){
  const releases=[];
  if(resources){
    releases.push(actionRouter.registerSubsystem('wave13-resources',async(action)=>{
      if(action.type==='wave13.resource.connect')return resources.connect(action.payload??action.target??{});
      if(action.type==='wave13.resource.disconnect')return resources.disconnect(action.target??action.payload??{});
      if(action.type==='wave13.resource.test')return resources.test(action.target??action.payload??{});
      throw new Error('Unsupported Wave 13 resource action');
    }));
    releases.push(actionRouter.registerAction('wave13.resource.connect',{subsystem:'wave13-resources'}));
    releases.push(actionRouter.registerAction('wave13.resource.disconnect',{subsystem:'wave13-resources'}));
    releases.push(actionRouter.registerAction('wave13.resource.test',{subsystem:'wave13-resources'}));
  }
  if(loreStudy){
    releases.push(actionRouter.registerSubsystem('wave13-lore',async(action)=>{
      if(action.type==='wave13.lore.accept')return loreStudy.accept(action.payload??{});
      if(action.type==='wave13.lore.run')return loreStudy.run(action.payload??{});
      throw new Error('Unsupported Wave 13 Lore action');
    }));
    releases.push(actionRouter.registerAction('wave13.lore.accept',{subsystem:'wave13-lore'}));
    releases.push(actionRouter.registerAction('wave13.lore.run',{subsystem:'wave13-lore'}));
  }
  return()=>{for(const release of releases.reverse())try{release?.();}catch{}};
}

export function renderOperationalSummary(host,{operations,scope,inspect}={}){
  const d=host.ownerDocument,status=operations.read(),section=element(d,'section',{className:'a52-wave13-operations',attrs:{'aria-label':'Live Brain bindings'}});
  const head=element(d,'div',{className:'a52-wave13-section-head'});
  head.append(element(d,'h2',{text:'Live Brain bindings'}),makeBadge(d,status.waitingForTurn?'WAITING FOR TURN':status.hostConnected?'HOST SELECTED':'NO HOST CHAT',status.waitingForTurn?'historical':status.hostConnected?'ready':'offline'));
  section.append(head);
  if(status.waitingForTurn)section.append(message(d,'Waiting for a turn','The selected chat is current. Turn-scoped receipts will appear after the Brain receives a generation event.','historical'));
  else if(!status.hostConnected)section.append(message(d,'No selected chat','Area-52 has no host chat identity to bind cognitive receipts to.','offline'));
  const grid=element(d,'div',{className:'a52-wave13-status-grid'});
  for(const row of status.stages.slice(0,8))grid.append(stageCard(d,row,scope,inspect));
  section.append(grid);host.append(section);
}

export function renderOperationalDetail(host,{operations,scope,inspect}={}){
  const d=host.ownerDocument,status=operations.read(),section=element(d,'section',{className:'a52-wave13-operations a52-wave13-operations--detail'});
  section.append(element(d,'h2',{text:'Producer / selection diagnostics'}));
  const selection=status.selection??{};
  section.append(createKeyValue(d,[
    {key:'Chat',value:selection.chatId??'none'},
    {key:'Turn',value:selection.turnId??'waiting'},
    {key:'Generation',value:selection.generationId??'waiting'},
    {key:'World revision',value:selection.worldRevision??'—'},
    {key:'Scene revision',value:selection.sceneRevision??'—'},
  ]));
  const grid=element(d,'div',{className:'a52-wave13-status-grid'});
  for(const row of status.stages)grid.append(stageCard(d,row,scope,inspect));
  section.append(grid);host.append(section);
}

export function renderResourceSurface(host,{resources,actionRouter,scope,refresh,notifications}={}){
  const d=host.ownerDocument,read=resources.read(),source=read.source,data=read.data??{resources:[],configurations:[],nativePathAvailable:true};
  const section=element(d,'section',{className:'a52-wave13-resources',attrs:{'aria-label':'Optional execution resource connections'}});
  const head=element(d,'div',{className:'a52-wave13-section-head'});
  head.append(element(d,'h2',{text:'Connections'}),makeHealthPill(d,{label:source.operationalState??source.health,status:source.statusToken,detail:source.impact}));
  section.append(head,element(d,'p',{className:'a52-muted',text:'Jev, Sidecar, and Vectoring are configured separately. Once a resource exists, its connection configuration is locked to the owner record; disconnect/test/reconnect remain available.'}));
  if(source.reason)section.append(message(d,source.operationalState==='UNAVAILABLE'?'Assembly action seam not connected':'Resource status',source.reason,source.statusToken));

  const caps=resources.capabilities();
  if(caps.read&&(!caps.connect||!caps.test||!caps.disconnect))section.append(message(d,'Resource controls incomplete','Resource status is readable, but connect/test/disconnect are not all exported by the assembly. Worker 2 remains the routing/execution owner.','warning'));

  const slots=element(d,'div',{className:'a52-wave13-connection-slots'});
  for(const spec of connectionSlotSpecs())slots.append(renderConnectionSlot(d,{spec,rows:data.resources.filter(row=>connectionSlotFor(row)===spec.id),resources,actionRouter,scope,refresh,notifications,caps}));
  section.append(slots);

  if(!data.resources.length)section.append(message(d,'No optional resource connected',caps.read?'Worker 2 reports no configured optional resources. Native cognition remains available.':'The host assembly has not exported Worker 2 resource status/actions yet.','historical'));
  host.append(section);
}

function renderConnectionSlot(d,{spec,rows,resources,actionRouter,scope,refresh,notifications,caps}){
  const connected=rows.some(row=>row.connected),configured=rows.length>0;
  const slot=element(d,'section',{className:'a52-wave13-connection-slot',dataset:{slot:spec.id,connected:String(connected),locked:String(configured)}});
  const head=element(d,'div',{className:'a52-wave13-connection-slot__head'});
  head.append(element(d,'h3',{text:spec.title}),makeBadge(d,connected?'CONNECTED':configured?'LOCKED':'OPEN',connected?'ready':configured?'observed':'historical'));
  slot.append(head,element(d,'p',{className:'a52-wave13-connection-slot__hint',text:spec.description}));

  if(configured){
    const locked=element(d,'div',{className:'a52-wave13-connection-slot__locked'});
    for(const row of rows)locked.append(renderLockedResource(d,{row,resources,actionRouter,scope,refresh,notifications,caps}));
    slot.append(locked);
    return slot;
  }

  if(!(caps.connect&&caps.configure)){
    slot.append(message(d,'Connection setup unavailable',caps.connect?'This assembly can reconnect owner-configured resources, but cannot add a new one.':'Worker 2 connection actions are not exported by this assembly.','warning'));
    return slot;
  }

  const form=element(d,'div',{className:'a52-wave13-connection-slot__form'});
  const resourceId=field(d,'input',spec.title+' resource ID',{type:'text',placeholder:spec.id.toLowerCase()+':local'});
  const endpoint=field(d,'input',spec.title+' endpoint',{type:'url',placeholder:'http://127.0.0.1:...'});
  const model=field(d,'input',spec.title+' model ID',{type:'text',placeholder:'model name'});
  const capabilities=field(d,'input',spec.title+' capabilities',{type:'text',placeholder:spec.defaultCapabilities.join(', ')});
  capabilities.value=spec.defaultCapabilities.join(', ');
  if(spec.fixedCapabilities){
    capabilities.disabled=true;capabilities.setAttribute('aria-disabled','true');capabilities.title='Jev capability is fixed by the owner contract.';
  }
  const connect=createButton(d,{label:'Connect '+spec.title,scope,onPress:async()=>{
    const parsedCaps=String(capabilities.value||'').split(',').map(x=>x.trim()).filter(Boolean);
    const result=await actionRouter.route({type:'wave13.resource.connect',payload:{role:spec.role,resourceId:resourceId.value||null,transportKind:'OPENAI_COMPATIBLE',endpoint:endpoint.value||null,modelId:model.value||null,capabilities:parsedCaps,local:true}});
    reportAction(notifications,result,spec.title+' connection');refresh?.();
  }});
  form.append(labelWrap(d,'Resource ID',resourceId),labelWrap(d,'Endpoint',endpoint),labelWrap(d,'Model',model),labelWrap(d,'Capabilities',capabilities),connect);
  slot.append(form);return slot;
}

function renderLockedResource(d,{row,resources,actionRouter,scope,refresh,notifications,caps}){
  const card=element(d,'article',{className:'a52-card a52-wave13-resource',dataset:{health:row.health}});
  const top=element(d,'div',{className:'a52-inline-status'});
  top.append(element(d,'strong',{text:row.id}),makeBadge(d,'CONFIG LOCKED','observed'),makeBadge(d,row.state??row.health,resourceStatus(row.health)));
  card.append(top,createKeyValue(d,[
    {key:'Connection',value:row.state??(row.connected?'READY':'DISCONNECTED')},{key:'Provider',value:row.providerId??'—'},{key:'Model',value:row.modelId??'—'},
    {key:'Transport',value:row.transportKind??'—'},{key:'Measurement',value:row.measurementClass??'—'},
    {key:'Concurrency',value:String(row.currentLoad)+' / '+String(row.concurrencyCapacity)},{key:'Capabilities',value:(row.capabilities??row.declaredCapabilities??[]).join(', ')||'none published'},
  ]));
  const actions=element(d,'div',{className:'a52-wave13-resource-actions'});
  if(caps.connect&&!row.connected)actions.append(createButton(d,{label:'Reconnect',scope,size:'sm',onPress:async()=>{const result=await actionRouter.route({type:'wave13.resource.connect',target:row});reportAction(notifications,result,'Resource connection');refresh?.();}}));
  if(caps.test)actions.append(createButton(d,{label:'Test',scope,size:'sm',onPress:async()=>{const result=await actionRouter.route({type:'wave13.resource.test',target:row});reportAction(notifications,result,'Resource test');refresh?.();}}));
  if(caps.disconnect&&row.connected)actions.append(createButton(d,{label:'Disconnect',scope,size:'sm',variant:'quiet',onPress:async()=>{const result=await actionRouter.route({type:'wave13.resource.disconnect',target:row});reportAction(notifications,result,'Resource disconnect');refresh?.();}}));
  const test=resources.testResult(row.id);if(test)card.append(element(d,'p',{className:'a52-muted',text:'Latest connection test: '+testSummary(test)}));
  if(row.reason&&!row.lastError)card.append(element(d,'p',{className:'a52-muted',text:row.reason}));
  if(row.lastError)card.append(message(d,'Resource issue',String(row.lastError),'warning'));
  if(actions.children?.length)card.append(actions);
  return card;
}

function connectionSlotSpecs(){return[
  {id:'JEV',title:'Jev',role:'JEV',description:'Semantic judgment resource. The UI does not decide when Jev runs.',defaultCapabilities:['SEMANTIC_JUDGMENT'],fixedCapabilities:true},
  {id:'SIDECAR',title:'Sidecar',role:'SIDECAR',description:'General optional execution resource used only when Worker 2 routing admits matching work.',defaultCapabilities:['STRUCTURED_EXTRACTION'],fixedCapabilities:false},
  {id:'VECTORING',title:'Vectoring',role:'VECTORING',description:'Retrieval/vector execution resource. Capabilities remain owner-advertised and routing stays with Worker 2.',defaultCapabilities:['RETRIEVAL','EMBED'],fixedCapabilities:false},
];}

function connectionSlotFor(row){
  const capabilities=new Set([...(row.capabilities??[]),...(row.declaredCapabilities??[]),...(row.activeCapabilities??[])].map(String));
  if(capabilities.has('SEMANTIC_JUDGMENT'))return'JEV';
  if(['EMBED','RETRIEVAL','RETRIEVAL_QUALITY','RERANK','LATE_INTERACTION','CROSS_ENCODER_RERANK'].some(capability=>capabilities.has(capability)))return'VECTORING';
  return'SIDECAR';
}

export function renderFanoutGatherSurface(host,{cognition,scope,inspect}={}){
  const d=host.ownerDocument,section=element(d,'section',{className:'a52-wave13-swarm',attrs:{'aria-label':'Sidecar fan-out and Gather'}});
  section.append(element(d,'h2',{text:'Fan-out → Gather'}));
  if(!cognition?.read){section.append(message(d,'Brain trace unavailable','The assembly does not expose the selected-turn cognition read model.','offline'));host.append(section);return;}
  const read=cognition.read(),data=read?.data,selection=data?.bindingSelection??{};
  if(!selection.turnId){
    section.append(message(d,'Waiting for an active turn','Connection health remains available above. Fan-out and Gather appear only when the selected chat publishes a turn.','historical'));host.append(section);return;
  }
  const choice=data?.choice??null,scatter=data?.scatter??null,gather=data?.gather??null,seal=data?.seal??null,jev=data?.jev??null;
  const jobs=scatter?.jobs??[],resourceIds=[...new Set(jobs.map(row=>row.resourceId).filter(Boolean))],gatherRows=gather?.results??[];
  const summary=element(d,'div',{className:'a52-wave13-flow-summary'});
  summary.append(flowStep(d,'Choice',choice?String(choice.admitted?.length??0)+' admitted · '+String(choice.skipped?.length??0)+' skipped':'No Choice receipt'),
    flowStep(d,'Fan-out',scatter?jobs.length+' logical jobs → '+resourceIds.length+' physical resources':'No Scatter receipt'),
    flowStep(d,'Gather',gather?String(gather.counts?.ADMITTED??0)+' admitted · '+String((gather.counts?.LATE??0)+(gather.counts?.STALE??0)+(gather.counts?.REJECTED??0)+(gather.counts?.INVALID??0))+' contained':'No Gather receipt'));
  section.append(summary);

  if(jev){
    const jevCard=element(d,'section',{className:'a52-card'});
    jevCard.append(element(d,'div',{className:'a52-inline-status'},element(d,'strong',{text:'Jev decision'}),makeBadge(d,jev.outcome??jev.state??'AVAILABLE',jev.state==='DEGRADED'||jev.state==='UNAVAILABLE'?'warning':'observed')));
    jevCard.append(createKeyValue(d,[{key:'Resource',value:jev.resourceId??'owner did not publish resource id'},{key:'Provider',value:jev.provider??'—'},{key:'Model',value:jev.model??'—'},{key:'Outcome',value:jev.outcome??jev.state??'—'}]));
    section.append(jevCard);
  }

  if(jobs.length){
    section.append(element(d,'h3',{text:'Logical jobs / physical mapping'}));
    const list=element(d,'div',{className:'a52-wave13-flow-list'});
    for(const job of jobs){
      const row=element(d,'div',{className:'a52-wave13-flow-row'});
      row.append(element(d,'strong',{text:job.capability??job.jobId??'Cognitive job'}),element(d,'code',{text:job.resourceId??'native / unreported'}),makeBadge(d,String(job.state??'UNKNOWN'),flowStatus(job.state)));
      list.append(row);
    }
    section.append(list);
  }else section.append(message(d,'No fan-out receipt','The selected turn did not publish Scatter jobs. The UI will not infer sidecar use from registered resources.','historical'));

  if(gatherRows.length){
    section.append(element(d,'h3',{text:'Gather results'}));
    const sealIds=new Set(seal?.effectiveAdmittedResultIds??seal?.admittedResultIds??[]),list=element(d,'div',{className:'a52-wave13-flow-list'});
    for(const result of gatherRows){
      const sealed=result.resultId&&sealIds.has(result.resultId),contained=['LATE','STALE','INVALID','REJECTED'].includes(String(result.status).toUpperCase());
      const row=element(d,'div',{className:'a52-wave13-flow-row'});
      row.append(element(d,'strong',{text:result.capability??result.resultId??'Result'}),element(d,'code',{text:(result.resourceId??result.sourceSubsystem??'owner')+(result.destination?' → '+result.destination:'')}),makeBadge(d,sealed?'SEALED':contained?String(result.status):String(result.status??'RETURNED'),sealed?'canonical':contained?'warning':'observed'));
      list.append(row);
    }
    section.append(list);
  }else if(gather)section.append(message(d,'Gather summary only','Gather published counts/evidence but no per-result rows. No result-level Seal admission is inferred.','historical'));
  else section.append(message(d,'Gather unavailable','No Gather receipt is published for the selected turn.','offline'));

  if(seal){
    const safe=seal.effectiveAdmittedResultIds??seal.admittedResultIds??[];
    section.append(element(d,'p',{className:'a52-muted',text:'Context Seal owner reports '+safe.length+' result id'+(safe.length===1?'':'s')+' safely admitted. Late/stale/invalid/rejected Gather results remain visible but are not relabeled as prompt contributions.'}));
  }
  if(inspect&&scatter)section.append(createButton(d,{label:'Inspect Scatter receipt',scope,size:'sm',variant:'quiet',onPress:()=>inspect({kind:'wave13-scatter-trace',id:scatter.receiptId??selection.turnId,title:'Scatter / fan-out',payload:scatter})}));
  if(inspect&&gather)section.append(createButton(d,{label:'Inspect Gather receipt',scope,size:'sm',variant:'quiet',onPress:()=>inspect({kind:'wave13-gather-trace',id:gather.receiptId??selection.turnId,title:'Gather',payload:gather})}));
  host.append(section);
}

export function renderSettingsSurface(host,{productAdapter,frontFacePresentation,diagnostics,scope,refresh,inspect}={}){
  const d=host.ownerDocument,root=element(d,'section',{className:'a52-wave13-settings'});
  root.append(header(d,'Settings','Area-52 display controls. Connection and Brain execution policy remain with their owning subsystems.'));
  const detail=element(d,'section',{className:'a52-wave13-settings__group'});
  detail.append(element(d,'strong',{text:'Detail level'}),element(d,'p',{className:'a52-muted',text:'Normal keeps the interface concise; Detail and Advanced expose progressively more owner receipts.'}));
  const detailActions=element(d,'div',{className:'a52-wave13-resource-actions'});
  for(const level of Object.values(ProductDetailLevel)){
    const button=createButton(d,{label:humanLabel(level),scope,size:'sm',onPress:()=>{productAdapter?.setDetailLevel?.(level);refresh?.();}});
    button.setAttribute('aria-pressed',String(productAdapter?.getDetailLevel?.()===level));detailActions.append(button);
  }
  detail.append(detailActions);root.append(detail);
  const display=element(d,'section',{className:'a52-wave13-settings__group'}),state=frontFacePresentation?.get?.()??{};
  display.append(element(d,'strong',{text:'Panel display'}),element(d,'p',{className:'a52-muted',text:'Use the rail or panel drag handle to move the attached UI. Use the ↔ Resize handle on the panel edge to change width.'}));
  const displayActions=element(d,'div',{className:'a52-wave13-resource-actions'});
  for(const density of ['COMPACT','COMFORTABLE']){
    const button=createButton(d,{label:humanLabel(density),scope,size:'sm',onPress:()=>{frontFacePresentation?.setDensity?.(density);refresh?.();}});
    button.setAttribute('aria-pressed',String(state.frontFaceDensity===density));displayActions.append(button);
  }
  const inspector=createButton(d,{label:state.inspectorVisible?'Hide inspector':'Show inspector',scope,size:'sm',onPress:()=>{frontFacePresentation?.setInspector?.(!frontFacePresentation.get().inspectorVisible);refresh?.();}});
  displayActions.append(inspector);display.append(displayActions);root.append(display);
  if(diagnostics)root.append(renderDiagnosticsCenter(d,{diagnostics,scope,inspect}));
  host.append(root);
}

export function renderDiagnosticsCenter(d,{diagnostics,scope,inspect}={}){
  const snapshot=diagnostics.read(),center=element(d,'section',{className:'a52-wave13-settings__group a52-wave13-diagnostics',attrs:{'aria-label':'Diagnostics Center'}});
  const head=element(d,'div',{className:'a52-wave13-section-head'});
  const unhealthy=(snapshot.producers?.failures??0)>0||snapshot.resources?.rows?.some(row=>['DEGRADED','UNAVAILABLE'].includes(String(row.state))||['DEGRADED','UNAVAILABLE','COOLDOWN'].includes(String(row.health)));
  head.append(element(d,'strong',{text:'Diagnostics Center'}),makeBadge(d,unhealthy?'ATTENTION':snapshot.host?.waitingForTurn?'WAITING':'LIVE',unhealthy?'warning':snapshot.host?.waitingForTurn?'historical':'ready'));
  center.append(head,element(d,'p',{className:'a52-muted',text:'Central read-only telemetry for the selected chat/turn. Owner receipts, resource health, routing evidence, and failures appear here; raw prompts are never collected.'}));
  const selection=snapshot.selection??{};
  center.append(createKeyValue(d,[
    {key:'Chat',value:selection.chatId??'none'},{key:'Turn',value:selection.turnId??'waiting'},{key:'Generation',value:selection.generationId??'waiting'},
    {key:'World / Scene revision',value:(selection.worldRevision??'—')+' / '+(selection.sceneRevision??'—')},
    {key:'Live-binding reads',value:snapshot.host?.liveBinding?.reads??'—'},{key:'Rejected stale/foreign reads',value:snapshot.host?.liveBinding?.rejected??0},
  ]));

  const wiring=element(d,'div',{className:'a52-wave13-diagnostic-lanes'});
  for(const spec of [
    ['Jev',snapshot.wiring?.jev],['Sidecar',snapshot.wiring?.sidecar],['Vectoring',snapshot.wiring?.vectoring],
  ]){
    const lane=spec[1]?.lane??{},card=element(d,'article',{className:'a52-card a52-wave13-diagnostic-lane'});
    const status=lane.connected>0?'CONNECTED':lane.configured>0?'CONFIGURED':'NOT CONNECTED';
    card.append(element(d,'div',{className:'a52-inline-status'},element(d,'strong',{text:spec[0]}),makeBadge(d,status,lane.connected>0?'ready':lane.configured>0?'warning':'historical')));
    card.append(createKeyValue(d,[
      {key:'Configured',value:lane.configured??0},{key:'Connected',value:lane.connected??0},{key:'Callable',value:lane.callable??0},
      {key:'Active executions',value:lane.activeExecutions??0},{key:'Expected capabilities',value:(spec[1]?.expectedCapabilities??[]).join(', ')},
    ]));
    if((lane.states??[]).length){
      const states=element(d,'div',{className:'a52-wave13-diagnostic-events'});
      for(const row of lane.states.slice(0,8)){
        const line=element(d,'div',{className:'a52-wave13-diagnostic-event'});
        line.append(element(d,'code',{text:row.id}),makeBadge(d,row.state??row.health??'UNKNOWN',resourceStatus(row.health)));
        if(row.lastExecution?.status)line.append(element(d,'span',{className:'a52-muted',text:'last execution '+row.lastExecution.status+(row.lastExecution.taskType?' · '+row.lastExecution.taskType:'')}));
        states.append(line);
      }
      card.append(states);
    }
    wiring.append(card);
  }
  center.append(element(d,'h3',{text:'Jev / Sidecar / Vectoring wiring'}),wiring);

  const stages=element(d,'div',{className:'a52-wave13-status-grid'});
  for(const row of snapshot.producers?.stages??[])stages.append(stageCard(d,row,scope,inspect));
  center.append(element(d,'h3',{text:'Producer telemetry'}),stages);

  const activity=element(d,'div',{className:'a52-wave13-diagnostics__activity'});
  const jobs=snapshot.cognition?.jobs??[],results=snapshot.cognition?.gather??[];
  activity.append(flowStep(d,'Logical jobs',jobs.length+' published'),flowStep(d,'Gather results',results.length+' returned'),flowStep(d,'Context admitted',String(snapshot.cognition?.seal?.admittedResultIds?.length??0)));
  center.append(element(d,'h3',{text:'Current turn activity'}),activity);
  if(jobs.length){
    const list=element(d,'div',{className:'a52-wave13-flow-list'});
    for(const job of jobs.slice(0,40)){
      const row=element(d,'div',{className:'a52-wave13-flow-row'});
      row.append(element(d,'strong',{text:job.taskType??job.capability??job.taskId??'Job'}),element(d,'code',{text:job.resourceId??'native / unreported'}),makeBadge(d,job.state??'PUBLISHED',flowStatus(job.state)));
      list.append(row);
    }
    center.append(list);
  }
  if(results.length){
    const list=element(d,'div',{className:'a52-wave13-flow-list'});
    for(const result of results.slice(0,40)){
      const row=element(d,'div',{className:'a52-wave13-flow-row'});
      row.append(element(d,'strong',{text:result.capability??result.resultId??'Result'}),element(d,'code',{text:result.resourceId??'owner'}),makeBadge(d,result.contextAdmitted?'CONTEXT ADMITTED':result.status??'RETURNED',result.contextAdmitted?'ready':flowStatus(result.status)));
      list.append(row);
    }
    center.append(list);
  }

  const lore=snapshot.lore??{};
  center.append(element(d,'h3',{text:'Lore / retrieval telemetry'}),createKeyValue(d,[
    {key:'Accepted',value:lore.accepted??0},{key:'Learned/current',value:lore.learned??0},{key:'Retrieval-ready',value:lore.retrievalReady??0},
    {key:'Due',value:lore.lifecycle?.due??0},{key:'Active',value:lore.lifecycle?.active??lore.lifecycle?.counts?.ACTIVE??0},{key:'Invalid',value:lore.lifecycle?.counts?.INVALID??0},
  ]));

  const errors=Object.entries(snapshot.cognition?.errors??{});
  if(errors.length){
    const list=element(d,'div',{className:'a52-wave13-diagnostic-events'});
    for(const [name,error] of errors)list.append(message(d,name+' read issue',error?.message??error?.code??'Unknown cognition read failure','warning'));
    center.append(element(d,'h3',{text:'Read / coherence issues'}),list);
  }
  const events=snapshot.telemetry?.resourceEvents??[];
  center.append(element(d,'h3',{text:'Recent owner resource telemetry'}));
  if(events.length){
    const list=element(d,'div',{className:'a52-wave13-diagnostic-events'});
    for(const event of events.slice(0,40)){
      const line=element(d,'div',{className:'a52-wave13-diagnostic-event'});
      line.append(element(d,'code',{text:event.resourceId??'resource'}),element(d,'strong',{text:event.code??'EVENT'}),element(d,'span',{text:event.message??''}));
      if(inspect)line.append(createButton(d,{label:'Inspect',scope,size:'sm',variant:'quiet',onPress:()=>inspect({kind:'wave13-diagnostic-event',id:String(event.sequence??event.code??'event'),title:(event.resourceId??'Resource')+' · '+(event.code??'event'),payload:event})}));
      list.append(line);
    }
    center.append(list);
  }else center.append(message(d,'No resource events yet','Connect, test, disconnect, reconnect, or execute an optional resource and owner telemetry will appear here.','historical'));
  return center;
}

function flowStep(d,label,value){const node=element(d,'div',{className:'a52-wave13-flow-step'});node.append(element(d,'strong',{text:label}),element(d,'span',{text:value}));return node;}
function flowStatus(value){const v=String(value??'').toUpperCase();if(['COMPLETE','COMPLETED','READY','SUCCEEDED','ADMITTED'].includes(v))return'ready';if(['ACTIVE','RUNNING','QUEUED','WORKING'].includes(v))return'loading';if(['FAILED','ERROR','INVALID','LATE','STALE','REJECTED'].includes(v))return'warning';return'historical';}
function humanLabel(value){return String(value??'').toLowerCase().replace(/(^|_)([a-z])/g,(_,space,letter)=>(space?' ':'')+letter.toUpperCase());}

export function renderLoreStudySurface(host,{loreStudy,actionRouter,scope,refresh,notifications,fallbackRender}={}){
  const d=host.ownerDocument;
  host.append(header(d,'Lore','Accept authored source, study it, and verify when learned representations become retrieval-ready.'));
  if(!loreStudy){fallbackRender?.(host,{scope,refresh,notifications,actionRouter});return;}
  const read=loreStudy.read(),source=read.source,data=read.data,caps=loreStudy.capabilities();
  host.append(makeHealthPill(d,{label:'Lore Study · '+(source.operationalState??source.health),status:source.statusToken,detail:source.impact}));
  if(source.reason)host.append(message(d,'Lore status',source.reason,source.statusToken));

  if(data){
    const entries=data.entries??[],accepted=entries.filter(x=>x.sourceRevisionId).length,learned=entries.filter(x=>x.learnedRevisionId&&x.freshness==='CURRENT').length,retrievalReady=Number(data.retrievalReady??0);
    host.append(createKeyValue(d,[
      {key:'Accepted source entries',value:accepted},{key:'Learned/current entries',value:learned},{key:'Retrieval-ready entries',value:retrievalReady},
      {key:'Due study obligations',value:data.lifecycle?.due??0},{key:'Active',value:data.lifecycle?.active??data.lifecycle?.counts?.ACTIVE??0},{key:'Invalid',value:data.lifecycle?.counts?.INVALID??0},
    ]));
    const denominator=Math.max(1,accepted),progress=Math.round(learned/denominator*100);host.append(createProgressBar(d,{value:accepted?progress:0,label:'Lore learning progress'}));
    if(accepted>learned)host.append(message(d,'Accepted is not learned',accepted-learned+' source entr'+(accepted-learned===1?'y is':'ies are')+' accepted but not yet current retrieval material.','warning'));
    if(entries.length)host.append(renderLoreEntries(d,entries,scope));
  }else host.append(message(d,'No Lore accepted yet','Submit authored Lore below. Area-52 will keep exact source revisions separate from learned representations.','historical'));

  const form=element(d,'section',{className:'a52-card a52-wave13-lore-form'});
  form.append(element(d,'h2',{text:'Submit Lore for study'}));
  const id=field(d,'input','Lorebook ID',{type:'text',placeholder:'my-story-lore'}),title=field(d,'input','Lorebook title',{type:'text',placeholder:'Story lore'});
  const body=field(d,'textarea','Lore content',{rows:'9',placeholder:'Paste plain text for one entry, or JSON: {"entries":[{"uid":"person-a","content":"..."}]}'});
  const error=element(d,'p',{className:'a52-wave13-form-status',attrs:{role:'status','aria-live':'polite'}});
  const actions=element(d,'div',{className:'a52-wave13-lore-actions'});
  const accept=createButton(d,{label:'Accept for study',disabled:!caps.accept,scope,onPress:async()=>{
    try{
      const payload=parseLoreSubmission({id:id.value,title:title.value,text:body.value});
      error.textContent='Submitting authored source…';error.dataset.status='loading';
      const result=await actionRouter.route({type:'wave13.lore.accept',payload});
      if(!result.ok)throw new Error(result.error||'Lore acceptance failed');
      error.textContent='Accepted by Lore owner. Learning state is shown above after the owner refreshes.';error.dataset.status='ready';reportAction(notifications,result,'Lore acceptance');refresh?.();
    }catch(e){error.textContent=String(e?.message??e);error.dataset.status='error';}
  }});
  const run=createButton(d,{label:'Run pending study',disabled:!caps.run,scope,onPress:async()=>{
    error.textContent='Requesting pending Lore study…';error.dataset.status='loading';
    const result=await actionRouter.route({type:'wave13.lore.run',payload:{scope:'DUE'}});
    if(!result.ok){error.textContent=result.error||'Lore study failed';error.dataset.status='error';}
    else {error.textContent='Study owner completed the requested work. Verify learned/current status above.';error.dataset.status='ready';reportAction(notifications,result,'Lore study');}
    refresh?.();
  }});
  actions.append(accept,run);form.append(labelWrap(d,'Lorebook ID',id),labelWrap(d,'Title',title),labelWrap(d,'Authored Lore',body),actions,error);
  if(!caps.accept)form.append(message(d,'Acceptance action unavailable','Worker 4 must export acceptLorebook/submitLorebook/ingestLorebook through the UI host binding.','offline'));
  if(caps.accept&&!caps.run)form.append(message(d,'Study action unavailable','Source can be submitted, but the assembly does not expose runLoreStudy/startLoreStudy. Do not treat acceptance as retrieval readiness unless the owner read model reports learned/current.','warning'));
  host.append(form);
}

function renderLoreEntries(d,entries,scope){
  const root=element(d,'div',{className:'a52-wave13-lore-entries'});
  for(const row of entries.slice(0,80)){
    const learned=Boolean(row.learnedRevisionId&&row.freshness==='CURRENT'),card=element(d,'article',{className:'a52-card a52-wave13-lore-entry'});
    card.append(element(d,'div',{className:'a52-inline-status'},element(d,'strong',{text:row.uid??row.sourceId??'Lore entry'}),makeBadge(d,row.sourceState??'SOURCE','observed'),makeBadge(d,learned?'LEARNED':'NOT LEARNED',learned?'ready':'warning')));
    card.append(createKeyValue(d,[{key:'Source revision',value:row.sourceRevisionId??'—'},{key:'Learned revision',value:row.learnedRevisionId??'—'},{key:'Freshness',value:row.freshness??'—'},{key:'Retrieval representations',value:row.retrievalRepresentations?.length??0}]));
    if(row.retrievalRepresentations?.some(x=>x.unresolved))card.append(makeBadge(d,'UNRESOLVED','warning'));root.append(card);
  }
  return root;
}

function stageCard(d,row,scope,inspect){
  const card=element(d,'article',{className:'a52-wave13-stage',dataset:{state:row.state}});
  card.append(element(d,'div',{className:'a52-inline-status'},element(d,'strong',{text:row.label}),makeBadge(d,row.state,stageStatus(row.state))));
  card.append(element(d,'p',{text:row.reason||'No additional detail.'}));
  if(row.turnId)card.append(element(d,'span',{className:'a52-muted',text:'turn '+row.turnId+(row.freshness?' · '+row.freshness:'')}));
  if(inspect)card.append(createButton(d,{label:'Inspect',scope,size:'sm',variant:'quiet',onPress:()=>inspect({kind:'wave13-producer-status',id:row.id,title:row.label,payload:row})}));
  return card;
}
function header(d,title,subtitle){const h=element(d,'div',{className:'a52-workspace-header'});h.append(element(d,'h1',{text:title}),element(d,'p',{className:'a52-muted',text:subtitle}));return h;}
function message(d,title,text,status='ready'){const r=element(d,'section',{className:'a52-state-message',attrs:{role:status==='error'?'alert':'status'},dataset:{status}});r.append(element(d,'strong',{text:title}),element(d,'span',{text:String(text??'')}));return r;}
function labelWrap(d,label,node){const root=element(d,'label',{className:'a52-wave13-field'});root.append(element(d,'span',{text:label}),node);return root;}
function field(d,tag,label,attrs={}){return element(d,tag,{className:'a52-input',attrs:{'aria-label':label,...attrs}});}
function option(d,value,label){return element(d,'option',{text:label,attrs:{value}});}
function stageStatus(v){if(v===OperatorProducerState.LIVE)return'ready';if(v===OperatorProducerState.WORKING)return'loading';if(v===OperatorProducerState.DEGRADED)return'warning';if(v===OperatorProducerState.IDLE||v===OperatorProducerState.WAITING_FOR_TURN)return'historical';return'offline';}
function resourceStatus(v){if(v==='HEALTHY')return'ready';if(v==='DEGRADED'||v==='SATURATED'||v==='COOLDOWN'||v==='PROBE')return'warning';return'offline';}
function testSummary(x){return String(x?.status??x?.health??x?.result??(x?.ok===true?'PASS':x?.ok===false?'FAIL':'completed'));}
function reportAction(notifications,result,label){if(!notifications?.push)return;notifications.push({status:result?.ok?'success':'error',message:label+': '+(result?.ok?'completed':result?.error??'failed')});}
