import {
  ResultClass,ResultDestination,ResultFreshness,ResultPayloadClass,
  createCognitiveResult,createResultRoute,
} from './publication-contracts.js';

const clone=(value)=>structuredClone(value);

export class ResultBus {
  #results=new Map();
  #routes=new Map();
  #sequence=0;

  constructor({registry=null,getWorldRevision=()=>0,getSceneRevision=()=>0,isTurnSealed=()=>false}={}){
    this.registry=registry;
    this.getWorldRevision=getWorldRevision;
    this.getSceneRevision=getSceneRevision;
    this.isTurnSealed=isTurnSealed;
  }

  receive(input){
    const result=input?.kind==='CognitiveResult'?clone(input):createCognitiveResult(input);
    if(this.#results.has(result.id)){
      return{result:clone(this.#results.get(result.id)),route:clone(this.#routes.get(result.id)),duplicate:true};
    }

    const freshness=this.#freshness(result);
    const late=Boolean(result.turnId&&this.isTurnSealed(result.turnId));
    const effectiveDestination=this.#destination(result,freshness,late);
    const accepted=freshness!==ResultFreshness.INVALID;
    const reason=this.#reason(result,freshness,late,effectiveDestination);

    const stored={...result,freshness,
      staleReason:freshness===ResultFreshness.STALE?reason:null,
      rejectionReason:freshness===ResultFreshness.INVALID?reason:null};
    this.#sequence+=1;
    const route=createResultRoute({
      id:`result-route:${this.#sequence}:${result.id}`,
      resultId:result.id,accepted,effectiveDestination,freshness,late,reason,
      turnId:result.turnId,correlationId:result.correlationId,sequence:this.#sequence,
    });
    this.#results.set(result.id,stored);
    this.#routes.set(result.id,route);
    return{result:clone(stored),route:clone(route),duplicate:false};
  }

  receiveCandidate(candidate,{
    taskId,turnId,correlationId,causationId=null,sourceSubsystem='SENSORY_NET',
    workerId='retrieval:in-process',resultClass=ResultClass.REQUIRED,
    destination=ResultDestination.FOREGROUND,worldRevision=this.getWorldRevision(),
    sceneRevision=this.getSceneRevision(),timing={},
  }={}){
    const sourceRevisionIds=[...new Set(candidate.sourceRevisionRefs??candidate.legacyProvenance?.sourceRevisionIds??candidate.provenance?.sourceRevisionIds??[])].sort();
    const provenance=candidate.legacyProvenance??(Array.isArray(candidate.provenance)?{sourceRevisionIds,candidateProvenance:clone(candidate.provenance),evidenceIdentity:candidate.evidenceIdentity??null}:candidate.provenance??{});
    return this.receive(createCognitiveResult({
      id:`result:${candidate.candidateId}:${correlationId}`,
      taskId,turnId,correlationId,causationId,sourceSubsystem,workerId,
      destinationOwner:null,resultType:'RETRIEVAL_CANDIDATE',
      resultClass,payloadClass:ResultPayloadClass.DERIVED_DATA,
      evidenceIds:[...(candidate.claimIds??candidate.claimRefs??[])],provenance,
      sourceRevisionIds,worldRevision,sceneRevision,authorityClass:'UNRESOLVED',
      destination,payload:candidate,timing,
    }));
  }

  #freshness(result){
    if(result.sourceRevisionIds.some(id=>this.registry&&!this.registry.isActiveRevision(id)))return ResultFreshness.STALE;
    const world=Number(this.getWorldRevision());
    const scene=Number(this.getSceneRevision());
    if(Number.isFinite(world)){
      if(result.worldRevision>world)return ResultFreshness.INVALID;
      if(result.worldRevision<world)return ResultFreshness.STALE;
    }
    if(Number.isFinite(scene)){
      if(result.sceneRevision>scene)return ResultFreshness.INVALID;
      if(result.sceneRevision<scene)return ResultFreshness.STALE;
    }
    return ResultFreshness.FRESH;
  }

  #destination(result,freshness,late){
    if(freshness===ResultFreshness.INVALID)return ResultDestination.EVALUATION;
    if(freshness===ResultFreshness.STALE)return ResultDestination.EVALUATION;
    if(!late)return result.destination;
    if(result.destination!==ResultDestination.FOREGROUND)return result.destination;
    if(result.resultClass===ResultClass.DEFERRED)return ResultDestination.BACKGROUND;
    return ResultDestination.NEXT_TURN;
  }

  #reason(result,freshness,late,effectiveDestination){
    if(freshness===ResultFreshness.INVALID)return'future revision fence is invalid for the receiving world/scene';
    if(freshness===ResultFreshness.STALE)return'result content may be valid but its source/world/scene revision fence is stale';
    if(late&&result.destination===ResultDestination.FOREGROUND)return`turn already sealed; routed to ${effectiveDestination}`;
    return'fresh result routed according to normalized destination policy';
  }

  get(resultId){
    const result=this.#results.get(resultId),route=this.#routes.get(resultId);
    return result?{result:clone(result),route:clone(route)}:null;
  }

  results({destination=null,freshness=null,turnId=null}={}){
    const out=[];
    for(const[id,result]of this.#results){
      const route=this.#routes.get(id);
      if(destination&&route.effectiveDestination!==destination)continue;
      if(freshness&&route.freshness!==freshness)continue;
      if(turnId&&result.turnId!==turnId)continue;
      out.push({result:clone(result),route:clone(route)});
    }
    return out.sort((a,b)=>a.route.sequence-b.route.sequence);
  }

  foreground(turnId){
    return this.results({destination:ResultDestination.FOREGROUND,turnId}).filter(x=>x.route.freshness===ResultFreshness.FRESH);
  }
}
