import {FidelityStatus} from './cognitive-audit-contracts.js';
import {clone} from './framework-utils.js';

export class DiagnosticFidelityEvaluator{
  constructor({ledger}={}){this.ledger=ledger;}
  evaluateBundle(bundle,{sealReceipt=null,resultRoutes=[],requiredTransactionTypes=[]}={}){
    const failures=[],warnings=[];const txs=bundle.transactionRefs.map(id=>this.ledger.get(id));const missing=bundle.transactionRefs.filter((id,i)=>!txs[i]);if(missing.length)failures.push({code:'MISSING_TRANSACTION_REFERENCE',refs:missing});
    for(const type of requiredTransactionTypes)if(!txs.some(x=>x?.transactionType===type))failures.push({code:'MISSING_REQUIRED_TRANSACTION',transactionType:type});
    if(sealReceipt){if(bundle.contextSealRef!==sealReceipt.id)failures.push({code:'CONTEXT_SEAL_REFERENCE_MISMATCH',expected:sealReceipt.id,actual:bundle.contextSealRef});
      for(const id of bundle.lateResultRefs)if((sealReceipt.admittedResultIds??[]).includes(id))failures.push({code:'LATE_RESULT_FALSELY_ADMITTED',resultId:id});
      for(const id of bundle.staleResultRefs)if((sealReceipt.admittedResultIds??[]).includes(id))failures.push({code:'STALE_RESULT_FALSELY_ADMITTED',resultId:id});
      if(bundle.reconstructionReceipt?.packetHash&&bundle.reconstructionReceipt.packetHash!==sealReceipt.packetHash)failures.push({code:'SEALED_PACKET_HASH_MISMATCH'});
    }else warnings.push({code:'MISSING_SEAL_EVIDENCE'});
    const routeById=new Map(resultRoutes.map(x=>[x.result?.id??x.resultId,x]));for(const id of bundle.lateResultRefs){const r=routeById.get(id);if(!r||r.route?.late!==true)failures.push({code:'FALSE_LATE_RESULT_CLAIM',resultId:id});}for(const id of bundle.staleResultRefs){const r=routeById.get(id);if(!r||r.route?.freshness!=='STALE')failures.push({code:'FALSE_STALE_RESULT_CLAIM',resultId:id});}
    const ordered=txs.filter(Boolean).map(x=>x.sequence);if(ordered.some((n,i)=>i&&n<ordered[i-1]))failures.push({code:'TRANSACTION_ORDER_FALSIFIED'});
    const status=failures.length?FidelityStatus.FAIL:warnings.length?FidelityStatus.PARTIAL:FidelityStatus.PASS;return{kind:'FidelityReceipt',status,pass:status===FidelityStatus.PASS,bundleId:bundle.bundleId,failures:clone(failures),warnings:clone(warnings),checkedTransactionCount:txs.filter(Boolean).length};
  }
}
