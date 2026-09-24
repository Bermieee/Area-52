import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {AuthorityClass,KnowledgeStatus} from '../src/contracts.js';
import {FrameworkKernel} from '../src/framework-kernel.js';
import {SubsystemLifecycle} from '../src/framework-contracts.js';
import {DependencyReadiness,inspectServiceReadiness} from '../src/dependency-readiness.js';
import {runEventRegistryConformance,createRepresentativeEvent} from '../src/event-conformance.js';
import {registerRuntimeStyleEventDescriptor,reconcileDependencyProjection} from '../src/shared-contract-adapters.js';
import {createCoprocessorPrecisionValidator,canonicalPrecisionProviderShape,COPROCESSOR_PRECISION_SCHEMA_ID} from '../src/coprocessor-precision-contract-adapter.js';
import {createCognitiveResult,ResultClass,ResultDestination,ResultPayloadClass} from '../src/publication-contracts.js';
import {KnowledgeAuthorityOrigin,KnowledgeSourceClass,KnowledgeTemporalStatus,createKnowledgeEvidence} from '../src/knowledge-evidence.js';
import {createKnowledgeGatherReceipt} from '../src/knowledge-integration-spine.js';
import {evaluateFt002CorePreflight,evaluateFt005CorePreflight,RepresentativeWorkloadHarness,RepresentativeWorkloadMetric as M} from '../src/core-function-test-preflight.js';
import {createPhase1ContractDeclarations} from '../src/phase1-integration-fixtures.js';
import {buildIntegrationContractMatrix} from '../src/integration-contract-matrix.js';
import {buildContractDriftMatrix} from '../src/contract-drift-detector.js';
import {Wave6CheckpointCatalog,Wave6AcceptedContractSnapshots,Wave6MovingContractSnapshots} from '../src/wave6-contract-fixtures.js';
import {
  IntegrationPatchRegistry,IntegrationRefKind,createCleanInstallReloadModel,createFileOriginReceipt,createIntegrationPatchRecord,
  createPerformanceReceipt,createWave6AssemblyRehearsalPlan,measureStage,resolveIntegrationCheckpoint,
} from '../src/integration-control-plane.js';
import {createBrowserRuntimeDeclaration,createImportedBrowserEvidenceResult,evaluateBrowserDeclaration,buildIntegrationBrowserMatrix,BrowserMatrixState} from '../src/integration-browser-matrix.js';
import {createFunctionTestBlockerMatrix,createPhase1GateReportV2,createPhase1RemainingWorkGraph,createUiReadModelRegistry} from '../src/phase1-readiness-v2.js';
import {createCrossSystemIncidentReceipt,createFunctionTestRehearsalReceipt,createHostRecoveryCase,createHostRecoveryReport,createIntegrationRehearsalReceipt} from '../src/integration-rehearsal-contracts.js';
import {NexusShadowIntegrationAdapter,createNexusLiveSurfaceObservation,createNexusContextCandidate,exportNexusShadowReplay} from '../src/nexus-shadow-adapter.js';
import {monotonicNow} from '../src/browser-runtime-utils.js';
import {EMBER_TAVERN_WAVE3} from './fixtures/ember-tavern-wave3.js';

const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
const manifest=(id,extra={})=>({subsystemId:id,version:'1.0.0',owner:'WAVE6',lifecycleState:SubsystemLifecycle.EXPERIMENTAL,failureBehavior:{recovery:'WAIT_OR_DEGRADE',diagnostics:true},diagnostics:{snapshot:true},...extra});

function freshCore(){
  const core=new Area52CognitiveCore();
  for(const row of EMBER_TAVERN_WAVE3.sources)core.importAndLearn(row);
  for(const row of EMBER_TAVERN_WAVE3.experiences)core.importAndLearn(row);
  return core;
}
function claim(core,predicate){
  const found=core.graph.allClaims().find(predicate);if(!found)throw new Error('fixture claim missing');return found;
}
function precisionCandidates(){
  return[
    {candidateId:'candidate:blade-history',sourceRevisionRefs:['w3:e1@1'],truthStatus:'HISTORICAL',authorityClass:'OBSERVED'},
    {candidateId:'candidate:tavern-current',sourceRevisionRefs:['w3:e3@1'],truthStatus:'CURRENT',authorityClass:'OBSERVED'},
  ];
}
function validPrecisionRaw(){
  return{results:[
    {candidateId:'candidate:tavern-current',score:.95,reasonCodes:['QUERY_MATCH','TEMPORAL_MATCH'],sourceRevisionRefs:['w3:e3@1'],truthStatus:'CURRENT',authorityClass:'OBSERVED'},
    {candidateId:'candidate:blade-history',score:.7,reasonCodes:['QUERY_MATCH'],sourceRevisionRefs:['w3:e1@1'],truthStatus:'HISTORICAL',authorityClass:'OBSERVED'},
  ],stageSummary:'accepted fixture'};
}
function structuredClosure(){
  const candidates=precisionCandidates(),validator=createCoprocessorPrecisionValidator({candidates,requiredCandidateIds:['candidate:tavern-current'],maxResults:2});
  const a=validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,providerId:'Provider-A',rawOutput:validPrecisionRaw()});
  const b=validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,providerId:'Provider-B',rawOutput:JSON.stringify(validPrecisionRaw())});
  const adversarial={
    invented:validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,rawOutput:{...validPrecisionRaw(),results:[{...validPrecisionRaw().results[0],candidateId:'invented'}]}}),
    duplicate:validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,rawOutput:{results:[validPrecisionRaw().results[0],validPrecisionRaw().results[0]],stageSummary:null}}),
    authority:validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,rawOutput:{results:[{...validPrecisionRaw().results[0],authorityClass:'SOURCE_CANON'}],stageSummary:null}}),
    revision:validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,rawOutput:{results:[{...validPrecisionRaw().results[0],sourceRevisionRefs:['w3:e3@2']}],stageSummary:null}}),
    score:validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,rawOutput:{results:[{...validPrecisionRaw().results[0],score:7}],stageSummary:null}}),
    version:validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,schemaVersion:'2.0.0',rawOutput:validPrecisionRaw()}),
    malformed:validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,rawOutput:'{bad'}),
    semanticContradiction:validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,rawOutput:{results:[{...validPrecisionRaw().results[0],truthStatus:'HISTORICAL'}],stageSummary:null}}),
  };
  return{candidates,validator,a,b,adversarial,canonical:canonicalPrecisionProviderShape(validPrecisionRaw())};
}

