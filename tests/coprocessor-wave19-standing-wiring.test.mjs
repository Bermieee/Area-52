import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Capability,CoprocessorResourceConnections,CoprocessorTelemetry,ResourceKind,ResourceMeasurementClass,TelemetryEvent,
  createCognitiveTask,createCognitionUiReadModelReader,createCoprocessorResourceHost,createRevisionSet,
} from '../src/coprocessor/index.js';

function response(body,status=200){
  return {ok:status>=200&&status<300,status,headers:{get:()=>null},json:async()=>structuredClone(body),text:async()=>JSON.stringify(body)};
}
function graphOutput(){
  return {nodes:['story:station'],edges:[],currentStateRefs:['story:state:current'],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'Bounded current location selected.'};
}
function providerFixture(){
  const failedHosts=new Set(),calls=[];
  const fetchImpl=async(url,init={})=>{
    const href=String(url),host=new URL(href).host,method=String(init.method??'GET').toUpperCase();
    calls.push({host,method,path:new URL(href).pathname});
    const model=host.startsWith('alpha')?'alpha-model':'beta-model';
    if(method==='GET'&&href.endsWith('/models'))return response({data:[{
      id:model,name:model,canonical_slug:'fixture/'+model,context_length:65536,
      architecture:{input_modalities:['text'],output_modalities:['text']},
      supported_parameters:['structured_outputs'],top_provider:{max_completion_tokens:4096},
      pricing:{prompt:'0.000001',completion:'0.000002'},
    }]});
    if(method==='POST'&&href.endsWith('/chat/completions')){
      const body=JSON.parse(init.body??'{}');
      const system=String(body.messages?.[0]?.content??'');
      if(system.includes('Area-52 connection qualification'))return response({model:body.model,provider:'fixture-'+host,choices:[{message:{content:'{"probe":"ok"}'},finish_reason:'stop'}]});
      if(failedHosts.has(host))return response({error:{message:'forced outage'}},503);
      return response({model:body.model,provider:'fixture-'+host,choices:[{message:{content:JSON.stringify(graphOutput())},finish_reason:'stop'}],usage:{prompt_tokens:11,completion_tokens:7}});
    }
    return response({error:{message:'missing'}},404);
  };
  return {fetchImpl,calls,fail(host){failedHosts.add(host);},recover(host){failedHosts.delete(host);}};
}
function addGraphResource(registry,id,fixture){
  registry.addResource({
    resourceId:id,displayName:id,providerProfileId:'profile:'+id,providerId:'provider:'+id,workerId:'worker:'+id,
    kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:'https://'+id+'.example/v1',modelId:id+'-model',
    apiKey:id+'-session-secret',credentialRequired:false,capabilities:[Capability.GRAPH],
    maxConcurrency:1,measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC,local:false,
    costMetadata:{inputPerMillion:1,outputPerMillion:2},fetchImpl:fixture.fetchImpl,
  });
}
function graphTask(){
  const now=Date.now();
  return createCognitiveTask({
    taskId:'task:wave19',taskType:'GRAPH_WALK',turnId:'turn:wave19',correlationId:'corr:wave19',
    requiredCapabilities:[Capability.GRAPH],softDeadline:now+5000,hardDeadline:now+10000,compilerLane:'wave19',
    intentFingerprint:'intent:wave19',inputRevisionSet:createRevisionSet({sourceRevisionSet:['src@1'],worldRevision:1,sceneRevision:2,characterStateRevision:3}),
    metadata:{expectedOutputTokens:128,contractMarker:'provider-independent'},
  });
}
async function qualifyBoth(registry){
  for(const id of ['alpha','beta']){
    const discovery=await registry.refreshResourceModels(id);assert.equal(discovery.state,'READY');
    registry.selectResourceModel(id,id+'-model');
    const connected=await registry.connectResource(id);assert.equal(connected.connected,true);assert.equal(connected.qualification.qualified,true);
    assert.equal(connected.qualification.evidence.modelListed,true);assert.equal(connected.qualification.evidence.transportProbe,'PASS');
  }
}

