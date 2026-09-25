import { BoundaryStatus } from './contracts.js';
import { SceneEventType, SceneRelationship, TransitionStatus } from './lifecycle-contracts.js';

const clone=(v)=>structuredClone(v);

export class ClapperboardTransitionManager{
  constructor({registry,stack,episodeCompiler,graph,publisher,prefetchTrigger,contextInvalidationPublisher=null}={}){
    if(!registry||!stack||!episodeCompiler||!graph||!publisher)throw new TypeError('registry, stack, episodeCompiler, graph and publisher are required');
    this.registry=registry;this.stack=stack;this.episodeCompiler=episodeCompiler;this.graph=graph;this.publisher=publisher;this.prefetchTrigger=prefetchTrigger;this.contextInvalidationPublisher=contextInvalidationPublisher;this.transitions=new Map();this.sequence=0;
  }

  #publish(eventType,scene,sourceRevisionRefs,payload,meta={}){
    return this.publisher.publish({eventType,sceneId:scene.sceneId,sceneRevision:scene.revision,sourceRevisionRefs,dedupeKey:meta.dedupeKey,correlationId:meta.correlationId,causationId:meta.causationId,turnId:meta.turnId,payload});
  }

  #finalize(sceneId,{evidenceRefs=[],sourceRevisionRefs=[],correlationId=null,causationId=null,turnId=null}={}){
    const scene=this.registry.current(sceneId);if(!scene)throw new Error(`unknown scene ${sceneId}`);
    let episode=null,error=null;
    try{episode=this.episodeCompiler.compile({scene,record:this.registry.get(sceneId),sceneRelationships:this.graph.neighbors(sceneId)});}catch(e){error=e;}
    const closed=this.registry.closeScene(sceneId,{futureSceneEpisodeRef:episode?.artifactRef??null,evidenceRefs});
    this.stack.close(sceneId);
    if(episode){
      this.graph.addScene({sceneId,episodeRef:episode.artifactRef,revision:scene.revision});
      for(const p of episode.participants??[]){const id=p.characterId??p.entityId;if(id)this.graph.addMembership({sceneId,refId:id,kind:'ENTITY',evidenceRefs:p.evidenceRefs??[],provenance:[episode.episodeId]});}
      for(const o of scene.fields?.immediateObjects?.value??[]){if(o.objectId)this.graph.addMembership({sceneId,refId:o.objectId,kind:'OBJECT',evidenceRefs:o.evidenceRefs??[],provenance:[episode.episodeId]});}
      for(const thread of episode.threadsCarried??[]){const id=typeof thread==='string'?thread:JSON.stringify(thread);this.graph.addMembership({sceneId,refId:id,kind:'THREAD',evidenceRefs:scene.fields?.activeThreads?.evidenceRefs??[],provenance:[episode.episodeId]});}
      for(const event of episode.events??[]){const id=event.eventId??event.id;if(id)this.graph.addMembership({sceneId,refId:id,kind:'EVENT',evidenceRefs:event.evidenceRefs??[],provenance:[episode.episodeId]});}
      this.#publish(SceneEventType.SCENE_EPISODE_READY,scene,sourceRevisionRefs,{episodeRef:episode.artifactRef},{dedupeKey:`episode:${episode.episodeId}`,correlationId,causationId,turnId});
    }
    this.#publish(SceneEventType.SCENE_CLOSED,closed.snapshots.at(-1),sourceRevisionRefs,{episodeRef:episode?.artifactRef??null,status:error?TransitionStatus.EPISODE_PENDING:TransitionStatus.COMPLETE},{dedupeKey:`closed:${sceneId}:${closed.revision}`,correlationId,causationId,turnId});
    return {episode,error,closed};
  }

  transition({decision,fromSceneId,nextSceneId=null,relationship=SceneRelationship.CONTINUES,evidenceRefs=[],sourceRevisionRefs=[],sourceRange={start:null,end:null},expectedSceneRevision=null,correlationId=null,causationId=null,turnId=null}={}){
    if(decision?.status!==BoundaryStatus.CONFIRMED)throw new Error('confirmed boundary decision required');
    const prior=[...this.transitions.entries()].find(([key])=>key.startsWith(`${decision.candidateId}:`));if(prior)return {...clone(prior[1]),status:TransitionStatus.DUPLICATE};
    const current=this.registry.current(fromSceneId);if(!current)return {status:TransitionStatus.REJECTED,reason:'unknown-current-scene'};
    if(current.lifecycle==='CLOSED')return {status:TransitionStatus.REJECTED,reason:'scene-already-closed',sceneId:fromSceneId};
    if(expectedSceneRevision!=null&&current.revision!==expectedSceneRevision)return {status:TransitionStatus.STALE,sceneId:fromSceneId,expectedSceneRevision,currentSceneRevision:current.revision};
    const target=nextSceneId??`scene:${fromSceneId}:next:${++this.sequence}`;
    const key=`${decision.candidateId}:${fromSceneId}:${current.revision}:${relationship}:${target}`;
    if(this.transitions.has(key))return {status:TransitionStatus.DUPLICATE,...clone(this.transitions.get(key))};

    this.#publish(SceneEventType.SCENE_BOUNDARY_CONFIRMED,current,sourceRevisionRefs,{candidateId:decision.candidateId,boundaryType:decision.boundaryType,relationship},{dedupeKey:`boundary-confirmed:${decision.candidateId}`,correlationId,causationId,turnId});

    let episode=null,partial=false,nextRecord=null,resumed=null,resumedFromRevision=null;
    if(relationship===SceneRelationship.RESUMES){
      resumedFromRevision=this.registry.current(target)?.revision??null;
      const finalized=this.#finalize(fromSceneId,{evidenceRefs,sourceRevisionRefs,correlationId,causationId,turnId});episode=finalized.episode;partial=Boolean(finalized.error);
      resumed=this.stack.resume(target,{evidenceRefs,sourceRevisionRefs});
      const resumedRecord=this.registry.resumeScene(target,evidenceRefs);
      this.graph.addRelationship({fromSceneId,toSceneId:target,relationship,evidenceRefs,provenance:[decision.candidateId]});
      const resumedScene=resumedRecord.snapshots.at(-1);
      this.#publish(SceneEventType.SCENE_OPENED,resumedScene,sourceRevisionRefs,{relationship,resumed:true,fromSceneId},{dedupeKey:`opened:${target}:${resumedScene.revision}`,correlationId,causationId,turnId});
      nextRecord=resumedRecord;
    }else if([SceneRelationship.FLASHBACK_OF,SceneRelationship.PARALLEL_TO,SceneRelationship.INTERRUPTS].includes(relationship)){
      this.registry.suspendScene(fromSceneId,evidenceRefs);this.stack.suspend(fromSceneId,{evidenceRefs});
      this.graph.addRelationship({fromSceneId,toSceneId:target,relationship,evidenceRefs,provenance:[decision.candidateId]});
      nextRecord=this.registry.openScene({sceneId:target,sourceRange,sourceRevisionRefs,parentSceneId:fromSceneId,relatedSceneIds:[fromSceneId],provenance:evidenceRefs});
      this.stack.open({sceneId:target,relationshipToPrior:relationship,parentSceneId:fromSceneId,interruptedSceneId:fromSceneId,sourceRevisionRefs,evidenceRefs});
      const nextScene=nextRecord.snapshots.at(-1);
      this.#publish(SceneEventType.SCENE_OPENED,nextScene,sourceRevisionRefs,{relationship,fromSceneId},{dedupeKey:`opened:${target}:1`,correlationId,causationId,turnId});
    }else{
      const finalized=this.#finalize(fromSceneId,{evidenceRefs,sourceRevisionRefs,correlationId,causationId,turnId});episode=finalized.episode;partial=Boolean(finalized.error);
      this.graph.addRelationship({fromSceneId,toSceneId:target,relationship,evidenceRefs,provenance:[decision.candidateId]});
      nextRecord=this.registry.openScene({sceneId:target,sourceRange,sourceRevisionRefs,parentSceneId:null,relatedSceneIds:[fromSceneId],provenance:evidenceRefs});
      this.stack.open({sceneId:target,relationshipToPrior:relationship,sourceRevisionRefs,evidenceRefs});
      const nextScene=nextRecord.snapshots.at(-1);
      this.#publish(SceneEventType.SCENE_OPENED,nextScene,sourceRevisionRefs,{relationship,fromSceneId},{dedupeKey:`opened:${target}:1`,correlationId,causationId,turnId});
    }

    let contextInvalidation=null;
    if(this.contextInvalidationPublisher){const nextScene=nextRecord.snapshots.at(-1);contextInvalidation=this.contextInvalidationPublisher.publish({fromSceneId,fromRevision:current.revision,toSceneId:target,toRevision:nextScene.revision,relationship,resumedSceneRef:relationship===SceneRelationship.RESUMES?{sceneId:target,fromRevision:resumedFromRevision,toRevision:nextScene.revision,sceneRevision:nextScene.revision}:null,sourceRevisionRefs,evidenceRefs,reason:relationship===SceneRelationship.RESUMES?'SCENE_RESUMED':'SCENE_TRANSITION'});}
    let prefetch=null;
    if(this.prefetchTrigger){
      const nextScene=nextRecord.snapshots.at(-1);prefetch=this.prefetchTrigger.recommend({sceneId:nextScene.sceneId,sceneRevision:nextScene.revision,trigger:`TRANSITION_${relationship}`,sceneRefs:[fromSceneId,target],priority:'HIGH',evidenceRefs,sourceRevisionRefs});
      this.#publish(SceneEventType.PREFETCH_RECOMMENDED,nextScene,sourceRevisionRefs,{recommendation:prefetch},{dedupeKey:prefetch.recommendationId,correlationId,causationId,turnId});
    }
    const result={status:partial?TransitionStatus.EPISODE_PENDING:TransitionStatus.COMPLETE,fromSceneId,toSceneId:target,relationship,episodeRef:episode?.artifactRef??null,nextSceneRevision:nextRecord.revision,prefetchRef:prefetch?.recommendationId??null,contextInvalidationId:contextInvalidation?.invalidationId??null,resumed:Boolean(resumed)};
    this.transitions.set(key,result);return clone(result);
  }

  exportState(){return clone({version:1,sequence:this.sequence,transitions:[...this.transitions.entries()]});}
  static importState(state,deps){const t=new ClapperboardTransitionManager(deps);t.sequence=state.sequence??0;t.transitions=new Map(state.transitions??[]);return t;}
}
