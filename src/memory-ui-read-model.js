import {
  MEMORY_LIMITS,
  MEMORY_UI_READ_MODEL_VERSION,
  deepClone,
  stableHash,
  stableStringify,
  uniqStrings,
} from './memory-contracts.js';

const freezeDeep=(value)=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freezeDeep(child);
    Object.freeze(value);
  }
  return value;
};

const text=(value)=>value==null||value===''?null:String(value);
const finite=(value)=>value==null||value===''?null:Number.isFinite(Number(value))?Number(value):null;

export function normalizeMemorySelection(input={}){
  const x=input?.selection??input?.context??input??{};
  return freezeDeep({
    chatId:text(x.chatId??x.chatNamespace??x.conversationId),
    turnId:text(x.turnId),
    generationId:text(x.generationId),
    correlationId:text(x.correlationId),
    worldRevision:finite(x.worldRevision??x.revisionFence?.worldRevision),
    sceneRevision:finite(x.sceneRevision??x.revisionFence?.sceneRevision),
    sourceRevisionRefs:uniqStrings(
      x.sourceRevisionRefs??x.sourceRevisionIds??x.sourceRevisionSet??x.revisionFence?.sourceRevisionSet??[],
      MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact,
    ),
  });
}

export function memorySelectionKey(input={}){
  const x=normalizeMemorySelection(input);
  return stableHash(stableStringify([
    x.chatId,x.turnId,x.generationId,x.correlationId,x.worldRevision,x.sceneRevision,x.sourceRevisionRefs,
  ]));
}

export function memoryEvidenceIdentity(evidence={}){
  const meta=evidence?.metadata??{};
  return {
    chatId:text(meta.chatId??meta.chatNamespace??meta.conversationId),
    turnId:text(meta.turnId),
    generationId:text(meta.generationId),
    correlationId:text(meta.correlationId),
  };
}

export function evidenceBelongsToChat(evidence,selection){
  const s=normalizeMemorySelection(selection);
  if(!s.chatId)return false;
  const id=memoryEvidenceIdentity(evidence);
  return id.chatId===s.chatId;
}

function sourceFreshness(producer,evidence){
  return producer.graph.evidenceFresh(evidence.id)?'FRESH':'STALE';
}

function claimBelongs(claim,evidenceIds){
  const refs=claim?.evidenceIds??[];
  return refs.length>0&&refs.every((id)=>evidenceIds.has(id));
}

function artifactBelongs(artifact,evidenceIds){
  const refs=artifact?.evidenceRefs??artifact?.supportEvidenceRefs??artifact?.exactEvidenceRefs??[];
  return refs.length>0&&refs.every((id)=>evidenceIds.has(id));
}

function asReadOnlyClaim(row){
  return {
    id:row.id,
    subjectId:row.subjectId,
    predicate:row.predicate,
    value:deepClone(row.value),
    temporal:deepClone(row.temporal),
    status:row.status,
    freshness:row.freshness,
    authorityClass:row.authorityClass,
    evidenceIds:[...(row.evidenceIds??[])],
    sourceRevisionIds:[...(row.sourceRevisionIds??[])],
    settlementDecisionId:row.settlementDecisionId??null,
    settlementReceiptId:row.settlementReceiptId??null,
    settledWorldRevision:row.settledWorldRevision??null,
  };
}

function readOnlyEpisode(row){
  return {
    id:row.id,
    logicalId:row.logicalId,
    revision:row.revision,
    sceneId:row.sceneId,
    sceneRevision:row.sceneRevision,
    freshness:row.freshness,
    state:row.state,
    authorityClass:row.authorityClass,
    summary:row.summary,
    participants:[...(row.participants??[])],
    knownBy:[...(row.knownBy??[])],
    evidenceRefs:[...(row.evidenceRefs??[])],
    sourceRevisionRefs:[...(row.sourceRevisionRefs??[])],
    mappingRefs:[...(row.mappingRefs??[])],
    bridgeResolutionStatus:row.bridgeResolutionStatus??null,
    bridgeReasonCodes:[...(row.bridgeReasonCodes??[])],
    provenance:deepClone(row.provenance??[]),
    admissionSource:row.admissionSource,
    timeBounds:deepClone(row.timeBounds),
  };
}

