import {
  MEMORY_API_VERSION,
  MEMORY_CONTRACT_VERSION,
  MEMORY_LIMITS,
  deepClone,
  stableHash,
  stableStringify,
} from './memory-contracts.js';
import {TemporalStateGraph} from './memory-temporal-state-graph.js';
import {MemoryGreenRoomStore} from './memory-green-room.js';
import {MemoryExperienceStore} from './memory-experience-store.js';
import {MemoryHistorianIndex} from './memory-historian.js';
import {MemorySummaryHierarchy} from './memory-summary-hierarchy.js';
import {MemoryExternalEvidenceBridge} from './memory-evidence-bridge.js';
import {
  MemoryUiReadModelProducer,
  evidenceBelongsToChat,
  normalizeMemorySelection,
} from './memory-ui-read-model.js';

export class MemoryTemporalProducer {
  constructor({
    graph=new TemporalStateGraph(),
    greenRoom=new MemoryGreenRoomStore(),
    experienceStore=null,
    historian=null,
    summaryHierarchy=null,
    evidenceBridge=null,
    uiReadModel=null,
    snapshot=null,
  }={}) {
    this.graph=graph;
    this.greenRoom=greenRoom;
    this.experienceStore=experienceStore??new MemoryExperienceStore({graph});
    this.historian=historian??new MemoryHistorianIndex({graph,experienceStore:this.experienceStore});
    this.summaryHierarchy=summaryHierarchy??new MemorySummaryHierarchy({graph:this.graph,experienceStore:this.experienceStore});
    this.evidenceBridge=evidenceBridge??new MemoryExternalEvidenceBridge({graph:this.graph});
    this.uiReadModel=uiReadModel??new MemoryUiReadModelProducer({producer:this});
    this.diagnostics=[];
    if (snapshot) this.restore(snapshot);
  }

  selectionFromEvidenceRefs(evidenceRefs=[]) {
    const rows=[...new Set(evidenceRefs)].map((id)=>this.graph.evidenceRecord(id)).filter(Boolean);
    if (!rows.length) return {};
    const identities=rows.map((row)=>row.metadata??{});
    const common=(keys)=>{
      const values=identities.map((meta)=>{
        for (const key of keys) if (meta?.[key]!=null&&String(meta[key]).length) return String(meta[key]);
        return null;
      }).filter(Boolean);
      return values.length&&new Set(values).size===1?values[0]:null;
    };
    return {
      chatId:common(['chatId','chatNamespace','conversationId']),
      turnId:common(['turnId']),
      generationId:common(['generationId']),
      correlationId:common(['correlationId']),
      worldRevision:Math.max(...rows.map((row)=>Number(row.worldRevision??0))),
      sceneRevision:Math.max(...rows.map((row)=>Number(row.sceneRevision??0)).filter(Number.isFinite),0)||null,
      sourceRevisionRefs:[...new Set(rows.map((row)=>row.sourceRevisionId))].sort().slice(0,MEMORY_LIMITS.maxSourceRevisionRefsPerArtifact),
    };
  }

  notifyUi(type,evidenceRefs=[],details={}) {
    return this.uiReadModel.notify(type,this.selectionFromEvidenceRefs(evidenceRefs),details);
  }

  appendEvidence(input) {
    const evidence=this.graph.appendEvidence(input);
    this.summaryHierarchy.onEvidenceAppended(evidence);
    this.notifyUi('MEMORY_EVIDENCE_APPENDED',[evidence.id],{evidenceId:evidence.id});
    return evidence;
  }

  appendRawExperience(input) {
    const evidence=this.experienceStore.appendRawExperience(input);
    this.summaryHierarchy.onEvidenceAppended(evidence);
    this.notifyUi('MEMORY_EXPERIENCE_APPENDED',[evidence.id],{evidenceId:evidence.id});
    return evidence;
  }

  ingestSceneExperience(proposal,options={}) {
    const record=this.evidenceBridge.registerSceneProposal(proposal,options);
    return this.refreshSceneExperienceProposal(record.proposalId,{currentSceneRevision:options.currentSceneRevision??null});
  }

  refreshSceneExperienceProposal(proposalId,{currentSceneRevision=null}={}) {
    const record=this.evidenceBridge.sceneProposals.get(proposalId);
    if (!record) throw new Error('MEMORY_SCENE_PROPOSAL_UNKNOWN:'+String(proposalId));
    const resolution=this.evidenceBridge.resolveSceneProposal(proposalId,{currentSceneRevision});
    const episode=this.experienceStore.ingestSceneExperience(record.proposal,{
      ...(record.options??{}),
      bridgeResolution:resolution,
    });
    this.summaryHierarchy.onEpisodePublished(episode);
    if (episode.freshness==='FRESH'&&resolution.status==='RESOLVED') this.ensureSceneSummaryScope(record.proposal,episode,resolution);
    this.historian.build();
    this.notifyUi('MEMORY_SCENE_EPISODE_REFRESHED',episode.evidenceRefs??[],{
      episodeId:episode.id,logicalId:episode.logicalId,freshness:episode.freshness,
    });
    return episode;
  }

  ensureSceneSummaryScope(proposal,episode,resolution) {
    const scopeRef='SCENE:'+proposal.sceneId;
    const desiredEvidence=[...(episode.evidenceRefs??[])].sort();
    const desiredEpisodes=[episode.logicalId].sort();
    const existing=this.summaryHierarchy.scope(scopeRef);
    if (
      existing
      && stableStringify([...(existing.evidenceRefs??[])].sort())===stableStringify(desiredEvidence)
      && stableStringify([...(existing.episodeLogicalIds??[])].sort())===stableStringify(desiredEpisodes)
    ) return existing;
    return this.summaryHierarchy.defineScope({
      level:'SCENE',
      scopeId:proposal.sceneId,
      evidenceRefs:desiredEvidence,
      episodeLogicalIds:desiredEpisodes,
      narrativeTimeRange:episode.timeBounds,
      provenance:[
        'scene-proposal:'+proposal.proposalId,
        ...(resolution.mappingIds??[]).map((id)=>'evidence-map:'+id),
        ...(resolution.sceneBoundaryEventId?['scene-boundary:'+resolution.sceneBoundaryEventId]:[]),
      ],
    });
  }

