import {MinimalRetrieval} from './retrieval.js';
import {CandidateBus} from './candidate-bus.js';
import {RetrievalChannelRegistry} from './retrieval-channel-registry.js';
import {RetrievalIndexLifecycleManager} from './retrieval-index-lifecycle.js';
import {createRetrievalIntent,CandidateFreshness,RetrievalChannelCapability} from './candidate-bus-contracts.js';
import {CoreClaimRetrievalChannel,ActiveContinuityRetrievalChannel,IndexRetrievalChannelProvider} from './sensory-net-channels.js';
import {stableHash} from './browser-runtime-utils.js';

const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
function frozen(v){const c=clone(v);const f=(x)=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){for(const y of Object.values(x))f(y);Object.freeze(x);}return x;};return f(c);}

export class SensoryNetBackbone{
  constructor({graph,sourceRegistry,hotCognition,candidateBus=null,channelRegistry=null,indexLifecycle=null,isSourceRevisionCurrent=null,externalRevisionSink=null}={}){
    this.graph=graph;this.sourceRegistry=sourceRegistry;this.hotCognition=hotCognition;
    this.isSourceRevisionCurrent=typeof isSourceRevisionCurrent==='function'?isSourceRevisionCurrent:(ref)=>sourceRegistry?.getRevision?.(ref)?sourceRegistry.isActiveRevision(ref):true;
    this.externalRevisionSink=typeof externalRevisionSink==='function'?externalRevisionSink:()=>{};
    this.legacyRetrieval=new MinimalRetrieval({graph});
    this.candidateBus=candidateBus??new CandidateBus({isSourceRevisionCurrent:(ref)=>this.isSourceRevisionCurrent(ref)});
    this.channelRegistry=channelRegistry??new RetrievalChannelRegistry();
    this.indexLifecycle=indexLifecycle??new RetrievalIndexLifecycleManager();
    this.lastEnvelope=null;this.#registerCoreChannels();
  }

