import test from 'node:test';
import assert from 'node:assert/strict';
import {CapabilityProfileRegistry} from '../src/coprocessor/capability-profiles.js';
import {OpenAICompatibleProviderAdapter,ProviderAdapterRegistry} from '../src/coprocessor/provider-adapters.js';
import {SpecialistExecutionLayer} from '../src/coprocessor/provider-execution.js';
import {createSceneObservationTask,SceneObservationSpecialist} from '../src/coprocessor/scene-observation-specialist.js';
import {Capability} from '../src/coprocessor/constants.js';

function fixture({limit=16000,handler}={}){
  const profiles=new CapabilityProfileRegistry(),adapters=new ProviderAdapterRegistry(),options=[];let normalizations=0;
  profiles.register({profileId:'scene',workerId:'worker',providerId:'provider',modelId:'fixture',capabilities:[Capability.STRUCTURED_EXTRACTION],structuredOutput:true,maxOutputTokens:limit,maxContextTokens:32000,latencyClass:'LOW'});
  adapters.register({providerId:'provider',modelId:'fixture',capabilities:[Capability.STRUCTURED_EXTRACTION],invoke:async(task,input,opts)=>{
    options.push(opts);
    if(handler)return handler(task,input,opts);
    return {text:JSON.stringify({fields:{},boundarySignals:{}}),usage:{},metadata:{},startedAt:Date.now(),completedAt:Date.now(),latencyMs:0};
  }});
  return {layer:new SpecialistExecutionLayer({profiles,adapters,specialists:{SCENE_OBSERVATION:{...SceneObservationSpecialist,normalize:(...args)=>{normalizations++;return SceneObservationSpecialist.normalize(...args);}}}}),options,normalizations:()=>normalizations};
}
function task(narrative,deadline=5000){return createSceneObservationTask({chatId:'chat',turnId:'turn',generationId:'generation',correlationId:'corr',sourceRevisionId:'source@1',sceneRevision:1,narrative,foregroundBudgetMs:deadline});}
const input=narrative=>({narrative,sceneId:'scene',baseRevision:1,evidenceRef:'evidence',sourceRevisionId:'source@1'});

test('Scene output allowance grows with narrative and exceeds the final JSON estimate',async()=>{
  const f=fixture(),short='Mara enters.',long='Mara carries an object through the gallery while several people discuss their plans. '.repeat(60);
  const small=task(short),large=task(long);
  assert.ok(large.metadata.expectedOutputTokens>small.metadata.expectedOutputTokens);
  await f.layer.execute(small,{input:input(short)});await f.layer.execute(large,{input:input(long)});
  assert.ok(f.options[0].maxOutputTokens>small.metadata.expectedOutputTokens);
  assert.ok(f.options[1].maxOutputTokens>f.options[0].maxOutputTokens);
});

test('Scene adaptive allowance respects qualified provider output capacity',async()=>{
  const f=fixture({limit:1200}),narrative='Mara enters.';
  await f.layer.execute(task(narrative),{input:input(narrative)});
  assert.equal(f.options[0].maxOutputTokens,1200);
});

test('Scene foreground quorum deadline does not cancel otherwise valid provider work',async()=>{
  let resolveProvider,aborted=false;
  const f=fixture({handler:async(t,i,opts)=>{opts.signal?.addEventListener('abort',()=>{aborted=true;});return new Promise(resolve=>{resolveProvider=resolve;});}});
  const pending=f.layer.execute(task('Mara enters.',100),{input:input('Mara enters.')});
  const beforeResolve=await Promise.race([pending.then(()=> 'SETTLED',()=> 'FAILED'),new Promise(resolve=>setTimeout(()=>resolve('STILL_RUNNING'),180))]);
  assert.equal(beforeResolve,'STILL_RUNNING','foreground quorum is not the provider lifetime');
  assert.equal(aborted,false);
  resolveProvider?.({text:'{"fields":{},"boundarySignals":{}}',usage:{},metadata:{},startedAt:Date.now()-180,completedAt:Date.now(),latencyMs:180});
  const result=await pending;
  assert.equal(result.status,'SUCCESS');assert.equal(f.normalizations(),1);
  assert.equal(f.options[0].timeoutMs,undefined,'Scene execution must use the provider/resource transport timeout, not the quorum deadline');
});
import {CoprocessorResourceConnections,ResourceKind} from '../src/coprocessor/resource-connections.js';

test('provider transport timeout remains explicit and separate from Scene foreground quorum',async()=>{
  let slow=false;
  const registry=new CoprocessorResourceConnections({fetchImpl:async(url,{signal}={})=>{
    if(slow&&String(url).endsWith('/chat/completions'))return new Promise((resolve,reject)=>{
      signal?.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});
    });
    return {ok:true,status:200,headers:{get:()=>null},json:async()=>String(url).endsWith('/models')?{data:[{id:'fixture'}]}:{model:'fixture',choices:[{message:{content:'{"fields":{},"boundarySignals":{}}'},finish_reason:'stop'}],usage:{}}};
  }});
  registry.addResource({resourceId:'scene',kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:'https://fixture.invalid',modelId:'fixture',apiKey:'fixture',capabilities:[Capability.STRUCTURED_EXTRACTION],timeoutMs:80});
  await registry.connectResource('scene');slow=true;
  await assert.rejects(registry.executeTask(task('Mara enters.',20),{input:input('Mara enters.')}),{code:'PROVIDER_TIMEOUT'});
  const row=registry.listResources()[0];
  assert.notEqual(row.lastFailure?.reasonCode,'SCENE_TIME_BUDGET_EXCEEDED');
  assert.equal(row.lastExecution.generationBudget.policy,'ADAPTIVE_SCENE');
  assert.ok(row.lastExecution.generationBudget.effectiveGenerationTokens>row.lastExecution.generationBudget.estimatedFinalTokens);
});