  admitExternalEvidenceMapping(input) {
    const receipt=this.evidenceBridge.admitMapping(input);
    const materializedSceneEpisodes=[];
    if (receipt.status==='ADMITTED') {
      const evidence=this.graph.evidenceRecord(receipt.memoryEvidenceId);
      if (evidence) this.summaryHierarchy.onEvidenceAppended(evidence);
      for (const proposalId of receipt.affectedSceneProposalIds??[]) {
        materializedSceneEpisodes.push(this.refreshSceneExperienceProposal(proposalId));
      }
      if (materializedSceneEpisodes.length) this.historian.build();
    }
    if (receipt.status==='ADMITTED') this.notifyUi('MEMORY_EXTERNAL_EVIDENCE_MAPPED',[receipt.memoryEvidenceId],{
      mappingId:receipt.mappingId,sourceRevisionId:receipt.sourceRevisionId,
    });
    return {
      ...receipt,
      materializedSceneEpisodes:materializedSceneEpisodes.map((episode)=>({
        id:episode.id,
        logicalId:episode.logicalId,
        revision:episode.revision,
        freshness:episode.freshness,
      })),
      memoryRevisionRefs:this.memoryRevisionRefs(),
    };
  }

  acceptSceneOwnerEvent(event,options={}) {
    const receipt=this.evidenceBridge.acceptSceneEvent(event,options);
    const materializedSceneEpisodes=[];
    if (['ACCEPTED','RECORDED_NONCONFIRMING'].includes(receipt.status)) {
      const ids=new Set(receipt.affectedSceneProposalIds??[]);
      if (options.currentSceneRevision!=null) {
        for (const record of this.evidenceBridge.sceneProposals.values()) {
          if (record.proposal.sceneId===event.sceneId) ids.add(record.proposalId);
        }
      }
      for (const proposalId of ids) {
        materializedSceneEpisodes.push(this.refreshSceneExperienceProposal(proposalId,{
          currentSceneRevision:options.currentSceneRevision??null,
        }));
      }
    }
    return {
      ...receipt,
      materializedSceneEpisodes:materializedSceneEpisodes.map((episode)=>({
        id:episode.id,
        logicalId:episode.logicalId,
        revision:episode.revision,
        freshness:episode.freshness,
      })),
      memoryRevisionRefs:this.memoryRevisionRefs(),
    };
  }

  invalidateExternalEvidenceMapping(input={}) {
    const bridgeReceipt=this.evidenceBridge.invalidateMapping(input);
    if (bridgeReceipt.status!=='INVALIDATED') return bridgeReceipt;
    const dependency=this.invalidateSourceRevision(bridgeReceipt.sourceRevisionId,{
      replacedBy:input.replacedBySourceRevisionId??null,
      removed:Boolean(input.removed),
      reason:input.reason??'OWNER_EVIDENCE_INVALIDATED',
    });
    const refreshed=[];
    for (const proposalId of bridgeReceipt.affectedSceneProposalIds??[]) {
      refreshed.push(this.refreshSceneExperienceProposal(proposalId));
    }
    return {
      ...bridgeReceipt,
      dependencyInvalidation:dependency,
      refreshedSceneEpisodes:refreshed.map((episode)=>({
        id:episode.id,logicalId:episode.logicalId,revision:episode.revision,freshness:episode.freshness,
      })),
      memoryRevisionRefs:this.memoryRevisionRefs(),
    };
  }

  publishEpisode(input) {
    const episode=this.experienceStore.publishEpisode(input);
    this.summaryHierarchy.onEpisodePublished(episode);
    return episode;
  }

