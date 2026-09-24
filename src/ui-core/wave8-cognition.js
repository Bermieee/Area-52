import { ProductDataMode, Wave6Health, clone, createProductSourceStatus, deepFreeze, normalizeWave6Health } from './wave6-contracts.js';

export const CognitionStageState=Object.freeze({
  ACTIVE:'ACTIVE',COMPLETE:'COMPLETE',SKIPPED:'SKIPPED',DEFERRED:'DEFERRED',UNAVAILABLE:'UNAVAILABLE',
  DEGRADED:'DEGRADED',STALE:'STALE',INVALID:'INVALID',FAILED:'FAILED',
});
export const CognitionStageId=Object.freeze({
  SCENE:'SCENE',CHOICE:'COGNITIVE_CHOICE',SCATTER:'SCATTER',SENSORY:'SENSORY',RETRIEVAL_QUALITY:'RETRIEVAL_QUALITY',
  TRUTH:'TRUTH',JEV:'JEV',PRECISION:'PRECISION',GATHER:'GATHER',CONTEXT_SEAL:'CONTEXT_SEAL',PROMPT_PLAN:'PROMPT_PLAN',
});
export const RetrievalQuality=Object.freeze({HIGH:'HIGH',MIXED:'MIXED',LOW:'LOW'});
export const JevOutcome=Object.freeze({
  DECIDED:'DECIDED',PARTIAL:'PARTIAL',UNRESOLVED:'UNRESOLVED',ABSTAINED:'ABSTAINED',ESCALATE_OWNER:'ESCALATE_OWNER',
  REQUEST_OPERATOR:'REQUEST_OPERATOR',STALE:'STALE',INVALID:'INVALID',
});
const STATES=new Set(Object.values(CognitionStageState));
const TRUTH=new Set(['CURRENT','HISTORICAL','SUPERSEDED','CONTRADICTED','UNCERTAIN','UNRESOLVED','UNKNOWN']);
const JEV=new Set(Object.values(JevOutcome));
const QUALITY=new Set(Object.values(RetrievalQuality));
const safeArray=(v)=>Array.isArray(v)?clone(v):[];
const stringOrNull=(v)=>v==null?null:String(v);
const reasonOf=(x)=>x?.reason??x?.reasonCode??x?.explanation??x?.diagnostics?.reason??x?.metadata?.reason??null;

export function createStage({id,label,state=CognitionStageState.UNAVAILABLE,summary='',reason=null,health=null,receiptRef=null,details=null}={}){
  if(!Object.values(CognitionStageId).includes(id))throw new TypeError(`Unsupported cognition stage: ${id}`);
  if(!STATES.has(state))throw new TypeError(`Unsupported cognition stage state: ${state}`);
  return deepFreeze({kind:'CognitionStage',id,label:label??human(id),state,summary:String(summary??''),reason:reason==null?null:String(reason),health:health??stateHealth(state),receiptRef:receiptRef??null,details:clone(details??null)});
}

export function normalizeCognitiveChoiceReceipt(receipt){
  if(!receipt)return null;
  const candidateJobs=safeArray(receipt.candidateJobs??receipt.candidateCognitionOptions??receipt.options??receipt.candidates).map(normalizeJobCandidate);
  const admitted=safeArray(receipt.admittedJobs??receipt.admitted??receipt.selectedJobs).map(x=>normalizeJobDecision(x,'ADMITTED'));
  const skipped=safeArray(receipt.skippedJobs??receipt.skipped??receipt.rejectedJobs).map(x=>normalizeJobDecision(x,'SKIPPED'));
  const deferred=safeArray(receipt.deferredJobs??receipt.deferred??receipt.backgroundJobs).map(x=>normalizeJobDecision(x,'DEFERRED'));
  const status=receipt.status??receipt.state??'COMPLETE';
  const executionResources=safeArray(receipt.executionResources??receipt.resources??receipt.assignments).map(normalizeResource);
  const jevDecision=normalizeOptionalDecision(receipt.jev??receipt.jevDecision??receipt.jevStatus);
  const precisionDecision=normalizeOptionalDecision(receipt.precision??receipt.precisionDecision??receipt.precisionStatus);
  const retrievalDecision=normalizeOptionalDecision(receipt.retrieval??receipt.retrievalDecision??receipt.retrievalStatus);
  const sensoryDecision=normalizeOptionalDecision(receipt.sensory??receipt.sensoryDecision??receipt.sensoryStatus);
  const truthDecision=normalizeOptionalDecision(receipt.truth??receipt.truthDecision??receipt.truthStatus);
  const scatterDecision=normalizeOptionalDecision(receipt.scatter??receipt.scatterDecision??receipt.scatterStatus);
  const gatherDecision=normalizeOptionalDecision(receipt.gather??receipt.gatherDecision??receipt.gatherStatus);
  return deepFreeze({
    kind:'NormalizedCognitiveChoiceReceipt',sourceKind:receipt.kind??'CognitiveChoiceReceipt',receiptId:stringOrNull(receipt.receiptId??receipt.id),
    turnId:stringOrNull(receipt.turnId),generationId:stringOrNull(receipt.generationId),correlationId:stringOrNull(receipt.correlationId),causationId:stringOrNull(receipt.causationId),
    status,brainChoice:humanChoice(receipt.brainChoice??receipt.chosenPath??receipt.choice??admitted.map(x=>x.capability)),
    candidateJobs,admitted,skipped,deferred,executionResources,retrievalIntents:safeArray(receipt.retrievalIntents),sensoryChannels:safeArray(receipt.sensoryChannels),
    jevDecision,precisionDecision,retrievalDecision,sensoryDecision,truthDecision,scatterDecision,gatherDecision,abstentions:safeArray(receipt.abstentions),generationEvidenceRefs:safeArray(receipt.generationEvidenceRefs??receipt.finalEvidenceRefs),
    resourceBudget:clone(receipt.resourceBudget??receipt.latencyBudget??receipt.budget??null),revisionIdentity:clone(receipt.revisionIdentity??{
      worldRevision:receipt.worldRevision??null,sceneRevision:receipt.sceneRevision??null,sourceRevisionRefs:safeArray(receipt.sourceRevisionRefs??receipt.sourceRevisionIds),
    }),reason:reasonOf(receipt),authority:'READ_ONLY',mutationAuthority:false,
  });
}

