import { Capability, FailureCode } from './constants.js';
import { ProviderInvocationError, ProviderModelDiscoveryState, ProviderTransportMode, bindProviderFetch } from './provider-adapters.js';

export const OPENROUTER_DECISIONS_ENDPOINT='https://openrouter.ai/api/alpha/decisions';
export const OPENROUTER_KEY_ENDPOINT='https://openrouter.ai/api/v1/key';
export const DEFAULT_OPENROUTER_JEV_MODEL='typesafe/jev-1.13';
export const OPENROUTER_JEV_PROTOCOL='alpha/decisions';

const SYNTH_UNRESOLVED='__AREA52_UNRESOLVED__';
const SYNTH_ABSTAIN='__AREA52_ABSTAIN__';

export function normalizeOpenRouterApiKey(apiKey){
  let value=String(apiKey??'').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').trim();
  value=value.replace(/^Bearer\s+/i,'').trim();
  return value.replace(/\s+/g,'');
}
export function normalizeOpenRouterJevModel(model){
  const value=String(model??DEFAULT_OPENROUTER_JEV_MODEL).trim();
  if(!value)return DEFAULT_OPENROUTER_JEV_MODEL;
  if(value==='jev-latest'||value==='typesafe/jev-latest')return '~typesafe/jev-latest';
  if(/^jev-\d/i.test(value))return 'typesafe/'+value;
  return value;
}
export function normalizeOpenRouterDecisionsEndpoint(endpoint=''){
  const raw=String(endpoint??'').trim();
  if(!raw)return OPENROUTER_DECISIONS_ENDPOINT;
  let url;try{url=new URL(raw);}catch{return raw.replace(/\/+$/,'');}
  const host=url.hostname.toLowerCase();
  if(host==='openrouter.ai'||host.endsWith('.openrouter.ai')){
    const path=url.pathname.replace(/\/+$/,'')||'/';
    if(path==='/'||/^\/api\/v1$/i.test(path)||/^\/api\/alpha\/decisions$/i.test(path))return url.origin+'/api/alpha/decisions';
  }
  return raw.replace(/\/+$/,'');
}
export function isOpenRouterJevDecisionConfig(config={}){
  const capabilities=[...(config.capabilities??config.declaredCapabilities??[])].map(String);
  if(!capabilities.includes(Capability.SEMANTIC_JUDGMENT))return false;
  try{
    const endpoint=new URL(normalizeOpenRouterDecisionsEndpoint(config.endpoint));
    const host=endpoint.hostname.toLowerCase();
    return host==='openrouter.ai'||host.endsWith('.openrouter.ai');
  }catch{return false;}
}

