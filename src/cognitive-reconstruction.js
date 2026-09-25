import {clone} from './framework-utils.js';

export class CognitiveReconstructor{
  constructor({ledger}){this.ledger=ledger;}
  reconstructTransaction(transactionId,{maxTransactions=128}={}){
    const target=this.ledger.get(transactionId);if(!target)return{complete:false,status:'MISSING_REFERENCE',targetId:transactionId,transactions:[],links:[],missingRefs:[transactionId],cycles:[],truncated:false};
    return this.reconstructCorrelation(target.correlationId,{throughSequence:target.sequence,maxTransactions});
  }
  reconstructCorrelation(correlationId,{throughSequence=Number.MAX_SAFE_INTEGER,maxTransactions=128}={}){
    let rows=this.ledger.list({correlationId}).filter(x=>x.sequence<=throughSequence).sort((a,b)=>a.sequence-b.sequence);const total=rows.length;let truncated=false;if(rows.length>maxTransactions){rows=rows.slice(-maxTransactions);truncated=true;}
    const byId=new Map(rows.map(x=>[x.transactionId,x])),missingRefs=[],links=[],cycles=[];
    for(const row of rows){
      if(!row.causationId)continue;
      const internal=row.causationId.startsWith('cognitive-tx:');
      if(internal&&!byId.has(row.causationId)&&!this.ledger.has(row.causationId))missingRefs.push(row.causationId);
      links.push({from:row.causationId,to:row.transactionId,internal,found:!internal||this.ledger.has(row.causationId)});
    }
    const next=new Map(rows.filter(x=>x.causationId?.startsWith('cognitive-tx:')).map(x=>[x.transactionId,x.causationId]));
    for(const row of rows){const seen=new Set();let id=row.transactionId;while(next.has(id)){if(seen.has(id)){cycles.push([...seen,id]);break;}seen.add(id);id=next.get(id);}}
    return{kind:'ReconstructionChain',correlationId,complete:missingRefs.length===0&&cycles.length===0&&!truncated,status:missingRefs.length||cycles.length||truncated?'PARTIAL_RECONSTRUCTION':'OK',transactions:clone(rows),links,missingRefs:[...new Set(missingRefs)].sort(),cycles,truncated,totalTransactions:total};
  }
  traceArtifact(artifactId,{maxTransactions=128}={}){const rows=this.ledger.list({artifactId}).sort((a,b)=>a.sequence-b.sequence);return this.#bounded('artifact',artifactId,rows,maxTransactions);}
  traceSourceRevision(sourceRevisionId,{maxTransactions=128}={}){const rows=this.ledger.list({sourceRevisionId}).sort((a,b)=>a.sequence-b.sequence);return this.#bounded('sourceRevision',sourceRevisionId,rows,maxTransactions);}
  traceTurn(turnId,{maxTransactions=128}={}){const rows=this.ledger.list({turnId}).sort((a,b)=>a.sequence-b.sequence);return this.#bounded('turn',turnId,rows,maxTransactions);}
  traceGeneration(generationId,{maxTransactions=128}={}){const rows=this.ledger.list({generationId}).sort((a,b)=>a.sequence-b.sequence);return this.#bounded('generation',generationId,rows,maxTransactions);}
  #bounded(targetType,targetId,rows,maxTransactions){const truncated=rows.length>maxTransactions,selected=truncated?rows.slice(-maxTransactions):rows;return{kind:'ReconstructionChain',targetType,targetId,complete:!truncated&&selected.length>0,status:selected.length===0?'MISSING_REFERENCE':truncated?'PARTIAL_RECONSTRUCTION':'OK',transactions:clone(selected),links:selected.filter(x=>x.causationId).map(x=>({from:x.causationId,to:x.transactionId,found:!x.causationId.startsWith('cognitive-tx:')||this.ledger.has(x.causationId)})),missingRefs:[],cycles:[],truncated,totalTransactions:rows.length};}
}
