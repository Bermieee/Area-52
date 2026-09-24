import { FailureCode } from './constants.js';
import { createCandidateBusEnvelope } from './candidate-bus.js';

export const RetrievalQuality = Object.freeze({ HIGH:'HIGH', MIXED:'MIXED', LOW:'LOW' });
export const CorrectiveRetrievalAction = Object.freeze({
  QUERY_REFORMULATION:'QUERY_REFORMULATION',
  SPARSE_RETRY:'SPARSE_RETRY',
  DENSE_RETRY:'DENSE_RETRY',
  GRAPH_EXPANSION:'GRAPH_EXPANSION',
  ENTITY_CONSTRAINED_SEARCH:'ENTITY_CONSTRAINED_SEARCH',
  TEMPORAL_NARROWING:'TEMPORAL_NARROWING',
});
const ACTIONS=new Set(Object.values(CorrectiveRetrievalAction));

export function retrievalControlDecision({
  quality,simpleTurn=false,correctiveAttempt=0,maxCorrectiveAttempts=1,
  recommendedAction=CorrectiveRetrievalAction.QUERY_REFORMULATION,
}={}) {
  const max=Math.min(1,Math.max(0,Number(maxCorrectiveAttempts)||0));
  if(simpleTurn)return receipt({action:'SKIP',reason:'HOT_COGNITION_SUFFICIENT',allowLongTermMemory:false,corrective:false,quality:quality??null});
  if(quality===RetrievalQuality.HIGH)return receipt({action:'PROCEED',reason:'HIGH_QUALITY',allowLongTermMemory:true,corrective:false,quality});
  if(quality===RetrievalQuality.MIXED&&Number(correctiveAttempt)<max){
    if(!ACTIONS.has(recommendedAction))throw new TypeError(`unsupported corrective retrieval action: ${recommendedAction}`);
    return receipt({action:'CORRECTIVE_RETRIEVAL',reason:'MIXED_QUALITY',allowLongTermMemory:false,corrective:true,nextAttempt:Number(correctiveAttempt)+1,quality,correctiveAction:recommendedAction});
  }
  if(quality===RetrievalQuality.MIXED)return receipt({action:'NO_LONG_TERM_MEMORY',reason:'CORRECTIVE_BUDGET_EXHAUSTED',allowLongTermMemory:false,corrective:false,quality});
  if(quality===RetrievalQuality.LOW)return receipt({action:'NO_LONG_TERM_MEMORY',reason:'LOW_QUALITY',allowLongTermMemory:false,corrective:false,quality});
  throw new TypeError('quality must be HIGH, MIXED or LOW');
}

export function evaluateRetrievalQuality(input={}) {
  if(Array.isArray(input.requiredIntents)||Array.isArray(input.requiredIntentIds))return evaluateIntentCoverage(input);
  return evaluateLegacyQuality(input);
}

export function createCorrectiveRetrievalPlan({
  turnId='turn',intentFingerprint='intent:unknown',reason='MIXED_QUALITY',
  targetIntentIds=[],missingEvidence=[],action=CorrectiveRetrievalAction.QUERY_REFORMULATION,
  allowedProviderClass=null,queryDelta=null,entityConstraints=[],temporalConstraint=null,
  maxCandidates=24,maxEvidenceBytes=32768,sourceRevisionSet=[],worldRevision=0,sceneRevision=0,
  softDeadline=0,hardDeadline=0,attempt=1,
}={}) {
  if(!ACTIONS.has(action))fail(FailureCode.SCHEMA_INVALID,`unsupported corrective retrieval action: ${action}`);
  const normalizedAttempt=Number(attempt);
  if(normalizedAttempt!==1)fail(FailureCode.SCHEMA_INVALID,'foreground corrective attempt must equal 1');
  const candidateCap=boundedInt(maxCandidates,1,64,'maxCandidates');
  const byteCap=boundedInt(maxEvidenceBytes,1024,131072,'maxEvidenceBytes');
  return freeze({
    kind:'CorrectiveRetrievalPlan',
    planId:`correct:${turnId}:${intentFingerprint}:${action}`,
    turnId:required(turnId,'turnId'),intentFingerprint:required(intentFingerprint,'intentFingerprint'),
    reason:required(reason,'reason'),targetIntentIds:strings(targetIntentIds,16,'targetIntentIds'),
    missingEvidence:strings(missingEvidence,32,'missingEvidence'),action,
    allowedProviderClass:allowedProviderClass==null?null:required(allowedProviderClass,'allowedProviderClass'),
    queryDelta:queryDelta==null?null:String(queryDelta).slice(0,800),
    entityConstraints:strings(entityConstraints,32,'entityConstraints'),
    temporalConstraint:temporalConstraint==null?null:structuredClone(temporalConstraint),
    maxCandidates:candidateCap,maxEvidenceBytes:byteCap,sourceRevisionSet:strings(sourceRevisionSet,64,'sourceRevisionSet'),
    worldRevision:finite(worldRevision,'worldRevision'),sceneRevision:finite(sceneRevision,'sceneRevision'),
    softDeadline:finite(softDeadline,'softDeadline'),hardDeadline:finite(hardDeadline,'hardDeadline'),
    attempt:1,authorityGranted:false,truthAuthorityGranted:false,
  });
}