export class OpenRouterJevDecisionAdapter{
  #apiKey=null;
  constructor({providerId='openrouter-jev-decisions',modelId=DEFAULT_OPENROUTER_JEV_MODEL,endpoint=OPENROUTER_DECISIONS_ENDPOINT,apiKey=null,fetchImpl=globalThis.fetch,timeoutMs=10000,capabilities=[Capability.SEMANTIC_JUDGMENT],measurementClass='MEASURED_LIVE'}={}){
    if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl is required');
    this.providerId=String(providerId||'openrouter-jev-decisions');this.modelId=normalizeOpenRouterJevModel(modelId);this.endpoint=normalizeOpenRouterDecisionsEndpoint(endpoint);
    this.fetchImpl=bindProviderFetch(fetchImpl);this.timeoutMs=Math.max(250,Number(timeoutMs)||10000);this.capabilities=[...new Set(capabilities.map(String))];this.measurementClass=measurementClass;
    this.structuredOutputSupport=true;this.streamingSupport=false;this.abortSupport=true;this.local=false;this.transportMode=ProviderTransportMode.DECISIONS;
    this.contextLimit=Number.MAX_SAFE_INTEGER;this.outputLimit=Number.MAX_SAFE_INTEGER;this.setCredential(apiKey);
  }
  get credentialConfigured(){return Boolean(this.#apiKey);}
  setCredential(value){const key=normalizeOpenRouterApiKey(value);this.#apiKey=key||null;return Boolean(this.#apiKey);}
  clearCredential(){this.#apiKey=null;return true;}
  setModelId(value){this.modelId=normalizeOpenRouterJevModel(value);return this.modelId;}
  async discoverModels(){return Object.freeze({ok:true,supported:true,state:ProviderModelDiscoveryState.READY,models:Object.freeze([{id:this.modelId,displayName:this.modelId,capabilities:Object.freeze([...this.capabilities])}]),latencyMs:0,transportMode:this.transportMode});}
  async probe({signal=null,timeoutMs=this.timeoutMs}={}){
    const startedAt=Date.now();await this.#probeCredential({signal,timeoutMs});
    const result=await this.#postDecisions({state:{purpose:'Area-52 Jev Decision Core connectivity test',expected:'typed decision reachable'},questions:{reachable:{type:'noul',instructions:'Does the state explicitly identify this as an Area-52 Jev Decision Core connectivity test?'}},signal,timeoutMs});
    const answer=result.payload?.answers?.reachable;
    if(!answer||answer.type!=='noul'||!Number.isFinite(Number(answer.noul)))throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,'OpenRouter Decisions qualification did not return answers.reachable as a typed Noul.',{providerId:this.providerId});
    const probability=Number(answer.noul);
    if(probability<0.5)throw new ProviderInvocationError(FailureCode.SEMANTIC_VALIDATION_FAILED,'OpenRouter Decisions returned a negative connectivity judgment for the explicit qualification state.',{providerId:this.providerId,details:{noul:probability}});
    return Object.freeze({ok:true,providerId:this.providerId,modelId:String(result.payload.model||this.modelId),latencyMs:Date.now()-startedAt,modelAvailable:true,discoveryState:ProviderModelDiscoveryState.READY,measurementClass:this.measurementClass,capabilities:Object.freeze([...this.capabilities]),transportMode:this.transportMode,actualProvider:String(result.payload.provider||'TypeSafe'),decisionProtocol:OPENROUTER_JEV_PROTOCOL,physicalExecution:true,qualificationPrimitive:'noul',qualificationProbability:probability});
  }
  async invoke(task,input,{signal=null,timeoutMs=this.timeoutMs}={}){
    if(String(task?.taskType??'')!=='JEV_DECISION')throw new ProviderInvocationError(FailureCode.CAPABILITY_UNAVAILABLE,'OpenRouter Jev Decisions adapter only executes JEV_DECISION tasks.',{providerId:this.providerId});
    if(!input?.data||typeof input.data!=='object')throw new ProviderInvocationError(FailureCode.SCHEMA_INVALID,'Jev Decisions invocation requires createJevProviderInput().data.',{providerId:this.providerId});
    const built=buildTypedDecisionRequest(input.data),startedAt=Date.now();
    const result=await this.#postDecisions({state:built.state,questions:built.questions,signal,timeoutMs});
    if(!result.payload?.answers||typeof result.payload.answers!=='object')throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,'OpenRouter Decisions response no longer contains an answers object.',{providerId:this.providerId});
    const mapped=mapTypedDecisionAnswers(input.data,built.plan,result.payload.answers),completedAt=Date.now();
    return Object.freeze({providerId:this.providerId,modelId:String(result.payload.model||this.modelId),text:JSON.stringify(mapped),usage:structuredClone(result.payload.usage??{}),finishReason:'typed-decision',startedAt,completedAt,latencyMs:completedAt-startedAt,metadata:Object.freeze({measurementClass:this.measurementClass,requestedModelId:this.modelId,actualProvider:String(result.payload.provider||'TypeSafe'),providerRequestId:result.payload.id??null,decisionProtocol:OPENROUTER_JEV_PROTOCOL,physicalExecution:true,typedQuestionKinds:Object.freeze([...new Set(Object.values(built.questions).map(q=>String(q.type)))]),rawStateRetained:false,rawCredentialIncluded:false})});
  }
  async #probeCredential({signal=null,timeoutMs=this.timeoutMs}={}){
    const key=this.#requireCredential();
    const response=await requestJson(this.fetchImpl,OPENROUTER_KEY_ENDPOINT,{method:'GET',headers:openRouterHeaders(key,{json:false}),signal,timeoutMs,providerId:this.providerId,operation:'OpenRouter Decision Core credential probe'});
    if(!response.ok)throw mapHttpError(response.status,response.payload,{providerId:this.providerId,operation:'OpenRouter Decision Core credential probe'});
    return response.payload;
  }
  async #postDecisions({state,questions,signal=null,timeoutMs=this.timeoutMs}={}){
    const key=this.#requireCredential();
    const response=await requestJson(this.fetchImpl,this.endpoint,{method:'POST',headers:openRouterHeaders(key),body:{model:this.modelId,state,questions},signal,timeoutMs,providerId:this.providerId,operation:'OpenRouter Decisions request'});
    if(!response.ok)throw mapHttpError(response.status,response.payload,{providerId:this.providerId,operation:'OpenRouter Decisions request'});
    if(!response.payload||typeof response.payload!=='object')throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,'OpenRouter Decisions returned an empty response.',{providerId:this.providerId});
    return response;
  }
  #requireCredential(){if(!this.#apiKey)throw new ProviderInvocationError(FailureCode.CREDENTIAL_REQUIRED,'A dedicated Decision Core OpenRouter API key is required for Jev.',{providerId:this.providerId});return this.#apiKey;}
}
export function createOpenRouterJevDecisionAdapter(options={}){return new OpenRouterJevDecisionAdapter(options);}

