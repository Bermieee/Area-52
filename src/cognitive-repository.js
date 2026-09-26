import {clone,req} from './framework-utils.js';
export const RepositoryDomains=Object.freeze(['sources','artifacts','temporal-state','episodes','reflections','graphs','vectors','ledger']);
function validateDomain(domain){req(domain,'repository domain');}
function key(domain,id){return`${domain}\u0000${id}`;}

export class InMemoryCognitiveRepository{
  #rows=new Map();
  put(domain,id,value,{revision=null}={}){validateDomain(domain);req(id,'repository id');const k=key(domain,id),rows=this.#rows.get(k)??[];const next=revision??(rows.length?rows.at(-1).revision+1:1);if(!Number.isInteger(next)||next<1)throw new TypeError('revision must be a positive integer');if(rows.some(x=>x.revision===next))throw new Error(`duplicate repository revision: ${domain}/${id}@${next}`);const row={domain,id,revision:next,value:clone(value)};rows.push(row);rows.sort((a,b)=>a.revision-b.revision);this.#rows.set(k,rows);return clone(row);}
  get(domain,id,{revision=null}={}){const rows=this.#rows.get(key(domain,id))??[];const row=revision===null?rows.at(-1):rows.find(x=>x.revision===revision);return row?clone(row):null;}
  list(domain){const out=[];for(const rows of this.#rows.values())for(const row of rows)if(row.domain===domain)out.push(clone(row));return out.sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision);}
  delete(domain,id){return this.#rows.delete(key(domain,id));}
}

export class ObjectFixtureCognitiveRepository{
  constructor(){this.rows=Object.create(null);}
  put(domain,id,value,{revision=null}={}){validateDomain(domain);req(id,'repository id');const k=key(domain,id),rows=this.rows[k]??[];const next=revision??(rows.length?rows.at(-1).revision+1:1);if(!Number.isInteger(next)||next<1)throw new TypeError('revision must be a positive integer');if(rows.some(x=>x.revision===next))throw new Error(`duplicate repository revision: ${domain}/${id}@${next}`);const row={domain,id,revision:next,value:clone(value)};rows.push(row);rows.sort((a,b)=>a.revision-b.revision);this.rows[k]=rows;return clone(row);}
  get(domain,id,{revision=null}={}){const rows=this.rows[key(domain,id)]??[];const row=revision===null?rows.at(-1):rows.find(x=>x.revision===revision);return row?clone(row):null;}
  list(domain){return Object.values(this.rows).flat().filter(x=>x.domain===domain).map(clone).sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision);}
  delete(domain,id){const k=key(domain,id),had=k in this.rows;delete this.rows[k];return had;}
}

export function assertCognitiveRepositoryAdapter(adapter){for(const method of ['put','get','list','delete'])if(typeof adapter?.[method]!=='function')throw new TypeError(`repository adapter missing ${method}`);return adapter;}
export function runRepositoryContractSuite(adapter){
  assertCognitiveRepositoryAdapter(adapter);const checks=[];const push=(name,pass)=>checks.push({name,pass:Boolean(pass)});
  const a=adapter.put('artifacts','a',{value:1});const b=adapter.put('artifacts','a',{value:2});push('revision increments',a.revision===1&&b.revision===2);push('latest retrieval',adapter.get('artifacts','a').value.value===2);push('deterministic revision retrieval',adapter.get('artifacts','a',{revision:1}).value.value===1);adapter.put('sources','s',{text:'x'});push('domain separation',adapter.list('artifacts').every(x=>x.domain==='artifacts'));push('delete',adapter.delete('sources','s')===true&&adapter.get('sources','s')===null);return{pass:checks.every(x=>x.pass),checks};
}

export class CognitiveRepositoryRouter{
  #adapters=new Map();#bindings=new Map();
  registerAdapter(name,adapter){req(name,'adapter name');this.#adapters.set(name,assertCognitiveRepositoryAdapter(adapter));return this;}
  bindDomain(domain,adapterName){validateDomain(domain);if(!this.#adapters.has(adapterName))throw new Error(`unknown adapter: ${adapterName}`);this.#bindings.set(domain,adapterName);return this;}
  adapterFor(domain){const name=this.#bindings.get(domain);if(!name)throw new Error(`repository domain is unbound: ${domain}`);return this.#adapters.get(name);}
  put(domain,id,value,options){return this.adapterFor(domain).put(domain,id,value,options);}
  get(domain,id,options){return this.adapterFor(domain).get(domain,id,options);}
  list(domain){return this.adapterFor(domain).list(domain);}
}
