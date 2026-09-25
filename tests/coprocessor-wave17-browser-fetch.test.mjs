import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Capability,CoprocessorResourceConnections,CoprocessorTelemetry,ProviderTransportMode,
  ResourceConnectionState,ResourceKind,ResourceMeasurementClass,createCognitiveTask,createRevisionSet,
} from '../src/coprocessor/index.js';

function response(body,status=200){
  return{ok:status>=200&&status<300,status,headers:{get:()=>null},json:async()=>structuredClone(body),text:async()=>JSON.stringify(body)};
}
function graphTask(id){
  const now=Date.now();
  return createCognitiveTask({
    taskId:'task:'+id,taskType:'GRAPH_WALK',turnId:'turn:'+id,correlationId:'corr:'+id,
    requiredCapabilities:[Capability.GRAPH],softDeadline:now+1500,hardDeadline:now+3000,
    compilerLane:'graphResults',intentFingerprint:'intent:'+id,
    inputRevisionSet:createRevisionSet({sourceRevisionSet:['source:'+id+'@1'],worldRevision:1,sceneRevision:1,characterStateRevision:1}),
    metadata:{expectedOutputTokens:128},
  });
}
function graphInput(){
  return{nodes:[{ref:'browser:station',type:'LOCATION'}],edges:[],states:[{ref:'browser:state',entityRef:'browser:sensor',temporalStatus:'CURRENT',summary:'The sensor is mounted at the station.'}],conflicts:[]};
}
function graphOutput(){
  return{nodes:['browser:station'],edges:[],currentStateRefs:['browser:state'],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'Bounded current state selected.'};
}
function installWindowBoundFetch(){
  const original=globalThis.fetch;
  const calls=[];
  let authMode='good';
  const nativeLike=async function(url,init={}){
    if(this!==globalThis)throw new TypeError('Window.fetch: Illegal invocation');
    const href=String(url),method=String(init.method??'GET').toUpperCase(),authorization=header(init.headers,'authorization');
    calls.push({href,method,authorization});
    if(authMode==='denied'||authorization!=='Bearer browser-key')return response({error:{message:'unauthorized'}},401);
    if(method==='GET'&&href.endsWith('/embeddings/models'))return response({data:[{id:'browser-embed',name:'Browser Embed',architecture:{input_modalities:['text'],output_modalities:['embeddings']}}]});
    if(method==='GET'&&href.endsWith('/models'))return response({data:[{id:'browser-chat',name:'Browser Chat',architecture:{input_modalities:['text'],output_modalities:['text']}}]});
    if(method==='POST'&&href.endsWith('/chat/completions')){
      const body=JSON.parse(init.body??'{}'),system=String(body.messages?.[0]?.content??'');
      const content=system.includes('Graph Walker')?JSON.stringify(graphOutput()):'{"probe":"ok"}';
      return response({model:body.model,provider:'browser-upstream',choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:5}});
    }
    if(method==='POST'&&href.endsWith('/embeddings')){
      const body=JSON.parse(init.body??'{}'),values=Array.isArray(body.input)?body.input:[body.input];
      return response({model:body.model,provider:'browser-embedding-upstream',data:values.map((_,i)=>({index:i,embedding:[i+.1,i+.2,i+.3]})),usage:{prompt_tokens:values.length*3,total_tokens:values.length*3}});
    }
    return response({error:{message:'not found'}},404);
  };
  globalThis.fetch=nativeLike;
  return{
    calls,
    deny(){authMode='denied';},
    allow(){authMode='good';},
    restore(){globalThis.fetch=original;},
  };
}
function header(headers,name){
  if(!headers)return null;
  if(typeof headers.get==='function')return headers.get(name);
  const key=Object.keys(headers).find(k=>k.toLowerCase()===name.toLowerCase());
  return key?headers[key]:null;
}

test('Wave17 native Window.fetch receiver survives discovery, connect/test and chat execution',async()=>{
  const windowFetch=installWindowBoundFetch();
  try{
    const telemetry=new CoprocessorTelemetry();
    const registry=new CoprocessorResourceConnections({telemetry});
    const discovery=await registry.discoverModels({
      endpoint:'https://openrouter.ai/api/v1',apiKey:'browser-key',capabilities:[Capability.GRAPH],
    });
    assert.equal(discovery.state,'READY');assert.equal(discovery.models[0].id,'browser-chat');assert.equal(discovery.local,false);
    registry.addResource({
      resourceId:'chat',providerProfileId:'profile:chat',providerId:'provider:chat',workerId:'worker:chat',
      kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:'https://openrouter.ai/api/v1',modelId:'browser-chat',apiKey:'browser-key',
      capabilities:[Capability.GRAPH],measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC,
    });
    const models=await registry.refreshResourceModels('chat');assert.equal(models.state,'READY');
    registry.selectResourceModel('chat','browser-chat');
    let row=await registry.connectResource('chat');
    assert.equal(row.state,ResourceConnectionState.READY);assert.equal(row.connected,true);assert.equal(row.callable,true);assert.equal(row.local,false);assert.equal(row.providerIdentity.family,'OPENROUTER');
    const probe=await registry.testResource('chat');assert.equal(probe.resource.lastTest.status,'PASS');assert.equal(probe.resource.connected,true);
    const result=await registry.executeTask(graphTask('browser-chat'),{input:graphInput(),profileId:'profile:chat'});
    assert.equal(result.modelId,'browser-chat');assert.equal(result.providerMetadata.actualProvider,'browser-upstream');
    assert.ok(windowFetch.calls.some(call=>call.href.endsWith('/models')));
    assert.ok(windowFetch.calls.some(call=>call.href.endsWith('/chat/completions')));
    const serialized=JSON.stringify({read:registry.readModel(),telemetry:telemetry.list()});
    assert.equal(serialized.includes('browser-key'),false);

    windowFetch.deny();
    await assert.rejects(
      ()=>registry.executeTask(graphTask('browser-chat-revoked'),{input:graphInput(),profileId:'profile:chat'}),
      error=>error?.code==='PROVIDER_UNAUTHORIZED'
    );
    row=registry.readResource('chat');
    assert.equal(row.state,ResourceConnectionState.UNAVAILABLE);assert.equal(row.reasonCode,'PROVIDER_UNAUTHORIZED');
    assert.equal(row.connected,false);assert.equal(row.callable,false);assert.equal(row.selectedModelQualified,false);
  }finally{windowFetch.restore();}
});

