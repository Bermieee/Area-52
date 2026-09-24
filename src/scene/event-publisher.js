import { SceneEventType, createSceneEventEnvelope } from './lifecycle-contracts.js';

const clone=(v)=>structuredClone(v);
const immutable=(value)=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))immutable(item);Object.freeze(value);}return value;};
export class SceneEventPublisher{
  constructor({sink=null,maxDedupe=512}={}){this.sink=sink;this.maxDedupe=maxDedupe;this.sequence=0;this.dedupe=new Map();}
  publish({eventType,sceneId,sceneRevision,sourceRevisionRefs=[],payload={},correlationId=null,causationId=null,turnId=null,dedupeKey=null,eventId=null}){
    if(!Object.values(SceneEventType).includes(eventType))throw new TypeError(`unsupported Scene event ${eventType}`);
    const key=dedupeKey?`${eventType}:${dedupeKey}`:null;if(key&&this.dedupe.has(key))return immutable(clone(this.dedupe.get(key)));
    const sequence=++this.sequence;const event=createSceneEventEnvelope({eventId:eventId??`scene-event:${sequence}`,eventType,sceneId,sceneRevision,sourceRevisionRefs,payload,correlationId,causationId,turnId,sequence,dedupeKey,createdAt:sequence});
    if(key){this.dedupe.set(key,event);while(this.dedupe.size>this.maxDedupe)this.dedupe.delete(this.dedupe.keys().next().value);}
    this.sink?.(event);return immutable(clone(event));
  }
  descriptors(){return Object.values(SceneEventType).map((eventType)=>({eventType,schemaVersion:'1.0',producer:'SCENE_INTELLIGENCE',payloadSchema:{allowUnknown:true}}));}
  isFresh(event,currentSceneRevision){return event.sceneRevision===currentSceneRevision;}
  runtimeEmitArgs(event){return {eventType:event.eventType,payload:clone(event.payload),meta:{eventId:event.eventId,schemaVersion:event.schemaVersion,producer:event.producer,causationId:event.causationId,correlationId:event.correlationId,turnId:event.turnId,sceneRevision:event.sceneRevision,sourceRevisions:event.sourceRevisions,dedupeKey:event.dedupeKey,createdAt:event.createdAt}};}
}
