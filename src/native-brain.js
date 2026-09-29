import {
  AuthorityClass,
  KnowledgeStatus,
  MutationType,
  SettlementOutcome,
  createClaim,
  createMutationProposal,
  createProvenance,
} from './contracts.js';
import {Area52CognitiveCore} from './cognitive-core.js';
import {
  KnowledgeTemporalStatus,
} from './knowledge-evidence.js';
import {LoreOwnerRetrievalChannel,MemoryOwnerRetrievalChannel,OWNER_KNOWLEDGE_CHANNELS} from './owner-knowledge-channels.js';
import {ProductionSparseRetrievalChannel} from './production-sparse-retrieval.js';
import {RetrievalChannelHealth} from './candidate-bus-contracts.js';
import {SceneQueryPlanner} from './scene/scene-query-planner.js';
import {NativeKnowledgeStore} from './native-knowledge-store.js';
import {NativeLearningFeedback} from './native-learning-feedback.js';
import {buildMemoryRetrievalFeedbackBatch} from './memory-retrieval-feedback.js';
import {
  CAPABILITIES,
  CausalReasonCode,
  CausalReceiptKind,
  causalObligationMatchesSelection,
  CognitiveObligationReconciler,
  LIFECYCLE_STATUS,
  MemoryPersistenceAdapter,
  WorkerDirector,
} from './runtime/index.js';
import {stableHash} from './browser-runtime-utils.js';
import {createSceneUiReadModelFromIntegrationState} from './scene/scene-ui-read-model.js';
import {NativeContextRetirementPolicy,contextRetirementContract} from './context-retirement-policy.js';
import {compactTurnRecord,reboundCompactedTurnRecord,DEFAULT_FULL_DETAIL_TURNS} from './native-turn-retention.js';

const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();
const req=(value,name)=>{if(typeof value!=='string'||!value.trim())throw new TypeError(name+' must be a non-empty string');return value.trim();};
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const perfNow=()=>Number(globalThis.performance?.now?.()??Date.now());

function redactTransitionHandoff(handoff){
  if(!handoff)return null;
  const safe=clone(handoff);
  if(safe.continuity){
    const summary=String(safe.continuity.compactPriorSceneSummary??'');
    safe.continuity.compactSummaryAvailable=Boolean(summary.trim());
    safe.continuity.compactSummaryLength=summary.length;
    delete safe.continuity.compactPriorSceneSummary;
  }
  return safe;
}

function redactSceneOwnerReceipt(receipt){
  if(!receipt)return null;
  const safe=clone(receipt);
  if(safe.transitionHandoff)safe.transitionHandoff=redactTransitionHandoff(safe.transitionHandoff);
  if(safe.transition?.handoff)safe.transition.handoff=redactTransitionHandoff(safe.transition.handoff);
  if(Array.isArray(safe.invalidatedTransitionHandoffs))safe.invalidatedTransitionHandoffs=safe.invalidatedTransitionHandoffs.map(redactTransitionHandoff);
  if(Array.isArray(safe.invalidatedHandoffs))safe.invalidatedHandoffs=safe.invalidatedHandoffs.map(redactTransitionHandoff);
  safe.rawNarrativeIncluded=false;safe.storyTextIncluded=false;
  return safe;
}

function redactContextRetirement(receipt){
  if(!receipt)return null;
  const transition=receipt.sceneTransition?{
    kind:receipt.sceneTransition.kind??'ContextSceneTransitionCarry',
    handoffId:receipt.sceneTransition.handoffId??null,
    previousSceneId:receipt.sceneTransition.previousSceneId??null,
    destinationSceneId:receipt.sceneTransition.destinationSceneId??null,
    relationship:receipt.sceneTransition.relationship??null,
    episodeRef:clone(receipt.sceneTransition.episodeRef??null),
    compactSummaryAvailable:Boolean(String(receipt.sceneTransition.compactPreviousSceneSummary??'').trim()),
    sourceRevisionRefs:uniq(receipt.sceneTransition.sourceRevisionRefs??[]),
    recentTailRefs:uniq(receipt.sceneTransition.recentTailRefs??[]),
    retainedRecentTailMessageIds:uniq(receipt.sceneTransition.retainedRecentTailMessageIds??[]),
    prefetchDestination:Boolean(receipt.sceneTransition.prefetchDestination),
    prefetchHints:uniq(receipt.sceneTransition.prefetchHints??[]),
    eligibilityDecisionOwner:receipt.sceneTransition.eligibilityDecisionOwner??null,
    promptInclusionAuthority:false,rawDialogueDeletionAuthority:false,contextSealAuthority:false,
  }:null;
  return Object.freeze({
    kind:receipt.kind??'NativeContextRetirementReceipt',contractVersion:receipt.contractVersion??1,chatId:receipt.chatId??null,
    policy:receipt.policy??null,hostHistoryMutation:false,
    recentWindow:Number(receipt.recentWindow??0),messageCount:Number(receipt.messageCount??0),
    retireEligibleMessageIds:[...(receipt.retireEligibleMessageIds??[])],
    keptRawMessageIds:[...(receipt.keptRawMessageIds??[])],
    decisions:clone(receipt.decisions??[]),
    retainedMessageRefs:(receipt.retainedMessages??[]).map(row=>({
      messageId:row.messageId??null,sequence:Number(row.sequence??0),role:row.role??null,
      sourceRevisionRefs:uniq(row.sourceRevisionRefs??[]),provenanceRefs:uniq(row.provenanceRefs??[]),tags:uniq(row.tags??[]),
    })),
    sceneTransition:transition,measurements:clone(receipt.measurements??{}),
    abstained:Boolean(receipt.abstained),abstentionReason:receipt.abstentionReason??null,receiptId:receipt.receiptId??null,
    rawNarrativeIncluded:false,storyTextIncluded:false,
  });
}

function sceneSignalFrom(input,chatId){
  if(input?.kind==='SceneIntegrationSignal')return clone(input);
  if(!input?.sceneId)return null;
  const revision=Math.max(1,Math.trunc(finite(input.sceneRevision,1)));
  return {
    kind:'SceneIntegrationSignal',contractVersion:'1.0.0',
    chatNamespace:chatId,chatId,
    sceneId:String(input.sceneId),sceneRevision:revision,
    sourceRevisionRefs:uniq(input.sourceRevisionRefs??input.sourceRevisionSet??[]),
    provenance:uniq(input.provenance??[]),
    location:clone(input.location??null),narrativeTime:clone(input.narrativeTime??null),
    activeCast:clone(input.activeCast??[]),castObservations:clone(input.castObservations??[]),
    activeThreads:clone(input.activeThreads??[]),activeRelationships:clone(input.activeRelationships??[]),objects:clone(input.objects??input.immediateObjects??[]),
    objectObservations:clone(input.objectObservations??[]),uncertainFields:clone(input.uncertainFields??[]),
    conflictSignals:clone(input.conflictSignals??[]),boundaryState:clone(input.boundaryState??{status:'STABLE'}),
    sceneRelationship:input.sceneRelationship??null,transitionType:input.transitionType??null,
    previousSceneRef:clone(input.previousSceneRef??null),resumedSceneRef:clone(input.resumedSceneRef??null),
    episodeRefs:clone(input.episodeRefs??[]),prefetchRecommendations:clone(input.prefetchRecommendations??[]),
    objectTransitionRefs:clone(input.objectTransitionRefs??[]),atmosphereContribution:clone(input.atmosphereContribution??null),
    health:clone(input.health??{status:'healthy',reasons:[]}),
    diagnosticRefs:clone(input.diagnosticRefs??{}),
    authority:'DESCRIPTIVE',authorityGranted:false,settlementAuthority:false,
    canonicalMutationAuthority:false,contextSealBypass:false,runtimeSchedulingAuthority:false,
  };
}

function observationTemporalKind(value){
  const kind=String(value??'CURRENT').toUpperCase();
  if(!['CURRENT','HISTORICAL','UNRESOLVED','UNCERTAIN'].includes(kind))throw new TypeError('Unsupported observation temporalKind: '+kind);
  return kind;
}

function statusForTemporal(kind){
  if(kind==='HISTORICAL')return KnowledgeStatus.HISTORICAL;
  if(kind==='UNRESOLVED')return KnowledgeStatus.UNRESOLVED;
  if(kind==='UNCERTAIN')return KnowledgeStatus.UNCERTAIN;
  return KnowledgeStatus.CURRENT;
}

