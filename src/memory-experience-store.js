import {
  AuthorityClass,
  HISTORIAN_COMPAT_VERSION,
  KnowledgeStatus,
  MEMORY_LIMITS,
  MEMORY_CONSOLIDATION_WORK_VERSION,
  MemoryArtifactKind,
  PerspectiveScope,
  deepClone,
  requiredString,
  stableHash,
  stableStringify,
  uniqStrings,
  unitNumber,
} from './memory-contracts.js';

function currentRevisionFor(historyMap,currentMap,key,artifacts) {
  const id=currentMap.get(key);
  return id?artifacts.get(id)??null:null;
}

function freshBySources(graph,sourceRevisionRefs) {
  return sourceRevisionRefs.every((id)=>graph.isSourceRevisionActive(id));
}

export class MemoryExperienceStore {
  constructor({graph,snapshot=null}={}) {
    if (!graph) throw new TypeError('MemoryExperienceStore requires TemporalStateGraph');
    this.graph=graph;
    this.episodes=new Map();
    this.episodeHistoryByLogical=new Map();
    this.currentEpisodeByLogical=new Map();
    this.reflections=new Map();
    this.reflectionHistoryByKey=new Map();
    this.currentReflectionByKey=new Map();
    this.sequence=0;
    this.reflectionSequence=0;
    this.consolidationSequence=0;
    this.consolidationSessions=new Map();
    this.diagnostics=[];
    if (snapshot) this.restore(snapshot);
  }

  appendRawExperience(input={}) {
    return this.graph.appendEvidence({...input,kind:input.kind??MemoryArtifactKind.EXPERIENCE});
  }

  ingestSceneExperience(proposal,{summary=null,participants=[],knownBy=[],significance=0.5,timeStart=null,timeEnd=null,bridgeResolution=null}={}) {
    if (!proposal || proposal.kind!=='SceneExperienceProposal') throw new TypeError('SceneExperienceProposal required');
    if (proposal.contractVersion!=='1.0.0') throw new Error('MEMORY_SCENE_HANDOFF_CONTRACT_MISMATCH:'+String(proposal.contractVersion));
    if (proposal.authorityGranted || proposal.memoryMutationAuthority || proposal.settlementAuthority) throw new Error('MEMORY_SCENE_HANDOFF_AUTHORITY_VIOLATION');
    const logicalId=proposal.sceneEpisodeRef?.artifactId??proposal.sceneEpisodeRef?.id??('scene:'+proposal.sceneId);
    return this.publishEpisode({
      logicalId,
      sceneId:proposal.sceneId,
      sceneRevision:Number(proposal.sceneRevision),
      sourceRevisionRefs:bridgeResolution?.memorySourceRevisionRefs??proposal.sourceRevisionRefs??[],
      evidenceRefs:bridgeResolution?.memoryEvidenceIds??proposal.evidenceRefs??[],
      externalEvidenceRefs:proposal.evidenceRefs??[],
      externalSourceRevisionRefs:proposal.sourceRevisionRefs??[],
      unresolvedExternalEvidenceRefs:bridgeResolution?.unresolvedEvidenceRefs??proposal.evidenceRefs??[],
      mappingRefs:bridgeResolution?.mappingIds??[],
      bridgeResolutionStatus:bridgeResolution?.status??null,
      bridgeReasonCodes:bridgeResolution?.details?.reasons??[],
      participants,
      knownBy,
      significance,
      timeStart,
      timeEnd,
      summary:summary??('Scene episode '+logicalId),
      sceneEpisodeRef:deepClone(proposal.sceneEpisodeRef),
      graphReferenceSet:deepClone(proposal.graphReferenceSet),
      provenance:deepClone(proposal.provenance??[]),
      admissionSource:'SCENE_EXPERIENCE_PROPOSAL',
    });
  }

