import {
  Capability,CoprocessorResourceConnections,DynamicFanOutPlanner,GatherCoordinator,NativeSidecarSwarm,ResourceKind,
  admitNativeSwarmContributionToOwner,bindProviderFetch,createTurnEnvelope,
} from '../src/coprocessor/index.js';
import {runWave16ResourceJevEvaluation} from './resource-jev-wave16-evaluator.mjs';

export async function runWave17SidecarJevEvaluation(){
  const wave16=await runWave16ResourceJevEvaluation();
  const nativeFetch=measureBrowserFetchBinding();
  const owner=await measureOwnerAdmission();
  const zero=await measureZeroResource();
  return Object.freeze({
    benchmark:'AREA52_SIDECAR_JEV_WAVE17',
    measurementClasses:Object.freeze({
      browserNativeFetch:'LOCAL_DETERMINISTIC',
      ownerAdmission:'LOCAL_DETERMINISTIC',
      controlledProviderHttp:'LOCAL_DETERMINISTIC',
      failureInjection:'SIMULATED_FAILURE',
      externalOpenRouter:'NOT_MEASURED_IN_DEFAULT_CI',
    }),
    browserFetchBinding:nativeFetch,
    nativeBrain:zero,
    ownerHandoff:owner,
    resourceQualification:wave16.connections,
    transportRouting:wave16.routing,
    jev:wave16.jev,
    liveEvidence:Object.freeze({
      realProviderCallObserved:false,
      ft005LivePass:false,
      jevLivePass:false,
      vectorLivePass:false,
      status:'REQUIRES_OPERATOR_CONFIGURED_OPENROUTER',
    }),
    authority:Object.freeze({
      truth:false,precision:false,settlement:false,canonicalMutation:false,finalChoice:false,contextSeal:false,
    }),
  });
}

function measureBrowserFetchBinding(){
  const original=globalThis.fetch;
  let called=false,receiverCorrect=false;
  const nativeLike=function(){called=true;receiverCorrect=this===globalThis;return Promise.resolve({ok:true,status:200});};
  globalThis.fetch=nativeLike;
  try{
    const bound=bindProviderFetch();
    return Object.freeze({supported:true,calledAfterInvoke:Promise.resolve(bound('https://example.invalid')).then(()=>called),receiverCorrectAfterInvoke:Promise.resolve(bound('https://example.invalid')).then(()=>receiverCorrect)});
  }finally{globalThis.fetch=original;}
}

async function measureOwnerAdmission(){
  const registry=new CoprocessorResourceConnections();
  registry.addResource({
    resourceId:'owner-eval',providerProfileId:'profile:owner-eval',providerId:'provider:owner-eval',workerId:'worker:owner-eval',
    kind:ResourceKind.DETERMINISTIC_LOCAL,modelId:'model:owner-eval',capabilities:[Capability.GRAPH],
    handlers:{GRAPH_WALK:()=>({nodes:['eval:location'],edges:[],currentStateRefs:['eval:state'],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'Bounded current state.'})},
  });
  await registry.connectResource('owner-eval');
  const swarm=new NativeSidecarSwarm({connections:registry,planner:new DynamicFanOutPlanner({defaultSoftBudgetMs:100,defaultHardBudgetMs:300})});
  const turn=makeTurn('owner');
  const prepared=swarm.prepareTurn({turnEvent:turn,plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION'}});
  const executed=await swarm.executeCheckpoint(prepared.checkpoint,{
    inputResolver:()=>({nodes:[{ref:'eval:location',type:'LOCATION'}],edges:[],states:[{ref:'eval:state',entityRef:'eval:sensor',temporalStatus:'CURRENT',summary:'Current bounded location.'}],conflicts:[]}),
    currentRevisionState:turn,
  });
  const gather=new GatherCoordinator({turnEvent:turn,plan:prepared.fanOutPlan,currentRevisionSet:turn});
  const receipt=await admitNativeSwarmContributionToOwner({contribution:executed.contribution,gather});
  return Object.freeze({
    physicalExecutions:receipt.executedResults.length,
    ownerEligible:receipt.eligibleResultIds.length,
    ownerAccepted:receipt.acceptedResultIds.length,
    rejectedAtOwner:receipt.rejectedAtOwnerResultIds.length,
    admissionPerformed:receipt.ownerAdmissionPerformed,
    jevAutoAdmitted:receipt.jev.admittedByBridge,
  });
}

async function measureZeroResource(){
  const registry=new CoprocessorResourceConnections();
  const swarm=new NativeSidecarSwarm({connections:registry});
  const turn=makeTurn('zero');
  const result=await swarm.runTurn({turnEvent:turn,plannerInput:{text:'Where is the instrument?',queryIntent:'LOCATION'},currentRevisionState:turn});
  return Object.freeze({
    zeroResourcesUsable:registry.readModel().nativePathRequired===true,
    readyOptionalResources:registry.readModel().readyResourceCount,
    ownerEligibleResults:result.contribution.resultsForOwner.length,
  });
}

function makeTurn(id){
  const now=Date.now();
  return createTurnEnvelope({turnId:'wave17:'+id,eventId:'event:'+id,correlationId:'corr:'+id,sourceRevisionSet:['source:'+id+'@1'],worldRevision:1,sceneRevision:1,characterStateRevision:1,createdAt:now,deadline:now+3000,cognitiveLayer:'L1'});
}
