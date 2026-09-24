const clone=(v)=>v==null?v:structuredClone(v);
const sourceRefs=['lore:ember@6','scene:ember@19','memory:ember@12'];

function functionDecision(capability,disposition,reasonCode,extra={}){
  return{kind:'CognitiveFunctionDecision',capability,disposition,reasonCode,expectedValue:extra.expectedValue??(disposition==='ADMITTED'?.9:.2),resourceCost:extra.resourceCost??{units:1},freshnessRequirement:extra.freshnessRequirement??'TURN_CURRENT',deadlineClass:extra.deadlineClass??(disposition==='DEFERRED'?'DEFERRED':'FOREGROUND_OPPORTUNISTIC'),requiredCapabilities:extra.requiredCapabilities??[],channelIds:extra.channelIds??[],metadata:{}};
}
function baseSelection({chatId='chat:ember',turnId='turn:418',generationId='gen:418',correlationId='corr:418',worldRevision=52,sceneRevision=19,sourceRevisionRefs:refs=sourceRefs}={}){
  return{chatId,turnId,generationId,correlationId,worldRevision,sceneRevision,sourceRevisionRefs:[...refs]};
}
function scene(s){return{kind:'SceneUiReadModel',sceneId:'scene:ember',revision:s.sceneRevision,lifecycle:'ACTIVE',location:{value:{name:'Ember Tavern'},authority:'OBSERVED'},narrativeTime:{value:'evening'},activeCast:['Mara','Eris'],objects:[{objectRef:'Sun Blade',state:'UNKNOWN',observationClass:'UNRESOLVED'}],activeThreads:['blade-fate'],uncertainFields:['Sun Blade fate'],provenanceRefs:['scene:ember'],health:{state:'READY',reasons:[]},chatId:s.chatId,turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId,worldRevision:s.worldRevision,sourceRevisionRefs:s.sourceRevisionRefs};}
function hot(s){return{kind:'HotCognitionReadModel',contractVersion:'1.0.0',snapshotId:'hot:'+s.turnId,stateId:'hot-state:ember',chatNamespace:s.chatId,hotRevision:21,sceneId:'scene:ember',sceneRevision:s.sceneRevision,worldRevision:s.worldRevision,locationSummary:'Ember Tavern',activeCastSummary:['Mara','Eris'],activeThreadSummary:['blade-fate'],segmentFreshness:{SCENE:'FRESH',LOCATION:'FRESH',ACTIVE_CAST:'FRESH',ACTIVE_THREADS:'FRESH'},sourceRevisionRefs:s.sourceRevisionRefs,turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId};}
function lore(s){return{kind:'LoreStatusReadModel',sourceEntryCount:5,learnedRepresentationCount:11,learnedState:'READY',indexState:'READY',lastRevision:'lore:ember@6',sourceRevisionRefs:['lore:ember@6'],provenanceRefs:['lorebook:ember'],turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId};}
function choice(s,scenario){
  const hotOnly=scenario==='hot';
  const ambiguous=scenario==='ambiguous';
  const decisions=hotOnly?[
    functionDecision('HOT_CONTEXT','ADMITTED','HOT_SUFFICIENT',{expectedValue:1}),
    functionDecision('RETRIEVAL','SKIPPED','HOT_SUFFICIENT'),
    functionDecision('TRUTH','SKIPPED','HOT_SUFFICIENT'),
    functionDecision('JEV','SKIPPED','JEV_NOT_REQUIRED'),
    functionDecision('PRECISION','SKIPPED','PRECISION_NOT_REQUIRED'),
    functionDecision('CONTEXT_COMPILER','ADMITTED','FOREGROUND_REQUIRED'),
    functionDecision('CONTEXT_SEAL','ADMITTED','FOREGROUND_REQUIRED'),
  ]:[
    functionDecision('RETRIEVAL','ADMITTED','RETRIEVAL_REQUIRED',{channelIds:['CORE_SPARSE','CORE_DENSE','CORE_TEMPORAL']}),
    functionDecision('HISTORIAN','ADMITTED','HISTORICAL_SUPPORT_REQUIRED'),
    functionDecision('GRAPH_WALKER','ADMITTED','RELATIONSHIP_EVIDENCE_REQUIRED'),
    functionDecision('GREEN_ROOM','SKIPPED','LOW_EXPECTED_VALUE'),
    functionDecision('TRUTH','ADMITTED','RETRIEVAL_REQUIRED'),
    functionDecision('JEV',ambiguous?'ADMITTED':'SKIPPED',ambiguous?'JEV_REQUIRED':'JEV_NOT_REQUIRED'),
    functionDecision('PRECISION','ADMITTED','PRECISION_REQUIRED'),
    functionDecision('GATHER','ADMITTED','FOREGROUND_REQUIRED'),
    functionDecision('EXTERNAL_GROUNDING','DEFERRED','DEFER_BACKGROUND',{deadlineClass:'DEFERRED'}),
  ];
  return{kind:'CognitiveChoiceReceipt',contractVersion:'1.0.0',id:'choice:'+s.turnId,turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId,receiptRevision:1,status:'COMPLETE',
    paths:hotOnly?['HOT_ONLY']:[ambiguous?'BOUNDED_AMBIGUITY':'STANDARD_RETRIEVAL'],functionDecisions:decisions,
    admittedJobs:decisions.filter(x=>x.disposition==='ADMITTED').map(x=>x.capability),skippedJobs:decisions.filter(x=>x.disposition==='SKIPPED').map(x=>x.capability),deferredJobs:decisions.filter(x=>x.disposition==='DEFERRED').map(x=>x.capability),
    consideredCognitionOptions:decisions.map(x=>x.capability),reasonCodes:[hotOnly?'HOT_SUFFICIENT':'RETRIEVAL_REQUIRED'],retrievalIntents:hotOnly?[]:['intent:blade-fate'],
    sensoryChannelsRequested:hotOnly?[]:['CORE_SPARSE','CORE_DENSE','CORE_TEMPORAL'],sensoryChannelsUsed:hotOnly?[]:['CORE_SPARSE','CORE_DENSE','CORE_TEMPORAL'],
    candidateCounts:hotOnly?{nominated:0,normalized:0,deduplicated:0,truthAdmitted:0,precisionAdmitted:0,finalGenerationFacing:3}:{nominated:18,normalized:18,deduplicated:7,truthAdmitted:5,precisionAdmitted:5,finalGenerationFacing:5},
    retrievalQuality:hotOnly?null:ambiguous?'MIXED':'HIGH',correctiveRetrieval:hotOnly?{requested:false,executed:false,correctionCount:0,maxCorrections:1}:{requested:ambiguous,executed:ambiguous,correctionCount:ambiguous?1:0,maxCorrections:1},
    truthGate:{considered:!hotOnly,invoked:!hotOnly,skipped:hotOnly,outcomeCounts:ambiguous?{CURRENT:3,HISTORICAL:1,UNRESOLVED:1}:{CURRENT:5,HISTORICAL:1,UNRESOLVED:0}},
    jev:hotOnly?{considered:true,invoked:false,skipped:true,unavailable:false,abstained:false,action:'SKIP_JEV',reason:'JEV_NOT_REQUIRED'}:ambiguous?{considered:true,invoked:true,skipped:false,unavailable:false,abstained:true,action:'JEV_ABSTAINED',reason:'JEV_ABSTAINED',resultRef:'jev:418'}:{considered:true,invoked:false,skipped:true,unavailable:false,abstained:false,action:'SKIP_JEV',reason:'JEV_NOT_REQUIRED'},
    precision:hotOnly?{considered:true,invoked:false,skipped:true,required:false,available:true,reason:'PRECISION_NOT_REQUIRED'}:{considered:true,invoked:true,skipped:false,required:true,available:true,reason:'PRECISION_REQUIRED',resultCount:5},
    finalEvidenceRefs:hotOnly?['scene:ember','hot:location','hot:cast']:['claim:tavern-destroyed','claim:blade-history','claim:blade-fate'],
    measurements:hotOnly?{avoidedJobs:6,avoidedChannelCalls:3,channelInvocations:0,optionalProviderCalls:0,executionResources:1,elapsedMs:4}:{avoidedJobs:2,avoidedChannelCalls:1,channelInvocations:3,optionalProviderCalls:0,executionResources:1,elapsedMs:31},
    revisions:{turnRevision:1,worldRevision:s.worldRevision,sceneRevision:s.sceneRevision,sourceRevisionRefs:s.sourceRevisionRefs},freshness:{candidateSet:hotOnly?'UNKNOWN':'FRESH'},seal:{sealed:true,sealReceiptId:'seal:'+s.turnId},metadata:{chatId:s.chatId}};
}
function scatter(s,resourceCount=1){
  const capabilities=['Historian','Graph Walker','Truth','Precision'];
  return{kind:'RuntimeScatterReceipt',receiptId:'scatter:'+s.turnId,turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId,jobs:capabilities.map((capability,i)=>({jobId:'job:'+i,capability,state:'COMPLETE',resourceId:'resource:'+((i%resourceCount)+1),provider:'native',model:null,correlationId:s.correlationId}))};
}
function sensory(s){
  return{kind:'CandidateBusEnvelope',candidateSetId:'candidates:'+s.turnId,query:'Where is the Sun Blade?',retrievalIntentIds:['intent:blade-fate'],sourceRevisionSet:s.sourceRevisionRefs,worldRevision:s.worldRevision,sceneRevision:s.sceneRevision,candidateCount:7,candidates:[],
    unavailableChannels:[],degradedChannels:[],freshness:'FRESH',metadata:{turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId},
    fusionReceipt:{kind:'CandidateFusionReceipt',candidateSetId:'candidates:'+s.turnId,inputNominationCount:18,inputChannelCount:3,deduplicatedCandidateCount:7,duplicateNominationCount:11,perChannelCounts:{CORE_SPARSE:7,CORE_DENSE:6,CORE_TEMPORAL:5},retrievalIntentIds:['intent:blade-fate'],unavailableChannels:[],degradedChannels:[],staleNominationCount:0,invalidNominationCount:0,freshness:'FRESH'}};
}
function truth(s,ambiguous=false){
  const rows=ambiguous?[
    {candidateId:'tavern',classification:'CURRENT',usableForIntent:true,claimIds:['claim:tavern-destroyed']},
    {candidateId:'blade-history',classification:'HISTORICAL',usableForIntent:false,claimIds:['claim:blade-history']},
    {candidateId:'blade-fate',classification:'UNRESOLVED',usableForIntent:true,claimIds:['claim:blade-fate']},
  ]:[
    {candidateId:'tavern',classification:'CURRENT',usableForIntent:true,claimIds:['claim:tavern-destroyed']},
    {candidateId:'mara',classification:'CURRENT',usableForIntent:true,claimIds:['claim:mara-owner']},
    {candidateId:'eris',classification:'CURRENT',usableForIntent:true,claimIds:['claim:eris-current']},
  ];
  return{kind:'TruthAssessment',id:'truth:'+s.turnId,query:'Where is the Sun Blade?',intent:'CURRENT',confidence:ambiguous?'MIXED':'HIGH',truthResults:rows,admittedCandidateIds:rows.filter(x=>x.usableForIntent).map(x=>x.candidateId),supportCandidateIds:ambiguous?['blade-history']:[],reason:ambiguous?'current fate remains conflicting':'fresh current evidence is sufficient',metadata:{turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId},worldRevision:s.worldRevision,sceneRevision:s.sceneRevision,sourceRevisionRefs:s.sourceRevisionRefs};
}
function correction(s){return{kind:'CorrectiveRetrievalReceipt',id:'correction:'+s.turnId,turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId,executed:true,failed:false,terminated:true,attempt:1,maxAttempts:1,initialQuality:'MIXED',finalQuality:'MIXED',candidateCount:7,reason:'bounded correction exhausted'};}
function jev(s){return{kind:'JevDecisionReceipt',contractVersion:'1.0.0',decisionId:'jev:'+s.turnId,outcome:'ABSTAINED',serviceStatus:'JEV_ABSTAINED',decisionCode:'ABSTAIN',selectedOptionIds:[],rejectedOptionIds:[],evidenceUsed:['claim:blade-fate'],unresolvedFactors:['destroyed versus removed'],confidence:.42,requiresOwnerSettlement:false,requiresOperator:false,settlementPerformed:false,revisionFence:{sourceRevisionSet:s.sourceRevisionRefs,worldRevision:s.worldRevision,sceneRevision:s.sceneRevision},providerProvenance:{providerId:'optional-jev',workerId:'resource:jev'},admission:{late:false},explanation:'Jev abstained; owner Settlement remains separate.',metadata:{turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId}};}
function precision(s){return{kind:'PrecisionReceipt',id:'precision:'+s.turnId,turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId,results:Array.from({length:5},(_,i)=>({candidateId:'candidate:'+i,finalRank:i+1,normalizedScore:1-i*.1,freshness:'FRESH',sourceRevisionIds:s.sourceRevisionRefs,worldRevision:s.worldRevision,sceneRevision:s.sceneRevision})),worldRevision:s.worldRevision,sceneRevision:s.sceneRevision,sourceRevisionRefs:s.sourceRevisionRefs};}
function gather(s,{late=false}={}){
  const rows=[
    {resultId:'result:tavern',capability:'Truth',status:'ADMITTED',accepted:true,evidenceRefs:['claim:tavern-destroyed'],freshness:'FRESH',correlationId:s.correlationId,worldRevision:s.worldRevision,sceneRevision:s.sceneRevision},
    {resultId:'result:blade-history',capability:'Historian',status:'ADMITTED',accepted:true,evidenceRefs:['claim:blade-history'],freshness:'FRESH',correlationId:s.correlationId,worldRevision:s.worldRevision,sceneRevision:s.sceneRevision},
    {resultId:'result:blade-fate',capability:'Truth',status:'ADMITTED',accepted:true,evidenceRefs:['claim:blade-fate'],freshness:'FRESH',correlationId:s.correlationId,worldRevision:s.worldRevision,sceneRevision:s.sceneRevision},
  ];
  if(late)rows.push({resultId:'result:green-room',capability:'Green Room',status:'LATE',accepted:false,late:true,evidenceRefs:['obs:late'],freshness:'FRESH',correlationId:s.correlationId,worldRevision:s.worldRevision,sceneRevision:s.sceneRevision});
  return{kind:'GenerationGatherReceipt',receiptId:'gather:'+s.turnId,turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId,results:rows,admittedEvidenceRefs:rows.filter(x=>x.accepted).flatMap(x=>x.evidenceRefs),worldRevision:s.worldRevision,sceneRevision:s.sceneRevision,sourceRevisionRefs:s.sourceRevisionRefs};
}
function seal(s,{late=false,conflictingAdmission=false}={}){
  const admitted=['result:tavern','result:blade-history','result:blade-fate'];if(conflictingAdmission)admitted.push('result:green-room');
  return{kind:'ContextSealReceipt',id:'seal:'+s.turnId,turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId,packetId:'packet:'+s.turnId,packetHash:'hash:'+s.turnId,sourceRevisionIds:s.sourceRevisionRefs,worldRevision:s.worldRevision,sceneRevision:s.sceneRevision,admittedResultIds:admitted,rejectedResultIds:[],staleResultIds:[],lateResultIds:late?['result:green-room']:[],fallbackState:'NONE',sequence:90,sealedAt:9000,dependencies:s.sourceRevisionRefs,sealedState:true};
}
function promptPlan(s,hotOnly=false){
  const slots=hotOnly?['CURRENT_SCENE','ACTIVE_CAST','RECENT_NARRATIVE']:['WORLD_FOUNDATION','CURRENT_SCENE','HISTORICAL_SUPPORT','UNRESOLVED_EVIDENCE','RECENT_NARRATIVE'];
  return{kind:'PromptPlanReadModel',contractVersion:'1.0.0',promptPlanId:'plan:'+s.generationId,generationId:s.generationId,turnId:s.turnId,contextSealId:'seal:'+s.turnId,sealedPacketHash:'hash:'+s.turnId,modelProfileId:'RP-LONG-CONTEXT-v3',worldRevision:s.worldRevision,sceneRevision:s.sceneRevision,sourceRevisionRefs:s.sourceRevisionRefs,slotAllocation:slots.map((slot,i)=>({slot,representation:'COMPACT',estimatedTokens:1000+i*100,required:true,protected:i<2,sourceSubsystem:slot==='UNRESOLVED_EVIDENCE'?'SETTLEMENT':'CORE',authorityClass:slot==='UNRESOLVED_EVIDENCE'?'UNRESOLVED':'OBSERVED'})),sectionOrder:slots,reuseDecisions:slots.map(slot=>({slot,state:hotOnly?'NO_CHANGE':'REBUILD',reason:hotOnly?'hot working set remained current':'selected by backend context compiler'})),dropped:[],deferred:[],budget:{total:32000,allocated:hotOnly?7600:19800,remaining:hotOnly?24400:12200},estimatedTokens:hotOnly?7600:19800,integrityStatus:'READY',fallbackDecisions:[],health:{state:'READY'},authority:'READ_ONLY',mutationAuthority:false};
}
function contextReceipt(s,ambiguous=false,hotOnly=false){
  return{kind:'ContextReceiptReadModel',turnId:s.turnId,generationId:s.generationId,contextSealId:'seal:'+s.turnId,promptPlanId:'plan:'+s.generationId,packetId:'packet:'+s.turnId,packetHash:'hash:'+s.turnId,modelProfileId:'RP-LONG-CONTEXT-v3',worldRevision:s.worldRevision,sceneRevision:s.sceneRevision,sourceRevisionRefs:s.sourceRevisionRefs,includedSections:hotOnly?['CURRENT_SCENE','ACTIVE_CAST','RECENT_NARRATIVE']:['WORLD_FOUNDATION','CURRENT_SCENE','HISTORICAL_SUPPORT','UNRESOLVED_EVIDENCE','RECENT_NARRATIVE'],omittedSections:[],deferredSections:[],unresolvedEvidence:ambiguous?[{artifactId:'claim:blade-fate',subjectId:'Sun Blade',predicate:'fate',value:'unknown',authority:'UNRESOLVED',status:'UNRESOLVED',alternatives:[{claim:'destroyed in fire',authority:'SOURCE_CANON'},{claim:'removed before fire',authority:'OBSERVED'}],reason:'Owner Settlement preserved conflict.'}]:[],reusedSegments:hotOnly?[{slot:'CURRENT_SCENE'},{slot:'ACTIVE_CAST'}]:[],rebuiltSegments:hotOnly?[]:[{slot:'CURRENT_SCENE'}],budget:{total:32000,allocated:hotOnly?7600:19800,remaining:hotOnly?24400:12200},estimatedTokens:hotOnly?7600:19800,fallbackState:'NONE',provenanceRefs:['prov:ember'],health:{state:'READY'},contextSealValid:true,authority:'READ_ONLY',mutationAuthority:false};
}
function forensic(s,complete=true){return{kind:'ForensicReadModel',contractVersion:'1.0.0',bundleId:'bundle:'+s.generationId,turnId:s.turnId,generationId:s.generationId,worldRevision:s.worldRevision,sceneRevision:s.sceneRevision,sourceRevisionRefs:s.sourceRevisionRefs,transactionRefs:['tx:source:'+s.turnId,'tx:seal:'+s.turnId],runtimeWorkRefs:['runtime:'+s.turnId],settlementRefs:['settlement:'+s.turnId],contextSealRef:'seal:'+s.turnId,promptPlanRef:'plan:'+s.generationId,lateResultRefs:['result:green-room'],staleResultRefs:[],complete,health:{state:complete?'READY':'DEGRADED',reasons:complete?[]:['PARTIAL']},authority:'READ_ONLY',mutationAuthority:false};}
function transactions(s,ambiguous=false){
  const base={kind:'CognitiveTransaction',contractVersion:'1.0.0',turnId:s.turnId,generationId:s.generationId,correlationId:s.correlationId,sourceRevisionIds:s.sourceRevisionRefs,authorityContext:{authorityClass:'UNRESOLVED'},provenance:{},metadata:{}};
  return[
    {...base,transactionId:'tx:source:'+s.turnId,transactionType:'SOURCE_REVISION_ADMITTED',sequence:1,subsystem:'SOURCE',owner:'SOURCE',outcome:{status:'RECORDED'},reasonCode:'SOURCE_CURRENT'},
    ...(ambiguous?[{...base,transactionId:'tx:settlement:'+s.turnId,transactionType:'SETTLEMENT_UNRESOLVED',sequence:2,subsystem:'SETTLEMENT',owner:'SETTLEMENT',outcome:{status:'UNRESOLVED'},reasonCode:'OWNER_PRESERVED_CONFLICT'}]:[]),
    {...base,transactionId:'tx:seal:'+s.turnId,transactionType:'CONTEXT_SEALED',sequence:3,subsystem:'CONTEXT',owner:'CONTEXT',outcome:{status:'ACCEPTED'},reasonCode:'PUBLICATION_BOUNDARY'},
  ];
}

