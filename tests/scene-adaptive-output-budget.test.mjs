import test from 'node:test';
import assert from 'node:assert/strict';
import {CapabilityProfileRegistry} from '../src/coprocessor/capability-profiles.js';
import {ProviderAdapterRegistry} from '../src/coprocessor/provider-adapters.js';
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

test('Scene deadline stops waiting for a provider even when it ignores abort',async()=>{
  let resolveProvider,aborted=false;
  const f=fixture({handler:async(t,i,opts)=>{opts.signal?.addEventListener('abort',()=>{aborted=true;});return new Promise(resolve=>{resolveProvider=resolve;});}});
  const started=Date.now(),pending=f.layer.execute(task('Mara enters.',100),{input:input('Mara enters.')});
  const result=await Promise.race([pending.then(()=>null,e=>e),new Promise(resolve=>setTimeout(()=>resolve('UNBOUNDED_WAIT'),400))]);
  resolveProvider?.({text:'{"fields":{},"boundarySignals":{}}',usage:{},metadata:{}});
  assert.equal(result?.code,'PROVIDER_TIMEOUT');assert.equal(aborted,true);assert.ok(Date.now()-started<400);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.normalizations(),0,'late provider payload must never enter normalization/admission');
});
import {CoprocessorResourceConnections,ResourceKind} from '../src/coprocessor/resource-connections.js';

test('local Scene time budget does not put a qualified provider into cooldown',async()=>{
  let slow=false;
  const registry=new CoprocessorResourceConnections({fetchImpl:async(url)=>{
    if(slow&&String(url).endsWith('/chat/completions'))return new Promise(()=>{});
    return {ok:true,json:async()=>String(url).endsWith('/models')?{data:[{id:'fixture'}]}:{choices:[{message:{content:'ok'}}]}};
  }});
  registry.addResource({resourceId:'scene',kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:'https://fixture.invalid',modelId:'fixture',apiKey:'fixture',capabilities:[Capability.STRUCTURED_EXTRACTION]});
  await registry.connectResource('scene');slow=true;
  await assert.rejects(registry.executeTask(task('Mara enters.',100),{input:input('Mara enters.')}),{code:'PROVIDER_TIMEOUT'});
  const row=registry.listResources()[0];
  assert.equal(row.callable,true);assert.equal(row.health,'HEALTHY');
  assert.equal(row.lastFailure.reasonCode,'SCENE_TIME_BUDGET_EXCEEDED');
  assert.equal(row.lastExecution.generationBudget.policy,'ADAPTIVE_SCENE');assert.ok(row.lastExecution.generationBudget.effectiveGenerationTokens>row.lastExecution.generationBudget.estimatedFinalTokens);
});

test('Scene breadth influences the estimate and unknown workload data is not retained',()=>{
  const base={chatId:'chat',turnId:'turn',generationId:'gen',correlationId:'corr',sourceRevisionId:'source@1',sceneRevision:1,narrative:'They gather.'};
  const narrow=createSceneObservationTask(base),wide=createSceneObservationTask({...base,sceneWorkload:{cast:12,objects:8,threads:4,rawStory:'PRIVATE'}});
  assert.ok(wide.metadata.expectedOutputTokens>narrow.metadata.expectedOutputTokens);
  assert.doesNotMatch(JSON.stringify(wide.metadata),/PRIVATE/);
});

test('Scene response cannot beat an expired deadline merely because its timer was delayed',async()=>{
  const originalNow=Date.now;let offset=0;
  try{
    Date.now=()=>originalNow()+offset;
    const f=fixture({handler:async()=>{offset=1000;return {text:'{"fields":{},"boundarySignals":{}}',usage:{},metadata:{}};}});
    await assert.rejects(f.layer.execute(task('Mara enters.',100),{input:input('Mara enters.')}),{code:'PROVIDER_TIMEOUT'});
    assert.equal(f.normalizations(),0);
  }finally{Date.now=originalNow;}
});
