import {MinimalRetrieval} from './retrieval.js';
import {CandidateBus} from './candidate-bus.js';
import {RetrievalChannelRegistry} from './retrieval-channel-registry.js';
import {RetrievalIndexLifecycleManager} from './retrieval-index-lifecycle.js';
import {createRetrievalIntent,CandidateFreshness,RetrievalChannelCapability} from './candidate-bus-contracts.js';
import {CoreClaimRetrievalChannel,ActiveContinuityRetrievalChannel,IndexRetrievalChannelProvider,DeclaredCapabilityChannel} from './sensory-net-channels.js';
import {NativeGraphNeighborhoodRetriever} from './graph-neighborhood-retriever.js';
import {stableHash} from './browser-runtime-utils.js';

const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
function frozen(v){const c=clone(v);const f=(x)=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){for(const y of Object.values(x))f(y);Object.freeze(x);}return x;};return f(c);}

export class SensoryNetBackbone{
  constructor({graph,sourceRegistry,hotCognition,entityRegistry=null,candidateBus=null,channelRegistry=null,indexLifecycle=null,isSourceRevisionCurrent=null,externalRevisionSink=null,graphLimits={}}={}){
    this.graph=graph;this.sourceRegistry=sourceRegistry;this.hotCognition=hotCognition;this.entityRegistry=entityRegistry;
    this.isSourceRevisionCurrent=typeof isSourceRevisionCurrent==='function'?isSourceRevisionCurrent:(ref)=>sourceRegistry?.getRevision?.(ref)?sourceRegistry.isActiveRevision(ref):true;
    this.externalRevisionSink=typeof externalRevisionSink==='function'?externalRevisionSink:()=>{};
    this.legacyRetrieval=new MinimalRetrieval({graph});
    this.candidateBus=candidateBus??new CandidateBus({isSourceRevisionCurrent:(ref)=>this.isSourceRevisionCurrent(ref),isIdentityRevisionCurrent:(ref)=>this.entityRegistry?.isCurrentRevisionRef?.(ref)??true});
    this.channelRegistry=channelRegistry??new RetrievalChannelRegistry();
    this.indexLifecycle=indexLifecycle??new RetrievalIndexLifecycleManager();
    this.graphEvidence=new Map();
    this.graphWalker=new NativeGraphNeighborhoodRetriever({
      temporalGraph:this.graph,entityRegistry:this.entityRegistry,sceneSnapshot:()=>this.hotCognition?.snapshot?.()??null,
      isSourceRevisionCurrent:(ref)=>this.isSourceRevisionCurrent(ref),limits:graphLimits,
      evidenceSink:(evidence)=>{if(evidence?.evidenceId)this.graphEvidence.set(String(evidence.evidenceId),clone(evidence));},
    });
    this.lastEnvelope=null;this.#registerCoreChannels();
  }

