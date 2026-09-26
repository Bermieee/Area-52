import {RetentionClass} from './cognitive-audit-contracts.js';
import {clone,req} from './framework-utils.js';

const DEFAULTS=Object.freeze({
  [RetentionClass.LIGHTWEIGHT_METADATA]:{ttl:null,maxBytes:0,retainDetail:false},
  [RetentionClass.BOUNDED_DIAGNOSTIC]:{ttl:1000,maxBytes:4096,retainDetail:true},
  [RetentionClass.FORENSIC_REFERENCE]:{ttl:null,maxBytes:2048,retainDetail:true},
  [RetentionClass.LARGE_DEBUG_PAYLOAD]:{ttl:50,maxBytes:16384,retainDetail:false},
  [RetentionClass.SENSITIVE_PAYLOAD]:{ttl:25,maxBytes:4096,retainDetail:false},
});
const BLOCKED_KEYS=Object.freeze({rawPrompt:'includeRawPrompt',prompt:'includeRawPrompt',messages:'includeRawPrompt',rawResponse:'includeRawResponse',fullResponse:'includeRawResponse',candidateBodies:'includeCandidateBodies',sourceText:'includeSourceText',exactContent:'includeSourceText'});
const byteSize=(value)=>JSON.stringify(value??null).length;
function sanitize(value,controls,depth=0,seen=new WeakSet()){
  if(value==null||typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='string')return value.length>2048?`${value.slice(0,2048)}…[clipped]`:value;
  if(typeof value!=='object')return String(value);if(depth>6)return'[depth-clipped]';if(seen.has(value))return'[circular]';seen.add(value);
  if(Array.isArray(value))return value.slice(0,128).map(v=>sanitize(v,controls,depth+1,seen));
  const out={};for(const [key,v] of Object.entries(value)){const flag=BLOCKED_KEYS[key];if(flag&&!controls[flag])continue;out[key]=sanitize(v,controls,depth+1,seen);}return out;
}

export class DiagnosticRetentionStore{
  #metadata=new Map();#details=new Map();#sequence=0;
  constructor({maxTotalDetailBytes=262144,controls={}}={}){
    this.maxTotalDetailBytes=Math.max(0,Number(maxTotalDetailBytes)||0);this.controls={includeRawPrompt:false,includeRawResponse:false,includeCandidateBodies:false,includeSourceText:false,includeSensitive:false,includeLargeDebug:false,...controls};
  }
  record({recordId,retentionClass=RetentionClass.LIGHTWEIGHT_METADATA,metadata={},detail=null,sequence=null,policy={}}){
    req(recordId,'recordId');const seq=sequence??++this.#sequence;this.#sequence=Math.max(this.#sequence,seq);const base=DEFAULTS[retentionClass]??DEFAULTS[RetentionClass.BOUNDED_DIAGNOSTIC],effective={...base,...policy};
    const canRetain=effective.retainDetail&&(retentionClass!==RetentionClass.LARGE_DEBUG_PAYLOAD||this.controls.includeLargeDebug)&&(retentionClass!==RetentionClass.SENSITIVE_PAYLOAD||this.controls.includeSensitive);
    const clean=canRetain&&detail!==null?sanitize(detail,this.controls):null;const bytes=clean===null?0:byteSize(clean);const accepted=clean!==null&&bytes<=effective.maxBytes;
    const meta={recordId,retentionClass,sequence:seq,expiresAfterSequence:effective.ttl===null?null:seq+Number(effective.ttl),detailRetained:accepted,detailExpired:false,detailBytes:accepted?bytes:0,detailOmittedReason:detail===null?null:!canRetain?'POLICY_BLOCKED':bytes>effective.maxBytes?'PAYLOAD_BUDGET_EXCEEDED':null,metadata:clone(metadata)};
    this.#metadata.set(recordId,meta);if(accepted)this.#details.set(recordId,clean);this.#enforceBudget();return clone(meta);
  }
  get(recordId,{includeDetail=false}={}){const meta=this.#metadata.get(recordId);if(!meta)return null;return{...clone(meta),detail:includeDetail&&this.#details.has(recordId)?clone(this.#details.get(recordId)):null};}
  list(){return[...this.#metadata.values()].sort((a,b)=>a.sequence-b.sequence).map(clone);}
  prune({currentSequence=this.#sequence}={}){let expired=0;for(const meta of this.#metadata.values()){if(meta.expiresAfterSequence!==null&&meta.expiresAfterSequence<=currentSequence&&this.#details.has(meta.recordId)){this.#details.delete(meta.recordId);meta.detailRetained=false;meta.detailExpired=true;meta.detailBytes=0;meta.detailOmittedReason='EXPIRED_BY_POLICY';expired++;}}return{expired,...this.stats()};}
  stats(){const rows=[...this.#metadata.values()];return{metadataCount:rows.length,detailCount:this.#details.size,detailBytes:rows.reduce((n,x)=>n+x.detailBytes,0),expiredCount:rows.filter(x=>x.detailExpired).length,maxTotalDetailBytes:this.maxTotalDetailBytes,controls:clone(this.controls)};}
  #enforceBudget(){let stats=this.stats();if(stats.detailBytes<=this.maxTotalDetailBytes)return;for(const meta of this.list()){if(stats.detailBytes<=this.maxTotalDetailBytes)break;if(meta.retentionClass===RetentionClass.FORENSIC_REFERENCE||!this.#details.has(meta.recordId))continue;this.#details.delete(meta.recordId);const live=this.#metadata.get(meta.recordId);live.detailRetained=false;live.detailExpired=true;live.detailBytes=0;live.detailOmittedReason='PRUNED_BY_BUDGET';stats=this.stats();}}
}
