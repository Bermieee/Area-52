import { ObservationClass, createFieldState } from './contracts.js';
import { SceneEventType } from './lifecycle-contracts.js';
import { createExperienceProposalFromScene } from './scene-memory-handoff.js';

const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values,limit=64)=>[...new Set((values??[]).filter(Boolean).map(String))].slice(-limit);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const refFor=(row,kind='item')=>{
  if(typeof row==='string')return row;
  if(!row||typeof row!=='object')return String(row??'');
  if(kind==='character')return String(row.characterId??row.characterRef??row.id??'');
  if(kind==='object')return String(row.objectId??row.objectRef??row.id??'');
  if(kind==='thread')return String(row.threadId??row.id??JSON.stringify(row));
  if(kind==='relationship')return String(row.relationshipId??row.id??[row.from,row.kind,row.to].filter(Boolean).join(':')??JSON.stringify(row));
  return String(row.id??JSON.stringify(row));
};
const mergeRows=(current,incoming,kind)=>{
  const map=new Map();
  for(const row of current??[]){const key=refFor(row,kind);if(key)map.set(key,clone(row));}
  for(const row of incoming??[]){const key=refFor(row,kind);if(key)map.set(key,clone(row));}
  return [...map.values()];
};

export class SceneOperatorService{
  constructor({runtime,maxHistoryRows=100}={}){
    if(!runtime?.registry||!runtime?.sceneRuntime)throw new TypeError('SceneOperatorService requires SceneLifecycleRuntime');
    this.runtime=runtime;
    this.maxHistoryRows=Math.max(10,Math.min(500,Number(maxHistoryRows)||100));
    this.mergeSplitReviews=new Map();
  }

  capabilities(){
    return Object.freeze({
      rescan:true,rebuild:true,compare:true,correct:true,
      mergeSplitReview:true,reviewMergeSplit:true,episodeRepair:true,
      carryover:true,applyCarryover:true,recoverMissedEntities:true,
      history:true,continuityWarnings:true,detectContinuityGaps:true,
      memoryPromotionPreview:true,characterMemoryPreview:true,
      mutationScope:'SCENE_LOCAL_ONLY',settlementAuthority:false,memoryMutationAuthority:false,
    });
  }

