import { deliveryHash } from './adaptive-context-contracts.js';

const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();

function semanticIdentity(plan){
  const entries=(plan?.sections??[]).flatMap(section=>section.semanticManifest??[]).map(row=>({
    semanticKey:String(row.semanticKey??''),
    authorityClass:row.authorityClass??null,
    temporalStatus:row.temporalStatus??null,
    sourceRevisionIds:uniq(row.sourceRevisionIds??[]),
  })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return deliveryHash(entries);
}

export class CorePresentationRouter{
  constructor({profileRegistry}={}){
    if(!profileRegistry||typeof profileRegistry.get!=='function')throw new TypeError('CorePresentationRouter requires a profileRegistry');
    this.profileRegistry=profileRegistry;
  }

  resolve({modelProfileId=null,fallbackProfileId=null,providerId=null,modelId=null,routeId=null,observedCacheBehavior=null}={}){
    const requested=modelProfileId==null?null:String(modelProfileId);
    if(requested&&requested!=='AUTO'&&this.profileRegistry.get(requested)){
      return{requestedProfileId:requested,selectedProfileId:requested,fallbackUsed:false,reason:'EXPLICIT_PROFILE',providerId:providerId??null,modelId:modelId??null,routeId:routeId??null,cacheAssumption:'PROFILE_DECLARED'};
    }
    const explicitFallback=fallbackProfileId==null?null:String(fallbackProfileId);
    if(requested&&requested!=='AUTO'&&explicitFallback&&this.profileRegistry.get(explicitFallback)){
      return{requestedProfileId:requested,selectedProfileId:explicitFallback,fallbackUsed:true,reason:'EXPLICIT_COMPATIBLE_FALLBACK',providerId:providerId??null,modelId:modelId??null,routeId:routeId??null,cacheAssumption:'PROFILE_DECLARED'};
    }
    const provider=String(providerId??'').toLowerCase();
    if(provider.includes('openrouter')){
      const observed=String(observedCacheBehavior?.status??'').toUpperCase()==='MEASURED';
      return{requestedProfileId:requested,selectedProfileId:'OPENROUTER_CONSERVATIVE',fallbackUsed:Boolean(requested&&requested!=='AUTO'),reason:observed?'OPENROUTER_MEASURED_ROUTE_HINT':'OPENROUTER_ROUTE_UNMEASURED_CONSERVATIVE',providerId:providerId??null,modelId:modelId??null,routeId:routeId??null,cacheAssumption:observed?'ROUTE_MEASURED':'ROUTE_DEPENDENT_UNMEASURED'};
    }
    if(requested&&requested!=='AUTO'&&!this.profileRegistry.get(requested)){
      return{requestedProfileId:requested,selectedProfileId:'GENERIC_SAFE',fallbackUsed:true,reason:'UNKNOWN_PROFILE_SAFE_FALLBACK',providerId:providerId??null,modelId:modelId??null,routeId:routeId??null,cacheAssumption:'CONSERVATIVE_UNKNOWN'};
    }
    if(provider){
      return{requestedProfileId:requested,selectedProfileId:'GENERIC_SAFE',fallbackUsed:false,reason:'UNKNOWN_PROVIDER_SAFE_FALLBACK',providerId:providerId??null,modelId:modelId??null,routeId:routeId??null,cacheAssumption:'CONSERVATIVE_UNKNOWN'};
    }
    return{requestedProfileId:requested,selectedProfileId:'CACHE_STABLE',fallbackUsed:false,reason:'CORE_DEFAULT',providerId:null,modelId:modelId??null,routeId:routeId??null,cacheAssumption:'PROFILE_DECLARED'};
  }
}

export function createCorePromptDeliveryReceipt({plan,rendered,routing}={}){
  if(!plan||!rendered)throw new TypeError('plan and rendered input are required');
  const roles=uniq((rendered.messages??[]).map(row=>row.role).concat((plan.sections??[]).map(row=>row.role)));
  const omissions=[...(plan.dropped??[]),...(plan.deferred??[]),...(plan.sections??[]).filter(row=>row.representation==='OMITTED').map(row=>({slot:row.slot,reason:'OMITTED_REPRESENTATION'}))];
  return Object.freeze({
    kind:'CorePromptDeliveryReceipt',contractVersion:1,status:'PLANNED_NOT_OBSERVED',
    generationId:plan.generationId,turnId:plan.turnId,contextSealId:plan.contextSealId,
    sealedPacketHash:plan.sealedPacketHash,semanticManifestIdentity:semanticIdentity(plan),
    semanticManifestHash:plan.diagnosticReceipt?.semanticManifestHash??deliveryHash(rendered.semanticManifest??[]),
    requestedProfileId:routing?.requestedProfileId??plan.modelProfileId,profileChoice:plan.modelProfileId,
    profileRevision:plan.modelProfileRevision,providerId:routing?.providerId??null,modelId:routing?.modelId??null,routeId:routing?.routeId??null,
    profileReason:routing?.reason??'DIRECT',profileFallbackUsed:Boolean(routing?.fallbackUsed),cacheAssumption:routing?.cacheAssumption??'PROFILE_DECLARED',
    plannedRoles:roles,plannedSections:(plan.sections??[]).map(row=>({slot:row.slot,role:row.role,representation:row.representation,sourceRevisionIds:uniq(row.sourceRevisionIds??[])})),
    sourceRevisionRefs:uniq(plan.sourceRevisionDependencies??[]),omissions:clone(omissions),
    presentationOnly:true,semanticSelectionAuthority:false,loreSelectionAuthority:false,factCreationAuthority:false,authorityMutation:false,
    providerChatTemplateTokensEmitted:false,observedHostDelivery:null,hostEvidenceRequired:true,
  });
}

export function attachObservedHostPromptEvidence(receipt,evidence={}){
  if(receipt?.kind!=='CorePromptDeliveryReceipt')throw new TypeError('CorePromptDeliveryReceipt is required');
  const observedSeal=evidence.sealedPacketHash??receipt.sealedPacketHash;
  const observedManifest=evidence.semanticManifestIdentity??receipt.semanticManifestIdentity;
  const matching=observedSeal===receipt.sealedPacketHash&&observedManifest===receipt.semanticManifestIdentity;
  return Object.freeze({
    ...clone(receipt),
    status:matching?'OBSERVED_MATCH':'OBSERVED_MISMATCH',
    observedHostDelivery:{
      kind:'ObservedHostPromptEvidence',host:String(evidence.host??'SILLYTAVERN'),
      generationId:evidence.generationId??receipt.generationId,requestId:evidence.requestId??null,
      observedRoles:uniq(evidence.observedRoles??[]),observedSections:uniq(evidence.observedSections??[]),
      sealedPacketHash:observedSeal,semanticManifestIdentity:observedManifest,
      promptFingerprint:evidence.promptFingerprint??null,matching,live:Boolean(evidence.live),capturedAt:evidence.capturedAt??null,
    },
  });
}

export function promptDeliveryIntegrationContract(){
  return Object.freeze({
    kind:'CorePromptDeliveryIntegrationContract',contractVersion:1,
    worker3Input:'ObservedHostPromptEvidence',
    worker3MustSupply:['generationId','observedRoles','observedSections'],
    identityChecks:['sealedPacketHash','semanticManifestIdentity'],
    corePlanIsNotHostProof:true,
    providerChatTemplateTokens:false,
    semanticMutationAllowed:false,
  });
}