function readOnlyReflection(row){
  return {
    id:row.id,
    reflectionKey:row.reflectionKey,
    revision:row.revision,
    statement:row.statement,
    subjectRefs:[...(row.subjectRefs??[])],
    supportEvidenceRefs:[...(row.supportEvidenceRefs??[])],
    contradictionEvidenceRefs:[...(row.contradictionEvidenceRefs??[])],
    episodeRefs:[...(row.episodeRefs??[])],
    sourceRevisionRefs:[...(row.sourceRevisionRefs??[])],
    confidence:row.confidence,
    action:row.action,
    freshness:row.freshness,
    state:row.state,
    authorityClass:row.authorityClass,
    provenance:deepClone(row.provenance??[]),
    canonicalMutationAuthority:false,
  };
}

function readOnlySummary(row){
  return {
    id:row.id,
    scopeRef:row.scopeRef,
    scopeLevel:row.scopeLevel,
    revision:row.revision,
    freshness:row.freshness,
    state:row.state,
    authorityClass:row.authorityClass,
    navigationOnly:true,
    independentEvidence:false,
    sourceRange:deepClone(row.sourceRange),
    exactEvidenceRefs:[...(row.exactEvidenceRefs??[])],
    exactSourceRevisionSet:[...(row.exactSourceRevisionSet??[])],
    representativeEvidenceRefs:[...(row.representativeEvidenceRefs??[])],
    unresolvedSetRefs:[...(row.unresolvedSetRefs??[])],
    knowledgeFence:deepClone(row.knowledgeFence),
    representationText:String(row.representationText??''),
    summaryPolicyRevision:row.summaryPolicyRevision,
    compilerRevision:row.compilerRevision,
  };
}

function cap(values,limit){
  return values.slice(Math.max(0,values.length-limit));
}

function retrievalReadModel(entry){
  if(!entry)return null;
  return deepClone({
    kind:'MemoryRetrievalReadModel',
    contractVersion:MEMORY_UI_READ_MODEL_VERSION,
    selection:entry.selection,
    query:entry.query,
    mode:entry.mode,
    status:entry.status,
    nominations:entry.nominations,
    diagnostics:entry.diagnostics,
    revisionRefs:entry.revisionRefs,
    sequence:entry.sequence,
    freshness:'FRESH',
    authorityGranted:false,
    admissionAuthority:false,
    settlementAuthority:false,
    contextSealAuthority:false,
  });
}

export class MemoryUiReadModelProducer{
  constructor({producer,snapshot=null}={}){
    if(!producer)throw new TypeError('MemoryUiReadModelProducer requires MemoryTemporalProducer');
    this.producer=producer;
    this.listeners=new Set();
    this.sequence=0;
    this.retrievalHistory=[];
    if(snapshot)this.restore(snapshot);
  }