  publishEpisode({
    logicalId,
    sceneId=null,
    sceneRevision=null,
    sourceRevisionRefs=[],
    evidenceRefs=[],
    externalEvidenceRefs=[],
    externalSourceRevisionRefs=[],
    unresolvedExternalEvidenceRefs=[],
    mappingRefs=[],
    bridgeResolutionStatus=null,
    bridgeReasonCodes=[],
    participants=[],
    knownBy=[],
    significance=0.5,
    timeStart=null,
    timeEnd=null,
    summary='',
    sceneEpisodeRef=null,
    graphReferenceSet=null,
    provenance=[],
    admissionSource='MEMORY_DIRECT',
  }={}) {
    requiredString(logicalId,'episode.logicalId');
    const sources=uniqStrings(sourceRevisionRefs,MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact);
    const evidence=uniqStrings(evidenceRefs,MEMORY_LIMITS.maxEpisodeEvidenceRefs);
    const unresolvedLocalEvidenceRefs=evidence.filter((id)=>!this.graph.evidenceRecord(id));
    const unresolvedExternal=uniqStrings(unresolvedExternalEvidenceRefs,MEMORY_LIMITS.maxEpisodeEvidenceRefs);
    const unresolvedEvidenceRefs=uniqStrings([...unresolvedLocalEvidenceRefs,...unresolvedExternal],MEMORY_LIMITS.maxEpisodeEvidenceRefs);
    const resolvedEvidenceRefs=evidence.filter((id)=>this.graph.evidenceRecord(id));
    const externalEvidence=uniqStrings(externalEvidenceRefs,MEMORY_LIMITS.maxEpisodeEvidenceRefs);
    const externalSources=uniqStrings(externalSourceRevisionRefs,MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact);
    const mappings=uniqStrings(mappingRefs,MEMORY_LIMITS.maxEvidenceRefsPerArtifact);
    const bridgeReasons=uniqStrings(bridgeReasonCodes,MEMORY_LIMITS.maxEvidenceRefsPerArtifact);
    const history=this.episodeHistoryByLogical.get(logicalId)??[];
    const publicationFingerprint=stableHash(stableStringify({
      logicalId,sceneId,sceneRevision,sources,evidence,externalEvidence,externalSources,unresolvedExternal,mappings,
      bridgeResolutionStatus,bridgeReasons,participants,knownBy,significance,timeStart,timeEnd,summary,
      sceneEpisodeRef,graphReferenceSet,admissionSource,
    }));
    const prior=currentRevisionFor(this.episodeHistoryByLogical,this.currentEpisodeByLogical,logicalId,this.episodes);
    if (prior&&prior.publicationFingerprint===publicationFingerprint) return deepClone(prior);
    const revision=history.length+1;
    const id='memory-episode:' + stableHash(logicalId+'|'+revision+'|'+publicationFingerprint);
    if (prior) {
      prior.state='HISTORICAL';
      prior.freshness='STALE';
      prior.replacedByEpisodeId=id;
    }
    const episode={
      kind:'MemoryEpisode',
      artifactType:MemoryArtifactKind.SCENE_EPISODE,
      id,
      logicalId,
      revision,
      sceneId:sceneId==null?null:String(sceneId),
      sceneRevision:sceneRevision==null?null:Number(sceneRevision),
      sourceRevisionRefs:sources,
      evidenceRefs:evidence,
      resolvedEvidenceRefs,
      unresolvedEvidenceRefs,
      externalEvidenceRefs:externalEvidence,
      externalSourceRevisionRefs:externalSources,
      unresolvedExternalEvidenceRefs:unresolvedExternal,
      mappingRefs:mappings,
      bridgeResolutionStatus,
      bridgeReasonCodes:bridgeReasons,
      participants:uniqStrings(participants,64),
      knownBy:uniqStrings(knownBy,64),
      significance:unitNumber(significance,'episode.significance'),
      timeBounds:{start:timeStart,end:timeEnd},
      summary:String(summary),
      sceneEpisodeRef:deepClone(sceneEpisodeRef),
      graphReferenceSet:deepClone(graphReferenceSet),
      provenance:deepClone(provenance),
      admissionSource,
      state:'CURRENT',
      freshness:(freshBySources(this.graph,sources)
        && unresolvedEvidenceRefs.length===0
        && resolvedEvidenceRefs.every((id)=>this.graph.evidenceFresh(id))
        && bridgeResolutionStatus!=='WITHHELD')?'FRESH':'STALE',
      publicationFingerprint,
      authorityClass:AuthorityClass.OBSERVED,
      currentWorldTruthAuthority:false,
      settlementAuthority:false,
      createdSequence:++this.sequence,
      replacedByEpisodeId:null,
    };
    this.episodes.set(id,episode);
    this.episodeHistoryByLogical.set(logicalId,[...history,id]);
    this.currentEpisodeByLogical.set(logicalId,id);
    return deepClone(episode);
  }

