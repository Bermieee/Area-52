import {
  KnowledgeAuthorityOrigin,
  KnowledgeSourceClass,
  KnowledgeTemporalStatus,
  createKnowledgeEvidence,
} from './knowledge-evidence.js';
import {
  CandidateFreshness,
  RetrievalChannelCapability,
  RetrievalChannelHealth,
  createChannelNomination,
  createRetrievalChannelDescriptor,
} from './candidate-bus-contracts.js';
import {stableHash} from './browser-runtime-utils.js';

const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();
const req=(value,name)=>{if(typeof value!=='string'||!value.trim())throw new TypeError(name+' must be a non-empty string');return value.trim();};
const tokenise=(value)=>[...new Set(String(value??'').toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g)??[])].filter(x=>!new Set(['the','and','for','that','with','this','from','was','were','are','what','where','when','who','why','how','into','about','your','their','have','has','had']).has(x));
const truthStatus=(evidence)=>Object.values(KnowledgeTemporalStatus).includes(evidence.temporalStatus)?evidence.temporalStatus:'UNRESOLVED';

function overlapScore(query,text){
  const q=tokenise(query),t=new Set(tokenise(text));
  if(!q.length)return 0;
  const matches=q.filter(x=>t.has(x)).length;
  return Number((matches/q.length).toFixed(6));
}

function perspectiveAllows(row,perspective){
  const scope=String(perspective?.scope??perspective?.kind??'WORLD');
  if(scope!=='CHARACTER_KNOWLEDGE')return true;
  const characterRef=perspective?.characterRef??perspective?.characterId??null;
  if(!characterRef)return false;
  if(row.publicToAll)return true;
  return row.knownBy.includes(String(characterRef));
}

function chatAllows(row,hotSnapshot){
  if(row.channelFamily!=='MEMORY')return true;
  const activeChat=hotSnapshot?.chatNamespace??null;
  if(!row.chatId||!activeChat)return true;
  return row.chatId===activeChat;
}

export class NativeKnowledgeStore{
  constructor({registry,snapshot=null,maxRecords=8192,maxHistoryPerSource=64}={}){
    if(!registry)throw new TypeError('NativeKnowledgeStore requires SourceRegistry');
    this.registry=registry;
    this.maxRecords=Math.max(64,Number(maxRecords)||8192);
    this.maxHistoryPerSource=Math.max(2,Number(maxHistoryPerSource)||64);
    this.records=new Map();
    this.currentBySource=new Map();
    this.historyBySource=new Map();
    this.sequence=0;
    if(snapshot)this.restoreState(snapshot);
  }

