import { Capability, FailureCode } from './constants.js';

export class ProviderInvocationError extends Error {
  constructor(code,message,{providerId=null,status=null,cause=null,details={}}={}) {
    super(message,{cause}); this.name='ProviderInvocationError'; this.code=code; this.providerId=providerId; this.status=status; this.details=details;
  }
}

export class ProviderAdapterRegistry {
  #adapters=new Map();
  register(adapter){
    assertAdapter(adapter);
    if(this.#adapters.has(adapter.providerId))throw new Error(`Provider adapter already registered: ${adapter.providerId}`);
    this.#adapters.set(adapter.providerId,adapter);return adapter;
  }
  get(providerId){return this.#adapters.get(providerId)??null;}
  list(){return [...this.#adapters.values()];}
}

export class DeterministicProviderAdapter {
  constructor({providerId='deterministic-provider',modelId='deterministic-model',capabilities=Object.values(Capability),handler=null,handlers={}}={}){
    this.providerId=providerId;this.modelId=modelId;this.capabilities=[...new Set(capabilities)];
    this.structuredOutputSupport=true;this.streamingSupport=false;this.abortSupport=true;
    this.contextLimit=Number.MAX_SAFE_INTEGER;this.outputLimit=Number.MAX_SAFE_INTEGER;
    this.handler=handler;this.handlers={...handlers};
  }
  async invoke(task,input,{signal=null,attempt=1}={}){
    if(signal?.aborted)throw new ProviderInvocationError(FailureCode.PROVIDER_ABORTED,'deterministic provider invocation aborted',{providerId:this.providerId});
    const fn=this.handlers[task.taskType]??this.handler;
    if(typeof fn!=='function')throw new ProviderInvocationError(FailureCode.PROVIDER_UNAVAILABLE,`No deterministic handler for ${task.taskType}`,{providerId:this.providerId});
    const startedAt=Number(input?.timing?.startedAt??0);
    let value;
    try{value=await fn({task,input,attempt,signal});}
    catch(error){
      if(error instanceof ProviderInvocationError)throw error;
      throw new ProviderInvocationError(error?.code??FailureCode.PROVIDER_FAILURE,error?.message??String(error),{providerId:this.providerId,cause:error});
    }
    const envelope=value&&typeof value==='object'&&('text'in value||'payload'in value)?value:{payload:value};
    const text=typeof envelope.text==='string'?envelope.text:JSON.stringify(envelope.payload??{});
    const latencyMs=Number(envelope.latencyMs??0);
    return Object.freeze({
      providerId:this.providerId,modelId:this.modelId,text,
      usage:structuredClone(envelope.usage??{}),
      finishReason:envelope.finishReason??'stop',
      startedAt:Number(envelope.startedAt??startedAt),
      completedAt:Number(envelope.completedAt??startedAt+latencyMs),
      latencyMs,
      metadata:structuredClone(envelope.metadata??{}),
    });
  }
}

export class OpenAICompatibleProviderAdapter {
  constructor({
    providerId='openai-compatible',modelId,endpoint,apiKey=null,headers={},fetchImpl=globalThis.fetch,
    timeoutMs=30000,contextLimit=null,outputLimit=null,capabilities=Object.values(Capability),
    local=false,costMetadata=null,
  }={}){
    if(typeof modelId!=='string'||!modelId)throw new TypeError('modelId is required');
    if(typeof endpoint!=='string'||!endpoint)throw new TypeError('endpoint is required');
    if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl is required');
    this.providerId=providerId;this.modelId=modelId;this.endpoint=endpoint.replace(/\/$/,'');this.apiKey=apiKey;
    this.headers={...headers};this.fetchImpl=fetchImpl;this.timeoutMs=Math.max(1,Number(timeoutMs)||30000);
    this.contextLimit=contextLimit==null?null:Number(contextLimit);this.outputLimit=outputLimit==null?null:Number(outputLimit);
    this.capabilities=[...new Set(capabilities)];this.structuredOutputSupport=true;this.streamingSupport=false;this.abortSupport=true;
    this.local=Boolean(local);this.costMetadata=costMetadata==null?null:structuredClone(costMetadata);
  }
  async invoke(task,input,{signal=null,timeoutMs=this.timeoutMs,maxOutputTokens=null,temperature=0}={}){
    const controller=new AbortController();let timer=null;let timedOut=false;
    const abort=()=>controller.abort(signal?.reason);
    if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}
    timer=setTimeout(()=>{timedOut=true;controller.abort(new Error('provider timeout'));},Math.max(1,Number(timeoutMs)||this.timeoutMs));
    const startedAt=Date.now();
    try{
      const messages=normalizeMessages(input);
      const body={model:this.modelId,messages,temperature:Number(temperature)};
      const limit=maxOutputTokens??this.outputLimit;if(Number.isFinite(Number(limit)))body.max_tokens=Number(limit);
      const headers={'content-type':'application/json',...this.headers};
      if(this.apiKey)headers.authorization=`Bearer ${this.apiKey}`;
      const response=await this.fetchImpl(`${this.endpoint}/chat/completions`,{
        method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,
      });
      if(!response?.ok){
        const status=Number(response?.status??0);let detail='';
        try{detail=String(await response.text()).slice(0,512);}catch{}
        throw new ProviderInvocationError(status===429||status>=500?FailureCode.PROVIDER_UNAVAILABLE:FailureCode.PROVIDER_FAILURE,
          `OpenAI-compatible provider returned HTTP ${status}`,{providerId:this.providerId,status,details:{detail}});
      }
      const json=await response.json();const text=json?.choices?.[0]?.message?.content;
      if(typeof text!=='string')throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,'provider response did not contain message.content text',{providerId:this.providerId});
      const completedAt=Date.now();
      return Object.freeze({providerId:this.providerId,modelId:this.modelId,text,usage:structuredClone(json.usage??{}),
        finishReason:json?.choices?.[0]?.finish_reason??null,startedAt,completedAt,latencyMs:completedAt-startedAt,
        metadata:{requestId:response.headers?.get?.('x-request-id')??null,local:this.local,costMetadata:this.costMetadata}});
    }catch(error){
      if(error instanceof ProviderInvocationError)throw error;
      if(timedOut)throw new ProviderInvocationError(FailureCode.PROVIDER_TIMEOUT,'OpenAI-compatible provider timed out',{providerId:this.providerId,cause:error});
      if(controller.signal.aborted)throw new ProviderInvocationError(FailureCode.PROVIDER_ABORTED,'OpenAI-compatible provider invocation aborted',{providerId:this.providerId,cause:error});
      throw new ProviderInvocationError(FailureCode.PROVIDER_UNAVAILABLE,error?.message??String(error),{providerId:this.providerId,cause:error});
    }finally{
      clearTimeout(timer);if(signal)signal.removeEventListener?.('abort',abort);
    }
  }
}

export function assertAdapter(adapter){
  if(!adapter||typeof adapter.providerId!=='string'||!adapter.providerId)throw new TypeError('providerId is required');
  if(typeof adapter.invoke!=='function')throw new TypeError('provider adapter invoke(task,input,options) is required');
  if(!Array.isArray(adapter.capabilities))throw new TypeError('provider adapter capabilities[] is required');
  return adapter;
}

function normalizeMessages(input){
  if(Array.isArray(input?.messages)){
    return input.messages.map((m)=>{
      if(!['system','user','assistant'].includes(m?.role)||typeof m?.content!=='string')throw new TypeError('provider messages require role/content strings');
      return{role:m.role,content:m.content};
    });
  }
  return[
    {role:'system',content:'Return only the requested JSON object. Do not call tools or functions.'},
    {role:'user',content:JSON.stringify(input??{})},
  ];
}