  reviseReflection({
    reflectionKey,
    statement,
    subjectRefs=[],
    supportEvidenceRefs=[],
    contradictionEvidenceRefs=[],
    episodeRefs=[],
    sourceRevisionRefs=[],
    confidence,
    action='REINFORCE',
    supersedesReflectionIds=[],
    splitFromReflectionId=null,
    provenance=[],
  }={}) {
    requiredString(reflectionKey,'reflectionKey');
    if (typeof statement!=='string'||!statement.trim()) throw new TypeError('reflection.statement required');
    const support=uniqStrings(supportEvidenceRefs,MEMORY_LIMITS.maxReflectionSupportRefs);
    const contradictions=uniqStrings(contradictionEvidenceRefs,MEMORY_LIMITS.maxReflectionContradictionRefs);
    for (const id of [...support,...contradictions]) if (!this.graph.evidenceRecord(id)) throw new Error('MEMORY_REFLECTION_EVIDENCE_UNKNOWN:'+id);
    for (const id of support) if (!this.graph.evidenceFresh(id)) throw new Error('MEMORY_REFLECTION_SUPPORT_STALE:'+id);
    const eps=uniqStrings(episodeRefs,MEMORY_LIMITS.maxEpisodesPerBatch);
    for (const id of eps) {
      const episode=this.episodes.get(id);
      if (!episode) throw new Error('MEMORY_REFLECTION_EPISODE_UNKNOWN:'+id);
      if (episode.freshness!=='FRESH' || episode.state!=='CURRENT') throw new Error('MEMORY_REFLECTION_EPISODE_STALE:'+id);
    }
    const sources=uniqStrings([
      ...sourceRevisionRefs,
      ...support.map((id)=>this.graph.evidenceRecord(id)?.sourceRevisionId).filter(Boolean),
      ...eps.flatMap((id)=>this.episodes.get(id)?.sourceRevisionRefs??[]),
    ],MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact);
    for (const sourceRevisionId of sources) if (!this.graph.isSourceRevisionActive(sourceRevisionId)) throw new Error('MEMORY_REFLECTION_SOURCE_STALE:'+sourceRevisionId);
    const history=this.reflectionHistoryByKey.get(reflectionKey)??[];
    const revision=history.length+1;
    const priorId=this.currentReflectionByKey.get(reflectionKey);
    const prior=priorId?this.reflections.get(priorId):null;
    const id='memory-reflection:' + stableHash(reflectionKey+'|'+revision+'|'+statement+'|'+support.join('|')+'|'+contradictions.join('|'));
    if (prior) {
      prior.state='HISTORICAL';
      prior.freshness='STALE';
      prior.supersededByReflectionId=id;
    }
    const reflection={
      kind:'MemoryReflection',
      artifactType:MemoryArtifactKind.REFLECTION,
      id,
      reflectionKey,
      revision,
      statement:statement.trim(),
      subjectRefs:uniqStrings(subjectRefs,64),
      supportEvidenceRefs:support,
      contradictionEvidenceRefs:contradictions,
      episodeRefs:eps,
      sourceRevisionRefs:sources,
      confidence:unitNumber(confidence,'reflection.confidence'),
      action:String(action),
      supersedesReflectionIds:uniqStrings([...supersedesReflectionIds,...(prior?[prior.id]:[])],64),
      splitFromReflectionId:splitFromReflectionId==null?null:String(splitFromReflectionId),
      provenance:deepClone(provenance),
      state:'CURRENT',
      freshness:freshBySources(this.graph,sources)?'FRESH':'STALE',
      authorityClass:AuthorityClass.INFERRED,
      truthStatus:KnowledgeStatus.INFERRED,
      worldTruthAuthority:false,
      characterStateMutation:false,
      settlementAuthority:false,
      createdSequence:++this.reflectionSequence,
      supersededByReflectionId:null,
    };
    this.reflections.set(id,reflection);
    this.reflectionHistoryByKey.set(reflectionKey,[...history,id]);
    this.currentReflectionByKey.set(reflectionKey,id);
    return deepClone(reflection);
  }