  acceptCompletedTurn(input={}) {
    const ownerArtifactRef=input.ownerArtifactRef;
    const externalEvidenceRef=String(input.externalEvidenceRef??'').trim();
    const sourceRevisionId=String(input.sourceRevisionId??'').trim();
    const chatId=String(input.chatId??'').trim();
    const turnId=String(input.turnId??'').trim();
    const generationId=String(input.generationId??'').trim();
    if(!ownerArtifactRef||!externalEvidenceRef||!sourceRevisionId||!chatId||!turnId||!generationId)throw new TypeError('Memory completed-turn admission requires ownerArtifactRef, externalEvidenceRef, sourceRevisionId, chatId, turnId and generationId');
    const resolution=this.evidenceBridge.resolveMapping({
      ownerArtifactRef,externalEvidenceRef,sourceRevisionId,
      sceneRevision:input.sceneRevision??ownerArtifactRef.sceneRevision??null,
      worldRevision:input.worldRevision??ownerArtifactRef.worldRevision??null,
    });
    if(!resolution.ok){
      const status=String(resolution.reasonCode??'').includes('STALE')||String(resolution.reasonCode??'').includes('REVISION')?'STALE':'FAILED';
      const receipt={
        kind:'MemoryCompletedTurnAdmissionReceipt',contractVersion:'1.0.0',status,
        reasonCode:resolution.reasonCode??'MEMORY_COMPLETED_TURN_MAPPING_UNAVAILABLE',
        chatId,turnId,generationId,correlationId:input.correlationId??null,sceneId:input.sceneId??null,sceneRevision:input.sceneRevision??null,
        sourceRevisionRefs:[sourceRevisionId],episodeId:null,summaryScopeRefs:[],reflectionReceipts:[],
        rawChatIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
        authorityGranted:false,canonicalMutationAuthority:false,settlementAuthority:false,contextSealAuthority:false,
      };
      this.pushDiagnostic(receipt);
      return receipt;
    }
    const mapping=resolution.mapping;
    const evidence=this.graph.evidenceRecord(mapping.memoryEvidenceId);
    if(!evidence)throw new Error('MEMORY_COMPLETED_TURN_EVIDENCE_MISSING:'+mapping.memoryEvidenceId);
    const reflectionCandidates=(input.reflectionCandidates??[]).slice(0,8).map((row,index)=>{
      const statement=String(row?.statement??'').trim();
      const reflectionKey=String(row?.reflectionKey??row?.key??(statement?'brain-reflection:'+stableHash(statement.toLowerCase()):'')).trim();
      if(!reflectionKey||!statement)return null;
      return {
        reflectionKey,statement,
        polarity:String(row?.polarity??(row?.contradiction===true?'CONTRADICT':'SUPPORT')).toUpperCase()==='CONTRADICT'?'CONTRADICT':'SUPPORT',
        subjectRefs:[...(row?.subjectRefs??[])].filter(Boolean).map(String).slice(0,32),
        confidence:Number.isFinite(Number(row?.confidence))?Math.max(0,Math.min(1,Number(row.confidence))):0.5,
        index,
      };
    }).filter(Boolean);
    const logicalId='brain-turn:'+chatId+':'+turnId;
    const priorId=this.experienceStore.currentEpisodeByLogical.get(logicalId)??null;
    const episode=this.publishEpisode({
      logicalId,chatId,turnId,generationId,correlationId:input.correlationId??null,
      sceneId:input.sceneId??null,sceneRevision:input.sceneRevision??null,
      sourceRevisionRefs:[mapping.sourceRevisionId],evidenceRefs:[mapping.memoryEvidenceId],
      externalEvidenceRefs:[mapping.externalEvidenceRef],externalSourceRevisionRefs:[mapping.sourceRevisionId],
      unresolvedExternalEvidenceRefs:[],mappingRefs:[mapping.id],bridgeResolutionStatus:'RESOLVED',
      participants:evidence.participants??[],knownBy:evidence.knownBy??[],significance:input.significance??0.5,
      timeStart:evidence.occurredAt??null,timeEnd:evidence.occurredAt??null,
      summary:String(evidence.exactContent??'').slice(0,MEMORY_LIMITS.maxHistorianExcerptCharacters),
      provenance:['native-brain-turn:'+turnId,'external-map:'+mapping.id],
      reflectionSignals:reflectionCandidates.map((row)=>({reflectionKey:row.reflectionKey,polarity:row.polarity})),
      admissionSource:'NATIVE_BRAIN_COMPLETED_TURN',
    });
    const hierarchy=this.ensureCompletedTurnSummaryScopes(episode);
    const reflectionReceipts=this.consolidateCompletedTurnReflections(episode,reflectionCandidates,{
      worldRevision:input.worldRevision??null,sceneRevision:input.sceneRevision??null,
      generationFence:{chatId,turnId,generationId,correlationId:input.correlationId??null,contextSealId:input.contextSealId??null},
    });
    const compaction=this.runSummaryCompaction({maxUnits:3});
    this.historian.build();
    const receipt={
      kind:'MemoryCompletedTurnAdmissionReceipt',contractVersion:'1.0.0',
      status:priorId===episode.id?'REPLAYED':'COMPLETED',reasonCode:null,
      chatId,turnId,generationId,correlationId:input.correlationId??null,sceneId:episode.sceneId,sceneRevision:episode.sceneRevision,
      sourceRevisionRefs:[...episode.sourceRevisionRefs],evidenceRefs:[...episode.evidenceRefs],
      episodeId:episode.id,episodeLogicalId:episode.logicalId,episodeRevision:episode.revision,
      exactSourceDrillback:this.experienceStore.exactDrillback(episode.id).length>0,
      summaryScopeRefs:hierarchy.scopeRefs,summaryPublishedArtifactIds:[...(compaction.publishedArtifactIds??[])],
      reflectionReceipts,
      rawChatIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
      authorityGranted:false,canonicalMutationAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    };
    this.pushDiagnostic(receipt);
    this.notifyUi('MEMORY_COMPLETED_TURN_ADMITTED',episode.evidenceRefs??[],{episodeId:episode.id,turnId,generationId});
    return receipt;
  }

  ensureCompletedTurnSummaryScopes(episode) {
    const chatId=episode.chatId??'unknown';
    const sceneKey=episode.sceneId??('revision-'+String(episode.sceneRevision??'unknown'));
    const sceneScopeRef='SCENE:brain:'+chatId+':'+sceneKey;
    const sessionScopeRef='SESSION:brain:'+chatId;
    const arcScopeRef='ARC:brain:'+chatId;
    const current=this.experienceStore.currentEpisodes({freshOnly:true}).filter((row)=>row.chatId===chatId);
    const sceneEpisodes=current.filter((row)=>(row.sceneId??('revision-'+String(row.sceneRevision??'unknown')))===sceneKey);
    const sceneEvidence=[...new Set(sceneEpisodes.flatMap((row)=>row.evidenceRefs??[]))].sort();
    const sceneLogicalIds=sceneEpisodes.map((row)=>row.logicalId).sort();
    const allSceneKeys=[...new Set(current.map((row)=>row.sceneId??('revision-'+String(row.sceneRevision??'unknown'))))].sort();
    const childSceneRefs=allSceneKeys.map((key)=>'SCENE:brain:'+chatId+':'+key);
    const defineIfChanged=(input)=>{
      const ref=input.level+':'+input.scopeId,prior=this.summaryHierarchy.scope(ref);
      const shape=(row)=>stableStringify({
        parentScopeRefs:[...(row?.parentScopeRefs??[])].sort(),childScopeRefs:[...(row?.childScopeRefs??[])].sort(),
        evidenceRefs:[...(row?.evidenceRefs??[])].sort(),episodeLogicalIds:[...(row?.episodeLogicalIds??[])].sort(),
        narrativeTimeRange:row?.narrativeTimeRange??null,
      });
      if(prior&&shape(prior)===shape(input))return prior;
      return this.summaryHierarchy.defineScope(input);
    };
    defineIfChanged({level:'SCENE',scopeId:'brain:'+chatId+':'+sceneKey,parentScopeRefs:[sessionScopeRef],evidenceRefs:sceneEvidence,episodeLogicalIds:sceneLogicalIds,provenance:['native-brain:'+chatId]});
    defineIfChanged({level:'SESSION',scopeId:'brain:'+chatId,parentScopeRefs:[arcScopeRef],childScopeRefs:childSceneRefs,episodeLogicalIds:current.map((row)=>row.logicalId).sort(),provenance:['native-brain:'+chatId]});
    defineIfChanged({level:'ARC',scopeId:'brain:'+chatId,childScopeRefs:[sessionScopeRef],episodeLogicalIds:current.map((row)=>row.logicalId).sort(),provenance:['native-brain:'+chatId]});
    return {kind:'MemoryCompletedTurnHierarchyReceipt',scopeRefs:[sceneScopeRef,sessionScopeRef,arcScopeRef],authorityGranted:false};
  }

