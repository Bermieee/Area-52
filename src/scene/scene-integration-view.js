import { createSceneIntegrationSignal, createSceneWhyReferences } from './integration-contracts.js';
import { createSceneUiReadModel } from './scene-ui-read-model.js';

const clone=(v)=>v==null?v:structuredClone(v);
const relationEdges=new Set(['SCENE_PRECEDES','SCENE_CONTINUES','SCENE_PARALLEL','SCENE_FLASHBACK','SCENE_INTERRUPTS','SCENE_RESUMES']);

function objectTransitionRefs(scene){
  const out=[];
  for(const item of scene.fields?.immediateObjects?.value??[]){
    const p=item.durableProposal;if(!p)continue;
    out.push(Object.freeze({kind:'ObjectTransitionReference',proposalId:p.proposalId??`object-transition:${scene.sceneId}:${scene.revision}:${item.objectId}:${item.state}`,sceneId:scene.sceneId,sceneRevision:scene.revision,objectRef:item.objectId,evidenceRefs:[...(item.evidenceRefs??[])],authority:'REFERENCE_ONLY'}));
  }
  return out;
}

function atmosphereRef(scene){
  const field=scene.fields?.atmosphere;if(!field||field.observationClass==='UNKNOWN')return null;
  return Object.freeze({kind:'SceneFieldReference',sceneId:scene.sceneId,sceneRevision:scene.revision,field:'atmosphere',observationClass:field.observationClass,evidenceRefs:[...(field.evidenceRefs??[])],canonical:false});
}

function previousSceneRef(runtime,sceneId){
  const edge=runtime.graph.neighbors(sceneId).filter((e)=>relationEdges.has(e.edgeType)&&e.toSceneId===sceneId).at(-1);
  if(!edge?.fromSceneId)return null;const scene=runtime.registry.current(edge.fromSceneId);return {sceneId:edge.fromSceneId,sceneRevision:scene?.revision??runtime.graph.nodes.get(edge.fromSceneId)?.revision??null,relationship:edge.edgeType};
}

function diagnosticRefs(runtime,scene,episodeRefs,objectRefs){
  const evidenceRefs=[...(scene.provenance??[]),...Object.values(scene.fields??{}).flatMap((x)=>x?.evidenceRefs??[])];
  const transitionIds=[...runtime.transitionManager.transitions.keys()].filter((x)=>x.includes(`:${scene.sceneId}:`)||x.endsWith(`:${scene.sceneId}`));
  const eventIds=[...runtime.publisher.dedupe.values()].filter((e)=>e.sceneId===scene.sceneId).map((e)=>e.eventId);
  const boundaryDecisionRefs=(runtime.sceneRuntime.boundaryVerifier.listDecisions?.()??[]).filter((d)=>d.sceneId===scene.sceneId).map((d)=>({kind:'SceneBoundaryDecisionReference',candidateId:d.candidateId,sceneId:d.sceneId,status:d.status,reasonCode:d.reason,evidenceRefs:[...(d.evidenceRefs??[])]}));
  return createSceneWhyReferences({evidenceRefs,sourceRevisionRefs:scene.sourceRevisionRefs??[],proposalIds:[...objectRefs.map((x)=>x.proposalId),...boundaryDecisionRefs.map((x)=>x.candidateId)],transitionIds,eventIds,artifactRefs:episodeRefs,boundaryDecisionRefs});
}

