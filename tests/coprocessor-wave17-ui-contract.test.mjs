import test from 'node:test';
import assert from 'node:assert/strict';

import {Capability,createCoprocessorResourceHost} from '../src/coprocessor/index.js';
import {Wave13ResourceControlAdapter} from '../src/ui-core/wave13-operator-adapters.js';

function response(body,status=200){
  return{ok:status>=200&&status<300,status,headers:{get:()=>null},json:async()=>structuredClone(body),text:async()=>JSON.stringify(body)};
}
function createProvider(){
  const calls=[];let denied=false;
  const fetchImpl=async(url,init={})=>{
    const href=String(url),method=String(init.method??'GET').toUpperCase();
    const headers=init.headers??{},authorization=headers.authorization??headers.Authorization??null;
    calls.push({href,method,authorizationConfigured:Boolean(authorization)});
    if(denied||authorization!=='Bearer ui-session-key')return response({error:{message:'unauthorized'}},401);
    if(method==='GET'&&href.endsWith('/embeddings/models'))return response({data:[{id:'ui-embed',name:'UI Embed',architecture:{input_modalities:['text'],output_modalities:['embeddings']}}]});
    if(method==='GET'&&href.endsWith('/models'))return response({data:[{id:'ui-chat',name:'UI Chat',architecture:{input_modalities:['text'],output_modalities:['text']}}]});
    if(method==='POST'&&href.endsWith('/chat/completions')){
      const body=JSON.parse(init.body??'{}');
      return response({model:body.model,provider:'ui-upstream',choices:[{message:{content:'{"probe":"ok"}'},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:2}});
    }
    if(method==='POST'&&href.endsWith('/embeddings')){
      const body=JSON.parse(init.body??'{}'),values=Array.isArray(body.input)?body.input:[body.input];
      return response({model:body.model,provider:'ui-vector-upstream',data:values.map((_,i)=>({index:i,embedding:[.1+i,.2+i,.3+i]})),usage:{prompt_tokens:3,total_tokens:3}});
    }
    return response({error:{message:'missing'}},404);
  };
  return{fetchImpl,calls,deny(){denied=true;},allow(){denied=false;}};
}

test('Wave17 current Worker3 resource adapter consumes real Worker2 discovery/connect/test contract',async()=>{
  const provider=createProvider(),host=createCoprocessorResourceHost({fetchImpl:provider.fetchImpl});
  const ui=new Wave13ResourceControlAdapter({bindings:{resourceHost:host}});
  assert.equal(ui.capabilities().discoverModels,true);

  const discovered=await ui.discoverModels({
    role:'JEV',endpoint:'https://openrouter.ai/api/v1',apiKey:'ui-session-key',capabilities:[Capability.SEMANTIC_JUDGMENT],
  });
  assert.equal(discovered.state,'READY');assert.equal(discovered.models[0].id,'ui-chat');assert.equal(discovered.local,false);

  const connected=await ui.connect({
    role:'JEV',displayName:'Primary Jev',transportKind:'OPENAI_COMPATIBLE',endpoint:'https://openrouter.ai/api/v1',
    modelId:'ui-chat',apiKey:'ui-session-key',capabilities:[Capability.SEMANTIC_JUDGMENT],local:false,
  });
  assert.equal(connected.state,'READY');assert.equal(connected.connected,true);assert.equal(connected.callable,true);
  const read=ui.read(),row=read.data.resources.find(x=>x.displayName==='Primary Jev');
  assert.ok(row);assert.equal(row.connected,true);assert.equal(row.callable,true);assert.equal(row.credentialConfigured,true);assert.equal(row.local,false);

  const tested=await ui.test(row);
  assert.equal(tested.resource.lastTest.status,'PASS');
  const publicText=JSON.stringify({read:ui.read(),lastAction:ui.lastAction,calls:provider.calls});
  assert.equal(publicText.includes('ui-session-key'),false);
});

test('Wave17 current Worker3 vector flow selects real embeddings transport and denied discovery stays unconnected',async()=>{
  const provider=createProvider(),host=createCoprocessorResourceHost({fetchImpl:provider.fetchImpl});
  const ui=new Wave13ResourceControlAdapter({bindings:{resourceHost:host}});

  const models=await ui.discoverModels({
    role:'VECTORING',endpoint:'https://openrouter.ai/api/v1',apiKey:'ui-session-key',capabilities:[Capability.RETRIEVAL,Capability.EMBED],
  });
  assert.equal(models.state,'READY');assert.equal(models.models[0].id,'ui-embed');

  const connected=await ui.connect({
    role:'VECTORING',displayName:'Primary Vectoring',transportKind:'OPENAI_COMPATIBLE',endpoint:'https://openrouter.ai/api/v1',
    modelId:'ui-embed',apiKey:'ui-session-key',capabilities:[Capability.RETRIEVAL,Capability.EMBED],local:false,
  });
  assert.equal(connected.transportMode,'EMBEDDINGS');assert.equal(connected.connected,true);assert.deepEqual(connected.activeCapabilities,[Capability.EMBED]);
  const row=ui.read().data.resources.find(x=>x.displayName==='Primary Vectoring');assert.ok(row);assert.equal(row.connected,true);
  const tested=await ui.test(row);assert.equal(tested.resource.lastTest.status,'PASS');
  assert.equal(provider.calls.some(x=>x.href.endsWith('/chat/completions')),false);
  assert.ok(provider.calls.some(x=>x.href.endsWith('/embeddings/models')));assert.ok(provider.calls.some(x=>x.href.endsWith('/embeddings')));

  provider.deny();
  const denied=await ui.discoverModels({
    role:'SIDECAR',endpoint:'https://openrouter.ai/api/v1',apiKey:'ui-session-key',capabilities:[Capability.STRUCTURED_EXTRACTION],
  });
  assert.equal(denied.state,'UNAUTHORIZED');assert.equal(denied.manualModelEntryAllowed,false);
  assert.equal(ui.read().data.resources.some(x=>x.displayName==='Primary Sidecar'&&x.connected),false);
});
