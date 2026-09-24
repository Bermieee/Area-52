import {CognitiveTransactionLedger,CognitiveReconstructor,DiagnosticRetentionStore,ForensicBundleStore,CognitiveTransactionType,RetentionClass} from '../src/cognitive-audit.js';

export function runCognitiveAuditStress(){
  const ledger=new CognitiveTransactionLedger(),reconstructor=new CognitiveReconstructor({ledger}),retention=new DiagnosticRetentionStore({maxTotalDetailBytes:65536}),bundles=new ForensicBundleStore();
  const tails=[];
  for(let chain=0;chain<500;chain++){
    let cause=null,last=null;
    for(let step=0;step<4;step++){
      const type=[CognitiveTransactionType.SOURCE_REVISION_ADMITTED,CognitiveTransactionType.PROPOSAL_CREATED,CognitiveTransactionType.SETTLEMENT_ACCEPTED,CognitiveTransactionType.CONTEXT_SEALED][step];
      last=ledger.append({transactionType:type,correlationId:`stress:${chain}`,causationId:cause,turnId:`turn:${chain}`,generationId:step===3?`gen:${chain}`:null,subsystem:'STRESS',owner:'STRESS',sourceRevisionIds:[`source:${chain}@${step+1}`],affectedArtifactIds:[`artifact:${chain}`],receiptRefs:step===3?[`seal:${chain}`]:[],reasonCode:`STEP_${step}`,provenance:{sourceRevisionIds:[`source:${chain}@${step+1}`]},metadata:{step}}).transaction;
      cause=last.transactionId;
    }
    tails.push(last.transactionId);
  }
  let completeQueries=0;for(const id of tails){const r=reconstructor.reconstructTransaction(id,{maxTransactions:16});if(r.complete&&r.transactions.length===4)completeQueries++;}
  for(let i=0;i<1000;i++)retention.record({recordId:`diag:${i}`,retentionClass:RetentionClass.BOUNDED_DIAGNOSTIC,sequence:i+1,policy:{ttl:500},metadata:{i},detail:{safe:'x'.repeat(300),rawPrompt:'p'.repeat(5000),rawResponse:'r'.repeat(5000)}});
  for(let i=0;i<100;i++){
    const chain=reconstructor.reconstructCorrelation(`stress:${i}`);const b=bundles.create({turnId:`turn:${i}`,generationId:`gen:${i}`,sourceRevisionRefs:[`source:${i}@1`],runtimeWorkRefs:[`runtime:${i}`],workerResultRefs:[`result:${i}`],transactionRefs:chain.transactions.map(x=>x.transactionId),contextSealRef:`seal:${i}`,reconstructionReceipt:{packetHash:`hash:${i}`},complete:true});
    retention.record({recordId:b.bundleId,retentionClass:RetentionClass.FORENSIC_REFERENCE,sequence:2001+i,metadata:{turnId:b.turnId},detail:{transactionRefs:b.transactionRefs,contextSealRef:b.contextSealRef}});
  }
  const before=retention.stats();retention.prune({currentSequence:5000});const after=retention.stats();
  const ids=ledger.list().map(x=>x.transactionId),uniqueIds=new Set(ids).size===ids.length,ordered=ledger.list().every((x,i,a)=>i===0||x.sequence>a[i-1].sequence),forensicSurvive=[...Array(100)].every((_,i)=>retention.get(`forensic-bundle:${i+1}:turn:${i}`,{includeDetail:true})?.detail!==null);
  const metrics={transactions:ledger.stats().count,causationChains:500,diagnosticQueries:tails.length,forensicBundles:bundles.list().length,completeQueries,uniqueIds,ordered,prePruneDetailBytes:before.detailBytes,postPruneDetailBytes:after.detailBytes,maxDetailBytes:after.maxTotalDetailBytes,metadataRetained:after.metadataCount,expiredDetails:after.expiredCount,forensicReferencesSurvive:forensicSurvive,boundedMemory:after.detailBytes<=after.maxTotalDetailBytes,noRawPromptRetention:retention.get('diag:999',{includeDetail:true}).detail===null};
  const pass=metrics.transactions===2000&&metrics.causationChains===500&&metrics.diagnosticQueries===500&&metrics.forensicBundles===100&&metrics.completeQueries===500&&metrics.uniqueIds&&metrics.ordered&&metrics.boundedMemory&&metrics.metadataRetained===1100&&metrics.expiredDetails>=1000&&metrics.forensicReferencesSurvive&&metrics.noRawPromptRetention;
  return{pass,metrics};
}
