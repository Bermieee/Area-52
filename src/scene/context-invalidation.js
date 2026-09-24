import { createSceneContextInvalidationSignal } from './integration-contracts.js';

const clone=(v)=>structuredClone(v);
export class SceneContextInvalidationPublisher{
  constructor({sink=null,maxDedupe=256}={}){this.sink=sink;this.maxDedupe=maxDedupe;this.dedupe=new Map();}
  publish(input={}){
    const signal=createSceneContextInvalidationSignal(input);const prior=this.dedupe.get(signal.invalidationId);if(prior)return clone(prior);
    this.dedupe.set(signal.invalidationId,signal);while(this.dedupe.size>this.maxDedupe)this.dedupe.delete(this.dedupe.keys().next().value);
    this.sink?.(signal);return clone(signal);
  }
  isFresh(signal,{sceneId,sceneRevision}={}){return signal?.toSceneRef?.sceneId===sceneId&&Number(signal?.toSceneRef?.sceneRevision)===Number(sceneRevision);}
  size(){return this.dedupe.size;}
  exportState(){return clone({version:1,maxDedupe:this.maxDedupe,dedupe:[...this.dedupe.entries()]});}
  static importState(state,{sink=null}={}){const p=new SceneContextInvalidationPublisher({sink,maxDedupe:state?.maxDedupe??256});p.dedupe=new Map(state?.dedupe??[]);return p;}
}
