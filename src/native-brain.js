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
  }={}){
    this.maxTurns=Math.max(16,Number(maxTurns)||256);
    this.core=new Area52CognitiveCore();

    if(snapshot?.core?.sourceRegistry)this.core.registry.restoreState(snapshot.core.sourceRegistry);
    if(snapshot?.core?.temporalState)this.core.graph.restoreState(snapshot.core.temporalState);
    if(snapshot?.core?.hotCognition)this.core.hotCognition.restoreState(snapshot.core.hotCognition,{
      activeSourceRevisionRefs:this.core.registry.activeRevisionIds(),
      worldRevision:this.core.graph.revision,
    });
    if(snapshot?.core?.contextSeal)this.core.publication.seal.restoreState(snapshot.core.contextSeal);

    this.feedback=new NativeLearningFeedback({snapshot:snapshot?.feedback??null});
    this.knowledge=new NativeKnowledgeStore({registry:this.core.registry,snapshot:snapshot?.knowledge??null});
    this.core.registerExternalKnowledgeResolver((candidate)=>this.knowledge.evidenceForCandidate(candidate));
    this.#registerKnowledgeChannels();

    this.turns=new Map(clone(snapshot?.turns??[]));
    this.turnOrder=clone(snapshot?.turnOrder??[]);
    this.sceneSignals=new Map(clone(snapshot?.sceneSignals??[]));
    this.turnSequence=Number(snapshot?.turnSequence??0);
    this.runtimeResults=clone(snapshot?.runtimeResults??[]).slice(-128);

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
    for(const id of ['NATIVE_LORE','NATIVE_MEMORY'])this.core.retrieval.unregisterChannel(id);
    this.core.registerRetrievalChannel(this.knowledge.channel('LORE',{channelId:'NATIVE_LORE',rankBias:(id)=>this.feedback.biasFor(id)}));
    this.core.registerRetrievalChannel(this.knowledge.channel('MEMORY',{channelId:'NATIVE_MEMORY',rankBias:(id)=>this.feedback.biasFor(id)}));
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
    this.core.hotCognition.invalidateKnowledge({
      updateId:'native-lore-corrected:'+prior.sourceRevisionId+'->'+row.sourceRevisionId,
      invalidatedSourceRevisionRefs:[prior.sourceRevisionId],
      reason:'LORE_SOURCE_CORRECTED',
    });
    return{prior,row};
  }

  removeLore(sourceId,{reason='LORE_SOURCE_REMOVED'}={}){
    const prior=this.knowledge.currentRecordForSource(sourceId);
    const receipt=this.knowledge.removeSource(sourceId,{reason});
    if(prior)this.core.hotCognition.invalidateKnowledge({
      updateId:'native-lore-removed:'+prior.sourceRevisionId,
      invalidatedSourceRevisionRefs:[prior.sourceRevisionId],
      reason,
    });
    return receipt;
  }

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
    executionLabel='LIVE_HOST',
  }={}){
    const chat=req(chatId,'chatId'),turn=req(turnId,'turnId'),generation=req(generationId,'generationId'),q=req(query,'query');
    const corr=correlationId??('corr:'+turn);
    this.core.activateHotCognitionChat(chat,{reason:'TURN_RECEIVED'});
    if(sceneSignal||scene)this.observeScene(chat,sceneSignal??scene);
    const sceneState=this.core.sceneIntegrationSnapshot(chat);
    if(!sceneState?.sceneId)throw new Error('NATIVE_BRAIN_SCENE_REQUIRED: active Scene owner state is required before generation');

    const sequence=++this.turnSequence;
    this.runtimeDirector.beginGeneration({turnId:turn,correlationId:corr,generationId:generation});
    const published=this.core.publishGenerationContext({
      turnId:turn,turnRevision:sequence,correlationId:corr,query:q,intent,
      anchorEntityIds:uniq(anchorEntityIds),budgetBytes,deadline,precisionAvailable,
      activeThreads,channelIds,perspectiveConstraint,
    });
    const delivery=this.core.deliverGenerationContext({
      published,generationId,modelProfileId,budgetTokens,systemPolicy,userInput:q,
    });
    if(!delivery?.ok)throw new Error('NATIVE_BRAIN_DELIVERY_FAILED:'+String(delivery?.status??delivery?.failure?.code??'UNKNOWN'));

    const record={
      kind:'NativeBrainTurnRecord',turnId:turn,sequence,chatId:chat,generationId:generation,correlationId:corr,
      query:q,intent,executionLabel,sceneId:sceneState.sceneId,sceneRevision:sceneState.sceneRevision,
      worldRevision:published.worldRevision,sourceRevisionSet:this.core.registry.activeRevisionIds(),
      perspectiveConstraint:clone(perspectiveConstraint),anchorEntityIds:uniq(anchorEntityIds),
      published:clone(published),delivery:clone(delivery),response:null,experience:null,settlements:[],reflections:[],feedback:null,
      state:'SEALED_FOR_GENERATION',
    };
    this.#rememberTurn(record);
    return clone({
      kind:'NativeBrainPreparedTurn',executionLabel,selection:this.#selection(record),
      scene:sceneState,cognitiveChoice:published.cognitiveChoiceReceipt,
      candidateEnvelope:published.candidateEnvelope,truthAssessment:published.assessment,
      gatherReceipt:published.gatherReceipt,contextSealReceipt:published.sealReceipt,
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

    const settlements=[];
    for(let index=0;index<observations.length;index++)settlements.push(this.#settleObservation(record,experience,observations[index],index));
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
      feedback:clone(latest.feedback),runtimeTaskId:task?.task?.taskId??null,
      rawExperienceRecoverable:Boolean(this.core.registry.getRevision(experience.sourceRevisionId)?.exactContent===text),
      canonicalMutationAuthority:'CORE_SETTLEMENT_ONLY',
    };
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
    const settlements=observations.map((row,index)=>this.#settleObservation(record,corrected,row,index));
    record.response=response;record.experience=clone(corrected);record.settlements=clone(settlements);record.state='LEARNED';
    return{kind:'NativeBrainCorrectionReceipt',turnId:id,priorSourceRevisionId:prior.sourceRevisionId,sourceRevisionId:corrected.sourceRevisionId,invalidatedClaimIds,settlements,historyPreserved:this.knowledge.history(prior.sourceId).length>1};
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
      world:this.core.currentWorldModel(),sensory:this.core.sensoryDiagnostics(),
      knowledge:this.knowledge.diagnostics(),feedback:this.feedback.diagnostics(),
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
        hotCognition:this.core.hotCognition.exportState(),
        contextSeal:this.core.publication.seal.exportState(),
      },
      knowledge:this.knowledge.exportState(),feedback:this.feedback.exportState(),
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
    return clone({...settled,claimId,sourceRevisionId:experience.sourceRevisionId});
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

  #selection(record){
    return{chatId:record.chatId,turnId:record.turnId,generationId:record.generationId,correlationId:record.correlationId,sceneId:record.sceneId,sceneRevision:record.sceneRevision,worldRevision:record.worldRevision,sourceRevisionRefs:[...record.sourceRevisionSet]};
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
