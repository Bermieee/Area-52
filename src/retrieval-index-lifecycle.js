import {
  IndexLifecycleOperation,IndexResidencyState,IndexVerifyStatus,
  RetrievalIndexContractError,createOwnerRetrievalArtifact,createIndexLifecycleReceipt,validateIndexAdapter,
} from './retrieval-index-contracts.js';
import {DeterministicRetrievalRepresentationProvider} from './retrieval-representation-provider.js';
import {stableHash} from './browser-runtime-utils.js';

const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
function frozen(v){const c=clone(v);const f=(x)=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){for(const y of Object.values(x))f(y);Object.freeze(x);}return x;};return f(c);}

export class RetrievalIndexLifecycleManager{
  constructor({representationProvider=new DeterministicRetrievalRepresentationProvider(),maxReceiptHistory=256}={}){
    if(!representationProvider||typeof representationProvider.represent!=='function')throw new RetrievalIndexContractError('REPRESENTATION_PROVIDER_INVALID','representation provider requires represent()');
    this.representationProvider=representationProvider;this.maxReceiptHistory=maxReceiptHistory;
    this.adapters=new Map();this.ownerArtifacts=new Map();this.expectedByAdapter=new Map();this.receipts=[];
    this.tornArtifacts=new Map();this.counters={inserts:0,updates:0,invalidations:0,tombstones:0,rebuilds:0,verifies:0,migrations:0,tornTransactions:0};
  }

  registerAdapter(adapter){
    validateIndexAdapter(adapter);if(this.adapters.has(adapter.adapterId))throw new RetrievalIndexContractError('INDEX_ADAPTER_EXISTS','adapter already registered: '+adapter.adapterId);
    this.adapters.set(adapter.adapterId,adapter);this.expectedByAdapter.set(adapter.adapterId,new Map());
    return frozen({adapterId:adapter.adapterId,indexFamily:adapter.indexFamily,indexVersion:adapter.indexVersion,registered:true});
  }
  unregisterAdapter(adapterId){const adapter=this.adapters.get(String(adapterId));if(!adapter)return null;this.adapters.delete(String(adapterId));this.expectedByAdapter.delete(String(adapterId));return frozen({adapterId:String(adapterId),unregistered:true});}
  listAdapters(){return frozen([...this.adapters.values()].map(a=>({adapterId:a.adapterId,indexFamily:a.indexFamily,indexVersion:a.indexVersion})).sort((a,b)=>a.adapterId.localeCompare(b.adapterId)));}