export class Area52NativeBrain{
  constructor({
    snapshot=null,
    runtimeCapacity={CPU:1},
    foregroundReserve={CPU:1},
    maxTurns=256,
    loreInterface=null,
    memoryInterface=null,
    memoryConsolidationInterface=null,
    graphProviders=[],
  }={}){
    this.maxTurns=Math.max(16,Number(maxTurns)||256);
    this.core=new Area52CognitiveCore();

    if(snapshot?.core?.sourceRegistry)this.core.registry.restoreState(snapshot.core.sourceRegistry);
    if(snapshot?.core?.temporalState)this.core.graph.restoreState(snapshot.core.temporalState);
    if(snapshot?.core?.entityIdentity)this.core.entities.restoreState(snapshot.core.entityIdentity);
    for(const provider of graphProviders??[])this.core.registerGraphProvider(provider);
    if(snapshot?.core?.hotCognition)this.core.hotCognition.restoreState(snapshot.core.hotCognition,{
      activeSourceRevisionRefs:this.core.registry.activeRevisionIds(),
      worldRevision:this.core.graph.revision,
    });
    if(snapshot?.core?.contextSeal)this.core.publication.seal.restoreState(snapshot.core.contextSeal);

    this.feedback=new NativeLearningFeedback({snapshot:snapshot?.feedback??null});
    this.contextRetirement=new NativeContextRetirementPolicy({isSourceRevisionCurrent:(ref)=>this.core.isSourceRevisionCurrent(ref)});
    this.knowledge=new NativeKnowledgeStore({registry:this.core.registry,snapshot:snapshot?.knowledge??null});
    this.ownerEvidence=new Map();
    this.sceneQueryPlanner=new SceneQueryPlanner();
    this.loreRevisionTrust=new Map(clone(snapshot?.loreRevisionTrust??[]));
    this.rejectedLoreRevisionIds=new Set(clone(snapshot?.rejectedLoreRevisionIds??[]));
    this.loreInterface=null;this.memoryInterface=null;this.memoryConsolidationInterface=null;
    this.ownerSparseChannel=new ProductionSparseRetrievalChannel({
      evidenceSink:(evidence)=>this.#rememberOwnerEvidence(evidence),
      revisionGuard:(source)=>this.#admitLoreOwnerRevision(source),
    });
    this.ownerLoreChannel=new LoreOwnerRetrievalChannel({
      getInterface:()=>this.loreInterface,
      evidenceSink:(evidence)=>this.#rememberOwnerEvidence(evidence),
      revisionGuard:(source)=>this.#admitLoreOwnerRevision(source),
    });
    this.ownerMemoryChannel=new MemoryOwnerRetrievalChannel({getInterface:()=>this.memoryInterface,evidenceSink:(evidence)=>this.#rememberOwnerEvidence(evidence)});
    this.core.registerExternalKnowledgeResolver((candidate)=>this.#resolveKnowledgeEvidence(candidate));
    this.attachLoreInterface(loreInterface);
    this.attachMemoryInterface(memoryInterface);
    this.attachMemoryConsolidationInterface(memoryConsolidationInterface);

    this.turns=new Map(clone(snapshot?.turns??[]));
    this.turnOrder=clone(snapshot?.turnOrder??[]);
    this.sceneSignals=new Map(clone(snapshot?.sceneSignals??[]));
    this.turnSequence=Number(snapshot?.turnSequence??0);
    this.runtimeResults=clone(snapshot?.runtimeResults??[]).slice(-128);
    this.listeners=new Set();
    this.backgroundDrainPromise=null;

    for(const [chatId,signal] of this.sceneSignals){
      this.core.activateHotCognitionChat(chatId,{reason:'IMPORT_OR_RELOAD'});
      this.core.consumeSceneSignal(signal,{chatNamespace:chatId});
    }

    this.runtimePersistence=new MemoryPersistenceAdapter(snapshot?.runtimeLedger??null);
    this.runtimeDirector=new WorkerDirector({
      persistence:this.runtimePersistence,
      capacity:runtimeCapacity,
      foregroundReserve,
      isTurnSealed:(turnId)=>this.core.publication.seal.isTurnSealed(turnId),
      resultSink:(envelope)=>this.#recordRuntimeResult(envelope),
    });
    this.runtimeDirector.registerWorker({
      workerId:'native-brain-local-cpu',
      capabilities:[CAPABILITIES.CPU_ANALYSIS],
      supportedLayers:['L0','L1','L2','L3','L4'],
      resourceProfile:{CPU:1},
      provider:'AREA52_NATIVE',
      implementationId:'native-brain-local-v1',
      concurrencyCapacity:1,latencyScore:1,qualityScore:1,
      foregroundEligible:true,backgroundEligible:true,
    });
    this.obligationReconciler=new CognitiveObligationReconciler({director:this.runtimeDirector,snapshot:snapshot?.expectedWork??null});
    this.#attachRecoveredExecutors();
  }

  #registerKnowledgeChannels(){
    for(const id of ['NATIVE_LORE','NATIVE_MEMORY','OWNER_SPARSE_EXACT',OWNER_KNOWLEDGE_CHANNELS.LORE,OWNER_KNOWLEDGE_CHANNELS.MEMORY])this.core.retrieval.unregisterChannel(id);
    if(this.loreInterface){
      this.core.registerRetrievalChannel(this.ownerLoreChannel);
      if(typeof this.loreInterface.status==='function'&&typeof this.loreInterface.sourceRevision==='function')this.core.registerRetrievalChannel(this.ownerSparseChannel);
    }else{
      this.ownerSparseChannel.clearScope('LORE_OWNER_NOT_ATTACHED');
      this.core.registerRetrievalChannel(this.knowledge.channel('LORE',{channelId:'NATIVE_LORE',rankBias:(id)=>this.feedback.biasFor(id)}));
    }
    if(this.memoryInterface)this.core.registerRetrievalChannel(this.ownerMemoryChannel);
    else this.core.registerRetrievalChannel(this.knowledge.channel('MEMORY',{channelId:'NATIVE_MEMORY',rankBias:(id)=>this.feedback.biasFor(id)}));
  }

  attachLoreInterface(loreInterface=null){
    if(loreInterface!==null&&typeof loreInterface?.query!=='function')throw new TypeError('Lore interface must expose query(request)');
    if(loreInterface?.contractVersion!=null&&Number(loreInterface.contractVersion)!==1)throw new Error('Unsupported Lore Brain interface contract version: '+loreInterface.contractVersion);
    this.loreInterface=loreInterface;
    if(!loreInterface)this.ownerSparseChannel.clearScope('LORE_OWNER_NOT_ATTACHED');
    this.#registerKnowledgeChannels();
    return{kind:'NativeBrainLoreInterfaceReceipt',attached:Boolean(loreInterface),contractVersion:loreInterface?.contractVersion??null,authorityGranted:false,settlementAuthority:false,contextSealAuthority:false};
  }

  attachMemoryConsolidationInterface(memoryConsolidationInterface=null){
    if(memoryConsolidationInterface!==null&&typeof memoryConsolidationInterface?.propose!=='function')throw new TypeError('Memory consolidation interface must expose propose(input)');
    this.memoryConsolidationInterface=memoryConsolidationInterface;
    if(this.runtimeDirector)this.#attachRecoveredExecutors();
    return{
      kind:'NativeBrainMemoryConsolidationInterfaceReceipt',
      attached:Boolean(memoryConsolidationInterface),
      contractVersion:memoryConsolidationInterface?.contractVersion??null,
      authorityGranted:false,canonicalMutationAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    };
  }

  acceptLoreRevisionChange(event={}){
    if(!event||event.kind!=='LoreSourceRevisionChanged')throw new TypeError('LoreSourceRevisionChanged event is required');
    for(const key of ['authorityGranted','settlementAuthority','canonicalMutationAuthority','contextSealAuthority','contextSealBypass'])if(event[key]===true)throw new Error('LORE_REVISION_CHANGE_AUTHORITY_VIOLATION:'+key);
    const sourceId=req(event.sourceId,'LoreSourceRevisionChanged.sourceId');
    const lorebookId=req(event.lorebookId,'LoreSourceRevisionChanged.lorebookId');
    const uid=req(String(event.uid??''),'LoreSourceRevisionChanged.uid');
    const previousSourceRevisionId=event.previousSourceRevisionId==null?null:req(event.previousSourceRevisionId,'LoreSourceRevisionChanged.previousSourceRevisionId');
    const sourceRevisionId=req(event.sourceRevisionId,'LoreSourceRevisionChanged.sourceRevisionId');
    const sourceState=String(event.sourceState??'CURRENT').toUpperCase();
    const contentHash=event.contentHash==null?null:req(event.contentHash,'LoreSourceRevisionChanged.contentHash');
    if(sourceState!=='REMOVED'&&!contentHash)throw new TypeError('LoreSourceRevisionChanged.contentHash must be present for a current authored revision');
    if(previousSourceRevisionId&&previousSourceRevisionId===sourceRevisionId)throw new Error('LORE_REVISION_CHANGE_REUSED_REVISION_ID');
    const previousTrust=this.loreRevisionTrust.get(sourceId)??null;
    if(previousSourceRevisionId)this.rejectedLoreRevisionIds.add(previousSourceRevisionId);
    if(previousTrust?.trustedSourceRevisionId&&previousTrust.trustedSourceRevisionId!==sourceRevisionId)this.rejectedLoreRevisionIds.add(previousTrust.trustedSourceRevisionId);
    if(previousTrust?.pendingSourceRevisionId&&previousTrust.pendingSourceRevisionId!==sourceRevisionId)this.rejectedLoreRevisionIds.add(previousTrust.pendingSourceRevisionId);
    if(sourceState==='REMOVED')this.rejectedLoreRevisionIds.add(sourceRevisionId);
    this.loreRevisionTrust.set(sourceId,{
      sourceId,lorebookId,uid,previousSourceRevisionId,pendingSourceRevisionId:sourceState==='REMOVED'?null:sourceRevisionId,
      trustedSourceRevisionId:null,contentHash,sourceState,
      settlementId:event.settlementId??null,operationKind:event.operationKind??null,exactFingerprint:event.exactFingerprint??null,
      studyObligationId:event.studyObligationId??null,studyTrigger:event.studyTrigger??null,restoration:Boolean(event.restoration),
      status:sourceState==='REMOVED'?'REMOVED':'PENDING_EXACT_RETRIEVAL',
      changedAtTurnSequence:this.turnSequence,
    });
    if(event.studyObligationId){
      this.obligationReconciler.declare({
        expectedId:'lore-study:'+String(event.studyObligationId),owner:'LORE',ownerSignalId:event.settlementId??('lore-revision:'+sourceRevisionId),
        cause:{eventType:'LORE_SOURCE_REVISION_CHANGED',eventId:'lore-revision:'+sourceRevisionId,producerId:'LORE',consumerId:'RUNTIME_CORE',ownerId:'LORE',chatId:event.chatId??null,turnId:event.turnId??null,generationId:event.generationId??null,correlationId:event.correlationId??null,sourceRevisionRefs:[sourceRevisionId],worldRevision:this.core.graph.revision,sceneRevision:event.sceneRevision??null},
        obligation:{taskType:'LORE_STUDY',layer:'L2',requiredCapabilities:['LORE_STUDY'],dedupeKey:'lore-study:'+String(event.studyObligationId)},
      });
    }
    const invalidatedChats=[],checkedChats=[];
    const persisted=this.core.hotCognition.exportState();
    for(const state of persisted?.states??[]){
      const chatNamespace=String(state?.chatNamespace??'');if(!chatNamespace)continue;
      checkedChats.push(chatNamespace);
      const invalidatedRefs=previousSourceRevisionId?[previousSourceRevisionId]:[];
      const receipt=this.core.hotCognition.invalidateKnowledge({
        chatNamespace,updateId:'owner-lore-revision:'+sourceId+':'+String(previousSourceRevisionId??'NONE')+'->'+sourceRevisionId,
        invalidatedSourceRevisionRefs:invalidatedRefs,invalidatedDependencyRevisionRefs:invalidatedRefs,
        reason:sourceState==='REMOVED'?'LORE_SOURCE_REMOVED':'LORE_SOURCE_REVISION_CHANGED',
      });
      if((receipt?.invalidatedSegments??[]).length)invalidatedChats.push(chatNamespace);
    }
    for(const [evidenceId,evidence] of [...this.ownerEvidence.entries()]){
      const refs=uniq([...(evidence?.sourceRevisionRefs??[]),...(evidence?.dependencyRevisionRefs??[])]);
      if(previousSourceRevisionId&&refs.includes(previousSourceRevisionId))this.ownerEvidence.delete(evidenceId);
    }
    const distrusted=new Set([previousSourceRevisionId,previousTrust?.trustedSourceRevisionId,previousTrust?.pendingSourceRevisionId].filter(Boolean));
    this.core.setExternalCurrentSourceRevisionRefs(this.core.externalCurrentSourceRevisionIds().filter(ref=>!distrusted.has(ref)));
    const identityInvalidation=previousSourceRevisionId?this.core.invalidateEntityIdentityRevision(previousSourceRevisionId,{reason:sourceState==='REMOVED'?'LORE_SOURCE_REMOVED':'LORE_SOURCE_REVISION_CHANGED'}):{kind:'IdentityRevisionInvalidationReceipt',sourceRevisionId:null,affectedEntityIds:[],retiredAliases:[],retiredLinks:[],historyPreserved:true,unrelatedIdentityMutation:false};
    const sparseRetrieval=this.ownerSparseChannel.acceptLoreRevisionChange(event,this.loreInterface);
    return{
      kind:'NativeBrainLoreRevisionInvalidationReceipt',contractVersion:1,status:'INVALIDATED',sourceId,lorebookId,uid,
      previousSourceRevisionId,sourceRevisionId,sourceState,settlementId:event.settlementId??null,operationKind:event.operationKind??null,restoration:Boolean(event.restoration),
      checkedChats:uniq(checkedChats),invalidatedChats:uniq(invalidatedChats),
      nextRevisionTrusted:sparseRetrieval?.status==='REINDEXED',nextRevisionRequiresOwnerRetrieval:sourceState!=='REMOVED'&&sparseRetrieval?.status!=='REINDEXED',revisionTrustStatus:this.loreRevisionTrust.get(sourceId)?.status??(sourceState==='REMOVED'?'REMOVED':'PENDING_EXACT_RETRIEVAL'),identityInvalidation,sparseRetrieval,
      authorityGranted:false,settlementAuthority:false,canonicalMutationAuthority:false,contextSealAuthority:false,
    };
  }

  attachMemoryInterface(memoryInterface=null){
    const adapters=memoryInterface?.adapters??memoryInterface;
    if(memoryInterface!==null&&(typeof adapters?.queryHistorian!=='function'||typeof adapters?.drillDown!=='function'))throw new TypeError('Memory interface must expose queryHistorian(request) and drillDown(nomination, options)');
    if(memoryInterface?.contractVersion!=null&&String(memoryInterface.contractVersion).split('.')[0]!=='1')throw new Error('Unsupported Memory integration contract version: '+memoryInterface.contractVersion);
    this.memoryInterface=memoryInterface;
    this.#registerKnowledgeChannels();
    if(this.runtimeDirector)this.#attachRecoveredExecutors();
    return{kind:'NativeBrainMemoryInterfaceReceipt',attached:Boolean(memoryInterface),contractVersion:memoryInterface?.contractVersion??null,authorityGranted:false,settlementAuthority:false,contextSealAuthority:false};
  }

  attachJevAdapter(adapter=null){
    const receipt=this.core.registerJevAdapter(adapter);
    return{kind:'NativeBrainOptionalJevReceipt',...clone(receipt),required:false,nativePathAvailable:true};
  }

  acceptLore(input){
    const row=this.knowledge.admitLore(input);
    if(this.core.hotCognition.hasActiveChat&&row.changed)this.core.hotCognition.invalidateKnowledge({
      updateId:'native-lore:'+row.sourceRevisionId,
      invalidatedSourceRevisionRefs:[],
      affectedSegments:['CONTINUITY'],
      reason:'LORE_REVISION_AVAILABLE',
    });
    return row;
  }

  correctLore(sourceId,exactContent,overrides={}){
    const prior=this.knowledge.currentRecordForSource(sourceId);
    if(!prior)throw new Error('Unknown Lore source: '+sourceId);
    const row=this.knowledge.correctSource(sourceId,exactContent,overrides);
    const identityInvalidation=this.core.invalidateEntityIdentityRevision(prior.sourceRevisionId,{reason:'LORE_SOURCE_CORRECTED'});
    this.core.hotCognition.invalidateKnowledge({
      updateId:'native-lore-corrected:'+prior.sourceRevisionId+'->'+row.sourceRevisionId,
      invalidatedSourceRevisionRefs:[prior.sourceRevisionId],
      reason:'LORE_SOURCE_CORRECTED',
    });
    return{prior,row,identityInvalidation};
  }

  removeLore(sourceId,{reason='LORE_SOURCE_REMOVED'}={}){
    const prior=this.knowledge.currentRecordForSource(sourceId);
    const receipt=this.knowledge.removeSource(sourceId,{reason});
    const identityInvalidation=prior?this.core.invalidateEntityIdentityRevision(prior.sourceRevisionId,{reason}):null;
    if(prior)this.core.hotCognition.invalidateKnowledge({
      updateId:'native-lore-removed:'+prior.sourceRevisionId,
      invalidatedSourceRevisionRefs:[prior.sourceRevisionId],
      reason,
    });
    return{...receipt,identityInvalidation};
  }

  registerEntityIdentity(input){return this.core.registerEntityIdentity(input);}
  proposeEntityIdentity(input){return this.core.proposeEntityIdentity(input);}
  settleEntityIdentity(proposalId,options={}){return this.core.settleEntityIdentity(proposalId,options);}
  registerGraphProvider(options){return this.core.registerGraphProvider(options);}
  unregisterGraphProvider(providerId){return this.core.unregisterGraphProvider(providerId);}
  entityIdentityReadModel(options={}){return this.core.entityIdentityReadModel(options);}
  entityIdentityContract(){return this.core.entityIdentityContract();}
  graphProviderInterfaceContract(){return this.core.graphProviderInterfaceContract();}
  graphWalkerDiagnostics(){return this.core.graphWalkerDiagnostics();}
  worldGraphReferences(query,options={}){return this.core.worldGraphReferences(query,options);}

  observeScene(chatId,input){
    const id=req(chatId,'chatId'),signal=sceneSignalFrom(input,id);
    if(!signal)throw new TypeError('Scene input requires sceneId or a SceneIntegrationSignal');
    this.core.activateHotCognitionChat(id,{reason:'SCENE_UPDATE'});
    const receipt=this.core.consumeSceneSignal(signal,{chatNamespace:id});
    if(receipt.coreHandling==='REJECTED'||receipt.coreHandling==='EXCLUDED_CURRENT')return{receipt,accepted:false};
    this.sceneSignals.set(id,signal);
    return{receipt,accepted:true,scene:this.core.sceneIntegrationSnapshot(id)};
  }

  async prepareTurn({
    chatId,turnId,generationId,correlationId=null,query,intent='CURRENT',
    scene=null,sceneSignal=null,sceneTimeline=[],sceneOwnerReceipt=null,sceneFanOut=null,anchorEntityIds=[],perspectiveConstraint=null,
    budgetBytes=5000,budgetTokens=null,deadline=null,modelProfileId=null,
    providerId=null,modelId=null,routeId=null,observedCacheBehavior=null,
    systemPolicy=null,activeThreads=[],activeContext=null,precisionAvailable=true,channelIds=null,
    candidateBudget=64,latencyBudgetMs=100,graphTraversal=null,
    executionLabel='LIVE_HOST',
  }={}){
    const turnStarted=perfNow();
    const chat=req(chatId,'chatId'),turn=req(turnId,'turnId'),generation=req(generationId,'generationId'),q=req(query,'query');
    const corr=correlationId??('corr:'+turn);
    this.core.activateHotCognitionChat(chat,{reason:'TURN_RECEIVED'});
    const sceneIngressReceipts=[];
    for(const row of sceneTimeline??[]){
      if(!row?.value)continue;
      const receipt=row.type==='INVALIDATION'
        ? this.core.consumeSceneContextInvalidation(row.value,{chatNamespace:chat})
        : row.type==='EVENT'
          ? this.core.consumeCognitiveEvent(row.value,{chatNamespace:chat})
          : null;
      if(receipt)sceneIngressReceipts.push({
        type:row.type,
        ref:row.value?.eventId??row.value?.invalidationId??null,
        eventType:row.value?.eventType??null,
        status:receipt.status??null,
        coreHandling:receipt.coreHandling??null,
        reason:receipt.reason??receipt.reasonCode??null,
      });
    }
    const sceneSignalAdmission=(sceneSignal||scene)?this.observeScene(chat,sceneSignal??scene):null;
    const invalidatedHandoffs=sceneOwnerReceipt?.invalidatedTransitionHandoffs??sceneOwnerReceipt?.invalidatedHandoffs??[];
    for(const handoff of invalidatedHandoffs??[]){
      const receipt=this.core.consumeSceneTransitionHandoff(handoff,{chatNamespace:chat});
      sceneIngressReceipts.push({
        type:'HANDOFF',ref:handoff?.handoffId??null,eventType:'SCENE_TRANSITION_HANDOFF_INVALIDATED',
        status:receipt.status??null,coreHandling:receipt.coreHandling??null,reason:receipt.reason??receipt.reasonCode??null,
      });
    }
    const transitionHandoff=sceneOwnerReceipt?.transitionHandoff??sceneOwnerReceipt?.transition?.handoff??null;
    if(transitionHandoff){
      const receipt=this.core.consumeSceneTransitionHandoff(transitionHandoff,{chatNamespace:chat});
      sceneIngressReceipts.push({
        type:'HANDOFF',ref:transitionHandoff.handoffId??null,eventType:'SCENE_TRANSITION_HANDOFF',
        status:receipt.status??null,coreHandling:receipt.coreHandling??null,reason:receipt.reason??receipt.reasonCode??null,
      });
    }
    const sceneState=this.core.sceneIntegrationSnapshot(chat);
    const safeSceneOwnerReceipt=redactSceneOwnerReceipt(sceneOwnerReceipt);
    if(!sceneState?.sceneId)throw new Error('NATIVE_BRAIN_SCENE_REQUIRED: active Scene owner state is required before generation');
    this.ownerEvidence.clear();this.core.setExternalCurrentSourceRevisionRefs([]);
    const sparseRetrievalReceipt=this.loreInterface
      ?this.ownerSparseChannel.hydrateLoreOwner(this.loreInterface,{chatId:chat,query:q})
      :this.ownerSparseChannel.clearScope('LORE_OWNER_NOT_ATTACHED');
    const sparseRegistryRow=this.core.retrieval.channelRegistry?.lookup?.('OWNER_SPARSE_EXACT')??null;
    if(sparseRegistryRow){
      const sparseUnavailable=sparseRetrievalReceipt.status==='UNAVAILABLE';
      const sparseHealth=sparseUnavailable
        ?RetrievalChannelHealth.UNAVAILABLE
        :sparseRetrievalReceipt.status==='PARTIAL'
          ?RetrievalChannelHealth.DEGRADED
          :RetrievalChannelHealth.HEALTHY;
      this.core.retrieval.channelRegistry.setHealth('OWNER_SPARSE_EXACT',{
        health:sparseHealth,
        available:!sparseUnavailable,
        currentIndexRevision:this.ownerSparseChannel.adapter?.indexVersion??null,
        stale:false,
        reason:sparseUnavailable?sparseRetrievalReceipt.reason:null,
      });
    }
    this.core.entities.setActiveStory(chat);
    this.#syncLoreEntityIdentities(chat);
    const retrievalIntents=this.#selectedTurnRetrievalIntents({chatId:chat,query:q,intent,perspectiveConstraint,anchorEntityIds,graphTraversal});
    const sequence=++this.turnSequence;
    this.runtimeDirector.beginGeneration({turnId:turn,correlationId:corr,generationId:generation});
    const choicePreparation=this.core.prepareGenerationChoice({
      turnId:turn,turnRevision:sequence,correlationId:corr,query:q,intent,anchorEntityIds:uniq(anchorEntityIds),
      budgetBytes,deadline,channelIds,perspectiveConstraint,candidateBudget,latencyBudgetMs,
    });
    let ownerSelection={
      chatId:chat,turnId:turn,generationId:generation,correlationId:corr,
      worldRevision:choicePreparation.worldRevision,sceneRevision:choicePreparation.sceneRevision,sourceRevisionRefs:this.core.currentSourceRevisionIds(),
    };
    this.ownerLoreChannel.beginTurn({selection:ownerSelection,perspectiveConstraint});
    this.ownerMemoryChannel.beginTurn({selection:ownerSelection,perspectiveConstraint});
    // Dense Memory is optional. Cognitive Choice decides whether retrieval is useful
    // before any embedding provider can run; the synchronous owner channel later
    // consumes only a revision-fenced cached nomination.
    let memoryDensePrime=choicePreparation.hotOnly
      ?this.ownerMemoryChannel.skipDense('HOT_SUFFICIENT',{selection:ownerSelection,resultClass:'OPPORTUNISTIC'})
      :await this.ownerMemoryChannel.prime({intentId:'memory-dense:'+turn,query:q,intentKind:intent,perspective:perspectiveConstraint},{query:q,selection:ownerSelection,resultClass:'OPPORTUNISTIC'});
    const postPrimeScene=this.core.sceneIntegrationSnapshot(chat),postPrimeWorld=this.core.graph.revision,postPrimeSourceRefs=this.core.currentSourceRevisionIds();
    const sourceFenceChanged=stableHash([...(ownerSelection.sourceRevisionRefs??[])].map(String).sort())!==stableHash([...postPrimeSourceRefs].map(String).sort());
    if(!choicePreparation.hotOnly&&(Number(postPrimeWorld)!==Number(ownerSelection.worldRevision)||Number(postPrimeScene?.sceneRevision)!==Number(ownerSelection.sceneRevision)||sourceFenceChanged)){
      ownerSelection={...ownerSelection,worldRevision:postPrimeWorld,sceneRevision:postPrimeScene?.sceneRevision??ownerSelection.sceneRevision,sourceRevisionRefs:postPrimeSourceRefs};
      this.ownerLoreChannel.beginTurn({selection:ownerSelection,perspectiveConstraint});
      this.ownerMemoryChannel.beginTurn({selection:ownerSelection,perspectiveConstraint});
      memoryDensePrime=this.ownerMemoryChannel.markDenseStale(memoryDensePrime,{selection:ownerSelection,reason:'DENSE_PRIME_STALE_SELECTED_STATE',resultClass:'OPPORTUNISTIC'});
    }
    let sceneFanOutIngress={kind:'NativeBrainSceneFanOutIngressReceipt',status:'UNAVAILABLE',reasonCode:'SCENE_FANOUT_HANDOFF_ABSENT',candidateCount:0,candidateIds:[],authorityGranted:false,admissionAuthority:false,truthAuthority:false,contextSealAuthority:false};
    let externalRetrievalCandidates=[];
    if(sceneFanOut){
      const expectedSources=uniq([
        ...(sceneState.sourceRevisionRefs??[]),
        // The Core integration snapshot does not retain prefetch recommendations, so the admitted
        // Scene owner signal is the authority for the prefetch part of the Fan-Out source set.
        ...(this.sceneSignals.get(chat)?.prefetchRecommendations??sceneState.prefetchRecommendations??[]).flatMap(row=>row?.sourceRevisionSet??row?.sourceRevisionRefs??[]),
      ]),actualSources=uniq(sceneFanOut.sourceRevisionSet??[]);
      const identityMismatch=[];
      if(String(sceneFanOut.chatId??'')!==chat)identityMismatch.push('chatId');
      if(String(sceneFanOut.turnId??'')!==turn)identityMismatch.push('turnId');
      if(String(sceneFanOut.generationId??'')!==generation)identityMismatch.push('generationId');
      if(String(sceneFanOut.correlationId??'')!==corr)identityMismatch.push('correlationId');
      if(String(sceneFanOut.sceneId??'')!==String(sceneState.sceneId??''))identityMismatch.push('sceneId');
      if(Number(sceneFanOut.sceneRevision)!==Number(sceneState.sceneRevision))identityMismatch.push('sceneRevision');
      if(JSON.stringify(actualSources)!==JSON.stringify(expectedSources))identityMismatch.push('sourceRevisionSet');
      if(identityMismatch.length){
        sceneFanOutIngress={kind:'NativeBrainSceneFanOutIngressReceipt',status:'REJECTED',reasonCode:'SCENE_FANOUT_SELECTION_FENCE_MISMATCH',identityMismatch,candidateCount:0,candidateIds:[],authorityGranted:false,admissionAuthority:false,truthAuthority:false,contextSealAuthority:false};
      }else{
        externalRetrievalCandidates=(sceneFanOut.candidates??[]).slice(0,64).filter(row=>row?.candidate?.candidateId);
        sceneFanOutIngress={
          kind:'NativeBrainSceneFanOutIngressReceipt',status:'ADMITTED_FOR_RESULT_BUS',reasonCode:null,identityMismatch:[],causationId:sceneFanOut.causationId??null,
          assemblyStatus:sceneFanOut.assemblyStatus??'ASSEMBLED',assemblyReasonCode:sceneFanOut.assemblyReasonCode??null,plannerConsidered:Boolean(sceneFanOut.plannerConsidered),
          physicalExecutionCount:Math.max(0,Number(sceneFanOut.physicalExecutionCount??0)||0),
          admittedResultIds:uniq(sceneFanOut.admittedResultIds??[]).slice(0,32),rejectedResultIds:uniq(sceneFanOut.rejectedResultIds??[]).slice(0,32),staleResultIds:uniq(sceneFanOut.staleResultIds??[]).slice(0,32),
          candidateCount:externalRetrievalCandidates.length,candidateIds:uniq(externalRetrievalCandidates.map(row=>row.candidate.candidateId)),
          authorityGranted:false,admissionAuthority:false,truthAuthority:false,contextSealAuthority:false,
        };
      }
    }

    const published=this.core.publishGenerationContext({
      turnId:turn,turnRevision:sequence,correlationId:corr,query:q,intent,
      anchorEntityIds:uniq(anchorEntityIds),budgetBytes,deadline,precisionAvailable,
      activeThreads,channelIds,perspectiveConstraint,candidateBudget,latencyBudgetMs,graphTraversal,retrievalIntents,externalRetrievalCandidates,choicePreparation,
    });
    this.#recordSceneExpectedWork({chatId:chat,turnId:turn,generationId:generation,correlationId:corr,turnRevision:sequence,sceneState,published});
    const sceneHandoff=this.core.sceneTransitionContext(chat);
    const contextRetirement=activeContext?this.contextRetirement.evaluate({
      chatId:chat,...clone(activeContext),sceneHandoff,
      additionalCurrentSourceRevisionRefs:uniq([
        ...(sceneState.sourceRevisionRefs??[]),
        ...(sceneHandoff?.sourceRevisionRefs??[]),
        ...(sceneHandoff?.continuity?.sourceRevisionRefs??[]),
      ]),
    }):null;
    const narrativeMessages=(contextRetirement?.retainedMessages??[]).filter(row=>!(String(row.role).toLowerCase()==='user'&&String(row.content).trim()===q));
    const contributions=narrativeMessages.length?[{
      id:'recent-narrative:'+stableHash({chatId:chat,turnId:turn,receiptId:contextRetirement.receiptId,messageIds:narrativeMessages.map(row=>row.messageId)},{length:20}),
      slot:'RECENT_NARRATIVE',sourceCategory:'GENERATION_ENVELOPE',owner:'GENERATION_ENVELOPE',semantic:false,semanticRefs:[],
      content:narrativeMessages.map(row=>({messageId:row.messageId,role:row.role,content:row.content})),
      sourceRevisionIds:[...new Set(narrativeMessages.flatMap(row=>row.sourceRevisionRefs??[]))].sort(),role:'context',
      required:false,priority:8,metadata:{contextRetirementReceiptId:contextRetirement.receiptId,hostHistoryMutation:false},
    }]:[];
    const contextRetirementReceipt=redactContextRetirement(contextRetirement);
    const deliveryStarted=perfNow();
    const delivery=this.core.deliverGenerationContext({
      published,chatId:chat,generationId,correlationId:corr,worldRevision:published.worldRevision,sceneRevision:sceneState.sceneRevision,
      modelProfileId,budgetTokens,systemPolicy,userInput:q,contributions,providerId,modelId,routeId,observedCacheBehavior,
    });
    const deliveryWallMs=Math.max(0,perfNow()-deliveryStarted);
    if(!delivery?.ok)throw new Error('NATIVE_BRAIN_DELIVERY_FAILED:'+String(delivery?.status??delivery?.failure?.code??'UNKNOWN'));
    const retrievalSkipped=(published.cognitiveChoiceReceipt?.skippedJobs??[]).includes('RETRIEVAL');
    if(retrievalSkipped){const reason=(published.cognitiveChoiceReceipt?.reasonCodes??[]).includes('HOT_SUFFICIENT')?'HOT_SUFFICIENT':'COGNITIVE_CHOICE_SKIPPED_RETRIEVAL';this.ownerLoreChannel.finalizeSkipped(reason);this.ownerMemoryChannel.finalizeSkipped(reason);}
    const channelReceipts=published.candidateEnvelope?.metadata?.channelReceipts??[];
    if(channelReceipts.some(row=>row.channelId===OWNER_KNOWLEDGE_CHANNELS.LORE&&row.status==='SKIPPED_LATENCY_BUDGET'))this.ownerLoreChannel.finalizeSkipped('LATENCY_BUDGET');
    if(channelReceipts.some(row=>row.channelId===OWNER_KNOWLEDGE_CHANNELS.MEMORY&&row.status==='SKIPPED_LATENCY_BUDGET'))this.ownerMemoryChannel.finalizeSkipped('LATENCY_BUDGET');
    const loreSync=this.#ownerRetrievalReceipt('LORE');
    const memorySync=this.#ownerRetrievalReceipt('MEMORY');
    const sceneSourceRevisionRefs=uniq(sceneState.sourceRevisionRefs??[]);
    const ownerSourceRevisionSet=uniq(this.core.externalCurrentSourceRevisionIds().filter(ref=>!sceneSourceRevisionRefs.includes(ref)));
    const sourceRevisionSet=uniq([...this.core.currentSourceRevisionIds(),...sceneSourceRevisionRefs,...(published.sealReceipt?.sourceRevisionIds??[])]);

    const record={
      kind:'NativeBrainTurnRecord',turnId:turn,sequence,chatId:chat,generationId:generation,correlationId:corr,
      query:q,intent,executionLabel,sceneId:sceneState.sceneId,sceneRevision:sceneState.sceneRevision,
      worldRevision:published.worldRevision,sourceRevisionSet,sceneSourceRevisionRefs,ownerSourceRevisionSet,
      sceneReadModel:createSceneUiReadModelFromIntegrationState(sceneState),
      perspectiveConstraint:clone(perspectiveConstraint),anchorEntityIds:uniq(anchorEntityIds),
      sceneOwnerReceipt:clone(sceneOwnerReceipt),sceneFanOutIngress:clone(sceneFanOutIngress),sceneIngress:{
        kind:'NativeBrainSceneIngressReceipt',
        timelineCount:sceneIngressReceipts.length,
        timelineReceipts:clone(sceneIngressReceipts),
        signalStatus:sceneSignalAdmission?.accepted===true?'ADMITTED':sceneSignalAdmission?.receipt?'REJECTED':'UNAVAILABLE',
        signalReceipt:clone(sceneSignalAdmission?.receipt??null),
        authorityGranted:false,canonicalMutationAuthority:false,settlementAuthority:false,contextSealAuthority:false,
      },
      retrievalPolicy:{candidateBudget:Number(candidateBudget)||64,latencyBudgetMs:Number(latencyBudgetMs),graphTraversal:clone(graphTraversal),retrievalIntents:clone(retrievalIntents)},
      sparseRetrievalReceipt:clone(sparseRetrievalReceipt),memoryDensePrime:clone(memoryDensePrime),
      published,delivery,contextRetirement:clone(contextRetirementReceipt),loreSync:clone(loreSync),memorySync:clone(memorySync),response:null,experience:null,settlements:[],reflections:[],feedback:null,
      performance:{
        kind:'NativeBrainGenerationPerformanceReceipt',contractVersion:1,
        chatId:chat,turnId:turn,generationId:generation,correlationId:corr,sceneRevision:sceneState.sceneRevision,worldRevision:published.worldRevision,
        stages:[
          ...(published.performanceReceipt?.stages??[]),
          {stage:'PROMPT_PLAN',wallMs:deliveryWallMs,queueWaitMs:0,inputCount:(published.sealReceipt?.admittedResultIds??[]).length,outputCount:(delivery.plan?.sections??[]).length,inputBytes:published.compilerReceipt?.compiledBytes??null,outputBytes:null,inputSizeClass:null,outputSizeClass:null,retainedObjectCount:(delivery.plan?.sections??[]).length,retainedBytes:null,outcome:delivery?.ok?'PLANNED':'FAILED'},
        ].slice(0,24),
        retrievalChannels:channelReceipts.slice(0,32).map(row=>({channelId:row.channelId,status:row.status,nominationCount:row.nominationCount,attemptedIntents:row.attemptedIntents,failedIntents:row.failedIntents,elapsedMs:row.elapsedMs})),
        counts:{...(published.performanceReceipt?.counts??{}),promptSections:(delivery.plan?.sections??[]).length,deferredSections:(delivery.plan?.deferred??[]).length},
        sizes:{...(published.performanceReceipt?.sizes??{}),promptPlanTokens:delivery.plan?.budget?.allocated??null,promptBudgetTokens:delivery.plan?.budget?.total??null},
        retained:{...(published.performanceReceipt?.retained??{}),promptSections:(delivery.plan?.sections??[]).length},
        detailedProfiling:false,rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
      },
      memoryReadDiagnosis:null,state:'SEALED_FOR_GENERATION',
    };
    record.performance.stages.push({stage:'BRAIN_PREPARATION_TOTAL',wallMs:Math.max(0,perfNow()-turnStarted),queueWaitMs:0,inputCount:1,outputCount:1,inputBytes:null,outputBytes:null,inputSizeClass:null,outputSizeClass:null,retainedObjectCount:1,retainedBytes:null,outcome:'SEALED_FOR_GENERATION'});
    record.performance.stages=record.performance.stages.slice(-24);
    this.#rememberTurn(record);
    this.#notify('TURN_PREPARED',record);
    return clone({
      kind:'NativeBrainPreparedTurn',executionLabel,selection:this.#selection(record),
      scene:sceneState,sceneOwnerReceipt:clone(safeSceneOwnerReceipt),sceneIngress:clone(record.sceneIngress),sceneFanOutIngress:clone(sceneFanOutIngress),loreSync,memorySync,memoryDensePrime:clone(memoryDensePrime),sparseRetrievalReceipt,retrievalIntents:clone(retrievalIntents),cognitiveChoice:published.cognitiveChoiceReceipt,
      candidateEnvelope:published.candidateEnvelope,truthAssessment:published.assessment,
      retrievalQualityReceipt:published.retrievalQualityReceipt??null,
      correctiveRetrievalReceipt:published.correctiveRetrievalReceipt??null,
      candidateTraceReceipt:published.candidateTraceReceipt??null,
      sceneFanOutResultBusReceipt:published.sceneFanOutResultBusReceipt??null,
      gatherReceipt:published.gatherReceipt,contextSealReceipt:published.sealReceipt,
      graphTraversalReceipt:published.graphTraversalReceipt??null,retrievalBudgetReceipt:published.retrievalBudgetReceipt??null,
      budgetDecision:delivery.plan?.diagnosticReceipt?.budgetDecision??null,
      contextRetirement:contextRetirementReceipt,promptDeliveryReceipt:delivery.receipt??null,
      promptPlan:delivery.plan,rendered:delivery.rendered,
      used:this.#usedWork(published),skipped:this.#skippedWork(published),
    });
  }

  // Lore owns its ontology; the Native identity registry is where Graph Walker resolves anchors and
  // owner-graph endpoints. Source owners may register stable identities (entityIdentityContract), so the
  // story-readable Lore entities are registered as owner-explicit identities with source links. Nothing
  // here settles a merge/split, and a failed or conflicting registration stays a receipt row.
  #syncLoreEntityIdentities(chatId){
    const iface=this.loreInterface;
    if(typeof iface?.entityIdentities!=='function')return null;
    this.loreIdentitySync??={keys:new Map(),refs:new Map(),last:null};
    const state=this.loreIdentitySync;
    let surface;
    try{surface=iface.entityIdentities({chatId,knownRevisionKey:state.keys.get(chatId)??null});}
    catch(error){state.last={kind:'NativeLoreIdentitySyncReceipt',chatId,status:'FAILED',reason:String(error?.message??error).slice(0,200)};return state.last;}
    if(surface?.status==='UNCHANGED')return state.last;
    const receipt={kind:'NativeLoreIdentitySyncReceipt',chatId,status:surface?.status??'UNAVAILABLE',reason:surface?.reason??null,revisionKey:surface?.revisionKey??null,registered:0,conflicts:[],invalidatedRevisionRefs:[],authorityGranted:false,settlementAuthority:false};
    const nextRefs=new Set();
    if(surface?.status==='OK'){
      for(const entity of surface.entities??[]){
        for(const ref of entity.sourceRevisionRefs??[])nextRefs.add(ref);
        try{
          this.core.registerEntityIdentity({
            entityId:entity.entityId,canonicalLabel:entity.canonicalName||entity.entityId,entityType:entity.entityType,
            providerId:'LORE_OWNER_GRAPH',sourceEntityId:entity.entityId,aliases:entity.aliases??[],storyScopeId:chatId,
            sourceRevisionRefs:entity.sourceRevisionRefs,provenanceRefs:entity.artifactRefs,authorityOrigin:'OWNER_EXPLICIT',
            metadata:{ownerAuthority:'LORE_ONTOLOGY',derivation:'LORE_ENTITY_EXTRACTION'},
          });
          receipt.registered+=1;
        }catch(error){receipt.conflicts.push({entityId:entity.entityId,reason:String(error?.message??error).slice(0,120)});}
      }
      for(const ref of state.refs.get(chatId)??[]){
        if(nextRefs.has(ref))continue;
        try{this.core.invalidateEntityIdentityRevision(ref,{reason:'LORE_SOURCE_REVISION_CHANGED'});receipt.invalidatedRevisionRefs.push(ref);}catch{}
      }
      state.keys.set(chatId,surface.revisionKey);state.refs.set(chatId,nextRefs);
    }
    state.last=receipt;
    return receipt;
  }

  #selectedTurnRetrievalIntents({chatId,query,intent='CURRENT',perspectiveConstraint=null,anchorEntityIds=[],graphTraversal=null}={}){
    const fallback=[{kind:intent,query,entityRefs:uniq(anchorEntityIds),perspective:clone(perspectiveConstraint),metadata:graphTraversal?{graphTraversal:clone(graphTraversal)}:{}}];
    const signal=this.sceneSignals.get(String(chatId));
    if(!signal?.sceneId||!Number(signal.sceneRevision))return fallback;
    try{
      const atmosphereContribution=signal.atmosphereContribution?.status==='AVAILABLE'?signal.atmosphereContribution:null;
      const scene={
        sceneId:String(signal.sceneId),revision:Number(signal.sceneRevision),sourceRevisionRefs:uniq(signal.sourceRevisionRefs??[]),provenance:uniq(signal.provenance??[]),
        fields:{
          location:{value:clone(signal.location??null)},activeCast:{value:clone(signal.activeCast??[])},activeThreads:{value:clone(signal.activeThreads??[])},
          activeRelationships:{value:clone(signal.activeRelationships??[])},immediateObjects:{value:clone(signal.objects??[])},atmosphere:{value:clone(atmosphereContribution?.dimensions??{})},
        },
      };
      const plan=this.sceneQueryPlanner.plan({scene,userInput:query,intent});
      const rows=(plan?.intents??[]).map((row)=>({
        intentId:row.intentId,
        kind:row.intentKind==='DIRECT_QUERY'?'AUTO':row.intentKind,
        query:row.query??query,
        entityRefs:uniq([...(row.entityRefs??[]),...(row.objectRefs??[]),...anchorEntityIds]),
        // Scene planner relationshipRefs are relationship identities, not graph edge-class filters.
        // Preserve them as planner metadata so Graph Walker does not interpret IDs as allowedEdgeMeanings.
        relationshipRefs:[],
        artifactRefs:uniq(row.objectRefs??[]),
        temporalConstraint:null,
        perspective:clone(perspectiveConstraint),
        metadata:{sceneIntentKind:row.intentKind,sceneRelationshipRefs:uniq(row.relationshipRefs??[]),locationRefs:uniq(row.locationRefs??[]),objectRefs:uniq(row.objectRefs??[]),threadRefs:uniq(row.threadRefs??[]),atmosphereContributionStatus:signal.atmosphereContribution?.status??'UNAVAILABLE',...(graphTraversal?{graphTraversal:clone(graphTraversal)}:{})},
      }));
      return rows.length?rows:fallback;
    }catch{
      return fallback;
    }
  }

