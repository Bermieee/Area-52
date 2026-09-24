const scene=()=>({
  title:'Ember Tavern',sceneId:'scene:ember',revision:19,location:'Ember Tavern',narrativeTime:'Late evening',
  cast:[{id:'Mara',name:'Mara',state:'PRESENT'},{id:'Eris',name:'Eris',state:'PRESENT'}],
  health:{state:'READY'},sourceRevisionRefs:['scene:r19'],
});
const lore=()=>({kind:'LoreStatusReadModel',sourceEntryCount:12,learnedRepresentationCount:12,learnedState:'READY',indexState:'READY',lastRevision:'r6',sourceRevisionRefs:['lore:r6']});
const promptPlan=()=>({promptPlanId:'plan:418',generationId:'gen:418',turnId:'turn:418',totalTokens:27800,budgetTotal:32000,source:{mode:'FIXTURE'},sceneRevision:19,worldRevision:52});
const seal=(overrides={})=>({kind:'ContextSealReceipt',id:'seal:418',turnId:'turn:418',correlationId:'corr:418',packetId:'packet:418',packetHash:'hash:418',sourceRevisionIds:['scene:r19','lore:r6'],worldRevision:52,sceneRevision:19,admittedResultIds:['result:1','result:2','result:3','result:4','result:5'],rejectedResultIds:[],staleResultIds:[],fallbackState:'NONE',sequence:418,sealedAt:4180,dependencies:['scene:r19','lore:r6'],sealedState:true,...overrides});
const choiceBase=()=>({
  kind:'CognitiveChoiceReceipt',receiptId:'choice:418',turnId:'turn:418',generationId:'gen:418',correlationId:'corr:418',causationId:'turn-event:418',
  status:'COMPLETE',worldRevision:52,sceneRevision:19,sourceRevisionRefs:['scene:r19','lore:r6'],resourceBudget:{foregroundMs:1200},
});
const fusion=(overrides={})=>({
  kind:'CandidateFusionReceipt',candidateSetId:'candidate-set:418',retrievalIntentIds:['intent:possession'],inputNominationCount:18,inputChannelCount:4,
  deduplicatedCandidateCount:7,duplicateNominationCount:11,perChannelCounts:{SPARSE:6,DENSE:5,GRAPH:4,HISTORIAN:3},perIntentCounts:{'intent:possession':18},
  boundedOutCount:0,unavailableChannels:[],degradedChannels:[],staleNominationCount:0,invalidNominationCount:0,revisionSet:{worldRevision:52,sceneRevision:19},
  freshness:'FRESH',coverageByIntent:{'intent:possession':true},candidateIdsByIntent:{'intent:possession':['cand:1','cand:2','cand:3','cand:4','cand:5','cand:6','cand:7']},
  uncoveredIntentIds:[],prunedCandidateIds:[],fusionPolicyVersion:'1.0.0',...overrides,
});
const sensoryCandidates=()=>[
  {candidateId:'cand:1',evidenceIdentity:'claim:blade-left',channelNominations:[{channelId:'SPARSE'},{channelId:'HISTORIAN'}],authorityClass:'SOURCE_CANON',truthStatusHint:'HISTORICAL',freshness:'FRESH',claimRefs:['claim:blade-left'],sourceRevisionRefs:['lore:r5'],representationText:'Historical: Sun Blade was left at Ember Tavern.'},
  {candidateId:'cand:2',evidenceIdentity:'claim:tavern-destroyed',channelNominations:[{channelId:'SPARSE'},{channelId:'DENSE'},{channelId:'GRAPH'}],authorityClass:'SETTLED',truthStatusHint:'CURRENT',freshness:'FRESH',claimRefs:['claim:tavern-destroyed'],sourceRevisionRefs:['scene:r19'],representationText:'Current: Ember Tavern was destroyed in the fire.'},
  {candidateId:'cand:3',evidenceIdentity:'claim:blade-destroyed',channelNominations:[{channelId:'DENSE'},{channelId:'GRAPH'}],authorityClass:'UNRESOLVED',truthStatusHint:'UNRESOLVED',freshness:'FRESH',claimRefs:['claim:blade-destroyed'],sourceRevisionRefs:['lore:r6'],representationText:'Evidence: Sun Blade may have been destroyed in the fire.'},
  {candidateId:'cand:4',evidenceIdentity:'claim:blade-removed',channelNominations:[{channelId:'SPARSE'},{channelId:'HISTORIAN'}],authorityClass:'UNRESOLVED',truthStatusHint:'UNRESOLVED',freshness:'FRESH',claimRefs:['claim:blade-removed'],sourceRevisionRefs:['lore:r6'],representationText:'Evidence: Sun Blade may have been removed before the fire.'},
  {candidateId:'cand:5',evidenceIdentity:'claim:blade-current',channelNominations:[{channelId:'GRAPH'}],authorityClass:'UNRESOLVED',truthStatusHint:'UNRESOLVED',freshness:'FRESH',claimRefs:['claim:blade-current'],sourceRevisionRefs:['lore:r6'],representationText:'Current: Sun Blade location is unknown.'},
  {candidateId:'cand:6',evidenceIdentity:'claim:mara-current',channelNominations:[{channelId:'SPARSE'}],authorityClass:'OBSERVED',truthStatusHint:'CURRENT',freshness:'FRESH',claimRefs:['claim:mara-current'],sourceRevisionRefs:['scene:r19'],representationText:'Mara is present in the current scene.'},
  {candidateId:'cand:7',evidenceIdentity:'claim:eris-current',channelNominations:[{channelId:'DENSE'}],authorityClass:'OBSERVED',truthStatusHint:'CURRENT',freshness:'FRESH',claimRefs:['claim:eris-current'],sourceRevisionRefs:['scene:r19'],representationText:'Eris is present in the current scene.'},
];
const sensory=()=>({kind:'CandidateBusEnvelope',candidateSetId:'candidate-set:418',query:'Where is the Sun Blade now?',retrievalIntentIds:['intent:possession'],sourceRevisionSet:['scene:r19','lore:r6'],worldRevision:52,sceneRevision:19,candidates:sensoryCandidates(),candidateCount:7,unavailableChannels:[],degradedChannels:[],fusionReceipt:fusion(),freshness:'FRESH'});
const truthHeavy=()=>({
  kind:'TruthAssessment',id:'truth:418',query:'What is known about the Ember Tavern and Sun Blade?',intent:'TEMPORAL',confidence:'HIGH',
  truthResults:[
    {candidateId:'cand:1',classification:'HISTORICAL',usableForIntent:true,reasons:['historical evidence is valid for temporal context'],claimIds:['claim:blade-left']},
    {candidateId:'cand:2',classification:'CURRENT',usableForIntent:true,reasons:['current settled tavern state'],claimIds:['claim:tavern-destroyed']},
    {candidateId:'cand:3',classification:'UNRESOLVED',usableForIntent:true,reasons:['competing fate evidence'],claimIds:['claim:blade-destroyed']},
    {candidateId:'cand:4',classification:'UNRESOLVED',usableForIntent:true,reasons:['competing fate evidence'],claimIds:['claim:blade-removed']},
    {candidateId:'cand:5',classification:'UNRESOLVED',usableForIntent:true,reasons:['current location not settled'],claimIds:['claim:blade-current']},
    {candidateId:'cand:6',classification:'CURRENT',usableForIntent:true,reasons:['current scene observation'],claimIds:['claim:mara-current']},
    {candidateId:'cand:7',classification:'CURRENT',usableForIntent:true,reasons:['current scene observation'],claimIds:['claim:eris-current']},
  ],
  correctiveRequest:null,reason:'fresh temporal evidence is sufficient for the requested context',admittedCandidateIds:['cand:1','cand:2','cand:3','cand:4','cand:5','cand:6','cand:7'],supportCandidateIds:[],
});
const truthAmbiguous=()=>({
  ...truthHeavy(),id:'truth:ambiguous',confidence:'MIXED',reason:'useful evidence exists but current resolution is incomplete, historical, or conflicting',
  correctiveRequest:{kind:'CorrectiveRetrievalRequest',id:'corrective:1',reason:'current Sun Blade location remains disputed',requestedAction:'RETRIEVE_CORRECTIVE_EVIDENCE',originalQuery:'Where is the Sun Blade now?',intent:'CURRENT',sourceRevisionIds:['lore:r6'],worldRevision:52,sceneRevision:19,priorCandidateIds:['cand:3','cand:4','cand:5'],missingEvidenceType:'location',maxAttempts:1,attempt:1},
});
const precision=()=>({kind:'PrecisionReceipt',receiptId:'precision:418',inputCount:7,outputCount:5,reason:'candidate set benefited from intent-sensitive ordering',results:[
  {kind:'PrecisionResult',candidateId:'cand:2',rawScore:9,normalizedScore:1,finalRank:1,modelProfileId:'fixture-reranker',modelProfileRevision:'1',runtimeProfile:'FIXTURE',latencyMs:1,freshness:'FRESH',sourceRevisionIds:['scene:r19'],worldRevision:52,sceneRevision:19},
  {kind:'PrecisionResult',candidateId:'cand:1',rawScore:8,normalizedScore:.9,finalRank:2,modelProfileId:'fixture-reranker',modelProfileRevision:'1',runtimeProfile:'FIXTURE',latencyMs:1,freshness:'FRESH',sourceRevisionIds:['lore:r5'],worldRevision:52,sceneRevision:19},
  {kind:'PrecisionResult',candidateId:'cand:3',rawScore:7,normalizedScore:.8,finalRank:3,modelProfileId:'fixture-reranker',modelProfileRevision:'1',runtimeProfile:'FIXTURE',latencyMs:1,freshness:'FRESH',sourceRevisionIds:['lore:r6'],worldRevision:52,sceneRevision:19},
  {kind:'PrecisionResult',candidateId:'cand:4',rawScore:7,normalizedScore:.8,finalRank:4,modelProfileId:'fixture-reranker',modelProfileRevision:'1',runtimeProfile:'FIXTURE',latencyMs:1,freshness:'FRESH',sourceRevisionIds:['lore:r6'],worldRevision:52,sceneRevision:19},
  {kind:'PrecisionResult',candidateId:'cand:5',rawScore:6,normalizedScore:.7,finalRank:5,modelProfileId:'fixture-reranker',modelProfileRevision:'1',runtimeProfile:'FIXTURE',latencyMs:1,freshness:'FRESH',sourceRevisionIds:['lore:r6'],worldRevision:52,sceneRevision:19},
]});
const gather=()=>({kind:'GatherReceipt',id:'gather:418',turnId:'turn:418',generationId:'gen:418',correlationId:'corr:418',results:[
  {resultId:'result:1',capability:'Historian',status:'ADMITTED',accepted:true,evidenceRefs:['claim:blade-left'],freshness:'FRESH',resourceId:'resource:1'},
  {resultId:'result:2',capability:'Graph reasoning',status:'ADMITTED',accepted:true,evidenceRefs:['claim:tavern-destroyed'],freshness:'FRESH',resourceId:'resource:1'},
  {resultId:'result:3',capability:'Truth verification',status:'ADMITTED',accepted:true,evidenceRefs:['claim:blade-destroyed'],freshness:'FRESH',resourceId:'resource:1'},
  {resultId:'result:4',capability:'Truth verification',status:'ADMITTED',accepted:true,evidenceRefs:['claim:blade-removed'],freshness:'FRESH',resourceId:'resource:1'},
  {resultId:'result:5',capability:'Precision',status:'ADMITTED',accepted:true,evidenceRefs:['claim:blade-current'],freshness:'FRESH',resourceId:'resource:1'},
],admittedEvidenceRefs:['claim:blade-left','claim:tavern-destroyed','claim:blade-destroyed','claim:blade-removed','claim:blade-current'],rejectedResultIds:[]});
const heavyChoice=()=>({...choiceBase(),brainChoice:['Historian','Graph Walker','Truth','Precision'],candidateJobs:[
  {jobId:'job:historian',capability:'Historian'},{jobId:'job:graph',capability:'Graph Walker'},{jobId:'job:truth',capability:'Truth'},{jobId:'job:precision',capability:'Precision'},
  {jobId:'job:jev',capability:'Jev'},{jobId:'job:external',capability:'External grounding'},{jobId:'job:lore',capability:'Lore expansion'},{jobId:'job:green',capability:'Green Room'},
  {jobId:'job:memory',capability:'Memory consolidation'},{jobId:'job:reflection',capability:'Reflection'},
],admittedJobs:[
  {jobId:'job:historian',capability:'Historian',reasonCode:'TEMPORAL_EVIDENCE_REQUIRED'},{jobId:'job:graph',capability:'Graph Walker',reasonCode:'RELATIONSHIP_PATH_REQUIRED'},
  {jobId:'job:truth',capability:'Truth',reasonCode:'TEMPORAL_CLASSIFICATION_REQUIRED'},{jobId:'job:precision',capability:'Precision',reasonCode:'BOUNDED_RERANK_USEFUL'},
],skippedJobs:[
  {jobId:'job:jev',capability:'Jev',reasonCode:'DETERMINISTIC_EVIDENCE_SUFFICIENT'},{jobId:'job:external',capability:'External grounding',reasonCode:'NO_REAL_WORLD_DEPENDENCY'},
  {jobId:'job:lore',capability:'Lore expansion',reasonCode:'EXISTING_REPRESENTATION_SUFFICIENT'},{jobId:'job:green',capability:'Green Room',reasonCode:'NO_CHARACTER_PERSPECTIVE_DELTA'},
  {jobId:'job:reflection',capability:'Reflection',reasonCode:'NO_REFLECTION_TRIGGER'},
],deferredJobs:[{jobId:'job:memory',capability:'Memory consolidation',reasonCode:'BACKGROUND_SAFE'}],
  retrievalDecision:{invoked:true,status:'COMPLETE',reasonCode:'LONG_TERM_EVIDENCE_REQUIRED'},sensoryDecision:{invoked:true,status:'COMPLETE'},truthDecision:{invoked:true,status:'COMPLETE'},
  jevDecision:{invoked:false,status:'SKIPPED',reasonCode:'DETERMINISTIC_EVIDENCE_SUFFICIENT'},precisionDecision:{invoked:true,status:'COMPLETE'},gatherDecision:{invoked:true,status:'COMPLETE'},
});
const scatterOne=()=>({kind:'ScatterReceipt',id:'scatter:418',turnId:'turn:418',correlationId:'corr:418',jobs:[
  {jobId:'job:historian',capability:'Historian',state:'COMPLETE',resourceId:'resource:1',provider:'fixture',model:'fixture'},
  {jobId:'job:graph',capability:'Graph Walker',state:'COMPLETE',resourceId:'resource:1',provider:'fixture',model:'fixture'},
  {jobId:'job:truth',capability:'Truth',state:'COMPLETE',resourceId:'resource:1',provider:'fixture',model:'fixture'},
  {jobId:'job:precision',capability:'Precision',state:'COMPLETE',resourceId:'resource:1',provider:'fixture',model:'fixture'},
]});

