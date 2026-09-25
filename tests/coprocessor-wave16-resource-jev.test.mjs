import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  Capability,CoprocessorResourceConnections,JevDecisionCore,JevDecisionShape,JevOutcome,
  ProviderTransportMode,ResourceConnectionState,ResourceCredentialStorage,ResourceKind,
  ResourceMeasurementClass,ResourceModelDiscoveryState,createCognitiveTask,createCoprocessorResourceHost,
  createJevDecisionRequest,createRevisionSet,
} from '../src/coprocessor/index.js';

function graphOutput(){
  return {nodes:['story:station'],edges:[],currentStateRefs:['story:state:current'],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'Bounded current location selected.'};
}
function jevDecision(selected='route-north'){
  const rejected=selected==='route-north'?['route-south']:['route-north'];
  return {outcome:'DECIDED',decisionCode:'CHOOSE_ONE',selectedOptionIds:[selected],rejectedOptionIds:rejected,classification:null,
    reasonCodes:['BOUNDED_EVIDENCE'],evidenceUsed:[selected==='route-north'?'ev:north':'ev:south'],unresolvedFactors:[],confidence:.82,abstained:false,
    escalationTarget:null,requiresOperator:false,explanation:'The cited bounded evidence distinguishes the alternatives.'};
}
function jevAbstain(){
  return {outcome:'ABSTAINED',decisionCode:'ABSTAIN',selectedOptionIds:[],rejectedOptionIds:[],classification:null,
    reasonCodes:['INSUFFICIENT_EVIDENCE'],evidenceUsed:[],unresolvedFactors:['Both bounded alternatives remain supported.'],confidence:0,abstained:true,
    escalationTarget:null,requiresOperator:false,explanation:'The supplied evidence does not safely distinguish the alternatives.'};
}

async function startProvider(){
  let mode='good',delayMs=0;
  const calls={models:0,embeddingModels:0,chat:0,embeddings:0,authFailures:0};let lastChatBody=null;
  const server=http.createServer(async(req,res)=>{
    const auth=req.headers.authorization;
    if(auth!=='Bearer good-key'){calls.authFailures++;res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'unauthorized'}}));return;}
    if(delayMs&&req.method==='GET')await sleep(delayMs);
    if(req.method==='GET'&&req.url==='/api/v1/models'){
      calls.models++;
      if(mode==='unsupported'){res.writeHead(404);res.end();return;}
      if(mode==='failed-discovery'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({models:'not-data'}));return;}
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({data:mode==='empty'?[]:[
        {id:'story-chat',name:'Story Chat',canonical_slug:'fixture/story-chat',context_length:32768,architecture:{input_modalities:['text'],output_modalities:['text']},supported_parameters:['structured_outputs'],pricing:{prompt:'0.000001',completion:'0.000002'}},
        {id:'alternate-chat',name:'Alternate Chat',architecture:{input_modalities:['text'],output_modalities:['text']}},
      ]}));return;
    }
    if(req.method==='GET'&&req.url==='/api/v1/embeddings/models'){
      calls.embeddingModels++;
      if(mode==='unsupported'){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({data:mode==='empty'?[]:[{id:'story-embed',name:'Story Embed',context_length:8192,architecture:{input_modalities:['text'],output_modalities:['embeddings']},pricing:{prompt:'0.0000001'}}]}));return;
    }
    if(req.method==='POST'&&req.url==='/api/v1/chat/completions'){
      calls.chat++;let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');lastChatBody=structuredClone(body);
      if(body.model!=='story-chat'&&body.model!=='alternate-chat'){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'model missing'}}));return;}
      if(mode==='strict-qualification'){
        if('temperature' in body||'max_tokens' in body||'max_completion_tokens' in body||body.messages?.length!==1||body.messages?.[0]?.role!=='user'){
          res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'qualification request used unsupported optional parameters'}}));return;
        }
        res.writeHead(200,{'content-type':'application/json','x-request-id':'fixture-reasoning'});
        res.end(JSON.stringify({model:body.model,provider:'fixture-reasoning-upstream',choices:[{message:{content:null,reasoning:'qualification accepted'},finish_reason:'length'}]}));return;
      }
      const system=String(body.messages?.[0]?.content??''),user=String(body.messages?.[1]?.content??'');
      if(delayMs&&system.includes('Graph Walker'))await sleep(delayMs);
      let content='{}';
      if(system.includes('Graph Walker'))content=JSON.stringify(graphOutput());
      else if(system.includes('bounded adjudication protocol')){
        if(mode==='unknown-option')content=JSON.stringify({...jevDecision(),selectedOptionIds:['invented-option'],rejectedOptionIds:[]});
        else if(user.includes('guild-hall'))content=JSON.stringify(jevAbstain());
        else content=JSON.stringify(jevDecision());
      }
      res.writeHead(200,{'content-type':'application/json','x-request-id':'fixture-chat'});
      res.end(JSON.stringify({model:body.model,provider:'fixture-upstream',choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:13,completion_tokens:9}}));return;
    }
    if(req.method==='POST'&&req.url==='/api/v1/embeddings'){
      calls.embeddings++;let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
      if(body.model!=='story-embed'){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'model missing'}}));return;}
      const values=Array.isArray(body.input)?body.input:[body.input];
      res.writeHead(200,{'content-type':'application/json','x-request-id':'fixture-embed'});
      res.end(JSON.stringify({model:'story-embed',provider:'fixture-embedding-upstream',data:values.map((_,index)=>({object:'embedding',index,embedding:[index+.1,index+.2,index+.3]})),usage:{prompt_tokens:values.length*4,total_tokens:values.length*4}}));return;
    }
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();
  return {
    baseUrl:'http://127.0.0.1:'+address.port+'/api/v1',
    setMode(value){mode=value;},setDelay(value){delayMs=value;},calls:()=>({...calls,lastChatBody:lastChatBody==null?null:structuredClone(lastChatBody)}),
    close:()=>new Promise(resolve=>server.close(resolve)),
  };
}

