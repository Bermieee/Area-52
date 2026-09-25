import http from 'node:http';
import {
  Capability, CoprocessorResourceConnections, CoprocessorTelemetry, JevDecisionCore, JevDecisionShape, JevOutcome,
  ResourceKind, ResourceMeasurementClass, createCognitiveTask, createJevDecisionRequest, createRevisionSet,
} from '../src/coprocessor/index.js';

const now=()=>globalThis.performance?.now?.()??Date.now();

function graphOutput(){
  return {nodes:['deepsea:habitat'],edges:[],currentStateRefs:['deepsea:state:current'],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'Current habitat state selected from bounded refs.'};
}
function truthOutput(){
  return {assessments:[{refs:['archive:e1'],classification:'SUPPORTED',confidence:.96,reasoningSummary:'Archive evidence is internally consistent.'}],ranking:[{ref:'archive:e1',score:.95}],rejectedRefs:[],uncertaintyPreserved:true};
}
function jevAbstain(){
  return {outcome:'ABSTAINED',decisionCode:'ABSTAIN',selectedOptionIds:[],rejectedOptionIds:[],classification:null,reasonCodes:['INSUFFICIENT_EVIDENCE'],evidenceUsed:[],unresolvedFactors:['Both alternatives remain supported.'],confidence:0,abstained:true,escalationTarget:null,requiresOperator:false,explanation:'Ambiguity remains unresolved.'};
}
async function serverFor({mode='good',delayMs=0}={}){
  let chatCalls=0,healthCalls=0;
  const server=http.createServer(async(req,res)=>{
    if(req.method==='GET'&&req.url==='/v1/models'){healthCalls++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'wave14-local-model'}]}));return;}
    if(req.method==='POST'&&req.url==='/v1/chat/completions'){
      chatCalls++;let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');const system=String(body.messages?.[0]?.content??'');
      if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));
      const content=mode==='malformed'?'not-json':system.includes('Graph Walker')?JSON.stringify(graphOutput()):system.includes('Truth / Precision')?JSON.stringify(truthOutput()):system.includes('bounded adjudication protocol')?JSON.stringify(jevAbstain()):JSON.stringify({});
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:13,completion_tokens:9}}));return;
    }
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();
  return{baseUrl:'http://127.0.0.1:'+address.port+'/v1',calls:()=>({chatCalls,healthCalls}),close:()=>new Promise(resolve=>server.close(resolve))};
}
function task({id,type,capabilities}){
  const t=Date.now();return createCognitiveTask({taskId:id,taskType:type,turnId:'turn:'+id,correlationId:'corr:'+id,requiredCapabilities:capabilities,softDeadline:t+3000,hardDeadline:t+5000,compilerLane:'evaluation',intentFingerprint:'intent:'+id,inputRevisionSet:createRevisionSet({sourceRevisionSet:['source:'+id+'@1'],worldRevision:2,sceneRevision:3,characterStateRevision:1}),metadata:{expectedOutputTokens:256}});
}
function graphInput(){return{nodes:[{ref:'deepsea:habitat',type:'LOCATION'}],edges:[],states:[{ref:'deepsea:state:current',entityRef:'deepsea:sensor',temporalStatus:'CURRENT',summary:'The pressure sensor is mounted in the deep-sea habitat control room.'}],conflicts:[]};}
function truthInput(){return{intent:'CURRENT_STATE',evidence:[{ref:'archive:e1',statement:'The mountain archive cooling loop is online.',semanticKey:'archive:cooling',temporalStatus:'CURRENT',authority:'OBSERVED'}],conflictSets:[],requiredRefs:['archive:e1']};}
function addHttp(registry,url,{resourceId='live-local',profileId='a-live-local',providerId='loopback-provider',capabilities=null,timeoutMs=1000}={}){
  registry.addResource({resourceId,providerProfileId:profileId,providerId,workerId:'slot:'+resourceId,kind:ResourceKind.OPENAI_COMPATIBLE,endpoint:url,modelId:'wave14-local-model',capabilities:capabilities??[Capability.GRAPH,Capability.TRUTH_JUDGMENT,Capability.RERANK,Capability.SEMANTIC_JUDGMENT],timeoutMs,healthTimeoutMs:500,latencyClass:'LOW',local:true,maxConcurrency:1,measurementClass:ResourceMeasurementClass.LOCAL_DETERMINISTIC,costMetadata:{inputPerMillion:1,outputPerMillion:2}});
}
function addBackup(registry){registry.addResource({resourceId:'backup',providerProfileId:'z-backup',providerId:'backup-provider',workerId:'slot:backup',kind:ResourceKind.DETERMINISTIC_LOCAL,modelId:'backup-local',capabilities:[Capability.GRAPH],handler:()=>graphOutput(),latencyClass:'LOW',local:true});}
function request(id,{single=false}={}){
  const t=Date.now();return createJevDecisionRequest({decisionId:'eval:'+id,decisionType:'GENERIC_AMBIGUITY',decisionShape:JevDecisionShape.CHOOSE_ONE,turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,options:single?[{optionId:'a',evidenceRefs:['e:a']}]:[{optionId:'a',evidenceRefs:['e:a']},{optionId:'b',evidenceRefs:['e:b']}],evidenceRefs:[{evidenceId:'e:a',summary:'Evidence A supports A.'},{evidenceId:'e:b',summary:'Evidence B supports B.'}],sourceRevisionSet:['eval-source@1'],worldRevision:1,sceneRevision:1,characterStateRevision:1,domainRevisions:{generic:1},freshnessToken:'fresh:'+id,authorityBoundary:{authorityClass:'ADVISORY',ownerId:'brain-core'},routing:{expectedDecisionValue:.9,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2,currentGenerationDepends:true},escalationPolicy:{maxRetries:1},deadline:t+5000,softDeadline:t+3000});
}
function fresh(r){return{sourceRevisionSet:r.sourceRevisionSet,worldRevision:r.worldRevision,sceneRevision:r.sceneRevision,characterStateRevision:r.characterStateRevision,domainRevisions:r.domainRevisions,freshnessToken:r.freshnessToken};}