  reflectionFromGreenRoomProposal(proposal,{statement,confidence=0.5,reflectionKey=null}={}) {
    if (!proposal || proposal.kind!=='MemoryReflectionProposal' || proposal.authority!==AuthorityClass.INFERRED || proposal.durableMutation) {
      throw new Error('MEMORY_REFLECTION_PROPOSAL_INVALID');
    }
    return this.reviseReflection({
      reflectionKey:reflectionKey??('green-room:'+proposal.characterRef),
      statement,
      subjectRefs:[proposal.characterRef],
      supportEvidenceRefs:proposal.supportingEvidenceRefs,
      contradictionEvidenceRefs:proposal.contradictingEvidenceRefs,
      sourceRevisionRefs:proposal.sourceRevisionSet,
      confidence,
      action:'REINFORCE',
      provenance:[{kind:'GreenRoomReflectionDerivation',proposalId:proposal.proposalId,compatibleInferenceRefs:proposal.compatibleInferenceRefs}],
    });
  }

  refreshFreshness() {
    const staleEpisodes=[];
    const staleReflections=[];
    for (const episode of this.episodes.values()) {
      if (episode.state!=='CURRENT') continue;
      const unresolvedLocal=episode.evidenceRefs.filter((id)=>!this.graph.evidenceRecord(id));
      const unresolved=uniqStrings([
        ...unresolvedLocal,
        ...(episode.bridgeResolutionStatus==='WITHHELD'?(episode.unresolvedExternalEvidenceRefs??[]):[]),
      ],MEMORY_LIMITS.maxEpisodeEvidenceRefs);
      episode.unresolvedEvidenceRefs=unresolved;
      episode.resolvedEvidenceRefs=episode.evidenceRefs.filter((id)=>this.graph.evidenceRecord(id));
      const fresh=freshBySources(this.graph,episode.sourceRevisionRefs)
        && unresolved.length===0
        && episode.resolvedEvidenceRefs.every((id)=>this.graph.evidenceFresh(id))
        && episode.bridgeResolutionStatus!=='WITHHELD';
      if (!fresh) {
        episode.freshness='STALE';
        staleEpisodes.push(episode.id);
      }
    }
    for (const reflection of this.reflections.values()) {
      if (reflection.state!=='CURRENT') continue;
      const episodeFresh=reflection.episodeRefs.every((id)=>this.episodes.get(id)?.freshness==='FRESH');
      const evidenceFresh=reflection.supportEvidenceRefs.every((id)=>this.graph.evidenceFresh(id));
      const sourceFresh=freshBySources(this.graph,reflection.sourceRevisionRefs);
      if (!(episodeFresh&&evidenceFresh&&sourceFresh)) {
        reflection.freshness='STALE';
        staleReflections.push(reflection.id);
      }
    }
    return {staleEpisodes:staleEpisodes.sort(),staleReflections:staleReflections.sort()};
  }

  currentEpisodes({freshOnly=true}={}) {
    this.refreshFreshness();
    return [...this.currentEpisodeByLogical.values()].map((id)=>this.episodes.get(id)).filter(Boolean)
      .filter((row)=>!freshOnly||row.freshness==='FRESH').map(deepClone)
      .sort((a,b)=>a.createdSequence-b.createdSequence);
  }

  currentReflections({freshOnly=true}={}) {
    this.refreshFreshness();
    return [...this.currentReflectionByKey.values()].map((id)=>this.reflections.get(id)).filter(Boolean)
      .filter((row)=>!freshOnly||row.freshness==='FRESH').map(deepClone)
      .sort((a,b)=>a.createdSequence-b.createdSequence);
  }

  episodeHistory(logicalId) {
    return (this.episodeHistoryByLogical.get(logicalId)??[]).map((id)=>deepClone(this.episodes.get(id)));
  }

  reflectionHistory(reflectionKey) {
    return (this.reflectionHistoryByKey.get(reflectionKey)??[]).map((id)=>deepClone(this.reflections.get(id)));
  }