export function normalizeScatterReceipt(receipt,choice=null){
  if(!receipt)return null;
  const jobs=safeArray(receipt.jobs??receipt.executions??receipt.assignments).map(row=>({
    jobId:stringOrNull(row.jobId??row.taskId??row.id),capability:human(row.capability??row.jobType??row.taskType??row.kind??'Cognitive job'),
    state:String(row.state??row.status??'UNKNOWN'),resourceId:stringOrNull(row.resourceId??row.workerId??row.executionResourceId),provider:stringOrNull(row.provider??row.providerId),
    model:stringOrNull(row.model??row.modelId),reason:reasonOf(row),correlationId:stringOrNull(row.correlationId),causationId:stringOrNull(row.causationId),
  }));
  return deepFreeze({kind:'NormalizedScatterReceipt',receiptId:stringOrNull(receipt.receiptId??receipt.id),turnId:stringOrNull(receipt.turnId??choice?.turnId),correlationId:stringOrNull(receipt.correlationId??choice?.correlationId),jobs,resourceCount:new Set(jobs.map(x=>x.resourceId).filter(Boolean)).size,authority:'READ_ONLY',mutationAuthority:false});
}

export function normalizeSensoryReceipt(input){
  if(!input)return null;
  const envelope=input.envelope??input.candidateBusEnvelope??(input.kind==='CandidateBusEnvelope'?input:null);
  const fusion=input.fusionReceipt??envelope?.fusionReceipt??(input.kind==='CandidateFusionReceipt'?input:null);
  const trace=input.trace??input.sensoryTrace??null;
  if(!envelope&&!fusion&&!trace)return null;
  const candidates=safeArray(envelope?.candidates??trace?.candidates);
  const perChannel=clone(fusion?.perChannelCounts??trace?.perChannelCounts??trace?.channels??{});
  const inputNominations=Number(fusion?.inputNominationCount??trace?.inputNominationCount??trace?.nominations??0);
  const unique=Number(fusion?.deduplicatedCandidateCount??envelope?.candidateCount??trace?.uniqueCandidates??trace?.uniqueCount??0);
  const duplicate=Number(fusion?.duplicateNominationCount??trace?.duplicateNominationCount??Math.max(0,inputNominations-unique));
  const freshness=envelope?.freshness??fusion?.freshness??trace?.freshness??'UNKNOWN';
  const unhealthy=[...(fusion?.unavailableChannels??envelope?.unavailableChannels??[]),...(fusion?.degradedChannels??envelope?.degradedChannels??[])];
  const state=freshness==='STALE'?CognitionStageState.STALE:freshness==='INVALID'?CognitionStageState.INVALID:unhealthy.length?CognitionStageState.DEGRADED:CognitionStageState.COMPLETE;
  return deepFreeze({
    kind:'NormalizedSensoryReceipt',receiptId:stringOrNull(fusion?.candidateSetId??envelope?.candidateSetId??trace?.receiptId??trace?.id),
    state,inputNominationCount:inputNominations,uniqueCandidateCount:unique,duplicateNominationCount:duplicate,perChannelCounts:perChannel,
    inputChannelCount:Number(fusion?.inputChannelCount??Object.keys(perChannel).length),boundedOutCount:Number(fusion?.boundedOutCount??0),
    staleNominationCount:Number(fusion?.staleNominationCount??0),invalidNominationCount:Number(fusion?.invalidNominationCount??0),
    unavailableChannels:safeArray(fusion?.unavailableChannels??envelope?.unavailableChannels),degradedChannels:safeArray(fusion?.degradedChannels??envelope?.degradedChannels),
    retrievalIntentIds:safeArray(envelope?.retrievalIntentIds??fusion?.retrievalIntentIds??trace?.retrievalIntentIds),
    sourceRevisionRefs:safeArray(envelope?.sourceRevisionSet??trace?.sourceRevisionRefs),worldRevision:envelope?.worldRevision??trace?.worldRevision??null,
    sceneRevision:envelope?.sceneRevision??trace?.sceneRevision??null,candidates:candidates.map(normalizeSensoryCandidate),fusionPolicyVersion:fusion?.fusionPolicyVersion??null,
    authority:'READ_ONLY',mutationAuthority:false,
  });
}

