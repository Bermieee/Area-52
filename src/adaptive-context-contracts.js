import { stableHash } from './browser-runtime-utils.js';

const freeze=(value)=>Object.freeze(value);
const enumValues=(value)=>new Set(Object.values(value));
const req=(value,name)=>{if(typeof value!=='string'||!value.length)throw new TypeError(`${name} must be a non-empty string`);return value;};
const strings=(value,name)=>{if(!Array.isArray(value)||value.some(x=>typeof x!=='string'))throw new TypeError(`${name} must be an array of strings`);return [...value];};
const serial=(value,name)=>{try{JSON.stringify(value);}catch{throw new TypeError(`${name} must be JSON-serializable`);}return structuredClone(value);};
const oneOf=(value,set,name)=>{if(!set.has(value))throw new TypeError(`${name} has unsupported value: ${value}`);return value;};

export const PromptSlot=freeze({
  SYSTEM_POLICY:'SYSTEM_POLICY',
  WORLD_FOUNDATION:'WORLD_FOUNDATION',
  CHARACTER_FOUNDATION:'CHARACTER_FOUNDATION',
  CURRENT_CHARACTER_STATE:'CURRENT_CHARACTER_STATE',
  CURRENT_WORLD_STATE:'CURRENT_WORLD_STATE',
  CURRENT_SCENE:'CURRENT_SCENE',
  ACTIVE_THREADS:'ACTIVE_THREADS',
  RELEVANT_LORE:'RELEVANT_LORE',
  EPISODIC_MEMORY:'EPISODIC_MEMORY',
  HISTORICAL_SUPPORT:'HISTORICAL_SUPPORT',
  UNRESOLVED_EVIDENCE:'UNRESOLVED_EVIDENCE',
  RECENT_NARRATIVE:'RECENT_NARRATIVE',
  USER_INPUT:'USER_INPUT',
});

export const ContributionSource=freeze({
  SEALED_PACKET:'SEALED_PACKET',
  STATIC_POLICY:'STATIC_POLICY',
  GENERATION_ENVELOPE:'GENERATION_ENVELOPE',
  PRESENTATION_METADATA:'PRESENTATION_METADATA',
});

export const ReuseState=freeze({NO_CHANGE:'NO_CHANGE',PATCH:'PATCH',REBUILD:'REBUILD',OMIT:'OMIT'});
export const DeliveryBand=freeze({STABLE_PREFIX:'STABLE_PREFIX',REVISIONED_MIDDLE:'REVISIONED_MIDDLE',VOLATILE_TAIL:'VOLATILE_TAIL'});
export const RepresentationMode=freeze({RICH:'RICH',COMPACT:'COMPACT',OMITTED:'OMITTED'});
export const DeliveryStatus=freeze({READY:'READY',DELIVERY_BUDGET_UNSATISFIABLE:'DELIVERY_BUDGET_UNSATISFIABLE',INTEGRITY_REJECTED:'INTEGRITY_REJECTED',PROFILE_UNAVAILABLE:'PROFILE_UNAVAILABLE',ADAPTER_FAILED:'ADAPTER_FAILED'});

const SLOT=enumValues(PromptSlot), SOURCE=enumValues(ContributionSource), REUSE=enumValues(ReuseState), BAND=enumValues(DeliveryBand), REP=enumValues(RepresentationMode), STATUS=enumValues(DeliveryStatus);

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
export function stableDeliveryString(value){return JSON.stringify(stable(value));}
export function deliveryHash(value){return stableHash(stableDeliveryString(value),{alreadyString:true});}

export function createPromptContribution({
  id,slot,sourceCategory,owner='CONTEXT_DELIVERY',semantic=false,semanticRefs=[],content=null,
  sourceRevisionIds=[],authorityClass=null,temporalStatus=null,role='context',required=false,priority=0,metadata={},
}){
  return{
    kind:'PromptContribution',id:req(id,'PromptContribution.id'),slot:(SLOT.has(slot)||/^EXT_[A-Z0-9_]+$/.test(slot)?slot:(()=>{throw new TypeError(`PromptContribution.slot has unsupported value: ${slot}`)})()),
    sourceCategory:oneOf(sourceCategory,SOURCE,'PromptContribution.sourceCategory'),owner:req(owner,'PromptContribution.owner'),
    semantic:Boolean(semantic),semanticRefs:strings(semanticRefs,'PromptContribution.semanticRefs'),content:serial(content,'PromptContribution.content'),
    sourceRevisionIds:strings(sourceRevisionIds,'PromptContribution.sourceRevisionIds'),authorityClass:authorityClass===null?null:req(authorityClass,'PromptContribution.authorityClass'),
    temporalStatus:temporalStatus===null?null:req(temporalStatus,'PromptContribution.temporalStatus'),role:req(role,'PromptContribution.role'),
    required:Boolean(required),priority:Number(priority),metadata:serial(metadata,'PromptContribution.metadata'),
  };
}

