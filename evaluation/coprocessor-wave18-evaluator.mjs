import {
  Capability,
  CapabilityProfileRegistry,
  DeterministicProviderAdapter,
  GreenRoomStore,
  JevDecisionCore,
  JevProviderExecutor,
  NativeHotDeepScheduler,
  Placement,
  ProviderAdapterRegistry,
  ResultClass,
  SpeculativeWarmCoordinator,
  createCoprocessorResourceHost,
  createDefaultJevDomainAdapterRegistry,
  createJevDomainAdapterMatrix,
  createMemoryConsolidationDeepWork,
  createNativeCoprocessorServices,
  createNativeTurnTask,
  createWave18CoprocessorReadModel,
  executeNativeTurn,
  admitGreenRoomBatchToMemoryOwner,
  requestJevOwnerReview,
} from '../src/coprocessor/index.js';

export async function evaluateCoprocessorWave18(){
  let clock=1000;
  const now=()=>clock;
  const tick=(ms)=>{clock+=ms;};

  const native=createNativeCoprocessorServices();
  const nativeTurn=executeNativeTurn({
    task:createNativeTurnTask({turnId:'story-a:quiet',sourceRevisionSet:['story-a:1'],sceneRevision:1}),
    candidates:[{optionId:'NATIVE_CONTINUE',evidenceRefs:['story-a:1']}],
  });

  const scheduler=new NativeHotDeepScheduler({resourceSlots:1,foregroundReserve:1,now});
  const quietPlacement=scheduler.classify({placement:Placement.HOT,resultClass:ResultClass.OPPORTUNISTIC},{expectedValue:.1,minimumExpectedValue:.5});
  const fastPlacement=scheduler.classify({placement:Placement.HOT,resultClass:ResultClass.REQUIRED},{expectedValue:1,minimumExpectedValue:.5});
  const deepPlacement=scheduler.classify({placement:Placement.DEEP,resultClass:ResultClass.DEFERRED},{expectedValue:.9,minimumExpectedValue:.5});

  const warmer=new SpeculativeWarmCoordinator({
    clock:now,
    adapters:{
      providerMode:'LOCAL_DETERMINISTIC',
      retrieve:async({intentSlice,recommendation})=>{
        tick(4);
        return{status:'OK',candidateRefs:intentSlice.map(x=>x.ref),evidenceRefs:recommendation.evidenceRefs,receipt:{status:'OK',count:intentSlice.length}};
      },
      evaluateQuality:async(refs)=>{tick(1);return{status:'OK',quality:refs.candidateRefs.length?'HIGH':'LOW'};},
      truthCheck:async()=>{tick(1);return{status:'VERIFIED',conflictState:'RESOLVED'};},
      precisionRank:async()=>{tick(1);return{status:'RANKED'};},
      compile:async({identity})=>{tick(2);return{compiledRef:{
        kind:'ArtifactReference',artifactId:'compiled:story-a:market',artifactType:'CompiledContextCandidate',owner:'CORE',
        revision:1,storageDomain:'compiled',sourceRevisionSet:[...identity.sourceRevisionSet],
        worldRevision:identity.worldRevision,sceneRevision:identity.sceneRevision,
      }};},
    },
  });
  const identityA={
    chatId:'chat:story-a',sceneRevision:2,worldRevision:5,characterStateRevision:3,
    sourceRevisionSet:['story-a:scene:2'],intentFingerprint:'story-a:next-market',retrievalPolicyRevision:'r1',
  };
  const recA={
    kind:'PrefetchRecommendation',recommendationId:'prefetch:story-a:market',sceneId:'scene:market',sceneRevision:2,
    trigger:'LIKELY_NEXT_LOCATION',entityRefs:['char:Ari'],locationRefs:['loc:market'],threadRefs:['thread:map'],sceneRefs:['scene:market'],
    priority:'NORMAL',expiryRevision:4,evidenceRefs:['ev:road-sign'],sourceRevisionRefs:['story-a:scene:2'],sourceRevisionSet:['story-a:scene:2'],
    authority:'NONE',status:'ACTIVE',
  };
  const preparedA=await warmer.prepare({recommendation:recA,identity:identityA,turnSequence:10,context:{targetTurnId:'story-a:turn:10'}});
  const reuseCandidate=warmer.consumeForSend({identity:identityA,turnSequence:10,turnId:'story-a:turn:10'});
  const reuse=warmer.recordCoreRevalidation({consumptionId:reuseCandidate.consumptionId,accepted:true});

  const divergent=warmer.consumeForSend({
    identity:{...identityA,sceneRevision:3,sourceRevisionSet:['story-a:scene:3']},
    turnSequence:11,turnId:'story-a:turn:11',
  });

  warmer.onForegroundStart({turnId:'story-a:turn:12'});
  const queued=warmer.enqueuePreparation({
    recommendation:{...recA,recommendationId:'prefetch:story-a:old-branch'},
    identity:{...identityA,intentFingerprint:'story-a:old-branch'},turnSequence:12,
  });
  const cancelled=warmer.invalidateActiveWork({
    currentIdentity:{...identityA,sceneRevision:4,sourceRevisionSet:['story-a:scene:4'],intentFingerprint:'story-a:new-branch'},
    reason:'FAST_SCENE_CHANGE',
  });
  warmer.onForegroundEnd();
  const cancelledResult=await queued.promise;

  const greenRoom=new GreenRoomStore({defaultTtlTurns:2});
  greenRoom.putBatch({
    sceneRevision:9,
    characters:[
      {characterRef:'Nia',evidenceRefs:['harbor:nia:dialogue'],sourceRevisionSet:['story-b:scene:9'],confidence:.78,dimensions:{guardedness:.7,latentIntent:'protect the dock',uncertainty:.25}},
      {characterRef:'Corin',evidenceRefs:['harbor:corin:gesture'],sourceRevisionSet:['story-b:scene:9'],confidence:.66,dimensions:{anxiety:.6,attentionTarget:'Nia',uncertainty:.34}},
    ],
  },{turnSequence:30,activeCharacterRefs:['Nia','Corin']});
  const greenBatch={kind:'GreenRoomBatch',sceneRevision:9,characters:greenRoom.active({sceneRevision:9,turnSequence:30})};
  const greenOwner=admitGreenRoomBatchToMemoryOwner({
    batch:greenBatch,
    memoryOwner:{acceptGreenRoomBatch(batch){return{kind:'MemoryGreenRoomBatchReceipt',accepted:batch.characters.map(x=>x.characterRef),sceneRevision:batch.sceneRevision,activeCount:batch.characters.length,authority:'INFERRED'};}},
    turnSequence:30,
  });
  const missingGreenOwner=admitGreenRoomBatchToMemoryOwner({batch:greenBatch,memoryOwner:null,turnSequence:30});

  let consolidationRuns=0;
  const memoryOwner={
    startConsolidation(jobs){return{id:'memory:story-b:long',checkpoint:{cursor:0},jobCount:jobs.length};},
    consolidationWorkUnits(sessionId){return[{kind:'MemoryConsolidationWorkUnit',contractVersion:'1.0.0',workUnitId:'unit:1',sessionId,cursor:0,jobType:'LONG_CONVERSATION',inputRevisionFence:{sourceRevisionRefs:['story-b:turns:1-300']},generationFence:{generationId:'story-b:g30'}}];},
    runConsolidation(){
      consolidationRuns+=1;
      tick(12);
      if(consolidationRuns===1)return{state:'CHECKPOINTED',checkpoint:{cursor:1},publishedArtifactIds:[]};
      return{state:'COMPLETED',checkpoint:{cursor:2},publishedArtifactIds:['memory:proposal:story-b:1']};
    },
  };
  const deepFactory=createMemoryConsolidationDeepWork({
    memoryOwner,jobs:[{jobId:'story-b:300-turn-window',sourceRevisionRefs:['story-b:turns:1-300']}],
    options:{reason:'LONG_CONVERSATION'},
  });
  scheduler.enqueueDeep(deepFactory.work);
  scheduler.beginForeground({workId:'story-b:foreground'});
  const yielded=await scheduler.runDeepSlice(deepFactory.work.workId,{context:{sealed:false}});
  scheduler.endForeground({workId:'story-b:foreground'});
  tick(3);
  const firstDeep=await scheduler.runDeepSlice(deepFactory.work.workId,{context:{sealed:false}});
  tick(2);
  const finalDeep=await scheduler.runDeepSlice(deepFactory.work.workId,{context:{sealed:false}});

  const jevProvider=createLocalJevProvider();
  const matrix=createJevDomainAdapterMatrix({core:new JevDecisionCore({providerExecutor:jevProvider})});

  const memDet=memoryInput('mem:det',{deterministicOutcome:'KNOWN'});
  const memDetProposal=await matrix.service.adjudicate(memDet,{currentRevisionState:currentFor(memDet)});

  const memAmb=memoryInput('mem:abstain');
  const memAbstain=await matrix.service.adjudicate(memAmb,{currentRevisionState:currentFor(memAmb)});
  const memOwnerReview=await requestJevOwnerReview({proposal:memAbstain,ownerReview:async()=>({decision:'UNRESOLVED',reasonCode:'OWNER_PRESERVES_AMBIGUITY'})});

  const temporal=temporalInput('time:conflict');
  const temporalProposal=await matrix.service.adjudicate(temporal,{currentRevisionState:currentFor(temporal)});
  const temporalOwnerReview=await requestJevOwnerReview({proposal:temporalProposal,ownerReview:async()=>({decision:'ACCEPTED',reasonCode:'TEMPORALLY_DISTINCT_SUPPORTED',settlementPerformed:false,canonicalMutation:false})});

  const late=temporalInput('time:late');
  const lateProposal=await matrix.service.adjudicate(late,{currentRevisionState:currentFor(late),sealed:true});
  const lateOwnerReview=await requestJevOwnerReview({proposal:lateProposal,ownerReview:async(proposal)=>({
    decision:proposal.details?.late?'REJECTED':'DEFERRED',reasonCode:proposal.details?.late?'POST_SEAL_NOT_FOREGROUND':'DEFERRED',
    settlementPerformed:false,canonicalMutation:false,
  })});

  const schedulerRead=scheduler.readModel();
  const readModel=createWave18CoprocessorReadModel({
    scheduler,warmer,greenRoom,consolidation:[finalDeep],
    ownerReceipts:[greenOwner,missingGreenOwner,memOwnerReview,temporalOwnerReview,lateOwnerReview],
    jevService:matrix.service,
  });

  const host=createCoprocessorResourceHost();
  return deepFreeze({
    kind:'CoprocessorWave18Evaluation',
    evidenceClass:'LOCAL_DETERMINISTIC',
    stories:[
      {
        storyId:'story-a-ember-road',
        quietTurn:{nativeOutcome:nativeTurn.outcome,optionalResourceCount:native.inventory.optional.length,placement:quietPlacement.decision},
        fastSceneChange:{placement:fastPlacement.decision,discardStatus:divergent.status,discardFreshness:divergent.freshness,cancelledPreparations:cancelled,cancelledStatus:cancelledResult.status},
        likelyNextLocation:{prepareStatus:preparedA.status,reuseCandidateStatus:reuseCandidate.status,ownerRevalidatedStatus:reuse.status,avoidedWork:reuse.avoidedWork},
      },
      {
        storyId:'story-b-harbor-siege',
        multiCharacter:{proposalCount:greenBatch.characters.length,ownerStatus:greenOwner.status,missingOwnerStatus:missingGreenOwner.status,authority:'INFERRED'},
        longConversation:{placement:deepPlacement.decision,yieldedStatus:yielded.status,firstStatus:firstDeep.status,finalStatus:finalDeep.status,ownerAccepted:finalDeep.ownerAccepted},
      },
    ],
    measurements:{
      prefetch:pick(warmer.metrics(),['totalQueueTimeMs','totalExecutionTimeMs','totalForegroundYieldWaitMs','usefulFreshHits','staleDiscards','invalidDiscards','preparationsCancelled','falseWarmHits']),
      scheduler:pick(schedulerRead.metrics,['totalHotQueueMs','totalHotExecutionMs','totalDeepQueueMs','totalDeepExecutionMs','foregroundBlockedMs','deepYields','deepResumes','deepCompleted']),
    },
    jev:{
      deterministicMemory:{path:memDetProposal.path,outcome:memDetProposal.proposedOutcome},
      uncertainMemory:{abstained:memAbstain.abstained,outcome:memAbstain.proposedOutcome,ownerDecision:memOwnerReview.ownerDecision},
      conflictingTemporal:{outcome:temporalProposal.proposedOutcome,ownerDecision:temporalOwnerReview.ownerDecision},
      postSeal:{late:Boolean(lateProposal.details?.late),foregroundEligible:Boolean(lateProposal.details?.foregroundEligible),ownerDecision:lateOwnerReview.ownerDecision},
    },
    nativeFallback:{
      zeroOptionalResources:native.inventory.optional.length===0,
      nativeOutcome:nativeTurn.outcome,
      resourceHostResourceCount:host.read.resources().resources.length,
      externalDatabaseRequired:false,orchestrationServiceRequired:false,
    },
    readModel,
    live:{
      classification:'MEASURED_LIVE',
      externalProviderObserved:false,
      status:'REQUIRES_OPERATOR_CONFIGURED_PROVIDER',
      costMeasured:false,
      usefulnessMeasured:false,
    },
  });
}

