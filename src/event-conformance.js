import {createCognitiveEventEnvelope} from './framework-contracts.js';
import {RepresentativePhase1EventTypes} from './phase1-integration-fixtures.js';
const clone=(v)=>structuredClone(v);
export function registerRepresentativePhase1Events(registry,{owner='PHASE1_INTEGRATION_FIXTURE'}={}){
  const registered=[];for(const eventType of RepresentativePhase1EventTypes){if(registry.has(eventType))continue;registry.registerType({eventType,eventVersion:'1.0.0',owner,validatePayload:(payload)=>payload!==null&&typeof payload==='object'&&!Array.isArray(payload)});registered.push(eventType);}return registered;
}
export function createRepresentativeEvent({eventType,eventId=`evt:${eventType}`,correlationId='corr:phase1',causationId='cause:phase1',turnId='turn:phase1',taskId=null,sourceRevisionSet=['source@1'],worldRevision=1,sceneRevision=1,sequence=1,dedupeIdentity=eventId,payload={ok:true},eventVersion='1.0.0'}={}){
  return createCognitiveEventEnvelope({eventId,eventType,eventVersion,producer:'PHASE1_FIXTURE',causationId,correlationId,turnId,taskId,sourceRevisionSet,worldRevision,sceneRevision,sequence,time:sequence,dedupeIdentity,payload,payloadSchemaVersion:'1'});
}
export function runEventRegistryConformance(registry){
  registerRepresentativePhase1Events(registry);const accepted=[],duplicates=[];let seq=0;
  for(const type of RepresentativePhase1EventTypes){const event=createRepresentativeEvent({eventType:type,eventId:`evt:${type}`,sequence:++seq});const first=registry.accept(event),second=registry.accept(event);accepted.push(first);duplicates.push(second);}
  const unknown=registry.accept(createRepresentativeEvent({eventType:'UNREGISTERED_PHASE1_EVENT',eventId:'evt:unknown'}));
  const incompatible=registry.accept(createRepresentativeEvent({eventType:'TURN_EVENT',eventId:'evt:bad-version',eventVersion:'2.0.0'}));
  return{kind:'EventRegistryConformanceReceipt',accepted:clone(accepted),duplicates:clone(duplicates),unknown:clone(unknown),incompatible:clone(incompatible),
    checks:{registeredAccepted:accepted.every(x=>x.ok===true&&!x.duplicate),duplicatesIdempotent:duplicates.every(x=>x.ok===true&&x.duplicate===true),unknownRejected:unknown.ok===false&&unknown.code==='EVENT_TYPE_UNKNOWN',incompatibleMajorRejected:incompatible.ok===false&&incompatible.code==='EVENT_VERSION_INCOMPATIBLE',identityPreserved:accepted.every(x=>x.event.correlationId==='corr:phase1'&&x.event.causationId==='cause:phase1'),revisionFencePreserved:accepted.every(x=>x.event.worldRevision===1&&x.event.sceneRevision===1&&x.event.sourceRevisionSet.includes('source@1'))}};
}