export class CorrectiveRetrievalDispatcher {
  constructor({providers={}}={}){this.providers={...providers};}
  register(action,provider){
    if(!ACTIONS.has(action))throw new TypeError(`unsupported corrective retrieval action: ${action}`);
    if(typeof provider!=='function'&&typeof provider?.retrieve!=='function')throw new TypeError('corrective provider must be function or retrieve()');
    this.providers[action]=provider;return this;
  }
  async dispatch(plan,context={}){
    if(!plan||plan.kind!=='CorrectiveRetrievalPlan')throw new TypeError('CorrectiveRetrievalPlan required');
    if(plan.attempt!==1)fail(FailureCode.SCHEMA_INVALID,'only one foreground corrective attempt is permitted');
    const provider=this.providers[plan.action];
    if(!provider)return freeze({kind:'CorrectiveRetrievalResult',status:'UNAVAILABLE',planId:plan.planId,action:plan.action,candidateSet:null,
      reason:'CORRECTIVE_PROVIDER_UNAVAILABLE',authorityGranted:false});
    try{
      const value=typeof provider==='function'?await provider(structuredClone(plan),context):await provider.retrieve(structuredClone(plan),context);
      return freeze({kind:'CorrectiveRetrievalResult',status:'SUCCESS',planId:plan.planId,action:plan.action,result:structuredClone(value),authorityGranted:false});
    }catch(error){
      return freeze({kind:'CorrectiveRetrievalResult',status:'DEGRADED',planId:plan.planId,action:plan.action,candidateSet:null,
        reason:error?.code??'CORRECTIVE_PROVIDER_FAILED',message:error?.message??String(error),authorityGranted:false});
    }
  }
}

export function mergeCorrectiveCandidateSets(firstPass,corrective,{maxCandidates=64}={}) {
  const first=asEnvelope(firstPass);
  const second=asEnvelope(corrective);
  const candidates=[...first.candidates,...second.candidates];
  return createCandidateBusEnvelope({
    candidateSetId:`corrected:${first.candidateSetId}`,
    query:first.query??second.query??null,
    intentFingerprint:first.intentFingerprint??second.intentFingerprint??null,
    sourceRevisionSet:[...new Set([...(first.sourceRevisionSet??[]),...(second.sourceRevisionSet??[])])],
    worldRevision:Math.max(Number(first.worldRevision??0),Number(second.worldRevision??0)),
    sceneRevision:Math.max(Number(first.sceneRevision??0),Number(second.sceneRevision??0)),
    candidates,
    unavailableChannels:[...new Set([...(first.unavailableChannels??[]),...(second.unavailableChannels??[])])],
    maxCandidates:Math.min(256,Math.max(1,Number(maxCandidates)||64)),
  });
}

export function createRetrievalAbstentionReceipt({
  reason,quality,retrievalIntentIds=[],missingIntents=[],attemptedChannels=[],unavailableChannels=[],
  correctiveAttemptUsed=false,revisionFence={},authorityGranted=false,
}={}) {
  return freeze({
    kind:'RetrievalAbstentionReceipt',
    reason:required(reason??'INSUFFICIENT_RETRIEVAL','reason'),
    quality:quality??RetrievalQuality.LOW,
    retrievalIntentIds:strings(retrievalIntentIds,32,'retrievalIntentIds'),
    missingIntents:strings(missingIntents,32,'missingIntents'),
    attemptedChannels:strings(attemptedChannels,32,'attemptedChannels'),
    unavailableChannels:strings(unavailableChannels,32,'unavailableChannels'),
    correctiveAttemptUsed:Boolean(correctiveAttemptUsed),
    revisionFence:structuredClone(revisionFence??{}),
    authorityGranted:false,
  });
}

