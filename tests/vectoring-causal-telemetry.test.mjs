import test from 'node:test';
import assert from 'node:assert/strict';

import {Capability,CoprocessorResourceConnections,ProviderTransportMode,ResourceKind} from '../src/coprocessor/index.js';
import {MemoryVectorIndex} from '../src/memory-vector-index.js';

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

test('Memory links query and artifact-index owner outcomes to physical execution IDs',async()=>{
  let active=true;
  const record={id:'historian:one',artifactId:'artifact:one',artifactRevision:2,representationText:'SECRET_ARTIFACT_BODY',sourceRevisionRefs:['source:one@2'],freshness:'FRESH',chatId:'chat:one'};
  const producer={historian:{records:new Map([[record.id,record]])},graph:{isSourceRevisionActive:()=>active},plasticity:{retrievable:()=>true}};
  const index=new MemoryVectorIndex({producer});
  const calls=[];
  index.attachExecutor(async request=>{
    calls.push(request);
    return{executionId:'exec:'+calls.length,embeddings:[[.1,.2,.3]],providerId:'provider:vector',actualModelId:'embedding-model',latencyMs:8};
  });
  index.enqueueArtifact({artifactId:'artifact:one',artifactRevision:2,chatId:'chat:one',sourceRevisionRefs:['source:one@2'],historianRecordRef:record.id});
  const maintenance=await index.runMaintenance({maxUnits:1});
  assert.equal(maintenance.outcomes[0].status,'ACCEPTED');assert.equal(maintenance.outcomes[0].executionId,'exec:1');
  assert.equal(calls[0].operation,'EMBED_ARTIFACT');assert.ok(calls[0].workId);assert.equal(calls[0].input,'SECRET_ARTIFACT_BODY');
  const query=await index.primeQuery({query:'SECRET_QUERY',selection});
  assert.equal(query.status,'READY');assert.equal(query.executionId,'exec:2');assert.equal(query.candidateCount,1);
  assert.equal(query.selection.generationId,'gen:one');assert.equal(calls[1].selection.turnId,'turn:one');
  const staleRecord={...record,id:'historian:two',artifactId:'artifact:two',artifactRevision:1,representationText:'SECRET_STALE_BODY',sourceRevisionRefs:['source:two@1']};
  producer.historian.records.set(staleRecord.id,staleRecord);
  index.enqueueArtifact({artifactId:'artifact:two',artifactRevision:1,chatId:'chat:one',sourceRevisionRefs:['source:two@1'],historianRecordRef:staleRecord.id});
  index.attachExecutor(async request=>{active=false;return{executionId:'exec:stale',embeddings:[[.1,.2,.3]]};});
  const stale=await index.runMaintenance({maxUnits:1});
  assert.equal(stale.outcomes[0].status,'REJECTED_LATE');assert.equal(stale.outcomes[0].executionId,'exec:stale');
  const publicJson=JSON.stringify(index.receipts);
  for(const secret of ['SECRET_QUERY','SECRET_ARTIFACT_BODY','SECRET_STALE_BODY','0.1,0.2,0.3'])assert.equal(publicJson.includes(secret),false);
});

test('failed embedding keeps an execution ID but Memory grants no owner acceptance',async()=>{
  let fail=false;
  const fetchImpl=async(url,init={})=>{
    if(init.method==='GET')return response({data:[]});
    if(fail)throw new TypeError('network unavailable');
    return response({model:'embedding-model',data:[{index:0,embedding:[.1,.2,.3]}]});
  };
  const owner=new CoprocessorResourceConnections({fetchImpl});
  owner.addResource({resourceId:'vector',kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:'https://openrouter.ai/api/v1',modelId:'embedding-model',apiKey:'test-key',capabilities:[Capability.EMBED],transportMode:ProviderTransportMode.EMBEDDINGS});
  await owner.connectResource('vector');fail=true;
  const index=new MemoryVectorIndex({producer:{historian:{records:new Map()},graph:{isSourceRevisionActive:()=>true},plasticity:{retrievable:()=>true}}});
  index.attachExecutor(async request=>owner.executeEmbedding('vector',{input:request.input,origin:{operation:request.operation,selection:request.selection}}));
  const outcome=await index.primeQuery({query:'SECRET_QUERY',selection});
  assert.equal(outcome.status,'UNAVAILABLE');assert.ok(outcome.executionId);assert.notEqual(outcome.ownerDecision,'ACCEPTED_FOR_HISTORIAN_NOMINATION');
  assert.equal(owner.readResource('vector').executionHistory.at(-1).status,'FAIL');
  assert.equal(owner.readResource('vector').executionHistory.at(-1).executionId,outcome.executionId);
});