function addChat(registry,endpoint,{resourceId='chat',apiKey=null,modelId='story-chat',timeoutMs=1000,credentialRequired=true}={}){
  return registry.addResource({resourceId,displayName:'Fixture Chat',providerProfileId:'profile:'+resourceId,providerId:'provider:'+resourceId,workerId:'worker:'+resourceId,
    kind:ResourceKind.OPENAI_COMPATIBLE,endpoint,modelId,apiKey,credentialRequired,timeoutMs,healthTimeoutMs:500,
    capabilities:[Capability.GRAPH,Capability.SEMANTIC_JUDGMENT],measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC,
    costMetadata:{inputPerMillion:1,outputPerMillion:2},local:false});
}
function graphTask(id='graph'){
  const now=Date.now();return createCognitiveTask({taskId:id,taskType:'GRAPH_WALK',turnId:'turn:'+id,correlationId:'corr:'+id,
    requiredCapabilities:[Capability.GRAPH],softDeadline:now+2000,hardDeadline:now+4000,compilerLane:'wave16',intentFingerprint:'intent:'+id,
    inputRevisionSet:createRevisionSet({sourceRevisionSet:['src:'+id+'@1'],worldRevision:2,sceneRevision:3,characterStateRevision:1}),metadata:{expectedOutputTokens:128}});
}
function graphInput(){return{nodes:[{ref:'story:station',type:'LOCATION'}],edges:[],states:[{ref:'story:state:current',entityRef:'story:sensor',temporalStatus:'CURRENT',summary:'The sensor is mounted at the station.'}],conflicts:[]};}
function jevRequest(id,{guild=false}={}){
  const now=Date.now();const options=guild
    ?[{optionId:'guild-hall',label:'Guild hall',evidenceRefs:['ev:north']},{optionId:'road-camp',label:'Road camp',evidenceRefs:['ev:south']}]
    :[{optionId:'route-north',label:'North route',evidenceRefs:['ev:north']},{optionId:'route-south',label:'South route',evidenceRefs:['ev:south']}];
  return createJevDecisionRequest({decisionId:id,decisionType:'BOUNDED_STATE_AMBIGUITY',decisionShape:JevDecisionShape.CHOOSE_ONE,
    turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,options,
    evidenceRefs:[{evidenceId:'ev:north',summary:'Bounded evidence supports the first alternative.'},{evidenceId:'ev:south',summary:'Independent bounded evidence supports the second alternative.'}],
    sourceRevisionSet:['src:'+id+'@1'],worldRevision:3,sceneRevision:4,characterStateRevision:2,domainRevisions:{story:3},freshnessToken:'fresh:'+id,
    authorityBoundary:{authorityClass:'ADVISORY',ownerId:'brain-core'},routing:{expectedDecisionValue:.9,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2,currentGenerationDepends:true},
    escalationPolicy:{maxRetries:0},deadline:now+4000,softDeadline:now+2500});
}
function fresh(request){return{sourceRevisionSet:request.sourceRevisionSet,worldRevision:request.worldRevision,sceneRevision:request.sceneRevision,characterStateRevision:request.characterStateRevision,domainRevisions:request.domainRevisions,freshnessToken:request.freshnessToken};}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('Wave16 credential lifecycle is session-only, redacted, replaceable and revocable',async()=>{
  const provider=await startProvider();
  try{
    const registry=new CoprocessorResourceConnections();addChat(registry,provider.baseUrl);
    let row=await registry.connectResource('chat');
    assert.equal(row.state,ResourceConnectionState.UNAVAILABLE);assert.equal(row.reasonCode,'CREDENTIAL_REQUIRED');assert.equal(row.callable,false);
    registry.setResourceCredential('chat','bad-key');
    const unauthorized=await registry.refreshResourceModels('chat');assert.equal(unauthorized.state,ResourceModelDiscoveryState.UNAUTHORIZED);assert.equal(unauthorized.manualModelEntryAllowed,true);
    registry.setResourceCredential('chat','good-key');
    const models=await registry.refreshResourceModels('chat');assert.equal(models.state,ResourceModelDiscoveryState.READY);assert.ok(models.models.some(x=>x.id==='story-chat'));
    registry.selectResourceModel('chat','story-chat');row=await registry.connectResource('chat');
    assert.equal(row.state,ResourceConnectionState.READY);assert.equal(row.selectedModelQualified,true);assert.equal(row.callable,true);
    assert.equal(row.credentialStorage,ResourceCredentialStorage.SESSION_MEMORY_ONLY);assert.equal(row.credentialConfigured,true);
    const testResult=await registry.testResource('chat');assert.equal(testResult.resource.lastTest.status,'PASS');
    const publicText=JSON.stringify({model:registry.readModel(),telemetry:registry.telemetry?.list?.()??[]});
    assert.equal(publicText.includes('good-key'),false);assert.equal(publicText.includes('bad-key'),false);
    row=registry.clearResourceCredential('chat');assert.equal(row.credentialConfigured,false);assert.equal(row.selectedModelQualified,false);assert.equal(row.callable,false);
  }finally{await provider.close();}
});

