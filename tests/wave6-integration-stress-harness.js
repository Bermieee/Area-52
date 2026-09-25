import {FrameworkKernel} from '../src/framework-kernel.js';
import {SubsystemLifecycle} from '../src/framework-contracts.js';
import {inspectServiceReadiness} from '../src/dependency-readiness.js';
import {registerRepresentativePhase1Events,createRepresentativeEvent} from '../src/event-conformance.js';
import {comparePublicContractSnapshots} from '../src/contract-drift-detector.js';
import {Wave6AcceptedContractSnapshots,Wave6MovingContractSnapshots,Wave6CheckpointCatalog} from '../src/wave6-contract-fixtures.js';
import {createIntegrationRehearsalReceipt,createCrossSystemIncidentReceipt} from '../src/integration-rehearsal-contracts.js';
import {classifyKnowledgeEvidenceFreshness,createKnowledgeEvidence,KnowledgeAuthorityOrigin,KnowledgeSourceClass,KnowledgeTemporalStatus} from '../src/knowledge-evidence.js';
import {AuthorityClass} from '../src/contracts.js';
import {createWave6AssemblyRehearsalPlan,resolveIntegrationCheckpoint} from '../src/integration-control-plane.js';
import {RepresentativeWorkloadHarness,RepresentativeWorkloadMetric as M} from '../src/core-function-test-preflight.js';
import {runWave6Acceptance} from './wave6-integration-harness.js';

const manifest=(id,extra={})=>({subsystemId:id,version:'1',owner:'W6_STRESS',lifecycleState:SubsystemLifecycle.EXPERIMENTAL,failureBehavior:{recovery:'WAIT',diagnostics:true},diagnostics:{snapshot:true},...extra});

