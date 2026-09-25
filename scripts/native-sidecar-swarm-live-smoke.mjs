import {
  Capability,CoprocessorResourceConnections,DynamicFanOutPlanner,NativeSidecarSwarm,ResourceKind,ResourceMeasurementClass,createTurnEnvelope,
} from '../src/coprocessor/index.js';

const endpoint=process.env.AREA52_SIDECAR_BASE_URL??process.env.AREA52_JEV_BASE_URL;
const modelId=process.env.AREA52_SIDECAR_MODEL??process.env.AREA52_JEV_MODEL;
if(!endpoint||!modelId){
  console.log(JSON.stringify({status:'SKIPPED',measurementClass:'MEASURED_LIVE',reason:'AREA52_SIDECAR_BASE_URL/MODEL (or JEV equivalents) were not supplied',realProviderCallObserved:false,ft005LivePass:false,credentialsLogged:false},null,2));
  process.exit(0);
}

const timeoutMs=positive(process.env.AREA52_SIDECAR_TIMEOUT_MS,30000);
const registry=new CoprocessorResourceConnections();
registry.addResource({
  resourceId:'live-sidecar',providerProfileId:'live-sidecar-profile',providerId:'live-sidecar-provider',workerId:'live-sidecar-slot',
  kind:ResourceKind.OPENAI_COMPATIBLE,endpoint,modelId,apiKey:process.env.AREA52_SIDECAR_API_KEY??process.env.AREA52_JEV_API_KEY??null,
  healthCheckPath:process.env.AREA52_SIDECAR_HEALTH_PATH??process.env.AREA52_JEV_HEALTH_PATH??'/models',
  timeoutMs,healthTimeoutMs:positive(process.env.AREA52_SIDECAR_HEALTH_TIMEOUT_MS,10000),capabilities:[Capability.GRAPH],
  maxConcurrency:Math.max(1,positive(process.env.AREA52_SIDECAR_MAX_CONCURRENCY,1)),maxContextTokens:positive(process.env.AREA52_SIDECAR_CONTEXT_LIMIT,32768),
  maxOutputTokens:positive(process.env.AREA52_SIDECAR_OUTPUT_LIMIT,1200),latencyClass:'MEDIUM',local:process.env.AREA52_SIDECAR_LOCAL==='1',
  measurementClass:ResourceMeasurementClass.MEASURED_LIVE,costMetadata:pricing(),
});

const connection=await registry.connectResource('live-sidecar');
if(!['READY','DEGRADED'].includes(connection.state)){
  console.log(JSON.stringify({status:'FAILED',stage:'CONNECT',measurementClass:'MEASURED_LIVE',resource:safeResource(connection),realProviderCallObserved:false,ft005LivePass:false,credentialsLogged:false},null,2));
  process.exit(1);
}

const planner=new DynamicFanOutPlanner({defaultSoftBudgetMs:Math.min(timeoutMs,20000),defaultHardBudgetMs:timeoutMs,maxWorkers:4});
const swarm=new NativeSidecarSwarm({connections:registry,planner});
const t=Date.now();
const turn=createTurnEnvelope({turnId:'live-sidecar-smoke',eventId:'event:live-sidecar-smoke',correlationId:'corr:live-sidecar-smoke',sourceRevisionSet:['live-sidecar-source@1'],worldRevision:1,sceneRevision:1,characterStateRevision:1,createdAt:t,deadline:t+timeoutMs+5000,cognitiveLayer:'L1'});
const input={nodes:[{ref:'field-station:location',type:'LOCATION'}],edges:[],states:[{ref:'field-station:sensor-state',entityRef:'field-station:sensor',temporalStatus:'CURRENT',summary:'The field sensor is mounted beside the station console.'}],conflicts:[]};
const result=await swarm.runTurn({turnEvent:turn,plannerInput:{text:'Where is the field sensor?',queryIntent:'LOCATION'},inputResolver:()=>input,currentRevisionState:turn});
const assignment=result.contribution.resultSummary.find(row=>row.taskType==='GRAPH_WALK')??null;
const worker=result.contribution.resultsForOwner.find(row=>row.taskId===assignment?.taskId)??null;
const realProviderCallObserved=assignment?.state==='READY_FOR_CORE'&&worker?.providerMetadata?.measurementClass==='MEASURED_LIVE';
const ft005LivePass=Boolean(realProviderCallObserved&&worker?.providerId==='live-sidecar-provider');

console.log(JSON.stringify({
  status:ft005LivePass?'PASS':'FAILED',measurementClass:'MEASURED_LIVE',realProviderCallObserved,ft005LivePass,
  connection:safeResource(connection),
  execution:assignment?{taskId:assignment.taskId,taskType:assignment.taskType,state:assignment.state,providerProfileId:assignment.providerProfileId,providerId:assignment.providerId,workerId:assignment.workerId,latencyMs:assignment.latencyMs,failureCode:assignment.failureCode,fallbackUsed:assignment.fallbackUsed}:null,
  usageReceipt:worker?.providerMetadata?.usageReceipt??null,
  authority:{truth:false,precision:false,settlement:false,canonicalMutation:false,finalChoice:false,contextSeal:false},
  credentialsLogged:false,
},null,2));
if(!ft005LivePass)process.exitCode=1;

function safeResource(row){return{resourceId:row.resourceId,state:row.state,providerProfileId:row.providerProfileId,modelId:row.modelId,activeCapabilities:row.activeCapabilities,lastHealthLatencyMs:row.lastHealthLatencyMs,credentialConfigured:row.credentialConfigured,endpoint:row.endpoint};}
function positive(value,fallback){const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback;}
function pricing(){const input=Number(process.env.AREA52_SIDECAR_INPUT_PER_MILLION),output=Number(process.env.AREA52_SIDECAR_OUTPUT_PER_MILLION);return Number.isFinite(input)&&input>=0&&Number.isFinite(output)&&output>=0?{inputPerMillion:input,outputPerMillion:output}:null;}
