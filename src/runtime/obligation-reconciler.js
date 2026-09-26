import {EXECUTION_STATUS,LIFECYCLE_STATUS} from './constants.js';
import {CausalLifecycleState,CausalReceiptKind,CausalReasonCode,createCausalReceipt} from './causal-receipts.js';

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
    const prior=this.expected.get(expectedId)??null;
    if(!prior)this.order.push(expectedId);
    this.expected.set(expectedId,{declaration,executor:executor??prior?.executor??null,evidence:[...(prior?.evidence??[])],evidenceSequence:Number(prior?.evidenceSequence??prior?.evidence?.length??0)});
    while(this.order.length>this.maxExpected){const old=this.order.shift();this.expected.delete(old);}
    return clone(declaration);
  }

  recordEvidence(expectedId,input={}){
    const entry=this.expected.get(String(expectedId));if(!entry)throw new Error('Unknown expected work: '+expectedId);
    const d=entry.declaration,kind=input.kind??input.eventKind;
    const defaults={
      [CausalReceiptKind.PHYSICAL_EXECUTION_STARTED]:[CausalLifecycleState.RUNNING,CausalReasonCode.PHYSICAL_EXECUTION_STARTED],
      [CausalReceiptKind.RESULT_RETURNED]:[CausalLifecycleState.RETURNED,CausalReasonCode.RESULT_RETURNED],
      [CausalReceiptKind.OWNER_ADMISSION]:[CausalLifecycleState.ACCEPTED,CausalReasonCode.OWNER_ACCEPTED],
      [CausalReceiptKind.SETTLEMENT]:[CausalLifecycleState.SETTLED,CausalReasonCode.SETTLED],
      [CausalReceiptKind.WORK_FAILED]:[CausalLifecycleState.FAILED,CausalReasonCode.TASK_FAILED],
      [CausalReceiptKind.RESULT_STALE]:[CausalLifecycleState.STALE,CausalReasonCode.STALE_RESULT],
      [CausalReceiptKind.RESULT_LATE]:[CausalLifecycleState.LATE,CausalReasonCode.LATE_RESULT],
      [CausalReceiptKind.OWNER_REJECTED]:[CausalLifecycleState.FAILED,CausalReasonCode.OWNER_REJECTED],
    };
    if(!defaults[kind])throw new TypeError('Unsupported external reconciliation evidence kind: '+kind);
    const index=Math.max(Number(entry.evidenceSequence??0),...(entry.evidence??[]).map(row=>Number(String(row?.id??'').match(/:e(\d+):/)?.[1]??0)))+1,[defaultState,defaultReason]=defaults[kind];
    entry.evidenceSequence=index;
    const receipt=createCausalReceipt({
      id:input.id??('expected:'+d.expectedId+':e'+index+':'+kind),kind,lifecycleState:input.lifecycleState??defaultState,reasonCode:input.reasonCode??defaultReason,
      taskId:input.taskId??null,taskType:d.obligation?.taskType??null,owner:d.owner,producerId:input.producerId??d.owner,consumerId:input.consumerId??d.cause?.consumerId??null,
      parentReceiptId:input.parentReceiptId??null,workerId:input.workerId??null,durationMs:input.durationMs??null,ownerAccepted:input.ownerAccepted??(kind===CausalReceiptKind.OWNER_ADMISSION?true:kind===CausalReceiptKind.OWNER_REJECTED?false:null),
      cause:{...clone(d.cause),...clone(input.cause??{})},metadata:clone(input.metadata??{}),
    });
    entry.evidence=[...(entry.evidence??[]),receipt].slice(-64);return clone(receipt);
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
    if(!record&&admit&&!(entry.evidence??[]).length){
      if(typeof entry.executor?.execute!=='function')return this.#receipt(d,ReconciliationStatus.DUE,CausalReasonCode.EXECUTOR_UNAVAILABLE,null,[]);
      const obligation={...clone(d.obligation),owner:d.obligation?.owner??d.owner,producerId:d.obligation?.producerId??d.owner,cause:clone(d.cause),dedupeKey:d.obligation?.dedupeKey??('expected:'+d.expectedId)};
      const admission=this.director.submit(obligation,entry.executor);
      if(!admission.accepted)return this.#receipt(d,ReconciliationStatus.BLOCKED,admission.reason==='backpressure'?CausalReasonCode.BACKPRESSURE:CausalReasonCode.DEPENDENCY_BLOCKED,null,[]);
      record=this.director.ledger.get(admission.task.taskId);
    }
    const evidence=[...(entry.evidence??[]),...(record?.causalReceipts??[])];
    if(record?.lifecycleStatus===LIFECYCLE_STATUS.CANCELLED)return this.#receipt(d,ReconciliationStatus.FAILED,CausalReasonCode.CANCELLED,record,evidence);
    if(record?.lifecycleStatus===LIFECYCLE_STATUS.SUPERSEDED)return this.#receipt(d,ReconciliationStatus.FAILED,CausalReasonCode.SUPERSEDED,record,evidence);
    if(record?.executionStatus===EXECUTION_STATUS.FAILED)return this.#receipt(d,ReconciliationStatus.FAILED,CausalReasonCode.TASK_FAILED,record,evidence);
    if(evidence.some(x=>x.eventKind===CausalReceiptKind.RESULT_STALE))return this.#receipt(d,ReconciliationStatus.STALE,CausalReasonCode.STALE_RESULT,record,evidence);
    if(evidence.some(x=>x.eventKind===CausalReceiptKind.RESULT_LATE))return this.#receipt(d,ReconciliationStatus.LATE,CausalReasonCode.LATE_RESULT,record,evidence);
    if(evidence.some(x=>x.eventKind===CausalReceiptKind.OWNER_REJECTED||x.ownerAccepted===false))return this.#receipt(d,ReconciliationStatus.FAILED,CausalReasonCode.OWNER_REJECTED,record,evidence);
    if(evidence.some(x=>x.eventKind===CausalReceiptKind.WORK_FAILED))return this.#receipt(d,ReconciliationStatus.FAILED,evidence.findLast(x=>x.eventKind===CausalReceiptKind.WORK_FAILED)?.reasonCode??CausalReasonCode.TASK_FAILED,record,evidence);

    const has=(name)=>{
      if(name==='PHYSICAL_EXECUTION')return evidence.some(x=>x.eventKind===CausalReceiptKind.PHYSICAL_EXECUTION_STARTED);
      if(name==='RESULT_RETURNED')return evidence.some(x=>x.eventKind===CausalReceiptKind.RESULT_RETURNED);
      if(name==='OWNER_ADMISSION')return evidence.some(x=>x.eventKind===CausalReceiptKind.OWNER_ADMISSION&&x.ownerAccepted===true);
      if(name==='SETTLEMENT')return evidence.some(x=>x.eventKind===CausalReceiptKind.SETTLEMENT);
      return false;
    };
    const missing=d.requiredEvidence.filter(name=>!has(name));
    if(!missing.length)return this.#receipt(d,ReconciliationStatus.DONE,d.requiredEvidence.includes('SETTLEMENT')?CausalReasonCode.SETTLED:CausalReasonCode.OWNER_ACCEPTED,record,evidence);
    if(!record&&!evidence.length)return this.#receipt(d,ReconciliationStatus.DUE,CausalReasonCode.TASK_NOT_ADMITTED,null,[]);
    const reason=!has('PHYSICAL_EXECUTION')?CausalReasonCode.LOGICAL_ADMISSION_ONLY:CausalReasonCode.NO_EVIDENCE;
    return this.#receipt(d,ReconciliationStatus.DUE,reason,record,evidence,{missingEvidence:missing});
  }

  list(){return this.order.map(id=>this.reconcile(id,{admit:false}));}

  snapshot(){
    return Object.freeze({
      kind:'CognitiveObligationReconcilerSnapshot',contractVersion:2,maxExpected:this.maxExpected,
      entries:this.order.map(id=>{const row=this.expected.get(id);return row?{declaration:clone(row.declaration),evidence:clone(row.evidence??[]),evidenceSequence:Number(row.evidenceSequence??row.evidence?.length??0)}:null;}).filter(Boolean),
    });
  }

  restore(snapshot={}){
    const rows=Array.isArray(snapshot?.entries)?snapshot.entries:Array.isArray(snapshot?.declarations)?snapshot.declarations.map(declaration=>({declaration,evidence:[]})):[];
    this.expected.clear();this.order=[];
    for(const row of rows.slice(-this.maxExpected)){const declaration=row?.declaration??row;this.declare(declaration,null);const entry=this.expected.get(declaration.expectedId);if(entry){entry.evidence=clone(row?.evidence??[]).slice(-64);entry.evidenceSequence=Math.max(Number(row?.evidenceSequence??0),...(entry.evidence??[]).map(receipt=>Number(String(receipt?.id??'').match(/:e(\d+):/)?.[1]??0)));}}
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