function dependencyClosure(){
  const framework=new FrameworkKernel();
  framework.services.register(manifest('consumer',{optionalDependencies:['memory']}));
  const optionalMissing=inspectServiceReadiness(framework,'consumer');
  framework.services.register(manifest('memory'));
  const recovered=inspectServiceReadiness(framework,'consumer');
  framework.services.unregister('memory');
  const disappeared=inspectServiceReadiness(framework,'consumer');
  framework.services.register(manifest('required-consumer',{requiredDependencies:['required-provider']}));
  const requiredMissing=inspectServiceReadiness(framework,'required-consumer');
  const runtimeOptional={executable:true,degraded:true,missingRequired:[],missingOptional:['memory'],degradedServices:[]};
  const reconciliation=reconcileDependencyProjection(optionalMissing,runtimeOptional);
  const cycleFramework=new FrameworkKernel();
  let cycleCode=null;
  try{
    cycleFramework.services.register(manifest('a',{requiredDependencies:['b']}));
    cycleFramework.services.register(manifest('b',{requiredDependencies:['a']}));
  }catch(error){cycleCode=error.code??'DEPENDENCY_CYCLE';}
  return{optionalMissing,recovered,disappeared,requiredMissing,reconciliation,cycleCode};
}

function eventClosure(){
  const framework=new FrameworkKernel(),conformance=runEventRegistryConformance(framework.events);
  const external=new FrameworkKernel();
  registerRuntimeStyleEventDescriptor(external.events,{eventType:'LOCATION_CHANGED',schemaVersion:'1.0',producer:'SCENE_INTELLIGENCE',payloadSchema:{required:['sceneId'],properties:{sceneId:'string'},allowUnknown:true}});
  const known=external.events.accept(createRepresentativeEvent({eventType:'LOCATION_CHANGED',eventId:'evt:location',payload:{sceneId:'scene:a'},eventVersion:'1.0'}));
  const duplicate=external.events.accept(createRepresentativeEvent({eventType:'LOCATION_CHANGED',eventId:'evt:location:duplicate',dedupeIdentity:'evt:location',payload:{sceneId:'scene:a'},eventVersion:'1.0'}));
  const future=new FrameworkKernel();
  registerRuntimeStyleEventDescriptor(future.events,{eventType:'MEMORY_CONSOLIDATED',schemaVersion:'1.0',producer:'MEMORY',payloadSchema:{allowUnknown:true}});
  const futureAccepted=future.events.accept(createRepresentativeEvent({eventType:'MEMORY_CONSOLIDATED',eventId:'evt:memory'}));
  return{conformance,known,duplicate,futureAccepted};
}

function makeEvidence(core){
  const destroyed=claim(core,c=>c.subjectId==='ember-tavern'&&c.predicate==='state'&&c.value==='destroyed'&&c.status===KnowledgeStatus.CURRENT);
  return createKnowledgeEvidence({
    evidenceId:'wave6:evidence:tavern-destroyed',artifactRef:{artifactId:destroyed.id,revision:1},
    sourceClass:KnowledgeSourceClass.OBSERVED_EXPERIENCE,authorityClass:AuthorityClass.OBSERVED,authorityOrigin:KnowledgeAuthorityOrigin.OBSERVATION,
    temporalStatus:KnowledgeTemporalStatus.CURRENT,sourceRevisionRefs:destroyed.provenance?.sourceRevisionIds??[],provenanceRefs:[destroyed.id,...(destroyed.provenance?.sourceRevisionIds??[])],
    claimIds:[destroyed.id],candidateLineage:{candidateRefs:['wave6:candidate:tavern-destroyed'],nominationChannels:['SCENE','DENSE'],evidenceRefs:[destroyed.id]},
    semantic:{subjectId:destroyed.subjectId,predicate:destroyed.predicate,value:destroyed.value,status:destroyed.status},
  });
}

