import { runFunctionTestTurn, createFunctionTest001Fixtures } from '../coprocessor/function-test-001.js';
import { ResultBus } from '../result-bus.js';
import { GenerationContextSeal, hashPacket } from '../context-seal.js';
import { AdaptiveContextRuntime } from '../adaptive-context-runtime.js';
import { WorkerDirector } from '../runtime/worker-director.js';
import { EXECUTION_STATUS, LIFECYCLE_STATUS } from '../runtime/constants.js';

const CURRENT_TAVERN='S_TAVERN_CURRENT';
const HISTORICAL_BLADE='S_BLADE_HISTORY';
const UNKNOWN_BLADE='S_BLADE_UNKNOWN';

function hasRef(rows,ref){return (rows??[]).some(row=>row?.ref===ref||row===ref);}
function allCaps(obligations){return [...new Set(obligations.flatMap(x=>x.requiredCapabilities??[]))].sort();}

function compileGatherForFunctionTest(compilerInput,fixtures){
  if(!hasRef(compilerInput.currentWorldState,CURRENT_TAVERN))throw new Error('Compiler bridge did not receive current Tavern state');
  if(!hasRef(compilerInput.historicalState,HISTORICAL_BLADE))throw new Error('Compiler bridge did not receive historical Blade location');
  if(!hasRef(compilerInput.unresolved,UNKNOWN_BLADE))throw new Error('Compiler bridge did not receive unresolved current Blade state');

  const assessments=(compilerInput.truthClassifications??[]).flatMap(x=>x.assessments??[]);
  const conflict=assessments.find(x=>x.classification==='CONFLICTING'&&(x.refs??[]).includes('E_FIRE')&&(x.refs??[]).includes('E_JOURNAL'));
  if(!conflict)throw new Error('Compiler bridge did not receive the competing Blade-fate evidence');

  const byRef=new Map(fixtures.evidenceFixture.candidates.map(x=>[x.ref,x]));
  const fire=byRef.get('E_FIRE');
  const journal=byRef.get('E_JOURNAL');
  const dependencies=[...fixtures.turnEvent.sourceRevisionSet].sort();

  return Object.freeze({
    kind:'CompiledContextPacket',
    id:'packet:function-test-001:integrated',
    query:fixtures.sceneFixture.text,
    intent:'CURRENT',
    representation:'COMPACT',
    current:[
      {e:'EmberTavern',p:'state',v:'destroyed',a:'OBSERVED',cf:1,id:CURRENT_TAVERN},
    ],
    historical:[
      {e:'SunBlade',p:'location',v:'Ember Tavern',a:'SOURCE_CANON',cf:1,id:HISTORICAL_BLADE,t:[null,null,'HISTORICAL']},
    ],
    unresolved:[
      {e:'SunBlade',p:'location',v:'unknown',a:'UNRESOLVED',cf:0,id:UNKNOWN_BLADE,reason:'credible fate conflict leaves current location unresolved'},
      {e:'SunBlade',p:'fate',v:fire.value,a:'UNRESOLVED',cf:conflict.confidence??0,id:'E_FIRE',reason:'credible competing evidence'},
      {e:'SunBlade',p:'fate',v:journal.value,a:'UNRESOLVED',cf:conflict.confidence??0,id:'E_JOURNAL',reason:'credible competing evidence'},
    ],
    provenanceIndex:{
      S_TAVERN_CURRENT:['rev:tavern'],
      S_BLADE_HISTORY:['rev:tavern'],
      S_BLADE_UNKNOWN:dependencies,
      E_FIRE:['rev:fire'],
      E_JOURNAL:['rev:journal'],
    },
    dependencies,
  });
}

async function exerciseRuntime(obligations){
  const director=new WorkerDirector({
    persistence:null,
    capacity:{CPU:4},
    foregroundReserve:{CPU:0},
    batch:{base:1,max:1},
  });

  director.registerWorker({
    workerId:'function-test-runtime-slot',
    capabilities:allCaps(obligations),
    supportedLayers:['L0','L1','L2','L3','L4'],
    resourceProfile:{CPU:1},
    concurrencyCapacity:4,
    latencyScore:1,
    qualityScore:1,
    provider:'deterministic-function-test',
    implementationId:'function-test-runtime-slot',
    foregroundEligible:true,
    backgroundEligible:true,
  });

  for(const obligation of obligations){
    director.submit(obligation,{
      units:[{id:obligation.taskId+':unit:0',payload:{taskId:obligation.taskId}}],
      async execute({units}){return units.map(x=>x.payload);},
      validate({output}){return Array.isArray(output);},
      commit({units}){return{committed:units.length};},
    });
  }

  await director.drain({maxCycles:64});
  const records=director.ledger.list().map(record=>({
    taskId:record.taskId,
    lifecycleStatus:record.lifecycleStatus,
    executionStatus:record.executionStatus,
    completedUnits:record.batch?.completedUnitIds?.length??0,
  }));
  return{records,snapshot:director.snapshot()};
}

function check(name,pass,detail){return{name,pass:Boolean(pass),detail};}