  read(selectionInput={}){
    const selection=normalizeMemorySelection(selectionInput);
    if(!selection.chatId){
      return freezeDeep({
        kind:'MemoryUiReadModel',
        contractVersion:MEMORY_UI_READ_MODEL_VERSION,
        availability:'DEGRADED',
        health:{state:'DEGRADED',reasons:['MEMORY_SELECTION_CHAT_REQUIRED']},
        ...deepClone(selection),
        revisionRefs:this.producer.memoryRevisionRefs(),
        persistentStateScope:'NONE',
        evidence:[],
        state:{current:[],historical:[],unresolved:[]},
        episodes:[],
        reflections:[],
        summaries:[],
        retrieval:null,
        provenance:{evidenceRefs:[],sourceRevisionRefs:[],mappingRefs:[],settlementRefs:[]},
        freshness:{freshEvidence:0,staleEvidence:0,freshEpisodes:0,staleEpisodes:0,freshReflections:0,staleReflections:0},
        limits:this.#limits(),
        readOnly:true,
        mutationAuthority:false,
        settlementAuthority:false,
        contextSealAuthority:false,
      });
    }

    const selectedEvidence=[];
    for(const id of this.producer.graph.evidenceOrder??[]){
      const row=this.producer.graph.evidenceRecord(id);
      if(row&&evidenceBelongsToChat(row,selection))selectedEvidence.push(row);
    }
    const evidenceIds=new Set(selectedEvidence.map((row)=>row.id));
    const asOf=selection.worldRevision==null?Infinity:selection.worldRevision;
    const current=this.producer.graph.currentProjection({asOfWorldRevision:asOf,includeStale:true})
      .filter((row)=>claimBelongs(row,evidenceIds))
      .map(asReadOnlyClaim);
    const historical=this.producer.graph.historicalClaims({
      asOfWorldRevision:asOf,includeUnresolved:false,includeStale:true,
    }).filter((row)=>row.status==='HISTORICAL'&&claimBelongs(row,evidenceIds)).map(asReadOnlyClaim);
    const unresolved=this.producer.graph.historicalClaims({
      asOfWorldRevision:asOf,includeUnresolved:true,includeStale:true,
    }).filter((row)=>row.status==='UNRESOLVED'&&claimBelongs(row,evidenceIds)).map(asReadOnlyClaim);

    const episodes=this.producer.experienceStore.currentEpisodes({freshOnly:false})
      .filter((row)=>artifactBelongs(row,evidenceIds)).map(readOnlyEpisode);
    const reflections=this.producer.experienceStore.currentReflections({freshOnly:false})
      .filter((row)=>artifactBelongs(row,evidenceIds)).map(readOnlyReflection);
    const summaries=this.producer.summaryHierarchy.currentArtifacts({freshOnly:false})
      .filter((row)=>artifactBelongs(row,evidenceIds)).map(readOnlySummary);

    const evidenceRows=cap(selectedEvidence,MEMORY_LIMITS.maxUiEvidenceRows).map((row)=>({
      id:row.id,
      sourceId:row.sourceId,
      sourceRevisionId:row.sourceRevisionId,
      contentHash:row.contentHash,
      contentPreview:String(row.exactContent??'').slice(0,320),
      occurredAt:row.occurredAt,
      worldRevision:row.worldRevision,
      sceneRevision:row.sceneRevision,
      participants:[...(row.participants??[])],
      knownBy:[...(row.knownBy??[])],
      perspective:row.perspective,
      evidenceKind:row.evidenceKind,
      authorityClass:row.authorityClass,
      freshness:sourceFreshness(this.producer,row),
      provenance:deepClone(row.provenance??[]),
      identity:memoryEvidenceIdentity(row),
    }));

    const retrieval=this.#latestRetrieval(selection);
    const activeSourceRefs=uniqStrings(
      selectedEvidence.filter((row)=>this.producer.graph.evidenceFresh(row.id)).map((row)=>row.sourceRevisionId),
      MEMORY_LIMITS.maxUiEvidenceRows,
    );
    const reasons=[];
    if(!selectedEvidence.length)reasons.push('MEMORY_NO_EVIDENCE_FOR_SELECTED_CHAT');
    if(evidenceRows.some((row)=>row.freshness==='STALE'))reasons.push('MEMORY_STALE_EVIDENCE_PRESENT');
    if(episodes.some((row)=>row.freshness==='STALE'))reasons.push('MEMORY_STALE_EPISODE_PRESENT');
    if(summaries.some((row)=>row.freshness==='STALE'))reasons.push('MEMORY_STALE_SUMMARY_PRESENT');
    const health=reasons.length?'DEGRADED':'READY';
    const sourceRevisionRefs=selection.sourceRevisionRefs.length
      ? [...selection.sourceRevisionRefs]
      : activeSourceRefs.slice(0,MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact);
    const worldRevision=selection.worldRevision??Math.max(0,...selectedEvidence.map((row)=>Number(row.worldRevision??0)));
    const sceneRevision=selection.sceneRevision??Math.max(0,...episodes.map((row)=>Number(row.sceneRevision??0)));
    const provenance={
      evidenceRefs:evidenceRows.map((row)=>row.id),
      sourceRevisionRefs:activeSourceRefs,
      mappingRefs:uniqStrings(episodes.flatMap((row)=>row.mappingRefs??[]),MEMORY_LIMITS.maxUiEvidenceRows),
      settlementRefs:uniqStrings(
        [...current,...historical,...unresolved].flatMap((row)=>[row.settlementDecisionId,row.settlementReceiptId].filter(Boolean)),
        MEMORY_LIMITS.maxUiEvidenceRows,
      ),
    };
    const model={
      kind:'MemoryUiReadModel',
      contractVersion:MEMORY_UI_READ_MODEL_VERSION,
      availability:selectedEvidence.length?'LIVE':'UNAVAILABLE',
      health:{state:health,reasons:reasons.slice(0,MEMORY_LIMITS.maxUiDegradedReasons)},
      chatId:selection.chatId,
      turnId:selection.turnId,
      generationId:selection.generationId,
      correlationId:selection.correlationId,
      worldRevision,
      sceneRevision:sceneRevision||null,
      sourceRevisionRefs,
      revisionRefs:this.producer.memoryRevisionRefs(),
      revision:'memory-ui:'+stableHash(stableStringify({
        selection:memorySelectionKey(selection),
        revisions:this.producer.memoryRevisionRefs(),
        retrievalSequence:retrieval?.sequence??null,
      })),
      persistentStateScope:'CHAT',
      retrievalScope:'SELECTED_TURN_GENERATION',
      evidence:evidenceRows,
      state:{current, historical, unresolved},
      episodes:cap(episodes,MEMORY_LIMITS.maxUiEpisodeRows),
      reflections:cap(reflections,MEMORY_LIMITS.maxUiReflectionRows),
      summaries:cap(summaries,MEMORY_LIMITS.maxUiSummaryRows),
      retrieval,
      provenance,
      freshness:{
        freshEvidence:evidenceRows.filter((row)=>row.freshness==='FRESH').length,
        staleEvidence:evidenceRows.filter((row)=>row.freshness!=='FRESH').length,
        freshEpisodes:episodes.filter((row)=>row.freshness==='FRESH').length,
        staleEpisodes:episodes.filter((row)=>row.freshness!=='FRESH').length,
        freshReflections:reflections.filter((row)=>row.freshness==='FRESH').length,
        staleReflections:reflections.filter((row)=>row.freshness!=='FRESH').length,
        freshSummaries:summaries.filter((row)=>row.freshness==='FRESH').length,
        staleSummaries:summaries.filter((row)=>row.freshness!=='FRESH').length,
      },
      limits:this.#limits(),
      readOnly:true,
      mutationAuthority:false,
      settlementAuthority:false,
      contextSealAuthority:false,
    };
    return freezeDeep(model);
  }