export function normalizeTruthAssessment(assessment){
  if(!assessment)return null;
  const quality=assessment.confidence??assessment.retrievalQuality??assessment.quality??null;
  const truthRows=safeArray(assessment.truthResults??assessment.results??assessment.classifications).map(row=>{
    const classification=String(row.classification??row.truthStatus??row.status??'UNKNOWN').toUpperCase();
    return deepFreeze({candidateId:stringOrNull(row.candidateId??row.id),classification:TRUTH.has(classification)?classification:'UNKNOWN',
      usableForIntent:row.usableForIntent==null?null:Boolean(row.usableForIntent),reasons:safeArray(row.reasons??(row.reason?[row.reason]:[])),claimIds:safeArray(row.claimIds),provenance:clone(row.provenance??null)});
  });
  const counts=Object.fromEntries([...TRUTH].map(x=>[x,0]));for(const row of truthRows)counts[row.classification]=(counts[row.classification]??0)+1;
  const corrective=assessment.correctiveRequest?deepFreeze({
    requestId:stringOrNull(assessment.correctiveRequest.id??assessment.correctiveRequest.requestId),reason:reasonOf(assessment.correctiveRequest),
    requestedAction:assessment.correctiveRequest.requestedAction??null,attempt:Number(assessment.correctiveRequest.attempt??1),
    maxAttempts:Number(assessment.correctiveRequest.maxAttempts??1),sourceRevisionRefs:safeArray(assessment.correctiveRequest.sourceRevisionIds),
    worldRevision:assessment.correctiveRequest.worldRevision??null,sceneRevision:assessment.correctiveRequest.sceneRevision??null,
  }):null;
  return deepFreeze({
    kind:'NormalizedTruthAssessment',receiptId:stringOrNull(assessment.id??assessment.receiptId),query:stringOrNull(assessment.query),intent:stringOrNull(assessment.intent),
    retrievalQuality:QUALITY.has(String(quality).toUpperCase())?String(quality).toUpperCase():null,reason:reasonOf(assessment),truthRows,counts,corrective,
    admittedCandidateIds:safeArray(assessment.admittedCandidateIds),supportCandidateIds:safeArray(assessment.supportCandidateIds),
    authority:'READ_ONLY',mutationAuthority:false,
  });
}

export function normalizeCorrectiveRetrievalReceipt(receipt,truth=null){
  if(!receipt&&!truth?.corrective)return null;
  const source=receipt??truth.corrective;
  const state=source.failed?CognitionStageState.DEGRADED:source.executed===false?CognitionStageState.SKIPPED:source.executed===true?CognitionStageState.COMPLETE:CognitionStageState.UNAVAILABLE;
  return deepFreeze({
    kind:'NormalizedCorrectiveRetrievalReceipt',receiptId:stringOrNull(source.receiptId??source.id??source.requestId),state,
    executed:source.executed==null?null:Boolean(source.executed),failed:Boolean(source.failed),terminated:source.terminated==null?null:Boolean(source.terminated),
    attempt:Number(source.attempt??source.request?.attempt??truth?.corrective?.attempt??0)||null,maxAttempts:Number(source.maxAttempts??source.request?.maxAttempts??truth?.corrective?.maxAttempts??0)||null,
    reason:reasonOf(source)??truth?.corrective?.reason??null,initialQuality:source.initialQuality??truth?.retrievalQuality??null,finalQuality:source.finalQuality??source.retrievalQuality??null,
    candidateCount:Number(source.candidateCount??source.candidates?.length??0),authority:'READ_ONLY',mutationAuthority:false,
  });
}