test('Wave19 live-style discovery and qualification route interchangeable providers without changing the cognitive task contract',async()=>{
  const fixture=providerFixture(),telemetry=new CoprocessorTelemetry(),registry=new CoprocessorResourceConnections({fetchImpl:fixture.fetchImpl,telemetry});
  addGraphResource(registry,'alpha',fixture);addGraphResource(registry,'beta',fixture);await qualifyBoth(registry);
  const task=graphTask(),before=structuredClone(task);
  const first=registry.routeQualifiedProviders(task,{maxProviders:2});
  assert.equal(first.candidates.length,2);assert.equal(first.candidates[0].resourceId,'alpha');assert.deepEqual(first.taskContract,before);
  assert.equal(first.candidates[0].qualification.contextLength,65536);assert.ok(first.candidates[0].qualification.supportedParameters.includes('structured_outputs'));

  registry.profiles.setLoad('profile:alpha',1);
  const changed=registry.routeQualifiedProviders(task,{maxProviders:2});
  assert.equal(changed.candidates[0].resourceId,'beta');assert.deepEqual(changed.taskContract,first.taskContract);assert.deepEqual(task,before);
  registry.profiles.setLoad('profile:alpha',0);
});

test('Wave19 forced provider failure falls back to a second qualified resource with typed receipts and unchanged contract',async()=>{
  const fixture=providerFixture(),telemetry=new CoprocessorTelemetry(),registry=new CoprocessorResourceConnections({fetchImpl:fixture.fetchImpl,telemetry});
  addGraphResource(registry,'alpha',fixture);addGraphResource(registry,'beta',fixture);await qualifyBoth(registry);
  const task=graphTask(),contract=registry.routeQualifiedProviders(task).taskContract;
  fixture.fail('alpha.example');
  const result=await registry.executeTaskWithFallback(task,{input:{nodes:[{ref:'story:station',type:'LOCATION'}],edges:[],states:[{ref:'story:state:current',entityRef:'story:sensor',temporalStatus:'CURRENT',summary:'Current.'}],conflicts:[]},maxProviders:2});
  assert.equal(result.status,'FALLBACK');assert.equal(result.attempts.length,2);
  assert.equal(result.attempts[0].status,'FAIL');assert.equal(result.attempts[1].status,'SUCCESS');assert.equal(result.attempts[1].resourceId,'beta');
  assert.deepEqual(result.taskContract,contract);assert.equal(result.authority,'NONE');
  const snapshot=telemetry.snapshot();assert.equal(snapshot.retry,1);assert.equal(snapshot.fallback,1);
});

