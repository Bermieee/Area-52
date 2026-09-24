import { HostActivity, HostEventStatus } from './lifecycle-contracts.js';

const clone=(v)=>structuredClone(v);
const ACTIVITIES=Object.values(HostActivity);

export class SillyTavernHostBridge{
  constructor({eventsByActivity={}}={}){
    this.eventsByActivity=new Map();this.activityByEvent=new Map();
    for(const [activity,eventName] of Object.entries(eventsByActivity))this.bind(activity,eventName);
  }
  bind(activity,eventName){
    if(!ACTIVITIES.includes(activity))throw new TypeError(`Unsupported HostActivity: ${activity}`);
    if(typeof eventName!=='string'||!eventName)throw new TypeError('host event name is required');
    this.eventsByActivity.set(activity,eventName);this.activityByEvent.set(eventName,activity);return this;
  }
  capability(activity){
    if(!ACTIVITIES.includes(activity))return {status:HostEventStatus.UNSUPPORTED,activity};
    const eventName=this.eventsByActivity.get(activity)??null;
    return eventName?{status:'HOST_CAPABILITY_AVAILABLE',activity,eventName}:{status:'HOST_CAPABILITY_UNAVAILABLE',activity,eventName:null};
  }
  capabilities(){return Object.freeze(Object.fromEntries(ACTIVITIES.map((activity)=>[activity,this.capability(activity)])));}
  toCanonical(hostEventName,payload={}){
    const activity=this.activityByEvent.get(hostEventName);if(!activity)return {status:'HOST_CAPABILITY_UNAVAILABLE',reason:'host-event-not-bound',hostEventName};
    return {status:HostEventStatus.ACCEPTED,input:{...clone(payload),activity,hostEventName}};
  }
  reattach(adapter,{chatId,messages=[],chatEventId=null}={}){
    if(!adapter?.normalize)throw new TypeError('NarrativeFeedAdapter-compatible adapter is required');
    const results=[];
    const chatActivity=this.eventsByActivity.has(HostActivity.IMPORT_OR_RELOAD)?HostActivity.IMPORT_OR_RELOAD:HostActivity.CHAT_LOAD;
    if(adapter.activeChatId===chatId)results.push({status:HostEventStatus.DUPLICATE,reason:'chat-already-attached',evidence:null});
    else results.push(adapter.normalize({activity:chatActivity,chatId,hostEventId:chatEventId??`reattach:${chatId}:state`}));
    for(const message of messages){
      const activity=message.activity??(message.role==='user'?HostActivity.USER_SEND:HostActivity.ASSISTANT_GENERATION_COMPLETE);
      const messageRevision=Number(message.messageRevision??message.revision??1);
      const hostEventId=message.hostEventId??`reattach:${chatId}:${message.messageId}:r${messageRevision}:${message.swipeId??'primary'}`;
      const sourceRevisionId=adapter.sourceRevisionIdFor?.({chatId,messageId:message.messageId,messageRevision,swipeId:message.swipeId??null});const prior=sourceRevisionId?adapter.findSourceRevision?.(chatId,sourceRevisionId):null;
      if(prior){results.push({status:HostEventStatus.DUPLICATE,evidence:prior,reason:'source-revision-already-attached'});continue;}
      results.push(adapter.normalize({activity,chatId,hostEventId,messageId:message.messageId,messageRevision,turnId:message.turnId,swipeId:message.swipeId??null,content:message.content??'',role:message.role}));
    }
    return results;
  }
}