  async runTurn(input,{generate=null,completeOptions={}}={}){
    const prepared=await this.prepareTurn(input);
    if(typeof generate!=='function')return{prepared,response:null,learning:null};
    const raw=await generate(prepared.rendered,{
      selection:prepared.selection,promptPlan:prepared.promptPlan,contextSealReceipt:prepared.contextSealReceipt,
      contextRetirement:prepared.contextRetirement??null,sceneOwnerReceipt:prepared.sceneOwnerReceipt??null,
    });
    const response=typeof raw==='string'?raw:raw?.text??raw?.content;
    if(typeof response!=='string'||!response.trim())throw new TypeError('generation callback must return response text');
    const record=this.turns.get(String(input.turnId));
    if(!record)throw new Error('Unknown native Brain turn: '+String(input.turnId));
    const responseEvidence=typeof raw==='object'&&raw!==null?{
      chatId:raw.chatId,turnId:raw.turnId,generationId:raw.generationId,correlationId:raw.correlationId,
      contextSealId:raw.contextSealId,requestId:raw.requestId,responseId:raw.responseId,
      providerId:raw.providerId,routeId:raw.routeId,capturedAt:raw.capturedAt??Date.now(),
    }:{
      chatId:prepared.selection?.chatId,turnId:prepared.selection?.turnId,generationId:prepared.selection?.generationId,
      correlationId:prepared.selection?.correlationId,contextSealId:prepared.contextSealReceipt?.id,capturedAt:Date.now(),
    };
    const deliveryReceipt=this.core.delivery.attachProviderResponseEvidence(record.delivery?.receipt,responseEvidence);
    const responsePhase=deliveryReceipt?.phases?.providerResponse??null;
    if(responsePhase?.status!=='RECEIVED'){
      const mismatch=(responsePhase?.identityMismatch??[]).join(',')||'unknown';
      throw new Error('PROVIDER_RESPONSE_IDENTITY_MISMATCH:'+mismatch);
    }
    record.delivery.receipt=clone(deliveryReceipt);
    const providerStageAlreadyMeasured=record.performance?.stages?.some(stage=>stage.stage==='PROVIDER_RESPONSE'&&stage.wallMs!=null);
    if((typeof raw==='object'&&raw!==null)||!providerStageAlreadyMeasured)this.#appendPerformanceStage(record,{stage:'PROVIDER_RESPONSE',wallMs:typeof raw==='object'&&raw!==null?raw.providerLatencyMs:null,queueWaitMs:typeof raw==='object'&&raw!==null?raw.providerQueueWaitMs:0,inputCount:1,outputCount:1,outcome:'RECEIVED'});
    this.#notify('PROVIDER_RESPONSE_RECEIVED',record);
    const learningStarted=perfNow();
    const learning=await this.completeTurn({turnId:input.turnId,response,...completeOptions});
    const foregroundCompletionMs=Math.max(0,perfNow()-learningStarted);
    this.#appendPerformanceStage(record,{stage:'LEARNING',wallMs:foregroundCompletionMs,queueWaitMs:0,inputCount:1,outputCount:learning?1:0,outcome:learning?.learningLifecycle?.status??(learning?'COMPLETED':'NO_RECEIPT')});
    if(completeOptions?.autoDrain===false)this.startBackgroundLearning({maxCycles:128});
    return{prepared,response,completion:clone(record.responseCompletionReceipt??null),learning};
  }

  async completeTurn({turnId,response,knownBy=[],observations=[],reflections=[],autoDrain=true}={}){
    const completionStarted=perfNow();
    const id=req(turnId,'turnId'),text=req(response,'response'),record=this.turns.get(id);
    if(!record)throw new Error('Unknown native Brain turn: '+id);
    if(record.responseCompletionReceipt){
      if(record.response!==text)throw new Error('DUPLICATE_RESPONSE_MISMATCH:'+id);
      if(autoDrain){
        await this.drainBackgroundLearning({maxCycles:128});
        record.explicitLearningDrainCompleted=true;
        const refreshed=this.#refreshLearningLifecycle(record)??record.learningReceipt;
        this.#notifyLearningAccepted(record,refreshed);
        return clone(refreshed);
      }
      return clone(this.#refreshLearningLifecycle(record)??record.learningReceipt);
    }

    const experience=this.knowledge.admitExperience({
      sourceId:'narrative:'+record.chatId+':'+id+':assistant',
      sourceType:'NARRATIVE_EXPERIENCE',exactContent:text,
      knownBy:uniq(knownBy),chatId:record.chatId,turnId:id,generationId:record.generationId,
      correlationId:record.correlationId,sceneRevision:record.sceneRevision,worldRevision:record.worldRevision,
      metadata:{role:'assistant',sequence:record.sequence,representationText:text},
    });
    this.core.consumeNarrativeEvidence({
      kind:'NarrativeEvidence',chatId:record.chatId,turnId:id,messageId:'assistant:'+id,
      messageRevision:1,sequence:record.sequence,activity:'APPEND',role:'assistant',
      sourceRevisionId:experience.sourceRevisionId,content:text,current:true,invalidates:[],
      knownBy:uniq(knownBy),publicToAll:false,
    });
    const memoryExpectedId=this.#declareMemoryExpectedWork(record,experience);
    if(memoryExpectedId)this.obligationReconciler.recordEvidence(memoryExpectedId,{kind:CausalReceiptKind.PHYSICAL_EXECUTION_STARTED,producerId:'NATIVE_BRAIN',consumerId:'MEMORY',metadata:{operation:'admitExternalEvidenceMapping'}});
    const memoryWriteback=this.#writeBackMemoryEvidence(record,experience,{knownBy,exactContent:text});
    this.#recordMemoryExpectedResult(memoryExpectedId,memoryWriteback);

    const settlements=[];
    for(let index=0;index<observations.length;index++)settlements.push(this.#settleObservation(record,experience,observations[index],index));
    const memorySettlementReceipts=this.#mirrorSettlementsToMemory(record,experience,settlements);
    const reflectionRows=[];
    for(let index=0;index<reflections.length;index++){
      const item=reflections[index],statement=req(item?.statement,'reflection.statement');
      reflectionRows.push(this.knowledge.admitReflection({
        sourceId:'reflection:'+record.chatId+':'+id+':'+index,
        sourceType:'REFLECTION',exactContent:statement,temporalStatus:item.temporalStatus??KnowledgeTemporalStatus.UNRESOLVED,
        knownBy:uniq(item.knownBy??knownBy),chatId:record.chatId,turnId:id,generationId:record.generationId,
        correlationId:record.correlationId,sceneRevision:record.sceneRevision,worldRevision:this.core.graph.revision,
        confidence:item.confidence??null,semantic:item.semantic??null,
        provenanceRefs:[experience.sourceRevisionId],dependencyRevisionRefs:[experience.sourceRevisionId],
        metadata:{representationText:statement,reason:item.reason??null},
      }));
    }

    record.response=text;record.experience=clone(experience);record.settlements=clone(settlements);record.reflections=clone(reflectionRows);
    record.state='RESPONSE_ACCEPTED';
    this.runtimeDirector.completeGeneration({turnId:id,correlationId:record.correlationId,generationId:record.generationId});
    const feedbackTask=this.#scheduleFeedback(id,experience.sourceRevisionId);
    const memoryFeedbackTask=this.#scheduleMemoryRetrievalFeedback(record);
    const memoryTask=this.#scheduleMemoryPostTurn(record,experience,memoryWriteback,{knownBy,reflections,memoryExpectedId});
    const feedbackTaskId=feedbackTask?.task?.taskId??null;
    const memoryFeedbackTaskId=memoryFeedbackTask?.task?.taskId??null;
    const memoryTaskId=memoryTask?.task?.taskId??null;
    record.feedbackRuntimeTaskId=feedbackTaskId;
    record.memoryFeedbackRuntimeTaskId=memoryFeedbackTaskId;
    record.memoryRuntimeTaskId=memoryTaskId;
    record.responseCompletionReceipt={
      kind:'NativeBrainResponseCompletionReceipt',contractVersion:1,status:'COMPLETED',
      chatId:record.chatId,turnId:id,generationId:record.generationId,correlationId:record.correlationId,
      contextSealId:record.published?.sealReceipt?.id??null,sourceRevisionId:experience.sourceRevisionId,
      foregroundWaitMs:Math.max(0,perfNow()-completionStarted),
      boundedOwnerAcknowledgement:{memoryWritebackStatus:memoryWriteback?.status??'NO_EVIDENCE',memoryOwnerAccepted:['ADMITTED','REPLAYED'].includes(String(memoryWriteback?.status??'').toUpperCase()),settlementCount:settlements.length},
      learningScheduled:Boolean(feedbackTaskId||memoryFeedbackTaskId||memoryTaskId),feedbackRuntimeTaskId:feedbackTaskId,memoryFeedbackRuntimeTaskId:memoryFeedbackTaskId,memoryRuntimeTaskId:memoryTaskId,
      responseRecordedBeforeBackgroundExecution:true,sealedGenerationImmutable:true,
      rawResponseIncluded:false,rawPromptIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
    };
    record.learningReceipt={
      kind:'NativeBrainLearningReceipt',turnId:id,experienceId:experience.evidenceId,sourceRevisionId:experience.sourceRevisionId,
      settlementDecisions:settlements.map(x=>x?.decision?.decision??'REJECTED'),
      reflectionEvidenceIds:reflectionRows.map(x=>x.evidenceId),
      feedback:clone(record.feedback),runtimeTaskId:feedbackTaskId,memoryFeedbackRuntimeTaskId:memoryFeedbackTaskId,memoryRuntimeTaskId:memoryTaskId,
      memoryRetrievalFeedbackBatch:clone(record.memoryRetrievalFeedbackBatch??null),memoryRetrievalFeedback:clone(record.memoryRetrievalFeedback??null),
      memoryWriteback:clone(memoryWriteback),memoryPostTurn:clone(record.memoryPostTurn??null),
      memoryConsolidation:clone(record.memoryConsolidation??null),memoryConsolidationRuntimeTaskId:record.memoryConsolidationRuntimeTaskId??null,
      memorySettlementReceipts:clone(memorySettlementReceipts),responseCompletion:clone(record.responseCompletionReceipt),
      learningLifecycle:{status:(feedbackTaskId||memoryFeedbackTaskId||memoryTaskId)?'SCHEDULED':'ACCEPTED',backgroundPending:Boolean(feedbackTaskId||memoryFeedbackTaskId||memoryTaskId),tasks:[],backgroundExecutionMs:null},
      rawExperienceRecoverable:Boolean(this.core.registry.getRevision(experience.sourceRevisionId)?.exactContent===text),
      sealedGenerationImmutable:true,canonicalMutationAuthority:'CORE_SETTLEMENT_ONLY',
    };
    this.#refreshLearningLifecycle(record);
    this.#notify('TURN_RESPONSE_COMPLETED',record);
    if(autoDrain){
      await this.drainBackgroundLearning({maxCycles:128});
      record.explicitLearningDrainCompleted=true;
      const refreshed=this.#refreshLearningLifecycle(record)??record.learningReceipt;
      this.#notifyLearningAccepted(record,refreshed);
      return clone(refreshed);
    }
    return clone(this.#refreshLearningLifecycle(record)??record.learningReceipt);
  }

  startBackgroundLearning({maxCycles=128}={}){
    void this.drainBackgroundLearning({maxCycles}).catch(()=>{});
    return{kind:'NativeBrainBackgroundLearningStartReceipt',status:'SCHEDULED',maxCycles:Number(maxCycles)||128,existingRuntime:true,newQueueCreated:false};
  }

  async drainBackgroundLearning({maxCycles=128}={}){
    if(this.backgroundDrainPromise)return this.backgroundDrainPromise;
    const run=(async()=>{
      const started=perfNow();
      const result=await this.runtimeDirector.drain({maxCycles});
      for(const row of this.turns.values())if(row?.responseCompletionReceipt)this.#refreshLearningLifecycle(row);
      return{kind:'NativeBrainBackgroundDrainReceipt',...result,backgroundExecutionMs:Math.max(0,perfNow()-started),existingRuntime:true};
    })();
    this.backgroundDrainPromise=run;
    try{return await run;}finally{if(this.backgroundDrainPromise===run)this.backgroundDrainPromise=null;}
  }

  #recordTaskOwnerDecision(taskId,{accepted,receiptId=null,reasonCode=null,consumerId=null,durationMs=null}={}){
    if(!taskId)return null;
    const task=this.runtimeDirector.ledger.get(taskId);
    if(!task)return null;
    const existing=(task.causalReceipts??[]).find(row=>[CausalReceiptKind.OWNER_ADMISSION,CausalReceiptKind.OWNER_REJECTED].includes(row?.eventKind??row?.kind));
    if(existing)return existing;
    return this.runtimeDirector.recordOwnerAdmission(taskId,{accepted:Boolean(accepted),receiptId,reasonCode,consumerId,durationMs});
  }

  #refreshLearningLifecycle(record){
    if(!record?.learningReceipt||!record?.responseCompletionReceipt)return record?.learningReceipt??null;
    const ids=uniq([record.feedbackRuntimeTaskId,record.memoryFeedbackRuntimeTaskId,record.memoryRuntimeTaskId,record.memoryConsolidationRuntimeTaskId]);
    const tasks=ids.map(taskId=>this.runtimeDirector.ledger.get(taskId)).filter(Boolean).map(task=>{
      const owner=(task.causalReceipts??[]).slice().reverse().find(row=>[CausalReceiptKind.OWNER_ADMISSION,CausalReceiptKind.OWNER_REJECTED].includes(row?.eventKind??row?.kind))??null;
      const returned=(task.causalReceipts??[]).slice().reverse().find(row=>[CausalReceiptKind.RESULT_RETURNED,CausalReceiptKind.RESULT_LATE,CausalReceiptKind.WORK_FAILED].includes(row?.eventKind??row?.kind))??null;
      return{
        taskId:task.taskId,taskType:task.obligation?.taskType??null,layer:task.obligation?.layer??null,runtimeClass:task.obligation?.runtimeClass??null,
        lifecycleStatus:task.lifecycleStatus,executionStatus:task.executionStatus,reasonCode:task.executionReason??task.lifecycleReason??null,
        startedCount:Number(task.startedCount??0),ownerAccepted:owner?.ownerAccepted??null,ownerReceiptId:owner?.metadata?.ownerReceiptId??null,
        executionReturned:Boolean(returned),executionDurationMs:returned?.durationMs??null,recoveryState:task.recoveryState??null,
      };
    });
    const running=tasks.some(row=>['ACTIVE','YIELDING'].includes(String(row.executionStatus)));
    const pending=tasks.some(row=>['PENDING','ELIGIBLE'].includes(String(row.lifecycleStatus))||['QUEUED','ACTIVE','YIELDING','PARKED','RECOVERING','BLOCKED'].includes(String(row.executionStatus)));
    const failed=tasks.some(row=>row.executionStatus==='FAILED'||row.ownerAccepted===false);
    const consolidationStatus=String(record.memoryConsolidation?.status??'').toUpperCase();
    const deferred=['DEFERRED','STALE','SKIPPED'].includes(consolidationStatus)&&Boolean(record.memoryConsolidation);
    let status=running?'RUNNING':pending?'SCHEDULED':failed?'FAILED':deferred?'DEFERRED':'ACCEPTED';
    const knownDurations=tasks.map(row=>Number(row.executionDurationMs)).filter(Number.isFinite);
    const providerMs=Number(record.memoryConsolidation?.sidecarExecution?.providerLatencyMs);
    const backgroundExecutionMs=Number.isFinite(providerMs)?providerMs:(knownDurations.length?knownDurations.reduce((a,b)=>a+b,0):null);
    record.learningReceipt={
      ...record.learningReceipt,feedback:clone(record.feedback),memoryRetrievalFeedbackBatch:clone(record.memoryRetrievalFeedbackBatch??null),memoryRetrievalFeedback:clone(record.memoryRetrievalFeedback??null),
      memoryPostTurn:clone(record.memoryPostTurn??null),memoryConsolidation:clone(record.memoryConsolidation??null),
      memoryFeedbackRuntimeTaskId:record.memoryFeedbackRuntimeTaskId??null,memoryConsolidationRuntimeTaskId:record.memoryConsolidationRuntimeTaskId??null,responseCompletion:clone(record.responseCompletionReceipt),
      learningLifecycle:{status,backgroundPending:pending||running,tasks,backgroundExecutionMs,foregroundWaitMs:record.responseCompletionReceipt.foregroundWaitMs,
        responseCompletionStatus:record.responseCompletionReceipt.status,sealedGenerationImmutable:true,
        explicitDrainCompleted:Boolean(record.explicitLearningDrainCompleted),
        compatibilityTerminalLearned:Boolean(record.explicitLearningDrainCompleted&&!pending&&!running&&!failed)},
    };
    const compatibilityTerminalLearned=Boolean(record.explicitLearningDrainCompleted&&!pending&&!running&&!failed);
    record.state=(status==='ACCEPTED'||compatibilityTerminalLearned)?'LEARNED':status==='FAILED'?'LEARNING_FAILED':status==='DEFERRED'?'LEARNING_DEFERRED':'RESPONSE_COMPLETED';
    return record.learningReceipt;
  }

  #notifyLearningAccepted(record,learning=null){
    if(!record||record.learningAcceptedNotified)return false;
    const receipt=learning??record.learningReceipt;
    if(receipt?.learningLifecycle?.status!=='ACCEPTED'&&!receipt?.learningLifecycle?.compatibilityTerminalLearned)return false;
    record.learningAcceptedNotified=true;
    this.#notify('TURN_LEARNED',record);
    return true;
  }

