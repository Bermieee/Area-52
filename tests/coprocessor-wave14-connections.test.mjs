import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  Capability, CoprocessorResourceConnections, JevDecisionCore, JevDecisionShape, JevOutcome,
  ResourceConnectionState, ResourceKind, ResourceMeasurementClass, createCognitiveTask,
  createCoprocessorResourceHost, createJevDecisionRequest, createRevisionSet,
} from '../src/coprocessor/index.js';

function graphOutput(){
  return {
    nodes:['orb:station'],edges:[],currentStateRefs:['orb:state:current'],historicalRefs:[],unresolvedRefs:[],conflicts:[],
    reasoningSummary:'Current orbital observation-deck state selected from bounded refs.',
  };
}
function truthOutput(){
  return {
    assessments:[{refs:['clinic:e1'],classification:'SUPPORTED',confidence:.97,reasoningSummary:'Current clinic generator evidence is internally consistent.'}],
    ranking:[{ref:'clinic:e1',score:.96}],rejectedRefs:[],uncertaintyPreserved:true,
  };
}
function jevAbstainOutput(){
  return {
    outcome:'ABSTAINED',decisionCode:'ABSTAIN',selectedOptionIds:[],rejectedOptionIds:[],classification:null,
    reasonCodes:['INSUFFICIENT_EVIDENCE'],evidenceUsed:[],unresolvedFactors:['Both bounded alternatives retain support.'],
    confidence:0,abstained:true,escalationTarget:null,requiresOperator:false,explanation:'Evidence remains unresolved.',
  };
}

async function startProvider({mode='good',graphDelayMs=0,chatDelayMs=0}={}){
  let chatCalls=0,modelCalls=0;
  const server=http.createServer(async(req,res)=>{
    if(req.method==='GET'&&req.url==='/v1/models'){
      modelCalls++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'area52-local-model'}]}));return;
    }
    if(req.method==='POST'&&req.url==='/v1/chat/completions'){
      chatCalls++;let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw||'{}'),system=String(body.messages?.[0]?.content??'');
      const delay=system.includes('Graph Walker')?graphDelayMs:chatDelayMs;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      const content=mode==='malformed'?'not-json':system.includes('Graph Walker')?JSON.stringify(graphOutput())
        :system.includes('Truth / Precision')?JSON.stringify(truthOutput())
        :system.includes('bounded adjudication protocol')?JSON.stringify(jevAbstainOutput()):JSON.stringify({});
      res.writeHead(200,{'content-type':'application/json','x-request-id':'local-fixture-request'});
      res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:11,completion_tokens:7}}));return;
    }
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();
  return {
    baseUrl:'http://127.0.0.1:'+address.port+'/v1',
    calls:()=>({chatCalls,modelCalls}),
    close:()=>new Promise(resolve=>server.close(resolve)),
  };
}

