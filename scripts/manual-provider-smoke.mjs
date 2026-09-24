import {
  Capability, CapabilityProfileRegistry, CoprocessorTelemetry, OpenAICompatibleProviderAdapter, ProviderAdapterRegistry,
  SpecialistExecutionLayer, createCognitiveTask,
} from '../src/coprocessor/index.js';

const endpoint=process.env.AREA52_OPENAI_BASE_URL;
const apiKey=process.env.AREA52_OPENAI_API_KEY??null;
const modelId=process.env.AREA52_OPENAI_MODEL;
const timeoutMs=Math.max(1,Number(process.env.AREA52_OPENAI_TIMEOUT_MS??30000)||30000);
if(!endpoint||!modelId){
  console.error('Set AREA52_OPENAI_BASE_URL and AREA52_OPENAI_MODEL. AREA52_OPENAI_API_KEY is optional for local endpoints.');
  process.exitCode=2;
}else{
  const profiles=new CapabilityProfileRegistry();
  profiles.register({profileId:'manual-historian',workerId:'manual-slot',providerId:'manual-openai',modelId,
    capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT],latencyClass:'MEDIUM',foregroundEligible:true});
  const adapters=new ProviderAdapterRegistry();
  adapters.register(new OpenAICompatibleProviderAdapter({providerId:'manual-openai',modelId,endpoint,apiKey,timeoutMs}));
  const telemetry=new CoprocessorTelemetry({limit:100});
  const layer=new SpecialistExecutionLayer({profiles,adapters,telemetry});
  const now=Date.now();
  const task=createCognitiveTask({taskId:'manual:historian',taskType:'HISTORIAN_RETRIEVAL',turnId:'manual:turn',correlationId:'manual:corr',
    requiredCapabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT],softDeadline:now+10000,hardDeadline:now+30000,
    inputRevisionSet:{sourceRevisionSet:['manual:source'],worldRevision:1,sceneRevision:1,characterStateRevision:1},compilerLane:'loreEvidence',
    intentFingerprint:'manual:intent'});
  try{
    const result=await layer.execute(task,{input:{intent:'CURRENT_STATE',activeEntities:['Sun Blade'],sceneRefs:['manual:scene'],maxRefs:2,candidates:[
      {ref:'E1',summary:'Historical: the Sun Blade was at Ember Tavern.',temporalStatus:'HISTORICAL',authority:'SOURCE_CANON'},
      {ref:'E2',summary:'Current location is unresolved.',temporalStatus:'UNRESOLVED',authority:'UNRESOLVED'},
    ]}});
    console.log(JSON.stringify({ok:true,providerId:result.providerId,modelId:result.modelId,latency:result.latency,payload:result.payload,
      usage:result.providerMetadata?.usage??{},telemetry:telemetry.list().map(({type,payload})=>({type,payload}))},null,2));
  }catch(error){
    console.error(JSON.stringify({ok:false,code:error.code??'ERROR',message:error.message},null,2));process.exitCode=1;
  }
}
