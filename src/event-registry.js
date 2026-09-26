import {CompatibilityStatus,FrameworkFailureCode,createCognitiveEventEnvelope} from './framework-contracts.js';
import {ContractVersionRegistry} from './contract-versioning.js';
import {FrameworkError,clone,req} from './framework-utils.js';

export class EventTypeRegistry{
  #types=new Map();#dedupe=new Map();
  constructor({versionRegistry=null}={}){this.versionRegistry=versionRegistry??new ContractVersionRegistry();}
  registerType({eventType,eventVersion='1.0.0',owner='UNOWNED',validatePayload=()=>true}={}){
    req(eventType,'eventType');if(this.#types.has(eventType))throw new FrameworkError('DUPLICATE_EVENT_TYPE',`Event type already registered: ${eventType}`);
    const contractId=`event:${eventType}`;this.versionRegistry.registerContract({contractId,currentVersion:eventVersion,validate:(event)=>Boolean(validatePayload(event.payload,event))});
    this.#types.set(eventType,{eventType,eventVersion,owner,validatePayload,contractId});this.#dedupe.set(eventType,new Map());return this.inspect(eventType);
  }
  unregisterType(eventType){this.#types.delete(eventType);this.#dedupe.delete(eventType);}
  has(eventType){return this.#types.has(eventType);}
  inspect(eventType){const s=this.#types.get(eventType);return s?{eventType:s.eventType,eventVersion:s.eventVersion,owner:s.owner,deliveryOwnedByFramework:false}:null;}
  list(){return[...this.#types.keys()].sort().map(x=>this.inspect(x));}
  registerMigration(eventType,migration){const s=this.#types.get(eventType);if(!s)throw new FrameworkError(FrameworkFailureCode.EVENT_TYPE_UNKNOWN,`Unknown event type: ${eventType}`);return this.versionRegistry.registerMigration(s.contractId,migration);}
  validate(input,{migrate=true}={}){
    let event;try{event=input?.kind==='CognitiveEventEnvelope'?clone(input):createCognitiveEventEnvelope(input);}catch(error){return{ok:false,code:'EVENT_ENVELOPE_INVALID',error:String(error.message??error)}}
    const spec=this.#types.get(event.eventType);if(!spec)return{ok:false,code:FrameworkFailureCode.EVENT_TYPE_UNKNOWN,event};
    const compatibility=this.versionRegistry.compatibility(spec.contractId,event.eventVersion);
    if(compatibility.status===CompatibilityStatus.MIGRATION_REQUIRED&&migrate){try{event=this.versionRegistry.migrate(spec.contractId,{...event,schemaVersion:event.eventVersion},{fromVersion:event.eventVersion});event.eventVersion=event.schemaVersion;delete event.schemaVersion;}catch(error){return{ok:false,code:error.code??FrameworkFailureCode.EVENT_VERSION_INCOMPATIBLE,error:String(error.message??error),event};}}
    else if(![CompatibilityStatus.EXACT,CompatibilityStatus.COMPATIBLE,CompatibilityStatus.DEPRECATED].includes(compatibility.status))return{ok:false,code:FrameworkFailureCode.EVENT_VERSION_INCOMPATIBLE,compatibility,event};
    let valid=false;try{valid=spec.validatePayload(event.payload,event)===true;}catch{}if(!valid)return{ok:false,code:'EVENT_PAYLOAD_INVALID',event};
    return{ok:true,event,compatibility};
  }
  accept(input){const validated=this.validate(input);if(!validated.ok)return validated;const {event}=validated,bucket=this.#dedupe.get(event.eventType),prior=bucket.get(event.dedupeIdentity);if(prior)return{...validated,duplicate:true,event:clone(prior)};bucket.set(event.dedupeIdentity,clone(event));return{...validated,duplicate:false};}
}