test('Wave16 provider execution omits default temperature and requests only task-sized output',async()=>{
  const provider=await startProvider();
  try{
    const registry=new CoprocessorResourceConnections();addChat(registry,provider.baseUrl,{apiKey:'good-key'});
    await registry.connectResource('chat');
    const result=await registry.executeTask(graphTask('parameter-compatibility'),{input:graphInput()});
    assert.equal(result.status,'SUCCESS');
    const body=provider.calls().lastChatBody;
    assert.equal(body.temperature,undefined);
    assert.equal(body.max_tokens,128);
  }finally{await provider.close();}
});

test('Wave16 chat qualification accepts minimal reasoning-style completion responses',async()=>{
  const provider=await startProvider();
  try{
    provider.setMode('strict-qualification');
    const registry=new CoprocessorResourceConnections();addChat(registry,provider.baseUrl,{apiKey:'good-key'});
    const discovery=await registry.refreshResourceModels('chat');assert.equal(discovery.state,ResourceModelDiscoveryState.READY);
    const ready=await registry.connectResource('chat');
    assert.equal(ready.state,ResourceConnectionState.READY);
    assert.equal(ready.selectedModelQualified,true);
    assert.equal(ready.callable,true);
    assert.equal(ready.actualModelId,'story-chat');
    assert.equal(ready.actualProvider,'fixture-reasoning-upstream');
    assert.ok(provider.calls().chat>=1);
  }finally{await provider.close();}
});

