import {
  RetrievalIndexFamily,IndexResidencyState,IndexVerifyStatus,
  RetrievalIndexContractError,createIndexVerifyReceipt,createIndexedArtifactRepresentation,
} from './retrieval-index-contracts.js';
import {stableHash} from './browser-runtime-utils.js';

const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
function frozen(v){const c=clone(v);const f=(x)=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){for(const y of Object.values(x))f(y);Object.freeze(x);}return x;};return f(c);}
function cosine(a,b){if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||!a.length)return 0;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/Math.sqrt(aa*bb):0;}
function sparseScore(queryTerms,representationTerms){const q=new Set(queryTerms??[]);let score=0;for(const row of representationTerms??[])if(q.has(row.term))score+=1+Math.log1p(Number(row.count??1));return score;}
function statusCounts(entries){const out={};for(const row of entries)out[row.status]=(out[row.status]??0)+1;return out;}

export class InMemoryRetrievalIndexAdapter{
  constructor({adapterId,indexFamily,indexVersion='1.0.0',faultInjector=null}={}){
    if(!Object.values(RetrievalIndexFamily).includes(indexFamily))throw new RetrievalIndexContractError('INDEX_FAMILY_INVALID','unsupported index family: '+indexFamily);
    this.adapterId=String(adapterId);this.indexFamily=indexFamily;this.indexVersion=String(indexVersion);
    this.faultInjector=faultInjector;this.entries=new Map();this.operationCounts={put:0,invalidate:0,tombstone:0,query:0,verify:0,rebuild:0,compact:0};
  }
  #fault(operation,payload){if(typeof this.faultInjector==='function'){const result=this.faultInjector(operation,clone(payload));if(result){const e=new Error(typeof result==='string'?result:'injected index adapter failure');e.code='INDEX_ADAPTER_INJECTED_FAILURE';throw e;}}}

  putRepresentation(representation){
    this.#fault('PUT',representation);
    const row=representation?.kind==='IndexedArtifactRepresentation'?representation:createIndexedArtifactRepresentation(representation);
    if(row.indexFamily!==this.indexFamily)throw new RetrievalIndexContractError('INDEX_FAMILY_MISMATCH','representation family does not match adapter');
    if(row.indexAdapter!==this.adapterId)throw new RetrievalIndexContractError('INDEX_ADAPTER_MISMATCH','representation adapter does not match adapterId');
    if(row.indexVersion!==this.indexVersion)throw new RetrievalIndexContractError('INDEX_VERSION_MISMATCH','representation indexVersion does not match adapter');
    const prior=this.entries.get(row.representationId);
    if(prior&&prior.ownerArtifactRevision>row.ownerArtifactRevision)throw new RetrievalIndexContractError('INDEX_REVISION_OUT_OF_ORDER','cannot overwrite newer representation with older owner revision');
    this.entries.set(row.representationId,clone({...row,residencyState:IndexResidencyState.ACTIVE}));
    this.operationCounts.put+=1;
    return frozen({status:prior?'UPDATED':'INSERTED',representationId:row.representationId,ownerArtifactRevision:row.ownerArtifactRevision});
  }

  invalidateRepresentation(representationId,{reason='INVALIDATED'}={}){
    this.#fault('INVALIDATE',{representationId,reason});
    const row=this.entries.get(String(representationId));if(!row)return frozen({status:'MISSING',representationId:String(representationId)});
    this.entries.set(row.representationId,clone({...row,residencyState:IndexResidencyState.INVALIDATED,metadata:{...row.metadata,invalidationReason:String(reason)}}));
    this.operationCounts.invalidate+=1;return frozen({status:'INVALIDATED',representationId:row.representationId});
  }

  tombstoneRepresentation(representationId,{reason='TOMBSTONED'}={}){
    this.#fault('TOMBSTONE',{representationId,reason});
    const row=this.entries.get(String(representationId));if(!row)return frozen({status:'MISSING',representationId:String(representationId)});
    this.entries.set(row.representationId,clone({...row,residencyState:IndexResidencyState.TOMBSTONED,metadata:{...row.metadata,tombstoneReason:String(reason)}}));
    this.operationCounts.tombstone+=1;return frozen({status:'TOMBSTONED',representationId:row.representationId});
  }

  query({queryRepresentation,limit=32,includeStale=false}={}){
    this.#fault('QUERY',{limit});this.operationCounts.query+=1;
    const rows=[];
    for(const row of this.entries.values()){
      if(row.residencyState!==IndexResidencyState.ACTIVE&&!includeStale)continue;
      let score=0,rankSignals={};
      if(this.indexFamily===RetrievalIndexFamily.SPARSE){
        score=sparseScore(queryRepresentation?.terms,row.representationData?.terms);
        rankSignals={bm25LikeScore:score,sparse:score};
      }else if(this.indexFamily===RetrievalIndexFamily.DENSE){
        score=cosine(queryRepresentation?.vector,row.representationData?.vector);
        rankSignals={cosineSimilarity:score,dense:score};
      }else score=0;
      if(score<=0)continue;
      rows.push({representation:clone(row),score,rankSignals});
    }
    rows.sort((a,b)=>b.score-a.score||a.representation.representationId.localeCompare(b.representation.representationId));
    return frozen(rows.slice(0,Math.max(0,Number(limit)||0)));
  }