function task({id,type,capabilities}){
  const now=Date.now();
  return createCognitiveTask({
    taskId:id,taskType:type,turnId:'turn:'+id,correlationId:'corr:'+id,requiredCapabilities:capabilities,
    softDeadline:now+3000,hardDeadline:now+5000,compilerLane:'test',intentFingerprint:'intent:'+id,
    inputRevisionSet:createRevisionSet({sourceRevisionSet:['src:'+id+'@1'],worldRevision:5,sceneRevision:7,characterStateRevision:2}),
    metadata:{expectedOutputTokens:256},
  });
}
function orbitalGraphInput(){
  return {
    nodes:[{ref:'orb:station',type:'LOCATION'}],edges:[],
    states:[{ref:'orb:state:current',entityRef:'orb:beacon',temporalStatus:'CURRENT',summary:'The survey beacon is mounted on the orbital observation deck.'}],
    conflicts:[],
  };
}
function clinicTruthInput(){
  return {
    intent:'CURRENT_STATE',
    evidence:[{ref:'clinic:e1',statement:'The riverside clinic generator is online.',semanticKey:'clinic:generator',temporalStatus:'CURRENT',authority:'OBSERVED'}],
    conflictSets:[],requiredRefs:['clinic:e1'],
  };
}
function addHttpResource(registry,endpoint,{resourceId='http-primary',profileId='a-http',providerId='http-provider',capabilities=null,timeoutMs=1000,apiKey='super-secret-token',maxConcurrency=1,costMetadata=null}={}){
  return registry.addResource({
    resourceId,providerProfileId:profileId,providerId,workerId:'slot:'+resourceId,kind:ResourceKind.OPENAI_COMPATIBLE,
    endpoint,modelId:'area52-local-model',apiKey,timeoutMs,healthTimeoutMs:500,
    capabilities:capabilities??[Capability.GRAPH,Capability.TRUTH_JUDGMENT,Capability.RERANK,Capability.SEMANTIC_JUDGMENT],
    latencyClass:'LOW',local:true,maxConcurrency,measurementClass:ResourceMeasurementClass.MEASURED_LIVE,costMetadata,
  });
}
function addLocalGraphResource(registry,{resourceId='local-backup',profileId='z-local',providerId='local-provider'}={}){
  return registry.addResource({
    resourceId,providerProfileId:profileId,providerId,workerId:'slot:'+resourceId,kind:ResourceKind.DETERMINISTIC_LOCAL,
    modelId:'deterministic-local',capabilities:[Capability.GRAPH],latencyClass:'LOW',local:true,maxConcurrency:1,
    handler:()=>graphOutput(),
  });
}
function jevRequest(id){
  const now=Date.now();
  return createJevDecisionRequest({
    decisionId:id,decisionType:'BOUNDED_STATE_AMBIGUITY',decisionShape:JevDecisionShape.CHOOSE_ONE,
    turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,
    options:[
      {optionId:'route-north',label:'North route',evidenceRefs:['ev:north']},
      {optionId:'route-south',label:'South route',evidenceRefs:['ev:south']},
    ],
    evidenceRefs:[
      {evidenceId:'ev:north',summary:'Sensor report supports the north route.'},
      {evidenceId:'ev:south',summary:'Independent log supports the south route.'},
    ],
    sourceRevisionSet:['src:'+id+'@1'],worldRevision:3,sceneRevision:4,characterStateRevision:2,domainRevisions:{world:3},
    freshnessToken:'fresh:'+id,authorityBoundary:{authorityClass:'ADVISORY',ownerId:'brain-core'},
    routing:{expectedDecisionValue:.9,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2,currentGenerationDepends:true},
    escalationPolicy:{maxRetries:1},deadline:now+5000,softDeadline:now+3000,
  });
}
function fresh(request){
  return {sourceRevisionSet:request.sourceRevisionSet,worldRevision:request.worldRevision,sceneRevision:request.sceneRevision,
    characterStateRevision:request.characterStateRevision,domainRevisions:request.domainRevisions,freshnessToken:request.freshnessToken};
}

test('no optional resource leaves the native Brain path usable and explicitly absent',()=>{
  const registry=new CoprocessorResourceConnections();
  const read=registry.readModel();
  assert.equal(read.resources.length,0);
  assert.equal(read.hasOptionalResources,false);
  assert.equal(read.readyResourceCount,0);
  assert.equal(read.nativePathRequired,true);
  assert.equal(read.truthAuthority,false);
  assert.equal(read.contextSealAuthority,false);
});

test('configured OpenAI-compatible resource probes, advertises active capabilities and executes two unrelated logical jobs',async()=>{
  const provider=await startProvider();
  try{
    const registry=new CoprocessorResourceConnections();
    addHttpResource(registry,provider.baseUrl,{costMetadata:{inputPerMillion:1,outputPerMillion:2}});
    const configured=registry.readResource('http-primary');
    assert.equal(configured.state,ResourceConnectionState.CONFIGURED);
    assert.deepEqual(configured.activeCapabilities,[]);
    assert.equal(configured.callable,false);

    const ready=await registry.connectResource('http-primary');
    assert.equal(ready.state,ResourceConnectionState.READY);
    assert.equal(ready.callable,true);
    assert.ok(ready.activeCapabilities.includes(Capability.GRAPH));
    assert.ok(ready.activeCapabilities.includes(Capability.TRUTH_JUDGMENT));
    assert.equal(ready.lastHealthResult,'PASS');
    assert.equal(ready.credentialConfigured,true);
    assert.equal(JSON.stringify(ready).includes('super-secret-token'),false);

    const graph=await registry.executeTask(task({id:'orbital-graph',type:'GRAPH_WALK',capabilities:[Capability.GRAPH]}),{input:orbitalGraphInput()});
    assert.equal(graph.providerId,'http-provider');
    assert.deepEqual(graph.payload.currentStateRefs,['orb:state:current']);
    assert.equal(graph.providerMetadata.measurementClass,ResourceMeasurementClass.MEASURED_LIVE);
    assert.equal(graph.providerMetadata.usageReceipt.cost.status,'MEASURED');

    const truth=await registry.executeTask(task({id:'clinic-truth',type:'TRUTH_PRECISION',capabilities:[Capability.TRUTH_JUDGMENT,Capability.RERANK]}),{input:clinicTruthInput()});
    assert.equal(truth.providerId,'http-provider');
    assert.equal(truth.payload.assessments[0].classification,'SUPPORTED');
    assert.ok(provider.calls().chatCalls>=2);
    assert.ok(provider.calls().modelCalls>=1);
  }finally{await provider.close();}
});