test('Wave16 discovery exposes loading, ready, empty, unsupported, unauthorized, unreachable and failed states',async()=>{
  const provider=await startProvider();
  try{
    const registry=new CoprocessorResourceConnections();addChat(registry,provider.baseUrl,{apiKey:'good-key'});
    const observed=[];const release=registry.subscribe(event=>{if(event.type==='RESOURCE_DISCOVERY')observed.push(event.resource.modelDiscovery.state);});
    provider.setDelay(20);let result=await registry.refreshResourceModels('chat');provider.setDelay(0);release();
    assert.equal(result.state,ResourceModelDiscoveryState.READY);assert.ok(observed.includes(ResourceModelDiscoveryState.LOADING));
    provider.setMode('empty');result=await registry.refreshResourceModels('chat');assert.equal(result.state,ResourceModelDiscoveryState.EMPTY);assert.equal(result.manualModelEntryAllowed,true);
    provider.setMode('unsupported');result=await registry.refreshResourceModels('chat');assert.equal(result.state,ResourceModelDiscoveryState.UNSUPPORTED);assert.equal(result.manualModelEntryAllowed,true);
    provider.setMode('good');registry.setResourceCredential('chat','bad-key');result=await registry.refreshResourceModels('chat');assert.equal(result.state,ResourceModelDiscoveryState.UNAUTHORIZED);assert.equal(result.manualModelEntryAllowed,true);
    registry.setResourceCredential('chat','good-key');provider.setMode('failed-discovery');result=await registry.refreshResourceModels('chat');assert.equal(result.state,ResourceModelDiscoveryState.FAILED);assert.equal(result.manualModelEntryAllowed,true);
  }finally{await provider.close();}

  const dead=await startProvider();const deadUrl=dead.baseUrl;await dead.close();
  const unreachableRegistry=new CoprocessorResourceConnections();
  const unreachable=await unreachableRegistry.discoverModels({endpoint:deadUrl,apiKey:'good-key',capabilities:[Capability.GRAPH],timeoutMs:50});
  assert.equal(unreachable.state,ResourceModelDiscoveryState.UNREACHABLE);assert.equal(unreachable.manualModelEntryAllowed,true);

  const openrouter=new CoprocessorResourceConnections();
  openrouter.addResource({resourceId:'remote',providerProfileId:'profile:remote',providerId:'provider:remote',workerId:'worker:remote',kind:ResourceKind.OPENAI_COMPATIBLE,
    endpoint:'https://openrouter.ai/api/v1',modelId:'vendor/model',capabilities:[Capability.SEMANTIC_JUDGMENT],local:true});
  const remote=openrouter.readResource('remote');assert.equal(remote.local,false);assert.equal(remote.providerIdentity.family,'OPENROUTER');assert.equal(remote.credentialRequired,true);
});

test('Wave16 vector resource uses embeddings transport and never labels chat output as an embedding',async()=>{
  const provider=await startProvider();
  try{
    const registry=new CoprocessorResourceConnections();
    registry.addResource({resourceId:'vector',providerProfileId:'profile:vector',providerId:'provider:vector',workerId:'worker:vector',kind:ResourceKind.OPENAI_COMPATIBLE,
      endpoint:provider.baseUrl,modelId:'story-embed',apiKey:'good-key',credentialRequired:true,capabilities:[Capability.RETRIEVAL,Capability.EMBED],
      measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC,costMetadata:{inputPerMillion:1,outputPerMillion:0},local:false});
    let row=registry.readResource('vector');assert.equal(row.transportMode,ProviderTransportMode.EMBEDDINGS);assert.deepEqual(row.routableCapabilities,[Capability.EMBED]);
    const discovery=await registry.refreshResourceModels('vector');assert.equal(discovery.state,ResourceModelDiscoveryState.READY);assert.deepEqual(discovery.models[0].capabilities,[Capability.EMBED]);
    row=await registry.connectResource('vector');assert.equal(row.callable,true);assert.deepEqual(row.activeCapabilities,[Capability.EMBED]);
    const result=await registry.executeEmbedding('vector',{input:['first passage','second passage']});
    assert.equal(result.vectorCount,2);assert.equal(result.dimensions,3);assert.equal(result.actualModelId,'story-embed');assert.equal(result.actualProvider,'fixture-embedding-upstream');
    assert.equal(result.usageReceipt.cost.status,'MEASURED');assert.equal(provider.calls().chat,0);assert.ok(provider.calls().embeddings>=2);
    await assert.rejects(()=>registry.executeTask(graphTask('not-vector-chat'),{input:graphInput()}),error=>error?.code==='CAPABILITY_UNAVAILABLE');
  }finally{await provider.close();}
});

test('Wave16 chat qualification records physical resource, actual model/provider, usage and disconnect',async()=>{
  const provider=await startProvider();
  try{
    const registry=new CoprocessorResourceConnections();addChat(registry,provider.baseUrl,{apiKey:'good-key'});
    await registry.refreshResourceModels('chat');await registry.connectResource('chat');
    const result=await registry.executeTask(graphTask('forest-setting'),{input:graphInput()});
    assert.equal(result.providerId,'provider:chat');assert.equal(result.workerId,'worker:chat');assert.equal(result.modelId,'story-chat');
    assert.equal(result.providerMetadata.actualProvider,'fixture-upstream');assert.equal(result.providerMetadata.measurementClass,ResourceMeasurementClass.LOCAL_DETERMINISTIC);
    assert.equal(result.providerMetadata.usageReceipt.cost.status,'MEASURED');
    const row=registry.disconnectResource('chat');assert.equal(row.state,ResourceConnectionState.DISCONNECTED);assert.equal(row.callable,false);
  }finally{await provider.close();}
});