  getRepresentation(representationId,{includeInactive=true}={}){
    const row=this.entries.get(String(representationId));if(!row)return null;
    if(!includeInactive&&row.residencyState!==IndexResidencyState.ACTIVE)return null;return clone(row);
  }
  listRepresentations(){return [...this.entries.values()].map(clone).sort((a,b)=>a.representationId.localeCompare(b.representationId));}

  verify({expectedRepresentations=[],ownerArtifacts=[],expectedIndexVersion=this.indexVersion,verificationId=null}={}){
    this.#fault('VERIFY',{expectedCount:expectedRepresentations.length});this.operationCounts.verify+=1;
    const expected=new Map(expectedRepresentations.map(x=>[x.representationId,x]));
    const owners=new Map(ownerArtifacts.map(x=>[x.artifactId,x]));
    const entries=[];
    for(const [id,expectedRow] of expected){
      const actual=this.entries.get(id);
      let status=IndexVerifyStatus.FRESH,reason='exact active representation';
      if(!actual){status=IndexVerifyStatus.MISSING;reason='representation missing';}
      else if(actual.indexVersion!==expectedIndexVersion){status=IndexVerifyStatus.ADAPTER_VERSION_MISMATCH;reason='adapter/index version mismatch';}
      else if(actual.residencyState===IndexResidencyState.TOMBSTONED){status=IndexVerifyStatus.TOMBSTONED;reason='representation tombstoned';}
      else if(actual.residencyState===IndexResidencyState.INVALIDATED){status=IndexVerifyStatus.INVALIDATED;reason='representation invalidated';}
      else if(actual.ownerArtifactRevision!==expectedRow.ownerArtifactRevision||actual.sourceRevision!==expectedRow.sourceRevision||actual.representationRevision!==expectedRow.representationRevision){status=IndexVerifyStatus.WRONG_REVISION;reason='representation revision differs from expected owner revision';}
      else if(actual.residencyState!==IndexResidencyState.ACTIVE){status=IndexVerifyStatus.STALE;reason='representation is not active';}
      entries.push({representationId:id,ownerArtifactId:expectedRow.ownerArtifactId,status,reason,actualOwnerRevision:actual?.ownerArtifactRevision??null,expectedOwnerRevision:expectedRow.ownerArtifactRevision});
    }
    for(const [id,actual] of this.entries)if(!expected.has(id)){
      const owner=owners.get(actual.ownerArtifactId);
      entries.push({representationId:id,ownerArtifactId:actual.ownerArtifactId,status:owner?IndexVerifyStatus.STALE:IndexVerifyStatus.ORPHAN,reason:owner?'unexpected representation for known owner':'owner artifact missing'});
    }
    entries.sort((a,b)=>a.representationId.localeCompare(b.representationId));
    const receipt=createIndexVerifyReceipt({
      verificationId:verificationId??('verify:'+this.adapterId+':'+stableHash(entries,{length:16})),adapterId:this.adapterId,indexVersion:this.indexVersion,
      statusCounts:statusCounts(entries),entries,
      missingArtifacts:uniq(entries.filter(x=>x.status===IndexVerifyStatus.MISSING).map(x=>x.ownerArtifactId)),
      orphanRepresentationIds:uniq(entries.filter(x=>x.status===IndexVerifyStatus.ORPHAN).map(x=>x.representationId)),
    });
    return receipt;
  }

  rebuild(representations=[]){
    this.#fault('REBUILD',{count:representations.length});this.entries.clear();this.operationCounts.rebuild+=1;
    for(const row of representations)this.putRepresentation(row);
    return frozen({status:'REBUILT',adapterId:this.adapterId,count:this.entries.size});
  }

  compact({dropTombstones=false,dropInvalidated=false}={}){
    this.#fault('COMPACT',{dropTombstones,dropInvalidated});let removed=0;
    for(const [id,row] of [...this.entries]){
      if((dropTombstones&&row.residencyState===IndexResidencyState.TOMBSTONED)||(dropInvalidated&&row.residencyState===IndexResidencyState.INVALIDATED)){this.entries.delete(id);removed++;}
    }
    this.operationCounts.compact+=1;return frozen({status:'COMPACTED',removed,remaining:this.entries.size});
  }

  exportState(){return frozen({kind:'InMemoryRetrievalIndexState',adapterId:this.adapterId,indexFamily:this.indexFamily,indexVersion:this.indexVersion,entries:this.listRepresentations(),operationCounts:clone(this.operationCounts)});}
  importState(state){if(state?.adapterId!==this.adapterId||state?.indexFamily!==this.indexFamily)throw new RetrievalIndexContractError('INDEX_STATE_INCOMPATIBLE','index state does not match adapter');this.entries=new Map((state.entries??[]).map(x=>[x.representationId,clone(x)]));return frozen({status:'IMPORTED',count:this.entries.size});}
}

export class SparseMemoryIndexAdapter extends InMemoryRetrievalIndexAdapter{
  constructor(options={}){super({adapterId:options.adapterId??'SPARSE_MEMORY',indexFamily:RetrievalIndexFamily.SPARSE,indexVersion:options.indexVersion??'1.0.0',faultInjector:options.faultInjector});}
}
export class DenseMemoryIndexAdapter extends InMemoryRetrievalIndexAdapter{
  constructor(options={}){super({adapterId:options.adapterId??'DENSE_MEMORY',indexFamily:RetrievalIndexFamily.DENSE,indexVersion:options.indexVersion??'1.0.0',faultInjector:options.faultInjector});}
}