  consolidateCompletedTurnReflections(episode,candidates=[],options={}) {
    const receipts=[];
    for(const candidate of candidates.slice(0,8)){
      const current=this.experienceStore.currentEpisodes({freshOnly:true});
      const supports=current.filter((row)=>(row.reflectionSignals??[]).some((signal)=>signal.reflectionKey===candidate.reflectionKey&&signal.polarity==='SUPPORT'));
      const contradictions=current.filter((row)=>(row.reflectionSignals??[]).some((signal)=>signal.reflectionKey===candidate.reflectionKey&&signal.polarity==='CONTRADICT'));
      const supportEvidenceRefs=[...new Set(supports.flatMap((row)=>row.evidenceRefs??[]))].sort();
      const contradictionEvidenceRefs=[...new Set(contradictions.flatMap((row)=>row.evidenceRefs??[]))].sort();
      const sourceRevisionRefs=[...new Set([...supports,...contradictions].flatMap((row)=>row.sourceRevisionRefs??[]))].sort();
      const session=this.startConsolidation([{type:'REFLECTION',input:{
        reflectionKey:candidate.reflectionKey,statement:candidate.statement,subjectRefs:candidate.subjectRefs,
        supportEvidenceRefs,contradictionEvidenceRefs,episodeRefs:supports.map((row)=>row.id),
        sourceRevisionRefs,confidence:candidate.confidence,action:'REINFORCE',
        provenance:['native-brain-reflection:'+candidate.reflectionKey],
      }}],{
        generationFence:options.generationFence??{},sourceRevisionRefs,
        worldRevision:options.worldRevision??null,sceneRevision:options.sceneRevision??null,
      });
      const result=this.runConsolidation(session.id,{maxUnits:1});
      const outcome=result.outcomes?.at(-1)??(result.lateDisposition?{status:result.lateDisposition.status??'DEFERRED',reasonCode:result.lateDisposition.reasonCode}:null);
      const safe={
        kind:'MemoryPostTurnReflectionReceipt',reflectionKey:candidate.reflectionKey,
        status:outcome?.status??(result.failures?.length?'FAILED':'DEFERRED'),reasonCode:outcome?.reasonCode??null,
        artifactId:outcome?.artifactId??null,resolutionStatus:outcome?.resolutionStatus??null,
        supportEpisodeCount:supports.length,contradictionEpisodeCount:contradictions.length,
        authorityClass:'INFERRED',canonicalAuthority:false,rawChatIncluded:false,hiddenReasoningIncluded:false,
      };
      receipts.push(safe);this.pushDiagnostic(safe);
    }
    if(!candidates.length){
      const skipped={kind:'MemoryPostTurnReflectionReceipt',reflectionKey:null,status:'SKIPPED',reasonCode:'MEMORY_REFLECTION_CANDIDATE_ABSENT',supportEpisodeCount:0,contradictionEpisodeCount:0,authorityClass:'INFERRED',canonicalAuthority:false,rawChatIncluded:false,hiddenReasoningIncluded:false};
      receipts.push(skipped);this.pushDiagnostic(skipped);
    }
    return receipts;
  }

  applySettlement(envelope) {
    const result=this.graph.applySettlement(envelope);
    this.summaryHierarchy.invalidateEvidenceRefs(envelope?.proposal?.evidenceIds??[],'SETTLEMENT_CHANGED');
    this.historian.build();
    this.notifyUi('MEMORY_SETTLEMENT_APPLIED',envelope?.proposal?.evidenceIds??[],{
      proposalId:envelope?.proposal?.id??null,decisionId:envelope?.decision?.id??null,
    });
    return result;
  }

  applyCoreSettlement(envelope,options={}) {
    try {
      const mapped=this.evidenceBridge.mapCoreSettlementEnvelope(envelope,options);
      const settlement=this.applySettlement(mapped.mappedEnvelope);
      return {
        kind:'MemoryCoreSettlementAdapterReceipt',
        contractVersion:'1.0.0',
        status:settlement?.kind==='MemorySettlementReplayReceipt'?'REPLAYED':'APPLIED',
        externalProposalId:mapped.externalProposalId,
        externalEvidenceIds:mapped.externalEvidenceIds,
        memoryEvidenceIds:mapped.memoryEvidenceIds,
        mappingIds:mapped.mappingIds,
        settlement:deepClone(settlement),
        reasonCode:null,
        authorityGranted:false,
        settlementAuthority:false,
        canonicalMutationAuthority:false,
        contextSealAuthority:false,
      };
    } catch (error) {
      const receipt={
        kind:'MemoryCoreSettlementAdapterReceipt',
        contractVersion:'1.0.0',
        status:'REJECTED',
        externalProposalId:envelope?.proposal?.id??null,
        externalEvidenceIds:[...(envelope?.proposal?.evidenceIds??[])],
        memoryEvidenceIds:[],
        mappingIds:[],
        settlement:null,
        reasonCode:error?.code??error?.message??'MEMORY_CORE_SETTLEMENT_ADAPTER_FAILED',
        details:deepClone(error?.details??{}),
        authorityGranted:false,
        settlementAuthority:false,
        canonicalMutationAuthority:false,
        contextSealAuthority:false,
      };
      this.pushDiagnostic(receipt);
      return receipt;
    }
  }

