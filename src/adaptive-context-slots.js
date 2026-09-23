import { PromptSlot,ContributionSource,DeliveryBand,createPromptContribution,createModelProfile } from './adaptive-context-contracts.js';

const clone=(value)=>structuredClone(value);
function deepFreeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const key of Object.keys(value))deepFreeze(value[key]);return value;}

export const CORE_SLOT_SPECS={
  [PromptSlot.SYSTEM_POLICY]:{owner:'OPERATOR_POLICY',allowedSources:[ContributionSource.STATIC_POLICY],role:'system',protected:true,semantic:false,band:DeliveryBand.STABLE_PREFIX,cacheEligible:true},
  [PromptSlot.WORLD_FOUNDATION]:{owner:'CONTEXT_COMPILER',allowedSources:[ContributionSource.SEALED_PACKET],role:'context',protected:false,semantic:true,band:DeliveryBand.STABLE_PREFIX,cacheEligible:true},
  [PromptSlot.CHARACTER_FOUNDATION]:{owner:'CONTEXT_COMPILER',allowedSources:[ContributionSource.SEALED_PACKET],role:'context',protected:false,semantic:true,band:DeliveryBand.STABLE_PREFIX,cacheEligible:true},
  [PromptSlot.CURRENT_CHARACTER_STATE]:{owner:'CONTEXT_COMPILER',allowedSources:[ContributionSource.SEALED_PACKET],role:'context',protected:true,semantic:true,band:DeliveryBand.REVISIONED_MIDDLE,cacheEligible:true},
  [PromptSlot.CURRENT_WORLD_STATE]:{owner:'CONTEXT_COMPILER',allowedSources:[ContributionSource.SEALED_PACKET],role:'context',protected:true,semantic:true,band:DeliveryBand.REVISIONED_MIDDLE,cacheEligible:true},
  [PromptSlot.CURRENT_SCENE]:{owner:'GENERATION_ENVELOPE',allowedSources:[ContributionSource.GENERATION_ENVELOPE],role:'context',protected:true,semantic:false,band:DeliveryBand.VOLATILE_TAIL,cacheEligible:false},
  [PromptSlot.ACTIVE_THREADS]:{owner:'GENERATION_ENVELOPE',allowedSources:[ContributionSource.GENERATION_ENVELOPE],role:'context',protected:true,semantic:false,band:DeliveryBand.VOLATILE_TAIL,cacheEligible:false},
  [PromptSlot.RELEVANT_LORE]:{owner:'CONTEXT_COMPILER',allowedSources:[ContributionSource.SEALED_PACKET],role:'context',protected:false,semantic:true,band:DeliveryBand.REVISIONED_MIDDLE,cacheEligible:true},
  [PromptSlot.EPISODIC_MEMORY]:{owner:'CONTEXT_COMPILER',allowedSources:[ContributionSource.SEALED_PACKET],role:'context',protected:false,semantic:true,band:DeliveryBand.REVISIONED_MIDDLE,cacheEligible:true},
  [PromptSlot.HISTORICAL_SUPPORT]:{owner:'CONTEXT_COMPILER',allowedSources:[ContributionSource.SEALED_PACKET],role:'context',protected:true,semantic:true,band:DeliveryBand.REVISIONED_MIDDLE,cacheEligible:true},
  [PromptSlot.UNRESOLVED_EVIDENCE]:{owner:'CONTEXT_COMPILER',allowedSources:[ContributionSource.SEALED_PACKET],role:'context',protected:true,semantic:true,band:DeliveryBand.REVISIONED_MIDDLE,cacheEligible:true},
  [PromptSlot.RECENT_NARRATIVE]:{owner:'GENERATION_ENVELOPE',allowedSources:[ContributionSource.GENERATION_ENVELOPE],role:'context',protected:false,semantic:false,band:DeliveryBand.VOLATILE_TAIL,cacheEligible:false},
  [PromptSlot.USER_INPUT]:{owner:'GENERATION_ENVELOPE',allowedSources:[ContributionSource.GENERATION_ENVELOPE],role:'user',protected:true,semantic:false,band:DeliveryBand.VOLATILE_TAIL,cacheEligible:false},
};

export const DEFAULT_ORDER=[PromptSlot.SYSTEM_POLICY,PromptSlot.WORLD_FOUNDATION,PromptSlot.CHARACTER_FOUNDATION,PromptSlot.CURRENT_CHARACTER_STATE,PromptSlot.CURRENT_WORLD_STATE,PromptSlot.RELEVANT_LORE,PromptSlot.EPISODIC_MEMORY,PromptSlot.HISTORICAL_SUPPORT,PromptSlot.UNRESOLVED_EVIDENCE,PromptSlot.CURRENT_SCENE,PromptSlot.ACTIVE_THREADS,PromptSlot.RECENT_NARRATIVE,PromptSlot.USER_INPUT];
export const RECENCY_ORDER=[PromptSlot.SYSTEM_POLICY,PromptSlot.WORLD_FOUNDATION,PromptSlot.HISTORICAL_SUPPORT,PromptSlot.RELEVANT_LORE,PromptSlot.EPISODIC_MEMORY,PromptSlot.CURRENT_WORLD_STATE,PromptSlot.CURRENT_CHARACTER_STATE,PromptSlot.UNRESOLVED_EVIDENCE,PromptSlot.CURRENT_SCENE,PromptSlot.ACTIVE_THREADS,PromptSlot.RECENT_NARRATIVE,PromptSlot.USER_INPUT];