export function buildTypedDecisionRequest(data={}){
  const options=Array.isArray(data.options)?data.options:[],evidence=Array.isArray(data.evidence)?data.evidence:[],constraints=Array.isArray(data.constraints)?data.constraints:[];
  const state={decision:{id:data.decisionId??null,type:data.decisionType??null,shape:data.decisionShape??null,allowedOutcomes:[...(data.allowedOutcomes??[])]},options:options.map(option=>({id:option.optionId,label:option.label,payload:structuredClone(option.payload??{}),evidenceRefs:[...(option.evidenceRefs??[])],provenanceRefs:[...(option.provenanceRefs??[])],requiresEvidence:option.requiresEvidence!==false})),evidence:evidence.map(row=>({id:row.evidenceId,summary:row.summary??'',sourceRef:row.sourceRef??null,revision:row.revision??null,available:row.available!==false,stale:Boolean(row.stale)})),constraints:constraints.map(row=>({id:row.constraintId,type:row.type,hard:row.hard!==false,violatedOptionIds:[...(row.violatedOptionIds??[])],description:row.description??''})),revisionFence:structuredClone(data.revisionFence??{}),authorityBoundary:structuredClone(data.authorityBoundary??{})};
  const evidenceById=new Map(evidence.map(row=>[row.evidenceId,row])),decisionShape=String(data.decisionShape??'CHOOSE_ONE');
  if(['CHOOSE_ONE','CLASSIFY_RELATIONSHIP'].includes(decisionShape)){
    const criteria={};for(const option of options)criteria[option.optionId]=describeOption(option,evidenceById);
    if((data.allowedOutcomes??[]).includes('UNRESOLVED'))criteria[SYNTH_UNRESOLVED]='Use when the supplied evidence does not support one bounded option over the others.';
    if(data.abstentionAllowed!==false&&(data.allowedOutcomes??[]).includes('ABSTAIN'))criteria[SYNTH_ABSTAIN]='Use when the supplied evidence is insufficient or unsafe for a bounded selection.';
    return Object.freeze({state,questions:Object.freeze({selection:{type:'choice',instructions:'Which bounded option best satisfies the requested decision using only the supplied state, evidence, and constraints? Do not invent options or grant authority.',criteria}}),plan:Object.freeze({kind:'CHOICE'})});
  }
  if(['CHOOSE_SUBSET','PRESERVE_MULTIPLE'].includes(decisionShape)){
    const questions={},mapping={};options.forEach((option,index)=>{const id='include_'+index;mapping[id]=option.optionId;questions[id]={type:'choice',instructions:'Should option '+option.optionId+' ('+option.label+') be included in the bounded result using only the supplied state, evidence, and constraints?',criteria:{include:'The supplied evidence and constraints support including this option.',exclude:'The supplied evidence or constraints do not support including this option.'}};});
    return Object.freeze({state,questions:Object.freeze(questions),plan:Object.freeze({kind:'MULTI_CHOICE',mapping:Object.freeze(mapping)})});
  }
  if(decisionShape==='RANK_BOUNDED_OPTIONS'){
    const questions={},mapping={};options.forEach((option,index)=>{const id='rank_'+index;mapping[id]=option.optionId;questions[id]={type:'score',instructions:'How strongly should option '+option.optionId+' ('+option.label+') rank under the supplied state, evidence, and constraints?',criteria:['Contradicted by evidence or blocked by constraints.','Weak or mixed support.','Supported by the supplied evidence and constraints.','Strongly supported and preferable among the bounded options.']};});
    return Object.freeze({state,questions:Object.freeze(questions),plan:Object.freeze({kind:'RANK_SCORE',mapping:Object.freeze(mapping)})});
  }
  if(decisionShape==='REJECT_ALL')return Object.freeze({state,questions:Object.freeze({reject_all:{type:'choice',instructions:'Should every supplied bounded option be rejected under the supplied evidence and constraints?',criteria:{reject_all:'All supplied options should be rejected.',keep_at_least_one:'At least one supplied option remains viable.'}}}),plan:Object.freeze({kind:'REJECT_ALL'})});
  if(decisionShape==='ABSTAIN')return Object.freeze({state,questions:Object.freeze({abstain:{type:'choice',instructions:'Should this bounded decision abstain because the supplied evidence is insufficient or unsafe?',criteria:{abstain:'Abstain from a bounded selection.',continue:'The evidence is sufficient to continue, so abstention is not established.'}}}),plan:Object.freeze({kind:'ABSTAIN'})});
  if(decisionShape==='UNRESOLVED')return Object.freeze({state,questions:Object.freeze({unresolved:{type:'choice',instructions:'Is this bounded decision genuinely unresolved under the supplied evidence and constraints?',criteria:{unresolved:'The supplied evidence does not resolve the bounded alternatives.',resolved:'The supplied evidence is sufficient to resolve the bounded alternatives.'}}}),plan:Object.freeze({kind:'UNRESOLVED'})});
  throw new ProviderInvocationError(FailureCode.CAPABILITY_UNAVAILABLE,'Jev typed Decisions transport does not execute policy-only decision shape '+decisionShape+'.',{details:{decisionShape}});
}

