import { ProductDetailLevel } from './wave5-product-model.js';
import { OperatorProducerState } from './wave13-operator-adapters.js';
import { createButton, createKeyValue, createProgressBar, element, makeBadge, makeHealthPill } from './primitives.js';

export function installWave13OperatorSurfaces(registry,{operations=null,resources=null,loreStudy=null,loreAuthoring=null,memory=null,diagnostics=null,actionRouter=null,cognition=null,coprocessor=null,frontFacePresentation=null,evidenceJournal=null}={}){
  const releases=[],connectionDrafts=createConnectionDraftStore(),loreAuthoringDraft=createLoreAuthoringDraftStore();
  if(registry.has('home')){
    const current=registry.get('home');
    registry.update('home',{render(host,ctx){current.render?.(host,ctx);if(operations)renderOperationalSummary(host,{...ctx,operations});}});
  }
  if(registry.has('brain')){
    const current=registry.get('brain');
    registry.update('brain',{render(host,ctx){current.render?.(host,ctx);if(operations&&ctx.productAdapter.getDetailLevel()!==ProductDetailLevel.NORMAL)renderOperationalDetail(host,{...ctx,operations});}});
  }
  if(!registry.has('connections'))registry.register({
    id:'connections',title:'Connections',icon:'⇄',category:'Product',navigation:{level:'product',order:70},views:['normal','detail','advanced'],supportedActions:['inspect','discover-models','refresh-models','set-credential','clear-credential','select-model','connect','disconnect','test','forget-saved'],
    render(host,ctx){
      host.append(header(host.ownerDocument,'Connections','Connect Jev, Sidecar, and Vectoring resources separately, then watch owner-reported fan-out and Gather without exposing raw prompts.'));
      if(resources)renderResourceSurface(host,{...ctx,resources,coprocessor,actionRouter,connectionDrafts});
      else host.append(message(host.ownerDocument,'Connections unavailable','Worker 2 resource host is not exported by this assembly. Native Brain operation remains available.','offline'));
      renderFanoutGatherSurface(host,{...ctx,cognition});
    },
  });
  if(!registry.has('settings'))registry.register({
    id:'settings',title:'Settings',icon:'⚙',category:'Product',navigation:{level:'product',order:80},views:['normal','detail','advanced'],supportedActions:['display-preferences','inspect'],
    render(host,ctx){renderSettingsSurface(host,{...ctx,frontFacePresentation,diagnostics,evidenceJournal});},
  });
  if(registry.has('lore')){
    const current=registry.get('lore');
    registry.update('lore',{render(host,ctx){
      renderLoreStudySurface(host,{...ctx,loreStudy,actionRouter,fallbackRender:current.render});
      renderLoreAuthoringSurface(host,{...ctx,loreStudy,loreAuthoring,actionRouter,draft:loreAuthoringDraft});
    }});
  }
  if(registry.has('memory')&&memory){
    registry.update('memory',{render(host,ctx){renderMemoryOwnerSurface(host,{...ctx,memory});}});
  }
  return()=>{for(const release of releases)try{release();}catch{}};
}

