const clone=(v)=>structuredClone(v);
const req=(v,n)=>{if(typeof v!=='string'||!v.length)throw new TypeError(`${n} must be a non-empty string`);return v;};
const major=(v)=>String(v??'1').replace(/^v/i,'').split('.')[0];

export const IntegrationCompatibilityStatus=Object.freeze({
  COMPATIBLE:'COMPATIBLE',PARTIAL:'PARTIAL',BLOCKED_ON_OTHER_LANE:'BLOCKED_ON_OTHER_LANE',MISMATCH:'MISMATCH',
});
export const IntegrationContractFamily=Object.freeze({
  ARTIFACT_REFERENCE:'ARTIFACT_ENVELOPE_REFERENCE',
  COGNITIVE_EVENT:'COGNITIVE_EVENT_ENVELOPE',
  REVISION_FENCES:'REVISION_FENCES',
  IDENTITY:'TURN_CORRELATION_CAUSATION_IDENTITY',
  RESULT_BUS:'RESULT_BUS_ELIGIBILITY',
  STRUCTURED_OUTPUT:'STRUCTURED_OUTPUT_VALIDATION',
  DEPENDENCY_STATE:'DEPENDENCY_STATE',
  CONTEXT_SEAL:'CONTEXT_SEAL_ADMISSION',
  PROMPT_PLAN:'PROMPT_PLAN_IDENTITY',
  DIAGNOSTIC_FORENSIC:'DIAGNOSTIC_FORENSIC_REFERENCES',
});

export function createContractDeclaration({lane,checkpoint,accepted=true,contracts=[]}={}){
  return{kind:'IntegrationContractDeclaration',lane:req(lane,'lane'),checkpoint:req(checkpoint,'checkpoint'),accepted:Boolean(accepted),
    contracts:contracts.map(x=>({family:req(x.family,'contract.family'),version:req(x.version??'1.0.0','contract.version'),features:[...new Set(x.features??[])].sort(),requiredFeatures:[...new Set(x.requiredFeatures??[])].sort(),adapterRequired:Boolean(x.adapterRequired),liveAccepted:x.liveAccepted!==false,notes:x.notes??null}))};
}
export function compareContractFamily(family,left,right){
  const a=left?.contracts?.find(x=>x.family===family),b=right?.contracts?.find(x=>x.family===family);
  if(!a||!b)return{family,status:IntegrationCompatibilityStatus.BLOCKED_ON_OTHER_LANE,reason:'CONTRACT_DECLARATION_MISSING',left:clone(a??null),right:clone(b??null)};
  if(major(a.version)!==major(b.version))return{family,status:IntegrationCompatibilityStatus.MISMATCH,reason:'MAJOR_VERSION_MISMATCH',left:clone(a),right:clone(b)};
  const af=new Set(a.features),bf=new Set(b.features),missingLeft=b.requiredFeatures.filter(x=>!af.has(x)),missingRight=a.requiredFeatures.filter(x=>!bf.has(x));
  if(missingLeft.length||missingRight.length)return{family,status:IntegrationCompatibilityStatus.MISMATCH,reason:'REQUIRED_FEATURE_MISMATCH',missingLeft,missingRight,left:clone(a),right:clone(b)};
  if(!left.accepted||!right.accepted)return{family,status:IntegrationCompatibilityStatus.BLOCKED_ON_OTHER_LANE,reason:'CHECKPOINT_NOT_ACCEPTED',left:clone(a),right:clone(b)};
  if(a.adapterRequired||b.adapterRequired||!a.liveAccepted||!b.liveAccepted)return{family,status:IntegrationCompatibilityStatus.PARTIAL,reason:a.adapterRequired||b.adapterRequired?'ADAPTER_OR_INTEGRATION_REQUIRED':'LIVE_ACCEPTANCE_PENDING',left:clone(a),right:clone(b)};
  return{family,status:IntegrationCompatibilityStatus.COMPATIBLE,reason:'CONTRACTS_COMPATIBLE',left:clone(a),right:clone(b)};
}
export function buildIntegrationContractMatrix({core,scene,coprocessor,runtime,ui}={}){
  const pairs=[['CORE_SCENE',core,scene],['CORE_COPROCESSOR',core,coprocessor],['CORE_RUNTIME',core,runtime],['CORE_UI_OBSERVATION',core,ui]];
  const families=Object.values(IntegrationContractFamily),rows=[];
  for(const [pair,left,right] of pairs)for(const family of families)rows.push({pair,...compareContractFamily(family,left,right)});
  const counts=Object.fromEntries(Object.values(IntegrationCompatibilityStatus).map(s=>[s,rows.filter(x=>x.status===s).length]));
  return{kind:'Phase1IntegrationContractMatrix',rows,counts,hasMismatch:counts.MISMATCH>0,blocked:counts.BLOCKED_ON_OTHER_LANE>0,ready:counts.MISMATCH===0,checkpoints:{core:core?.checkpoint??null,scene:scene?.checkpoint??null,coprocessor:coprocessor?.checkpoint??null,runtime:runtime?.checkpoint??null,ui:ui?.checkpoint??null}};
}
