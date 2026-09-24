import { createWave7ProductionBindings } from '../../../src/ui-core/index.js';

const clone=value=>value==null?value:typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
const CURRENT='gen:418',PREVIOUS='gen:417';

function plan(gen=CURRENT,{health='READY',fallback='NONE',partial=false,stale=false}={}){
  const sceneRevision=gen===PREVIOUS?18:stale?18:19;
  const slots=[
    {slot:'WORLD_FOUNDATION',representation:'COMPACT',estimatedTokens:3600,required:true,protected:true},
    {slot:'CHARACTER_FOUNDATION',representation:'COMPACT',estimatedTokens:3200,required:true,protected:true},
    {slot:'CURRENT_SCENE',representation:'RICH',estimatedTokens:4200,required:true,protected:true},
    {slot:'HISTORICAL_SUPPORT',representation:'COMPACT',estimatedTokens:1600,required:false,protected:false},
    {slot:'UNRESOLVED_EVIDENCE',representation:'RICH',estimatedTokens:1200,required:true,protected:true},
    {slot:'MEMORY',representation:'BALANCED',estimatedTokens:2400,required:false,protected:false},
    {slot:'RECENT_NARRATIVE',representation:'RICH',estimatedTokens:11600,required:true,protected:true},
  ];
  const reuse=[
    {slot:'WORLD_FOUNDATION',state:gen===PREVIOUS?'REBUILD':'NO_CHANGE',reason:gen===PREVIOUS?'initial generation build':'world revision unchanged',cacheEligible:true,priority:100,sourceSubsystem:'WORLD',authorityClass:'SETTLED',revisionIdentity:{worldRevision:52}},
    {slot:'CHARACTER_FOUNDATION',state:gen===PREVIOUS?'REBUILD':'NO_CHANGE',reason:gen===PREVIOUS?'initial generation build':'character identity sources unchanged',cacheEligible:true,priority:95,sourceSubsystem:'LORE',authorityClass:'SOURCE_CANON',revisionIdentity:{sourceRevision:'lore:r6'}},
    {slot:'CURRENT_SCENE',state:'REBUILD',reason:stale?'selected historical Scene revision for stale-state review':'Scene revision changed after the tavern aftermath turn',cacheEligible:true,priority:100,sourceSubsystem:'SCENE',authorityClass:'OBSERVED',revisionIdentity:{sceneRevision}},
    {slot:'HISTORICAL_SUPPORT',state:'REBUILD',reason:'retrieval requested prior Sun Blade possession history',cacheEligible:false,priority:70,sourceSubsystem:'RETRIEVAL',authorityClass:'HISTORICAL',revisionIdentity:{sourceRevision:'lore:r6'}},
    {slot:'UNRESOLVED_EVIDENCE',state:'PATCH',reason:'competing destroyed-versus-removed evidence must remain unresolved',cacheEligible:false,priority:100,sourceSubsystem:'SETTLEMENT',authorityClass:'UNRESOLVED',revisionIdentity:{worldRevision:52}},
    {slot:'MEMORY',state:'NO_CHANGE',reason:'relevant episode/reflection revisions unchanged',cacheEligible:true,priority:65,sourceSubsystem:'MEMORY',authorityClass:'INFERRED',revisionIdentity:{memoryRevision:'memory:r12'}},
    {slot:'RECENT_NARRATIVE',state:'REBUILD',reason:'current host turn appended to recent narrative',cacheEligible:true,priority:100,sourceSubsystem:'HOST',authorityClass:'OBSERVED',revisionIdentity:{turnId:`turn:${gen}`}},
  ];
  const usedSlots=partial?slots.slice(0,5):slots,usedReuse=partial?reuse.slice(0,5):reuse,allocated=partial?16200:27800;
  return {kind:'PromptPlanReadModel',contractVersion:'1.0.0',dataMode:'FIXTURE',fixture:true,promptPlanId:`plan:${gen}`,generationId:gen,turnId:`turn:${gen}`,
    contextSealId:partial?null:`seal:${gen}`,sealedPacketHash:partial?null:`hash:${gen}`,modelProfileId:'RP-LONG-CONTEXT-v3',modelProfileRevision:'3',deliveryPolicyRevision:'7',
    worldRevision:52,sceneRevision,sourceRevisionRefs:['world:r52',`scene:r${sceneRevision}`,'lore:r6','memory:r12'],
    slotAllocation:usedSlots,sectionOrder:usedSlots.map(x=>x.slot),reuseDecisions:usedReuse,cacheDecisions:usedReuse.filter(x=>x.cacheEligible).map(x=>({slot:x.slot,cacheEligible:true})),
    reusedSegments:usedReuse.filter(x=>x.state==='NO_CHANGE').map(x=>({slot:x.slot,reuseState:'NO_CHANGE',cacheEligible:x.cacheEligible})),
    rebuiltSegments:usedReuse.filter(x=>x.state==='REBUILD').map(x=>({slot:x.slot,reuseState:'REBUILD',cacheEligible:x.cacheEligible})),
    dropped:partial?[]:[{slot:'AMBIENT_LORE',estimatedTokens:700,reason:'lower-priority ambient lore was outside this generation budget',priority:10,sourceSubsystem:'LORE',authorityClass:'SOURCE_CANON'}],
    deferred:partial?[]:[{slot:'BACKGROUND_REFLECTION',estimatedTokens:500,reason:'reflection is useful but not required before this generation seal',priority:20,sourceSubsystem:'MEMORY',authorityClass:'INFERRED'}],
    fallbackDecisions:fallback==='NONE'?[]:[{state:fallback,reason:'fixture degraded-path demonstration'}],budget:{total:32000,allocated,remaining:32000-allocated,estimatedTokens:allocated},estimatedTokens:allocated,
    integrityStatus:health,health:{state:health,reasons:partial?['ASSEMBLY_IN_PROGRESS']:fallback==='NONE'?[]:[fallback]},authority:'READ_ONLY',mutationAuthority:false,previousPromptPlanId:gen===CURRENT?`plan:${PREVIOUS}`:null};
}