  admit({
    sourceId,sourceType='EXTERNAL_KNOWLEDGE',exactContent,sourceClass,authorityClass,authorityOrigin,
    temporalStatus=KnowledgeTemporalStatus.CURRENT,channelFamily=null,knownBy=[],publicToAll=null,
    chatId=null,turnId=null,generationId=null,correlationId=null,sceneRevision=null,worldRevision=null,
    claimIds=[],semantic=null,confidence=null,hardRule=false,provenanceRefs=[],dependencyRevisionRefs=[],
    artifactType='NativeExactKnowledgeEvidence',metadata={},
  }={}){
    const id=req(sourceId,'sourceId'),text=req(exactContent,'exactContent');
    const existing=this.registry.getSource(id);
    let revision,changed=false;
    if(!existing){
      revision=this.registry.importSource({id,sourceType:String(sourceType),content:text,metadata:{...clone(metadata),nativeKnowledge:true}}).revision;
      changed=true;
    }else{
      const active=this.registry.getActiveRevision(id);
      if(active.exactContent===text)revision=active;
      else{
        const replacement=this.registry.replaceSource(id,text);
        revision=replacement.revision;
        changed=replacement.changed;
      }
    }

    const family=String(channelFamily??(sourceClass===KnowledgeSourceClass.SOURCE_LORE||sourceClass===KnowledgeSourceClass.DERIVED_REPRESENTATION?'LORE':'MEMORY')).toUpperCase();
    if(!['LORE','MEMORY'].includes(family))throw new TypeError('channelFamily must be LORE or MEMORY');
    const artifactId='native-knowledge:'+revision.id;
    if(!this.registry.getArtifact(artifactId,{includeInvalid:true})){
      this.registry.registerDerivedArtifact({
        artifactId,
        artifact:{kind:'NativeExactKnowledgeArtifact',sourceId:id,sourceRevisionId:revision.id,sourceClass,channelFamily:family},
        sourceRevisionIds:[revision.id],
        activity:'PRESERVE_EXTERNAL_KNOWLEDGE',
        agent:'native-knowledge-store',
      });
    }

    const evidence=createKnowledgeEvidence({
      evidenceId:'knowledge:'+revision.id,
      artifactRef:{artifactId,artifactType,revision:revision.revision},
      sourceClass,
      authorityClass,
      authorityOrigin,
      sourceAuthorityClass:authorityOrigin===KnowledgeAuthorityOrigin.CARRIED?authorityClass:null,
      temporalStatus,
      sourceRevisionRefs:[revision.id],
      dependencyRevisionRefs:uniq(dependencyRevisionRefs),
      provenanceRefs:uniq([revision.id,...provenanceRefs]),
      confidence,
      claimIds:uniq(claimIds),
      semantic:semantic??null,
      hardRule,
      extensions:{
        nativeKnowledge:true,channelFamily:family,knownBy:uniq(knownBy),
        publicToAll:publicToAll==null?family==='LORE':Boolean(publicToAll),
        chatId:chatId==null?null:String(chatId),turnId:turnId==null?null:String(turnId),
        generationId:generationId==null?null:String(generationId),correlationId:correlationId==null?null:String(correlationId),
        originSceneRevision:sceneRevision==null?null:Number(sceneRevision),originWorldRevision:worldRevision==null?null:Number(worldRevision),
        metadata:clone(metadata),
      },
    });
    const row={
      kind:'NativeKnowledgeRecord',
      sequence:++this.sequence,
      sourceId:id,sourceRevisionId:revision.id,
      evidenceId:evidence.evidenceId,evidence,
      artifactId,channelFamily:family,
      exactContent:text,
      representationText:String(metadata.representationText??text).slice(0,12000),
      knownBy:uniq(knownBy),
      publicToAll:publicToAll==null?family==='LORE':Boolean(publicToAll),
      chatId:chatId==null?null:String(chatId),turnId:turnId==null?null:String(turnId),
      generationId:generationId==null?null:String(generationId),correlationId:correlationId==null?null:String(correlationId),
      sceneRevision:sceneRevision==null?null:Number(sceneRevision),worldRevision:worldRevision==null?null:Number(worldRevision),
      changed,
    };
    this.records.set(row.evidenceId,row);
    this.currentBySource.set(id,row.evidenceId);
    const history=this.historyBySource.get(id)??[];
    if(!history.includes(row.evidenceId))history.push(row.evidenceId);
    if(history.length>this.maxHistoryPerSource)history.splice(0,history.length-this.maxHistoryPerSource);
    this.historyBySource.set(id,history);
    this.#enforceBound();
    return clone(row);
  }

  admitLore(input={}){
    return this.admit({
      sourceClass:KnowledgeSourceClass.SOURCE_LORE,
      authorityClass:'SOURCE_CANON',
      authorityOrigin:KnowledgeAuthorityOrigin.SOURCE,
      channelFamily:'LORE',
      publicToAll:true,
      ...input,
    });
  }

  admitExperience(input={}){
    return this.admit({
      sourceClass:KnowledgeSourceClass.OBSERVED_EXPERIENCE,
      authorityClass:'OBSERVED',
      authorityOrigin:KnowledgeAuthorityOrigin.OBSERVATION,
      channelFamily:'MEMORY',
      publicToAll:false,
      ...input,
    });
  }

  admitReflection(input={}){
    return this.admit({
      sourceClass:KnowledgeSourceClass.REFLECTION,
      authorityClass:'INFERRED',
      authorityOrigin:KnowledgeAuthorityOrigin.INFERENCE,
      channelFamily:'MEMORY',
      publicToAll:false,
      ...input,
    });
  }

  correctSource(sourceId,exactContent,overrides={}){
    const current=this.currentRecordForSource(sourceId);
    if(!current)throw new Error('Unknown native knowledge source: '+sourceId);
    const evidence=current.evidence;
    return this.admit({
      sourceId,sourceType:this.registry.getSource(sourceId)?.sourceType??'EXTERNAL_KNOWLEDGE',exactContent,
      sourceClass:evidence.sourceClass,authorityClass:evidence.authorityClass,authorityOrigin:evidence.authorityOrigin,
      temporalStatus:evidence.temporalStatus,channelFamily:current.channelFamily,knownBy:current.knownBy,
      publicToAll:current.publicToAll,chatId:current.chatId,turnId:current.turnId,generationId:current.generationId,
      correlationId:current.correlationId,sceneRevision:current.sceneRevision,worldRevision:current.worldRevision,
      claimIds:evidence.claimIds,semantic:evidence.semantic,confidence:evidence.confidence,hardRule:evidence.hardRule,
      provenanceRefs:evidence.provenanceRefs,dependencyRevisionRefs:evidence.dependencyRevisionRefs,
      metadata:evidence.extensions?.metadata??{},
      ...overrides,
    });
  }

