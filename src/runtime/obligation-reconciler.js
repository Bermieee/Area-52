import { EXECUTION_STATUS,LIFECYCLE_STATUS } from './constants.js';
import { sanitizeObligationCause } from './obligation-cause.js';

export const ReconciliationState=Object.freeze({
  MISSING:'MISSING',
  DUE:'DUE',
  BLOCKED:'BLOCKED',
  FAILED:'FAILED',
  SKIPPED_WITH_REASON:'SKIPPED_WITH_REASON',
  DONE:'DONE',
});

export const ReconciliationReason=Object.freeze({
  OBLIGATION_NOT_CREATED:'OBLIGATION_NOT_CREATED',
  AWAITING_EXECUTION:'AWAITING_EXECUTION',
  DEPENDENCY_NOT_DONE:'DEPENDENCY_NOT_DONE',
  EXECUTOR_NOT_PROVIDED:'EXECUTOR_NOT_PROVIDED',
  ADMITTED_FOR_EXECUTION:'ADMITTED_FOR_EXECUTION',
  ALREADY_ADMITTED:'ALREADY_ADMITTED',
  EXECUTION_FAILED:'EXECUTION_FAILED',
  CANCELLED:'CANCELLED',
  SUPERSEDED:'SUPERSEDED',
  SKIPPED_BY_OWNER:'SKIPPED_BY_OWNER',
  OWNER_ACCEPTANCE_PENDING:'OWNER_ACCEPTANCE_PENDING',
  OWNER_REJECTED:'OWNER_REJECTED',
  SETTLEMENT_PENDING:'SETTLEMENT_PENDING',
  COMPLETED_AND_SATISFIED:'COMPLETED_AND_SATISFIED',
});

const terminalForDependency=new Set([ReconciliationState.DONE,ReconciliationState.SKIPPED_WITH_REASON]);

export class CognitiveObligationReconciler{
  constructor({director}={}){
    if(!director)throw new TypeError('CognitiveObligationReconciler requires a WorkerDirector');
    this.director=director;
  }