  indexArtifact(input,{adapterIds=null,operation=null}={}){
    const artifact=input?.kind==='OwnerRetrievalArtifact'?input:createOwnerRetrievalArtifact(input);
    const prior=this.ownerArtifacts.get(artifact.artifactId);
    if(prior&&artifact.artifactRevision<prior.artifactRevision)throw new RetrievalIndexContractError('OWNER_REVISION_OUT_OF_ORDER','owner artifact revision moved backwards');
    const selected=this.#selected(adapterIds),op=operation??(prior?IndexLifecycleOperation.UPDATE:IndexLifecycleOperation.INSERT);
    if(prior&&artifact.artifactRevision===prior.artifactRevision){
      const existing=selected.every(adapter=>this.expectedByAdapter.get(adapter.adapterId)?.has(this.#representation(adapter,artifact).representationId));
      if(existing)return this.#receipt({operation:op,artifact,status:'NO_CHANGE',representationIds:selected.map(a=>this.#representation(a,artifact).representationId),reason:'owner revision already indexed'});
    }
    const tx='index-tx:'+stableHash({artifactId:artifact.artifactId,artifactRevision:artifact.artifactRevision,adapters:selected.map(x=>x.adapterId)},{length:20});
    const staged=[],success=[],failures=[];
    for(const adapter of selected){
      const representation=this.#representation(adapter,artifact);staged.push({adapter,representation});
      try{
        if(prior){
          const expectedMap=this.expectedByAdapter.get(adapter.adapterId),old=[...expectedMap.values()].filter(x=>x.ownerArtifactId===artifact.artifactId);
          for(const row of old)adapter.invalidateRepresentation(row.representationId,{reason:'OWNER_REVISION_ADVANCED'});
        }
        adapter.putRepresentation(representation);success.push(adapter.adapterId);
      }catch(error){failures.push({adapterId:adapter.adapterId,code:error?.code??'INDEX_ADAPTER_FAILURE',message:String(error?.message??error)});}
    }
    if(failures.length){
      this.tornArtifacts.set(artifact.artifactId,{transactionId:tx,targetArtifact:clone(artifact),successfulAdapters:success,failures,priorArtifact:clone(prior??null)});
      this.counters.tornTransactions+=1;
      return this.#receipt({operation:op,artifact,status:'TORN',representationIds:staged.map(x=>x.representation.representationId),affectedRepresentationIds:staged.filter(x=>success.includes(x.adapter.adapterId)).map(x=>x.representation.representationId),reason:'partial adapter write; committed owner marker not advanced',transactionId:tx,details:{success,failures}});
    }
    for(const {adapter,representation} of staged){
      const map=this.expectedByAdapter.get(adapter.adapterId);
      for(const [id,row] of [...map])if(row.ownerArtifactId===artifact.artifactId&&id!==representation.representationId)map.delete(id);
      map.set(representation.representationId,clone(representation));
    }
    this.ownerArtifacts.set(artifact.artifactId,clone(artifact));this.tornArtifacts.delete(artifact.artifactId);
    if(prior)this.counters.updates++;else this.counters.inserts++;
    return this.#receipt({operation:op,artifact,status:'APPLIED',representationIds:staged.map(x=>x.representation.representationId),affectedRepresentationIds:staged.map(x=>x.representation.representationId),reason:prior?'owner revision reindexed':'owner artifact indexed',transactionId:tx});
  }

  invalidateBySourceRevision(sourceRevision,{reason='SOURCE_REVISION_INVALIDATED',adapterIds=null}={}){
    const affected=[...this.ownerArtifacts.values()].filter(x=>x.sourceRevision===String(sourceRevision)).map(x=>x.artifactId).sort();
    return frozen({kind:'IndexSourceInvalidationReceipt',sourceRevision:String(sourceRevision),affectedArtifactIds:affected,
      receipts:affected.map(artifactId=>this.invalidateArtifact(artifactId,{reason,adapterIds})),wholeIndexRebuild:false,authorityGranted:false});
  }

  tombstoneBySourceId(sourceId,{reason='SOURCE_RETIRED',adapterIds=null}={}){
    const affected=[...this.ownerArtifacts.values()].filter(x=>x.sourceId===String(sourceId)).map(x=>x.artifactId).sort();
    return frozen({kind:'IndexSourceRetirementReceipt',sourceId:String(sourceId),affectedArtifactIds:affected,
      receipts:affected.map(artifactId=>this.tombstoneArtifact(artifactId,{reason,adapterIds})),historyPreserved:true,authorityGranted:false});
  }

  invalidateArtifact(artifactId,{reason='OWNER_INVALIDATED',adapterIds=null}={}){
    const id=String(artifactId),selected=this.#selected(adapterIds),affected=[];
    for(const adapter of selected){
      const map=this.expectedByAdapter.get(adapter.adapterId);
      for(const row of map.values())if(row.ownerArtifactId===id){adapter.invalidateRepresentation(row.representationId,{reason});affected.push(row.representationId);}
    }
    this.counters.invalidations+=1;
    return this.#receipt({operation:IndexLifecycleOperation.INVALIDATE,artifact:this.ownerArtifacts.get(id)??{artifactId:id,artifactRevision:1},status:affected.length?'APPLIED':'NO_CHANGE',affectedRepresentationIds:affected,reason});
  }

  tombstoneArtifact(artifactId,{reason='OWNER_RETIRED',adapterIds=null}={}){
    const id=String(artifactId),selected=this.#selected(adapterIds),affected=[];
    for(const adapter of selected){
      const map=this.expectedByAdapter.get(adapter.adapterId);
      for(const row of map.values())if(row.ownerArtifactId===id){adapter.tombstoneRepresentation(row.representationId,{reason});affected.push(row.representationId);}
    }
    this.counters.tombstones+=1;
    return this.#receipt({operation:IndexLifecycleOperation.TOMBSTONE,artifact:this.ownerArtifacts.get(id)??{artifactId:id,artifactRevision:1},status:affected.length?'APPLIED':'NO_CHANGE',affectedRepresentationIds:affected,reason});
  }

  queryAdapter(adapterId,{query,limit=32,currentOwnerArtifacts=null}={}){
    const adapter=this.adapters.get(String(adapterId));if(!adapter)throw new RetrievalIndexContractError('INDEX_ADAPTER_UNKNOWN','unknown adapter: '+adapterId);
    const queryRepresentation=this.representationProvider.representQuery(query,adapter.indexFamily);
    const rows=adapter.query({queryRepresentation,limit,includeStale:true}),expected=this.expectedByAdapter.get(adapter.adapterId);
    const ownerMap=currentOwnerArtifacts?new Map(currentOwnerArtifacts.map(x=>[x.artifactId,x])):this.ownerArtifacts;
    return frozen(rows.map(row=>{
      const rep=row.representation,committed=expected.get(rep.representationId),owner=ownerMap.get(rep.ownerArtifactId);
      let freshness='FRESH',reason='committed representation matches current owner';
      if(rep.residencyState!==IndexResidencyState.ACTIVE){freshness='STALE';reason='representation residency is '+rep.residencyState;}
      else if(!committed||committed.ownerArtifactRevision!==rep.ownerArtifactRevision||committed.sourceRevision!==rep.sourceRevision){freshness='STALE';reason='representation differs from committed lifecycle marker';}
      else if(owner&&(owner.artifactRevision!==rep.ownerArtifactRevision||owner.sourceRevision!==rep.sourceRevision)){freshness='STALE';reason='representation differs from current owner revision';}
      else if(this.tornArtifacts.has(rep.ownerArtifactId)){freshness='STALE';reason='owner artifact has torn lifecycle transaction';}
      return {...row,freshness,reason};
    }));
  }

  verify({ownerArtifacts=null,adapterIds=null}={}){
    const owners=(ownerArtifacts??[...this.ownerArtifacts.values()]).map(x=>x?.kind==='OwnerRetrievalArtifact'?x:createOwnerRetrievalArtifact(x));
    const selected=this.#selected(adapterIds),receipts=[],torn=uniq([...this.tornArtifacts.keys()]);
    for(const adapter of selected){
      const expected=[...this.expectedByAdapter.get(adapter.adapterId).values()];
      const receipt=adapter.verify({expectedRepresentations:expected,ownerArtifacts:owners,expectedIndexVersion:adapter.indexVersion,verificationId:'verify:'+adapter.adapterId+':'+stableHash(expected,{length:12})});
      const entries=receipt.entries.map(row=>torn.includes(row.ownerArtifactId)&&row.status===IndexVerifyStatus.FRESH?{...row,status:IndexVerifyStatus.TORN,reason:'artifact has uncommitted partial adapter update'}:row);
      const counts={};for(const row of entries)counts[row.status]=(counts[row.status]??0)+1;
      receipts.push({...receipt,entries,statusCounts:counts,tornArtifacts:torn.filter(id=>entries.some(x=>x.ownerArtifactId===id))});
    }
    this.counters.verifies+=1;
    const overall=torn.length||receipts.some(r=>Object.entries(r.statusCounts).some(([k,v])=>k!==IndexVerifyStatus.FRESH&&v>0))?'DEGRADED':'FRESH';
    return frozen({kind:'IndexLifecycleVerification',overall,tornArtifacts:torn,adapterReceipts:receipts,authorityGranted:false});
  }

  rebuild({ownerArtifacts,adapterIds=null}={}){
    if(!Array.isArray(ownerArtifacts))throw new RetrievalIndexContractError('OWNER_ARTIFACTS_REQUIRED','rebuild requires ownerArtifacts');
    const owners=ownerArtifacts.map(x=>x?.kind==='OwnerRetrievalArtifact'?x:createOwnerRetrievalArtifact(x)),selected=this.#selected(adapterIds),receipts=[];
    for(const adapter of selected){
      const representations=owners.map(artifact=>this.#representation(adapter,artifact));
      adapter.rebuild(representations);const map=new Map(representations.map(x=>[x.representationId,clone(x)]));this.expectedByAdapter.set(adapter.adapterId,map);
      receipts.push(this.#receipt({operation:IndexLifecycleOperation.REBUILD,artifact:{artifactId:'*',artifactRevision:1},adapterId:adapter.adapterId,status:'APPLIED',representationIds:representations.map(x=>x.representationId),reason:'rebuilt from supplied owner artifacts'}));
    }
    this.ownerArtifacts=new Map(owners.map(x=>[x.artifactId,clone(x)]));this.tornArtifacts.clear();this.counters.rebuilds+=1;
    return frozen({kind:'IndexRebuildResult',receipts,verification:this.verify({ownerArtifacts:owners,adapterIds:selected.map(x=>x.adapterId)}),authorityGranted:false});
  }

  compact({adapterIds=null,dropTombstones=false,dropInvalidated=false}={}){
    return frozen(this.#selected(adapterIds).map(adapter=>({adapterId:adapter.adapterId,...adapter.compact({dropTombstones,dropInvalidated})})));
  }

  migrate({fromAdapterId,toAdapter,ownerArtifacts}={}){
    const source=this.adapters.get(String(fromAdapterId));if(!source)throw new RetrievalIndexContractError('INDEX_ADAPTER_UNKNOWN','unknown source adapter: '+fromAdapterId);
    if(!this.adapters.has(toAdapter.adapterId))this.registerAdapter(toAdapter);
    const owners=(ownerArtifacts??[...this.ownerArtifacts.values()]).map(x=>x?.kind==='OwnerRetrievalArtifact'?x:createOwnerRetrievalArtifact(x));
    const rebuild=this.rebuild({ownerArtifacts:owners,adapterIds:[toAdapter.adapterId]});
    const preserved=owners.map(owner=>({
      artifactId:owner.artifactId,sourceRevision:owner.sourceRevision,claimRefs:[...owner.claimRefs],eventRefs:[...owner.eventRefs],
      authorityClass:owner.authorityClass,truthStatusHint:owner.truthStatusHint,provenanceRefs:[...owner.provenanceRefs],
    }));
    this.counters.migrations+=1;
    return frozen({kind:'IndexMigrationReceipt',operation:IndexLifecycleOperation.MIGRATE,fromAdapterId:source.adapterId,toAdapterId:toAdapter.adapterId,preserved,verification:rebuild.verification,authorityGranted:false});
  }

  expectedRepresentations(adapterId){const map=this.expectedByAdapter.get(String(adapterId));return frozen(map?[...map.values()]:[]);}
  getOwnerArtifact(artifactId){const row=this.ownerArtifacts.get(String(artifactId));return row?clone(row):null;}
  lifecycleDiagnostics(){return frozen({kind:'RetrievalIndexLifecycleDiagnostics',counters:clone(this.counters),tornArtifacts:[...this.tornArtifacts.keys()].sort(),recentReceipts:clone(this.receipts),adapters:this.listAdapters(),storesOwnerArtifactsAsRebuildMetadataOnly:true,indexIsSourceOfTruth:false,readOnly:true});}

  #representation(adapter,artifact){return this.representationProvider.represent(artifact,{indexFamily:adapter.indexFamily,adapterId:adapter.adapterId,indexVersion:adapter.indexVersion});}
  #selected(adapterIds){const ids=adapterIds?uniq(adapterIds):[...this.adapters.keys()].sort();const rows=ids.map(id=>this.adapters.get(id));if(rows.some(x=>!x))throw new RetrievalIndexContractError('INDEX_ADAPTER_UNKNOWN','one or more requested adapters are not registered');return rows;}
  #receipt({operation,artifact,adapterId=null,status,representationIds=[],affectedRepresentationIds=[],preservedRepresentationIds=[],reason=null,transactionId=null,details={}}){
    const receipt=createIndexLifecycleReceipt({receiptId:'index-receipt:'+stableHash({operation,artifactId:artifact.artifactId,artifactRevision:artifact.artifactRevision,adapterId,status,representationIds,transactionId,seq:this.receipts.length},{length:20}),operation,artifactId:artifact.artifactId,adapterId,beforeRevision:null,afterRevision:artifact.artifactRevision,representationIds,affectedRepresentationIds,preservedRepresentationIds,status,reason,transactionId,details});
    this.receipts.push(clone(receipt));while(this.receipts.length>this.maxReceiptHistory)this.receipts.shift();return receipt;
  }
}
