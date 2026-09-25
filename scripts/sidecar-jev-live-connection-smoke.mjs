import {
  Capability, CoprocessorResourceConnections, JevDecisionCore, JevDecisionShape,
  ResourceKind, ResourceMeasurementClass, createJevDecisionRequest,
} from '../src/coprocessor/index.js';

const endpoint=process.env.AREA52_JEV_BASE_URL;
const modelId=process.env.AREA52_JEV_MODEL;
if(!endpoint||!modelId){
  console.log(JSON.stringify({
    status:'SKIPPED',
    measurementClass:'MEASURED_LIVE',
    reason:'AREA52_JEV_BASE_URL and AREA52_JEV_MODEL were not supplied',
    credentialsLogged:false,
  },null,2));
  process.exit(0);
}

const registry=new CoprocessorResourceConnections();
registry.addResource({
  resourceId:'live-jev',
  providerProfileId:'live-jev-profile',
  providerId:'live-jev-provider',
  workerId:'live-jev-slot',
  kind:ResourceKind.OPENAI_COMPATIBLE,
  endpoint,
  modelId,
  apiKey:process.env.AREA52_JEV_API_KEY??null,
  healthCheckPath:process.env.AREA52_JEV_HEALTH_PATH??'/models',
  timeoutMs:number(process.env.AREA52_JEV_TIMEOUT_MS,30000),
  healthTimeoutMs:number(process.env.AREA52_JEV_HEALTH_TIMEOUT_MS,10000),
  capabilities:[Capability.SEMANTIC_JUDGMENT],
  maxConcurrency:Math.max(1,number(process.env.AREA52_JEV_MAX_CONCURRENCY,1)),
  maxContextTokens:numberOrNull(process.env.AREA52_JEV_CONTEXT_LIMIT)??Number.MAX_SAFE_INTEGER,
  maxOutputTokens:numberOrNull(process.env.AREA52_JEV_OUTPUT_LIMIT)??1200,
  latencyClass:'MEDIUM',
  local:process.env.AREA52_JEV_LOCAL==='1',
  measurementClass:ResourceMeasurementClass.MEASURED_LIVE,
  costMetadata:pricing(),
});

const connection=await registry.connectResource('live-jev');
if(!['READY','DEGRADED'].includes(connection.state)){
  console.log(JSON.stringify({
    status:'FAILED',
    stage:'CONNECT',
    measurementClass:'MEASURED_LIVE',
    resource:connection,
    credentialsLogged:false,
  },null,2));
  process.exit(1);
}

const core=new JevDecisionCore({providerExecutor:registry.createJevProviderExecutor()});
const clear=makeRequest('clear-single-option',{single:true});
const before=core.metricsSnapshot();
const clearReceipt=await core.decide(clear,{currentRevisionState:fresh(clear)});
const afterClear=core.metricsSnapshot();

const ambiguous=makeRequest('bounded-ambiguity',{single:false});
const ambiguousReceipt=await core.decide(ambiguous,{currentRevisionState:fresh(ambiguous)});
const afterAmbiguous=core.metricsSnapshot();

const invalidStatuses=new Set(['JEV_INVALID','JEV_UNAVAILABLE','JEV_STALE']);
const passed=!invalidStatuses.has(ambiguousReceipt.serviceStatus)
  && afterClear.providerCalls-before.providerCalls===0
  && afterAmbiguous.providerCalls-afterClear.providerCalls>=1;

const report={
  status:passed?'PASS':'FAILED',
  measurementClass:'MEASURED_LIVE',
  connection:{
    resourceId:connection.resourceId,state:connection.state,providerProfileId:connection.providerProfileId,
    modelId:connection.modelId,activeCapabilities:connection.activeCapabilities,lastHealthLatencyMs:connection.lastHealthLatencyMs,
    credentialConfigured:connection.credentialConfigured,endpoint:connection.endpoint,
  },
  clearCase:{
    serviceStatus:clearReceipt.serviceStatus,outcome:clearReceipt.outcome,
    providerCalls:afterClear.providerCalls-before.providerCalls,
  },
  ambiguousCase:{
    serviceStatus:ambiguousReceipt.serviceStatus,outcome:ambiguousReceipt.outcome,abstained:ambiguousReceipt.abstained,
    providerCalls:afterAmbiguous.providerCalls-afterClear.providerCalls,
    latency:ambiguousReceipt.latencyMetadata,
    provider:{
      providerProfileId:ambiguousReceipt.providerProvenance?.providerProfileId??null,
      providerId:ambiguousReceipt.providerProvenance?.providerId??null,
      modelId:ambiguousReceipt.providerProvenance?.modelId??null,
      measurementClass:ambiguousReceipt.providerProvenance?.measurementClass??null,
      usageReceipt:ambiguousReceipt.providerProvenance?.usageReceipt??null,
    },
    authorityGranted:ambiguousReceipt.authorityGranted,
    settlementPerformed:ambiguousReceipt.settlementPerformed,
  },
  metrics:afterAmbiguous,
  credentialsLogged:false,
};
console.log(JSON.stringify(report,null,2));
if(!passed)process.exitCode=1;

function makeRequest(id,{single=false}={}){
  const now=Date.now();
  const evidence=[
    {evidenceId:'ev:a',summary:'Bounded evidence A supports option A.'},
    {evidenceId:'ev:b',summary:'Bounded evidence B independently supports option B.'},
  ];
  const options=single
    ?[{optionId:'option-a',label:'Option A',evidenceRefs:['ev:a']}]
    :[{optionId:'option-a',label:'Option A',evidenceRefs:['ev:a']},{optionId:'option-b',label:'Option B',evidenceRefs:['ev:b']}];
  return createJevDecisionRequest({
    decisionId:'live:'+id,decisionType:'GENERIC_BOUNDED_AMBIGUITY',decisionShape:JevDecisionShape.CHOOSE_ONE,
    turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,options,evidenceRefs:evidence,
    sourceRevisionSet:['live-source@1'],worldRevision:1,sceneRevision:1,characterStateRevision:1,
    domainRevisions:{generic:1},freshnessToken:'fresh:'+id,authorityBoundary:{authorityClass:'ADVISORY',ownerId:'brain-core'},
    routing:{expectedDecisionValue:.9,latencyPenalty:.05,costPenalty:.05,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2,currentGenerationDepends:true},
    escalationPolicy:{maxRetries:1},deadline:now+number(process.env.AREA52_JEV_DECISION_DEADLINE_MS,30000),softDeadline:now+number(process.env.AREA52_JEV_SOFT_DEADLINE_MS,20000),
  });
}
function fresh(request){return{sourceRevisionSet:request.sourceRevisionSet,worldRevision:request.worldRevision,sceneRevision:request.sceneRevision,characterStateRevision:request.characterStateRevision,domainRevisions:request.domainRevisions,freshnessToken:request.freshnessToken};}
function pricing(){
  const inputPerMillion=numberOrNull(process.env.AREA52_JEV_INPUT_PER_MILLION),outputPerMillion=numberOrNull(process.env.AREA52_JEV_OUTPUT_PER_MILLION);
  return inputPerMillion==null||outputPerMillion==null?null:{inputPerMillion,outputPerMillion};
}
function number(value,fallback){const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback;}
function numberOrNull(value){if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}
