import { ObservationClass, createFieldState } from '../scene/contracts.js';
import { DevelopmentDeploymentBrain } from './brain.js';
import { mountWave12SillyTavernInterface } from '../ui-core/index.js';

export const DEVELOPMENT_DEPLOYMENT_PROMPT_ID = 'area52-development-deployment';
export const DEVELOPMENT_DEPLOYMENT_LIVE_CONTRACT_VERSION = '1.4.0';

const clone = (value) => value == null ? value : structuredClone(value);
const clean = (value) => String(value ?? '').trim();

function normalizeEndpoint(value){
  const raw=clean(value);if(!raw)return null;
  try{const url=new URL(raw);return url.origin+url.pathname.replace(/\/+$/,'');}
  catch{return raw.replace(/\/+$/,'');}
}

function isSillyTavernOpenRouterRoute(context,config={}){
  const endpoint=normalizeEndpoint(config.endpoint);
  if(!endpoint)return false;
  try{
    const host=new URL(endpoint).hostname.toLowerCase();
    const hostFetch=typeof context?.fetch==='function'?context.fetch:globalThis.fetch;
    return (host==='openrouter.ai'||host.endsWith('.openrouter.ai'))&&typeof hostFetch==='function'&&typeof context?.getRequestHeaders==='function';
  }catch{return false;}
}

function createSillyTavernActiveOpenRouterAdapter({getContext,providerId,modelId,capabilities=[]}={}){
  let selectedModel=clean(modelId);
  if(!selectedModel)throw new TypeError('OpenRouter model is required');
  const request=async(messages,{signal=null,maxOutputTokens=null,temperature=null}={})=>{
    const context=getContext(),hostFetch=typeof context?.fetch==='function'?context.fetch:globalThis.fetch;
    if(typeof hostFetch!=='function'||typeof context?.getRequestHeaders!=='function')throw Object.assign(new Error('SillyTavern authenticated host request API is unavailable'),{code:'PROVIDER_UNAVAILABLE'});
    const body={stream:false,messages,model:selectedModel,chat_completion_source:'openrouter'};
    if(Number.isFinite(Number(maxOutputTokens))&&Number(maxOutputTokens)>0)body.max_tokens=Math.trunc(Number(maxOutputTokens));
    if(temperature!=null&&Number.isFinite(Number(temperature)))body.temperature=Number(temperature);
    const startedAt=Date.now();
    let response;
    try{
      response=await hostFetch('/api/backends/chat-completions/generate',{
        method:'POST',headers:context.getRequestHeaders(),cache:'no-cache',body:JSON.stringify(body),signal:signal??undefined,
      });
    }catch(error){
      throw Object.assign(new Error('SillyTavern OpenRouter proxy request failed: '+String(error?.message??error)),{code:'PROVIDER_UNAVAILABLE',cause:error});
    }
    let json=null,plain='';
    try{json=await response.json();}catch{try{plain=await response.text();}catch{}}
    if(!response?.ok||json?.error){
      const detail=clean(json?.error?.message??json?.message??plain);
      const status=Number(response?.status??0);
      const message='SillyTavern OpenRouter proxy rejected the request'+(status&&status!==200?' (HTTP '+status+')':'')+(detail?': '+detail.slice(0,240):'');
      const code=status===401||status===403?'PROVIDER_UNAUTHORIZED':status===404?'MODEL_UNAVAILABLE':'PROVIDER_FAILURE';
      throw Object.assign(new Error(message),{code,status});
    }
    const content=typeof json?.choices?.[0]?.message?.content==='string'
      ?json.choices[0].message.content
      :typeof json?.choices?.[0]?.text==='string'?json.choices[0].text
      :typeof json?.content==='string'?json.content:'';
    if(!content)throw Object.assign(new Error('SillyTavern OpenRouter backend returned no completion text'),{code:'MALFORMED_OUTPUT'});
    const completedAt=Date.now();return{content,startedAt,completedAt};
  };
  return{
    providerId,modelId:selectedModel,capabilities:[...new Set(capabilities)],measurementClass:'MEASURED_LIVE',
    structuredOutputSupport:true,streamingSupport:false,abortSupport:true,local:false,
    contextLimit:Number.MAX_SAFE_INTEGER,outputLimit:Number.MAX_SAFE_INTEGER,
    setModelId(value){selectedModel=clean(value);this.modelId=selectedModel;return selectedModel;},
    setCredential(){return false;},clearCredential(){return false;},
    async discoverModels(){return Object.freeze({ok:true,supported:true,state:'READY',models:Object.freeze([{id:selectedModel,displayName:selectedModel}]),latencyMs:0,transportMode:'CHAT_COMPLETIONS'});},
    async probe({signal=null}={}){
      const probe=await request([{role:'user',content:'Area-52 connection qualification. Reply briefly.'}],{signal});
      return Object.freeze({ok:true,providerId,modelId:selectedModel,latencyMs:probe.completedAt-probe.startedAt,modelAvailable:true,discoveryState:'READY',measurementClass:'MEASURED_LIVE',capabilities:Object.freeze([...new Set(capabilities)]),transportMode:'CHAT_COMPLETIONS',actualProvider:'SILLYTAVERN_ACTIVE_OPENROUTER'});
    },
    async invoke(task,input,{signal=null,maxOutputTokens=1200,temperature=0}={}){
      const messages=Array.isArray(input?.messages)?input.messages:[{role:'user',content:JSON.stringify(input?.data??input??{})}];
      const result=await request(messages,{signal,maxOutputTokens,temperature});
      return Object.freeze({providerId,modelId:selectedModel,text:result.content,usage:{},finishReason:'stop',startedAt:result.startedAt,completedAt:result.completedAt,latencyMs:result.completedAt-result.startedAt,
        metadata:{measurementClass:'MEASURED_LIVE',requestedModelId:selectedModel,actualProvider:'SILLYTAVERN_ACTIVE_OPENROUTER',hostManagedCredential:true,hostCredentialSource:'SILLYTAVERN_ACTIVE_SECRET'}});
    },
  };
}

function shortHash(value) {
  let h = 2166136261;
  for (const ch of String(value)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function assistantMessage(context,index=null){
  const chat=Array.isArray(context?.chat)?context.chat:[];
  if(Number.isInteger(Number(index))){
    const row=chat[Number(index)],text=clean(row?.mes??row?.content??row?.text);
    if(row&&row?.is_user!==true&&row?.role!=='user'&&text)return{index:Number(index),row,text};
  }
  for(let i=chat.length-1;i>=0;i-=1){
    const row=chat[i],text=clean(row?.mes??row?.content??row?.text);
    if(row&&row?.is_user!==true&&row?.role!=='user'&&text)return{index:i,row,text};
  }
  return null;
}

function safeProviderOutcome(value){
  if(!value||typeof value!=='object')return value==null?null:{status:String(value)};
  return{
    status:value.status??value.state??value.result??null,
    code:value.code??value.reasonCode??value.errorCode??null,
    message:typeof value.message==='string'?value.message.slice(0,400):typeof value.reason==='string'?value.reason.slice(0,400):null,
    latencyMs:Number.isFinite(Number(value.latencyMs??value.durationMs))?Number(value.latencyMs??value.durationMs):null,
  };
}

function operatorResultSummary(result){
  if(!result)return null;
  const value=result?.ok===true?result.value??null:null;
  return{ok:result?.ok===true,kind:value?.kind??null,errorCode:result?.error?.code??null};
}

function nativeBrainContract(brain){
  if(!brain)return{available:false,reason:'Worker 1 Area52NativeBrain is not integrated into this main assembly.'};
  const required=['runTurn','uiBindings'];
  const missing=required.filter(name=>typeof brain?.[name]!=='function');
  return missing.length?{available:false,reason:'Native Brain owner object is missing: '+missing.join(', ')}:{available:true,reason:null};
}

function latestUserMessage(context) {
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    const row = chat[index];
    const isUser = row?.is_user === true || row?.role === 'user';
    const text = clean(row?.mes ?? row?.content ?? row?.text);
    if (isUser && text) return { index, row, text };
  }
  return null;
}

export function classifyDevelopmentDeploymentTurn(text) {
  const value = clean(text).toLowerCase();
  if (/(uncertain|unknown|ambiguous|conflict(?:ing)?|contradict(?:s|ed|ory|ion)?|disagree(?:s|ment)?|accounts? differ|reports? differ|which (?:account|report|version)|what really happened)/.test(value)) return 'ambiguous';
  if (/(where are we|where am i|where.*now)/.test(value)) return 'simple';
  return 'retrieval';
}

function sceneField(value, revision, evidenceRef, observationClass = ObservationClass.OBSERVED, confidence = 1) {
  return createFieldState({
    value,
    revision,
    evidenceRefs: [evidenceRef],
    observationClass,
    confidence,
    provenance: [evidenceRef],
  });
}

export function extractDevelopmentDeploymentScene(text, { revision, evidenceRef } = {}) {
  const raw = clean(text);
  const fields = {};
  const locationMatch = raw.match(/\b(?:[Aa]t|[Ii]nside|[Ww]ithin|[Oo]utside|[Nn]ear)\s+(?:the\s+)?([\p{Lu}][\p{L}\p{N}'’_-]*(?:\s+(?:[\p{Lu}][\p{L}\p{N}'’_-]*|of|the|and)){0,4})/u);
  if (locationMatch?.[1]) {
    const location = locationMatch[1].replace(/[.,!?;:]+$/, '').trim();
    if (location) fields.location = sceneField({ location }, revision, evidenceRef);
  }
  return {
    explicit: Object.keys(fields).length > 0,
    fields,
    sourceText: raw,
    extractionPolicy: 'GENERIC_HOST_EVIDENCE_ONLY',
  };
}