test('Wave19 selected-turn cognition read model separates configured, connected, physical execution and owner acceptance without leaking prompts or credentials',async()=>{
  const fixture=providerFixture(),telemetry=new CoprocessorTelemetry(),registry=new CoprocessorResourceConnections({fetchImpl:fixture.fetchImpl,telemetry});
  addGraphResource(registry,'alpha',fixture);addGraphResource(registry,'beta',fixture);await qualifyBoth(registry);
  const identity={chatId:'chat:wave19',turnId:'turn:wave19',generationId:'gen:wave19',correlationId:'corr:wave19'};
  telemetry.emit(TelemetryEvent.TASK_QUEUED,{...identity,taskId:'task:wave19',placement:'HOT',resultClass:'REQUIRED',queueMs:12,raw_prompt:'DO NOT LEAK',API_KEY:'DO NOT LEAK'});
  telemetry.emit(TelemetryEvent.TASK_STARTED,{...identity,taskId:'task:wave19',placement:'HOT',resultClass:'REQUIRED'});
  telemetry.emit(TelemetryEvent.TASK_YIELDING,{...identity,taskId:'task:wave19'});
  telemetry.emit(TelemetryEvent.TASK_PARKED,{...identity,taskId:'task:wave19'});
  telemetry.emit(TelemetryEvent.TASK_RESUMED,{...identity,taskId:'task:wave19'});
  telemetry.emit(TelemetryEvent.RETRY,{...identity,taskId:'task:wave19'});
  telemetry.emit(TelemetryEvent.FALLBACK_USED,{...identity,taskId:'task:wave19',resourceId:'beta'});
  telemetry.emit(TelemetryEvent.RESOURCE_EXECUTION,{...identity,taskId:'task:wave19',resourceId:'beta',providerProfileId:'profile:beta',providerId:'provider:beta',status:'SUCCESS',latencyMs:31});
  telemetry.emit(TelemetryEvent.RESULT_ROUTED,{...identity,taskId:'task:wave19',destination:'FOREGROUND'});
  telemetry.emit(TelemetryEvent.TASK_STARTED,{chatId:'other-chat',turnId:'other-turn',taskId:'foreign-task',placement:'DEEP',resultClass:'REQUIRED'});
  const ownerReceipt={kind:'NativeSidecarSwarmOwnerHandoffReceipt',turnId:identity.turnId,correlationId:identity.correlationId,ownerAdmissionPerformed:true,
    admissions:[{taskId:'task:wave19',resultId:'result:wave19',resourceId:'beta',providerProfileId:'profile:beta',providerId:'provider:beta',workerId:'worker:beta',acceptedByOwner:true,destination:'FOREGROUND'}],
    ownerGather:{rawPrompt:'MUST NOT LEAK'},apiKey:'MUST NOT LEAK'};
  const reader=createCognitionUiReadModelReader({telemetry,resourceConnections:registry,ownerReceipts:()=>[ownerReceipt]});
  const read=reader.read(identity);
  assert.equal(read.chatId,identity.chatId);assert.equal(read.turnId,identity.turnId);assert.equal(read.correlationId,identity.correlationId);
  assert.equal(read.tasks.some(x=>x.taskId==='foreign-task'),false);
  const task=read.tasks.find(x=>x.taskId==='task:wave19');assert.ok(task);assert.equal(task.yields,1);assert.equal(task.parks,1);assert.equal(task.resumes,1);
  assert.equal(task.retries,1);assert.equal(task.fallbacks,1);assert.equal(task.physicallyExecuted,true);assert.equal(task.ownerAccepted,true);
  const beta=read.resources.find(x=>x.resourceId==='beta');assert.ok(beta);assert.equal(beta.configured,true);assert.equal(beta.connected,true);assert.equal(beta.physicalExecutionAttempted,true);assert.equal(beta.ownerAccepted,true);
  assert.equal(read.lifecycle.configured,2);assert.equal(read.lifecycle.connected,2);assert.equal(read.lifecycle.ownerAccepted,1);
  assert.equal(read.rawPromptIncluded,false);assert.equal(read.credentialIncluded,false);
  const publicText=JSON.stringify({read,events:telemetry.list()});
  for(const secret of ['DO NOT LEAK','MUST NOT LEAK','alpha-session-secret','beta-session-secret'])assert.equal(publicText.includes(secret),false,secret);
});

test('Wave19 resource host exposes Worker3-compatible actions plus qualified route and cognition reads while native Brain remains optional-resource independent',()=>{
  const telemetry=new CoprocessorTelemetry();
  const host=createCoprocessorResourceHost({telemetry});
  for(const action of ['addResource','discoverModels','refreshModels','setCredential','clearCredential','selectModel','connectResource','disconnectResource','testResource'])
    assert.equal(typeof host.actions[action],'function',action);
  assert.equal(typeof host.read.capabilityRoute,'function');assert.equal(typeof host.read.cognition,'function');
  assert.equal(host.read.resources().nativePathRequired,true);
  const state=host.read.cognition({chatId:'chat:native',turnId:'turn:native',correlationId:'corr:native'});
  assert.equal(state.lifecycle.configured,0);assert.equal(state.lifecycle.connected,0);assert.equal(state.mutationAuthority,false);assert.equal(host.authority.finalChoice,false);
});