  // Host deleted the message this turn's response was learned from. History is preserved (the source
  // is retired, not erased); every current-state consumer of that revision is invalidated.
  retireTurnNarrative(turnId,{reason='HOST_MESSAGE_DELETED'}={}){
    const id=req(turnId,'turnId'),record=this.turns.get(id);
    if(!record?.experience)return{kind:'NativeTurnNarrativeRetirementReceipt',turnId:id,status:'NO_LEARNED_NARRATIVE',historyPreserved:true};
    const prior=this.knowledge.currentRecordForSource(record.experience.sourceId);
    if(!prior)return{kind:'NativeTurnNarrativeRetirementReceipt',turnId:id,status:'ALREADY_RETIRED',historyPreserved:true};
    const removal=this.knowledge.removeSource(record.experience.sourceId,{reason});
    const invalidatedClaimIds=this.core.graph.invalidateClaimsBySourceRevision(prior.sourceRevisionId);
    let memoryInvalidation=null;
    const invalidate=this.memoryInterface?.invalidateExternalEvidenceMapping??this.memoryInterface?.adapters?.invalidateExternalEvidenceMapping;
    if(typeof invalidate==='function'){
      const ownerArtifactRef=this.#memoryOwnerArtifactRef(record,prior);
      memoryInvalidation=invalidate({ownerArtifactRef,externalEvidenceRef:ownerArtifactRef.artifactId,replacedBySourceRevisionId:null,removed:true,reason});
      if(memoryInvalidation&&typeof memoryInvalidation.then==='function')throw new Error('MEMORY_ASYNC_INVALIDATION_UNSUPPORTED_IN_SYNC_COMMIT');
    }
    this.core.hotCognition.invalidateKnowledge({
      chatNamespace:record.chatId,updateId:'narrative-retired:'+prior.sourceRevisionId,
      invalidatedSourceRevisionRefs:[prior.sourceRevisionId],reason,
    });
    this.core.consumeNarrativeEvidence({
      kind:'NarrativeEvidence',chatId:record.chatId,turnId:id,messageId:'assistant:'+id,messageRevision:2,
      sequence:record.sequence,activity:'DELETE',role:'assistant',sourceRevisionId:prior.sourceRevisionId,
      content:null,current:false,invalidates:[prior.sourceRevisionId],knownBy:[],publicToAll:false,
    });
    record.retiredNarrative={reason,sourceRevisionId:prior.sourceRevisionId};
    return{kind:'NativeTurnNarrativeRetirementReceipt',turnId:id,status:'RETIRED',reason,sourceRevisionId:prior.sourceRevisionId,invalidatedClaimIds:clone(invalidatedClaimIds),removal:clone(removal),memoryInvalidation:clone(memoryInvalidation),historyPreserved:true};
  }

  correctTurn({turnId,response,observations=[],knownBy=[],reflections=[]}={}){
    const id=req(turnId,'turnId'),record=this.turns.get(id);if(!record?.experience)throw new Error('Turn has no learned narrative source: '+id);
    const prior=this.knowledge.currentRecordForSource(record.experience.sourceId);if(!prior)throw new Error('Narrative source is not current: '+id);
    const corrected=this.knowledge.correctSource(record.experience.sourceId,req(response,'response'),{
      knownBy:uniq(knownBy),metadata:{role:'assistant',sequence:record.sequence,representationText:response},
    });
    const invalidatedClaimIds=this.core.graph.invalidateClaimsBySourceRevision(prior.sourceRevisionId);
    this.core.hotCognition.invalidateKnowledge({
      chatNamespace:record.chatId,updateId:'narrative-correction:'+prior.sourceRevisionId+'->'+corrected.sourceRevisionId,
      invalidatedSourceRevisionRefs:[prior.sourceRevisionId],reason:'NARRATIVE_SOURCE_CORRECTED',
    });
    this.core.consumeNarrativeEvidence({
      kind:'NarrativeEvidence',chatId:record.chatId,turnId:id,messageId:'assistant:'+id,messageRevision:2,
      sequence:record.sequence,activity:'EDIT',role:'assistant',sourceRevisionId:corrected.sourceRevisionId,
      content:response,current:true,invalidates:[prior.sourceRevisionId],
      knownBy:uniq(knownBy),publicToAll:false,
    });
    const memoryWriteback=this.#writeBackMemoryEvidence(record,corrected,{knownBy,exactContent:response,priorExperience:prior});
    let memoryPostTurn=null;
    const accept=this.memoryInterface?.acceptCompletedTurn??this.memoryInterface?.adapters?.acceptCompletedTurn;
    if(typeof accept==='function'&&['ADMITTED','REPLAYED'].includes(String(memoryWriteback?.status??'').toUpperCase())){
      const ownerArtifactRef=this.#memoryOwnerArtifactRef(record,corrected);
      const reflectionCandidates=(reflections??[]).slice(0,8).map((item,index)=>({
        reflectionKey:item?.reflectionKey??item?.semantic?.reflectionKey??null,
        statement:String(item?.statement??''),
        subjectRefs:uniq(item?.subjectRefs??item?.semantic?.subjectRefs??[]).slice(0,32),
        confidence:item?.confidence??0.5,
        polarity:item?.polarity??(item?.contradiction===true?'CONTRADICT':'SUPPORT'),
        index,
      }));
      memoryPostTurn=accept({
        chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,
        sceneId:record.sceneId??null,sceneRevision:record.sceneRevision,worldRevision:record.worldRevision,
        contextSealId:record.published?.sealReceipt?.id??null,sourceRevisionId:corrected.sourceRevisionId,
        ownerArtifactRef,externalEvidenceRef:ownerArtifactRef.artifactId,reflectionCandidates,
      });
      if(memoryPostTurn&&typeof memoryPostTurn.then==='function')throw new Error('MEMORY_ASYNC_CORRECTION_ADMISSION_UNSUPPORTED_IN_SYNC_CORRECTION');
    }
    const settlements=observations.map((row,index)=>this.#settleObservation(record,corrected,row,index));
    const memorySettlementReceipts=this.#mirrorSettlementsToMemory(record,corrected,settlements);
    record.response=response;record.experience=clone(corrected);record.settlements=clone(settlements);record.memoryPostTurn=clone(memoryPostTurn);record.state='LEARNED';
    if(record.learningReceipt)record.learningReceipt={...record.learningReceipt,sourceRevisionId:corrected.sourceRevisionId,memoryWriteback:clone(memoryWriteback),memoryPostTurn:clone(memoryPostTurn),memorySettlementReceipts:clone(memorySettlementReceipts)};
    this.#notify('TURN_CORRECTED',record);
    return{kind:'NativeBrainCorrectionReceipt',turnId:id,priorSourceRevisionId:prior.sourceRevisionId,sourceRevisionId:corrected.sourceRevisionId,invalidatedClaimIds,settlements,memoryWriteback,memoryPostTurn,memorySettlementReceipts,historyPreserved:this.knowledge.history(prior.sourceId).length>1};
  }

  subscribe(listener){
    if(typeof listener!=='function')throw new TypeError('native Brain listener must be a function');
    this.listeners.add(listener);return()=>this.listeners.delete(listener);
  }

  uiBindings(){
    return Object.freeze({
      readSelection:({chatId}={})=>this.#selectionForChat(chatId),
      subscribe:(listener)=>this.subscribe(listener),
      readScene:(selection={})=>this.#readStage(selection,record=>this.#generationSceneReadModel(record)),
      readHotCognition:(selection={})=>this.#readStage(selection,record=>this.#generationHotSnapshot(record)),
      readCognitiveChoice:(selection={})=>this.#readStage(selection,record=>record.published?.cognitiveChoiceReceipt??null),
      readScatter:(selection={})=>this.#readStage(selection,record=>this.#uiScatterReceipt(record)),
      readSensoryTrace:(selection={})=>this.#readStage(selection,record=>record.published?.candidateEnvelope??null),
      readCandidateBusEnvelope:(selection={})=>this.#readStage(selection,record=>record.published?.candidateEnvelope??null),
      readCandidateFusionReceipt:(selection={})=>this.#readStage(selection,record=>record.published?.candidateEnvelope?.fusionReceipt??null),
      readIdentityResolution:(selection={})=>this.#readStage(selection,record=>({kind:'NativeBrainIdentityResolutionReadModel',...this.#selection(record),...this.core.entityIdentityReadModel({storyId:record.chatId}),loreIdentitySync:clone(this.loreIdentitySync?.last??null),authorityGranted:false})),
      readGraphTraversal:(selection={})=>this.#readStage(selection,record=>record.published?.graphTraversalReceipt??record.published?.candidateEnvelope?.metadata?.graphTraversalReceipt??null),
      readWorldGraphReferences:(selection={})=>this.#readStage(selection,record=>this.#worldGraphReferenceReadModel(record)),
      readRetrievalBudget:(selection={})=>this.#readStage(selection,record=>this.#uiRetrievalBudgetReceipt(record)),
      readRejectedEvidence:(selection={})=>this.#readStage(selection,record=>this.#uiRejectedEvidence(record)),
      readTruth:(selection={})=>this.#readStage(selection,record=>record.published?.publicationAssessment??record.published?.assessment??null),
      readCorrectiveRetrieval:(selection={})=>this.#readStage(selection,record=>record.published?.corrective??null),
      readJev:(selection={})=>this.#readStage(selection,record=>record.published?.cognitiveChoiceReceipt?.jev??null),
      readPrecision:(selection={})=>this.#readStage(selection,record=>this.#uiPrecisionReceipt(record)),
      readGather:(selection={})=>this.#readStage(selection,record=>this.#uiGatherReceipt(record)),
      readContextSeal:(selection={})=>this.#readStage(selection,record=>record.published?.sealReceipt??null),
      readLoreStatus:(selection={})=>this.#readStage(selection,record=>({kind:'NativeBrainLoreStatus',...this.#selection(record),sync:clone(record.loreSync??null),fallbackStore:this.loreInterface?null:this.knowledge.diagnostics(),authorityGranted:false})),
      readMemoryStatus:(selection={})=>this.#readStage(selection,record=>this.#memoryReadModel(record,selection)),
      readRuntimeStatus:()=>clone(this.runtimeDirector.snapshot()),
      readExpectedWork:(selection={})=>this.#readStage(selection,record=>this.#expectedWorkReadModel(record)),
      readPromptPlan:(selection={})=>this.#readStage(selection,record=>record.delivery?.plan??null),
      readContextRetirement:(selection={})=>this.#readStage(selection,record=>record.contextRetirement??null),
      readPromptDeliveryReceipt:(selection={})=>this.#readStage(selection,record=>record.delivery?.receipt??null),
      readContextReceipt:(selection={})=>this.#readStage(selection,record=>this.#contextReceipt(record)),
      readSelectedTurnReceipt:(selection={})=>this.#readStage(selection,record=>this.#selectedTurnReceipt(record)),
      listGenerations:({limit=50,selection={}}={})=>this.#listGenerations({limit,selection}),
      readGeneration:({generationId,...selection}={})=>this.#readGeneration(generationId,selection),
    });
  }

  receiveCognitiveResult(result){
    return this.core.publication.receiveResult(result);
  }

  contextRetirementContract(){return contextRetirementContract();}
  promptDeliveryIntegrationContract(){return this.core.delivery.integrationContract();}
  attachObservedHostPromptEvidence(receipt,evidence={}){return this.core.delivery.attachObservedHostEvidence(receipt,evidence);}
  attachProviderResponseEvidence(receipt,evidence={}){return this.core.delivery.attachProviderResponseEvidence(receipt,evidence);}
  declareExpectedCognitiveWork(declaration,executor=null){return this.obligationReconciler.declare(declaration,executor);}
  reconcileExpectedCognitiveWork(expectedId,options={}){return this.obligationReconciler.reconcile(expectedId,options);}
  listExpectedCognitiveWork(){return this.obligationReconciler.list();}
  recordLoreStudyOwnerReceipt(receipt={}){
    if(!receipt||receipt.kind!=='LoreStudyRunReceipt'||!Array.isArray(receipt.results))throw new TypeError('LoreStudyRunReceipt with results is required');
    const known=new Set(this.obligationReconciler.list().map(row=>row.expectedId)),results=[];
    for(const row of receipt.results.slice(0,64)){
      const obligation=row?.obligation??{},obligationId=obligation.id==null?null:String(obligation.id);
      if(!obligationId){results.push({kind:'NativeBrainLoreStudyResultReconciliation',status:'IGNORED',reasonCode:'LORE_STUDY_OBLIGATION_ID_MISSING',authorityGranted:false});continue;}
      const expectedId='lore-study:'+obligationId;
      if(!known.has(expectedId)){results.push({kind:'NativeBrainLoreStudyResultReconciliation',expectedId,status:'NO_EXPECTED_WORK',reasonCode:'NO_EXPECTED_WORK',authorityGranted:false});continue;}
      const state=String(obligation.state??'UNKNOWN').toUpperCase(),attempt=Math.max(0,Number(obligation.attempts??0)||0);
      const metadata={ownerReceiptKind:'LoreStudyRunReceipt',obligationId,studyState:state,attempt,sourceId:obligation.sourceId??null,sourceRevisionId:obligation.sourceRevisionId??null,learnedRevisionId:row?.learnedRevision?.id??null,checkpointed:Boolean(row?.checkpointed),failed:Boolean(row?.failed),errorCode:row?.error?.code??obligation?.lastError?.code??null};
      const receiptBase='lore-study-owner:'+stableHash({expectedId,state,attempt,sourceRevisionId:metadata.sourceRevisionId,learnedRevisionId:metadata.learnedRevisionId,checkpointed:metadata.checkpointed,failed:metadata.failed},{length:24});
      const started=this.obligationReconciler.recordEvidence(expectedId,{id:receiptBase+':started',kind:CausalReceiptKind.PHYSICAL_EXECUTION_STARTED,producerId:'LORE',consumerId:'RUNTIME_CORE',metadata});
      if(state==='COMPLETED'){
        const returned=this.obligationReconciler.recordEvidence(expectedId,{id:receiptBase+':returned',kind:CausalReceiptKind.RESULT_RETURNED,producerId:'LORE',consumerId:'NATIVE_BRAIN',parentReceiptId:started.id,metadata});
        this.obligationReconciler.recordEvidence(expectedId,{id:receiptBase+':accepted',kind:CausalReceiptKind.OWNER_ADMISSION,producerId:'LORE',consumerId:'COGNITIVE_STATE',parentReceiptId:returned.id,ownerAccepted:true,metadata});
      }else if(state==='SUPERSEDED'){
        this.obligationReconciler.recordEvidence(expectedId,{id:receiptBase+':stale',kind:CausalReceiptKind.RESULT_STALE,producerId:'LORE',consumerId:'NATIVE_BRAIN',parentReceiptId:started.id,metadata});
      }else if(state==='FAILED'||state==='INVALID'){
        this.obligationReconciler.recordEvidence(expectedId,{id:receiptBase+':failed',kind:CausalReceiptKind.WORK_FAILED,producerId:'LORE',consumerId:'NATIVE_BRAIN',parentReceiptId:started.id,reasonCode:CausalReasonCode.TASK_FAILED,metadata});
      }else{
        this.obligationReconciler.recordEvidence(expectedId,{id:receiptBase+':returned',kind:CausalReceiptKind.RESULT_RETURNED,producerId:'LORE',consumerId:'NATIVE_BRAIN',parentReceiptId:started.id,metadata});
      }
      results.push(this.obligationReconciler.reconcile(expectedId,{admit:false}));
    }
    return{kind:'NativeBrainLoreStudyReconciliationReceipt',contractVersion:1,sourceReceiptKind:receipt.kind,results:clone(results),rawLoreIncluded:false,authorityGranted:false,canonicalMutationAuthority:false};
  }
  recordHostObservationEvidence(turnId,evidence={}){
    const id=req(turnId,'turnId'),record=this.turns.get(id);if(!record)throw new Error('Unknown native Brain turn: '+id);
    const mismatch=(name,expected,actual)=>actual!=null&&String(actual)!==String(expected)?name:null;
    const bad=[mismatch('chatId',record.chatId,evidence.chatId),mismatch('turnId',record.turnId,evidence.turnId),mismatch('generationId',record.generationId,evidence.generationId),mismatch('correlationId',record.correlationId,evidence.correlationId),mismatch('worldRevision',record.worldRevision,evidence.worldRevision),mismatch('sceneRevision',record.sceneRevision,evidence.sceneRevision)].filter(Boolean);
    if(bad.length)throw new Error('HOST_OBSERVATION_IDENTITY_MISMATCH:'+bad.join(','));
    record.hostObservation={
      kind:'ObservedHostTurnEvidence',eventId:req(evidence.eventId??('host-observation:'+record.generationId),'host observation eventId'),
      chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,
      worldRevision:record.worldRevision,sceneRevision:record.sceneRevision,sourceRevisionRefs:uniq(evidence.sourceRevisionRefs??record.sceneSourceRevisionRefs??[]).slice(0,32),
      durationMs:Number.isFinite(Number(evidence.durationMs))?Math.max(0,Number(evidence.durationMs)):null,capturedAt:evidence.capturedAt??null,
      rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
    };
    this.#appendPerformanceStage(record,{stage:'HOST_PREPARATION',wallMs:record.hostObservation.durationMs,queueWaitMs:0,inputCount:1,outputCount:1,outcome:'HOST_EVENT_PREPARED'});
    this.#notify('HOST_OBSERVATION_RECORDED',record);return clone(record.hostObservation);
  }
  recordObservedHostPromptEvidence(turnId,evidence={}){
    const id=req(turnId,'turnId'),record=this.turns.get(id);if(!record)throw new Error('Unknown native Brain turn: '+id);
    const bounded={...clone(evidence),chatId:evidence.chatId??record.chatId,turnId:evidence.turnId??record.turnId,generationId:evidence.generationId??record.generationId,correlationId:evidence.correlationId??record.correlationId,contextSealId:evidence.contextSealId??record.delivery?.receipt?.contextSealId};
    for(const [name,expected] of [['chatId',record.chatId],['turnId',record.turnId],['generationId',record.generationId],['correlationId',record.correlationId]])if(bounded[name]!=null&&String(bounded[name])!==String(expected))throw new Error('HOST_DELIVERY_IDENTITY_MISMATCH:'+name);
    const receipt=this.core.delivery.attachObservedHostEvidence(record.delivery?.receipt,bounded);record.delivery.receipt=clone(receipt);
    this.#appendPerformanceStage(record,{stage:'HOST_INSERTION',wallMs:bounded.insertionDurationMs,queueWaitMs:0,inputCount:Number(bounded.area52MessageCount??bounded.observedRoles?.length??0),outputCount:Number(bounded.hostMessageCount??0),inputBytes:bounded.area52InputBytes??null,outputBytes:null,retainedObjectCount:0,retainedBytes:0,outcome:receipt?.phases?.hostRequest?.status==='OBSERVED_MATCH'?'OBSERVED_MATCH':'OBSERVATION_REJECTED'});
    this.#notify('HOST_DELIVERY_EVIDENCE_RECORDED',record);return clone(receipt);
  }
  recordProviderResponsePerformance(turnId,evidence={}){
    const id=req(turnId,'turnId'),record=this.turns.get(id);if(!record)throw new Error('Unknown native Brain turn: '+id);
    for(const [name,expected] of [['chatId',record.chatId],['turnId',record.turnId],['generationId',record.generationId],['correlationId',record.correlationId]])if(evidence[name]!=null&&String(evidence[name])!==String(expected))throw new Error('PROVIDER_PERFORMANCE_IDENTITY_MISMATCH:'+name);
    const row=this.#appendPerformanceStage(record,{stage:'PROVIDER_RESPONSE',wallMs:evidence.providerLatencyMs,queueWaitMs:evidence.providerQueueWaitMs??0,inputCount:1,outputCount:1,outcome:'RECEIVED'});
    this.#notify('PROVIDER_RESPONSE_PERFORMANCE_RECORDED',record);return clone(row);
  }
  identityReferences(entityIds=[],options={}){return this.core.entityIdentityReferences(entityIds,options);}
  temporalReferences(options={}){return this.core.temporalStateReferences(options);}

  readTurn(turnId){const row=this.turns.get(String(turnId));return row?clone(row):null;}
  currentWorldModel(){return this.core.currentWorldModel();}
  sourceHistory(sourceId){return this.knowledge.history(sourceId);}

  diagnostics(){
    return {
      kind:'Area52NativeBrainDiagnostics',
      turns:this.turns.size,activeChat:this.core.hotCognition.activeChatNamespace,
      world:this.core.currentWorldModel(),sensory:this.core.sensoryDiagnostics(),identity:this.core.entityIdentityReadModel(),graph:this.core.graphWalkerDiagnostics(),
      knowledge:this.knowledge.diagnostics(),feedback:this.feedback.diagnostics(),
      loreInterface:{attached:Boolean(this.loreInterface),kind:this.loreInterface?.kind??null,contractVersion:this.loreInterface?.contractVersion??null},
      loreRevisionTrust:{
        tracked:this.loreRevisionTrust.size,
        pending:[...this.loreRevisionTrust.values()].filter((row)=>row.status==='PENDING_EXACT_RETRIEVAL').map((row)=>row.sourceId).sort(),
        trusted:[...this.loreRevisionTrust.values()].filter((row)=>row.status==='TRUSTED').map((row)=>row.sourceId).sort(),
        rejectedRevisionIds:[...this.rejectedLoreRevisionIds].sort(),
      },
      memoryInterface:{attached:Boolean(this.memoryInterface),kind:this.memoryInterface?.kind??null,contractVersion:this.memoryInterface?.contractVersion??null},
      memoryConsolidationInterface:{attached:Boolean(this.memoryConsolidationInterface),kind:this.memoryConsolidationInterface?.kind??null,contractVersion:this.memoryConsolidationInterface?.contractVersion??null},
      memoryRetrievalFeedback:{scheduled:[...this.turns.values()].filter(row=>row.memoryFeedbackRuntimeTaskId).length,applied:[...this.turns.values()].filter(row=>row.memoryRetrievalFeedback).length,last:clone([...this.turns.values()].map(row=>row.memoryRetrievalFeedback).filter(Boolean).at(-1)??null),supportAdded:false,retrievalUseIsEvidence:false,authorityChanged:false,canonicalMutationAuthority:false},
      ownerEvidence:{retained:this.ownerEvidence.size,currentSourceRevisionRefs:this.core.externalCurrentSourceRevisionIds()},
      sceneFanOut:{
        turnCount:[...this.turns.values()].filter(row=>row.sceneFanOutIngress).length,
        admittedTurnCount:[...this.turns.values()].filter(row=>row.sceneFanOutIngress?.status==='ADMITTED_FOR_RESULT_BUS').length,
        rejectedTurnCount:[...this.turns.values()].filter(row=>row.sceneFanOutIngress?.status==='REJECTED').length,
        admittedCandidateCount:[...this.turns.values()].reduce((n,row)=>n+Number(row.sceneFanOutIngress?.candidateCount??0),0),
        last:clone([...this.turns.values()].map(row=>row.sceneFanOutIngress).filter(Boolean).at(-1)??null),
        authorityGranted:false,admissionAuthority:false,truthAuthority:false,contextSealAuthority:false,
      },
      expectedWork:{count:this.obligationReconciler.list().length},runtime:this.runtimeDirector.snapshot(),
      nativeRequirements:{jevRequired:false,sidecarRequired:false,externalDatabaseRequired:false,sqlRequired:false,remoteModelRequired:false,userOrchestratorRequired:false},
    };
  }

  snapshot(){
    return clone({
      kind:'Area52NativeBrainSnapshot',version:'1.0.0',maxTurns:this.maxTurns,turnSequence:this.turnSequence,
      core:{
        sourceRegistry:this.core.registry.exportState(),
        temporalState:this.core.graph.exportState(),
        entityIdentity:this.core.entities.exportState(),
        hotCognition:this.core.hotCognition.exportState(),
        contextSeal:this.core.publication.seal.exportState(),
      },
      knowledge:this.knowledge.exportState(),feedback:this.feedback.exportState(),
      loreRevisionTrust:[...this.loreRevisionTrust.entries()],rejectedLoreRevisionIds:[...this.rejectedLoreRevisionIds],
      // Restore image: settled turns are persisted in compacted reference form (owner stores and the
      // sealed packet stay authoritative); turns with pending background learning keep full detail.
      turns:[...this.turns.entries()].map(([id,record])=>[id,this.#turnBackgroundSettled(record)?compactTurnRecord(record,{reason:'SNAPSHOT',sequence:this.turnSequence}):record]),turnOrder:this.turnOrder,sceneSignals:[...this.sceneSignals.entries()],
      runtimeLedger:this.runtimePersistence.exportSnapshot(),runtimeResults:this.runtimeResults,expectedWork:this.obligationReconciler.snapshot(),
    });
  }

  static fromSnapshot(snapshot,options={}){return new Area52NativeBrain({...options,snapshot});}

  #settleObservation(turn,experience,input,index){
    if(!input||typeof input!=='object')throw new TypeError('observation must be an object');
    const authority=input.authorityClass??AuthorityClass.OBSERVED;
    if(![AuthorityClass.OBSERVED,AuthorityClass.UNRESOLVED].includes(authority)){
      return{kind:'NativeObservationReceipt',status:'REJECTED',reason:'NARRATIVE_OBSERVATION_AUTHORITY_UNSUPPORTED',authorityClass:authority,canonicalMutation:false};
    }
    const subjectId=req(input.subjectId,'observation.subjectId'),predicate=req(input.predicate,'observation.predicate');
    const explicitIdentityIds=[subjectId,...(typeof input.value==='string'?[input.value]:[])].filter(id=>Boolean(this.core.entities.get(id)));
    const identityRevisionRefs=this.core.entityIdentityReferences(explicitIdentityIds).references.map(row=>row.revisionRef);
    const temporalKind=observationTemporalKind(input.temporalKind),at=finite(input.at,turn.sequence);
    const claimId='native-claim:'+stableHash({sourceRevisionId:experience.sourceRevisionId,index,subjectId,predicate,value:input.value,at,temporalKind},{length:24});
    const provenance=createProvenance({
      id:'prov:'+claimId,sourceRevisionIds:[experience.sourceRevisionId],evidenceIds:[experience.artifactId],
      derivedFromIds:[experience.artifactId],activity:'POST_TURN_OBSERVATION',agent:'area52-native-brain',
      invalidators:[experience.sourceRevisionId,experience.artifactId],
    });
    const claim=createClaim({
      id:claimId,subjectId,predicate,value:clone(input.value),
      temporal:{kind:temporalKind,validFrom:at,validUntil:null},
      authorityClass:authority,confidence:Number(input.confidence??1),status:statusForTemporal(temporalKind),
      provenance,owner:'WORLD_STATE',stableIdentity:this.core.entities.get(subjectId)?subjectId:null,identityRevisionRefs,claimType:input.claimType??'FACT',slotPolicy:input.slotPolicy??'SINGLE',
      explicitness:'OBSERVED_POST_TURN',evidenceTime:at,
    });
    const proposal=createMutationProposal({
      id:'native-proposal:'+claimId,mutationType:MutationType.SET_CLAIM,owner:'WORLD_STATE',
      sourceRevisionIds:[experience.sourceRevisionId],evidenceIds:[experience.artifactId],
      freshnessRevisionIds:[experience.sourceRevisionId],payload:{claim},status:'PROPOSED',
    });
    const tx=this.core.audit.recordProposal(proposal,{correlationId:turn.correlationId,causationId:'generation:'+turn.generationId});
    const before=this.core.graph.revision,settled=this.core.settlement.settle(proposal);
    this.core.audit.recordSettlement(proposal,settled,{correlationId:turn.correlationId,causationId:tx.transactionId,beforeRevision:before,afterRevision:this.core.graph.revision});
    if(settled.receipt?.outcome===SettlementOutcome.SETTLED)this.core.hotCognition.consumeOwnerWorldChange({
      chatNamespace:turn.chatId,updateId:'native-world:'+settled.receipt.id,worldRevision:this.core.graph.revision,
      sourceRevisionRefs:[experience.sourceRevisionId],artifactRefs:this.core.worldArtifactRefsForHot(settled.receipt.settledArtifactIds),
      provenanceRefs:[experience.sourceRevisionId],eventType:'STATE_SETTLED',
    });
    return clone({...settled,proposal,claimId,sourceRevisionId:experience.sourceRevisionId});
  }

  #scheduleMemoryPostTurn(record,experience,memoryWriteback,{knownBy=[],reflections=[],memoryExpectedId=null}={}){
    const accept=this.memoryInterface?.acceptCompletedTurn??this.memoryInterface?.adapters?.acceptCompletedTurn;
    if(!this.memoryInterface||typeof accept!=='function')return null;
    const mapping=memoryWriteback?.ownerReceipt??null;
    if(!['ADMITTED','REPLAYED'].includes(String(memoryWriteback?.status??'').toUpperCase())||!mapping?.memoryEvidenceId)return null;
    const ownerArtifactRef=this.#memoryOwnerArtifactRef(record,experience);
    const reflectionCandidates=(reflections??[]).slice(0,8).map((item,index)=>({
      reflectionKey:item?.reflectionKey??item?.semantic?.reflectionKey??null,
      statement:String(item?.statement??''),
      subjectRefs:uniq(item?.subjectRefs??item?.semantic?.subjectRefs??[]).slice(0,32),
      confidence:item?.confidence??0.5,
      polarity:item?.polarity??(item?.contradiction===true?'CONTRADICT':'SUPPORT'),
      index,
    }));
    return this.runtimeDirector.submit({
      taskType:'MEMORY_POST_TURN',owner:'MEMORY',producerId:'NATIVE_BRAIN',
      layer:'L2',runtimeClass:'NEARLINE',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],
      dedupeKey:'memory-post-turn:'+record.generationId+':'+experience.sourceRevisionId,foreground:false,
      sourceRevisionIds:[experience.sourceRevisionId],worldRevision:record.worldRevision,sceneRevision:record.sceneRevision,
      payload:{
        expectedId:memoryExpectedId,chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,
        sceneId:record.sceneId??null,sceneRevision:record.sceneRevision,worldRevision:record.worldRevision,contextSealId:record.published?.sealReceipt?.id??null,
        sourceRevisionId:experience.sourceRevisionId,ownerArtifactRef,externalEvidenceRef:ownerArtifactRef.artifactId,
        mappingId:mapping.mappingId??null,memoryEvidenceId:mapping.memoryEvidenceId,knownBy:uniq(knownBy),reflectionCandidates,
        resultClass:'DEFERRED',
      },
      cause:{eventType:'POST_TURN_MEMORY',eventId:'memory-learning:'+record.generationId,correlationId:record.correlationId,producerId:'NATIVE_BRAIN',consumerId:'MEMORY',ownerId:'MEMORY',chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,turnRevision:record.sequence,sourceRevisionRefs:[experience.sourceRevisionId],worldRevision:record.worldRevision,sceneRevision:record.sceneRevision},
      batchHint:{maxSliceUnits:1},checkpointPolicy:{maxUnitsPerCheckpoint:1},
    },{
      units:[{id:'memory-post-turn:'+record.turnId,payload:{
        expectedId:memoryExpectedId,chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,
        sceneId:record.sceneId??null,sceneRevision:record.sceneRevision,worldRevision:record.worldRevision,contextSealId:record.published?.sealReceipt?.id??null,
        sourceRevisionId:experience.sourceRevisionId,ownerArtifactRef,externalEvidenceRef:ownerArtifactRef.artifactId,
        reflectionCandidates,
      }}],
      ...this.#memoryPostTurnExecutor(),
    });
  }

