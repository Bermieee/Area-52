import { Capability, FailureCode } from './constants.js';

export const ProviderTransportMode=Object.freeze({
  CHAT_COMPLETIONS:'CHAT_COMPLETIONS',
  EMBEDDINGS:'EMBEDDINGS',
});

export const ProviderModelDiscoveryState=Object.freeze({
  READY:'READY',
  EMPTY:'EMPTY',
  UNSUPPORTED:'UNSUPPORTED',
});

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
  constructor({providerId='deterministic-provider',modelId='deterministic-model',capabilities=Object.values(Capability),handler=null,handlers={},measurementClass='LOCAL_DETERMINISTIC'}={}){
    this.providerId=providerId;this.modelId=modelId;this.capabilities=[...new Set(capabilities)];this.measurementClass=measurementClass;
    this.structuredOutputSupport=true;this.streamingSupport=false;this.abortSupport=true;
    this.contextLimit=Number.MAX_SAFE_INTEGER;this.outputLimit=Number.MAX_SAFE_INTEGER;
    this.handler=handler;this.handlers={...handlers};
  }
  async probe({signal=null}={}){
    if(signal?.aborted)throw new ProviderInvocationError(FailureCode.PROVIDER_ABORTED,'deterministic provider probe aborted',{providerId:this.providerId});
    return Object.freeze({ok:true,providerId:this.providerId,modelId:this.modelId,latencyMs:0,measurementClass:this.measurementClass,capabilities:Object.freeze([...this.capabilities])});
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
      metadata:{...structuredClone(envelope.metadata??{}),measurementClass:this.measurementClass},
    });
  }
}

