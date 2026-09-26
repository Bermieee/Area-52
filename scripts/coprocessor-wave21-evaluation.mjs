import {
  Capability,CoprocessorResourceConnections,CoprocessorTelemetry,DynamicFanOutPlanner,NativeSidecarSwarm,ResourceKind,TelemetryEvent,createTurnEnvelope,summarizeJevUsefulnessCorpus,
} from '../src/coprocessor/index.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const now=Date.now();
const turn=createTurnEnvelope({turnId:'turn:wave21-benchmark',eventId:'event:wave21-benchmark',correlationId:'corr:wave21-benchmark',
  sourceRevisionSet:['source:wave21@1'],worldRevision:1,sceneRevision:1,characterStateRevision:1,createdAt:now,deadline:now+5000,cognitiveLayer:'L1'});
const plannerInput={text:'Where is the instrument and what is its current physical state?',queryIntent:'CURRENT_STATE',conflictSignals:[],activeCast:[]};
const graphInput={nodes:[{ref:'lab:location',type:'LOCATION'}],edges:[],states:[{ref:'lab:state',entityRef:'lab:sensor',temporalStatus:'CURRENT',summary:'current'}],conflicts:[]};
const truthInput={intent:'CURRENT_STATE',evidence:[{ref:'lab:e1',statement:'loop online',semanticKey:'lab:loop',temporalStatus:'CURRENT',authority:'OBSERVED'}],conflictSets:[],requiredRefs:['lab:e1']};
const graphOutput={nodes:['lab:location'],edges:[],currentStateRefs:['lab:state'],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'bounded'};
const truthOutput={assessments:[{refs:['lab:e1'],classification:'SUPPORTED',confidence:.95,reasoningSummary:'bounded'}],ranking:[{ref:'lab:e1',score:.95}],rejectedRefs:[],uncertaintyPreserved:true};

let active=0,legacyPeak=0,layeredPeakObserved=0,mode='legacy';
const guarded=value=>async()=>{active++;if(mode==='legacy')legacyPeak=Math.max(legacyPeak,active);else layeredPeakObserved=Math.max(layeredPeakObserved,active);await sleep(12);active--;return value;};
const telemetry=new CoprocessorTelemetry({limit:2000});
const registry=new CoprocessorResourceConnections({telemetry});
for(const [id,profileId] of [['alpha','a-alpha'],['beta','b-beta']]){
  registry.addResource({resourceId:id,providerProfileId:profileId,providerId:'provider:'+id,workerId:'worker:'+id,kind:ResourceKind.DETERMINISTIC_LOCAL,
    modelId:'model:'+id,capabilities:[Capability.GRAPH,Capability.TRUTH_JUDGMENT,Capability.RERANK],
    handlers:{GRAPH_WALK:guarded(graphOutput),TRUTH_PRECISION:guarded(truthOutput)},maxConcurrency:1,latencyClass:'LOW',local:true});
  await registry.connectResource(id);
}
const planner=new DynamicFanOutPlanner({defaultSoftBudgetMs:250,defaultHardBudgetMs:500});
const swarm=new NativeSidecarSwarm({connections:registry,planner,telemetry});
const planningStarted=performance.now();
const prepared=swarm.prepareTurn({turnEvent:turn,chatId:'chat:wave21',generationId:'gen:wave21',plannerInput});
const scatterPlanningMs=performance.now()-planningStarted;
const graphTask=prepared.fanOutPlan.tasks.find(x=>x.taskType==='GRAPH_WALK');
const truthTask=prepared.fanOutPlan.tasks.find(x=>x.taskType==='TRUTH_PRECISION');
if(!graphTask||!truthTask)throw new Error('representative workload did not produce graph + truth tasks');

const baselineEventStart=telemetry.list().length;
const baselineStarted=performance.now();
const baselineResults=await Promise.all([
  registry.executeTask(graphTask,{input:graphInput,profileId:'a-alpha'}),
  registry.executeTask(truthTask,{input:truthInput,profileId:'b-beta'}),
]);
const baselineElapsedMs=performance.now()-baselineStarted;
const baselineRetainedBytes=baselineResults.reduce((sum,row)=>sum+new TextEncoder().encode(JSON.stringify(row)).length,0);
const baselineEvents=telemetry.list().slice(baselineEventStart);

mode='layered';active=0;
const layeredEventStart=telemetry.list().length;
const layeredStarted=performance.now();
const layered=await swarm.executeCheckpoint(prepared.checkpoint,{inputResolver:task=>task.taskType==='GRAPH_WALK'?graphInput:truthInput,currentRevisionState:turn});
const layeredElapsedMs=performance.now()-layeredStarted;
const layeredEvents=telemetry.list().slice(layeredEventStart);
const wave=layered.contribution.layeredScatterReceipt;

