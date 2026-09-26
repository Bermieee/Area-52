import { createSceneExperienceProposal, createSceneGraphReferenceSet } from './integration-contracts.js';

const edgeBucket=(edgeType)=>edgeType==='ENTITY_IN_SCENE'?'entityMembershipRefs':edgeType==='EVENT_IN_SCENE'?'eventMembershipRefs':edgeType==='OBJECT_IN_SCENE'?'objectMembershipRefs':edgeType==='THREAD_IN_SCENE'?'threadMembershipRefs':'relationshipRefs';

export function createGraphReferenceSetFromScene({graph,scene,episodeRefs=[]}={}){
  if(!graph||!scene)throw new TypeError('graph and scene are required');
  const refs={relationshipRefs:[],entityMembershipRefs:[],eventMembershipRefs:[],objectMembershipRefs:[],threadMembershipRefs:[]};
  for(const edge of graph.neighbors(scene.sceneId)){refs[edgeBucket(edge.edgeType)].push(edge.edgeId);}
  return createSceneGraphReferenceSet({sceneId:scene.sceneId,sceneRevision:scene.revision,episodeRefs,sourceRevisionRefs:scene.sourceRevisionRefs??[],provenance:scene.provenance??[],...refs});
}

export function createExperienceProposalFromScene({scene,episode,graph,proposalId=null}={}){
  if(!scene||!episode||!graph)throw new TypeError('scene, episode and graph are required');
  const graphReferenceSet=createGraphReferenceSetFromScene({graph,scene,episodeRefs:[episode.artifactRef]});
  return createSceneExperienceProposal({proposalId:proposalId??`scene-experience:${scene.sceneId}:${scene.revision}`,sceneId:scene.sceneId,sceneRevision:scene.revision,sceneEpisodeRef:episode.artifactRef,graphReferenceSet,sourceRevisionRefs:scene.sourceRevisionRefs??[],evidenceRefs:scene.provenance??[],provenance:episode.provenance??[]});
}