export function createModelProfile({
  modelProfileId,schemaVersion='1',revision='1',contextWindow=4096,reservedTokens=256,
  roleBehavior={system:true,user:true,context:true},structuredContextPreference='COMPACT',positionOrder=[],
  bandBySlot={},segmentStrategy='SLOT_ATOMIC',cacheCharacteristics={},sectionAllocationWeights={},tokenEstimatorId='deterministic-approx-v1',
  segmentConstraints={},longContextPolicy='DEGRADE_OPTIONAL_FIRST',fallbackProfileId=null,adapterId='structured-blocks-v1',deliveryPolicyRevision='1',
}){
  if(!Number.isInteger(contextWindow)||contextWindow<1)throw new TypeError('ModelProfile.contextWindow must be a positive integer');
  if(!Number.isInteger(reservedTokens)||reservedTokens<0)throw new TypeError('ModelProfile.reservedTokens must be a non-negative integer');
  if(!Array.isArray(positionOrder)||positionOrder.some(x=>!SLOT.has(x)&&!/^EXT_[A-Z0-9_]+$/.test(x)))throw new TypeError('ModelProfile.positionOrder contains an invalid slot');
  if(new Set(positionOrder).size!==positionOrder.length)throw new TypeError('ModelProfile.positionOrder must not contain duplicates');
  for(const band of Object.values(bandBySlot))oneOf(band,BAND,'ModelProfile.bandBySlot');
  return{
    kind:'ModelProfile',modelProfileId:req(modelProfileId,'ModelProfile.modelProfileId'),schemaVersion:req(schemaVersion,'ModelProfile.schemaVersion'),revision:req(revision,'ModelProfile.revision'),
    contextWindow,reservedTokens,roleBehavior:serial(roleBehavior,'ModelProfile.roleBehavior'),structuredContextPreference:req(structuredContextPreference,'ModelProfile.structuredContextPreference'),
    positionOrder:[...positionOrder],bandBySlot:serial(bandBySlot,'ModelProfile.bandBySlot'),segmentStrategy:req(segmentStrategy,'ModelProfile.segmentStrategy'),
    cacheCharacteristics:serial(cacheCharacteristics,'ModelProfile.cacheCharacteristics'),sectionAllocationWeights:serial(sectionAllocationWeights,'ModelProfile.sectionAllocationWeights'),tokenEstimatorId:req(tokenEstimatorId,'ModelProfile.tokenEstimatorId'),
    segmentConstraints:serial(segmentConstraints,'ModelProfile.segmentConstraints'),longContextPolicy:req(longContextPolicy,'ModelProfile.longContextPolicy'),
    fallbackProfileId:fallbackProfileId===null?null:req(fallbackProfileId,'ModelProfile.fallbackProfileId'),adapterId:req(adapterId,'ModelProfile.adapterId'),
    deliveryPolicyRevision:req(deliveryPolicyRevision,'ModelProfile.deliveryPolicyRevision'),
  };
}

export function createPromptPlan({
  promptPlanId,generationId,turnId,contextSealId,sealedPacketHash,modelProfileId,modelProfileRevision,deliveryPolicyRevision,
  sections=[],segments=[],budget,ordering=[],placement={},reuseDecisions=[],cacheDecisions=[],fallbackDecisions=[],dropped=[],deferred=[],
  sourceRevisionDependencies=[],worldRevision=0,sceneRevision=0,diagnosticReceipt={},previousPromptPlanId=null,status=DeliveryStatus.READY,
}){
  oneOf(status,STATUS,'PromptPlan.status');
  if(!Array.isArray(sections)||!Array.isArray(segments))throw new TypeError('PromptPlan sections/segments must be arrays');
  for(const decision of reuseDecisions)oneOf(decision.state,REUSE,'PromptPlan.reuseDecisions.state');
  for(const section of sections)if(section.representation)oneOf(section.representation,REP,'PromptPlan.section.representation');
  return{
    kind:'PromptPlan',promptPlanId:req(promptPlanId,'PromptPlan.promptPlanId'),generationId:req(generationId,'PromptPlan.generationId'),turnId:req(turnId,'PromptPlan.turnId'),
    contextSealId:req(contextSealId,'PromptPlan.contextSealId'),sealedPacketHash:req(sealedPacketHash,'PromptPlan.sealedPacketHash'),modelProfileId:req(modelProfileId,'PromptPlan.modelProfileId'),
    modelProfileRevision:req(modelProfileRevision,'PromptPlan.modelProfileRevision'),deliveryPolicyRevision:req(deliveryPolicyRevision,'PromptPlan.deliveryPolicyRevision'),
    sections:serial(sections,'PromptPlan.sections'),segments:serial(segments,'PromptPlan.segments'),budget:serial(budget,'PromptPlan.budget'),ordering:strings(ordering,'PromptPlan.ordering'),
    placement:serial(placement,'PromptPlan.placement'),reuseDecisions:serial(reuseDecisions,'PromptPlan.reuseDecisions'),cacheDecisions:serial(cacheDecisions,'PromptPlan.cacheDecisions'),
    fallbackDecisions:serial(fallbackDecisions,'PromptPlan.fallbackDecisions'),dropped:serial(dropped,'PromptPlan.dropped'),deferred:serial(deferred,'PromptPlan.deferred'),
    sourceRevisionDependencies:strings(sourceRevisionDependencies,'PromptPlan.sourceRevisionDependencies'),worldRevision:Number(worldRevision),sceneRevision:Number(sceneRevision),
    diagnosticReceipt:serial(diagnosticReceipt,'PromptPlan.diagnosticReceipt'),previousPromptPlanId:previousPromptPlanId===null?null:req(previousPromptPlanId,'PromptPlan.previousPromptPlanId'),status,
  };
}