export function registerWave13OperatorActions(actionRouter,{resources=null,loreStudy=null,loreAuthoring=null}={}){
  const releases=[];
  if(resources){
    releases.push(actionRouter.registerSubsystem('wave13-resources',async(action)=>{
      if(action.type==='wave13.resource.discoverModels')return resources.discoverModels(action.payload??{});
      if(action.type==='wave13.resource.refreshModels')return resources.refreshModels(action.target??action.payload??{});
      if(action.type==='wave13.resource.selectModel')return resources.selectModel(action.target??{},action.payload?.modelId??'');
      if(action.type==='wave13.resource.connect')return resources.connect(action.payload??action.target??{});
      if(action.type==='wave13.resource.disconnect')return resources.disconnect(action.target??action.payload??{});
      if(action.type==='wave13.resource.test')return resources.test(action.target??action.payload??{});
      if(action.type==='wave13.resource.forgetSaved')return resources.forgetSavedProfile(action.target??action.payload??{});
      throw new Error('Unsupported Wave 13 resource action');
    }));
    releases.push(actionRouter.registerAction('wave13.resource.discoverModels',{subsystem:'wave13-resources'}));
    releases.push(actionRouter.registerAction('wave13.resource.refreshModels',{subsystem:'wave13-resources'}));
    releases.push(actionRouter.registerAction('wave13.resource.selectModel',{subsystem:'wave13-resources'}));
    releases.push(actionRouter.registerAction('wave13.resource.connect',{subsystem:'wave13-resources'}));
    releases.push(actionRouter.registerAction('wave13.resource.disconnect',{subsystem:'wave13-resources'}));
    releases.push(actionRouter.registerAction('wave13.resource.test',{subsystem:'wave13-resources'}));
    releases.push(actionRouter.registerAction('wave13.resource.forgetSaved',{subsystem:'wave13-resources'}));
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
  if(loreAuthoring){
    releases.push(actionRouter.registerSubsystem('wave13-lore-authoring',async(action)=>{
      if(action.type==='wave13.loreAuthoring.discover')return loreAuthoring.sourceDiscoveryIdentity(action.payload??{});
      if(action.type==='wave13.loreAuthoring.previewEdit')return loreAuthoring.previewEditImpact(action.payload??{});
      if(action.type==='wave13.loreAuthoring.proposeTree')return loreAuthoring.proposeTree(action.payload??{});
      if(action.type==='wave13.loreAuthoring.previewMerge')return loreAuthoring.previewMerge(action.payload??{});
      if(action.type==='wave13.loreAuthoring.startTreeBuild')return loreAuthoring.startTreeBuild(action.payload??{});
      if(action.type==='wave13.loreAuthoring.startMergeBuild')return loreAuthoring.startMergeBuild(action.payload??{});
      if(action.type==='wave13.loreAuthoring.resumeBuild')return loreAuthoring.resumeBuild(action.payload??{});
      if(action.type==='wave13.loreAuthoring.recordDecision')return loreAuthoring.recordDecision(action.payload??{});
      if(action.type==='wave13.loreAuthoring.reclassify')return loreAuthoring.reclassify(action.payload??{});
      if(action.type==='wave13.loreAuthoring.computeFinalPreview')return loreAuthoring.computeFinalPreview(action.payload??{});
      if(action.type==='wave13.loreAuthoring.approveFinalPreview')return loreAuthoring.approveFinalPreview(action.payload??{});
      if(action.type==='wave13.loreAuthoring.applySettlement')return loreAuthoring.applySettlement(action.payload??{});
      if(action.type==='wave13.loreAuthoring.restoreSettlement')return loreAuthoring.restoreSettlement(action.payload??{});
      throw new Error('Unsupported Wave 13 Lore authoring action');
    }));
    for(const type of ['wave13.loreAuthoring.discover','wave13.loreAuthoring.previewEdit','wave13.loreAuthoring.proposeTree','wave13.loreAuthoring.previewMerge','wave13.loreAuthoring.startTreeBuild','wave13.loreAuthoring.startMergeBuild','wave13.loreAuthoring.resumeBuild','wave13.loreAuthoring.recordDecision','wave13.loreAuthoring.reclassify','wave13.loreAuthoring.computeFinalPreview','wave13.loreAuthoring.approveFinalPreview','wave13.loreAuthoring.applySettlement','wave13.loreAuthoring.restoreSettlement']){
      releases.push(actionRouter.registerAction(type,{subsystem:'wave13-lore-authoring'}));
    }
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
  const pipeline=status.pipeline??{};
  if(pipeline.hostLifecycle?.ownerAvailable===false)section.append(message(d,'Native Brain owner not integrated',pipeline.hostLifecycle.reason??'Worker 1 native Brain owner is not attached to this main assembly. Visible legacy/demo receipts must not be treated as end-to-end native Brain execution.','warning'));
  else if(pipeline.hostLifecycle?.ownerAvailable===true)section.append(message(d,'Native Brain host loop attached','The host reports Worker 1’s owner interface is attached. Delivery and learning still require their own receipts below.','ready'));
  section.append(element(d,'h3',{text:'Brain activity'}),element(d,'div',{className:'a52-wave13-diagnostics__activity'},
    flowStep(d,'Producers available',String(pipeline.registeredProducers??0)),
    flowStep(d,'Jobs mapped',pipeline.mappingReceipt?String(pipeline.logicalJobsMapped??0)+' logical → '+String(pipeline.mappedResourceCount??0)+' resource '+((pipeline.mappedResourceCount??0)===1?'identity':'identities'):'No Scatter receipt'),
    flowStep(d,'Physical execution',pipeline.executionReceipt?String(pipeline.physicalExecutionAttempts??0)+' attempts · '+String(pipeline.physicalExecutionSucceeded??0)+' succeeded':'No selected-turn execution receipt'),
    flowStep(d,'Results returned',pipeline.resultReceipt?String(pipeline.returnedResults??0):'No Gather receipt'),
    flowStep(d,'Context admitted',pipeline.admissionReceipt?String(pipeline.contextAdmitted??0):'No Context Seal receipt'),
    flowStep(d,'Generation delivery',pipeline.deliveryReceipt?(pipeline.generationState?humanLabel(pipeline.generationState):'Sealed context delivered'):pipeline.generationReader?'No delivery receipt':'Owner generation reader unavailable'),
    flowStep(d,'Learning write-back',pipeline.learningReceipt?'Learning receipt recorded':pipeline.generationReceipt?'No learning receipt yet':'No generation receipt')
  ));
  const grid=element(d,'div',{className:'a52-wave13-status-grid'});
  for(const row of status.stages.slice(0,8))grid.append(stageCard(d,row,scope,inspect,{inspection:status.inspections?.[row.id]}));
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
  const pipeline=status.pipeline??{};
  section.append(element(d,'h3',{text:'Execution / admission'}),createKeyValue(d,[
    {key:'Registered producers',value:pipeline.registeredProducers??0},{key:'Scatter mapping receipt',value:pipeline.mappingReceipt?'Published':'None'},
    {key:'Logical jobs mapped',value:pipeline.logicalJobsMapped??0},{key:'Mapped resource identities',value:pipeline.mappedResourceCount??0},
    {key:'Physical execution receipt',value:pipeline.executionReceipt?'Published':'None'},{key:'Physical attempts / success / fail',value:[pipeline.physicalExecutionAttempts??0,pipeline.physicalExecutionSucceeded??0,pipeline.physicalExecutionFailed??0].join(' / ')},
    {key:'Gather receipt',value:pipeline.resultReceipt?'Published':'None'},
    {key:'Returned results',value:pipeline.returnedResults??0},{key:'Context Seal receipt',value:pipeline.admissionReceipt?'Published':'None'},
    {key:'Context-admitted results',value:pipeline.contextAdmitted??0},
    {key:'Generation receipt',value:pipeline.generationReceipt?'Published':'None'},{key:'Generation state',value:pipeline.generationState??'—'},
    {key:'Post-response learning',value:pipeline.learningReceipt?(pipeline.learningKind??'Published'):'None'},
    {key:'Host lifecycle',value:pipeline.hostLifecycle?String(pipeline.hostLifecycle.learned??0)+' learned · '+String(pipeline.hostLifecycle.pending??0)+' pending':'Not exported'},
  ]));
  const grid=element(d,'div',{className:'a52-wave13-status-grid'});
  for(const row of status.stages)grid.append(stageCard(d,row,scope,inspect,{showIds:true,inspection:status.inspections?.[row.id]}));
  section.append(grid);host.append(section);
}

export function renderResourceSurface(host,{resources,coprocessor=null,actionRouter,scope,refresh,notifications,connectionDrafts=null}={}){
  const d=host.ownerDocument,read=resources.read(),source=read.source,data=read.data??{resources:[],configurations:[],nativePathAvailable:true};
  const turnResources=safeCoprocessorResourceRows(coprocessor);
  const section=element(d,'section',{className:'a52-wave13-resources',attrs:{'aria-label':'Optional execution resource connections'}});
  const head=element(d,'div',{className:'a52-wave13-section-head'});
  head.append(element(d,'h2',{text:'Connections'}),makeHealthPill(d,{label:source.operationalState??source.health,status:source.statusToken,detail:source.impact}));
  section.append(head,element(d,'p',{className:'a52-muted',text:'Jev, Sidecar, and Vectoring are configured separately. Locked connection profiles are saved across demo reloads and rehydrated into Worker 2; provider credentials remain session-memory-only.'}));
  if(source.reason)section.append(message(d,source.operationalState==='UNAVAILABLE'?'Assembly action seam not connected':'Resource status',source.reason,source.statusToken));

  const caps=resources.capabilities();
  if(caps.read&&(!caps.connect||!caps.test||!caps.disconnect))section.append(message(d,'Resource controls incomplete','Resource status is readable, but connect/test/disconnect are not all exported by the assembly. Worker 2 remains the routing/execution owner.','warning'));

  const slots=element(d,'div',{className:'a52-wave13-connection-slots'});
  const drafts=connectionDrafts??createConnectionDraftStore(),savedProfiles=resources.savedProfiles?.()??[];
  if(savedProfiles.length)section.append(message(d,'Saved connection locks',savedProfiles.length+' optional connection profile'+(savedProfiles.length===1?' is':'s are')+' stored for reload recovery. API keys are intentionally not serialized.','ready'));
  for(const spec of connectionSlotSpecs()){
    const savedProfile=savedProfiles.find(row=>row.role===spec.id)??null;
    slots.append(renderConnectionSlot(d,{spec,savedProfile,rows:data.resources.filter(row=>connectionSlotFor(row)===spec.id).map(row=>overlayTurnResourceEvidence(row,turnResources)),resources,actionRouter,scope,refresh,notifications,caps,connectionDrafts:drafts}));
  }
  section.append(slots);

  if(!data.resources.length)section.append(message(d,'No optional resource connected',caps.read?'Worker 2 reports no configured optional resources. Native cognition remains available.':'The host assembly has not exported Worker 2 resource status/actions yet.','historical'));
  host.append(section);
}

function renderConnectionSlot(d,{spec,savedProfile=null,rows,resources,actionRouter,scope,refresh,notifications,caps,connectionDrafts}){
  const connected=rows.some(row=>row.connected),configured=rows.length>0,saved=Boolean(savedProfile);
  const slot=element(d,'section',{className:'a52-wave13-connection-slot',dataset:{slot:spec.id,connected:String(connected),locked:String(configured||saved),saved:String(saved)}});
  const head=element(d,'div',{className:'a52-wave13-connection-slot__head'});
  head.append(element(d,'h3',{text:spec.title}),makeBadge(d,connected?'CONNECTED':configured?(saved?'SAVED':'LOCKED'):saved?'SAVED':'OPEN',connected?'ready':configured||saved?'observed':'historical'));
  slot.append(head,element(d,'p',{className:'a52-wave13-connection-slot__hint',text:spec.description}));

  if(configured){
    const locked=element(d,'div',{className:'a52-wave13-connection-slot__locked'});
    for(const row of rows)locked.append(renderLockedResource(d,{row,spec,savedProfile,resources,actionRouter,scope,refresh,notifications,caps,connectionDrafts}));
    slot.append(locked);
    return slot;
  }

  if(!(caps.connect&&caps.configure)){
    slot.append(message(d,'Connection setup unavailable',caps.connect?'This assembly can reconnect owner-configured resources, but cannot add a new one.':'Worker 2 connection actions are not exported by this assembly.','warning'));
    return slot;
  }

  if(savedProfile)connectionDrafts.patch(spec.id,{
    connectionName:savedProfile.displayName??spec.defaultName,endpoint:savedProfile.endpoint??'',capabilities:(savedProfile.capabilities??spec.defaultCapabilities).join(', '),
    selectedModel:savedProfile.modelId??'',manualModel:savedProfile.modelId??'',
  });
  const draft=connectionDrafts.get(spec);
  const credentialWasCleared=connectionDrafts.consumeCredentialPresence(spec.id);
  const form=element(d,'div',{className:'a52-wave13-connection-slot__form'});
  const connectionName=field(d,'input',spec.title+' connection name',{type:'text',placeholder:spec.defaultName,autocomplete:'off'});
  connectionName.value=draft.connectionName??spec.defaultName;
  const endpoint=field(d,'input',spec.title+' endpoint',{type:'url',placeholder:spec.remotePlaceholder??'https://provider.example/v1'});
  endpoint.value=draft.endpoint??'';
  const apiKey=field(d,'input',spec.title+' API key',{type:'password',placeholder:'Required when the provider requires authentication',autocomplete:'off',spellcheck:'false'});
  const capabilities=field(d,'input',spec.title+' capabilities',{type:'text',placeholder:spec.defaultCapabilities.join(', ')});
  capabilities.value=draft.capabilities??spec.defaultCapabilities.join(', ');
  if(spec.fixedCapabilities){
    capabilities.disabled=true;capabilities.setAttribute('aria-disabled','true');capabilities.title='Jev capability is fixed by the owner contract.';
  }
  const draftModels=Array.isArray(draft.models)?draft.models:[];
  const modelListId='a52-model-list-'+String(spec.id).replace(/[^a-z0-9_-]/gi,'-');
  const modelChoice=field(d,'input',spec.title+' model',{type:'text',placeholder:'Type or choose a model ID',autocomplete:'off',list:modelListId});
  const modelSuggestions=element(d,'datalist',{attrs:{id:modelListId}});
  for(const modelRow of draftModels)modelSuggestions.append(option(d,modelRow.id,modelRow.label));
  modelChoice.value=draft.manualModel??draft.selectedModel??'';
  const discoveryState=element(d,'p',{className:'a52-wave13-connection-slot__hint',text:draft.discoveryMessage??(caps.discoverModels?'Load models from the provider before testing the connection. Choosing a model does not prove the connection works.':'Worker 2 model discovery is not exported here. Manual model entry is available only as a compatibility fallback.')});
  const updateDraft=()=>connectionDrafts.patch(spec.id,{
    connectionName:String(connectionName.value||spec.defaultName),endpoint:String(endpoint.value||''),capabilities:String(capabilities.value||''),
    selectedModel:String(modelChoice.value||''),manualModel:String(modelChoice.value||''),
  });
  listenField(scope,connectionName,'input',updateDraft);listenField(scope,endpoint,'input',updateDraft);listenField(scope,capabilities,'input',updateDraft);
  listenField(scope,modelChoice,'input',updateDraft);listenField(scope,modelChoice,'change',updateDraft);
  listenField(scope,apiKey,'input',()=>connectionDrafts.setCredentialPresence(spec.id,Boolean(String(apiKey.value||'').trim())));
  const loadModels=createButton(d,{label:'Load / Refresh Models',scope,size:'sm',variant:'quiet',disabled:!caps.discoverModels,onPress:async()=>{
    updateDraft();
    const parsedCaps=String(capabilities.value||'').split(',').map(x=>x.trim()).filter(Boolean);
    const result=await actionRouter.route({type:'wave13.resource.discoverModels',payload:{
      role:spec.role,transportKind:'OPENAI_COMPATIBLE',endpoint:endpoint.value||null,apiKey:apiKey.value||null,capabilities:parsedCaps,
    }});
    if(!result.ok){
      const text='Model discovery failed: '+String(result.error??'unknown error')+'.';
      connectionDrafts.patch(spec.id,{models:[],manualAllowed:true,discoveryState:'FAILED',discoveryMessage:text});
      modelSuggestions.replaceChildren();discoveryState.textContent=text+' You can still enter the exact model ID manually; Test Connection will verify it.';
      reportAction(notifications,result,spec.title+' model discovery');return;
    }
    const discovery=result.result??{},models=discoveryModels(discovery),state=String(discovery.state??'FAILED').toUpperCase(),statusText=discoveryStatusText(state,discovery,models.length);
    connectionDrafts.patch(spec.id,{models,manualAllowed:true,discoveryState:state,discoveryMessage:statusText});
    modelSuggestions.replaceChildren();
    for(const modelRow of models)modelSuggestions.append(option(d,modelRow.id,modelRow.label));
    discoveryState.textContent=statusText;reportAction(notifications,result,spec.title+' model discovery');
  }});
  const testConnection=createButton(d,{label:'Save, Lock & Test Connection',scope,onPress:async()=>{
    updateDraft();
    const selectedModel=String(modelChoice.value||'').trim();
    if(!selectedModel){
      discoveryState.textContent='Enter a model ID. Load models to get suggestions; qualification will verify the exact ID you submit.';
      return;
    }
    const parsedCaps=String(capabilities.value||'').split(',').map(x=>x.trim()).filter(Boolean);
    const connectResult=await actionRouter.route({type:'wave13.resource.connect',payload:{
      role:spec.role,displayName:connectionName.value||spec.defaultName,transportKind:'OPENAI_COMPATIBLE',
      endpoint:endpoint.value||null,modelId:selectedModel,apiKey:apiKey.value||null,capabilities:parsedCaps,local:isLocalConnectionEndpoint(endpoint.value),
    }});
    apiKey.value='';connectionDrafts.setCredentialPresence(spec.id,false);
    if(!connectResult.ok){
      discoveryState.textContent='Connection failed: '+String(connectResult.error??'unknown error')+'.';
      reportAction(notifications,connectResult,spec.title+' connection');refresh?.();return;
    }
    connectionDrafts.clear(spec.id);
    const connectedRow=resources.read().data.resources.find(row=>row.displayName===(connectionName.value||spec.defaultName)&&connectionSlotFor(row)===spec.id);
    const testResult=connectedRow?await actionRouter.route({type:'wave13.resource.test',target:connectedRow}):connectResult;
    const testFailure=resourceTestFailure(testResult);
    discoveryState.textContent=testFailure?'Connection test failed: '+testFailure:'Connection test passed. Owner-reported status is shown in the locked resource card.';
    reportResourceTest(notifications,testResult,spec.title+' connection test');refresh?.();
  }});
  form.append(
    labelWrap(d,'Connection name',connectionName),labelWrap(d,'Endpoint',endpoint),labelWrap(d,'API key',apiKey),labelWrap(d,'Capabilities',capabilities),
    loadModels,labelWrap(d,'Model',modelChoice),modelSuggestions,discoveryState,
    ...(savedProfile?[message(d,'Saved profile loaded','The saved '+spec.title+' endpoint, model, capabilities, and identity are prefilled.','ready')]:[]),
    ...(credentialWasCleared?[message(d,'API key cleared on refresh','For security, the unsubmitted API key was not retained when this workspace refreshed. Re-enter it before loading models or testing the connection.','warning')]:[]),
    element(d,'p',{className:'a52-wave13-connection-slot__hint',text:'Saving a connection locks its connection profile for future demo reloads.'}),
    testConnection
  );
  slot.append(form);return slot;
}

function renderLockedResource(d,{row,spec,savedProfile=null,resources,actionRouter,scope,refresh,notifications,caps,connectionDrafts}){
  const card=element(d,'article',{className:'a52-card a52-wave13-resource',dataset:{health:row.health,saved:String(Boolean(savedProfile))}});
  const top=element(d,'div',{className:'a52-inline-status'});
  top.append(element(d,'strong',{text:row.displayName??'Connected resource'}),makeBadge(d,savedProfile?'SAVED LOCK':'CONFIG LOCKED','observed'),makeBadge(d,row.state??row.health,resourceStatus(row.health)));
  const qualification=row.selectedModelQualified||row.callable?'Qualified callable by owner':row.connected?'Connected; not owner-qualified callable':'Not connected';
  card.append(top,createKeyValue(d,[
    {key:'Configured',value:'Yes'},{key:'Saved across reloads',value:savedProfile?'Yes':'Not yet'},{key:'Connection',value:row.state??(row.connected?'CONNECTED':'DISCONNECTED')},{key:'Qualification',value:qualification},
    {key:'Physical execution',value:row.physicalExecutionAttempted?(row.physicalExecutionSucceeded?'Succeeded':'Attempted / not successful'):'No cognitive execution observed'},
    {key:'Owner accepted',value:row.ownerAccepted===true?'Yes':row.ownerAccepted===false?'No':row.ownerAcceptanceSource==='OWNER_RECEIPT_REQUIRED'?'Requires owner receipt':'Not reported'},
    {key:'Health',value:row.health??'Not reported'},{key:'Availability',value:row.availability??'Not reported'},
    {key:'Provider',value:row.actualProvider??row.providerId??'—'},{key:'Model',value:row.actualModelId??row.modelId??'—'},
    {key:'Transport',value:row.transportKind??'—'},{key:'Measurement',value:row.measurementClass??'—'},
    {key:'Concurrency',value:String(row.currentLoad)+' / '+String(row.concurrencyCapacity)},{key:'Capabilities',value:(row.capabilities??row.declaredCapabilities??[]).join(', ')||'none published'},
  ]));
  if(!row.selectedModelQualified&&row.connected)card.append(message(d,'Connected is not qualified','Worker 2 reports a connection, but the selected model is not currently qualified. Requalify before treating this resource as callable.','warning'));
  else if(!row.callable)card.append(message(d,'Resource is not callable','Worker 2 does not currently consider this resource callable. Refresh models, select a valid model if needed, then requalify and Test.','warning'));

  const management=element(d,'div',{className:'a52-wave13-connection-slot__form'});
  const discovered=Array.isArray(row.modelDiscovery?.models)?row.modelDiscovery.models:[];
  const modelListId='a52-model-list-locked-'+String(row.id??row.resourceId??'resource').replace(/[^a-z0-9_-]/gi,'-');
  const model=field(d,'input',(spec?.title??row.kind??'Resource')+' qualified model',{type:'text',placeholder:'Type or choose a model ID',autocomplete:'off',list:modelListId});
  const modelSuggestions=element(d,'datalist',{attrs:{id:modelListId}});
  for(const item of discovered)modelSuggestions.append(option(d,String(item.id??item.modelId??''),String(item.displayName??item.name??item.id??item.modelId??'model')));
  model.value=String(row.modelId??'');

  const managementStatus=element(d,'p',{className:'a52-wave13-connection-slot__hint',attrs:{role:'status','aria-live':'polite'},text:'Operational settings remain owner-backed. Model changes require a new qualification check before the resource is callable.'});
  const manageActions=element(d,'div',{className:'a52-wave13-resource-actions'});
  if(caps.refreshModels)manageActions.append(createButton(d,{label:'Refresh models',scope,size:'sm',variant:'quiet',onPress:async()=>{
    const result=await actionRouter.route({type:'wave13.resource.refreshModels',target:row});reportAction(notifications,result,'Configured resource model refresh');refresh?.();
  }}));
  if(caps.selectModel)manageActions.append(createButton(d,{label:'Select model',scope,size:'sm',variant:'quiet',onPress:async()=>{
    const modelId=String(model.value||'').trim();if(!modelId){managementStatus.textContent='Enter a model ID. Refreshed models are suggestions, not a whitelist.';return;}
    const result=await actionRouter.route({type:'wave13.resource.selectModel',target:row,payload:{modelId}});
    managementStatus.textContent=result.ok?'Model selected. Requalification is required before this resource is callable.':'Model selection failed: '+String(result.error??'unknown error');
    reportAction(notifications,result,'Configured resource model selection');refresh?.();
  }}));
  if(manageActions.children?.length){
    management.append(labelWrap(d,'Model',model),modelSuggestions,manageActions,managementStatus);
    card.append(management);
  }

  const actions=element(d,'div',{className:'a52-wave13-resource-actions'});
  if(caps.connect&&!row.callable)actions.append(createButton(d,{label:row.connected?'Requalify':'Connect / qualify',scope,size:'sm',onPress:async()=>{const result=await actionRouter.route({type:'wave13.resource.connect',target:row});reportAction(notifications,result,'Resource qualification');refresh?.();}}));
  if(caps.test)actions.append(createButton(d,{label:'Test',scope,size:'sm',onPress:async()=>{const result=await actionRouter.route({type:'wave13.resource.test',target:row});reportResourceTest(notifications,result,'Resource test');refresh?.();}}));
  if(caps.disconnect&&row.connected)actions.append(createButton(d,{label:'Disconnect',scope,size:'sm',variant:'quiet',onPress:async()=>{const result=await actionRouter.route({type:'wave13.resource.disconnect',target:row});reportAction(notifications,result,'Resource disconnect');refresh?.();}}));
  if(savedProfile)actions.append(createButton(d,{label:'Forget saved lock',scope,size:'sm',variant:'quiet',onPress:async()=>{
    const result=await actionRouter.route({type:'wave13.resource.forgetSaved',target:row});
    if(result.ok)notifications?.push?.({message:'Saved '+(spec?.title??'resource')+' connection lock removed. The current owner record remains configured until this runtime reloads.',status:'info'});
    else reportAction(notifications,result,'Saved connection lock removal');
    refresh?.();
  }}));
  if(actions.children?.length)card.append(actions);
  return card;
}

function resourceStatus(v){if(v==='HEALTHY')return'ready';if(v==='DEGRADED'||v==='SATURATED'||v==='COOLDOWN'||v==='PROBE')return'warning';return'offline';}
function testSummary(x){
  if(x?.failure||String(x?.resource?.lastTest?.status??'').toUpperCase()==='FAIL')return'FAIL';
  if(String(x?.resource?.lastTest?.status??'').toUpperCase()==='PASS')return'PASS';
  return String(x?.status??x?.health??x?.result?.status??(x?.ok===true?'PASS':x?.ok===false?'FAIL':'completed'));
}
function resourceTestFailure(actionResult){
  if(!actionResult?.ok)return String(actionResult?.error??'Owner test action failed.');
  const owner=actionResult.result??{};
  if(owner.failure)return String(owner.failure.message??owner.failure.code??'Provider check failed.');
  const resource=owner.resource??owner;
  if(String(resource?.lastTest?.status??'').toUpperCase()==='FAIL')return String(resource?.lastFailure?.message??resource?.reason??resource?.lastTest?.failureCode??'Provider check failed.');
  if(['UNAVAILABLE'].includes(String(resource?.state??'').toUpperCase())&&resource?.lastFailure)return String(resource.lastFailure.message??resource.reason??'Provider is unavailable.');
  return null;
}
function reportResourceTest(notifications,result,label){
  if(!notifications?.push)return;
  const failure=resourceTestFailure(result);notifications.push({status:failure?'error':'success',message:label+': '+(failure??'passed')});
}
function reportAction(notifications,result,label){if(!notifications?.push)return;notifications.push({status:result?.ok?'success':'error',message:label+': '+(result?.ok?'completed':result?.error??'failed')});}