export class PromptSlotRegistry{
  constructor(){this.slots=new Map(Object.entries(CORE_SLOT_SPECS).map(([name,spec])=>[name,deepFreeze(clone(spec))]));}
  registerExtensionSlot(name,spec){
    if(!/^EXT_[A-Z0-9_]+$/.test(name))throw new TypeError('extension slot names must match EXT_[A-Z0-9_]+');
    if(this.slots.has(name))throw new Error(`Prompt slot already registered: ${name}`);
    if(!spec||typeof spec!=='object'||!Array.isArray(spec.allowedSources)||!spec.allowedSources.length)throw new TypeError('extension slot spec requires allowedSources');
    const normalized={owner:String(spec.owner??'EXTENSION'),allowedSources:[...spec.allowedSources],role:String(spec.role??'context'),protected:Boolean(spec.protected),semantic:Boolean(spec.semantic),band:spec.band??DeliveryBand.REVISIONED_MIDDLE,cacheEligible:spec.cacheEligible!==false};
    if(!Object.values(DeliveryBand).includes(normalized.band))throw new TypeError('extension slot band is invalid');
    this.slots.set(name,deepFreeze(normalized));return this.get(name);
  }
  has(name){return this.slots.has(name);}
  get(name){const spec=this.slots.get(name);return spec?clone(spec):null;}
  list(){return [...this.slots.entries()].map(([name,spec])=>({name,...clone(spec)}));}
  normalizeContribution(input){
    if(!input||typeof input!=='object')throw new TypeError('Prompt contribution must be an object');
    if(!this.slots.has(input.slot))throw new Error(`Unregistered prompt slot: ${input.slot}`);
    const contribution=createPromptContribution(input),spec=this.slots.get(contribution.slot);
    if(contribution.semantic&&contribution.sourceCategory!==ContributionSource.SEALED_PACKET)throw new Error('POST_SEAL_SEMANTIC_INJECTION');
    if(!spec.allowedSources.includes(contribution.sourceCategory))throw new Error(`Prompt slot ${contribution.slot} rejects source category ${contribution.sourceCategory}`);
    if(contribution.owner!==spec.owner)throw new Error(`CONFLICTING_SLOT_OWNERSHIP:${contribution.slot}`);
    if(spec.semantic&&contribution.sourceCategory===ContributionSource.SEALED_PACKET&&!contribution.semanticRefs.length)throw new Error(`Sealed semantic contribution ${contribution.id} requires semanticRefs`);
    if(contribution.role!==spec.role)throw new Error(`Prompt slot ${contribution.slot} requires role ${spec.role}`);
    return contribution;
  }
}

export class ModelProfileRegistry{
  constructor({profiles=[]}={}){
    this.profiles=new Map();
    this.register(createModelProfile({modelProfileId:'CACHE_STABLE',revision:'1',contextWindow:4096,reservedTokens:256,structuredContextPreference:'RICH',positionOrder:DEFAULT_ORDER,segmentStrategy:'BAND_GROUPED',bandBySlot:Object.fromEntries(DEFAULT_ORDER.map(slot=>[slot,CORE_SLOT_SPECS[slot].band])),cacheCharacteristics:{stablePrefix:true,preferReusableGroups:true},adapterId:'messages-v1',deliveryPolicyRevision:'1',fallbackProfileId:'RECENCY_WEIGHTED'}));
    this.register(createModelProfile({modelProfileId:'RECENCY_WEIGHTED',revision:'1',contextWindow:4096,reservedTokens:256,structuredContextPreference:'COMPACT',positionOrder:RECENCY_ORDER,segmentStrategy:'SLOT_ATOMIC',bandBySlot:Object.fromEntries(RECENCY_ORDER.map(slot=>[slot,CORE_SLOT_SPECS[slot].band])),cacheCharacteristics:{stablePrefix:false,preferCurrentProximity:true},adapterId:'structured-blocks-v1',deliveryPolicyRevision:'1',fallbackProfileId:'CACHE_STABLE'}));
    for(const profile of profiles)this.register(profile);
  }
  register(profile){const normalized=profile?.kind==='ModelProfile'?clone(profile):createModelProfile(profile);this.profiles.set(normalized.modelProfileId,deepFreeze(normalized));return this.get(normalized.modelProfileId);}
  get(id){const p=this.profiles.get(id);return p?clone(p):null;}
  resolve(id,{fallbackProfileId=null}={}){const direct=this.get(id);if(direct)return{profile:direct,fallbackUsed:false,requestedProfileId:id};const fallback=fallbackProfileId?this.get(fallbackProfileId):null;if(fallback)return{profile:fallback,fallbackUsed:true,requestedProfileId:id};return{profile:null,fallbackUsed:false,requestedProfileId:id};}
}