  currentProjection(options={}) {
    return this.graph.currentProjection(options);
  }

  historicalClaims(options={}) {
    return this.graph.historicalClaims(options);
  }

  asOf(worldRevision) {
    return this.graph.asOf(worldRevision);
  }

  traverseEntity(entityId,options={}) {
    return this.graph.traverseEntity(entityId,options);
  }

  unresolvedSets(options={}) {
    return this.graph.unresolvedSets(options);
  }

  ingestGreenRoomBatch(batch,options={}) {
    return this.greenRoom.ingestBatch(batch,options);
  }

  expireGreenRoom(context={}) {
    return this.greenRoom.expire(context);
  }

  greenRoomShadow(context={}) {
    return this.greenRoom.compactShadow(context);
  }

  greenRoomReflectionProposal(characterRef,options={}) {
    return this.greenRoom.createReflectionProposal(characterRef,options);
  }

  reflectionFromGreenRoomProposal(proposal,options={}) {
    const reflection=this.experienceStore.reflectionFromGreenRoomProposal(proposal,options);
    this.summaryHierarchy.invalidateEvidenceRefs([...(reflection.supportEvidenceRefs??[]),...(reflection.contradictionEvidenceRefs??[])],'REFLECTION_CHANGED');
    this.historian.build();
    this.notifyUi('MEMORY_REFLECTION_PUBLISHED',reflection.supportEvidenceRefs??[],{reflectionId:reflection.id});
    return reflection;
  }

  reviseReflection(input) {
    const reflection=this.experienceStore.reviseReflection(input);
    this.summaryHierarchy.invalidateEvidenceRefs([...(reflection.supportEvidenceRefs??[]),...(reflection.contradictionEvidenceRefs??[])],'REFLECTION_CHANGED');
    this.historian.build();
    this.notifyUi('MEMORY_REFLECTION_REVISED',reflection.supportEvidenceRefs??[],{reflectionId:reflection.id});
    return reflection;
  }

  invalidateSourceRevision(sourceRevisionId,options={}) {
    const graphResult=this.graph.invalidateSourceRevision(sourceRevisionId,options);
    const greenRoomResult=this.greenRoom.expire({invalidatedSourceRevisionRefs:[sourceRevisionId]});
    const derived=this.experienceStore.refreshFreshness();
    const hierarchy=this.summaryHierarchy.invalidateSourceRevision(sourceRevisionId,options);
    this.historian.build();
    const receipt={
      kind:'MemoryDependencyInvalidationReceipt',
      sourceRevisionId,
      graphTransitionId:graphResult.event.id,
      expiredGreenRoom:greenRoomResult.expired,
      staleEpisodeIds:derived.staleEpisodes,
      staleReflectionIds:derived.staleReflections,
      staleSummaryArtifactIds:hierarchy.staleArtifactIds,
      affectedSummaryScopeRefs:hierarchy.affectedScopeRefs,
      memoryRevisionRefs:this.memoryRevisionRefs(),
      unrelatedMemoryMutation:false,
    };
    this.pushDiagnostic(receipt);
    const affectedEvidence=[...this.graph.evidenceOrder].filter((id)=>this.graph.evidenceRecord(id)?.sourceRevisionId===sourceRevisionId);
    this.notifyUi('MEMORY_SOURCE_INVALIDATED',affectedEvidence,{sourceRevisionId,reason:options.reason??'SOURCE_REVISION_INVALIDATED'});
    return receipt;
  }

  rebuildHistorian() {
    return this.historian.build();
  }

  queryHistorian(request) {
    try {
      const selection=normalizeMemorySelection(request?.selection??{});
      const allowedEvidenceIds=selection.chatId
        ? (this.graph.evidenceOrder??[]).filter((id)=>{
            const row=this.graph.evidenceRecord(id);
            return row&&evidenceBelongsToChat(row,selection);
          })
        : null;
      const fencedRequest=allowedEvidenceIds==null?request??{}:{...(request??{}),allowedEvidenceIds};
      const raw=this.summaryHierarchy.queryHistorian(fencedRequest,(baseRequest)=>this.historian.query(baseRequest));
      let result=raw;
      if (selection.chatId) {
        const nominations=(raw.nominations??[]).filter((nomination)=>this.nominationBelongsToChat(nomination,selection));
        result={
          ...raw,
          nominations,
          diagnostics:{
            ...(raw.diagnostics??{}),
            selectionFiltered:true,
            selectedChatId:selection.chatId,
            selectionFilteredOut:Math.max(0,(raw.nominations??[]).length-nominations.length),
            returned:nominations.length,
          },
        };
        this.uiReadModel.recordRetrieval(selection,request,result);
      }
      return result;
    } catch (error) {
      this.pushDiagnostic({kind:'MemoryHistorianDegraded',reason:error?.message??String(error)});
      const degraded=this.historian.degradedResult({query:request?.query??'',mode:request?.mode??'EXPLICIT_HISTORY',reason:error?.message??'HISTORIAN_FAILED'});
      const selection=normalizeMemorySelection(request?.selection??{});
      if(selection.chatId)this.uiReadModel.recordRetrieval(selection,request,degraded);
      return degraded;
    }
  }