  #chatIdForScene(sceneId){
    for(const [chatId,currentSceneId] of this.runtime.chatScenes??[])if(currentSceneId===sceneId)return chatId;
    return null;
  }

  #freshness({sceneId,expectedSceneRevision=null,sourceRevisionRefs=[],chatId=null,requireOpen=false}={}){
    const current=this.runtime.registry.current(sceneId);
    if(!current)return{ok:false,status:'UNAVAILABLE',reason:'SCENE_UNAVAILABLE',scene:null,staleSourceRevisionRefs:[]};
    if(requireOpen&&current.lifecycle!=='OPEN')return{ok:false,status:'UNAVAILABLE',reason:'SCENE_NOT_OPEN',scene:current,staleSourceRevisionRefs:[]};
    if(expectedSceneRevision!=null&&Number(expectedSceneRevision)!==Number(current.revision)){
      return{ok:false,status:'STALE',reason:'SCENE_REVISION_STALE',scene:current,staleSourceRevisionRefs:[]};
    }
    const ownerChat=this.#chatIdForScene(sceneId);
    if(chatId&&ownerChat&&String(chatId)!==String(ownerChat)){
      return{ok:false,status:'UNAVAILABLE',reason:'SCENE_CHAT_MISMATCH',scene:current,staleSourceRevisionRefs:[]};
    }
    const activeChatId=String(this.runtime.narrativeFeed?.activeChatId??'').trim();
    if(chatId&&activeChatId&&String(chatId)!==activeChatId){
      return{ok:false,status:'UNAVAILABLE',reason:'CHAT_SELECTION_STALE',scene:current,staleSourceRevisionRefs:[]};
    }
    const resolvedChat=String(chatId??ownerChat??'').trim();
    const refs=uniq(sourceRevisionRefs,128);
    if(resolvedChat&&refs.length&&typeof this.runtime.narrativeFeed?.currentEvidence==='function'){
      const evidence=this.runtime.narrativeFeed.currentEvidence(resolvedChat)??[];
      if(evidence.length){
        const currentRefs=new Set(evidence.map(row=>String(row.sourceRevisionId??'')).filter(Boolean));
        const stale=refs.filter(ref=>!currentRefs.has(ref));
        if(stale.length)return{ok:false,status:'STALE',reason:'SOURCE_REVISION_STALE',scene:current,staleSourceRevisionRefs:stale};
      }
    }
    return{ok:true,status:'CURRENT',reason:null,scene:current,staleSourceRevisionRefs:[]};
  }

  #normalizeFields(fields,currentRevision,evidenceRefs=[]){
    const out={};
    for(const [name,value] of Object.entries(fields??{})){
      if(value?.observationClass){
        const refs=value.observationClass===ObservationClass.UNKNOWN?[]:uniq([...(value.evidenceRefs??[]),...evidenceRefs],64);
        out[name]=createFieldState({...value,revision:currentRevision+1,evidenceRefs:refs,provenance:value.observationClass===ObservationClass.UNKNOWN?[]:uniq([...(value.provenance??[]),...evidenceRefs],64)});
      }else{
        out[name]=createFieldState({value:clone(value),revision:currentRevision+1,evidenceRefs:uniq(evidenceRefs,64),observationClass:ObservationClass.OBSERVED,confidence:1,provenance:uniq(evidenceRefs,64)});
      }
    }
    return out;
  }

  #summary({sceneId,before,after,delta,operation,reason,evidenceRefs=[],sourceRevisionRefs=[],provider=null,blockedFields=[],extra={}}={}){
    const changedFields=Object.keys(delta?.changedFields??{}).sort();
    const changes=Object.fromEntries(changedFields.map((name)=>{
      const change=delta.changedFields[name]??{};
      return[name,{
        beforeRevision:change.before?.revision??before?.fields?.[name]?.revision??null,
        afterRevision:change.after?.revision??after?.fields?.[name]?.revision??null,
        beforeObservationClass:change.before?.observationClass??null,
        afterObservationClass:change.after?.observationClass??null,
        beforeEvidenceRefs:uniq(change.before?.evidenceRefs??[],64),
        afterEvidenceRefs:uniq(change.after?.evidenceRefs??[],64),
        before:clone(change.before?.value??null),
        after:clone(change.after?.value??null),
      }];
    }));
    return Object.freeze({
      kind:'SceneOperatorChangeSummary',
      sceneId,
      operation,
      fromRevision:before?.revision??delta?.fromRevision??null,
      toRevision:after?.revision??delta?.toRevision??before?.revision??null,
      revisionChanged:Number(after?.revision??before?.revision??0)!==Number(before?.revision??0),
      meaningful:changedFields.length>0,
      changedFields,
      changes,
      why:Object.freeze({
        reason:reason??delta?.reason??'SCENE_OPERATOR_ACTION',
        deltaReason:delta?.reason??null,
        provider,
        evidenceRefs:uniq(evidenceRefs,64),
        sourceRevisionRefs:uniq(sourceRevisionRefs,128),
        blockedFields:uniq(blockedFields,32),
        fullRefreshRequired:Boolean(delta?.fullRefreshRequired),
      }),
      ...clone(extra),
    });
  }

  #staleReceipt(sceneId,freshness,operation){
    return Object.freeze({
      kind:'SceneOperatorMutationReceipt',operation,status:freshness.status,applied:false,sceneId,
      sceneRevision:freshness.scene?.revision??null,reason:freshness.reason,
      staleSourceRevisionRefs:[...(freshness.staleSourceRevisionRefs??[])],
      authority:'SCENE_LOCAL_ONLY',settlementAuthority:false,contextSealAuthority:false,memoryMutationAuthority:false,
    });
  }

  compare({sceneId,fromRevision,toRevision}={}){
    const record=this.runtime.registry.get(sceneId);if(!record)throw new Error('unknown Scene');
    const from=record.snapshots.find(x=>x.revision===fromRevision),to=record.snapshots.find(x=>x.revision===toRevision);
    if(!from||!to)throw new Error('requested Scene revision not retained');
    const changedFields=Object.keys({...from.fields,...to.fields}).filter(name=>!same(from.fields?.[name]?.value,to.fields?.[name]?.value)||from.fields?.[name]?.observationClass!==to.fields?.[name]?.observationClass).sort();
    const relevantDeltas=(record.deltas??[]).filter(delta=>Number(delta.toRevision)>Number(fromRevision)&&Number(delta.toRevision)<=Number(toRevision));
    return Object.freeze({
      kind:'SceneComparison',sceneId,fromRevision,toRevision,changedFields,
      changes:Object.fromEntries(changedFields.map(name=>[name,{before:clone(from.fields?.[name]??null),after:clone(to.fields?.[name]??null)}])),
      why:relevantDeltas.map(delta=>({fromRevision:delta.fromRevision,toRevision:delta.toRevision,reason:delta.reason??null,evidenceRefs:uniq(delta.evidenceRefs??[],64),changedFields:Object.keys(delta.changedFields??{}).sort()})),
      readOnly:true,authority:'DESCRIPTIVE',settlementAuthority:false,
    });
  }

  correct({sceneId,fieldName,value,evidenceRefs=[],sourceRevisionRefs=[],observationClass=ObservationClass.OBSERVED,confidence=1,expectedSceneRevision=null,chatId=null,reason='OPERATOR_CORRECTION'}={}){
    const freshness=this.#freshness({sceneId,expectedSceneRevision,sourceRevisionRefs,chatId,requireOpen:true});
    if(!freshness.ok)return this.#staleReceipt(sceneId,freshness,'CORRECTION');
    const before=clone(freshness.scene);
    const state=value?.observationClass
      ? createFieldState({...value,revision:before.revision+1,evidenceRefs:value.observationClass===ObservationClass.UNKNOWN?[]:uniq([...(value.evidenceRefs??[]),...evidenceRefs],64),provenance:value.observationClass===ObservationClass.UNKNOWN?[]:uniq([...(value.provenance??[]),...evidenceRefs],64)})
      : createFieldState({value,revision:before.revision+1,evidenceRefs:uniq(evidenceRefs,64),observationClass,confidence,provenance:uniq(evidenceRefs,64)});
    const result=this.runtime.sceneRuntime.correct({sceneId,fieldName,fieldState:state,evidenceRefs});
    const publication=this.runtime.publishOperatorDelta?.({scene:result.scene,delta:result.delta,evidenceRefs,sourceRevisionRefs,operation:'CORRECTION',reason});
    const historyRef={
      sceneId,fieldName,sceneRevision:before.revision,fieldRevision:before.fields?.[fieldName]?.revision??null,
      observationClass:before.fields?.[fieldName]?.observationClass??null,evidenceRefs:uniq(before.fields?.[fieldName]?.evidenceRefs??[],64),
    };
    const changeSummary=this.#summary({sceneId,before,after:result.scene,delta:result.delta,operation:'CORRECTION',reason,evidenceRefs,sourceRevisionRefs,provider:'OPERATOR_CORRECTION',extra:{historyRefs:[historyRef]}});
    return Object.freeze({...result,kind:'SceneOperatorMutationReceipt',operation:'CORRECTION',status:'APPLIED',changeSummary,publication:clone(publication??null),historyPreserved:true,authority:'SCENE_LOCAL_ONLY',settlementAuthority:false,contextSealAuthority:false,memoryMutationAuthority:false});
  }

  rescan({sceneId,fields,evidenceRefs=[],sourceRevisionRefs=[],provider='OPERATOR_RESCAN',expectedSceneRevision=null,chatId=null,reason='OPERATOR_RESCAN',operation='RESCAN'}={}){
    const freshness=this.#freshness({sceneId,expectedSceneRevision,sourceRevisionRefs,chatId,requireOpen:true});
    if(!freshness.ok)return this.#staleReceipt(sceneId,freshness,operation);
    const before=clone(freshness.scene);
    if(!fields||!Object.keys(fields).length)return Object.freeze({kind:'SceneOperatorMutationReceipt',operation,status:'UNAVAILABLE',applied:false,sceneId,sceneRevision:before.revision,reason:'RESCAN_FIELDS_UNAVAILABLE',authority:'SCENE_LOCAL_ONLY',settlementAuthority:false,contextSealAuthority:false,memoryMutationAuthority:false});
    const normalizedFields=this.#normalizeFields(fields,before.revision,evidenceRefs);
    const result=this.runtime.sceneRuntime.observe({
      sceneId,proposalId:`operator-${String(operation).toLowerCase()}:${sceneId}:${before.revision}`,
      fields:normalizedFields,sourceRevisionRefs,evidenceRefs,provider,allowWhenRefreshRequired:true,
    });
    const publication=result.applied&&result.delta?this.runtime.publishOperatorDelta?.({scene:result.scene,delta:result.delta,evidenceRefs,sourceRevisionRefs,operation,reason}):null;
    const changeSummary=this.#summary({sceneId,before,after:result.scene??before,delta:result.delta,operation,reason,evidenceRefs,sourceRevisionRefs,provider,blockedFields:result.blockedFields??[]});
    const status=result.applied?'APPLIED':(result.noChange?'NO_CHANGE':'UNAVAILABLE');
    return Object.freeze({...result,kind:'SceneOperatorMutationReceipt',operation,status,changeSummary,publication:clone(publication??null),authority:'SCENE_LOCAL_ONLY',settlementAuthority:false,contextSealAuthority:false,memoryMutationAuthority:false});
  }

  rebuild(input={}){
    return this.rescan({...input,provider:input.provider??'OPERATOR_REBUILD',reason:input.reason??'OPERATOR_REBUILD',operation:'REBUILD'});
  }

  recoverMissedEntities({sceneId,characters=[],objects=[],evidenceRefs=[],sourceRevisionRefs=[],expectedSceneRevision=null,chatId=null}={}){
    const freshness=this.#freshness({sceneId,expectedSceneRevision,sourceRevisionRefs,chatId,requireOpen:true});
    if(!freshness.ok)return this.#staleReceipt(sceneId,freshness,'MISSED_ENTITY_RECOVERY');
    const current=freshness.scene;
    const recoveredCharacters=(characters??[]).map(row=>typeof row==='string'?{characterId:row,state:'PRESENT',evidenceRefs:uniq(evidenceRefs,64)}:{state:'PRESENT',...clone(row),evidenceRefs:uniq([...(row?.evidenceRefs??[]),...evidenceRefs],64)});
    const recoveredObjects=(objects??[]).map(row=>typeof row==='string'?{objectId:row,state:'PRESENT',evidenceRefs:uniq(evidenceRefs,64)}:{state:'PRESENT',...clone(row),evidenceRefs:uniq([...(row?.evidenceRefs??[]),...evidenceRefs],64)});
    const fields={};
    if(recoveredCharacters.length){
      const merged=mergeRows(current.fields?.activeCast?.value??[],recoveredCharacters,'character');
      if(!same(merged,current.fields?.activeCast?.value??[]))fields.activeCast=createFieldState({value:merged,revision:current.revision+1,evidenceRefs:uniq([...(current.fields?.activeCast?.evidenceRefs??[]),...evidenceRefs],64),observationClass:ObservationClass.OBSERVED,confidence:1,provenance:uniq([...(current.fields?.activeCast?.provenance??[]),...evidenceRefs],64)});
    }
    if(recoveredObjects.length){
      const merged=mergeRows(current.fields?.immediateObjects?.value??[],recoveredObjects,'object');
      if(!same(merged,current.fields?.immediateObjects?.value??[]))fields.immediateObjects=createFieldState({value:merged,revision:current.revision+1,evidenceRefs:uniq([...(current.fields?.immediateObjects?.evidenceRefs??[]),...evidenceRefs],64),observationClass:ObservationClass.OBSERVED,confidence:1,provenance:uniq([...(current.fields?.immediateObjects?.provenance??[]),...evidenceRefs],64)});
    }
    if(!Object.keys(fields).length){
      return Object.freeze({kind:'SceneOperatorMutationReceipt',operation:'MISSED_ENTITY_RECOVERY',status:'NO_CHANGE',applied:false,sceneId,sceneRevision:current.revision,recoveredCharacterRefs:uniq(recoveredCharacters.map(row=>refFor(row,'character')),64),recoveredObjectRefs:uniq(recoveredObjects.map(row=>refFor(row,'object')),64),authority:'SCENE_LOCAL_ONLY',settlementAuthority:false,contextSealAuthority:false,memoryMutationAuthority:false});
    }
    const result=this.rescan({sceneId,fields,evidenceRefs,sourceRevisionRefs,expectedSceneRevision:current.revision,chatId,provider:'OPERATOR_MISSED_ENTITY_RECOVERY',reason:'MISSED_ENTITY_RECOVERY',operation:'MISSED_ENTITY_RECOVERY'});
    return Object.freeze({...result,recoveredCharacterRefs:uniq(recoveredCharacters.map(row=>refFor(row,'character')),64),recoveredObjectRefs:uniq(recoveredObjects.map(row=>refFor(row,'object')),64)});
  }

  proposeMergeSplit({sceneIds=[],mode='MERGE',evidenceRefs=[]}={}){
    const normalized=uniq(sceneIds,16);
    const normalizedMode=String(mode).toUpperCase();
    if(!['MERGE','SPLIT'].includes(normalizedMode))throw new TypeError('merge/split mode must be MERGE or SPLIT');
    if(!normalized.length||(normalizedMode==='MERGE'&&normalized.length<2))throw new TypeError('merge/split review needs the required Scene ids');
    const sceneRefs=normalized.map(sceneId=>{
      const scene=this.runtime.registry.current(sceneId);if(!scene)throw new Error(`unknown Scene ${sceneId}`);
      return{sceneId,sceneRevision:scene.revision,lifecycle:scene.lifecycle,sourceRevisionRefs:uniq(scene.sourceRevisionRefs,64)};
    });
    const proposalId=`scene-${normalizedMode.toLowerCase()}:${sceneRefs.map(ref=>`${ref.sceneId}@${ref.sceneRevision}`).join('+')}`;
    const proposal=Object.freeze({
      kind:'SceneMergeSplitReviewProposal',proposalId,mode:normalizedMode,sceneIds:normalized,sceneRefs:clone(sceneRefs),
      evidenceRefs:uniq(evidenceRefs,64),authority:'REVIEW_ONLY',reviewRequired:true,ownerDecision:'PENDING',
      automaticSimilarityDecision:false,similarityScoreUsed:false,applied:false,mutationApplied:false,
      settlementAuthority:false,contextSealAuthority:false,memoryMutationAuthority:false,
    });
    this.mergeSplitReviews.set(proposalId,proposal);
    return proposal;
  }

  reviewMergeSplit({proposalId,proposal=null,decision='DEFER',evidenceRefs=[]}={}){
    const item=proposal??this.mergeSplitReviews.get(proposalId);
    if(!item||item.kind!=='SceneMergeSplitReviewProposal')return Object.freeze({kind:'SceneMergeSplitReviewReceipt',proposalId:proposalId??null,status:'UNAVAILABLE',ownerDecision:'UNAVAILABLE',mutationApplied:false,reason:'MERGE_SPLIT_PROPOSAL_UNAVAILABLE',authority:'REVIEW_ONLY',settlementAuthority:false});
    const ownerDecision=String(decision).toUpperCase();
    if(!['APPROVE','REJECT','DEFER'].includes(ownerDecision))throw new TypeError('merge/split review decision must be APPROVE, REJECT or DEFER');
    const staleRefs=(item.sceneRefs??[]).filter(ref=>Number(this.runtime.registry.current(ref.sceneId)?.revision)!==Number(ref.sceneRevision)).map(ref=>({sceneId:ref.sceneId,expectedRevision:ref.sceneRevision,currentRevision:this.runtime.registry.current(ref.sceneId)?.revision??null}));
    if(staleRefs.length)return Object.freeze({kind:'SceneMergeSplitReviewReceipt',proposalId:item.proposalId,status:'STALE',ownerDecision:'DEFER',staleSceneRefs:staleRefs,mutationApplied:false,automaticSimilarityDecision:false,reason:'SCENE_REVISION_STALE',authority:'REVIEW_ONLY',settlementAuthority:false,contextSealAuthority:false,memoryMutationAuthority:false});
    const receipt=Object.freeze({
      kind:'SceneMergeSplitReviewReceipt',proposalId:item.proposalId,mode:item.mode,sceneRefs:clone(item.sceneRefs),
      status:'REVIEWED',ownerDecision,reviewEvidenceRefs:uniq(evidenceRefs,64),
      reviewRequired:ownerDecision==='DEFER',requiresExplicitApply:ownerDecision==='APPROVE',
      automaticSimilarityDecision:false,similarityScoreUsed:false,mutationApplied:false,applied:false,
      authority:'REVIEW_ONLY',settlementAuthority:false,contextSealAuthority:false,memoryMutationAuthority:false,
    });
    this.mergeSplitReviews.set(item.proposalId,Object.freeze({...item,ownerDecision,reviewRequired:receipt.reviewRequired,reviewEvidenceRefs:receipt.reviewEvidenceRefs}));
    return receipt;
  }

  repairEpisode({sceneId,events=[],claims=[],evidenceRefs=[],sourceRevisionRefs=[],expectedSceneRevision=null}={}){
    const freshness=this.#freshness({sceneId,expectedSceneRevision,sourceRevisionRefs,requireOpen:false});
    if(!freshness.ok)return this.#staleReceipt(sceneId,freshness,'EPISODE_REPAIR');
    const scene=freshness.scene,record=this.runtime.registry.get(sceneId);if(!record)throw new Error('unknown Scene');
    const priorEpisodes=this.runtime.episodeCompiler.list().filter(row=>row.sceneId===sceneId).sort((a,b)=>a.sceneRevision-b.sceneRevision);
    const replacedEpisodeRefs=priorEpisodes.map(row=>clone(row.artifactRef??{episodeId:row.episodeId,sceneRevision:row.sceneRevision})).slice(-16);
    this.runtime.episodeCompiler.invalidateScene(sceneId);
    const episode=this.runtime.episodeCompiler.compile({scene,record,sceneRelationships:this.runtime.graph.neighbors(sceneId),events,claims});
    const event=this.runtime.publisher?.publish?.({
      eventType:SceneEventType.SCENE_EPISODE_READY,sceneId,sceneRevision:scene.revision,
      sourceRevisionRefs:uniq([...(scene.sourceRevisionRefs??[]),...sourceRevisionRefs],128),
      payload:{episodeRef:clone(episode.artifactRef),repair:true,replacesEpisodeRefs:clone(replacedEpisodeRefs)},
      dedupeKey:`operator-episode-repair:${sceneId}:${scene.revision}:${uniq(evidenceRefs,16).join('+')||'manual'}`,
    })??null;
    return Object.freeze({kind:'SceneEpisodeRepairReceipt',operation:'EPISODE_REPAIR',status:'REPAIRED',sceneId,sceneRevision:scene.revision,episode:clone(episode),episodeRef:clone(episode.artifactRef),replacesEpisodeRefs:clone(replacedEpisodeRefs),evidenceRefs:uniq(evidenceRefs,64),eventId:event?.eventId??null,rawNarrativeDeleted:false,authority:'DERIVED_REPAIR',settlementAuthority:false,contextSealAuthority:false,memoryMutationAuthority:false});
  }

  carryover({sceneId}={}){
    const scene=this.runtime.registry.current(sceneId);if(!scene)throw new Error('unknown Scene');const f=scene.fields??{};
    const threads=clone(f.activeThreads?.value??[]);
    const objects=(f.immediateObjects?.value??[]).filter(x=>!['REMOVED','DESTROYED'].includes(String(x.state)));
    const relationships=clone(f.activeRelationships?.value??[]);
    const threadRefs=threads.map(x=>refFor(x,'thread')).filter(Boolean);
    const objectRefs=objects.map(x=>refFor(x,'object')).filter(Boolean);
    const relationshipRefs=relationships.map(x=>refFor(x,'relationship')).filter(Boolean);
    return Object.freeze({
      kind:'SceneCarryoverProposal',sceneId,sceneRevision:scene.revision,
      unresolvedThreads:threads,relationshipStates:relationships,
      unresolvedThreadRefs:uniq(threadRefs,64),objectRefs:uniq(objectRefs,64),relationshipRefs:uniq(relationshipRefs,64),
      evidenceRefs:uniq([...(f.activeThreads?.evidenceRefs??[]),...(f.activeRelationships?.evidenceRefs??[])],64),
      sourceRevisionRefs:uniq(scene.sourceRevisionRefs,64),authority:'PROPOSAL',reviewRequired:false,
      memoryMutationAuthority:false,settlementAuthority:false,promptInclusionAuthority:false,
    });
  }

  applyCarryover({fromSceneId,toSceneId,evidenceRefs=[],sourceRevisionRefs=[],expectedSceneRevision=null,chatId=null}={}){
    const proposal=this.carryover({sceneId:fromSceneId});
    const freshness=this.#freshness({sceneId:toSceneId,expectedSceneRevision,sourceRevisionRefs,chatId,requireOpen:true});
    if(!freshness.ok)return this.#staleReceipt(toSceneId,freshness,'CARRYOVER');
    const destination=freshness.scene,fields={};
    const combinedEvidence=uniq([...(proposal.evidenceRefs??[]),...evidenceRefs],64);
    if(proposal.unresolvedThreads.length){
      const merged=mergeRows(destination.fields?.activeThreads?.value??[],proposal.unresolvedThreads,'thread');
      if(!same(merged,destination.fields?.activeThreads?.value??[]))fields.activeThreads=createFieldState({value:merged,revision:destination.revision+1,evidenceRefs:combinedEvidence,observationClass:ObservationClass.INFERRED,confidence:Math.min(.85,Number(destination.fields?.activeThreads?.confidence??.85)),provenance:combinedEvidence,metadata:{carryoverFromSceneId:fromSceneId,carryoverSourceRevision:proposal.sceneRevision}});
    }
    if(proposal.relationshipStates.length){
      const merged=mergeRows(destination.fields?.activeRelationships?.value??[],proposal.relationshipStates,'relationship');
      if(!same(merged,destination.fields?.activeRelationships?.value??[]))fields.activeRelationships=createFieldState({value:merged,revision:destination.revision+1,evidenceRefs:combinedEvidence,observationClass:ObservationClass.INFERRED,confidence:Math.min(.85,Number(destination.fields?.activeRelationships?.confidence??.85)),provenance:combinedEvidence,metadata:{carryoverFromSceneId:fromSceneId,carryoverSourceRevision:proposal.sceneRevision}});
    }
    if(!Object.keys(fields).length)return Object.freeze({kind:'SceneOperatorMutationReceipt',operation:'CARRYOVER',status:'NO_CHANGE',applied:false,sceneId:toSceneId,sceneRevision:destination.revision,carryoverProposal:proposal,authority:'SCENE_LOCAL_ONLY',settlementAuthority:false,contextSealAuthority:false,memoryMutationAuthority:false});
    const result=this.rescan({
      sceneId:toSceneId,fields,evidenceRefs:combinedEvidence,
      sourceRevisionRefs:uniq([...(proposal.sourceRevisionRefs??[]),...sourceRevisionRefs],128),
      expectedSceneRevision:destination.revision,chatId,provider:'SCENE_CARRYOVER',
      reason:'RELATIONSHIP_THREAD_CARRYOVER',operation:'CARRYOVER',
    });
    return Object.freeze({...result,carryoverFromSceneId:fromSceneId,carryoverProposal:proposal});
  }

  continuityWarnings({sceneId}={}){
    const scene=this.runtime.registry.current(sceneId);if(!scene)return[];
    const warnings=(scene.unresolvedFields??[]).map(field=>({code:'UNRESOLVED_SCENE_FIELD',field}));
    for(const [field,state] of Object.entries(scene.fields??{}))if(state?.metadata?.invalidatedBySourceEdit)warnings.push({code:'SOURCE_REVISION_INVALIDATED',field,previousEvidenceRefs:uniq(state.metadata.previousEvidenceRefs??[],32)});
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
    const all=this.runtime.registry.list().flatMap(record=>record.snapshots.map(snapshot=>({
      sceneId:record.sceneId,revision:snapshot.revision,lifecycle:snapshot.lifecycle,
      sourceRevisionRefs:uniq(snapshot.sourceRevisionRefs,16),unresolvedFields:[...(snapshot.unresolvedFields??[])],
      location:clone(snapshot.fields?.location?.value??null),updatedAt:snapshot.updatedAt,
    }))).sort((a,b)=>(a.updatedAt??0)-(b.updatedAt??0));
    const start=Math.max(0,Number(offset)||0),cap=Math.max(1,Math.min(this.maxHistoryRows,Number(limit)||25));
    return Object.freeze({kind:'SceneHistoryPage',offset:start,limit:cap,total:all.length,items:clone(all.slice(start,start+cap)),hasMore:start+cap<all.length,readOnly:true});
  }
}