function createLocalJevProvider(){
  const profiles=new CapabilityProfileRegistry();
  profiles.register({
    profileId:'wave18-jev-profile',workerId:'wave18-local',providerId:'wave18-local-provider',modelId:'fixture',
    capabilities:[Capability.SEMANTIC_JUDGMENT,Capability.PROPOSAL_REVIEW,Capability.CONFLICT_INTERPRETATION],
    foregroundEligible:true,backgroundEligible:true,placements:[Placement.HOT,Placement.DEEP],
    supportedLayers:['L1','L2','L3','L4'],maxContextTokens:200000,maxOutputTokens:4000,
  });
  const adapters=new ProviderAdapterRegistry();
  adapters.register(new DeterministicProviderAdapter({
    providerId:'wave18-local-provider',modelId:'fixture',capabilities:[Capability.SEMANTIC_JUDGMENT],
    handlers:{JEV_DECISION:({input})=>{
      const type=input.data.decisionType;
      if(type==='MEMORY_KNOWLEDGE_BELIEF_CLASSIFICATION')return{payload:jevOutput({outcome:'ABSTAINED',decisionCode:'ABSTAIN',abstained:true,evidenceUsed:[],confidence:0})};
      if(type==='TEMPORAL_TRANSITION_CONTRADICTION')return{payload:jevOutput({selected:['TEMPORALLY_DISTINCT'],rejected:['TRANSITION','CONTRADICTION','UNRESOLVED'],evidenceUsed:['time:a','time:b']})};
      return{payload:jevOutput({outcome:'UNRESOLVED',decisionCode:'UNRESOLVED',confidence:.2})};
    }},
  }));
  return new JevProviderExecutor({profiles,adapters});
}

