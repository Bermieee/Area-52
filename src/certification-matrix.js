import {clone,req} from './framework-utils.js';
export const DefaultCertificationCategories=Object.freeze(['truth','history','provenance','stale-revision','authority','recovery','latency-resource']);
function normalize(reqs=[]){return reqs.map((row,index)=>typeof row==='string'?{id:row,mandatory:true}:{id:req(row.id??row.name,`evaluationRequirements[${index}].id`),mandatory:row.mandatory!==false,category:row.category??null});}
export class GoldenWorldCertificationMatrix{
  #results=new Map();
  requirementsFor(manifest){return normalize(manifest?.evaluationRequirements??[]);}
  record(serviceId,{testId,pass,evidence=null}){req(serviceId,'serviceId');req(testId,'testId');const rows=this.#results.get(serviceId)??new Map();rows.set(testId,{testId,pass:Boolean(pass),evidence:clone(evidence)});this.#results.set(serviceId,rows);return clone(rows.get(testId));}
  status(serviceId,manifest){const requirements=this.requirementsFor(manifest),rows=this.#results.get(serviceId)??new Map();const tests=requirements.map(r=>({...r,result:rows.get(r.id)??null}));const missing=tests.filter(x=>x.mandatory&&!x.result),failed=tests.filter(x=>x.mandatory&&x.result&&!x.result.pass);return{serviceId,eligible:missing.length===0&&failed.length===0,missing:missing.map(x=>x.id),failed:failed.map(x=>x.id),tests:clone(tests)};}
}