  #registerCoreChannels(){
    const channels=[
      new CoreClaimRetrievalChannel({channelId:'CORE_SPARSE',mode:'SPARSE',retrieval:this.legacyRetrieval,capability:RetrievalChannelCapability.SPARSE}),
      new CoreClaimRetrievalChannel({channelId:'CORE_DENSE',mode:'DENSE',retrieval:this.legacyRetrieval,capability:RetrievalChannelCapability.DENSE}),
      new CoreClaimRetrievalChannel({channelId:'CORE_GRAPH_COMPAT',mode:'GRAPH',retrieval:this.legacyRetrieval,capability:RetrievalChannelCapability.GRAPH}),
      new CoreClaimRetrievalChannel({channelId:'CORE_TEMPORAL',mode:'TEMPORAL',retrieval:this.legacyRetrieval,capability:RetrievalChannelCapability.WORLD_STATE}),
      new CoreClaimRetrievalChannel({channelId:'CORE_CONFLICT',mode:'CONFLICT',retrieval:this.legacyRetrieval,capability:RetrievalChannelCapability.SPECIALIZED_STORE}),
      new ActiveContinuityRetrievalChannel({hotCognition:this.hotCognition}),
    ];
    for(const channel of channels)if(!this.channelRegistry.lookup(channel.descriptor.channelId))this.channelRegistry.register(channel);
  }

  registerChannel(provider){return this.channelRegistry.register(provider);}
  unregisterChannel(channelId){return this.channelRegistry.unregister(channelId);}
  registerIndexChannel({adapter,channelId=null,supportedIntentKinds=['*'],maxCandidates=64}={}){
    if(!this.indexLifecycle.adapters.has(adapter.adapterId))this.indexLifecycle.registerAdapter(adapter);
    const id=channelId??('INDEX_'+adapter.indexFamily+'_'+adapter.adapterId);
    const provider=new IndexRetrievalChannelProvider({channelId:id,lifecycle:this.indexLifecycle,adapterId:adapter.adapterId,supportedIntentKinds,maxCandidates});
    return this.channelRegistry.register(provider);
  }

  retrieveEnvelope(query,{intent='CURRENT',retrievalIntents=null,anchorEntityIds=[],worldRevision=this.graph?.revision??0,sceneRevision=0,channelIds=null,currentOwnerArtifacts=null,metadata={}}={}){
    const intents=(retrievalIntents?.length?retrievalIntents:[{intentId:'intent:'+stableHash({query,intent,anchorEntityIds},{length:16}),kind:intent,query,entityRefs:anchorEntityIds}])
      .map((row,index)=>row?.kind==='RetrievalIntent'?row:createRetrievalIntent({
        intentId:row.intentId??row.id??('intent:'+index+':'+stableHash(row,{length:12})),kind:row.kind??row.intentKind??intent,
        query:row.query??query,entityRefs:row.entityRefs??anchorEntityIds,relationshipRefs:row.relationshipRefs??[],eventRefs:row.eventRefs??[],
        artifactRefs:row.artifactRefs??[],temporalConstraint:row.temporalConstraint??null,perspective:row.perspective??null,metadata:row.metadata??{},
      }));
    const localSourceRevisionSet=this.sourceRegistry?.activeRevisionIds?.()??[];
    const context={query,anchorEntityIds:uniq(anchorEntityIds),worldRevision,sceneRevision,sourceRevisionSet:localSourceRevisionSet,currentOwnerArtifacts,hotCognitionSnapshot:this.hotCognition?.snapshot?.()??null};
    const scatter=this.channelRegistry.retrieveAllSync({intents,context,channelIds});
    const ownerRevisionRefs=this.#trustedOwnerRevisionRefs(scatter.nominations);this.externalRevisionSink(ownerRevisionRefs);
    const sourceRevisionSet=uniq([...localSourceRevisionSet,...ownerRevisionRefs]);
    const envelope=this.candidateBus.fuse({
      nominations:scatter.nominations,retrievalIntents:intents,query,currentRevisionSet:{sourceRevisionSet,worldRevision,sceneRevision},
      unavailableChannels:scatter.unavailableChannels,degradedChannels:scatter.degradedChannels,
      metadata:{...metadata,channelReceipts:scatter.channelReceipts,channelErrors:scatter.errors},
    });
    this.lastEnvelope=envelope;return envelope;
  }

  async retrieveEnvelopeAsync(query,{intent='CURRENT',retrievalIntents=null,anchorEntityIds=[],worldRevision=this.graph?.revision??0,sceneRevision=0,channelIds=null,currentOwnerArtifacts=null,metadata={}}={}){
    const intents=(retrievalIntents?.length?retrievalIntents:[{intentId:'intent:'+stableHash({query,intent,anchorEntityIds},{length:16}),kind:intent,query,entityRefs:anchorEntityIds}])
      .map((row,index)=>row?.kind==='RetrievalIntent'?row:createRetrievalIntent({intentId:row.intentId??row.id??('intent:'+index+':'+stableHash(row,{length:12})),kind:row.kind??row.intentKind??intent,query:row.query??query,entityRefs:row.entityRefs??anchorEntityIds,relationshipRefs:row.relationshipRefs??[],eventRefs:row.eventRefs??[],artifactRefs:row.artifactRefs??[],temporalConstraint:row.temporalConstraint??null,perspective:row.perspective??null,metadata:row.metadata??{}}));
    const localSourceRevisionSet=this.sourceRegistry?.activeRevisionIds?.()??[];
    const context={query,anchorEntityIds:uniq(anchorEntityIds),worldRevision,sceneRevision,sourceRevisionSet:localSourceRevisionSet,currentOwnerArtifacts,hotCognitionSnapshot:this.hotCognition?.snapshot?.()??null};
    const scatter=await this.channelRegistry.retrieveAll({intents,context,channelIds});
    const ownerRevisionRefs=this.#trustedOwnerRevisionRefs(scatter.nominations);this.externalRevisionSink(ownerRevisionRefs);
    const sourceRevisionSet=uniq([...localSourceRevisionSet,...ownerRevisionRefs]);
    const envelope=this.candidateBus.fuse({nominations:scatter.nominations,retrievalIntents:intents,query,currentRevisionSet:{sourceRevisionSet,worldRevision,sceneRevision},unavailableChannels:scatter.unavailableChannels,degradedChannels:scatter.degradedChannels,metadata:{...metadata,channelReceipts:scatter.channelReceipts,channelErrors:scatter.errors}});
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
  diagnostics(){return frozen({kind:'SensoryNetDiagnostics',candidateBus:this.candidateBus.diagnostics(),channels:this.channelRegistry.manifest(),indexLifecycle:this.indexLifecycle.lifecycleDiagnostics(),lastFusionReceipt:clone(this.lastEnvelope?.fusionReceipt??null),retainsCandidatePayloadHistory:false,readOnly:true,mutationAuthority:false});}

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