test('Wave17 native Window.fetch receiver keeps OpenRouter embeddings separate from chat transport',async()=>{
  const windowFetch=installWindowBoundFetch();
  try{
    const registry=new CoprocessorResourceConnections();
    const discovery=await registry.discoverModels({
      endpoint:'https://openrouter.ai/api/v1',apiKey:'browser-key',
      capabilities:[Capability.RETRIEVAL,Capability.EMBED],transportMode:ProviderTransportMode.EMBEDDINGS,
    });
    assert.equal(discovery.state,'READY');assert.equal(discovery.models[0].id,'browser-embed');
    registry.addResource({
      resourceId:'vector',providerProfileId:'profile:vector',providerId:'provider:vector',workerId:'worker:vector',
      kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:'https://openrouter.ai/api/v1',modelId:'browser-embed',apiKey:'browser-key',
      transportMode:ProviderTransportMode.EMBEDDINGS,capabilities:[Capability.RETRIEVAL,Capability.EMBED],
      measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC,
    });
    await registry.refreshResourceModels('vector');registry.selectResourceModel('vector','browser-embed');
    const connected=await registry.connectResource('vector');assert.equal(connected.connected,true);assert.equal(connected.transportMode,ProviderTransportMode.EMBEDDINGS);
    const tested=await registry.testResource('vector');assert.equal(tested.resource.lastTest.status,'PASS');
    const result=await registry.executeEmbedding('vector',{input:['alpha','beta']});
    assert.equal(result.vectorCount,2);assert.equal(result.dimensions,3);assert.equal(result.actualProvider,'browser-embedding-upstream');
    assert.ok(windowFetch.calls.some(call=>call.href.endsWith('/embeddings/models')));
    assert.ok(windowFetch.calls.filter(call=>call.href.endsWith('/embeddings')).length>=3);
    assert.equal(windowFetch.calls.some(call=>call.href.endsWith('/chat/completions')),false);

    windowFetch.deny();
    await assert.rejects(()=>registry.executeEmbedding('vector',{input:['credential-revoked']}),error=>error?.code==='PROVIDER_UNAUTHORIZED');
    const row=registry.readResource('vector');
    assert.equal(row.state,ResourceConnectionState.UNAVAILABLE);assert.equal(row.reasonCode,'PROVIDER_UNAUTHORIZED');
    assert.equal(row.connected,false);assert.equal(row.callable,false);assert.equal(row.selectedModelQualified,false);
  }finally{windowFetch.restore();}
});

test('Wave17 browser authorization/test failures never leave a false connected claim',async()=>{
  const windowFetch=installWindowBoundFetch();
  try{
    const registry=new CoprocessorResourceConnections();
    registry.addResource({
      resourceId:'chat',providerProfileId:'profile:chat',providerId:'provider:chat',workerId:'worker:chat',
      kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:'https://openrouter.ai/api/v1',modelId:'browser-chat',apiKey:'browser-key',
      capabilities:[Capability.GRAPH],measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC,
    });
    await registry.refreshResourceModels('chat');registry.selectResourceModel('chat','browser-chat');
    let row=await registry.connectResource('chat');assert.equal(row.connected,true);
    windowFetch.deny();
    const failed=await registry.testResource('chat');
    row=failed.resource;
    assert.equal(row.lastTest.status,'FAIL');assert.equal(row.lastTest.failureCode,'PROVIDER_UNAUTHORIZED');
    assert.equal(row.state,ResourceConnectionState.UNAVAILABLE);assert.equal(row.connected,false);assert.equal(row.callable,false);assert.equal(row.selectedModelQualified,false);
    assert.equal(row.lastFailure.code,'PROVIDER_UNAUTHORIZED');assert.equal(row.reasonCode,'PROVIDER_UNAUTHORIZED');
    const denied=await registry.discoverModels({endpoint:'https://openrouter.ai/api/v1',apiKey:'browser-key',capabilities:[Capability.GRAPH]});
    assert.equal(denied.state,'UNAUTHORIZED');assert.equal(denied.manualModelEntryAllowed,false);
  }finally{windowFetch.restore();}
});