  recordRetrieval(selectionInput,request,result){
    const selection=normalizeMemorySelection(selectionInput);
    if(!selection.chatId)return null;
    const row={
      kind:'MemoryUiRetrievalJournalEntry',
      selection:deepClone(selection),
      selectionKey:memorySelectionKey(selection),
      query:String(request?.query??''),
      mode:request?.mode??'EXPLICIT_HISTORY',
      status:result?.status??'DEGRADED',
      nominations:(result?.nominations??[]).slice(0,MEMORY_LIMITS.maxUiRetrievalArtifacts).map((item)=>deepClone(item)),
      diagnostics:deepClone(result?.diagnostics??{}),
      revisionRefs:this.producer.memoryRevisionRefs(),
      sequence:++this.sequence,
    };
    this.retrievalHistory.push(row);
    if(this.retrievalHistory.length>MEMORY_LIMITS.maxUiRetrievalHistory){
      this.retrievalHistory.splice(0,this.retrievalHistory.length-MEMORY_LIMITS.maxUiRetrievalHistory);
    }
    this.notify('MEMORY_RETRIEVAL_UPDATED',selection,{retrievalSequence:row.sequence});
    return retrievalReadModel(row);
  }

  notify(type,selectionInput={},details={}){
    const selection=normalizeMemorySelection(selectionInput);
    const event=freezeDeep({
      kind:'MemoryUiProducerUpdate',
      contractVersion:MEMORY_UI_READ_MODEL_VERSION,
      sequence:++this.sequence,
      type:String(type||'MEMORY_CHANGED'),
      selection,
      revisionRefs:this.producer.memoryRevisionRefs(),
      details:deepClone(details),
      rawEvidenceIncluded:false,
      mutationAuthority:false,
    });
    for(const listener of [...this.listeners]){
      try{listener(event);}catch{}
    }
    return event;
  }