  inspect(expected){return this.#evaluate(expected,false);}
  reconcile(expected){return this.#evaluate(expected,true);}

  #evaluate(expected,submitDue){
    if(!Array.isArray(expected))throw new TypeError('expected steps must be an array');
    const seen=new Set(),steps=[];
    for(const step of expected){
      if(!step?.stepId||seen.has(step.stepId))throw new TypeError('stepId must be unique and nonempty');
      if(!step.obligation?.dedupeKey)throw new TypeError('each expected obligation requires a dedupeKey');
      seen.add(step.stepId);
      const dependency=(step.dependsOn??[]).find(id=>!terminalForDependency.has(steps.find(item=>item.stepId===id)?.state));
      let record=this.director.ledger.list().find(item=>item.obligation.dedupeKey===step.obligation.dedupeKey&&item.lifecycleStatus!==LIFECYCLE_STATUS.CANCELLED)??null;
      let why=null;
      if(!record&&step.skipReason){
        steps.push(this.#row(step,null,ReconciliationState.SKIPPED_WITH_REASON,ReconciliationReason.SKIPPED_BY_OWNER,null));
        continue;
      }
      if(!record&&submitDue&&!dependency&&typeof step.executor?.execute==='function'){
        const admitted=this.director.submit({...step.obligation,cause:step.cause??null,expectedWorkId:step.stepId,obligationChainId:step.chainId??null},step.executor);
        if(admitted.accepted){
          record=this.director.ledger.get(admitted.task.taskId);
          why=admitted.deduped?ReconciliationReason.ALREADY_ADMITTED:ReconciliationReason.ADMITTED_FOR_EXECUTION;
        }else why=String(admitted.reason??ReconciliationReason.EXECUTION_FAILED).toUpperCase().replace(/-/g,'_');
      }
      if(!record){
        const state=dependency||submitDue&&typeof step.executor?.execute!=='function'?ReconciliationState.BLOCKED:ReconciliationState.MISSING;
        const reason=dependency?ReconciliationReason.DEPENDENCY_NOT_DONE:state===ReconciliationState.BLOCKED?ReconciliationReason.EXECUTOR_NOT_PROVIDED:ReconciliationReason.OBLIGATION_NOT_CREATED;
        steps.push(this.#row(step,null,state,why??reason,null));
        continue;
      }
      const explained=this.director.explainObligation?.(record.taskId)??null;
      const admission=record.obligation?.ownerAdmission??null;
      let state=ReconciliationState.DUE,reason=why??ReconciliationReason.AWAITING_EXECUTION;
      if(record.executionStatus===EXECUTION_STATUS.FAILED){
        state=ReconciliationState.FAILED;reason=ReconciliationReason.EXECUTION_FAILED;
      }else if(record.lifecycleStatus===LIFECYCLE_STATUS.CANCELLED){
        state=ReconciliationState.SKIPPED_WITH_REASON;reason=ReconciliationReason.CANCELLED;
      }else if(record.lifecycleStatus===LIFECYCLE_STATUS.SUPERSEDED){
        state=ReconciliationState.SKIPPED_WITH_REASON;reason=ReconciliationReason.SUPERSEDED;
      }else if(record.executionStatus===EXECUTION_STATUS.BLOCKED){
        state=ReconciliationState.BLOCKED;reason=String(record.executionReason??ReconciliationReason.EXECUTOR_NOT_PROVIDED).slice(0,160);
      }else if(record.lifecycleStatus===LIFECYCLE_STATUS.SATISFIED&&record.executionStatus===EXECUTION_STATUS.COMPLETE){
        if(step.requiresOwnerAcceptance&&admission?.accepted!==true){
          state=ReconciliationState.BLOCKED;reason=admission?.accepted===false?ReconciliationReason.OWNER_REJECTED:ReconciliationReason.OWNER_ACCEPTANCE_PENDING;
        }else if(step.requiresSettlement&& !admission?.settlementReceiptId){
          state=ReconciliationState.BLOCKED;reason=ReconciliationReason.SETTLEMENT_PENDING;
        }else{
          state=ReconciliationState.DONE;reason=ReconciliationReason.COMPLETED_AND_SATISFIED;
        }
      }
      steps.push(this.#row(step,record,state,reason,explained));
    }
    return Object.freeze({
      kind:'CognitiveObligationReconciliation',contractVersion:'1.1.0',steps,
      complete:steps.every(step=>terminalForDependency.has(step.state)),
      ownerAccepted:steps.filter(step=>step.ownerAccepted===true).length,
      failed:steps.filter(step=>step.state===ReconciliationState.FAILED).length,
      blocked:steps.filter(step=>step.state===ReconciliationState.BLOCKED).length,
      skipped:steps.filter(step=>step.state===ReconciliationState.SKIPPED_WITH_REASON).length,
    });
  }

  #row(step,record,state,reason,explained){
    const admission=record?.obligation?.ownerAdmission??null;
    return Object.freeze({
      stepId:String(step.stepId),chainId:step.chainId??record?.obligation?.obligationChainId??null,
      owner:step.obligation.owner,state,reasonCode:String(reason),skipReason:step.skipReason??record?.executionReason??null,
      taskId:record?.taskId??null,executionStatus:record?.executionStatus??null,lifecycleStatus:record?.lifecycleStatus??null,
      physicalExecutionAttempted:Number(record?.startedCount??0)>0,
      physicalExecutionReturned:(record?.resultReceipts?.length??0)>0||record?.executionStatus===EXECUTION_STATUS.COMPLETE,
      ownerAccepted:typeof admission?.accepted==='boolean'?admission.accepted:null,
      ownerReceiptId:admission?.receiptId??null,settlementReceiptId:admission?.settlementReceiptId??null,
      cause:sanitizeObligationCause(explained?.cause??record?.obligation?.cause??step.cause),
      communications:explained?.communications??[],
    });
  }
}