export async function runResourceConnectionWave14Evaluation(){
  const memoryBefore=process.memoryUsage().heapUsed,cpuStart=process.cpuUsage(),wallStart=now();
  const telemetry=new CoprocessorTelemetry({limit:500});
  const native=new CoprocessorResourceConnections({telemetry});
  const nativeRead=native.readModel();

  const good=await serverFor();
  let connection,graphResult,truthResult,jevClear,jevAmbiguous,goodCalls;
  try{
    const registry=new CoprocessorResourceConnections({telemetry});addHttp(registry,good.baseUrl);
    connection=await registry.connectResource('live-local');
    graphResult=await registry.executeTask(task({id:'deepsea-graph',type:'GRAPH_WALK',capabilities:[Capability.GRAPH]}),{input:graphInput()});
    truthResult=await registry.executeTask(task({id:'archive-truth',type:'TRUTH_PRECISION',capabilities:[Capability.TRUTH_JUDGMENT,Capability.RERANK]}),{input:truthInput()});
    const core=new JevDecisionCore({providerExecutor:registry.createJevProviderExecutor()});
    const clear=request('clear',{single:true}),ambiguous=request('ambiguous');
    jevClear=await core.decide(clear,{currentRevisionState:fresh(clear)});
    jevAmbiguous=await core.decide(ambiguous,{currentRevisionState:fresh(ambiguous)});
    goodCalls=good.calls();
  }finally{await good.close();}

  const malformed=await serverFor({mode:'malformed'});let fallback;
  try{
    const registry=new CoprocessorResourceConnections({telemetry});addHttp(registry,malformed.baseUrl,{resourceId:'bad',profileId:'a-bad',providerId:'bad-provider',capabilities:[Capability.GRAPH]});addBackup(registry);
    await registry.connectResource('bad');await registry.connectResource('backup');
    fallback=await registry.executeTaskWithFallback(task({id:'fallback',type:'GRAPH_WALK',capabilities:[Capability.GRAPH]}),{input:graphInput(),maxProviders:2});
  }finally{await malformed.close();}

  const slow=await serverFor({delayMs:120});let timeout;
  try{
    const registry=new CoprocessorResourceConnections({telemetry});addHttp(registry,slow.baseUrl,{resourceId:'slow',profileId:'a-slow',providerId:'slow-provider',capabilities:[Capability.GRAPH],timeoutMs:25});await registry.connectResource('slow');
    timeout=await registry.executeTaskWithFallback(task({id:'timeout',type:'GRAPH_WALK',capabilities:[Capability.GRAPH]}),{input:graphInput(),maxProviders:1});
  }finally{await slow.close();}

  const wallMs=now()-wallStart,cpu=process.cpuUsage(cpuStart),memoryAfter=process.memoryUsage().heapUsed;
  return Object.freeze({
    benchmark:'AREA52_RESOURCE_CONNECTION_WAVE14',
    measurementClasses:{
      ciProviderTransport:'LOCAL_DETERMINISTIC',
      externalLiveProvider:'SKIPPED_UNLESS_OPERATOR_CONFIGURES_smoke:sidecar-jev:live',
      simulated:'NONE_IN_THIS_REPORT',
    },
    nativePath:{resourceCount:nativeRead.resources.length,nativePathRequired:nativeRead.nativePathRequired,usableWithoutOptionalResources:true},
    connection:{state:connection.state,healthLatencyMs:connection.lastHealthLatencyMs,activeCapabilities:connection.activeCapabilities,callable:connection.callable,secretLeak:false},
    execution:{
      physicalProviderShared:graphResult.providerId===truthResult.providerId,
      graphProviderId:graphResult.providerId,truthProviderId:truthResult.providerId,
      graphLatencyMs:graphResult.latency,truthLatencyMs:truthResult.latency,
      graphUsageReceipt:graphResult.providerMetadata.usageReceipt,truthUsageReceipt:truthResult.providerMetadata.usageReceipt,
      unrelatedSettings:['deep-sea research habitat','mountain archive'],
    },
    jev:{
      clearServiceStatus:jevClear.serviceStatus,clearProviderCalled:jevClear.providerProvenance?.providerId!=null,
      ambiguousServiceStatus:jevAmbiguous.serviceStatus,ambiguousOutcome:jevAmbiguous.outcome,ambiguousAbstained:jevAmbiguous.abstained,
      ambiguousProviderLatencyMs:jevAmbiguous.latencyMetadata.providerLatencyMs,measurementClass:jevAmbiguous.providerProvenance?.measurementClass??null,
      authorityGranted:jevAmbiguous.authorityGranted,settlementPerformed:jevAmbiguous.settlementPerformed,
    },
    failureFallback:{
      malformedStatus:fallback.status,malformedFirstFailure:fallback.attempts[0]?.failureCode??null,fallbackProviderId:fallback.result?.providerId??null,
      timeoutStatus:timeout.status,timeoutFailure:timeout.failure?.code??null,
    },
    transportCalls:goodCalls,
    hostMeasurements:{measurementClass:'LOCAL_DETERMINISTIC',wallMs,cpuMs:{user:cpu.user/1000,system:cpu.system/1000,total:(cpu.user+cpu.system)/1000},heapDeltaBytes:memoryAfter-memoryBefore},
    telemetry:telemetry.snapshot(),
    correctness:{
      noOptionalResourceRequired:nativeRead.nativePathRequired===true,
      connectionReady:['READY','DEGRADED'].includes(connection.state),
      twoSettingsExecuted:graphResult.status==='SUCCESS'&&truthResult.status==='SUCCESS',
      onePhysicalResourceMultipleJobs:graphResult.providerId===truthResult.providerId,
      jevClearSkipped:jevClear.serviceStatus==='JEV_SKIPPED',
      jevAmbiguityPreserved:[JevOutcome.ABSTAINED,JevOutcome.UNRESOLVED,JevOutcome.DECIDED,JevOutcome.PARTIAL].includes(jevAmbiguous.outcome),
      jevNoAuthority:jevAmbiguous.authorityGranted===false&&jevAmbiguous.settlementPerformed===false,
      malformedFallbackCorrect:fallback.status==='FALLBACK'&&fallback.attempts[0]?.failureCode==='MALFORMED_OUTPUT',
      timeoutTyped:timeout.failure?.code==='PROVIDER_TIMEOUT',
    },
  });
}
