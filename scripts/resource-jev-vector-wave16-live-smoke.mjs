import {
  Capability,CoprocessorResourceConnections,JevDecisionCore,JevDecisionShape,ProviderTransportMode,
  ResourceKind,ResourceMeasurementClass,createCognitiveTask,createJevDecisionRequest,createRevisionSet,
} from '../src/coprocessor/index.js';

const apiKey=process.env.AREA52_OPENROUTER_API_KEY??null;
const baseUrl=process.env.AREA52_OPENROUTER_BASE_URL??'https://openrouter.ai/api/v1';
const jevModel=process.env.AREA52_JEV_MODEL??null;
const sidecarModel=process.env.AREA52_SIDECAR_MODEL??jevModel;
const vectorModel=process.env.AREA52_VECTOR_MODEL??null;

if(!apiKey||!jevModel||!sidecarModel||!vectorModel){
  console.log(JSON.stringify({
    status:'SKIPPED',measurementClass:'MEASURED_LIVE',
    reason:'Set AREA52_OPENROUTER_API_KEY, AREA52_JEV_MODEL, AREA52_SIDECAR_MODEL and AREA52_VECTOR_MODEL in the operator environment.',
    realProviderCallObserved:false,ft005LivePass:false,jevLivePass:false,vectorLivePass:false,
    credentialsLogged:false,credentialStorage:'SESSION_MEMORY_ONLY',
  },null,2));
  process.exit(0);
}

const registry=new CoprocessorResourceConnections();
const ids={sidecar:'live-sidecar',jev:'live-jev',vector:'live-vector'};
const report={status:'FAILED',measurementClass:'MEASURED_LIVE',realProviderCallObserved:false,ft005LivePass:false,jevLivePass:false,vectorLivePass:false,
  credentialsLogged:false,credentialStorage:'SESSION_MEMORY_ONLY',baseUrl:safeEndpoint(baseUrl),resources:{},execution:{},authority:{truth:false,precision:false,settlement:false,canonicalMutation:false,finalChoice:false,contextSeal:false}};

