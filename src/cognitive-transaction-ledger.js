import {CognitiveTransactionType,createCognitiveTransaction} from './cognitive-audit-contracts.js';
import {FrameworkError,clone,req,stableString} from './framework-utils.js';

function deepFreeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const key of Object.keys(value))deepFreeze(value[key]);return value;}

export class CognitiveTransactionTypeRegistry{
  #types=new Map();
  constructor(){for(const type of Object.values(CognitiveTransactionType))this.register(type,{owner:'COGNITIVE_CORE'});}
  register(type,{owner='UNOWNED',description=null}={}){req(type,'transaction type');if(this.#types.has(type))throw new FrameworkError('DUPLICATE_TRANSACTION_TYPE',`Transaction type already registered: ${type}`);this.#types.set(type,{type,owner,description});return this.get(type);}
  has(type){return this.#types.has(type);}
  get(type){const x=this.#types.get(type);return x?clone(x):null;}
  list(){return[...this.#types.values()].map(clone).sort((a,b)=>a.type.localeCompare(b.type));}
}

export class CognitiveTransactionLedger{
  #rows=[];#byId=new Map();#sequence=0;
  constructor({typeRegistry=null}={}){this.typeRegistry=typeRegistry??new CognitiveTransactionTypeRegistry();}
  get sequence(){return this.#sequence;}
  append(input){
    const type=input.transactionType;if(!this.typeRegistry.has(type))throw new FrameworkError('UNKNOWN_TRANSACTION_TYPE',`Unknown cognitive transaction type: ${type}`);
    const requestedId=input.transactionId??null;if(requestedId&&this.#byId.has(requestedId)){
      const prior=this.#byId.get(requestedId),candidate=createCognitiveTransaction({...input,transactionId:requestedId,sequence:prior.sequence,timestamp:input.timestamp??prior.timestamp});
      if(stableString(prior)!==stableString(candidate))throw new FrameworkError('TRANSACTION_ID_CONFLICT',`Transaction ID conflicts with existing immutable record: ${requestedId}`);
      return{transaction:clone(prior),duplicate:true};
    }
    const sequence=this.#sequence+1;const transactionId=requestedId??`cognitive-tx:${sequence}:${String(type).toLowerCase()}`;
    const row=deepFreeze(createCognitiveTransaction({...input,transactionId,sequence,timestamp:input.timestamp??sequence}));
    this.#sequence=sequence;this.#rows.push(row);this.#byId.set(row.transactionId,row);return{transaction:clone(row),duplicate:false};
  }
  get(transactionId){const row=this.#byId.get(transactionId);return row?clone(row):null;}
  has(transactionId){return this.#byId.has(transactionId);}
  list(filters={}){
    const matches=(row)=>{
      if(filters.transactionType&&row.transactionType!==filters.transactionType)return false;
      if(filters.correlationId&&row.correlationId!==filters.correlationId)return false;
      if(filters.causationId&&row.causationId!==filters.causationId)return false;
      if(filters.turnId&&row.turnId!==filters.turnId)return false;
      if(filters.taskId&&row.taskId!==filters.taskId)return false;
      if(filters.generationId&&row.generationId!==filters.generationId)return false;
      if(filters.sourceRevisionId&&!row.sourceRevisionIds.includes(filters.sourceRevisionId))return false;
      if(filters.artifactId&&!row.affectedArtifactIds.includes(filters.artifactId))return false;
      if(filters.receiptRef&&!row.receiptRefs.includes(filters.receiptRef))return false;
      if(filters.reasonCode&&row.reasonCode!==filters.reasonCode)return false;
      if(filters.afterSequence&&row.sequence<=filters.afterSequence)return false;
      if(filters.beforeSequence&&row.sequence>=filters.beforeSequence)return false;
      return true;
    };
    return this.#rows.filter(matches).map(clone);
  }
  stats(){return{count:this.#rows.length,sequence:this.#sequence,types:Object.fromEntries(this.typeRegistry.list().map(t=>[t.type,this.#rows.filter(r=>r.transactionType===t.type).length]))};}
  snapshot(){return{kind:'CognitiveTransactionLedgerSnapshot',sequence:this.#sequence,transactions:this.#rows.map(clone)};}
}