  removeSource(sourceId,{reason='NATIVE_KNOWLEDGE_REMOVED'}={}){
    const current=this.currentRecordForSource(sourceId);
    const retired=this.registry.retireSource(sourceId,{reason});
    this.currentBySource.delete(String(sourceId));
    return {kind:'NativeKnowledgeRemovalReceipt',sourceId:String(sourceId),evidenceId:current?.evidenceId??null,retired,historyPreserved:true};
  }

  evidenceById(evidenceId){
    const row=this.records.get(String(evidenceId));
    return row?clone(row.evidence):null;
  }

  evidenceForCandidate(candidate){
    const evidenceId=candidate?.metadata?.knowledgeEvidenceId??candidate?.channelNominations?.map(x=>x.metadata?.knowledgeEvidenceId).find(Boolean)??null;
    if(!evidenceId)return null;
    const row=this.records.get(String(evidenceId));
    if(!row||this.currentBySource.get(row.sourceId)!==row.evidenceId)return null;
    if(!this.registry.isActiveRevision(row.sourceRevisionId))return null;
    if(!(row.evidence.dependencyRevisionRefs??[]).every(ref=>!this.registry.getRevision(ref)||this.registry.isActiveRevision(ref)))return null;
    return clone(row.evidence);
  }

  currentRecordForSource(sourceId){
    const id=this.currentBySource.get(String(sourceId)),row=id?this.records.get(id):null;
    return row?clone(row):null;
  }

  currentRecords({channelFamily=null}={}){
    const rows=[...this.currentBySource.values()].map(id=>this.records.get(id)).filter(Boolean)
      .filter(row=>this.registry.isActiveRevision(row.sourceRevisionId))
      .filter(row=>(row.evidence.dependencyRevisionRefs??[]).every(ref=>!this.registry.getRevision(ref)||this.registry.isActiveRevision(ref)))
      .filter(row=>!channelFamily||row.channelFamily===String(channelFamily).toUpperCase())
      .sort((a,b)=>a.sequence-b.sequence);
    return rows.map(clone);
  }

  history(sourceId){
    return (this.historyBySource.get(String(sourceId))??[]).map(id=>this.records.get(id)).filter(Boolean).map(clone);
  }

  channel(channelFamily,{channelId=null,maxCandidates=64,rankBias=null}={}){
    const family=String(channelFamily).toUpperCase();
    if(!['LORE','MEMORY'].includes(family))throw new TypeError('channelFamily must be LORE or MEMORY');
    const store=this;
    const id=channelId??(family==='LORE'?'NATIVE_LORE':'NATIVE_MEMORY');
    const capabilities=family==='LORE'
      ?[RetrievalChannelCapability.SPARSE,RetrievalChannelCapability.SPECIALIZED_STORE]
      :[RetrievalChannelCapability.HISTORIAN,RetrievalChannelCapability.REFLECTION,RetrievalChannelCapability.CHARACTER_MEMORY];
    return {
      descriptor:createRetrievalChannelDescriptor({
        channelId:id,capabilities,supportedIntentKinds:['*'],maxCandidates,
        health:RetrievalChannelHealth.HEALTHY,available:true,
        metadata:{source:'NATIVE_KNOWLEDGE_STORE',channelFamily:family,externalServiceRequired:false,admissionAuthority:false},
      }),
      retrieve(intent,context={}){
        const query=String(intent?.query??context.query??'');
        const perspective=intent?.perspective??null;
        const rows=store.currentRecords({channelFamily:family})
          .filter(row=>chatAllows(row,context.hotCognitionSnapshot))
          .filter(row=>perspectiveAllows(row,perspective))
          .map(row=>({row,score:overlapScore(query,row.representationText)}))
          .filter(x=>x.score>0||tokenise(query).length===0)
          .sort((a,b)=>b.score-a.score||b.row.sequence-a.row.sequence)
          .slice(0,maxCandidates);
        const learnedBias=typeof rankBias==='function'?Number(rankBias(id))||0:0;
        return rows.map(({row,score},index)=>createChannelNomination({
          nominationId:id+':'+intent.intentId+':'+row.evidenceId,
          channelId:id,candidateId:'candidate:'+row.evidenceId,
          evidenceIdentity:'knowledge:'+row.sourceId,
          artifactRef:clone(row.evidence.artifactRef),artifactRevision:row.evidence.artifactRef?.revision??1,
          sourceRevisionRefs:[...row.evidence.sourceRevisionRefs],claimRefs:[...row.evidence.claimIds],
          entityRefs:uniq([row.evidence.semantic?.subjectId,row.evidence.semantic?.objectId]),
          retrievalIntentIds:[intent.intentId],rankSignals:{lexical:score,recency:1/(1+index),feedbackUtility:learnedBias},normalizedRank:Math.max(0,Math.min(1,(score||0.01)+learnedBias)),
          temporalHints:[{status:row.evidence.temporalStatus,originWorldRevision:row.worldRevision,originSceneRevision:row.sceneRevision}],
          authorityClass:row.evidence.authorityClass,truthStatusHint:truthStatus(row.evidence),
          provenance:row.evidence.provenanceRefs.map(ref=>({ref})),evidenceRefs:[row.evidence.evidenceId],
          dependencyRevisions:[...row.evidence.dependencyRevisionRefs],
          freshness:CandidateFreshness.FRESH,representationRef:row.evidence.evidenceId,
          representationRevision:row.evidence.artifactRef?.revision??1,representationText:row.representationText,
          metadata:{
            knowledgeEvidenceId:row.evidence.evidenceId,sourceClass:row.evidence.sourceClass,
            channelFamily:family,chatId:row.chatId,turnId:row.turnId,generationId:row.generationId,
            knownBy:[...row.knownBy],publicToAll:row.publicToAll,
            originWorldRevision:row.worldRevision,originSceneRevision:row.sceneRevision,
          },
          worldRevision:null,sceneRevision:null,
        }));
      },
    };
  }