export function makeWave11Turn({selection={},scenario='retrieval',resourceCount=1,late=false,conflictingAdmission=false,completeForensics=true}={}){
  const s=baseSelection(selection),hotOnly=scenario==='hot',ambiguous=scenario==='ambiguous';
  return{selection:s,scene:scene(s),hot:hot(s),lore:lore(s),choice:choice(s,scenario),scatter:hotOnly?null:scatter(s,resourceCount),sensory:hotOnly?null:sensory(s),truth:hotOnly?null:truth(s,ambiguous),corrective:ambiguous?correction(s):null,jev:ambiguous?jev(s):null,precision:hotOnly?null:precision(s),gather:gather(s,{late}),seal:seal(s,{late,conflictingAdmission}),promptPlan:promptPlan(s,hotOnly),contextReceipt:contextReceipt(s,ambiguous,hotOnly),forensic:forensic(s,completeForensics),transactions:transactions(s,ambiguous)};
}

export function createWave11LiveHost(turns,initialTurnId=null){
  const records=new Map(turns.map(x=>[x.selection.turnId,x])),byGeneration=new Map(turns.map(x=>[x.selection.generationId,x]));
  let current=records.get(initialTurnId??turns[0]?.selection.turnId)??turns[0]??null;const listeners=new Set(),failures=new Map();
  const pick=(selection={})=>records.get(selection.turnId)??byGeneration.get(selection.generationId)??current;
  const read=(key)=>(selection={})=>{const rec=pick(selection);const failure=failures.get(key);if(failure)throw failure;return clone(rec?.[key]??null);};
  const bundle={
    readSelection:()=>clone(current?.selection??{}),
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    readScene:read('scene'),readHotCognition:read('hot'),readLoreStatus:read('lore'),readCognitiveChoice:read('choice'),readScatter:read('scatter'),
    readCandidateBusEnvelope:read('sensory'),readTruth:read('truth'),readCorrectiveRetrieval:read('corrective'),readJev:read('jev'),readPrecision:read('precision'),
    readGather:read('gather'),readContextSeal:read('seal'),readPromptPlan:read('promptPlan'),readContextReceipt:read('contextReceipt'),
    listGenerations:()=>turns.map((x,i)=>({generationId:x.selection.generationId,turnId:x.selection.turnId,promptPlanId:'plan:'+x.selection.generationId,current:x===current,index:i})),
    readForensic:(selection={})=>clone(pick(selection)?.forensic??null),
    listForensics:(selection={})=>{const rec=pick(selection);return rec?[clone(rec.forensic)]:[];},
    listTransactions:()=>turns.flatMap(x=>x.transactions.map(clone)),
    readTransaction:(id)=>clone(turns.flatMap(x=>x.transactions).find(x=>x.transactionId===id)??null),
    reconstructGeneration:(generationId)=>({kind:'ReconstructionChain',targetType:'generation',targetId:generationId,complete:true,transactions:clone(byGeneration.get(generationId)?.transactions??[]),links:[],missingRefs:[],cycles:[],truncated:false}),
    readRuntimeWork:(id)=>({id,state:'COMPLETE'}),readKnowledgeTrace:(ref)=>({ref,authority:'UNRESOLVED'}),readLazyForensicPayload:(id)=>({id,provider:'advanced-only'}),
  };
  return{
    bundle,
    current:()=>clone(current?.selection??{}),
    switchTo(turnId){current=records.get(turnId);if(!current)throw new Error('unknown turn '+turnId);for(const fn of [...listeners])fn({type:'HOST_CONTEXT_CHANGED',selection:clone(current.selection)});},
    emit(){for(const fn of [...listeners])fn({type:'RECEIPT_UPDATED',selection:clone(current?.selection??{})});},
    fail(stage,error=new Error(stage+' failed')){failures.set(stage,error);},
    clearFailure(stage){failures.delete(stage);},
    listenerCount:()=>listeners.size,
    record:(turnId)=>records.get(turnId),
  };
}