export class OpenAICompatibleProviderAdapter {
  #apiKey=null;
  constructor({
    providerId='openai-compatible',modelId,endpoint,apiKey=null,headers={},fetchImpl=globalThis.fetch,
    timeoutMs=30000,contextLimit=null,outputLimit=null,capabilities=Object.values(Capability),
    local=false,costMetadata=null,healthCheckPath='/models',modelListPath=null,measurementClass='MEASURED_LIVE',
    transportMode=ProviderTransportMode.CHAT_COMPLETIONS,
  }={}){
    if(typeof modelId!=='string'||!modelId)throw new TypeError('modelId is required');
    if(typeof endpoint!=='string'||!endpoint)throw new TypeError('endpoint is required');
    if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl is required');
    if(!Object.values(ProviderTransportMode).includes(transportMode))throw new TypeError('unsupported provider transport mode: '+transportMode);
    this.providerId=providerId;this.modelId=modelId;this.endpoint=endpoint.replace(/\/$/,'');this.setCredential(apiKey);
    this.headers={...headers};this.fetchImpl=fetchImpl;this.timeoutMs=Math.max(1,Number(timeoutMs)||30000);
    this.contextLimit=contextLimit==null?null:Number(contextLimit);this.outputLimit=outputLimit==null?null:Number(outputLimit);
    this.capabilities=[...new Set(capabilities)];this.structuredOutputSupport=transportMode===ProviderTransportMode.CHAT_COMPLETIONS;
    this.streamingSupport=false;this.abortSupport=true;this.local=Boolean(local);this.costMetadata=costMetadata==null?null:structuredClone(costMetadata);
    this.healthCheckPath=String(healthCheckPath||'/models');this.transportMode=transportMode;
    this.modelListPath=String(modelListPath??(transportMode===ProviderTransportMode.EMBEDDINGS?'/embeddings/models':this.healthCheckPath));
    this.measurementClass=measurementClass;
  }
  get credentialConfigured(){return Boolean(this.#apiKey);}
  setCredential(value){
    if(value==null||value===''){this.#apiKey=null;return false;}
    if(typeof value!=='string'||!value.trim())throw new TypeError('credential must be a non-empty string');
    this.#apiKey=value.trim();return true;
  }
  clearCredential(){this.#apiKey=null;return true;}
  setModelId(value){
    if(typeof value!=='string'||!value.trim())throw new TypeError('modelId must be a non-empty string');
    this.modelId=value.trim();return this.modelId;
  }
  async discoverModels({signal=null,timeoutMs=this.timeoutMs}={}){
    const startedAt=Date.now();const path=normalizePath(this.modelListPath);
    let response;
    try{
      response=await providerFetch(this.fetchImpl,this.endpoint+path,{method:'GET',headers:this.#requestHeaders(),signal},{signal,timeoutMs,providerId:this.providerId,operation:'model discovery'});
    }catch(error){throw normalizeTransportError(error,{providerId:this.providerId,operation:'model discovery'});}
    const status=Number(response?.status??0);
    if(status===404||status===405){
      return Object.freeze({ok:false,supported:false,state:ProviderModelDiscoveryState.UNSUPPORTED,models:Object.freeze([]),latencyMs:Date.now()-startedAt,transportMode:this.transportMode});
    }
    if(!response?.ok)throw httpError(status,{providerId:this.providerId,operation:'model discovery'});
    let body;
    try{body=await response.json();}catch(error){throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,'provider model discovery returned invalid JSON',{providerId:this.providerId,cause:error});}
    if(!Array.isArray(body?.data))throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,'provider model discovery did not return data[]',{providerId:this.providerId});
    const models=body.data.map((row)=>normalizeDiscoveredModel(row,this.transportMode)).filter(Boolean);
    return Object.freeze({
      ok:true,supported:true,state:models.length?ProviderModelDiscoveryState.READY:ProviderModelDiscoveryState.EMPTY,
      models:Object.freeze(models),latencyMs:Date.now()-startedAt,transportMode:this.transportMode,
    });
  }
  async probe({signal=null,timeoutMs=this.timeoutMs}={}){
    const startedAt=Date.now();let discovery;
    try{discovery=await this.discoverModels({signal,timeoutMs});}
    catch(error){throw error;}
    const modelAvailable=discovery.supported?discovery.models.some((row)=>row.id===this.modelId):null;
    if(discovery.supported&&!modelAvailable)throw new ProviderInvocationError(FailureCode.MODEL_UNAVAILABLE,'Configured model is not available from provider discovery',{providerId:this.providerId,status:404});
    const qualification=this.transportMode===ProviderTransportMode.EMBEDDINGS
      ? await this.#qualificationEmbedding({signal,timeoutMs})
      : await this.#qualificationChat({signal,timeoutMs});
    return Object.freeze({
      ok:true,providerId:this.providerId,modelId:qualification.modelId??this.modelId,latencyMs:Date.now()-startedAt,
      modelAvailable,discoveryState:discovery.state,measurementClass:this.measurementClass,
      capabilities:Object.freeze([...this.capabilities]),transportMode:this.transportMode,actualProvider:qualification.actualProvider??null,
    });
  }
  async invoke(task,input,{signal=null,timeoutMs=this.timeoutMs,maxOutputTokens=null,temperature=0}={}){
    if(this.transportMode!==ProviderTransportMode.CHAT_COMPLETIONS){
      throw new ProviderInvocationError(FailureCode.CAPABILITY_UNAVAILABLE,'Embeddings transport cannot execute chat-completion specialist work',{providerId:this.providerId});
    }
    const startedAt=Date.now();
    try{
      const messages=normalizeMessages(input);
      const body={model:this.modelId,messages,temperature:Number(temperature)};
      const limit=maxOutputTokens??this.outputLimit;if(Number.isFinite(Number(limit)))body.max_tokens=Number(limit);
      const response=await providerFetch(this.fetchImpl,`${this.endpoint}/chat/completions`,{
        method:'POST',headers:this.#requestHeaders({'content-type':'application/json'}),body:JSON.stringify(body),signal,
      },{signal,timeoutMs,providerId:this.providerId,operation:'chat completion'});
      if(!response?.ok)throw httpError(Number(response?.status??0),{providerId:this.providerId,operation:'chat completion'});
      const json=await parseProviderJson(response,this.providerId,'chat completion');const text=json?.choices?.[0]?.message?.content;
      if(typeof text!=='string')throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,'provider response did not contain message.content text',{providerId:this.providerId});
      const completedAt=Date.now();const actualModelId=typeof json?.model==='string'&&json.model?json.model:this.modelId;
      return Object.freeze({providerId:this.providerId,modelId:actualModelId,text,usage:structuredClone(json.usage??{}),
        finishReason:json?.choices?.[0]?.finish_reason??null,startedAt,completedAt,latencyMs:completedAt-startedAt,
        metadata:{requestId:response.headers?.get?.('x-request-id')??null,local:this.local,costMetadata:this.costMetadata,measurementClass:this.measurementClass,
          requestedModelId:this.modelId,actualProvider:safeProviderName(json?.provider),transportMode:this.transportMode}});
    }catch(error){throw normalizeTransportError(error,{providerId:this.providerId,operation:'chat completion'});}
  }
  async embed(input,{signal=null,timeoutMs=this.timeoutMs,dimensions=null,inputType=null,encodingFormat='float'}={}){
    if(this.transportMode!==ProviderTransportMode.EMBEDDINGS){
      throw new ProviderInvocationError(FailureCode.CAPABILITY_UNAVAILABLE,'Chat-completions transport cannot be reported as an embedding resource',{providerId:this.providerId});
    }
    const values=normalizeEmbeddingInput(input);const startedAt=Date.now();
    const body={model:this.modelId,input:values.length===1?values[0]:values,encoding_format:encodingFormat};
    if(Number.isInteger(Number(dimensions))&&Number(dimensions)>0)body.dimensions=Number(dimensions);
    if(typeof inputType==='string'&&inputType.trim())body.input_type=inputType.trim();
    try{
      const response=await providerFetch(this.fetchImpl,`${this.endpoint}/embeddings`,{
        method:'POST',headers:this.#requestHeaders({'content-type':'application/json'}),body:JSON.stringify(body),signal,
      },{signal,timeoutMs,providerId:this.providerId,operation:'embedding'});
      if(!response?.ok)throw httpError(Number(response?.status??0),{providerId:this.providerId,operation:'embedding'});
      const json=await parseProviderJson(response,this.providerId,'embedding');const rows=Array.isArray(json?.data)?json.data:[];
      if(rows.length!==values.length)throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,'embedding response count did not match input count',{providerId:this.providerId});
      const vectors=rows.map((row,index)=>{
        if(!Array.isArray(row?.embedding)||!row.embedding.length||row.embedding.some((value)=>!Number.isFinite(Number(value)))){
          throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,`embedding response row ${index} did not contain a numeric vector`,{providerId:this.providerId});
        }
        return Object.freeze(row.embedding.map(Number));
      });
      const width=vectors[0]?.length??0;if(vectors.some((vector)=>vector.length!==width))throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,'embedding response vectors used inconsistent dimensions',{providerId:this.providerId});
      const completedAt=Date.now();const actualModelId=typeof json?.model==='string'&&json.model?json.model:this.modelId;
      return Object.freeze({providerId:this.providerId,modelId:actualModelId,vectors:Object.freeze(vectors),dimensions:width,usage:structuredClone(json.usage??{}),
        startedAt,completedAt,latencyMs:completedAt-startedAt,
        metadata:{requestId:response.headers?.get?.('x-request-id')??null,local:this.local,costMetadata:this.costMetadata,measurementClass:this.measurementClass,
          requestedModelId:this.modelId,actualProvider:safeProviderName(json?.provider),transportMode:this.transportMode}});
    }catch(error){throw normalizeTransportError(error,{providerId:this.providerId,operation:'embedding'});}
  }
  async #qualificationChat({signal,timeoutMs}){
    const body={model:this.modelId,messages:[
      {role:'system',content:'Area-52 connection qualification. Return a short JSON object only.'},
      {role:'user',content:'{"probe":"area52"}'},
    ],temperature:0,max_tokens:8};
    const response=await providerFetch(this.fetchImpl,`${this.endpoint}/chat/completions`,{
      method:'POST',headers:this.#requestHeaders({'content-type':'application/json'}),body:JSON.stringify(body),signal,
    },{signal,timeoutMs,providerId:this.providerId,operation:'chat qualification'});
    if(!response?.ok)throw httpError(Number(response?.status??0),{providerId:this.providerId,operation:'chat qualification'});
    const json=await parseProviderJson(response,this.providerId,'chat qualification');
    if(typeof json?.choices?.[0]?.message?.content!=='string')throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,'chat qualification response did not contain message.content text',{providerId:this.providerId});
    return{modelId:typeof json?.model==='string'&&json.model?json.model:this.modelId,actualProvider:safeProviderName(json?.provider)};
  }
  async #qualificationEmbedding({signal,timeoutMs}){
    const response=await providerFetch(this.fetchImpl,`${this.endpoint}/embeddings`,{
      method:'POST',headers:this.#requestHeaders({'content-type':'application/json'}),body:JSON.stringify({model:this.modelId,input:'area52 connection qualification',encoding_format:'float'}),signal,
    },{signal,timeoutMs,providerId:this.providerId,operation:'embedding qualification'});
    if(!response?.ok)throw httpError(Number(response?.status??0),{providerId:this.providerId,operation:'embedding qualification'});
    const json=await parseProviderJson(response,this.providerId,'embedding qualification');
    if(!Array.isArray(json?.data?.[0]?.embedding)||!json.data[0].embedding.length)throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,'embedding qualification response did not contain a vector',{providerId:this.providerId});
    return{modelId:typeof json?.model==='string'&&json.model?json.model:this.modelId,actualProvider:safeProviderName(json?.provider)};
  }
  #requestHeaders(extra={}){
    const headers={...this.headers,...extra};if(this.#apiKey)headers.authorization='Bearer '+this.#apiKey;return headers;
  }
}