function receipt(gen=CURRENT,{fallback='NONE',stale=false}={}){
  const sceneRevision=stale?18:gen===PREVIOUS?18:19;
  return {kind:'ContextReceiptReadModel',contractVersion:'1.0.0',dataMode:'FIXTURE',turnId:`turn:${gen}`,generationId:gen,contextSealId:`seal:${gen}`,promptPlanId:`plan:${gen}`,
    packetId:`packet:${gen}`,packetHash:`hash:${gen}`,modelProfileId:'RP-LONG-CONTEXT-v3',worldRevision:52,sceneRevision,sourceRevisionRefs:['world:r52',`scene:r${sceneRevision}`,'lore:r6','memory:r12'],
    includedSections:['WORLD_FOUNDATION','CHARACTER_FOUNDATION','CURRENT_SCENE','HISTORICAL_SUPPORT','UNRESOLVED_EVIDENCE','MEMORY','RECENT_NARRATIVE'],
    omittedSections:[{slot:'AMBIENT_LORE',reason:'lower-priority ambient lore was outside this generation budget'}],deferredSections:[{slot:'BACKGROUND_REFLECTION',reason:'reflection is useful but not required before this generation seal'}],
    unresolvedEvidence:[{artifactId:'claim:sun-blade:fate',subjectId:'Sun Blade',predicate:'current status/location',value:'unknown',authority:'UNRESOLVED',status:'UNRESOLVED',
      provenanceRefs:['src:blade-left:r6','src:tavern-destroyed:r6','obs:removed-rumor:t418'],
      alternatives:[{claim:'Destroyed in the Ember Tavern fire',authority:'SOURCE_CANON',provenanceRef:'src:tavern-destroyed:r6'},{claim:'Removed before the fire',authority:'OBSERVED',provenanceRef:'obs:removed-rumor:t418'}],
      reason:'Owner Settlement preserved conflicting evidence; no current Sun Blade location was asserted.'}],
    reusedSegments:[{slot:'WORLD_FOUNDATION'},{slot:'CHARACTER_FOUNDATION'},{slot:'MEMORY'}],rebuiltSegments:[{slot:'CURRENT_SCENE'},{slot:'HISTORICAL_SUPPORT'},{slot:'RECENT_NARRATIVE'}],
    budget:{total:32000,allocated:27800,remaining:4200},estimatedTokens:27800,fallbackState:fallback,provenanceRefs:['src:blade-left:r6','src:tavern-destroyed:r6','obs:removed-rumor:t418'],
    health:{state:fallback==='NONE'?'READY':'DEGRADED',reasons:fallback==='NONE'?[]:[fallback]},contextSealValid:true,authority:'READ_ONLY',mutationAuthority:false};
}

