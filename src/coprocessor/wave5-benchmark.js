import { transportCandidateMatrix } from './cognitive-data-plane.js';

export const Wave5MeasurementState=Object.freeze({MEASURED:'MEASURED',REPLAYED:'REPLAYED',NOT_MEASURED:'NOT_MEASURED',NOT_APPLICABLE:'NOT_APPLICABLE'});
export const RepresentativeTurnClass=Object.freeze({
  SIMPLE_ACKNOWLEDGEMENT:'simple acknowledgement',
  DIALOGUE_HEAVY:'dialogue-heavy turn',
  INVENTORY_LOCATION:'inventory/location action',
  HISTORICAL_CALLBACK:'historical callback',
  MULTI_CHARACTER_EMOTIONAL:'multi-character emotional scene',
  HIGH_AMBIGUITY:'high ambiguity turn',
  LARGE_RETRIEVAL:'large retrieval turn',
  BACKGROUND_MAINTENANCE:'background maintenance window',
});

export function qualifyDataPlaneTransports({measurements={}}={}){
  return Object.freeze(transportCandidateMatrix().map((candidate)=>{
    const provided=measurements[candidate.transport];
    if(provided!=null)return Object.freeze({...candidate,measurement:Object.freeze({status:Wave5MeasurementState.MEASURED,value:structuredClone(provided)})});
    if(candidate.adopted)return Object.freeze({...candidate,measurement:Object.freeze({status:Wave5MeasurementState.REPLAYED,value:{classification:candidate.classification}})});
    return Object.freeze({...candidate,measurement:Object.freeze({status:Wave5MeasurementState.NOT_MEASURED,value:null,reason:'transport runtime not available in this environment'})});
  }));
}

export function daprBenchmarkStatus({measurement=null}={}){
  return measurement==null
    ?Object.freeze({status:Wave5MeasurementState.NOT_MEASURED,value:null,evaluationOnly:true})
    :Object.freeze({status:Wave5MeasurementState.MEASURED,value:structuredClone(measurement),evaluationOnly:true});
}

export function summarizeRepresentativeSwarm(rows=[]){
  return Object.freeze({
    kind:'RepresentativeSwarmBenchmark',
    rows:Object.freeze(rows.map((row)=>Object.freeze({
      turnClass:row.turnClass,plannedWorkers:Number(row.plannedWorkers??0),hotWorkers:Number(row.hotWorkers??0),deepWorkers:Number(row.deepWorkers??0),
      zeroWorker:Number(row.plannedWorkers??0)===0,fallbacks:Number(row.fallbacks??0),stale:Number(row.stale??0),warmHits:Number(row.warmHits??0),
      precisionInput:Number(row.precisionInput??0),precisionOutput:Number(row.precisionOutput??0),foregroundDelayMs:Number(row.foregroundDelayMs??0),
      measurementState:row.measurementState??Wave5MeasurementState.REPLAYED,
    }))),
  });
}

export function buildFt006CoprocessorMetrics(rows=[]){
  const list=[...rows];
  return Object.freeze({
    turns:list.length,workersWoken:list.reduce((n,x)=>n+Number(x.plannedWorkers??0),0),
    hotWorkers:list.reduce((n,x)=>n+Number(x.hotWorkers??0),0),deepWorkers:list.reduce((n,x)=>n+Number(x.deepWorkers??0),0),
    zeroWorkerTurns:list.filter((x)=>Number(x.plannedWorkers??0)===0).length,fallbacks:list.reduce((n,x)=>n+Number(x.fallbacks??0),0),
    staleResults:list.reduce((n,x)=>n+Number(x.stale??0),0),warmHits:list.reduce((n,x)=>n+Number(x.warmHits??0),0),
    precisionCandidatesIn:list.reduce((n,x)=>n+Number(x.precisionInput??0),0),precisionCandidatesOut:list.reduce((n,x)=>n+Number(x.precisionOutput??0),0),
    measurementState:Wave5MeasurementState.REPLAYED,
  });
}
