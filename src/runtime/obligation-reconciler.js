import {EXECUTION_STATUS,LIFECYCLE_STATUS} from './constants.js';
import {CausalReceiptKind,CausalReasonCode} from './causal-receipts.js';

const clone=(value)=>value==null?value:structuredClone(value);
const req=(value,name)=>{if(typeof value!=='string'||!value.trim())throw new TypeError(name+' must be a non-empty string');return value.trim();};

export const ReconciliationStatus=Object.freeze({
  DONE:'DONE',DUE:'DUE',BLOCKED:'BLOCKED',FAILED:'FAILED',SKIPPED_WITH_REASON:'SKIPPED_WITH_REASON',
  DEFERRED:'DEFERRED',STALE:'STALE',LATE:'LATE',
});

export class CognitiveObligationReconciler{
  constructor({director,maxExpected=256,snapshot=null}={}){
    if(!director)throw new TypeError('CognitiveObligationReconciler requires a WorkerDirector');
    this.director=director;this.maxExpected=Math.max(16,Number(maxExpected)||256);this.expected=new Map();this.order=[];
    if(snapshot)this.restore(snapshot);
  }

  declare(input={},executor=null){
    const expectedId=req(input.expectedId,'expectedId'),owner=req(input.owner,'owner'),ownerSignalId=req(input.ownerSignalId,'ownerSignalId');
    const disposition=String(input.disposition??'EXPECTED').toUpperCase();
    if(!['EXPECTED','SKIP','DEFER'].includes(disposition))throw new TypeError('Unsupported expected disposition: '+disposition);
    const declaration=Object.freeze({
      kind:'OwnerExpectedCognitiveWork',contractVersion:1,expectedId,owner,ownerSignalId,disposition,
      reasonCode:String(input.reasonCode??(disposition==='SKIP'?CausalReasonCode.OWNER_DECLARED_NO_WORK:disposition==='DEFER'?CausalReasonCode.OWNER_DEFERRED:CausalReasonCode.OWNER_EXPECTED_WORK)),
      prerequisites:[...(input.prerequisites??[])].map(String).sort(),
      requiredEvidence:[...(input.requiredEvidence??['PHYSICAL_EXECUTION','RESULT_RETURNED','OWNER_ADMISSION'])].map(String),
      obligation:clone(input.obligation??{}),cause:clone(input.cause??{}),
      authorityGranted:false,canonicalMutationAuthority:false,
    });
    if(!this.expected.has(expectedId))this.order.push(expectedId);
    this.expected.set(expectedId,{declaration,executor});
    while(this.order.length>this.maxExpected){const old=this.order.shift();this.expected.delete(old);}
    return clone(declaration);
  }

