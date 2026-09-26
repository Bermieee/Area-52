import { ObservationClass, createFieldState } from './contracts.js';
import { createExperienceProposalFromScene } from './scene-memory-handoff.js';
const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values,limit=64)=>[...new Set((values??[]).filter(Boolean).map(String))].slice(-limit);

export class SceneOperatorService{
  constructor({runtime,maxHistoryRows=100}={}){
    if(!runtime?.registry||!runtime?.sceneRuntime)throw new TypeError('SceneOperatorService requires SceneLifecycleRuntime');
    this.runtime=runtime;this.maxHistoryRows=Math.max(10,Math.min(500,Number(maxHistoryRows)||100));
  }
  capabilities(){return Object.freeze({rescan:true,compare:true,correct:true,mergeSplitReview:true,episodeRepair:true,carryover:true,history:true,continuityWarnings:true,detectContinuityGaps:true,memoryPromotionPreview:true,characterMemoryPreview:true,mutationScope:'SCENE_LOCAL_ONLY',settlementAuthority:false,memoryMutationAuthority:false});}
  compare({sceneId,fromRevision,toRevision}={}){
    const record=this.runtime.registry.get(sceneId);if(!record)throw new Error('unknown Scene');
    const from=record.snapshots.find(x=>x.revision===fromRevision),to=record.snapshots.find(x=>x.revision===toRevision);if(!from||!to)throw new Error('requested Scene revision not retained');
    const changedFields=Object.keys({...from.fields,...to.fields}).filter(name=>JSON.stringify(from.fields?.[name]?.value)!==JSON.stringify(to.fields?.[name]?.value)||from.fields?.[name]?.observationClass!==to.fields?.[name]?.observationClass);
    return Object.freeze({kind:'SceneComparison',sceneId,fromRevision,toRevision,changedFields,changes:Object.fromEntries(changedFields.map(name=>[name,{before:clone(from.fields?.[name]??null),after:clone(to.fields?.[name]??null)}])),readOnly:true});
  }
  correct({sceneId,fieldName,value,evidenceRefs=[],observationClass=ObservationClass.OBSERVED,confidence=1}={}){
    const current=this.runtime.registry.current(sceneId);if(!current)throw new Error('unknown Scene');
    const state=value?.observationClass?value:createFieldState({value,revision:current.revision+1,evidenceRefs,observationClass,confidence});
    return this.runtime.sceneRuntime.correct({sceneId,fieldName,fieldState:state,evidenceRefs});
  }
  rescan({sceneId,fields,evidenceRefs=[],sourceRevisionRefs=[],provider='OPERATOR_RESCAN'}={}){
    const current=this.runtime.registry.current(sceneId);if(!current)throw new Error('unknown Scene');
    return this.runtime.sceneRuntime.observe({sceneId,proposalId:`operator-rescan:${sceneId}:${current.revision}`,fields,sourceRevisionRefs,evidenceRefs,provider,allowWhenRefreshRequired:true});
  }
  proposeMergeSplit({sceneIds=[],mode='MERGE',evidenceRefs=[]}={}){
    const normalized=uniq(sceneIds,16);if(!normalized.length)throw new TypeError('merge/split review needs Scene ids');
    return Object.freeze({kind:'SceneMergeSplitReviewProposal',proposalId:`scene-${String(mode).toLowerCase()}:${normalized.join('+')}`,mode:String(mode).toUpperCase(),sceneIds:normalized,evidenceRefs:uniq(evidenceRefs,64),authority:'REVIEW_ONLY',applied:false,settlementAuthority:false,contextSealAuthority:false,memoryMutationAuthority:false});
  }
  repairEpisode({sceneId,events=[],claims=[],evidenceRefs=[]}={}){
    const scene=this.runtime.registry.current(sceneId),record=this.runtime.registry.get(sceneId);if(!scene||!record)throw new Error('unknown Scene');
    this.runtime.episodeCompiler.invalidateScene(sceneId);
    const episode=this.runtime.episodeCompiler.compile({scene,record,sceneRelationships:this.runtime.graph.neighbors(sceneId),events,claims});
    return Object.freeze({kind:'SceneEpisodeRepairReceipt',sceneId,sceneRevision:scene.revision,episode:clone(episode),evidenceRefs:uniq(evidenceRefs,64),rawNarrativeDeleted:false,authority:'DERIVED_REPAIR',settlementAuthority:false});
  }
  carryover({sceneId}={}){
    const scene=this.runtime.registry.current(sceneId);if(!scene)throw new Error('unknown Scene');const f=scene.fields??{};
    const threads=(f.activeThreads?.value??[]).map(x=>typeof x==='string'?x:(x.threadId??x.id??null)).filter(Boolean);
    const objects=(f.immediateObjects?.value??[]).filter(x=>!['REMOVED','DESTROYED'].includes(String(x.state))).map(x=>x.objectId??x.objectRef).filter(Boolean);
    const relationships=(f.activeRelationships?.value??[]).map(x=>x.relationshipId??x.id??[x.from,x.kind,x.to].filter(Boolean).join(':')).filter(Boolean);
    return Object.freeze({kind:'SceneCarryoverProposal',sceneId,sceneRevision:scene.revision,unresolvedThreadRefs:uniq(threads,64),objectRefs:uniq(objects,64),relationshipRefs:uniq(relationships,64),sourceRevisionRefs:uniq(scene.sourceRevisionRefs,64),authority:'PROPOSAL',memoryMutationAuthority:false,settlementAuthority:false,promptInclusionAuthority:false});
  }
  continuityWarnings({sceneId}={}){
    const scene=this.runtime.registry.current(sceneId);if(!scene)return[];
    const warnings=(scene.unresolvedFields??[]).map(field=>({code:'UNRESOLVED_SCENE_FIELD',field}));
    for(const item of scene.fields?.immediateObjects?.value??[])if(item.state==='UNCERTAIN')warnings.push({code:'OBJECT_STATE_UNCERTAIN',objectId:item.objectId});
    return warnings.slice(0,64);
  }
  detectContinuityGaps({sceneId,expectedCharacterRefs=[],expectedObjectRefs=[]}={}){
    const scene=this.runtime.registry.current(sceneId);if(!scene)throw new Error('unknown Scene');
    const presentCharacters=new Set((scene.fields?.activeCast?.value??[]).filter(row=>(row.state??row.presence??'PRESENT')==='PRESENT').map(row=>String(row.characterId??row.characterRef??row.id??row)).filter(Boolean));
    const presentObjects=new Set((scene.fields?.immediateObjects?.value??[]).filter(row=>!['MENTIONED_ONLY','REMOVED','DESTROYED'].includes(String(row.state??'PRESENT'))).map(row=>String(row.objectId??row.objectRef??row.id??row)).filter(Boolean));
    const expectedCharacters=uniq(expectedCharacterRefs,64),expectedObjects=uniq(expectedObjectRefs,64);
    return Object.freeze({kind:'SceneContinuityGapReport',sceneId,sceneRevision:scene.revision,missingCharacterRefs:expectedCharacters.filter(ref=>!presentCharacters.has(ref)),missingObjectRefs:expectedObjects.filter(ref=>!presentObjects.has(ref)),presentCharacterRefs:[...presentCharacters].sort(),presentObjectRefs:[...presentObjects].sort(),sourceRevisionRefs:uniq(scene.sourceRevisionRefs,64),authority:'DIAGNOSTIC_ONLY',mutationAuthority:false,settlementAuthority:false});
  }
  previewMemoryPromotion({sceneId,episode=null}={}){
    const scene=this.runtime.registry.current(sceneId),record=this.runtime.registry.get(sceneId);if(!scene||!record)throw new Error('unknown Scene');
    const derived=episode??this.runtime.episodeCompiler.list().filter(row=>row.sceneId===sceneId).sort((a,b)=>a.sceneRevision-b.sceneRevision).at(-1)??this.runtime.episodeCompiler.compile({scene,record,sceneRelationships:this.runtime.graph.neighbors(sceneId)});
    const proposal=createExperienceProposalFromScene({scene,episode:derived,graph:this.runtime.graph,proposalId:`operator-memory-preview:${sceneId}:${scene.revision}`});
    return Object.freeze({kind:'SceneMemoryPromotionPreview',sceneId,sceneRevision:scene.revision,proposal:clone(proposal),reviewRequired:true,authority:'REVIEW_ONLY',memoryMutationAuthority:false,settlementAuthority:false,contextSealAuthority:false});
  }
  previewCharacterMemoryExtraction({sceneId,characterRefs=[]}={}){
    const scene=this.runtime.registry.current(sceneId);if(!scene)throw new Error('unknown Scene');
    const cast=scene.fields?.activeCast?.value??[],available=new Set(cast.filter(row=>(row.state??row.presence??'PRESENT')==='PRESENT').map(row=>String(row.characterId??row.characterRef??row.id??row)).filter(Boolean));
    const requested=uniq(characterRefs?.length?characterRefs:[...available],32).filter(ref=>available.has(ref));
    const unresolvedThreadRefs=uniq((scene.fields?.activeThreads?.value??[]).map(row=>typeof row==='string'?row:(row.threadId??row.id??null)).filter(Boolean),64);
    const objects=scene.fields?.immediateObjects?.value??[];
    const evidenceRefs=uniq([...(scene.sourceRevisionRefs??[]),...(scene.fields?.activeCast?.evidenceRefs??[]),...(scene.fields?.activeThreads?.evidenceRefs??[])],64);
    const items=requested.map(characterRef=>Object.freeze({characterRef,sceneId,sceneRevision:scene.revision,unresolvedThreadRefs:[...unresolvedThreadRefs],heldObjectRefs:uniq(objects.filter(row=>String(row.holderId??'')===characterRef&&!['REMOVED','DESTROYED'].includes(String(row.state))).map(row=>row.objectId??row.objectRef),32),evidenceRefs:[...evidenceRefs],authority:'PROPOSAL',memoryMutationAuthority:false}));
    return Object.freeze({kind:'SceneCharacterMemoryExtractionPreview',sceneId,sceneRevision:scene.revision,items,reviewRequired:true,sourceRevisionRefs:uniq(scene.sourceRevisionRefs,64),authority:'REVIEW_ONLY',memoryMutationAuthority:false,settlementAuthority:false});
  }
  history({offset=0,limit=25}={}){
    const all=this.runtime.registry.list().flatMap(record=>record.snapshots.map(snapshot=>({sceneId:record.sceneId,revision:snapshot.revision,lifecycle:snapshot.lifecycle,sourceRevisionRefs:uniq(snapshot.sourceRevisionRefs,16),unresolvedFields:[...(snapshot.unresolvedFields??[])],location:clone(snapshot.fields?.location?.value??null),updatedAt:snapshot.updatedAt}))).sort((a,b)=>(a.updatedAt??0)-(b.updatedAt??0));
    const start=Math.max(0,Number(offset)||0),cap=Math.max(1,Math.min(this.maxHistoryRows,Number(limit)||25));
    return Object.freeze({kind:'SceneHistoryPage',offset:start,limit:cap,total:all.length,items:clone(all.slice(start,start+cap)),hasMore:start+cap<all.length,readOnly:true});
  }
}