export function mapTypedDecisionAnswers(data={},plan={},answers={}){
  const options=Array.isArray(data.options)?data.options:[],optionIds=options.map(option=>option.optionId),byId=new Map(options.map(option=>[option.optionId,option])),requiresOperator=Boolean(data.operatorApprovalPolicy?.required);
  if(plan.kind==='CHOICE'){
    const answer=requireChoice(answers.selection,'selection'),confidence=choiceConfidence(answer);
    if(answer.choice===SYNTH_UNRESOLVED)return decisionEnvelope({outcome:'UNRESOLVED',decisionCode:'UNRESOLVED',confidence,requiresOperator,reasonCodes:['JEV_TYPED_CHOICE','JEV_TYPED_UNRESOLVED'],unresolvedFactors:['Typed Jev did not identify one bounded option as sufficiently supported.']});
    if(answer.choice===SYNTH_ABSTAIN)return decisionEnvelope({outcome:'ABSTAINED',decisionCode:'ABSTAIN',confidence,abstained:true,requiresOperator,reasonCodes:['JEV_TYPED_CHOICE','JEV_TYPED_ABSTAIN'],unresolvedFactors:['Typed Jev judged the supplied evidence insufficient for bounded selection.']});
    if(!byId.has(answer.choice))throw malformed('Typed Jev Choice returned an unknown option: '+String(answer.choice));
    const selected=[answer.choice],rejected=optionIds.filter(id=>id!==answer.choice);
    return decisionEnvelope({outcome:'DECIDED',decisionCode:String(data.decisionShape),selectedOptionIds:selected,rejectedOptionIds:rejected,classification:String(data.decisionShape)==='CLASSIFY_RELATIONSHIP'?answer.choice:null,evidenceUsed:evidenceForOptions(selected,byId),confidence,requiresOperator,reasonCodes:['JEV_TYPED_CHOICE'],explanation:'Typed Jev Choice selected '+answer.choice+' with confidence '+formatProbability(confidence)+'.'});
  }
  if(plan.kind==='MULTI_CHOICE'){
    const selected=[],rejected=[],confidences=[];for(const [questionId,optionId] of Object.entries(plan.mapping??{})){const answer=requireChoice(answers[questionId],questionId);if(!['include','exclude'].includes(answer.choice))throw malformed('Typed Jev subset Choice returned an unsupported answer for '+questionId+'.');confidences.push(choiceConfidence(answer));(answer.choice==='include'?selected:rejected).push(optionId);}
    const confidence=average(confidences);
    if(!selected.length){const abstain=data.abstentionAllowed!==false;return decisionEnvelope({outcome:abstain?'ABSTAINED':'UNRESOLVED',decisionCode:abstain?'ABSTAIN':'UNRESOLVED',confidence,abstained:abstain,requiresOperator,rejectedOptionIds:rejected,reasonCodes:['JEV_TYPED_MULTI_CHOICE',abstain?'JEV_TYPED_ABSTAIN':'JEV_TYPED_UNRESOLVED'],unresolvedFactors:['No bounded option received an include decision from typed Jev.']});}
    return decisionEnvelope({outcome:'DECIDED',decisionCode:String(data.decisionShape),selectedOptionIds:selected,rejectedOptionIds:rejected,evidenceUsed:evidenceForOptions(selected,byId),confidence,requiresOperator,reasonCodes:['JEV_TYPED_MULTI_CHOICE'],explanation:'Typed Jev independently evaluated '+String(selected.length+rejected.length)+' bounded options and included '+String(selected.length)+'.'});
  }
  if(plan.kind==='RANK_SCORE'){
    const rows=[];for(const [questionId,optionId] of Object.entries(plan.mapping??{})){const answer=requireScore(answers[questionId],questionId);rows.push({optionId,score:Number(answer.score),confidence:scoreConfidence(answer)});}rows.sort((a,b)=>b.score-a.score||b.confidence-a.confidence||a.optionId.localeCompare(b.optionId));const selected=rows.map(row=>row.optionId);
    return decisionEnvelope({outcome:'DECIDED',decisionCode:'RANK_BOUNDED_OPTIONS',selectedOptionIds:selected,rejectedOptionIds:[],evidenceUsed:evidenceForOptions(selected,byId),confidence:average(rows.map(row=>row.confidence)),requiresOperator,reasonCodes:['JEV_TYPED_SCORE'],explanation:'Typed Jev Score ranked '+String(rows.length)+' bounded options.'});
  }
  if(plan.kind==='REJECT_ALL'){
    const answer=requireChoice(answers.reject_all,'reject_all'),confidence=choiceConfidence(answer);
    if(answer.choice==='reject_all')return decisionEnvelope({outcome:'DECIDED',decisionCode:'REJECT_ALL',selectedOptionIds:[],rejectedOptionIds:optionIds,evidenceUsed:evidenceForOptions(optionIds,byId),confidence,requiresOperator,reasonCodes:['JEV_TYPED_REJECT_ALL'],explanation:'Typed Jev judged all bounded options rejectable.'});
    if(answer.choice!=='keep_at_least_one')throw malformed('Typed Jev reject-all Choice returned an unsupported answer.');
    return decisionEnvelope({outcome:'UNRESOLVED',decisionCode:'UNRESOLVED',confidence,requiresOperator,reasonCodes:['JEV_TYPED_REJECT_ALL','JEV_TYPED_UNRESOLVED'],unresolvedFactors:['At least one bounded option remains viable, but REJECT_ALL does not identify which one.']});
  }
  if(plan.kind==='ABSTAIN'){const answer=requireChoice(answers.abstain,'abstain'),confidence=choiceConfidence(answer),abstain=answer.choice==='abstain';if(!abstain&&answer.choice!=='continue')throw malformed('Typed Jev abstain Choice returned an unsupported answer.');return decisionEnvelope({outcome:abstain?'ABSTAINED':'UNRESOLVED',decisionCode:abstain?'ABSTAIN':'UNRESOLVED',confidence,abstained:abstain,requiresOperator,reasonCodes:['JEV_TYPED_ABSTAIN'],unresolvedFactors:abstain?['Typed Jev judged the evidence insufficient for a bounded decision.']:['Abstention was not established by the typed decision.']});}
  if(plan.kind==='UNRESOLVED'){const answer=requireChoice(answers.unresolved,'unresolved'),confidence=choiceConfidence(answer);if(!['unresolved','resolved'].includes(answer.choice))throw malformed('Typed Jev unresolved Choice returned an unsupported answer.');return decisionEnvelope({outcome:'UNRESOLVED',decisionCode:'UNRESOLVED',confidence,requiresOperator,reasonCodes:['JEV_TYPED_UNRESOLVED'],unresolvedFactors:[answer.choice==='unresolved'?'Typed Jev judged the bounded alternatives unresolved.':'The request shape only permits an unresolved result; typed Jev indicated the evidence may be resolvable.']});}
  throw malformed('Unknown typed Jev mapping plan: '+String(plan.kind));
}

