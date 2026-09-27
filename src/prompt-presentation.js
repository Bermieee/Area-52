import { deliveryHash } from './adaptive-context-contracts.js';

const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(value=>value!==null&&value!==undefined).map(String))].sort();
const bounded=(values,limit=64)=>Array.isArray(values)?values.slice(0,limit):[];

function semanticIdentity(plan,sealedPacket=null){
  if(sealedPacket&&typeof sealedPacket==='object'){
    const semanticPacket={
      current:clone(sealedPacket.current??[]),historical:clone(sealedPacket.historical??[]),
      unresolved:clone(sealedPacket.unresolved??[]),activeThreads:clone(sealedPacket.activeThreads??[]),
      relevantLore:clone(sealedPacket.relevantLore??[]),episodicMemory:clone(sealedPacket.episodicMemory??[]),
      dependencies:uniq(sealedPacket.dependencies??[]),
    };
    return deliveryHash(semanticPacket);
  }
  const entries=(plan?.sections??[]).flatMap(section=>section.semanticManifest??[]).map(row=>({
    semanticKey:String(row.semanticKey??''),
    authorityClass:row.authorityClass??null,
    temporalStatus:row.temporalStatus??null,
    sourceRevisionIds:uniq(row.sourceRevisionIds??[]),
  })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return deliveryHash(entries);
}

function plannedSections(plan,rendered){
  const bySlot=new Map((rendered?.messageMap??[]).map(row=>[row.slot,row]));
  return bounded((plan?.sections??[]).map(section=>{
    const mapped=bySlot.get(section.slot)??{};
    return{
      slot:section.slot,
      sectionIdentity:section.sectionIdentity??mapped.sectionIdentity??null,
      owner:section.owner??mapped.owner??null,
      priority:Number(section.priority??mapped.priority??0),
      semanticRole:section.role??mapped.semanticRole??null,
      providerRole:mapped.providerRole??null,
      representation:section.representation??mapped.representation??null,
      segmentBand:mapped.segmentBand??section.band??null,
      sourceRevisionIds:uniq(section.sourceRevisionIds??mapped.sourceRevisionIds??[]),
      provenanceSourceRevisionIds:uniq(section.sourceRevisionIds??mapped.sourceRevisionIds??[]),
      semanticManifestIdentity:deliveryHash(section.semanticManifest??[]),
    };
  }));
}

function identityMismatches(receipt,evidence){
  return [
    ['chatId',receipt?.chatId,evidence?.chatId],
    ['turnId',receipt?.turnId,evidence?.turnId],
    ['generationId',receipt?.generationId,evidence?.generationId],
    ['correlationId',receipt?.correlationId,evidence?.correlationId],
    ['contextSealId',receipt?.contextSealId,evidence?.contextSealId],
  ].filter(([,expected,actual])=>actual!=null&&expected!=null&&String(actual)!==String(expected)).map(([name])=>name);
}

export class CorePresentationRouter{
  constructor({profileRegistry}={}){
    if(!profileRegistry||typeof profileRegistry.get!=='function')throw new TypeError('CorePresentationRouter requires a profileRegistry');
    this.profileRegistry=profileRegistry;
  }

  resolve({modelProfileId=null,fallbackProfileId=null,providerId=null,modelId=null,routeId=null,observedCacheBehavior=null}={}){
    const requested=modelProfileId==null?null:String(modelProfileId);
    const measured=String(observedCacheBehavior?.status??'').toUpperCase()==='MEASURED'||observedCacheBehavior?.measured===true;
    if(requested&&requested!=='AUTO'&&this.profileRegistry.get(requested)){
      return{requestedProfileId:requested,selectedProfileId:requested,fallbackUsed:false,reason:'EXPLICIT_PROFILE',providerId:providerId??null,modelId:modelId??null,routeId:routeId??null,measuredRoute:measured,cacheAssumption:'PROFILE_DECLARED'};
    }
    const explicitFallback=fallbackProfileId==null?null:String(fallbackProfileId);
    if(requested&&requested!=='AUTO'&&explicitFallback&&this.profileRegistry.get(explicitFallback)){
      return{requestedProfileId:requested,selectedProfileId:explicitFallback,fallbackUsed:true,reason:'EXPLICIT_COMPATIBLE_FALLBACK',providerId:providerId??null,modelId:modelId??null,routeId:routeId??null,measuredRoute:measured,cacheAssumption:'PROFILE_DECLARED'};
    }
    const provider=String(providerId??'').toLowerCase();
    if(provider.includes('openrouter')){
      return{requestedProfileId:requested,selectedProfileId:'OPENROUTER_CONSERVATIVE',fallbackUsed:Boolean(requested&&requested!=='AUTO'),reason:measured?'OPENROUTER_MEASURED_ROUTE_HINT':'OPENROUTER_ROUTE_UNMEASURED_CONSERVATIVE',providerId:providerId??null,modelId:modelId??null,routeId:routeId??null,measuredRoute:measured,cacheAssumption:measured?'ROUTE_MEASURED':'ROUTE_DEPENDENT_UNMEASURED'};
    }
    if(requested&&requested!=='AUTO'&&!this.profileRegistry.get(requested)){
      return{requestedProfileId:requested,selectedProfileId:'GENERIC_SAFE',fallbackUsed:true,reason:'UNKNOWN_PROFILE_SAFE_FALLBACK',providerId:providerId??null,modelId:modelId??null,routeId:routeId??null,measuredRoute:measured,cacheAssumption:'CONSERVATIVE_UNKNOWN'};
    }
    if(provider){
      return{requestedProfileId:requested,selectedProfileId:'GENERIC_SAFE',fallbackUsed:false,reason:'UNKNOWN_PROVIDER_SAFE_FALLBACK',providerId:providerId??null,modelId:modelId??null,routeId:routeId??null,measuredRoute:measured,cacheAssumption:'CONSERVATIVE_UNKNOWN'};
    }
    return{requestedProfileId:requested,selectedProfileId:'CACHE_STABLE',fallbackUsed:false,reason:'CORE_DEFAULT',providerId:null,modelId:modelId??null,routeId:routeId??null,measuredRoute:measured,cacheAssumption:'PROFILE_DECLARED'};
  }
}

export function createCorePromptDeliveryReceipt({plan,rendered,routing,sealedPacket=null,identity={},input={}}={}){
  if(!plan||!rendered)throw new TypeError('plan and rendered input are required');
  const semanticManifestIdentity=semanticIdentity(plan,sealedPacket);
  const semanticRoles=uniq((plan.sections??[]).map(row=>row.role));
  const providerRoles=uniq((rendered.messages??[]).map(row=>row.role));
  const supportedProviderRoles=uniq(rendered.supportedProviderRoles??['assistant','system','user']);
  const unsupportedProviderRoles=providerRoles.filter(role=>!supportedProviderRoles.includes(role));
  const semanticRolesByProvider=new Map();
  for(const row of rendered.messageMap??[]){
    const providerRole=String(row?.providerRole??''),semanticRole=String(row?.semanticRole??'');
    if(!providerRole||!semanticRole)continue;
    if(!semanticRolesByProvider.has(providerRole))semanticRolesByProvider.set(providerRole,new Set());
    semanticRolesByProvider.get(providerRole).add(semanticRole);
  }
  const roleCollisions=bounded([...semanticRolesByProvider.entries()]
    .map(([providerRole,roles])=>({providerRole,semanticRoles:[...roles].sort(),outcome:'PRESERVED_AS_SEPARATE_MESSAGES'}))
    .filter(row=>row.semanticRoles.length>1));
  const omissionMap=new Map();
  for(const row of [...(plan.dropped??[]),...(plan.deferred??[])])omissionMap.set(String(row.slot),clone(row));
  for(const row of (plan.sections??[]).filter(row=>row.representation==='OMITTED'))if(!omissionMap.has(String(row.slot)))omissionMap.set(String(row.slot),{slot:row.slot,reason:'OMITTED_REPRESENTATION'});
  const omissions=[...omissionMap.values()];
  const sections=plannedSections(plan,rendered);
  const from=input?.previousRouteId==null?null:String(input.previousRouteId);
  const to=routing?.routeId==null?null:String(routing.routeId);
  const routeChanged=from!==null&&to!==null&&from!==to;
  const routeOutcome=Object.freeze({
    changed:routeChanged,from,to,cacheAssumption:routing?.cacheAssumption??'PROFILE_DECLARED',
    cacheAssumptionInvalidated:Boolean(routeChanged&&!routing?.measuredRoute),
  });
  return Object.freeze({
    kind:'CorePromptDeliveryReceipt',contractVersion:2,status:'PLANNED_NOT_OBSERVED',
    chatId:identity.chatId??plan.chatId??null,generationId:plan.generationId,turnId:plan.turnId,correlationId:identity.correlationId??null,
    worldRevision:identity.worldRevision??null,sceneRevision:identity.sceneRevision??null,promptPlanId:plan.promptPlanId,contextSealId:plan.contextSealId,
    sealedPacketHash:plan.sealedPacketHash,semanticManifestIdentity,semanticManifestScope:'SEALED_PACKET_SEMANTICS',
    semanticManifestHash:semanticManifestIdentity,presentedSemanticManifestHash:plan.diagnosticReceipt?.semanticManifestHash??deliveryHash(rendered.semanticManifest??[]),
    requestedProfileId:routing?.requestedProfileId??plan.modelProfileId,profileChoice:plan.modelProfileId,
    profileRevision:plan.modelProfileRevision,providerId:routing?.providerId??null,modelId:routing?.modelId??null,routeId:routing?.routeId??null,
    profileReason:routing?.reason??'DIRECT',profileFallbackUsed:Boolean(routing?.fallbackUsed),cacheAssumption:routing?.cacheAssumption??'PROFILE_DECLARED',
    presentation:Object.freeze({
      requestedProfileId:routing?.requestedProfileId??null,modelProfileId:plan.modelProfileId,fallbackUsed:Boolean(routing?.fallbackUsed),
      reason:routing?.reason??null,providerId:routing?.providerId??null,modelId:routing?.modelId??null,routeId:routing?.routeId??null,
      cacheAssumption:routing?.cacheAssumption??null,providerTemplateTokensInjected:false,roleCollisions:clone(roleCollisions),
    }),
    routeOutcome,plannedRoles:semanticRoles,semanticRoles,providerRoles,supportedProviderRoles,unsupportedProviderRoles,roleCollisions:clone(roleCollisions),
    messageRoleMap:clone(rendered.messageMap??[]),plannedSections:clone(sections),
    sourceRevisionRefs:uniq([...(plan.sourceRevisionDependencies??[]),...(plan.sections??[]).flatMap(row=>row.sourceRevisionIds??[])]),
    omissions:clone(omissions),omitted:clone(plan.dropped??[]),deferred:clone(plan.deferred??[]),
    phases:Object.freeze({
      planned:Object.freeze({status:'PLANNED',promptPlanId:plan.promptPlanId,modelProfileId:plan.modelProfileId,ordering:bounded(plan.ordering??[]),omittedCount:(plan.dropped??[]).length,deferredCount:(plan.deferred??[]).length}),
      sealedCompiled:Object.freeze({status:'SEALED_COMPILED',contextSealId:plan.contextSealId,sealedPacketHash:plan.sealedPacketHash,semanticManifestIdentity,sourceRevisionRefs:uniq(plan.sourceRevisionDependencies??[]),sections:clone(sections)}),
      hostRequest:Object.freeze({status:'NOT_OBSERVED',reason:'HOST_REQUEST_NOT_OBSERVED'}),
      providerResponse:Object.freeze({status:'NOT_RECEIVED',reason:'PROVIDER_RESPONSE_NOT_RECEIVED'}),
    }),
    presentationOnly:true,semanticSelectionAuthority:false,loreSelectionAuthority:false,factCreationAuthority:false,authorityMutation:false,
    authorityGranted:false,canonicalMutationAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    providerChatTemplateTokensEmitted:false,rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
    observedHostDelivery:null,providerResponseReceived:null,hostEvidenceRequired:true,
  });
}

export function attachObservedHostPromptEvidence(receipt,evidence={}){
  if(receipt?.kind!=='CorePromptDeliveryReceipt')throw new TypeError('CorePromptDeliveryReceipt is required');
  const observedSeal=evidence.sealedPacketHash??receipt.sealedPacketHash;
  const observedManifest=evidence.semanticManifestIdentity??(evidence.semanticManifest?semanticIdentity(null,{
    current:evidence.semanticManifest,current:[],historical:[],unresolved:[],activeThreads:[],relevantLore:[],episodicMemory:[],dependencies:[]
  }):receipt.semanticManifestIdentity);
  const observedRoles=uniq(evidence.observedRoles??[]);
  const roleCompatible=observedRoles.length===0||observedRoles.every(role=>(receipt.supportedProviderRoles??['assistant','system','user']).includes(role));
  const observedChat=evidence.chatId??receipt.chatId??null,observedTurn=evidence.turnId??receipt.turnId??null,observedGeneration=evidence.generationId??receipt.generationId??null;
  const observedCorrelation=evidence.correlationId??receipt.correlationId??null,observedContextSeal=evidence.contextSealId??receipt.contextSealId??null;
  const identityMismatch=identityMismatches(receipt,{chatId:observedChat,turnId:observedTurn,generationId:observedGeneration,correlationId:observedCorrelation,contextSealId:observedContextSeal});
  const identityCompatible=identityMismatch.length===0;
  const observedSectionsRaw=bounded(evidence.observedSections??[]);
  const observedSections=observedSectionsRaw.map(row=>typeof row==='string'?{slot:row}:{
    slot:row?.slot??null,sectionIdentity:row?.sectionIdentity??null,providerRole:row?.providerRole??null,
    sourceRevisionIds:uniq(row?.sourceRevisionIds??[]),semanticManifestIdentity:row?.semanticManifestIdentity??null,
  });
  const expectedSections=(receipt.messageRoleMap??[]).map(row=>({slot:row.slot,sectionIdentity:row.sectionIdentity??null,providerRole:row.providerRole??null}));
  const sectionCompatible=!observedSections.length||(
    observedSections.length===expectedSections.length&&observedSections.every((row,index)=>{
      const expected=expectedSections[index];
      return row.slot===expected.slot&&(!row.sectionIdentity||!expected.sectionIdentity||row.sectionIdentity===expected.sectionIdentity)&&(!row.providerRole||row.providerRole===expected.providerRole);
    })
  );
  const hostObserved=evidence.hostObserved!==false;
  const matching=Boolean(hostObserved&&observedSeal===receipt.sealedPacketHash&&observedManifest===receipt.semanticManifestIdentity&&roleCompatible&&sectionCompatible&&identityCompatible);
  const observed=Object.freeze({
    kind:'ObservedHostPromptEvidence',observationStage:'HOST_REQUEST_ASSEMBLED',hostObserved,
    host:String(evidence.host??'SILLYTAVERN'),chatId:observedChat,turnId:observedTurn,generationId:observedGeneration,
    correlationId:observedCorrelation,contextSealId:observedContextSeal,requestId:evidence.requestId??null,
    observedRoles,observedSections:clone(observedSections),roleCompatible,sectionCompatible,identityCompatible,identityMismatch,
    sealedPacketHash:observedSeal,semanticManifestIdentity:observedManifest,promptFingerprint:evidence.promptFingerprint??null,
    matching,live:Boolean(evidence.live),capturedAt:evidence.capturedAt??null,
  });
  return Object.freeze({
    ...clone(receipt),status:matching?'OBSERVED_MATCH':'OBSERVED_MISMATCH',observedHostDelivery:observed,
    phases:Object.freeze({...clone(receipt.phases),hostRequest:Object.freeze({
      status:matching?'OBSERVED_MATCH':'OBSERVED_MISMATCH',requestId:observed.requestId,contextSealId:receipt.contextSealId,
      sealedPacketHash:receipt.sealedPacketHash,semanticManifestIdentity:receipt.semanticManifestIdentity,
      observedRoles,observedSections:clone(observedSections),matching,identityMismatch,promptFingerprint:observed.promptFingerprint,capturedAt:observed.capturedAt,
    })}),
  });
}

export function attachProviderResponseEvidence(receipt,evidence={}){
  if(receipt?.kind!=='CorePromptDeliveryReceipt')throw new TypeError('CorePromptDeliveryReceipt is required');
  const identityMismatch=identityMismatches(receipt,evidence);
  const hostRequestId=receipt?.phases?.hostRequest?.requestId??receipt?.observedHostDelivery?.requestId??null;
  if(evidence.requestId!=null&&hostRequestId!=null&&String(evidence.requestId)!==String(hostRequestId))identityMismatch.push('requestId');
  const accepted=identityMismatch.length===0;
  const response=Object.freeze({
    status:accepted?'RECEIVED':'REJECTED_IDENTITY_MISMATCH',
    chatId:evidence.chatId??receipt.chatId??null,turnId:evidence.turnId??receipt.turnId??null,
    generationId:evidence.generationId??receipt.generationId??null,correlationId:evidence.correlationId??receipt.correlationId??null,
    contextSealId:evidence.contextSealId??receipt.contextSealId??null,requestId:evidence.requestId??hostRequestId??null,
    responseId:evidence.responseId??null,providerId:evidence.providerId??receipt.providerId??null,routeId:evidence.routeId??receipt.routeId??null,
    identityMismatch,capturedAt:evidence.capturedAt??null,rawResponseIncluded:false,storyTextIncluded:false,hiddenReasoningIncluded:false,
  });
  return Object.freeze({
    ...clone(receipt),status:accepted?'PROVIDER_RESPONSE_RECEIVED':'PROVIDER_RESPONSE_REJECTED',providerResponseReceived:response,
    phases:Object.freeze({...clone(receipt.phases),providerResponse:response}),
  });
}

export function promptDeliveryIntegrationContract(){
  return Object.freeze({
    kind:'CorePromptDeliveryIntegrationContract',contractVersion:2,
    worker3Input:'CorePromptDeliveryReceipt',worker4Input:'CorePromptDeliveryReceipt.phases',
    stages:['planned','sealedCompiled','hostRequest','providerResponse'],
    worker3MustSupply:['chatId','turnId','generationId','contextSealId','sealedPacketHash','semanticManifestIdentity','observedRoles','observedSections'],
    worker4OwnerReceiptShape:['kind','contractVersion','chatId','turnId','generationId','correlationId','promptPlanId','contextSealId','sealedPacketHash','semanticManifestIdentity','phases'],
    identityChecks:['chatId','turnId','generationId','correlationId','contextSealId','sealedPacketHash','semanticManifestIdentity'],
    corePlanIsNotHostProof:true,hostObservationRequiresAssembledRequest:true,providerResponseRequiredForEndToEnd:true,
    providerChatTemplateTokens:false,providerMessageRoles:['system','user','assistant'],semanticRoleMapping:{context:'system'},
    unsupportedOutboundRolesRejected:true,semanticMutationAllowed:false,
    rawPromptExcluded:true,storyTextExcluded:true,loreBodiesExcluded:true,credentialsExcluded:true,hiddenReasoningExcluded:true,
  });
}
