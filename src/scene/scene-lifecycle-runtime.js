import { BoundaryStatus, BoundaryType } from './contracts.js';
import { HostActivity, HostEventStatus, RetrievalQuality, SceneEventType, SceneRelationship } from './lifecycle-contracts.js';
import { SceneIntelligenceRuntime } from './runtime.js';
import { SceneRegistry } from './scene-registry.js';
import { SceneStack } from './scene-stack.js';
import { SceneEpisodeCompiler } from './scene-episode.js';
import { SceneGraph } from './scene-graph.js';
import { SceneEventPublisher } from './event-publisher.js';
import { ScenePrefetchTrigger, scenePrefetchIntentsFromNarrative } from './prefetch-trigger.js';
import { NarrativeFeedAdapter } from './narrative-feed-adapter.js';
import { SceneRetrievalAdapter } from './scene-retrieval.js';
import { ClapperboardTransitionManager } from './transition-manager.js';
import { SceneContextInvalidationPublisher } from './context-invalidation.js';
import { buildSceneIntegrationSignal, buildSceneUiReadModel, fanOutSceneInput } from './scene-integration-view.js';
import { AtmosphereTracker } from './atmosphere.js';

const clone=(v)=>structuredClone(v);
const relationForBoundary=(type)=>type===BoundaryType.FLASHBACK?SceneRelationship.FLASHBACK_OF:type===BoundaryType.PARALLEL?SceneRelationship.PARALLEL_TO:SceneRelationship.CONTINUES;
const atmosphereDimensions=(input)=>input?.observationClass?clone(input.value??{}):clone(input?.dimensions??input?.value??input??{});

export class SceneLifecycleRuntime{
  constructor({registry=new SceneRegistry(),stack=new SceneStack(),episodeCompiler=new SceneEpisodeCompiler(),graph=new SceneGraph(),publisher=new SceneEventPublisher(),prefetchTrigger=new ScenePrefetchTrigger(),narrativeFeed=new NarrativeFeedAdapter(),contextInvalidationPublisher=new SceneContextInvalidationPublisher(),atmosphereTracker=new AtmosphereTracker()}={}){
    this.registry=registry;this.stack=stack;this.episodeCompiler=episodeCompiler;this.graph=graph;this.publisher=publisher;this.prefetchTrigger=prefetchTrigger;this.narrativeFeed=narrativeFeed;this.contextInvalidationPublisher=contextInvalidationPublisher;this.atmosphereTracker=atmosphereTracker;
    this.sceneRuntime=new SceneIntelligenceRuntime({registry});
    this.transitionManager=new ClapperboardTransitionManager({registry,stack,episodeCompiler,graph,publisher,prefetchTrigger,sceneRuntime:this.sceneRuntime,contextInvalidationPublisher});
    this.retrieval=new SceneRetrievalAdapter({episodeProvider:()=>episodeCompiler.list(),graph});
    this.chatScenes=new Map();this.chatSceneSeq=new Map();
  }

  ensureChatScene(chatId,{sourceRevisionRefs=[],evidenceRefs=[]}={}){
    const existing=this.chatScenes.get(chatId);if(existing){const scene=this.registry.current(existing);if(scene&&scene.lifecycle!=='CLOSED')return scene;}
    const seq=(this.chatSceneSeq.get(chatId)??0)+1;this.chatSceneSeq.set(chatId,seq);const sceneId=`chat:${chatId}:scene:${seq}`;
    this.sceneRuntime.open({sceneId,sourceRevisionRefs,provenance:evidenceRefs});if(!this.stack.current())this.stack.open({sceneId,sourceRevisionRefs,evidenceRefs});else{this.stack.suspend(this.stack.activeSceneId,{evidenceRefs});this.stack.open({sceneId,relationshipToPrior:SceneRelationship.ISOLATED,sourceRevisionRefs,evidenceRefs});}
    this.chatScenes.set(chatId,sceneId);return this.registry.current(sceneId);
  }