function renderPromptPlan(plan) {
  const sections = (plan?.sections ?? [])
    .filter((section) => section?.representation !== 'OMITTED' && clean(section?.text))
    .map((section) => {
      const refs = (section.semanticManifest ?? []).map((entry) => entry.semanticKey ?? entry.id).filter(Boolean);
      return [
        '## ' + section.slot,
        clean(section.text),
        refs.length ? 'Evidence: ' + refs.join(', ') : null,
      ].filter(Boolean).join('\n');
    });

  return [
    '[Area-52 sealed context]',
    'PromptPlan: ' + (plan?.promptPlanId ?? 'unknown'),
    'Generation: ' + (plan?.generationId ?? 'unknown'),
    ...sections,
  ].join('\n\n');
}

function sourceIdentity(chatId, message) {
  const messageKey = clean(message.row?.mesId ?? message.row?.message_id ?? message.row?.id ?? message.index);
  const digest = shortHash(message.text);
  return {
    sourceId: 'sillytavern:' + chatId + ':message:' + messageKey + ':' + digest,
    messageKey,
    digest,
  };
}

function registerNarrativeSource(brain, { chatId, message }) {
  const identity = sourceIdentity(chatId, message);
  const imported = brain.core.registry.importSource({
    id: identity.sourceId,
    sourceType: 'EXPERIENCE',
    content: message.text,
    metadata: {
      host: 'SILLYTAVERN',
      chatId,
      messageId: identity.messageKey,
      messageIndex: message.index,
      messageDigest: identity.digest,
      role: 'user',
    },
  });
  return { ...identity, sourceRevisionId: imported.revision.id };
}

function applyNativeScene(brain, { chatId, message, sourceRevisionId }) {
  const prior = brain.scene.integrationSignal(chatId);
  const nextRevision = Number(prior?.sceneRevision ?? 0) + 1;
  const parsed = extractDevelopmentDeploymentScene(message.text, { revision: nextRevision, evidenceRef: sourceRevisionId });
  if (!parsed.explicit) {
    const signal = prior ?? brain.ensureScene({ chatId, sourceRevisionId });
    return {
      observed: false,
      initialized: !prior,
      parsed,
      signal,
      delta: null,
      reason: prior ? 'NO_EXPLICIT_SCENE_FIELDS_REUSE_CURRENT' : 'SCENE_INITIALIZED_WITH_UNKNOWN_FIELDS',
    };
  }

  const location = parsed.fields.location.value;
  const observed = brain.observeScene({
    chatId,
    sourceRevisionId,
    location,
    activeCast: prior?.activeCast ?? [],
    activeThreads: prior?.activeThreads ?? [],
    objects: prior?.objects ?? [],
    atmosphere: null,
  });
  return { observed: true, initialized: false, parsed, signal: observed, delta: observed.delta ?? null, reason: 'HOST_LOCATION_OBSERVED' };
}

async function injectPrompt(context, result) {
  const plan = result?.delivery?.plan ?? null;
  if (!plan) return { supported: false, succeeded: false, reason: 'PROMPT_PLAN_UNAVAILABLE' };
  if (typeof context?.setExtensionPrompt !== 'function') {
    return { supported: false, succeeded: false, reason: 'SILLYTAVERN_SET_EXTENSION_PROMPT_UNAVAILABLE', promptPlanId: plan.promptPlanId };
  }
  const content = renderPromptPlan(plan);
  await Promise.resolve(context.setExtensionPrompt(
    DEVELOPMENT_DEPLOYMENT_PROMPT_ID,
    content,
    1,
    0,
    false,
    0,
  ));
  return {
    supported: true,
    succeeded: true,
    promptId: DEVELOPMENT_DEPLOYMENT_PROMPT_ID,
    position: 1,
    depth: 0,
    role: 0,
    promptPlanId: plan.promptPlanId,
    generationId: plan.generationId,
    contextSealId: plan.contextSealId,
    contentDigest: shortHash(content),
    semanticEntryCount: plan.diagnosticReceipt?.semanticEntryCount ?? null,
  };
}


async function executeHostTurn(brain, context, message, { mode = null, inject = true } = {}) {
  const chatId = clean(context?.chatId);
  if (!chatId) throw new Error('SillyTavern chatId is unavailable');
  const chosenMode = mode ?? classifyDevelopmentDeploymentTurn(message.text);
  const source = registerNarrativeSource(brain, { chatId, message });
  const scene = applyNativeScene(brain, { chatId, message, sourceRevisionId: source.sourceRevisionId });
  const turnSuffix = source.messageKey + ':' + source.digest + ':' + chosenMode;
  const turnId = 'live:' + chatId + ':' + turnSuffix;
  const generationId = 'live-gen:' + chatId + ':' + source.messageKey + ':' + source.digest;

  const result = await brain.runTurn({
    chatId,
    turnId,
    generationId,
    query: message.text,
    mode: chosenMode,
  });
  const promptInjection = inject ? await injectPrompt(context, result) : { supported: true, succeeded: true, reason: 'DEGRADED_CONTROL_NO_MAIN_INJECTION' };
  const selection = result.selection;
  const seal = brain.core.publication.seal.verify(turnId);

  return {
    kind: 'DevelopmentDeploymentLiveTurnEvidence',
    mode: chosenMode,
    host: {
      chatId,
      messageIndex: message.index,
      messageId: source.messageKey,
      messageDigest: source.digest,
      sourceRevisionId: source.sourceRevisionId,
    },
    selection: clone(selection),
    scene: {
      observedFromHostMessage: scene.observed,
      initializedFromHostMessage: Boolean(scene.initialized),
      reason: scene.reason ?? null,
      extractionPolicy: scene.parsed?.extractionPolicy ?? null,
      revision: scene.signal?.sceneRevision ?? null,
      sceneId: scene.signal?.sceneId ?? null,
      delta: clone(scene.delta),
      changedFields: Object.keys(scene.delta?.changedFields ?? {}).sort(),
    },
    runtime: {
      jobCount: result.scatter.jobs.length,
      jobs: clone(result.scatter.jobs),
      resourceCount: result.scatter.resourceCount,
      resourceIds: clone(result.scatter.resourceIds),
    },
    cognition: {
      choice: clone(result.published.cognitiveChoiceReceipt),
      truth: clone(result.published.assessment),
      jev: clone(result.jevProposal),
      jevExecution: clone(result.jevExecution),
      gather: clone(result.published.gatherReceipt),
    },
    delivery: {
      ok: result.delivery.ok,
      status: result.delivery.status,
      promptPlanId: result.delivery.plan?.promptPlanId ?? null,
      generationId: result.delivery.plan?.generationId ?? null,
      contextSealId: result.delivery.plan?.contextSealId ?? null,
      sealVerified: Boolean(seal?.sealed && seal?.hashMatches),
      semanticManifest: clone(result.delivery.plan?.sections?.flatMap((section) => section.semanticManifest ?? []) ?? []),
      promptInjection,
    },
  };
}

function liveTurnReady(row) {
  if (!row?.host?.chatId || !row?.selection?.turnId || !row?.selection?.generationId) return false;
  if (!row.delivery?.ok || !row.delivery?.sealVerified || !row.delivery?.promptInjection?.succeeded) return false;
  if (!row.cognition?.choice || !row.runtime) return false;
  if (!row.scene?.sceneId || row.scene?.extractionPolicy !== 'GENERIC_HOST_EVIDENCE_ONLY') return false;
  return true;
}

function storyCoverage(turns) {
  const byChat = new Map();
  for (const row of turns) {
    const chatId = clean(row?.host?.chatId);
    if (!chatId) continue;
    const current = byChat.get(chatId) ?? { chatId, turnCount: 0, readyTurnCount: 0, modes: new Set() };
    current.turnCount += 1;
    if (liveTurnReady(row)) current.readyTurnCount += 1;
    if (row?.mode) current.modes.add(row.mode);
    byChat.set(chatId, current);
  }
  return [...byChat.values()]
    .map((row) => ({ ...row, modes: [...row.modes].sort(), ready: row.readyTurnCount > 0 }))
    .sort((a, b) => a.chatId.localeCompare(b.chatId));
}

