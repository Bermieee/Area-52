import {runWave3PublicationGoldenWorld} from './wave3-golden-harness.js';
import {ResultClass,ResultDestination,ResultPayloadClass,createCognitiveResult} from '../src/publication-contracts.js';
import {ContributionSource,PromptSlot} from '../src/adaptive-context-contracts.js';
import {CognitiveTransactionType,FidelityStatus} from '../src/cognitive-audit.js';
import {SubsystemLifecycle} from '../src/framework-contracts.js';

export function runCognitiveAuditWave2GoldenWorld(){
  const base=runWave3PublicationGoldenWorld(),{core,published,late,edit,future}=base;
  core.audit.setExternalReaders({
    runtimeWorkReader:(turnId)=>turnId==='turn:w3:1'?[{taskId:'runtime:turn:w3:1',checkpointId:'checkpoint:w3:1',executionStatus:'COMPLETE'}]:[],
    sidecarTelemetryReader:(turnId)=>turnId==='turn:w3:1'?[{id:'telemetry:w3:gather',type:'GATHER_DISAGREEMENT',provider:'fixture-reference'}]:[],
  });
  const stale=core.publication.receiveResult(createCognitiveResult({
    id:'result:audit:stale',taskId:'audit:stale',turnId:'turn:audit:stale',correlationId:'corr:audit:stale',sourceSubsystem:'AUDIT_FIXTURE',workerId:'fixture',
    destinationOwner:null,resultType:'RETRIEVAL_CANDIDATE',resultClass:ResultClass.OPPORTUNISTIC,payloadClass:ResultPayloadClass.DERIVED_DATA,evidenceIds:[],provenance:{fixture:true},
    sourceRevisionIds:['w3:journal@1'],worldRevision:published.worldRevision,sceneRevision:published.sceneRevision,authorityClass:'UNRESOLVED',destination:ResultDestination.FOREGROUND,payload:{fixture:true},timing:{},
  }));
  core.framework.services.register({subsystemId:'audit-blocked-service',version:'1.0.0',owner:'TEST',lifecycleState:SubsystemLifecycle.EXPERIMENTAL,requiredDependencies:['missing-diagnostic-provider'],failureBehavior:{recovery:'WAIT_FOR_DEPENDENCY',diagnostics:true},diagnostics:{snapshot:true}});
  const blocked=core.audit.diagnostics.whyBlocked('audit-blocked-service');
  const delivered=core.deliverGenerationContext({published,generationId:'audit-pressure',modelProfileId:'RECENCY_WEIGHTED',budgetTokens:650,userInput:'Where is the Sun Blade now?',contributions:[{id:'audit-bulk',slot:PromptSlot.RECENT_NARRATIVE,sourceCategory:ContributionSource.GENERATION_ENVELOPE,owner:'GENERATION_ENVELOPE',semantic:false,semanticRefs:[],content:'bulk '.repeat(3000),sourceRevisionIds:[],role:'context',required:false,priority:0,metadata:{}}]});
  const omission=core.audit.diagnostics.whyOmitted(delivered.plan.promptPlanId);
  const unresolvedTx=core.audit.ledger.list().find(t=>t.decision==='UNRESOLVED'||t.transactionType===CognitiveTransactionType.STATE_CONTRADICTED);
  const unresolvedTarget=unresolvedTx?.affectedArtifactIds?.[0]??'sun-blade';const unresolved=core.audit.diagnostics.whyUnresolved(unresolvedTarget);
  const bundle=core.audit.createForensicBundle({turnId:'turn:w3:1',generationId:'audit-pressure',gatherRef:'gather:w3:disagreement',truthDecisionRefs:published.assessment.truthResults.map(x=>`truth:${x.candidateId}`),precisionRefs:published.precisionResults.map(x=>`precision:${x.candidateId}`),assemblyProvenanceRefs:['assembly:Development-Nexus@715fa7fc']});
  const routes=core.publication.resultBus.results({turnId:'turn:w3:1'});const fidelity=core.audit.fidelity.evaluateBundle(bundle,{sealReceipt:published.sealReceipt,resultRoutes:routes,requiredTransactionTypes:[CognitiveTransactionType.CONTEXT_SEALED,CognitiveTransactionType.RESULT_LATE]});
  const falsified=structuredClone(bundle);falsified.lateResultRefs=[published.sealReceipt.admittedResultIds[0]];const falseReceipt=core.audit.fidelity.evaluateBundle(falsified,{sealReceipt:published.sealReceipt,resultRoutes:routes});
  const missing=structuredClone(bundle);missing.transactionRefs.push('cognitive-tx:missing:required');const missingReceipt=core.audit.fidelity.evaluateBundle(missing,{sealReceipt:published.sealReceipt,resultRoutes:routes,requiredTransactionTypes:[CognitiveTransactionType.CONTEXT_SEALED]});
  const sourceTrace=core.audit.reconstructor.traceSourceRevision('w3:journal@2'),oldTrace=core.audit.reconstructor.traceSourceRevision('w3:journal@1');
  const staleExplanation=core.audit.diagnostics.whyStale(stale.result.id),turnTrace=core.audit.diagnostics.traceTurn('turn:w3:1');
  const sealTx=core.audit.ledger.list({turnId:'turn:w3:1'}).find(x=>x.transactionType===CognitiveTransactionType.CONTEXT_SEALED),lateTx=core.audit.ledger.list({turnId:'turn:w3:1'}).find(x=>x.transactionType===CognitiveTransactionType.RESULT_LATE);
  const metrics={
    baseGoldenWorld:base.pass,transactionTrailExists:core.audit.ledger.stats().count>0,sourceAdmissionRecorded:core.audit.ledger.list({transactionType:CognitiveTransactionType.SOURCE_REVISION_ADMITTED}).length>=base.core.registry.listSources().length,
    settlementRecorded:core.audit.ledger.list().some(x=>x.transactionType===CognitiveTransactionType.SETTLEMENT_ACCEPTED),sealRecorded:Boolean(sealTx),lateRecorded:Boolean(lateTx),
    lateExcludedFromSeal:late.route.late===true&&!published.sealReceipt.admittedResultIds.includes(late.result.id),staleClassified:stale.route.freshness==='STALE'&&stale.route.effectiveDestination==='EVALUATION',staleExplainable:staleExplanation.status==='OK',
    sourceEditTrace:sourceTrace.transactions.some(x=>x.transactionType===CognitiveTransactionType.SOURCE_REVISION_ADMITTED)&&sourceTrace.transactions.some(x=>x.transactionType===CognitiveTransactionType.ARTIFACT_INVALIDATED),oldHistoryPreserved:oldTrace.transactions.length>0,
    unresolvedExplainable:unresolved.status==='OK',dependencyBlockedExplainable:blocked.status==='OK'&&blocked.metadata.dependencies.missingRequired.includes('missing-diagnostic-provider'),
    omissionExplainable:omission.status==='OK'&&omission.metadata.decisions.length>0,promptPlanReferenced:Boolean(bundle.promptPlanRef),runtimeReferenced:bundle.runtimeWorkRefs.includes('runtime:turn:w3:1'),sidecarTelemetryReferenced:bundle.reconstructionReceipt.telemetryRefs.includes('telemetry:w3:gather'),
    gatherReferencePreserved:bundle.gatherRef==='gather:w3:disagreement',contextSealReferenced:bundle.contextSealRef===published.sealReceipt.id,lateReferencePreserved:bundle.lateResultRefs.includes(late.result.id),
    fidelityPass:fidelity.status===FidelityStatus.PASS,falsifiedDiagnosticRejected:falseReceipt.status===FidelityStatus.FAIL,missingTransactionRejected:missingReceipt.status===FidelityStatus.FAIL,
    turnTraceBounded:turnTrace.evidenceRefs.length<=48,futureContextUsesNewRevision:future.packet.dependencies.includes('w3:journal@2'),oldSealStillStable:base.metrics.packetHashStableAfterEdit,
  };
  return{pass:Object.values(metrics).every(Boolean),metrics,core,bundle,fidelity,falseReceipt,missingReceipt,stale,delivered,edit};
}
