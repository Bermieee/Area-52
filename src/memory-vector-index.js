import {AuthorityClass,KnowledgeStatus,createArtifactReference,createCandidateNomination,deepClone,stableHash,stableStringify} from './memory-contracts.js';

export const MEMORY_VECTOR_INDEX_VERSION='1.0.0';
const cosine=(a,b)=>{if(!Array.isArray(a)||!Array.isArray(b)||!a.length||a.length!==b.length)return null;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/(Math.sqrt(aa)*Math.sqrt(bb)):null;};
const sizeClass=n=>n<512?'XS':n<2048?'S':n<8192?'M':n<32768?'L':'XL';
const heapSample=()=>Number(globalThis.performance?.memory?.usedJSHeapSize??0)||null;

export class MemoryVectorIndex{
  constructor({producer,snapshot=null,maxVectors=4096,maxPending=4096,maxReceipts=128}={}){
    if(!producer)throw new TypeError('MemoryVectorIndex requires producer');this.producer=producer;this.executor=null;this.maxVectors=maxVectors;this.maxPending=maxPending;this.maxReceipts=maxReceipts;
    this.vectors=new Map();this.pending=[];this.queryCache=new Map();this.receipts=[];this.sequence=0;if(snapshot)this.restore(snapshot);
  }
  attachExecutor(executor=null){if(executor!==null&&typeof executor!=='function')throw new TypeError('vector executor must be a function');this.executor=executor;return{kind:'MemoryVectorExecutorReceipt',attached:Boolean(executor),authorityGranted:false};}
  enqueueArtifact({artifactId,artifactRevision=1,chatId=null,sourceRevisionRefs=[],historianRecordRef=null}={}){
    const id=String(artifactId??'').trim();if(!id)throw new TypeError('artifactId required');
    const item={workId:'memory-vector:'+stableHash(id+'|'+artifactRevision+'|'+sourceRevisionRefs.join('|')),artifactId:id,artifactRevision:Number(artifactRevision)||1,chatId:chatId==null?null:String(chatId),
      sourceRevisionRefs:[...new Set(sourceRevisionRefs.map(String))].sort(),historianRecordRef:historianRecordRef==null?null:String(historianRecordRef),attempts:0,enqueuedAt:Date.now(),enqueuedSequence:++this.sequence};
    if(!this.pending.some(x=>x.workId===item.workId)&&!this.vectors.has(id+'@'+item.artifactRevision))this.pending.push(item);
    if(this.pending.length>this.maxPending)this.pending.splice(0,this.pending.length-this.maxPending);return deepClone(item);
  }
  async runMaintenance({maxUnits=1}={}){
    const limit=Math.max(1,Math.min(16,Number(maxUnits)||1)),outcomes=[];const cycleStarted=Date.now();
    for(let n=0;n<limit&&this.pending.length;n++){
      const item=this.pending[0],record=this.#historianRecord(item);item.attempts+=1;
      if(!record){this.pending.shift();outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,status:'REJECTED',reasonCode:'HISTORIAN_RECORD_ABSENT',ownerDecision:'REJECTED'}));continue;}
      if(!this.#fresh(record.sourceRevisionRefs)){this.pending.shift();outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,status:'REJECTED_STALE',reasonCode:'SOURCE_REVISION_STALE',ownerDecision:'REJECTED'}));continue;}
      if(typeof this.executor!=='function'){outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,status:'UNAVAILABLE',reasonCode:'VECTOR_PROVIDER_UNAVAILABLE',ownerDecision:'DEFERRED'}));break;}
      const body=String(record.representationText??''),dispatchedAt=Date.now(),heapBefore=heapSample();let result;
      try{result=await this.executor({requestPurpose:'COGNITIVE_EXECUTION',operation:'EMBED_ARTIFACT',input:body,workId:item.workId,artifactId:item.artifactId,artifactRevision:item.artifactRevision,chatId:item.chatId});}
      catch(error){outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,executionId:error?.executionId??null,status:'UNAVAILABLE',reasonCode:String(error?.code??'VECTOR_PROVIDER_FAILURE'),ownerDecision:'DEFERRED'}));break;}
      if(result?.status==='UNAVAILABLE'){outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,executionId:result.executionId??null,status:'UNAVAILABLE',reasonCode:result.reasonCode??'VECTOR_PROVIDER_UNAVAILABLE',ownerDecision:'DEFERRED'}));break;}
      if(!Array.isArray(result?.embeddings?.[0])||!result.embeddings[0].length){this.pending.shift();outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,executionId:result?.executionId??null,status:'REJECTED',reasonCode:'VECTOR_RESULT_INVALID',ownerDecision:'REJECTED',providerRequestId:result?.providerRequestId??null}));continue;}
      const current=this.#historianRecord(item);if(!current||current.artifactRevision!==item.artifactRevision||!this.#fresh(item.sourceRevisionRefs)){
        this.pending.shift();outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,executionId:result.executionId??null,status:'REJECTED_LATE',reasonCode:'ARTIFACT_REVISION_CHANGED',ownerDecision:'REJECTED',providerRequestId:result.providerRequestId??null}));continue;
      }
      const key=item.artifactId+'@'+item.artifactRevision;this.vectors.set(key,{key,artifactId:item.artifactId,artifactRevision:item.artifactRevision,chatId:item.chatId,sourceRevisionRefs:[...item.sourceRevisionRefs],
        historianRecordRef:record.id,vector:[...result.embeddings[0]],providerRequestId:result.providerRequestId??null,providerId:result.providerId??null,modelId:result.actualModelId??result.modelId??null,acceptedSequence:++this.sequence});
      this.pending.shift();this.#trimVectors();outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,executionId:result.executionId??null,status:'ACCEPTED',reasonCode:null,requestPurpose:'COGNITIVE_EXECUTION',
        providerRequestId:result.providerRequestId??null,providerId:result.providerId??null,modelId:result.actualModelId??null,ownerDecision:'ACCEPTED',ownerDestination:'MEMORY_VECTOR_INDEX',
        queueWaitMs:Math.max(0,dispatchedAt-Number(item.enqueuedAt??cycleStarted)),providerLatencyMs:result.latencyMs??null,usageClass:result.measurementClass??null,costClass:result.usageReceipt?.cost?.status??null,
        payloadSizeClass:sizeClass(body.length),heapBefore,heapAfter:heapSample(),rawPayloadRetained:false}));
    }
    return{kind:'MemoryVectorMaintenanceReceipt',contractVersion:MEMORY_VECTOR_INDEX_VERSION,status:outcomes.some(x=>x.status==='UNAVAILABLE')?'UNAVAILABLE':'COMPLETED',processed:outcomes.length,outcomes,pending:this.pending.length,foregroundBlockedMs:0};
  }
  async primeQuery({query,selection={},maxCandidates=12}={}){
    const identity={chatId:selection?.chatId??null,turnId:selection?.turnId??null,generationId:selection?.generationId??null,correlationId:selection?.correlationId??null,worldRevision:selection?.worldRevision??null,sceneRevision:selection?.sceneRevision??null,sourceRevisionRefs:[...new Set((selection?.sourceRevisionRefs??[]).map(String))].sort()};
    const q=String(query??'').trim();if(!q)return this.#record({kind:'MemoryVectorQueryReceipt',selection:identity,status:'SKIPPED',reasonCode:'EMPTY_QUERY',requested:true,providerAttempted:false,providerReturned:false,ownerAdmitted:false});
    if(typeof this.executor!=='function')return this.#record({kind:'MemoryVectorQueryReceipt',selection:identity,status:'UNAVAILABLE',reasonCode:'VECTOR_PROVIDER_UNAVAILABLE',requestPurpose:'COGNITIVE_EXECUTION',requested:true,providerAttempted:false,providerReturned:false,ownerAdmitted:false});
    let result;const started=Date.now();
    try{result=await this.executor({requestPurpose:'COGNITIVE_EXECUTION',operation:'EMBED_QUERY',input:q,chatId:selection?.chatId??null,selection:identity});}
    catch(error){return this.#record({kind:'MemoryVectorQueryReceipt',selection:identity,executionId:error?.executionId??null,status:'UNAVAILABLE',reasonCode:String(error?.code??'VECTOR_PROVIDER_FAILURE'),requestPurpose:'COGNITIVE_EXECUTION',requested:true,providerAttempted:Boolean(error?.executionId),providerReturned:false,ownerAdmitted:false});}
    const providerAttempted=Boolean(result?.providerAttempted??result?.executionId??result?.providerRequestId),providerReturned=Boolean(result?.providerReturned??Array.isArray(result?.embeddings));
    if(result?.status==='UNAVAILABLE')return this.#record({kind:'MemoryVectorQueryReceipt',selection:identity,executionId:result.executionId??null,status:'UNAVAILABLE',reasonCode:result.reasonCode??'VECTOR_PROVIDER_UNAVAILABLE',requestPurpose:'COGNITIVE_EXECUTION',requested:true,providerAttempted,providerReturned,ownerAdmitted:false,foregroundBudgetMs:result.foregroundBudgetMs??null,foregroundQueueWaitMs:result.foregroundQueueWaitMs??null,providerExecutionMs:result.providerExecutionMs??null,foregroundBlockedMs:result.foregroundBlockedMs??Math.max(0,Date.now()-started)});
    const vector=result?.embeddings?.[0];if(!Array.isArray(vector)||!vector.length)return this.#record({kind:'MemoryVectorQueryReceipt',selection:identity,executionId:result?.executionId??null,status:'REJECTED',reasonCode:'VECTOR_QUERY_RESULT_INVALID',providerRequestId:result?.providerRequestId??null,requested:true,providerAttempted,providerReturned,ownerAdmitted:false,foregroundQueueWaitMs:result?.foregroundQueueWaitMs??null,providerExecutionMs:result?.providerExecutionMs??null});
    const chat=String(selection?.chatId??''),scored=[];
    for(const entry of this.vectors.values()){if(chat&&entry.chatId&&entry.chatId!==chat)continue;if(!this.#fresh(entry.sourceRevisionRefs))continue;const score=cosine(vector,entry.vector);if(score==null)continue;scored.push({artifactId:entry.artifactId,artifactRevision:entry.artifactRevision,historianRecordRef:entry.historianRecordRef,score:(score+1)/2});}
    scored.sort((a,b)=>b.score-a.score||a.artifactId.localeCompare(b.artifactId));const selected=scored.slice(0,Math.max(1,Math.min(48,Number(maxCandidates)||12)));
    this.queryCache.set(this.#queryKey(q,selection),{selected,sequence:++this.sequence});if(this.queryCache.size>128){const oldest=[...this.queryCache.entries()].sort((a,b)=>a[1].sequence-b[1].sequence)[0];if(oldest)this.queryCache.delete(oldest[0]);}
    return this.#record({kind:'MemoryVectorQueryReceipt',selection:identity,executionId:result.executionId??null,status:'READY',requestPurpose:'COGNITIVE_EXECUTION',providerRequestId:result.providerRequestId??null,providerId:result.providerId??null,modelId:result.actualModelId??null,
      providerLatencyMs:result.latencyMs??Math.max(0,Date.now()-started),foregroundBudgetMs:result.foregroundBudgetMs??1200,foregroundQueueWaitMs:result.foregroundQueueWaitMs??null,providerExecutionMs:result.providerExecutionMs??result.latencyMs??null,foregroundBlockedMs:result.foregroundBlockedMs??Math.max(0,Date.now()-started),candidateCount:selected.length,ownerDecision:'ACCEPTED_FOR_HISTORIAN_NOMINATION',ownerDestination:'HISTORIAN_DENSE_RETRIEVAL',requested:true,providerAttempted,providerReturned:true,ownerAdmitted:true,queryHash:stableHash(q.toLowerCase()),rawQueryRetained:false});
  }
  cachedNominations({query,selection={},retrievalIntentId=null,maxCandidates=12}={}){
    const cached=this.queryCache.get(this.#queryKey(String(query??'').trim(),selection));if(!cached)return[];const intentId=retrievalIntentId??('memory-dense-intent:'+stableHash(String(query).toLowerCase())),out=[];
    for(const hit of cached.selected.slice(0,Math.max(1,Math.min(48,Number(maxCandidates)||12)))){
      const record=this.producer.historian.records.get(hit.historianRecordRef);if(!record||record.freshness!=='FRESH'||!this.producer.plasticity.retrievable(record.artifactId,record.artifactRevision))continue;
      out.push(createCandidateNomination({nominationId:'memory-dense-nomination:'+stableHash(intentId+'|'+record.id),candidateId:'memory-dense-candidate:'+stableHash(record.id),evidenceIdentity:'artifact:'+stableHash(record.artifactId+'|'+record.artifactRevision),
        artifactRef:createArtifactReference({artifactId:record.artifactId,artifactType:record.artifactType,owner:'MEMORY',revision:record.artifactRevision,sourceRevisionSet:record.sourceRevisionRefs,worldRevision:record.worldRevision,sceneRevision:record.sceneRevision,contentHash:stableHash(record.representationText),provenanceRef:record.provenance?.[0]?.ref??null}),
        artifactRevision:record.artifactRevision,sourceRevisionRefs:record.sourceRevisionRefs,claimRefs:record.claimRefs,eventRefs:record.eventRefs,entityRefs:record.entityRefs,relationshipRefs:record.relationshipRefs,retrievalIntentIds:[intentId],
        rankSignals:{intentMatch:hit.score,entityOverlap:0,temporalFit:1,significance:record.significance??.5,recency:1,perspectiveCompatibility:1,denseExecution:true},normalizedRank:Math.max(0,Math.min(1,hit.score)),
        authorityClass:record.authorityClass??AuthorityClass.UNKNOWN,truthStatusHint:record.truthStatusHint??KnowledgeStatus.UNRESOLVED,provenance:record.provenance,evidenceRefs:record.evidenceRefs,dependencyRevisions:record.dependencyRevisions,
        representationRef:record.id,representationRevision:record.artifactRevision,representationText:record.representationText,metadata:{historianChannel:record.channel,perspective:{scope:'WORLD'},retrievalRecordRef:record.id,exactSourceDrillback:true,denseExecution:true,truthAuthorityGranted:false,settlementAuthority:false,contextSealAuthority:false},
        worldRevision:record.worldRevision,sceneRevision:record.sceneRevision}));
    }
    return out;
  }
  invalidateSourceRevision(sourceRevisionId){const source=String(sourceRevisionId);for(const [key,row] of [...this.vectors])if(row.sourceRevisionRefs.includes(source))this.vectors.delete(key);for(const row of this.pending)if(row.sourceRevisionRefs.includes(source))row.stale=true;this.queryCache.clear();}
  status(){return{kind:'MemoryVectorIndexStatus',executorAttached:Boolean(this.executor),vectorCount:this.vectors.size,pendingCount:this.pending.length,queryCacheCount:this.queryCache.size,revision:this.revisionRef()};}
  readReceipts({limit=128}={}){return deepClone(this.receipts.slice(-Math.max(1,Math.min(128,Number(limit)||128))));}
  revisionRef(){return'memory-vector:'+stableHash(stableStringify({vectors:[...this.vectors.keys()].sort(),pending:this.pending.map(x=>x.workId)}));}
  snapshot(){return{kind:'MemoryVectorIndexSnapshot',contractVersion:MEMORY_VECTOR_INDEX_VERSION,vectors:[...this.vectors.entries()].map(([k,v])=>[k,deepClone(v)]),pending:deepClone(this.pending),receipts:deepClone(this.receipts),sequence:this.sequence};}
  restore(s){this.vectors=new Map((s?.vectors??[]).map(([k,v])=>[k,deepClone(v)]));this.pending=deepClone(s?.pending??[]).slice(-this.maxPending);this.receipts=deepClone(s?.receipts??[]).slice(-this.maxReceipts);this.sequence=Number(s?.sequence??0);this.queryCache=new Map();}
  #historianRecord(item){if(item.historianRecordRef){const r=this.producer.historian.records.get(item.historianRecordRef);if(r)return r;}return[...this.producer.historian.records.values()].find(r=>r.artifactId===item.artifactId&&Number(r.artifactRevision)===Number(item.artifactRevision))??null;}
  #fresh(refs){return(refs??[]).every(ref=>this.producer.graph.isSourceRevisionActive(ref));}
  #queryKey(query,selection){return stableHash(stableStringify([String(selection?.chatId??''),String(selection?.turnId??''),String(selection?.generationId??''),String(selection?.correlationId??''),Number(selection?.worldRevision??0),Number(selection?.sceneRevision??0),[...new Set((selection?.sourceRevisionRefs??[]).map(String))].sort(),String(query).toLowerCase()]));}
  #record(row){const value={contractVersion:MEMORY_VECTOR_INDEX_VERSION,at:Date.now(),...deepClone(row)};this.receipts.push(value);if(this.receipts.length>this.maxReceipts)this.receipts.splice(0,this.receipts.length-this.maxReceipts);return deepClone(value);}
  #trimVectors(){if(this.vectors.size<=this.maxVectors)return;const rows=[...this.vectors.entries()].sort((a,b)=>a[1].acceptedSequence-b[1].acceptedSequence);while(rows.length&&this.vectors.size>this.maxVectors)this.vectors.delete(rows.shift()[0]);}
}