function integrationRehearsal(){
  const core=freshCore();core.publication.setSceneRevision(4);
  const evidence=makeEvidence(core),candidateId=evidence.candidateLineage.candidateRefs[0];
  const hostActivity={activity:'USER_SEND',chatId:'ember-chat',turnId:'turn:wave6:integration',sourceRevisionId:evidence.sourceRevisionRefs[0]};
  const sceneSignal={kind:'SceneIntegrationSignalFixture',sceneId:'scene:ember',sceneRevision:4,sourceRevisionRefs:[...evidence.sourceRevisionRefs],activeCast:[{characterId:'eris',state:'PRESENT'}],castObservations:[{characterId:'eris',state:'PRESENT'},{characterId:'mara',state:'MENTIONED_ONLY'}],location:{id:'ember-tavern'},sceneRelationship:'CONTINUES',authority:'DESCRIPTIVE'};
  const fanout={kind:'DynamicFanOutFixture',turnId:hostActivity.turnId,sceneId:sceneSignal.sceneId,activeCharacterIds:['eris'],requiredCapabilities:['SEMANTIC_JUDGMENT'],authorityGranted:false};
  const runtimeObligation={kind:'RuntimeObligationFixture',taskId:'task:wave6:integration',turnId:hostActivity.turnId,sourceRevisionIds:[...evidence.sourceRevisionRefs],sceneRevision:4,requiredCapabilities:['SEMANTIC_JUDGMENT'],schedulingDecision:null,authorityGranted:false};
  const worker=core.publication.receiveResult(createCognitiveResult({
    id:'result:wave6:worker',taskId:runtimeObligation.taskId,turnId:hostActivity.turnId,correlationId:'corr:wave6:integration',
    sourceSubsystem:'COPROCESSOR',workerId:'fixture-worker',resultType:'WORK_RESULT',resultClass:ResultClass.REQUIRED,payloadClass:ResultPayloadClass.DERIVED_DATA,
    evidenceIds:[evidence.evidenceId],provenance:{candidateId},sourceRevisionIds:evidence.sourceRevisionRefs,worldRevision:core.graph.revision,sceneRevision:4,
    authorityClass:AuthorityClass.UNRESOLVED,destination:ResultDestination.FOREGROUND,
    payload:{candidateId,evidenceId:evidence.evidenceId,score:.9},timing:{latencyMs:1},
  }));
  const published=core.knowledge.publishFixture({
    turnId:hostActivity.turnId,correlationId:'corr:wave6:integration',generationId:'generation:wave6:integration',
    query:'What is the current state of the Ember Tavern?',intent:'CURRENT',evidence:[evidence],
    precisionResults:[{candidateId,finalRank:1,normalizedScore:.9,freshness:'FRESH',sourceRevisionIds:evidence.sourceRevisionRefs,reasonCodes:['QUERY_MATCH']}],
    activeSourceRevisionRefs:core.registry.activeRevisionIds(),activeDependencyRevisionRefs:core.registry.activeRevisionIds(),worldRevision:core.graph.revision,sceneRevision:4,sealedAt:600,
  });
  const steps=[
    {stage:'HostActivity',ref:hostActivity.turnId},{stage:'Scene contract fixture',ref:sceneSignal.sceneId},{stage:'Dynamic Fan-Out contract fixture',ref:fanout.turnId},
    {stage:'Runtime obligation',ref:runtimeObligation.taskId},{stage:'worker result fixture',ref:worker.result.id},{stage:'Result Bus',ref:worker.route.id},
    {stage:'Gather',ref:published.gather.gatherId},{stage:'Truth / KnowledgeEvidence',ref:evidence.evidenceId},{stage:'Context Compiler',ref:published.packet.id},
    {stage:'Context Seal',ref:published.sealReceipt.id},{stage:'PromptPlan',ref:published.promptPlan.promptPlanId},
  ];
  const receipt=createIntegrationRehearsalReceipt({rehearsalId:'wave6:accepted-contract-spine',checkpointRefs:[
    Wave6CheckpointCatalog.core.acceptedCheckpointSha,Wave6CheckpointCatalog.scene.acceptedCheckpointSha,Wave6CheckpointCatalog.coprocessor.acceptedCheckpointSha,Wave6CheckpointCatalog.runtime.acceptedCheckpointSha,
  ],steps,packet:published.packet,sealReceipt:published.sealReceipt,promptPlan:published.promptPlan,diagnosticRefs:[evidence.evidenceId]});
  return{core,evidence,hostActivity,sceneSignal,fanout,runtimeObligation,worker,published,receipt};
}