test('one physical resource serves multiple jobs, and a second resource is used only when capacity makes it useful',async()=>{
  const provider=await startProvider({graphDelayMs:120});
  try{
    const registry=new CoprocessorResourceConnections();
    addHttpResource(registry,provider.baseUrl,{capabilities:[Capability.GRAPH],maxConcurrency:1});
    addLocalGraphResource(registry);
    await registry.connectResource('http-primary');
    await registry.connectResource('local-backup');

    const firstTask=task({id:'capacity-first',type:'GRAPH_WALK',capabilities:[Capability.GRAPH]});
    const secondTask=task({id:'capacity-second',type:'GRAPH_WALK',capabilities:[Capability.GRAPH]});
    const first=registry.executeTask(firstTask,{input:orbitalGraphInput()});
    await new Promise(resolve=>setTimeout(resolve,15));
    const second=await registry.executeTask(secondTask,{input:orbitalGraphInput()});
    const firstResult=await first;

    assert.equal(firstResult.providerId,'http-provider');
    assert.equal(second.providerId,'local-provider');
    assert.equal(registry.readResource('http-primary').maxConcurrency,1);
    assert.equal(registry.readResource('http-primary').activeExecutions,0);
    assert.equal(registry.readResource('local-backup').state,ResourceConnectionState.READY);
  }finally{await provider.close();}
});

test('malformed provider output is rejected and bounded fallback may use a second connected resource',async()=>{
  const bad=await startProvider({mode:'malformed'});
  try{
    const registry=new CoprocessorResourceConnections();
    addHttpResource(registry,bad.baseUrl,{resourceId:'bad-http',profileId:'a-bad',providerId:'bad-provider',capabilities:[Capability.GRAPH]});
    addLocalGraphResource(registry,{resourceId:'good-local',profileId:'z-good',providerId:'good-provider'});
    await registry.connectResource('bad-http');await registry.connectResource('good-local');
    const report=await registry.executeTaskWithFallback(task({id:'fallback-graph',type:'GRAPH_WALK',capabilities:[Capability.GRAPH]}),{input:orbitalGraphInput(),maxProviders:2});
    assert.equal(report.status,'FALLBACK');
    assert.equal(report.attempts.length,2);
    assert.equal(report.attempts[0].failureCode,'MALFORMED_OUTPUT');
    assert.equal(report.attempts[1].status,'SUCCESS');
    assert.equal(report.result.providerId,'good-provider');
    assert.notEqual(registry.readResource('bad-http').state,ResourceConnectionState.READY);
  }finally{await bad.close();}
});

test('unreachable endpoint, timeout and explicit disconnect produce typed visible outcomes',async()=>{
  const dead=await startProvider();const deadUrl=dead.baseUrl;await dead.close();
  const registry=new CoprocessorResourceConnections();
  addHttpResource(registry,deadUrl,{resourceId:'unreachable',profileId:'a-unreachable',providerId:'unreachable-provider',capabilities:[Capability.GRAPH],timeoutMs:80});
  const unreachable=await registry.connectResource('unreachable');
  assert.equal(unreachable.state,ResourceConnectionState.UNAVAILABLE);
  assert.equal(unreachable.lastHealthResult,'FAIL');
  assert.ok(['PROVIDER_UNAVAILABLE','PROVIDER_TIMEOUT'].includes(unreachable.lastFailure.code));

  const slow=await startProvider({graphDelayMs:160});
  try{
    addHttpResource(registry,slow.baseUrl,{resourceId:'slow',profileId:'b-slow',providerId:'slow-provider',capabilities:[Capability.GRAPH],timeoutMs:30});
    await registry.connectResource('slow');
    const timed=await registry.executeTaskWithFallback(task({id:'timeout-graph',type:'GRAPH_WALK',capabilities:[Capability.GRAPH]}),{input:orbitalGraphInput(),maxProviders:1});
    assert.equal(timed.status,'FAILED');
    assert.equal(timed.failure.code,'PROVIDER_TIMEOUT');
    assert.equal(registry.readResource('slow').lastExecution.failureCode,'PROVIDER_TIMEOUT');

    const slow2=await startProvider({graphDelayMs:300});
    try{
      addHttpResource(registry,slow2.baseUrl,{resourceId:'disconnecting',profileId:'c-disconnect',providerId:'disconnect-provider',capabilities:[Capability.GRAPH],timeoutMs:2000});
      await registry.connectResource('disconnecting');
      const running=registry.executeTask(task({id:'disconnect-graph',type:'GRAPH_WALK',capabilities:[Capability.GRAPH]}),{input:orbitalGraphInput(),profileId:'c-disconnect'});
      await new Promise(resolve=>setTimeout(resolve,20));
      const disconnected=registry.disconnectResource('disconnecting');
      assert.equal(disconnected.state,ResourceConnectionState.DISCONNECTED);
      await assert.rejects(running,error=>error?.code==='PROVIDER_ABORTED');
      assert.equal(registry.readResource('disconnecting').state,ResourceConnectionState.DISCONNECTED);
    }finally{await slow2.close();}
  }finally{await slow.close();}
});