function seal(gen=CURRENT,{fallback='NONE',stale=false}={}){
  const sceneRevision=stale?18:gen===PREVIOUS?18:19;
  return {kind:'ContextSealReceipt',id:`seal:${gen}`,turnId:`turn:${gen}`,correlationId:`corr:${gen}`,packetId:`packet:${gen}`,packetHash:`hash:${gen}`,
    sourceRevisionIds:['world:r52',`scene:r${sceneRevision}`,'lore:r6','memory:r12'],worldRevision:52,sceneRevision,admittedResultIds:['result:historian','result:truth','result:retrieval'],
    rejectedResultIds:['result:malformed'],staleResultIds:['result:scene-r18'],lateResultIds:['result:green-room'],fallbackState:fallback,deadline:{foregroundMs:1200},sequence:90,sealedAt:9000,
    dependencies:['world:r52',`scene:r${sceneRevision}`,'lore:r6','memory:r12'],sealedState:true};
}

function tx(id,type,sequence,subsystem,owner,authority,reason,extra={}){
  return {kind:'CognitiveTransaction',transactionId:id,transactionType:type,sequence,timestamp:sequence*100,correlationId:'corr:gen:418',turnId:'turn:gen:418',generationId:'gen:418',
    subsystem,owner,taskId:extra.taskId??null,beforeRevision:extra.beforeRevision??null,afterRevision:extra.afterRevision??null,sourceRevisionIds:extra.sourceRevisionIds??[],affectedArtifactIds:extra.affectedArtifactIds??[],
    authorityContext:{authorityClass:authority},decision:extra.decision??null,outcome:extra.outcome??{status:'RECORDED'},receiptRefs:extra.receiptRefs??[],reasonCode:reason,provenance:extra.provenance??{},
    metadata:extra.metadata??{},retentionClass:extra.retentionClass??'FORENSIC_REFERENCE'};
}

