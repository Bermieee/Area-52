import { CastPresence, ObservationClass, createFieldState } from '../scene/contracts.js';
import { HostActivity, SceneRelationship } from '../scene/lifecycle-contracts.js';
import { scenePrefetchIntentsFromNarrative } from '../scene/prefetch-trigger.js';
import { packBrainSnapshot, unpackBrainSnapshot } from './brain-snapshot-parts.js';
import { DevelopmentDeploymentBrain } from './brain.js';
import { mountWave12SillyTavernInterface } from '../ui-core/index.js';
import {
  createOpenRouterJevDecisionAdapter,
  isOpenRouterJevDecisionConfig,
  normalizeOpenRouterDecisionsEndpoint,
  normalizeOpenRouterJevModel,
  DEFAULT_OPENROUTER_JEV_MODEL,
} from '../coprocessor/openrouter-jev-decisions.js';

export const DEVELOPMENT_DEPLOYMENT_PROMPT_ID = 'area52-development-deployment';
export const DEVELOPMENT_DEPLOYMENT_LIVE_CONTRACT_VERSION = '1.4.0';

const clone = (value) => value == null ? value : structuredClone(value);
const clean = (value) => String(value ?? '').trim();
const EXCLUDED_HOST_GENERATION_TYPES=Object.freeze(new Set(['quiet','impersonate']));
const SESSION_BOUNDS=Object.freeze({turnEvidence:32,processed:32,loreIngestion:32,errors:64,nativePerformance:12});
const pushBounded=(list,value,limit)=>{list.push(value);if(list.length>limit)list.splice(0,list.length-limit);return value;};
const safeDiagnosticMessage=(error)=>{
  let value=String(error?.code??error?.message??error??'UNKNOWN_ERROR');
  value=value.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi,'Bearer [redacted]').replace(/sk-[A-Za-z0-9_-]{8,}/gi,'[redacted-key]').replace(/(api[_-]?key|authorization|credential|secret|token)\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]');
  return value.slice(0,512);
};
const perfNow=()=>Number(globalThis.performance?.now?.()??Date.now());
const utf8Bytes=(value)=>{const text=String(value??'');if(typeof TextEncoder==='function')return new TextEncoder().encode(text).length;return unescape(encodeURIComponent(text)).length;};