  artifact(id) {
    return deepClone(this.episodes.get(id)??this.reflections.get(id)??null);
  }

  exactDrillback(artifactId) {
    const artifact=this.episodes.get(artifactId)??this.reflections.get(artifactId);
    if (!artifact) return [];
    const evidenceIds=artifact.evidenceRefs??artifact.supportEvidenceRefs??[];
    return evidenceIds.map((id)=>this.graph.exactEvidence(id)).filter(Boolean);
  }

  memoryRevisionRefs() {
    const latestEpisode=[...this.currentEpisodeByLogical.values()].sort().at(-1)??null;
    const latestReflection=[...this.currentReflectionByKey.values()].sort().at(-1)??null;
    return [
      'memory-experience:' + stableHash(stableStringify({sequence:this.sequence,latestEpisode})),
      'memory-reflection:' + stableHash(stableStringify({sequence:this.reflectionSequence,latestReflection})),
    ];
  }

  startConsolidation(jobs=[],options={}) {
    if (!Array.isArray(jobs)) throw new TypeError('consolidation jobs must be an array');
    if (jobs.length>MEMORY_LIMITS.maxConsolidationJobs) throw new RangeError('Memory consolidation job count exceeds bound');
    const explicitSources=uniqStrings(options.sourceRevisionRefs??[],MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact);
    const jobSources=uniqStrings(jobs.flatMap((job)=>[
      ...(job?.input?.sourceRevisionRefs??[]),
      ...(job?.input?.supportEvidenceRefs??[]).map((id)=>this.graph.evidenceRecord(id)?.sourceRevisionId).filter(Boolean),
      ...(job?.input?.contradictionEvidenceRefs??[]).map((id)=>this.graph.evidenceRecord(id)?.sourceRevisionId).filter(Boolean),
    ]),MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact);
    const sourceRevisionRefs=uniqStrings([...explicitSources,...jobSources],MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact);
    const generation=options.generationFence??options.selection??{};
    const generationFence={
      chatId:generation.chatId??generation.chatNamespace??null,
      turnId:generation.turnId??null,
      generationId:generation.generationId??null,
      correlationId:generation.correlationId??null,
      contextSealId:generation.contextSealId??null,
    };
    const inputRevisionFence={
      sourceRevisionRefs,
      worldRevision:options.worldRevision==null?null:Number(options.worldRevision),
      sceneRevision:options.sceneRevision==null?null:Number(options.sceneRevision),
      revisionToken:options.revisionToken??stableHash(stableStringify({
        sourceRevisionRefs,
        worldRevision:options.worldRevision??null,
        sceneRevision:options.sceneRevision??null,
      })),
    };
    const id='memory-consolidation:' + stableHash(String(++this.consolidationSequence)+'|'+stableStringify(jobs)+'|'+stableStringify(inputRevisionFence)+'|'+stableStringify(generationFence));
    const session={
      kind:'MemoryConsolidationSession',
      contractVersion:MEMORY_CONSOLIDATION_WORK_VERSION,
      id,
      state:'ACTIVE',
      cursor:0,
      jobs:deepClone(jobs),
      publishedArtifactIds:[],
      failures:[],
      checkpoint:null,
      inputRevisionFence,
      generationFence,
      lateDisposition:null,
      runtimeSchedulingAuthority:false,
      physicalWorkerAuthority:false,
      foregroundPublicationAuthority:false,
      contextSealAuthority:false,
    };
    this.consolidationSessions.set(id,session);
    return deepClone(session);
  }

  consolidationWorkUnits(sessionId,{maxUnits=MEMORY_LIMITS.maxCheckpointWorkUnits}={}) {
    const session=this.consolidationSessions.get(sessionId);
    if (!session) throw new Error('Unknown Memory consolidation session: '+sessionId);
    const cap=Math.max(1,Math.min(MEMORY_LIMITS.maxCheckpointWorkUnits,Number(maxUnits)||1));
    return session.jobs.slice(session.cursor,session.cursor+cap).map((job,offset)=>({
      kind:'MemoryConsolidationWorkUnit',
      contractVersion:MEMORY_CONSOLIDATION_WORK_VERSION,
      workUnitId:'memory-consolidation-unit:'+stableHash(session.id+'|'+String(session.cursor+offset)+'|'+session.inputRevisionFence.revisionToken),
      sessionId:session.id,
      cursor:session.cursor+offset,
      jobType:job?.type??null,
      inputRevisionFence:deepClone(session.inputRevisionFence),
      generationFence:deepClone(session.generationFence),
      runtimeSchedulingAuthority:false,
      physicalWorkerAuthority:false,
      foregroundPublicationAuthority:false,
      contextSealAuthority:false,
      canonicalMutationAuthority:false,
    }));
  }

