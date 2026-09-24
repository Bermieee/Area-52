import {
  Capability, ResultClass, ResultDestination, TelemetryEvent,
} from './constants.js';
import { CapabilityProfileRegistry } from './capability-profiles.js';
import { TurnEventHub } from './turn-event-hub.js';
import { DynamicFanOutPlanner } from './fanout-planner.js';
import { GatherCoordinator } from './gather-coordinator.js';
import { ProviderAdapterRegistry, DeterministicProviderAdapter } from './provider-adapters.js';
import { SpecialistExecutionLayer, ProviderExecutionRouter } from './provider-execution.js';
import { CoprocessorTelemetry, emitTelemetry } from './telemetry.js';
import { RecordingResultBusFixture } from './integration-adapters.js';
import { toNexusCognitiveResult } from './integration-adapters.js';
import { fallbackForTask } from './fallback-policy.js';
import { toRuntimeObligation } from './runtime-compatibility.js';

export function createFunctionTest001Fixtures(overrides={}){
  return{
    turnEvent:{
      turnId:'turn:function-test-001',eventId:'turn-event:function-test-001',eventType:'TURN_EVENT',
      correlationId:'corr:function-test-001',causationId:'user-send:function-test-001',
      sourceRevisionSet:['rev:fire','rev:journal','rev:tavern'],worldRevision:44,sceneRevision:12,characterStateRevision:9,
      createdAt:0,deadline:120,cognitiveLayer:'L1',requiredCapabilities:[],deliveryAttempt:1,dedupeKey:'turn:function-test-001',
      ...(overrides.turnEvent??{}),
    },
    sceneFixture:{
      text:'Eris returns to the ruined Ember Tavern looking for the Sun Blade while speaking to Mara.',
      activeCast:['Eris','Mara'],activeThreads:['Sun Blade fate'],location:'Ember Tavern',
      ...(overrides.sceneFixture??{}),
    },
    evidenceFixture:{
      candidates:[
        {ref:'E_FIRE',summary:'Witness account: the Sun Blade was destroyed in the Tavern fire.',semanticKey:'sun-blade:fate',value:'destroyed-in-fire',temporalStatus:'UNRESOLVED',authority:'CREDIBLE'},
        {ref:'E_JOURNAL',summary:'Journal: the Sun Blade was removed before the fire.',semanticKey:'sun-blade:fate',value:'removed-before-fire',temporalStatus:'UNRESOLVED',authority:'CREDIBLE'},
        {ref:'E_HISTORY',summary:'Earlier episode: the Sun Blade was at Ember Tavern.',semanticKey:'sun-blade:location',value:'Ember Tavern',temporalStatus:'HISTORICAL',authority:'SOURCE_CANON'},
      ],
      ...(overrides.evidenceFixture??{}),
    },
    graphFixture:{
      nodes:[{ref:'N_TAVERN',type:'LOCATION'},{ref:'N_BLADE',type:'ITEM'},{ref:'N_ERIS',type:'CHARACTER'},{ref:'N_MARA',type:'CHARACTER'}],
      edges:[{ref:'EDGE_HISTORY',from:'N_BLADE',to:'N_TAVERN',relation:'WAS_AT'}],
      states:[
        {ref:'S_TAVERN_CURRENT',entityRef:'N_TAVERN',temporalStatus:'CURRENT',summary:'Ember Tavern is destroyed.'},
        {ref:'S_BLADE_HISTORY',entityRef:'N_BLADE',temporalStatus:'HISTORICAL',summary:'Sun Blade was at Ember Tavern.'},
        {ref:'S_BLADE_UNKNOWN',entityRef:'N_BLADE',temporalStatus:'UNRESOLVED',summary:'Current Sun Blade location is unknown.'},
      ],
      conflicts:['C_BLADE_FATE'],
      ...(overrides.graphFixture??{}),
    },
    characterFixture:{
      characters:[
        {characterId:'Eris',evidenceRefs:['CHAR_ERIS_SCENE'],recentSceneEvidence:['Eris searches the ruins.'],relationshipEvidenceRefs:[]},
        {characterId:'Mara',evidenceRefs:['CHAR_MARA_SCENE'],recentSceneEvidence:['Mara is guarded while discussing the Blade.'],relationshipEvidenceRefs:[]},
      ],
      expiry:{onSceneRevisionChange:true,ttlTurns:1,onCharacterExit:true},
      ...(overrides.characterFixture??{}),
    },
  };
}