export class DevelopmentDeploymentSillyTavernSession {
  constructor({
    sillyTavern = globalThis.SillyTavern ?? null,
    document = globalThis.document ?? null,
    brain = null,
    mountUi = true,
    onEvidence = null,
    initialLorebook = null,
    nativeBrain = null,
    ownerBindings = {},
    persistNativeBrain = null,
  } = {}) {
    this.sillyTavern = sillyTavern;
    this.document = document;
    this.brain = brain ?? new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: true });
    this.nativeBrain = null;
    this.ownerBindings = ownerBindings&&typeof ownerBindings==='object'?{...ownerBindings}:{};
    this.persistNativeBrain=typeof persistNativeBrain==='function'?persistNativeBrain:null;
    this.nativePersistence=[];
    this.nativePending = new Map();
    this.nativePayloads = new Map();
    this.nativeRuns = new Map();
    this.nativeHistory = [];
    this.nativeRejections = [];
    this.nativeLoreRevisionEvents = [];
    this.routedLoreRevisionKeys = new Set();
    this.nativeOwnerAttachments = {lore:null,memory:null,graphProviders:[]};
    this.nativeGraphProviderIds = new Set();
    this.optionalGenerationActive = new Map();
    this.releaseLoreOwnerEvents = null;
    this.nativeSequence = 0;
    this.hostEventSequence = 0;
    this.hostNarrativeEvents = [];
    this.hostManagedResourceProfiles = new Map();
    this.onEvidence = typeof onEvidence === 'function' ? onEvidence : null;
    this.uiHost = null;
    this.running = false;
    this.release = null;
    this.processing = null;
    this.processed = new Map();
    this.turnEvidence = [];
    this.scenarios = { simple: null, retrieval: null, ambiguous: null };
    this.loreIngestion = [];
    this.acceptedLorebooks = new Map();
    this.degraded = null;
    this.operatorReview = { promptInspectorConfirmed: false, uiTraceReviewed: false, liveSillyTavernConfirmed: false, confirmedAt: null };
    this.errors = [];
    if(nativeBrain)this.attachNativeBrain(nativeBrain,{remount:false});
    if (initialLorebook) this.ingestLorebook(initialLorebook, { notify: false });
    if (mountUi) this.mount();
  }

  getContext() {
    if (!this.sillyTavern || typeof this.sillyTavern.getContext !== 'function') throw new Error('SillyTavern.getContext() is unavailable');
    const context = this.sillyTavern.getContext();
    if (!context || typeof context !== 'object') throw new Error('SillyTavern host context is unavailable');
    return context;
  }

  attachNativeBrain(nativeBrain,{remount=true}={}){
    const contract=nativeBrainContract(nativeBrain);
    if(!contract.available)throw new TypeError(contract.reason);
    const wasRunning=this.running;if(wasRunning)this.stop();
    this.nativeBrain=nativeBrain;
    this.#attachNativeKnowledgeOwners();
    if(remount&&this.uiHost){this.uiHost.destroy?.();this.uiHost=null;this.mount();}
    if(wasRunning)this.start();
    this.#notify();return this;
  }

  detachNativeBrain(){
    const wasRunning=this.running;if(wasRunning)this.stop();
    for(const run of this.nativeRuns.values())try{run.responseReject?.(new Error('Native Brain owner detached'));}catch{}
    this.nativeBrain=null;this.nativePending.clear();this.nativePayloads.clear();this.nativeRuns.clear();this.nativeOwnerAttachments={lore:null,memory:null,graphProviders:[]};this.nativeGraphProviderIds.clear();this.#completeAllOptionalGenerations('NATIVE_BRAIN_DETACHED');
    if(this.uiHost){this.uiHost.destroy?.();this.uiHost=null;this.mount();}
    if(wasRunning)this.start();
    this.#notify();return this;
  }

  acceptLoreRevisionChange(event){
    const contract=nativeBrainContract(this.nativeBrain);
    if(!contract.available||typeof this.nativeBrain?.acceptLoreRevisionChange!=='function')throw new Error('Native Brain Lore revision invalidation contract is not integrated');
    const receipt=this.nativeBrain.acceptLoreRevisionChange(clone(event));
    const safe={kind:receipt?.kind??'NativeBrainLoreRevisionInvalidationReceipt',status:receipt?.status??null,sourceId:receipt?.sourceId??event?.sourceId??null,lorebookId:receipt?.lorebookId??event?.lorebookId??null,uid:receipt?.uid??event?.uid??null,previousSourceRevisionId:receipt?.previousSourceRevisionId??event?.previousSourceRevisionId??null,sourceRevisionId:receipt?.sourceRevisionId??event?.sourceRevisionId??null,nextRevisionTrusted:Boolean(receipt?.nextRevisionTrusted),revisionTrustStatus:receipt?.revisionTrustStatus??null,at:Date.now()};
    this.nativeLoreRevisionEvents.push(safe);if(this.nativeLoreRevisionEvents.length>100)this.nativeLoreRevisionEvents.shift();this.#notify();return clone(safe);
  }

  ingestLorebook(lorebook, { notify = true } = {}) {
    if (!lorebook || !Array.isArray(lorebook.entries)) throw new TypeError('Lorebook entries are required');
    const result = this.brain.ingestLorebook(lorebook);
    const lorebookId = String(lorebook.id ?? 'operator-lore');
    this.acceptedLorebooks.set(lorebookId, clone(lorebook));
    const receipt = {
      kind: 'DevelopmentDeploymentLoreIngestionReceipt',
      lorebookId,
      title: String(lorebook.title ?? 'Operator Lore'),
      accepted: true,
      processed: true,
      entryCount: lorebook.entries.length,
      mappingCount: result.mappingCount,
      rawSourceOnlyCount: result.rawSourceOnlyCount ?? 0,
      semanticExtractionCount: result.semanticExtractionCount ?? 0,
      retrievable: result.mappingCount > 0,
      hierarchyRevision: result.retrieval?.hierarchyRevision ?? null,
    };
    this.loreIngestion.push(receipt);
    if (notify) this.#notify();
    return clone(receipt);
  }

  mount() {
    if (this.uiHost) return this.uiHost;
    this.uiHost = mountWave12SillyTavernInterface({
      getContext: () => this.getContext(),
      document: this.document,
      hostBindings: this.#uiHostBindings(),
    });
    this.#notify();
    return this.uiHost;
  }

  start() {
    if (this.running) return this;
    const context = this.getContext();
    if(!context.eventSource||typeof context.eventSource.on!=='function')throw new Error('SillyTavern eventSource is unavailable');
    const releases=[];
    if(this.nativeBrain){
      const before=context.eventTypes?.GENERATION_AFTER_COMMANDS??context.event_types?.GENERATION_AFTER_COMMANDS;
      const requestReady=context.eventTypes?.CHAT_COMPLETION_PROMPT_READY??context.event_types?.CHAT_COMPLETION_PROMPT_READY;
      const received=context.eventTypes?.MESSAGE_RECEIVED??context.event_types?.MESSAGE_RECEIVED;
      const stopped=context.eventTypes?.GENERATION_STOPPED??context.event_types?.GENERATION_STOPPED;
      if(!before||!requestReady||!received)throw new Error('Native Brain live integration requires GENERATION_AFTER_COMMANDS, CHAT_COMPLETION_PROMPT_READY, and MESSAGE_RECEIVED events');
      const beforeHandler=async(type,options,dryRun)=>{if(dryRun)return;try{await this.prepareNativeGeneration({generationType:type});}catch(error){this.errors.push({at:Date.now(),message:String(error?.message??error),stage:'NATIVE_PREPARE'});this.#notify();}};
      const requestHandler=async(eventData)=>{if(eventData?.dryRun)return;try{this.injectNativeModelRequest(eventData);}catch(error){this.errors.push({at:Date.now(),message:String(error?.message??error),stage:'NATIVE_MODEL_REQUEST'});this.#notify();}};
      const receivedHandler=async(index)=>{try{await this.completeNativeGeneration({messageIndex:index});}catch(error){this.errors.push({at:Date.now(),message:String(error?.message??error),stage:'NATIVE_COMPLETE'});this.#notify();}};
      const stoppedHandler=()=>{this.#expireNativePending('GENERATION_STOPPED_WITHOUT_COMPLETION');};
      context.eventSource.on(before,beforeHandler);releases.push(()=>context.eventSource.removeListener?.(before,beforeHandler));
      context.eventSource.on(requestReady,requestHandler);releases.push(()=>context.eventSource.removeListener?.(requestReady,requestHandler));
      context.eventSource.on(received,receivedHandler);releases.push(()=>context.eventSource.removeListener?.(received,receivedHandler));
      if(stopped){context.eventSource.on(stopped,stoppedHandler);releases.push(()=>context.eventSource.removeListener?.(stopped,stoppedHandler));}
    }else{
      const eventName=context.eventTypes?.MESSAGE_SENT??context.event_types?.MESSAGE_SENT;
      if(!eventName)throw new Error('No supported SillyTavern pre-generation event is available');
      const handler=async()=>{try{await this.processCurrentTurn();}catch{/* processCurrentTurn records the failure for the operator. */}};
      context.eventSource.on(eventName,handler);releases.push(()=>context.eventSource.removeListener?.(eventName,handler));
    }
    const observedHostEvents=['MESSAGE_SENT','MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_UPDATED','MESSAGE_SWIPED','MESSAGE_SWIPE_DELETED','CHAT_CHANGED','CHAT_LOADED','CHAT_CREATED','CHAT_RENAMED','WORLDINFO_UPDATED','WORLDINFO_SETTINGS_UPDATED','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED'];
    for(const key of observedHostEvents){
      const eventName=context.eventTypes?.[key]??context.event_types?.[key];
      if(!eventName)continue;
      const observer=(...args)=>this.#recordHostNarrativeEvent(key,args);
      context.eventSource.on(eventName,observer);releases.push(()=>context.eventSource.removeListener?.(eventName,observer));
    }
    this.release=()=>{for(const release of releases.splice(0))try{release();}catch{}};
    this.running=true;this.#notify();return this;
  }

  stop() {
    this.release?.();this.release=null;this.running=false;this.#completeAllOptionalGenerations('SESSION_STOPPED');this.#notify();return this;
  }

  async prepareNativeGeneration({generationType='normal'}={}){
    const contract=nativeBrainContract(this.nativeBrain);if(!contract.available)throw new Error(contract.reason);
    const context=this.getContext(),message=latestUserMessage(context),chatId=clean(context.chatId);
    if(!message)throw new Error('No current SillyTavern user message is available for native Brain preparation');
    if(!chatId)throw new Error('SillyTavern chatId is unavailable');
    if(this.nativeRuns.has(chatId))throw new Error('A native Brain generation is already pending for this selected chat');
    const source=registerNarrativeSource(this.brain,{chatId,message}),scene=applyNativeScene(this.brain,{chatId,message,sourceRevisionId:source.sourceRevisionId});
    const seq=++this.nativeSequence,turnId='native-live:'+chatId+':'+source.messageKey+':'+source.digest+':'+seq,generationId='native-live-gen:'+chatId+':'+source.messageKey+':'+source.digest+':'+seq;
    let readyResolve,readyReject,responseResolve,responseReject,readySettled=false;
    const readyPromise=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const responsePromise=new Promise((resolve,reject)=>{responseResolve=resolve;responseReject=reject;});
    const run={chatId,turnId,generationId,responseResolve,responseReject,runPromise:null};
    this.nativeRuns.set(chatId,run);
    run.runPromise=Promise.resolve().then(()=>this.nativeBrain.runTurn({
      chatId,turnId,generationId,query:message.text,sceneSignal:scene.signal,executionLabel:'LIVE_SILLYTAVERN',
    },{
      generate:async(rendered,meta={})=>{
        const seal=meta.contextSealReceipt;
        if(!seal?.sealedState)throw new Error('Native Brain did not publish a sealed Context Seal before the model request');
        if(!rendered)throw new Error('Native Brain runTurn did not publish prepared.rendered for the model request');
        this.nativePayloads.set(chatId,clone(rendered));
        const pending={kind:'NativeBrainHostTurn',chatId,turnId,generationId,generationType:String(generationType??'normal'),userMessageIndex:message.index,userMessageDigest:source.digest,preparedAt:Date.now(),promptPlanId:meta.promptPlan?.promptPlanId??null,contextSealId:seal?.id??meta.promptPlan?.contextSealId??null,renderedPayloadDigest:shortHash(JSON.stringify(rendered)),state:'SEALED_FOR_MODEL_REQUEST'};
        this.nativePending.set(chatId,pending);this.nativeHistory.push(clone(pending));if(this.nativeHistory.length>100)this.nativeHistory.splice(0,this.nativeHistory.length-100);
        this.#beginOptionalGeneration(pending);
        readySettled=true;readyResolve(clone(pending));this.#notify();
        return responsePromise;
      },
    })).then(result=>({ok:true,result})).catch(error=>{if(!readySettled){readySettled=true;readyReject(error);}return{ok:false,error};});
    return readyPromise;
  }

  injectNativeModelRequest(eventData={}){
    const context=this.getContext(),chatId=clean(context.chatId),pending=this.nativePending.get(chatId),rendered=this.nativePayloads.get(chatId);
    if(!pending||!rendered)return null;
    if(pending.requestInjectedAt)return clone(pending);
    if(rendered.format!=='messages'||!Array.isArray(rendered.messages))throw new Error('Native Brain prepared.rendered format is not supported by the SillyTavern chat-completion request hook: '+String(rendered.format??'unknown'));
    if(!Array.isArray(eventData.chat))throw new Error('SillyTavern CHAT_COMPLETION_PROMPT_READY did not expose a mutable chat request');
    const exactMessages=clone(rendered.messages),lastUserIndex=eventData.chat.map(row=>String(row?.role??'')).lastIndexOf('user'),insertAt=lastUserIndex>=0?lastUserIndex:eventData.chat.length;
    eventData.chat.splice(insertAt,0,...exactMessages);
    const updated={...pending,state:'MODEL_REQUEST_PAYLOAD_INJECTED',requestInjectedAt:Date.now(),requestPayloadDigest:shortHash(JSON.stringify(exactMessages)),renderedMessageCount:exactMessages.length,requestHook:'CHAT_COMPLETION_PROMPT_READY'};
    this.nativePending.set(chatId,updated);this.nativeHistory.push(clone(updated));if(this.nativeHistory.length>100)this.nativeHistory.splice(0,this.nativeHistory.length-100);
    this.#notify();return clone(updated);
  }

  async completeNativeGeneration({messageIndex=null}={}){
    const contract=nativeBrainContract(this.nativeBrain);if(!contract.available)throw new Error(contract.reason);
    const context=this.getContext(),chatId=clean(context.chatId),pending=this.nativePending.get(chatId);
    if(!pending){
      const foreign=[...this.nativePending.values()].at(-1)??null;
      if(foreign){this.nativeRejections.push({at:Date.now(),code:'NATIVE_COMPLETION_CHAT_MISMATCH',expectedChatId:foreign.chatId,actualChatId:chatId,generationId:foreign.generationId});if(this.nativeRejections.length>100)this.nativeRejections.shift();this.#notify();}
      return null;
    }
    if(!pending.requestInjectedAt)throw new Error('Native Brain response arrived without the exact prepared.rendered payload being observed in the model request');
    const assistant=assistantMessage(context,messageIndex);
    if(!assistant)throw new Error('SillyTavern assistant response is unavailable for native Brain completion');
    if(assistant.index<=pending.userMessageIndex)throw new Error('Assistant completion does not follow the prepared user message');
    const run=this.nativeRuns.get(chatId);if(!run)throw new Error('Native Brain runTurn callback is unavailable for the pending generation');
    run.responseResolve(assistant.text);
    const outcome=await run.runPromise;
    if(!outcome?.ok)throw outcome?.error??new Error('Native Brain runTurn failed after provider response');
    const learning=outcome.result?.learning??null;
    if(!learning)throw new Error('Native Brain runTurn returned no learning receipt after the provider response');
    const completed={...pending,state:'LEARNED',completedAt:Date.now(),assistantMessageIndex:assistant.index,responseDigest:shortHash(assistant.text),learning:{kind:learning?.kind??null,sourceRevisionId:learning?.sourceRevisionId??null,rawExperienceRecoverable:Boolean(learning?.rawExperienceRecoverable),settlementCount:learning?.settlements?.length??learning?.settlementDecisions?.length??0,runtimeTaskId:learning?.runtimeTaskId??null}};
    this.nativePending.delete(chatId);this.nativePayloads.delete(chatId);this.nativeRuns.delete(chatId);this.nativeHistory.push(clone(completed));if(this.nativeHistory.length>100)this.nativeHistory.splice(0,this.nativeHistory.length-100);
    this.#completeOptionalGeneration(pending,'GENERATION_COMPLETED');
    await this.#persistNativeBrainCheckpoint({chatId,turnId:pending.turnId,generationId:pending.generationId});
    this.#notify();return clone(completed);
  }

  async processCurrentTurn({ mode = null } = {}) {
    if (this.processing) return this.processing;
    this.processing = this.#processCurrentTurn({ mode })
      .catch((error) => {
        this.errors.push({ at: Date.now(), message: String(error?.message ?? error) });
        this.#notify();
        throw error;
      })
      .finally(() => { this.processing = null; });
    return this.processing;
  }

  async #processCurrentTurn({ mode = null } = {}) {
    const context = this.getContext();
    const message = latestUserMessage(context);
    if (!message) throw new Error('No current SillyTavern user message is available');
    const chosenMode = mode ?? classifyDevelopmentDeploymentTurn(message.text);
    const key = clean(context.chatId) + ':' + message.index + ':' + shortHash(message.text) + ':' + chosenMode;
    if (this.processed.has(key)) return clone(this.processed.get(key));

    const evidence = await executeHostTurn(this.brain, context, message, { mode: chosenMode, inject: true });
    this.processed.set(key, evidence);
    this.turnEvidence.push(evidence);
    this.scenarios[chosenMode] = evidence;

    if (chosenMode === 'ambiguous') {
      const degradedBrain = new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: false });
      for (const lorebook of this.acceptedLorebooks.values()) degradedBrain.ingestLorebook(clone(lorebook));
      const degraded = await executeHostTurn(degradedBrain, context, message, { mode: 'ambiguous', inject: false });
      this.degraded = {
        ...degraded,
        evidenceClass: 'SIMULATED_FAILURE_PROBE',
        controlledFailure: 'JEV_UNAVAILABLE',
        safe: degraded.delivery.ok && degraded.cognition?.choice?.jev?.unavailable === true && degraded.cognition?.jev == null,
      };
    }

    this.#notify();
    return clone(evidence);
  }

  confirmOperatorReview({ promptInspectorConfirmed = true, uiTraceReviewed = true, liveSillyTavernConfirmed = false } = {}) {
    this.operatorReview = {
      promptInspectorConfirmed: Boolean(promptInspectorConfirmed),
      uiTraceReviewed: Boolean(uiTraceReviewed),
      liveSillyTavernConfirmed: Boolean(liveSillyTavernConfirmed),
      confirmedAt: Date.now(),
    };
    this.#notify();
    return this.exportEvidence();
  }

  exportEvidence() {
    const uiDiagnostics = this.uiHost?.diagnostics?.() ?? null;
    const modeCoverage = {
      simple: liveTurnReady(this.scenarios.simple),
      retrieval: liveTurnReady(this.scenarios.retrieval),
      ambiguous: liveTurnReady(this.scenarios.ambiguous),
    };
    const stories = storyCoverage(this.turnEvidence);
    const storyChatIds = stories.map((row) => row.chatId);
    const liveTurnChecks = {
      anyReadyTurn: this.turnEvidence.some(liveTurnReady),
      twoUnrelatedStories: stories.filter((row) => row.ready).length >= 2,
      promptDeliveryObserved: this.turnEvidence.some((row) => row.delivery?.promptInjection?.succeeded === true),
      sealedContextObserved: this.turnEvidence.some((row) => row.delivery?.sealVerified === true),
      genericScenePolicyObserved: this.turnEvidence.some((row) => row.scene?.extractionPolicy === 'GENERIC_HOST_EVIDENCE_ONLY'),
    };
    const executionReady = Object.values(liveTurnChecks).every(Boolean);
    const operatorReady = this.operatorReview.promptInspectorConfirmed
      && this.operatorReview.uiTraceReviewed
      && this.operatorReview.liveSillyTavernConfirmed;
    const operatorLiveChecksCaptured = executionReady
      && operatorReady
      && Boolean(uiDiagnostics?.mounted ?? this.uiHost);
    const latest = this.turnEvidence.at(-1) ?? null;
    const jevExecutions = this.turnEvidence.map((row) => row?.cognition?.jevExecution).filter(Boolean);
    const liveJevExecution = jevExecutions.find((row) => row.status === 'LIVE_PROVIDER' && row.providerProvenance?.measurementClass === 'MEASURED_LIVE') ?? null;
    const failedLiveJevExecution = [...jevExecutions].reverse().find((row) => row.status === 'LIVE_PROVIDER_FAILED_NATIVE_FALLBACK') ?? null;
    const latestJevExecution = latest?.cognition?.jevExecution ?? null;
    const capabilityEvidence = latest ? {
      sceneIntelligence: { status: latest.scene?.sceneId ? 'RUN' : 'UNAVAILABLE', reason: latest.scene?.reason ?? null },
      retrieval: { status: latest.mode === 'simple' ? 'SKIPPED' : latest.runtime?.jobs?.some((job) => job.taskType === 'LORE_RETRIEVAL') ? 'RUN' : 'UNAVAILABLE' },
      truth: { status: latest.cognition?.truth ? 'RUN' : 'UNAVAILABLE' },
      cognitiveChoice: { status: latest.cognition?.choice ? 'RUN' : 'UNAVAILABLE' },
      runtime: { status: latest.runtime?.jobCount > 0 ? 'RUN' : 'SKIPPED', resourceIds: latest.runtime?.resourceIds ?? [] },
      jev: latest.cognition?.jev
        ? latestJevExecution?.status === 'LIVE_PROVIDER'
          ? { status: 'RUN', reason: 'MEASURED_LIVE_PROVIDER', liveProvider: true, providerProvenance: clone(latestJevExecution.providerProvenance) }
          : latestJevExecution?.status === 'LIVE_PROVIDER_FAILED_NATIVE_FALLBACK'
            ? { status: 'DEGRADED', reason: 'LIVE_PROVIDER_FAILED_NATIVE_FALLBACK', liveProvider: false, failure: clone(latestJevExecution.failedLiveAttempt ?? latestJevExecution.failure ?? null) }
            : { status: 'FIXTURE', reason: 'DETERMINISTIC_LOCAL_JEV_NOT_REAL_PROVIDER', liveProvider: false }
        : { status: latest.mode === 'ambiguous' ? 'UNAVAILABLE' : 'SKIPPED', liveProvider: false },
      gather: { status: latest.cognition?.gather ? 'RUN' : 'UNAVAILABLE' },
      promptPlan: { status: latest.delivery?.promptInjection?.succeeded ? 'RUN' : 'UNAVAILABLE', promptPlanId: latest.delivery?.promptPlanId ?? null },
      memory: { status: 'SKIPPED', reason: 'NO_MEMORY_TASK_ADMITTED_IN_THIS_TURN' },
      forensics: { status: 'UNAVAILABLE', reason: 'NO_LIVE_OWNER_BINDING' },
      transactions: { status: 'UNAVAILABLE', reason: 'NO_LIVE_OWNER_BINDING' },
    } : null;

    const nativeContract=nativeBrainContract(this.nativeBrain),nativePrepared=this.nativeHistory.filter(row=>row.state==='SEALED_FOR_MODEL_REQUEST').length,nativeInjected=this.nativeHistory.filter(row=>row.state==='MODEL_REQUEST_PAYLOAD_INJECTED').length,nativeLearned=this.nativeHistory.filter(row=>row.state==='LEARNED').length;
    const installedUiBindings=this.#uiHostBindings(),installedUiReaderNames=Object.entries(installedUiBindings).filter(([name,value])=>typeof value==='function'&&(name.startsWith('read')||name.startsWith('list')||name.startsWith('reconstruct'))).map(([name])=>name).sort();
    const installedOptionalOwners={
      resources:Boolean(installedUiBindings.resourceHost??installedUiBindings.coprocessorResourceHost),
      loreStudy:Boolean(installedUiBindings.loreIntelligenceService??installedUiBindings.loreStudyService??installedUiBindings.loreOperatorHost??installedUiBindings.loreStudyHost),
      loreAuthoring:Boolean(installedUiBindings.loreAuthoringService??installedUiBindings.loreAuthoringHost??installedUiBindings.loreAuthoringOperator),
      memory:Boolean(installedUiBindings.memoryIntegrationSurface??installedUiBindings.memoryInterface??installedUiBindings.memoryOwner),
    };
    const nativeLearnedByChat={};for(const row of this.nativeHistory.filter(row=>row.state==='LEARNED'))nativeLearnedByChat[row.chatId]=(nativeLearnedByChat[row.chatId]??0)+1;
    const nativeMultiTurnChatIds=Object.entries(nativeLearnedByChat).filter(([,count])=>count>=2).map(([chatId])=>chatId);
    let loreOperatorEvidence=null,resourceOperatorEvidence=null,authoringOperatorEvidence=null,navigationEvidence=null;
    try{
      const loreAdapter=this.uiHost?.ui?.operator?.loreStudy,read=loreAdapter?.read?.(),selected=loreAdapter?.selectedLorebook?.()??{};
      loreOperatorEvidence={
        available:Boolean(loreAdapter),state:read?.source?.operationalState??read?.source?.health??null,
        counts:clone(read?.data?.operatorCounts??null),retrievalReady:Number(read?.data?.retrievalReady??0),
        selected:selected?.selection?.selected?{selected:true,lorebookId:selected.snapshot?.id??selected.selection?.lorebookId??null,title:selected.snapshot?.title??selected.selection?.title??null,entryCount:selected.snapshot?.entries?.length??selected.selection?.entryCount??null,discoveryKind:selected.snapshot?.discovery?.kind??null}:{selected:false,reason:selected?.selection?.reason??null},
      };
    }catch(error){loreOperatorEvidence={available:false,error:String(error?.code??error?.message??error)};}
    try{
      const resourceAdapter=this.uiHost?.ui?.operator?.resources,read=resourceAdapter?.read?.();
      resourceOperatorEvidence={available:Boolean(resourceAdapter),state:read?.source?.operationalState??null,resources:(read?.data?.resources??[]).map(row=>({id:row.id,kind:row.kind,state:row.state,health:row.health,connected:row.connected,callable:row.callable,modelId:row.modelId,capabilities:[...(row.capabilities??[])],measurementClass:row.measurementClass,lastTest:safeProviderOutcome(row.lastTest),lastFailure:safeProviderOutcome(row.lastFailure)}))};
    }catch(error){resourceOperatorEvidence={available:false,error:String(error?.code??error?.message??error)};}
    try{
      const authoring=this.uiHost?.ui?.operator?.loreAuthoring,snap=authoring?.snapshot?.();
      authoringOperatorEvidence={available:Boolean(authoring),capabilities:clone(snap?.capabilities??null),last:{discovery:operatorResultSummary(snap?.last?.discovery),edit:operatorResultSummary(snap?.last?.edit),tree:operatorResultSummary(snap?.last?.tree),merge:operatorResultSummary(snap?.last?.merge)}};
    }catch(error){authoringOperatorEvidence={available:false,error:String(error?.code??error?.message??error)};}
    try{navigationEvidence=clone(this.uiHost?.ui?.floatingController?.diagnostics?.()??null);}catch{}
    let functionTestObservations=null;
    try{
      const diag=this.uiHost?.ui?.operator?.diagnostics?.read?.()??null,stages=new Map((diag?.producers?.stages??[]).map(row=>[row.id,row]));
      const stageObserved=id=>['LIVE','WORKING','IDLE'].includes(String(stages.get(id)?.state??''));
      const measured=(diag?.resources?.rows??[]).filter(row=>row.callable&&row.measurementClass==='MEASURED_LIVE');
      functionTestObservations={
        acceptanceAuthority:false,
        FT177:{status:stageObserved('scene')&&Boolean(diag?.pipeline?.executionReceipt)&&Boolean(diag?.pipeline?.admissionReceipt)?'OBSERVED':'PENDING',source:'Scene owner → Runtime execution → Context Seal',scene:stages.get('scene')?.state??'UNAVAILABLE',executionReceipt:Boolean(diag?.pipeline?.executionReceipt),sealReceipt:Boolean(diag?.pipeline?.admissionReceipt)},
        FT178:{status:stageObserved('memory')&&Boolean(diag?.memory?.retrievalStatus)&&Boolean(diag?.pipeline?.admissionReceipt)?'OBSERVED':'PENDING',source:'Memory owner → retrieval → Context Seal',memory:stages.get('memory')?.state??'UNAVAILABLE',retrievalStatus:diag?.memory?.retrievalStatus??null,sealReceipt:Boolean(diag?.pipeline?.admissionReceipt)},
        FT179:{status:Number(diag?.lore?.retrievalReady??0)>0&&stageObserved('truth')&&Boolean(diag?.pipeline?.admissionReceipt)?'OBSERVED':'PENDING',source:'Lore owner → Truth → Context Seal',retrievalReady:Number(diag?.lore?.retrievalReady??0),truth:stages.get('truth')?.state??'UNAVAILABLE',sealReceipt:Boolean(diag?.pipeline?.admissionReceipt)},
        FT180:{status:measured.some(row=>row.lastExecution?.status==='SUCCESS')?'OBSERVED':'PENDING',source:'Measured-live provider routing',callableMeasuredResources:measured.length,successfulExecutions:measured.filter(row=>row.lastExecution?.status==='SUCCESS').length,failedResources:(diag?.resources?.rows??[]).filter(row=>row.lastFailure).length},
      };
    }catch{}
    return clone({
      kind: 'DevelopmentDeploymentLiveDemoEvidence',
      contractVersion: DEVELOPMENT_DEPLOYMENT_LIVE_CONTRACT_VERSION,
      status: operatorLiveChecksCaptured ? 'DIRECTOR_REVIEW_PENDING' : executionReady ? 'OPERATOR_CONFIRMATION_PENDING' : 'LIVE_DEMO_PENDING',
      issue: 224,
      issue224AutomaticPass: false,
      directorApprovalRequired: true,
      oneResource: true,
      externalDatabaseRequired: false,
      externalOrchestrationRequired: false,
      remoteProviderRequired: false,
      scenarios: this.scenarios,
      turns: this.turnEvidence,
      storyChatIds,
      twoStoryCoverage: storyChatIds.length >= 2,
      loreIngestion: this.loreIngestion,
      degraded: this.degraded,
      checks: liveTurnChecks,
      modeCoverage,
      storyCoverage: stories,
      deterministicFixtureEvidence: {
        modeCoverage,
        simulatedJevFailureSafe: Boolean(this.degraded?.safe),
        acceptanceAuthority: false,
      },
      capabilityEvidence,
      providerEvidence: {
        jev: liveJevExecution ? 'MEASURED_LIVE_PROVIDER' : 'DETERMINISTIC_LOCAL_FIXTURE',
        realProviderCallObserved: Boolean(liveJevExecution),
        ft005LivePass: Boolean(liveJevExecution),
        liveProviderProvenance: clone(liveJevExecution?.providerProvenance ?? null),
        failedLiveAttempt: clone(failedLiveJevExecution ?? null),
      },
      loreStatus: clone(this.brain.readLoreStatus?.() ?? null),
      operatorReview: this.operatorReview,
      operatorLiveChecksCaptured,
      ui: uiDiagnostics,
      hostNarrativeFeed:{
        eventCount:this.hostNarrativeEvents.length,
        events:clone(this.hostNarrativeEvents.slice(-100)),
        rawTextCaptured:false,
        revisionMutationEvents:this.hostNarrativeEvents.filter(row=>row.revisionAffecting).length,
        chatBoundaryEvents:this.hostNarrativeEvents.filter(row=>row.chatBoundary).length,
      },
      nativeBrainIntegration:{
        ownerAvailable:nativeContract.available,reason:nativeContract.reason??null,preparedCount:nativePrepared,requestPayloadInjectedCount:nativeInjected,learnedCount:nativeLearned,
        installedUiReaderNames,installedOptionalOwners,
        pendingCount:this.nativePending.size,staleOrForeignCompletionRejected:this.nativeRejections.length,
        ownerKnowledgeAttachments:clone(this.nativeOwnerAttachments),loreRevisionInvalidations:clone(this.nativeLoreRevisionEvents),
        persistence:{configured:Boolean(this.persistNativeBrain),last:clone(this.nativePersistence.at(-1)??null),persistedCount:this.nativePersistence.filter(x=>x.status==='PERSISTED').length},
        learnedByChat:clone(nativeLearnedByChat),multiTurnObserved:nativeMultiTurnChatIds.length>0,multiTurnChatIds:nativeMultiTurnChatIds,
        exactPreparedRenderedObserved:nativeInjected>0,endToEndObserved:nativePrepared>0&&nativeInjected>0&&nativeLearned>0,last:this.nativeHistory.at(-1)??null,rejections:clone(this.nativeRejections),
        rawPromptCaptured:false,rawResponseCaptured:false,
      },
      uiProducerDiagnosticsAreRegistrationOnly: !nativeContract.available,
      loreOperatorEvidence,
      resourceOperatorEvidence,
      authoringOperatorEvidence,
      navigationEvidence,
      functionTestObservations,

      errors: this.errors,
      liveEvidenceComplete: false,
      liveEvidenceCompleteReason: 'DIRECTOR_APPROVAL_AND_REQUIRED_LIVE_GATES_REMAIN_EXTERNAL_TO_THIS_RECORD',
    });
  }

  destroy() {
    this.stop();
    if(this.nativePending.size)this.#expireNativePending('SESSION_DESTROYED');
    this.uiHost?.destroy?.();
    this.uiHost = null;
    this.releaseLoreOwnerEvents?.();
    this.releaseLoreOwnerEvents = null;
  }

  async #persistNativeBrainCheckpoint({chatId,turnId,generationId}={}){
    if(!this.persistNativeBrain||typeof this.nativeBrain?.snapshot!=='function'){
      const row={at:Date.now(),chatId,turnId,generationId,status:'NOT_CONFIGURED'};this.nativePersistence.push(row);if(this.nativePersistence.length>100)this.nativePersistence.shift();return row;
    }
    try{
      const snapshot=this.nativeBrain.snapshot();
      await this.persistNativeBrain({chatId,turnId,generationId,snapshot});
      const row={at:Date.now(),chatId,turnId,generationId,status:'PERSISTED'};this.nativePersistence.push(row);if(this.nativePersistence.length>100)this.nativePersistence.shift();return row;
    }catch(error){
      const row={at:Date.now(),chatId,turnId,generationId,status:'FAILED',reason:String(error?.code??error?.message??error)};this.nativePersistence.push(row);if(this.nativePersistence.length>100)this.nativePersistence.shift();return row;
    }
  }

  #attachNativeKnowledgeOwners(){
    if(!this.nativeBrain)return;
    const brainBindings=typeof this.brain?.hostBindings==='function'?this.brain.hostBindings():{};
    const mergedOwners={...brainBindings,...this.ownerBindings};
    const loreService=mergedOwners.loreIntelligenceService??mergedOwners.loreStudyService??null;
    const loreInterface=mergedOwners.loreBrainInterface??(typeof loreService?.brainInterface==='function'?loreService.brainInterface():null);
    const memoryInterface=mergedOwners.memoryIntegrationSurface??mergedOwners.memoryInterface??mergedOwners.memoryOwner??null;
    const graphProviders=Array.isArray(mergedOwners.graphProviders)?mergedOwners.graphProviders.filter(Boolean):[];

    if(typeof this.nativeBrain.attachLoreInterface==='function'){
      try{const receipt=this.nativeBrain.attachLoreInterface(loreInterface??null);this.nativeOwnerAttachments.lore={attached:Boolean(receipt?.attached),contractVersion:receipt?.contractVersion??loreInterface?.contractVersion??null};}
      catch(error){this.nativeOwnerAttachments.lore={attached:false,error:String(error?.code??error?.message??error)};}
    }
    if(typeof this.nativeBrain.attachMemoryInterface==='function'){
      try{const receipt=this.nativeBrain.attachMemoryInterface(memoryInterface??null);this.nativeOwnerAttachments.memory={attached:Boolean(receipt?.attached),contractVersion:receipt?.contractVersion??memoryInterface?.contractVersion??null};}
      catch(error){this.nativeOwnerAttachments.memory={attached:false,error:String(error?.code??error?.message??error)};}
    }

    const graphReceipts=[];
    if(typeof this.nativeBrain.unregisterGraphProvider==='function'){
      for(const providerId of this.nativeGraphProviderIds){
        try{this.nativeBrain.unregisterGraphProvider(providerId);}catch{}
      }
    }
    this.nativeGraphProviderIds.clear();
    if(typeof this.nativeBrain.registerGraphProvider==='function'){
      for(const provider of graphProviders){
        const providerId=String(provider?.providerId??'');
        if(!providerId||typeof provider?.query!=='function')continue;
        try{
          const receipt=this.nativeBrain.registerGraphProvider(provider);
          this.nativeGraphProviderIds.add(providerId);
          graphReceipts.push({providerId,attached:true,owner:provider.owner??null,semanticsVersion:provider.semanticsVersion??null,receipt:clone(receipt??null)});
        }catch(error){
          graphReceipts.push({providerId,attached:false,owner:provider.owner??null,error:String(error?.code??error?.message??error)});
        }
      }
    }
    this.nativeOwnerAttachments.graphProviders=graphReceipts;

    this.releaseLoreOwnerEvents?.();
    this.releaseLoreOwnerEvents=null;
    if(typeof brainBindings.subscribe==='function'){
      this.releaseLoreOwnerEvents=brainBindings.subscribe((event)=>{
        if(event?.type!=='LORE_AUTHORING_SETTLEMENT')return;
        this.#routeLoreRevisionEvents(event?.result);
        this.#notify();
      });
    }
  }

  #decorateSillyTavernResourceHost(host){
    if(!host?.actions||!host?.read)return host;
    const getContext=()=>this.getContext(),session=this;
    const decorateConfig=(config={})=>{
      const role=clean(config.role??config.resourceRole).toUpperCase(),caps=[...(config.capabilities??[])].map(String);
      const jev=role==='JEV'||caps.includes('SEMANTIC_JUDGMENT');
      if(!jev||config.apiKey)return config;
      const context=getContext();
      if(!isSillyTavernOpenRouterRoute(context,config))return config;
      const resourceId=clean(config.resourceId)||('jev:'+clean(config.displayName??'primary-jev').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''));
      const providerId=clean(config.providerId)||('provider:'+resourceId),modelId=clean(config.modelId);
      const adapter=createSillyTavernActiveOpenRouterAdapter({getContext,providerId,modelId,capabilities:caps});
      session.hostManagedResourceProfiles.set(resourceId,{source:'SILLYTAVERN_ACTIVE_SECRET',name:'SillyTavern active OpenRouter secret'});
      return{...config,resourceId,providerId,modelId,adapter,credentialRequired:false,credentialManagedByHost:true,hostCredentialSource:'SILLYTAVERN_ACTIVE_SECRET',
        connectionProfileName:'SillyTavern active OpenRouter secret',profileMetadata:{...(config.profileMetadata??{}),credentialOwner:'SILLYTAVERN_ACTIVE_SECRET'}};
    };
    const decorateRow=(row)=>{
      if(!row||typeof row!=='object')return row;
      const meta=session.hostManagedResourceProfiles.get(clean(row.resourceId));
      return meta?{...clone(row),credentialManagedByHost:true,hostCredentialSource:meta.source,connectionProfileName:meta.name}:clone(row);
    };
    const actions=Object.freeze({...host.actions,addResource:(config)=>decorateRow(host.actions.addResource(decorateConfig(config)))});
    const read=Object.freeze({
      ...host.read,
      resources:()=>{const raw=host.read.resources();return raw&&Array.isArray(raw.resources)?{...clone(raw),resources:raw.resources.map(decorateRow)}:raw;},
      resource:(resourceId)=>decorateRow(host.read.resource(resourceId)),
    });
    return Object.freeze({...host,actions,read});
  }

  #uiHostBindings(){
    const brainBindings=typeof this.brain?.hostBindings==='function'?this.brain.hostBindings():{};
    const base={...brainBindings,...this.ownerBindings},contract=nativeBrainContract(this.nativeBrain);
    const rawResourceHost=base.resourceHost??base.coprocessorResourceHost??null,hostResourceBridge=this.#decorateSillyTavernResourceHost(rawResourceHost);
    if(hostResourceBridge){
      base.resourceHost=hostResourceBridge;base.coprocessorResourceHost=hostResourceBridge;
      base.addResource=(config)=>hostResourceBridge.actions.addResource(config);
      base.listResources=()=>hostResourceBridge.read.resources();
      base.listResourceProfiles=()=>hostResourceBridge.read.resources();
    }
    base.readNativeBrainHostLifecycle=()=>({kind:'NativeBrainHostLifecycle',ownerAvailable:contract.available,reason:contract.reason??null,pending:this.nativePending.size,prepared:this.nativeHistory.filter(x=>x.state==='SEALED_FOR_MODEL_REQUEST').length,requestPayloadInjected:this.nativeHistory.filter(x=>x.state==='MODEL_REQUEST_PAYLOAD_INJECTED').length,learned:this.nativeHistory.filter(x=>x.state==='LEARNED').length,rejected:this.nativeRejections.length});
    if(!contract.available)return base;
    const native=this.nativeBrain.uiBindings();
    const nativeKeys=['readSelection','readScene','readHotCognition','readCognitiveChoice','readScatter','readSensoryTrace','readCandidateBusEnvelope','readCandidateFusionReceipt','readIdentityResolution','readGraphTraversal','readRetrievalBudget','readRejectedEvidence','readTruth','readCorrectiveRetrieval','readJev','readPrecision','readGather','readContextSeal','readLoreStatus','readMemoryStatus','readRuntimeStatus','readPromptPlan','readContextReceipt','listGenerations','readGeneration'];
    const merged={...base};

    const resourceHost=merged.resourceHost??merged.coprocessorResourceHost??null;
    const resourceContractAvailable=Boolean(
      resourceHost
      &&((typeof resourceHost?.read?.resources==='function')||(typeof merged.listResources==='function'))
      &&(typeof resourceHost?.actions?.addResource==='function'||typeof merged.addResource==='function')
      &&(typeof resourceHost?.actions?.connectResource==='function'||typeof merged.connectResource==='function')
    );
    if(!resourceContractAvailable){
      for(const key of ['resourceHost','coprocessorResourceHost','coprocessorTelemetry','listResources','listResourceProfiles','addResource','connectResource','disconnectResource','testResource'])delete merged[key];
    }

    const loreStudyHost=merged.loreStudyHost??merged.loreOperatorHost??merged.loreHost??null;
    const loreStudyContractAvailable=Boolean(
      loreStudyHost
      &&(typeof loreStudyHost?.actions?.acceptLorebook==='function'||typeof merged.acceptLorebook==='function')
      &&(typeof loreStudyHost?.actions?.runLoreStudy==='function'||typeof merged.runLoreStudy==='function')
    );
    if(!loreStudyContractAvailable){
      for(const key of ['loreStudyHost','loreOperatorHost','loreHost','acceptLorebook','runLoreStudy'])delete merged[key];
    }

    const authoringHost=this.#nativeAwareLoreAuthoringHost();
    if(authoringHost)merged.loreAuthoringHost=authoringHost;
    else{
      delete merged.loreAuthoringHost;delete merged.loreAuthoringOperator;
    }
    for(const key of nativeKeys)if(typeof native?.[key]==='function')merged[key]=native[key];
    const baseSubscribe=base.subscribe,nativeSubscribe=native?.subscribe;
    merged.subscribe=(listener)=>{const releases=[];if(typeof baseSubscribe==='function')releases.push(baseSubscribe(listener));if(typeof nativeSubscribe==='function')releases.push(nativeSubscribe(listener));return()=>{for(const release of releases)try{release?.();}catch{}};};
    merged.readNativeBrainHostLifecycle=base.readNativeBrainHostLifecycle;
    return merged;
  }

  #nativeAwareLoreAuthoringHost(){
    if(!this.nativeBrain)return null;
    const brainBindings=typeof this.brain?.hostBindings==='function'?this.brain.hostBindings():{};
    const mergedOwners={...brainBindings,...this.ownerBindings};
    let host=mergedOwners.loreAuthoringHost??mergedOwners.loreAuthoringOperator??null;
    if(!host&&typeof mergedOwners.loreAuthoringService?.operatorContract==='function'){
      try{host=mergedOwners.loreAuthoringService.operatorContract();}catch{return null;}
    }
    if(!host?.actions||!host?.read)return null;
    const requiredActions=['computeFinalPreview','approveFinalPreview','applySettlement','restoreSettlement'];
    if(!requiredActions.every(name=>typeof host.actions?.[name]==='function'))return null;
    const actions={...host.actions};
    for(const name of ['applySettlement','restoreSettlement']){
      const original=host.actions[name];
      actions[name]=(...args)=>{
        const result=original(...args);
        if(result&&typeof result.then==='function')return result.then(value=>{this.#routeLoreRevisionEvents(value);return value;});
        this.#routeLoreRevisionEvents(result);return result;
      };
    }
    return Object.freeze({...host,actions:Object.freeze(actions)});
  }

  #routeLoreRevisionEvents(result){
    if(!this.nativeBrain||typeof this.nativeBrain.acceptLoreRevisionChange!=='function')return;
    const value=result?.ok===true?result.value??null:result;
    if(!value||typeof value!=='object')return;
    const events=[...(value.acceptedRevisionEvents??[]),...(value.revisionEvents??[]),...(value.worker1?.revisionEvents??[]),...(value.restoration?.revisionEvents??[])];
    for(const event of events){
      if(!event?.sourceId||!event?.sourceRevisionId)continue;
      const key=[event.settlementId??value.settlementId??'',event.sourceId,event.previousSourceRevisionId??'',event.sourceRevisionId,event.restoration?'RESTORE':'APPLY'].join('|');
      if(this.routedLoreRevisionKeys.has(key))continue;
      try{this.acceptLoreRevisionChange(event);this.routedLoreRevisionKeys.add(key);}
      catch(error){this.errors.push({at:Date.now(),message:String(error?.message??error),stage:'LORE_REVISION_INVALIDATION_ROUTE',sourceId:event.sourceId,sourceRevisionId:event.sourceRevisionId});}
    }
  }

  #recordHostNarrativeEvent(type,args=[]){
    let context=null;try{context=this.getContext();}catch{}
    const eventType=String(type),revisionAffecting=['MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','MESSAGE_SWIPE_DELETED'].includes(eventType);
    const chatBoundary=['CHAT_CHANGED','CHAT_LOADED','CHAT_CREATED','CHAT_RENAMED'].includes(eventType);
    const generationBoundary=['GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED'].includes(eventType);
    const rawIndex=(args??[]).find(value=>Number.isInteger(Number(value)))??null,messageIndex=rawIndex==null?null:Number(rawIndex);
    const chatId=clean(context?.chatId)||null,chat=Array.isArray(context?.chat)?context.chat:[],message=messageIndex==null?null:chat[messageIndex]??null;
    const messageKey=messageIndex==null?null:clean(message?.mesId??message?.message_id??message?.id??messageIndex)||String(messageIndex);
    const messageText=message==null?'':clean(message?.mes??message?.content??message?.text),messageDigest=messageText?shortHash(messageText):null;
    const pending=chatId?this.nativePending.get(chatId)??null:null;
    const row={
      kind:'SillyTavernNarrativeHostEvent',contractVersion:2,sequence:++this.hostEventSequence,type:eventType,
      eventId:'st-host:'+this.hostEventSequence+':'+shortHash([chatId??'no-chat',eventType,messageKey??'no-message',messageDigest??'no-digest'].join('|')),
      chatId,messageIndex,messageId:messageKey,messageRevisionId:messageKey&&messageDigest?messageKey+':'+messageDigest:null,messageDigest,
      role:message?(message.is_user===true||message.role==='user'?'user':'assistant'):null,
      turnId:pending?.turnId??null,generationId:pending?.generationId??null,
      revisionAffecting,chatBoundary,generationBoundary,worldInfo:eventType.startsWith('WORLDINFO_'),at:Date.now(),
      rawTextIncluded:false,rawPayloadIncluded:false,
    };
    this.hostNarrativeEvents.push(row);if(this.hostNarrativeEvents.length>200)this.hostNarrativeEvents.shift();
    if(this.nativePending.size&&(revisionAffecting||chatBoundary))this.#expireNativePending('HOST_'+eventType+'_INVALIDATED_PENDING_GENERATION');
    this.#notify();return clone(row);
  }

  #beginOptionalGeneration(pending){
    const brainBindings=typeof this.brain?.hostBindings==='function'?this.brain.hostBindings():{};
    const merged={...brainBindings,...this.ownerBindings};
    if(typeof merged.beginOptionalResourceGeneration!=='function')return null;
    const key=String(pending?.generationId??pending?.turnId??'');
    if(!key||this.optionalGenerationActive.has(key))return this.optionalGenerationActive.get(key)??null;
    try{
      const result=merged.beginOptionalResourceGeneration({chatId:pending.chatId,turnId:pending.turnId,generationId:pending.generationId,correlationId:pending.correlationId??null});
      this.optionalGenerationActive.set(key,{pending:clone(pending),startedAt:Date.now(),result:clone(result??null)});
      return result;
    }catch(error){
      this.errors.push({at:Date.now(),message:String(error?.code??error?.message??error),stage:'OPTIONAL_RESOURCE_GENERATION_BEGIN',turnId:pending?.turnId??null,generationId:pending?.generationId??null});
      return null;
    }
  }

  #completeOptionalGeneration(pending,reason='GENERATION_COMPLETED'){
    const brainBindings=typeof this.brain?.hostBindings==='function'?this.brain.hostBindings():{};
    const merged={...brainBindings,...this.ownerBindings};
    const key=String(pending?.generationId??pending?.turnId??'');
    if(!key||!this.optionalGenerationActive.has(key))return null;
    this.optionalGenerationActive.delete(key);
    if(typeof merged.completeOptionalResourceGeneration!=='function')return null;
    try{
      return merged.completeOptionalResourceGeneration({chatId:pending?.chatId??null,turnId:pending?.turnId??null,generationId:pending?.generationId??null,reason});
    }catch(error){
      this.errors.push({at:Date.now(),message:String(error?.code??error?.message??error),stage:'OPTIONAL_RESOURCE_GENERATION_COMPLETE',turnId:pending?.turnId??null,generationId:pending?.generationId??null});
      return null;
    }
  }

  #completeAllOptionalGenerations(reason='SESSION_STOPPED'){
    for(const row of [...this.optionalGenerationActive.values()])this.#completeOptionalGeneration(row.pending,reason);
  }

  #expireNativePending(reason){
    for(const [chatId,row] of [...this.nativePending.entries()]){
      this.nativeRejections.push({at:Date.now(),code:String(reason),chatId,generationId:row.generationId,turnId:row.turnId});
      const run=this.nativeRuns.get(chatId);try{run?.responseReject?.(new Error(String(reason)));}catch{}
      this.#completeOptionalGeneration(row,String(reason));
      this.nativePending.delete(chatId);this.nativePayloads.delete(chatId);this.nativeRuns.delete(chatId);
    }
    while(this.nativeRejections.length>100)this.nativeRejections.shift();this.#notify();
  }

  #notify() {
    this.onEvidence?.(this.exportEvidence());
  }
}

export function createDevelopmentDeploymentSillyTavernSession(options) {
  return new DevelopmentDeploymentSillyTavernSession(options);
}
