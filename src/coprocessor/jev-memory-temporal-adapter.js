import { ResultClass } from './constants.js';
import { deepFreeze } from './contracts.js';
import { JevDecisionShape, JevOutcome, createJevDecisionRequest } from './jev-contracts.js';
import {
  JevAdapterPrecheckStatus,JevDomain,assertAdapterInputBounds,createOwnerProposal,validateReceiptAgainstRequest,
} from './jev-domain-adapter.js';

export const MemoryJevDecisionKind=Object.freeze({
  KNOWLEDGE_BELIEF:'MEMORY_KNOWLEDGE_BELIEF_CLASSIFICATION',
  CONSOLIDATION_REVIEW:'MEMORY_CONSOLIDATION_REVIEW',
});

export const TemporalJevDecisionKind=Object.freeze({
  TRANSITION_CONTRADICTION:'TEMPORAL_TRANSITION_CONTRADICTION',
});

const MEMORY_KNOWLEDGE=new Set(['KNOWN','BELIEVED','FALSE_BELIEF','UNCERTAIN','UNRESOLVED']);
const MEMORY_CONSOLIDATION=new Set(['ACCEPT_PROPOSAL','REJECT_PROPOSAL','REWORK_PROPOSAL','UNRESOLVED']);
const TEMPORAL=new Set(['TRANSITION','CONTRADICTION','TEMPORALLY_DISTINCT','UNRESOLVED']);

export function createMemoryJevAdapter(){return createAdapter({
  adapterId:'jev.adapter.memory.v1',domainId:JevDomain.MEMORY,supportedDecisionKinds:Object.values(MemoryJevDecisionKind),
  normalize:normalizeMemory,
  optionSet(input){return input.decisionKind===MemoryJevDecisionKind.KNOWLEDGE_BELIEF?MEMORY_KNOWLEDGE:MEMORY_CONSOLIDATION;},
  rejection(option,input,evidence){
    if(option.illegal||option.payload?.durableMutation||option.payload?.claimsWorldTruth||option.payload?.bypassSettlement||option.payload?.promotesInferredToObserved)return'MEMORY_OWNER_AUTHORITY_RULE';
    if(input.decisionKind===MemoryJevDecisionKind.KNOWLEDGE_BELIEF&&option.optionId==='KNOWN'&&input.characterRef){
      for(const ref of option.evidenceRefs){
        const row=evidence.find(x=>x.evidenceId===ref),knownBy=row?.metadata?.knownBy;
        if(Array.isArray(knownBy)&&!knownBy.includes(input.characterRef))return'CHARACTER_KNOWLEDGE_SCOPE_VIOLATION';
      }
    }
    return null;
  },
  domainRevisions(input){return{memory:input.memoryRevision,owner:input.ownerRevision};},
  proposalType:'MemoryDecisionProposal',
  details(outcome,receipt,input){return{
    semanticDecision:outcome,characterRef:input.characterRef??null,memoryMutation:false,worldTruthMutation:false,
    characterKnowledgeMutation:false,settlementByJev:false,foregroundEligible:receipt?.admission?.foregroundEligible!==false,
    late:Boolean(receipt?.admission?.late),ownerReviewRequired:true,
  };},
  explanation(receipt,outcome){
    if(receipt?.admission?.late)return'Memory Jev result arrived after the generation seal and is not foreground-eligible.';
    if(receipt?.abstained||outcome==='UNRESOLVED')return'Jev preserved Memory ambiguity; Memory owner policy must decide whether any durable change is warranted.';
    if(receipt?.serviceStatus==='JEV_SKIPPED')return'Jev was skipped because Memory owner prechecks left one deterministic bounded outcome.';
    return'Jev proposed a bounded Memory interpretation; Memory ownership and Settlement remain external.';
  },
});}