test('Jev skips a clear deterministic case, invokes bounded ambiguity, may abstain, and cannot reopen a sealed generation',async()=>{
  const provider=await startProvider();
  try{
    const registry=new CoprocessorResourceConnections();
    addHttpResource(registry,provider.baseUrl,{capabilities:[Capability.SEMANTIC_JUDGMENT]});
    await registry.connectResource('http-primary');
    const core=new JevDecisionCore({providerExecutor:registry.createJevProviderExecutor()});

    const clear=jevRequest('clear-route');
    const before=provider.calls().chatCalls;
    const clearReceipt=await core.decide(clear,{currentRevisionState:fresh(clear),deterministicAnswer:{
      outcome:JevOutcome.DECIDED,decisionCode:JevDecisionShape.CHOOSE_ONE,selectedOptionIds:['route-north'],rejectedOptionIds:['route-south'],
      evidenceUsed:['ev:north'],confidence:1,
    }});
    assert.equal(clearReceipt.serviceStatus,'JEV_SKIPPED');
    assert.equal(provider.calls().chatCalls,before);

    const ambiguous=jevRequest('ambiguous-route');
    const abstained=await core.decide(ambiguous,{currentRevisionState:fresh(ambiguous)});
    assert.equal(abstained.outcome,JevOutcome.ABSTAINED);
    assert.equal(abstained.abstained,true);
    assert.equal(abstained.authorityGranted,false);
    assert.equal(abstained.canonicalMutation,false);

    const lateRequest=jevRequest('late-route');
    const late=await core.decide(lateRequest,{currentRevisionState:fresh(lateRequest),sealed:true});
    assert.equal(late.admission.late,true);
    assert.equal(late.admission.foregroundEligible,false);
    assert.equal(late.authorityGranted,false);
    assert.equal(late.settlementPerformed,false);
  }finally{await provider.close();}
});

test('host adapter exposes stable actions/reads without UI ownership or secret leakage',async()=>{
  const provider=await startProvider();
  try{
    const host=createCoprocessorResourceHost();
    assert.throws(()=>host.actions.addResource({
      resourceId:'unsafe-url',providerProfileId:'unsafe-profile',providerId:'unsafe-provider',workerId:'unsafe-worker',kind:ResourceKind.OPENAI_COMPATIBLE,
      endpoint:provider.baseUrl+'?secret=query-secret',modelId:'area52-local-model',apiKey:'host-secret',capabilities:[Capability.GRAPH],local:true,
    }),/must not contain credentials, query parameters, or fragments/);
    host.actions.addResource({
      resourceId:'ui-resource',providerProfileId:'ui-profile',providerId:'ui-provider',workerId:'ui-worker',kind:ResourceKind.OPENAI_COMPATIBLE,
      endpoint:provider.baseUrl,modelId:'area52-local-model',apiKey:'host-secret',capabilities:[Capability.GRAPH],local:true,
    });
    const events=[];const release=host.subscribe(event=>events.push(event.type));
    await host.actions.connectResource('ui-resource');
    const model=host.read.resources(),resource=host.read.resource('ui-resource');
    release();
    assert.equal(typeof host.actions.testResource,'function');
    assert.equal(typeof host.actions.disconnectResource,'function');
    assert.equal(typeof host.execution.executeTaskWithFallback,'function');
    assert.equal(model.readyResourceCount,1);
    assert.equal(resource.endpoint.includes('secret='),false);
    assert.equal(JSON.stringify(model).includes('host-secret'),false);
    assert.equal(host.authority.finalChoice,false);
    assert.equal(host.authority.contextSeal,false);
    assert.ok(events.includes('RESOURCE_READY'));
  }finally{await provider.close();}
});