  #registerCoreChannels(){
    const channels=[
      new CoreClaimRetrievalChannel({channelId:'CORE_SPARSE',mode:'SPARSE',retrieval:this.legacyRetrieval,capability:RetrievalChannelCapability.SPARSE}),
      new CoreClaimRetrievalChannel({channelId:'CORE_DENSE',mode:'DENSE',retrieval:this.legacyRetrieval,capability:RetrievalChannelCapability.DENSE}),
      this.graphWalker,
      new CoreClaimRetrievalChannel({channelId:'CORE_TEMPORAL',mode:'TEMPORAL',retrieval:this.legacyRetrieval,capability:RetrievalChannelCapability.WORLD_STATE}),
      new CoreClaimRetrievalChannel({channelId:'CORE_CONFLICT',mode:'CONFLICT',retrieval:this.legacyRetrieval,capability:RetrievalChannelCapability.SPECIALIZED_STORE}),
      new ActiveContinuityRetrievalChannel({hotCognition:this.hotCognition,entityRegistry:this.entityRegistry}),
      new DeclaredCapabilityChannel({channelId:'DENSE_EMBEDDINGS',capability:RetrievalChannelCapability.DENSE,fallbackChannelIds:['CORE_DENSE','CORE_SPARSE'],reason:'NO_NATIVE_EMBEDDING_PROVIDER_CONFIGURED'}),
      new DeclaredCapabilityChannel({channelId:'LATE_INTERACTION',capability:RetrievalChannelCapability.LATE_INTERACTION,fallbackChannelIds:['CORE_SPARSE'],reason:'NO_NATIVE_LATE_INTERACTION_PROVIDER_CONFIGURED'}),
      new DeclaredCapabilityChannel({channelId:'HIERARCHY_RAPTOR',capability:RetrievalChannelCapability.RAPTOR,fallbackChannelIds:['NATIVE_LORE','OWNER_LORE'],reason:'NO_HIERARCHICAL_INDEX_PROVIDER_CONFIGURED'}),
      new DeclaredCapabilityChannel({channelId:'GRAPHRAG_COMMUNITY',capability:RetrievalChannelCapability.GRAPHRAG_COMMUNITY,fallbackChannelIds:['ZZ_NATIVE_GRAPH_WALKER'],reason:'NO_COMMUNITY_INDEX_PROVIDER_CONFIGURED'}),
    ];
    for(const channel of channels)if(!this.channelRegistry.lookup(channel.descriptor.channelId))this.channelRegistry.register(channel);
  }

  registerChannel(provider){return this.channelRegistry.register(provider);}
  unregisterChannel(channelId){return this.channelRegistry.unregister(channelId);}
  registerGraphProvider(options){return this.graphWalker.registerProvider(options);}
  unregisterGraphProvider(providerId){return this.graphWalker.unregisterProvider(providerId);}
  graphProviderInterfaceContract(){return this.graphWalker.ownerInterfaceContract();}
  graphWalkerDiagnostics(){return this.graphWalker.diagnostics();}
  resolveKnowledgeEvidence(candidate){
    const evidenceId=candidate?.metadata?.knowledgeEvidenceId??candidate?.channelNominations?.map(row=>row?.metadata?.knowledgeEvidenceId).find(Boolean)??null;
    return evidenceId&&this.graphEvidence.has(String(evidenceId))?clone(this.graphEvidence.get(String(evidenceId))):null;
  }
  registerIndexChannel({adapter,channelId=null,supportedIntentKinds=['*'],maxCandidates=64}={}){
    if(!this.indexLifecycle.adapters.has(adapter.adapterId))this.indexLifecycle.registerAdapter(adapter);
    const id=channelId??('INDEX_'+adapter.indexFamily+'_'+adapter.adapterId);
    const provider=new IndexRetrievalChannelProvider({channelId:id,lifecycle:this.indexLifecycle,adapterId:adapter.adapterId,supportedIntentKinds,maxCandidates});
    return this.channelRegistry.register(provider);
  }

  retrieveEnvelope(query,{intent='CURRENT',retrievalIntents=null,anchorEntityIds=[],worldRevision=this.graph?.revision??0,sceneRevision=0,channelIds=null,currentOwnerArtifacts=null,metadata={},candidateBudget=64,latencyBudgetMs=100,graphTraversal=null}={}){
    const intents=(retrievalIntents?.length?retrievalIntents:[{intentId:'intent:'+stableHash({query,intent,anchorEntityIds},{length:16}),kind:intent,query,entityRefs:anchorEntityIds}])
      .map((row,index)=>row?.kind==='RetrievalIntent'?row:createRetrievalIntent({
        intentId:row.intentId??row.id??('intent:'+index+':'+stableHash(row,{length:12})),kind:row.kind??row.intentKind??intent,
        query:row.query??query,entityRefs:row.entityRefs??anchorEntityIds,relationshipRefs:row.relationshipRefs??[],eventRefs:row.eventRefs??[],
        artifactRefs:row.artifactRefs??[],temporalConstraint:row.temporalConstraint??null,perspective:row.perspective??null,
        metadata:{...(row.metadata??{}),...(graphTraversal?{graphTraversal}: {})},
      }));
    const localSourceRevisionSet=this.sourceRegistry?.activeRevisionIds?.()??[];
    const context={query,anchorEntityIds:uniq(anchorEntityIds),worldRevision,sceneRevision,sourceRevisionSet:localSourceRevisionSet,currentOwnerArtifacts,hotCognitionSnapshot:this.hotCognition?.snapshot?.()??null,latencyBudgetMs,graphTraversal};
    const scatter=this.channelRegistry.retrieveAllSync({intents,context,channelIds});
    const graphChannelReceipt=scatter.channelReceipts?.find(row=>row.channelId==='ZZ_NATIVE_GRAPH_WALKER')??null;
    const graphExecuted=Boolean(graphChannelReceipt&&graphChannelReceipt.status!=='SKIPPED_LATENCY_BUDGET'&&graphChannelReceipt.status!=='UNAVAILABLE'&&graphChannelReceipt.status!=='ERROR');
    const graphReceipt=graphExecuted?clone(this.graphWalker?.lastReceipt??null):null;
    const graphRevisionRefs=graphReceipt?.trustedSourceRevisionRefs??[];
    const ownerRevisionRefs=uniq([...this.#trustedOwnerRevisionRefs(scatter.nominations),...graphRevisionRefs]);
    if(this.#ownerChannelsExecuted(scatter.channelReceipts)||graphRevisionRefs.length)this.externalRevisionSink(ownerRevisionRefs);
    const sourceRevisionSet=uniq([...localSourceRevisionSet,...ownerRevisionRefs]);
    const envelope=this.candidateBus.fuse({
      nominations:scatter.nominations,retrievalIntents:intents,query,currentRevisionSet:{sourceRevisionSet,worldRevision,sceneRevision},
      unavailableChannels:scatter.unavailableChannels,degradedChannels:scatter.degradedChannels,candidateLimit:candidateBudget,
      metadata:{...metadata,channelReceipts:scatter.channelReceipts,channelErrors:scatter.errors,retrievalBudgetReceipt:scatter.budgetReceipt??null,graphTraversalReceipt:graphReceipt},
    });
    this.#warmGraphNeighborhood(envelope,graphReceipt);
    this.lastEnvelope=envelope;return envelope;
  }

  async retrieveEnvelopeAsync(query,{intent='CURRENT',retrievalIntents=null,anchorEntityIds=[],worldRevision=this.graph?.revision??0,sceneRevision=0,channelIds=null,currentOwnerArtifacts=null,metadata={},candidateBudget=64,latencyBudgetMs=100,graphTraversal=null}={}){
    const intents=(retrievalIntents?.length?retrievalIntents:[{intentId:'intent:'+stableHash({query,intent,anchorEntityIds},{length:16}),kind:intent,query,entityRefs:anchorEntityIds}])
      .map((row,index)=>row?.kind==='RetrievalIntent'?row:createRetrievalIntent({
        intentId:row.intentId??row.id??('intent:'+index+':'+stableHash(row,{length:12})),kind:row.kind??row.intentKind??intent,
        query:row.query??query,entityRefs:row.entityRefs??anchorEntityIds,relationshipRefs:row.relationshipRefs??[],eventRefs:row.eventRefs??[],artifactRefs:row.artifactRefs??[],
        temporalConstraint:row.temporalConstraint??null,perspective:row.perspective??null,metadata:{...(row.metadata??{}),...(graphTraversal?{graphTraversal}: {})},
      }));
    const localSourceRevisionSet=this.sourceRegistry?.activeRevisionIds?.()??[];
    const context={query,anchorEntityIds:uniq(anchorEntityIds),worldRevision,sceneRevision,sourceRevisionSet:localSourceRevisionSet,currentOwnerArtifacts,hotCognitionSnapshot:this.hotCognition?.snapshot?.()??null,latencyBudgetMs,graphTraversal};
    const scatter=await this.channelRegistry.retrieveAll({intents,context,channelIds});
    const graphChannelReceipt=scatter.channelReceipts?.find(row=>row.channelId==='ZZ_NATIVE_GRAPH_WALKER')??null;
    const graphExecuted=Boolean(graphChannelReceipt&&graphChannelReceipt.status!=='SKIPPED_LATENCY_BUDGET'&&graphChannelReceipt.status!=='UNAVAILABLE'&&graphChannelReceipt.status!=='ERROR');
    const graphReceipt=graphExecuted?clone(this.graphWalker?.lastReceipt??null):null;
    const graphRevisionRefs=graphReceipt?.trustedSourceRevisionRefs??[];
    const ownerRevisionRefs=uniq([...this.#trustedOwnerRevisionRefs(scatter.nominations),...graphRevisionRefs]);
    if(this.#ownerChannelsExecuted(scatter.channelReceipts)||graphRevisionRefs.length)this.externalRevisionSink(ownerRevisionRefs);
    const sourceRevisionSet=uniq([...localSourceRevisionSet,...ownerRevisionRefs]);
    const envelope=this.candidateBus.fuse({nominations:scatter.nominations,retrievalIntents:intents,query,currentRevisionSet:{sourceRevisionSet,worldRevision,sceneRevision},unavailableChannels:scatter.unavailableChannels,degradedChannels:scatter.degradedChannels,candidateLimit:candidateBudget,metadata:{...metadata,channelReceipts:scatter.channelReceipts,channelErrors:scatter.errors,retrievalBudgetReceipt:scatter.budgetReceipt??null,graphTraversalReceipt:graphReceipt}});
    this.#warmGraphNeighborhood(envelope,graphReceipt);
    this.lastEnvelope=envelope;return envelope;
  }

  retrieve(query,options={}){
    const envelope=this.retrieveEnvelope(query,options);
    return envelope.candidates.filter(candidate=>candidate.freshness===CandidateFreshness.FRESH);
  }

  continuityOnly(query,options={}){
    return this.retrieveEnvelope(query,{...options,channelIds:['ACTIVE_CONTINUITY']});
  }

  manifest(){return this.channelRegistry.manifest();}
  diagnostics(){return frozen({kind:'SensoryNetDiagnostics',candidateBus:this.candidateBus.diagnostics(),channels:this.channelRegistry.manifest(),indexLifecycle:this.indexLifecycle.lifecycleDiagnostics(),graphWalker:this.graphWalker.diagnostics(),lastFusionReceipt:clone(this.lastEnvelope?.fusionReceipt??null),lastRetrievalBudgetReceipt:clone(this.lastEnvelope?.metadata?.retrievalBudgetReceipt??null),retainsCandidatePayloadHistory:false,readOnly:true,mutationAuthority:false});}

  #warmGraphNeighborhood(envelope,graphReceipt){
    if(!graphReceipt||!this.hotCognition?.hasActiveChat)return null;
    const rows=(envelope?.candidates??[]).filter(candidate=>candidate?.freshness===CandidateFreshness.FRESH&&(candidate?.graphMetadata??[]).length);
    const prior=this.hotCognition?.snapshot?.()?.segments?.GRAPH_NEIGHBORHOOD??null;
    const mergePrior=Boolean(prior?.freshness==='FRESH'&&prior?.value?.state==='AVAILABLE'&&!(graphReceipt?.staleRejectedCount>0));
    const refs=uniq([
      ...(mergePrior?(prior?.value?.refs??[]):[]),
      ...rows.flatMap(candidate=>(candidate.graphMetadata??[]).map(meta=>String(meta.graphProvider??'GRAPH')+'|'+String(meta.edgeId??meta.representationRef??candidate.candidateId))),
      ...(graphReceipt?.hotNeighborhoodRefs??[]),
    ]);
    const sourceRevisionRefs=uniq([
      ...(mergePrior?(prior?.sourceRevisionRefs??[]):[]),
      ...rows.flatMap(candidate=>candidate.sourceRevisionRefs??[]),
      ...(graphReceipt?.hotNeighborhoodSourceRevisionRefs??[]),
    ]);
    const identityRevisionRefs=uniq([
      ...rows.flatMap(candidate=>candidate.identityRevisionRefs??[]),
      ...(graphReceipt?.hotNeighborhoodIdentityRevisionRefs??[]),
    ]);
    const dependencyRevisionRefs=uniq([
      ...(mergePrior?(prior?.dependencyRevisionRefs??[]):[]),
      ...(graphReceipt?.hotNeighborhoodDependencyRevisionRefs??[]),
    ]);
    const provenanceRefs=uniq(rows.flatMap(candidate=>[
      ...((candidate.provenance??[]).map(item=>item?.ref).filter(Boolean)),
      ...(candidate.evidenceRefs??[]),
    ]));
    const degraded=(graphReceipt.providers??[]).some(row=>row?.status==='DEGRADED');
    return this.hotCognition.setGraphNeighborhood({
      state:refs.length||!degraded?'AVAILABLE':'DEGRADED',refs,sourceRevisionRefs,identityRevisionRefs,dependencyRevisionRefs,provenanceRefs,
      updateId:'graph-warm:'+stableHash({candidateSetId:envelope?.candidateSetId??null,worldRevision:envelope?.worldRevision??null,sceneRevision:envelope?.sceneRevision??null,refs},{length:20}),
    });
  }

  #ownerChannelsExecuted(receipts=[]){
    return (receipts??[]).some((receipt)=>this.channelRegistry.lookup(receipt?.channelId)?.descriptor?.metadata?.ownerRevisionFence===true);
  }

  #trustedOwnerRevisionRefs(nominations=[]){
    const refs=[];
    for(const nomination of nominations??[]){
      const descriptor=this.channelRegistry.lookup(nomination?.channelId)?.descriptor;
      if(descriptor?.metadata?.ownerRevisionFence!==true)continue;
      refs.push(...(nomination?.sourceRevisionRefs??[]));
    }
    return uniq(refs);
  }
}