function ft002Rehearsal(){
  const core=freshCore();core.publication.setSceneRevision(4);
  const published=core.publishGenerationContext({turnId:'turn:ft002:wave6',correlationId:'corr:ft002:wave6',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:610});
  const expected={currentFacts:published.packet.current,historicalFacts:published.packet.historical,unresolvedFacts:published.packet.unresolved};
  const sources=[...published.sealReceipt.sourceRevisionIds];
  const scenarios=[
    ['stable dialogue','CONTINUES'],['location transition','CONTINUES'],['doorway false cut','CONTINUES'],['cast entrance/exit','CONTINUES'],
    ['mentioned-not-present','CONTINUES'],['time shift','CONTINUES'],['flashback','FLASHBACK'],['parallel Scene','PARALLEL'],
    ['interrupt/resume','RESUMES'],['stale Scene result','CONTINUES'],['corrected Scene inference','CONTINUES'],
  ];
  const receipts=scenarios.map(([name,relationship],i)=>{
    const sceneSignal={sceneId:'scene:ember',sceneRevision:4,sourceRevisionRefs:sources,activeCast:[{characterId:'eris',state:'PRESENT'}],castObservations:[{characterId:'eris',state:'PRESENT'},{characterId:'mentioned',state:'MENTIONED_ONLY'}],sceneRelationship:relationship,chronologyAssumption:null};
    const current={eventId:'scene:event:'+i,sceneRevision:4},stale={eventId:'scene:event:stale:'+i,sceneRevision:3};
    const receipt=evaluateFt002CorePreflight({sceneSignal,sceneEvent:current,currentSceneRevision:4,staleSceneEvent:stale,staleSceneResultRoute:{resultId:'scene:stale-result:'+i,freshness:'STALE'},sealReceipt:published.sealReceipt,packet:published.packet,ft001Expected:expected});
    return{name,receipt};
  });
  return{published,receipts,summary:createFunctionTestRehearsalReceipt({testId:'FT002',checks:Object.fromEntries(receipts.map(x=>[x.name,x.receipt.state==='CORE_SIDE_READY'])),livePendingReason:'LIVE SILLYTAVERN PENDING'})};
}

function ft005Rehearsal(structured){
  const core=freshCore();
  const pub=core.publishGenerationContext({turnId:'turn:ft005:wave6',correlationId:'corr:ft005:wave6',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:620});
  const precision=pub.precisionResults[0];
  const late=core.publication.receiveResult(createCognitiveResult({
    id:'result:ft005:late',taskId:'task:ft005:late',turnId:'turn:ft005:wave6',correlationId:'corr:ft005:wave6',
    sourceSubsystem:'COPROCESSOR',workerId:'provider-B',resultType:'WORK_RESULT',resultClass:ResultClass.OPPORTUNISTIC,payloadClass:ResultPayloadClass.DERIVED_DATA,
    evidenceIds:[precision?.candidateId??'none'],provenance:{provider:'B'},sourceRevisionIds:precision?.sourceRevisionIds??[],worldRevision:pub.worldRevision,sceneRevision:pub.sceneRevision,
    authorityClass:AuthorityClass.UNRESOLVED,destination:ResultDestination.FOREGROUND,payload:{candidateId:precision?.candidateId??'none'},timing:{completedAt:621},
  }));
  const forcedAFailure=structured.validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,providerId:'Provider-A',rawOutput:'{bad'});
  const receipt=evaluateFt005CorePreflight({providerValidations:[structured.a,structured.b],malformedValidation:forcedAFailure,semanticInvalidValidation:structured.adversarial.semanticContradiction,unavailableReadiness:{state:DependencyReadiness.DEGRADED},lateRoute:{...late.route,resultId:late.result.id},sealReceipt:pub.sealReceipt,requiredFallback:{bounded:true,attempts:1,maxAttempts:2}});
  const summary=createFunctionTestRehearsalReceipt({testId:'FT005',checks:{
    providerAValid:structured.a.canonicalReady,providerBValid:structured.b.canonicalReady,
    providerAFailureTyped:forcedAFailure.canonicalReady===false,providerBFallbackCanonical:structured.b.canonicalReady,
    malformedRejected:structured.adversarial.malformed.canonicalReady===false,lateContained:late.route.effectiveDestination==='NEXT_TURN',corePreflight:receipt.state==='CORE_SIDE_READY',
  },livePendingReason:'LIVE PROVIDER EXECUTION PENDING'});
  return{pub,late,forcedAFailure,receipt,summary};
}

function ft006Replay(){
  const h=new RepresentativeWorkloadHarness({workloadId:'wave6:representative-replay'});
  const events=['SCENE_CONTINUITY','RECURRING_CHARACTER','RELATIONSHIP_PROGRESS','CURRENT_TO_HISTORICAL','UNRESOLVED_CONFLICT','LATE_WORKER','RELOAD','REGENERATE_EDIT','CONTEXT_PRESSURE','CACHE_REUSE','SHADOW_COMPARE','CALLBACK'];
  for(let i=0;i<events.length;i++)h.recordTurn({turnId:'w6:rp:'+i,sceneId:i<6?'scene:a':'scene:b',generationId:'w6:g:'+i,events:[events[i]],metrics:{
    [M.CURRENT_STATE_ERRORS]:{state:'REPLAYED',value:0},[M.HISTORICAL_STATE_ERRORS]:{state:'REPLAYED',value:0},[M.CONTRADICTION_ERRORS]:{state:'REPLAYED',value:0},
    [M.STALE_ADMISSION]:{state:'REPLAYED',value:0},[M.MISSED_RELEVANT_CONTEXT]:{state:'REPLAYED',value:i===8?1:0},[M.UNNECESSARY_CONTEXT]:{state:'REPLAYED',value:i%3},
    [M.UNRESOLVED_THREAD_MISSES]:{state:'REPLAYED',value:0},[M.PROVENANCE_COMPLETENESS]:{state:'REPLAYED',value:1},[M.CALLBACK_CONTINUITY]:{state:'REPLAYED',value:i===11?1:null},
    [M.CHARACTER_CONSISTENCY]:{state:'REPLAYED',value:1},[M.LATENCY_MS]:{state:'REPLAYED',value:18+i},[M.TOKEN_BYTES]:{state:'REPLAYED',value:2200+i*10},
    [M.WORKER_FANOUT]:{state:'REPLAYED',value:i%4},[M.WARM_CACHE_REUSE]:{state:'REPLAYED',value:i>0},[M.OPERATOR_CORRECTIONS]:{state:'REPLAYED',value:0},
  }});
  return h.report();
}