export function buildSceneIntegrationSignal(runtime,chatId){
  const sceneId=runtime.chatScenes.get(chatId);if(!sceneId)return null;
  const scene=runtime.registry.current(sceneId);if(!scene)return null;
  const record=runtime.registry.get(sceneId);const frame=runtime.stack.frames.find((x)=>x.sceneId===sceneId)??null;
  const episodes=runtime.episodeCompiler.list();const recentEpisodeRefs=episodes.slice(-4).map((x)=>x.artifactRef);
  const query=(scene.fields?.activeThreads?.value??[]).map((x)=>typeof x==='string'?x:JSON.stringify(x)).join(' ');
  const activeCast=scene.fields?.activeCast?.value??[];const location=scene.fields?.location?.value??null;
  const retrieval=runtime.retrieval.retrieve({query,activeEntityRefs:activeCast.filter((x)=>x.state==='PRESENT').map((x)=>x.characterId).filter(Boolean),locationRef:location?.location??location,currentSceneId:sceneId,limit:3});
  const prefetch=runtime.prefetchTrigger.active({sceneId,sceneRevision:scene.revision});const objectRefs=objectTransitionRefs(scene);
  const prev=previousSceneRef(runtime,sceneId);const resumed=frame?.relationshipToPrior==='RESUMES'?{sceneId,sceneRevision:scene.revision}:null;
  const diag=diagnosticRefs(runtime,scene,recentEpisodeRefs,objectRefs);
  const health=scene.health??{status:(scene.unresolvedFields??[]).length?'degraded':'ready',reasons:(scene.unresolvedFields??[]).length?['UNRESOLVED_FIELDS']:[]};
  return createSceneIntegrationSignal({
    sceneId,sceneRevision:scene.revision,sourceRevisionRefs:scene.sourceRevisionRefs??[],
    location,narrativeTime:scene.fields?.narrativeTime?.value??null,activeCast,castObservations:activeCast,
    activeThreads:scene.fields?.activeThreads?.value??[],objects:scene.fields?.immediateObjects?.value??[],
    uncertainFields:scene.unresolvedFields??[],conflictSignals:scene.unresolvedFields??[],boundaryState:scene.fields?.boundaryState?.value??null,
    sceneRelationship:frame?.relationshipToPrior??null,transitionType:frame?.relationshipToPrior??scene.fields?.boundaryState?.value?.type??null,
    previousSceneRef:prev,resumedSceneRef:resumed,latestEpisodeRef:recentEpisodeRefs.at(-1)??null,episodeRefs:recentEpisodeRefs,
    retrievalQuality:runtime.retrieval.quality(retrieval),prefetchRecommendations:prefetch,objectTransitionRefs:objectRefs,
    atmosphere:scene.fields?.atmosphere??null,atmosphereRef:atmosphereRef(scene),health,
    provenance:[...(scene.provenance??[]),...Object.values(scene.fields??{}).flatMap((x)=>x?.evidenceRefs??[])],diagnosticRefs:diag,
  });
}

export function buildSceneUiReadModel(runtime,chatId){
  const sceneId=runtime.chatScenes.get(chatId);if(!sceneId)return null;const scene=runtime.registry.current(sceneId);if(!scene)return null;
  const record=runtime.registry.get(sceneId);const frame=runtime.stack.frames.find((x)=>x.sceneId===sceneId)??null;
  const episodes=runtime.episodeCompiler.list();const latestEpisodeRef=episodes.at(-1)?.artifactRef??null;
  const prefetch=runtime.prefetchTrigger.active({sceneId,sceneRevision:scene.revision});
  const objectRefs=objectTransitionRefs(scene);const diag=diagnosticRefs(runtime,scene,episodes.slice(-4).map((x)=>x.artifactRef),objectRefs);
  return createSceneUiReadModel({scene,relationshipToPrior:frame?.relationshipToPrior??null,latestEpisodeRef,latestDelta:record?.deltas?.at(-1)??null,prefetchRecommendations:prefetch,diagnosticRefs:diag});
}

export function fanOutSceneInput(runtime,chatId){
  const signal=buildSceneIntegrationSignal(runtime,chatId);if(!signal)return null;
  return Object.freeze({
    kind:'SceneFanOutInput',contractVersion:'1.0.0',sceneId:signal.sceneId,sceneRevision:signal.sceneRevision,
    sourceRevisionSet:[...signal.sourceRevisionSet],activeCast:clone(signal.activeCast),location:clone(signal.location),
    activeThreads:clone(signal.activeThreads),uncertainSceneFields:[...signal.uncertainFields],conflictSignals:[...signal.conflictSignals],
    boundaryState:clone(signal.boundaryState),sceneRelationship:signal.sceneRelationship,sceneTransitionType:signal.transitionType,
    episodeRefs:clone(signal.episodeRefs),retrievalQuality:signal.retrievalQuality,prefetchRecommendations:clone(signal.prefetchRecommendations),
    objects:clone(signal.objects),authorityGranted:false,
  });
}