const phaseStats=(events)=> {
  const invoked=events.filter(event=>event.type===TelemetryEvent.PROVIDER_INVOKED);
  return {
    physicalWorkerProviderAttempts:invoked.length,
    providerExecutionLatencyMs:{sum:invoked.reduce((sum,event)=>sum+Number(event.payload.executionLatency??0),0),peak:Math.max(0,...invoked.map(event=>Number(event.payload.executionLatency??0)))},
    resultNormalizationLatencyMs:{sum:invoked.reduce((sum,event)=>sum+Number(event.payload.validationLatency??0),0),peak:Math.max(0,...invoked.map(event=>Number(event.payload.validationLatency??0)))},
    resourceExecutionEvents:events.filter(event=>event.type===TelemetryEvent.RESOURCE_EXECUTION).length,
  };
};
const baselinePhases=phaseStats(baselineEvents),layeredPhases=phaseStats(layeredEvents);

const jev=summarizeJevUsefulnessCorpus({measurementClass:'LOCAL_DETERMINISTIC',cases:[
  {id:'deterministic-skip',ambiguous:false,deterministic:{correct:true,confidence:1,latencyMs:1},jevAssisted:{correct:true,confidence:1,latencyMs:1,physicalExecution:false}},
  {id:'ambiguous-useful',ambiguous:true,deterministic:{correct:false,abstained:true,confidence:.2,latencyMs:1},jevAssisted:{correct:true,confidence:.82,latencyMs:12,physicalExecution:true,ownerAccepted:true}},
  {id:'false-certainty-avoided',ambiguous:true,deterministic:{correct:false,confidence:.92,latencyMs:1},jevAssisted:{correct:false,abstained:true,confidence:.15,latencyMs:11,physicalExecution:true,ownerAccepted:false}},
]});

const report={
  kind:'Worker2Wave21Evaluation',measurementClass:'LOCAL_DETERMINISTIC',
  workload:{logicalJobs:2,description:'same physical-state query with clean graph evidence'},
  profile:{
    scatterPlanning:{durationMs:scatterPlanningMs,logicalJobs:prepared.fanOutPlan.tasks.length},
    before:{nativeJobs:{count:2,wallMs:baselineElapsedMs},...baselinePhases,gather:{present:false},journalPublication:{measured:false,owner:'Worker 3'},mainThreadUiHandoff:{measured:false,owner:'Worker 3'},browserLongTasks:{measured:false}},
    after:{nativeJobs:{physicalCount:wave.metrics.physicalAttemptCount,wallMs:layeredElapsedMs},...layeredPhases,gather:{present:true,timeToCloseMs:wave.metrics.timeToGatherCloseMs,quorumSatisfied:wave.metrics.quorumSatisfied},
      journalPublication:{measured:false,owner:'Worker 3'},mainThreadUiHandoff:{measured:false,owner:'Worker 3'},browserLongTasks:{measured:false}},
  },
  before:{executionModel:'UNLAYERED_BURST',physicalAttempts:2,peakConcurrency:legacyPeak,retainedBytes:baselineRetainedBytes,timeToReadyMs:baselineElapsedMs},
  after:{executionModel:'LAYERED_SCATTER',physicalAttempts:wave.metrics.physicalAttemptCount,peakConcurrency:Math.max(wave.metrics.peakLayerConcurrency,layeredPeakObserved),
    retainedBytesEstimate:wave.metrics.peakRetainedBytesEstimate,timeToGatherCloseMs:wave.metrics.timeToGatherCloseMs,wallMs:layeredElapsedMs,workAvoided:wave.metrics.workAvoidedCount,
    quorumSatisfied:wave.metrics.quorumSatisfied},
  deltas:{physicalAttempts:wave.metrics.physicalAttemptCount-2,peakConcurrency:Math.max(wave.metrics.peakLayerConcurrency,layeredPeakObserved)-legacyPeak,
    retainedBytesEstimate:wave.metrics.peakRetainedBytesEstimate-baselineRetainedBytes,timeToGatherCloseMs:wave.metrics.timeToGatherCloseMs-baselineElapsedMs,wallMs:layeredElapsedMs-baselineElapsedMs},
  jev,
  limitations:['Node/local deterministic measurement only.','Journal publication and main-thread/UI handoff are Worker 3 downstream boundaries and are explicitly unmeasured here.','No installed-SillyTavern browser main-thread/heap/long-task claim.','No authenticated optional-provider cost/latency claim.'],
};
if(report.after.physicalAttempts>=report.before.physicalAttempts)throw new Error('layered workload did not avoid expected physical work');
if(report.after.peakConcurrency>report.before.peakConcurrency)throw new Error('layered workload increased peak concurrency');
console.log(JSON.stringify(report,null,2));
