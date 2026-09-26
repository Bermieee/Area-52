const finite=(v)=>Number.isFinite(Number(v))?Number(v):null;
const nowDefault=()=>globalThis.performance?.now?.()??Date.now();
const boundedScalar=(value,depth=0)=>{
  if(value==null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return value.slice(0,160);
  if(depth>=2)return'[bounded]';
  if(Array.isArray(value))return value.slice(0,12).map(row=>boundedScalar(row,depth+1));
  if(typeof value!=='object')return String(value);
  const out={};for(const [key,row] of Object.entries(value).slice(0,24)){
    const k=String(key),normalized=k.toLowerCase().replace(/[^a-z0-9]/g,'');
    if(/prompt|content|body|message|story|lorebody|apikey|credential|secret|reasoning|chainofthought/.test(normalized))continue;
    out[k]=boundedScalar(row,depth+1);
  }return out;
};

export class OperatorLoadTrace{
  constructor({clock=nowDefault,performanceObject=globalThis.performance??null,maxLongTasks=32}={}){
    this.clock=typeof clock==='function'?clock:nowDefault;this.performanceObject=performanceObject;this.maxLongTasks=Math.max(8,Number(maxLongTasks)||32);
    this.counters={hostUpdates:0,ownerUpdates:0,suppressedRoutineHostRefreshes:0,hostRefreshesScheduled:0,evidenceCapturesScheduled:0,evidenceCapturesExecuted:0,activityFeedRendersScheduled:0};
    this.hostEvents={};this.ownerStages={};this.areas={};this.ownerTimings={SCATTER:{state:'NO_EVIDENCE'},GATHER:{state:'NO_EVIDENCE'}};
    this.longTasks=[];this.longTaskObserver=null;this.destroyed=false;
    try{
      const Observer=globalThis.PerformanceObserver;
      if(typeof Observer==='function'&&Observer.supportedEntryTypes?.includes?.('longtask')){
        this.longTaskObserver=new Observer(list=>{for(const row of list.getEntries())this.#longTask(row);});
        this.longTaskObserver.observe({entryTypes:['longtask']});
      }
    }catch{}
  }
  increment(name,amount=1){if(this.destroyed)return;this.counters[name]=Number(this.counters[name]??0)+Number(amount||0);}
  noteUpdate(update=null){
    const event=update?.event??update??{},hostEvent=event?.hostEvent??null,ownerStage=event?.stage??null;
    if(hostEvent){const key=String(hostEvent);this.counters.hostUpdates+=1;this.hostEvents[key]=(this.hostEvents[key]??0)+1;}
    if(ownerStage){const key=String(ownerStage).toUpperCase();this.counters.ownerUpdates+=1;this.ownerStages[key]=(this.ownerStages[key]??0)+1;this.observeOwnerReceipt(key,event);}
    return{hostEvent:hostEvent?String(hostEvent):null,ownerStage:ownerStage?String(ownerStage).toUpperCase():null,routineStreamingHostEvent:String(hostEvent??'')==='MESSAGE_UPDATED'};
  }
  measure(area,fn){
    const start=this.clock();try{return fn();}finally{this.record(area,Math.max(0,this.clock()-start));}
  }
  record(area,durationMs){
    if(this.destroyed)return;const key=String(area),duration=Math.max(0,Number(durationMs)||0),row=this.areas[key]??{count:0,totalMs:0,maxMs:0};
    row.count+=1;row.totalMs+=duration;row.maxMs=Math.max(row.maxMs,duration);this.areas[key]=row;
  }
  observeOwnerReceipt(stage,receipt){
    const key=String(stage??'').toUpperCase();if(!['SCATTER','GATHER'].includes(key)||!receipt||typeof receipt!=='object')return;
    let duration=finite(receipt.durationMs);
    const started=finite(receipt.startedAt??receipt.startAt),ended=finite(receipt.completedAt??receipt.endAt);if(duration==null&&started!=null&&ended!=null&&ended>=started)duration=ended-started;
    const concurrency=finite(receipt.concurrency??receipt.activeConcurrency??receipt.maxConcurrency);
    const deferred=finite(receipt.deferredWorkCount??receipt.deferredCount??receipt.deferred?.length);
    const waves=receipt.waveTriggers??receipt.waves??receipt.layeredScatter?.waves??null;
    const hasTiming=duration!=null||concurrency!=null||deferred!=null||waves!=null;
    this.ownerTimings[key]=hasTiming?{state:'OBSERVED',durationMs:duration,concurrency,deferredWork:deferred,waveTriggers:boundedScalar(waves)}:{state:'NO_EVIDENCE'};
  }
  snapshot(){
    const longTaskTotalMs=this.longTasks.reduce((sum,row)=>sum+row.durationMs,0),longTaskMaxMs=this.longTasks.reduce((max,row)=>Math.max(max,row.durationMs),0);
    const heap=finite(this.performanceObject?.memory?.usedJSHeapSize);
    return{
      kind:'Area52OperatorLoadTrace',contractVersion:1,counters:{...this.counters},hostEvents:{...this.hostEvents},ownerStages:{...this.ownerStages},
      areas:Object.fromEntries(Object.entries(this.areas).map(([key,row])=>[key,{count:row.count,totalMs:Number(row.totalMs.toFixed(3)),maxMs:Number(row.maxMs.toFixed(3)),avgMs:row.count?Number((row.totalMs/row.count).toFixed(3)):0}])),
      ownerTimings:boundedScalar(this.ownerTimings),longTasks:{supported:Boolean(this.longTaskObserver),count:this.longTasks.length,totalMs:Number(longTaskTotalMs.toFixed(3)),maxMs:Number(longTaskMaxMs.toFixed(3))},
      heap:{usedJSHeapSize:heap},rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
    };
  }
  destroy(){this.destroyed=true;try{this.longTaskObserver?.disconnect?.();}catch{}this.longTaskObserver=null;this.longTasks=[];}
  #longTask(entry){const duration=Math.max(0,Number(entry?.duration)||0);this.longTasks.push({durationMs:duration,startTime:finite(entry?.startTime)});if(this.longTasks.length>this.maxLongTasks)this.longTasks.splice(0,this.longTasks.length-this.maxLongTasks);}
}
