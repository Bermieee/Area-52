import {
  CandidateFreshness,CandidateTruthStatus,RetrievalChannelCapability,RetrievalChannelHealth,
  createChannelNomination,createRetrievalChannelDescriptor,
} from './candidate-bus-contracts.js';
import {HotSegmentKind,HotFreshness} from './hot-cognition-contracts.js';
import {RetrievalIndexFamily} from './retrieval-index-contracts.js';

const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
const boundedText=(v,max=1200)=>String(v??'').slice(0,max);
const norm=(score)=>{const n=Number(score)||0;return Math.max(0,Math.min(1,n/(1+Math.abs(n))));};
function claimSourceRefs(claim){return uniq(claim?.provenance?.sourceRevisionIds??[]);}
function claimArtifactRef(claim){return{artifactId:claim.id,artifactType:'Claim',revision:1};}

export class CoreClaimRetrievalChannel{
  constructor({channelId,mode,retrieval,capability,supportedIntentKinds=['GENERAL','CURRENT','HISTORICAL','TEMPORAL','CONTRADICTION'],maxCandidates=64}={}){
    this.channelId=channelId;this.mode=mode;this.retrieval=retrieval;
    this.descriptor=createRetrievalChannelDescriptor({channelId,capabilities:[capability],supportedIntentKinds,maxCandidates,health:RetrievalChannelHealth.HEALTHY,available:true,metadata:{compatibilityChannel:true,graphWalkerOwner:false}});
  }
  retrieve(intent,context={}){
    const query=intent.query??context.query??'',anchors=uniq(context.anchorEntityIds??intent.entityRefs??[]);
    let rows=[];
    if(this.mode==='SPARSE')rows=this.retrieval.exact(query);
    else if(this.mode==='DENSE')rows=this.retrieval.semantic(query);
    else if(this.mode==='GRAPH')rows=this.retrieval.graphNeighborhood(anchors);
    else if(this.mode==='TEMPORAL')rows=['HISTORICAL','TEMPORAL'].includes(intent.intentKind)?this.retrieval.temporal(anchors):[];
    else if(this.mode==='CONFLICT')rows=['CURRENT','TEMPORAL','CONTRADICTION'].includes(intent.intentKind)?this.retrieval.conflicts(anchors):[];
    return rows.slice(0,this.descriptor.maxCandidates).map(({claim,score},index)=>{
      const legacyLabel={SPARSE:'exact',DENSE:'semantic',GRAPH:'graph',TEMPORAL:'temporal',CONFLICT:'conflict'}[this.mode]??this.mode.toLowerCase();
      const raw={},metadata={mode:this.mode,compatibilityChannel:true,legacyRetrievalIntent:legacyLabel};
      let graphMetadata=null;
      if(this.mode==='SPARSE')Object.assign(raw,{bm25Score:score,sparse:score});
      if(this.mode==='DENSE')Object.assign(raw,{semanticSimilarity:score,dense:score});
      if(this.mode==='GRAPH'){Object.assign(raw,{graphDistance:1});graphMetadata={graphProvider:'CORE_TEMPORAL_GRAPH_COMPAT',distance:1,path:uniq([...anchors,claim.id]),edgeTypes:['CLAIM_NEIGHBOR']};}
      if(this.mode==='TEMPORAL')Object.assign(raw,{temporalFit:score,temporal:score});
      if(this.mode==='CONFLICT')Object.assign(raw,{conflictRelevance:score,conflict:score});
      return createChannelNomination({
        nominationId:this.channelId+':'+intent.intentId+':'+claim.id,channelId:this.channelId,candidateId:'candidate:'+claim.id,
        evidenceIdentity:'claim:'+claim.id,artifactRef:claimArtifactRef(claim),artifactRevision:1,sourceRevisionRefs:claimSourceRefs(claim),
        claimRefs:[claim.id],entityRefs:uniq([claim.subjectId,typeof claim.value==='string'?claim.value:null]),
        retrievalIntentIds:[intent.intentId],rankSignals:raw,normalizedRank:Math.max(0,Math.min(1,norm(score)-index*.000001)),
        graphMetadata,temporalHints:[{status:claim.status??CandidateTruthStatus.UNRESOLVED,temporal:clone(claim.temporal??null)}],
        authorityClass:claim.authorityClass??'UNKNOWN',truthStatusHint:claim.status??CandidateTruthStatus.UNRESOLVED,
        provenance:[claim.provenance??{ref:claim.id}],evidenceRefs:[claim.id],dependencyRevisions:claimSourceRefs(claim),
        freshness:CandidateFreshness.FRESH,representationRef:claim.id,representationRevision:1,
        representationText:boundedText(claim.subjectId+' '+claim.predicate+' '+String(claim.value)+' '+String(claim.status??'')),
        metadata,worldRevision:context.worldRevision??null,sceneRevision:context.sceneRevision??null,
      });
    });
  }
}