  nominationBelongsToChat(nomination,selection) {
    const summary=nomination?.metadata?.historianChannel==='HIERARCHICAL_SUMMARY';
    const rows=summary
      ? this.summaryHierarchy.drillDown(nomination)
      : (nomination?.evidenceRefs??[]).map((id)=>this.graph.evidenceRecord(id)).filter(Boolean);
    return rows.length>0&&rows.every((row)=>evidenceBelongsToChat(row,selection));
  }

  resolveHistorianMemoryRequest(request) {
    try {
      if (!request||request.kind!=='HistorianMemoryRequest') throw new TypeError('HistorianMemoryRequest required');
      const currentRevisionRefs=this.memoryRevisionRefs();
      const requested=[...(request.memoryRevisionRefs??[])].sort();
      if (requested.length && stableStringify(requested)!==stableStringify([...currentRevisionRefs].sort())) {
        return {
          kind:'HistorianMemoryResolution',
          contractVersion:'1.0.0',
          status:'DEGRADED',
          artifacts:[],
          unavailableChannels:['MEMORY_REVISION_FENCE_CHANGED'],
          memoryRevisionRefs:requested,
          perspectiveStatus:request?.perspectiveConstraint?.scope??'WORLD',
          evidenceBytes:0,
          authorityGranted:false,
          memoryMutation:false,
        };
      }

      const maxArtifacts=Math.max(1,Math.min(
        MEMORY_LIMITS.maxHistorianCandidates,
        Number(request.limits?.maxArtifacts??MEMORY_LIMITS.maxHistorianCandidates)||MEMORY_LIMITS.maxHistorianCandidates,
      ));
      const all=[];
      for (const intent of request.retrievalIntents??[]) {
        const result=this.queryHistorian({
          query:intent.query??intent.intentId,
          mode:intent.mode??'CONTINUITY_RECALL',
          retrievalIntentId:intent.intentId,
          activeEntityIds:intent.entityRefs?.length?intent.entityRefs:request.activeEntityIds??[],
          perspectiveConstraint:request.perspectiveConstraint??{scope:'WORLD'},
          maxCandidates:maxArtifacts,
          breadth:intent.breadth??request.breadth,
          temporalDistance:intent.temporalDistance??request.temporalDistance,
          resolutionHint:intent.resolutionHint??request.resolutionHint,
          precisionRequired:Boolean(intent.precisionRequired??request.precisionRequired),
          selection:request.selection??null,
        });
        all.push(...(result.nominations??[]));
      }

      const unique=new Map();
      for (const nomination of all) {
        const summaryKey=nomination.metadata?.sourceRangeHash
          ? 'summary-range:'+nomination.metadata.sourceRangeHash
          : nomination.evidenceIdentity??nomination.candidateId;
        const existing=unique.get(summaryKey);
        if (!existing||Number(nomination.normalizedRank??0)>Number(existing.normalizedRank??0)) unique.set(summaryKey,nomination);
      }
      const nominations=[...unique.values()]
        .sort((a,b)=>Number(b.normalizedRank??0)-Number(a.normalizedRank??0)||String(a.candidateId).localeCompare(String(b.candidateId)))
        .slice(0,maxArtifacts);
      const artifacts=nominations.map((nomination)=>{
        const channel=nomination.metadata?.historianChannel??'EPISODIC_MEMORY';
        const summary=channel==='HIERARCHICAL_SUMMARY';
        return {
          candidateId:nomination.candidateId,
          artifactRef:deepClone(nomination.artifactRef),
          sourceRef:nomination.sourceRevisionRefs?.[0]??null,
          episodeId:channel==='SCENE_EPISODE'?nomination.artifactRef?.artifactId:null,
          eventId:nomination.eventRefs?.[0]??null,
          reflectionId:channel==='REFLECTION'?nomination.artifactRef?.artifactId:null,
          summaryArtifactId:summary?nomination.metadata?.summaryArtifactId??nomination.artifactRef?.artifactId:null,
          channel,
          resolutionLevel:summary?nomination.metadata?.resolutionLevel??null:null,
          retrievalIntentIds:[...(nomination.retrievalIntentIds??[])],
          entityRefs:[...(nomination.entityRefs??[])],
          relationshipRefs:[...(nomination.relationshipRefs??[])],
          eventRefs:[...(nomination.eventRefs??[])],
          claimRefs:[...(nomination.claimRefs??[])],
          temporalHints:(nomination.temporalHints??[]).map(String),
          authorityClass:nomination.authorityClass,
          truthStatusHint:nomination.truthStatusHint,
          provenance:deepClone(nomination.provenance??[]),
          evidenceRefs:[...(nomination.evidenceRefs??[])],
          sourceRevisionRefs:[...(nomination.sourceRevisionRefs??[])],
          dependencyRevisions:[...(nomination.dependencyRevisions??[])],
          perspective:deepClone(nomination.metadata?.perspective??request.perspectiveConstraint??{scope:'WORLD'}),
          representationText:String(nomination.representationText??''),
          rankSignals:{
            intentMatch:Number(nomination.rankSignals?.intentMatch??0),
            entityOverlap:Number(nomination.rankSignals?.entityOverlap??0),
            temporalFit:Number(nomination.rankSignals?.temporalFit??0),
            significance:Number(nomination.rankSignals?.significance??0),
            recency:Number(nomination.rankSignals?.recency??0),
            perspectiveCompatibility:Number(nomination.rankSignals?.perspectiveCompatibility??1),
          },
          sceneRelevance:null,
          semanticKey:summary
            ? nomination.metadata?.summaryScopeRef??nomination.artifactRef?.artifactId
            : nomination.artifactRef?.artifactId??nomination.candidateId,
          exactSourceDrillback:Boolean(nomination.metadata?.exactSourceDrillback),
          independentEvidence:summary?false:null,
          navigationOnly:summary?true:null,
          authorityGranted:false,
          memoryMutation:false,
        };
      });
      const bytes=JSON.stringify(artifacts).length;
      const maxBytes=Number(request.limits?.maxEvidenceBytes??MEMORY_LIMITS.maxHistorianEvidenceBytes);
      if (bytes>maxBytes) {
        return {
          kind:'HistorianMemoryResolution',
          contractVersion:'1.0.0',
          status:'DEGRADED',
          artifacts:[],
          unavailableChannels:['EVIDENCE_BUDGET_EXCEEDED'],
          memoryRevisionRefs:requested.length?requested:currentRevisionRefs,
          perspectiveStatus:request?.perspectiveConstraint?.scope??'WORLD',
          evidenceBytes:0,
          authorityGranted:false,
          memoryMutation:false,
        };
      }
      return {
        kind:'HistorianMemoryResolution',
        contractVersion:'1.0.0',
        status:'OK',
        artifacts,
        unavailableChannels:[],
        memoryRevisionRefs:requested.length?requested:currentRevisionRefs,
        perspectiveStatus:request?.perspectiveConstraint?.scope??'WORLD',
        evidenceBytes:bytes,
        authorityGranted:false,
        memoryMutation:false,
      };
    } catch (error) {
      this.pushDiagnostic({kind:'MemoryHistorianResolverDegraded',reason:error?.message??String(error)});
      return {
        kind:'HistorianMemoryResolution',
        contractVersion:'1.0.0',
        status:'DEGRADED',
        artifacts:[],
        unavailableChannels:['MEMORY_RESOLVER_FAILED'],
        memoryRevisionRefs:[...(request?.memoryRevisionRefs??[])],
        perspectiveStatus:request?.perspectiveConstraint?.scope??'WORLD',
        evidenceBytes:0,
        authorityGranted:false,
        memoryMutation:false,
      };
    }
  }

