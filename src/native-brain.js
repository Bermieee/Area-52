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
import {NativeKnowledgeStore} from './native-knowledge-store.js';
import {NativeLearningFeedback} from './native-learning-feedback.js';
import {
  CAPABILITIES,
  LIFECYCLE_STATUS,
  MemoryPersistenceAdapter,
  WorkerDirector,
} from './runtime/index.js';
import {stableHash} from './browser-runtime-utils.js';

const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();
const req=(value,name)=>{if(typeof value!=='string'||!value.trim())throw new TypeError(name+' must be a non-empty string');return value.trim();};
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;

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
    activeThreads:clone(input.activeThreads??[]),objects:clone(input.objects??input.immediateObjects??[]),
    objectObservations:clone(input.objectObservations??[]),uncertainFields:clone(input.uncertainFields??[]),
    conflictSignals:clone(input.conflictSignals??[]),boundaryState:clone(input.boundaryState??{status:'STABLE'}),
    sceneRelationship:input.sceneRelationship??null,transitionType:input.transitionType??null,
    previousSceneRef:clone(input.previousSceneRef??null),resumedSceneRef:clone(input.resumedSceneRef??null),
    episodeRefs:clone(input.episodeRefs??[]),prefetchRecommendations:clone(input.prefetchRecommendations??[]),
    objectTransitionRefs:clone(input.objectTransitionRefs??[]),
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
    this.knowledge=new NativeKnowledgeStore({registry:this.core.registry,snapshot:snapshot?.knowledge??null});
    this.ownerEvidence=new Map();
    this.loreRevisionTrust=new Map(clone(snapshot?.loreRevisionTrust??[]));
    this.rejectedLoreRevisionIds=new Set(clone(snapshot?.rejectedLoreRevisionIds??[]));
    this.loreInterface=null;this.memoryInterface=null;
    this.ownerLoreChannel=new LoreOwnerRetrievalChannel({
      getInterface:()=>this.loreInterface,
      evidenceSink:(evidence)=>this.#rememberOwnerEvidence(evidence),
      revisionGuard:(source)=>this.#admitLoreOwnerRevision(source),
    });
    this.ownerMemoryChannel=new MemoryOwnerRetrievalChannel({getInterface:()=>this.memoryInterface,evidenceSink:(evidence)=>this.#rememberOwnerEvidence(evidence)});
    this.core.registerExternalKnowledgeResolver((candidate)=>this.#resolveKnowledgeEvidence(candidate));
    this.attachLoreInterface(loreInterface);
    this.attachMemoryInterface(memoryInterface);

    this.turns=new Map(clone(snapshot?.turns??[]));
    this.turnOrder=clone(snapshot?.turnOrder??[]);
    this.sceneSignals=new Map(clone(snapshot?.sceneSignals??[]));
    this.turnSequence=Number(snapshot?.turnSequence??0);
    this.runtimeResults=clone(snapshot?.runtimeResults??[]).slice(-128);
    this.listeners=new Set();

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
    this.#attachRecoveredExecutors();
  }

  #registerKnowledgeChannels(){
    for(const id of ['NATIVE_LORE','NATIVE_MEMORY',OWNER_KNOWLEDGE_CHANNELS.LORE,OWNER_KNOWLEDGE_CHANNELS.MEMORY])this.core.retrieval.unregisterChannel(id);
    if(this.loreInterface)this.core.registerRetrievalChannel(this.ownerLoreChannel);
    else this.core.registerRetrievalChannel(this.knowledge.channel('LORE',{channelId:'NATIVE_LORE',rankBias:(id)=>this.feedback.biasFor(id)}));
    if(this.memoryInterface)this.core.registerRetrievalChannel(this.ownerMemoryChannel);
    else this.core.registerRetrievalChannel(this.knowledge.channel('MEMORY',{channelId:'NATIVE_MEMORY',rankBias:(id)=>this.feedback.biasFor(id)}));
  }

  attachLoreInterface(loreInterface=null){
    if(loreInterface!==null&&typeof loreInterface?.query!=='function')throw new TypeError('Lore interface must expose query(request)');
    if(loreInterface?.contractVersion!=null&&Number(loreInterface.contractVersion)!==1)throw new Error('Unsupported Lore Brain interface contract version: '+loreInterface.contractVersion);
    this.loreInterface=loreInterface;
    this.#registerKnowledgeChannels();
    return{kind:'NativeBrainLoreInterfaceReceipt',attached:Boolean(loreInterface),contractVersion:loreInterface?.contractVersion??null,authorityGranted:false,settlementAuthority:false,contextSealAuthority:false};
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
    return{
      kind:'NativeBrainLoreRevisionInvalidationReceipt',contractVersion:1,status:'INVALIDATED',sourceId,lorebookId,uid,
      previousSourceRevisionId,sourceRevisionId,sourceState,settlementId:event.settlementId??null,operationKind:event.operationKind??null,restoration:Boolean(event.restoration),
      checkedChats:uniq(checkedChats),invalidatedChats:uniq(invalidatedChats),
      nextRevisionTrusted:false,nextRevisionRequiresOwnerRetrieval:sourceState!=='REMOVED',revisionTrustStatus:sourceState==='REMOVED'?'REMOVED':'PENDING_EXACT_RETRIEVAL',identityInvalidation,
      authorityGranted:false,settlementAuthority:false,canonicalMutationAuthority:false,contextSealAuthority:false,
    };
  }

  attachMemoryInterface(memoryInterface=null){
    const adapters=memoryInterface?.adapters??memoryInterface;
    if(memoryInterface!==null&&(typeof adapters?.queryHistorian!=='function'||typeof adapters?.drillDown!=='function'))throw new TypeError('Memory interface must expose queryHistorian(request) and drillDown(nomination, options)');
    if(memoryInterface?.contractVersion!=null&&String(memoryInterface.contractVersion).split('.')[0]!=='1')throw new Error('Unsupported Memory integration contract version: '+memoryInterface.contractVersion);
    this.memoryInterface=memoryInterface;
    this.#registerKnowledgeChannels();
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
    scene=null,sceneSignal=null,anchorEntityIds=[],perspectiveConstraint=null,
    budgetBytes=5000,budgetTokens=null,deadline=null,modelProfileId='CACHE_STABLE',
    systemPolicy=null,activeThreads=[],precisionAvailable=true,channelIds=null,
    candidateBudget=64,latencyBudgetMs=100,graphTraversal=null,
    executionLabel='LIVE_HOST',
  }={}){
    const chat=req(chatId,'chatId'),turn=req(turnId,'turnId'),generation=req(generationId,'generationId'),q=req(query,'query');
    const corr=correlationId??('corr:'+turn);
    this.core.activateHotCognitionChat(chat,{reason:'TURN_RECEIVED'});
    if(sceneSignal||scene)this.observeScene(chat,sceneSignal??scene);
    const sceneState=this.core.sceneIntegrationSnapshot(chat);
    if(!sceneState?.sceneId)throw new Error('NATIVE_BRAIN_SCENE_REQUIRED: active Scene owner state is required before generation');
    this.ownerEvidence.clear();
    // The Scene owner may carry a host revision that is not stored in the native SourceRegistry.
    // Reset the external fence to this turn's accepted Scene revisions; retrieval channels merge
    // their current owner revisions into the same fence instead of replacing the Scene evidence.
    this.core.setExternalCurrentSourceRevisionRefs(sceneState.sourceRevisionRefs??[]);
    const ownerSelection={chatId:chat,turnId:turn,generationId:generation,correlationId:corr,worldRevision:this.core.graph.revision,sceneRevision:sceneState.sceneRevision,sourceRevisionRefs:this.core.currentSourceRevisionIds()};
    this.ownerLoreChannel.beginTurn({selection:ownerSelection,perspectiveConstraint});
    this.ownerMemoryChannel.beginTurn({selection:ownerSelection,perspectiveConstraint});

    const sequence=++this.turnSequence;
    this.runtimeDirector.beginGeneration({turnId:turn,correlationId:corr,generationId:generation});
    const published=this.core.publishGenerationContext({
      turnId:turn,turnRevision:sequence,correlationId:corr,query:q,intent,
      anchorEntityIds:uniq(anchorEntityIds),budgetBytes,deadline,precisionAvailable,
      activeThreads,channelIds,perspectiveConstraint,candidateBudget,latencyBudgetMs,graphTraversal,
    });
    const delivery=this.core.deliverGenerationContext({
      published,generationId,modelProfileId,budgetTokens,systemPolicy,userInput:q,
    });
    if(!delivery?.ok)throw new Error('NATIVE_BRAIN_DELIVERY_FAILED:'+String(delivery?.status??delivery?.failure?.code??'UNKNOWN'));
    const retrievalSkipped=(published.cognitiveChoiceReceipt?.skippedJobs??[]).includes('RETRIEVAL');
    if(retrievalSkipped){const reason=(published.cognitiveChoiceReceipt?.reasonCodes??[]).includes('HOT_SUFFICIENT')?'HOT_SUFFICIENT':'COGNITIVE_CHOICE_SKIPPED_RETRIEVAL';this.ownerLoreChannel.finalizeSkipped(reason);this.ownerMemoryChannel.finalizeSkipped(reason);}
    const channelReceipts=published.candidateEnvelope?.metadata?.channelReceipts??[];
    if(channelReceipts.some(row=>row.channelId===OWNER_KNOWLEDGE_CHANNELS.LORE&&row.status==='SKIPPED_LATENCY_BUDGET'))this.ownerLoreChannel.finalizeSkipped('LATENCY_BUDGET');
    if(channelReceipts.some(row=>row.channelId===OWNER_KNOWLEDGE_CHANNELS.MEMORY&&row.status==='SKIPPED_LATENCY_BUDGET'))this.ownerMemoryChannel.finalizeSkipped('LATENCY_BUDGET');
    const loreSync=this.#ownerRetrievalReceipt('LORE');
    const memorySync=this.#ownerRetrievalReceipt('MEMORY');

    const record={
      kind:'NativeBrainTurnRecord',turnId:turn,sequence,chatId:chat,generationId:generation,correlationId:corr,
      query:q,intent,executionLabel,sceneId:sceneState.sceneId,sceneRevision:sceneState.sceneRevision,
      worldRevision:published.worldRevision,sourceRevisionSet:this.core.currentSourceRevisionIds(),sceneSourceRevisionRefs:uniq(sceneState.sourceRevisionRefs??[]),
      perspectiveConstraint:clone(perspectiveConstraint),anchorEntityIds:uniq(anchorEntityIds),
      retrievalPolicy:{candidateBudget:Number(candidateBudget)||64,latencyBudgetMs:Number(latencyBudgetMs),graphTraversal:clone(graphTraversal)},
      published:clone(published),delivery:clone(delivery),loreSync:clone(loreSync),memorySync:clone(memorySync),response:null,experience:null,settlements:[],reflections:[],feedback:null,
      state:'SEALED_FOR_GENERATION',
    };
    this.#rememberTurn(record);
    this.#notify('TURN_PREPARED',record);
    return clone({
      kind:'NativeBrainPreparedTurn',executionLabel,selection:this.#selection(record),
      scene:sceneState,loreSync,memorySync,cognitiveChoice:published.cognitiveChoiceReceipt,
      candidateEnvelope:published.candidateEnvelope,truthAssessment:published.assessment,
      gatherReceipt:published.gatherReceipt,contextSealReceipt:published.sealReceipt,
      graphTraversalReceipt:published.graphTraversalReceipt??null,retrievalBudgetReceipt:published.retrievalBudgetReceipt??null,
      budgetDecision:delivery.plan?.diagnosticReceipt?.budgetDecision??null,
      promptPlan:delivery.plan,rendered:delivery.rendered,
      used:this.#usedWork(published),skipped:this.#skippedWork(published),
    });
  }

  async runTurn(input,{generate=null,completeOptions={}}={}){
    const prepared=await this.prepareTurn(input);
    if(typeof generate!=='function')return{prepared,response:null,learning:null};
    const raw=await generate(prepared.rendered,{
      selection:prepared.selection,promptPlan:prepared.promptPlan,contextSealReceipt:prepared.contextSealReceipt,
    });
    const response=typeof raw==='string'?raw:raw?.text??raw?.content;
    if(typeof response!=='string'||!response.trim())throw new TypeError('generation callback must return response text');
    const learning=await this.completeTurn({turnId:input.turnId,response,...completeOptions});
    return{prepared,response,learning};
  }

  async completeTurn({turnId,response,knownBy=[],observations=[],reflections=[],autoDrain=true}={}){
    const id=req(turnId,'turnId'),text=req(response,'response'),record=this.turns.get(id);
    if(!record)throw new Error('Unknown native Brain turn: '+id);
    if(record.state==='LEARNED')return clone(record.learningReceipt);

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
    const memoryWriteback=this.#writeBackMemoryEvidence(record,experience,{knownBy,exactContent:text});

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
    record.state='OBSERVED';
    this.runtimeDirector.completeGeneration({turnId:id,correlationId:record.correlationId,generationId:record.generationId});
    const task=this.#scheduleFeedback(id,experience.sourceRevisionId);
    if(autoDrain)await this.runtimeDirector.drain({maxCycles:128});
    const latest=this.turns.get(id);
    latest.state='LEARNED';
    latest.learningReceipt={
      kind:'NativeBrainLearningReceipt',turnId:id,experienceId:experience.evidenceId,sourceRevisionId:experience.sourceRevisionId,
      settlementDecisions:settlements.map(x=>x?.decision?.decision??'REJECTED'),
      reflectionEvidenceIds:reflectionRows.map(x=>x.evidenceId),
      feedback:clone(latest.feedback),runtimeTaskId:task?.task?.taskId??null,memoryWriteback:clone(memoryWriteback),memorySettlementReceipts:clone(memorySettlementReceipts),
      rawExperienceRecoverable:Boolean(this.core.registry.getRevision(experience.sourceRevisionId)?.exactContent===text),
      canonicalMutationAuthority:'CORE_SETTLEMENT_ONLY',
    };
    this.#notify('TURN_LEARNED',latest);
    return clone(latest.learningReceipt);
  }

  correctTurn({turnId,response,observations=[],knownBy=[]}={}){
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
    const settlements=observations.map((row,index)=>this.#settleObservation(record,corrected,row,index));
    const memorySettlementReceipts=this.#mirrorSettlementsToMemory(record,corrected,settlements);
    record.response=response;record.experience=clone(corrected);record.settlements=clone(settlements);record.state='LEARNED';
    this.#notify('TURN_CORRECTED',record);
    return{kind:'NativeBrainCorrectionReceipt',turnId:id,priorSourceRevisionId:prior.sourceRevisionId,sourceRevisionId:corrected.sourceRevisionId,invalidatedClaimIds,settlements,memoryWriteback,memorySettlementReceipts,historyPreserved:this.knowledge.history(prior.sourceId).length>1};
  }

  subscribe(listener){
    if(typeof listener!=='function')throw new TypeError('native Brain listener must be a function');
    this.listeners.add(listener);return()=>this.listeners.delete(listener);
  }

  uiBindings(){
    return Object.freeze({
      readSelection:({chatId}={})=>this.#selectionForChat(chatId),
      subscribe:(listener)=>this.subscribe(listener),
      readScene:(selection={})=>this.#readStage(selection,record=>this.core.sceneIntegrationSnapshot(record.chatId)),
      readHotCognition:(selection={})=>this.#readStage(selection,record=>this.core.hotCognitionSnapshot(record.chatId)),
      readCognitiveChoice:(selection={})=>this.#readStage(selection,record=>record.published?.cognitiveChoiceReceipt??null),
      readScatter:(selection={})=>this.#readStage(selection,record=>this.#uiScatterReceipt(record)),
      readSensoryTrace:(selection={})=>this.#readStage(selection,record=>record.published?.candidateEnvelope??null),
      readCandidateBusEnvelope:(selection={})=>this.#readStage(selection,record=>record.published?.candidateEnvelope??null),
      readCandidateFusionReceipt:(selection={})=>this.#readStage(selection,record=>record.published?.candidateEnvelope?.fusionReceipt??null),
      readIdentityResolution:(selection={})=>this.#readStage(selection,record=>({kind:'NativeBrainIdentityResolutionReadModel',...this.#selection(record),...this.core.entityIdentityReadModel(),authorityGranted:false})),
      readGraphTraversal:(selection={})=>this.#readStage(selection,record=>record.published?.graphTraversalReceipt??record.published?.candidateEnvelope?.metadata?.graphTraversalReceipt??null),
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
      readPromptPlan:(selection={})=>this.#readStage(selection,record=>record.delivery?.plan??null),
      readContextReceipt:(selection={})=>this.#readStage(selection,record=>this.#contextReceipt(record)),
      readSelectedTurnReceipt:(selection={})=>this.#readStage(selection,record=>this.#selectedTurnReceipt(record)),
      listGenerations:({limit=50,selection={}}={})=>this.#listGenerations({limit,selection}),
      readGeneration:({generationId,...selection}={})=>this.#readGeneration(generationId,selection),
    });
  }

  receiveCognitiveResult(result){
    return this.core.publication.receiveResult(result);
  }

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
      ownerEvidence:{retained:this.ownerEvidence.size,currentSourceRevisionRefs:this.core.externalCurrentSourceRevisionIds()},
      runtime:this.runtimeDirector.snapshot(),
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
      turns:[...this.turns.entries()],turnOrder:this.turnOrder,sceneSignals:[...this.sceneSignals.entries()],
      runtimeLedger:this.runtimePersistence.exportSnapshot(),runtimeResults:this.runtimeResults,
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
      provenance,owner:'WORLD_STATE',claimType:input.claimType??'FACT',slotPolicy:input.slotPolicy??'SINGLE',
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
      sourceRevisionRefs:[experience.sourceRevisionId],artifactRefs:settled.receipt.settledArtifactIds,
      provenanceRefs:[experience.sourceRevisionId],eventType:'STATE_SETTLED',
    });
    return clone({...settled,proposal,claimId,sourceRevisionId:experience.sourceRevisionId});
  }

  #scheduleFeedback(turnId,sourceRevisionId){
    const record=this.turns.get(String(turnId));if(!record)return null;
    return this.runtimeDirector.submit({
      taskType:'NATIVE_LEARNING_FEEDBACK',owner:'COGNITIVE_CORE',producerId:'NATIVE_BRAIN',
      layer:'L2',runtimeClass:'NEARLINE',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],
      dedupeKey:'native-feedback:'+turnId,foreground:false,sourceRevisionIds:[sourceRevisionId],
      worldRevision:this.core.graph.revision,sceneRevision:record.sceneRevision,
      payload:{turnId:String(turnId),correlationId:record.correlationId,resultClass:'DEFERRED'},
      batchHint:{maxSliceUnits:1},checkpointPolicy:{maxUnitsPerCheckpoint:1},
    },{
      units:[{id:'feedback:'+turnId,payload:{turnId:String(turnId)}}],
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
          const record=this.turns.get(String(item.turnId));if(!record)continue;
          if(!record.feedback)record.feedback=this.feedback.observeTurn({
            turnId:record.turnId,candidateEnvelope:record.published?.candidateEnvelope,
            publicationAssessment:record.published?.publicationAssessment,
            cognitiveChoiceReceipt:record.published?.cognitiveChoiceReceipt,packet:record.published?.packet,
          });
          receipts.push(clone(record.feedback));
        }
        return{output:receipts,validation:{valid:true},authorityGranted:false,canonicalMutation:false};
      },
    };
  }

  #attachRecoveredExecutors(){
    for(const record of this.runtimeDirector.ledger.list()){
      if(record.obligation?.taskType!=='NATIVE_LEARNING_FEEDBACK')continue;
      if(record.lifecycleStatus===LIFECYCLE_STATUS.SATISFIED)continue;
      try{this.runtimeDirector.attachExecutor(record.taskId,this.#feedbackExecutor());this.runtimeDirector.recoverTask(record.taskId);}catch{}
    }
  }

  #recordRuntimeResult(envelope){
    this.runtimeResults.push(clone(envelope));if(this.runtimeResults.length>128)this.runtimeResults.splice(0,this.runtimeResults.length-128);
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
    if(!record&&generationId)record=[...this.turns.values()].find(row=>row.generationId===generationId&&(!chatId||row.chatId===chatId))??null;
    if(!record&&chatId){for(let index=this.turnOrder.length-1;index>=0;index--){const row=this.turns.get(this.turnOrder[index]);if(row?.chatId===chatId){record=row;break;}}}
    if(!record)return null;
    if(chatId&&record.chatId!==chatId)return null;if(generationId&&record.generationId!==generationId)return null;
    if(selection?.correlationId!=null&&record.correlationId!==String(selection.correlationId))return null;
    if(selection?.sceneRevision!=null&&Number(record.sceneRevision)!==Number(selection.sceneRevision))return null;
    if(selection?.worldRevision!=null&&Number(record.worldRevision)!==Number(selection.worldRevision))return null;
    return record;
  }

  #readStage(selection,reader){const record=this.#recordForSelection(selection);if(!record)return null;const value=reader(record);return value==null?null:clone(value);}

  #listGenerations({limit=50,selection={}}={}){
    const max=Math.max(1,Math.min(200,Number(limit)||50)),chatId=selection?.chatId==null?null:String(selection.chatId);
    return this.turnOrder.slice().reverse().map(id=>this.turns.get(id)).filter(Boolean).filter(row=>!chatId||row.chatId===chatId).slice(0,max).map(row=>({kind:'NativeBrainGenerationSummary',...this.#selection(row),state:row.state,executionLabel:row.executionLabel,sealId:row.published?.sealReceipt?.id??null,promptPlanId:row.delivery?.plan?.promptPlanId??null}));
  }

  #readGeneration(generationId,selection={}){if(generationId==null)return null;const record=this.#recordForSelection({...selection,generationId});if(!record)return null;return clone({kind:'NativeBrainGenerationReadModel',...this.#selection(record),state:record.state,executionLabel:record.executionLabel,cognitiveChoice:record.published?.cognitiveChoiceReceipt??null,candidateEnvelope:record.published?.candidateEnvelope??null,identityResolution:this.core.entityIdentityReadModel(),graphTraversal:record.published?.graphTraversalReceipt??null,retrievalBudget:this.#uiRetrievalBudgetReceipt(record),rejectedEvidence:this.#uiRejectedEvidence(record),truth:record.published?.publicationAssessment??record.published?.assessment??null,gather:record.published?.gatherReceipt??null,contextSeal:record.published?.sealReceipt??null,promptPlan:record.delivery?.plan??null,loreSync:record.loreSync??null,memorySync:record.memorySync??null,learningReceipt:record.learningReceipt??null});}

  #notify(stage,record){
    if(!this.listeners.size||!record)return;const event=Object.freeze({kind:'NativeBrainReceiptUpdate',stage:String(stage),selection:this.#selection(record),rawPromptIncluded:false,rawResponseIncluded:false});
    for(const listener of [...this.listeners])try{listener(event);}catch{}
  }

  #selection(record){
    const ownerSourceRevisionRefs=uniq((record.sourceRevisionSet??[]).filter(ref=>!this.core.registry.getRevision(ref)));
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
    const selection=this.#selection(record),scene=this.core.sceneIntegrationSnapshot(record.chatId),hot=this.core.hotCognitionSnapshot(record.chatId);
    const choice=record.published?.cognitiveChoiceReceipt??null,gather=record.published?.gatherReceipt??null,seal=record.published?.sealReceipt??null,plan=record.delivery?.plan??null,context=this.#contextReceipt(record);
    const producer=(value,{id=null,reasonCodes=[]}={})=>({status:value?'PUBLISHED':'UNAVAILABLE',id:value?(id??value.receiptId??value.id??value.promptPlanId??value.kind??null):null,reasonCodes:uniq(reasonCodes).slice(0,16)});
    const deferred=(plan?.deferred??[]).slice(0,16).map(row=>({slot:row.slot??null,reason:row.reason??null,requiredTokens:row.requiredTokens??null,remainingTokensAtDecision:row.remainingTokensAtDecision??null,shortfallTokens:row.shortfallTokens??null}));
    const includedSlots=(context?.includedSections??[]).slice(0,32),selectedRefs=selection.sourceRevisionRefs.slice(0,128),sceneRefs=uniq(record.sceneSourceRevisionRefs??scene?.sourceRevisionRefs??[]).slice(0,32),sealRefs=uniq(seal?.sourceRevisionIds??[]).slice(0,128);
    return{
      kind:'NativeBrainSelectedTurnReceipt',contractVersion:1,...selection,
      sourceRevisions:{selectedCount:selection.sourceRevisionRefs.length,selectedRefs,sceneCount:sceneRefs.length,sceneRefs,sealCount:sealRefs.length,sealRefs,ownerCount:selection.ownerSourceRevisionRefs.length},
      producers:{
        scene:producer(scene,{id:scene?.lastReceiptId??scene?.sceneId??null}),
        hotCognition:producer(hot,{id:hot?.snapshotId??null}),
        cognitiveChoice:producer(choice,{id:choice?.receiptId??choice?.id??null,reasonCodes:choice?.reasonCodes??[]}),
        retrieval:producer(record.published?.candidateEnvelope,{id:record.published?.candidateEnvelope?.envelopeId??record.published?.candidateEnvelope?.id??null,reasonCodes:choice?.skippedJobs?.includes('RETRIEVAL')?(choice?.reasonCodes??[]):[]}),
        gather:producer(gather,{id:gather?.receiptId??gather?.kind??null}),
        contextSeal:producer(seal,{id:seal?.id??null}),
        promptPlan:producer(plan,{id:plan?.promptPlanId??null}),
        contextReceipt:producer(context,{id:context?.contextSealId??null}),
      },
      counts:{
        admittedJobs:(choice?.admittedJobs??[]).length,skippedJobs:(choice?.skippedJobs??[]).length,
        admittedResults:(gather?.admittedResultIds??[]).length,staleResults:(gather?.staleResultIds??[]).length,rejectedResults:(gather?.rejectedResultIds??[]).length,
        plannedSections:(plan?.sections??[]).length,includedSections:includedSlots.length,deferredSections:deferred.length,
      },
      delivery:{
        planned:plan?{state:'PLANNED',promptPlanId:plan.promptPlanId,contextSealId:plan.contextSealId,totalTokens:plan.budget?.allocated??null,budgetTotal:plan.budget?.total??null,budgetRemaining:plan.budget?.remaining??null,includedSlots,deferred}: {state:'UNAVAILABLE',reason:'PROMPT_PLAN_UNAVAILABLE'},
        compiled:context?{state:'COMPILED_AND_SEALED',contextSealId:context.contextSealId,packetId:context.packetId??null,packetHash:context.packetHash??null,includedSlots:[...(context.includedSections??[])].slice(0,32),deferred:[...(context.deferredSections??[])].slice(0,16)}:{state:'UNAVAILABLE',reason:'CONTEXT_RECEIPT_UNAVAILABLE'},
        hostObserved:{state:'UNAVAILABLE',reason:'HOST_OBSERVATION_OWNED_BY_SILLYTAVERN_BOUNDARY'},
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
    const choice=record.published?.cognitiveChoiceReceipt??{},jobs=(choice.admittedJobs??[]).map((jobId,index)=>({jobId:String(jobId),sequence:index+1,status:'EXECUTED',owner:'COGNITIVE_CORE'}));
    return{kind:'RuntimeTurnReceipt',...this.#selection(record),jobs,admittedJobCount:jobs.length,resourceCount:1,resourceIds:['native-brain-local-cpu'],requiredFallback:0,opportunisticPending:0,executionComplete:true,authorityGranted:false};
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
    const results=(record.published?.resultRoutes??[]).map((row)=>({resultId:row?.result?.id??null,accepted:Boolean(row?.route?.accepted),freshness:row?.route?.freshness??null,destination:row?.route?.effectiveDestination??row?.result?.destination??null}));
    return{...clone(receipt),...this.#selection(record),results};
  }

  #uiPrecisionReceipt(record){
    const results=record.published?.precisionResults??[];
    if(!results.length&&!record.published?.precisionFailed)return null;
    return{kind:'PrecisionReceipt',...this.#selection(record),results:clone(results),failed:Boolean(record.published?.precisionFailed),authorityGranted:false};
  }

  #memoryReadModel(record,selection={}){
    const read=this.memoryInterface?.readMemory??this.memoryInterface?.adapters?.readMemory;
    if(typeof read==='function'){
      try{const value=read({...this.#selection(record),...clone(selection)});if(value&&typeof value.then!=='function')return value;}catch{}
    }
    return{kind:'NativeBrainMemoryStatus',...this.#selection(record),sync:clone(record.memorySync??null),fallbackStore:this.memoryInterface?null:this.knowledge.diagnostics(),authorityGranted:false};
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
      return{kind:'NativeBrainMemoryWritebackReceipt',status:receipt?.status??'ADMITTED',ownerReceipt:clone(receipt??null),invalidation:clone(invalidation),sourceRevisionId:experience.sourceRevisionId,authorityGranted:false,canonicalMutationAuthority:false};
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
  }
}
