import {AuthorityClass,KnowledgeStatus,createArtifactReference,createCandidateNomination,deepClone,stableHash,stableStringify} from './memory-contracts.js';

export const MEMORY_VECTOR_INDEX_VERSION='1.0.0';
const cosine=(a,b)=>{if(!Array.isArray(a)||!Array.isArray(b)||!a.length||a.length!==b.length)return null;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/(Math.sqrt(aa)*Math.sqrt(bb)):null;};
const sizeClass=n=>n<512?'XS':n<2048?'S':n<8192?'M':n<32768?'L':'XL';
const heapSample=()=>Number(globalThis.performance?.memory?.usedJSHeapSize??0)||null;

const SEGMENT=Object.freeze({characters:1600,overlap:200,maxSegments:8});
const bestCosine=(query,entry)=>{let best=cosine(query,entry.vector);for(const v of entry.segmentVectors??[]){const c=cosine(query,v);if(c!=null&&(best==null||c>best))best=c;}return best;};

export class MemoryVectorIndex{
  constructor({producer,snapshot=null,maxVectors=4096,maxPending=4096,maxReceipts=128}={}){
    if(!producer)throw new TypeError('MemoryVectorIndex requires producer');this.producer=producer;this.executor=null;this.maxVectors=maxVectors;this.maxPending=maxPending;this.maxReceipts=maxReceipts;
    this.vectors=new Map();this.pending=[];this.queryCache=new Map();this.receipts=[];this.sequence=0;
    // Cap ledger rows 51-52: pending work over capacity is deferred (backpressure), never dropped; the backlog is rebuilt
    // from the canonical episodes once the queue drains. Vector eviction is counted, not silent.
    this.backpressure={deferred:0,active:false};this.evictions={count:0,lastSequence:null};if(snapshot)this.restore(snapshot);
  }
  attachExecutor(executor=null){if(executor!==null&&typeof executor!=='function')throw new TypeError('vector executor must be a function');this.executor=executor;return{kind:'MemoryVectorExecutorReceipt',attached:Boolean(executor),authorityGranted:false};}
  enqueueArtifact({artifactId,artifactRevision=1,chatId=null,sourceRevisionRefs=[],historianRecordRef=null}={}){
    const id=String(artifactId??'').trim();if(!id)throw new TypeError('artifactId required');
    const item={workId:'memory-vector:'+stableHash(id+'|'+artifactRevision+'|'+sourceRevisionRefs.join('|')),artifactId:id,artifactRevision:Number(artifactRevision)||1,chatId:chatId==null?null:String(chatId),
      sourceRevisionRefs:[...new Set(sourceRevisionRefs.map(String))].sort(),historianRecordRef:historianRecordRef==null?null:String(historianRecordRef),attempts:0,enqueuedAt:Date.now(),enqueuedSequence:++this.sequence};
    if(this.pending.some(x=>x.workId===item.workId)||this.vectors.has(id+'@'+item.artifactRevision))return deepClone(item);
    if(this.pending.length>=this.maxPending){
      this.backpressure.deferred+=1;this.backpressure.active=true;
      return deepClone({...item,status:'DEFERRED_BACKPRESSURE',reasonCode:'VECTOR_PENDING_CAPACITY',continuation:'RECONCILE_FROM_EPISODES'});
    }
    this.pending.push(item);return deepClone(item);
  }
  // Re-derive deferred work from the owner's current episodes: every fresh episode record without a vector for its
  // current revision and not already pending is queued, up to capacity. Clears backpressure once nothing is missing.
  reconcileBackpressure(){
    if(!this.backpressure.active)return 0;
    const pendingKeys=new Set(this.pending.map(x=>x.artifactId+'@'+x.artifactRevision));let added=0,missing=0;
    for(const record of this.producer.historian.records.values()){
      if(record.channel!=='SCENE_EPISODE'||record.freshness!=='FRESH')continue;
      const key=record.artifactId+'@'+record.artifactRevision;if(this.vectors.has(key)||pendingKeys.has(key))continue;
      missing+=1;if(this.pending.length>=this.maxPending)continue;
      const episode=this.producer.experienceStore?.episodes?.get?.(record.artifactId);
      const before=this.pending.length;
      this.enqueueArtifact({artifactId:record.artifactId,artifactRevision:record.artifactRevision,chatId:episode?.chatId??null,sourceRevisionRefs:record.sourceRevisionRefs,historianRecordRef:record.id});
      if(this.pending.length>before){added+=1;pendingKeys.add(key);missing-=1;}
    }
    if(!missing){this.backpressure.active=false;this.backpressure.deferred=0;}
    return added;
  }
  async runMaintenance({maxUnits=1}={}){
    const limit=Math.max(1,Math.min(16,Number(maxUnits)||1)),outcomes=[];const cycleStarted=Date.now();
    if(this.backpressure.active&&this.pending.length<this.maxPending/2)this.reconcileBackpressure();
    for(let n=0;n<limit&&this.pending.length;n++){
      const item=this.pending[0],record=this.#historianRecord(item);item.attempts+=1;
      if(!record){this.pending.shift();outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,status:'REJECTED',reasonCode:'HISTORIAN_RECORD_ABSENT',ownerDecision:'REJECTED'}));continue;}
      if(!this.#fresh(record.sourceRevisionRefs)){this.pending.shift();outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,status:'REJECTED_STALE',reasonCode:'SOURCE_REVISION_STALE',ownerDecision:'REJECTED'}));continue;}
      if(typeof this.executor!=='function'){outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,status:'UNAVAILABLE',reasonCode:'VECTOR_PROVIDER_UNAVAILABLE',ownerDecision:'DEFERRED'}));break;}
      const segments=this.#segmentsFor(record),body=segments.texts.length===1?segments.texts[0]:segments.texts,dispatchedAt=Date.now(),heapBefore=heapSample();let result;
      try{result=await this.executor({requestPurpose:'COGNITIVE_EXECUTION',operation:'EMBED_ARTIFACT',input:body,workId:item.workId,artifactId:item.artifactId,artifactRevision:item.artifactRevision,chatId:item.chatId});}
      catch(error){outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,executionId:error?.executionId??null,status:'UNAVAILABLE',reasonCode:String(error?.code??'VECTOR_PROVIDER_FAILURE'),ownerDecision:'DEFERRED'}));break;}
      if(result?.status==='UNAVAILABLE'){outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,executionId:result.executionId??null,status:'UNAVAILABLE',reasonCode:result.reasonCode??'VECTOR_PROVIDER_UNAVAILABLE',ownerDecision:'DEFERRED'}));break;}
      const segmentsOk=segments.texts.length===1||(Array.isArray(result?.embeddings)&&result.embeddings.length===segments.texts.length&&result.embeddings.every(v=>Array.isArray(v)&&v.length===result.embeddings[0].length));
      if(!Array.isArray(result?.embeddings?.[0])||!result.embeddings[0].length||!segmentsOk){this.pending.shift();outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,executionId:result?.executionId??null,status:'REJECTED',reasonCode:'VECTOR_RESULT_INVALID',ownerDecision:'REJECTED',providerRequestId:result?.providerRequestId??null}));continue;}
      const current=this.#historianRecord(item);if(!current||current.artifactRevision!==item.artifactRevision||!this.#fresh(item.sourceRevisionRefs)){
        this.pending.shift();outcomes.push(this.#record({kind:'MemoryVectorWorkReceipt',workId:item.workId,executionId:result.executionId??null,status:'REJECTED_LATE',reasonCode:'ARTIFACT_REVISION_CHANGED',ownerDecision:'REJECTED',providerRequestId:result.providerRequestId??null}));continue;
      }
      const key=item.artifactId+'@'+item.artifactRevision;this.vectors.set(key,{key,artifactId:item.artifactId,artifactRevision:item.artifactRevision,chatId:item.chatId,sourceRevisionRefs:[...item.sourceRevisionRefs],
        historianRecordRef:record.id,vector:[...result.embeddings[0]],
        ...(segments.texts.length>1?{segmentVectors:result.embeddings.slice(1).map(v=>[...v]),segmentCoverage:segments.coverage}:{}),providerRequestId:result.providerRequestId??null,providerId:result.providerId??null,modelId:result.actualModelId??result.modelId??null,acceptedSequence:++this.sequence});
      // An older revision of the same artifact is superseded: it no longer takes a residency slot.
      for(const [oldKey,row] of [...this.vectors])if(row.artifactId===item.artifactId&&row.artifactRevision<item.artifactRevision)this.vectors.delete(oldKey);
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
    for(const entry of this.vectors.values()){if(chat&&entry.chatId&&entry.chatId!==chat)continue;if(!this.#fresh(entry.sourceRevisionRefs))continue;const score=bestCosine(vector,entry);if(score==null)continue;scored.push({artifactId:entry.artifactId,artifactRevision:entry.artifactRevision,historianRecordRef:entry.historianRecordRef,score:(score+1)/2});}
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
  status(){return{kind:'MemoryVectorIndexStatus',executorAttached:Boolean(this.executor),vectorCount:this.vectors.size,pendingCount:this.pending.length,queryCacheCount:this.queryCache.size,
    backpressure:{active:this.backpressure.active,deferred:this.backpressure.deferred,continuation:this.backpressure.active?'RECONCILE_FROM_EPISODES':null},
    evictions:{count:this.evictions.count,lastSequence:this.evictions.lastSequence,canonicalKnowledgeDropped:false,fallback:'LEXICAL_HISTORIAN'},revision:this.revisionRef()};}
  readReceipts({limit=128}={}){return deepClone(this.receipts.slice(-Math.max(1,Math.min(128,Number(limit)||128))));}
  revisionRef(){return'memory-vector:'+stableHash(stableStringify({vectors:[...this.vectors.keys()].sort(),pending:this.pending.map(x=>x.workId)}));}
  snapshot(){return{kind:'MemoryVectorIndexSnapshot',contractVersion:MEMORY_VECTOR_INDEX_VERSION,vectors:[...this.vectors.entries()].map(([k,v])=>[k,deepClone(v)]),pending:deepClone(this.pending),receipts:deepClone(this.receipts),sequence:this.sequence,backpressure:{...this.backpressure},evictions:{...this.evictions}};}
  restore(s){this.vectors=new Map((s?.vectors??[]).map(([k,v])=>[k,deepClone(v)]));const pending=deepClone(s?.pending??[]);this.pending=pending.slice(0,this.maxPending);this.receipts=deepClone(s?.receipts??[]).slice(-this.maxReceipts);this.sequence=Number(s?.sequence??0);this.queryCache=new Map();
    this.backpressure={deferred:Number(s?.backpressure?.deferred??0)+Math.max(0,pending.length-this.maxPending),active:Boolean(s?.backpressure?.active)||pending.length>this.maxPending};this.evictions={count:Number(s?.evictions?.count??0),lastSequence:s?.evictions?.lastSequence??null};}
  #historianRecord(item){if(item.historianRecordRef){const r=this.producer.historian.records.get(item.historianRecordRef);if(r)return r;}return[...this.producer.historian.records.values()].find(r=>r.artifactId===item.artifactId&&Number(r.artifactRevision)===Number(item.artifactRevision))??null;}
  // Cap ledger row 41: the episode's representation text is its first 1,600 characters, so the rest of a long reply was
  // invisible to dense recall. A long reply is embedded as the representation text plus overlapping windows over the whole
  // exact evidence (one provider call with several inputs; at most MAX_SEGMENTS, always including the ending). A reply
  // within the representation text is embedded exactly as before (one string input).
  #segmentsFor(record){
    const head=String(record.representationText??'');
    const exact=(record.evidenceRefs??[]).map(id=>{const row=this.producer.graph?.evidenceView?.(id)??this.producer.graph?.evidenceRecord?.(id);return String(row?.exactContent??'');}).join('\n');
    if(exact.length<=SEGMENT.characters||!exact.startsWith(head.slice(0,Math.min(head.length,64))))return{texts:[head],coverage:null};
    const starts=[];for(let at=SEGMENT.characters-SEGMENT.overlap;at<exact.length;at+=SEGMENT.characters-SEGMENT.overlap)starts.push(at);
    const lastStart=Math.max(0,exact.length-SEGMENT.characters);
    let chosen=starts;const budget=SEGMENT.maxSegments-1;
    if(chosen.length>budget)chosen=[...starts.slice(0,budget-1),lastStart];
    const texts=[head,...chosen.map(at=>exact.slice(at,at+SEGMENT.characters))];
    const covered=chosen.length===starts.length;
    return{texts,coverage:{kind:'MemoryVectorSegmentCoverage',sourceCharacters:exact.length,segments:texts.length,complete:covered,endingIncluded:true,canonicalKnowledgeDropped:false}};
  }
  #fresh(refs){return(refs??[]).every(ref=>this.producer.graph.isSourceRevisionActive(ref));}
  #queryKey(query,selection){return stableHash(stableStringify([String(selection?.chatId??''),String(selection?.turnId??''),String(selection?.generationId??''),String(selection?.correlationId??''),Number(selection?.worldRevision??0),Number(selection?.sceneRevision??0),[...new Set((selection?.sourceRevisionRefs??[]).map(String))].sort(),String(query).toLowerCase()]));}
  #record(row){const value={contractVersion:MEMORY_VECTOR_INDEX_VERSION,at:Date.now(),...deepClone(row)};this.receipts.push(value);if(this.receipts.length>this.maxReceipts)this.receipts.splice(0,this.receipts.length-this.maxReceipts);return deepClone(value);}
  #trimVectors(){if(this.vectors.size<=this.maxVectors)return;const rows=[...this.vectors.entries()].sort((a,b)=>a[1].acceptedSequence-b[1].acceptedSequence);while(rows.length&&this.vectors.size>this.maxVectors){this.vectors.delete(rows.shift()[0]);this.evictions.count+=1;this.evictions.lastSequence=this.sequence;}}
}
