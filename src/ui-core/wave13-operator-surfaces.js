import { ProductDetailLevel } from './wave5-product-model.js';
import { OperatorProducerState, parseLoreSubmission } from './wave13-operator-adapters.js';
import { createButton, createKeyValue, createProgressBar, element, makeBadge, makeHealthPill } from './primitives.js';

export function installWave13OperatorSurfaces(registry,{operations=null,resources=null,loreStudy=null,actionRouter=null}={}){
  const releases=[];
  if(registry.has('home')){
    const current=registry.get('home');
    registry.update('home',{render(host,ctx){current.render?.(host,ctx);if(operations)renderOperationalSummary(host,{...ctx,operations});}});
  }
  if(registry.has('brain')){
    const current=registry.get('brain');
    registry.update('brain',{render(host,ctx){current.render?.(host,ctx);if(resources)renderResourceSurface(host,{...ctx,resources,actionRouter});if(operations&&ctx.productAdapter.getDetailLevel()!==ProductDetailLevel.NORMAL)renderOperationalDetail(host,{...ctx,operations});}});
  }
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
  const section=element(d,'section',{className:'a52-wave13-resources',attrs:{'aria-label':'Jev and sidecar resources'}});
  const head=element(d,'div',{className:'a52-wave13-section-head'});
  head.append(element(d,'h2',{text:'Jev / sidecar resources'}),makeHealthPill(d,{label:source.operationalState??source.health,status:source.statusToken,detail:source.impact}));
  section.append(head,element(d,'p',{className:'a52-muted',text:'Optional execution resources add capabilities. The native Brain remains valid when none are attached.'}));
  if(source.reason)section.append(message(d,source.operationalState==='UNAVAILABLE'?'Assembly action seam not connected':'Resource status',source.reason,source.statusToken));

  const caps=resources.capabilities();
  if(caps.read&&(!caps.connect||!caps.test||!caps.disconnect))section.append(message(d,'Resource controls incomplete','Resource status is readable, but connect/test/disconnect are not all exported by the assembly. Worker 2 remains the routing/execution owner.','warning'));
  if(caps.connect){
    const form=element(d,'div',{className:'a52-wave13-resource-connect'});
    const kind=field(d,'select','Resource type');for(const value of ['SIDECAR','JEV'])kind.append(option(d,value,value));
    const profile=field(d,'input','Profile ID',{type:'text',placeholder:'local-resource'});
    const endpoint=field(d,'input','Local endpoint',{type:'url',placeholder:'http://127.0.0.1:...'});
    const model=field(d,'input','Model ID',{type:'text',placeholder:'optional model id'});
    const connect=createButton(d,{label:'Connect resource',scope,onPress:async()=>{
      const result=await actionRouter.route({type:'wave13.resource.connect',payload:{kind:kind.value||'SIDECAR',profileId:profile.value||null,endpoint:endpoint.value||null,modelId:model.value||null,local:true}});
      reportAction(notifications,result,'Resource connection');refresh?.();
    }});
    form.append(labelWrap(d,'Type',kind),labelWrap(d,'Profile',profile),labelWrap(d,'Endpoint',endpoint),labelWrap(d,'Model',model),connect);section.append(form);
  }

  if(!data.resources.length)section.append(message(d,'No optional resource connected',caps.read?'Worker 2 reports no connected optional resources. Native cognition remains available.':'The host assembly has not exported Worker 2 resource status/actions yet.','historical'));
  else{
    const list=element(d,'div',{className:'a52-wave13-resource-list'});
    for(const row of data.resources){
      const card=element(d,'article',{className:'a52-card a52-wave13-resource',dataset:{health:row.health}});
      const top=element(d,'div',{className:'a52-inline-status'});
      top.append(element(d,'strong',{text:row.id}),makeBadge(d,row.kind,'observed'),makeBadge(d,row.health,resourceStatus(row.health)));
      card.append(top,createKeyValue(d,[
        {key:'Provider',value:row.providerId??'—'},{key:'Model',value:row.modelId??'—'},{key:'Placement',value:(row.placements??[]).join(', ')||'—'},
        {key:'Concurrency',value:String(row.currentLoad)+' / '+String(row.concurrencyCapacity)},{key:'Capabilities',value:(row.capabilities??[]).join(', ')||'none published'},
      ]));
      const actions=element(d,'div',{className:'a52-wave13-resource-actions'});
      if(caps.test)actions.append(createButton(d,{label:'Test',scope,size:'sm',onPress:async()=>{const result=await actionRouter.route({type:'wave13.resource.test',target:row});reportAction(notifications,result,'Resource test');refresh?.();}}));
      if(caps.disconnect&&row.connected)actions.append(createButton(d,{label:'Disconnect',scope,size:'sm',variant:'quiet',onPress:async()=>{const result=await actionRouter.route({type:'wave13.resource.disconnect',target:row});reportAction(notifications,result,'Resource disconnect');refresh?.();}}));
      const test=resources.testResult(row.id);if(test)card.append(element(d,'p',{className:'a52-muted',text:'Latest connection test: '+testSummary(test)}));
      if(row.lastError)card.append(message(d,'Resource issue',String(row.lastError),'warning'));
      if(actions.children?.length)card.append(actions);list.append(card);
    }
    section.append(list);
  }
  host.append(section);
}

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