  drillDown(nominationOrRecordRef,options={}) {
    const summary=this.summaryHierarchy.drillDown(nominationOrRecordRef);
    const rows=summary.length?summary:this.historian.drillDown(nominationOrRecordRef);
    const perspective=options.perspectiveConstraint
      ??(typeof nominationOrRecordRef==='object'?nominationOrRecordRef?.metadata?.perspective:null)
      ??{scope:'WORLD'};
    const selection=normalizeMemorySelection(options.selection??{});
    const selected=selection.chatId?rows.filter((row)=>evidenceBelongsToChat(row,selection)):rows;
    if(perspective?.scope!=='CHARACTER_KNOWLEDGE')return selected;
    const characterRef=perspective.characterRef??perspective.characterId??null;
    if(!characterRef)return [];
    return selected.filter((row)=>(row.knownBy??[]).includes(characterRef));
  }

  profileHierarchyQuery(request,options={}) {
    return this.summaryHierarchy.profileSummaryQuery(request,options);
  }

  defineSummaryScope(input) {
    return this.summaryHierarchy.defineScope(input);
  }

  runSummaryCompaction(options={}) {
    const result=this.summaryHierarchy.runCompaction(options);
    if((result.publishedArtifactIds??[]).length)this.uiReadModel.notify('MEMORY_SUMMARY_UPDATED',{},{
      artifactIds:result.publishedArtifactIds,
      pendingWorkUnits:result.pendingWorkUnits,
    });
    return result;
  }

  summaryWorkUnits(options={}) {
    return this.summaryHierarchy.nextWorkUnits(options);
  }

  compileSummaryWorkUnit(workUnit,options={}) {
    return this.summaryHierarchy.compileWorkUnit(workUnit,options);
  }

  summaryArtifact(scopeRef,options={}) {
    return this.summaryHierarchy.currentArtifact(scopeRef,options);
  }

  summaryHistory(scopeRef) {
    return this.summaryHierarchy.artifactHistory(scopeRef);
  }

  summaryStatus() {
    return this.summaryHierarchy.status();
  }

  memoryRevisionRefs() {
    return [...this.historian.memoryRevisionRefs(),this.summaryHierarchy.revisionRef(),this.evidenceBridge.revisionRef()].sort();
  }

  startConsolidation(jobs=[],options={}) {
    return this.experienceStore.startConsolidation(jobs,options);
  }

  consolidationWorkUnits(sessionId,options={}) {
    return this.experienceStore.consolidationWorkUnits(sessionId,options);
  }

  runConsolidation(sessionId,options={}) {
    const result=this.experienceStore.runConsolidation(sessionId,options);
    if (result.publishedArtifactIds.length) {
      this.historian.build();
      const evidenceRefs=result.publishedArtifactIds.flatMap((id)=>this.experienceStore.artifact(id)?.supportEvidenceRefs??[]);
      this.notifyUi('MEMORY_CONSOLIDATION_PUBLISHED',evidenceRefs,{sessionId,publishedArtifactIds:result.publishedArtifactIds});
    }
    return result;
  }

  readMemoryUi(selection={}) {
    return this.uiReadModel.read(selection);
  }

  subscribeMemory(listener) {
    return this.uiReadModel.subscribe(listener);
  }

  createMemoryUiProducer(options={}) {
    return this.uiReadModel.createProducer(options);
  }

  checkpoint({cursor=0,pendingWork=[]}={}) {
    return this.experienceStore.checkpoint({cursor,pendingWork});
  }