export function wave8HotOnlyFixture(){
  return{scene:scene(),lore:lore(),cognitiveChoiceReceipt:{...choiceBase(),brainChoice:'Hot Cognition',candidateJobs:[{jobId:'job:hot',capability:'Hot Cognition'},{jobId:'job:historian',capability:'Historian'},{jobId:'job:jev',capability:'Jev'},{jobId:'job:precision',capability:'Precision'}],admittedJobs:[{jobId:'job:hot',capability:'Hot Cognition',reasonCode:'CURRENT_WORKING_STATE_SUFFICIENT'}],skippedJobs:[{jobId:'job:historian',capability:'Historian',reasonCode:'CURRENT_WORKING_STATE_SUFFICIENT'},{jobId:'job:jev',capability:'Jev',reasonCode:'NO_BOUNDED_AMBIGUITY'},{jobId:'job:precision',capability:'Precision',reasonCode:'NO_RETRIEVAL_CANDIDATE_SET'}],deferredJobs:[],scatterDecision:{invoked:false,status:'SKIPPED',reasonCode:'NO_SIDECAR_WORK_REQUIRED'},retrievalDecision:{invoked:false,status:'SKIPPED',reasonCode:'CURRENT_WORKING_STATE_SUFFICIENT'},sensoryDecision:{invoked:false,status:'SKIPPED',reasonCode:'CURRENT_WORKING_STATE_SUFFICIENT'},truthDecision:{invoked:false,status:'SKIPPED',reasonCode:'NO_LONG_TERM_EVIDENCE'},jevDecision:{invoked:false,status:'SKIPPED',reasonCode:'NO_BOUNDED_AMBIGUITY'},precisionDecision:{invoked:false,status:'SKIPPED',reasonCode:'NO_RETRIEVAL_CANDIDATE_SET'}},gather:{...gather(),results:[{resultId:'result:hot',capability:'Hot Cognition',status:'ADMITTED',accepted:true,evidenceRefs:['hot:scene:19'],freshness:'FRESH'}],admittedEvidenceRefs:['hot:scene:19']},seal:seal({admittedResultIds:['result:hot']}),promptPlan:promptPlan()};
}
export function wave8RetrievalHeavyFixture(){return{scene:scene(),lore:lore(),cognitiveChoiceReceipt:heavyChoice(),scatter:scatterOne(),sensory:sensory(),truth:truthHeavy(),precision:precision(),gather:gather(),seal:seal(),promptPlan:promptPlan()};}
export function wave8AmbiguousFixture(){
  const choice={...heavyChoice(),brainChoice:['Historian','Graph Walker','Truth','Jev'],admittedJobs:[...heavyChoice().admittedJobs.filter(x=>x.capability!=='Precision'),{jobId:'job:jev',capability:'Jev',reasonCode:'BOUNDED_AMBIGUITY_REMAINS'}],skippedJobs:heavyChoice().skippedJobs.filter(x=>x.capability!=='Jev'),jevDecision:{invoked:true,status:'INVOKED',reasonCode:'BOUNDED_AMBIGUITY_REMAINS'},precisionDecision:{invoked:false,status:'SKIPPED',reasonCode:'AMBIGUITY_NOT_RANKING_PROBLEM'}};
  return{scene:scene(),lore:lore(),cognitiveChoiceReceipt:choice,scatter:{...scatterOne(),jobs:[...scatterOne().jobs.filter(x=>x.capability!=='Precision'),{jobId:'job:jev',capability:'Jev',state:'COMPLETE',resourceId:'resource:1'}]},sensory:sensory(),truth:truthAmbiguous(),corrective:{kind:'CorrectiveRetrievalReceipt',id:'corrective:1',executed:true,failed:false,terminated:true,attempt:1,maxAttempts:1,reason:'current Sun Blade location remains disputed',initialQuality:'MIXED',finalQuality:'MIXED',candidateCount:7},jev:{kind:'JevDecisionReceipt',id:'jev:418',outcome:'ABSTAINED',invoked:true,reasonCode:'EVIDENCE_INSUFFICIENT_FOR_SAFE_DECISION',decisionType:'BOUNDED_AMBIGUITY',options:[{optionId:'destroyed',label:'Destroyed in fire'},{optionId:'removed',label:'Removed before fire'}],selectedOptionIds:[],rejectedOptionIds:[],evidenceRefs:['claim:blade-destroyed','claim:blade-removed'],unresolvedFactors:['No fresh possession/location observation'],revisionFence:{worldRevision:52,sceneRevision:19,sourceRevisionRefs:['lore:r6']},confidence:.63,requiresOwnerSettlement:true,requiresOperatorReview:false,ownerSettlement:{status:'NO_MUTATION'}},gather:gather(),seal:seal(),promptPlan:promptPlan()};
}
export function wave8DegradedFixture(){
  const choice={...heavyChoice(),brainChoice:['Historian','Truth','Jev','Green Room'],jevDecision:{invoked:true,status:'INVOKED',reasonCode:'BOUNDED_AMBIGUITY_REMAINS'},precisionDecision:{invoked:false,status:'SKIPPED',reasonCode:'FALLBACK_ORDERING_USED'}};
  return{scene:scene(),lore:lore(),cognitiveChoiceReceipt:choice,scatter:{kind:'ScatterReceipt',id:'scatter:degraded',jobs:[{jobId:'job:historian',capability:'Historian',state:'COMPLETE',resourceId:'resource:1'},{jobId:'job:green',capability:'Green Room',state:'COMPLETE',resourceId:'resource:1'}]},sensory:{...sensory(),freshness:'FRESH',fusionReceipt:fusion({degradedChannels:['DENSE']})},truth:truthAmbiguous(),corrective:{kind:'CorrectiveRetrievalReceipt',id:'corrective:degraded',executed:true,failed:true,terminated:true,attempt:1,maxAttempts:1,reason:'corrective retrieval timed out',initialQuality:'MIXED',finalQuality:'MIXED'},gather:{kind:'GatherReceipt',id:'gather:degraded',turnId:'turn:418',generationId:'gen:418',correlationId:'corr:418',results:[
    {resultId:'result:historian',capability:'Historian',status:'ADMITTED',accepted:true,evidenceRefs:['claim:blade-left'],freshness:'FRESH'},
    {resultId:'result:scene-r18',capability:'Scene result',status:'STALE',accepted:false,reason:'scene revision mismatch',evidenceRefs:['scene:r18'],freshness:'STALE',sceneRevision:18},
    {resultId:'result:green-late',capability:'Green Room',status:'LATE',accepted:false,reason:'turn already sealed; routed to NEXT_TURN',evidenceRefs:['green:418'],freshness:'FRESH',late:true,destination:'NEXT_TURN'},
    {resultId:'result:malformed',capability:'Graph reasoning',status:'INVALID',accepted:false,reason:'structured result failed validation',evidenceRefs:[],freshness:'INVALID'},
  ],admittedEvidenceRefs:['claim:blade-left'],rejectedResultIds:['result:scene-r18','result:green-late','result:malformed']},seal:seal({admittedResultIds:['result:historian'],rejectedResultIds:['result:malformed'],staleResultIds:['result:scene-r18']}),promptPlan:promptPlan()};
}
export function wave8MultiResourceFixture(){const f=wave8RetrievalHeavyFixture();f.scatter={...f.scatter,jobs:f.scatter.jobs.map((x,i)=>({...x,resourceId:i<2?'resource:1':'resource:2'}))};return f;}
export function wave8LargeFixture(count=10000){
  const f=wave8RetrievalHeavyFixture();
  f.cognitiveChoiceReceipt={...f.cognitiveChoiceReceipt,candidateJobs:Array.from({length:count},(_,i)=>({jobId:'job:'+i,capability:'Candidate '+i})),admittedJobs:Array.from({length:Math.min(count,500)},(_,i)=>({jobId:'job:'+i,capability:'Admitted '+i,reasonCode:'FIXTURE_ADMISSION'}))};
  f.sensory={...f.sensory,candidates:Array.from({length:count},(_,i)=>({candidateId:'cand:'+i,evidenceIdentity:'e:'+i,channelNominations:[{channelId:i%2?'SPARSE':'DENSE'}],authorityClass:'UNRESOLVED',truthStatusHint:'UNKNOWN',freshness:'FRESH',sourceRevisionRefs:['lore:r6']})),candidateCount:count,fusionReceipt:{...f.sensory.fusionReceipt,inputNominationCount:count*2,deduplicatedCandidateCount:count,duplicateNominationCount:count}};
  f.gather={...f.gather,results:Array.from({length:count},(_,i)=>({resultId:'result:'+i,capability:'Result '+i,status:i%97===0?'STALE':'ADMITTED',accepted:i%97!==0,evidenceRefs:['e:'+i],freshness:i%97===0?'STALE':'FRESH'}))};
  return f;
}
