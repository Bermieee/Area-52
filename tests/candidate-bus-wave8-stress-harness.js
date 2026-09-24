import {CandidateBus} from '../src/candidate-bus.js';
import {RetrievalChannelRegistry} from '../src/retrieval-channel-registry.js';
import {
  CandidateFreshness,RetrievalChannelCapability,RetrievalChannelHealth,
  createChannelNomination,createRetrievalChannelDescriptor,createRetrievalIntent,
} from '../src/candidate-bus-contracts.js';
import {RetrievalIndexLifecycleManager} from '../src/retrieval-index-lifecycle.js';
import {SparseMemoryIndexAdapter,DenseMemoryIndexAdapter} from '../src/retrieval-index-adapters.js';
import {DeterministicRetrievalRepresentationProvider} from '../src/retrieval-representation-provider.js';
import {createOwnerRetrievalArtifact} from '../src/retrieval-index-contracts.js';
import {monotonicNow,utf8ByteLength,stableJson} from '../src/browser-runtime-utils.js';

const intent=(i)=>createRetrievalIntent({intentId:'intent:'+i,kind:i%3===0?'CURRENT':i%3===1?'HISTORICAL':'RELATIONSHIP',query:'stress query '+i});
const owner=(i,revision=1)=>createOwnerRetrievalArtifact({
  artifactId:'artifact:'+i,artifactRevision:revision,artifactType:'StressArtifact',sourceId:'source:'+i,sourceRevision:'source:'+i+'@'+revision,
  claimRefs:['claim:'+i],entityRefs:['entity:'+(i%50)],authorityClass:i%2?'OBSERVED':'INFERRED',
  truthStatusHint:i%3===0?'CURRENT':i%3===1?'HISTORICAL':'UNRESOLVED',
  provenanceRefs:['source:'+i+'@'+revision,'claim:'+i],dependencyInvalidators:['source:'+i+'@'+revision],
  semanticKey:'claim:'+i,text:'stress artifact '+i+' revision '+revision+' with continuity token '+(i%100),
});

function stressNomination(i,{duplicateOf=null,stale=false}={}){
  const base=duplicateOf??i,evidence=base%2500,channel='CH_'+(base%20),intentId='intent:'+(base%8);
  const authority=evidence%2?'OBSERVED':'INFERRED',truth=evidence%3===0?'CURRENT':evidence%3===1?'HISTORICAL':'UNRESOLVED';
  return createChannelNomination({
    nominationId:'nom:'+i+':'+channel,channelId:channel,candidateId:'candidate:evidence:'+evidence,evidenceIdentity:'evidence:'+evidence,
    artifactRef:{artifactId:'artifact:'+evidence,artifactType:'Stress',revision:1},artifactRevision:1,
    sourceRevisionRefs:[stale?'source@old':'source@1'],claimRefs:['claim:'+evidence],entityRefs:['entity:'+(evidence%50)],
    retrievalIntentIds:[intentId],rankSignals:{rawScore:(base%1000)/10,signalKind:'channel-local'},normalizedRank:(base%1000)/999,
    authorityClass:authority,truthStatusHint:truth,provenance:[{ref:'prov:'+evidence}],evidenceRefs:['evidence:'+evidence],
    dependencyRevisions:[],freshness:CandidateFreshness.FRESH,representationRef:'rep:'+evidence,representationRevision:1,
    representationText:'bounded representation '+evidence,metadata:{bucket:base%17},worldRevision:9,sceneRevision:11,
  });
}