function transactions({hotOnly=false,degraded=false,partial=false}={}){
  const rows=[
    tx('tx:source','SOURCE_REVISION_ADMITTED',10,'SOURCE','SOURCE','SOURCE_CANON','SOURCE_REVISION_CURRENT',{sourceRevisionIds:['src:tavern-destroyed:r6','src:blade-left:r6'],affectedArtifactIds:['claim:sun-blade:fate'],outcome:{status:'RECORDED',summary:'Source revisions admitted for evaluation'}}),
    tx('tx:proposal','PROPOSAL_CREATED',20,'WORLD','WORLD','UNRESOLVED','CONFLICTING_CURRENT_STATE_PROPOSED',{affectedArtifactIds:['claim:sun-blade:fate'],outcome:{status:'RECORDED',summary:'Proposal records competing Sun Blade current-state claims'}}),
    tx('tx:validation','PROPOSAL_VALIDATED',30,'TRUTH','SETTLEMENT','UNRESOLVED','COMPETING_EVIDENCE_VALID',{sourceRevisionIds:['src:tavern-destroyed:r6','obs:removed-rumor:t418'],affectedArtifactIds:['claim:sun-blade:fate'],outcome:{status:'RECORDED',summary:'Both alternatives retain supporting evidence'}}),
    tx('tx:settlement','SETTLEMENT_UNRESOLVED',40,'SETTLEMENT','SETTLEMENT','UNRESOLVED','OWNER_PRESERVED_CONFLICT',{affectedArtifactIds:['claim:sun-blade:fate'],receiptRefs:['settlement:sun-blade:unresolved'],decision:{status:'UNRESOLVED',summary:'Neither destroyed nor removed claim is owner-settled'},outcome:{status:'UNRESOLVED',summary:'Sun Blade remains UNRESOLVED'}}),
    tx('tx:reflection','REFLECTION_CREATED',50,'MEMORY','MEMORY','INFERRED','UNRESOLVED_PATTERN_RECORDED',{affectedArtifactIds:['reflection:sun-blade-conflict'],outcome:{status:'RECORDED',summary:'Reflection records the unresolved evidence pattern without changing world truth'}}),
  ];
  if(partial)return rows.slice(0,2);
  rows.push(hotOnly
    ?tx('tx:retrieval-skip','RETRIEVAL_SKIPPED',60,'RETRIEVAL','RETRIEVAL','UNRESOLVED','HOT_CONTEXT_SUFFICIENT',{outcome:{status:'SKIPPED',summary:'Current hot context was sufficient; retrieval did not run'}})
    :tx('tx:retrieval','RETRIEVAL_COMPLETED',60,'RETRIEVAL','RETRIEVAL','HISTORICAL','HISTORICAL_POSSESSION_REQUESTED',{sourceRevisionIds:['src:blade-left:r6'],affectedArtifactIds:['claim:blade-history'],receiptRefs:['result:retrieval'],outcome:{status:'RECORDED',summary:'Historical Sun Blade possession evidence retrieved'}}));
  rows.push(
    tx('tx:gather','RESULT_ROUTED',70,'GATHER','GATHER','UNRESOLVED','GATHER_PRESERVED_AUTHORITY',{affectedArtifactIds:['claim:sun-blade:fate'],receiptRefs:['gather:418'],outcome:{status:'RECORDED',summary:'Gather admitted bounded evidence without settling the conflict'}}),
    tx('tx:compile','CONTEXT_SECTION_COMPILED',80,'CONTEXT','CONTEXT','UNRESOLVED','UNRESOLVED_SECTION_COMPILED',{affectedArtifactIds:['section:UNRESOLVED_EVIDENCE'],receiptRefs:['context-section:unresolved'],outcome:{status:'RECORDED',summary:'Compiled context labels the Sun Blade conflict UNRESOLVED'}}),
    tx('tx:seal','CONTEXT_SEALED',90,'CONTEXT','CONTEXT','UNRESOLVED','PUBLICATION_BOUNDARY',{affectedArtifactIds:['packet:gen:418'],receiptRefs:['seal:gen:418'],outcome:{status:'ACCEPTED',summary:'Context sealed with unresolved evidence intact'}}),
    tx('tx:plan','CONTEXT_DELIVERY_PLANNED',95,'CONTEXT','CONTEXT','UNRESOLVED','PLAN_READY',{affectedArtifactIds:['plan:gen:418'],receiptRefs:['plan:gen:418'],outcome:{status:'ACCEPTED',summary:'PromptPlan points at the sealed packet'}}),
    tx('tx:late','RESULT_LATE',110,'GREEN_ROOM','COPROCESSOR','INFERRED','CONTEXT_ALREADY_SEALED',{taskId:'task:green-room',receiptRefs:['result:green-room'],outcome:{status:'LATE',summary:'Late optional interpretation retained for future cognition only'}})
  );
  if(degraded)rows.splice(7,0,tx('tx:stale','RESULT_STALE',75,'RESULT_BUS','RESULT_BUS','UNRESOLVED','SCENE_REVISION_MISMATCH',{beforeRevision:18,afterRevision:19,receiptRefs:['result:scene-r18'],outcome:{status:'STALE',summary:'Stale Scene result excluded'}}));
  return rows;
}

function forensic({complete=true}={}){
  return {kind:'ForensicReadModel',contractVersion:'1.0.0',bundleId:'bundle:gen:418',turnId:'turn:gen:418',generationId:'gen:418',worldRevision:52,sceneRevision:19,
    sourceRevisionRefs:['src:tavern-destroyed:r6','src:blade-left:r6','obs:removed-rumor:t418'],turnEventRef:'turn-event:gen:418',runtimeWorkRefs:['runtime:historian','runtime:green-room'],
    workerResultRefs:['result:historian','result:green-room'],truthDecisionRefs:['truth:sun-blade'],precisionRefs:['precision:1'],gatherRef:'gather:418',
    transactionRefs:['tx:source','tx:proposal','tx:validation','tx:settlement','tx:reflection','tx:retrieval','tx:compile','tx:seal','tx:plan','tx:late'],
    settlementRefs:['settlement:sun-blade:unresolved'],contextSealRef:'seal:gen:418',promptPlanRef:'plan:gen:418',lateResultRefs:['result:green-room'],staleResultRefs:['result:scene-r18'],
    diagnosticRefs:['diag:418'],diagnosticReasons:complete?[]:['PROVIDER_TIMEOUT','FORENSIC_BUNDLE_PARTIAL'],assemblyProvenanceRefs:['assembly:418'],complete,
    health:{state:complete?'READY':'DEGRADED',reasons:complete?[]:['FORENSIC_BUNDLE_PARTIAL']},authority:'READ_ONLY',mutationAuthority:false};
}

