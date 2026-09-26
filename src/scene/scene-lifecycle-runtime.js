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

const clone=(v)=>structuredClone(v);
const relationForBoundary=(type)=>type===BoundaryType.FLASHBACK?SceneRelationship.FLASHBACK_OF:type===BoundaryType.PARALLEL?SceneRelationship.PARALLEL_TO:SceneRelationship.CONTINUES;

export class SceneLifecycleRuntime{
  constructor({registry=new SceneRegistry(),stack=new SceneStack(),episodeCompiler=new SceneEpisodeCompiler(),graph=new SceneGraph(),publisher=new SceneEventPublisher(),prefetchTrigger=new ScenePrefetchTrigger(),narrativeFeed=new NarrativeFeedAdapter(),contextInvalidationPublisher=new SceneContextInvalidationPublisher()}={}){
    this.registry=registry;this.stack=stack;this.episodeCompiler=episodeCompiler;this.graph=graph;this.publisher=publisher;this.prefetchTrigger=prefetchTrigger;this.narrativeFeed=narrativeFeed;this.contextInvalidationPublisher=contextInvalidationPublisher;
    this.sceneRuntime=new SceneIntelligenceRuntime({registry});
    this.transitionManager=new ClapperboardTransitionManager({registry,stack,episodeCompiler,graph,publisher,prefetchTrigger,contextInvalidationPublisher});
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
    this.prefetchTrigger.cancelSuperseded({sceneId:scene.sceneId,sceneRevision:scene.revision});
    const base={sceneId:scene.sceneId,sceneRevision:scene.revision,sourceRevisionRefs:[evidence.sourceRevisionId],turnId:evidence.turnId,correlationId:evidence.correlationId,causationId:evidence.causationId};
    this.publisher.publish({...base,eventType:SceneEventType.SCENE_STATE_DELTA,payload:{delta},dedupeKey:`delta:${scene.sceneId}:${delta.toRevision}`});
    const map={location:SceneEventType.LOCATION_CHANGED,narrativeTime:SceneEventType.TIME_SHIFT_DETECTED,activeCast:SceneEventType.ACTIVE_CAST_CHANGED,activeRelationships:SceneEventType.RELATIONSHIP_SIGNAL,atmosphere:SceneEventType.VIBE_CHANGED,immediateObjects:SceneEventType.OBJECT_TRANSITION};
    for(const [name,change] of Object.entries(delta.changedFields??{})){const eventType=map[name];if(eventType)this.publisher.publish({...base,eventType,payload:{field:name,change},dedupeKey:`${eventType}:${scene.sceneId}:${delta.toRevision}`});}
    const changed=Object.keys(delta.changedFields??{});if(changed.some((x)=>['location','activeCast','activeThreads'].includes(x))){const f=scene.fields;const rec=this.prefetchTrigger.recommend({sceneId:scene.sceneId,sceneRevision:scene.revision,trigger:`SCENE_DELTA:${changed.filter((x)=>['location','activeCast','activeThreads'].includes(x)).join('+')}`,entityRefs:(f.activeCast?.value??[]).filter((x)=>x.state==='PRESENT').map((x)=>x.characterId).filter(Boolean),locationRefs:[f.location?.value?.location].filter(Boolean),threadRefs:(f.activeThreads?.value??[]).filter((x)=>typeof x==='string'),priority:changed.includes('location')?'HIGH':'NORMAL',evidenceRefs:[evidence.sourceRevisionId],sourceRevisionRefs:[evidence.sourceRevisionId]});this.publisher.publish({...base,eventType:SceneEventType.PREFETCH_RECOMMENDED,payload:{recommendation:rec},dedupeKey:rec.recommendationId});}
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
    const extracted=extract(evidence,current)??{};const fields=extracted.fields??extracted;
    const observed=this.sceneRuntime.observe({sceneId:current.sceneId,proposalId:`host:${evidence.sourceRevisionId}`,fields,sourceRevisionRefs:[evidence.sourceRevisionId],evidenceRefs:[evidence.sourceRevisionId],allowWhenRefreshRequired:Boolean(extracted.allowWhenRefreshRequired)});
    if(observed.applied)this.#publishDelta(observed.scene,observed.delta,evidence);
    let boundary=null,transition=null;
    if(extracted.boundarySignals){
      boundary=this.sceneRuntime.boundary({sceneId:current.sceneId,evidenceRefs:[evidence.sourceRevisionId],signals:extracted.boundarySignals,sourcePosition:{messageId:evidence.messageId,messageRevision:evidence.messageRevision}});
      if(boundary){
        this.publisher.publish({eventType:SceneEventType.SCENE_BOUNDARY_CANDIDATE,sceneId:current.sceneId,sceneRevision:observed.scene?.revision??current.revision,sourceRevisionRefs:[evidence.sourceRevisionId],payload:{candidate:boundary.candidate},turnId:evidence.turnId,correlationId:evidence.correlationId,causationId:evidence.causationId,dedupeKey:boundary.candidate.candidateId});
        if(boundary.decision.status===BoundaryStatus.CONFIRMED){
          const relationship=extracted.relationship??relationForBoundary(boundary.candidate.proposedBoundaryType);
          const nextSceneId=relationship===SceneRelationship.RESUMES?extracted.resumeSceneId:null;
          transition=this.transitionManager.transition({decision:boundary.decision,fromSceneId:current.sceneId,nextSceneId,relationship,evidenceRefs:[evidence.sourceRevisionId],sourceRevisionRefs:[evidence.sourceRevisionId],sourceRange:{start:evidence.messageId,end:evidence.messageId},expectedSceneRevision:observed.scene?.revision??current.revision,turnId:evidence.turnId,correlationId:evidence.correlationId,causationId:evidence.causationId});
          if(transition.toSceneId)this.chatScenes.set(evidence.chatId,transition.toSceneId);
        }
      }
    }
    return {...normalized,invalidated,invalidatedHandoffs,invalidatedPrefetch,scene:clone(observed.scene),delta:clone(observed.delta),boundary,transition};
  }

  integrationSignal(chatId){return buildSceneIntegrationSignal(this,chatId);}
  publicSignalArtifact(chatId){return this.integrationSignal(chatId);}
  fanOutInput(chatId){return fanOutSceneInput(this,chatId);}
  uiReadModel(chatId){return buildSceneUiReadModel(this,chatId);}
}
