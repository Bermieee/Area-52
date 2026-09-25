export const WAVE18_READ_MODEL_VERSION='1.0.0';

export function createWave18CoprocessorReadModel({
  scheduler=null,
  warmer=null,
  greenRoom=null,
  consolidation=[],
  ownerReceipts=[],
  jevService=null,
}={}){
  const schedulerRead=typeof scheduler?.readModel==='function'?scheduler.readModel():null;
  const warmerMetrics=typeof warmer?.metrics==='function'?warmer.metrics():null;
  const greenRows=typeof greenRoom?.active==='function'?greenRoom.active({}):Array.isArray(greenRoom?.characters)?greenRoom.characters:[];
  const greenMetrics=typeof greenRoom?.metrics==='function'?greenRoom.metrics():null;
  return freeze({
    kind:'Wave18CoprocessorReadModel',
    contractVersion:WAVE18_READ_MODEL_VERSION,
    hotDeep:schedulerRead?{
      resourceSlots:schedulerRead.resourceSlots,
      foregroundReserve:schedulerRead.foregroundReserve,
      foregroundActive:schedulerRead.foregroundActive,
      activeHot:schedulerRead.activeHot,
      activeDeep:schedulerRead.activeDeep,
      deepWork:schedulerRead.deepWork.map(row=>({
        workId:row.workId,status:row.status,executionClass:row.executionClass,
        queueMs:row.queueMs,executionMs:row.executionMs,slices:row.slices,yields:row.yields,resumes:row.resumes,
        ownerState:row.ownerState,ownerAccepted:row.ownerAccepted,
      })),
      metrics:{
        hotRuns:schedulerRead.metrics.hotRuns,hotSkips:schedulerRead.metrics.hotSkips,
        deepQueued:schedulerRead.metrics.deepQueued,deepCompleted:schedulerRead.metrics.deepCompleted,
        deepYields:schedulerRead.metrics.deepYields,deepResumes:schedulerRead.metrics.deepResumes,
        totalHotQueueMs:schedulerRead.metrics.totalHotQueueMs,totalHotExecutionMs:schedulerRead.metrics.totalHotExecutionMs,
        totalDeepQueueMs:schedulerRead.metrics.totalDeepQueueMs,totalDeepExecutionMs:schedulerRead.metrics.totalDeepExecutionMs,
        foregroundBlockedMs:schedulerRead.metrics.foregroundBlockedMs,
      },
    }:null,
    prefetch:warmerMetrics?{
      providerMode:warmerMetrics.providerMode,
      activePreparations:warmerMetrics.activePreparations,
      queuedPreparations:warmerMetrics.queuedPreparations,
      parkedPreparations:warmerMetrics.parkedPreparations,
      usefulFreshHits:warmerMetrics.usefulFreshHits,
      freshCandidates:warmerMetrics.freshCandidates,
      partialSalvage:warmerMetrics.partialSalvage,
      staleDiscards:warmerMetrics.staleDiscards,
      invalidDiscards:warmerMetrics.invalidDiscards,
      falseWarmHits:warmerMetrics.falseWarmHits,
      preparationsCancelled:warmerMetrics.preparationsCancelled,
      totalQueueTimeMs:warmerMetrics.totalQueueTimeMs,
      totalExecutionTimeMs:warmerMetrics.totalExecutionTimeMs,
      totalForegroundYieldWaitMs:warmerMetrics.totalForegroundYieldWaitMs,
    }:null,
    greenRoom:{
      proposals:greenRows.map(row=>({
        characterRef:row.characterRef,
        sceneRevision:row.sceneRevision,
        confidence:row.confidence,
        dimensions:clone(row.dimensions??{}),
        directEvidenceRefCount:Array.isArray(row.directEvidenceRefs)?row.directEvidenceRefs.length:Array.isArray(row.evidenceRefs)?row.evidenceRefs.length:0,
        sourceRevisionCount:Array.isArray(row.sourceRevisionSet)?row.sourceRevisionSet.length:0,
        authority:row.authority??'INFERRED',
        durableMutation:false,
      })),
      metrics:greenMetrics?{
        active:greenMetrics.active,history:greenMetrics.history,expiries:greenMetrics.expiries,
        contradictions:greenMetrics.contradictions,sourceInvalidations:greenMetrics.sourceInvalidations,
      }:null,
    },
    consolidation:(Array.isArray(consolidation)?consolidation:[consolidation]).filter(Boolean).map(row=>({
      workId:row.workId??null,status:row.status??null,ownerState:row.ownerState??null,
      ownerAccepted:Boolean(row.ownerAccepted),queueMs:Number(row.queueMs??0),executionMs:Number(row.executionMs??0),
      slices:Number(row.slices??0),yields:Number(row.yields??0),resumes:Number(row.resumes??0),
      checkpointPresent:Boolean(row.checkpointPresent),
    })),
    ownerAcceptance:(Array.isArray(ownerReceipts)?ownerReceipts:[ownerReceipts]).filter(Boolean).map(row=>({
      kind:row.kind??null,status:row.status??null,ownerDecision:row.ownerDecision??null,
      ownerAccepted:Boolean(row.ownerAccepted??row.accepted),rejected:Boolean(row.rejected),
      pendingOwnerIntegration:Boolean(row.pendingOwnerIntegration||row.status==='PENDING_OWNER_CONTRACT'||row.status==='OWNER_CONTRACT_UNAVAILABLE'),
      settlementPerformed:Boolean(row.settlementPerformed),canonicalMutation:Boolean(row.canonicalMutation),
    })),
    jev:typeof jevService?.metricsSnapshot==='function'?jevService.metricsSnapshot().map(row=>({
      domain:row.domain,decisionKind:row.decisionKind,decisions:row.decisions,deterministicSkips:row.deterministicSkips,
      jevInvoked:row.jevInvoked,abstentions:row.abstentions,unresolved:row.unresolved,staleRejections:row.staleRejections,
      totalLatencyMs:row.totalLatencyMs,
    })):[],
    authority:{mutation:false,truth:false,settlement:false,contextSeal:false,finalChoice:false},
  });
}

function clone(value){return value==null?value:structuredClone(value);}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
