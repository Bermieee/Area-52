import { createShadowContextCandidate } from './shadow-context-scorer.js';

const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
const req=(v,n)=>{if(typeof v!=='string'||!v.trim())throw new TypeError(n+' must be a non-empty string');return v.trim();};
const freezeDeep=(v)=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))freezeDeep(x);Object.freeze(v);}return v;};

export const NEXUS_SHADOW_ADAPTER_VERSION='1.0.0';
export const NexusShadowStatus=Object.freeze({REPLAY_ADAPTER_READY:'REPLAY_ADAPTER_READY',LIVE_SHADOW_CONNECTION_PENDING:'LIVE_SHADOW_CONNECTION_PENDING',LIVE_SHADOW_CONNECTED:'LIVE_SHADOW_CONNECTED'});

export function createNexusSnapshot({
  snapshotId,chatId=null,turnId=null,capturedAt=null,loreObservations=[],characterState=[],durableLore=[],smartContext=[],promptLoader=null,diagnosticRefs=[],
}={}){
  return freezeDeep({kind:'NexusSnapshot',contractVersion:NEXUS_SHADOW_ADAPTER_VERSION,snapshotId:req(snapshotId,'NexusSnapshot.snapshotId'),chatId:chatId==null?null:String(chatId),turnId:turnId==null?null:String(turnId),capturedAt,
    loreObservations:clone(loreObservations),characterState:clone(characterState),durableLore:clone(durableLore),smartContext:clone(smartContext),promptLoader:clone(promptLoader),diagnosticRefs:uniq(diagnosticRefs),
    authority:'OBSERVATION_ONLY',readOnly:true,mutationAllowed:false});
}
export function createNexusTurnObservation({
  observationId,turnId,generationId=null,narrativeFeed=[],contextRefs=[],promptPlanObservation=null,diagnosticRefs=[],
}={}){
  return freezeDeep({kind:'NexusTurnObservation',contractVersion:NEXUS_SHADOW_ADAPTER_VERSION,observationId:req(observationId,'NexusTurnObservation.observationId'),turnId:req(turnId,'NexusTurnObservation.turnId'),generationId:generationId==null?null:String(generationId),
    narrativeFeed:clone(narrativeFeed),contextRefs:uniq(contextRefs),promptPlanObservation:clone(promptPlanObservation),diagnosticRefs:uniq(diagnosticRefs),
    authority:'OBSERVATION_ONLY',readOnly:true,mutationAllowed:false});
}
export function createNexusContextCandidate({
  candidateId,turnId,generationId=null,payload={},facts=[],current=[],historical=[],unresolved=[],unresolvedThreads=[],
  sourceRevisionRefs=[],provenanceRefs=[],provenanceIndex={},latencyMs=null,nextBeatRefs=[],evidenceRefs=[],
}={}){
  const base=createShadowContextCandidate({candidateId,system:'NEXUS',turnId,generationId,payload,facts,current,historical,unresolved,unresolvedThreads,sourceRevisionRefs,provenanceRefs,provenanceIndex,latencyMs,nextBeatRefs,evidenceRefs});
  return freezeDeep({...base,kind:'NexusContextCandidate',contractVersion:NEXUS_SHADOW_ADAPTER_VERSION,readOnly:true,mutationAllowed:false});
}
export function createNexusWorkerObservation({
  observationId,turnId=null,workerId,routeId=null,planId=null,decisionRefs=[],bounded=true,diagnosticRefs=[],
}={}){
  return freezeDeep({kind:'NexusWorkerObservation',contractVersion:NEXUS_SHADOW_ADAPTER_VERSION,observationId:req(observationId,'NexusWorkerObservation.observationId'),turnId:turnId==null?null:String(turnId),workerId:req(workerId,'NexusWorkerObservation.workerId'),routeId:routeId==null?null:String(routeId),planId:planId==null?null:String(planId),decisionRefs:uniq(decisionRefs),bounded:Boolean(bounded),diagnosticRefs:uniq(diagnosticRefs),authority:'OBSERVATION_ONLY',readOnly:true,mutationAllowed:false});
}

export function exportNexusShadowReplay({replayId,snapshot=null,turns=[],contexts=[],workers=[]}={}){
  return freezeDeep({kind:'NexusShadowReplay',contractVersion:NEXUS_SHADOW_ADAPTER_VERSION,replayId:req(replayId,'NexusShadowReplay.replayId'),snapshot:clone(snapshot),turns:clone(turns),contexts:clone(contexts),workers:clone(workers),mutationAllowed:false});
}
export function importNexusShadowReplay(input){
  if(input?.kind!=='NexusShadowReplay'||String(input.contractVersion??'').split('.')[0]!=='1')throw new TypeError('invalid NexusShadowReplay');
  const replay=clone(input);
  replay.replayState='REPLAYED';
  replay.authority='EVALUATION_ONLY';
  replay.mutationAllowed=false;
  return freezeDeep(replay);
}

export class NexusShadowIntegrationAdapter{
  constructor({readSnapshot=null,readTurn=null,readContext=null,readWorker=null}={}){
    this.readers={readSnapshot,readTurn,readContext,readWorker};
  }
  status(){
    const connected=Object.values(this.readers).some(fn=>typeof fn==='function');
    return freezeDeep({kind:'NexusShadowAdapterStatus',replay:NexusShadowStatus.REPLAY_ADAPTER_READY,live:connected?NexusShadowStatus.LIVE_SHADOW_CONNECTED:NexusShadowStatus.LIVE_SHADOW_CONNECTION_PENDING,liveAcceptance:false,readOnly:true,mutationAllowed:false});
  }
  importReplay(input){return importNexusShadowReplay(input);}
  async observe({snapshotArgs=null,turnArgs=null,contextArgs=null,workerArgs=null}={}){
    const call=async(name,args)=>typeof this.readers[name]==='function'?clone(await this.readers[name](clone(args??{}))):null;
    const result={kind:'NexusShadowLiveObservation',snapshot:await call('readSnapshot',snapshotArgs),turn:await call('readTurn',turnArgs),context:await call('readContext',contextArgs),worker:await call('readWorker',workerArgs),readOnly:true,mutationAllowed:false,liveAcceptance:false};
    return freezeDeep(result);
  }
}