function decisionEnvelope(input={}){return{outcome:input.outcome??'UNRESOLVED',decisionCode:input.decisionCode??'UNRESOLVED',selectedOptionIds:[...(input.selectedOptionIds??[])],rejectedOptionIds:[...(input.rejectedOptionIds??[])],classification:input.classification??null,reasonCodes:[...(input.reasonCodes??[])],evidenceUsed:[...(input.evidenceUsed??[])],unresolvedFactors:[...(input.unresolvedFactors??[])],confidence:clamp01(input.confidence??0),abstained:Boolean(input.abstained),escalationTarget:null,requiresOperator:Boolean(input.requiresOperator),explanation:String(input.explanation??'')};}
function describeOption(option,evidenceById){const evidence=(option.evidenceRefs??[]).map(id=>evidenceById.get(id)?.summary).filter(Boolean).join(' | '),payload=option.payload&&Object.keys(option.payload).length?JSON.stringify(option.payload):'';return[String(option.label??option.optionId),evidence?'Evidence: '+evidence:'',payload?'Payload: '+payload:''].filter(Boolean).join('. ').slice(0,1800);}
function evidenceForOptions(ids,byId){const refs=[];for(const id of ids)for(const ref of byId.get(id)?.evidenceRefs??[])if(!refs.includes(ref))refs.push(ref);return refs;}
function requireChoice(answer,name){if(!answer||answer.type!=='choice'||typeof answer.choice!=='string')throw malformed('OpenRouter Decisions answer '+name+' is not a typed Choice.');return answer;}
function requireScore(answer,name){if(!answer||answer.type!=='score'||!Number.isFinite(Number(answer.score)))throw malformed('OpenRouter Decisions answer '+name+' is not a typed Score.');return answer;}
function choiceConfidence(answer){const direct=Number(answer.confidence);if(Number.isFinite(direct))return clamp01(direct);const values=Object.values(answer.probabilities??{}).map(Number).filter(Number.isFinite);return values.length?clamp01(Math.max(...values)):0;}
function scoreConfidence(answer){const value=Number(answer.confidence);return Number.isFinite(value)?clamp01(value):0;}
function average(values){const rows=values.filter(Number.isFinite);return rows.length?rows.reduce((a,b)=>a+b,0)/rows.length:0;}
function clamp01(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;}
function formatProbability(value){return clamp01(value).toFixed(3);}
function malformed(message){return new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,message);}
function openRouterHeaders(apiKey,{json=true}={}){const headers={Authorization:'Bearer '+apiKey,'HTTP-Referer':'https://sillytavern.app','X-OpenRouter-Title':'Area-52'};if(json)headers['Content-Type']='application/json';return headers;}
async function requestJson(fetchImpl,url,{method='GET',headers={},body=null,signal=null,timeoutMs=10000,providerId=null,operation='OpenRouter request'}={}){
  const controller=new AbortController();let timedOut=false;const abortExternal=()=>controller.abort(signal?.reason??'caller-abort');if(signal?.aborted)abortExternal();else signal?.addEventListener?.('abort',abortExternal,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort('provider-timeout');},Math.max(250,Number(timeoutMs)||10000));
  try{
    let response;try{response=await fetchImpl(url,{method,headers,body:body==null?undefined:JSON.stringify(body),signal:controller.signal});}
    catch(error){if(timedOut)throw new ProviderInvocationError(FailureCode.PROVIDER_TIMEOUT,operation+' timed out.',{providerId,cause:error});if(controller.signal.aborted)throw new ProviderInvocationError(FailureCode.PROVIDER_ABORTED,operation+' aborted.',{providerId,cause:error});throw new ProviderInvocationError(FailureCode.PROVIDER_UNAVAILABLE,operation+' network failure: '+String(error?.message??error),{providerId,cause:error});}
    let payload=null;try{payload=await response.json();}catch(error){if(response.ok)throw new ProviderInvocationError(FailureCode.MALFORMED_OUTPUT,operation+' returned invalid JSON.',{providerId,cause:error,status:Number(response.status??0)});}
    return{ok:Boolean(response.ok),status:Number(response.status??0),payload};
  }finally{clearTimeout(timer);signal?.removeEventListener?.('abort',abortExternal);}
}
function mapHttpError(status,payload,{providerId=null,operation='OpenRouter request'}={}){
  const code=(status===401||status===403)?FailureCode.PROVIDER_UNAUTHORIZED:(status===408||status===524)?FailureCode.PROVIDER_TIMEOUT:(status===404)?FailureCode.MODEL_UNAVAILABLE:(status===429||status>=500)?FailureCode.PROVIDER_UNAVAILABLE:FailureCode.PROVIDER_FAILURE;
  const detail=safeErrorDetail(payload),auth=code===FailureCode.PROVIDER_UNAUTHORIZED?' OpenRouter rejected the dedicated Decision Core API key.':'';
  return new ProviderInvocationError(code,operation+' returned HTTP '+String(status)+'.'+auth+(detail?' '+detail:''),{providerId,status,details:{decisionProtocol:OPENROUTER_JEV_PROTOCOL}});
}
function safeErrorDetail(payload){const raw=typeof payload?.error==='string'?payload.error:payload?.error?.message??payload?.message??'',value=String(raw??'').replace(/[\r\n\t]+/g,' ').trim();return value.slice(0,240);}
