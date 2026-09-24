import {
  Capability, CapabilityProfileRegistry, CoprocessorTelemetry, DeterministicProviderAdapter, FailureCode,
  OpenAICompatibleProviderAdapter, ProviderAdapterRegistry, ProviderInvocationError, SpecialistExecutionLayer,
  createCognitiveTask, createRevisionSet, negotiateCapabilities, runProviderQualification,
} from '../src/coprocessor/index.js';

const providers=['A','B'].map(readProvider).filter(Boolean);
if(!providers.length){
  console.error('FT005 READY / NOT RUN: configure AREA52_PROVIDER_A_BASE_URL + AREA52_PROVIDER_A_MODEL and/or provider B equivalents. API keys are optional for local endpoints.');
  process.exitCode=2;
}else{
  const profiles=new CapabilityProfileRegistry(); const adapters=new ProviderAdapterRegistry(); const telemetry=new CoprocessorTelemetry({limit:100});
  for(const spec of providers){
    profiles.register({profileId:spec.profileId,workerId:`slot-${spec.name.toLowerCase()}`,providerId:spec.providerId,modelId:spec.modelId,
      capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT],latencyClass:'MEDIUM',foregroundEligible:true,structuredOutput:true,
      maxContextTokens:spec.contextLimit??Number.MAX_SAFE_INTEGER,maxOutputTokens:spec.outputLimit??Number.MAX_SAFE_INTEGER,local:spec.local});
    adapters.register(adapterFor(spec));
  }
  const layer=new SpecialistExecutionLayer({profiles,adapters,telemetry});
  const task=createCognitiveTask({taskId:'ft005:historian',taskType:'HISTORIAN_RETRIEVAL',turnId:'ft005:turn',correlationId:'ft005:corr',
    requiredCapabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT],softDeadline:Date.now()+10000,hardDeadline:Date.now()+30000,
    compilerLane:'loreEvidence',intentFingerprint:'ft005:current-location',metadata:{expectedOutputTokens:512},
    inputRevisionSet:createRevisionSet({sourceRevisionSet:['ft005:fixture'],worldRevision:1,sceneRevision:1,characterStateRevision:1})});
  const input={intent:'CURRENT_LOCATION',maxRefs:2,candidates:[
    {ref:'E1',summary:'CURRENT: Mara is at Ember Tavern.',semanticKey:'mara:location',temporalStatus:'CURRENT',authority:'SOURCE_CANON'},
    {ref:'E2',summary:'HISTORICAL: Mara was at the old forge.',semanticKey:'mara:location',temporalStatus:'HISTORICAL',authority:'SOURCE_CANON'},
  ]};
  const negotiation=negotiateCapabilities(profiles,task,{maxCostClass:'HIGH'});
  console.log(`PROVIDER CONNECTED: ${providers.map(p=>p.name).join(', ')}`);
  console.log(`CAPABILITY MATCHED: ${negotiation.eligibleImplementations.length} eligible implementation(s)`);
  const report=await runProviderQualification({registry:profiles,executionLayer:layer,task,input,maxProviders:2});
  console.log(`REQUEST SENT: ${report.attempts.length} attempt(s)`);
  console.log(`OUTPUT VALIDATED: ${report.result?.validationReceipt?.deterministic==='PASS'?'PASS':'FAIL'}`);
  console.log(`RESULT NORMALIZED: ${report.result?.kind==='CognitiveWorkerResult'?'PASS':'FAIL'}`);
  console.log(`TELEMETRY RECORDED: ${telemetry.list().length} event(s)`);
  console.log(JSON.stringify({
    status:report.status,providersConfigured:providers.map(p=>p.name),negotiation:{degraded:negotiation.degraded,eligible:negotiation.eligibleImplementations.map(p=>p.profileId)},
    attempts:report.attempts,result:report.result?{providerId:report.result.providerId,modelId:report.result.modelId,authorityClass:report.result.authorityClass,
      usage:report.result.providerMetadata?.usage??{},latency:report.result.latency}:null,
    telemetry:telemetry.list().map(({type,payload})=>({type,payload})),
  },null,2));
  if(!report.result)process.exitCode=1;
}

function readProvider(name){
  const prefix=`AREA52_PROVIDER_${name}`; const endpoint=process.env[`${prefix}_BASE_URL`]; const modelId=process.env[`${prefix}_MODEL`];
  if(!endpoint||!modelId)return null;
  return{name,profileId:`provider-${name.toLowerCase()}`,providerId:`ft005-${name.toLowerCase()}`,endpoint,modelId,apiKey:process.env[`${prefix}_API_KEY`]??null,
    timeoutMs:Math.max(1,Number(process.env[`${prefix}_TIMEOUT_MS`]??30000)||30000),local:process.env[`${prefix}_LOCAL`]==='1',
    contextLimit:numberOrNull(process.env[`${prefix}_CONTEXT_LIMIT`]),outputLimit:numberOrNull(process.env[`${prefix}_OUTPUT_LIMIT`]),
    forceUnavailable:name==='A'&&process.env.AREA52_FT005_FORCE_A_UNAVAILABLE==='1'};
}
function adapterFor(spec){
  if(spec.forceUnavailable)return new DeterministicProviderAdapter({providerId:spec.providerId,modelId:spec.modelId,capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT],handler:()=>{throw new ProviderInvocationError(FailureCode.PROVIDER_UNAVAILABLE,'forced FT005 provider outage',{providerId:spec.providerId});}});
  return new OpenAICompatibleProviderAdapter({providerId:spec.providerId,modelId:spec.modelId,endpoint:spec.endpoint,apiKey:spec.apiKey,timeoutMs:spec.timeoutMs,
    contextLimit:spec.contextLimit,outputLimit:spec.outputLimit,local:spec.local,capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT]});
}
function numberOrNull(value){if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