function bindingsFor(scenario){
  if(scenario==='empty')return createWave7ProductionBindings({fixture:true,fixtureLabel:'DEMO / FIXTURE DATA'});
  const hotOnly=scenario==='hot-only',degraded=scenario==='degraded',loading=scenario==='loading',stale=scenario==='stale';
  const currentPlan=plan(CURRENT,{health:loading?'WORKING':stale?'STALE':degraded?'DEGRADED':'READY',fallback:degraded?'COPROCESSOR_TIMEOUT':'NONE',partial:loading,stale});
  const currentReceipt=loading?null:receipt(CURRENT,{fallback:degraded?'COPROCESSOR_TIMEOUT':'NONE',stale});
  const currentSeal=loading?null:seal(CURRENT,{fallback:degraded?'COPROCESSOR_TIMEOUT':'NONE',stale});
  const rows=transactions({hotOnly,degraded,partial:loading}),bundle=forensic({complete:!degraded&&!loading});
  const generations=loading?[{generationId:CURRENT,turnId:`turn:${CURRENT}`}]:[{generationId:PREVIOUS,turnId:`turn:${PREVIOUS}`},{generationId:CURRENT,turnId:`turn:${CURRENT}`}];
  return createWave7ProductionBindings({
    fixture:true,fixtureLabel:'DEMO / FIXTURE DATA',
    readPromptPlanReadModel:({generationId}={})=>clone(generationId===PREVIOUS?plan(PREVIOUS):currentPlan),
    readContextReceiptReadModel:({generationId}={})=>generationId===PREVIOUS?clone(receipt(PREVIOUS)):clone(currentReceipt),
    readContextSealReceipt:({generationId}={})=>generationId===PREVIOUS?clone(seal(PREVIOUS)):clone(currentSeal),
    readIntegrityReceipt:()=>loading?null:{valid:!degraded,state:degraded?'DEGRADED':'VALID'},listGenerations:()=>clone(generations),
    readForensicReadModel:arg=>{const id=typeof arg==='string'?arg:arg?.generationId;if(id===PREVIOUS)return clone({...bundle,bundleId:'bundle:gen:417',generationId:PREVIOUS,turnId:'turn:gen:417',lateResultRefs:[],staleResultRefs:[]});return clone(bundle);},
    listForensicReadModels:()=>[clone(bundle)],listCognitiveTransactions:({generationId}={})=>generationId===PREVIOUS?[]:clone(rows),
    readCognitiveTransaction:id=>clone(rows.find(x=>x.transactionId===id)??null),
    reconstructGeneration:id=>({kind:'ReconstructionChain',targetType:'generation',targetId:id,complete:bundle.complete,status:bundle.complete?'OK':'PARTIAL',transactions:clone(rows),links:[],missingRefs:bundle.complete?[]:['provider:optional'],cycles:[],truncated:false,totalTransactions:rows.length}),
    readRuntimeWork:id=>({id,taskType:id.includes('green')?'GREEN_ROOM':'HISTORIAN',state:id.includes('green')?'LATE':'COMPLETE'}),
    readKnowledgeTrace:ref=>({ref,authority:ref.includes('rumor')?'OBSERVED':'SOURCE_CANON'}),
    readLazyForensicPayload:id=>({id,fixture:true,providerDetail:'fixture-only advanced diagnostic',rawDiagnosticCode:'WAVE10_REVIEW_DETAIL'}),
  });
}

export function createWave10ReviewBindings(scenario='healthy'){return bindingsFor(scenario);}
export function createWave10TraceFixture(scenario='ambiguous'){
  const bindings=bindingsFor(scenario);
  return {bindings,promptPlan:bindings.promptPlan.readPromptPlanReadModel?.({generationId:CURRENT})??null,contextReceipt:bindings.promptPlan.readContextReceiptReadModel?.({generationId:CURRENT})??null,
    contextSeal:bindings.promptPlan.readSealReceipt?.({generationId:CURRENT})??null,forensic:bindings.forensics.readForensicReadModel?.({generationId:CURRENT})??null,transactions:bindings.forensics.listTransactions?.({generationId:CURRENT})??[]};
}