export function createTemporalJevAdapter(){return createAdapter({
  adapterId:'jev.adapter.temporal.v1',domainId:JevDomain.TEMPORAL,supportedDecisionKinds:Object.values(TemporalJevDecisionKind),
  normalize:normalizeTemporal,optionSet(){return TEMPORAL;},
  rejection(option){
    if(option.illegal||option.payload?.durableMutation||option.payload?.claimsAuthority||option.payload?.rewritesProvenance||option.payload?.promotesHistoricalToCurrent)return'TEMPORAL_OWNER_AUTHORITY_RULE';
    return null;
  },
  domainRevisions(input){return{temporal:input.temporalRevision,owner:input.ownerRevision};},
  proposalType:'TemporalDecisionProposal',
  details(outcome,receipt){return{
    semanticDecision:outcome,temporalMutation:false,historicalToCurrentPromotion:false,provenanceRewrite:false,
    settlementByJev:false,foregroundEligible:receipt?.admission?.foregroundEligible!==false,
    late:Boolean(receipt?.admission?.late),ownerReviewRequired:true,
  };},
  explanation(receipt,outcome){
    if(receipt?.admission?.late)return'Temporal Jev result arrived after the generation seal and cannot alter the sealed foreground context.';
    if(receipt?.abstained||outcome==='UNRESOLVED')return'Jev preserved temporal ambiguity instead of forcing transition or contradiction.';
    if(receipt?.serviceStatus==='JEV_SKIPPED')return'Jev was skipped because Temporal owner prechecks determined the bounded outcome.';
    return'Jev proposed a bounded temporal interpretation; the Temporal/Memory owner retains revision and Settlement authority.';
  },
});}

