const clone=(v)=>structuredClone(v);
export class ScenePrefetchTrigger{
  constructor({maxPending=32,defaultTtlRevisions=3}={}){this.maxPending=maxPending;this.defaultTtlRevisions=defaultTtlRevisions;this.pending=new Map();this.seq=0;}
  recommend({sceneId,sceneRevision,trigger,entityRefs=[],locationRefs=[],threadRefs=[],sceneRefs=[],priority='NORMAL',evidenceRefs=[],sourceRevisionRefs=[],ttlRevisions=this.defaultTtlRevisions}){
    const sourceRevisionSet=[...new Set(sourceRevisionRefs)].sort();const id=`prefetch:${sceneId}:${sceneRevision}:${++this.seq}`;const r={kind:'PrefetchRecommendation',contractVersion:'1.0.0',recommendationId:id,sceneId,sceneRevision,trigger,entityRefs:[...new Set(entityRefs)],locationRefs:[...new Set(locationRefs)],threadRefs:[...new Set(threadRefs)],sceneRefs:[...new Set(sceneRefs)],priority,expiryRevision:sceneRevision+ttlRevisions,evidenceRefs:[...new Set(evidenceRefs)],sourceRevisionRefs:[...sourceRevisionSet],sourceRevisionSet,authority:'NONE',status:'ACTIVE'};
    this.pending.set(id,r);while(this.pending.size>this.maxPending)this.pending.delete(this.pending.keys().next().value);return clone(r);
  }
  active({sceneId,sceneRevision}){this.expire({sceneId,sceneRevision});return [...this.pending.values()].filter((x)=>x.sceneId===sceneId&&x.status==='ACTIVE').map(clone);}
  expire({sceneId,sceneRevision}){for(const r of this.pending.values())if(r.sceneId===sceneId&&r.expiryRevision<sceneRevision)r.status='EXPIRED';}
  cancelSuperseded({sceneId,sceneRevision}){for(const r of this.pending.values())if(r.sceneId===sceneId&&r.sceneRevision<sceneRevision)r.status='CANCELLED';}
  isFresh(recommendation,{sceneId,sceneRevision}={}){return recommendation?.kind==='PrefetchRecommendation'&&recommendation.status==='ACTIVE'&&recommendation.sceneId===sceneId&&Number(recommendation.sceneRevision)===Number(sceneRevision)&&Number(sceneRevision)<=Number(recommendation.expiryRevision);}
  exportState(){return clone({version:1,seq:this.seq,pending:[...this.pending.values()]});}
  static importState(state){const p=new ScenePrefetchTrigger();p.seq=state.seq??0;for(const r of state.pending??[])p.pending.set(r.recommendationId,r);return p;}
}