export function normalizeJevDecisionReceipt(receipt,choice=null){
  if(!receipt){
    const decision=choice?.jevDecision;if(!decision)return null;
    if(decision.invoked===false||decision.state==='SKIPPED'||decision.status==='SKIPPED')return deepFreeze({
      kind:'NormalizedJevDecisionReceipt',receiptId:null,state:CognitionStageState.SKIPPED,outcome:'SKIPPED',invoked:false,reason:decision.reason??decision.reasonCode??null,
      decisionType:null,options:[],selectedOptionIds:[],rejectedOptionIds:[],evidenceRefs:[],unresolvedFactors:[],revisionFence:null,confidence:null,
      requiresOwnerSettlement:null,requiresOperatorReview:null,ownerSettlement:null,provider:null,model:null,resourceId:null,authority:'READ_ONLY',mutationAuthority:false,
    });
    return null;
  }
  const rawOutcome=String(receipt.outcome??receipt.status??receipt.decisionStatus??'INVALID').toUpperCase();
  const outcome=JEV.has(rawOutcome)?rawOutcome:JevOutcome.INVALID;
  const state=outcome==='STALE'?CognitionStageState.STALE:outcome==='INVALID'?CognitionStageState.INVALID:CognitionStageState.COMPLETE;
  const selected=safeArray(receipt.selectedOptionIds??receipt.selectedOptions??(receipt.selectedOptionId?[receipt.selectedOptionId]:[])).map(x=>typeof x==='string'?x:x.optionId??x.id).filter(Boolean);
  const rejected=safeArray(receipt.rejectedOptionIds??receipt.rejectedOptions).map(x=>typeof x==='string'?x:x.optionId??x.id).filter(Boolean);
  return deepFreeze({
    kind:'NormalizedJevDecisionReceipt',receiptId:stringOrNull(receipt.receiptId??receipt.id),state,outcome,invoked:receipt.invoked==null?true:Boolean(receipt.invoked),
    reason:reasonOf(receipt),decisionType:stringOrNull(receipt.decisionType??receipt.requestType),options:safeArray(receipt.options??receipt.optionsConsidered),
    selectedOptionIds:selected,rejectedOptionIds:rejected,evidenceRefs:safeArray(receipt.evidenceRefs??receipt.evidenceIds),
    unresolvedFactors:safeArray(receipt.unresolvedFactors),revisionFence:clone(receipt.revisionFence??{
      worldRevision:receipt.worldRevision??null,sceneRevision:receipt.sceneRevision??null,sourceRevisionRefs:safeArray(receipt.sourceRevisionRefs??receipt.sourceRevisionIds),
    }),confidence:receipt.confidence==null?null:Number(receipt.confidence),
    requiresOwnerSettlement:receipt.requiresOwnerSettlement==null?null:Boolean(receipt.requiresOwnerSettlement),
    requiresOperatorReview:receipt.requiresOperatorReview==null?null:Boolean(receipt.requiresOperatorReview),
    ownerSettlement:clone(receipt.ownerSettlement??receipt.settlement??null),provider:stringOrNull(receipt.provider??receipt.providerId),model:stringOrNull(receipt.model??receipt.modelId),
    resourceId:stringOrNull(receipt.resourceId??receipt.workerId??receipt.executionResourceId),authority:'READ_ONLY',mutationAuthority:false,
  });
}

export function normalizePrecisionReceipt(receipt,choice=null){
  if(!receipt){
    const decision=choice?.precisionDecision;if(!decision)return null;
    if(decision.invoked===false||decision.state==='SKIPPED'||decision.status==='SKIPPED')return deepFreeze({
      kind:'NormalizedPrecisionReceipt',receiptId:null,state:CognitionStageState.SKIPPED,invoked:false,reason:decision.reason??decision.reasonCode??null,inputCount:null,outputCount:null,results:[],authority:'READ_ONLY',mutationAuthority:false,
    });
    return null;
  }
  const rows=Array.isArray(receipt)?receipt:safeArray(receipt.results??receipt.rankings??receipt.precisionResults);
  const freshness=receipt.freshness??(rows.some(x=>x.freshness==='STALE')?'STALE':'FRESH');
  const state=freshness==='STALE'?CognitionStageState.STALE:receipt.invalid?CognitionStageState.INVALID:receipt.failed?CognitionStageState.DEGRADED:CognitionStageState.COMPLETE;
  return deepFreeze({
    kind:'NormalizedPrecisionReceipt',receiptId:stringOrNull(receipt.receiptId??receipt.id),state,invoked:true,reason:reasonOf(receipt),
    inputCount:Number(receipt.inputCount??receipt.candidateCount??rows.length),outputCount:Number(receipt.outputCount??receipt.admittedCount??rows.length),
    results:rows.map(row=>({candidateId:stringOrNull(row.candidateId),finalRank:row.finalRank??null,rawScore:row.rawScore??null,normalizedScore:row.normalizedScore??null,
      freshness:row.freshness??null,sourceRevisionRefs:safeArray(row.sourceRevisionIds),worldRevision:row.worldRevision??null,sceneRevision:row.sceneRevision??null,
      modelProfileId:stringOrNull(row.modelProfileId),modelProfileRevision:stringOrNull(row.modelProfileRevision),runtimeProfile:stringOrNull(row.runtimeProfile),latencyMs:row.latencyMs??null})),
    authority:'READ_ONLY',mutationAuthority:false,
  });
}