  diagnostics(){
    return {
      kind:'NativeKnowledgeStoreDiagnostics',
      currentRecords:this.currentBySource.size,
      retainedRecords:this.records.size,
      loreRecords:this.currentRecords({channelFamily:'LORE'}).length,
      memoryRecords:this.currentRecords({channelFamily:'MEMORY'}).length,
      sourceHistoryCount:[...this.historyBySource.values()].reduce((sum,x)=>sum+x.length,0),
      maxRecords:this.maxRecords,maxHistoryPerSource:this.maxHistoryPerSource,
      externalDatabaseRequired:false,remoteModelRequired:false,
      mutationAuthority:false,settlementAuthority:false,
    };
  }

  exportState(){
    return clone({
      kind:'NativeKnowledgeStoreSnapshot',
      maxRecords:this.maxRecords,maxHistoryPerSource:this.maxHistoryPerSource,sequence:this.sequence,
      records:[...this.records.entries()],currentBySource:[...this.currentBySource.entries()],
      historyBySource:[...this.historyBySource.entries()],
    });
  }

  restoreState(snapshot){
    if(!snapshot||snapshot.kind!=='NativeKnowledgeStoreSnapshot')throw new TypeError('NativeKnowledgeStoreSnapshot is required');
    this.maxRecords=Math.max(64,Number(snapshot.maxRecords??this.maxRecords));
    this.maxHistoryPerSource=Math.max(2,Number(snapshot.maxHistoryPerSource??this.maxHistoryPerSource));
    this.sequence=Number(snapshot.sequence??0);
    this.records=new Map(clone(snapshot.records??[]));
    this.currentBySource=new Map(clone(snapshot.currentBySource??[]));
    this.historyBySource=new Map(clone(snapshot.historyBySource??[]));
    for(const [sourceId,evidenceId] of [...this.currentBySource]){
      const row=this.records.get(evidenceId);
      if(!row||!this.registry.getRevision(row.sourceRevisionId)||!this.registry.isActiveRevision(row.sourceRevisionId))this.currentBySource.delete(sourceId);
    }
    this.#enforceBound();
    return this.exportState();
  }

  #enforceBound(){
    if(this.records.size<=this.maxRecords)return;
    const current=new Set(this.currentBySource.values());
    const removable=[...this.records.values()].filter(row=>!current.has(row.evidenceId)).sort((a,b)=>a.sequence-b.sequence);
    while(this.records.size>this.maxRecords&&removable.length){
      const row=removable.shift();this.records.delete(row.evidenceId);
      const history=this.historyBySource.get(row.sourceId)??[];
      this.historyBySource.set(row.sourceId,history.filter(id=>id!==row.evidenceId));
    }
  }
}

export const NATIVE_KNOWLEDGE_CHANNELS=Object.freeze({LORE:'NATIVE_LORE',MEMORY:'NATIVE_MEMORY'});