  publicApi() {
    return {
      kind:'MemoryTemporalProducerApi',
      apiVersion:MEMORY_API_VERSION,
      contractVersion:MEMORY_CONTRACT_VERSION,
      revisionRefs:this.memoryRevisionRefs(),
      capabilities:[
        'APPEND_EVIDENCE',
        'INGEST_SCENE_EXPERIENCE',
        'ADMIT_COMPLETED_BRAIN_TURN',
        'APPLY_OWNER_SETTLEMENT',
        'CURRENT_PROJECTION',
        'AS_OF_HISTORY',
        'ENTITY_TRAVERSAL',
        'GREEN_ROOM_SHADOW',
        'REFLECTION_DERIVATION',
        'BOUNDED_CONSOLIDATION_CHECKPOINT',
        'HISTORIAN_QUERY',
        'HISTORIAN_RESOLVER',
        'EXACT_EVIDENCE_DRILLBACK',
        'HIERARCHICAL_SUMMARY_COMPACTION',
        'EXTERNAL_EVIDENCE_IDENTITY_BRIDGE',
        'SCENE_EVIDENCE_LATE_RESOLUTION',
        'CORE_SETTLEMENT_EVIDENCE_MAPPING',
        'RESOLUTION_AWARE_HISTORIAN',
        'SUMMARY_WORK_REVISION_FENCES',
        'GENERATION_FENCED_CONSOLIDATION_WORK',
        'SELECTION_AWARE_UI_READ_MODEL',
        'MEMORY_READ_SUBSCRIBE',
        'SNAPSHOT_RELOAD',
      ],
      bounds:deepClone(MEMORY_LIMITS),
      ownership:{
        canonicalMutation:'CORE_OWNER_SETTLEMENT_ONLY',
        scenePersistence:'MEMORY_ADMISSION_OF_REFERENCE_FIRST_SCENE_PROPOSALS',
        greenRoom:'INFERRED_EXPIRING',
        reflection:'INFERRED_DURABLE',
        historian:'NOMINATION_ONLY',
        summaries:'DERIVED_NAVIGATION_ONLY',
        evidenceBridge:'IDENTITY_AND_EXACT_CONTENT_ONLY',
        uiReadModel:'READ_ONLY_SELECTION_AWARE',
        candidateBusAdmission:false,
        truthGate:false,
        settlement:false,
        contextSeal:false,
        runtimeScheduling:false,
      },
      adapters:{
        coreSettlement:'Core MutationProposal + SettlementDecision/Receipt',
        scene:'SceneExperienceProposal v1.0.0',
        greenRoom:'GreenRoomBatch v1.1.0',
        historian:'HistorianMemoryResolution v1.0.0 + CandidateNomination v1.0.0',
        hierarchy:'MemoryHierarchicalSummary v1.0.0 + MemorySummaryCompactionWorkUnit v1.0.0',
        evidenceBridge:'MemoryExternalEvidenceMapping v1.0.0 + MemoryCoreSettlementAdapterReceipt v1.0.0',
        ui:'MemoryUiReadModel v1.0.0 + MemoryUiProducer v1.0.0',
        consolidation:'MemoryConsolidationWorkUnit v1.0.0',
      },
    };
  }

  status() {
    return {
      kind:'MemoryTemporalProducerStatus',
      revisionRefs:this.memoryRevisionRefs(),
      evidenceCount:this.graph.evidence.size,
      settlementJournalCount:this.graph.settlementJournal.length,
      currentProjectionCount:this.graph.currentProjection({includeStale:true}).length,
      unresolvedSetCount:this.graph.unresolvedSets().length,
      activeGreenRoomCount:this.greenRoom.activeByCharacter.size,
      episodeCount:this.experienceStore.episodes.size,
      reflectionCount:this.experienceStore.reflections.size,
      historian:this.historian.status(),
      summaryHierarchy:this.summaryHierarchy.status(),
      evidenceBridge:this.evidenceBridge.status(),
      uiReadModel:{
        contractVersion:'1.0.0',
        retrievalHistory:this.uiReadModel.retrievalHistory.length,
        subscribers:this.uiReadModel.listeners.size,
      },
      diagnostics:deepClone(this.diagnostics),
    };
  }

  pushDiagnostic(row) {
    this.diagnostics.push(deepClone(row));
    if (this.diagnostics.length>MEMORY_LIMITS.maxDiagnostics) this.diagnostics.splice(0,this.diagnostics.length-MEMORY_LIMITS.maxDiagnostics);
  }

  snapshot() {
    return {
      kind:'MemoryTemporalProducerSnapshot',
      apiVersion:MEMORY_API_VERSION,
      graph:this.graph.snapshot(),
      greenRoom:this.greenRoom.snapshot(),
      experienceStore:this.experienceStore.snapshot(),
      historian:this.historian.snapshot(),
      summaryHierarchy:this.summaryHierarchy.snapshot(),
      evidenceBridge:this.evidenceBridge.snapshot(),
      uiReadModel:this.uiReadModel.snapshot(),
      diagnostics:deepClone(this.diagnostics),
    };
  }

  restore(snapshot) {
    this.graph.restore(snapshot?.graph??null);
    this.greenRoom.restore(snapshot?.greenRoom??null);
    this.experienceStore=new MemoryExperienceStore({graph:this.graph,snapshot:snapshot?.experienceStore??null});
    this.historian=new MemoryHistorianIndex({graph:this.graph,experienceStore:this.experienceStore,snapshot:snapshot?.historian??null});
    this.summaryHierarchy=new MemorySummaryHierarchy({graph:this.graph,experienceStore:this.experienceStore,snapshot:snapshot?.summaryHierarchy??null});
    this.evidenceBridge=new MemoryExternalEvidenceBridge({graph:this.graph,snapshot:snapshot?.evidenceBridge??null});
    this.uiReadModel=new MemoryUiReadModelProducer({producer:this,snapshot:snapshot?.uiReadModel??null});
    this.diagnostics=deepClone(snapshot?.diagnostics??[]).slice(-MEMORY_LIMITS.maxDiagnostics);
  }

  static fromSnapshot(snapshot) {
    return new MemoryTemporalProducer({snapshot});
  }
}