function createAdapter(spec){
  return deepFreeze({
    adapterId:spec.adapterId,domainId:spec.domainId,adapterVersion:'1.0.0',supportedDecisionKinds:spec.supportedDecisionKinds,
    canAdapt(input){return Boolean(input&&input.domain===spec.domainId&&spec.supportedDecisionKinds.includes(input.decisionKind));},
    deterministicPrecheck(input){
      const n=spec.normalize(input),allowed=spec.optionSet(n);
      for(const option of n.options)if(!allowed.has(option.optionId))throw new TypeError('unsupported '+spec.domainId+' option: '+option.optionId);
      const rejectedOptionIds=n.options.filter(o=>spec.rejection(o,n,n.evidence)).map(o=>o.optionId);
      const viable=n.options.filter(o=>!rejectedOptionIds.includes(o.optionId));
      if(n.deterministicOutcome){
        const option=viable.find(o=>o.optionId===n.deterministicOutcome);
        if(!option)throw new TypeError(spec.domainId+' deterministicOutcome must name a viable option');
        return precheck(JevAdapterPrecheckStatus.DETERMINISTIC,{reasonCodes:[spec.domainId+'_OWNER_DETERMINISTIC'],rejectedOptionIds,deterministicAnswer:answer(option,rejectedOptionIds)});
      }
      if(viable.length===1)return precheck(JevAdapterPrecheckStatus.DETERMINISTIC,{reasonCodes:['ONLY_ONE_OWNER_VALID_'+spec.domainId+'_OPTION'],rejectedOptionIds,deterministicAnswer:answer(viable[0],rejectedOptionIds)});
      if(!viable.length)return precheck(JevAdapterPrecheckStatus.UNRESOLVED_WITHOUT_JEV,{reasonCodes:['NO_VALID_'+spec.domainId+'_OPTION'],rejectedOptionIds});
      return precheck(JevAdapterPrecheckStatus.JEV_REQUIRED,{reasonCodes:[spec.domainId+'_BOUNDED_AMBIGUITY'],rejectedOptionIds});
    },
    buildRequest(input,pre){
      const n=spec.normalize(input),rejected=n.options.filter(o=>spec.rejection(o,n,n.evidence));
      return createJevDecisionRequest({
        decisionId:n.decisionId,decisionType:n.decisionKind,decisionShape:JevDecisionShape.CHOOSE_ONE,
        turnId:n.turnId,taskId:n.taskId,correlationId:n.correlationId,causationId:n.causationId,
        options:n.options.map(toOption),evidenceRefs:n.evidence,provenanceRefs:n.provenanceRefs,
        constraints:rejected.map(o=>({constraintId:spec.domainId.toLowerCase()+':owner-rule:'+o.optionId,type:spec.domainId+'_OWNER_RULE',hard:true,violatedOptionIds:[o.optionId],reasonCode:spec.rejection(o,n,n.evidence),description:'Owner policy rejects this authority-unsafe option.'})),
        allowedOutcomes:[JevDecisionShape.CHOOSE_ONE,JevDecisionShape.UNRESOLVED,JevDecisionShape.ABSTAIN,JevDecisionShape.ESCALATE,JevDecisionShape.REQUEST_OPERATOR],
        authorityBoundary:{authorityClass:'ADVISORY',ownerId:n.owner,notes:'Jev may propose only; domain owner validates revisions and performs any allowed Settlement.'},
        sourceRevisionSet:n.sourceRevisionSet,worldRevision:n.worldRevision,sceneRevision:n.sceneRevision,characterStateRevision:n.characterStateRevision,
        domainRevisions:spec.domainRevisions(n),freshnessToken:n.freshnessToken,abstentionAllowed:true,
        escalationPolicy:{allowedTargets:['OWNER','OPERATOR','DEEP_REVIEW','RETRY_LATER','UNRESOLVED'],defaultTarget:'OWNER',maxRetries:n.maxRetries},
        deadline:n.deadline,softDeadline:n.softDeadline,resultClass:n.resultClass,cognitiveLayer:n.cognitiveLayer,
        domainAdapterId:spec.adapterId,domainAdapterVersion:'1.0.0',routing:n.routing,
        metadata:{domain:spec.domainId,decisionKind:n.decisionKind,precheckStatus:pre.status,ownerReviewRequired:true},
      });
    },
    validateReceipt(receipt,context){
      validateReceiptAgainstRequest(receipt,context);
      for(const id of receipt.selectedOptionIds??[]){
        const option=spec.normalize(context.input).options.find(o=>o.optionId===id);
        if(!option||spec.rejection(option,spec.normalize(context.input),spec.normalize(context.input).evidence))throw new TypeError(spec.domainId+' receipt selected owner-rejected option');
      }
      return true;
    },
    interpretReceipt(receipt,{input,request,currentRevisionState,precheck:pre}){
      validateReceiptAgainstRequest(receipt,{request,currentRevisionState});
      const unresolved=[JevOutcome.UNRESOLVED,JevOutcome.ABSTAINED,JevOutcome.STALE,JevOutcome.INVALID].includes(receipt.outcome);
      const outcome=unresolved?'UNRESOLVED':receipt.selectedOptionIds?.[0]??'UNRESOLVED';
      return createOwnerProposal({
        proposalType:spec.proposalType,domain:spec.domainId,decisionKind:input.decisionKind,owner:input.owner??(spec.domainId+'_OWNER'),
        request,receipt,precheck:pre,proposedOutcome:outcome,details:spec.details(outcome,receipt,input),
        explanation:spec.explanation(receipt,outcome),staleState:receipt.outcome===JevOutcome.STALE?'STALE':'FRESH',
      });
    },
    fallbackProposal(input,{reason,error}={}){
      return createOwnerProposal({
        proposalType:spec.proposalType,domain:spec.domainId,decisionKind:input?.decisionKind??(spec.domainId+'_UNKNOWN'),
        owner:input?.owner??(spec.domainId+'_OWNER'),proposedOutcome:'UNRESOLVED',
        details:{semanticDecision:'UNRESOLVED',ownerReviewRequired:true,mutation:false,settlementByJev:false},
        explanation:spec.domainId+' remains unresolved because '+String(reason??'adapter execution degraded')+'.',
        fallbackReason:String(reason??'DEGRADED')+(error?.message?':'+String(error.message).slice(0,120):''),
      });
    },
  });
}

