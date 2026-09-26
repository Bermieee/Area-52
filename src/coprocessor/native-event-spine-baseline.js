export class NativeEventSpineBaseline {
  constructor({state=null}={}){
    this.events=[];this.dedupe=new Map();this.subscribers=new Map();this.failures=[];
    if(state)this.restore(state);
  }
  subscribe(eventType,handler){
    if(typeof handler!=='function')throw new TypeError('handler is required');
    if(!this.subscribers.has(eventType))this.subscribers.set(eventType,new Set());
    this.subscribers.get(eventType).add(handler);
    return()=>this.subscribers.get(eventType)?.delete(handler);
  }
  publish(event,{deliveryAttempt=1}={}){
    if(!event?.eventId)throw new TypeError('eventId is required');
    const key=event.dedupeKey??event.eventId;
    if(this.dedupe.has(key))return Object.freeze({event:this.dedupe.get(key),duplicate:true,deliveryAttempt});
    const stored=Object.freeze(structuredClone({...event,deliveryAttempt}));
    this.dedupe.set(key,stored);this.events.push(stored);
    for(const handler of [...(this.subscribers.get(event.eventType)??[]),...(this.subscribers.get('*')??[])]){
      try{handler(stored);}catch(error){this.failures.push({eventId:stored.eventId,message:error?.message??String(error)});}
    }
    return Object.freeze({event:stored,duplicate:false,deliveryAttempt});
  }
  replay(event){return this.publish(event,{deliveryAttempt:Number(event.deliveryAttempt??1)+1});}
  snapshot(){return structuredClone({events:this.events,dedupe:[...this.dedupe],failures:this.failures});}
  restore(state){
    this.events=structuredClone(state?.events??[]);
    this.dedupe=new Map(structuredClone(state?.dedupe??[]));
    this.failures=structuredClone(state?.failures??[]);
    return this;
  }
}