export function assertAdapter(adapter){
  if(!adapter||typeof adapter.providerId!=='string'||!adapter.providerId)throw new TypeError('providerId is required');
  if(typeof adapter.invoke!=='function')throw new TypeError('provider adapter invoke(task,input,options) is required');
  if(!Array.isArray(adapter.capabilities))throw new TypeError('provider adapter capabilities[] is required');
  return adapter;
}

async function providerFetch(fetchImpl,url,init,{signal=null,timeoutMs=30000,providerId=null,operation='request'}={}){
  const controller=new AbortController();let timedOut=false;
  const abort=()=>controller.abort(signal?.reason??'caller-abort');
  if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}
  const timer=setTimeout(()=>{timedOut=true;controller.abort('provider-timeout');},Math.max(1,Number(timeoutMs)||30000));
  try{return await fetchImpl(url,{...init,signal:controller.signal});}
  catch(error){
    if(timedOut)throw new ProviderInvocationError(FailureCode.PROVIDER_TIMEOUT,`${operation} timed out`,{providerId,cause:error});
    if(controller.signal.aborted)throw new ProviderInvocationError(FailureCode.PROVIDER_ABORTED,`${operation} aborted`,{providerId,cause:error});
    throw new ProviderInvocationError(FailureCode.PROVIDER_UNAVAILABLE,error?.message??String(error),{providerId,cause:error});
  }finally{clearTimeout(timer);if(signal)signal.removeEventListener?.('abort',abort);}
}
function httpError(status,{providerId=null,operation='provider request'}={}){
  const code=(status===401||status===403)?FailureCode.PROVIDER_UNAUTHORIZED
    :(status===408||status===524)?FailureCode.PROVIDER_TIMEOUT
    :(status===404)?FailureCode.MODEL_UNAVAILABLE
    :(status===429||status>=500)?FailureCode.PROVIDER_UNAVAILABLE:FailureCode.PROVIDER_FAILURE;
  return new ProviderInvocationError(code,`${operation} returned HTTP ${status}`,{providerId,status});
}
function normalizeTransportError(error,{providerId=null,operation='provider request'}={}){
  if(error instanceof ProviderInvocationError)return error;
  return new ProviderInvocationError(error?.code??FailureCode.PROVIDER_UNAVAILABLE,error?.message??String(error),{providerId,cause:error,details:{operation}});
}
async function parseProviderJson(response,providerId,operation){
  try{return await response.json();}
  catch(error){throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,`${operation} returned invalid JSON`,{providerId,cause:error});}
}
function normalizeDiscoveredModel(row,transportMode){
  const id=typeof row?.id==='string'?row.id.trim():'';if(!id)return null;
  const inputModalities=Array.isArray(row?.architecture?.input_modalities)?row.architecture.input_modalities.map(String):[];
  const outputModalities=Array.isArray(row?.architecture?.output_modalities)?row.architecture.output_modalities.map(String):[];
  const capabilities=transportMode===ProviderTransportMode.EMBEDDINGS||outputModalities.includes('embeddings')?[Capability.EMBED]:[];
  return Object.freeze({
    id,name:typeof row?.name==='string'&&row.name?row.name:id,canonicalSlug:typeof row?.canonical_slug==='string'?row.canonical_slug:null,
    contextLength:finiteNumber(row?.context_length),maxOutputTokens:finiteNumber(row?.top_provider?.max_completion_tokens),
    inputModalities:Object.freeze(inputModalities),outputModalities:Object.freeze(outputModalities),
    supportedParameters:Object.freeze(Array.isArray(row?.supported_parameters)?row.supported_parameters.map(String):[]),
    capabilities:Object.freeze(capabilities),pricing:safePricing(row?.pricing),
  });
}
function safePricing(value){
  if(!value||typeof value!=='object')return null;const out={};
  for(const key of ['prompt','completion','request','image'])if(value[key]!=null&&Number.isFinite(Number(value[key])))out[key]=Number(value[key]);
  return Object.freeze(out);
}
function normalizeEmbeddingInput(input){
  const values=Array.isArray(input)?input:[input];
  if(!values.length||values.length>2048)throw new TypeError('embedding input must contain 1..2048 items');
  return values.map((value,index)=>{if(typeof value!=='string'||!value.length)throw new TypeError(`embedding input[${index}] must be a non-empty string`);return value;});
}
function normalizePath(value){const path=String(value||'/models');return path.startsWith('/')?path:'/'+path;}
function finiteNumber(value){const number=Number(value);return Number.isFinite(number)?number:null;}
function safeProviderName(value){return typeof value==='string'&&value.length?value.slice(0,160):null;}

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