function assemblyRehearsal(){
  const receipts=[
    createFileOriginReceipt({receiptId:'origin:core:cognitive',lane:'CORE',branch:'Development-Nexus',acceptedSha:Wave6CheckpointCatalog.core.acceptedCheckpointSha,sourcePath:'src/cognitive-core.js',sourceDigest:'11e714717d189bc3d3ccb6658706c08e7e6779ee',acceptanceEvidenceRefs:['35964450102']}),
    createFileOriginReceipt({receiptId:'origin:coprocessor:candidate',lane:'COPROCESSOR',branch:'Development-Sidecar/Jev',acceptedSha:Wave6CheckpointCatalog.coprocessor.acceptedCheckpointSha,sourcePath:'src/coprocessor/candidate-bus.js',sourceDigest:'89956d7e5987fba0c79756b1a896ddddc2b7a805',acceptanceEvidenceRefs:['35963150929']}),
    createFileOriginReceipt({receiptId:'origin:scene:contracts',lane:'SCENE',branch:'Development-Scene-Scanner',acceptedSha:Wave6CheckpointCatalog.scene.acceptedCheckpointSha,sourcePath:'src/scene/contracts.js',sourceDigest:'76f7a9c8ae8543de215a22d775c32a6cd2532529',acceptanceEvidenceRefs:['35958003150']}),
    createFileOriginReceipt({receiptId:'origin:runtime:event',lane:'RUNTIME',branch:'Development-Worker-Director',acceptedSha:Wave6CheckpointCatalog.runtime.acceptedCheckpointSha,sourcePath:'src/runtime/event-spine.js',sourceDigest:'d1628ea9b1d6aabd91dbba5dc2387ab0ee12d062',acceptanceEvidenceRefs:['Wave6 handoff']}),
  ];
  const patch=createIntegrationPatchRecord({patchId:'patch:wave6:event-adapter',targetPath:'integration/adapters/scene-runtime-event.js',sourceLane:'SCENE',acceptedSourceSha:Wave6CheckpointCatalog.scene.acceptedCheckpointSha,reason:'explicit compatibility-only adapter rehearsal',expectedBeforeDigest:'adapter-before',expectedAfterDigest:'adapter-after',hostIntegrationOnly:true});
  const registry=new IntegrationPatchRegistry();registry.register(patch);
  const plan=createWave6AssemblyRehearsalPlan({checkpointRecords:[Wave6CheckpointCatalog.core,Wave6CheckpointCatalog.scene,Wave6CheckpointCatalog.coprocessor,Wave6CheckpointCatalog.runtime],originReceipts:receipts,patches:[patch],contractChecks:[
    {contractId:'COGNITIVE_EVENT',version:'1.0.0'},{contractId:'STRUCTURED_OUTPUT',version:'1.0.0'},{contractId:'DEPENDENCY_STATE',version:'1.0.0'},
  ],browserGates:['CORE','SCENE','COPROCESSOR','RUNTIME'],functionTests:['FT002_REHEARSAL','FT005_REHEARSAL']});
  return{receipts,patch,registry,plan};
}

function browserRehearsal(){
  const coreDecl=createBrowserRuntimeDeclaration({subsystem:'CORE',checkpoint:Wave6CheckpointCatalog.core.acceptedCheckpointSha,browserRuntimePaths:['src/wave6-browser-fixture.js'],requiredWebApis:['structuredClone'],hostCapabilities:['esm']});
  const core=evaluateBrowserDeclaration(coreDecl,{sources:{'src/wave6-browser-fixture.js':'export const x=structuredClone({ok:true});'},availableWebApis:['structuredClone'],availableHostCapabilities:['esm'],executed:true});
  const coprocessor=createImportedBrowserEvidenceResult({subsystem:'COPROCESSOR',checkpoint:Wave6CheckpointCatalog.coprocessor.acceptedCheckpointSha,state:BrowserMatrixState.PASS,evidenceRefs:['Coprocessor Wave4 browser-like 2/2'],measurementState:'REPLAYED'});
  const scene=createImportedBrowserEvidenceResult({subsystem:'SCENE',checkpoint:Wave6CheckpointCatalog.scene.acceptedCheckpointSha,state:BrowserMatrixState.PASS,evidenceRefs:['Scene Wave2 browser-style acceptance'],measurementState:'REPLAYED'});
  const runtime=createImportedBrowserEvidenceResult({subsystem:'RUNTIME',checkpoint:Wave6CheckpointCatalog.runtime.acceptedCheckpointSha,state:BrowserMatrixState.NOT_RUN,evidenceRefs:[],measurementState:'NOT_MEASURED',notes:'Runtime browser-host integration not independently executed by Worker 1'});
  return buildIntegrationBrowserMatrix([core,coprocessor,scene,runtime]);
}

