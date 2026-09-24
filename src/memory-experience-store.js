import {
  AuthorityClass,
  HISTORIAN_COMPAT_VERSION,
  KnowledgeStatus,
  MEMORY_LIMITS,
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
    this.diagnostics=[];
    if (snapshot) this.restore(snapshot);
  }

  appendRawExperience(input={}) {
    return this.graph.appendEvidence({...input,kind:input.kind??MemoryArtifactKind.EXPERIENCE});
  }

  ingestSceneExperience(proposal,{summary=null,participants=[],knownBy=[],significance=0.5,timeStart=null,timeEnd=null}={}) {
    if (!proposal || proposal.kind!=='SceneExperienceProposal') throw new TypeError('SceneExperienceProposal required');
    if (proposal.contractVersion!=='1.0.0') throw new Error('MEMORY_SCENE_HANDOFF_CONTRACT_MISMATCH:'+String(proposal.contractVersion));
    if (proposal.authorityGranted || proposal.memoryMutationAuthority || proposal.settlementAuthority) throw new Error('MEMORY_SCENE_HANDOFF_AUTHORITY_VIOLATION');
    const logicalId=proposal.sceneEpisodeRef?.artifactId??proposal.sceneEpisodeRef?.id??('scene:'+proposal.sceneId);
    return this.publishEpisode({
      logicalId,
      sceneId:proposal.sceneId,
      sceneRevision:Number(proposal.sceneRevision),
      sourceRevisionRefs:proposal.sourceRevisionRefs??[],
      evidenceRefs:proposal.evidenceRefs??[],
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
    for (const id of evidence) if (!this.graph.evidenceRecord(id)) throw new Error('MEMORY_EPISODE_EVIDENCE_UNKNOWN:'+id);
    const history=this.episodeHistoryByLogical.get(logicalId)??[];
    const revision=history.length+1;
    const id='memory-episode:' + stableHash(logicalId+'|'+revision+'|'+sources.join('|')+'|'+evidence.join('|')+'|'+summary);
    const prior=currentRevisionFor(this.episodeHistoryByLogical,this.currentEpisodeByLogical,logicalId,this.episodes);
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
      freshness:freshBySources(this.graph,sources)?'FRESH':'STALE',
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
    const eps=uniqStrings(episodeRefs,MEMORY_LIMITS.maxEpisodesPerBatch);
    for (const id of eps) if (!this.episodes.has(id)) throw new Error('MEMORY_REFLECTION_EPISODE_UNKNOWN:'+id);
    const sources=uniqStrings([
      ...sourceRevisionRefs,
      ...support.map((id)=>this.graph.evidenceRecord(id)?.sourceRevisionId).filter(Boolean),
      ...eps.flatMap((id)=>this.episodes.get(id)?.sourceRevisionRefs??[]),
    ],MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact);
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
      const fresh=freshBySources(this.graph,episode.sourceRevisionRefs) && episode.evidenceRefs.every((id)=>this.graph.evidenceFresh(id));
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

  checkpoint({cursor=0,pendingWork=[]}={}) {
    return {
      kind:'MemoryConsolidationCheckpoint',
      cursor:Number(cursor),
      pendingWork:deepClone(pendingWork).slice(0,MEMORY_LIMITS.maxCheckpointWorkUnits),
      checksum:stableHash(stableStringify({cursor,pendingWork})),
      runtimeSchedulingAuthority:false,
      physicalWorkerAuthority:false,
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