  #memoryPostTurnExecutor(){
    return {
      execute:async({units})=>units.map((unit)=>clone(unit.payload)),
      validate:async({output})=>Array.isArray(output)&&output.every((item)=>typeof item?.turnId==='string'&&typeof item?.sourceRevisionId==='string'),
      commit:async({output})=>{
        const receipts=[];
        for(const item of output){
          const accept=this.memoryInterface?.acceptCompletedTurn??this.memoryInterface?.adapters?.acceptCompletedTurn;
          let receipt;
          try{
            receipt=typeof accept==='function'?accept(item):{kind:'MemoryCompletedTurnAdmissionReceipt',status:'FAILED',reasonCode:'MEMORY_COMPLETED_TURN_OWNER_UNAVAILABLE'};
            if(receipt&&typeof receipt.then==='function')receipt=await receipt;
          }catch(error){receipt={kind:'MemoryCompletedTurnAdmissionReceipt',status:'FAILED',reasonCode:error?.code??error?.message??String(error)};}
          const candidate=this.turns.get(String(item.turnId));
          const record=candidate&&candidate.chatId===String(item.chatId)&&candidate.generationId===String(item.generationId)&&candidate.correlationId===String(item.correlationId)?candidate:null;
          if(record)record.memoryPostTurn=clone(receipt);
          if(record?.memoryRuntimeTaskId)this.#recordTaskOwnerDecision(record.memoryRuntimeTaskId,{accepted:['COMPLETED','REPLAYED'].includes(String(receipt?.status??'').toUpperCase()),receiptId:receipt?.episodeId??receipt?.kind??null,reasonCode:receipt?.reasonCode??null,consumerId:'MEMORY'});
          if(record&&['COMPLETED','REPLAYED'].includes(String(receipt?.status??'').toUpperCase())){
            const consolidationTask=this.#scheduleMemoryConsolidation(record,receipt);
            record.memoryConsolidationRuntimeTaskId=consolidationTask?.task?.taskId??record.memoryConsolidationRuntimeTaskId??null;
          }else if(record){
            record.memoryConsolidation={
              kind:'NativeBrainMemoryConsolidationReceipt',status:'SKIPPED',
              reasonCode:'MEMORY_EPISODE_ADMISSION_NOT_COMPLETED',episodeId:receipt?.episodeId??null,
              authorityGranted:false,canonicalMutation:false,
            };
          }
          receipts.push(clone(receipt));
        }
        return{output:receipts,validation:{valid:true},authorityGranted:false,canonicalMutation:false};
      },
    };
  }

  #scheduleMemoryConsolidation(record,memoryReceipt){
    if(!record||!memoryReceipt?.episodeId)return null;
    if(!this.memoryConsolidationInterface||typeof this.memoryConsolidationInterface.propose!=='function'){
      record.memoryConsolidation={
        kind:'NativeBrainMemoryConsolidationReceipt',status:'DEFERRED',
        reasonCode:'MEMORY_CONSOLIDATION_PRODUCER_UNAVAILABLE',episodeId:memoryReceipt.episodeId,
        authorityGranted:false,canonicalMutation:false,
      };
      return null;
    }
    const payload={
      selection:{
        chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,
        worldRevision:record.worldRevision,sceneRevision:record.sceneRevision,sourceRevisionRefs:[...(memoryReceipt.sourceRevisionRefs??[])],
      },
      episodeId:memoryReceipt.episodeId,
    };
    return this.runtimeDirector.submit({
      taskType:'MEMORY_CONSOLIDATION_PROPOSAL',owner:'MEMORY',producerId:'CONTINUOUS_CONSOLIDATION',
      layer:'L3',runtimeClass:'DEEP',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],
      dedupeKey:'memory-consolidation:'+record.generationId+':'+memoryReceipt.episodeId,foreground:false,
      sourceRevisionIds:[...(memoryReceipt.sourceRevisionRefs??[])],worldRevision:record.worldRevision,sceneRevision:record.sceneRevision,
      payload:{...clone(payload),resultClass:'DEFERRED'},
      cause:{
        eventType:'MEMORY_EPISODE_ADMITTED',eventId:'memory-consolidation:'+record.generationId,
        correlationId:record.correlationId,producerId:'MEMORY',consumerId:'CONTINUOUS_CONSOLIDATION',ownerId:'MEMORY',
        chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,turnRevision:record.sequence,
        sourceRevisionRefs:[...(memoryReceipt.sourceRevisionRefs??[])],worldRevision:record.worldRevision,sceneRevision:record.sceneRevision,
      },
      batchHint:{maxSliceUnits:1},checkpointPolicy:{maxUnitsPerCheckpoint:1},
    },{
      units:[{id:'memory-consolidation:'+record.turnId,payload}],
      ...this.#memoryConsolidationExecutor(),
    });
  }

  #memoryConsolidationExecutor(){
    return{
      execute:async({units})=>{
        const rows=[];
        for(const unit of units){
          const producer=this.memoryConsolidationInterface;
          if(!producer||typeof producer.propose!=='function'){
            rows.push({kind:'DeploymentMemoryConsolidationProposalReceipt',status:'DEFERRED',reasonCode:'MEMORY_CONSOLIDATION_PRODUCER_UNAVAILABLE',...clone(unit.payload)});
            continue;
          }
          try{
            let result=producer.propose(clone(unit.payload));
            if(result&&typeof result.then==='function')result=await result;
            rows.push(clone(result));
          }catch(error){
            rows.push({
              kind:'DeploymentMemoryConsolidationProposalReceipt',status:'FAILED',
              reasonCode:error?.code??error?.message??String(error),
              selection:clone(unit.payload?.selection??null),episodeId:unit.payload?.episodeId??null,
              rawChatIncluded:false,canonicalMutation:false,settlementAuthority:false,
            });
          }
        }
        return rows;
      },
      validate:async({output})=>Array.isArray(output)&&output.every((row)=>typeof row?.status==='string'),
      commit:async({output})=>{
        const receipts=[];
        for(const proposed of output){
          const selection=proposed?.selection??null;
          const turnId=String(selection?.turnId??proposed?.turnId??'');
          const record=this.#recordForSelection({...selection,turnId,sourceRevisionRefs:[]});
          let ownerReview=null;
          if(proposed?.status==='PROPOSED'&&proposed?.bundle){
            const review=this.memoryInterface?.reviewConsolidationBundle??this.memoryInterface?.adapters?.reviewConsolidationBundle;
            if(typeof review==='function'){
              try{
                ownerReview=review({bundle:proposed.bundle,handoff:proposed.memoryHandoff??null,selection:selection??{}});
                if(ownerReview&&typeof ownerReview.then==='function')ownerReview=await ownerReview;
              }catch(error){
                ownerReview={kind:'MemoryConsolidationBundleReviewReceipt',status:'FAILED',reasonCode:error?.code??error?.message??String(error),results:[]};
              }
            }else ownerReview={kind:'MemoryConsolidationBundleReviewReceipt',status:'FAILED',reasonCode:'MEMORY_CONSOLIDATION_OWNER_REVIEW_UNAVAILABLE',results:[]};
          }
          const receipt={
            kind:'NativeBrainMemoryConsolidationReceipt',
            status:ownerReview?.status??proposed?.status??'DEFERRED',
            reasonCode:ownerReview?.reasonCode??proposed?.reasonCode??null,
            episodeId:proposed?.episodeId??record?.memoryPostTurn?.episodeId??null,
            producerStatus:proposed?.status??null,
            ownerReview:clone(ownerReview),
            providerAttempted:Boolean(proposed?.providerAttempted),
            sidecarExecution:proposed?.executionReceipt?clone({
              ...proposed.executionReceipt,
              ownerDecision:ownerReview?.status??proposed?.status??'DEFERRED',
              ownerAccepted:['COMPLETED','REPLAYED'].includes(String(ownerReview?.status??'').toUpperCase()),
            }):null,
            rawChatIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
            authorityGranted:false,canonicalMutation:false,settlementAuthority:false,contextSealAuthority:false,
          };
          if(record){
            record.memoryConsolidation=clone(receipt);
            if(record.memoryConsolidationRuntimeTaskId&&ownerReview)this.#recordTaskOwnerDecision(record.memoryConsolidationRuntimeTaskId,{accepted:['COMPLETED','REPLAYED'].includes(String(ownerReview?.status??'').toUpperCase()),receiptId:ownerReview?.bundleId??ownerReview?.kind??receipt.kind,reasonCode:receipt.reasonCode??null,consumerId:'MEMORY'});
          }
          receipts.push(receipt);
        }
        return{output:receipts,validation:{valid:true},authorityGranted:false,canonicalMutation:false};
      },
    };
  }

  #scheduleMemoryRetrievalFeedback(record){
    const admit=this.memoryInterface?.admitRetrievalFeedback??this.memoryInterface?.adapters?.admitRetrievalFeedback;
    if(!record||typeof admit!=='function')return null;
    const batch=buildMemoryRetrievalFeedbackBatch({
      selection:this.#selection(record),candidateEnvelope:record.published?.candidateEnvelope,
      assessment:record.published?.assessment,publicationAssessment:record.published?.publicationAssessment,
      candidateTraceReceipt:record.published?.candidateTraceReceipt,
    });
    record.memoryRetrievalFeedbackBatch=clone(batch);
    if(!batch.scheduledEligible)return null;
    const sourceRevisionIds=uniq(batch.outcomes.flatMap(row=>row.sourceRevisionRefs??[])).slice(0,64);
    const payload={chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,batch:clone(batch)};
    return this.runtimeDirector.submit({
      taskType:'MEMORY_RETRIEVAL_FEEDBACK',owner:'MEMORY',producerId:'NATIVE_BRAIN',
      layer:'L2',runtimeClass:'NEARLINE',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],
      dedupeKey:batch.batchId,foreground:false,sourceRevisionIds,worldRevision:record.worldRevision,sceneRevision:record.sceneRevision,
      payload:{...clone(payload),resultClass:'DEFERRED'},
      cause:{eventType:'MEMORY_RETRIEVAL_OUTCOME_READY',eventId:batch.batchId,correlationId:record.correlationId,producerId:'NATIVE_BRAIN',consumerId:'MEMORY',ownerId:'MEMORY',
        chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,turnRevision:record.sequence,sourceRevisionRefs:sourceRevisionIds,worldRevision:record.worldRevision,sceneRevision:record.sceneRevision},
      batchHint:{maxSliceUnits:1},checkpointPolicy:{maxUnitsPerCheckpoint:1},
    },{
      units:[{id:batch.batchId,payload}],
      ...this.#memoryRetrievalFeedbackExecutor(),
    });
  }

  #memoryRetrievalFeedbackExecutor(){
    return{
      execute:async({units})=>units.map(unit=>clone(unit.payload)),
      validate:async({output})=>Array.isArray(output)&&output.every(item=>item?.batch?.kind==='MemoryRetrievalFeedbackBatch'&&typeof item?.turnId==='string'),
      commit:async({output})=>{
        const receipts=[];
        for(const item of output){
          const candidate=this.turns.get(String(item.turnId));
          const record=candidate&&candidate.chatId===String(item.chatId)&&candidate.generationId===String(item.generationId)&&candidate.correlationId===String(item.correlationId)?candidate:null;
          if(!record||record.memoryRetrievalFeedbackBatch?.batchId!==item.batch?.batchId){
            receipts.push({kind:'MemoryRetrievalFeedbackReceipt',status:'REJECTED',reasonCode:'BRAIN_FEEDBACK_SELECTION_MISMATCH',batchId:item.batch?.batchId??null,supportAdded:false,authorityChanged:false,canonicalMutationAuthority:false});
            continue;
          }
          const admit=this.memoryInterface?.admitRetrievalFeedback??this.memoryInterface?.adapters?.admitRetrievalFeedback;
          let receipt;
          try{
            receipt=typeof admit==='function'?admit(item.batch):{kind:'MemoryRetrievalFeedbackReceipt',status:'REJECTED',reasonCode:'MEMORY_FEEDBACK_OWNER_UNAVAILABLE',batchId:item.batch.batchId};
            if(receipt&&typeof receipt.then==='function')receipt=await receipt;
          }catch(error){receipt={kind:'MemoryRetrievalFeedbackReceipt',status:'REJECTED',reasonCode:String(error?.code??error?.message??error),batchId:item.batch.batchId,supportAdded:false,authorityChanged:false,canonicalMutationAuthority:false};}
          record.memoryRetrievalFeedback=clone(receipt);
          if(record.memoryFeedbackRuntimeTaskId)this.#recordTaskOwnerDecision(record.memoryFeedbackRuntimeTaskId,{accepted:String(receipt?.status??'').toUpperCase()!=='REJECTED',receiptId:receipt?.batchId??receipt?.kind??null,reasonCode:receipt?.reasonCode??null,consumerId:'MEMORY'});
          receipts.push(clone(receipt));
        }
        return{output:receipts,validation:{valid:true},authorityGranted:false,canonicalMutation:false};
      },
    };
  }

  #scheduleFeedback(turnId,sourceRevisionId){
    const record=this.turns.get(String(turnId));if(!record)return null;
    return this.runtimeDirector.submit({
      taskType:'NATIVE_LEARNING_FEEDBACK',owner:'COGNITIVE_CORE',producerId:'NATIVE_BRAIN',
      layer:'L2',runtimeClass:'NEARLINE',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],
      dedupeKey:'native-feedback:'+turnId,foreground:false,sourceRevisionIds:[sourceRevisionId],
      worldRevision:this.core.graph.revision,sceneRevision:record.sceneRevision,
      payload:{chatId:record.chatId,turnId:String(turnId),generationId:record.generationId,correlationId:record.correlationId,resultClass:'DEFERRED'},
      cause:{eventType:'POST_TURN_LEARNING',eventId:'learning:'+record.generationId,correlationId:record.correlationId,producerId:'NATIVE_BRAIN',consumerId:'COGNITIVE_LEARNING',ownerId:'COGNITIVE_CORE',chatId:record.chatId,turnId:String(turnId),generationId:record.generationId,turnRevision:record.sequence,sourceRevisionRefs:[sourceRevisionId],worldRevision:this.core.graph.revision,sceneRevision:record.sceneRevision},
      batchHint:{maxSliceUnits:1},checkpointPolicy:{maxUnitsPerCheckpoint:1},
    },{
      units:[{id:'feedback:'+turnId,payload:{turnId:String(turnId),chatId:record.chatId,generationId:record.generationId,correlationId:record.correlationId}}],
      ...this.#feedbackExecutor(),
    });
  }

  #feedbackExecutor(){
    return {
      execute:async({units})=>units.map(unit=>clone(unit.payload)),
      validate:async({output})=>Array.isArray(output)&&output.every(x=>typeof x?.turnId==='string'),
      commit:async({output})=>{
        const receipts=[];
        for(const item of output){
          const candidate=this.turns.get(String(item.turnId));
          const record=candidate&&(!item?.chatId||candidate.chatId===String(item.chatId))&&(!item?.generationId||candidate.generationId===String(item.generationId))&&(!item?.correlationId||candidate.correlationId===String(item.correlationId))?candidate:null;
          if(!record)continue;
          if(!record.feedback)record.feedback=this.feedback.observeTurn({
            turnId:record.turnId,candidateEnvelope:record.published?.candidateEnvelope,
            assessment:record.published?.assessment,publicationAssessment:record.published?.publicationAssessment,
            cognitiveChoiceReceipt:record.published?.cognitiveChoiceReceipt,packet:record.published?.packet,
          });
          if(record.feedbackRuntimeTaskId)this.#recordTaskOwnerDecision(record.feedbackRuntimeTaskId,{accepted:true,receiptId:record.feedback?.receiptId??record.feedback?.id??record.feedback?.kind??('feedback:'+record.turnId),consumerId:'COGNITIVE_CORE'});
          receipts.push(clone(record.feedback));
        }
        return{output:receipts,validation:{valid:true},authorityGranted:false,canonicalMutation:false};
      },
    };
  }

  #attachRecoveredExecutors(){
    for(const record of this.runtimeDirector.ledger.list()){
      if(record.lifecycleStatus===LIFECYCLE_STATUS.SATISFIED)continue;
      let executor=null;
      if(record.obligation?.taskType==='NATIVE_LEARNING_FEEDBACK')executor=this.#feedbackExecutor();
      if(record.obligation?.taskType==='MEMORY_RETRIEVAL_FEEDBACK'&&this.memoryInterface)executor=this.#memoryRetrievalFeedbackExecutor();
      if(record.obligation?.taskType==='MEMORY_POST_TURN'&&this.memoryInterface)executor=this.#memoryPostTurnExecutor();
      if(record.obligation?.taskType==='MEMORY_CONSOLIDATION_PROPOSAL'&&this.memoryConsolidationInterface&&this.memoryInterface)executor=this.#memoryConsolidationExecutor();
      if(!executor)continue;
      try{this.runtimeDirector.attachExecutor(record.taskId,executor);this.runtimeDirector.recoverTask(record.taskId);}catch{}
    }
  }

  #recordRuntimeResult(envelope){
    this.runtimeResults.push(clone(envelope));if(this.runtimeResults.length>128)this.runtimeResults.splice(0,this.runtimeResults.length-128);
    const record=this.turns.get(String(envelope?.turnId??''));
    if(record&&record.generationId===String(envelope?.generationId??record.generationId)&&record.correlationId===String(envelope?.correlationId??record.correlationId)){
      const learning=this.#refreshLearningLifecycle(record);
      this.#notify('TURN_LEARNING_UPDATED',record);
      this.#notifyLearningAccepted(record,learning);
    }
    return envelope;
  }

  #selectionForChat(chatId=null){
    const wanted=chatId==null?null:String(chatId);
    for(let index=this.turnOrder.length-1;index>=0;index--){const record=this.turns.get(this.turnOrder[index]);if(record&&(!wanted||record.chatId===wanted))return this.#selection(record);}
    if(wanted){const scene=this.core.sceneIntegrationSnapshot(wanted);if(scene?.sceneId)return{chatId:wanted,turnId:null,generationId:null,correlationId:null,sceneId:scene.sceneId,sceneRevision:scene.sceneRevision,worldRevision:this.core.graph.revision,sourceRevisionRefs:this.core.currentSourceRevisionIds(),ownerSourceRevisionRefs:this.core.externalCurrentSourceRevisionIds()};}
    return{chatId:wanted,turnId:null,generationId:null,correlationId:null,sceneId:null,sceneRevision:null,worldRevision:this.core.graph.revision,sourceRevisionRefs:this.core.currentSourceRevisionIds(),ownerSourceRevisionRefs:this.core.externalCurrentSourceRevisionIds()};
  }

  #recordForSelection(selection={}){
    const turnId=selection?.turnId==null?null:String(selection.turnId),generationId=selection?.generationId==null?null:String(selection.generationId),chatId=selection?.chatId==null?null:String(selection.chatId);
    let record=turnId?this.turns.get(turnId):null;
    if(turnId&&!record)return null;
    if(!record&&generationId)record=[...this.turns.values()].find(row=>row.generationId===generationId&&(!chatId||row.chatId===chatId))??null;
    if(!record&&chatId){for(let index=this.turnOrder.length-1;index>=0;index--){const row=this.turns.get(this.turnOrder[index]);if(row?.chatId===chatId){record=row;break;}}}
    if(!record)return null;
    if(turnId&&record.turnId!==turnId)return null;if(chatId&&record.chatId!==chatId)return null;if(generationId&&record.generationId!==generationId)return null;
    if(selection?.correlationId!=null&&record.correlationId!==String(selection.correlationId))return null;
    if(selection?.sceneRevision!=null&&Number(record.sceneRevision)!==Number(selection.sceneRevision))return null;
    if(selection?.worldRevision!=null&&Number(record.worldRevision)!==Number(selection.worldRevision))return null;
    if((selection?.sourceRevisionRefs??[]).length){
      const selectedFence=new Set((record.sourceRevisionSet??[]).map(String));
      if((selection.sourceRevisionRefs??[]).some(ref=>!selectedFence.has(String(ref))))return null;
    }
    return record;
  }

  #generationSceneReadModel(record){
    if(record.sceneReadModel)return record.sceneReadModel;
    // Older checkpoints can only project a Scene when its exact fence remains current.
    const state=this.core.sceneIntegrationSnapshot(record.chatId);
    if(state?.sceneId!==record.sceneId||Number(state.sceneRevision)!==Number(record.sceneRevision))return null;
    return createSceneUiReadModelFromIntegrationState(state);
  }

  #readStage(selection,reader){const record=this.#recordForSelection(selection);if(!record)return null;const value=reader(record);return value==null?null:clone(value);}

  #listGenerations({limit=50,selection={}}={}){
    const max=Math.max(1,Math.min(200,Number(limit)||50)),chatId=selection?.chatId==null?null:String(selection.chatId);
    return this.turnOrder.slice().reverse().map(id=>this.turns.get(id)).filter(Boolean).filter(row=>!chatId||row.chatId===chatId).slice(0,max).map(row=>({kind:'NativeBrainGenerationSummary',...this.#selection(row),state:row.state,executionLabel:row.executionLabel,sealId:row.published?.sealReceipt?.id??null,promptPlanId:row.delivery?.plan?.promptPlanId??null}));
  }

  #readGeneration(generationId,selection={}){if(generationId==null)return null;const record=this.#recordForSelection({...selection,generationId});if(!record)return null;if(record.responseCompletionReceipt)this.#refreshLearningLifecycle(record);return clone({kind:'NativeBrainGenerationReadModel',...this.#selection(record),state:record.state,executionLabel:record.executionLabel,cognitiveChoice:record.published?.cognitiveChoiceReceipt??null,candidateEnvelope:record.published?.candidateEnvelope??null,identityResolution:this.core.entityIdentityReadModel(),graphTraversal:record.published?.graphTraversalReceipt??null,retrievalBudget:this.#uiRetrievalBudgetReceipt(record),rejectedEvidence:this.#uiRejectedEvidence(record),truth:record.published?.publicationAssessment??record.published?.assessment??null,gather:record.published?.gatherReceipt??null,contextSeal:record.published?.sealReceipt??null,promptPlan:record.delivery?.plan??null,contextRetirement:record.contextRetirement??null,promptDeliveryReceipt:record.delivery?.receipt??null,loreSync:record.loreSync??null,memorySync:record.memorySync??null,memoryDensePrime:record.memoryDensePrime??null,responseCompletion:record.responseCompletionReceipt??null,memoryRetrievalFeedbackBatch:record.memoryRetrievalFeedbackBatch??null,memoryRetrievalFeedback:record.memoryRetrievalFeedback??null,memoryFeedbackRuntimeTaskId:record.memoryFeedbackRuntimeTaskId??null,memoryPostTurn:record.memoryPostTurn??null,memoryConsolidation:record.memoryConsolidation??null,learningReceipt:record.learningReceipt??null});}

  #worldGraphReferenceReadModel(record){
    const refs=this.worldGraphReferences(record.query,{
      intent:record.intent??'CURRENT',
      anchorEntityIds:[...(record.anchorEntityIds??[])],
      worldRevision:record.worldRevision,
      sceneRevision:record.sceneRevision,
      latencyBudgetMs:record.retrievalPolicy?.latencyBudgetMs??100,
      graphTraversal:clone(record.retrievalPolicy?.graphTraversal??null),
      perspective:clone(record.perspectiveConstraint??null),
    });
    const referenceSet=clone(refs);
    if(referenceSet&&typeof referenceSet==='object')delete referenceSet.query;
    return{
      kind:'NativeBrainSelectedTurnWorldGraphReferences',contractVersion:'1.0.0',
      ...this.#selection(record),referenceSet,
      observationClass:'ON_DEMAND_SELECTED_TURN_REFERENCE_READ',
      generationTimeReceipt:false,queryIncluded:false,rawPromptIncluded:false,rawLoreIncluded:false,rawMemoryIncluded:false,
      authorityGranted:false,mutationAuthority:false,truthAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    };
  }


  #notify(stage,record){
    if(!this.listeners.size||!record)return;const event=Object.freeze({kind:'NativeBrainReceiptUpdate',stage:String(stage),selection:this.#selection(record),rawPromptIncluded:false,rawResponseIncluded:false});
    for(const listener of [...this.listeners])try{listener(event);}catch{}
  }

  #generationHotSnapshot(record){
    const sealed=this.core.hotCognition?.snapshotForTurn?.(record.turnId)??null;
    if(!sealed?.snapshot)return null;
    return{
      ...clone(sealed.snapshot),
      generationFence:{kind:'HotGenerationSourceFence',turnId:record.turnId,generationId:record.generationId,contextSealId:sealed.contextSealId??record.published?.sealReceipt?.id??null,sourceRevisionRefs:[...(record.sourceRevisionSet??[])],postResponseNarrativeExcluded:true},
    };
  }

  #appendPerformanceStage(record,row={}){
    if(!record)return null;
    if(!record.performance)record.performance={kind:'NativeBrainGenerationPerformanceReceipt',contractVersion:1,chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,stages:[],counts:{},sizes:{},retained:{},detailedProfiling:false,rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false};
    const wall=Number(row.wallMs),queue=Number(row.queueWaitMs);
    const next={
      stage:String(row.stage??'UNKNOWN'),wallMs:Number.isFinite(wall)?Math.max(0,wall):null,queueWaitMs:Number.isFinite(queue)?Math.max(0,queue):0,
      inputCount:Math.max(0,Number(row.inputCount)||0),outputCount:Math.max(0,Number(row.outputCount)||0),
      inputBytes:row.inputBytes!=null&&Number.isFinite(Number(row.inputBytes))?Math.max(0,Number(row.inputBytes)):null,outputBytes:row.outputBytes!=null&&Number.isFinite(Number(row.outputBytes))?Math.max(0,Number(row.outputBytes)):null,
      inputSizeClass:row.inputSizeClass??null,outputSizeClass:row.outputSizeClass??null,
      retainedObjectCount:Math.max(0,Number(row.retainedObjectCount)||0),retainedBytes:row.retainedBytes!=null&&Number.isFinite(Number(row.retainedBytes))?Math.max(0,Number(row.retainedBytes)):null,
      outcome:String(row.outcome??'RECORDED'),
    };
    record.performance.stages=[...(record.performance.stages??[]).filter(stage=>stage.stage!==next.stage),next].slice(-24);
    return next;
  }

  #selection(record){
    const sceneRefs=new Set(record.sceneSourceRevisionRefs??[]);
    const ownerSourceRevisionRefs=uniq(record.ownerSourceRevisionSet??(record.sourceRevisionSet??[]).filter(ref=>!sceneRefs.has(ref)&&!this.core.registry.getRevision(ref)));
    return{chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,sceneId:record.sceneId,sceneRevision:record.sceneRevision,worldRevision:record.worldRevision,sourceRevisionRefs:[...record.sourceRevisionSet],ownerSourceRevisionRefs};
  }

  #contextReceipt(record){
    if(!record?.published?.sealReceipt||!record?.delivery?.plan)return null;
    const receipt=this.core.observation.contextReceipt({published:record.published,delivery:record.delivery});
    return{
      ...receipt,chatId:record.chatId,correlationId:record.correlationId,
      sourceRevisionRefs:uniq([...(receipt.sourceRevisionRefs??[]),...(record.published.sealReceipt.sourceRevisionIds??[])]),
    };
  }

  #selectedTurnReceipt(record){
    if(record?.responseCompletionReceipt)this.#refreshLearningLifecycle(record);
    const selection=this.#selection(record),hostObservation=record.hostObservation??null,scene=record.published?.sceneIntegration??null,hot=record.published?.hotCognition??null;
    const learnedNarrativeRefs=uniq([record.experience?.sourceRevisionId,record.learningReceipt?.sourceRevisionId].filter(ref=>ref&&!selection.sourceRevisionRefs.includes(String(ref))));
    const choice=record.published?.cognitiveChoiceReceipt??null,gather=record.published?.gatherReceipt??null,seal=record.published?.sealReceipt??null,plan=record.delivery?.plan??null,context=this.#contextReceipt(record),expectedWork=this.#expectedWorkReadModel(record),sceneFanOutBinding=record.published?.sceneFanOutResultBusReceipt??null;
    const candidate=record.published?.candidateEnvelope??null,truth=record.published?.publicationAssessment??record.published?.assessment??null;
    const stageId=(stage,value,explicit=null)=>!value?null:(explicit??value.receiptId??value.id??value.envelopeId??value.promptPlanId??('native:'+stage+':'+stableHash({turnId:record.turnId,stage,kind:value.kind??null},{length:20})));
    const producer=(stage,value,{producerId,consumerId,parentReceiptId=null,status=null,reasonCode=null,reasonCodes=[],durationMs=null,ownerAccepted=null,sourceRevisionRefs=null,metadata={}}={})=>{
      const present=Boolean(value),resolvedStatus=status??(present?'PUBLISHED':'NO_EVIDENCE');
      return{
        status:resolvedStatus,lifecycleState:resolvedStatus,id:stageId(stage,value,metadata.id??null),
        producerId,consumerId,parentReceiptId,durationMs:Number.isFinite(Number(durationMs))?Number(durationMs):null,ownerAccepted,
        reasonCode:reasonCode??(present?'EVIDENCE_PUBLISHED':'NO_EVIDENCE'),reasonCodes:uniq(reasonCodes).slice(0,16),
        chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,
        turnRevision:record.sequence,worldRevision:record.worldRevision,sceneRevision:record.sceneRevision,
        sourceRevisionRefs:uniq(sourceRevisionRefs??(present?(record.sourceRevisionSet??[]):[])).slice(0,32),...clone(metadata),
      };
    };
    const sceneId=stageId('scene',scene,scene?.lastReceiptId??scene?.sceneId??null),hotId=stageId('hotCognition',hot,hot?.snapshotId??null),choiceId=stageId('cognitiveChoice',choice,choice?.id??null);
    const candidateId=stageId('sensory',candidate,candidate?.envelopeId??candidate?.id??null),truthId=stageId('truth',truth,null),gatherId=stageId('gather',gather,gather?.receiptId??null),sealId=stageId('contextSeal',seal,seal?.id??null),planId=stageId('promptPlan',plan,plan?.promptPlanId??null);
    const runtimeRecords=this.runtimeDirector.ledger.list().filter(row=>causalObligationMatchesSelection(row.obligation,selection));
    const runtimeEvents=runtimeRecords.flatMap(row=>(row.causalReceipts??[]).map(event=>({...clone(event),taskId:row.taskId}))).slice(-32);
    const runtimeValue=runtimeEvents.length?{kind:'NativeBrainRuntimeCausalEvidence',id:'native:runtime:'+stableHash({turnId:record.turnId,ids:runtimeEvents.map(x=>x.id)},{length:20})}:null;
    const jevDecision=choice?.jev?.considered?{kind:'CognitiveJevDecision',id:(choiceId??'choice')+':jev'}:null;
    const precisionDecision=choice?.precision?.considered?{kind:'CognitivePrecisionDecision',id:(choiceId??'choice')+':precision'}:null;
    const promptReceipt=record.delivery?.receipt??null,observed=promptReceipt?.observedHostDelivery??null,hostRequestStatus=promptReceipt?.phases?.hostRequest?.status??null,learning=record.learningReceipt??null;
    const densePrime=record.memoryDensePrime??null,responseCompletion=record.responseCompletionReceipt??learning?.responseCompletion??null,backgroundLearning=learning?.learningLifecycle??null;
    const denseRetrieval={
      kind:'NativeBrainDenseRetrievalLifecycleReceipt',contractVersion:1,...selection,
      resultClass:densePrime?.resultClass??'OPPORTUNISTIC',required:String(densePrime?.resultClass??'OPPORTUNISTIC').toUpperCase()==='REQUIRED',
      status:densePrime?.status??'NO_EVIDENCE',reasonCode:densePrime?.reasonCode??(densePrime?'DENSE_RETRIEVAL_STATE_RECORDED':'DENSE_RETRIEVAL_RECEIPT_ABSENT'),
      requested:Boolean(densePrime?.requested),providerAttempted:Boolean(densePrime?.providerAttempted),providerReturned:Boolean(densePrime?.providerReturned),ownerAdmitted:Boolean(densePrime?.ownerAdmitted),
      executionId:densePrime?.executionId??null,providerRequestId:densePrime?.providerRequestId??null,providerId:densePrime?.providerId??null,modelId:densePrime?.modelId??null,
      foregroundWaitMs:densePrime?.foregroundBlockedMs??null,queueWaitMs:densePrime?.foregroundQueueWaitMs??null,providerExecutionMs:densePrime?.providerExecutionMs??densePrime?.providerLatencyMs??null,
      sourceRevisionRefs:uniq(densePrime?.selection?.sourceRevisionRefs??selection.sourceRevisionRefs).slice(0,32),
      rawQueryIncluded:false,rawPromptIncluded:false,providerBodyIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
      authorityGranted:false,admissionAuthority:false,truthAuthority:false,contextSealAuthority:false,
    };
    const completionLifecycle={
      kind:'NativeBrainCompletionLifecycleReceipt',contractVersion:1,...selection,
      responseCompletion:responseCompletion?{
        status:responseCompletion.status??'COMPLETED',contextSealId:responseCompletion.contextSealId??null,sourceRevisionId:responseCompletion.sourceRevisionId??null,
        foregroundWaitMs:responseCompletion.foregroundWaitMs??null,learningScheduled:Boolean(responseCompletion.learningScheduled),
        feedbackRuntimeTaskId:responseCompletion.feedbackRuntimeTaskId??null,memoryFeedbackRuntimeTaskId:responseCompletion.memoryFeedbackRuntimeTaskId??null,memoryRuntimeTaskId:responseCompletion.memoryRuntimeTaskId??null,
        boundedOwnerAcknowledgement:clone(responseCompletion.boundedOwnerAcknowledgement??null),responseRecordedBeforeBackgroundExecution:Boolean(responseCompletion.responseRecordedBeforeBackgroundExecution),
      }:{status:'NO_EVIDENCE',reasonCode:'RESPONSE_COMPLETION_RECEIPT_ABSENT'},
      background:backgroundLearning?{
        status:backgroundLearning.status??'UNKNOWN',backgroundPending:Boolean(backgroundLearning.backgroundPending),foregroundWaitMs:backgroundLearning.foregroundWaitMs??responseCompletion?.foregroundWaitMs??null,
        backgroundExecutionMs:backgroundLearning.backgroundExecutionMs??null,sealedGenerationImmutable:Boolean(backgroundLearning.sealedGenerationImmutable),
        tasks:clone((backgroundLearning.tasks??[]).slice(0,8)),
        reasonCode:backgroundLearning.status==='ACCEPTED'?'OWNER_ACCEPTED':backgroundLearning.status==='FAILED'?'BACKGROUND_LEARNING_FAILED':backgroundLearning.status==='DEFERRED'?'BACKGROUND_LEARNING_DEFERRED':backgroundLearning.status==='RUNNING'?'BACKGROUND_LEARNING_RUNNING':'BACKGROUND_LEARNING_PENDING',
      }:{status:responseCompletion?.learningScheduled?'SCHEDULED':'NO_WORK',backgroundPending:Boolean(responseCompletion?.learningScheduled),foregroundWaitMs:responseCompletion?.foregroundWaitMs??null,backgroundExecutionMs:null,tasks:[],reasonCode:responseCompletion?.learningScheduled?'BACKGROUND_LEARNING_PENDING':'BACKGROUND_LEARNING_NOT_SCHEDULED'},
      rawResponseIncluded:false,rawPromptIncluded:false,providerBodiesIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
      authorityGranted:false,canonicalMutationAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    };
    const memoryEvidence=learning?.memoryWriteback??record.memorySync??null;
    const memoryRetrievalFeedback=learning?.memoryRetrievalFeedback??record.memoryRetrievalFeedback??null;
    const memoryEpisode=learning?.memoryPostTurn??record.memoryPostTurn??null;
    const memoryConsolidation=learning?.memoryConsolidation??record.memoryConsolidation??null;
    const loreEvidence=record.loreSync??null;
    const deferred=(plan?.deferred??[]).slice(0,16).map(row=>({slot:row.slot??null,reason:row.reason??null,requiredTokens:row.requiredTokens??null,remainingTokensAtDecision:row.remainingTokensAtDecision??null,shortfallTokens:row.shortfallTokens??null}));
    const includedSlots=(context?.includedSections??[]).slice(0,32),selectedRefs=selection.sourceRevisionRefs.slice(0,128),sceneRefs=uniq(record.sceneSourceRevisionRefs??scene?.sourceRevisionRefs??[]).slice(0,32),sealRefs=uniq(seal?.sourceRevisionIds??[]).slice(0,128);
    const sceneOwner=record.sceneOwnerReceipt??null,sceneIngress=record.sceneIngress??null,sceneFanOutIngress=record.sceneFanOutIngress??null;
    const sceneTimelineReceipts=(sceneIngress?.timelineReceipts??[]).slice(0,32);
    const sceneReadModel=this.#generationSceneReadModel(record);
    const fanOutAdmitted=[...(choice?.admittedJobs??[])],fanOutSkipped=[...(choice?.skippedJobs??[])];
    const sceneFlow={
      kind:'NativeBrainSceneFlowReceipt',
      observation:sceneOwner?{
        state:sceneOwner.status==='NO_WORK'?'NO_WORK':'OBSERVED',
        receiptKind:sceneOwner.kind??null,sceneId:sceneOwner.sceneId??null,sceneRevision:sceneOwner.sceneRevision??null,
        sourceRevisionRefs:uniq(sceneOwner.sourceRevisionRefs??[]).slice(0,32),changedFields:[...(sceneOwner.changedFields??[])].slice(0,16),
        noWorkReason:sceneOwner.noWorkReason??null,boundaryStatus:sceneOwner.boundary?.decision?.status??null,transitionStatus:sceneOwner.transition?.status??null,
        eventTypes:[...(sceneOwner.eventTypes??[])].slice(0,16),authorityGranted:false,
      }:{state:'UNAVAILABLE',reason:'SCENE_OWNER_RECEIPT_NOT_SUPPLIED'},
      events:sceneTimelineReceipts.length?{state:'ADMITTED',count:sceneTimelineReceipts.length,receipts:clone(sceneTimelineReceipts)}:{state:'NO_WORK',count:0,reason:'NO_SCENE_EVENT_OR_INVALIDATION_FOR_TURN'},
      signal:sceneIngress?.signalStatus==='ADMITTED'?{state:'ADMITTED',receipt:clone(sceneIngress.signalReceipt??null)}:sceneIngress?.signalStatus==='REJECTED'?{state:'REJECTED',receipt:clone(sceneIngress.signalReceipt??null)}:{state:'UNAVAILABLE',reason:'SCENE_SIGNAL_NOT_ADMITTED'},
      readModel:sceneReadModel?{state:'PUBLISHED',kind:sceneReadModel.kind,sceneId:sceneReadModel.sceneId??null,sceneRevision:sceneReadModel.sceneRevision??sceneReadModel.revision??null,sourceRevisionRefs:uniq(sceneReadModel.sourceRevisionRefs??[]).slice(0,32)}:{state:'UNAVAILABLE',reason:'SCENE_UI_READ_MODEL_UNAVAILABLE'},
      fanOut:sceneFanOutIngress?{
        state:sceneFanOutIngress.status==='ADMITTED_FOR_RESULT_BUS'?(sceneFanOutIngress.candidateCount?'ADMITTED':'NO_WORK'):'REJECTED',
        ingressStatus:sceneFanOutIngress.status,reasonCode:sceneFanOutIngress.reasonCode??null,causationId:sceneFanOutIngress.causationId??null,
        assemblyStatus:sceneFanOutIngress.assemblyStatus??null,assemblyReasonCode:sceneFanOutIngress.assemblyReasonCode??null,plannerConsidered:Boolean(sceneFanOutIngress.plannerConsidered),
        physicalExecutionCount:Number(sceneFanOutIngress.physicalExecutionCount??0),admittedResultIds:[...(sceneFanOutIngress.admittedResultIds??[])].slice(0,32),
        rejectedResultIds:[...(sceneFanOutIngress.rejectedResultIds??[])].slice(0,32),staleResultIds:[...(sceneFanOutIngress.staleResultIds??[])].slice(0,32),
        candidateCount:Number(sceneFanOutIngress.candidateCount??0),candidateIds:[...(sceneFanOutIngress.candidateIds??[])].slice(0,32),
        coreBinding:sceneFanOutBinding?{
          status:sceneFanOutBinding.status,boundCandidateIds:[...(sceneFanOutBinding.boundCandidateIds??[])].slice(0,32),rejectedCandidateIds:[...(sceneFanOutBinding.rejectedCandidateIds??[])].slice(0,32),
          selectionResultIds:[...(sceneFanOutBinding.selectionResultIds??[])].slice(0,32),gatheredSelectionResultIds:[...(sceneFanOutBinding.gatheredSelectionResultIds??[])].slice(0,32),
          selectionResultRoutes:clone((sceneFanOutBinding.selectionResultRoutes??[]).slice(0,32)),rows:clone((sceneFanOutBinding.rows??[]).slice(0,32)),
        }:null,
        coreChoice:{admittedJobs:fanOutAdmitted.slice(0,16),skippedJobs:fanOutSkipped.slice(0,16),reasonCodes:uniq(choice?.reasonCodes??[]).slice(0,16)},
      }:fanOutAdmitted.length?{state:'ADMITTED',ingressStatus:'NO_EXTERNAL_HANDOFF',candidateCount:0,candidateIds:[],coreBinding:sceneFanOutBinding?clone(sceneFanOutBinding):null,coreChoice:{admittedJobs:fanOutAdmitted.slice(0,16),skippedJobs:fanOutSkipped.slice(0,16),reasonCodes:uniq(choice?.reasonCodes??[]).slice(0,16)}}:{state:'NO_WORK',ingressStatus:'NO_EXTERNAL_HANDOFF',candidateCount:0,candidateIds:[],coreBinding:sceneFanOutBinding?clone(sceneFanOutBinding):null,coreChoice:{admittedJobs:[],skippedJobs:fanOutSkipped.slice(0,16),reasonCodes:uniq(choice?.reasonCodes??[]).slice(0,16)}},
      gather:gather?{state:(gather.admittedResultIds??[]).length?'ADMITTED_RESULTS':'PUBLISHED_NO_WORK',receiptId:gather.receiptId??gather.kind??null,admittedResultCount:(gather.admittedResultIds??[]).length,staleResultCount:(gather.staleResultIds??[]).length,rejectedResultCount:(gather.rejectedResultIds??[]).length}:{state:'UNAVAILABLE',reason:'GATHER_RECEIPT_UNAVAILABLE'},
      contextSeal:seal?{state:'SEALED',contextSealId:seal.id??null,sceneId:seal.sceneId??scene?.sceneId??null,sceneRevision:seal.sceneRevision??null,sourceRevisionRefs:uniq(seal.sourceRevisionIds??[]).slice(0,64)}:{state:'UNAVAILABLE',reason:'CONTEXT_SEAL_UNAVAILABLE'},
      promptPlan:plan?{state:'PLANNED',promptPlanId:plan.promptPlanId??null,contextSealId:plan.contextSealId??null,turnId:plan.turnId??null,generationId:plan.generationId??null}:{state:'UNAVAILABLE',reason:'PROMPT_PLAN_UNAVAILABLE'},
      hostDelivery:{state:'UNAVAILABLE',reason:'HOST_OBSERVATION_OWNED_BY_SILLYTAVERN_BOUNDARY'},
      authorityGranted:false,canonicalMutationAuthority:false,settlementAuthority:false,contextSealAuthority:false,
    };
    const sceneFences={
      selectedChatId:selection.chatId,selectedTurnId:selection.turnId,selectedGenerationId:selection.generationId,
      selectedSceneId:selection.sceneId,selectedSceneRevision:selection.sceneRevision,
      sceneRevisionMatchesSelection:Number(scene?.sceneRevision)===Number(selection.sceneRevision),
      sceneSourceRefsInSelection:sceneRefs.every(ref=>selection.sourceRevisionRefs.includes(ref)),
      sceneSourceRefsInSeal:sceneRefs.every(ref=>sealRefs.includes(ref)),
      sceneReadModelMatchesSelection:Boolean(sceneReadModel&&sceneReadModel.sceneId===selection.sceneId&&Number(sceneReadModel.sceneRevision??sceneReadModel.revision)===Number(selection.sceneRevision)),
      promptPlanTurnMatches:plan?.turnId===selection.turnId,
      promptPlanGenerationMatches:plan?.generationId===selection.generationId,
      contextSealTurnMatches:seal?.turnId===selection.turnId,
    };
    const producers={
      hostObservation:producer('hostObservation',hostObservation,{producerId:'SILLYTAVERN_HOST',consumerId:'SCENE',reasonCode:hostObservation?'EVIDENCE_PUBLISHED':'NO_EVIDENCE',durationMs:hostObservation?.durationMs??null,sourceRevisionRefs:hostObservation?.sourceRevisionRefs??[],metadata:{id:hostObservation?.eventId??null}}),
      scene:producer('scene',scene,{producerId:'SCENE',consumerId:'HOT_COGNITION',sourceRevisionRefs:scene?.sourceRevisionRefs??[],metadata:{id:sceneId,sceneRevision:scene?.sceneRevision??null}}),
      hotCognition:producer('hotCognition',hot,{producerId:'HOT_COGNITION',consumerId:'COGNITIVE_CHOICE',parentReceiptId:sceneId,metadata:{id:hotId,hotRevision:hot?.hotRevision??null}}),
      cognitiveChoice:producer('cognitiveChoice',choice,{producerId:'COGNITIVE_CHOICE',consumerId:'RUNTIME_SCATTER',parentReceiptId:hotId,reasonCodes:choice?.reasonCodes??[],durationMs:choice?.latencyResourceBudget?.controllerOverheadMs??null,metadata:{id:choiceId}}),
      sensory:producer('sensory',candidate,{producerId:'SENSORY_NET',consumerId:'TRUTH',parentReceiptId:choiceId,durationMs:choice?.latencyResourceBudget?.retrievalElapsedMs??null,metadata:{id:candidateId}}),
      retrieval:producer('retrieval',candidate,{producerId:'RETRIEVAL',consumerId:'TRUTH',parentReceiptId:choiceId,status:choice?.skippedJobs?.includes('RETRIEVAL')?'SKIPPED':null,reasonCode:choice?.skippedJobs?.includes('RETRIEVAL')?(choice?.reasonCodes?.includes('HOT_SUFFICIENT')?'HOT_SUFFICIENT':'NOT_REQUIRED'):null,reasonCodes:choice?.skippedJobs?.includes('RETRIEVAL')?(choice?.reasonCodes??[]):[],metadata:{id:candidateId}}),
      truth:producer('truth',truth,{producerId:'TRUTH',consumerId:'GATHER',parentReceiptId:candidateId,metadata:{id:truthId}}),
      runtime:producer('runtime',runtimeValue,{producerId:'RUNTIME_CORE',consumerId:'OWNER',parentReceiptId:choiceId,reasonCode:runtimeValue?'EVIDENCE_PUBLISHED':'LOGICAL_ADMISSION_ONLY',metadata:{id:runtimeValue?.id??null,eventCount:runtimeEvents.length,events:runtimeEvents}}),
      jev:producer('jev',jevDecision,{producerId:'JEV',consumerId:'GATHER',parentReceiptId:truthId,status:choice?.jev?.unavailable?'UNAVAILABLE':choice?.jev?.abstained?'DEFERRED':choice?.jev?.skipped?'SKIPPED':null,reasonCode:choice?.jev?.reason??(jevDecision?'EVIDENCE_PUBLISHED':'NO_EVIDENCE'),ownerAccepted:null,metadata:{id:jevDecision?.id??null,configured:Boolean(choice?.jev?.considered),qualified:Boolean(choice?.jev?.alternativeCount>=2),physicalAttempt:Boolean(choice?.jev?.invoked),executionPurpose:choice?.jev?.invoked?'COGNITIVE_EXECUTION':'NO_PROVIDER_ATTEMPT',returned:Boolean(choice?.jev?.resultRef||choice?.jev?.abstained),resultRef:choice?.jev?.resultRef??null}}),
      sidecar:producer('sidecar',sceneFanOutIngress?.status==='ADMITTED_FOR_RESULT_BUS'?sceneFanOutIngress:null,{producerId:'SCENE_FANOUT',consumerId:'RESULT_BUS',parentReceiptId:sceneId,status:sceneFanOutIngress?.status??null,reasonCode:sceneFanOutIngress?.reasonCode??(sceneFanOutIngress?.status==='ADMITTED_FOR_RESULT_BUS'?'OWNER_ADMITTED_RESULT_BUS_INPUT':'NO_EVIDENCE'),sourceRevisionRefs:record.sceneSourceRevisionRefs??[],metadata:{candidateCount:Number(sceneFanOutIngress?.candidateCount??0),candidateIds:[...(sceneFanOutIngress?.candidateIds??[])].slice(0,32),causationId:sceneFanOutIngress?.causationId??null,upstreamPhysicalExecutionCount:Number(sceneFanOutIngress?.physicalExecutionCount??0),upstreamAdmittedResultIds:[...(sceneFanOutIngress?.admittedResultIds??[])].slice(0,32),physicalExecutionClaimed:false}}),
      vectoring:producer('vectoring',densePrime,{producerId:'VECTORING',consumerId:'OWNER_MEMORY',parentReceiptId:choiceId,status:densePrime?.status??'NO_EVIDENCE',reasonCode:denseRetrieval.reasonCode,ownerAccepted:denseRetrieval.ownerAdmitted?true:denseRetrieval.providerReturned?false:null,sourceRevisionRefs:denseRetrieval.sourceRevisionRefs,metadata:{resultClass:denseRetrieval.resultClass,requested:denseRetrieval.requested,physicalAttempt:denseRetrieval.providerAttempted,returned:denseRetrieval.providerReturned,ownerAdmitted:denseRetrieval.ownerAdmitted,executionId:denseRetrieval.executionId,providerRequestId:denseRetrieval.providerRequestId,foregroundWaitMs:denseRetrieval.foregroundWaitMs,queueWaitMs:denseRetrieval.queueWaitMs,providerExecutionMs:denseRetrieval.providerExecutionMs}}),
      precision:producer('precision',precisionDecision,{producerId:'PRECISION',consumerId:'GATHER',parentReceiptId:truthId,status:choice?.precision?.failed?'FAILED':choice?.precision?.skipped?'SKIPPED':null,reasonCode:choice?.precision?.reason??(precisionDecision?'EVIDENCE_PUBLISHED':'NO_EVIDENCE'),metadata:{id:precisionDecision?.id??null,physicalAttempt:Boolean(choice?.precision?.invoked),returned:Number(choice?.precision?.resultCount??0)>0}}),
      gather:producer('gather',gather,{producerId:'GATHER',consumerId:'CONTEXT_SEAL',parentReceiptId:truthId,metadata:{id:gatherId}}),
      contextSeal:producer('contextSeal',seal,{producerId:'CONTEXT_SEAL',consumerId:'PROMPT_PLAN',parentReceiptId:gatherId,metadata:{id:sealId}}),
      promptPlan:producer('promptPlan',plan,{producerId:'PROMPT_PLAN',consumerId:'CORE_RENDER',parentReceiptId:sealId,metadata:{id:planId}}),
      contextReceipt:producer('contextReceipt',context,{producerId:'CORE_RENDER',consumerId:'SILLYTAVERN_HOST',parentReceiptId:planId,metadata:{id:context?.contextSealId??null}}),
      compiledDelivery:producer('compiledDelivery',promptReceipt,{producerId:'CORE_DELIVERY',consumerId:'SILLYTAVERN_HOST',parentReceiptId:planId,metadata:{id:stageId('compiledDelivery',promptReceipt,promptReceipt?.contextSealId??null),providerRoles:uniq(promptReceipt?.providerRoles??[])}}),
      delivery:producer('delivery',observed,{producerId:'SILLYTAVERN_HOST',consumerId:'MODEL_PROVIDER',parentReceiptId:stageId('compiledDelivery',promptReceipt,promptReceipt?.contextSealId??null),status:observed?(hostRequestStatus==='OBSERVED_MATCH'?'OBSERVED':'REJECTED'):null,reasonCode:observed?(hostRequestStatus==='OBSERVED_MATCH'?'HOST_EVIDENCE_MATCH':'HOST_EVIDENCE_MISMATCH'):'NO_EVIDENCE',metadata:{id:observed?.requestId??null,live:Boolean(observed?.live),matching:Boolean(observed?.matching),identityCompatible:observed?.identityCompatible??null,observedRoles:uniq(observed?.observedRoles??[])}}),
      responseCompletion:producer('responseCompletion',responseCompletion,{producerId:'NATIVE_BRAIN',consumerId:'RUNTIME_CORE',parentReceiptId:observed?.requestId??sealId,status:responseCompletion?.status??'NO_EVIDENCE',reasonCode:responseCompletion?'RESPONSE_COMPLETION_RECORDED':'NO_EVIDENCE',durationMs:responseCompletion?.foregroundWaitMs??null,ownerAccepted:responseCompletion?.status==='COMPLETED'?true:null,sourceRevisionRefs:[responseCompletion?.sourceRevisionId].filter(Boolean),metadata:{id:stageId('responseCompletion',responseCompletion,responseCompletion?.contextSealId?('response-complete:'+record.turnId):null),learningScheduled:Boolean(responseCompletion?.learningScheduled),feedbackRuntimeTaskId:responseCompletion?.feedbackRuntimeTaskId??null,memoryRuntimeTaskId:responseCompletion?.memoryRuntimeTaskId??null,sealedGenerationImmutable:Boolean(responseCompletion?.sealedGenerationImmutable)}}),
      learning:producer('learning',learning,{producerId:'COGNITIVE_LEARNING',consumerId:'MEMORY_LORE',parentReceiptId:stageId('responseCompletion',responseCompletion,responseCompletion?.contextSealId?('response-complete:'+record.turnId):null)??observed?.requestId??sealId,ownerAccepted:completionLifecycle.background.status==='ACCEPTED'?true:completionLifecycle.background.status==='FAILED'?false:null,metadata:{id:stageId('learning',learning,learning?.experienceId??null),learningStatus:completionLifecycle.background.status,learningReasonCode:completionLifecycle.background.reasonCode,backgroundPending:completionLifecycle.background.backgroundPending,taskCount:completionLifecycle.background.tasks.length,foregroundWaitMs:completionLifecycle.background.foregroundWaitMs,backgroundExecutionMs:completionLifecycle.background.backgroundExecutionMs}}),
      memory:producer('memory',memoryEvidence,{producerId:'MEMORY_MAPPING',consumerId:'MEMORY_EPISODE',parentReceiptId:stageId('learning',learning,learning?.experienceId??null),status:memoryEvidence?.status==='NOT_ATTACHED'?'SKIPPED':memoryEvidence?.status==='NO_EVIDENCE'?'NO_EVIDENCE':memoryEvidence?.status??null,reasonCode:memoryEvidence?.status==='NOT_ATTACHED'?'OPTIONAL_RESOURCE_UNAVAILABLE':memoryEvidence?.status==='NO_EVIDENCE'?'NO_EVIDENCE':memoryEvidence?.reason??null,ownerAccepted:memoryEvidence?.status==='ADMITTED'&&Boolean(memoryEvidence?.ownerReceipt)?true:null,metadata:{stageSemantics:'EXACT_EVIDENCE_MAPPING_ONLY',readerDiagnosis:clone(record.memoryReadDiagnosis??{state:memoryEvidence?.status==='NO_EVIDENCE'?'WRITE_ABSENT':'READER_NOT_OBSERVED',reasonCode:memoryEvidence?.status==='NO_EVIDENCE'?'MEMORY_WRITE_ABSENT':'MEMORY_READER_NOT_OBSERVED'})}}),
      memoryRetrievalFeedback:producer('memoryRetrievalFeedback',memoryRetrievalFeedback,{producerId:'NATIVE_BRAIN',consumerId:'MEMORY',parentReceiptId:truthId,status:memoryRetrievalFeedback?.status??(record.memoryFeedbackRuntimeTaskId?'SCHEDULED':'NO_EVIDENCE'),reasonCode:memoryRetrievalFeedback?.reasonCode??(record.memoryFeedbackRuntimeTaskId?'BACKGROUND_FEEDBACK_SCHEDULED':'NO_OWNER_MEMORY_FEEDBACK'),ownerAccepted:memoryRetrievalFeedback?memoryRetrievalFeedback.status!=='REJECTED':null,metadata:{runtimeTaskId:record.memoryFeedbackRuntimeTaskId??null,batchId:record.memoryRetrievalFeedbackBatch?.batchId??null,outcomeCount:record.memoryRetrievalFeedbackBatch?.outcomeCount??0,appliedCount:memoryRetrievalFeedback?.counts?.applied??0,rejectedCount:memoryRetrievalFeedback?.counts?.rejected??0,deferredCount:memoryRetrievalFeedback?.counts?.deferred??0,replayedCount:memoryRetrievalFeedback?.counts?.replayed??0,supportAdded:false,retrievalUseIsEvidence:false,authorityChanged:false,deliveryKnown:false,stageSemantics:'NONCANONICAL_RETRIEVAL_PLASTICITY'}}),
      memoryEpisode:producer('memoryEpisode',memoryEpisode,{producerId:'MEMORY',consumerId:'MEMORY_HIERARCHY_HISTORIAN',parentReceiptId:stageId('memory',memoryEvidence,null),status:memoryEpisode?.status??null,reasonCode:memoryEpisode?.reasonCode??null,ownerAccepted:['COMPLETED','REPLAYED'].includes(String(memoryEpisode?.status??'').toUpperCase()),sourceRevisionRefs:memoryEpisode?.sourceRevisionRefs??[],metadata:{episodeId:memoryEpisode?.episodeId??null,episodeRevision:memoryEpisode?.episodeRevision??null,exactSourceDrillback:Boolean(memoryEpisode?.exactSourceDrillback),stageSemantics:'DURABLE_EPISODE_ADMISSION'}}),
      memoryConsolidation:producer('memoryConsolidation',memoryConsolidation,{producerId:'CONTINUOUS_CONSOLIDATION',consumerId:'MEMORY',parentReceiptId:stageId('memoryEpisode',memoryEpisode,memoryEpisode?.episodeId??null),status:memoryConsolidation?.status??null,reasonCode:memoryConsolidation?.reasonCode??null,ownerAccepted:['COMPLETED','REPLAYED'].includes(String(memoryConsolidation?.ownerReview?.status??memoryConsolidation?.status??'').toUpperCase()),sourceRevisionRefs:memoryEpisode?.sourceRevisionRefs??[],metadata:{runtimeTaskId:record.memoryConsolidationRuntimeTaskId??null,producerStatus:memoryConsolidation?.producerStatus??null,providerAttempted:Boolean(memoryConsolidation?.providerAttempted),stageSemantics:'REFLECTION_CONSOLIDATION_OWNER_REVIEW'}}),
      lore:producer('lore',loreEvidence,{producerId:'LORE',consumerId:'COGNITIVE_STATE',parentReceiptId:candidateId,status:loreEvidence?.status==='NOT_ATTACHED'?'SKIPPED':null,reasonCode:loreEvidence?.status==='NOT_ATTACHED'?'OPTIONAL_RESOURCE_UNAVAILABLE':null,ownerAccepted:null}),
    };
    const causalOwnerEvents=Object.entries(producers).map(([stage,event])=>({stage,...clone(event)})).slice(0,32);
    return{
      kind:'NativeBrainSelectedTurnReceipt',contractVersion:2,...selection,
      sourceRevisions:{selectedCount:selection.sourceRevisionRefs.length,selectedRefs,sceneCount:sceneRefs.length,sceneRefs,sealCount:sealRefs.length,sealRefs,ownerCount:selection.ownerSourceRevisionRefs.length,generationPreSealRefs:selectedRefs,postResponseLearnedNarrativeRefs:learnedNarrativeRefs,postResponseNarrativeExcludedFromGenerationFence:true},
      producers,causalOwnerEvents,expectedWork,sceneFlow,sceneFences,denseRetrieval,completionLifecycle,
      memoryRetrievalFeedback:clone(memoryRetrievalFeedback),memoryRetrievalFeedbackBatch:clone(record.memoryRetrievalFeedbackBatch??null),
      performance:clone(record.performance??record.published?.performanceReceipt??null),
      counts:{
        admittedJobs:(choice?.admittedJobs??[]).length,skippedJobs:(choice?.skippedJobs??[]).length,
        admittedResults:(gather?.admittedResultIds??[]).length,staleResults:(gather?.staleResultIds??[]).length,rejectedResults:(gather?.rejectedResultIds??[]).length,sceneFanOutCandidates:Number(sceneFanOutIngress?.candidateCount??0),
        plannedSections:(plan?.sections??[]).length,includedSections:includedSlots.length,deferredSections:deferred.length,runtimeCausalEvents:runtimeEvents.length,expectedWork:expectedWork.items.length,
      },
      delivery:{
        planned:plan?{state:'PLANNED',promptPlanId:plan.promptPlanId,contextSealId:plan.contextSealId,totalTokens:plan.budget?.allocated??null,budgetTotal:plan.budget?.total??null,budgetRemaining:plan.budget?.remaining??null,includedSlots,deferred}: {state:'UNAVAILABLE',reason:'PROMPT_PLAN_UNAVAILABLE'},
        compiled:context?{state:'COMPILED_AND_SEALED',contextSealId:context.contextSealId,packetId:context.packetId??null,packetHash:context.packetHash??null,includedSlots:[...(context.includedSections??[])].slice(0,32),deferred:[...(context.deferredSections??[])].slice(0,16)}:{state:'UNAVAILABLE',reason:'CONTEXT_RECEIPT_UNAVAILABLE'},
        hostObserved:observed?{state:'OBSERVED',requestId:observed.requestId??null,matching:Boolean(observed.matching),live:Boolean(observed.live),observedRoles:uniq(observed.observedRoles??[])}:{state:'UNAVAILABLE',reason:'HOST_OBSERVATION_OWNED_BY_SILLYTAVERN_BOUNDARY'},
      },
      rawPromptIncluded:false,storyTextIncluded:false,loreBodiesIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false,
    };
  }


  #rememberOwnerEvidence(evidence){
    if(!evidence?.evidenceId)return null;
    this.ownerEvidence.set(String(evidence.evidenceId),clone(evidence));
    while(this.ownerEvidence.size>512)this.ownerEvidence.delete(this.ownerEvidence.keys().next().value);
    return evidence;
  }

  #resolveKnowledgeEvidence(candidate){
    const evidenceId=candidate?.metadata?.knowledgeEvidenceId??candidate?.channelNominations?.map(row=>row?.metadata?.knowledgeEvidenceId).find(Boolean)??null;
    if(evidenceId&&this.ownerEvidence.has(String(evidenceId)))return clone(this.ownerEvidence.get(String(evidenceId)));
    return this.knowledge.evidenceForCandidate(candidate);
  }

  #admitLoreOwnerRevision(source={}){
    const sourceId=String(source?.sourceId??'').trim(),sourceRevisionId=String(source?.sourceRevisionId??'').trim();
    if(!sourceId||!sourceRevisionId)return{admit:false,reason:'LORE_REVISION_IDENTITY_MISSING'};
    if(this.rejectedLoreRevisionIds.has(sourceRevisionId))return{admit:false,reason:'LORE_REPLACED_REVISION_DISTRUSTED'};
    const trust=this.loreRevisionTrust.get(sourceId);
    if(!trust)return{admit:true,status:'UNTRACKED_OWNER_CURRENT'};
    if(trust.status==='REMOVED')return{admit:false,reason:'LORE_SOURCE_REMOVED'};
    if(trust.status==='PENDING_EXACT_RETRIEVAL'){
      if(sourceRevisionId!==trust.pendingSourceRevisionId)return{admit:false,reason:'LORE_REPLACEMENT_AWAITING_EXACT_RETRIEVAL'};
      if(typeof source.exactAuthoredText!=='string'||!source.exactAuthoredText.trim())return{admit:false,reason:'LORE_REPLACEMENT_EXACT_SOURCE_MISSING'};
      if(source.ownerRevision&&String(source.ownerRevision.id??'')!==sourceRevisionId)return{admit:false,reason:'LORE_OWNER_CURRENT_REVISION_MISMATCH'};
      if(source.ownerRevision?.state==='REMOVED')return{admit:false,reason:'LORE_REPLACEMENT_REMOVED'};
      if(source.ownerRevision?.contentHash&&trust.contentHash&&String(source.ownerRevision.contentHash)!==String(trust.contentHash))return{admit:false,reason:'LORE_REPLACEMENT_CONTENT_HASH_MISMATCH'};
      this.loreRevisionTrust.set(sourceId,{...trust,status:'TRUSTED',trustedSourceRevisionId:sourceRevisionId,pendingSourceRevisionId:null,trustedAtTurnSequence:this.turnSequence+1});
      return{admit:true,status:'TRUSTED_AFTER_EXACT_RETRIEVAL'};
    }
    if(trust.trustedSourceRevisionId&&sourceRevisionId!==trust.trustedSourceRevisionId)return{admit:false,reason:'LORE_REVISION_CHANGE_EVENT_REQUIRED'};
    return{admit:true,status:'TRUSTED_CURRENT'};
  }

  #ownerRetrievalReceipt(kind){
    const upper=String(kind).toUpperCase(),attached=upper==='LORE'?Boolean(this.loreInterface):Boolean(this.memoryInterface);
    if(!attached)return{kind:'OwnerKnowledgeRetrievalReceipt',channelId:upper==='LORE'?OWNER_KNOWLEDGE_CHANNELS.LORE:OWNER_KNOWLEDGE_CHANNELS.MEMORY,status:'NOT_ATTACHED',queried:false,nominationCount:0,sourceRevisionFence:[],authorityGranted:false};
    return upper==='LORE'?this.ownerLoreChannel.receipt():this.ownerMemoryChannel.receipt();
  }

  #uiScatterReceipt(record){
    const choice=record.published?.cognitiveChoiceReceipt??{};
    const runtimeRecords=this.runtimeDirector.ledger.list().filter(row=>causalObligationMatchesSelection(row.obligation,this.#selection(record)));
    const eventsFor=(row)=>row.causalReceipts??[];
    const physicalEvents=runtimeRecords.flatMap(row=>eventsFor(row).filter(event=>event.eventKind==='PHYSICAL_EXECUTION_STARTED').map(event=>({taskId:row.taskId,...clone(event)})));
    const matchesJob=(row,jobId)=>[row.obligation?.taskType,row.obligation?.payload?.cognitiveTask?.taskType,row.obligation?.payload?.cognitiveTask?.jobId].filter(Boolean).map(String).includes(String(jobId));
    const jobs=(choice.admittedJobs??[]).map((jobId,index)=>{
      const matched=runtimeRecords.filter(row=>matchesJob(row,jobId)),events=matched.flatMap(eventsFor),physical=events.filter(x=>x.eventKind==='PHYSICAL_EXECUTION_STARTED'),returned=events.filter(x=>x.eventKind==='RESULT_RETURNED'),late=events.find(x=>x.eventKind==='RESULT_LATE'),stale=events.find(x=>x.eventKind==='RESULT_STALE'),rejected=events.find(x=>x.eventKind==='OWNER_REJECTED'||x.ownerAccepted===false),accepted=[...events].reverse().find(x=>x.eventKind==='OWNER_ADMISSION'&&x.ownerAccepted===true);
      const terminal=stale?'STALE':late?'LATE':rejected?'REJECTED':accepted?'OWNER_ACCEPTED':returned.length?'RETURNED':physical.length?'RUNNING':'ADMITTED_LOGICAL';
      const lastEvidence=stale??late??rejected??accepted??returned.at(-1)??physical.at(-1)??null;
      return{jobId:String(jobId),sequence:index+1,status:terminal,owner:'COGNITIVE_CORE',taskIds:matched.map(row=>row.taskId),physicalExecutionEvidence:physical.length?'EVIDENCE':'NO_EVIDENCE',resultReturned:returned.length>0,ownerAccepted:rejected?false:accepted?true:null,reasonCode:lastEvidence?.reasonCode??'LOGICAL_ADMISSION_ONLY'};
    });
    const runtimeTasks=runtimeRecords.map(row=>({taskId:row.taskId,taskType:row.obligation?.taskType??null,owner:row.obligation?.owner??null,lifecycleStatus:row.lifecycleStatus,executionStatus:row.executionStatus,eventKinds:uniq(eventsFor(row).map(event=>event.eventKind)),lastReasonCode:eventsFor(row).at(-1)?.reasonCode??null}));
    return{
      kind:'RuntimeTurnReceipt',...this.#selection(record),jobs,runtimeTasks,admittedJobCount:jobs.length,
      resourceCount:new Set(physicalEvents.map(event=>event.workerId).filter(Boolean)).size,
      resourceIds:uniq(physicalEvents.map(event=>event.workerId).filter(Boolean)),physicalEvents:physicalEvents.slice(-32),
      requiredFallback:0,opportunisticPending:jobs.filter(row=>row.status==='RUNNING').length,executionComplete:jobs.every(row=>['RETURNED','OWNER_ACCEPTED','STALE','LATE','REJECTED'].includes(row.status)),
      logicalAdmissionIsNotExecution:true,authorityGranted:false,
    };
  }


  #expectedWorkReadModel(record){
    const items=this.obligationReconciler.list().filter(row=>{
      const cause=row.cause??{};
      if(cause.chatId!=null&&String(cause.chatId)!==record.chatId)return false;
      if(cause.turnId!=null&&String(cause.turnId)!==record.turnId)return false;
      if(cause.generationId!=null&&String(cause.generationId)!==record.generationId)return false;
      return cause.chatId!=null||cause.turnId!=null||cause.generationId!=null;
    });
    return{kind:'NativeBrainExpectedWorkReadModel',...this.#selection(record),items:clone(items),counts:{total:items.length,done:items.filter(row=>row.status==='DONE').length,due:items.filter(row=>row.status==='DUE').length,blocked:items.filter(row=>row.status==='BLOCKED').length,failed:items.filter(row=>row.status==='FAILED').length,skipped:items.filter(row=>row.status==='SKIPPED_WITH_REASON').length,deferred:items.filter(row=>row.status==='DEFERRED').length,stale:items.filter(row=>row.status==='STALE').length,late:items.filter(row=>row.status==='LATE').length},authorityGranted:false};
  }

  #uiRetrievalBudgetReceipt(record){
    const fusion=record.published?.candidateEnvelope?.fusionReceipt??null,latency=record.published?.retrievalBudgetReceipt??record.published?.candidateEnvelope?.metadata?.retrievalBudgetReceipt??null,choice=record.published?.cognitiveChoiceReceipt?.latencyResourceBudget??null,delivery=record.delivery?.plan?.diagnosticReceipt?.budgetDecision??null;
    return{kind:'NativeBrainRetrievalBudgetReceipt',...this.#selection(record),candidate:{requested:record.retrievalPolicy?.candidateBudget??choice?.candidateBudget??null,effective:fusion?.diagnostics?.effectiveCandidateLimit??choice?.effectiveCandidateLimit??null,nominated:fusion?.inputNominationCount??0,deduplicated:fusion?.deduplicatedCandidateCount??0,boundedOut:fusion?.boundedOutCount??0},latency:clone(latency),contextDelivery:clone(delivery),authorityGranted:false};
  }

  #uiRejectedEvidence(record){
    const fusion=record.published?.candidateEnvelope?.fusionReceipt??{},graph=record.published?.graphTraversalReceipt??record.published?.candidateEnvelope?.metadata?.graphTraversalReceipt??{},routes=record.published?.resultRoutes??[];
    return{kind:'NativeBrainRejectedEvidenceReceipt',...this.#selection(record),staleNominationCount:Number(fusion.staleNominationCount??0),invalidNominationCount:Number(fusion.invalidNominationCount??0),staleGraphEdges:clone(graph.staleRejected??[]),staleGraphEdgeCount:Number(graph.staleRejectedCount??0),loreRejectedRevisionRefs:[...(record.loreSync?.rejectedRevisionRefs??[])],staleResultIds:routes.filter(row=>row?.route?.freshness==='STALE').map(row=>row.result?.id).filter(Boolean),rejectedResultIds:routes.filter(row=>row?.route?.accepted===false).map(row=>row.result?.id).filter(Boolean),authorityGranted:false};
  }

  #uiGatherReceipt(record){
    const receipt=record.published?.gatherReceipt;if(!receipt)return null;
    const results=(record.published?.resultRoutes??[]).map((row)=>({
      resultId:row?.result?.id??null,candidateId:row?.result?.payload?.candidateId??row?.result?.provenance?.candidateId??null,
      accepted:Boolean(row?.route?.accepted),freshness:row?.route?.freshness??null,destination:row?.route?.effectiveDestination??row?.result?.destination??null,
      evidenceRefs:uniq([...(row?.result?.evidenceIds??[]),...(row?.result?.payload?.evidenceRefs??[])]),
      sourceRevisionRefs:uniq(row?.result?.sourceRevisionIds??[]),
      graphProviders:uniq((row?.result?.payload?.graphMetadata??[]).map(meta=>meta?.graphProvider).filter(Boolean)),
    }));
    return{...clone(receipt),...this.#selection(record),results};
  }

  #uiPrecisionReceipt(record){
    const results=record.published?.precisionResults??[];
    if(!results.length&&!record.published?.precisionFailed)return null;
    return{kind:'PrecisionReceipt',...this.#selection(record),results:clone(results),failed:Boolean(record.published?.precisionFailed),authorityGranted:false};
  }

  #memoryReadModel(record,selection={}){
    const expected=this.#selection(record),writeback=record.learningReceipt?.memoryWriteback??null,episode=record.learningReceipt?.memoryPostTurn??record.memoryPostTurn??null;
    const feedbackFields={retrievalFeedbackBatch:clone(record.memoryRetrievalFeedbackBatch??null),retrievalFeedback:clone(record.memoryRetrievalFeedback??null),memoryFeedbackRuntimeTaskId:record.memoryFeedbackRuntimeTaskId??null,supportAdded:false,retrievalUseIsEvidence:false,authorityChanged:false,canonicalMutationAuthority:false};
    const writeStatus=String(writeback?.status??'NO_WRITE').toUpperCase(),episodeStatus=String(episode?.status??'NO_EPISODE').toUpperCase();
    const writePresent=['ADMITTED','REPLAYED'].includes(writeStatus)||['ADMITTED','REPLAYED','COMPLETED'].includes(episodeStatus)||Boolean(episode?.episodeId);
    const baseDiagnosis={writeState:writePresent?'WRITE_PRESENT':'WRITE_ABSENT',writeStatus,episodeStatus,ownerReceiptKind:writeback?.ownerReceipt?.kind??null};
    const read=this.memoryInterface?.readMemory??this.memoryInterface?.adapters?.readMemory;
    if(typeof read==='function'){
      try{
        const value=read({...expected,...clone(selection)});
        if(value&&typeof value.then!=='function'){
          const fields=['chatId','turnId','generationId','correlationId','sceneRevision','worldRevision'];
          const mismatchFields=fields.filter(name=>value?.[name]!=null&&expected?.[name]!=null&&String(value[name])!==String(expected[name]));
          const diagnosis={...baseDiagnosis,state:mismatchFields.length?'READER_SELECTION_MISMATCH':writePresent?'WRITE_PRESENT_READER_AVAILABLE':'WRITE_ABSENT',reasonCode:mismatchFields.length?'MEMORY_READER_SELECTION_MISMATCH':writePresent?'MEMORY_WRITE_PRESENT_READER_AVAILABLE':'MEMORY_WRITE_ABSENT',mismatchFields};
          record.memoryReadDiagnosis=diagnosis;
          return{...clone(value),...feedbackFields,evidenceDiagnosis:clone(diagnosis)};
        }
        const diagnosis={...baseDiagnosis,state:writePresent?'WRITE_PRESENT_READER_EMPTY':'WRITE_ABSENT',reasonCode:writePresent?'MEMORY_WRITE_PRESENT_READER_RETURNED_NO_MODEL':'MEMORY_WRITE_ABSENT',mismatchFields:[]};
        record.memoryReadDiagnosis=diagnosis;
      }catch(error){
        const code=String(error?.code??'MEMORY_READ_FAILED').slice(0,96),selectionMismatch=/SELECTION|STALE|FOREIGN|FENCE/.test(code.toUpperCase());
        const diagnosis={...baseDiagnosis,state:selectionMismatch?'READER_SELECTION_MISMATCH':writePresent?'WRITE_PRESENT_READER_FAILED':'WRITE_ABSENT',reasonCode:selectionMismatch?'MEMORY_READER_SELECTION_MISMATCH':writePresent?'MEMORY_READER_FAILED_AFTER_WRITE':'MEMORY_WRITE_ABSENT',readerErrorCode:code,mismatchFields:[]};
        record.memoryReadDiagnosis=diagnosis;
      }
    }else record.memoryReadDiagnosis={...baseDiagnosis,state:writePresent?'WRITE_PRESENT_READER_UNAVAILABLE':'WRITE_ABSENT',reasonCode:writePresent?'MEMORY_READER_UNAVAILABLE_AFTER_WRITE':'MEMORY_WRITE_ABSENT',mismatchFields:[]};
    return{kind:'NativeBrainMemoryStatus',...expected,sync:clone(record.memorySync??null),fallbackStore:this.memoryInterface?null:this.knowledge.diagnostics(),...feedbackFields,evidenceDiagnosis:clone(record.memoryReadDiagnosis),authorityGranted:false};
  }

  #memoryOwnerArtifactRef(record,experience){
    const revision=this.core.registry.getRevision(experience.sourceRevisionId),ownerRevision=Math.max(1,Number(revision?.revision??experience?.evidence?.artifactRef?.revision??1));
    return{kind:'ArtifactReference',artifactId:'core-narrative:'+record.chatId+':'+record.turnId+':assistant',artifactType:'NarrativeExperience',owner:'COGNITIVE_CORE',revision:ownerRevision,sourceRevisionSet:[experience.sourceRevisionId],worldRevision:record.worldRevision,sceneRevision:record.sceneRevision};
  }

  #mirrorSettlementsToMemory(record,experience,settlements=[]){
    const apply=this.memoryInterface?.applyCoreSettlement??this.memoryInterface?.adapters?.applyCoreSettlement;
    if(!this.memoryInterface||typeof apply!=='function')return[];
    const artifactRef=this.#memoryOwnerArtifactRef(record,experience),externalEvidenceRef=artifactRef.artifactId,receipts=[];
    for(const settlement of settlements??[]){
      if(!settlement?.proposal||!settlement?.decision)continue;
      try{
        const memoryEnvelope={proposal:clone(settlement.proposal),decision:clone(settlement.decision),receipt:clone(settlement.receipt??null)};
        memoryEnvelope.proposal.evidenceIds=(memoryEnvelope.proposal.evidenceIds??[]).map(id=>id===experience.artifactId?externalEvidenceRef:id);
        memoryEnvelope.decision.evidenceIds=(memoryEnvelope.decision.evidenceIds??[]).map(id=>id===experience.artifactId?externalEvidenceRef:id);
        const receipt=apply(memoryEnvelope,{evidenceArtifactRefs:[{externalEvidenceRef,artifactRef}]});
        if(receipt&&typeof receipt.then==='function')receipts.push({kind:'NativeBrainMemorySettlementMirrorReceipt',status:'DEGRADED',reason:'MEMORY_ASYNC_SETTLEMENT_MIRROR_UNSUPPORTED'});
        else receipts.push(clone(receipt));
      }catch(error){receipts.push({kind:'NativeBrainMemorySettlementMirrorReceipt',status:'DEGRADED',reason:error?.message??String(error),authorityGranted:false});}
    }
    return receipts;
  }

  #recordSceneExpectedWork({chatId,turnId,generationId,correlationId,turnRevision,sceneState,published}){
    if(!sceneState?.retrievalRequired)return[];
    const choice=published?.cognitiveChoiceReceipt??null,candidate=published?.candidateEnvelope??null,results=[];
    for(const need of sceneState.cognitiveNeeds??[]){
      if(String(need?.resultClass??'')!=='REQUIRED'||!(need?.requiredCapabilities??[]).map(String).includes('RETRIEVAL'))continue;
      const expectedId='scene-need:'+String(generationId)+':'+String(need.needId??need.needType??'retrieval');
      this.obligationReconciler.declare({
        expectedId,owner:'SCENE',ownerSignalId:sceneState.lastReceiptId??('scene:'+sceneState.sceneId+':r'+sceneState.sceneRevision),
        cause:{eventType:'SCENE_COGNITIVE_NEED',eventId:String(need.needId??expectedId),producerId:'SCENE',consumerId:'COGNITIVE_CHOICE',ownerId:'SCENE',chatId,turnId,generationId,correlationId,turnRevision,sourceRevisionRefs:sceneState.sourceRevisionRefs??[],worldRevision:published?.worldRevision??null,sceneRevision:sceneState.sceneRevision},
        obligation:{taskType:'SCENE_RETRIEVAL_NEED',layer:'L1',requiredCapabilities:['RETRIEVAL'],dedupeKey:expectedId},
      });
      results.push(this.obligationReconciler.reconcile(expectedId,{admit:false}));
    }
    return results;
  }

  #declareMemoryExpectedWork(record,experience){
    const expectedId='memory-post-turn:'+record.generationId;
    const common={expectedId,owner:'MEMORY',ownerSignalId:'generation-complete:'+record.generationId,cause:{eventType:'GENERATION_COMPLETED',eventId:'generation-complete:'+record.generationId,producerId:'NATIVE_BRAIN',consumerId:'MEMORY',ownerId:'MEMORY',chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,turnRevision:record.sequence,sourceRevisionRefs:[experience.sourceRevisionId],worldRevision:record.worldRevision,sceneRevision:record.sceneRevision}};
    if(!this.memoryInterface){this.obligationReconciler.declare({...common,disposition:'SKIP',reasonCode:CausalReasonCode.OPTIONAL_RESOURCE_UNAVAILABLE});return null;}
    this.obligationReconciler.declare({...common,obligation:{taskType:'MEMORY_POST_TURN',layer:'L2',requiredCapabilities:['MEMORY_WRITEBACK'],dedupeKey:expectedId}});return expectedId;
  }

  #recordMemoryExpectedResult(expectedId,receipt){
    if(!expectedId)return null;
    const status=String(receipt?.status??'UNKNOWN').toUpperCase();
    if(['ADMITTED','REPLAYED'].includes(status)&&receipt?.ownerReceipt){
      const returned=this.obligationReconciler.recordEvidence(expectedId,{kind:CausalReceiptKind.RESULT_RETURNED,producerId:'MEMORY',consumerId:'NATIVE_BRAIN',metadata:{status,ownerReceiptKind:receipt.ownerReceipt.kind??null}});
      this.obligationReconciler.recordEvidence(expectedId,{kind:CausalReceiptKind.OWNER_ADMISSION,producerId:'MEMORY',consumerId:'COGNITIVE_STATE',parentReceiptId:returned.id,ownerAccepted:true,metadata:{status,ownerReceiptKind:receipt.ownerReceipt.kind??null}});
    }else if(['ADMITTED','REPLAYED','NO_EVIDENCE','SKIPPED'].includes(status))return this.obligationReconciler.reconcile(expectedId,{admit:false});
    else this.obligationReconciler.recordEvidence(expectedId,{kind:CausalReceiptKind.WORK_FAILED,producerId:'MEMORY',consumerId:'NATIVE_BRAIN',reasonCode:status==='UNSUPPORTED'?CausalReasonCode.EXECUTOR_UNAVAILABLE:CausalReasonCode.TASK_FAILED,metadata:{status,reason:receipt?.reasonCode??receipt?.reason??null}});
    return this.obligationReconciler.reconcile(expectedId,{admit:false});
  }
  #writeBackMemoryEvidence(record,experience,{knownBy=[],exactContent,priorExperience=null}={}){
    const admit=this.memoryInterface?.admitExternalEvidenceMapping??this.memoryInterface?.adapters?.admitExternalEvidenceMapping;
    if(!this.memoryInterface)return{kind:'NativeBrainMemoryWritebackReceipt',status:'NOT_ATTACHED',authorityGranted:false};
    if(typeof admit!=='function')return{kind:'NativeBrainMemoryWritebackReceipt',status:'UNSUPPORTED',reason:'MEMORY_EXACT_EVIDENCE_MAPPING_UNAVAILABLE',authorityGranted:false};
    try{
      const ownerArtifactRef=this.#memoryOwnerArtifactRef(record,experience),ownerRevision=ownerArtifactRef.revision;
      const externalEvidenceRef=ownerArtifactRef.artifactId;
      let invalidation=null;
      const invalidate=this.memoryInterface?.invalidateExternalEvidenceMapping??this.memoryInterface?.adapters?.invalidateExternalEvidenceMapping;
      if(priorExperience&&typeof invalidate==='function'){
        const priorOwnerArtifactRef=this.#memoryOwnerArtifactRef(record,priorExperience);
        invalidation=invalidate({ownerArtifactRef:priorOwnerArtifactRef,externalEvidenceRef:priorOwnerArtifactRef.artifactId,replacedBySourceRevisionId:experience.sourceRevisionId,removed:false,reason:'NARRATIVE_SOURCE_CORRECTED'});
        if(invalidation&&typeof invalidation.then==='function')throw new Error('MEMORY_ASYNC_INVALIDATION_UNSUPPORTED_IN_SYNC_COMMIT');
      }
      const receipt=admit({
        kind:'MemoryExternalEvidenceMappingRequest',contractVersion:'1.0.0',
        ownerArtifactRef,
        externalEvidenceRef,
        source:{
          sourceId:experience.sourceId,sourceRevisionId:experience.sourceRevisionId,exactContent:String(exactContent??experience.exactContent??''),
          evidenceKind:'NARRATIVE_EXPERIENCE',occurredAt:record.sequence,worldRevision:record.worldRevision,sceneRevision:record.sceneRevision,
          participants:uniq(knownBy),knownBy:uniq(knownBy),perspective:'WORLD',
          metadata:{chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,role:'assistant'},
          provenance:['core-narrative:'+experience.sourceRevisionId],
        },
        revisionProof:{sourceRevisionId:experience.sourceRevisionId,ownerArtifactRevision:ownerRevision,worldRevision:record.worldRevision,sceneRevision:record.sceneRevision},
        provenanceRefs:['native-brain:'+record.turnId],
      });
      if(receipt&&typeof receipt.then==='function')return{kind:'NativeBrainMemoryWritebackReceipt',status:'DEGRADED',reason:'MEMORY_ASYNC_WRITEBACK_UNSUPPORTED_IN_SYNC_COMMIT',authorityGranted:false};
      return{kind:'NativeBrainMemoryWritebackReceipt',status:receipt?.status??'NO_EVIDENCE',ownerReceipt:clone(receipt??null),invalidation:clone(invalidation),sourceRevisionId:experience.sourceRevisionId,authorityGranted:false,canonicalMutationAuthority:false};
    }catch(error){return{kind:'NativeBrainMemoryWritebackReceipt',status:'DEGRADED',reason:error?.message??String(error),sourceRevisionId:experience.sourceRevisionId,authorityGranted:false};}
  }

  #usedWork(published){
    const r=published.cognitiveChoiceReceipt;
    return{admittedJobs:[...(r?.admittedJobs??[])],sensoryChannelsUsed:[...(r?.sensoryChannelsUsed??[])],finalEvidenceRefs:[...(r?.finalEvidenceRefs??[])],paths:[...(r?.paths??[])]};
  }

  #skippedWork(published){
    const r=published.cognitiveChoiceReceipt;
    return{skippedJobs:[...(r?.skippedJobs??[])],deferredJobs:[...(r?.deferredJobs??[])],reasonCodes:[...(r?.reasonCodes??[])],jev:clone(r?.jev??null),precision:clone(r?.precision??null)};
  }

  #rememberTurn(record){
    const id=String(record.turnId);
    if(!this.turns.has(id))this.turnOrder.push(id);
    this.turns.set(id,record);
    while(this.turnOrder.length>this.maxTurns){const old=this.turnOrder.shift();this.turns.delete(old);}
    this.#compactRetainedTurns();
  }

  // Audit H3: only the newest turns keep full diagnostic detail. Older records whose background
  // learning has settled are compacted to references; owner stores and the sealed packet remain
  // authoritative. A record with pending Runtime work or uncomputed feedback is left intact.
  #turnBackgroundSettled(record){
    if(record.feedbackRuntimeTaskId&&!record.feedback)return false;
    const ids=[record.feedbackRuntimeTaskId,record.memoryFeedbackRuntimeTaskId,record.memoryRuntimeTaskId,record.memoryConsolidationRuntimeTaskId].filter(Boolean);
    for(const taskId of ids){
      const task=this.runtimeDirector?.ledger?.get?.(taskId);if(!task)continue;
      if(['PENDING','ELIGIBLE'].includes(String(task.lifecycleStatus))||['QUEUED','ACTIVE','YIELDING','PARKED','RECOVERING'].includes(String(task.executionStatus)))return false;
    }
    return true;
  }
  #compactRetainedTurns(){
    const keep=Math.max(1,Number(this.fullDetailTurns??DEFAULT_FULL_DETAIL_TURNS));
    const eligible=this.turnOrder.slice(0,Math.max(0,this.turnOrder.length-keep));
    for(const id of eligible){
      const record=this.turns.get(id);
      if(!record)continue;
      if(record.retention?.state==='COMPACTED'){
        // Late learning receipts can attach after compaction; re-bound recently compacted records only.
        if(Number(record.retention.compactedAtSequence??0)>=this.turnSequence-8)this.turns.set(id,reboundCompactedTurnRecord(record));
        continue;
      }
      if(!this.#turnBackgroundSettled(record))continue;
      this.turns.set(id,compactTurnRecord(record,{sequence:this.turnSequence}));
    }
  }
}
