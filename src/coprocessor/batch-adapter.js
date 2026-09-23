import { ResultClass, TelemetryEvent } from './constants.js';
import { toRuntimeObligation } from './runtime-compatibility.js';

export class AdaptiveSidecarSlicePolicy {
  constructor({base=8,min=1,max=32,targetLatencyMs=80,reservedOutputTokens=512}={}){
    this.base=base;this.min=min;this.max=max;this.targetLatencyMs=targetLatencyMs;this.reservedOutputTokens=reservedOutputTokens;
  }
  choose({itemCount,averageTokensPerItem=128,previousLatencyMs=0,outputExpansion=1,providerErrors=0,contextLimitTokens=8192,deadlineClass=ResultClass.DEFERRED}={}){
    let size=this.base;
    if(previousLatencyMs>this.targetLatencyMs)size=Math.ceil(size/2);
    if(Number(outputExpansion)>1.5)size=Math.ceil(size/2);
    if(Number(providerErrors)>0)size=Math.ceil(size/2);
    if(deadlineClass===ResultClass.REQUIRED)size=Math.ceil(size/2);
    const usable=Math.max(1,Number(contextLimitTokens)-this.reservedOutputTokens);
    const tokenBound=Math.max(1,Math.floor(usable/Math.max(1,Number(averageTokensPerItem))));
    return Math.max(this.min,Math.min(this.max,Number(itemCount)||this.max,size,tokenBound));
  }
}

export class PartialResultAccumulator {
  constructor(){this.committed=new Map();this.failures=[];}
  commit({sliceId,unitIds,output}){if(this.committed.has(sliceId))return this.committed.get(sliceId);const receipt={sliceId,unitIds:[...unitIds],output:structuredClone(output)};this.committed.set(sliceId,receipt);return receipt;}
  fail({sliceId,unitIds,error}){this.failures.push({sliceId,unitIds:[...unitIds],message:error?.message??String(error)});}
  snapshot(){return{committedSlices:[...this.committed.values()].map((value)=>structuredClone(value)),failedSlices:structuredClone(this.failures),
    committedUnits:[...this.committed.values()].reduce((n,r)=>n+r.unitIds.length,0),failedUnits:this.failures.reduce((n,r)=>n+r.unitIds.length,0)};}
}

export class SidecarBatchAdapter {
  constructor({slicePolicy=new AdaptiveSidecarSlicePolicy(),telemetry=null}={}){this.slicePolicy=slicePolicy;this.telemetry=telemetry;}
  prepare(task,items,{averageTokensPerItem=128,previousLatencyMs=0,outputExpansion=1,providerErrors=0,contextLimitTokens=8192}={}){
    if(!Array.isArray(items))throw new TypeError('batch items must be an array');
    const maxSliceUnits=this.slicePolicy.choose({itemCount:items.length,averageTokensPerItem,previousLatencyMs,outputExpansion,providerErrors,
      contextLimitTokens,deadlineClass:task.resultClass});
    const base=toRuntimeObligation(task);
    const obligation={...base,batchHint:{...base.batchHint,maxSliceUnits},checkpointPolicy:{...base.checkpointPolicy,maxUnitsPerCheckpoint:maxSliceUnits},
      yieldPolicy:{...base.yieldPolicy,maxUninterruptedSliceMs:task.resultClass===ResultClass.REQUIRED?50:100}};
    const units=items.map((payload,index)=>({id:payload?.id??`${task.taskId}:unit:${index}`,payload}));
    return Object.freeze({obligation:Object.freeze(obligation),units:Object.freeze(units),maxSliceUnits});
  }
  createSubmission(task,items,{executeSlice,validateSlice=()=>true,accumulator=new PartialResultAccumulator(),signals={}}={}){
    if(typeof executeSlice!=='function')throw new TypeError('executeSlice is required');
    const prepared=this.prepare(task,items,signals);
    const telemetry=this.telemetry;
    return{
      ...prepared,accumulator,
      execute:async({task:runtimeTask,units,sliceId})=>{
        const started=Date.now();const output=await executeSlice({task:runtimeTask,units,sliceId});
        telemetry?.emit(TelemetryEvent.BATCH_SLICE,{taskId:task.taskId,sliceId,unitCount:units.length,phase:'EXECUTED',latency:Date.now()-started});
        return output;
      },
      validate:async(args)=>Boolean(await validateSlice(args)),
      commit:async({units,output,sliceId})=>{
        const receipt=accumulator.commit({sliceId,unitIds:units.map(x=>x.id),output});
        telemetry?.emit(TelemetryEvent.BATCH_SLICE,{taskId:task.taskId,sliceId,unitCount:units.length,phase:'COMMITTED'});
        return receipt;
      },
    };
  }
}

export function createGreenRoomBatchUnits(characters=[]){
  return characters.map((character,index)=>({id:`green-room:${character.characterId??index}`,...structuredClone(character)}));
}