export function normalizeGatherReceipt(receipt){
  if(!receipt)return null;
  const rows=safeArray(receipt.results??receipt.items??receipt.entries).map(row=>{
    const freshness=String(row.freshness??row.route?.freshness??'FRESH').toUpperCase(),late=Boolean(row.late??row.route?.late);
    const accepted=row.accepted??row.route?.accepted??row.admitted??false;
    const rawStatus=String(row.status??row.disposition??(late?'LATE':freshness==='STALE'?'STALE':freshness==='INVALID'?'INVALID':accepted?'ADMITTED':'REJECTED')).toUpperCase();
    const status=['ADMITTED','STALE','LATE','REJECTED','INVALID'].includes(rawStatus)?rawStatus:(accepted?'ADMITTED':'REJECTED');
    return deepFreeze({resultId:stringOrNull(row.resultId??row.id??row.result?.id),capability:human(row.capability??row.resultType??row.result?.resultType??row.sourceSubsystem??row.result?.sourceSubsystem??'Result'),
      status,accepted:Boolean(accepted)&&!['STALE','LATE','INVALID','REJECTED'].includes(status),reason:reasonOf(row)??row.route?.reason??row.rejectionReason??row.result?.rejectionReason??row.result?.staleReason??null,
      evidenceRefs:safeArray(row.evidenceRefs??row.evidenceIds??row.result?.evidenceIds),freshness,late,sourceSubsystem:stringOrNull(row.sourceSubsystem??row.result?.sourceSubsystem),
      taskId:stringOrNull(row.taskId??row.result?.taskId),resourceId:stringOrNull(row.resourceId??row.workerId??row.result?.workerId),correlationId:stringOrNull(row.correlationId??row.result?.correlationId),
      sourceRevisionRefs:safeArray(row.sourceRevisionRefs??row.sourceRevisionIds??row.result?.sourceRevisionIds),worldRevision:row.worldRevision??row.result?.worldRevision??null,
      sceneRevision:row.sceneRevision??row.result?.sceneRevision??null,destination:stringOrNull(row.destination??row.route?.effectiveDestination??row.result?.destination)});
  });
  const counts={ADMITTED:0,STALE:0,LATE:0,REJECTED:0,INVALID:0};for(const row of rows)counts[row.status]=(counts[row.status]??0)+1;
  return deepFreeze({
    kind:'NormalizedGatherReceipt',receiptId:stringOrNull(receipt.receiptId??receipt.id??receipt.gatherId),turnId:stringOrNull(receipt.turnId),generationId:stringOrNull(receipt.generationId),
    correlationId:stringOrNull(receipt.correlationId),state:receipt.failed?CognitionStageState.DEGRADED:CognitionStageState.COMPLETE,counts,results:rows,
    admittedEvidenceRefs:safeArray(receipt.admittedEvidenceRefs??receipt.generationEvidenceRefs??rows.filter(x=>x.accepted).flatMap(x=>x.evidenceRefs)),
    rejectedResultIds:safeArray(receipt.rejectedResultIds??rows.filter(x=>!x.accepted).map(x=>x.resultId).filter(Boolean)),
    reason:reasonOf(receipt),authority:'READ_ONLY',mutationAuthority:false,
  });
}

export function normalizeLoreStatus(model){
  if(!model)return null;
  return deepFreeze({
    kind:'NormalizedLoreStatus',sourceKind:model.kind??'LoreStatusReadModel',sourceEntryCount:numberOrNull(model.sourceEntryCount??model.sourceEntries??model.entryCount),
    learnedRepresentationCount:numberOrNull(model.learnedRepresentationCount??model.representationCount),learnedState:model.learnedState??model.representationsState??model.studyState??null,
    indexState:model.indexState??model.indexHealth??null,lastRevision:stringOrNull(model.lastRevision??model.revision??model.sourceRevision),
    sourceRevisionRefs:safeArray(model.sourceRevisionRefs),provenanceRefs:safeArray(model.provenanceRefs),health:clone(model.health??null),authority:'READ_ONLY',mutationAuthority:false,
  });
}

export function buildLiveCognitionPath({
  scene=null,hotCognition=null,choice=null,scatter=null,sensory=null,truth=null,corrective=null,jev=null,precision=null,gather=null,seal=null,promptPlan=null,lore=null,
  modes={},
}={}){
  const stages=[];
  stages.push(stageScene(scene,modes.scene));
  stages.push(stageChoice(choice,modes.choice));
  stages.push(stageScatter(scatter,choice,modes.scatter));
  stages.push(stageSensory(sensory,choice,modes.sensory));
  stages.push(stageRetrieval(truth,corrective,choice,modes.truth));
  stages.push(stageTruth(truth,choice,modes.truth));
  stages.push(stageJev(jev,modes.jev));
  stages.push(stagePrecision(precision,modes.precision));
  stages.push(stageGather(gather,choice,modes.gather));
  stages.push(stageSeal(seal,modes.seal));
  stages.push(stagePromptPlan(promptPlan,modes.promptPlan));
  const available=stages.filter(x=>x.state!==CognitionStageState.UNAVAILABLE);
  const degraded=available.some(x=>[CognitionStageState.DEGRADED,CognitionStageState.STALE,CognitionStageState.INVALID,CognitionStageState.FAILED].includes(x.state));
  const working=available.some(x=>x.state===CognitionStageState.ACTIVE);
  const availableModes=Object.values(modes??{}).filter(x=>x&&x!==ProductDataMode.UNAVAILABLE);const fixtureOnly=availableModes.length>0&&availableModes.every(x=>x===ProductDataMode.FIXTURE);
  const source=createProductSourceStatus({
    mode:available.length?(fixtureOnly?ProductDataMode.FIXTURE:degraded?ProductDataMode.DEGRADED:ProductDataMode.LIVE):ProductDataMode.UNAVAILABLE,
    health:available.length?(degraded?Wave6Health.DEGRADED:working?Wave6Health.WORKING:Wave6Health.READY):Wave6Health.UNAVAILABLE,
    label:'Live Brain Cognition',impact:available.length?(degraded?'Brain cognition is visible with contained degraded/stale/invalid work.':'Recorded cognitive path is available for inspection.'):'No live cognitive-path producer is connected.',
    producer:'Wave8 cognitive receipt adapters',
  });
  return deepFreeze({
    kind:'LiveBrainCognitionPath',source,turnId:first(choice?.turnId,gather?.turnId,seal?.turnId),generationId:first(choice?.generationId,gather?.generationId,promptPlan?.generationId),
    correlationId:first(choice?.correlationId,gather?.correlationId,seal?.correlationId),scene:clone(scene),hotCognition:clone(hotCognition),choice:clone(choice),scatter:clone(scatter),
    sensory:clone(sensory),truth:clone(truth),corrective:clone(corrective),jev:clone(jev),precision:clone(precision),gather:clone(gather),seal:clone(seal),promptPlan:clone(promptPlan),lore:clone(lore),
    stages,summary:buildNormalSummary({choice,sensory,truth,jev,precision,gather,seal,promptPlan}),authority:'READ_ONLY',mutationAuthority:false,
  });
}

