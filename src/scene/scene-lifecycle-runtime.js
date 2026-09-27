import { BoundaryStatus, BoundaryType } from './contracts.js';
import { HostActivity, HostEventStatus, RetrievalQuality, SceneEventType, SceneRelationship } from './lifecycle-contracts.js';
import { SceneIntelligenceRuntime } from './runtime.js';
import { SceneRegistry } from './scene-registry.js';
import { SceneStack } from './scene-stack.js';
import { SceneEpisodeCompiler } from './scene-episode.js';
import { SceneGraph } from './scene-graph.js';
import { SceneEventPublisher } from './event-publisher.js';
import { ScenePrefetchTrigger } from './prefetch-trigger.js';
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

  #publishDelta(scene,delta,evidence){
    return this.publishOperatorDelta({
      scene,delta,
      evidenceRefs:[evidence.sourceRevisionId],
      sourceRevisionRefs:[evidence.sourceRevisionId],
      operation:'HOST_OBSERVATION',
      reason:delta?.reason??'HOST_OBSERVATION',
      turnId:evidence.turnId,correlationId:evidence.correlationId,causationId:evidence.causationId,
    });
  }

  publishOperatorDelta({scene,delta,evidenceRefs=[],sourceRevisionRefs=[],operation='SCENE_OPERATOR',reason=null,turnId=null,correlationId=null,causationId=null}={}){
    if(!scene?.sceneId||!delta?.toRevision)return null;
    const refs=[...new Set(((sourceRevisionRefs?.length?sourceRevisionRefs:scene.sourceRevisionRefs)??[]).filter(Boolean).map(String))];
    const evidence=[...new Set((evidenceRefs??[]).filter(Boolean).map(String))];
    this.prefetchTrigger.cancelSuperseded({sceneId:scene.sceneId,sceneRevision:scene.revision});
    const base={sceneId:scene.sceneId,sceneRevision:scene.revision,sourceRevisionRefs:refs,turnId,correlationId,causationId};
    const published=[];
    const hostObservation=operation==='HOST_OBSERVATION';
    published.push(this.publisher.publish({
      ...base,eventType:SceneEventType.SCENE_STATE_DELTA,
      payload:hostObservation?{delta}:{delta,operation,reason:reason??delta?.reason??null,operatorInitiated:true},
      dedupeKey:hostObservation?`delta:${scene.sceneId}:${delta.toRevision}`:`delta:${scene.sceneId}:${delta.toRevision}:${operation}`,
    }));
    const map={location:SceneEventType.LOCATION_CHANGED,narrativeTime:SceneEventType.TIME_SHIFT_DETECTED,activeCast:SceneEventType.ACTIVE_CAST_CHANGED,activeRelationships:SceneEventType.RELATIONSHIP_SIGNAL,atmosphere:SceneEventType.VIBE_CHANGED,immediateObjects:SceneEventType.OBJECT_TRANSITION};
    for(const [name,change] of Object.entries(delta.changedFields??{})){
      const eventType=map[name];if(!eventType)continue;
      published.push(this.publisher.publish({
        ...base,eventType,payload:hostObservation?{field:name,change}:{field:name,change,operation,reason:reason??delta?.reason??null},
        dedupeKey:hostObservation?`${eventType}:${scene.sceneId}:${delta.toRevision}`:`${eventType}:${scene.sceneId}:${delta.toRevision}:${operation}`,
      }));
    }
    const changed=Object.keys(delta.changedFields??{});
    let recommendation=null;
    const retrievalFields=changed.filter((x)=>['location','activeCast','activeThreads'].includes(x));
    if(retrievalFields.length){
      const f=scene.fields;
      recommendation=this.prefetchTrigger.recommend({
        sceneId:scene.sceneId,sceneRevision:scene.revision,
        trigger:`SCENE_DELTA:${retrievalFields.join('+')}`,
        entityRefs:(f.activeCast?.value??[]).filter((x)=>x?.state==='PRESENT').map((x)=>x.characterId).filter(Boolean),
        locationRefs:[f.location?.value?.location??f.location?.value].filter(Boolean),
        threadRefs:(f.activeThreads?.value??[]).map((x)=>typeof x==='string'?x:(x?.threadId??x?.id??null)).filter(Boolean),
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

  ingestHostEvent(input,{extract=null}={}){
    const normalized=this.narrativeFeed.normalize(input);
    if(normalized.status!==HostEventStatus.ACCEPTED)return normalized;
    const evidence=normalized.evidence;
    if([HostActivity.CHAT_LOAD,HostActivity.CHAT_SWITCH,HostActivity.NEW_CHAT,HostActivity.IMPORT_OR_RELOAD].includes(evidence.activity)){
      const scene=this.ensureChatScene(evidence.chatId,{sourceRevisionRefs:[evidence.sourceRevisionId],evidenceRefs:[evidence.sourceRevisionId]});return {...normalized,scene:clone(scene)};
    }
    const invalidated=[],invalidatedHandoffs=[],invalidatedPrefetch=[],invalidationRefs=[...new Set([...(evidence.invalidates??[]),evidence.replacesRevisionId].filter(Boolean))];
    for(const source of invalidationRefs){invalidated.push(...this.#invalidateSource(source,evidence.sourceRevisionId));invalidatedHandoffs.push(...this.transitionManager.invalidateHandoffs({sourceRevisionRefs:[source],replacementRef:evidence.sourceRevisionId}));invalidatedPrefetch.push(...this.prefetchTrigger.invalidateBySource({sourceRevisionRefs:[source],replacementRef:evidence.sourceRevisionId}));}
    if(!evidence.current||typeof evidence.content!=='string'||!extract)return {...normalized,invalidated,invalidatedHandoffs,invalidatedPrefetch};
    const current=this.ensureChatScene(evidence.chatId,{sourceRevisionRefs:[evidence.sourceRevisionId],evidenceRefs:[evidence.sourceRevisionId]});
    const extracted=extract(evidence,current)??{};const fields=clone(extracted.fields??extracted);
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
    let boundary=null,transition=null,observed=null;
    if(extracted.boundarySignals){
      boundary=this.sceneRuntime.boundary({sceneId:current.sceneId,evidenceRefs:[evidence.sourceRevisionId],signals:extracted.boundarySignals,sourcePosition:{messageId:evidence.messageId,messageRevision:evidence.messageRevision}});
      if(boundary){
        this.publisher.publish({eventType:SceneEventType.SCENE_BOUNDARY_CANDIDATE,sceneId:current.sceneId,sceneRevision:current.revision,sourceRevisionRefs:[evidence.sourceRevisionId],payload:{candidate:boundary.candidate},turnId:evidence.turnId,correlationId:evidence.correlationId,causationId:evidence.causationId,dedupeKey:boundary.candidate.candidateId});
        if(boundary.decision.status===BoundaryStatus.CONFIRMED){
          const relationship=extracted.relationship??relationForBoundary(boundary.candidate.proposedBoundaryType);
          const nextSceneId=relationship===SceneRelationship.RESUMES?extracted.resumeSceneId:null;
          const destinationHints={
            entityRefs:(fields.activeCast?.value??[]).filter((row)=>row?.state==='PRESENT').map((row)=>row.characterId).filter(Boolean),
            locationRefs:[fields.location?.value?.location??fields.location?.value].filter(Boolean),
            threadRefs:(fields.activeThreads?.value??[]).filter((row)=>typeof row==='string'),
          };
          transition=this.transitionManager.transition({
            decision:boundary.decision,fromSceneId:current.sceneId,nextSceneId,relationship,
            evidenceRefs:[evidence.sourceRevisionId],sourceRevisionRefs:[evidence.sourceRevisionId],
            sourceRange:{start:evidence.messageId,end:evidence.messageId},destinationHints,destinationFields:fields,
            allowDestinationRefresh:Boolean(extracted.allowWhenRefreshRequired),expectedSceneRevision:current.revision,
            turnId:evidence.turnId,correlationId:evidence.correlationId,causationId:evidence.causationId,
          });
          if(transition.toSceneId){
            this.chatScenes.set(evidence.chatId,transition.toSceneId);
            const nextScene=this.registry.current(transition.toSceneId);
            observed={scene:nextScene,delta:clone(transition.destinationDelta??null),applied:Boolean(transition.destinationApplied)};
          }
        }
      }
    }
    if(!observed){
      observed=this.sceneRuntime.observe({sceneId:current.sceneId,proposalId:`host:${evidence.sourceRevisionId}`,fields,sourceRevisionRefs:[evidence.sourceRevisionId],evidenceRefs:[evidence.sourceRevisionId],allowWhenRefreshRequired:Boolean(extracted.allowWhenRefreshRequired)});
      if(observed.applied)this.#publishDelta(observed.scene,observed.delta,evidence);
    }
    return {...normalized,invalidated,invalidatedHandoffs,invalidatedPrefetch,scene:clone(observed.scene),delta:clone(observed.delta),boundary,transition,atmosphereDisposition};
  }

  integrationSignal(chatId){return buildSceneIntegrationSignal(this,chatId);}
  publicSignalArtifact(chatId){return this.integrationSignal(chatId);}
  fanOutInput(chatId){return fanOutSceneInput(this,chatId);}
  uiReadModel(chatId){return buildSceneUiReadModel(this,chatId);}
}
