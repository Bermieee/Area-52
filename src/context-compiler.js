import { createHash } from 'node:crypto';
import { KnowledgeStatus, createCompiledContextPacket } from './contracts.js';
const sectionFor=(classification)=>classification===KnowledgeStatus.CURRENT?'current':[KnowledgeStatus.HISTORICAL,KnowledgeStatus.SUPERSEDED].includes(classification)?'historical':'unresolved';
const factKey=(claim,section)=>`${section}|${claim.subjectId}|${claim.predicate}|${JSON.stringify(claim.value)}`;
const hash=(value)=>createHash('sha256').update(String(value),'utf8').digest('hex').slice(0,16);
export class ContextCompiler {
  constructor({graph,maxFactsPerSection=12}){this.graph=graph;this.maxFactsPerSection=maxFactsPerSection;}
  compile({query,intent,truthResults}){
    const buckets={current:new Map(),historical:new Map(),unresolved:new Map()},provenanceIndex={},dependencies=new Set();
    for(const result of truthResults){if(!result.usableForIntent)continue;for(const claimId of result.claimIds){const claim=this.graph.getClaim(claimId);if(!claim)continue;const section=sectionFor(result.classification),key=factKey(claim,section);let fact=buckets[section].get(key);if(!fact){fact={e:claim.subjectId,p:claim.predicate,v:claim.value,a:claim.authorityClass,cf:claim.confidence,id:claim.id,_supportIds:[],_from:claim.temporal?.validFrom??null,_to:claim.temporal?.validUntil??null,_status:result.classification};buckets[section].set(key,fact);}fact._supportIds.push(claim.id);fact.cf=Math.max(fact.cf,claim.confidence);if(fact._from===null||Number(claim.temporal?.validFrom??0)<Number(fact._from))fact._from=claim.temporal?.validFrom??fact._from;const refs=claim.provenance?.sourceRevisionIds??[];const existing=provenanceIndex[fact.id]??[];provenanceIndex[fact.id]=[...new Set([...existing,...refs])].sort();for(const ref of refs)dependencies.add(ref);}}
    const finalize=(map,section)=>[...map.values()].map(f=>{const out={e:f.e,p:f.p,v:f.v,a:f.a,cf:f.cf,id:f.id};const support=[...new Set(f._supportIds)].sort();if(support.length>1)out.supportIds=support;if(section!=='current')out.t=[f._from,f._to,f._status];return out;}).sort((a,b)=>a.e.localeCompare(b.e)||a.p.localeCompare(b.p)||String(a.v).localeCompare(String(b.v))).slice(0,this.maxFactsPerSection);
    const current=finalize(buckets.current,'current'),historical=finalize(buckets.historical,'historical'),unresolvedRows=finalize(buckets.unresolved,'unresolved');
    const keptIds=new Set([...current,...historical,...unresolvedRows].map(f=>f.id));for(const id of Object.keys(provenanceIndex))if(!keptIds.has(id))delete provenanceIndex[id];
    return createCompiledContextPacket({id:`packet:${intent.toLowerCase()}:${hash([...keptIds].sort().join('|')||'empty')}`,query,intent,current,historical,unresolved:unresolvedRows,provenanceIndex,dependencies:[...dependencies].sort()});
  }
}