try{
  addChat(ids.sidecar,sidecarModel,[Capability.GRAPH]);
  addChat(ids.jev,jevModel,[Capability.SEMANTIC_JUDGMENT]);
  registry.addResource({resourceId:ids.vector,displayName:'Live Vectoring',providerProfileId:'profile:'+ids.vector,providerId:'provider:'+ids.vector,workerId:'worker:'+ids.vector,
    kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:baseUrl,modelId:vectorModel,credentialRequired:true,transportMode:ProviderTransportMode.EMBEDDINGS,
    capabilities:[Capability.RETRIEVAL,Capability.EMBED],measurementClass:ResourceMeasurementClass.MEASURED_LIVE,maxConcurrency:1,local:false});

  for(const id of Object.values(ids))registry.setResourceCredential(id,apiKey);
  for(const id of Object.values(ids)){
    const discovery=await registry.refreshResourceModels(id);
    if(discovery.state==='READY'){
      if(!discovery.models.some(model=>model.id===registry.readResource(id).modelId))throw fail('MODEL_UNAVAILABLE',id+' selected model was not returned by provider discovery');
      registry.selectResourceModel(id,registry.readResource(id).modelId);
    }else if(discovery.state==='UNSUPPORTED'){
      registry.selectResourceModel(id,registry.readResource(id).modelId);
    }else throw fail('MODEL_DISCOVERY_'+discovery.state,id+' discovery did not yield a usable model state');
    const connected=await registry.connectResource(id);if(!connected.callable)throw fail(connected.lastFailure?.code??'CONNECT_FAILED',id+' did not qualify as callable');
    const tested=await registry.testResource(id);if(tested.resource.lastTest?.status!=='PASS')throw fail(tested.failure?.code??'TEST_FAILED',id+' authenticated test failed');
    report.resources[id]=safeResource(tested.resource);
  }

  const graph=await registry.executeTask(graphTask(),{input:graphInput(),profileId:'profile:'+ids.sidecar});
  report.execution.sidecar={
    resourceId:ids.sidecar,providerProfileId:'profile:'+ids.sidecar,providerId:graph.providerId,workerId:graph.workerId,actualModelId:graph.modelId,
    actualProvider:graph.providerMetadata?.actualProvider??null,latencyMs:graph.latency,usageReceipt:graph.providerMetadata?.usageReceipt??null,
    reachedOwnerStage:true,measurementClass:graph.providerMetadata?.measurementClass??null,
  };
  report.ft005LivePass=graph.providerMetadata?.measurementClass==='MEASURED_LIVE';

  const embeddings=await registry.executeEmbedding(ids.vector,{input:['Area-52 live vector qualification passage.']});
  report.execution.vector={
    resourceId:ids.vector,providerProfileId:embeddings.providerProfileId,providerId:embeddings.providerId,workerId:embeddings.workerId,
    actualModelId:embeddings.actualModelId,actualProvider:embeddings.actualProvider,latencyMs:embeddings.latencyMs,usageReceipt:embeddings.usageReceipt,
    vectorCount:embeddings.vectorCount,dimensions:embeddings.dimensions,reachedOwnerStage:true,measurementClass:embeddings.measurementClass,
  };
  report.vectorLivePass=embeddings.measurementClass==='MEASURED_LIVE'&&embeddings.vectorCount===1&&embeddings.dimensions>0;

  const core=new JevDecisionCore({providerExecutor:registry.createJevProviderExecutor()});
  const clear=request('live-clear',{single:true});const before=core.metricsSnapshot();
  const clearReceipt=await core.decide(clear,{currentRevisionState:fresh(clear)});
  const afterClear=core.metricsSnapshot();
  const ambiguous=request('live-ambiguous');const jevReceipt=await core.decide(ambiguous,{currentRevisionState:fresh(ambiguous)});
  const afterJev=core.metricsSnapshot();
  report.execution.jev={
    resourceId:jevReceipt.providerProvenance?.resourceId??ids.jev,providerProfileId:jevReceipt.providerProvenance?.providerProfileId??null,
    providerId:jevReceipt.providerProvenance?.providerId??null,workerId:jevReceipt.providerProvenance?.workerId??null,
    requestedModelId:jevReceipt.providerProvenance?.requestedModelId??jevModel,actualModelId:jevReceipt.providerProvenance?.modelId??null,
    actualProvider:jevReceipt.providerProvenance?.actualProvider??null,serviceStatus:jevReceipt.serviceStatus,outcome:jevReceipt.outcome,
    latency:jevReceipt.latencyMetadata,usageReceipt:jevReceipt.providerProvenance?.usageReceipt??null,authorityGranted:jevReceipt.authorityGranted,
    settlementPerformed:jevReceipt.settlementPerformed,reachedOwnerStage:true,measurementClass:jevReceipt.providerProvenance?.measurementClass??null,
    clearCase:{serviceStatus:clearReceipt.serviceStatus,providerCalls:afterClear.providerCalls-before.providerCalls},
  };
  report.jevLivePass=afterJev.providerCalls-afterClear.providerCalls>=1
    && jevReceipt.providerProvenance?.measurementClass==='MEASURED_LIVE'
    && !['JEV_INVALID','JEV_UNAVAILABLE','JEV_STALE'].includes(jevReceipt.serviceStatus)
    && jevReceipt.authorityGranted===false&&jevReceipt.settlementPerformed===false;

  report.realProviderCallObserved=Boolean(report.ft005LivePass&&report.vectorLivePass&&report.jevLivePass);
  report.status=report.realProviderCallObserved?'PASS':'FAILED';
}catch(error){
  report.failure={code:String(error?.code??'WAVE16_LIVE_FAILURE'),message:redact(error?.message??String(error))};
}finally{
  for(const id of Object.values(ids)){try{if(registry.resources.has(id))registry.disconnectResource(id);}catch{}}
}

console.log(JSON.stringify(report,null,2));
if(report.status!=='PASS')process.exitCode=1;