  subscribe(listener){
    if(typeof listener!=='function')throw new TypeError('Memory UI listener must be a function');
    if(this.listeners.size>=MEMORY_LIMITS.maxUiSubscribers)throw new RangeError('Memory UI subscriber limit exceeded');
    this.listeners.add(listener);
    return()=>this.listeners.delete(listener);
  }

  createProducer({readSelection=null}={}){
    const owner=this;
    return freezeDeep({
      kind:'MemoryUiProducer',
      contractVersion:MEMORY_UI_READ_MODEL_VERSION,
      read(selection=null){
        const effective=selection??(typeof readSelection==='function'?readSelection():{});
        return owner.read(effective);
      },
      readRetrieval(request={},selection=null){
        const effective=selection??request.selection??(typeof readSelection==='function'?readSelection():{});
        return owner.producer.queryHistorian({...request,selection:effective});
      },
      subscribe(listener){return owner.subscribe(listener);},
      mutationAuthority:false,
      settlementAuthority:false,
      contextSealAuthority:false,
    });
  }

  #latestRetrieval(selection){
    const key=memorySelectionKey(selection);
    for(let i=this.retrievalHistory.length-1;i>=0;i-=1){
      if(this.retrievalHistory[i].selectionKey===key)return retrievalReadModel(this.retrievalHistory[i]);
    }
    return null;
  }

  #limits(){
    return {
      maxEvidenceRows:MEMORY_LIMITS.maxUiEvidenceRows,
      maxEpisodeRows:MEMORY_LIMITS.maxUiEpisodeRows,
      maxReflectionRows:MEMORY_LIMITS.maxUiReflectionRows,
      maxSummaryRows:MEMORY_LIMITS.maxUiSummaryRows,
      maxRetrievalHistory:MEMORY_LIMITS.maxUiRetrievalHistory,
      maxRetrievalArtifacts:MEMORY_LIMITS.maxUiRetrievalArtifacts,
      maxSubscribers:MEMORY_LIMITS.maxUiSubscribers,
    };
  }

  snapshot(){
    return {
      kind:'MemoryUiReadModelSnapshot',
      contractVersion:MEMORY_UI_READ_MODEL_VERSION,
      sequence:this.sequence,
      retrievalHistory:this.retrievalHistory.map(deepClone),
    };
  }

  restore(snapshot){
    this.sequence=Number(snapshot?.sequence??0);
    this.retrievalHistory=(snapshot?.retrievalHistory??[]).slice(-MEMORY_LIMITS.maxUiRetrievalHistory).map(deepClone);
  }
}