  consolidationFenceStatus(session,{sealed=false,sealedGenerationIds=[],currentSourceRevisionRefs=null}={}) {
    const sealedIds=new Set((sealedGenerationIds??[]).map(String));
    const generationId=session?.generationFence?.generationId;
    if (sealed===true||(generationId&&sealedIds.has(String(generationId)))) {
      return {ok:false,state:'PARKED_AFTER_SEAL',reasonCode:'MEMORY_CONSOLIDATION_GENERATION_SEALED',destination:'NEXT_TURN'};
    }
    const expected=session?.inputRevisionFence?.sourceRevisionRefs??[];
    const active=currentSourceRevisionRefs==null
      ? new Set([...this.graph.sourceRevisionState.entries()].filter(([,row])=>row?.state==='ACTIVE').map(([id])=>id))
      : new Set(currentSourceRevisionRefs);
    const stale=expected.filter((id)=>!active.has(id));
    if(stale.length) return {ok:false,state:'STALE',reasonCode:'MEMORY_CONSOLIDATION_INPUT_REVISION_STALE',staleSourceRevisionRefs:stale,destination:'RECOMPUTE'};
    return {ok:true,state:'FRESH',reasonCode:null,destination:'DURABLE_MEMORY'};
  }

  runConsolidation(sessionId,{maxUnits=MEMORY_LIMITS.maxCheckpointWorkUnits,sealed=false,sealedGenerationIds=[],currentSourceRevisionRefs=null}={}) {
    const session=this.consolidationSessions.get(sessionId);
    if (!session) throw new Error('Unknown Memory consolidation session: '+sessionId);
    if (session.state==='COMPLETED') return deepClone(session);
    const fence=this.consolidationFenceStatus(session,{sealed,sealedGenerationIds,currentSourceRevisionRefs});
    if(!fence.ok){
      session.state=fence.state;
      session.lateDisposition={
        reasonCode:fence.reasonCode,
        destination:fence.destination,
        generationId:session.generationFence?.generationId??null,
        foregroundEligible:false,
        contextSealMutation:false,
        staleSourceRevisionRefs:[...(fence.staleSourceRevisionRefs??[])],
      };
      return deepClone(session);
    }
    if(session.state==='PARKED_AFTER_SEAL'||session.state==='STALE')session.state='ACTIVE';
    session.lateDisposition=null;
    const limit=Math.max(1,Math.min(MEMORY_LIMITS.maxCheckpointWorkUnits,Number(maxUnits)||1));
    let used=0;
    while (session.cursor<session.jobs.length && used<limit) {
      const liveFence=this.consolidationFenceStatus(session,{sealed,sealedGenerationIds,currentSourceRevisionRefs});
      if(!liveFence.ok){
        session.state=liveFence.state;
        session.lateDisposition={
          reasonCode:liveFence.reasonCode,destination:liveFence.destination,
          generationId:session.generationFence?.generationId??null,foregroundEligible:false,contextSealMutation:false,
          staleSourceRevisionRefs:[...(liveFence.staleSourceRevisionRefs??[])],
        };
        break;
      }
      const job=session.jobs[session.cursor];
      try {
        if (job.type!=='REFLECTION') throw new Error('MEMORY_CONSOLIDATION_JOB_UNSUPPORTED:'+String(job.type));
        const artifact=this.reviseReflection(job.input??{});
        if(!session.publishedArtifactIds.includes(artifact.id))session.publishedArtifactIds.push(artifact.id);
      } catch (error) {
        session.failures.push({cursor:session.cursor,code:error?.message??String(error)});
      }
      session.cursor+=1;
      used+=1;
      session.checkpoint={
        cursor:session.cursor,
        total:session.jobs.length,
        inputRevisionFence:deepClone(session.inputRevisionFence),
        generationFence:deepClone(session.generationFence),
        checksum:stableHash(stableStringify({
          cursor:session.cursor,
          publishedArtifactIds:session.publishedArtifactIds,
          failures:session.failures,
          inputRevisionFence:session.inputRevisionFence,
          generationFence:session.generationFence,
        })),
      };
    }
    if(session.state!=='PARKED_AFTER_SEAL'&&session.state!=='STALE')session.state=session.cursor>=session.jobs.length?'COMPLETED':'CHECKPOINTED';
    return deepClone(session);
  }