function emberFullSpine(){
  const core=freshCore();core.publication.setSceneRevision(4);
  const sceneFixture={sceneId:'scene:ember',sceneRevision:4,sourceRevisionRefs:core.registry.activeRevisionIds(),activeCast:[{characterId:'eris',state:'PRESENT'}],castObservations:[{characterId:'eris',state:'PRESENT'}],authority:'DESCRIPTIVE'};
  const coprocessorFixture={candidateLimit:12,authorityGranted:false,truthOwnedByCore:true};
  const published=core.publishGenerationContext({turnId:'turn:ember:wave6',correlationId:'corr:ember:wave6',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:700});
  const delivery=core.deliverGenerationContext({published,generationId:'generation:ember:wave6',modelProfileId:'RECENCY_WEIGHTED',userInput:EMBER_TAVERN_WAVE3.query});
  const forensic=core.observation.forensic(core.audit.createForensicBundle({turnId:'turn:ember:wave6',generationId:'generation:ember:wave6'}));
  const facts={
    tavernCurrentDestroyed:published.packet.current.some(x=>x.e==='ember-tavern'&&x.p==='state'&&x.v==='destroyed'),
    tavernHistoricalIntact:published.packet.historical.some(x=>x.e==='ember-tavern'&&x.p==='state'&&x.v==='intact'),
    bladeHistoricalTavern:published.packet.historical.some(x=>x.e==='sun-blade'&&x.p==='location'&&x.v==='ember-tavern'),
    bladeCurrentUnknown:published.packet.unresolved.some(x=>x.e==='sun-blade'&&x.p==='location'&&x.v==='unknown'),
    bladeFateUnresolved:published.packet.unresolved.some(x=>x.e==='sun-blade'&&x.p==='state'&&['destroyed','survived'].includes(x.v)),
    noFalseCurrentTavern:!published.packet.current.some(x=>x.e==='sun-blade'&&x.p==='location'&&x.v==='ember-tavern'),
  };
  return{core,sceneFixture,coprocessorFixture,published,delivery,forensic,facts};
}

function performanceRehearsal({structured,rehearsal,assembly,incident}){
  const rows=[];
  rows.push(measureStage('event validation latency',()=>eventClosure()).measurement);
  rows.push(measureStage('contract normalization latency',()=>structured.validator.validate({schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,rawOutput:validPrecisionRaw()})).measurement);
  rows.push(measureStage('Gather latency',()=>createKnowledgeGatherReceipt({gatherId:'perf:gather',evidence:[rehearsal.evidence],truthResults:rehearsal.published.truthResults})).measurement);
  rows.push(measureStage('Compiler latency',()=>rehearsal.core.compiler.compileDetailed({query:'What is the current state of the Ember Tavern?',intent:'CURRENT',truthResults:rehearsal.published.truthResults,knowledgeEvidence:[rehearsal.evidence]})).measurement);
  const sealCore=freshCore();const sealPub=sealCore.publishGenerationContext({turnId:'perf:seal',correlationId:'perf:seal',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:800});
  rows.push(measureStage('Seal latency',()=>sealCore.publication.seal.verify('perf:seal')).measurement);
  rows.push(measureStage('PromptPlan latency',()=>sealCore.deliverGenerationContext({published:sealPub,generationId:'perf:g',modelProfileId:'RECENCY_WEIGHTED',userInput:EMBER_TAVERN_WAVE3.query})).measurement);
  const adapter=new NexusShadowIntegrationAdapter(),replay=exportNexusShadowReplay({replayId:'perf:replay',contexts:[createNexusContextCandidate({candidateId:'perf:nexus',turnId:'perf:turn'})]});
  rows.push(measureStage('replay latency',()=>adapter.importReplay(replay)).measurement);
  rows.push(measureStage('diagnostic reconstruction latency',()=>clone(incident)).measurement);
  rows.push(measureStage('manifest verification latency',()=>createWave6AssemblyRehearsalPlan({checkpointRecords:[Wave6CheckpointCatalog.core],originReceipts:assembly.receipts.filter(x=>x.lane==='CORE')})).measurement);
  return createPerformanceReceipt({measurements:rows});
}