function addChat(id,modelId,capabilities){
  registry.addResource({resourceId:id,displayName:id===ids.jev?'Live Jev':'Live Sidecar',providerProfileId:'profile:'+id,providerId:'provider:'+id,workerId:'worker:'+id,
    kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:baseUrl,modelId,credentialRequired:true,transportMode:ProviderTransportMode.CHAT_COMPLETIONS,
    capabilities,measurementClass:ResourceMeasurementClass.MEASURED_LIVE,maxConcurrency:1,local:false});
}
function graphTask(){
  const now=Date.now();return createCognitiveTask({taskId:'live:graph',taskType:'GRAPH_WALK',turnId:'turn:live-wave16',correlationId:'corr:live-wave16',
    requiredCapabilities:[Capability.GRAPH],softDeadline:now+20000,hardDeadline:now+30000,compilerLane:'wave16-live',intentFingerprint:'intent:live-graph',
    inputRevisionSet:createRevisionSet({sourceRevisionSet:['live-source@1'],worldRevision:1,sceneRevision:1,characterStateRevision:1}),metadata:{expectedOutputTokens:256}});
}
function graphInput(){return{nodes:[{ref:'live:station',type:'LOCATION'}],edges:[],states:[{ref:'live:state',entityRef:'live:sensor',temporalStatus:'CURRENT',summary:'The field sensor is mounted beside the station console.'}],conflicts:[]};}
function request(id,{single=false}={}){
  const now=Date.now();const evidence=[{evidenceId:'ev:a',summary:'Bounded evidence A supports option A.'},{evidenceId:'ev:b',summary:'Bounded evidence B independently supports option B.'}];
  const options=single?[{optionId:'option-a',label:'Option A',evidenceRefs:['ev:a']}]:[{optionId:'option-a',label:'Option A',evidenceRefs:['ev:a']},{optionId:'option-b',label:'Option B',evidenceRefs:['ev:b']}];
  return createJevDecisionRequest({decisionId:id,decisionType:'GENERIC_BOUNDED_AMBIGUITY',decisionShape:JevDecisionShape.CHOOSE_ONE,turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,
    options,evidenceRefs:evidence,sourceRevisionSet:['live-source@1'],worldRevision:1,sceneRevision:1,characterStateRevision:1,domainRevisions:{generic:1},freshnessToken:'fresh:'+id,
    authorityBoundary:{authorityClass:'ADVISORY',ownerId:'brain-core'},routing:{expectedDecisionValue:.9,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2,currentGenerationDepends:true},
    escalationPolicy:{maxRetries:1},deadline:now+30000,softDeadline:now+20000});
}
function fresh(r){return{sourceRevisionSet:r.sourceRevisionSet,worldRevision:r.worldRevision,sceneRevision:r.sceneRevision,characterStateRevision:r.characterStateRevision,domainRevisions:r.domainRevisions,freshnessToken:r.freshnessToken};}
function safeResource(row){return{resourceId:row.resourceId,displayName:row.displayName,state:row.state,providerProfileId:row.providerProfileId,providerId:row.providerId,modelId:row.modelId,actualModelId:row.actualModelId,
  actualProvider:row.actualProvider,transportMode:row.transportMode,providerIdentity:row.providerIdentity,local:row.local,activeCapabilities:row.activeCapabilities,
  measurementClass:row.measurementClass,lastHealthLatencyMs:row.lastHealthLatencyMs,lastTest:row.lastTest,credentialConfigured:row.credentialConfigured,credentialStorage:row.credentialStorage,selectedModelQualified:row.selectedModelQualified};}
function safeEndpoint(value){try{const url=new URL(value);return url.protocol+'//'+url.host+url.pathname.replace(/\/$/,'');}catch{return null;}}
function redact(value){return String(value??'').replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED]').replace(/api[_-]?key\s*[:=]\s*[^\s,;]+/gi,'apiKey=[REDACTED]').slice(0,600);}
function fail(code,message){const error=new Error(message);error.code=code;return error;}