  checkpoint({cursor=0,pendingWork=[],inputRevisionFence=null,generationFence=null}={}) {
    return {
      kind:'MemoryConsolidationCheckpoint',
      contractVersion:MEMORY_CONSOLIDATION_WORK_VERSION,
      cursor:Number(cursor),
      pendingWork:deepClone(pendingWork).slice(0,MEMORY_LIMITS.maxCheckpointWorkUnits),
      inputRevisionFence:deepClone(inputRevisionFence),
      generationFence:deepClone(generationFence),
      checksum:stableHash(stableStringify({cursor,pendingWork,inputRevisionFence,generationFence})),
      runtimeSchedulingAuthority:false,
      physicalWorkerAuthority:false,
      foregroundPublicationAuthority:false,
      contextSealAuthority:false,
    };
  }

  snapshot() {
    return {
      kind:'MemoryExperienceStoreSnapshot',
      episodes:[...this.episodes.values()].map(deepClone),
      episodeHistoryByLogical:[...this.episodeHistoryByLogical.entries()].map(([k,v])=>[k,[...v]]),
      currentEpisodeByLogical:[...this.currentEpisodeByLogical.entries()],
      reflections:[...this.reflections.values()].map(deepClone),
      reflectionHistoryByKey:[...this.reflectionHistoryByKey.entries()].map(([k,v])=>[k,[...v]]),
      currentReflectionByKey:[...this.currentReflectionByKey.entries()],
      sequence:this.sequence,
      reflectionSequence:this.reflectionSequence,
      consolidationSequence:this.consolidationSequence,
      consolidationSessions:[...this.consolidationSessions.entries()].map(([id,row])=>[id,deepClone(row)]),
      diagnostics:deepClone(this.diagnostics),
    };
  }

  restore(snapshot) {
    this.episodes=new Map((snapshot?.episodes??[]).map((row)=>[row.id,deepClone(row)]));
    this.episodeHistoryByLogical=new Map((snapshot?.episodeHistoryByLogical??[]).map(([k,v])=>[k,[...v]]));
    this.currentEpisodeByLogical=new Map(snapshot?.currentEpisodeByLogical??[]);
    this.reflections=new Map((snapshot?.reflections??[]).map((row)=>[row.id,deepClone(row)]));
    this.reflectionHistoryByKey=new Map((snapshot?.reflectionHistoryByKey??[]).map(([k,v])=>[k,[...v]]));
    this.currentReflectionByKey=new Map(snapshot?.currentReflectionByKey??[]);
    this.sequence=Number(snapshot?.sequence??0);
    this.reflectionSequence=Number(snapshot?.reflectionSequence??0);
    this.consolidationSequence=Number(snapshot?.consolidationSequence??0);
    this.consolidationSessions=new Map((snapshot?.consolidationSessions??[]).map(([id,row])=>[id,deepClone(row)]));
    this.diagnostics=deepClone(snapshot?.diagnostics??[]).slice(-MEMORY_LIMITS.maxDiagnostics);
  }
}

export function historianArtifactReference(artifact) {
  return {
    artifactId:artifact.id,
    artifactType:artifact.artifactType,
    owner:'MEMORY',
    revision:artifact.revision,
    domain:'MEMORY',
    sourceRevisionSet:[...(artifact.sourceRevisionRefs??[])],
    worldRevision:null,
    sceneRevision:artifact.sceneRevision??null,
    contentHash:stableHash(artifact.summary??artifact.statement??artifact.id),
    provenanceRef:'memory-provenance:'+artifact.id,
    authorityGranted:false,
  };
}
