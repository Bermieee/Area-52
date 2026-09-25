import {deliveryHash} from './adaptive-context-contracts.js';

export const DeliveryPolicyStatus=Object.freeze({SHADOW:'SHADOW',QUALIFIED:'QUALIFIED',ACTIVE:'ACTIVE',SUPERSEDED:'SUPERSEDED'});
export const DeliveryEvidenceState=Object.freeze({MEASURED:'MEASURED',REPLAYED:'REPLAYED',NOT_MEASURED:'NOT_MEASURED',NOT_APPLICABLE:'NOT_APPLICABLE'});
const ALLOWED_PARAMETERS=new Set(['positionOrder','structuredContextPreference','sectionAllocationWeights','segmentStrategy','cacheCharacteristics']);
const clone=(v)=>structuredClone(v);
const req=(v,n)=>{if(typeof v!=='string'||!v.length)throw new TypeError(`${n} must be a non-empty string`);return v;};
function normalizeParameters(parameters={}){
  const out={};for(const [key,value] of Object.entries(parameters)){
    if(!ALLOWED_PARAMETERS.has(key))throw new Error(`DELIVERY_POLICY_PARAMETER_FORBIDDEN:${key}`);
    if(key==='positionOrder'){if(!Array.isArray(value)||value.some(x=>typeof x!=='string')||new Set(value).size!==value.length)throw new TypeError('positionOrder must be a unique string array');}
    if(key==='structuredContextPreference'&&!['RICH','COMPACT'].includes(value))throw new TypeError('structuredContextPreference must be RICH or COMPACT');
    if(key==='sectionAllocationWeights'){if(!value||typeof value!=='object'||Array.isArray(value)||Object.values(value).some(x=>!Number.isFinite(Number(x))))throw new TypeError('sectionAllocationWeights must contain finite numeric values');}
    if(key==='segmentStrategy'&&!['BAND_GROUPED','SLOT_ATOMIC'].includes(value))throw new TypeError('segmentStrategy is unsupported');
    if(key==='cacheCharacteristics'&&(!value||typeof value!=='object'||Array.isArray(value)))throw new TypeError('cacheCharacteristics must be an object');
    out[key]=clone(value);
  }return out;
}
function mean(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}