  reconcile(expectedId,{admit=true}={}){
    const entry=this.expected.get(String(expectedId));if(!entry)throw new Error('Unknown expected work: '+expectedId);
    const d=entry.declaration;
    if(d.disposition==='SKIP')return this.#receipt(d,ReconciliationStatus.SKIPPED_WITH_REASON,d.reasonCode,null,[]);
    if(d.disposition==='DEFER')return this.#receipt(d,ReconciliationStatus.DEFERRED,d.reasonCode,null,[]);
    for(const prerequisite of d.prerequisites){
      const state=this.reconcile(prerequisite,{admit:false});
      if(state.status!==ReconciliationStatus.DONE)return this.#receipt(d,ReconciliationStatus.BLOCKED,CausalReasonCode.PREREQUISITE_PENDING,null,[],{blockedBy:prerequisite});
    }
    let record=this.#findTask(d);
    if(!record&&admit){
      if(typeof entry.executor?.execute!=='function')return this.#receipt(d,ReconciliationStatus.DUE,CausalReasonCode.EXECUTOR_UNAVAILABLE,null,[]);
      const obligation={...clone(d.obligation),owner:d.obligation?.owner??d.owner,producerId:d.obligation?.producerId??d.owner,cause:clone(d.cause),dedupeKey:d.obligation?.dedupeKey??('expected:'+d.expectedId)};
      const admission=this.director.submit(obligation,entry.executor);
      if(!admission.accepted)return this.#receipt(d,ReconciliationStatus.BLOCKED,admission.reason==='backpressure'?CausalReasonCode.BACKPRESSURE:CausalReasonCode.DEPENDENCY_BLOCKED,null,[]);
      record=this.director.ledger.get(admission.task.taskId);
    }
    if(!record)return this.#receipt(d,ReconciliationStatus.DUE,CausalReasonCode.TASK_NOT_ADMITTED,null,[]);
    const evidence=[...(record.causalReceipts??[])];
    if(record.lifecycleStatus===LIFECYCLE_STATUS.CANCELLED)return this.#receipt(d,ReconciliationStatus.FAILED,CausalReasonCode.CANCELLED,record,evidence);
    if(record.lifecycleStatus===LIFECYCLE_STATUS.SUPERSEDED)return this.#receipt(d,ReconciliationStatus.FAILED,CausalReasonCode.SUPERSEDED,record,evidence);
    if(record.executionStatus===EXECUTION_STATUS.FAILED)return this.#receipt(d,ReconciliationStatus.FAILED,CausalReasonCode.TASK_FAILED,record,evidence);
    if(evidence.some(x=>x.eventKind===CausalReceiptKind.RESULT_STALE))return this.#receipt(d,ReconciliationStatus.STALE,CausalReasonCode.STALE_RESULT,record,evidence);
    if(evidence.some(x=>x.eventKind===CausalReceiptKind.RESULT_LATE))return this.#receipt(d,ReconciliationStatus.LATE,CausalReasonCode.LATE_RESULT,record,evidence);
    if(evidence.some(x=>x.eventKind===CausalReceiptKind.OWNER_REJECTED||x.ownerAccepted===false))return this.#receipt(d,ReconciliationStatus.FAILED,CausalReasonCode.OWNER_REJECTED,record,evidence);

    const has=(name)=>{
      if(name==='PHYSICAL_EXECUTION')return evidence.some(x=>x.eventKind===CausalReceiptKind.PHYSICAL_EXECUTION_STARTED);
      if(name==='RESULT_RETURNED')return evidence.some(x=>x.eventKind===CausalReceiptKind.RESULT_RETURNED);
      if(name==='OWNER_ADMISSION')return evidence.some(x=>x.eventKind===CausalReceiptKind.OWNER_ADMISSION&&x.ownerAccepted===true);
      if(name==='SETTLEMENT')return evidence.some(x=>x.eventKind===CausalReceiptKind.SETTLEMENT);
      return false;
    };
    const missing=d.requiredEvidence.filter(name=>!has(name));
    if(!missing.length)return this.#receipt(d,ReconciliationStatus.DONE,d.requiredEvidence.includes('SETTLEMENT')?CausalReasonCode.SETTLED:CausalReasonCode.OWNER_ACCEPTED,record,evidence);
    const reason=!has('PHYSICAL_EXECUTION')?CausalReasonCode.LOGICAL_ADMISSION_ONLY:CausalReasonCode.NO_EVIDENCE;
    return this.#receipt(d,ReconciliationStatus.DUE,reason,record,evidence,{missingEvidence:missing});
  }

  list(){return this.order.map(id=>this.reconcile(id,{admit:false}));}

  snapshot(){
    return Object.freeze({
      kind:'CognitiveObligationReconcilerSnapshot',contractVersion:1,maxExpected:this.maxExpected,
      declarations:this.order.map(id=>clone(this.expected.get(id)?.declaration)).filter(Boolean),
    });
  }

  restore(snapshot={}){
    const rows=Array.isArray(snapshot?.declarations)?snapshot.declarations:[];
    this.expected.clear();this.order=[];
    for(const declaration of rows.slice(-this.maxExpected))this.declare(declaration,null);
    return this.snapshot();
  }

  #findTask(d){return this.director.ledger.list().find(r=>r.obligation?.dedupeKey===(d.obligation?.dedupeKey??('expected:'+d.expectedId)))??null;}

  #receipt(d,status,reasonCode,record,evidence,extra={}){
    return Object.freeze({
      kind:'CognitiveObligationReconciliationReceipt',contractVersion:1,expectedId:d.expectedId,owner:d.owner,ownerSignalId:d.ownerSignalId,
      status,reasonCode,taskId:record?.taskId??null,lifecycleStatus:record?.lifecycleStatus??null,executionStatus:record?.executionStatus??null,
      evidenceStages:evidence.slice(-32).map(x=>({id:x.id,eventKind:x.eventKind,lifecycleState:x.lifecycleState,reasonCode:x.reasonCode,parentReceiptId:x.parentReceiptId,ownerAccepted:x.ownerAccepted})),
      cause:clone(d.cause),...clone(extra),authorityGranted:false,canonicalMutationAuthority:false,
    });
  }
}