export class AdaptiveRetrievalController {
  constructor({maxCorrectiveAttempts=1,chooseCorrectiveAction=null,dispatcher=null}={}){
    this.maxCorrectiveAttempts=Math.min(1,Math.max(0,Number(maxCorrectiveAttempts)||0));
    this.chooseCorrectiveAction=chooseCorrectiveAction;
    this.dispatcher=dispatcher;
  }

  async run({retrieve,evaluate=evaluateRetrievalQuality,query,context={},simpleTurn=false}={}){
    if(typeof retrieve!=='function')throw new TypeError('retrieve is required');
    if(typeof evaluate!=='function')throw new TypeError('evaluate is required');
    if(simpleTurn)return freeze({action:'SKIP',attempts:0,result:null,quality:null,allowLongTermMemory:false,correctivePasses:0,canonicalTruthGranted:false});

    let result=await retrieve({query,context,attempt:0,correctiveAction:null,correctivePlan:null});
    let quality=await evaluate(result,{query,context,attempt:0});
    let decision=retrievalControlDecision({quality:quality.quality??quality,correctiveAttempt:0,maxCorrectiveAttempts:this.maxCorrectiveAttempts,recommendedAction:this.#action(result,quality,context)});
    let correctivePasses=0;
    let correctionPlan=null;
    let correctionResult=null;

    if(decision.action==='CORRECTIVE_RETRIEVAL'){
      correctivePasses=1;
      correctionPlan=createCorrectiveRetrievalPlan({
        turnId:context.turnId??'turn',intentFingerprint:context.intentFingerprint??'intent:unknown',
        reason:quality.reason??decision.reason,targetIntentIds:quality.missingIntentIds??quality.missingIntents??[],
        missingEvidence:quality.missingEvidence??quality.reasonCodes??[],action:decision.correctiveAction,
        allowedProviderClass:context.allowedProviderClass??null,queryDelta:context.queryDelta??query??null,
        entityConstraints:quality.missingEntityRefs??context.entityConstraints??[],temporalConstraint:quality.temporalCorrection??context.temporalConstraint??null,
        maxCandidates:context.maxCorrectiveCandidates??24,maxEvidenceBytes:context.maxCorrectiveEvidenceBytes??32768,
        sourceRevisionSet:context.sourceRevisionSet??[],worldRevision:context.worldRevision??0,sceneRevision:context.sceneRevision??0,
        softDeadline:context.softDeadline??0,hardDeadline:context.hardDeadline??0,attempt:1,
      });

      let corrected;
      if(this.dispatcher){
        correctionResult=await this.dispatcher.dispatch(correctionPlan,{query,context,firstPass:result});
        corrected=correctionResult.status==='SUCCESS'?(correctionResult.result?.candidateSet??correctionResult.result):null;
      }else{
        corrected=await retrieve({query,context,attempt:1,correctiveAction:decision.correctiveAction,correctivePlan:correctionPlan,priorResult:result});
      }
      if(corrected)result=mergeCompatibleResults(result,corrected,context.maxCandidates??64);
      quality=await evaluate(result,{query,context,attempt:1,correctivePlan:correctionPlan});
      decision=retrievalControlDecision({quality:quality.quality??quality,correctiveAttempt:1,maxCorrectiveAttempts:this.maxCorrectiveAttempts,recommendedAction:this.#action(result,quality,context)});
    }

    const abstention=decision.action==='NO_LONG_TERM_MEMORY'?createRetrievalAbstentionReceipt({
      reason:decision.reason,quality:quality.quality??quality,retrievalIntentIds:quality.requiredIntentIds??context.retrievalIntentIds??[],
      missingIntents:quality.missingIntentIds??[],attemptedChannels:quality.attemptedChannels??context.attemptedChannels??[],
      unavailableChannels:quality.unavailableChannels??result?.unavailableChannels??[],correctiveAttemptUsed:correctivePasses===1,
      revisionFence:{sourceRevisionSet:context.sourceRevisionSet??[],worldRevision:context.worldRevision??0,sceneRevision:context.sceneRevision??0,intentFingerprint:context.intentFingerprint??null},
    }):null;

    return freeze({
      action:decision.action,attempts:1+correctivePasses,correctivePasses,result:structuredClone(result),quality:structuredClone(quality),
      allowLongTermMemory:decision.allowLongTermMemory,reason:decision.reason,correctivePlan,correctionResult,abstention,canonicalTruthGranted:false,
    });
  }

  #action(result,quality,context){
    const proposed=typeof this.chooseCorrectiveAction==='function'?this.chooseCorrectiveAction({result,quality,context}):null;
    if(proposed)return proposed;
    if((quality.missingEntityRefs??[]).length)return CorrectiveRetrievalAction.ENTITY_CONSTRAINED_SEARCH;
    if((quality.temporalMismatchCount??0)>0)return CorrectiveRetrievalAction.TEMPORAL_NARROWING;
    if((quality.exactIdentifierMissing??false)===true)return CorrectiveRetrievalAction.SPARSE_RETRY;
    if((quality.relationshipCoverageMissing??false)===true)return CorrectiveRetrievalAction.GRAPH_EXPANSION;
    if((quality.semanticMismatch??false)===true)return CorrectiveRetrievalAction.DENSE_RETRY;
    return CorrectiveRetrievalAction.QUERY_REFORMULATION;
  }
}

function evaluateIntentCoverage(input){
  const required=normalizeIntentIds(input.requiredIntents??input.requiredIntentIds??[]);
  const candidates=input.candidates??input.candidateSet?.candidates??[];
  const satisfied=new Set(input.satisfiedIntentIds??[]);
  for(const candidate of candidates){
    if(candidate.freshness==='STALE')continue;
    for(const id of candidate.retrievalIntentIds??candidate.metadata?.retrievalIntentIds??[])if(required.includes(id))satisfied.add(id);
  }
  const missing=required.filter((id)=>!satisfied.has(id));
  const contradictoryCount=count(input.contradictoryCount,candidates.filter((x)=>['CONTRADICTED','UNRESOLVED'].includes(x.truthStatus)).length);
  const staleCount=count(input.staleCount,candidates.filter((x)=>x.freshness==='STALE').length);
  const unresolvedCount=count(input.unresolvedCount,candidates.filter((x)=>['UNCERTAIN','UNRESOLVED'].includes(x.truthStatus)).length);
  const temporalMismatchCount=count(input.temporalMismatchCount,candidates.filter((x)=>x.metadata?.temporalMismatch===true).length);
  const perspectiveMismatchCount=count(input.perspectiveMismatchCount,candidates.filter((x)=>x.metadata?.perspectiveMismatch===true).length);
  const provenanceIncompleteCount=count(input.provenanceIncompleteCount,candidates.filter((x)=>!(x.provenance??[]).length).length);
  const missingEntityRefs=strings(input.missingEntityRefs??[],32,'missingEntityRefs');
  const attemptedChannels=strings(input.attemptedChannels??[...new Set(candidates.map((x)=>x.channel).filter(Boolean))],32,'attemptedChannels');
  const unavailableChannels=strings(input.unavailableChannels??input.candidateSet?.unavailableChannels??[],32,'unavailableChannels');
  const confidence=clamp(input.precisionConfidence??input.confidence??(required.length? satisfied.size/required.length:0));
  const coverage=required.length?satisfied.size/required.length:(candidates.length?1:0);
  let quality,reason;
  if(!candidates.length||(!satisfied.size&&required.length)){quality=RetrievalQuality.LOW;reason='REQUIRED_INTENTS_UNSATISFIED';}
  else if(missing.length||staleCount||contradictoryCount||unresolvedCount||temporalMismatchCount||perspectiveMismatchCount||provenanceIncompleteCount||missingEntityRefs.length||unavailableChannels.length||confidence<0.65){
    quality=RetrievalQuality.MIXED;reason='INTENT_COVERAGE_INCOMPLETE_OR_UNCERTAIN';
  }else{quality=RetrievalQuality.HIGH;reason='REQUIRED_INTENTS_COVERED';}
  return freeze({
    kind:'RetrievalQualityReceipt',quality,reason,requiredIntentIds:required,satisfiedIntentIds:[...satisfied],missingIntentIds:missing,
    candidateCount:candidates.length,coverage,contradictoryCount,staleCount,unresolvedCount,temporalMismatchCount,perspectiveMismatchCount,
    provenanceIncompleteCount,missingEntityRefs,attemptedChannels,unavailableChannels,precisionConfidence:confidence,
    relationshipCoverageMissing:Boolean(input.relationshipCoverageMissing),exactIdentifierMissing:Boolean(input.exactIdentifierMissing),
    semanticMismatch:Boolean(input.semanticMismatch),canonicalTruthGranted:false,truthClassificationPerformed:false,
  });
}

function evaluateLegacyQuality({
  candidateCount=0,relevantCount=0,contradictoryCount=0,staleCount=0,unresolvedCount=0,requiredCoverage=1,confidence=0,
}={}){
  const total=Math.max(0,Number(candidateCount)||0);
  const relevant=Math.max(0,Math.min(total,Number(relevantCount)||0));
  const contradictions=Math.max(0,Number(contradictoryCount)||0);
  const stale=Math.max(0,Number(staleCount)||0);
  const unresolved=Math.max(0,Number(unresolvedCount)||0);
  const coverage=total?relevant/total:0;
  const required=clamp(requiredCoverage),cf=clamp(confidence);
  let quality,reason;
  if(!total||!relevant||coverage<Math.min(0.25,required)){quality=RetrievalQuality.LOW;reason='INSUFFICIENT_RELEVANT_EVIDENCE';}
  else if(contradictions||stale||unresolved||coverage<required||cf<0.65){quality=RetrievalQuality.MIXED;reason='USEFUL_WITH_UNCERTAINTY';}
  else{quality=RetrievalQuality.HIGH;reason='USEFUL_AND_WELL_COVERED';}
  return freeze({kind:'RetrievalQualityReceipt',quality,reason,candidateCount:total,relevantCount:relevant,contradictoryCount:contradictions,
    staleCount:stale,unresolvedCount:unresolved,coverage,confidence:cf,canonicalTruthGranted:false,truthClassificationPerformed:false});
}

function mergeCompatibleResults(first,corrected,maxCandidates){
  if(first?.kind==='CandidateBusEnvelope'||corrected?.kind==='CandidateBusEnvelope'||Array.isArray(first?.candidates)||Array.isArray(corrected?.candidates)){
    return mergeCorrectiveCandidateSets(first,corrected,{maxCandidates});
  }
  return corrected;
}
function asEnvelope(value){
  if(value?.kind==='CandidateBusEnvelope')return value;
  return createCandidateBusEnvelope({...value,candidates:value?.candidates??[],maxCandidates:Math.max(1,value?.candidates?.length??1)});
}
function normalizeIntentIds(values){
  if(!Array.isArray(values))throw new TypeError('required intents must be an array');
  return [...new Set(values.map((x)=>required(typeof x==='string'?x:x.intentId??x.id,'intentId')))];
}
function receipt(value){return freeze({...value,canonicalTruthGranted:false});}
function strings(v,max,name){if(!Array.isArray(v))fail(FailureCode.SCHEMA_INVALID,`${name} must be array`);const out=[...new Set(v.map((x)=>required(x,name)))];if(out.length>max)fail(FailureCode.SCHEMA_INVALID,`${name} exceeds ${max}`);return out;}
function boundedInt(v,min,max,name){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)fail(FailureCode.SCHEMA_INVALID,`${name} must be ${min}..${max}`);return n;}
function finite(v,name){const n=Number(v);if(!Number.isFinite(n))fail(FailureCode.SCHEMA_INVALID,`${name} must be finite`);return n;}
function required(v,name){if(typeof v!=='string'||!v.trim())fail(FailureCode.SCHEMA_INVALID,`${name} must be non-empty string`);return v.trim();}
function count(explicit,fallback){return explicit==null?fallback:Math.max(0,Number(explicit)||0);}
function clamp(value){const n=Number(value);if(!Number.isFinite(n))return 0;return Math.max(0,Math.min(1,n));}
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;}