test('Scene breadth influences the estimate and unknown workload data is not retained',()=>{
  const base={chatId:'chat',turnId:'turn',generationId:'gen',correlationId:'corr',sourceRevisionId:'source@1',sceneRevision:1,narrative:'They gather.'};
  const narrow=createSceneObservationTask(base),wide=createSceneObservationTask({...base,sceneWorkload:{cast:12,objects:8,threads:4,rawStory:'PRIVATE'}});
  assert.ok(wide.metadata.expectedOutputTokens>narrow.metadata.expectedOutputTokens);
  assert.doesNotMatch(JSON.stringify(wide.metadata),/PRIVATE/);
});

test('valid Scene completion remains usable after both former local deadline windows',async()=>{
  const originalNow=Date.now,base=originalNow();let offset=0;
  try{
    Date.now=()=>base+offset;
    const f=fixture({handler:async()=>{
      offset=12050;
      return {text:'{"fields":{},"boundarySignals":{}}',usage:{},metadata:{},startedAt:base,completedAt:base+offset,latencyMs:offset};
    }});
    const foreground=createSceneObservationTask({chatId:'chat',turnId:'turn:fg',generationId:'generation:fg',correlationId:'corr:fg',sourceRevisionId:'source@1',sceneRevision:1,narrative:'Mara enters.',foregroundBudgetMs:1200,now:base});
    const fg=await f.layer.execute(foreground,{input:input('Mara enters.')});
    assert.equal(fg.status,'SUCCESS');
    const post=createSceneObservationTask({chatId:'chat',turnId:'turn:post',generationId:'generation:post',correlationId:'corr:post',sourceRevisionId:'source@2',sceneRevision:1,narrative:'Mara enters.',phase:'POST_RESPONSE',now:base});
    const bg=await f.layer.execute(post,{input:{...input('Mara enters.'),sourceRevisionId:'source@2'}});
    assert.equal(bg.status,'SUCCESS');
    assert.equal(f.normalizations(),2);
    assert.ok(Date.now()-foreground.hardDeadline>10000,'completion is logically beyond the former 1.2s and 10s cancellation windows');
    assert.equal(post.hardDeadline,base,'DEFERRED Scene work has no fabricated ten-second foreground window');
  }finally{Date.now=originalNow;}
});


test('real OpenAI-compatible Scene request and strict response normalization agree',async()=>{
  let requestBody=null;
  const adapter=new OpenAICompatibleProviderAdapter({
    providerId:'provider:request-shape',modelId:'glm-scene-fixture',endpoint:'https://fixture.invalid',apiKey:'fixture',
    capabilities:[Capability.STRUCTURED_EXTRACTION],timeoutMs:5000,
    fetchImpl:async(url,init)=>{
      requestBody=JSON.parse(init.body);
      return{
        ok:true,status:200,headers:{get:()=> 'request-1'},
        async json(){return{
          model:'glm-scene-fixture',
          choices:[{message:{content:[{type:'text',text:'{"fields":{"location":{"value":{"location":"Glass Dome"},"confidence":0.9,"observationClass":"OBSERVED"}},"boundarySignals":{}}'}]},finish_reason:'stop'}],
          usage:{prompt_tokens:12,completion_tokens:20,total_tokens:32},
        };},
      };
    },
  });
  const cognitiveTask=task('Mira studies the sealed note.');
  const providerInput=SceneObservationSpecialist.buildInput(cognitiveTask,input('Mira studies the sealed note.'));
  const invocation=await adapter.invoke(cognitiveTask,providerInput,{maxOutputTokens:2048});
  const normalized=SceneObservationSpecialist.normalize(invocation.text);
  assert.equal(requestBody.model,'glm-scene-fixture');
  assert.equal(requestBody.max_tokens,2048);
  assert.deepEqual(requestBody.response_format,{type:'json_object'});
  assert.match(requestBody.messages[0].content,/strict JSON/i);
  assert.match(requestBody.messages[1].content,/UNTRUSTED_SCENE_EVIDENCE_JSON/);
  assert.match(requestBody.messages[1].content,/Mira studies the sealed note/);
  assert.equal(normalized.fields.location.value.location,'Glass Dome');
  assert.equal(normalized.fields.location.observationClass,'OBSERVED');
  assert.equal(invocation.metadata.requestId,'request-1');
});


test('malformed Scene JSON retains completion diagnostics without retaining response text',async()=>{
  const f=fixture({handler:async()=>({text:'PRIVATE_INVALID_OUTPUT',finishReason:'length',usage:{completion_tokens:99},metadata:{},latencyMs:1})});
  await assert.rejects(f.layer.execute(task('Mara enters.'),{input:input('Mara enters.')}),error=>{
    assert.equal(error.code,'MALFORMED_OUTPUT');
    assert.equal(error.details.responseMetadata.finishReason,'length');
    assert.equal(error.details.generationBudget.policy,'ADAPTIVE_SCENE');
    assert.doesNotMatch(JSON.stringify(error.details),/PRIVATE_INVALID_OUTPUT/);
    return true;
  });
});
