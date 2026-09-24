import { SceneEventType, createSceneEventEnvelope } from './lifecycle-contracts.js';

const clone=(v)=>structuredClone(v);
const immutable=(value)=>{if(value&&typeof value==='object'){for(const item of Object.values(value))immutable(item);if(!Object.isFrozen(value))Object.freeze(value);}return value;};
export class SceneEventPublisher{
  constructor({sink=null,maxDedupe=512}={}){this.sink=sink;this.maxDedupe=maxDedupe;this.sequence=0;this.dedupe=new Map();}
  publish({eventType,sceneId,sceneRevision,sourceRevisionRefs=[],payload={},correlationId=null,causationId=null,turnId=null,dedupeKey=null,eventId=null}){
    if(!Object.values(SceneEventType).includes(eventType))throw new TypeError(`unsupported Scene event ${eventType}`);
    const key=dedupeKey?`${eventType}:${dedupeKey}`:null;if(key&&this.dedupe.has(key))return immutable(clone(this.dedupe.get(key)));
    const sequence=++this.sequence;const event=immutable(createSceneEventEnvelope({eventId:eventId??`scene-event:${sequence}`,eventType,sceneId,sceneRevision,sourceRevisionRefs,payload,correlationId,causationId,turnId,sequence,dedupeKey,createdAt:sequence}));
    const validation=this.validateCompatibility(event);if(!validation.ok){const error=new Error(`Scene event rejected: ${validation.code}`);error.code=validation.code;throw error;}
    if(key){this.dedupe.set(key,event);while(this.dedupe.size>this.maxDedupe)this.dedupe.delete(this.dedupe.keys().next().value);}
    this.sink?.(event);return immutable(clone(event));
  }
  descriptors(){return this.runtimeDescriptors();}
  runtimeDescriptors(){return Object.values(SceneEventType).map((eventType)=>({eventType,schemaVersion:'1.0',producer:'SCENE_INTELLIGENCE',payloadSchema:{allowUnknown:true}}));}
  coreDescriptors(){return Object.values(SceneEventType).map((eventType)=>({eventType,eventVersion:'1.0.0',owner:'SCENE_INTELLIGENCE',payloadSchemaVersion:'1.0.0'}));}
  validateCompatibility(event){
    if(!event||typeof event!=='object')return {ok:false,code:'EVENT_ENVELOPE_INVALID'};
    if(!Object.values(SceneEventType).includes(event.eventType))return {ok:false,code:'EVENT_TYPE_UNKNOWN'};
    const major=(v)=>String(v??'1.0.0').split('.')[0];
    if(major(event.eventVersion??event.schemaVersion)!=='1')return {ok:false,code:'EVENT_VERSION_INCOMPATIBLE'};
    if(major(event.payloadSchemaVersion??'1.0.0')!=='1')return {ok:false,code:'EVENT_PAYLOAD_VERSION_INCOMPATIBLE'};
    if(event.payload==null||typeof event.payload!=='object'||Array.isArray(event.payload))return {ok:false,code:'EVENT_PAYLOAD_INVALID'};
    if(event.contextSealBypass===true||event.authorityGranted===true||event.settlementAuthority===true||event.payload?.contextSealBypass===true||event.payload?.authorityGranted===true||event.payload?.settlementAuthority===true)return {ok:false,code:'EVENT_AUTHORITY_VIOLATION'};
    return {ok:true,code:'COMPATIBLE'};
  }
  registerWithRuntimeRegistry(registry){if(!registry?.register)throw new TypeError('Runtime EventTypeRegistry-compatible register() is required');return this.runtimeDescriptors().map((d)=>registry.register(d));}
  registerWithCoreRegistry(registry){if(!registry?.registerType)throw new TypeError('Core EventTypeRegistry-compatible registerType() is required');return this.coreDescriptors().map((d)=>registry.registerType({eventType:d.eventType,eventVersion:d.eventVersion,owner:d.owner,validatePayload:(payload,event)=>this.validateCompatibility({...event,payload}).ok}));}
  runtimeSink(spine){if(!spine?.emit)throw new TypeError('Runtime EventSpine-compatible emit() is required');return (event)=>{const args=this.runtimeEmitArgs(event);return spine.emit(args.eventType,args.payload,args.meta);};}
  isFresh(event,currentSceneRevision){return event.sceneRevision===currentSceneRevision;}
  runtimeEmitArgs(event){return {eventType:event.eventType,payload:clone(event.payload),meta:{eventId:event.eventId,schemaVersion:event.schemaVersion,producer:event.producer,causationId:event.causationId,correlationId:event.correlationId,turnId:event.turnId,sceneRevision:event.sceneRevision,sourceRevisions:event.sourceRevisions,revisionFences:clone(event.revisionFences),dedupeKey:event.dedupeKey,createdAt:event.createdAt}};}
}