export class DeliveryLearningEngine{
  #feedback=new Map();#policies=new Map();#activeByProfile=new Map();#feedbackOrder=[];#policyOrder=[];
  constructor({benchmarkRevision='delivery-benchmark-v1',minimumEvidence=5,minimumImprovement=.02,maxFeedback=1000,maxPolicies=256}={}){
    this.benchmarkRevision=req(benchmarkRevision,'benchmarkRevision');this.minimumEvidence=Math.max(2,Number(minimumEvidence)||5);this.minimumImprovement=Math.max(0,Number(minimumImprovement)||0);this.maxFeedback=Math.max(this.minimumEvidence,Number(maxFeedback)||1000);this.maxPolicies=Math.max(4,Number(maxPolicies)||256);
  }
  recordFeedback({feedbackId,modelProfileId,policyRef='BASE',benchmarkRevision=this.benchmarkRevision,evidenceRef,measurementState=DeliveryEvidenceState.MEASURED,metrics={}}={}){
    req(feedbackId,'feedbackId');req(modelProfileId,'modelProfileId');req(evidenceRef,'evidenceRef');if(!Object.values(DeliveryEvidenceState).includes(measurementState))throw new TypeError('invalid measurementState');
    const row=Object.freeze({kind:'DeliveryFeedback',feedbackId,modelProfileId,policyRef:String(policyRef),benchmarkRevision:req(benchmarkRevision,'benchmarkRevision'),evidenceRef,measurementState,metrics:clone(metrics)});
    const prior=this.#feedback.get(feedbackId);if(prior){if(JSON.stringify(prior)!==JSON.stringify(row))throw new Error(`DELIVERY_FEEDBACK_ID_CONFLICT:${feedbackId}`);return clone(prior);}
    this.#feedback.set(feedbackId,row);this.#feedbackOrder.push(feedbackId);while(this.#feedbackOrder.length>this.maxFeedback){const id=this.#feedbackOrder.shift();this.#feedback.delete(id);}return clone(row);
  }
  proposeRevision({modelProfileId,evidenceRefs=[],changedParameters={},expectedImprovement=null,confidence=null}={}){
    req(modelProfileId,'modelProfileId');const parameters=normalizeParameters(changedParameters),refs=[...new Set(evidenceRefs)].sort(),prior=this.activePolicyFor(modelProfileId),evaluation=this.#evaluate(modelProfileId,refs);
    const signature={modelProfileId,priorPolicyRef:prior?.policyId??null,evidenceRefs:refs,changedParameters:parameters,benchmarkRevision:this.benchmarkRevision};
    const policyId=`delivery-policy:${modelProfileId}:${deliveryHash(signature).slice(0,20)}`;const existing=this.#policies.get(policyId);if(existing)return clone(existing);
    const ordinal=this.#policyOrder.filter(id=>this.#policies.get(id)?.modelProfileId===modelProfileId).length+1;
    const row={kind:'DeliveryPolicyRevision',policyId,version:`learned-${ordinal}-${deliveryHash(signature).slice(0,8)}`,modelProfileId,priorPolicyRef:prior?.policyId??null,evidenceRefs:refs,changedParameters:parameters,expectedImprovement:expectedImprovement===null?evaluation.averageImprovement:Number(expectedImprovement),confidence:confidence===null?evaluation.confidence:Number(confidence),minimumEvidence:this.minimumEvidence,status:DeliveryPolicyStatus.SHADOW,benchmarkRevision:this.benchmarkRevision,qualification:clone(evaluation)};
    this.#policies.set(policyId,row);this.#policyOrder.push(policyId);while(this.#policyOrder.length>this.maxPolicies){const id=this.#policyOrder[0],p=this.#policies.get(id);if(p?.status===DeliveryPolicyStatus.ACTIVE)break;this.#policyOrder.shift();this.#policies.delete(id);}return clone(row);
  }
  qualify(policyId){const row=this.#requiredPolicy(policyId),evaluation=this.#evaluate(row.modelProfileId,row.evidenceRefs);row.qualification=clone(evaluation);row.expectedImprovement=evaluation.averageImprovement;row.confidence=evaluation.confidence;if(evaluation.eligible)row.status=DeliveryPolicyStatus.QUALIFIED;else row.status=DeliveryPolicyStatus.SHADOW;return clone(row);}
  activate(policyId){const row=this.#requiredPolicy(policyId);if(row.status!==DeliveryPolicyStatus.QUALIFIED)throw new Error(`DELIVERY_POLICY_NOT_QUALIFIED:${policyId}`);const currentId=this.#activeByProfile.get(row.modelProfileId);if(currentId&&currentId!==policyId){const current=this.#policies.get(currentId);if(current)current.status=DeliveryPolicyStatus.SUPERSEDED;}row.status=DeliveryPolicyStatus.ACTIVE;this.#activeByProfile.set(row.modelProfileId,policyId);return clone(row);}
  rollback(modelProfileId,{toPolicyRef=null}={}){const active=this.activePolicyFor(modelProfileId);if(!active)throw new Error(`NO_ACTIVE_DELIVERY_POLICY:${modelProfileId}`);const targetId=toPolicyRef??active.priorPolicyRef;if(!targetId){const current=this.#policies.get(active.policyId);current.status=DeliveryPolicyStatus.SUPERSEDED;this.#activeByProfile.delete(modelProfileId);return{rolledBackFrom:active.policyId,activePolicy:null};}const target=this.#policies.get(targetId);if(!target||target.modelProfileId!==modelProfileId)throw new Error(`ROLLBACK_POLICY_NOT_FOUND:${targetId}`);this.#policies.get(active.policyId).status=DeliveryPolicyStatus.SUPERSEDED;target.status=DeliveryPolicyStatus.ACTIVE;this.#activeByProfile.set(modelProfileId,targetId);return{rolledBackFrom:active.policyId,activePolicy:clone(target)};}
  activePolicyFor(modelProfileId){const id=this.#activeByProfile.get(modelProfileId),row=id?this.#policies.get(id):null;return row?clone(row):null;}
  applyToProfile(profile){const policy=this.activePolicyFor(profile.modelProfileId);if(!policy)return{profile:clone(profile),policy:null};return{profile:{...clone(profile),...clone(policy.changedParameters),deliveryPolicyRevision:policy.version},policy};}
  policy(policyId){const row=this.#policies.get(policyId);return row?clone(row):null;}
  feedback(){return this.#feedbackOrder.map(id=>clone(this.#feedback.get(id))).filter(Boolean);}
  policies(){return this.#policyOrder.map(id=>clone(this.#policies.get(id))).filter(Boolean);}
  stats(){return{feedbackCount:this.#feedback.size,policyCount:this.#policies.size,activePolicies:this.#activeByProfile.size,maxFeedback:this.maxFeedback,maxPolicies:this.maxPolicies};}
  #requiredPolicy(id){const row=this.#policies.get(id);if(!row)throw new Error(`UNKNOWN_DELIVERY_POLICY:${id}`);return row;}
  #evaluate(modelProfileId,refs){
    const rows=refs.map(id=>this.#feedback.get(id)).filter(Boolean),reasons=[];if(rows.length<refs.length)reasons.push('MISSING_EVIDENCE');if(rows.length<this.minimumEvidence)reasons.push('MINIMUM_EVIDENCE_NOT_MET');
    if(rows.some(x=>x.modelProfileId!==modelProfileId))reasons.push('PROFILE_MISMATCH');if(rows.some(x=>x.benchmarkRevision!==this.benchmarkRevision))reasons.push('STALE_BENCHMARK_EVIDENCE');if(rows.some(x=>![DeliveryEvidenceState.MEASURED,DeliveryEvidenceState.REPLAYED].includes(x.measurementState)))reasons.push('UNMEASURED_EVIDENCE');
    const protectedFields=['semanticRetention','protectedRetention','unresolvedRetention','factualRetention','temporalRetention','provenanceRetention'];for(const field of protectedFields)if(rows.some(x=>x.metrics?.[field]!==undefined&&Number(x.metrics[field])<1))reasons.push(`PROTECTED_RETENTION_REGRESSION:${field}`);
    if(rows.some(x=>x.metrics?.semanticEquivalent===false))reasons.push('SEMANTIC_PACKET_CHANGED');if(rows.some(x=>x.metrics?.baselinePacketHash&&x.metrics?.candidatePacketHash&&x.metrics.baselinePacketHash!==x.metrics.candidatePacketHash))reasons.push('SEMANTIC_PACKET_CHANGED');
    const improvements=rows.map(x=>Number(x.metrics?.improvementScore??0)).filter(Number.isFinite),averageImprovement=mean(improvements);if(averageImprovement<this.minimumImprovement)reasons.push('MINIMUM_IMPROVEMENT_NOT_MET');
    const eligible=reasons.length===0,confidence=Math.min(1,rows.length/(this.minimumEvidence*2));return{eligible,reasons:[...new Set(reasons)],sampleCount:rows.length,averageImprovement:Number(averageImprovement.toFixed(6)),confidence:Number(confidence.toFixed(6)),requiredSemanticFloor:1,minimumImprovement:this.minimumImprovement,benchmarkRevision:this.benchmarkRevision};
  }
}

export function feedbackMetricsFromBenchmark(benchmark,{improvementScore=0,semanticEquivalent=true,baselinePacketHash=null,candidatePacketHash=baselinePacketHash}={}){
  return{semanticRetention:Number(benchmark.semanticRetention??benchmark.factualRetention??1),protectedRetention:Number(benchmark.protectedRetention??benchmark.semanticRetention??1),unresolvedRetention:Number(benchmark.unresolvedRetention??benchmark.unresolvedThreadRetention??1),factualRetention:Number(benchmark.factualRetention??benchmark.semanticRetention??1),temporalRetention:Number(benchmark.temporalQualifierRetention??benchmark.temporalRetention??1),provenanceRetention:Number(benchmark.provenanceReferenceRetention??benchmark.provenanceRetention??1),improvementScore:Number(improvementScore),semanticEquivalent:Boolean(semanticEquivalent),baselinePacketHash,candidatePacketHash};
}