export function createJevDecisionResourceHostBridge(host,{fetchImpl=globalThis.fetch}={}){
  if(!host?.actions||!host?.read)return host;
  const isJev=(config={})=>isOpenRouterJevDecisionConfig(config);
  const decorateConfig=(config={})=>{
    if(!isJev(config))return config;
    const endpoint=normalizeOpenRouterDecisionsEndpoint(config.endpoint);
    const modelId=normalizeOpenRouterJevModel(config.modelId??DEFAULT_OPENROUTER_JEV_MODEL);
    const providerId=clean(config.providerId)||('provider:'+clean(config.resourceId??'jev:primary'));
    const capabilities=[...new Set((config.capabilities??['SEMANTIC_JUDGMENT']).map(String))];
    const adapter=createOpenRouterJevDecisionAdapter({
      providerId,modelId,endpoint,apiKey:config.apiKey??null,fetchImpl,
      timeoutMs:Number(config.timeoutMs??config.healthTimeoutMs??10000)||10000,
      capabilities,measurementClass:config.measurementClass??'MEASURED_LIVE',
    });
    return{
      ...config,endpoint,modelId,providerId,adapter,
      credentialRequired:true,transportMode:'DECISIONS',structuredOutputSupport:true,
      profileMetadata:{...(config.profileMetadata??{}),decisionProtocol:'alpha/decisions',credentialOwner:'AREA52_SESSION_MEMORY'},
    };
  };
  const actions=Object.freeze({
    ...host.actions,
    addResource:(config)=>host.actions.addResource(decorateConfig(config)),
    discoverModels:(config,opts)=>{
      if(!isJev(config))return host.actions.discoverModels(config,opts);
      const modelId=normalizeOpenRouterJevModel(config.modelId??DEFAULT_OPENROUTER_JEV_MODEL);
      return Object.freeze({
        kind:'ResourceModelDiscoveryResult',state:'READY',
        models:Object.freeze([{id:modelId,displayName:modelId,capabilities:Object.freeze(['SEMANTIC_JUDGMENT'])}]),
        manualModelEntryAllowed:true,reasonCode:'MODEL_DISCOVERY_READY',
        reason:'Jev uses the dedicated OpenRouter Decisions transport; the configured Decision model will be qualified by a real typed Decisions call.',
        endpoint:normalizeOpenRouterDecisionsEndpoint(config.endpoint),transportMode:'DECISIONS',
        credentialConfigured:Boolean(config.apiKey),credentialStorage:'SESSION_MEMORY_ONLY',
      });
    },
  });
  return Object.freeze({...host,actions});
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

function sceneUiReadModelForSelection(sceneRuntime,selection={}){
  const chatId=clean(selection?.chatId);if(!chatId||typeof sceneRuntime?.uiReadModel!=='function')return null;
  const model=sceneRuntime.uiReadModel(chatId);if(!model||model.kind!=='SceneUiReadModel')return null;
  if(selection?.sceneRevision!=null&&Number(model.revision)!==Number(selection.sceneRevision))return null;
  const expectedRefs=new Set((selection?.sourceRevisionRefs??[]).map(String));
  if(expectedRefs.size&&(model.sourceRevisionRefs??[]).some(ref=>!expectedRefs.has(String(ref))))return null;
  return{
    ...clone(model),chatId,
    turnId:selection?.turnId??null,generationId:selection?.generationId??null,correlationId:selection?.correlationId??null,
  };
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

const ATMOSPHERE_CUES=Object.freeze({
  tension:{pattern:/\b(?:tense|tension|strained|on edge|standoff)\b/i,novelPattern:/\b(?:confronts?|corners?|draws? (?:a |the )?(?:blade|gun|weapon)|weapons? (?:are )?drawn)\b/i,score:.78,confidence:.82},
  danger:{pattern:/\b(?:danger|dangerous|threat|threatening|peril|unsafe|attacks?|charges?|explodes?)\b/i,novelPattern:/\b(?:attacks?|charges?|threatens?|explodes?|weapon(?:s)? (?:is|are) drawn|blade flashes)\b/i,score:.82,confidence:.86},
  intimacy:{pattern:/\b(?:intimate|intimacy|tender|tenderness|affectionate|affection|kisses?|embraces?|hugs?)\b/i,novelPattern:/\b(?:kisses?|embraces?|hugs?|holds? (?:him|her|them|each other) close)\b/i,score:.72,confidence:.78},
  urgency:{pattern:/\b(?:urgent|urgency|hurry|hurried|immediately|no time to lose|deadline|countdown)\b/i,novelPattern:/\b(?:deadline|countdown|before it is too late|must (?:leave|go|escape) now|races? against time)\b/i,score:.82,confidence:.86},
  uncertainty:{pattern:/\b(?:uncertain|uncertainty|unsure|unclear|ambiguous|cannot see|can't see)\b/i,novelPattern:/\b(?:loses? sight of|searches? blindly|cannot see|can't see|does not know whether)\b/i,score:.70,confidence:.80},
  humor:{pattern:/\b(?:humor|humorous|joke|jokes|joked|laugh|laughs|laughed|laughter|chuckles?|amused)\b/i,novelPattern:/\b(?:laughs?|laughed|laughing|chuckles?|jokes?|joked)\b/i,score:.68,confidence:.78},
  grief:{pattern:/\b(?:grief|grieving|grieve|mourn|mourns|mourning|sorrow|sorrowful|weeps?|sobs?)\b/i,novelPattern:/\b(?:mourns?|mourned|weeps?|wept|sobs?|sobbed|funeral)\b/i,score:.82,confidence:.86},
  hostility:{pattern:/\b(?:hostile|hostility|snarl|snarls|threatens?|menacing|attacks?|glares?)\b/i,novelPattern:/\b(?:glares?|snarls?|threatens?|attacks?|swings? at|lunges? at)\b/i,score:.82,confidence:.86},
});
function extractAtmosphereDimensions(raw,evidenceRef){
  const dimensions={};
  for(const [name,cue] of Object.entries(ATMOSPHERE_CUES)){
    if(!cue.pattern.test(raw))continue;
    dimensions[name]={score:cue.score,confidence:cue.confidence,evidenceRefs:[evidenceRef],novelNarrativeEvidence:Boolean(cue.novelPattern?.test(raw))};
  }
  return dimensions;
}

export function extractDevelopmentDeploymentScene(text, { revision, evidenceRef, currentScene = null, sceneRuntime = null } = {}) {
  const raw = clean(text);
  const fields = {};
  const priorLocation = clean(currentScene?.fields?.location?.value?.location ?? currentScene?.fields?.location?.value);
  const priorCast = Array.isArray(currentScene?.fields?.activeCast?.value) ? clone(currentScene.fields.activeCast.value) : [];
  const cast = new Map(priorCast.filter((row)=>row?.characterId).map((row)=>[String(row.characterId),{...clone(row)}]));
  let castChanged = false;
  const boundarySignals = {};
  let relationship = null;
  let resumeSceneId = null;
  const prefetchIntents=scenePrefetchIntentsFromNarrative(raw);

  // Clear location evidence is an explicit travel/arrival phrase or a clause-initial preposition
  // ("At North Gallery, ..."). A preposition in the middle of a clause ("looks at Kael", "sits near
  // Tomas") is as likely to name a person or object, so it is only weak, INFERRED evidence and never
  // pre-empts semantic extraction.
  const locationName = String.raw`([\p{Lu}][\p{L}\p{N}'’_-]*(?:\s+(?:[\p{Lu}][\p{L}\p{N}'’_-]*|of|the|and)){0,4})`;
  const prepositionMatch = raw.match(new RegExp(String.raw`\b(?:[Aa]t|[Ii]nside|[Ww]ithin|[Oo]utside|[Nn]ear)\s+(?:the\s+)?` + locationName, 'u'));
  const travelMatch = raw.match(new RegExp(String.raw`\b(?:arrive(?:s|d)?|reach(?:es|ed)?|travel(?:s|ed)?|move(?:s|d)?|return(?:s|ed)?)\s+(?:at|in|inside|to)\s+(?:the\s+)?` + locationName, 'u'));
  const clauseInitial = prepositionMatch ? /(?:^|[.!?"”\n]\s*|[,;]\s*)$/.test(raw.slice(0, prepositionMatch.index)) : false;
  const locationMatch = clauseInitial ? prepositionMatch : (travelMatch ?? prepositionMatch);
  const locationIsClear = clauseInitial || Boolean(travelMatch);
  const TIME_OF_DAY = /^(?:dawn|dusk|noon|midnight|morning|evening|night|nightfall|daybreak|sunrise|sunset|twilight)$/i;
  let location = null;
  if (locationMatch?.[1]) {
    location = locationMatch[1].replace(/[.,!?;:]+$/, '').replace(/(?:\s+(?:and|of|the))+$/i, '').trim();
    if (location && !TIME_OF_DAY.test(location)) {
      fields.location = locationIsClear ? sceneField({ location }, revision, evidenceRef) : sceneField({ location }, revision, evidenceRef, ObservationClass.INFERRED, 0.5);
    } else location = null;
  }

  const person = String.raw`[\p{Lu}][\p{L}\p{N}'’_-]*(?:\s+[\p{Lu}][\p{L}\p{N}'’_-]*)?`;
  const enterRe = new RegExp(`\\b(${person})\\s+(?:enters?|entered|arrives?|arrived|joins?|joined|steps? in|walks? in)\\b`,'gu');
  const leaveRe = new RegExp(`\\b(${person})\\s+(?:leaves?|left|exits?|exited|departs?|departed|walks? out|steps? out)\\b`,'gu');
  const mentionRe = new RegExp(`\\b(?:mentions?|mentioned|talks? about|asks? about|references?|referenced)\\s+(${person})\\b`,'gu');
  for (const match of raw.matchAll(enterRe)) {
    const characterId=match[1].trim();cast.set(characterId,{characterId,state:CastPresence.PRESENT,evidenceRefs:[evidenceRef]});castChanged=true;
  }
  for (const match of raw.matchAll(leaveRe)) {
    const characterId=match[1].trim();cast.set(characterId,{characterId,state:CastPresence.DEPARTED,evidenceRefs:[evidenceRef]});castChanged=true;
  }
  for (const match of raw.matchAll(mentionRe)) {
    const characterId=match[1].trim();
    if (!cast.has(characterId) || cast.get(characterId)?.state!==CastPresence.PRESENT) {
      cast.set(characterId,{characterId,state:CastPresence.MENTIONED_ONLY,evidenceRefs:[evidenceRef]});castChanged=true;
    }
  }
  if (castChanged) fields.activeCast = sceneField([...cast.values()], revision, evidenceRef);

  const atmosphereDimensions=extractAtmosphereDimensions(raw,evidenceRef);
  if(Object.keys(atmosphereDimensions).length)fields.atmosphere=sceneField(atmosphereDimensions,revision,evidenceRef,ObservationClass.INFERRED,Math.min(...Object.values(atmosphereDimensions).map((row)=>row.confidence)));

  const numberWords={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const timeMatch=raw.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+(later|earlier)\b/i);
  if(timeMatch){
    const rawAmount=timeMatch[1].toLowerCase(),amount=numberWords[rawAmount]??Number(rawAmount),unit=timeMatch[2].toLowerCase(),direction=timeMatch[3].toLowerCase();
    fields.narrativeTime=sceneField({anchor:`${amount} ${unit} ${direction}`,mode:direction==='earlier'?'FLASHBACK':'CONTINUOUS'},revision,evidenceRef);
    if(direction==='earlier'){boundarySignals.flashback=1;relationship=SceneRelationship.FLASHBACK_OF;}
    else if(/days?|weeks?|months?|years?/.test(unit)){boundarySignals.majorTimeJump={strength:1,explicit:true};}
  }else if(/\b(?:years?|months?|weeks?|days?)\s+earlier\b/i.test(raw)||/\bflashback\b/i.test(raw)){
    const anchor=(raw.match(/\b(?:years?|months?|weeks?|days?)\s+earlier\b/i)?.[0]??'flashback').toLowerCase();
    fields.narrativeTime=sceneField({anchor,mode:'FLASHBACK'},revision,evidenceRef);
    boundarySignals.flashback=1;relationship=SceneRelationship.FLASHBACK_OF;
  }

  if(/\bmeanwhile\b|\bat the same time elsewhere\b/i.test(raw)){boundarySignals.parallel=1;relationship=SceneRelationship.PARALLEL_TO;}
  if(/\bdoorway\b|\bthreshold\b/i.test(raw))boundarySignals.doorway=1;

  const resumeCue=/\bback in the present\b|\breturn(?:s|ed)? to (?:the )?(?:present|prior scene)\b|\bresume(?:s|d)? (?:the )?(?:present|prior scene)\b/i.test(raw);
  if(resumeCue){
    boundarySignals.explicitBreak=1;relationship=SceneRelationship.RESUMES;
    const frames=[...(sceneRuntime?.stack?.frames??[])].reverse();
    resumeSceneId=frames.find((frame)=>frame?.suspended&&frame?.resumable!==false)?.sceneId??null;
  }

  const travelCue=/\b(?:arrive(?:s|d)?|reach(?:es|ed)?|travel(?:s|ed)?|move(?:s|d)?|went|go(?:es)?|return(?:s|ed)?)\b/i.test(raw);
  if(location&&priorLocation&&location!==priorLocation&&travelCue&&!resumeCue){
    boundarySignals.locationTransition=1;boundarySignals.explicitBreak=1;
  }

  const explicitBreak=/\bscene break\b|\bcut to\b|(?:^|\n)\s*\*\*\*\s*(?:$|\n)/i.test(raw);
  if(explicitBreak)boundarySignals.explicitBreak=1;

  return {
    // Only structural evidence is "clear": atmosphere cues, prefetch intents and weak locations alone
    // leave semantic extraction in charge (deterministic fields stay as the fallback when no resource answers).
    explicit: (Boolean(fields.location) && locationIsClear) || Boolean(fields.activeCast) || Boolean(fields.narrativeTime) || Object.keys(boundarySignals).length > 0,
    fields,
    prefetchIntents,
    sourceText: raw,
    boundarySignals:Object.keys(boundarySignals).length?boundarySignals:null,
    relationship,
    resumeSceneId,
    allowWhenRefreshRequired:Boolean(relationship||boundarySignals.explicitBreak),
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
  // Swipe/regenerate/continue legitimately re-prepare against an already registered, unchanged
  // host message. Reuse its active revision; a same-id source with different content is a genuine
  // identity collision and still fails. Generation/request identity stays separate (turnId/seq).
  const existing = brain.core.registry.getSource(identity.sourceId);
  if (existing) {
    let active = null;
    try { active = brain.core.registry.getActiveRevision(identity.sourceId); } catch { active = null; }
    if (active && active.exactContent === message.text) return { ...identity, sourceRevisionId: active.id, reused: true };
    const error = new Error('NARRATIVE_SOURCE_IDENTITY_COLLISION: ' + identity.sourceId + (active ? ' content differs from its active revision' : ' has no active revision'));
    error.code = 'NARRATIVE_SOURCE_IDENTITY_COLLISION';
    throw error;
  }
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

async function applyNativeScene(brain, {
  chatId,message,sourceRevisionId=null,activity=HostActivity.USER_SEND,messageRevision=1,turnId=null,hostEventId=null,
  generationId=null,correlationId=null,causationId=null,phase='FOREGROUND_USER',selectionGuard=null,turnSealed=null,foregroundBudgetMs=1200,
}={}){
  const prior=brain.scene.integrationSignal(chatId);
  const identity=sourceIdentity(chatId,message);
  const resolvedTurnId=turnId??['scene-turn',chatId,identity.messageKey,messageRevision].join(':');
  const resolvedGenerationId=generationId??['scene-generation',chatId,identity.messageKey,messageRevision,identity.digest].join(':');
  const ownerSourceRevisionId=brain.scene?.narrativeFeed?.sourceRevisionIdFor?.({
    chatId,messageId:identity.messageKey,messageRevision,
  })??sourceRevisionId;
  const resolvedHostEventId=hostEventId??['st-scene',chatId,identity.messageKey,messageRevision,identity.digest,activity].join(':');
  const resolvedCorrelationId=correlationId??('corr:'+resolvedTurnId),resolvedCausationId=causationId??resolvedHostEventId;
  const hostEvent={
    activity,chatId,hostEventId:resolvedHostEventId,
    messageId:identity.messageKey,messageRevision,turnId:resolvedTurnId,generationId:resolvedGenerationId,
    correlationId:resolvedCorrelationId,causationId:resolvedCausationId,sourceRevisionId:ownerSourceRevisionId,
    content:message.text,role:message.role??(activity===HostActivity.USER_SEND?'user':'assistant'),
  };
  const currentSelection=()=>typeof selectionGuard==='function'?Boolean(selectionGuard()):true;
  const sealed=()=>typeof turnSealed==='function'?Boolean(turnSealed()):false;
  const safeParsed=(value)=>{
    const out=clone(value??{});
    delete out.sourceText;
    return out;
  };
  const superseded=(semantic=null)=>{
    const signal=prior??null;
    return{
      kind:'DeploymentSceneOwnerReceipt',contractVersion:1,status:'REJECTED',noWorkReason:'SCENE_SELECTION_SUPERSEDED',
      chatId,sceneId:signal?.sceneId??null,sceneRevision:signal?.sceneRevision??null,sourceRevisionRefs:[...(signal?.sourceRevisionRefs??[])],
      changedFields:[],signal,observed:false,initialized:!prior&&Boolean(signal),
      semanticObservation:semantic?{...clone(semantic.executionReceipt),ownerAdmitted:false,ownerReasonCode:'SCENE_PROPOSAL_SELECTION_SUPERSEDED',stale:true}:{status:'SKIPPED',reasonCode:'SCENE_SELECTION_SUPERSEDED',attempted:false,returned:false,ownerAdmitted:false,stale:true},
      parsed:{explicit:false,fields:{},boundarySignals:null,relationship:null,resumeSceneId:null,extractionPolicy:'NO_SCENE_MUTATION_SUPERSEDED_SELECTION'},
      reason:'SCENE_SELECTION_SUPERSEDED',authorityGranted:false,canonicalMutationAuthority:false,settlementAuthority:false,contextSealAuthority:false,rawNarrativeIncluded:false,
    };
  };
  if(!currentSelection())return superseded();

  // #213 deterministic path: inspect clear host evidence before scheduling any external Scene worker.
  const previewScene=prior?.sceneId?brain.scene.registry.current(prior.sceneId):null;
  const deterministicPreview=ownerSourceRevisionId?extractDevelopmentDeploymentScene(message.text,{
    revision:(Number(previewScene?.revision??prior?.sceneRevision??1)||1)+1,
    evidenceRef:ownerSourceRevisionId,currentScene:previewScene,sceneRuntime:brain.scene,
  }):{explicit:false,fields:{},boundarySignals:null};
  let semantic=null,admission=null,receipt=null,parsed=null,jevAdvice=null;
  if(deterministicPreview?.explicit){
    let ownerParsed=null;
    receipt=brain.ingestSceneHostEvent(hostEvent,{
      extract:(e,scene)=>{
        ownerParsed=extractDevelopmentDeploymentScene(e.content,{
          revision:scene.revision+1,evidenceRef:e.sourceRevisionId,currentScene:scene,sceneRuntime:brain.scene,
        });
        return ownerParsed;
      },
    });
    parsed={...safeParsed(ownerParsed??deterministicPreview),extractionPolicy:'DETERMINISTIC_SCENE_OWNER'};
  }else if(typeof brain.runSceneObservationWork==='function'&&ownerSourceRevisionId){
    semantic=await brain.runSceneObservationWork({
      chatId,turnId:resolvedTurnId,generationId:resolvedGenerationId,correlationId:resolvedCorrelationId,
      sourceRevisionId:ownerSourceRevisionId,narrative:message.text,phase,parentWorkId:'generation:'+resolvedGenerationId,foregroundBudgetMs,hostEvent,
    });
    if(!currentSelection()){
      if(semantic?.executionReceipt?.workId&&typeof brain.cancelSceneObservationWork==='function')brain.cancelSceneObservationWork({taskId:semantic.executionReceipt.workId,reason:'SCENE_OBSERVATION_SELECTION_SUPERSEDED'});
      return superseded(semantic);
    }
    const hasSemanticWork=semantic?.status==='RETURNED'&&(
      Object.keys(semantic?.proposal?.fields??{}).length>0||Object.keys(semantic?.boundarySignals??{}).length>0
    );
    const hasBoundedAmbiguity=semantic?.status==='RETURNED'&&Array.isArray(semantic?.ambiguities)&&semantic.ambiguities.length>0;
    if(hasBoundedAmbiguity&&typeof brain.adjudicateSceneObservationAmbiguity==='function'){
      jevAdvice=await brain.adjudicateSceneObservationAmbiguity({
        work:semantic,hostEvent,currentSelection,turnSealed,
      });
    }
    if(!currentSelection())return superseded(semantic);
    if(hasSemanticWork||jevAdvice?.accepted===true){
      admission=brain.admitSceneObservationProposal({
        work:semantic,hostEvent,currentSelection:currentSelection(),turnSealed:sealed(),jevAdvice,
      });
      receipt=admission?.ownerReceipt??null;
      parsed={
        explicit:true,fields:clone(semantic.proposal?.fields??{}),boundarySignals:clone(semantic.boundarySignals??{}),
        relationship:null,resumeSceneId:null,allowWhenRefreshRequired:false,extractionPolicy:'SEMANTIC_COGNITIVE_RESOURCE',
        ambiguityCount:Array.isArray(semantic.ambiguities)?Math.min(4,semantic.ambiguities.length):0,
      };
      if(!admission?.accepted&&['SCENE_PROPOSAL_SELECTION_SUPERSEDED','SCENE_PROPOSAL_LATE_AFTER_SEAL','SCENE_PROPOSAL_STALE_REVISION','SCENE_PROPOSAL_SOURCE_FENCE_MISMATCH','SCENE_JEV_ADVICE_FENCE_MISMATCH'].includes(admission?.reasonCode)){
        const signal=prior??brain.scene.integrationSignal(chatId);
        return{
          ...(receipt??{}),kind:receipt?.kind??'DeploymentSceneOwnerReceipt',status:'REJECTED',noWorkReason:admission.reasonCode,
          chatId,sceneId:signal?.sceneId??semantic.proposal?.sceneId??null,sceneRevision:signal?.sceneRevision??semantic.proposal?.baseRevision??null,
          sourceRevisionRefs:[...(signal?.sourceRevisionRefs??[])],changedFields:[],signal,observed:false,initialized:!prior&&Boolean(signal),
          semanticObservation:{
            ...clone(semantic.executionReceipt),ownerAdmitted:false,ownerReasonCode:admission.reasonCode,
            stale:Boolean(admission.receipt?.stale),late:Boolean(admission.receipt?.late),
            ambiguityReview:jevAdvice?{
              status:jevAdvice.status??null,reasonCode:jevAdvice.reasonCode??null,ambiguityId:jevAdvice.ambiguityId??null,
              decisionKind:jevAdvice.decisionKind??null,field:jevAdvice.field??null,selectedOptionId:jevAdvice.selectedOptionId??null,
              stale:Boolean(jevAdvice.stale),late:Boolean(jevAdvice.late),degraded:Boolean(jevAdvice.degraded),
            }:null,
          },
          parsed,reason:admission.reasonCode,authorityGranted:false,canonicalMutationAuthority:false,settlementAuthority:false,contextSealAuthority:false,rawNarrativeIncluded:false,
        };
      }
    }
  }

  if(!receipt){
    if(!currentSelection())return superseded(semantic);
    if(semantic&&phase!=='POST_RESPONSE'&&sealed()){
      const signal=prior??brain.scene.integrationSignal(chatId);
      return{
        kind:'DeploymentSceneOwnerReceipt',contractVersion:1,status:'REJECTED',noWorkReason:'SCENE_PROPOSAL_LATE_AFTER_SEAL',
        chatId,sceneId:signal?.sceneId??semantic.proposal?.sceneId??null,sceneRevision:signal?.sceneRevision??semantic.proposal?.baseRevision??null,
        sourceRevisionRefs:[...(signal?.sourceRevisionRefs??[])],changedFields:[],signal,observed:false,initialized:!prior&&Boolean(signal),
        semanticObservation:{...clone(semantic.executionReceipt),ownerAdmitted:false,ownerReasonCode:'SCENE_PROPOSAL_LATE_AFTER_SEAL',late:true},
        parsed:{explicit:false,fields:{},boundarySignals:null,relationship:null,resumeSceneId:null,extractionPolicy:'NO_SCENE_MUTATION_LATE_RESULT'},
        reason:'SCENE_PROPOSAL_LATE_AFTER_SEAL',authorityGranted:false,canonicalMutationAuthority:false,settlementAuthority:false,contextSealAuthority:false,rawNarrativeIncluded:false,
      };
    }
    let fallbackParsed=null;
    receipt=brain.ingestSceneHostEvent(hostEvent,{
      extract:(e,scene)=>{
        fallbackParsed=extractDevelopmentDeploymentScene(e.content,{
          revision:scene.revision+1,evidenceRef:e.sourceRevisionId,currentScene:scene,sceneRuntime:brain.scene,
        });
        return fallbackParsed;
      },
    });
    parsed=safeParsed(fallbackParsed??{explicit:false,fields:{},boundarySignals:null,relationship:null,resumeSceneId:null,extractionPolicy:'GENERIC_HOST_EVIDENCE_ONLY'});
  }
  const signal=receipt.signal??prior??(ownerSourceRevisionId?brain.ensureScene({chatId,sourceRevisionId:ownerSourceRevisionId}):sourceRevisionId?brain.ensureScene({chatId,sourceRevisionId}):null);
  const observed=receipt.status==='OBSERVED';
  const initialized=!prior&&Boolean(signal);
  const semanticObservation=semantic?{
    ...clone(semantic.executionReceipt),ownerAdmitted:admission?.accepted??null,ownerReasonCode:admission?.reasonCode??null,
    changedFields:[...(admission?.ownerReceipt?.changedFields??receipt?.changedFields??[])].slice(0,16),
    ambiguityCount:Array.isArray(semantic?.ambiguities)?Math.min(4,semantic.ambiguities.length):0,
    ambiguityReview:jevAdvice?{
      status:jevAdvice.status??null,reasonCode:jevAdvice.reasonCode??null,ambiguityId:jevAdvice.ambiguityId??null,
      decisionKind:jevAdvice.decisionKind??null,field:jevAdvice.field??null,selectedOptionId:jevAdvice.selectedOptionId??null,
      stale:Boolean(jevAdvice.stale),late:Boolean(jevAdvice.late),degraded:Boolean(jevAdvice.degraded),
    }:null,
  }:null;
  return{
    ...receipt,observed,initialized,parsed,signal,delta:receipt.delta??null,semanticObservation,
    extractionPolicy:parsed?.extractionPolicy??'GENERIC_HOST_EVIDENCE_ONLY',
    reason:observed
      ? (receipt.transition?'HOST_SCENE_TRANSITION_OBSERVED':parsed?.extractionPolicy==='SEMANTIC_COGNITIVE_RESOURCE'?'SEMANTIC_SCENE_FIELDS_ADMITTED':parsed?.extractionPolicy==='DETERMINISTIC_SCENE_OWNER'?'DETERMINISTIC_SCENE_FIELDS_ADMITTED':'HOST_SCENE_FIELDS_OBSERVED')
      : (initialized?'SCENE_INITIALIZED_WITH_UNKNOWN_FIELDS':receipt.noWorkReason??'NO_EXPLICIT_SCENE_FIELDS_REUSE_CURRENT'),
  };
}

function sceneOwnerReceiptForNative(scene){
  if(!scene)return null;
  const safe=clone(scene);
  delete safe.dispatchTimeline;delete safe.signal;delete safe.parsed;
  return safe;
}

function activeContextForNative(brain,context,chatId){
  const chat=Array.isArray(context?.chat)?context.chat:[];
  const currentEvidence=brain?.scene?.narrativeFeed?.currentEvidence?.(chatId)??[];
  const evidenceByMessage=new Map(currentEvidence.filter(row=>row?.messageId!=null).map(row=>[String(row.messageId),row]));
  const messages=[];
  for(let index=0;index<chat.length;index++){
    const row=chat[index],content=clean(row?.mes??row?.content??row?.text);
    if(!content)continue;
    const identity=sourceIdentity(chatId,{index,row,text:content}),evidence=evidenceByMessage.get(identity.messageKey);
    messages.push({
      messageId:identity.messageKey,sequence:index,
      role:row?.role??(row?.is_user===true?'user':'assistant'),content,
      sourceRevisionRefs:evidence?.sourceRevisionId?[evidence.sourceRevisionId]:[],
      provenanceRefs:evidence?.sourceRevisionId?[evidence.sourceRevisionId]:[],
    });
  }
  return{messages,coverage:[],recentWindow:6,hostHistoryMutation:false};
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
  const turnSuffix = source.messageKey + ':' + source.digest + ':' + chosenMode;
  const turnId = 'live:' + chatId + ':' + turnSuffix;
  const generationId = 'live-gen:' + chatId + ':' + source.messageKey + ':' + source.digest;
  const scene = await applyNativeScene(brain, { chatId, message, sourceRevisionId: source.sourceRevisionId, turnId, generationId });

  const result = await brain.runTurn({
    chatId,
    turnId,
    generationId,
    query: message.text,
    mode: chosenMode,
    sceneReceipt: scene,
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

const READY_SCENE_EXTRACTION_POLICIES=new Set([
  'GENERIC_HOST_EVIDENCE_ONLY',
  'DETERMINISTIC_SCENE_OWNER',
  'SEMANTIC_COGNITIVE_RESOURCE',
]);

function liveTurnReady(row) {
  if (!row?.host?.chatId || !row?.selection?.turnId || !row?.selection?.generationId) return false;
  if (!row.delivery?.ok || !row.delivery?.sealVerified || !row.delivery?.promptInjection?.succeeded) return false;
  if (!row.cognition?.choice || !row.runtime) return false;
  if (!row.scene?.sceneId || !READY_SCENE_EXTRACTION_POLICIES.has(row.scene?.extractionPolicy)) return false;
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
    memoryOwnerSnapshot = null,
    loreOwnerSnapshot = null,
    sceneOwnerSnapshot = null,
    persistNativeBrain = null,
    storage = null,
    hostState = null,
    restoreReceipt = null,
    detailedGenerationProfiling = false,
  } = {}) {
    this.sillyTavern = sillyTavern;
    this.document = document;
    this.brain = brain ?? new DevelopmentDeploymentBrain({ resourceCount: 1, jevAvailable: true, memoryOwnerSnapshot, loreOwnerSnapshot, sceneOwnerSnapshot });
    this.nativeBrain = null;
    this.ownerBindings = ownerBindings&&typeof ownerBindings==='object'?{...ownerBindings}:{};
    this.persistNativeBrain=typeof persistNativeBrain==='function'?persistNativeBrain:null;
    // Installed durable storage: one Brain per story (chat), owners stored once. `storyBrains` keeps live brains so a
    // chat switch inside a session does not reload; `nativeBrainStoryId` says which story the attached brain serves.
    this.storage=storage&&typeof storage.saveStory==='function'?storage:null;
    this.storageRestore=restoreReceipt?clone(restoreReceipt):{kind:'InstalledStorageRestoreReceipt',status:this.storage?'NOT_ATTEMPTED':'NO_STORAGE'};
    this.nativeBrainStoryId=null;this.storyBrains=new Map();this.storyBrainReady=Promise.resolve();
    this.nativePersistence=[];
    this.nativePending = new Map();
    this.nativePayloads = new Map();
    this.nativeRuns = new Map();
    // Deep Lore study yields at slice boundaries while a native generation is running or awaiting its response.
    this.brain.setForegroundProbe?.(() => this.nativeRuns.size > 0 || this.nativePending.size > 0);
    this.nativeHistory = [];
    this.nativeRejections = [];
    this.nativePerformance = [];
    this.detailedGenerationProfiling=Boolean(detailedGenerationProfiling);
    this.nativeLoreRevisionEvents = [];
    this.routedLoreRevisionKeys = new Set();
    this.nativeOwnerAttachments = {lore:null,memory:null,memoryConsolidation:null,graphProviders:[]};
    this.nativeGraphProviderIds = new Set();
    this.optionalGenerationActive = new Map();
    this.releaseLoreOwnerEvents = null;
    this.nativeSequence = 0;
    this.hostEventSequence = 0;
    this.hostNarrativeEvents = [];
    this.hostAssistantTurns = new Map();
    this.lastPersistedLoreOwnerKey = null;
    this.hostRevisionReconciliations = [];
    this.sceneHostMessageState = new Map();
    // Host bookkeeping that lets a restored session keep retiring what deleted/edited messages taught it.
    if (hostState?.kind === 'InstalledHostState') {
      for (const [key, row] of hostState.hostAssistantTurns ?? []) this.hostAssistantTurns.set(key, clone(row));
      for (const [key, row] of hostState.sceneHostMessageState ?? []) this.sceneHostMessageState.set(key, clone(row));
    }
    this.onEvidence = typeof onEvidence === 'function' ? onEvidence : null;
    this.uiHost = null;
    this.running = false;
    this.destroyed=false;this.hostListenerCount=0;this.notifyScheduled=false;this.notifyHandle=null;this.longTaskObserver=null;this.longTaskEntries=[];
    this.profileListeners=new Set();this.profileCaptureStates=[];
    this.loadMetrics={notifyRequested:0,notifyDelivered:0,notifyCoalesced:0,notifyTotalMs:0,notifyMaxMs:0,lastNotifyMs:0,longTaskCount:0,longTaskTotalMs:0,longTaskMaxMs:0,heapMinBytes:null,heapMaxBytes:null,heapLastBytes:null};
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

  #sceneHostVersion(chatId,message,{activity=null}={}){
    const identity=sourceIdentity(chatId,message),key=chatId+'|'+identity.messageKey,prior=this.sceneHostMessageState.get(key)??null;
    const changed=Boolean(prior&&prior.digest!==identity.digest);
    const messageRevision=changed?prior.messageRevision+1:(prior?.messageRevision??1);
    const resolvedActivity=activity??(changed?HostActivity.EDIT:HostActivity.USER_SEND);
    const state={messageRevision,digest:identity.digest,activity:resolvedActivity,messageKey:identity.messageKey};
    this.sceneHostMessageState.set(key,state);
    return clone(state);
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
    this.nativeBrain=null;this.nativePending.clear();this.nativePayloads.clear();this.nativeRuns.clear();this.nativeOwnerAttachments={lore:null,memory:null,memoryConsolidation:null,graphProviders:[]};this.nativeGraphProviderIds.clear();this.#completeAllOptionalGenerations('NATIVE_BRAIN_DETACHED');
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
    pushBounded(this.loreIngestion,receipt,SESSION_BOUNDS.loreIngestion);
    if (notify) this.#notify();
    return clone(receipt);
  }

  uiBindings(){return this.#uiHostBindings();}

  setDetailedGenerationProfiling(enabled=true){this.detailedGenerationProfiling=Boolean(enabled);return this.detailedGenerationProfiling;}

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
      const beforeHandler=async(type,options,dryRun)=>{if(dryRun)return;try{await this.prepareNativeGeneration({generationType:type});}catch(error){pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'NATIVE_PREPARE'},SESSION_BOUNDS.errors);this.#notify();}};
      const requestHandler=async(eventData)=>{if(eventData?.dryRun)return;try{this.injectNativeModelRequest(eventData);}catch(error){pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'NATIVE_MODEL_REQUEST'},SESSION_BOUNDS.errors);this.#notify();}};
      const receivedHandler=async(index)=>{this.#recordHostNarrativeEvent('MESSAGE_RECEIVED',[index]);try{await this.completeNativeGeneration({messageIndex:index});}catch(error){pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'NATIVE_COMPLETE'},SESSION_BOUNDS.errors);this.#notify();}};
      const stoppedHandler=(...args)=>{this.#recordHostNarrativeEvent('GENERATION_STOPPED',args);this.#expireNativePending('GENERATION_STOPPED_WITHOUT_COMPLETION');};
      context.eventSource.on(before,beforeHandler);releases.push(()=>context.eventSource.removeListener?.(before,beforeHandler));
      context.eventSource.on(requestReady,requestHandler);releases.push(()=>context.eventSource.removeListener?.(requestReady,requestHandler));
      // Text-completion backends never emit CHAT_COMPLETION_PROMPT_READY; SillyTavern emits
      // GENERATE_AFTER_COMBINE_PROMPTS {prompt:string} instead (also with prompt '' for chat completion).
      const combined=context.eventTypes?.GENERATE_AFTER_COMBINE_PROMPTS??context.event_types?.GENERATE_AFTER_COMBINE_PROMPTS;
      if(combined){
        const textHandler=async(eventData)=>{if(eventData?.dryRun)return;try{this.injectNativeTextPrompt(eventData);}catch(error){pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'NATIVE_TEXT_PROMPT'},SESSION_BOUNDS.errors);this.#notify();}};
        context.eventSource.on(combined,textHandler);releases.push(()=>context.eventSource.removeListener?.(combined,textHandler));
      }
      context.eventSource.on(received,receivedHandler);releases.push(()=>context.eventSource.removeListener?.(received,receivedHandler));
      if(stopped){context.eventSource.on(stopped,stoppedHandler);releases.push(()=>context.eventSource.removeListener?.(stopped,stoppedHandler));}
    }else{
      const eventName=context.eventTypes?.MESSAGE_SENT??context.event_types?.MESSAGE_SENT;
      if(!eventName)throw new Error('No supported SillyTavern pre-generation event is available');
      const handler=async(...args)=>{this.#recordHostNarrativeEvent('MESSAGE_SENT',args);try{await this.processCurrentTurn();}catch{/* processCurrentTurn records the failure for the operator. */}};
      context.eventSource.on(eventName,handler);releases.push(()=>context.eventSource.removeListener?.(eventName,handler));
    }
    const observedHostEvents=['MESSAGE_SENT','MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_UPDATED','MESSAGE_SWIPED','MESSAGE_SWIPE_DELETED','CHAT_CHANGED','CHAT_LOADED','CHAT_CREATED','CHAT_RENAMED','WORLDINFO_UPDATED','WORLDINFO_SETTINGS_UPDATED','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED'];
    for(const key of observedHostEvents){
      if (key === 'MESSAGE_SENT' || (this.nativeBrain && ['MESSAGE_RECEIVED','GENERATION_STOPPED'].includes(key))) continue;
      const eventName=context.eventTypes?.[key]??context.event_types?.[key];
      if(!eventName)continue;
      const observer=(...args)=>this.#recordHostNarrativeEvent(key,args);
      context.eventSource.on(eventName,observer);releases.push(()=>context.eventSource.removeListener?.(eventName,observer));
    }
    this.release=()=>{for(const release of releases.splice(0))try{release();}catch{}};
    this.hostListenerCount=releases.length;this.#startLoadObserver();
    this.running=true;this.#notify();return this;
  }

  stop() {
    this.release?.();this.release=null;this.hostListenerCount=0;this.running=false;this.#stopLoadObserver();this.#completeAllOptionalGenerations('SESSION_STOPPED');this.#notify();return this;
  }

  async prepareNativeGeneration({generationType='normal'}={}){
    const type=String(generationType??'normal').toLowerCase();
    if(EXCLUDED_HOST_GENERATION_TYPES.has(type)){
      // Quiet (other extensions' generateQuietPrompt) and impersonate requests produce no story
      // reply; they are not Area-52 story turns and must not reserve a run or receive context.
      pushBounded(this.nativeRejections,{at:Date.now(),code:'HOST_GENERATION_TYPE_EXCLUDED',generationType:type},100);
      return null;
    }
    await this.storyBrainReady;
    try{await this.#ensureStoryBrain(clean(this.getContext()?.chatId));}catch(error){pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'STORY_BRAIN_SWITCH'},SESSION_BOUNDS.errors);}
    const contract=nativeBrainContract(this.nativeBrain);if(!contract.available)throw new Error(contract.reason);
    const context=this.getContext(),message=latestUserMessage(context),chatId=clean(context.chatId);
    if(!message)throw new Error('No current SillyTavern user message is available for native Brain preparation');
    if(!chatId)throw new Error('SillyTavern chatId is unavailable');
    // SillyTavern serializes non-quiet generations per chat, so a run still registered for this chat
    // at a new GENERATION_AFTER_COMMANDS belongs to a generation that ended without completion
    // (provider error, aborted stream). Expire exactly that run; never a newer one.
    const orphan=this.nativeRuns.get(chatId);
    if(orphan)this.releaseNativeRun(chatId,orphan,'SUPERSEDED_BY_NEW_GENERATION');
    this.#reconcileHostRevisions('PREPARE_GENERATION');
    const hostPrepareStarted=perfNow(),profileStart=this.#generationProfileSample();
    const source=registerNarrativeSource(this.brain,{chatId,message});
    const seq=++this.nativeSequence,turnId='native-live:'+chatId+':'+source.messageKey+':'+source.digest+':'+seq,generationId='native-live-gen:'+chatId+':'+source.messageKey+':'+source.digest+':'+seq;
    const correlationId='corr:'+turnId,causationId='host-narrative:'+source.sourceRevisionId;
    const selectionGuard=()=>{
      try{
        const current=this.getContext(),latest=latestUserMessage(current);
        return clean(current.chatId)===chatId&&Boolean(latest)&&latest.index===message.index&&sourceIdentity(chatId,latest).digest===source.digest;
      }catch{return false;}
    };
    const sceneVersion=this.#sceneHostVersion(chatId,message);
    const scene=await applyNativeScene(this.brain,{
      chatId,message,sourceRevisionId:source.sourceRevisionId,activity:sceneVersion.activity,messageRevision:sceneVersion.messageRevision,
      turnId,generationId,correlationId,causationId,phase:'FOREGROUND_USER',selectionGuard,
      turnSealed:()=>Boolean(this.nativeBrain?.core?.publication?.seal?.isTurnSealed?.(turnId)),
    });
    const sceneFanOut=await this.brain.assembleSceneFanOutForNativeTurn({
      chatId,turnId,generationId,correlationId,causationId,query:message.text,worldRevision:this.nativeBrain?.core?.graph?.revision??0,
      foregroundBudgetMs:1200,selectionGuard,sealed:()=>Boolean(this.nativeBrain?.core?.publication?.seal?.isTurnSealed?.(turnId)),
    });
    if(!selectionGuard())throw new Error('NATIVE_SCENE_SELECTION_SUPERSEDED_BEFORE_BRAIN');
    const sceneOwnerReceipt=sceneOwnerReceiptForNative(scene);
    const activeContext=activeContextForNative(this.brain,context,chatId);
    let readyResolve,readyReject,responseResolve,responseReject,readySettled=false;
    const readyPromise=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const responsePromise=new Promise((resolve,reject)=>{responseResolve=resolve;responseReject=reject;});
    // The generate callback is the only consumer; if preparation fails first, a release-time rejection
    // must not surface as an unhandled rejection in the host page.
    responsePromise.catch(()=>{});
    const run={chatId,turnId,generationId,responseResolve,responseReject,runPromise:null,hostPrepareStarted,profileStart,profileAfterInsertion:null};
    pushBounded(this.profileCaptureStates,{chatId,turnId,generationId,correlationId,status:profileStart?'ARMED':'NOT_ARMED',updatedAt:Date.now()},SESSION_BOUNDS.nativePerformance);
    this.nativeRuns.set(chatId,run);
    run.runPromise=Promise.resolve().then(()=>this.nativeBrain.runTurn({
      chatId,turnId,generationId,correlationId,query:message.text,sceneSignal:scene.signal,sceneTimeline:scene.dispatchTimeline??[],sceneOwnerReceipt,
      sceneFanOut:sceneFanOut?.coreHandoff??null,executionLabel:'LIVE_SILLYTAVERN',
      // Installed context retirement: the host history window is evaluated by the documented
      // NativeContextRetirementPolicy (RECENT_NARRATIVE, optional) instead of being ignored.
      activeContext,
    },{
      generate:async(rendered,meta={})=>{
        const seal=meta.contextSealReceipt;
        if(!seal?.sealedState)throw new Error('Native Brain did not publish a sealed Context Seal before the model request');
        if(!rendered)throw new Error('Native Brain runTurn did not publish prepared.rendered for the model request');
        this.nativePayloads.set(chatId,clone(rendered));
        const pending={kind:'NativeBrainHostTurn',chatId,turnId,generationId,correlationId:meta.selection?.correlationId??correlationId,causationId,generationType:String(generationType??'normal'),userMessageIndex:message.index,userMessageDigest:source.digest,sceneId:scene.signal?.sceneId??null,sceneRevision:scene.signal?.sceneRevision??null,sceneSourceRevisionRefs:[...(scene.signal?.sourceRevisionRefs??[])],sceneOwnerReceipt:clone(sceneOwnerReceipt),sceneFanOutReceipt:clone(sceneFanOut?.receipt??null),contextRetirement:clone(meta.contextRetirement??null),preparedAt:Date.now(),promptPlanId:meta.promptPlan?.promptPlanId??null,contextSealId:seal?.id??meta.promptPlan?.contextSealId??null,renderedPayloadDigest:shortHash(JSON.stringify(rendered)),state:'SEALED_FOR_MODEL_REQUEST'};
        if(typeof this.nativeBrain?.recordHostObservationEvidence==='function')this.nativeBrain.recordHostObservationEvidence(turnId,{eventId:'host-preparation:'+generationId,chatId,turnId,generationId,correlationId:pending.correlationId,sceneRevision:pending.sceneRevision,sourceRevisionRefs:pending.sceneSourceRevisionRefs,durationMs:Math.max(0,perfNow()-run.hostPrepareStarted),capturedAt:Date.now()});
        this.nativePending.set(chatId,pending);this.nativeHistory.push(clone(pending));if(this.nativeHistory.length>100)this.nativeHistory.splice(0,this.nativeHistory.length-100);
        this.#beginOptionalGeneration(pending);
        readySettled=true;readyResolve(clone(pending));this.#notify();
        return responsePromise;
      },
      completeOptions:{autoDrain:false},
    })).then(result=>({ok:true,result})).catch(error=>{if(!readySettled){readySettled=true;this.releaseNativeRun(chatId,run,'NATIVE_PREPARATION_FAILED');readyReject(error);}return{ok:false,error};});
    return readyPromise;
  }

  /** Text-completion delivery (GENERATE_AFTER_COMBINE_PROMPTS). Inserts the exact sealed
   *  prepared.rendered sections, in messageMap order, once, immediately before the current user
   *  message in the combined prompt, and records the same observed-host delivery receipt. */
  injectNativeTextPrompt(eventData={}){
    const insertionStarted=perfNow();
    if(typeof eventData?.prompt!=='string'||!eventData.prompt.length)return null; // chat completion emits prompt ''
    const context=this.getContext(),chatId=clean(context.chatId),pending=this.nativePending.get(chatId),rendered=this.nativePayloads.get(chatId);
    if(!pending||!rendered)return null;
    if(pending.requestInjectedAt)return clone(pending);
    if(rendered.format!=='messages'||!Array.isArray(rendered.messages))throw new Error('Native Brain prepared.rendered format is not supported by the SillyTavern text-completion hook: '+String(rendered.format??'unknown'));
    const exactMessages=clone(rendered.messages);
    const body=exactMessages.map(row=>String(row?.content??'')).filter(Boolean).join('\n\n');
    const block='[Area-52 sealed context]\n'+body+'\n[/Area-52 sealed context]\n';
    const userText=clean(context.chat?.[pending.userMessageIndex]?.mes??'');
    const at=userText?eventData.prompt.lastIndexOf(userText):-1,insertAt=at>=0?at:0;
    const before=eventData.prompt;
    eventData.prompt=before.slice(0,insertAt)+block+before.slice(insertAt);
    const area52PayloadJson=JSON.stringify(exactMessages),requestPayloadDigest=shortHash(area52PayloadJson),area52InputBytes=utf8Bytes(block);
    const insertionDurationMs=Math.max(0,perfNow()-insertionStarted);
    const run=this.nativeRuns.get(chatId);if(run)run.profileAfterInsertion=this.#generationProfileSample();
    let observedReceipt=null,ownerDeliveryReceiptRecorded=false;
    if(typeof this.nativeBrain?.recordObservedHostPromptEvidence==='function'){
      try{
        observedReceipt=this.nativeBrain.recordObservedHostPromptEvidence(pending.turnId,{
          host:'SILLYTAVERN',hostFormat:'TEXT_COMPLETION',hostObserved:true,live:true,chatId,turnId:pending.turnId,generationId:pending.generationId,
          contextSealId:pending.contextSealId,requestId:eventData.requestId??null,sealedPacketHash:rendered.sealedPacketHash??null,
          observedRoles:exactMessages.map(row=>row.role),
          observedSections:(rendered.messageMap??[]).map(row=>({slot:row.slot,sectionIdentity:row.sectionIdentity??null,providerRole:row.providerRole??null,sourceRevisionIds:[...(row.sourceRevisionIds??[])],semanticManifestIdentity:row.semanticManifestIdentity??null})),
          promptFingerprint:requestPayloadDigest,capturedAt:Date.now(),insertionDurationMs,area52InputBytes,area52MessageCount:exactMessages.length,hostMessageCount:1,
        });
        if(observedReceipt?.phases?.hostRequest?.status!=='OBSERVED_MATCH')throw new Error('HOST_DELIVERY_OBSERVATION_MISMATCH');
        ownerDeliveryReceiptRecorded=true;
      }catch(error){eventData.prompt=before;throw error;}
    }
    const updated={...pending,state:'MODEL_REQUEST_PAYLOAD_INJECTED',requestInjectedAt:Date.now(),requestId:eventData.requestId??null,requestPayloadDigest,renderedMessageCount:exactMessages.length,area52InputBytes,requestHook:'GENERATE_AFTER_COMBINE_PROMPTS',hostFormat:'TEXT_COMPLETION',deliveryReceiptStatus:ownerDeliveryReceiptRecorded?(observedReceipt?.status??'OBSERVED_MATCH'):'HOST_OBSERVED_OWNER_RECEIPT_UNAVAILABLE',deliveryReceiptContractVersion:observedReceipt?.contractVersion??null,ownerDeliveryReceiptRecorded};
    this.nativePending.set(chatId,updated);this.nativePayloads.delete(chatId);this.nativeHistory.push(clone(updated));if(this.nativeHistory.length>100)this.nativeHistory.splice(0,this.nativeHistory.length-100);
    this.#notify();return clone(updated);
  }

  injectNativeModelRequest(eventData={}){
    const insertionStarted=perfNow();
    const context=this.getContext(),chatId=clean(context.chatId),pending=this.nativePending.get(chatId),rendered=this.nativePayloads.get(chatId);
    if(!pending||!rendered)return null;
    if(pending.requestInjectedAt)return clone(pending);
    if(rendered.format!=='messages'||!Array.isArray(rendered.messages))throw new Error('Native Brain prepared.rendered format is not supported by the SillyTavern chat-completion request hook: '+String(rendered.format??'unknown'));
    if(!Array.isArray(eventData.chat))throw new Error('SillyTavern CHAT_COMPLETION_PROMPT_READY did not expose a mutable chat request');
    const exactMessages=clone(rendered.messages),supportedRoles=new Set(rendered.supportedProviderRoles??['system','user','assistant']);
    const unsupportedRole=exactMessages.map(row=>String(row?.role??'')).find(role=>!supportedRoles.has(role));
    if(unsupportedRole)throw new Error('UNSUPPORTED_PROVIDER_MESSAGE_ROLE:'+unsupportedRole);
    const lastUserIndex=eventData.chat.map(row=>String(row?.role??'')).lastIndexOf('user'),insertAt=lastUserIndex>=0?lastUserIndex:eventData.chat.length;
    eventData.chat.splice(insertAt,0,...exactMessages);
    const area52PayloadJson=JSON.stringify(exactMessages),requestPayloadDigest=shortHash(area52PayloadJson),area52InputBytes=utf8Bytes(area52PayloadJson);
    const insertionDurationMs=Math.max(0,perfNow()-insertionStarted),hostMessageCount=eventData.chat.length;
    const run=this.nativeRuns.get(chatId);if(run)run.profileAfterInsertion=this.#generationProfileSample();
    let observedReceipt=null,ownerDeliveryReceiptRecorded=false;
    if(typeof this.nativeBrain?.recordObservedHostPromptEvidence==='function'){
      try{
        observedReceipt=this.nativeBrain.recordObservedHostPromptEvidence(pending.turnId,{
          host:'SILLYTAVERN',hostObserved:true,live:true,chatId,turnId:pending.turnId,generationId:pending.generationId,
          contextSealId:pending.contextSealId,requestId:eventData.requestId??eventData.id??null,
          sealedPacketHash:rendered.sealedPacketHash??null,observedRoles:exactMessages.map(row=>row.role),
          observedSections:(rendered.messageMap??[]).map(row=>({slot:row.slot,sectionIdentity:row.sectionIdentity??null,providerRole:row.providerRole??null,sourceRevisionIds:[...(row.sourceRevisionIds??[])],semanticManifestIdentity:row.semanticManifestIdentity??null})),
          promptFingerprint:requestPayloadDigest,capturedAt:Date.now(),
          insertionDurationMs,area52InputBytes,area52MessageCount:exactMessages.length,hostMessageCount,
        });
        if(observedReceipt?.phases?.hostRequest?.status!=='OBSERVED_MATCH')throw new Error('HOST_DELIVERY_OBSERVATION_MISMATCH');
        ownerDeliveryReceiptRecorded=true;
      }catch(error){
        eventData.chat.splice(insertAt,exactMessages.length);
        throw error;
      }
    }
    const deliveryReceiptStatus=ownerDeliveryReceiptRecorded?(observedReceipt?.status??'OBSERVED_MATCH'):'HOST_OBSERVED_OWNER_RECEIPT_UNAVAILABLE';
    const updated={...pending,state:'MODEL_REQUEST_PAYLOAD_INJECTED',requestInjectedAt:Date.now(),requestId:eventData.requestId??eventData.id??null,requestPayloadDigest,renderedMessageCount:exactMessages.length,area52InputBytes,requestHook:'CHAT_COMPLETION_PROMPT_READY',deliveryReceiptStatus,deliveryReceiptContractVersion:observedReceipt?.contractVersion??null,ownerDeliveryReceiptRecorded};
    this.nativePending.set(chatId,updated);this.nativePayloads.delete(chatId);this.nativeHistory.push(clone(updated));if(this.nativeHistory.length>100)this.nativeHistory.splice(0,this.nativeHistory.length-100);
    this.#notify();return clone(updated);
  }

  async completeNativeGeneration(options={}){
    const chatId=(()=>{try{return clean(this.getContext().chatId);}catch{return '';}})();
    const run=chatId?this.nativeRuns.get(chatId)??null:null;
    try{return await this.#completeNativeGenerationInner(options);}
    catch(error){
      // Any failed completion is terminal for this run: release it (identity-checked) so the
      // next Send is not blocked, then surface the failure to Diagnostics via the caller.
      if(run)this.releaseNativeRun(chatId,run,'NATIVE_COMPLETION_FAILED');
      throw error;
    }
  }

  async #completeNativeGenerationInner({messageIndex=null}={}){
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
    const providerLatencyMs=Math.max(0,Date.now()-Number(pending.requestInjectedAt??Date.now()));
    if(typeof this.nativeBrain?.recordProviderResponsePerformance==='function')this.nativeBrain.recordProviderResponsePerformance(pending.turnId,{chatId,turnId:pending.turnId,generationId:pending.generationId,correlationId:pending.correlationId,providerLatencyMs,capturedAt:Date.now()});
    run.responseResolve(assistant.text);
    const outcome=await run.runPromise;
    if(!outcome?.ok)throw outcome?.error??new Error('Native Brain runTurn failed after provider response');
    const learning=outcome.result?.learning??null;
    const completion=outcome.result?.completion??learning?.responseCompletion??null;
    if(!learning||completion?.status!=='COMPLETED')throw new Error('Native Brain runTurn returned no response-completion receipt after the provider response');
    // Foreground response ownership ends after bounded response admission and background
    // work scheduling. L2/L3 learning continues through the existing Runtime and must
    // not hold the installed host completion path open.
    this.#completeOptionalGeneration(pending,'GENERATION_COMPLETED');
    let postResponseScene=null;
    try{
      const assistantMessageForScene={...assistant,role:'assistant'};
      const assistantSource=registerNarrativeSource(this.brain,{chatId,message:assistantMessageForScene});
      const assistantSceneVersion=this.#sceneHostVersion(chatId,assistantMessageForScene,{activity:HostActivity.ASSISTANT_GENERATION_COMPLETE});
      const assistantIdentity=sourceIdentity(chatId,assistantMessageForScene);
      this.hostAssistantTurns.set(assistantIdentity.sourceId,{chatId,turnId:pending.turnId,messageKey:assistantIdentity.messageKey,digest:assistantIdentity.digest});
      this.#reconcileHostRevisions('ASSISTANT_COMPLETED');
      postResponseScene=await applyNativeScene(this.brain,{
        chatId,message:assistantMessageForScene,sourceRevisionId:assistantSource.sourceRevisionId,
        activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,messageRevision:assistantSceneVersion.messageRevision,
        turnId:pending.turnId,generationId:pending.generationId,phase:'POST_RESPONSE',
        selectionGuard:()=>{
          try{
            const current=this.getContext(),currentAssistant=assistantMessage(current,assistant.index);
            return clean(current.chatId)===chatId&&Boolean(currentAssistant)&&sourceIdentity(chatId,{...currentAssistant,role:'assistant'}).digest===assistantIdentity.digest;
          }catch{return false;}
        },
        turnSealed:()=>true,
      });
      if(postResponseScene?.signal&&typeof this.nativeBrain?.observeScene==='function')this.nativeBrain.observeScene(chatId,postResponseScene.signal);
    }catch(error){
      pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'POST_RESPONSE_SCENE_OBSERVATION'},SESSION_BOUNDS.errors);
    }
    const completed={
      ...pending,state:'RESPONSE_COMPLETED',completedAt:Date.now(),assistantMessageIndex:assistant.index,responseDigest:shortHash(assistant.text),
      responseCompletion:{kind:completion?.kind??null,status:completion?.status??null,foregroundWaitMs:completion?.foregroundWaitMs??null,learningScheduled:Boolean(completion?.learningScheduled),feedbackRuntimeTaskId:completion?.feedbackRuntimeTaskId??null,memoryRuntimeTaskId:completion?.memoryRuntimeTaskId??null},
      learning:{kind:learning?.kind??null,sourceRevisionId:learning?.sourceRevisionId??null,rawExperienceRecoverable:Boolean(learning?.rawExperienceRecoverable),settlementCount:learning?.settlements?.length??learning?.settlementDecisions?.length??0,runtimeTaskId:learning?.runtimeTaskId??null,status:learning?.learningLifecycle?.status??null,backgroundPending:Boolean(learning?.learningLifecycle?.backgroundPending)},
      postResponseScene:postResponseScene?{
        status:postResponseScene.status??null,reason:postResponseScene.reason??null,sceneId:postResponseScene.sceneId??postResponseScene.signal?.sceneId??null,
        sceneRevision:postResponseScene.sceneRevision??postResponseScene.signal?.sceneRevision??null,changedFields:[...(postResponseScene.changedFields??[])].slice(0,16),
        semanticObservation:clone(postResponseScene.semanticObservation??null),rawNarrativeIncluded:false,
      }:null,
    };
    this.nativePending.delete(chatId);this.nativePayloads.delete(chatId);this.nativeRuns.delete(chatId);this.nativeHistory.push(clone(completed));if(this.nativeHistory.length>100)this.nativeHistory.splice(0,this.nativeHistory.length-100);
    const checkpointStarted=perfNow(),checkpointStart=this.#generationProfileSample();
    const captureState=this.profileCaptureStates.find(row=>row.generationId===pending.generationId);
    if(captureState){captureState.status=checkpointStart?'CHECKPOINT_PENDING':'NOT_ARMED';captureState.updatedAt=Date.now();}
    const checkpointReceipt=await this.#persistNativeBrainCheckpoint({chatId,turnId:pending.turnId,generationId:pending.generationId});
    const checkpointWallMs=Math.max(0,perfNow()-checkpointStarted);
    // Long Tasks are published after the current browser task ends. Sampling
    // in the persistence microtask would omit synchronous checkpoint stalls.
    if(this.detailedGenerationProfiling)await new Promise(resolve=>setTimeout(resolve,0));
    const profileEnd=this.#generationProfileSample();
    if(run.profileStart||run.profileAfterInsertion||profileEnd){
      const start=run.profileStart,end=profileEnd;
      const delta=(a,b)=>Number.isFinite(Number(a))&&Number.isFinite(Number(b))?Number(b)-Number(a):null;
      pushBounded(this.nativePerformance,{
        kind:'NativeGenerationDetailedPerformanceProfile',chatId,turnId:pending.turnId,generationId:pending.generationId,correlationId:pending.correlationId,
        start,afterInsertion:run.profileAfterInsertion,end:profileEnd,providerLatencyMs,
        checkpointPersistence:{status:checkpointReceipt.status,wallMs:checkpointWallMs,startAt:checkpointStart?.at??null,endAt:profileEnd?.at??null,heapDeltaBytes:checkpointStart&&profileEnd?profileEnd.heapBytes-checkpointStart.heapBytes:null},
        longTasks:this.longTaskEntries.filter(row=>row.startAt>=start?.at&&row.startAt<=end?.at).slice(-64).map(row=>({...row,phase:row.startAt>=(checkpointStart?.at??Infinity)?'CHECKPOINT_PERSISTENCE':row.startAt<(run.profileAfterInsertion?.at??end?.at)?'PRE_INSERTION':'PROVIDER_WAIT_OR_LEARNING'})),
        deltas:{
          heapBytes:delta(start?.heapBytes,end?.heapBytes),
          longTaskCount:delta(start?.longTaskCount,end?.longTaskCount),
          longTaskTotalMs:delta(start?.longTaskTotalMs,end?.longTaskTotalMs),
          diagnosticsUiRefreshCount:delta(start?.diagnosticsUiRefreshCount,end?.diagnosticsUiRefreshCount),
          diagnosticsUiRefreshTotalMs:delta(start?.diagnosticsUiRefreshTotalMs,end?.diagnosticsUiRefreshTotalMs),
        },
        rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
      },SESSION_BOUNDS.nativePerformance);
      if(captureState){captureState.status='AVAILABLE';captureState.updatedAt=Date.now();}
      const update={kind:'NativeBrainReceiptUpdate',stage:'HOST_PROFILE_COMPLETED',selection:{chatId,turnId:pending.turnId,generationId:pending.generationId,correlationId:pending.correlationId},rawPromptIncluded:false,rawResponseIncluded:false};
      for(const listener of this.profileListeners)try{listener(update);}catch{/* Observers cannot fail host completion. */}
    }
    this.#notify();return clone(completed);
  }

  async processCurrentTurn({ mode = null } = {}) {
    if (this.processing) return this.processing;
    this.processing = this.#processCurrentTurn({ mode })
      .catch((error) => {
        pushBounded(this.errors,{ at: Date.now(), message: safeDiagnosticMessage(error) },SESSION_BOUNDS.errors);
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
    this.processed.set(key, evidence);while(this.processed.size>SESSION_BOUNDS.processed)this.processed.delete(this.processed.keys().next().value);
    pushBounded(this.turnEvidence,evidence,SESSION_BOUNDS.turnEvidence);
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
      genericScenePolicyObserved: this.turnEvidence.some((row) => READY_SCENE_EXTRACTION_POLICIES.has(row.scene?.extractionPolicy)),
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

    const nativeContract=nativeBrainContract(this.nativeBrain),nativePrepared=this.nativeHistory.filter(row=>row.state==='SEALED_FOR_MODEL_REQUEST').length,nativeInjected=this.nativeHistory.filter(row=>row.state==='MODEL_REQUEST_PAYLOAD_INJECTED').length,nativeResponseCompleted=this.nativeHistory.filter(row=>row.state==='RESPONSE_COMPLETED'||row.state==='LEARNED').length,nativeLearned=this.nativeHistory.filter(row=>row.state==='LEARNED').length;
    const installedUiBindings=this.#uiHostBindings(),installedUiReaderNames=Object.entries(installedUiBindings).filter(([name,value])=>typeof value==='function'&&(name.startsWith('read')||name.startsWith('list')||name.startsWith('reconstruct'))).map(([name])=>name).sort();
    let selectedTurnReceipt=null,installedUiSceneReadModelKind=null;
    try{
      const selected=installedUiBindings.readSelection?.()??{};
      selectedTurnReceipt=installedUiBindings.readSelectedTurnReceipt?.(selected)??null;
      installedUiSceneReadModelKind=installedUiBindings.readScene?.(selected)?.kind??null;
    }catch{}
    const installedOptionalOwners={
      resources:Boolean(installedUiBindings.resourceHost??installedUiBindings.coprocessorResourceHost),
      loreStudy:Boolean(installedUiBindings.loreIntelligenceService??installedUiBindings.loreStudyService??installedUiBindings.loreOperatorHost??installedUiBindings.loreStudyHost),
      loreAuthoring:Boolean(installedUiBindings.loreAuthoringService??installedUiBindings.loreAuthoringHost??installedUiBindings.loreAuthoringOperator),
      memory:Boolean(installedUiBindings.memoryIntegrationSurface??installedUiBindings.memoryInterface??installedUiBindings.memoryOwner),
    };
    const nativeLearnedByChat={};for(const row of this.nativeHistory.filter(row=>row.state==='LEARNED'))nativeLearnedByChat[row.chatId]=(nativeLearnedByChat[row.chatId]??0)+1;
    const nativeResponseCompletedByChat={};for(const row of this.nativeHistory.filter(row=>row.state==='RESPONSE_COMPLETED'||row.state==='LEARNED'))nativeResponseCompletedByChat[row.chatId]=(nativeResponseCompletedByChat[row.chatId]??0)+1;
    const nativeMultiTurnChatIds=Object.entries(nativeResponseCompletedByChat).filter(([,count])=>count>=2).map(([chatId])=>chatId);
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
      loreStatus: clone((this.brain.readLoreStatusReference ?? this.brain.readLoreStatus)?.call(this.brain) ?? null),
      sceneMemoryLifecycle:{
        diagnostics:clone(this.brain.diagnostics?.()?.sceneMemory??null),
        receipts:clone(this.brain.readSceneMemoryLifecycleReceipts?.({limit:100})??[]),
        rawStoryTextCaptured:false,providerBodiesCaptured:false,credentialsCaptured:false,hiddenReasoningCaptured:false,
      },
      operatorReview: this.operatorReview,
      operatorLiveChecksCaptured,
      ui: uiDiagnostics,
      hostNarrativeFeed:{
        eventCount:this.hostNarrativeEvents.length,
        events:clone(this.hostNarrativeEvents.slice(-100)),
        rawTextCaptured:false,
        revisionMutationEvents:this.hostNarrativeEvents.filter(row=>row.revisionAffecting).length,
        chatBoundaryEvents:this.hostNarrativeEvents.filter(row=>row.chatBoundary).length,
        revisionReconciliations:clone(this.hostRevisionReconciliations.slice(-20)),
        revisionReconciliationCount:this.hostRevisionReconciliations.length,
      },
      nativeBrainIntegration:{
        ownerAvailable:nativeContract.available,reason:nativeContract.reason??null,preparedCount:nativePrepared,requestPayloadInjectedCount:nativeInjected,responseCompletedCount:nativeResponseCompleted,learnedCount:nativeLearned,
        installedUiReaderNames,installedUiSceneReadModelKind,installedOptionalOwners,
        pendingCount:this.nativePending.size,retainedDeliveryPayloadCount:this.nativePayloads.size,staleOrForeignCompletionRejected:this.nativeRejections.length,
        // Operator-visible lifecycle health (metadata only): a failed preparation or delivery and its
        // recovery must be visible instead of Area-52 silently contributing nothing.
        generationLifecycle:(()=>{
          const byReason={};for(const row of this.nativeRejections)byReason[row.code]=(byReason[row.code]??0)+1;
          const failures=this.errors.filter(row=>['NATIVE_PREPARE','NATIVE_MODEL_REQUEST','NATIVE_TEXT_PROMPT','NATIVE_COMPLETE'].includes(row.stage));
          const last=failures.at(-1)??null;
          return{activeRunCount:this.nativeRuns.size,releasedOrRejectedByReason:byReason,preparationOrDeliveryFailureCount:failures.length,
            lastFailure:last?{at:last.at,stage:last.stage,message:String(last.message??'').slice(0,240)}:null,
            recoveredAfterLastFailure:Boolean(last&&this.nativeHistory.some(row=>row.state==='RESPONSE_COMPLETED'&&Number(row.completedAt??0)>Number(last.at??0)))};
        })(),
        ownerKnowledgeAttachments:clone(this.nativeOwnerAttachments),loreRevisionInvalidations:clone(this.nativeLoreRevisionEvents),
        persistence:{configured:Boolean(this.persistNativeBrain||this.storage),storage:this.storage?{...this.storage.diagnostics(),restore:clone(this.storageRestore),storyBrainId:this.nativeBrainStoryId,liveStories:this.storyBrains.size}:null,last:clone(this.nativePersistence.at(-1)??null),persistedCount:this.nativePersistence.filter(x=>x.status==='PERSISTED').length},
        learnedByChat:clone(nativeLearnedByChat),responseCompletedByChat:clone(nativeResponseCompletedByChat),multiTurnObserved:nativeMultiTurnChatIds.length>0,multiTurnChatIds:nativeMultiTurnChatIds,
        exactPreparedRenderedObserved:nativeInjected>0,endToEndObserved:nativePrepared>0&&nativeInjected>0&&nativeResponseCompleted>0,endToEndResponseObserved:nativePrepared>0&&nativeInjected>0&&nativeResponseCompleted>0,endToEndLearningAccepted:nativeLearned>0,last:this.nativeHistory.at(-1)??null,rejections:clone(this.nativeRejections),
        sceneFanOut:{
          observedTurns:this.nativeHistory.filter(row=>row.sceneFanOutReceipt).length,
          physicalExecutionCount:this.nativeHistory.reduce((n,row)=>n+Number(row.sceneFanOutReceipt?.physicalExecutionCount??0),0),
          admittedResultCount:this.nativeHistory.reduce((n,row)=>n+(row.sceneFanOutReceipt?.admittedResultIds?.length??0),0),
          rejectedResultCount:this.nativeHistory.reduce((n,row)=>n+(row.sceneFanOutReceipt?.rejectedResultIds?.length??0),0),
          staleResultCount:this.nativeHistory.reduce((n,row)=>n+(row.sceneFanOutReceipt?.staleResultIds?.length??0),0),
          last:clone([...this.nativeHistory].reverse().find(row=>row.sceneFanOutReceipt)?.sceneFanOutReceipt??null),
          evidenceClass:'INSTALLED_HOST_BOUNDARY',authorityGranted:false,truthAuthority:false,contextSealAuthority:false,
        },
        selectedTurnReceipt:clone(selectedTurnReceipt),rawPromptCaptured:false,rawResponseCaptured:false,
      },
      uiProducerDiagnosticsAreRegistrationOnly: !nativeContract.available,
      loreOperatorEvidence,
      resourceOperatorEvidence,
      authoringOperatorEvidence,
      navigationEvidence,
      functionTestObservations,

      errors: clone(this.errors),
      runtimeLoad:this.loadDiagnostics(),
      liveEvidenceComplete: false,
      liveEvidenceCompleteReason: 'DIRECTOR_APPROVAL_AND_REQUIRED_LIVE_GATES_REMAIN_EXTERNAL_TO_THIS_RECORD',
    });
  }

  destroy() {
    this.destroyed=true;
    this.profileListeners.clear();
    if(this.notifyHandle!=null&&typeof globalThis.cancelAnimationFrame==='function')try{globalThis.cancelAnimationFrame(this.notifyHandle);}catch{}
    this.notifyHandle=null;this.notifyScheduled=false;
    this.stop();
    if(this.nativePending.size)this.#expireNativePending('SESSION_DESTROYED');
    this.uiHost?.destroy?.();
    this.uiHost = null;
    this.releaseLoreOwnerEvents?.();
    this.releaseLoreOwnerEvents = null;
  }

  async #persistNativeBrainCheckpoint({chatId,turnId,generationId}={}){
    if((!this.persistNativeBrain&&!this.storage)||typeof this.nativeBrain?.snapshot!=='function'){
      const row={at:Date.now(),chatId,turnId,generationId,status:'NOT_CONFIGURED'};this.nativePersistence.push(row);if(this.nativePersistence.length>100)this.nativePersistence.shift();return row;
    }
    try{
      const snapshot=this.nativeBrain.snapshot();
      const brainBindings=typeof this.brain?.hostBindings==='function'?this.brain.hostBindings():{};
      const snapshotMemoryOwner=brainBindings?.snapshotMemoryOwner??(typeof this.brain?.snapshotMemoryOwner==='function'?()=>this.brain.snapshotMemoryOwner():null);
      const memoryOwnerSnapshot=typeof snapshotMemoryOwner==='function'?snapshotMemoryOwner():null;
      // The Lore owner (accepted books, study, story binding) is large; persist it only when it changed.
      const loreOwnerRevisionKey=typeof brainBindings?.loreOwnerRevisionKey==='function'?brainBindings.loreOwnerRevisionKey():(typeof this.brain?.loreOwnerRevisionKey==='function'?this.brain.loreOwnerRevisionKey():null);
      const snapshotLoreOwner=brainBindings?.snapshotLoreOwner??(typeof this.brain?.snapshotLoreOwner==='function'?()=>this.brain.snapshotLoreOwner():null);
      const loreChanged=Boolean(snapshotLoreOwner)&&loreOwnerRevisionKey!==this.lastPersistedLoreOwnerKey;
      const loreOwnerSnapshot=loreChanged?snapshotLoreOwner():undefined;
      if(this.persistNativeBrain)await this.persistNativeBrain({chatId,turnId,generationId,snapshot,memoryOwnerSnapshot,loreOwnerRevisionKey,...(loreChanged?{loreOwnerSnapshot}:{})});
      let storageRow=null;
      if(this.storage){
        // One story per key, owners once. A failed owner write after a successful story write is reported and
        // retried at the next checkpoint (the Lore key is only advanced on success).
        const story=await this.storage.saveStory(chatId,{...packBrainSnapshot(snapshot),host:this.#hostStateFor(chatId)});
        const snapshotSceneOwner=brainBindings?.snapshotSceneOwner??(typeof this.brain?.snapshotSceneOwner==='function'?()=>this.brain.snapshotSceneOwner():null);
        const owners=await this.storage.saveOwners({memory:memoryOwnerSnapshot??undefined,scene:typeof snapshotSceneOwner==='function'?snapshotSceneOwner():undefined,...(loreChanged?{lore:loreOwnerSnapshot}:{})});
        storageRow={storyGeneration:story.generation,ownersGeneration:owners.generation,storyBytes:story.bytes,ownersBytes:owners.bytes};
      }
      if(loreChanged)this.lastPersistedLoreOwnerKey=loreOwnerRevisionKey;
      const row={at:Date.now(),chatId,turnId,generationId,status:'PERSISTED',...(storageRow?{storage:storageRow}:{})};this.nativePersistence.push(row);if(this.nativePersistence.length>100)this.nativePersistence.shift();return row;
    }catch(error){
      const row={at:Date.now(),chatId,turnId,generationId,status:'FAILED',reason:safeDiagnosticMessage(error)};this.nativePersistence.push(row);if(this.nativePersistence.length>100)this.nativePersistence.shift();return row;
    }
  }

  #attachNativeKnowledgeOwners(){
    if(!this.nativeBrain)return;
    const brainBindings=typeof this.brain?.hostBindings==='function'?this.brain.hostBindings():{};
    const mergedOwners={...brainBindings,...this.ownerBindings};
    const loreService=mergedOwners.loreIntelligenceService??mergedOwners.loreStudyService??null;
    const loreInterface=mergedOwners.loreBrainInterface??(typeof loreService?.brainInterface==='function'?loreService.brainInterface():null);
    const memoryInterface=mergedOwners.memoryIntegrationSurface??mergedOwners.memoryInterface??mergedOwners.memoryOwner??null;
    const memoryConsolidationInterface=mergedOwners.memoryConsolidationProducer??mergedOwners.memoryConsolidationInterface??null;
    const graphProviders=Array.isArray(mergedOwners.graphProviders)?mergedOwners.graphProviders.filter(Boolean):[];

    if(typeof this.nativeBrain.attachLoreInterface==='function'){
      try{const receipt=this.nativeBrain.attachLoreInterface(loreInterface??null);this.nativeOwnerAttachments.lore={attached:Boolean(receipt?.attached),contractVersion:receipt?.contractVersion??loreInterface?.contractVersion??null};}
      catch(error){this.nativeOwnerAttachments.lore={attached:false,error:String(error?.code??error?.message??error)};}
    }
    if(typeof this.nativeBrain.attachMemoryInterface==='function'){
      try{const receipt=this.nativeBrain.attachMemoryInterface(memoryInterface??null);this.nativeOwnerAttachments.memory={attached:Boolean(receipt?.attached),contractVersion:receipt?.contractVersion??memoryInterface?.contractVersion??null};}
      catch(error){this.nativeOwnerAttachments.memory={attached:false,error:String(error?.code??error?.message??error)};}
    }
    if(typeof this.nativeBrain.attachMemoryConsolidationInterface==='function'){
      try{
        const receipt=this.nativeBrain.attachMemoryConsolidationInterface(memoryConsolidationInterface??null);
        this.nativeOwnerAttachments.memoryConsolidation={attached:Boolean(receipt?.attached),contractVersion:receipt?.contractVersion??memoryConsolidationInterface?.contractVersion??null};
      }catch(error){this.nativeOwnerAttachments.memoryConsolidation={attached:false,error:String(error?.code??error?.message??error)};}
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
    if(typeof this.nativeBrain.startBackgroundLearning==='function')this.nativeBrain.startBackgroundLearning({maxCycles:128});

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
    return createJevDecisionResourceHostBridge(host,{fetchImpl:globalThis.fetch});
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
    base.readNativeBrainHostLifecycle=()=>({kind:'NativeBrainHostLifecycle',ownerAvailable:contract.available,reason:contract.reason??null,pending:this.nativePending.size,prepared:this.nativeHistory.filter(x=>x.state==='SEALED_FOR_MODEL_REQUEST').length,requestPayloadInjected:this.nativeHistory.filter(x=>x.state==='MODEL_REQUEST_PAYLOAD_INJECTED').length,responseCompleted:this.nativeHistory.filter(x=>x.state==='RESPONSE_COMPLETED'||x.state==='LEARNED').length,learned:this.nativeHistory.filter(x=>x.state==='LEARNED').length,rejected:this.nativeRejections.length});
    base.readHostDeliveryReceipt=(selection={})=>this.#readHostDeliveryReceipt(selection);
    base.readNativeGenerationPerformance=(selection={})=>this.#readNativeGenerationPerformance(selection);
    base.setDetailedGenerationProfiling=(enabled=false)=>this.setDetailedGenerationProfiling(enabled);
    base.loadDiagnostics=()=>this.loadDiagnostics();
    if(!contract.available)return base;
    const native=this.nativeBrain.uiBindings();
    const nativeKeys=['readSelection','readScene','readHotCognition','readCognitiveChoice','readScatter','readSensoryTrace','readCandidateBusEnvelope','readCandidateFusionReceipt','readIdentityResolution','readGraphTraversal','readWorldGraphReferences','readRetrievalBudget','readRejectedEvidence','readTruth','readCorrectiveRetrieval','readJev','readPrecision','readGather','readContextSeal','readLoreStatus','readMemoryStatus','readRuntimeStatus','readExpectedWork','readPromptPlan','readContextRetirement','readPromptDeliveryReceipt','readContextReceipt','readSelectedTurnReceipt','listGenerations','readGeneration'];
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
    }else if(typeof this.brain?.runLoreStudyBatched==='function'){
      // The operator's "Run study" action goes through yielding, checkpointed Runtime batches (async), not the
      // one-shot synchronous call kept for rehearsal and tests.
      const batched=(input)=>this.brain.runLoreStudyBatched(input??{});
      const hostKey=['loreStudyHost','loreOperatorHost','loreHost'].find(key=>merged[key]&&typeof merged[key]?.actions?.runLoreStudy==='function');
      if(hostKey)merged[hostKey]={...merged[hostKey],actions:{...merged[hostKey].actions,runLoreStudy:batched,startLoreStudy:batched}};
      if(typeof merged.runLoreStudy==='function')merged.runLoreStudy=batched;
    }

    const authoringHost=this.#nativeAwareLoreAuthoringHost();
    if(authoringHost)merged.loreAuthoringHost=authoringHost;
    else{
      delete merged.loreAuthoringHost;delete merged.loreAuthoringOperator;
    }
    for(const key of nativeKeys)if(typeof native?.[key]==='function')merged[key]=native[key];
    const selectedSceneReader=typeof merged.readScene==='function'?merged.readScene:null;
    if(selectedSceneReader)merged.readScene=(selection={})=>{
      const model=selectedSceneReader(selection);if(!model||model.kind!=='SceneUiReadModel')return null;
      if(selection?.chatId&&model.chatId&&String(model.chatId)!==String(selection.chatId))return null;
      const modelSceneRevision=model.sceneRevision??model.revision??null;
      if(selection?.sceneRevision!=null&&modelSceneRevision!=null&&Number(modelSceneRevision)!==Number(selection.sceneRevision))return null;
      const expectedRefs=new Set((selection?.sourceRevisionRefs??[]).map(String)),actualRefs=[...(model.sourceRevisionRefs??[])].map(String);
      if(expectedRefs.size&&actualRefs.some(ref=>!expectedRefs.has(ref)))return null;
      return{...clone(model),chatId:selection?.chatId??model.chatId??null,turnId:selection?.turnId??model.turnId??null,generationId:selection?.generationId??model.generationId??null,correlationId:selection?.correlationId??model.correlationId??null,sceneRevision:modelSceneRevision};
    };
    const nativeSelectedTurnReader=typeof merged.readSelectedTurnReceipt==='function'?merged.readSelectedTurnReceipt:null;
    if(nativeSelectedTurnReader)merged.readSelectedTurnReceipt=(selection={})=>{
      const owner=nativeSelectedTurnReader(selection);if(!owner)return null;
      const expectedPromptPlanId=owner.delivery?.planned?.promptPlanId??null;
      const expectedContextSealId=owner.delivery?.compiled?.contextSealId??owner.delivery?.planned?.contextSealId??null;
      const host=this.#readHostDeliveryReceipt({...owner,...selection});
      const identityMatches=Boolean(host)
        &&(!expectedPromptPlanId||host.promptPlanId===expectedPromptPlanId)
        &&(!expectedContextSealId||host.contextSealId===expectedContextSealId);
      const observed=Boolean(host?.hostObserved)&&identityMatches;
      const sceneReadModel=merged.readScene({...owner,...selection});
      const sceneReadMatches=Boolean(sceneReadModel?.kind==='SceneUiReadModel')
        &&sceneReadModel.chatId===owner.chatId
        &&Number(sceneReadModel.revision)===Number(owner.sceneRevision)
        &&(owner.sourceRevisions?.sceneRefs??[]).every(ref=>(sceneReadModel.sourceRevisionRefs??[]).includes(ref));
      const hostObserved=observed?{
        state:'OBSERVED',receiptId:host.receiptId??null,lifecycleState:host.state??null,requestHook:host.requestHook??null,
        requestInjectedAt:host.requestInjectedAt??null,completedAt:host.completedAt??null,promptPlanId:host.promptPlanId??null,contextSealId:host.contextSealId??null,
        requestPayloadDigest:host.requestPayloadDigest??null,renderedPayloadDigest:host.renderedPayloadDigest??null,
      }:{
        state:'UNAVAILABLE',
        reason:host?.hostObserved&&!identityMatches?'SILLYTAVERN_HOST_DELIVERY_IDENTITY_MISMATCH':host?.observationReason??'SILLYTAVERN_HOST_REQUEST_NOT_OBSERVED',
        receiptId:host?.receiptId??null,lifecycleState:host?.state??null,
        expectedPromptPlanId,observedPromptPlanId:host?.promptPlanId??null,
        expectedContextSealId,observedContextSealId:host?.contextSealId??null,
      };
      const readModelEdge=sceneReadMatches?{
        state:'PUBLISHED',kind:sceneReadModel.kind,sceneId:sceneReadModel.sceneId,sceneRevision:sceneReadModel.revision,
        sourceRevisionRefs:[...(sceneReadModel.sourceRevisionRefs??[])].slice(0,32),
      }:{state:'UNAVAILABLE',reason:sceneReadModel?'SCENE_READ_MODEL_FENCE_MISMATCH':'SCENE_READ_MODEL_UNAVAILABLE'};
      return{
        ...owner,
        sceneFlow:{
          ...(owner.sceneFlow??{}),readModel:readModelEdge,hostDelivery:hostObserved,
          semanticObservation:(()=>{
            const rows=this.brain?.readSceneObservationReceipts?.({limit:128})??[];
            const matching=rows.filter(row=>
              (!owner.chatId||row?.chatId===owner.chatId)&&(!owner.turnId||row?.turnId===owner.turnId)&&(!owner.generationId||row?.generationId===owner.generationId)
            );
            const execution=[...matching].reverse().find(row=>row?.kind==='DeploymentSceneObservationExecutionReceipt')??null;
            const ownerAdmission=[...matching].reverse().find(row=>row?.kind==='DeploymentSceneObservationOwnerReceipt')??null;
            return execution||ownerAdmission?{execution:clone(execution),ownerAdmission:clone(ownerAdmission)}:null;
          })(),
        },
        sceneFences:{...(owner.sceneFences??{}),sceneReadModelMatchesSelection:sceneReadMatches},
        delivery:{...(owner.delivery??{}),hostObserved},
        hostDeliveryReceiptId:host?.receiptId??null,
        hostDetailedProfile:this.#readNativeGenerationPerformance(owner),
      };
    };
    const baseSubscribe=base.subscribe,nativeSubscribe=native?.subscribe;
    merged.subscribe=(listener)=>{const releases=[];if(typeof baseSubscribe==='function')releases.push(baseSubscribe(listener));if(typeof nativeSubscribe==='function')releases.push(nativeSubscribe(listener));this.profileListeners.add(listener);return()=>{this.profileListeners.delete(listener);for(const release of releases)try{release?.();}catch{}};};
    merged.readNativeBrainHostLifecycle=base.readNativeBrainHostLifecycle;
    merged.readHostDeliveryReceipt=base.readHostDeliveryReceipt;
    merged.readNativeGenerationPerformance=base.readNativeGenerationPerformance;
    return merged;
  }

  #readNativeGenerationPerformance(selection={}){
    const generationId=clean(selection?.generationId),chatId=clean(selection?.chatId),turnId=clean(selection?.turnId),correlationId=clean(selection?.correlationId);
    if(!generationId)return null;
    const row=[...this.nativePerformance].reverse().find(item=>item?.generationId===generationId&&(!chatId||item.chatId===chatId)&&(!turnId||item.turnId===turnId)&&(!correlationId||item.correlationId===correlationId))??null;
    return row?clone(row):null;
  }

  #readHostDeliveryReceipt(selection={}){
    const generationId=clean(selection?.generationId),chatId=clean(selection?.chatId),turnId=clean(selection?.turnId);
    if(!generationId)return null;
    const row=[...this.nativeHistory].reverse().find(item=>item?.generationId===generationId&&(!chatId||item.chatId===chatId)&&(!turnId||item.turnId===turnId))??null;
    const rejection=[...this.nativeRejections].reverse().find(item=>item?.generationId===generationId&&(!chatId||item.chatId===chatId)&&(!turnId||item.turnId===turnId))??null;
    if(!row&&!rejection)return null;
    const source=row??rejection,aborted=Boolean(rejection)&&String(row?.state??'')!=='LEARNED';
    return {
      kind:'SillyTavernHostDeliveryReceipt',contractVersion:1,receiptId:'host-delivery:'+generationId,
      chatId:source.chatId??chatId,turnId:source.turnId??turnId,generationId,
      state:aborted?'ABORTED':row?.state??'UNVERIFIED',promptPlanId:row?.promptPlanId??null,contextSealId:row?.contextSealId??null,
      preparedAt:row?.preparedAt??null,requestInjectedAt:row?.requestInjectedAt??null,completedAt:row?.completedAt??null,requestHook:row?.requestHook??null,
      renderedPayloadDigest:row?.renderedPayloadDigest??null,requestPayloadDigest:row?.requestPayloadDigest??null,renderedMessageCount:row?.renderedMessageCount??null,
      promptInjected:Boolean(row?.requestInjectedAt),hostObserved:Boolean(row?.requestInjectedAt),observationState:row?.requestInjectedAt?'OBSERVED':'UNAVAILABLE',
      observationReason:row?.requestInjectedAt?null:(aborted?String(rejection?.code??'HOST_GENERATION_ABORTED'):'SILLYTAVERN_HOST_REQUEST_NOT_OBSERVED'),
      responseCompleted:Boolean(row?.completedAt),learningObserved:Boolean(row?.state==='LEARNED'&&row?.learning),abortCode:aborted?String(rejection?.code??'HOST_GENERATION_ABORTED'):null,
      rawPromptIncluded:false,storyTextIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
    };
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
      catch(error){pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'LORE_REVISION_INVALIDATION_ROUTE',sourceId:event.sourceId,sourceRevisionId:event.sourceRevisionId},SESSION_BOUNDS.errors);}
    }
  }

  #hostStateFor(chatId){
    const prefix=String(chatId)+'|';
    return{
      kind:'InstalledHostState',version:1,chatId:String(chatId),
      hostAssistantTurns:[...this.hostAssistantTurns.entries()].filter(([,row])=>row.chatId===chatId).map(([key,row])=>[key,clone(row)]),
      sceneHostMessageState:[...this.sceneHostMessageState.entries()].filter(([key])=>key.startsWith(prefix)).map(([key,row])=>[key,clone(row)]),
    };
  }

  // Waits for the durable writes queued so far (tests, orderly shutdown).
  async flushPersistence(){await this.storage?.flush?.();}

  // One Brain per story. The attached brain serves exactly one chat; a chat switch attaches that chat's own
  // brain (live in this session, restored from storage, or fresh), so nothing learned in one story is reachable
  // from another. Without storage the single injected brain is kept (its registries are story-scoped instead).
  async #ensureStoryBrain(chatId){
    if(!this.storage||!chatId||!this.nativeBrain)return;
    if(this.nativeBrainStoryId==null){this.nativeBrainStoryId=chatId;this.storyBrains.set(chatId,this.nativeBrain);return;}
    if(this.nativeBrainStoryId===chatId)return;
    const from=this.nativeBrainStoryId,receipt={kind:'StoryBrainSwitchReceipt',at:Date.now(),from,to:chatId,source:'LIVE',storage:null,error:null};
    try{await this.#persistNativeBrainCheckpoint({chatId:from,turnId:null,generationId:null});}catch{/* best effort: every completed turn already checkpointed */}
    let next=this.storyBrains.get(chatId)??null;
    if(!next){
      const loaded=await this.storage.loadStory(chatId);receipt.storage=loaded.status;
      const brainClass=this.nativeBrain.constructor;
      const storedBrain=unpackBrainSnapshot(loaded.parts);
      if(storedBrain&&typeof brainClass.fromSnapshot==='function'){
        try{next=brainClass.fromSnapshot(storedBrain);receipt.source='STORAGE';}
        catch(error){receipt.error=safeDiagnosticMessage(error);next=null;}
      }
      if(loaded.parts.host?.kind==='InstalledHostState'){
        for(const [key,row] of loaded.parts.host.hostAssistantTurns??[])this.hostAssistantTurns.set(key,clone(row));
        for(const [key,row] of loaded.parts.host.sceneHostMessageState??[])this.sceneHostMessageState.set(key,clone(row));
      }
      if(!next){next=new brainClass();receipt.source=receipt.error?'FRESH_AFTER_REJECTED_SNAPSHOT':'FRESH';}
      this.storyBrains.set(chatId,next);
    }
    this.nativeBrain=next;this.nativeBrainStoryId=chatId;
    this.#attachNativeKnowledgeOwners();
    if(this.uiHost){this.uiHost.destroy?.();this.uiHost=null;this.mount();}
    this.storageRestore={...this.storageRestore,lastSwitch:receipt};
    this.#notify();
  }

  // Host history is the authority on which messages exist. Anything learned from a message that was
  // deleted, or whose text changed, is retired or superseded at the owner that holds it: Core source
  // registry (dependent artifacts), Scene NarrativeFeed (revision evidence) and the Native Brain turn
  // narrative (claims, Hot tail, Memory mapping). Source history is preserved; nothing is erased.
  #reconcileHostRevisions(cause){
    let context;try{context=this.getContext();}catch{return null;}
    const chatId=clean(context?.chatId),registry=this.brain?.core?.registry;
    if(!chatId||!registry||typeof registry.listSources!=='function')return null;
    const chat=Array.isArray(context.chat)?context.chat:[],live=new Map(),byKey=new Map();
    chat.forEach((row,index)=>{
      const text=clean(row?.mes??row?.content??row?.text);if(!text)return;
      const message={index,row,text},identity=sourceIdentity(chatId,message);
      live.set(identity.sourceId,message);byKey.set(identity.messageKey,{message,identity});
    });
    const receipt={kind:'HostRevisionReconciliation',cause:String(cause),chatId,at:Date.now(),retiredSources:[],sceneEvents:[],nativeTurns:[],errors:[]};
    const fail=(stage,error)=>{receipt.errors.push({stage,message:safeDiagnosticMessage(error)});pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'HOST_REVISION_'+stage},SESSION_BOUNDS.errors);};
    for(const source of registry.listSources()){
      const meta=source.metadata??{};
      if(meta.host!=='SILLYTAVERN'||meta.chatId!==chatId||live.has(source.id)||registry.isSourceRetired(source.id))continue;
      const key=String(meta.messageId??''),replacement=byKey.get(key)??null,edited=Boolean(replacement);
      try{
        const retired=registry.retireSource(source.id,{reason:edited?'HOST_MESSAGE_EDITED':'HOST_MESSAGE_DELETED'});
        receipt.retiredSources.push({sourceId:source.id,messageKey:key,reason:edited?'HOST_MESSAGE_EDITED':'HOST_MESSAGE_DELETED',invalidatedArtifactCount:(retired?.invalidatedArtifactIds??[]).length});
      }catch(error){fail('CORE_RETIRE',error);}
      try{
        const hasFeedEvidence=(this.brain.scene?.narrativeFeed?.currentEvidence?.(chatId)??[]).some(row=>String(row.messageId)===key);
        if(hasFeedEvidence&&typeof this.brain.ingestSceneHostEvent==='function'){
          const stateKey=chatId+'|'+key,prior=this.sceneHostMessageState.get(stateKey)??null,messageRevision=(prior?.messageRevision??1)+1;
          const activity=edited?HostActivity.EDIT:HostActivity.DELETE;
          this.brain.ingestSceneHostEvent({
            activity,chatId,messageId:key,messageRevision,hostEventId:'st-revision:'+chatId+':'+source.id+':'+activity,
            turnId:'host-revision:'+chatId+':'+key+':'+messageRevision,correlationId:'corr:host-revision:'+source.id,
            role:meta.role==='assistant'?'assistant':'user',...(edited?{content:replacement.message.text}:{}),
          });
          this.sceneHostMessageState.set(stateKey,{messageRevision,digest:edited?replacement.identity.digest:null,activity,messageKey:key});
          receipt.sceneEvents.push({activity,messageKey:key,messageRevision});
        }
      }catch(error){fail('SCENE_FEED',error);}
    }
    for(const [sourceId,entry] of [...this.hostAssistantTurns.entries()]){
      if(entry.chatId!==chatId||live.has(sourceId))continue;
      const replacement=byKey.get(entry.messageKey)??null;
      const superseded=replacement&&[...this.hostAssistantTurns.values()].some(other=>other!==entry&&other.chatId===chatId&&other.messageKey===entry.messageKey&&other.digest===replacement.identity.digest);
      try{
        if(replacement&&!superseded&&typeof this.nativeBrain?.correctTurn==='function'){
          this.nativeBrain.correctTurn({turnId:entry.turnId,response:replacement.message.text});
          this.hostAssistantTurns.delete(sourceId);
          this.hostAssistantTurns.set(replacement.identity.sourceId,{...entry,digest:replacement.identity.digest});
          receipt.nativeTurns.push({turnId:entry.turnId,action:'CORRECTED'});
        }else if(typeof this.nativeBrain?.retireTurnNarrative==='function'){
          this.nativeBrain.retireTurnNarrative(entry.turnId,{reason:superseded?'HOST_MESSAGE_SUPERSEDED':'HOST_MESSAGE_DELETED'});
          this.hostAssistantTurns.delete(sourceId);
          receipt.nativeTurns.push({turnId:entry.turnId,action:superseded?'SUPERSEDED':'RETIRED'});
        }
      }catch(error){fail('NATIVE_TURN',error);}
    }
    if(!receipt.retiredSources.length&&!receipt.nativeTurns.length&&!receipt.errors.length)return null;
    pushBounded(this.hostRevisionReconciliations,receipt,100);
    return receipt;
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
    if(chatBoundary&&this.storage&&chatId){this.storyBrainReady=this.storyBrainReady.then(()=>this.#ensureStoryBrain(chatId)).catch(error=>{pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'STORY_BRAIN_SWITCH'},SESSION_BOUNDS.errors);});}
    if(revisionAffecting)this.#reconcileHostRevisions(eventType);
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
      pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'OPTIONAL_RESOURCE_GENERATION_BEGIN',turnId:pending?.turnId??null,generationId:pending?.generationId??null},SESSION_BOUNDS.errors);
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
      pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'OPTIONAL_RESOURCE_GENERATION_COMPLETE',turnId:pending?.turnId??null,generationId:pending?.generationId??null},SESSION_BOUNDS.errors);
      return null;
    }
  }

  #completeAllOptionalGenerations(reason='SESSION_STOPPED'){
    for(const row of [...this.optionalGenerationActive.values()])this.#completeOptionalGeneration(row.pending,reason);
  }

  /** Release one native run and its pending/payload rows, only if `run` is still the current run
   *  for `chatId`. A late cleanup of a superseded run cannot erase a newer generation. */
  releaseNativeRun(chatId,run,reason='NATIVE_RUN_RELEASED'){
    const key=String(chatId??'');if(!key||!run||this.nativeRuns.get(key)!==run)return false;
    const pending=this.nativePending.get(key)??null;
    if(!pending||pending.turnId===run.turnId){
      this.nativeRejections.push({at:Date.now(),code:String(reason),chatId:key,generationId:run.generationId??pending?.generationId??null,turnId:run.turnId??pending?.turnId??null});
      while(this.nativeRejections.length>100)this.nativeRejections.shift();
      try{run.responseReject?.(new Error(String(reason)));}catch{}
      if(pending)this.#completeOptionalGeneration(pending,String(reason));
      this.nativePending.delete(key);this.nativePayloads.delete(key);
    }
    this.nativeRuns.delete(key);this.#notify();return true;
  }

  #expireNativePending(reason){
    for(const [chatId,run] of [...this.nativeRuns.entries()])if(!this.nativePending.has(chatId))this.releaseNativeRun(chatId,run,reason);
    for(const [chatId,row] of [...this.nativePending.entries()]){
      this.nativeRejections.push({at:Date.now(),code:String(reason),chatId,generationId:row.generationId,turnId:row.turnId});
      const run=this.nativeRuns.get(chatId);try{run?.responseReject?.(new Error(String(reason)));}catch{}
      this.#completeOptionalGeneration(row,String(reason));
      this.nativePending.delete(chatId);this.nativePayloads.delete(chatId);this.nativeRuns.delete(chatId);
    }
    while(this.nativeRejections.length>100)this.nativeRejections.shift();this.#notify();
  }

  loadDiagnostics(){
    return clone({
      kind:'DevelopmentDeploymentLoadDiagnostics',contractVersion:1,running:this.running,hostListenerCount:this.hostListenerCount,
      notification:{requested:this.loadMetrics.notifyRequested,delivered:this.loadMetrics.notifyDelivered,coalesced:this.loadMetrics.notifyCoalesced,lastMs:this.loadMetrics.lastNotifyMs,maxMs:this.loadMetrics.notifyMaxMs,totalMs:this.loadMetrics.notifyTotalMs},
      longTasks:{supported:Boolean(globalThis.PerformanceObserver?.supportedEntryTypes?.includes?.('longtask')),count:this.loadMetrics.longTaskCount,totalMs:this.loadMetrics.longTaskTotalMs,maxMs:this.loadMetrics.longTaskMaxMs},
      heap:{supported:Number.isFinite(Number(globalThis.performance?.memory?.usedJSHeapSize)),minBytes:this.loadMetrics.heapMinBytes,maxBytes:this.loadMetrics.heapMaxBytes,lastBytes:this.loadMetrics.heapLastBytes},
      retained:{turnEvidence:this.turnEvidence.length,processed:this.processed.size,hostNarrativeEvents:this.hostNarrativeEvents.length,nativeHistory:this.nativeHistory.length,nativeRejections:this.nativeRejections.length,nativePerformance:this.nativePerformance.length,nativeDeliveryPayloads:this.nativePayloads.size,loreIngestion:this.loreIngestion.length,errors:this.errors.length,optionalGenerations:this.optionalGenerationActive.size},
      generationProfiling:{detailedEnabled:this.detailedGenerationProfiling,retainedProfiles:this.nativePerformance.length,latest:this.nativePerformance.at(-1)??null,captureStates:this.profileCaptureStates},
      bounds:clone(SESSION_BOUNDS),rawPromptCaptured:false,storyTextCaptured:false,credentialsCaptured:false,hiddenReasoningCaptured:false,
    });
  }

  #generationProfileSample(){
    if(!this.detailedGenerationProfiling)return null;
    this.#recordLongTasks(this.longTaskObserver?.takeRecords?.()??[]);
    const heap=Number(globalThis.performance?.memory?.usedJSHeapSize);
    return{
      at:Date.now(),heapBytes:Number.isFinite(heap)?heap:null,
      longTaskCount:this.loadMetrics.longTaskCount,longTaskTotalMs:this.loadMetrics.longTaskTotalMs,longTaskMaxMs:this.loadMetrics.longTaskMaxMs,
      diagnosticsUiRefreshCount:this.loadMetrics.notifyDelivered,
      diagnosticsUiRefreshTotalMs:this.loadMetrics.notifyTotalMs,
      diagnosticsUiRefreshMaxMs:this.loadMetrics.notifyMaxMs,
      diagnosticsUiRefreshLastMs:this.loadMetrics.lastNotifyMs,
    };
  }

  #startLoadObserver(){
    if(this.longTaskObserver||typeof globalThis.PerformanceObserver!=='function'||!globalThis.PerformanceObserver.supportedEntryTypes?.includes?.('longtask'))return;
    try{
      this.longTaskObserver=new globalThis.PerformanceObserver((list)=>{
        this.#recordLongTasks(list.getEntries?.()??[]);
      });
      this.longTaskObserver.observe({type:'longtask',buffered:true});
    }catch{this.longTaskObserver=null;}
  }

  #recordLongTasks(rows){
    for(const row of rows){
      const duration=Number(row.duration)||0;
      this.loadMetrics.longTaskCount+=1;this.loadMetrics.longTaskTotalMs+=duration;this.loadMetrics.longTaskMaxMs=Math.max(this.loadMetrics.longTaskMaxMs,duration);
      if(this.detailedGenerationProfiling){
        const origin=Number(globalThis.performance?.timeOrigin);
        if(Number.isFinite(origin)&&Number.isFinite(Number(row.startTime)))pushBounded(this.longTaskEntries,{startAt:origin+Number(row.startTime),durationMs:duration},64);
      }
    }
  }

  #stopLoadObserver(){try{this.longTaskObserver?.disconnect?.();}catch{}this.longTaskObserver=null;}

  #sampleHeap(){
    const bytes=Number(globalThis.performance?.memory?.usedJSHeapSize);
    if(!Number.isFinite(bytes))return;
    this.loadMetrics.heapLastBytes=bytes;this.loadMetrics.heapMinBytes=this.loadMetrics.heapMinBytes==null?bytes:Math.min(this.loadMetrics.heapMinBytes,bytes);this.loadMetrics.heapMaxBytes=this.loadMetrics.heapMaxBytes==null?bytes:Math.max(this.loadMetrics.heapMaxBytes,bytes);
  }

  #notify() {
    this.loadMetrics.notifyRequested+=1;
    if(!this.onEvidence||this.destroyed)return;
    if(this.notifyScheduled){this.loadMetrics.notifyCoalesced+=1;return;}
    this.notifyScheduled=true;
    const deliver=()=>{
      if(!this.notifyScheduled||this.destroyed)return;
      this.notifyScheduled=false;this.notifyHandle=null;
      const started=perfNow();this.#sampleHeap();
      try{this.onEvidence(this.exportEvidence());}catch(error){pushBounded(this.errors,{at:Date.now(),message:safeDiagnosticMessage(error),stage:'EVIDENCE_CALLBACK'},SESSION_BOUNDS.errors);}
      const elapsed=Math.max(0,perfNow()-started);this.loadMetrics.notifyDelivered+=1;this.loadMetrics.lastNotifyMs=elapsed;this.loadMetrics.notifyTotalMs+=elapsed;this.loadMetrics.notifyMaxMs=Math.max(this.loadMetrics.notifyMaxMs,elapsed);this.#sampleHeap();
    };
    if(typeof globalThis.requestAnimationFrame==='function')this.notifyHandle=globalThis.requestAnimationFrame(deliver);
    else if(typeof globalThis.queueMicrotask==='function')globalThis.queueMicrotask(deliver);
    else Promise.resolve().then(deliver);
  }
}

export function createDevelopmentDeploymentSillyTavernSession(options) {
  return new DevelopmentDeploymentSillyTavernSession(options);
}