export class ActiveContinuityRetrievalChannel{
  constructor({hotCognition,maxCandidates=48}={}){
    this.hotCognition=hotCognition;
    this.descriptor=createRetrievalChannelDescriptor({
      channelId:'ACTIVE_CONTINUITY',capabilities:[RetrievalChannelCapability.ACTIVE_CONTINUITY],
      supportedIntentKinds:['*'],maxCandidates,health:RetrievalChannelHealth.HEALTHY,available:true,
      metadata:{source:'HOT_COGNITION',workingStateOnly:true,canonicalTruth:false},
    });
  }
  retrieve(intent,context={}){
    const snapshot=context.hotCognitionSnapshot??this.hotCognition?.snapshot?.();if(!snapshot)return[];
    const out=[],push=(input)=>{if(out.length<this.descriptor.maxCandidates)out.push(createChannelNomination(input));};
    const make=(segmentKind,suffix,value,{authorityClass='UNRESOLVED',truthStatusHint=CandidateTruthStatus.UNKNOWN,rank=.9,continuitySignals=[]}={})=>{
      const segment=snapshot.segments?.[segmentKind];if(!segment||segment.freshness!==HotFreshness.FRESH||value==null)return;
      push({
        nominationId:'ACTIVE_CONTINUITY:'+intent.intentId+':'+suffix,channelId:'ACTIVE_CONTINUITY',
        candidateId:'continuity:'+snapshot.stateId+':'+suffix,evidenceIdentity:'continuity:'+snapshot.chatNamespace+':'+suffix,
        artifactRef:{artifactId:snapshot.stateId,artifactType:'HotCognitionSnapshot',revision:snapshot.hotRevision},artifactRevision:snapshot.hotRevision,
        sourceRevisionRefs:segment.sourceRevisionRefs??[],entityRefs:[],retrievalIntentIds:[intent.intentId],
        rankSignals:{sceneRelevance:rank,activeContinuity:rank},normalizedRank:rank,temporalHints:[{status:truthStatusHint}],
        continuitySignals,authorityClass,truthStatusHint,provenance:(segment.provenanceRefs??[]).map(ref=>({ref})),
        evidenceRefs:segment.provenanceRefs??[],dependencyRevisions:segment.dependencyRevisionRefs??[],
        freshness:CandidateFreshness.FRESH,representationRef:snapshot.stateId+':'+segmentKind,representationRevision:segment.revision,
        representationText:boundedText(typeof value==='string'?value:JSON.stringify(value),800),
        metadata:{hotCognitionSnapshotId:snapshot.snapshotId,hotRevision:snapshot.hotRevision,segmentKind,workingStateOnly:true},
        worldRevision:snapshot.worldRevision,sceneRevision:snapshot.sceneRevision,
      });
    };
    const loc=snapshot.segments?.[HotSegmentKind.LOCATION];if(loc?.value)make(HotSegmentKind.LOCATION,'location',loc.value,{authorityClass:loc.authorityClass,truthStatusHint:CandidateTruthStatus.CURRENT,rank:.98,continuitySignals:[{type:'ACTIVE_LOCATION'}]});
    for(const row of snapshot.segments?.[HotSegmentKind.ACTIVE_CAST]?.value??[])make(HotSegmentKind.ACTIVE_CAST,'cast:'+row.id,row,{authorityClass:row.authorityClass??snapshot.segments[HotSegmentKind.ACTIVE_CAST].authorityClass,truthStatusHint:CandidateTruthStatus.CURRENT,rank:.97,continuitySignals:[{type:'ACTIVE_CAST',entityRef:row.id}]});
    for(const row of snapshot.segments?.[HotSegmentKind.ACTIVE_ENTITIES]?.value??[])make(HotSegmentKind.ACTIVE_ENTITIES,'entity:'+row.id,row,{authorityClass:row.authorityClass??snapshot.segments[HotSegmentKind.ACTIVE_ENTITIES].authorityClass,truthStatusHint:CandidateTruthStatus.CURRENT,rank:.94,continuitySignals:[{type:'ACTIVE_ENTITY',entityRef:row.id}]});
    for(const row of snapshot.segments?.[HotSegmentKind.ACTIVE_THREADS]?.value??[])make(HotSegmentKind.ACTIVE_THREADS,'thread:'+row.threadId,row,{authorityClass:row.authorityClass??'UNRESOLVED',truthStatusHint:CandidateTruthStatus.UNRESOLVED,rank:.96,continuitySignals:[{type:'ACTIVE_THREAD',threadId:row.threadId}]});
    for(const row of snapshot.segments?.[HotSegmentKind.RECENT_EPISODE_TAIL]?.value??[])make(HotSegmentKind.RECENT_EPISODE_TAIL,'episode:'+String(row.refId??row.sourceRevisionId),row,{authorityClass:'OBSERVED',truthStatusHint:CandidateTruthStatus.HISTORICAL,rank:.75,continuitySignals:[{type:'RECENT_EPISODE'}]});
    const graph=snapshot.segments?.[HotSegmentKind.GRAPH_NEIGHBORHOOD]?.value;if(graph?.state==='AVAILABLE')for(const ref of graph.refs??[])make(HotSegmentKind.GRAPH_NEIGHBORHOOD,'graph:'+ref,{ref},{authorityClass:'UNRESOLVED',truthStatusHint:CandidateTruthStatus.UNKNOWN,rank:.7,continuitySignals:[{type:'ACTIVE_GRAPH_REF',ref}]});
    return out;
  }
}

