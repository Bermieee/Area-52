import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  Capability,CoprocessorResourceConnections,ProviderTransportMode,ResourceKind,ResourceMeasurementClass,
} from '../src/coprocessor/index.js';

test('Wave16 resource production modules remain browser-host portable and secret-storage-free',async()=>{
  const files=['src/coprocessor/provider-adapters.js','src/coprocessor/resource-connections.js','src/coprocessor/resource-host-adapter.js','src/coprocessor/provider-execution.js','src/coprocessor/jev-decision-core.js'];
  for(const file of files){
    const text=await fs.readFile(new URL('../'+file,import.meta.url),'utf8');
    for(const banned of ["from 'node:","from \"node:","require(","process.env","Buffer.","node:http","node:fs"])assert.equal(text.includes(banned),false,file+' contains '+banned);
    assert.doesNotMatch(text,/localStorage|sessionStorage|indexedDB/i,file+' must not persist provider credentials');
  }
});

test('Wave16 OpenAI-compatible transport works with injected fetch and browser Web APIs only',async()=>{
  const calls=[];
  const fetchImpl=async(url,init={})=>{
    calls.push({url,method:init.method??'GET',authorization:init.headers?.authorization??null});
    if(String(url).endsWith('/models'))return response({data:[{id:'browser-chat',architecture:{input_modalities:['text'],output_modalities:['text']}}]});
    if(String(url).endsWith('/chat/completions'))return response({model:'browser-chat',provider:'browser-fixture',choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}});
    throw new Error('unexpected URL '+url);
  };
  const registry=new CoprocessorResourceConnections({fetchImpl});
  registry.addResource({resourceId:'browser-remote',providerProfileId:'profile:browser-remote',providerId:'provider:browser-remote',workerId:'worker:browser-remote',
    kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:'https://example.invalid/v1',modelId:'browser-chat',apiKey:'browser-secret',credentialRequired:true,
    transportMode:ProviderTransportMode.CHAT_COMPLETIONS,capabilities:[Capability.SEMANTIC_JUDGMENT],measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC});
  const discovery=await registry.refreshResourceModels('browser-remote');assert.equal(discovery.state,'READY');
  registry.selectResourceModel('browser-remote','browser-chat');const ready=await registry.connectResource('browser-remote');
  assert.equal(ready.callable,true);assert.equal(ready.local,false);assert.equal(ready.actualModelId,'browser-chat');assert.equal(ready.actualProvider,'browser-fixture');
  assert.equal(JSON.stringify(registry.readModel()).includes('browser-secret'),false);
  assert.ok(calls.every(call=>call.authorization==='Bearer browser-secret'));
});

function response(body,status=200){return{ok:status>=200&&status<300,status,headers:{get:()=>null},json:async()=>structuredClone(body),text:async()=>JSON.stringify(body)};}
