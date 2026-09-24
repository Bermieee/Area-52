import { Freshness, ResultDestination } from './constants.js';
import { classifyFreshness } from './validation.js';

export class ExecutionAdmissionGuard {
  #tasks=new Map();#results=new Set();#dedupe=new Map();
  register(task){
    if(!task?.taskId)throw new TypeError('taskId is required');
    const existing=this.#dedupe.get(task.dedupeKey);
    if(existing)return Object.freeze({accepted:false,duplicate:true,taskId:existing});
    this.#tasks.set(task.taskId,{status:'ACTIVE',dedupeKey:task.dedupeKey,revision:structuredClone(task.inputRevisionSet)});
    this.#dedupe.set(task.dedupeKey,task.taskId);
    return Object.freeze({accepted:true,duplicate:false,taskId:task.taskId});
  }
  cancel(taskId){return this.#set(taskId,'CANCELLED');}
  supersede(taskId){return this.#set(taskId,'SUPERSEDED');}
  park(taskId){return this.#set(taskId,'PARKED');}
  resume(taskId,currentRevisionSet){
    const row=this.#required(taskId);const freshness=classifyFreshness(row.revision,currentRevisionSet);
    if(freshness!==Freshness.FRESH){row.status='SUPERSEDED';return Object.freeze({accepted:false,status:row.status,freshness,action:'REPLAN'});}
    row.status='ACTIVE';return Object.freeze({accepted:true,status:row.status,freshness,action:'RESUME'});
  }
  admit(result,{currentRevisionSet=null,sealed=false}={}){
    const row=this.#tasks.get(result?.taskId);
    if(!row)return Object.freeze({accepted:false,reason:'UNKNOWN_TASK',destination:ResultDestination.DIAGNOSTIC_ONLY});
    if(this.#results.has(result.resultId))return Object.freeze({accepted:false,duplicate:true,reason:'DUPLICATE_RESULT',destination:ResultDestination.DROP});
    this.#results.add(result.resultId);
    if(['CANCELLED','SUPERSEDED'].includes(row.status))return Object.freeze({accepted:false,reason:row.status,destination:ResultDestination.DROP});
    if(currentRevisionSet){
      const freshness=classifyFreshness(result.freshnessIdentity??row.revision,currentRevisionSet);
      if(freshness!==Freshness.FRESH)return Object.freeze({accepted:false,reason:'STALE_OR_FUTURE',freshness,destination:ResultDestination.DROP});
    }
    if(sealed)return Object.freeze({accepted:false,late:true,reason:'SEALED',destination:ResultDestination.NEXT_TURN});
    return Object.freeze({accepted:true,reason:'ACTIVE',destination:ResultDestination.FOREGROUND});
  }
  exportState(){return structuredClone({tasks:[...this.#tasks],results:[...this.#results],dedupe:[...this.#dedupe]});}
  importState(state){this.#tasks=new Map(state?.tasks??[]);this.#results=new Set(state?.results??[]);this.#dedupe=new Map(state?.dedupe??[]);return this;}
  #set(taskId,status){const row=this.#required(taskId);row.status=status;return Object.freeze({taskId,status});}
  #required(taskId){const row=this.#tasks.get(taskId);if(!row)throw new Error(\`Unknown task: \${taskId}\`);return row;}
}