function memoryInput(id,{deterministicOutcome=null}={}){
  return{
    domain:'MEMORY',decisionKind:'MEMORY_KNOWLEDGE_BELIEF_CLASSIFICATION',decisionId:id,turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,
    owner:'MEMORY_OWNER',characterRef:'Nia',sourceRevisionSet:['mem:src:1'],worldRevision:5,sceneRevision:9,characterStateRevision:4,
    memoryRevision:12,ownerRevision:7,freshnessToken:'fresh:'+id,deadline:10000,softDeadline:9000,deterministicOutcome,
    options:[
      {optionId:'KNOWN',evidenceRefs:['mem:a']},{optionId:'UNCERTAIN',evidenceRefs:['mem:a','mem:b']},{optionId:'UNRESOLVED',evidenceRefs:['mem:b']},
    ],
    evidence:[
      {evidenceId:'mem:a',summary:'Nia heard the warning directly.',metadata:{knownBy:['Nia']},provenanceRefs:['story-b:dialogue']},
      {evidenceId:'mem:b',summary:'Later hearsay conflicts with the warning.',metadata:{knownBy:['Nia']},provenanceRefs:['story-b:rumor']},
    ],
    provenanceRefs:['story-b:dialogue','story-b:rumor'],
    routing:{expectedDecisionValue:.9,latencyPenalty:0,costPenalty:0,uncertaintyPenalty:0,authorityRisk:0,minimumInvocationValue:.2},
  };
}

