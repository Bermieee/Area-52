import {
  CandidateFreshness,
  CandidateTruthStatus,
  RetrievalChannelCapability,
  RetrievalChannelHealth,
  createChannelNomination,
  createRetrievalChannelDescriptor,
} from './candidate-bus-contracts.js';
import {KnowledgeAuthorityOrigin,KnowledgeSourceClass,KnowledgeTemporalStatus,createKnowledgeEvidence} from './knowledge-evidence.js';
import {InMemoryRetrievalIndexAdapter} from './retrieval-index-adapters.js';
import {RetrievalIndexLifecycleManager} from './retrieval-index-lifecycle.js';
import {
  IndexResidencyState,
  RetrievalIndexFamily,
  createIndexedArtifactRepresentation,
  createOwnerRetrievalArtifact,
  stableRepresentationId,
} from './retrieval-index-contracts.js';

const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter((value)=>value!==null&&value!==undefined&&String(value).trim()!=='').map((value)=>String(value).trim()))].sort();

function normalize(value){
  return String(value??'')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g,"'")
    .replace(/[\u201c\u201d]/g,'"')
    .replace(/[^\p{L}\p{N}_:@.'-]+/gu,' ')
    .trim()
    .replace(/\s+/g,' ');
}
function tokens(value){
  return normalize(value).split(/\s+/).filter(Boolean).slice(0,512);
}
function counts(value){
  const out={};
  for(const token of tokens(value))out[token]=(out[token]??0)+1;
  return out;
}
function strings(value){
  if(value==null)return[];
  if(Array.isArray(value))return value.flatMap(strings);
  if(typeof value==='object')return[];
  const text=String(value).trim();
  return text?[text]:[];
}
function metadataLists(revision){
  const metadata=revision?.metadata??{},extra=metadata?.extra??{};
  const aliases=uniq([
    ...strings(extra.aliases),...strings(extra.alias),...strings(extra.names),...strings(extra.name),
  ]);
  const triggers=uniq([
    ...strings(extra.triggers),...strings(extra.trigger),...strings(extra.keys),...strings(extra.key),
  ]);
  const keywords=uniq([
    ...strings(metadata.tags),...strings(extra.keywords),...strings(extra.keyword),...strings(extra.tags),
  ]);
  const phrases=uniq([
    ...strings(metadata.title),...aliases,
  ]);
  return{aliases,triggers,keywords,phrases};
}
function sparseFields({sourceId,lorebookId,uid,revision}){
  const lists=metadataLists(revision);
  return{
    exactIdentifiers:uniq([sourceId,lorebookId,uid,...lists.aliases,...lists.triggers]).map(normalize).filter(Boolean),
    exactPhrases:lists.phrases.map(normalize).filter(Boolean),
    authoredKeywords:lists.keywords.map(normalize).filter(Boolean),
  };
}
function lexicalScore(queryTerms,representationTerms){
  const q=new Set(queryTerms??[]);
  let score=0;
  for(const row of representationTerms??[])if(q.has(row.term))score+=1+Math.log1p(Number(row.count??1));
  return score;
}
function containsQualified(query,value){
  const needle=normalize(value);if(!needle)return false;
  return query===needle||(' '+query+' ').includes(' '+needle+' ');
}
function scoreSparse(queryRepresentation,representation){
  const query=normalize(queryRepresentation?.normalized??queryRepresentation?.query??'');
  const data=representation?.representationData??{};
  if(!query)return null;
  if((data.exactIdentifiers??[]).some((value)=>containsQualified(query,value))){
    return{score:100,rankSignals:{sparseExecution:'EXACT_IDENTIFIER',qualifiedExact:1,sparse:100}};
  }
  if((data.exactPhrases??[]).some((value)=>containsQualified(query,value))){
    return{score:70,rankSignals:{sparseExecution:'EXACT_PHRASE',exactPhrase:1,sparse:70}};
  }
  if((data.authoredKeywords??[]).some((value)=>containsQualified(query,value))){
    return{score:50,rankSignals:{sparseExecution:'AUTHORED_KEYWORD',authoredKeyword:1,sparse:50}};
  }
  const lexical=lexicalScore(queryRepresentation?.terms,data.terms);
  if(lexical<=0)return null;
  return{score:lexical,rankSignals:{sparseExecution:'LEXICAL_FALLBACK',lexicalTokenOverlap:lexical,sparse:lexical}};
}

class ProductionSparseRepresentationProvider{
  constructor({providerId='production-qualified-sparse-v1'}={}){this.providerId=String(providerId);}
  represent(artifact,{indexFamily,adapterId,indexVersion}={}){
    if(indexFamily!==RetrievalIndexFamily.SPARSE)throw new TypeError('ProductionSparseRepresentationProvider supports SPARSE only');
    const text=String(artifact.text??artifact.metadata?.representationText??artifact.semanticKey??artifact.artifactId??'');
    const termCounts=counts(text);
    const fields=artifact.metadata?.sparseFields??{};
    return createIndexedArtifactRepresentation({
      representationId:stableRepresentationId({
        adapterId,indexFamily,artifactId:artifact.artifactId,semanticKey:artifact.semanticKey,
        claimRefs:artifact.claimRefs,eventRefs:artifact.eventRefs,
      }),
      representationRevision:artifact.artifactRevision,
      indexFamily,
      ownerArtifactId:artifact.artifactId,
      ownerArtifactRevision:artifact.artifactRevision,
      sourceId:artifact.sourceId,
      sourceRevision:artifact.sourceRevision,
      entityRefs:artifact.entityRefs,
      conceptRefs:artifact.metadata?.conceptRefs??[],
      claimRefs:artifact.claimRefs,
      eventRefs:artifact.eventRefs,
      relationshipRefs:artifact.relationshipRefs,
      authorityClass:artifact.authorityClass,
      truthStatusHint:artifact.truthStatusHint,
      provenanceRefs:artifact.provenanceRefs,
      dependencyInvalidators:artifact.dependencyInvalidators,
      indexAdapter:adapterId,
      indexVersion,
      representationData:{
        terms:Object.keys(termCounts).sort().map((term)=>({term,count:termCounts[term]})),
        exactIdentifiers:uniq(fields.exactIdentifiers??[]).map(normalize).filter(Boolean),
        exactPhrases:uniq(fields.exactPhrases??[]).map(normalize).filter(Boolean),
        authoredKeywords:uniq(fields.authoredKeywords??[]).map(normalize).filter(Boolean),
        providerId:this.providerId,
      },
      representationText:text,
      semanticKey:artifact.semanticKey,
      metadata:{
        ...(clone(artifact.metadata??{})),
        representationProvider:this.providerId,
        artifactType:artifact.artifactType,
        sparseImplementation:'QUALIFIED_LEXICAL_SPARSE',
        productionBm25:false,
      },
    });
  }
  representQuery(text,indexFamily){
    if(indexFamily!==RetrievalIndexFamily.SPARSE)throw new TypeError('ProductionSparseRepresentationProvider supports SPARSE only');
    const normalized=normalize(text),termCounts=counts(normalized);
    return{query:String(text??''),normalized,terms:Object.keys(termCounts).sort()};
  }
}

class ProductionSparseIndexAdapter extends InMemoryRetrievalIndexAdapter{
  constructor({adapterId='PRODUCTION_SPARSE_EXACT',indexVersion='1.0.0'}={}){
    super({adapterId,indexFamily:RetrievalIndexFamily.SPARSE,indexVersion});
  }
  query({queryRepresentation,limit=32,includeStale=false}={}){
    this.operationCounts.query+=1;
    const rows=[];
    for(const representation of this.entries.values()){
      if(representation.residencyState!==IndexResidencyState.ACTIVE&&!includeStale)continue;
      const scored=scoreSparse(queryRepresentation,representation);
      if(!scored)continue;
      rows.push({representation:clone(representation),score:scored.score,rankSignals:scored.rankSignals});
    }
    rows.sort((a,b)=>b.score-a.score||a.representation.representationId.localeCompare(b.representation.representationId));
    return rows.slice(0,Math.max(0,Math.trunc(Number(limit)||0)));
  }
}

export class ProductionSparseRetrievalChannel{
  constructor({
    channelId='OWNER_SPARSE_EXACT',
    adapterId='PRODUCTION_SPARSE_EXACT',
    maxArtifacts=512,
    maxCandidates=32,
    evidenceSink=null,
    revisionGuard=null,
    truthStatusFor=null,
  }={}){
    this.truthStatusFor=typeof truthStatusFor==='function'?truthStatusFor:null;
    this.channelId=String(channelId);
    this.evidenceSink=typeof evidenceSink==='function'?evidenceSink:()=>{};
    this.revisionGuard=typeof revisionGuard==='function'?revisionGuard:null;
    this.maxArtifacts=Math.max(1,Math.min(2048,Math.trunc(Number(maxArtifacts)||512)));
    this.maxCandidates=Math.max(1,Math.min(64,Math.trunc(Number(maxCandidates)||32)));
    this.adapter=new ProductionSparseIndexAdapter({adapterId});
    this.lifecycle=new RetrievalIndexLifecycleManager({representationProvider:new ProductionSparseRepresentationProvider()});
    this.lifecycle.registerAdapter(this.adapter);
    this.activeArtifactIds=new Set();
    this.activeChatId=null;
    this.lastHydration={
      kind:'ProductionSparseHydrationReceipt',status:'UNAVAILABLE',reason:'OWNER_NOT_HYDRATED',
      chatId:null,eligibleCount:0,indexedCount:0,boundedOutCount:0,failures:[],
      authorityGranted:false,admissionAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    };
    this.lastRevisionReceipt=null;
    this.descriptor=createRetrievalChannelDescriptor({
      channelId:this.channelId,
      capabilities:[RetrievalChannelCapability.SPARSE],
      supportedIntentKinds:['*'],
      maxCandidates:this.maxCandidates,
      health:RetrievalChannelHealth.HEALTHY,
      available:true,
      metadata:{
        owner:'BRAIN_RETRIEVAL',
        implementation:'QUALIFIED_LEXICAL_SPARSE',
        productionBm25:false,
        ownerRevisionFence:true,
        sourceScopeRequired:true,
        candidateBusAdmissionAuthority:false,
        settlementAuthority:false,
        contextSealAuthority:false,
      },
    });
  }

  clearScope(reason='OWNER_SCOPE_CLEARED'){
    this.activeArtifactIds.clear();
    this.activeChatId=null;
    this.lastHydration={
      kind:'ProductionSparseHydrationReceipt',status:'UNAVAILABLE',reason:String(reason),
      chatId:null,eligibleCount:0,indexedCount:0,boundedOutCount:0,failures:[],
      authorityGranted:false,admissionAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    };
    return clone(this.lastHydration);
  }

  hydrateLoreOwner(owner,{chatId,query=null}={}){
    const chat=chatId==null?null:String(chatId);
    if(!chat||typeof owner?.status!=='function'||typeof owner?.sourceRevision!=='function'){
      return this.clearScope(!chat?'STORY_SCOPE_REQUIRED':'OWNER_CURRENT_SOURCE_SURFACE_UNAVAILABLE');
    }
    let status;
    try{status=owner.status({chatId:chat});}
    catch(error){
      this.clearScope('OWNER_STATUS_FAILED');
      this.lastHydration={...this.lastHydration,chatId:chat,reason:error?.code??error?.message??'OWNER_STATUS_FAILED'};
      return clone(this.lastHydration);
    }
    const queryText=normalize(query??'');
    const exactStatusMatch=(row)=>queryText&&[
      row?.sourceId,row?.uid,row?.title,row?.name,
    ].some((value)=>value!=null&&containsQualified(queryText,value));
    const eligible=(status?.entries??[])
      .filter((row)=>row?.eligibleForStoryRetrieval===true&&row?.sourceState!=='REMOVED'&&row?.freshness==='CURRENT'&&row?.retrievalReady!==false)
      .sort((a,b)=>{
        const pa=exactStatusMatch(a)?0:1,pb=exactStatusMatch(b)?0:1;
        return pa-pb||String(a.sourceId).localeCompare(String(b.sourceId));
      });
    const selected=eligible.slice(0,this.maxArtifacts);
    const queryPrioritizedCount=selected.filter(exactStatusMatch).length;
    const active=new Set(),failures=[],indexedArtifacts=[];
    let indexedCount=0;
    for(const entry of selected){
      const receipt=this.#indexEntry(owner,entry);
      if(receipt.ok){active.add(receipt.artifactId);indexedArtifacts.push(receipt.artifact);indexedCount+=1;}
      else failures.push(receipt.failure);
    }
    let compaction=null;
    if(this.lifecycle.ownerArtifacts.size>this.maxArtifacts){
      compaction=this.lifecycle.rebuild({ownerArtifacts:indexedArtifacts,adapterIds:[this.adapter.adapterId]});
    }
    this.activeChatId=chat;
    this.activeArtifactIds=active;
    this.lastHydration={
      kind:'ProductionSparseHydrationReceipt',
      status:failures.length?(indexedCount?'PARTIAL':'UNAVAILABLE'):'READY',
      reason:failures.length?'OWNER_ENTRY_VALIDATION_FAILED':'OWNER_CURRENT_REVISIONS_INDEXED',
      chatId:chat,
      eligibleCount:eligible.length,
      indexedCount,
      activeCount:active.size,
      boundedOutCount:Math.max(0,eligible.length-selected.length),
      queryPrioritizedCount,
      compacted:Boolean(compaction),
      compaction:clone(compaction),
      failures:failures.slice(0,32),
      indexVersion:this.adapter.indexVersion,
      implementation:'QUALIFIED_LEXICAL_SPARSE',
      productionBm25:false,
      authorityGranted:false,admissionAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    };
    return clone(this.lastHydration);
  }

  acceptLoreRevisionChange(event,owner){
    const sourceId=event?.sourceId==null?null:String(event.sourceId);
    if(!sourceId)return{kind:'ProductionSparseRevisionReceipt',status:'IGNORED',reason:'SOURCE_ID_REQUIRED',authorityGranted:false};
    const previous=event.previousSourceRevisionId==null?null:String(event.previousSourceRevisionId);
    const invalidation=previous
      ? this.lifecycle.invalidateBySourceRevision(previous,{reason:event.sourceState==='REMOVED'?'LORE_SOURCE_REMOVED':'LORE_SOURCE_REVISION_CHANGED'})
      : null;
    const artifactId=this.#artifactId(sourceId);
    if(String(event.sourceState??'CURRENT').toUpperCase()==='REMOVED'){
      const retirement=this.lifecycle.tombstoneBySourceId(sourceId,{reason:'LORE_SOURCE_REMOVED'});
      this.activeArtifactIds.delete(artifactId);
      this.lastRevisionReceipt={
        kind:'ProductionSparseRevisionReceipt',status:'TOMBSTONED',sourceId,
        previousSourceRevisionId:previous,sourceRevisionId:event.sourceRevisionId??null,
        invalidation,retirement,reindexed:false,wholeIndexRebuild:false,authorityGranted:false,
      };
      return clone(this.lastRevisionReceipt);
    }
    if(!this.activeChatId||typeof owner?.status!=='function'||typeof owner?.sourceRevision!=='function'){
      this.activeArtifactIds.delete(artifactId);
      this.lastRevisionReceipt={
        kind:'ProductionSparseRevisionReceipt',status:'INVALIDATED',sourceId,
        previousSourceRevisionId:previous,sourceRevisionId:event.sourceRevisionId??null,
        invalidation,reindexed:false,reason:'CURRENT_OWNER_SURFACE_UNAVAILABLE',wholeIndexRebuild:false,authorityGranted:false,
      };
      return clone(this.lastRevisionReceipt);
    }
    let status;
    try{status=owner.status({chatId:this.activeChatId});}
    catch(error){
      this.activeArtifactIds.delete(artifactId);
      this.lastRevisionReceipt={
        kind:'ProductionSparseRevisionReceipt',status:'INVALIDATED',sourceId,
        previousSourceRevisionId:previous,sourceRevisionId:event.sourceRevisionId??null,
        invalidation,reindexed:false,reason:error?.code??error?.message??'OWNER_STATUS_FAILED',wholeIndexRebuild:false,authorityGranted:false,
      };
      return clone(this.lastRevisionReceipt);
    }
    const entry=(status?.entries??[]).find((row)=>String(row?.sourceId??'')===sourceId);
    if(!entry||entry.eligibleForStoryRetrieval!==true||entry.sourceState==='REMOVED'||entry.freshness!=='CURRENT'||entry.retrievalReady===false){
      this.activeArtifactIds.delete(artifactId);
      this.lastRevisionReceipt={
        kind:'ProductionSparseRevisionReceipt',status:'INVALIDATED',sourceId,
        previousSourceRevisionId:previous,sourceRevisionId:event.sourceRevisionId??null,
        invalidation,reindexed:false,reason:'OWNER_SOURCE_NOT_CURRENT_OR_SCOPE_ELIGIBLE',wholeIndexRebuild:false,authorityGranted:false,
      };
      return clone(this.lastRevisionReceipt);
    }
    const indexed=this.#indexEntry(owner,entry);
    if(indexed.ok)this.activeArtifactIds.add(indexed.artifactId);else this.activeArtifactIds.delete(artifactId);
    this.lastRevisionReceipt={
      kind:'ProductionSparseRevisionReceipt',
      status:indexed.ok?'REINDEXED':'INVALIDATED',
      sourceId,previousSourceRevisionId:previous,sourceRevisionId:event.sourceRevisionId??entry.sourceRevisionId??null,
      invalidation,reindexed:indexed.ok,indexReceipt:indexed.receipt??null,
      reason:indexed.ok?'DEPENDENT_SOURCE_REINDEXED':indexed.failure?.reason??'OWNER_REVISION_VALIDATION_FAILED',
      wholeIndexRebuild:false,authorityGranted:false,admissionAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    };
    return clone(this.lastRevisionReceipt);
  }

  retrieve(intent,context={}){
    if(!this.activeChatId||!this.activeArtifactIds.size)return[];
    const query=String(intent?.query??context.query??'').trim();
    if(!query)return[];
    const rows=this.lifecycle.queryAdapter(this.adapter.adapterId,{query,limit:this.maxCandidates});
    const fresh=rows.filter((row)=>row.freshness===CandidateFreshness.FRESH&&this.activeArtifactIds.has(row.representation.ownerArtifactId));
    const maxScore=Math.max(...fresh.map((row)=>Number(row.score)||0),1);
    return fresh.slice(0,this.maxCandidates).map((row,index)=>{
      const rep=row.representation;
      // The Lore owner's current temporal/conflict view of this source (never a stale index-time constant). A failing
      // lookup is UNRESOLVED (fail closed); no opinion (null) keeps the indexed hint.
      let owned=null;
      if(this.truthStatusFor){try{owned=this.truthStatusFor(rep.sourceId)??null;}catch{owned={status:CandidateTruthStatus.UNRESOLVED,temporalHints:[]};}}
      const truthStatus=CandidateTruthStatus[owned?.status]??rep.truthStatusHint;
      const evidenceId='owner-sparse-evidence:'+rep.sourceRevision;
      const evidence=createKnowledgeEvidence({
        evidenceId,evidenceIdentity:'lore-source:'+rep.sourceId,
        artifactRef:{artifactId:rep.ownerArtifactId,artifactType:rep.metadata?.artifactType??'LORE_SOURCE_SPARSE',revision:rep.ownerArtifactRevision},
        sourceClass:KnowledgeSourceClass.SOURCE_LORE,authorityClass:'SOURCE_CANON',authorityOrigin:KnowledgeAuthorityOrigin.SOURCE,
        temporalStatus:KnowledgeTemporalStatus[truthStatus]??KnowledgeTemporalStatus.CURRENT,sourceRevisionRefs:[rep.sourceRevision],dependencyRevisionRefs:rep.dependencyInvalidators,
        provenanceRefs:uniq([rep.sourceRevision,...(rep.provenanceRefs??[])]),
        loreRef:{sourceId:rep.sourceId,lorebookId:rep.metadata?.lorebookId??null,uid:rep.metadata?.uid??null,sourceRevisionId:rep.sourceRevision},
        extensions:{representationText:rep.representationText,exactSourceDrillback:true,owner:'LORE',sparseExecution:row.rankSignals?.sparseExecution??'LEXICAL_FALLBACK'},
      });
      this.evidenceSink(evidence);
      return createChannelNomination({
        nominationId:this.channelId+':'+String(intent?.intentId??'intent')+':'+rep.representationId,
        channelId:this.channelId,
        candidateId:'candidate:owner-sparse:'+rep.ownerArtifactId,
        evidenceIdentity:'owner-sparse:'+rep.sourceId,
        artifactRef:{artifactId:rep.ownerArtifactId,artifactType:rep.metadata?.artifactType??'LORE_SOURCE_SPARSE',revision:rep.ownerArtifactRevision},
        artifactRevision:rep.ownerArtifactRevision,
        sourceRevisionRefs:[rep.sourceRevision],
        entityRefs:rep.entityRefs,
        relationshipRefs:rep.relationshipRefs,
        claimRefs:rep.claimRefs,
        eventRefs:rep.eventRefs,
        retrievalIntentIds:[String(intent?.intentId??'intent')],
        rankSignals:{...row.rankSignals,productionSparse:true,productionBm25:false},
        normalizedRank:Math.max(0,Math.min(1,(Number(row.score)||0)/maxScore-index*0.000001)),
        authorityClass:rep.authorityClass,
        truthStatusHint:truthStatus,
        temporalHints:owned?.temporalHints?.length?owned.temporalHints:[{status:truthStatus}],
        provenance:(rep.provenanceRefs??[]).map((ref)=>({ref})),
        evidenceRefs:[evidenceId],
        dependencyRevisions:rep.dependencyInvalidators,
        freshness:CandidateFreshness.FRESH,
        representationRef:rep.representationId,
        representationRevision:rep.representationRevision,
        representationText:rep.representationText,
        metadata:{
          ...(clone(rep.metadata??{})),
          owner:'LORE',knowledgeEvidenceId:evidenceId,
          ownerSourceId:rep.sourceId,
          ownerSourceRevisionId:rep.sourceRevision,
          exactSourceDrillback:true,
          authorityScope:{chatId:this.activeChatId},
          sparseExecution:row.rankSignals?.sparseExecution??'LEXICAL_FALLBACK',
          retrievalRankAuthority:false,
          productionBm25:false,
        },
        worldRevision:context.worldRevision??null,
        sceneRevision:context.sceneRevision??null,
      });
    });
  }

  diagnostics(){
    return{
      kind:'ProductionSparseRetrievalDiagnostics',
      channelId:this.channelId,
      implementation:'QUALIFIED_LEXICAL_SPARSE',
      productionBm25:false,
      activeChatId:this.activeChatId,
      artifactCount:this.activeArtifactIds.size,
      residentOwnerArtifactCount:this.lifecycle.ownerArtifacts.size,
      maxArtifacts:this.maxArtifacts,
      maxCandidates:this.maxCandidates,
      lastHydration:clone(this.lastHydration),
      lastRevisionReceipt:clone(this.lastRevisionReceipt),
      lifecycle:this.lifecycle.lifecycleDiagnostics(),
      authorityGranted:false,admissionAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    };
  }

  #artifactId(sourceId){return'owner-lore-sparse:'+String(sourceId);}

  #indexEntry(owner,entry){
    const sourceId=String(entry?.sourceId??'');
    if(!sourceId)return{ok:false,failure:{sourceId:null,reason:'SOURCE_ID_REQUIRED'}};
    let revision;
    try{revision=owner.sourceRevision(sourceId);}
    catch(error){return{ok:false,failure:{sourceId,reason:error?.code??error?.message??'OWNER_SOURCE_REVISION_FAILED'}};}
    if(!revision||String(revision.id??'')!==String(entry.sourceRevisionId??'')||revision.state==='REMOVED'||typeof revision.exactContent!=='string'){
      return{ok:false,failure:{sourceId,reason:'OWNER_CURRENT_REVISION_MISMATCH',expectedRevisionId:entry.sourceRevisionId??null,actualRevisionId:revision?.id??null}};
    }
    if(this.revisionGuard){
      let guard;
      try{guard=this.revisionGuard({sourceId,sourceRevisionId:String(revision.id),exactAuthoredText:String(revision.exactContent),ownerRevision:clone(revision)});}
      catch(error){return{ok:false,failure:{sourceId,reason:error?.code??error?.message??'BRAIN_REVISION_GUARD_FAILED'}};}
      if(guard===false||guard?.admit===false)return{ok:false,failure:{sourceId,reason:guard?.reason??'BRAIN_REVISION_GUARD_REJECTED'}};
    }
    const artifactId=this.#artifactId(sourceId);
    const fields=sparseFields({sourceId,lorebookId:entry.lorebookId,uid:entry.uid,revision});
    const artifact=createOwnerRetrievalArtifact({
      artifactId,
      artifactRevision:Math.max(1,Number(revision.revision)||1),
      artifactType:'LORE_SOURCE_SPARSE',
      sourceId,
      sourceRevision:String(revision.id),
      authorityClass:'SOURCE_CANON',
      truthStatusHint:CandidateTruthStatus.CURRENT,
      provenanceRefs:uniq([revision.id,revision.provenance?.sourceRevisionId]),
      dependencyInvalidators:[String(revision.id)],
      semanticKey:sourceId,
      text:String(revision.exactContent),
      metadata:{
        representationText:String(revision.exactContent),
        lorebookId:String(entry.lorebookId??revision.lorebookId??''),
        uid:String(entry.uid??revision.uid??''),
        title:revision.metadata?.title??null,
        sparseFields:fields,
        sourceAuthority:true,
        storyScoped:true,
      },
    });
    try{
      const receipt=this.lifecycle.indexArtifact(artifact,{adapterIds:[this.adapter.adapterId]});
      return{ok:true,artifactId,artifact:clone(artifact),receipt};
    }catch(error){
      return{ok:false,failure:{sourceId,reason:error?.code??error?.message??'SPARSE_INDEX_FAILED'}};
    }
  }
}