export function runWave8Stress(){
  const intents=Array.from({length:8},(_,i)=>intent(i));
  const bus=new CandidateBus({limits:{
    maxPerIntent:256,maxPerChannel:1000,maxPerChannelIntent:1000,maxTotalCandidates:512,
    maxNominationRecordsPerCandidate:8,maxGraphPathsPerCandidate:4,maxProvenanceRefsPerCandidate:32,
    maxEvidenceRefsPerCandidate:32,maxMetadataBytesPerCandidate:1024,maxRepresentationChars:400,maxReceiptHistory:32,
  }});
  const unique=Array.from({length:10000},(_,i)=>stressNomination(i));
  const duplicates=Array.from({length:5000},(_,i)=>stressNomination(10000+i,{duplicateOf:i}));
  const tFusion=monotonicNow();
  const fused=bus.fuse({nominations:[...unique,...duplicates],retrievalIntents:intents,currentRevisionSet:{sourceRevisionSet:['source@1'],worldRevision:9,sceneRevision:11}});
  const fusionLatencyMs=monotonicNow()-tFusion;

  const orderBus=new CandidateBus({limits:{maxReceiptHistory:32,maxTotalCandidates:16,maxPerIntent:16,maxPerChannel:16,maxPerChannelIntent:16}});
  const small=[0,1,2,3,4,5].map(i=>stressNomination(i));
  const baseline=orderBus.fuse({nominations:small,retrievalIntents:intents,currentRevisionSet:{sourceRevisionSet:['source@1'],worldRevision:9,sceneRevision:11}});
  const baselineSemantic=stableJson(baseline.candidates);
  let orderFailures=0;const tOrder=monotonicNow();
  for(let i=0;i<5000;i++){
    const shift=i%small.length,rotated=[...small.slice(shift),...small.slice(0,shift)];
    if(i%2)rotated.reverse();
    const result=orderBus.fuse({nominations:rotated,retrievalIntents:intents,currentRevisionSet:{sourceRevisionSet:['source@1'],worldRevision:9,sceneRevision:11}});
    if(stableJson(result.candidates)!==baselineSemantic)orderFailures++;
  }
  const orderPermutationLatencyMs=monotonicNow()-tOrder;

  const staleBus=new CandidateBus({limits:{maxTotalCandidates:512,maxPerIntent:512,maxPerChannel:2500,maxPerChannelIntent:2500,maxReceiptHistory:8}});
  const staleInput=Array.from({length:2000},(_,i)=>stressNomination(i,{stale:true}));
  const staleSet=staleBus.fuse({nominations:staleInput,retrievalIntents:intents,currentRevisionSet:{sourceRevisionSet:['source@new'],worldRevision:9,sceneRevision:11}});

  const registry=new RetrievalChannelRegistry();
  for(let i=0;i<20;i++){
    const id='FAIL_CH_'+i,throws=i%4===0,health=i%5===0?RetrievalChannelHealth.DEGRADED:RetrievalChannelHealth.HEALTHY;
    registry.register({
      descriptor:createRetrievalChannelDescriptor({channelId:id,capabilities:[RetrievalChannelCapability.SPECIALIZED_STORE],supportedIntentKinds:['GENERAL','CURRENT','HISTORICAL','RELATIONSHIP'],maxCandidates:2,health,available:true}),
      retrieve:(ri)=>{if(throws)throw Object.assign(new Error('simulated channel failure'),{code:'SIMULATED_CHANNEL_FAILURE'});return[createChannelNomination({nominationId:id+':'+ri.intentId,channelId:id,candidateId:'candidate:'+id,evidenceIdentity:'failure-evidence:'+id,artifactRef:{artifactId:'failure:'+id,revision:1},sourceRevisionRefs:['source@1'],retrievalIntentIds:[ri.intentId],rankSignals:{score:i},normalizedRank:.5,authorityClass:'INFERRED',truthStatusHint:'UNRESOLVED'})];},
    });
  }
  let failureCycles=0,failureCorruption=0;const tChannels=monotonicNow();
  for(let i=0;i<2000;i++){
    const scatter=registry.retrieveAllSync({intents:[intents[i%intents.length]],context:{}});
    if(!scatter.errors.length||!scatter.nominations.length)failureCorruption++;
    failureCycles++;
  }
  const perChannelOverheadMs=monotonicNow()-tChannels;

  const provider=new DeterministicRetrievalRepresentationProvider(),manager=new RetrievalIndexLifecycleManager({representationProvider:provider,maxReceiptHistory:64});
  manager.registerAdapter(new SparseMemoryIndexAdapter({adapterId:'STRESS_SPARSE'}));manager.registerAdapter(new DenseMemoryIndexAdapter({adapterId:'STRESS_DENSE'}));
  const artifacts=Array.from({length:2000},(_,i)=>owner(i,1));
  const tInsert=monotonicNow();for(const artifact of artifacts)manager.indexArtifact(artifact);const indexInsertMs=monotonicNow()-tInsert;
  const updated=Array.from({length:2000},(_,i)=>owner(i,2));
  const tUpdate=monotonicNow();for(const artifact of updated)manager.indexArtifact(artifact);const indexUpdateMs=monotonicNow()-tUpdate;
  const tInvalidate=monotonicNow();for(let i=0;i<1000;i++)manager.invalidateArtifact('artifact:'+i,{reason:'STRESS_INVALIDATE'});const indexInvalidateMs=monotonicNow()-tInvalidate;
  for(let i=1000;i<2000;i++)manager.tombstoneArtifact('artifact:'+i,{reason:'STRESS_TOMBSTONE'});
  const tVerify=monotonicNow();const postLifecycleVerify=manager.verify({ownerArtifacts:updated});const indexVerifyMs=monotonicNow()-tVerify;

  const rebuildManager=new RetrievalIndexLifecycleManager({representationProvider:provider,maxReceiptHistory:16});
  rebuildManager.registerAdapter(new SparseMemoryIndexAdapter({adapterId:'REBUILD_SPARSE'}));rebuildManager.registerAdapter(new DenseMemoryIndexAdapter({adapterId:'REBUILD_DENSE'}));
  const rebuildOwners=Array.from({length:12},(_,i)=>owner(3000+i,1));
  const tRebuild=monotonicNow();let rebuildFailures=0,verifyCycles=0;
  for(let i=0;i<500;i++){
    const result=rebuildManager.rebuild({ownerArtifacts:rebuildOwners});if(result.verification.overall!=='FRESH')rebuildFailures++;
    const verify=rebuildManager.verify({ownerArtifacts:rebuildOwners});if(verify.overall!=='FRESH')rebuildFailures++;verifyCycles++;
  }
  const rebuildVerifyMs=monotonicNow()-tRebuild;

  let failDense=false;
  const tornManager=new RetrievalIndexLifecycleManager({representationProvider:provider,maxReceiptHistory:32});
  tornManager.registerAdapter(new SparseMemoryIndexAdapter({adapterId:'TORN_SPARSE'}));
  tornManager.registerAdapter(new DenseMemoryIndexAdapter({adapterId:'TORN_DENSE',faultInjector:(op,payload)=>failDense&&op==='PUT'&&payload.ownerArtifactRevision===2?'torn':false}));
  let tornFailures=0;const tTorn=monotonicNow();
  for(let i=0;i<250;i++){
    const a1=owner(5000+i,1),a2=owner(5000+i,2);tornManager.indexArtifact(a1);failDense=true;
    const torn=tornManager.indexArtifact(a2);if(torn.status!=='TORN')tornFailures++;
    const verify=tornManager.verify({ownerArtifacts:[...Array.from({length:i},(_,j)=>owner(5000+j,2)),a1]});if(verify.overall!=='DEGRADED')tornFailures++;
    failDense=false;const recovered=tornManager.indexArtifact(a2);if(recovered.status!=='APPLIED')tornFailures++;
  }
  const tornRecoveryMs=monotonicNow()-tTorn;

  const busDiag=bus.diagnostics(),orderDiag=orderBus.diagnostics();
  const invariants={
    largeFusionBounded:fused.candidateCount<=512,
    duplicateReplayCount:fused.fusionReceipt.duplicateNominationCount>=5000,
    metadataBounded:fused.candidates.every(c=>utf8ByteLength(JSON.stringify(c.metadata))<=2048),
    receiptBounded:utf8ByteLength(JSON.stringify(fused.fusionReceipt))<200000,
    noAuthorityEscalation:fused.candidates.every(c=>['OBSERVED','INFERRED'].includes(c.authorityClass)),
    orderIndependent:orderFailures===0,
    receiptHistoryBounded:busDiag.recentReceipts.length<=32&&orderDiag.recentReceipts.length<=32&&busDiag.retainsCandidatePayloadHistory===false,
    allStaleVisible:staleSet.fusionReceipt.staleNominationCount===2000&&staleSet.candidates.every(c=>c.freshness==='STALE'),
    partialFailureIsolated:failureCorruption===0,
    lifecycleCounts:manager.counters.inserts===2000&&manager.counters.updates===2000&&manager.counters.invalidations>=1000&&manager.counters.tombstones>=1000,
    invalidAndTombstoneNotFresh:postLifecycleVerify.overall==='DEGRADED',
    rebuildStable:rebuildFailures===0&&verifyCycles===500,
    tornRecoveryStable:tornFailures===0&&tornManager.verify({ownerArtifacts:Array.from({length:250},(_,i)=>owner(5000+i,2))}).overall==='FRESH',
    noCandidateSetRetentionLeak:!('candidates' in busDiag)&&!('candidateSets' in busDiag),
  };
  return{
    pass:Object.values(invariants).every(Boolean),counts:{
      candidateNominations:unique.length,duplicateNominations:duplicates.length,orderPermutations:5000,staleRevisionCases:staleInput.length,
      partialChannelFailureCases:failureCycles,indexInserts:2000,indexUpdates:2000,indexInvalidations:1000,indexTombstones:1000,
      rebuilds:500,verifyCycles,tornStateRecoveryCases:250,
    },invariants,metrics:{
      fusionLatencyMs,orderPermutationLatencyMs,perChannelOverheadMs,indexInsertMs,indexUpdateMs,indexInvalidateMs,indexVerifyMs,rebuildVerifyMs,tornRecoveryMs,
      fusedCandidateCount:fused.candidateCount,fusionReceiptBytes:utf8ByteLength(JSON.stringify(fused.fusionReceipt)),
      fusionEnvelopeBytes:utf8ByteLength(JSON.stringify(fused)),receiptHistorySize:busDiag.recentReceipts.length,
      indexRepresentationCount:manager.expectedRepresentations('STRESS_SPARSE').length,
    },failureDetails:{orderFailures,failureCorruption,rebuildFailures,tornFailures},fused,staleSet,postLifecycleVerify,
  };
}
