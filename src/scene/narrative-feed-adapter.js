import { HostActivity, HostEventStatus } from './lifecycle-contracts.js';

const clone=(v)=>structuredClone(v);
const stable=(...parts)=>parts.map((x)=>String(x??'')).join(':');
export class NarrativeFeedAdapter{
  constructor({maxDedupe=2048}={}){this.maxDedupe=maxDedupe;this.chats=new Map();this.dedupe=new Map();this.activeChatId=null;this.sequence=0;}

  #chat(chatId){if(!this.chats.has(chatId))this.chats.set(chatId,{chatId,messages:new Map(),currentSwipe:new Map(),revision:0});return this.chats.get(chatId);}
  normalize(input={}){
    const activity=input.activity;if(!Object.values(HostActivity).includes(activity))return {status:HostEventStatus.UNSUPPORTED,reason:'unsupported-activity'};
    const chatId=input.chatId;if(!chatId)return {status:HostEventStatus.INVALID,reason:'chatId-required'};
    const dedupeKey=input.hostEventId??stable(chatId,activity,input.messageId,input.messageRevision,input.swipeId,input.eventSequence);
    if(this.dedupe.has(dedupeKey))return {status:HostEventStatus.DUPLICATE,evidence:clone(this.dedupe.get(dedupeKey))};
    const chat=this.#chat(chatId);this.sequence++;let result;
    try{result=this.#apply(chat,{...input,activity});}catch(error){return {status:HostEventStatus.INVALID,reason:error.message};}
    this.dedupe.set(dedupeKey,result);while(this.dedupe.size>this.maxDedupe)this.dedupe.delete(this.dedupe.keys().next().value);return {status:HostEventStatus.ACCEPTED,evidence:clone(result)};
  }

  #apply(chat,input){
    const {activity}=input;
    if([HostActivity.CHAT_LOAD,HostActivity.CHAT_SWITCH,HostActivity.NEW_CHAT,HostActivity.IMPORT_OR_RELOAD].includes(activity)){this.activeChatId=chat.chatId;chat.revision++;return this.#evidence(chat,input,{kind:'CHAT_STATE',current:true,content:null});}
    if(activity===HostActivity.LORE_CHANGE){chat.revision++;return this.#evidence(chat,input,{kind:'LORE_CHANGE',current:true,content:input.content??null});}
    const messageId=input.messageId;if(!messageId)throw new Error('messageId-required');
    const existing=chat.messages.get(messageId)??{messageId,revisions:[],currentRevision:null,swipes:new Map(),deleted:false};
    let revision=Number(input.messageRevision??((existing.revisions.at(-1)?.messageRevision??0)+1));if(!Number.isInteger(revision)||revision<1)throw new Error('invalid-message-revision');
    const sourceRevisionId=stable('chat',chat.chatId,'message',messageId,'r',revision,input.swipeId??'primary');
    if(activity===HostActivity.DELETE){existing.deleted=true;for(const r of existing.revisions)r.current=false;existing.currentRevision=null;chat.messages.set(messageId,existing);chat.revision++;return this.#evidence(chat,input,{kind:'DELETE',current:false,content:null,sourceRevisionId,invalidates:existing.revisions.map((r)=>r.sourceRevisionId)});}
    let invalidates=[];
    if(activity===HostActivity.REGENERATE){invalidates=existing.revisions.filter((r)=>r.current).map((r)=>r.sourceRevisionId);for(const r of existing.revisions)r.current=false;for(const s of existing.swipes.values())s.current=false;}
    if(activity===HostActivity.SWIPE_SELECTED){invalidates=[...existing.swipes.values()].filter((s)=>s.current&&s.swipeId!==input.swipeId).map((s)=>s.sourceRevisionId);for(const s of existing.swipes.values())s.current=false;const target=existing.swipes.get(input.swipeId);if(target){target.current=true;existing.currentRevision=target.messageRevision;chat.currentSwipe.set(messageId,input.swipeId);chat.revision++;return this.#evidence(chat,input,{...target,kind:'SWIPE_SELECTED',invalidates});} }
    const prior=existing.revisions.find((r)=>r.current);if(prior)prior.current=false;
    const item={messageId,messageRevision:revision,sourceRevisionId,content:String(input.content??''),role:input.role??(activity===HostActivity.USER_SEND?'user':'assistant'),current:true,historical:false,swipeId:input.swipeId??null,activity,invalidates};
    if(activity===HostActivity.EDIT&&existing.revisions.length)item.replacesRevisionId=existing.revisions.at(-1).sourceRevisionId;
    if(activity===HostActivity.REGENERATE)item.branchOf=existing.revisions.at(-1)?.sourceRevisionId??null;
    existing.revisions.push(item);existing.currentRevision=revision;existing.deleted=false;if(input.swipeId)existing.swipes.set(input.swipeId,item);chat.messages.set(messageId,existing);chat.revision++;
    return this.#evidence(chat,input,item);
  }

  #evidence(chat,input,item){return {kind:'NarrativeEvidence',activity:input.activity,chatId:chat.chatId,messageId:input.messageId??null,messageRevision:item.messageRevision??null,turnId:input.turnId??stable(chat.chatId,input.messageId??'chat',item.messageRevision??chat.revision),sourceRevisionId:item.sourceRevisionId??stable('chat',chat.chatId,'state',chat.revision),correlationId:input.correlationId??stable('corr',chat.chatId,input.turnId??input.messageId??chat.revision),causationId:input.causationId??input.hostEventId??null,sequence:this.sequence,chatRevision:chat.revision,current:Boolean(item.current),historical:!item.current,content:item.content??null,role:item.role??null,invalidates:[...(item.invalidates??[])],replacesRevisionId:item.replacesRevisionId??null,branchOf:item.branchOf??null,swipeId:item.swipeId??input.swipeId??null};}
  currentEvidence(chatId){const chat=this.chats.get(chatId);if(!chat)return[];const out=[];for(const m of chat.messages.values())for(const r of m.revisions)if(r.current&&!m.deleted)out.push(clone(r));return out;}
  exportState(){return clone({version:1,activeChatId:this.activeChatId,sequence:this.sequence,chats:[...this.chats.entries()].map(([id,c])=>[id,{...c,messages:[...c.messages.entries()].map(([mid,m])=>[mid,{...m,swipes:[...m.swipes.entries()]}]),currentSwipe:[...c.currentSwipe.entries()]}]),dedupe:[...this.dedupe.entries()]});}
  static importState(state){const a=new NarrativeFeedAdapter();a.activeChatId=state.activeChatId??null;a.sequence=state.sequence??0;for(const [id,c] of state.chats??[])a.chats.set(id,{...c,messages:new Map((c.messages??[]).map(([mid,m])=>[mid,{...m,swipes:new Map(m.swipes??[])}])),currentSwipe:new Map(c.currentSwipe??[])});a.dedupe=new Map(state.dedupe??[]);return a;}
}