function normalizeMemory(input){
  const n=normalizeCommon(input,JevDomain.MEMORY,Object.values(MemoryJevDecisionKind));
  return{...n,characterRef:input.characterRef??null,memoryRevision:revision(input.memoryRevision??input.domainRevisions?.memory??0),ownerRevision:revision(input.ownerRevision??input.domainRevisions?.owner??0)};
}
function normalizeTemporal(input){
  const n=normalizeCommon(input,JevDomain.TEMPORAL,Object.values(TemporalJevDecisionKind));
  return{...n,temporalRevision:revision(input.temporalRevision??input.domainRevisions?.temporal??0),ownerRevision:revision(input.ownerRevision??input.domainRevisions?.owner??0)};
}
function normalizeCommon(input,domain,kinds){
  if(!input||input.domain!==domain)throw new TypeError(domain+' adapter requires domain '+domain);
  if(!kinds.includes(input.decisionKind))throw new TypeError('unsupported '+domain+' decision kind: '+input.decisionKind);
  const options=normalizeOptions(input.options),evidence=normalizeEvidence(input.evidence);
  assertAdapterInputBounds({options,evidence,provenanceRefs:input.provenanceRefs??[],metadata:input.adapterMetadata??{}});
  for(const option of options)for(const ref of option.evidenceRefs)if(!evidence.some(e=>e.evidenceId===ref))throw new TypeError(domain+' option '+option.optionId+' references unknown evidence '+ref);
  return{
    ...input,decisionId:req(input.decisionId,'decisionId'),turnId:req(input.turnId,'turnId'),taskId:req(input.taskId??('jev:'+input.decisionId),'taskId'),
    correlationId:req(input.correlationId,'correlationId'),owner:req(input.owner??(domain+'_OWNER'),'owner'),options,evidence,
    provenanceRefs:strings(input.provenanceRefs??[]),sourceRevisionSet:strings(input.sourceRevisionSet??[]),
    worldRevision:finite(input.worldRevision??0),sceneRevision:finite(input.sceneRevision??0),characterStateRevision:finite(input.characterStateRevision??0),
    freshnessToken:req(input.freshnessToken??(domain.toLowerCase()+':'+input.decisionId),'freshnessToken'),
    deadline:finite(input.deadline??Number.MAX_SAFE_INTEGER),softDeadline:finite(input.softDeadline??input.deadline??Number.MAX_SAFE_INTEGER),
    resultClass:input.resultClass??ResultClass.OPPORTUNISTIC,cognitiveLayer:input.cognitiveLayer??'L1',
    maxRetries:integer(input.maxRetries??1,0,3),routing:input.routing??{expectedDecisionValue:.8,latencyPenalty:.05,costPenalty:.03,uncertaintyPenalty:.05,authorityRisk:0,minimumInvocationValue:.2},
  };
}
function normalizeOptions(values){if(!Array.isArray(values))throw new TypeError('options must be array');const seen=new Set();return values.map(v=>{const o={optionId:req(v.optionId??v.id,'optionId'),label:String(v.label??v.optionId??v.id).slice(0,240),evidenceRefs:strings(v.evidenceRefs??[]),provenanceRefs:strings(v.provenanceRefs??[]),payload:structuredClone(v.payload??{}),illegal:Boolean(v.illegal)};if(seen.has(o.optionId))throw new TypeError('duplicate optionId');seen.add(o.optionId);return o;});}
function normalizeEvidence(values=[]){if(!Array.isArray(values))throw new TypeError('evidence must be array');return values.map(v=>({evidenceId:req(v.evidenceId??v.ref,'evidenceId'),sourceRef:v.sourceRef??null,summary:String(v.summary??'').slice(0,1200),provenanceRefs:strings(v.provenanceRefs??[]),revision:v.revision??null,available:v.available!==false,stale:Boolean(v.stale),metadata:structuredClone(v.metadata??{})}));}
function toOption(o){return{optionId:o.optionId,label:o.label,evidenceRefs:o.evidenceRefs,provenanceRefs:o.provenanceRefs,requiresEvidence:o.evidenceRefs.length>0,payload:o.payload};}
function answer(option,rejected){return{outcome:JevOutcome.DECIDED,decisionCode:JevDecisionShape.CHOOSE_ONE,selectedOptionIds:[option.optionId],rejectedOptionIds:rejected.filter(id=>id!==option.optionId),evidenceUsed:[...option.evidenceRefs],confidence:1,reasonCodes:['OWNER_DETERMINISTIC']};}
function precheck(status,extra={}){return deepFreeze({kind:'JevAdapterPrecheckReceipt',status,...extra});}
function req(v,n){if(typeof v!=='string'||!v.trim())throw new TypeError(n+' must be non-empty string');return v.trim();}
function strings(v){if(!Array.isArray(v))throw new TypeError('expected array');return[...new Set(v.map(x=>req(x,'array value')))];}
function finite(v){const n=Number(v);if(!Number.isFinite(n))throw new TypeError('value must be finite');return n;}
function revision(v){return['string','number'].includes(typeof v)&&String(v)?v:0;}
function integer(v,min,max){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw new TypeError('integer must be '+min+'-'+max);return n;}