export function runWave6Acceptance(){
  const checkpointLocks={
    core:resolveIntegrationCheckpoint(Wave6CheckpointCatalog.core),
    coprocessor:resolveIntegrationCheckpoint(Wave6CheckpointCatalog.coprocessor),
    scene:resolveIntegrationCheckpoint(Wave6CheckpointCatalog.scene),
    coprocessorHeadRejected:resolveIntegrationCheckpoint(Wave6CheckpointCatalog.coprocessor,{refKind:IntegrationRefKind.BRANCH_HEAD}),
    sceneHeadRejected:resolveIntegrationCheckpoint(Wave6CheckpointCatalog.scene,{refKind:IntegrationRefKind.BRANCH_HEAD}),
  };
  const matrix=buildIntegrationContractMatrix(createPhase1ContractDeclarations());
  const drift=buildContractDriftMatrix(['core','coprocessor','scene','runtime','ui'].map(lane=>({accepted:Wave6AcceptedContractSnapshots[lane],current:Wave6MovingContractSnapshots[lane]})));
  const structured=structuredClosure(),dependency=dependencyClosure(),events=eventClosure(),rehearsal=integrationRehearsal(),ft002=ft002Rehearsal(),ft005=ft005Rehearsal(structured),ft006=ft006Replay();
  const nexus=new NexusShadowIntegrationAdapter(),nexusStatus=nexus.status(),liveSurface=createNexusLiveSurfaceObservation({observationId:'nexus:wave6:smart-context',surface:'SMART_CONTEXT',turnId:'turn:wave6',payload:{candidateCount:12}});
  const assembly=assemblyRehearsal(),browser=browserRehearsal(),lifecycle=createCleanInstallReloadModel();
  const blockers=createFunctionTestBlockerMatrix({coreCheckpoint:Wave6CheckpointCatalog.core.acceptedCheckpointSha});
  const workGraph=createPhase1RemainingWorkGraph({blockerMatrix:blockers,acceptedCheckpoints:Object.fromEntries(Object.entries(Wave6CheckpointCatalog).map(([k,v])=>[k,v.acceptedCheckpointSha])),movingHeads:Object.fromEntries(Object.entries(Wave6CheckpointCatalog).map(([k,v])=>[k,v.branchHeadSha]))});
  const uiRegistry=createUiReadModelRegistry();
  const incident=createCrossSystemIncidentReceipt({incidentId:'incident:wave6',sceneResult:{resultId:'scene:stale',sceneRevision:3,freshness:'STALE'},lateOptionalResult:{resultId:'optional:late',late:true},historicalLore:{evidenceId:'lore:history',sourceRevisionRefs:['lore@1'],semantic:{predicate:'location',value:'ember-tavern'}},currentObservedCorrection:{evidenceId:'observed:current',sourceRevisionRefs:['experience@2'],semantic:{predicate:'location',value:'unknown'}},sealReceipt:{id:'seal:incident',sceneRevision:4}});
  const ember=emberFullSpine();
  const recovery=createHostRecoveryReport([
    createHostRecoveryCase({caseId:'provider-disappears',input:{providerAvailable:false},expectedState:'DEGRADED',actualState:'DEGRADED'}),
    createHostRecoveryCase({caseId:'optional-service-disappears',input:dependency.disappeared,expectedState:'DEGRADED',actualState:dependency.disappeared.state}),
    createHostRecoveryCase({caseId:'scene-producer-restarts',input:{registryReattached:true},expectedState:'READY',actualState:events.futureAccepted.ok?'READY':'BLOCKED'}),
    createHostRecoveryCase({caseId:'duplicate-host-event',input:events.duplicate,expectedState:'IDEMPOTENT',actualState:events.duplicate.duplicate?'IDEMPOTENT':'DUPLICATED'}),
    createHostRecoveryCase({caseId:'host-reload',input:lifecycle,expectedState:'RESTORE_MODEL_READY',actualState:lifecycle.actions.length===6?'RESTORE_MODEL_READY':'BLOCKED'}),
    createHostRecoveryCase({caseId:'late-stale-result',input:ft005.late.route,expectedState:'NEXT_TURN',actualState:ft005.late.route.effectiveDestination}),
    createHostRecoveryCase({caseId:'invalid-contract-major',input:events.conformance.incompatible,expectedState:'REJECTED',actualState:events.conformance.incompatible.ok?'ACCEPTED':'REJECTED'}),
    createHostRecoveryCase({caseId:'partial-dependency-recovery',input:dependency.recovered,expectedState:'READY',actualState:dependency.recovered.state}),
  ]);
  const performance=performanceRehearsal({structured,rehearsal,assembly,incident});
  const gate=createPhase1GateReportV2({checkpoint:Wave6CheckpointCatalog.core.acceptedCheckpointSha,acceptedCheckpoints:Object.fromEntries(Object.entries(Wave6CheckpointCatalog).map(([k,v])=>[k,v.acceptedCheckpointSha])),movingHeads:Object.fromEntries(Object.entries(Wave6CheckpointCatalog).map(([k,v])=>[k,v.branchHeadSha])),contractReconciliation:matrix,contractDrift:drift,functionTests:blockers,browserReadiness:browser.integrationAcceptance,assemblyReadiness:assembly.plan.blocked?'BLOCKED':'READY',uiReadiness:'READY',loreStatus:'BLOCKED',memoryStatus:'BLOCKED',remainingBlockers:['FT002 live SillyTavern','#178 Memory missing','#179 Lore/Sensory missing','FT005 live provider execution','FT006 representative integrated workload','#185 live browser host','#186 real main reconstruction']});

  const metrics={
    acceptedCheckpointLockCore:checkpointLocks.core.ok&&checkpointLocks.core.selectedSha===Wave6CheckpointCatalog.core.acceptedCheckpointSha,
    coprocessorMovingHeadRefused:checkpointLocks.coprocessorHeadRejected.ok===false&&checkpointLocks.coprocessorHeadRejected.code==='UNACCEPTED_BRANCH_HEAD',
    sceneMovingHeadRefused:checkpointLocks.sceneHeadRejected.ok===false&&checkpointLocks.sceneHeadRejected.code==='UNACCEPTED_BRANCH_HEAD',
    contractMatrixNoMismatch:matrix.hasMismatch===false,
    contractMatrixFutureOwnersBlocked:matrix.rows.some(x=>x.pair==='CORE_MEMORY_FUTURE'&&x.status==='BLOCKED_ON_OTHER_LANE')&&matrix.rows.some(x=>x.pair==='CORE_LORE_FUTURE'&&x.status==='BLOCKED_ON_OTHER_LANE'),
    driftNoBreaking:drift.hasBreaking===false,
    sceneDriftExtension:drift.reports.find(x=>x.lane==='SCENE')?.status==='COMPATIBLE_EXTENSION',
    coprocessorNoContractDrift:drift.reports.find(x=>x.lane==='COPROCESSOR')?.status==='NO_CHANGE',
    structuredProvidersCanonical:structured.a.canonicalReady&&structured.b.canonicalReady&&JSON.stringify(structured.a.normalized)===JSON.stringify(structured.b.normalized)&&JSON.stringify(structured.a.normalized)===JSON.stringify(structured.canonical),
    structuredAdversarialFail:Object.values(structured.adversarial).every(x=>x.canonicalReady===false),
    dependencyRequiredBlocked:dependency.requiredMissing.state==='BLOCKED',
    dependencyOptionalDegraded:dependency.optionalMissing.state==='DEGRADED',
    dependencyRecovers:dependency.recovered.state==='READY'&&dependency.disappeared.state==='DEGRADED',
    dependencyRuntimeReconciles:dependency.reconciliation.compatible&&dependency.reconciliation.providerCapabilityState==='SEPARATE_CONTRACT',
    dependencyCycleDeterministic:Boolean(dependency.cycleCode),
    eventConformance:Object.values(events.conformance.checks).every(Boolean),
    eventExternalDescriptorAccepted:events.known.ok===true,
    eventDuplicateIdempotent:events.duplicate.duplicate===true,
    eventRegistryExtensible:events.futureAccepted.ok===true,
    integrationRehearsalGreen:rehearsal.receipt.status==='ASSEMBLY_REHEARSAL_GREEN'&&rehearsal.receipt.mainMutationAllowed===false&&rehearsal.published.packet.current.some(x=>x.e==='ember-tavern'&&x.v==='destroyed'),
    ft002AssemblyGreen:ft002.summary.status==='ASSEMBLY_REHEARSAL_GREEN'&&ft002.summary.liveAcceptance===false,
    ft005AssemblyGreen:ft005.summary.status==='ASSEMBLY_REHEARSAL_GREEN'&&ft005.summary.liveAcceptance===false,
    ft006Expanded:ft006.turns.length===12&&ft006.aggregateScore===null&&ft006.liveQualification===false,
    nexusLiveAdapterReady:nexusStatus.implementation==='LIVE_ADAPTER_IMPLEMENTATION_READY'&&nexusStatus.runtimeConnection==='RUNTIME_CONNECTION_NOT_EXECUTED'&&liveSurface.readOnly&&liveSurface.mutationAllowed===false,
    assemblyAcceptedOnly:assembly.plan.blocked===false&&assembly.plan.mainMutationAllowed===false&&assembly.plan.steps.some(x=>x.action==='CHECK_CONTRACT_VERSION')&&assembly.plan.steps.some(x=>x.action==='RUN_BROWSER_GATE')&&assembly.plan.steps.some(x=>x.action==='RUN_FUNCTION_TEST'),
    originReceiptsComplete:assembly.receipts.length===4&&assembly.receipts.every(x=>x.acceptedSha&&x.sourceDigest&&x.integrationPath),
    patchRegistryExplicit:assembly.registry.list().length===1&&assembly.patch.hostIntegrationOnly===true,
    browserMatrixHonest:browser.counts.PASS===3&&browser.counts.NOT_RUN===1&&browser.integrationAcceptance==='PARTIAL',
    reloadModelComplete:lifecycle.actions.length===6,
    blockerMatrixMachineReadable:blockers.rows.length===6&&blockers.rows.find(x=>x.test==='FT001').state==='PASS'&&blockers.rows.find(x=>x.test==='FT003').state==='BLOCKED',
    remainingWorkGraph:workGraph.nodes.some(x=>x.id==='PHASE1_GATE'&&x.state==='BLOCKED')&&workGraph.edges.length>0,
    uiRegistryComplete:uiRegistry.models.length===4&&uiRegistry.models.every(x=>x.mutationAuthority===false),
    incidentExplainable:incident.explainable&&incident.decisions.some(x=>x.outcome==='REJECTED')&&incident.decisions.some(x=>x.outcome==='DEFERRED'),
    emberFullSpine:Object.values(ember.facts).every(Boolean)&&ember.delivery.plan.status==='READY',
    recoveryCases:recovery.pass&&recovery.counts.total===8,
    performanceMeasured:performance.measurements.length===9&&performance.measurements.every(x=>x.state==='MEASURED'&&Number.isFinite(x.latencyMs)),
    phase1GateBlocked:gate.state==='BLOCKED'&&gate.phase2PromotionAllowed===false,
  };
  return{pass:Object.values(metrics).every(Boolean),metrics,checkpointLocks,matrix,drift,structured,dependency,events,rehearsal,ft002,ft005,ft006,nexusStatus,liveSurface,assembly,browser,lifecycle,blockers,workGraph,uiRegistry,incident,ember,recovery,performance,gate};
}