export function createFunctionTest001DeterministicExecution({telemetry=new CoprocessorTelemetry()}={}){
  const profiles=new CapabilityProfileRegistry();
  const providerId='fixture:foreground-specialists';
  profiles.register({profileId:'historian-v2',workerId:'slot:historian',providerId,modelId:'fixture-v2',
    capabilities:[Capability.RETRIEVAL,Capability.LONG_CONTEXT],latencyClass:'LOW',reliability:1});
  profiles.register({profileId:'graph-v2',workerId:'slot:graph',providerId,modelId:'fixture-v2',
    capabilities:[Capability.GRAPH],latencyClass:'LOW',reliability:1});
  profiles.register({profileId:'green-v2',workerId:'slot:green',providerId,modelId:'fixture-v2',
    capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.CHARACTER_INFERENCE],latencyClass:'MEDIUM',reliability:1});
  profiles.register({profileId:'truth-v2',workerId:'slot:truth',providerId,modelId:'fixture-v2',
    capabilities:[Capability.TRUTH_JUDGMENT,Capability.RERANK],latencyClass:'LOW',reliability:1});
  const adapters=new ProviderAdapterRegistry();
  adapters.register(new DeterministicProviderAdapter({providerId,modelId:'fixture-v2',handlers:{
    HISTORIAN_RETRIEVAL:()=>({latencyMs:40,payload:{refs:['E_FIRE','E_JOURNAL','E_HISTORY'],relevance:[
      {ref:'E_FIRE',score:.94},{ref:'E_JOURNAL',score:.93},{ref:'E_HISTORY',score:.82}],uncertainty:'HIGH',reasoningSummary:'Both fate claims and historical location are relevant.'}}),
    GRAPH_WALK:()=>({latencyMs:50,payload:{nodes:['N_TAVERN','N_BLADE'],edges:['EDGE_HISTORY'],currentStateRefs:['S_TAVERN_CURRENT'],
      historicalRefs:['S_BLADE_HISTORY'],unresolvedRefs:['S_BLADE_UNKNOWN'],conflicts:['C_BLADE_FATE'],reasoningSummary:'Current and historical state stay separated.'}}),
    GREEN_ROOM:({input})=>({latencyMs:240,payload:{characters:input.data.characters.map(c=>({characterId:c.characterId,guardedness:c.characterId==='Mara'?.78:.42,
      warmth:c.characterId==='Mara'?.34:.48,anger:.18,trustTrend:'UNKNOWN',anxiety:c.characterId==='Mara'?.62:.51,latentIntent:'Assess the ruined Tavern.',
      confidence:.72,evidenceRefs:c.evidenceRefs,sceneRevision:input.data.sceneRevision,expiry:{onSceneRevisionChange:true,ttlTurns:1,onCharacterExit:true}}))}}),
    TRUTH_PRECISION:()=>({latencyMs:70,payload:{assessments:[{refs:['E_FIRE','E_JOURNAL'],classification:'CONFLICTING',confidence:.96,
      reasoningSummary:'Both claims are credible and mutually incompatible.'},{refs:['E_HISTORY'],classification:'SUPPORTED',confidence:.98,
      reasoningSummary:'Historical Tavern location is supported as history only.'}],ranking:[{ref:'E_FIRE',score:.95},{ref:'E_JOURNAL',score:.94},{ref:'E_HISTORY',score:.8}],
      rejectedRefs:[],uncertaintyPreserved:true}}),
  }}));
  return{profiles,adapters,telemetry,executionLayer:new SpecialistExecutionLayer({profiles,adapters,telemetry})};
}