test('Wave16 timeout and disconnect during execution remain typed failures with native fallback intact',async()=>{
  const provider=await startProvider();
  try{
    const timeoutRegistry=new CoprocessorResourceConnections();addChat(timeoutRegistry,provider.baseUrl,{resourceId:'slow',apiKey:'good-key',timeoutMs:25});
    await timeoutRegistry.connectResource('slow');provider.setDelay(80);
    const timed=await timeoutRegistry.executeTaskWithFallback(graphTask('timed'),{input:graphInput(),maxProviders:1});
    assert.equal(timed.status,'FAILED');assert.equal(timed.failure.code,'PROVIDER_TIMEOUT');
    provider.setDelay(0);

    const disconnectRegistry=new CoprocessorResourceConnections();addChat(disconnectRegistry,provider.baseUrl,{resourceId:'disconnect',apiKey:'good-key',timeoutMs:1000});
    await disconnectRegistry.connectResource('disconnect');provider.setDelay(120);
    const running=disconnectRegistry.executeTask(graphTask('disconnecting'),{input:graphInput()});await sleep(15);disconnectRegistry.disconnectResource('disconnect');
    await assert.rejects(running,error=>error?.code==='PROVIDER_ABORTED');
    assert.equal(disconnectRegistry.readModel().nativePathRequired,true);
  }finally{await provider.close();}
});

test('Wave16 Jev measures skip, useful bounded decision, safe abstention, false-certainty rejection and post-seal admission',async()=>{
  const provider=await startProvider();
  try{
    const registry=new CoprocessorResourceConnections();addChat(registry,provider.baseUrl,{apiKey:'good-key'});
    await registry.connectResource('chat');const core=new JevDecisionCore({providerExecutor:registry.createJevProviderExecutor()});
    const clear=jevRequest('clear-case');const before=provider.calls().chat;
    const clearReceipt=await core.decide(clear,{currentRevisionState:fresh(clear),deterministicAnswer:{outcome:JevOutcome.DECIDED,decisionCode:JevDecisionShape.CHOOSE_ONE,selectedOptionIds:['route-north'],rejectedOptionIds:['route-south'],evidenceUsed:['ev:north'],confidence:1}});
    assert.equal(clearReceipt.serviceStatus,'JEV_SKIPPED');assert.equal(provider.calls().chat,before);

    const ambiguous=jevRequest('orbital-route');const decided=await core.decide(ambiguous,{currentRevisionState:fresh(ambiguous)});
    assert.equal(decided.outcome,'DECIDED');assert.deepEqual(decided.selectedOptionIds,['route-north']);assert.equal(decided.authorityGranted,false);assert.equal(decided.settlementPerformed,false);
    assert.equal(decided.providerProvenance.modelId,'story-chat');assert.equal(decided.providerProvenance.actualProvider,'fixture-upstream');assert.equal(decided.providerProvenance.resourceId,'chat');

    const guild=jevRequest('guild-witness',{guild:true});const abstained=await core.decide(guild,{currentRevisionState:fresh(guild)});
    assert.equal(abstained.outcome,'ABSTAINED');assert.equal(abstained.abstained,true);assert.equal(abstained.authorityGranted,false);

    provider.setMode('unknown-option');const invalidRequest=jevRequest('false-certainty');
    const invalid=await core.decide(invalidRequest,{currentRevisionState:fresh(invalidRequest)});
    assert.equal(invalid.serviceStatus,'JEV_INVALID');assert.equal(invalid.authorityGranted,false);assert.equal(invalid.settlementPerformed,false);
    provider.setMode('good');

    const lateRequest=jevRequest('sealed-late');const late=await core.decide(lateRequest,{currentRevisionState:fresh(lateRequest),sealed:true});
    assert.equal(late.admission.late,true);assert.equal(late.admission.foregroundEligible,false);assert.equal(late.authorityGranted,false);
  }finally{await provider.close();}
});

test('Wave16 public host exposes credential/discovery/selection actions without taking UI or Brain authority',()=>{
  const host=createCoprocessorResourceHost();
  for(const action of ['discoverModels','refreshModels','setCredential','clearCredential','revokeCredential','selectModel','connectResource','disconnectResource','testResource'])
    assert.equal(typeof host.actions[action],'function',action);
  assert.equal(typeof host.execution.createEmbeddings,'function');
  assert.equal(host.authority.finalChoice,false);assert.equal(host.authority.truth,false);assert.equal(host.authority.settlement,false);assert.equal(host.authority.contextSeal,false);
  assert.equal(host.read.resources().nativePathRequired,true);
});