export function runWave6Stress(){
  const base=runWave6Acceptance();
  const counts={
    eventRegistryValidations:0,contractDriftComparisons:0,dependencyStateTransitions:0,integrationRehearsalTurns:0,
    staleResultCases:0,duplicateEventCases:0,providerFallbackCases:0,assemblyManifestValidations:0,integrationPatchValidations:0,
    diagnosticReconstructions:0,multiTurnFt006ReplaySequences:0,
  };
  let failures=0,staleAdmissions=0,unacceptedHeadAdmissions=0,patchEscapes=0,globalScores=0;

  const events=new FrameworkKernel();registerRepresentativePhase1Events(events.events);
  for(let i=0;i<10000;i++){
    const e=createRepresentativeEvent({eventType:i%2?'TURN_EVENT':'CONTEXT_SEALED',eventId:'stress:event:'+i,dedupeIdentity:'stress:event:'+i,sequence:i+1});
    const r=events.events.validate(e);if(!r.ok)failures++;counts.eventRegistryValidations++;
  }

  for(let i=0;i<5000;i++){
    const accepted=i%2?Wave6AcceptedContractSnapshots.scene:Wave6AcceptedContractSnapshots.coprocessor;
    const current=i%2?Wave6MovingContractSnapshots.scene:Wave6MovingContractSnapshots.coprocessor;
    const r=comparePublicContractSnapshots(accepted,current);if(!r.status)failures++;counts.contractDriftComparisons++;
  }

  const deps=new FrameworkKernel();deps.services.register(manifest('consumer',{optionalDependencies:['optional']}));
  for(let i=0;i<2500;i++){
    deps.services.register(manifest('optional'));if(inspectServiceReadiness(deps,'consumer').state!=='READY')failures++;counts.dependencyStateTransitions++;
    deps.services.unregister('optional');if(inspectServiceReadiness(deps,'consumer').state!=='DEGRADED')failures++;counts.dependencyStateTransitions++;
  }

  for(let i=0;i<5000;i++){
    const lock=resolveIntegrationCheckpoint(i%2?Wave6CheckpointCatalog.scene:Wave6CheckpointCatalog.coprocessor);
    const r=createIntegrationRehearsalReceipt({rehearsalId:'stress:turn:'+i,checkpointRefs:[lock.selectedSha],steps:[{stage:'HostActivity',ref:'turn:'+i},{stage:'Context Seal',ref:'seal:'+i}],packet:{id:'packet:'+i},sealReceipt:{id:'seal:'+i},promptPlan:{promptPlanId:'plan:'+i}});
    if(!lock.ok||r.mainMutationAllowed!==false)failures++;counts.integrationRehearsalTurns++;
  }

  const stale=createKnowledgeEvidence({evidenceId:'stress:stale',artifactRef:{id:'stale'},sourceClass:KnowledgeSourceClass.EPISODIC_MEMORY,authorityClass:AuthorityClass.OBSERVED,authorityOrigin:KnowledgeAuthorityOrigin.CARRIED,sourceAuthorityClass:AuthorityClass.OBSERVED,temporalStatus:KnowledgeTemporalStatus.CURRENT,sourceRevisionRefs:['experience@5'],dependencyRevisionRefs:['episode@5']});
  for(let i=0;i<2000;i++){
    const state=classifyKnowledgeEvidenceFreshness(stale,{activeSourceRevisionRefs:['experience@6'],activeDependencyRevisionRefs:['episode@6']});
    if(state==='FRESH')staleAdmissions++;counts.staleResultCases++;
  }

  for(let i=0;i<2000;i++){
    const id='dup:'+i,event=createRepresentativeEvent({eventType:'TURN_EVENT',eventId:id,dedupeIdentity:id,sequence:20000+i});
    events.events.accept(event);const d=events.events.accept(event);if(!d.duplicate)failures++;counts.duplicateEventCases++;
  }

  for(let i=0;i<2000;i++){
    const bad=base.structured.validator.validate({schemaId:'COPROCESSOR_PRECISION_RESULT_SET',providerId:'A',rawOutput:'{bad'});
    const good=base.structured.validator.validate({schemaId:'COPROCESSOR_PRECISION_RESULT_SET',providerId:'B',rawOutput:{results:[
      {candidateId:'candidate:tavern-current',score:.95,reasonCodes:['QUERY_MATCH'],sourceRevisionRefs:['w3:e3@1'],truthStatus:'CURRENT',authorityClass:'OBSERVED'},
    ],stageSummary:'fallback'}});
    if(bad.canonicalReady||!good.canonicalReady)failures++;counts.providerFallbackCases++;
  }

  for(let i=0;i<2000;i++){
    const record=i%2?Wave6CheckpointCatalog.scene:Wave6CheckpointCatalog.coprocessor;
    const plan=createWave6AssemblyRehearsalPlan({checkpointRecords:[record],originReceipts:[]});
    if(plan.blocked||plan.mainMutationAllowed)failures++;counts.assemblyManifestValidations++;
  }
  const movingScene=resolveIntegrationCheckpoint(Wave6CheckpointCatalog.scene,{refKind:'BRANCH_HEAD'});
  if(movingScene.ok)unacceptedHeadAdmissions++;

  for(let i=0;i<1000;i++){
    const v=base.assembly.registry.validate(base.assembly.patch.patchId,{sourceLane:'SCENE',acceptedSourceSha:Wave6CheckpointCatalog.scene.acceptedCheckpointSha,beforeDigest:'adapter-before',afterDigest:'adapter-after',targetPath:'integration/adapters/scene-runtime-event.js'});
    if(v.state!=='VALID')patchEscapes++;counts.integrationPatchValidations++;
  }

  for(let i=0;i<1000;i++){
    const receipt=createCrossSystemIncidentReceipt({incidentId:'stress:incident:'+i,sceneResult:{resultId:'scene:'+i,sceneRevision:3,freshness:'STALE'},lateOptionalResult:{resultId:'late:'+i,late:true},historicalLore:{evidenceId:'h:'+i,sourceRevisionRefs:['lore@1'],semantic:{predicate:'location',value:'old'}},currentObservedCorrection:{evidenceId:'c:'+i,sourceRevisionRefs:['exp@2'],semantic:{predicate:'location',value:'new'}},sealReceipt:{id:'seal:'+i,sceneRevision:4}});
    if(!receipt.explainable)failures++;counts.diagnosticReconstructions++;
  }

  for(let i=0;i<1000;i++){
    const h=new RepresentativeWorkloadHarness({workloadId:'stress:ft006:'+i});
    for(let t=0;t<3;t++)h.recordTurn({turnId:'stress:ft006:'+i+':'+t,sceneId:t<2?'a':'b',events:t===1?['RELATIONSHIP_PROGRESS']:['SCENE_CONTINUITY'],metrics:{
      [M.CURRENT_STATE_ERRORS]:{state:'REPLAYED',value:0},[M.STALE_ADMISSION]:{state:'REPLAYED',value:0},[M.LATENCY_MS]:{state:'REPLAYED',value:20+t},
    }});
    const report=h.report();if(report.aggregateScore!==null)globalScores++;if(report.turns.length!==3)failures++;counts.multiTurnFt006ReplaySequences++;
  }

  const invariants={
    noFailures:failures===0,
    noStaleAdmission:staleAdmissions===0,
    unacceptedMovingHeadRefused:unacceptedHeadAdmissions===0&&movingScene.ok===false,
    documentedPatchOnly:patchEscapes===0,
    noGlobalRpScore:globalScores===0,
    phase1StillBlocked:base.gate.state==='BLOCKED'&&base.gate.phase2PromotionAllowed===false,
    noMainMutation:base.assembly.plan.mainMutationAllowed===false,
  };
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  return{pass:Object.values(invariants).every(Boolean),counts,total,invariants,failures,staleAdmissions,unacceptedHeadAdmissions,patchEscapes,globalScores};
}