export async function runFunctionTestTurn({
  turnEvent,sceneFixture,evidenceFixture,graphFixture,characterFixture,providerMode='deterministic',
  executionLayer=null,resultBus=null,planner=new DynamicFanOutPlanner({maxWorkers:8}),downstream={},
}={}){
  const fixtures=createFunctionTest001Fixtures({turnEvent,sceneFixture,evidenceFixture,graphFixture,characterFixture});
  const eventHub=new TurnEventHub(),telemetry=executionLayer?.telemetry??new CoprocessorTelemetry();
  const execution=executionLayer??createFunctionTest001DeterministicExecution({telemetry}).executionLayer;
  if(providerMode!=='deterministic'&&!executionLayer)throw new TypeError('non-deterministic providerMode requires injected executionLayer');
  let boundarySealed=false;
  const bus=resultBus??new RecordingResultBusFixture({isTurnSealed:()=>boundarySealed});
  const inputResolver=(task)=>inputForRole(task,fixtures);
  const router=new ProviderExecutionRouter({executionLayer:execution,inputResolver});
  const published=eventHub.publish(fixtures.turnEvent);const event=published.event;
  const plan=planner.plan({turnEvent:event,text:fixtures.sceneFixture.text,queryIntent:'CURRENT_STATE',activeCast:fixtures.sceneFixture.activeCast,
    activeThreads:fixtures.sceneFixture.activeThreads,location:fixtures.sceneFixture.location,conflictSignals:['sun-blade:fate'],
    inputRefs:{historian:fixtures.evidenceFixture.candidates.map(x=>x.ref),'graph-walker':fixtures.graphFixture.states.map(x=>x.ref),
      'green-room':fixtures.characterFixture.characters.map(x=>x.characterId),'truth-precision':fixtures.evidenceFixture.candidates.map(x=>x.ref)},
    maxFanOut:4,resourceConstraint:{maxForegroundWorkers:4}});
  const gather=new GatherCoordinator({turnEvent:event,plan,currentRevisionSet:event});
  const outcomes=await Promise.all(plan.tasks.map(async task=>{
    try{return{task,result:await router.dispatch(task,{turnEvent:event}),failure:null};}
    catch(error){return{task,result:null,failure:error};}
  }));
  outcomes.sort((a,b)=>(a.result?.completedAt??Number.MAX_SAFE_INTEGER)-(b.result?.completedAt??Number.MAX_SAFE_INTEGER)||a.task.taskId.localeCompare(b.task.taskId));
  let closureAt=null;const lateQueue=[],workerResults=[];
  for(const item of outcomes){
    if(!item.result){gather.addFailure({taskId:item.task.taskId,code:item.failure?.code??'PROVIDER_FAILURE',message:item.failure?.message??String(item.failure)});continue;}
    workerResults.push(item.result);
    if(closureAt!=null||item.result.completedAt>item.task.hardDeadline){lateQueue.push(item);continue;}
    const routed=bus.receive(toNexusCognitiveResult(item.result,item.task));const external=gather.recordExternalRoute(item.result,routed?.route);
    if(!external)await gather.accept(item.result,{arrivalAt:item.result.completedAt});
    if(gather.quorumSatisfied())closureAt=item.result.completedAt;
  }
  if(!gather.quorumSatisfied()){
    const at=Math.max(event.deadline,...plan.tasks.map(x=>x.hardDeadline));
    for(const task of gather.missingRequired()){
      const fallback=fallbackForTask(task,{at,input:inputResolver(task)});
      if(fallback){gather.addFallback(task.taskId,fallback);bus.receive(toNexusCognitiveResult(fallback,task));workerResults.push(fallback);}
    }
    closureAt=at;
  }
  const gatherBundle=gather.close({at:closureAt??event.createdAt,reason:gather.quorumSatisfied()?'FOREGROUND_QUORUM':'HARD_DEADLINE_DEGRADED'});
  const compilerInput=gather.compilerInput();
  const foregroundQuorumReceipt={satisfied:gather.quorumSatisfied(),closedAt:gatherBundle.closedAt,reason:gatherBundle.closeReason,
    requiredTaskIds:gather.requiredTasks().map(x=>x.taskId),missingRequired:gatherBundle.missingRequired};
  const compiled=typeof downstream.compile==='function'?await downstream.compile(compilerInput):null;
  const sealCompatibilityReceipt={ownsSeal:false,ready:true,turnId:event.turnId,correlationId:event.correlationId,
    admittedResultIds:[...gatherBundle.acceptedResultIds],staleResultIds:[...gatherBundle.staleResultIds],foregroundClosedAt:gatherBundle.closedAt};
  if(typeof downstream.seal==='function'){sealCompatibilityReceipt.externalSeal=await downstream.seal({turnEvent:event,compilerInput,compiled,gatherBundle});}
  boundarySealed=true;gather.markSealed(sealCompatibilityReceipt.externalSeal??sealCompatibilityReceipt);
  for(const item of lateQueue){
    const routed=bus.receive(toNexusCognitiveResult(item.result,item.task));await gather.accept(item.result,{arrivalAt:item.result.completedAt});
    emitTelemetry(telemetry,TelemetryEvent.LATE_ROUTED,{taskId:item.task.taskId,turnId:event.turnId,providerId:item.result.providerId,
      destination:routed?.route?.effectiveDestination??ResultDestination.NEXT_TURN});
  }
  const finalBundle=gather.bundle();const promptPlan=typeof downstream.promptPlan==='function'?await downstream.promptPlan({compiled,seal:sealCompatibilityReceipt.externalSeal,compilerInput}):null;
  return Object.freeze({
    fanOutPlan:plan,runtimeSubmissions:Object.freeze(plan.tasks.map(task=>toRuntimeObligation(task))),workerResults:Object.freeze(workerResults),gatherBundle:finalBundle,foregroundQuorumReceipt,
    lateResults:Object.freeze(finalBundle.lateResults),compilerInput,sealCompatibilityReceipt,promptPlan,
    telemetrySummary:summarizeTelemetry(telemetry.list()),fixtureBoundaries:{scene:true,evidence:true,graph:true,provider:providerMode==='deterministic'},
  });
}

