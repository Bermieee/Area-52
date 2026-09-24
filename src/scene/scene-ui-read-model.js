import { ObservationClass } from './contracts.js';

const clone=(v)=>v==null?v:structuredClone(v);
const freeze=(v)=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
export const SceneUiHealth=Object.freeze({READY:'READY',WORKING:'WORKING',DEGRADED:'DEGRADED',STALE:'STALE',REBUILD_REQUIRED:'REBUILD_REQUIRED',ERROR:'ERROR'});
const ProductHealthMap=Object.freeze({READY:'READY',WORKING:'STUDYING',DEGRADED:'DEGRADED',STALE:'DEGRADED',REBUILD_REQUIRED:'BLOCKED',ERROR:'UNAVAILABLE'});
const GeneralStatusMap=Object.freeze({READY:'ready',WORKING:'loading',DEGRADED:'warning',STALE:'stale',REBUILD_REQUIRED:'warning',ERROR:'error'});
const healthRow=(state,reasons=[])=>({state,productHealth:ProductHealthMap[state],generalStatus:GeneralStatusMap[state],reasons});

function field(scene,name){return scene?.fields?.[name]??null;}
function health(scene){
  if(!scene)return healthRow(SceneUiHealth.ERROR,['SCENE_MISSING']);
  const reasons=[];if(scene.health?.status==='error')return healthRow(SceneUiHealth.ERROR,[...(scene.health?.reasons??['SCENE_ERROR'])]);
  if(Object.values(scene.fields??{}).some((x)=>x?.metadata?.invalidatedBySourceEdit)){reasons.push('SOURCE_EDIT_INVALIDATION');return healthRow(SceneUiHealth.REBUILD_REQUIRED,reasons);}
  if((scene.unresolvedFields??[]).length){reasons.push('UNRESOLVED_FIELDS');return healthRow(SceneUiHealth.DEGRADED,reasons);}
  if(!(scene.provenance??[]).length&&!(scene.sourceRevisionRefs??[]).length){reasons.push('PROVENANCE_MISSING');return {state:SceneUiHealth.DEGRADED,productHealth:'DEGRADED',reasons};}
  return healthRow(SceneUiHealth.READY,reasons);
}

export function createSceneUiReadModel({scene,relationshipToPrior=null,latestEpisodeRef=null,latestDelta=null,prefetchRecommendations=[],diagnosticRefs={}}={}){
  if(!scene?.sceneId||!scene?.revision)throw new TypeError('SceneUiReadModel requires scene identity/revision');
  const atmosphere=field(scene,'atmosphere');const objects=field(scene,'immediateObjects')?.value??[];
  return freeze({
    kind:'SceneUiReadModel',contractVersion:'1.0.0',sceneId:scene.sceneId,revision:scene.revision,lifecycle:scene.lifecycle,
    sourceRevisionRefs:[...(scene.sourceRevisionRefs??[])],
    location:clone(field(scene,'location')),narrativeTime:clone(field(scene,'narrativeTime')),
    activeCast:clone(field(scene,'activeCast')?.value??[]),activeThreads:clone(field(scene,'activeThreads')?.value??[]),objects:clone(objects),
    atmosphere:atmosphere?freeze({...clone(atmosphere),authority:'INFERRED_CONTEXT',canonical:false,inferred:atmosphere.observationClass===ObservationClass.INFERRED}):null,
    boundaryState:clone(field(scene,'boundaryState')),relationshipToPrior,latestEpisodeRef:clone(latestEpisodeRef),
    latestDeltaSummary:latestDelta?freeze({fromRevision:latestDelta.fromRevision,toRevision:latestDelta.toRevision,changedFields:Object.keys(latestDelta.changedFields??{}),reason:latestDelta.reason,fullRefreshRequired:Boolean(latestDelta.fullRefreshRequired)}):null,
    uncertainFields:[...(scene.unresolvedFields??[])],prefetchState:freeze({active:clone(prefetchRecommendations),count:prefetchRecommendations.length}),
    health:freeze(health(scene)),provenanceRefs:[...(scene.provenance??[])],diagnosticRefs:clone(diagnosticRefs),
    authority:'READ_ONLY',authorityGranted:false,mutationAuthority:false,settlementAuthority:false,contextSealBypass:false,
  });
}

export function isSceneUiReadModelFresh(model,{sceneId,revision}={}){return model?.kind==='SceneUiReadModel'&&model.sceneId===sceneId&&Number(model.revision)===Number(revision);}