export async function runPhase1FunctionTest001(){
  const fixtures=createFunctionTest001Fixtures();
  const seal=new GenerationContextSeal();
  const activeRevisions=new Set(fixtures.turnEvent.sourceRevisionSet);
  const resultBus=new ResultBus({
    registry:{isActiveRevision:(id)=>activeRevisions.has(id)},
    getWorldRevision:()=>fixtures.turnEvent.worldRevision,
    getSceneRevision:()=>fixtures.turnEvent.sceneRevision,
    isTurnSealed:(turnId)=>seal.isTurnSealed(turnId),
  });
  const delivery=new AdaptiveContextRuntime();

  const sidecar=await runFunctionTestTurn({
    ...fixtures,
    resultBus,
    downstream:{
      compile:(compilerInput)=>compileGatherForFunctionTest(compilerInput,fixtures),
      seal:({turnEvent,compiled,gatherBundle})=>seal.seal({
        turnId:turnEvent.turnId,
        correlationId:turnEvent.correlationId,
        packet:compiled,
        sourceRevisionIds:compiled.dependencies,
        worldRevision:turnEvent.worldRevision,
        sceneRevision:turnEvent.sceneRevision,
        admittedResultIds:gatherBundle.acceptedResultIds,
        rejectedResultIds:gatherBundle.rejectedResultIds,
        staleResultIds:gatherBundle.staleResultIds,
        deadline:turnEvent.deadline,
        sealedAt:gatherBundle.closedAt,
        dependencies:compiled.dependencies,
      }),
      promptPlan:({seal:sealed})=>delivery.deliver({
        sealedPacket:sealed.packet,
        sealReceipt:sealed.receipt,
        generationId:'generation:function-test-001',
        turnId:fixtures.turnEvent.turnId,
        modelProfileId:'CACHE_STABLE',
        systemPolicy:'Area-52 Phase 1 Function Test 001',
        userInput:fixtures.sceneFixture.text,
        contributions:[],
        worldRevision:fixtures.turnEvent.worldRevision,
        sceneRevision:fixtures.turnEvent.sceneRevision,
      }),
    },
  });

  const runtime=await exerciseRuntime(sidecar.runtimeSubmissions);
  const receipt=seal.getReceipt(fixtures.turnEvent.turnId);
  const packet=seal.getPacket(fixtures.turnEvent.turnId);
  const routes=resultBus.results({turnId:fixtures.turnEvent.turnId});
  const lateRoutes=routes.filter(x=>x.route.late);
  const currentFalseLocation=(packet.current??[]).some(x=>x.e==='SunBlade'&&x.p==='location'&&x.v==='Ember Tavern');
  const fateValues=new Set((packet.unresolved??[]).filter(x=>x.e==='SunBlade'&&x.p==='fate').map(x=>x.v));

  const checks=[
    check('Four-worker fan-out',sidecar.fanOutPlan.tasks.length===4,String(sidecar.fanOutPlan.tasks.length)+' tasks planned'),
    check('Foreground quorum closes at 70ms',sidecar.foregroundQuorumReceipt.satisfied&&sidecar.foregroundQuorumReceipt.closedAt===70,'closedAt='+sidecar.foregroundQuorumReceipt.closedAt),
    check('Late Green Room cannot block foreground',sidecar.lateResults.some(x=>x.destination==='NEXT_TURN'),String(sidecar.lateResults.length)+' late result(s)'),
    check('Real Result Bus keeps late work out of foreground',lateRoutes.some(x=>x.route.effectiveDestination==='NEXT_TURN'),String(lateRoutes.length)+' late routed result(s)'),
    check('Current Tavern truth preserved',(packet.current??[]).some(x=>x.id===CURRENT_TAVERN&&x.v==='destroyed'),'Ember Tavern CURRENT=destroyed'),
    check('Historical Blade location preserved',(packet.historical??[]).some(x=>x.id===HISTORICAL_BLADE&&x.v==='Ember Tavern'),'Sun Blade at Tavern is HISTORICAL'),
    check('No false current Blade-at-Tavern state',!currentFalseLocation,'Sun Blade current location is not Tavern'),
    check('Current Blade location remains unresolved',(packet.unresolved??[]).some(x=>x.id===UNKNOWN_BLADE&&x.v==='unknown'),'Sun Blade CURRENT location=unknown'),
    check('Competing Blade fate evidence preserved',fateValues.has('destroyed-in-fire')&&fateValues.has('removed-before-fire'),[...fateValues].join(' vs ')),
    check('Context Seal is immutable',Object.isFrozen(packet)&&receipt?.packetHash===hashPacket(packet),receipt?.packetHash??'no seal receipt'),
    check('Adaptive Context Runtime produces PromptPlan',sidecar.promptPlan?.ok===true&&sidecar.promptPlan?.plan?.contextSealId===receipt?.id,sidecar.promptPlan?.status??'missing'),
    check('Runtime accepts and completes all four obligations',runtime.records.length===4&&runtime.records.every(x=>x.lifecycleStatus===LIFECYCLE_STATUS.SATISFIED&&x.executionStatus===EXECUTION_STATUS.COMPLETE),runtime.records),
  ];

  const pass=checks.every(x=>x.pass);
  return Object.freeze({
    kind:'Area52Phase1FunctionTest001Report',
    pass,
    testId:'FUNCTION_TEST_001',
    title:'One-Key Swarm -> Runtime -> Result Bus -> Gather -> Context Seal -> PromptPlan',
    checks,
    summary:{
      plannedWorkers:sidecar.fanOutPlan.tasks.length,
      foregroundClosedAt:sidecar.foregroundQuorumReceipt.closedAt,
      lateResults:sidecar.lateResults.length,
      resultRoutes:routes.length,
      runtimeTasks:runtime.records.length,
      packetHash:receipt?.packetHash??null,
      promptPlanId:sidecar.promptPlan?.plan?.promptPlanId??null,
    },
    runtime:runtime.records,
    resultRoutes:routes.map(x=>({
      resultId:x.result.id,
      freshness:x.route.freshness,
      late:x.route.late,
      destination:x.route.effectiveDestination,
    })),
    packet,
    promptPlan:sidecar.promptPlan?.plan??null,
  });
}
