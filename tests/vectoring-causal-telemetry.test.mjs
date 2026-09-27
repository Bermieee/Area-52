import test from 'node:test';
import assert from 'node:assert/strict';

import {Capability,CoprocessorResourceConnections,ProviderTransportMode,ResourceKind} from '../src/coprocessor/index.js';

const selection={chatId:'chat:one',turnId:'turn:one',generationId:'gen:one',correlationId:'corr:one'};
const response=(body)=>({ok:true,status:200,headers:{get:()=>null},json:async()=>body,text:async()=>JSON.stringify(body)});

function registry(){
  const fetchImpl=async(url,init={})=>{
    if(init.method==='GET')return response({data:[]});
    if(String(url).endsWith('/embeddings'))return response({model:'openai/text-embedding-3-small',data:[{index:0,embedding:[.1,.2,.3]}]});
    throw new Error('unexpected URL');
  };
  const owner=new CoprocessorResourceConnections({fetchImpl});
  owner.addResource({resourceId:'vector',kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:'https://openrouter.ai/api/v1',modelId:'openai/text-embedding-3-small',apiKey:'secret-test-key',capabilities:[Capability.RETRIEVAL,Capability.EMBED],transportMode:ProviderTransportMode.EMBEDDINGS});
  return owner;
}

test('physical query and background indexing have distinct bounded execution identities',async()=>{
  const owner=registry();await owner.connectResource('vector');
  const query=await owner.executeEmbedding('vector',{input:'SECRET_QUERY',origin:{operation:'EMBED_QUERY',selection}});
  const index=await owner.executeEmbedding('vector',{input:'SECRET_ARTIFACT_BODY',origin:{operation:'EMBED_ARTIFACT',selection:{chatId:'chat:one'},workId:'work:one',artifactId:'artifact:one',artifactRevision:2}});
  assert.ok(query.executionId);assert.ok(index.executionId);assert.notEqual(query.executionId,index.executionId);
  const rows=owner.readResource('vector').executionHistory;
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(x=>x.operation),['EMBED_QUERY','EMBED_ARTIFACT']);
  assert.equal(rows[0].selection.generationId,'gen:one');
  assert.equal(rows[1].selection.generationId,null);
  assert.equal(rows[1].workId,'work:one');
  assert.equal(rows[0].status,'SUCCESS');assert.equal(rows[0].dimensions,3);
  const publicJson=JSON.stringify(owner.readResource('vector'));
  for(const secret of ['SECRET_QUERY','SECRET_ARTIFACT_BODY','secret-test-key','0.1,0.2,0.3'])assert.equal(publicJson.includes(secret),false);
});