export function sourceModeForReceipt(value,explicitMode=null){
  if(explicitMode)return explicitMode;
  return value?ProductDataMode.LIVE:ProductDataMode.UNAVAILABLE;
}

function normalizeJobCandidate(row,index){if(typeof row==='string')return deepFreeze({jobId:null,capability:human(row),reason:null,priority:null,index});return deepFreeze({jobId:stringOrNull(row.jobId??row.taskId??row.id),capability:human(row.capability??row.jobType??row.taskType??row.name??row.kind??`Candidate ${index+1}`),reason:reasonOf(row),priority:row.priority??null,index});}
function normalizeJobDecision(row,disposition){if(typeof row==='string')return deepFreeze({jobId:null,capability:human(row),disposition,reason:null,resourceId:null,provider:null,model:null,state:null});return deepFreeze({jobId:stringOrNull(row.jobId??row.taskId??row.id),capability:human(row.capability??row.jobType??row.taskType??row.name??row.kind??'Cognitive job'),disposition,reason:reasonOf(row),resourceId:stringOrNull(row.resourceId??row.workerId??row.executionResourceId),provider:stringOrNull(row.provider??row.providerId),model:stringOrNull(row.model??row.modelId),state:row.state??row.status??null});}
function normalizeResource(row){if(typeof row==='string')return deepFreeze({resourceId:row,jobs:[]});return deepFreeze({resourceId:stringOrNull(row.resourceId??row.workerId??row.id),provider:stringOrNull(row.provider??row.providerId),model:stringOrNull(row.model??row.modelId),jobs:safeArray(row.jobs??row.taskIds).map(String),state:row.state??row.status??null});}
function normalizeOptionalDecision(value){if(value==null)return null;if(typeof value==='boolean')return deepFreeze({invoked:value,state:value?'INVOKED':'SKIPPED',reason:null});if(typeof value==='string')return deepFreeze({invoked:value!=='SKIPPED',state:value,reason:null});return deepFreeze({invoked:value.invoked==null?null:Boolean(value.invoked),state:value.state??value.status??null,reason:reasonOf(value),reasonCode:value.reasonCode??null});}
function normalizeSensoryCandidate(row){return deepFreeze({candidateId:stringOrNull(row.candidateId??row.id),evidenceIdentity:stringOrNull(row.evidenceIdentity),channelCount:safeArray(row.channelNominations??row.nominatedBy).length,channels:safeArray(row.channelNominations??row.nominatedBy).map(x=>typeof x==='string'?x:x.channelId??x.id).filter(Boolean),authority:row.authorityClass??row.authority??'UNKNOWN',truthStatusHint:row.truthStatusHint??row.truthStatus??'UNKNOWN',freshness:row.freshness??'UNKNOWN',fusionScore:row.fusionScore??null,sourceRevisionRefs:safeArray(row.sourceRevisionRefs),evidenceRefs:safeArray(row.evidenceRefs),claimRefs:safeArray(row.claimRefs??row.claimIds),graphMetadata:clone(row.graphMetadata??null),rankSignals:clone(row.rankSignals??row.scoreSignals??{})});}
function stageScene(scene,mode){if(!scene)return createStage({id:CognitionStageId.SCENE,label:'Scene',state:CognitionStageState.UNAVAILABLE,summary:'Scene Intelligence unavailable.'});const health=normalizeWave6Health(scene.health?.state??scene.source?.health??'READY',{fallback:Wave6Health.READY});return createStage({id:CognitionStageId.SCENE,label:'Scene',state:health===Wave6Health.STALE?CognitionStageState.STALE:health===Wave6Health.DEGRADED?CognitionStageState.DEGRADED:health===Wave6Health.UNAVAILABLE?CognitionStageState.UNAVAILABLE:CognitionStageState.COMPLETE,summary:`${scene.title??scene.location??scene.sceneId??'Current Scene'}${scene.revision!=null?` · r${scene.revision}`:''}`,details:{mode}});}
function stageChoice(x,mode){if(!x)return createStage({id:CognitionStageId.CHOICE,label:'Choice',state:CognitionStageState.UNAVAILABLE,summary:'Cognitive Choice receipt unavailable.'});return createStage({id:CognitionStageId.CHOICE,label:'Choice',state:mapStageState(x.status),summary:x.brainChoice?`Brain chose: ${x.brainChoice}`:`${x.admitted.length} jobs admitted`,reason:x.reason,receiptRef:x.receiptId,details:{mode}});}
function stageScatter(x,choice,mode){if(!x){const d=choice?.scatterDecision;if(isExplicitSkip(d))return createStage({id:CognitionStageId.SCATTER,label:'Scatter',state:CognitionStageState.SKIPPED,summary:'Skipped',reason:d.reason??d.reasonCode??null});return createStage({id:CognitionStageId.SCATTER,label:'Scatter',state:CognitionStageState.UNAVAILABLE,summary:'Scatter execution receipt unavailable.'});}const failed=x.jobs.some(j=>['FAILED','ERROR','INVALID'].includes(String(j.state).toUpperCase()));const active=x.jobs.some(j=>['ACTIVE','RUNNING','QUEUED'].includes(String(j.state).toUpperCase()));return createStage({id:CognitionStageId.SCATTER,label:'Scatter',state:failed?CognitionStageState.DEGRADED:active?CognitionStageState.ACTIVE:CognitionStageState.COMPLETE,summary:`${x.jobs.length} logical jobs across ${x.resourceCount} execution resource${x.resourceCount===1?'':'s'}`,receiptRef:x.receiptId,details:{mode}});}
function stageSensory(x,choice,mode){if(!x){const d=choice?.sensoryDecision??choice?.retrievalDecision;if(isExplicitSkip(d))return createStage({id:CognitionStageId.SENSORY,label:'Sensory',state:CognitionStageState.SKIPPED,summary:'Skipped',reason:d.reason??d.reasonCode??null});return createStage({id:CognitionStageId.SENSORY,label:'Sensory',state:CognitionStageState.UNAVAILABLE,summary:'Sensory/Candidate Bus receipt unavailable.'});}return createStage({id:CognitionStageId.SENSORY,label:'Sensory',state:x.state,summary:`${x.inputNominationCount} nominations → ${x.uniqueCandidateCount} unique`,receiptRef:x.receiptId,details:{mode}});}
function stageRetrieval(truth,corrective,choice,mode){if(!truth){const d=choice?.retrievalDecision;if(isExplicitSkip(d))return createStage({id:CognitionStageId.RETRIEVAL_QUALITY,label:'Retrieval',state:CognitionStageState.SKIPPED,summary:'Skipped',reason:d.reason??d.reasonCode??null});return createStage({id:CognitionStageId.RETRIEVAL_QUALITY,label:'Retrieval',state:CognitionStageState.UNAVAILABLE,summary:'Retrieval-quality receipt unavailable.'});}let suffix='';if(truth.retrievalQuality==='MIXED'&&corrective){suffix=corrective.executed?' · corrected once':corrective.state===CognitionStageState.SKIPPED?' · correction skipped':'';}return createStage({id:CognitionStageId.RETRIEVAL_QUALITY,label:'Retrieval',state:truth.retrievalQuality?CognitionStageState.COMPLETE:CognitionStageState.UNAVAILABLE,summary:`${truth.retrievalQuality??'UNAVAILABLE'}${suffix}`,reason:truth.reason,receiptRef:truth.receiptId,details:{mode}});}
function stageTruth(x,choice,mode){if(!x){const d=choice?.truthDecision;if(isExplicitSkip(d))return createStage({id:CognitionStageId.TRUTH,label:'Truth',state:CognitionStageState.SKIPPED,summary:'Skipped',reason:d.reason??d.reasonCode??null});return createStage({id:CognitionStageId.TRUTH,label:'Truth',state:CognitionStageState.UNAVAILABLE,summary:'Truth assessment unavailable.'});}const rows=Object.entries(x.counts).filter(([,n])=>n>0).map(([k,n])=>`${n} ${k}`);return createStage({id:CognitionStageId.TRUTH,label:'Truth',state:CognitionStageState.COMPLETE,summary:rows.join(' · ')||'No classified candidates',receiptRef:x.receiptId,details:{mode}});}
function stageJev(x,mode){if(!x)return createStage({id:CognitionStageId.JEV,label:'Jev',state:CognitionStageState.UNAVAILABLE,summary:'Jev decision receipt unavailable.'});return createStage({id:CognitionStageId.JEV,label:'Jev',state:x.state,summary:x.outcome==='SKIPPED'?'Skipped':x.outcome,reason:x.reason,receiptRef:x.receiptId,details:{mode}});}
function stagePrecision(x,mode){if(!x)return createStage({id:CognitionStageId.PRECISION,label:'Precision',state:CognitionStageState.UNAVAILABLE,summary:'Precision receipt unavailable.'});return createStage({id:CognitionStageId.PRECISION,label:'Precision',state:x.state,summary:x.state===CognitionStageState.SKIPPED?'Skipped':`${x.inputCount??x.results.length} candidates → ${x.outputCount??x.results.length}`,reason:x.reason,receiptRef:x.receiptId,details:{mode}});}
function stageGather(x,choice,mode){if(!x){const d=choice?.gatherDecision;if(isExplicitSkip(d))return createStage({id:CognitionStageId.GATHER,label:'Gather',state:CognitionStageState.SKIPPED,summary:'Skipped',reason:d.reason??d.reasonCode??null});return createStage({id:CognitionStageId.GATHER,label:'Gather',state:CognitionStageState.UNAVAILABLE,summary:'Gather receipt unavailable.'});}return createStage({id:CognitionStageId.GATHER,label:'Gather',state:x.state,summary:`${x.counts.ADMITTED} admitted · ${x.counts.STALE} stale · ${x.counts.LATE} late · ${x.counts.REJECTED+x.counts.INVALID} rejected/invalid`,reason:x.reason,receiptRef:x.receiptId,details:{mode}});}
function stageSeal(x,mode){if(!x)return createStage({id:CognitionStageId.CONTEXT_SEAL,label:'Seal',state:CognitionStageState.UNAVAILABLE,summary:'Context Seal unavailable.'});return createStage({id:CognitionStageId.CONTEXT_SEAL,label:'Seal',state:x.sealedState===false?CognitionStageState.FAILED:CognitionStageState.COMPLETE,summary:x.sealedState===false?'UNSEALED':`SEALED · ${x.admittedResultIds.length} admitted`,receiptRef:x.sealId,details:{mode}});}
function stagePromptPlan(x,mode){if(!x)return createStage({id:CognitionStageId.PROMPT_PLAN,label:'PromptPlan',state:CognitionStageState.UNAVAILABLE,summary:'PromptPlan unavailable.'});const source=x.source??null;return createStage({id:CognitionStageId.PROMPT_PLAN,label:'PromptPlan',state:source?.mode===ProductDataMode.DEGRADED?CognitionStageState.DEGRADED:CognitionStageState.COMPLETE,summary:`${x.totalTokens??x.usedOrEstimatedTokens??0} tokens · ${x.promptPlanId??'plan'}`,receiptRef:x.promptPlanId,details:{mode}});}
function buildNormalSummary({choice,sensory,truth,jev,precision,gather,seal,promptPlan}){return deepFreeze({brainChoice:choice?.brainChoice??null,jobs:choice?{candidate:choice.candidateJobs.length,admitted:choice.admitted.length,skipped:choice.skipped.length,deferred:choice.deferred.length}:null,sensory:sensory?{nominations:sensory.inputNominationCount,unique:sensory.uniqueCandidateCount}:null,retrievalQuality:truth?.retrievalQuality??null,truthCounts:truth?.counts??null,jev:jev?{state:jev.state,outcome:jev.outcome}:null,precision:precision?{state:precision.state,input:precision.inputCount,output:precision.outputCount}:null,gather:gather?.counts??null,seal:seal?{sealed:Boolean(seal.sealedState),admitted:seal.admittedResultIds.length,stale:seal.staleResultIds.length,late:seal.lateResultIds.length,rejected:seal.rejectedResultIds.length}:null,promptPlan:promptPlan?{id:promptPlan.promptPlanId,tokens:promptPlan.totalTokens??promptPlan.usedOrEstimatedTokens??null}:null});}
function mapStageState(value){const x=String(value??'COMPLETE').toUpperCase();if(STATES.has(x))return x;if(['READY','DONE','SUCCESS','SUCCEEDED','DECIDED'].includes(x))return CognitionStageState.COMPLETE;if(['RUNNING','WORKING','QUEUED'].includes(x))return CognitionStageState.ACTIVE;if(['ERROR'].includes(x))return CognitionStageState.FAILED;return CognitionStageState.COMPLETE;}
function stateHealth(state){if(state===CognitionStageState.ACTIVE)return Wave6Health.WORKING;if([CognitionStageState.DEGRADED,CognitionStageState.STALE].includes(state))return Wave6Health.DEGRADED;if([CognitionStageState.INVALID,CognitionStageState.FAILED].includes(state))return Wave6Health.BLOCKED;if(state===CognitionStageState.UNAVAILABLE)return Wave6Health.UNAVAILABLE;return Wave6Health.READY;}
function humanChoice(v){if(Array.isArray(v))return v.map(human).join(' + ');return v==null?null:human(v);}
function human(v){return String(v??'').trim().replace(/[_:-]+/g,' ').replace(/\b\w/g,m=>m.toUpperCase());}
function isExplicitSkip(v){return Boolean(v&&(v.invoked===false||String(v.state??v.status??'').toUpperCase()==='SKIPPED'));}
function numberOrNull(v){if(v==null)return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function first(...v){return v.find(x=>x!=null)??null;}
