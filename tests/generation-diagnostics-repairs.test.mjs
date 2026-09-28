import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {OpenAICompatibleProviderAdapter} from '../src/coprocessor/provider-adapters.js';

test('installed entry does not register the removed demo evidence renderer',async()=>{
  const source=await readFile(new URL('../index.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/onEvidence:\s*\(evidence\)\s*=>\s*renderEvidence/);
});

test('missing final completion publishes safe shape metadata without reasoning or bodies',async()=>{
  const adapter=new OpenAICompatibleProviderAdapter({modelId:'fixture',endpoint:'https://fixture.invalid',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:null,reasoning:'PRIVATE REASONING',tool_calls:[{function:{arguments:'PRIVATE BODY'}}]}}],usage:{prompt_tokens:12,completion_tokens:64,total_tokens:76,completion_tokens_details:{reasoning_tokens:64}}})})});
  await assert.rejects(adapter.invoke({taskType:'SCENE_OBSERVATION'},{messages:[{role:'user',content:'PRIVATE STORY'}]}),error=>{
    assert.equal(error.code,'MALFORMED_OUTPUT');
    assert.deepEqual(error.details.responseMetadata,{choiceCount:1,finishReason:'length',contentType:'null',reasoningPresent:true,toolCallCount:1,promptTokens:12,completionTokens:64,totalTokens:76,reasoningTokens:64});
    assert.doesNotMatch(JSON.stringify(error.details),/PRIVATE/);
    return true;
  });
});
import {CoprocessorResourceConnections,ResourceKind} from '../src/coprocessor/resource-connections.js';
import {createSceneObservationTask} from '../src/coprocessor/scene-observation-specialist.js';
import {Capability} from '../src/coprocessor/constants.js';

test('Sidecar failure keeps exact owner selection and safe metadata in resource diagnostics',async()=>{
  let fail=false;
  const registry=new CoprocessorResourceConnections({fetchImpl:async(url)=>({ok:true,json:async()=>String(url).endsWith('/models')?{data:[{id:'fixture'}]}:{choices:[{finish_reason:fail?'length':'stop',message:{content:fail?null:'ok',reasoning:fail?'PRIVATE':undefined}}],usage:{completion_tokens:64}}})});
  registry.addResource({resourceId:'sidecar',kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:'https://fixture.invalid',modelId:'fixture',apiKey:'fixture-key',capabilities:[Capability.STRUCTURED_EXTRACTION]});
  await registry.connectResource('sidecar');fail=true;
  const task=createSceneObservationTask({chatId:'chat',turnId:'turn',generationId:'gen',correlationId:'corr',sourceRevisionId:'source@1',sceneRevision:1});
  await assert.rejects(registry.executeTask(task,{input:{narrative:'PRIVATE STORY',sceneId:'scene',baseRevision:1,evidenceRef:'evidence',sourceRevisionId:'source@1'}}));
  const row=registry.listResources().find(row=>row.resourceId==='sidecar');
  assert.deepEqual(row.lastExecution.selection,{chatId:'chat',turnId:'turn',generationId:'gen',correlationId:'corr'});
  assert.equal(row.lastFailure.responseMetadata.finishReason,'length');
  assert.equal(row.lastExecution.responseMetadata.reasoningPresent,true);
  assert.doesNotMatch(JSON.stringify(row),/PRIVATE/);
});



