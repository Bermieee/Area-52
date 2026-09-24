import {CoreStructuredOutputValidator,StructuredOutputSchemaRegistry} from './structured-output-validation.js';

const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
const sameSet=(a,b)=>{const aa=uniq(a),bb=uniq(b);return aa.length===bb.length&&aa.every((x,i)=>x===bb[i]);};
const exactKeys=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value))return false;const actual=Object.keys(value).sort(),expected=[...keys].sort();return actual.length===expected.length&&actual.every((x,i)=>x===expected[i]);};
const unit=(v)=>Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1;

export const COPROCESSOR_PRECISION_SCHEMA_ID='COPROCESSOR_PRECISION_RESULT_SET';
export const COPROCESSOR_PRECISION_SCHEMA_VERSION='1.0.0';
export const CoprocessorPrecisionReasonCode=Object.freeze({
  QUERY_MATCH:'QUERY_MATCH',INTENT_MATCH:'INTENT_MATCH',TEMPORAL_MATCH:'TEMPORAL_MATCH',SCENE_MATCH:'SCENE_MATCH',
  MULTI_CHANNEL_SUPPORT:'MULTI_CHANNEL_SUPPORT',LATE_INTERACTION_SELECTED:'LATE_INTERACTION_SELECTED',
  SEMANTIC_CONFIRMED:'SEMANTIC_CONFIRMED',CONTRADICTION_PRESERVED:'CONTRADICTION_PRESERVED',
  DETERMINISTIC_FALLBACK:'DETERMINISTIC_FALLBACK',PROVIDER_RERANK:'PROVIDER_RERANK',
});
const REASONS=new Set(Object.values(CoprocessorPrecisionReasonCode));

export function createCoprocessorPrecisionValidator({candidates=[],requiredCandidateIds=[],maxResults=candidates.length||1}={}){
  const byId=new Map(candidates.map(c=>[String(c.candidateId),c]));
  const registry=new StructuredOutputSchemaRegistry();
  registry.register({
    schemaId:COPROCESSOR_PRECISION_SCHEMA_ID,
    schemaVersion:COPROCESSOR_PRECISION_SCHEMA_VERSION,
    typeValidate:(value)=>{
      const errors=[];
      if(!exactKeys(value,['results','stageSummary']))errors.push('top-level shape must be exactly results/stageSummary');
      if(!Array.isArray(value?.results))errors.push('results must be an array');
      if(value?.results?.length>Math.max(0,Number(maxResults)||0))errors.push('results exceed maxResults');
      for(const [index,row] of (value?.results??[]).entries()){
        if(!exactKeys(row,['candidateId','score','reasonCodes','sourceRevisionRefs','truthStatus','authorityClass']))errors.push('row '+index+' has unsupported/missing fields');
        if(typeof row?.candidateId!=='string'||!row.candidateId)errors.push('row '+index+' candidateId invalid');
        if(!unit(row?.score))errors.push('row '+index+' score invalid');
        if(!Array.isArray(row?.reasonCodes)||row.reasonCodes.some(x=>typeof x!=='string'))errors.push('row '+index+' reasonCodes invalid');
        if(!Array.isArray(row?.sourceRevisionRefs)||row.sourceRevisionRefs.some(x=>typeof x!=='string'))errors.push('row '+index+' sourceRevisionRefs invalid');
        if(typeof row?.truthStatus!=='string'||typeof row?.authorityClass!=='string')errors.push('row '+index+' truth/authority invalid');
      }
      if(value?.stageSummary!==null&&value?.stageSummary!==undefined&&typeof value.stageSummary!=='string')errors.push('stageSummary invalid');
      return{ok:errors.length===0,errors};
    },
    semanticValidate:(value)=>{
      const errors=[],seen=new Set();
      for(const row of value.results){
        const source=byId.get(row.candidateId);
        if(!source){errors.push('unknown candidateId:'+row.candidateId);continue;}
        if(seen.has(row.candidateId))errors.push('duplicate candidateId:'+row.candidateId);seen.add(row.candidateId);
        for(const reason of row.reasonCodes)if(!REASONS.has(reason))errors.push('unknown reasonCode:'+reason);
        if(!sameSet(row.sourceRevisionRefs,source.sourceRevisionRefs??[]))errors.push('wrong revision:'+row.candidateId);
        if(row.authorityClass!==source.authorityClass)errors.push('authority escalation:'+row.candidateId);
        if(row.truthStatus!==source.truthStatus)errors.push('truth status changed:'+row.candidateId);
      }
      for(const id of requiredCandidateIds)if(!seen.has(id))errors.push('required candidate omitted:'+id);
      return{ok:errors.length===0,errors};
    },
    normalize:(value)=>({
      results:value.results.map(row=>({
        candidateId:row.candidateId,
        score:Number(row.score),
        reasonCodes:uniq(row.reasonCodes),
        sourceRevisionRefs:uniq(row.sourceRevisionRefs),
        truthStatus:row.truthStatus,
        authorityClass:row.authorityClass,
      })),
      stageSummary:value.stageSummary==null?null:String(value.stageSummary).slice(0,600),
      authorityGranted:false,
      settlementAuthority:false,
    }),
  });
  return new CoreStructuredOutputValidator({registry});
}

export function canonicalPrecisionProviderShape(value){
  return{
    results:(value?.results??[]).map(row=>({
      candidateId:String(row.candidateId),score:Number(row.score),reasonCodes:uniq(row.reasonCodes),
      sourceRevisionRefs:uniq(row.sourceRevisionRefs),truthStatus:String(row.truthStatus),authorityClass:String(row.authorityClass),
    })),
    stageSummary:value?.stageSummary==null?null:String(value.stageSummary).slice(0,600),
    authorityGranted:false,settlementAuthority:false,
  };
}