export class IndexRetrievalChannelProvider{
  constructor({channelId,lifecycle,adapterId,capability=null,supportedIntentKinds=['*'],maxCandidates=64}={}){
    this.channelId=channelId;this.lifecycle=lifecycle;this.adapterId=adapterId;
    const adapter=lifecycle?.adapters?.get?.(adapterId);if(!adapter)throw new TypeError('IndexRetrievalChannelProvider requires registered adapter '+adapterId);
    const inferred=adapter.indexFamily===RetrievalIndexFamily.SPARSE?RetrievalChannelCapability.SPARSE:
      adapter.indexFamily===RetrievalIndexFamily.DENSE?RetrievalChannelCapability.DENSE:
      adapter.indexFamily===RetrievalIndexFamily.LATE_INTERACTION?RetrievalChannelCapability.LATE_INTERACTION:RetrievalChannelCapability.SPECIALIZED_STORE;
    this.descriptor=createRetrievalChannelDescriptor({channelId,capabilities:[capability??inferred],supportedIntentKinds,maxCandidates,health:RetrievalChannelHealth.HEALTHY,available:true,metadata:{adapterId,indexFamily:adapter.indexFamily,indexVersion:adapter.indexVersion}});
  }
  retrieve(intent,context={}){
    const rows=this.lifecycle.queryAdapter(this.adapterId,{query:intent.query??context.query??'',limit:this.descriptor.maxCandidates,currentOwnerArtifacts:context.currentOwnerArtifacts??null});
    const max=Math.max(...rows.map(x=>Number(x.score)||0),0),min=Math.min(...rows.map(x=>Number(x.score)||0),0),span=max-min||1;
    return rows.map((row,index)=>{
      const rep=row.representation,normalized=rows.length===1?1:Math.max(0,Math.min(1,(Number(row.score)-min)/span));
      return createChannelNomination({
        nominationId:this.channelId+':'+intent.intentId+':'+rep.representationId,channelId:this.channelId,
        candidateId:'candidate:'+rep.ownerArtifactId+':'+(rep.semanticKey??rep.claimRefs?.[0]??rep.eventRefs?.[0]??rep.representationId),
        artifactRef:{artifactId:rep.ownerArtifactId,artifactType:rep.metadata?.artifactType??'UNKNOWN',revision:rep.ownerArtifactRevision},
        artifactRevision:rep.ownerArtifactRevision,sourceRevisionRefs:[rep.sourceRevision],claimRefs:rep.claimRefs,eventRefs:rep.eventRefs,
        entityRefs:rep.entityRefs,relationshipRefs:rep.relationshipRefs,retrievalIntentIds:[intent.intentId],
        rankSignals:row.rankSignals,normalizedRank:normalized,authorityClass:rep.authorityClass,truthStatusHint:rep.truthStatusHint,
        provenance:rep.provenanceRefs.map(ref=>({ref})),evidenceRefs:rep.provenanceRefs,dependencyRevisions:rep.dependencyInvalidators,
        freshness:row.freshness===CandidateFreshness.FRESH?CandidateFreshness.FRESH:CandidateFreshness.STALE,
        representationRef:rep.representationId,representationRevision:rep.representationRevision,representationText:rep.representationText,
        metadata:{adapterId:this.adapterId,indexFamily:rep.indexFamily,indexVersion:rep.indexVersion,residencyState:rep.residencyState,retrievalReason:row.reason},
        worldRevision:context.worldRevision??null,sceneRevision:context.sceneRevision??null,
      });
    });
  }
}
