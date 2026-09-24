import { createArtifactRef, createSceneEpisode } from './lifecycle-contracts.js';

const clone=(v)=>structuredClone(v);
function stableDigest(value){const text=JSON.stringify(value);let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0');}
const field=(scene,name)=>scene.fields?.[name]??null;

export class SceneEpisodeCompiler{
  constructor(){this.cache=new Map();}
  key(scene){return `${scene.sceneId}@${scene.revision}:${[...(scene.sourceRevisionRefs??[])].sort().join(',')}`;}

  compile({scene,record=null,sceneRelationships=[],events=[],claims=[],stateTransitions=[],objectTransitions=[]}){
    if(!scene?.sceneId||!scene?.revision)throw new TypeError('scene/revision required');
    const key=this.key(scene);if(this.cache.has(key))return clone(this.cache.get(key));
    const participants=field(scene,'activeCast')?.value??[];
    const sceneObjects=field(scene,'immediateObjects')?.value??[];
    const location=field(scene,'location');
    const narrativeTime=field(scene,'narrativeTime');
    const relationships=field(scene,'activeRelationships')?.value??[];
    const threads=field(scene,'activeThreads')?.value??[];
    const atmosphere=field(scene,'atmosphere');
    const derivedStateTransitions=stateTransitions.length?stateTransitions:(record?.deltas??[]).flatMap((delta)=>Object.entries(delta.changedFields??{}).map(([fieldName,change])=>({field:fieldName,fromRevision:delta.fromRevision,toRevision:delta.toRevision,before:clone(change.before?.value??null),after:clone(change.after?.value??null),observationClass:change.after?.observationClass??'UNKNOWN',evidenceRefs:[...(change.after?.evidenceRefs??delta.evidenceRefs??[])]})));
    const derivedObjectTransitions=objectTransitions.length?objectTransitions:sceneObjects.filter((x)=>x.durableProposal).map((x)=>({objectId:x.objectId,state:x.state,holderId:x.holderId??null,containerId:x.containerId??null,proposal:clone(x.durableProposal),evidenceRefs:[...(x.evidenceRefs??[])],authority:'OBSERVED_SCENE_ONLY'}));
    const atmosphereTrajectory=(record?.snapshots??[]).map((snap)=>snap.fields?.atmosphere).filter((x)=>x&&x.observationClass!=='UNKNOWN').map((x)=>({revision:x.revision,observationClass:x.observationClass,value:clone(x.value),evidenceRefs:[...(x.evidenceRefs??[])]}));
    const observationSummary={};
    for(const [name,value] of Object.entries(scene.fields??{}))observationSummary[name]={observationClass:value.observationClass,confidence:value.confidence,evidenceRefs:[...(value.evidenceRefs??[])]};
    const episodeId=`episode:${scene.sceneId}:${scene.revision}`;
    const provenance=[...new Set([...(scene.provenance??[]),...(record?.provenance??[]),...Object.values(scene.fields??{}).flatMap((x)=>x.evidenceRefs??[])])];
    const compactSummary=[location?.value?.location??location?.value??null,participants.filter((x)=>x.state==='PRESENT').map((x)=>x.characterId).join(', '),threads.map?.((x)=>typeof x==='string'?x:JSON.stringify(x)).join('; ')].filter(Boolean).join(' | ');
    const base={episodeId,sceneId:scene.sceneId,sceneRevision:scene.revision,sourceRange:scene.sourceRange,sourceRevisionRefs:scene.sourceRevisionRefs??[],participants,location,narrativeTime,events,claims,relationshipSignals:relationships,stateTransitions:derivedStateTransitions,objectTransitions:derivedObjectTransitions,threadsOpened:threads,threadsResolved:[],threadsCarried:threads,atmosphereTrajectory:atmosphereTrajectory.length?atmosphereTrajectory:(atmosphere?[{revision:atmosphere.revision,observationClass:atmosphere.observationClass,value:atmosphere.value,evidenceRefs:atmosphere.evidenceRefs}]:[]),sceneRelationships,compactSummary,retrievalRefs:[],graphRefs:[],provenance,observationSummary};
    const digest=stableDigest(base);
    const artifactRef=createArtifactRef({artifactId:episodeId,artifactType:'SceneEpisode',revision:scene.revision,sourceRevisionRefs:scene.sourceRevisionRefs??[],sliceIdentity:`${scene.sceneId}:${scene.sourceRange?.start??'?' }-${scene.sourceRange?.end??'?'}`,digest,provenance});
    const episode=createSceneEpisode({...base,artifactRef});
    this.cache.set(key,episode);return clone(episode);
  }

  validateFreshness(episode,scene){if(!episode||!scene)return false;if(episode.sceneId!==scene.sceneId||episode.sceneRevision!==scene.revision)return false;const a=[...(episode.sourceRevisionRefs??[])].sort(),b=[...(scene.sourceRevisionRefs??[])].sort();return JSON.stringify(a)===JSON.stringify(b);}
  get(episodeId){for(const episode of this.cache.values())if(episode.episodeId===episodeId)return clone(episode);return null;}
  list(){return [...this.cache.values()].map(clone);}
  invalidateScene(sceneId){for(const key of [...this.cache.keys()])if(key.startsWith(`${sceneId}@`))this.cache.delete(key);}
  exportState(){return clone({version:1,episodes:[...this.cache.entries()]});}
  static importState(state){const c=new SceneEpisodeCompiler();for(const [k,v] of state.episodes??[])c.cache.set(k,v);return c;}
}