function temporalInput(id){
  return{
    domain:'TEMPORAL',decisionKind:'TEMPORAL_TRANSITION_CONTRADICTION',decisionId:id,turnId:'turn:'+id,taskId:'task:'+id,correlationId:'corr:'+id,
    owner:'TEMPORAL_OWNER',sourceRevisionSet:['time:src:1'],worldRevision:5,sceneRevision:9,characterStateRevision:4,
    temporalRevision:8,ownerRevision:7,freshnessToken:'fresh:'+id,deadline:10000,softDeadline:9000,
    options:[
      {optionId:'TRANSITION',evidenceRefs:['time:a']},{optionId:'CONTRADICTION',evidenceRefs:['time:a','time:b']},
      {optionId:'TEMPORALLY_DISTINCT',evidenceRefs:['time:a','time:b']},{optionId:'UNRESOLVED',evidenceRefs:['time:b']},
    ],
    evidence:[
      {evidenceId:'time:a',summary:'The harbor gate was closed before dusk.',provenanceRefs:['story-b:turn:120']},
      {evidenceId:'time:b',summary:'The gate is open after the alarm.',provenanceRefs:['story-b:turn:180']},
    ],
    provenanceRefs:['story-b:turn:120','story-b:turn:180'],
    routing:{expectedDecisionValue:.9,latencyPenalty:0,costPenalty:0,uncertaintyPenalty:0,authorityRisk:0,minimumInvocationValue:.2},
  };
}

function currentFor(input){
  return{
    sourceRevisionSet:[...input.sourceRevisionSet],worldRevision:input.worldRevision,sceneRevision:input.sceneRevision,
    characterStateRevision:input.characterStateRevision,freshnessToken:input.freshnessToken,
    domainRevisions:input.domain==='MEMORY'
      ?{memory:input.memoryRevision,owner:input.ownerRevision}
      :{temporal:input.temporalRevision,owner:input.ownerRevision},
  };
}
function jevOutput({selected=[],rejected=[],evidenceUsed=[],outcome='DECIDED',decisionCode='CHOOSE_ONE',confidence=.8,abstained=false}={}){
  return{outcome,decisionCode,selectedOptionIds:selected,rejectedOptionIds:rejected,classification:null,reasonCodes:['LOCAL_DETERMINISTIC'],evidenceUsed,
    unresolvedFactors:outcome==='UNRESOLVED'?['bounded ambiguity']:[],confidence,abstained,escalationTarget:null,requiresOperator:false,explanation:'bounded deterministic fixture'};
}
function pick(value,keys){return Object.fromEntries(keys.map(k=>[k,value[k]]));}
function deepFreeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);return value;}