function inputForRole(task,fixtures){
  switch(task.metadata.roleId){
    case'historian':return{intent:'CURRENT_STATE',activeEntities:['Eris','Mara','Sun Blade','Ember Tavern'],sceneRefs:['scene:ember'],
      candidates:fixtures.evidenceFixture.candidates,maxRefs:5};
    case'graph-walker':return{nodes:fixtures.graphFixture.nodes,edges:fixtures.graphFixture.edges,states:fixtures.graphFixture.states,conflicts:fixtures.graphFixture.conflicts};
    case'green-room':return{characters:fixtures.characterFixture.characters,expiry:fixtures.characterFixture.expiry};
    case'truth-precision':return{intent:'CURRENT_STATE',evidence:fixtures.evidenceFixture.candidates.map(x=>({ref:x.ref,statement:x.summary,semanticKey:x.semanticKey,
      temporalStatus:x.temporalStatus,authority:x.authority})),conflictSets:[{id:'sun-blade:fate',refs:['E_FIRE','E_JOURNAL']}],requiredRefs:['E_FIRE','E_JOURNAL','E_HISTORY']};
    default:return{};
  }
}
function summarizeTelemetry(events){
  const counts={};for(const event of events)counts[event.type]=(counts[event.type]??0)+1;
  return{eventCount:events.length,counts};
}