  #invalidateSource(sourceRevisionId,replacementRef){
    const affected=[];
    for(const record of this.registry.list()){
      const scene=this.registry.current(record.sceneId);if(!scene)continue;
      const fields=Object.entries(scene.fields??{}).filter(([,state])=>(state.evidenceRefs??[]).includes(sourceRevisionId)).map(([name])=>name);
      if(fields.length){this.registry.reviseSource(record.sceneId,{sourceRevisionRef:replacementRef,affectedFields:fields,evidenceRefs:[replacementRef]});this.episodeCompiler.invalidateScene(record.sceneId);const node=this.graph.nodes.get(record.sceneId);if(node)node.metadata={...(node.metadata??{}),stale:true,invalidatedBy:replacementRef};affected.push({sceneId:record.sceneId,fields});}
    }
    return affected;
  }

  #publishRecommendation(scene,evidence,input){
    const rec=this.prefetchTrigger.recommend({
      sceneId:scene.sceneId,sceneRevision:scene.revision,
      evidenceRefs:[evidence.sourceRevisionId],sourceRevisionRefs:[evidence.sourceRevisionId],
      ...input,
    });
    this.publisher.publish({
      eventType:SceneEventType.PREFETCH_RECOMMENDED,sceneId:scene.sceneId,sceneRevision:scene.revision,
      sourceRevisionRefs:[evidence.sourceRevisionId],chatId:evidence.chatId,turnId:evidence.turnId,generationId:evidence.generationId,correlationId:evidence.correlationId,causationId:evidence.causationId,
      payload:{recommendation:rec},dedupeKey:[rec.dedupeKey??'prefetch',rec.recommendationId].join(':'),
    });
    return rec;
  }

  #publishDelta(scene,delta,evidence){
    this.prefetchTrigger.cancelSuperseded({sceneId:scene.sceneId,sceneRevision:scene.revision});
    const base={sceneId:scene.sceneId,sceneRevision:scene.revision,sourceRevisionRefs:[evidence.sourceRevisionId],chatId:evidence.chatId,turnId:evidence.turnId,generationId:evidence.generationId,correlationId:evidence.correlationId,causationId:evidence.causationId};
    this.publisher.publish({...base,eventType:SceneEventType.SCENE_STATE_DELTA,payload:{delta},dedupeKey:`delta:${scene.sceneId}:${delta.toRevision}`});
    const map={location:SceneEventType.LOCATION_CHANGED,narrativeTime:SceneEventType.TIME_SHIFT_DETECTED,activeCast:SceneEventType.ACTIVE_CAST_CHANGED,activeRelationships:SceneEventType.RELATIONSHIP_SIGNAL,atmosphere:SceneEventType.VIBE_CHANGED,immediateObjects:SceneEventType.OBJECT_TRANSITION};
    for(const [name,change] of Object.entries(delta.changedFields??{})){const eventType=map[name];if(eventType)this.publisher.publish({...base,eventType,payload:{field:name,change},dedupeKey:`${eventType}:${scene.sceneId}:${delta.toRevision}`});}
    const f=scene.fields;
    const entityRefs=(f.activeCast?.value??[]).filter((x)=>x?.state==='PRESENT').map((x)=>x.characterId).filter(Boolean);
    const locationRefs=[f.location?.value?.location??f.location?.value].filter((x)=>typeof x==='string'&&x.length);
    const threadRefs=threadIds(f.activeThreads?.value??[]);
    const changed=delta.changedFields??{};
    if(changed.location)this.#publishRecommendation(scene,evidence,{trigger:'LOCATION_CHANGED',entityRefs,locationRefs,threadRefs,priority:'HIGH'});
    if(changed.activeCast)this.#publishRecommendation(scene,evidence,{trigger:'ACTIVE_CAST_CHANGED',entityRefs,locationRefs,threadRefs,priority:'NORMAL'});
    if(changed.activeThreads){
      const before=new Set(threadIds(fieldArray(changed.activeThreads.before)));
      const activated=threadIds(fieldArray(changed.activeThreads.after)).filter((x)=>!before.has(x));
      if(activated.length)this.#publishRecommendation(scene,evidence,{trigger:'THREAD_ACTIVATED',entityRefs,locationRefs,threadRefs:activated,priority:'NORMAL'});
    }
  }

  publishOperatorDelta({scene,delta,evidenceRefs=[],sourceRevisionRefs=[],operation='SCENE_OPERATOR',reason=null,chatId=null,turnId=null,generationId=null,correlationId=null,causationId=null}={}){
    if(!scene?.sceneId||!delta?.toRevision)return null;
    const refs=[...new Set(((sourceRevisionRefs?.length?sourceRevisionRefs:scene.sourceRevisionRefs)??[]).filter(Boolean).map(String))];
    const evidence=[...new Set((evidenceRefs??[]).filter(Boolean).map(String))];
    this.prefetchTrigger.cancelSuperseded({sceneId:scene.sceneId,sceneRevision:scene.revision});
    const base={sceneId:scene.sceneId,sceneRevision:scene.revision,sourceRevisionRefs:refs,chatId,turnId,generationId,correlationId,causationId};
    const published=[];
    published.push(this.publisher.publish({
      ...base,eventType:SceneEventType.SCENE_STATE_DELTA,
      payload:{delta,operation,reason:reason??delta?.reason??null,operatorInitiated:true},
      dedupeKey:`delta:${scene.sceneId}:${delta.toRevision}:${operation}`,
    }));
    const map={location:SceneEventType.LOCATION_CHANGED,narrativeTime:SceneEventType.TIME_SHIFT_DETECTED,activeCast:SceneEventType.ACTIVE_CAST_CHANGED,activeRelationships:SceneEventType.RELATIONSHIP_SIGNAL,atmosphere:SceneEventType.VIBE_CHANGED,immediateObjects:SceneEventType.OBJECT_TRANSITION};
    for(const [name,change] of Object.entries(delta.changedFields??{})){
      const eventType=map[name];if(!eventType)continue;
      published.push(this.publisher.publish({
        ...base,eventType,payload:{field:name,change,operation,reason:reason??delta?.reason??null},
        dedupeKey:`${eventType}:${scene.sceneId}:${delta.toRevision}:${operation}`,
      }));
    }
    const changed=Object.keys(delta.changedFields??{});
    let recommendation=null;
    const retrievalFields=changed.filter((x)=>['location','activeCast','activeThreads'].includes(x));
    if(retrievalFields.length){
      const f=scene.fields;
      recommendation=this.prefetchTrigger.recommend({
        sceneId:scene.sceneId,sceneRevision:scene.revision,
        trigger:`SCENE_OPERATOR_DELTA:${retrievalFields.join('+')}`,
        entityRefs:(f.activeCast?.value??[]).filter((x)=>x?.state==='PRESENT').map((x)=>x.characterId).filter(Boolean),
        locationRefs:[f.location?.value?.location??f.location?.value].filter(Boolean),
        threadRefs:(f.activeThreads?.value??[]).map((x)=>typeof x==='string'?x:(x?.threadId??x?.id??x?.ref??null)).filter(Boolean),
        priority:changed.includes('location')?'HIGH':'NORMAL',
        evidenceRefs:evidence,sourceRevisionRefs:refs,
      });
      published.push(this.publisher.publish({
        ...base,eventType:SceneEventType.PREFETCH_RECOMMENDED,
        payload:{recommendation,operation,reason:reason??delta?.reason??null},
        dedupeKey:recommendation.recommendationId,
      }));
    }
    return clone({
      kind:'SceneOperatorPublicationReceipt',operation,sceneId:scene.sceneId,sceneRevision:scene.revision,
      changedFields:changed.sort(),eventIds:published.map((x)=>x?.eventId).filter(Boolean),
      eventTypes:published.map((x)=>x?.eventType).filter(Boolean),
      prefetchRecommendationId:recommendation?.recommendationId??null,
      prefetchNeeded:Boolean(recommendation),sourceRevisionRefs:refs,evidenceRefs:evidence,
      authority:'SIGNAL_ONLY',runtimeSchedulingAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    });
  }

  #publishLikelyNext(scene,evidence,intents){
    const rows=this.prefetchTrigger.recommendFromIntents({
      sceneId:scene.sceneId,sceneRevision:scene.revision,intents,
      trigger:'LIKELY_NEXT',evidenceRefs:[evidence.sourceRevisionId],sourceRevisionRefs:[evidence.sourceRevisionId],
    });
    for(const rec of rows)this.publisher.publish({
      eventType:SceneEventType.PREFETCH_RECOMMENDED,sceneId:scene.sceneId,sceneRevision:scene.revision,
      sourceRevisionRefs:[evidence.sourceRevisionId],chatId:evidence.chatId,turnId:evidence.turnId,generationId:evidence.generationId,correlationId:evidence.correlationId,causationId:evidence.causationId,
      payload:{recommendation:rec},dedupeKey:[rec.dedupeKey??'prefetch',rec.recommendationId].join(':'),
    });
    return rows;
  }

  indexEpisodeGraph(episode){
    if(!episode?.sceneId)return[];
    const record=this.registry.get(episode.sceneId),current=this.registry.current(episode.sceneId);if(!record||!current)return[];
    const scene=(record.snapshots??[]).find(row=>Number(row?.revision)===Number(episode.sceneRevision))??current;
    const refs=[],episodeRef=episode.artifactRef??null,sourceRevisionRefs=episode.sourceRevisionRefs??scene.sourceRevisionRefs??[];
    this.graph.addScene({sceneId:episode.sceneId,episodeRef,revision:episode.sceneRevision,metadata:{episodeId:episode.episodeId,sourceRevisionRefs:[...sourceRevisionRefs]}});
    for(const p of episode.participants??[]){const id=p.characterId??p.entityId;if(id)refs.push(this.graph.addMembership({sceneId:episode.sceneId,refId:id,kind:'ENTITY',evidenceRefs:p.evidenceRefs??scene.fields?.activeCast?.evidenceRefs??[],sourceRevisionRefs,provenance:[episode.episodeId],sceneRevision:episode.sceneRevision,episodeRef,temporalStatus:'HISTORICAL'}));}
    const objects=scene.fields?.immediateObjects?.value??[];
    for(const o of objects){if(!o?.objectId)continue;refs.push(this.graph.addMembership({sceneId:episode.sceneId,refId:o.objectId,kind:'OBJECT',evidenceRefs:o.evidenceRefs??scene.fields?.immediateObjects?.evidenceRefs??[],sourceRevisionRefs,provenance:[episode.episodeId],sceneRevision:episode.sceneRevision,episodeRef,temporalStatus:'HISTORICAL',observedState:{state:o.state??null,holderId:o.holderId??null,containerId:o.containerId??null,observationClass:o.observationClass??scene.fields?.immediateObjects?.observationClass??'UNKNOWN',confidence:o.confidence??scene.fields?.immediateObjects?.confidence??0},temporalApplicability:{sceneId:episode.sceneId,sceneRevision:episode.sceneRevision,observedAtRevision:o.seenRevision??episode.sceneRevision,narrativeTime:clone(episode.narrativeTime?.value??null),sourceRevisionRefs:[...sourceRevisionRefs]}}));}
    for(const thread of episode.threadsCarried??[]){const id=typeof thread==='string'?thread:thread?.threadId??thread?.id??JSON.stringify(thread);refs.push(this.graph.addMembership({sceneId:episode.sceneId,refId:id,kind:'THREAD',evidenceRefs:scene.fields?.activeThreads?.evidenceRefs??[],sourceRevisionRefs,provenance:[episode.episodeId],sceneRevision:episode.sceneRevision,episodeRef,temporalStatus:'HISTORICAL'}));}
    for(const event of episode.events??[]){const id=event?.eventId??event?.id;if(id)refs.push(this.graph.addMembership({sceneId:episode.sceneId,refId:id,kind:'EVENT',evidenceRefs:event.evidenceRefs??[],sourceRevisionRefs,provenance:[episode.episodeId],sceneRevision:episode.sceneRevision,episodeRef,temporalStatus:'HISTORICAL',temporalApplicability:clone(event.temporalApplicability??episode.narrativeTime?.value??null)}));}
    return refs;
  }

  #admitGraphEvidenceLinks(scene,evidence,links=[],episodeRef=null){
    const receipts=[],originSceneRevision=Number(episodeRef?.revision??episodeRef?.sceneRevision??scene.revision);
    for(const raw of (Array.isArray(links)?links:[]).slice(0,32)){
      const relation=String(raw?.relation??'SUPPORTS').toUpperCase(),evidenceRefs=[...new Set((raw?.evidenceRefs??[]).filter(Boolean).map(String))];
      if(!evidenceRefs.length||!evidenceRefs.includes(String(evidence.sourceRevisionId))){receipts.push({status:'REJECTED',reasonCode:'SCENE_GRAPH_CURRENT_EVIDENCE_REQUIRED',relation,fromRef:raw?.fromRef??null,toRef:raw?.toRef??null});continue;}
      try{
        const edge=this.graph.addEvidenceLink({sceneId:scene.sceneId,sceneRevision:originSceneRevision,episodeRef,fromRef:raw.fromRef,toRef:raw.toRef,relation,evidenceRefs,sourceRevisionRefs:[evidence.sourceRevisionId],provenance:[evidence.sourceRevisionId,...(raw.provenance??[])],derivedFrom:raw.derivedFrom??[],ownerApproved:true,supportStatus:raw.supportStatus??'SUPPORTED',interpretationId:raw.interpretationId??null,temporalApplicability:raw.temporalApplicability??{sceneId:scene.sceneId,sceneRevision:originSceneRevision}});
        receipts.push({status:'ADMITTED',reasonCode:'SCENE_GRAPH_OWNER_LINK_ADMITTED',edgeId:edge.edgeId,relation,causal:Boolean(edge.causal),authorityClass:edge.authorityClass});
      }catch(error){receipts.push({status:'REJECTED',reasonCode:String(error?.message??'SCENE_GRAPH_LINK_REJECTED'),relation,fromRef:raw?.fromRef??null,toRef:raw?.toRef??null});}
    }
    return receipts;
  }

  admitGraphEvidenceLinks({chatId,sceneId,sceneRevision,sourceRevisionId,links=[],episodeRef=null}={}){
    const chat=String(chatId??'').trim(),sceneRef=String(sceneId??'').trim(),sourceRef=String(sourceRevisionId??'').trim();
    if(!chat||!sceneRef||!sourceRef)return{kind:'SceneGraphEvidenceAdmission',status:'REJECTED',reasonCode:'SCENE_GRAPH_OWNER_FENCE_REQUIRED',receipts:[]};
    const activeSceneId=this.chatScenes.get(chat)??null;
    const historicalEpisode=episodeRef?.artifactId?this.episodeCompiler.get(String(episodeRef.artifactId)):null;
    const admittedHistoricalScene=Boolean(historicalEpisode&&historicalEpisode.sceneId===sceneRef&&historicalEpisode.artifactRef?.artifactId===episodeRef.artifactId);
    if(activeSceneId&&activeSceneId!==sceneRef&&!admittedHistoricalScene)return{kind:'SceneGraphEvidenceAdmission',status:'REJECTED',reasonCode:'SCENE_GRAPH_FOREIGN_SCENE',receipts:[]};
    const scene=this.registry.current(sceneRef);
    const expectedRevision=historicalEpisode?Number(historicalEpisode.sceneRevision):Number(scene?.revision);
    if(!scene||Number(sceneRevision)!==expectedRevision)return{kind:'SceneGraphEvidenceAdmission',status:'REJECTED',reasonCode:'SCENE_GRAPH_STALE_SCENE_REVISION',receipts:[]};
    const currentRefs=new Set(this.narrativeFeed.currentEvidence(chat).map(row=>String(row.sourceRevisionId)));
    if(!currentRefs.has(sourceRef))return{kind:'SceneGraphEvidenceAdmission',status:'REJECTED',reasonCode:'SCENE_GRAPH_STALE_SOURCE_REVISION',receipts:[]};
    const evidence={chatId:chat,sourceRevisionId:sourceRef};
    const receipts=this.#admitGraphEvidenceLinks(scene,evidence,links,episodeRef);
    return{kind:'SceneGraphEvidenceAdmission',status:receipts.some(row=>row.status==='ADMITTED')?'ADMITTED':receipts.length?'REJECTED':'NO_WORK',reasonCode:receipts.some(row=>row.status==='ADMITTED')?'SCENE_GRAPH_OWNER_LINKS_ADMITTED':receipts.length?'SCENE_GRAPH_OWNER_LINKS_REJECTED':'SCENE_GRAPH_OWNER_NO_LINKS',sceneId:sceneRef,sceneRevision:expectedRevision,sourceRevisionId:sourceRef,receipts:clone(receipts),authorityGranted:false,canonicalMutationAuthority:false,truthAuthority:false,temporalStateAuthority:false,memoryMutationAuthority:false};
  }

  ingestHostEvent(input,{extract=null}={}){
    const normalized=this.narrativeFeed.normalize(input);
    if(normalized.status!==HostEventStatus.ACCEPTED)return normalized;
    return this.#applyAcceptedEvidence(normalized,normalized.evidence,extract,{applyInvalidations:true});
  }

  applyExistingEvidence(input,{extract=null}={}){
    const chatId=String(input?.chatId??'').trim(),sourceRevisionId=String(input?.sourceRevisionId??'').trim();
    if(!chatId||!sourceRevisionId)return{status:HostEventStatus.INVALID,reason:'chatId-and-sourceRevisionId-required'};
    const stored=this.narrativeFeed.findSourceRevision(chatId,sourceRevisionId);
    const current=this.narrativeFeed.currentEvidence(chatId).find(row=>String(row.sourceRevisionId)===sourceRevisionId)??null;
    if(!stored||!current)return{status:HostEventStatus.INVALID,reason:'source-revision-not-current',stale:true,sourceRevisionId};
    const evidence={
      ...clone(stored),chatId,sourceRevisionId,current:true,historical:false,
      turnId:input.turnId??null,generationId:input.generationId??null,correlationId:input.correlationId??null,causationId:input.causationId??null,
      activity:input.activity??stored.activity,role:input.role??stored.role,content:stored.content,
    };
    const normalized={status:HostEventStatus.ACCEPTED,evidence,reusedExistingEvidence:true};
    return this.#applyAcceptedEvidence(normalized,evidence,extract,{applyInvalidations:false});
  }

  #applyAcceptedEvidence(normalized,evidence,extract,{applyInvalidations=true}={}){
    if([HostActivity.CHAT_LOAD,HostActivity.CHAT_SWITCH,HostActivity.NEW_CHAT,HostActivity.IMPORT_OR_RELOAD].includes(evidence.activity)){
      const scene=this.ensureChatScene(evidence.chatId,{sourceRevisionRefs:[evidence.sourceRevisionId],evidenceRefs:[evidence.sourceRevisionId]});
      const invalidatedPrefetch=this.prefetchTrigger.cancelOtherScenes({sceneId:scene.sceneId,reason:'CHAT_CHANGE:'+evidence.activity});
      return {...normalized,scene:clone(scene),invalidatedPrefetch};
    }
    const invalidated=[],invalidatedHandoffs=[],invalidatedPrefetch=[],invalidationRefs=applyInvalidations?[...new Set([...(evidence.invalidates??[]),evidence.replacesRevisionId].filter(Boolean))]:[];
    const invalidatedGraph=[];for(const source of invalidationRefs){invalidated.push(...this.#invalidateSource(source,evidence.sourceRevisionId));invalidatedGraph.push(...this.graph.invalidateBySource(source,evidence.sourceRevisionId));invalidatedHandoffs.push(...this.transitionManager.invalidateHandoffs({sourceRevisionRefs:[source],replacementRef:evidence.sourceRevisionId}));invalidatedPrefetch.push(...this.prefetchTrigger.invalidateBySource({sourceRevisionRefs:[source],replacementRef:evidence.sourceRevisionId}));}
    if(!evidence.current||typeof evidence.content!=='string'||!extract)return {...normalized,invalidated,invalidatedGraph,invalidatedHandoffs,invalidatedPrefetch};
    const current=this.ensureChatScene(evidence.chatId,{sourceRevisionRefs:[evidence.sourceRevisionId],evidenceRefs:[evidence.sourceRevisionId]});
    const extracted=extract(evidence,current)??{};const fields=clone(extractSceneFields(extracted));
    let atmosphereDisposition='UNAVAILABLE';
    if(Object.prototype.hasOwnProperty.call(fields,'atmosphere')){
      const dimensions=atmosphereDimensions(fields.atmosphere);
      const generatedWording=String(evidence.role??'').toLowerCase()==='assistant';
      const acceptedDimensions=generatedWording
        ? Object.fromEntries(Object.entries(dimensions).filter(([,row])=>Boolean(row?.novelNarrativeEvidence)))
        : dimensions;
      if(generatedWording&&!Object.keys(acceptedDimensions).length){
        delete fields.atmosphere;
        atmosphereDisposition='REJECTED_RECURSIVE_GENERATED_WORDING';
      }else{
        const sourceRef=evidence.sourceRevisionId;
        fields.atmosphere=this.atmosphereTracker.update({
          revision:current.revision+1,
          evidenceRefs:[sourceRef],
          dimensions:acceptedDimensions,
          metadata:{
            sourceRole:evidence.role??null,
            sourceActivity:evidence.activity??null,
            generationDerivedEvidenceRefs:generatedWording?[sourceRef]:[],
            novelNarrativeEvidenceRefs:generatedWording?[sourceRef]:[],
          },
        });
        atmosphereDisposition=fields.atmosphere.observationClass==='INFERRED'?(generatedWording?'UPDATED_FROM_NOVEL_GENERATED_NARRATIVE':'UPDATED'):'UNAVAILABLE';
      }
    }
    const likelyNextIntents=[...(extracted.prefetchIntents??scenePrefetchIntentsFromNarrative(evidence.content)??[])];const graphEvidenceLinks=extracted.graphEvidenceLinks??[],graphEvidenceOwnerApproved=extracted.graphEvidenceLinksOwnerApproved===true;
    let boundary=null,transition=null,observed=null;
    if(extracted.boundarySignals){
      boundary=this.sceneRuntime.boundary({sceneId:current.sceneId,evidenceRefs:[evidence.sourceRevisionId],signals:extracted.boundarySignals,sourcePosition:{messageId:evidence.messageId,messageRevision:evidence.messageRevision}});
      if(boundary){
        this.publisher.publish({eventType:SceneEventType.SCENE_BOUNDARY_CANDIDATE,sceneId:current.sceneId,sceneRevision:current.revision,sourceRevisionRefs:[evidence.sourceRevisionId],payload:{candidate:boundary.candidate},chatId:evidence.chatId,turnId:evidence.turnId,generationId:evidence.generationId,correlationId:evidence.correlationId,causationId:evidence.causationId,dedupeKey:boundary.candidate.candidateId});
        if(boundary.decision.status===BoundaryStatus.CONFIRMED){
          const relationship=extracted.relationship??relationForBoundary(boundary.candidate.proposedBoundaryType);
          const nextSceneId=relationship===SceneRelationship.RESUMES?extracted.resumeSceneId:null;
          const destinationHints={
            entityRefs:(fields.activeCast?.value??[]).filter((row)=>row?.state==='PRESENT').map((row)=>row.characterId).filter(Boolean),
            locationRefs:[fields.location?.value?.location??fields.location?.value].filter(Boolean),
            threadRefs:(fields.activeThreads?.value??[]).map((row)=>typeof row==='string'?row:(row?.threadId??row?.id??row?.ref??null)).filter(Boolean),
          };
          const priorSourceRefs=new Set((current.sourceRevisionRefs??[]).map(String));
          const recentTailRefs=(this.narrativeFeed.currentEvidence(evidence.chatId)??[])
            .filter(row=>priorSourceRefs.has(String(row.sourceRevisionId)))
            .sort((x,y)=>Number(x.sequence??0)-Number(y.sequence??0))
            .slice(-2)
            .map(row=>row.sourceRevisionId);
          transition=this.transitionManager.transition({
            decision:boundary.decision,fromSceneId:current.sceneId,nextSceneId,relationship,
            evidenceRefs:[evidence.sourceRevisionId],sourceRevisionRefs:[evidence.sourceRevisionId],
            sourceRange:{start:evidence.messageId,end:evidence.messageId},recentTailRefs,destinationHints,destinationFields:fields,
            allowDestinationRefresh:Boolean(extracted.allowWhenRefreshRequired),expectedSceneRevision:current.revision,
            chatId:evidence.chatId,turnId:evidence.turnId,generationId:evidence.generationId,correlationId:evidence.correlationId,causationId:evidence.causationId,
          });
          if(transition.episodeRef){
            const episode=this.episodeCompiler.get(transition.episodeRef.artifactId);
            if(episode)this.indexEpisodeGraph(episode);
            const relationshipEdge=this.graph.addRelationship({fromSceneId:transition.fromSceneId,toSceneId:transition.toSceneId,relationship:transition.relationship,evidenceRefs:[evidence.sourceRevisionId],sourceRevisionRefs:[evidence.sourceRevisionId],provenance:[boundary.decision.candidateId,evidence.sourceRevisionId],sceneRevision:episode?.sceneRevision??current.revision,episodeRef:episode?.artifactRef??transition.episodeRef});
            const relationshipRefs=[relationshipEdge.edgeId];
            if(transition.relationship===SceneRelationship.CONTINUES){const temporalEdge=this.graph.addRelationship({fromSceneId:transition.fromSceneId,toSceneId:transition.toSceneId,relationship:SceneRelationship.PRECEDES,evidenceRefs:[evidence.sourceRevisionId],sourceRevisionRefs:[evidence.sourceRevisionId],provenance:[boundary.decision.candidateId,evidence.sourceRevisionId],sceneRevision:episode?.sceneRevision??current.revision,episodeRef:episode?.artifactRef??transition.episodeRef});relationshipRefs.push(temporalEdge.edgeId);}
          }else if(transition.toSceneId){
            this.graph.addRelationship({fromSceneId:transition.fromSceneId,toSceneId:transition.toSceneId,relationship:transition.relationship,evidenceRefs:[evidence.sourceRevisionId],sourceRevisionRefs:[evidence.sourceRevisionId],provenance:[boundary.decision.candidateId,evidence.sourceRevisionId],sceneRevision:current.revision});
          }
          if(transition.toSceneId){
            this.chatScenes.set(evidence.chatId,transition.toSceneId);
            const nextScene=this.registry.current(transition.toSceneId);
            observed={scene:nextScene,delta:clone(transition.destinationDelta??null),applied:Boolean(transition.destinationApplied)};
          }
        }
      }
    }
    if(!observed){
      if(Object.keys(fields??{}).length){
        observed=this.sceneRuntime.observe({sceneId:current.sceneId,proposalId:`host:${evidence.sourceRevisionId}`,fields,sourceRevisionRefs:[evidence.sourceRevisionId],evidenceRefs:[evidence.sourceRevisionId],allowWhenRefreshRequired:Boolean(extracted.allowWhenRefreshRequired)});
        if(observed.applied)this.#publishDelta(observed.scene,observed.delta,evidence);
      }else{
        observed={scene:current,delta:null,applied:false,noChange:true};
      }
    }
    const publishedPrefetch=likelyNextIntents.length?this.#publishLikelyNext(observed.scene,evidence,likelyNextIntents):[];
    const graphLinkScene=transition?.episodeRef?(this.registry.current(transition.fromSceneId)??observed.scene):observed.scene;
    const graphEvidenceAdmission=graphEvidenceLinks.length?(graphEvidenceOwnerApproved?this.admitGraphEvidenceLinks({chatId:evidence.chatId,sceneId:graphLinkScene.sceneId,sceneRevision:transition?.episodeRef?.revision??graphLinkScene.revision,sourceRevisionId:evidence.sourceRevisionId,links:graphEvidenceLinks,episodeRef:transition?.episodeRef??null}):{kind:'SceneGraphEvidenceAdmission',status:'REJECTED',reasonCode:'SCENE_GRAPH_OWNER_APPROVAL_REQUIRED',receipts:graphEvidenceLinks.slice(0,32).map(raw=>({status:'REJECTED',reasonCode:'SCENE_GRAPH_OWNER_APPROVAL_REQUIRED',relation:String(raw?.relation??'SUPPORTS').toUpperCase(),fromRef:raw?.fromRef??null,toRef:raw?.toRef??null}))}):{kind:'SceneGraphEvidenceAdmission',status:'NO_WORK',reasonCode:'SCENE_GRAPH_OWNER_NO_LINKS',receipts:[]};
    const graphEvidenceReceipts=graphEvidenceAdmission.receipts;
    return {...normalized,invalidated,invalidatedGraph,invalidatedHandoffs,invalidatedPrefetch,publishedPrefetch,graphEvidenceAdmission,graphEvidenceReceipts,scene:clone(observed.scene),delta:clone(observed.delta),boundary,transition,atmosphereDisposition};
  }

  integrationSignal(chatId){return buildSceneIntegrationSignal(this,chatId);}
  publicSignalArtifact(chatId){return this.integrationSignal(chatId);}
  fanOutInput(chatId){return fanOutSceneInput(this,chatId);}
  uiReadModel(chatId){return buildSceneUiReadModel(this,chatId);}
}

function fieldArray(state){const value=state&&typeof state==='object'&&Object.prototype.hasOwnProperty.call(state,'value')?state.value:state;return Array.isArray(value)?value:[];}
function threadIds(values){return [...new Set((values??[]).map((row)=>typeof row==='string'?row:row?.threadId??row?.id??null).filter(Boolean).map(String))];}
function extractSceneFields(extracted){
  if(extracted?.fields&&typeof extracted.fields==='object'&&!Array.isArray(extracted.fields))return extracted.fields;
  const controlKeys=['boundarySignals','prefetchIntents','graphEvidenceLinks','graphEvidenceLinksOwnerApproved','relationship','resumeSceneId','allowWhenRefreshRequired','explicit','extractionPolicy'];
  if(controlKeys.some((key)=>Object.prototype.hasOwnProperty.call(extracted??{},key)))return{};
  return extracted&&typeof extracted==='object'&&!Array.isArray(extracted)?extracted:{};
}
