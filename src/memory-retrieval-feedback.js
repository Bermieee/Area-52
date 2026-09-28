import {stableHash} from './browser-runtime-utils.js';

const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();
const artifactIdOf=(ref)=>typeof ref==='string'?ref:(ref?.artifactId??ref?.id??null);
const artifactRevisionOf=(nomination)=>Number(nomination?.artifactRevision??nomination?.artifactRef?.revision??1)||1;
const MAX_OUTCOMES=64;
const MAX_REASON_CODES=16;

function truthOutcome(candidate,truth,publicationAssessment,trace){
  const admitted=new Set([
    ...(publicationAssessment?.admittedCandidateIds??[]),
    ...(publicationAssessment?.supportCandidateIds??[]),
  ].map(String));
  if(String(candidate?.freshness??'').toUpperCase()!=='FRESH'){
    return{outcome:'REJECTED_STALE_OR_INVALID',stage:'CANDIDATE_BUS',signal:'NONE',reasonCodes:['CANDIDATE_NOT_FRESH']};
  }
  if(!truth)return{outcome:'OUTCOME_UNKNOWN',stage:'TRUTH',signal:'NONE',reasonCodes:['TRUTH_RECEIPT_ABSENT']};
  if(truth.usableForIntent===false){
    const reasons=uniq(truth.reasons??[]);
    const classification=String(truth.classification??truth.temporalStatus??'UNKNOWN').toUpperCase();
    const temporalOrInvalid=['HISTORICAL','STALE','INVALID','REMOVED'].includes(classification)
      ||reasons.some(reason=>/historical|stale|invalid|foreign|scope|revision/i.test(reason));
    return{outcome:temporalOrInvalid?'REJECTED_TEMPORAL_OR_SCOPE':'REJECTED_RELEVANCE_QUALITY',stage:'TRUTH',
      signal:temporalOrInvalid?'NONE':'REJECTED',reasonCodes:reasons.length?reasons:['TRUTH_EXPLICIT_REJECTION']};
  }
  if(truth.usableForIntent===true&&admitted.has(String(candidate.candidateId))){
    return{outcome:trace?.sealed?'INCLUDED_IN_SEALED_CONTEXT':'ACCEPTED_DOWNSTREAM',stage:trace?.sealed?'CONTEXT_SEAL':trace?.gathered?'GATHER':'TRUTH',
      signal:'ACCEPTED',reasonCodes:['EXACT_DOWNSTREAM_ADMISSION']};
  }
  if(truth.usableForIntent===true)return{outcome:'OMITTED_OR_DEFERRED_NEUTRAL',stage:'GATHER',signal:'NONE',reasonCodes:['NO_EXPLICIT_REJECTION_RECEIPT']};
  return{outcome:'OUTCOME_UNKNOWN',stage:'TRUTH',signal:'NONE',reasonCodes:['DOWNSTREAM_EVIDENCE_INSUFFICIENT']};
}

function mergeMapped(existing,next){
  if(!existing)return next;
  const evidenceSignals=new Set([existing.signal,next.signal].filter(signal=>signal&&signal!=='NONE'));
  const mixed=evidenceSignals.size>1;
  const base=mixed?{
    ...existing,signal:'NONE',outcome:'MIXED_DOWNSTREAM_OUTCOME_NEUTRAL',outcomeStage:'MULTI_STAGE',
  }:(next.signal!=='NONE'&&existing.signal==='NONE'?next:existing);
  return{...base,candidateIds:uniq([...(existing.candidateIds??[]),...(next.candidateIds??[])]),nominationIds:uniq([...(existing.nominationIds??[]),...(next.nominationIds??[])]),
    sourceRevisionRefs:uniq([...(existing.sourceRevisionRefs??[]),...(next.sourceRevisionRefs??[])]),
    reasonCodes:uniq([...(existing.reasonCodes??[]),...(next.reasonCodes??[]),...(mixed?['CONFLICTING_EXACT_OUTCOMES_NEUTRALIZED']:[])]).slice(0,MAX_REASON_CODES),
    includedInSeal:Boolean(existing.includedInSeal||next.includedInSeal),gathered:Boolean(existing.gathered||next.gathered)};
}

export function buildMemoryRetrievalFeedbackBatch({selection={},candidateEnvelope=null,assessment=null,publicationAssessment=null,candidateTraceReceipt=null}={}){
  const traceByCandidate=new Map((candidateTraceReceipt?.rows??[]).map(row=>[String(row.candidateId),row]));
  const truthByCandidate=new Map((assessment?.truthResults??[]).map(row=>[String(row.candidateId),row]));
  const mapped=new Map(),mappingRejects=[];
  for(const candidate of candidateEnvelope?.candidates??[]){
    const memoryNominations=(candidate.channelNominations??[]).filter(row=>String(row?.channelId)==='OWNER_MEMORY');
    if(!memoryNominations.length)continue;
    const trace=traceByCandidate.get(String(candidate.candidateId))??null,truth=truthByCandidate.get(String(candidate.candidateId))??null;
    const candidateClassification=truthOutcome(candidate,truth,publicationAssessment,trace);
    for(const nomination of memoryNominations){
      const classification=String(nomination?.freshness??'').toUpperCase()&&String(nomination?.freshness??'').toUpperCase()!=='FRESH'
        ?{outcome:'REJECTED_STALE_OR_INVALID',stage:'CANDIDATE_BUS',signal:'NONE',reasonCodes:['MEMORY_NOMINATION_NOT_FRESH']}
        :candidateClassification;
      const artifactId=artifactIdOf(nomination.artifactRef),artifactRevision=artifactRevisionOf(nomination);
      if(!artifactId){mappingRejects.push({candidateId:candidate.candidateId,nominationId:nomination.nominationId??null,status:'REJECTED',reasonCode:'MEMORY_ARTIFACT_REF_MISSING'});continue;}
      const key=String(artifactId)+'@'+String(artifactRevision);
      mapped.set(key,mergeMapped(mapped.get(key),{
        outcomeId:null,artifactRef:clone(nomination.artifactRef),artifactId:String(artifactId),artifactRevision,candidateIds:[String(candidate.candidateId)],nominationIds:uniq([nomination.nominationId]),
        sourceRevisionRefs:uniq(nomination.sourceRevisionRefs??[]),dependencyRevisions:uniq(nomination.dependencyRevisions??[]),representationRef:nomination.representationRef??null,
        representationRevision:nomination.representationRevision??null,outcome:classification.outcome,outcomeStage:classification.stage,signal:classification.signal,
        reasonCodes:classification.reasonCodes.slice(0,MAX_REASON_CODES),gathered:Boolean(trace?.gathered),includedInSeal:Boolean(trace?.sealed),retrieved:true,nominated:true,
        deliveryKnown:false,providerDeliveryEvidence:false,supportAdded:false,retrievalUseIsEvidence:false,authorityChanged:false,canonicalMutationAuthority:false,
      }));
    }
  }
  const outcomes=[...mapped.values()].sort((a,b)=>(a.artifactId+'@'+a.artifactRevision).localeCompare(b.artifactId+'@'+b.artifactRevision)).slice(0,MAX_OUTCOMES);
  const identity={chatId:selection?.chatId??null,turnId:selection?.turnId??null,generationId:selection?.generationId??null,correlationId:selection?.correlationId??null,
    worldRevision:selection?.worldRevision??null,sceneRevision:selection?.sceneRevision??null};
  for(const row of outcomes)row.outcomeId='memory-feedback-outcome:'+stableHash({identity,artifactId:row.artifactId,artifactRevision:row.artifactRevision,outcome:row.outcome,stage:row.outcomeStage,signal:row.signal,candidateIds:row.candidateIds},{length:28});
  return{kind:'MemoryRetrievalFeedbackBatch',contractVersion:'1.0.0',batchId:'memory-retrieval-feedback:'+stableHash({identity,outcomeIds:outcomes.map(row=>row.outcomeId)},{length:28}),
    selection:clone(identity),outcomes,mappingRejects:mappingRejects.slice(0,32),outcomeCount:outcomes.length,scheduledEligible:outcomes.length>0,deliveryKnown:false,hostDeliveryInferred:false,
    supportAdded:false,retrievalUseIsEvidence:false,authorityChanged:false,canonicalMutationAuthority:false,settlementAuthority:false,truthAuthority:false,
    rawStoryIncluded:false,rawLoreIncluded:false,promptIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false};
}

const evidenceChatId=(evidence)=>{const meta=evidence?.metadata??{};for(const key of ['chatId','chatNamespace','conversationId'])if(meta[key]!=null&&String(meta[key]).length)return String(meta[key]);return null;};

export class MemoryRetrievalFeedbackOwner{
  constructor({producer,snapshot=null,maxReceipts=256,maxOutcomeIds=4096}={}){
    if(!producer)throw new TypeError('MemoryRetrievalFeedbackOwner requires producer');
    this.producer=producer;this.maxReceipts=Math.max(32,Number(maxReceipts)||256);this.maxOutcomeIds=Math.max(256,Number(maxOutcomeIds)||4096);
    this.seenOutcomeIds=new Set();this.outcomeOrder=[];this.receipts=[];if(snapshot)this.restore(snapshot);
  }
  admit(batch={}){
    if(batch?.kind!=='MemoryRetrievalFeedbackBatch'||!batch?.batchId)return this.#retain({kind:'MemoryRetrievalFeedbackReceipt',status:'REJECTED',reasonCode:'FEEDBACK_BATCH_INVALID',batchId:batch?.batchId??null,outcomes:[],supportAdded:false,authorityChanged:false,canonicalMutationAuthority:false});
    const selection=clone(batch.selection??{}),decisions=[],appliedRefs=[],acceptedIds=[],rejectedIds=[];let replayed=0;
    for(const input of (batch.outcomes??[]).slice(0,MAX_OUTCOMES)){
      const outcomeId=String(input?.outcomeId??'');
      if(!outcomeId){decisions.push(this.#decision(input,'REJECTED','OUTCOME_ID_MISSING'));continue;}
      if(this.seenOutcomeIds.has(outcomeId)){replayed++;decisions.push(this.#decision(input,'REPLAYED','OUTCOME_ALREADY_APPLIED'));continue;}
      const artifactId=String(input?.artifactId??''),artifactRevision=Number(input?.artifactRevision??0),before=this.producer.plasticity.record(artifactId,artifactRevision);
      if(!before){decisions.push(this.#decision(input,'REJECTED','MEMORY_ARTIFACT_REVISION_MISSING'));continue;}
      if(before.stale||before.current===false||!this.producer.plasticity.retrievable(artifactId,artifactRevision)){decisions.push(this.#decision(input,'REJECTED','MEMORY_ARTIFACT_REVISION_STALE',{before}));continue;}
      const exactSourceRefs=uniq(before.sourceRevisionRefs??[]),requestedSourceRefs=uniq(input?.sourceRevisionRefs??[]);
      if(requestedSourceRefs.length&&requestedSourceRefs.some(ref=>!exactSourceRefs.includes(ref))){decisions.push(this.#decision(input,'REJECTED','MEMORY_SOURCE_REVISION_FENCE_MISMATCH',{before}));continue;}
      const evidenceRows=uniq(before.evidenceRefs??[]).map(id=>this.producer.graph.evidenceRecord(id)).filter(Boolean);
      if(evidenceRows.some(row=>!this.producer.graph.evidenceFresh(row.id))){decisions.push(this.#decision(input,'REJECTED','MEMORY_DEPENDENT_EVIDENCE_STALE',{before}));continue;}
      const evidenceChats=uniq(evidenceRows.map(evidenceChatId));
      if(selection?.chatId&&evidenceChats.length&&evidenceChats.some(id=>id!==String(selection.chatId))){decisions.push(this.#decision(input,'REJECTED','MEMORY_FOREIGN_STORY_MAPPING',{before}));continue;}
      if(selection?.chatId&&evidenceRows.length&&!evidenceRows.some(row=>evidenceChatId(row)===String(selection.chatId))){decisions.push(this.#decision(input,'REJECTED','MEMORY_STORY_SCOPE_UNPROVEN',{before}));continue;}
      const signal=String(input?.signal??'NONE').toUpperCase();let effect=null;
      if(signal==='ACCEPTED'||signal==='REJECTED'){
        effect=this.producer.plasticity.recordRetrievalUse({artifactId,artifactRevision,accepted:signal==='ACCEPTED',rejected:signal==='REJECTED',countRetrieval:false,strictRevision:true});
        if(effect.status!=='RECORDED'){decisions.push(this.#decision(input,'REJECTED','MEMORY_PLASTICITY_OWNER_REJECTED',{before,effect}));continue;}
        appliedRefs.push({artifactId,artifactRevision});if(signal==='ACCEPTED')acceptedIds.push(artifactId);else rejectedIds.push(artifactId);
      }
      this.#markSeen(outcomeId);
      decisions.push(this.#decision(input,signal==='NONE'?'DEFERRED':'APPLIED',signal==='NONE'?'NEUTRAL_OUTCOME_NO_QUALITY_SIGNAL':'OWNER_PLASTICITY_APPLIED',{before,effect}));
    }
    let coRetrieval=null,reconsolidation=null;
    if(appliedRefs.length>1)coRetrieval=this.producer.plasticity.recordCoRetrieval({artifactRefs:appliedRefs,acceptedArtifactIds:uniq(acceptedIds),rejectedArtifactIds:uniq(rejectedIds),reasonCode:'DOWNSTREAM_RETRIEVAL_FEEDBACK',countRetrieval:false,existingOnly:true});
    if(appliedRefs.length)reconsolidation=this.producer.plasticity.reconsolidate({maxUnits:Math.min(8,Math.max(1,appliedRefs.length*2))});
    const finalized=decisions.map(row=>{const after=row.artifactId?this.producer.plasticity.record(row.artifactId,row.artifactRevision):null;return{...row,after:after?this.#state(after):null,nominationPriorityAfter:after?this.producer.plasticity.nominationPriority(row.artifactId,row.artifactRevision):null};});
    const applied=finalized.filter(row=>row.status==='APPLIED').length,rejected=finalized.filter(row=>row.status==='REJECTED').length,deferred=finalized.filter(row=>row.status==='DEFERRED').length;
    return this.#retain({kind:'MemoryRetrievalFeedbackReceipt',contractVersion:'1.0.0',status:applied||deferred?'COMPLETED':replayed&&!rejected?'REPLAYED':rejected?'REJECTED':'NO_SIGNAL',
      batchId:String(batch.batchId),selection,outcomes:finalized,counts:{input:(batch.outcomes??[]).length,applied,rejected,deferred,replayed},coRetrieval:clone(coRetrieval),reconsolidation:clone(reconsolidation),
      ownerDecision:rejected&&!applied?'REJECTED':applied?'ACCEPTED_WITH_BOUNDED_EFFECT':'DEFERRED_NEUTRAL',supportAdded:false,retrievalUseIsEvidence:false,authorityChanged:false,
      canonicalMutationAuthority:false,settlementAuthority:false,truthAuthority:false,deliveryKnown:false,hostDeliveryInferred:false,rawStoryIncluded:false,rawLoreIncluded:false,promptIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false});
  }
  #decision(input,status,reasonCode,{before=null,effect=null}={}){return{outcomeId:input?.outcomeId??null,artifactId:input?.artifactId??null,artifactRevision:input?.artifactRevision??null,
    candidateIds:uniq(input?.candidateIds??[]),nominationIds:uniq(input?.nominationIds??[]),outcome:input?.outcome??null,outcomeStage:input?.outcomeStage??null,
    reasonCodes:uniq([reasonCode,...(input?.reasonCodes??[])]).slice(0,MAX_REASON_CODES),signal:input?.signal??'NONE',status,ownerAccepted:status!=='REJECTED',
    mappingStatus:status==='REJECTED'?'REJECTED':'EXACT',before:before?this.#state(before):null,effect:clone(effect),gathered:Boolean(input?.gathered),includedInSeal:Boolean(input?.includedInSeal),
    deliveryKnown:false,supportAdded:false,retrievalUseIsEvidence:false,authorityChanged:false,canonicalMutationAuthority:false};}
  #state(row){return{retrievalUses:Number(row?.retrievalUses??0),acceptedUses:Number(row?.acceptedUses??0),rejectedUses:Number(row?.rejectedUses??0),maturityStage:row?.maturityStage??null,
    residency:row?.residency??null,strength:row?.strength??null,maturity:row?.maturity??null,authorityClass:row?.authorityClass??null,stale:Boolean(row?.stale),current:row?.current!==false,
    nominationPriority:this.producer.plasticity.nominationPriority(row?.artifactId,row?.artifactRevision)};}
  #markSeen(id){if(this.seenOutcomeIds.has(id))return;this.seenOutcomeIds.add(id);this.outcomeOrder.push(id);while(this.outcomeOrder.length>this.maxOutcomeIds){const oldest=this.outcomeOrder.shift();this.seenOutcomeIds.delete(oldest);}}
  #retain(receipt){this.receipts.push(clone(receipt));if(this.receipts.length>this.maxReceipts)this.receipts.splice(0,this.receipts.length-this.maxReceipts);
    this.producer.pushDiagnostic?.({kind:'MemoryRetrievalFeedbackDiagnostic',status:receipt.status,batchId:receipt.batchId??null,counts:clone(receipt.counts??{}),
      outcomes:(receipt.outcomes??[]).slice(0,32).map(row=>({outcomeId:row.outcomeId,artifactId:row.artifactId,artifactRevision:row.artifactRevision,candidateIds:row.candidateIds,outcomeStage:row.outcomeStage,outcome:row.outcome,status:row.status,reasonCodes:row.reasonCodes,ownerAccepted:row.ownerAccepted,nominationPriorityAfter:row.nominationPriorityAfter??null,residency:row.after?.residency??null,supportAdded:false,authorityChanged:false,deliveryKnown:false})),
      supportAdded:false,authorityChanged:false,canonicalMutationAuthority:false,rawStoryIncluded:false,rawLoreIncluded:false,promptIncluded:false,credentialsIncluded:false,hiddenReasoningIncluded:false});
    return clone(receipt);}
  status(){const last=this.receipts.at(-1)??null;return{kind:'MemoryRetrievalFeedbackStatus',contractVersion:'1.0.0',retainedReceipts:this.receipts.length,retainedOutcomeIds:this.seenOutcomeIds.size,
    appliedCount:this.receipts.reduce((n,row)=>n+Number(row.counts?.applied??0),0),rejectedCount:this.receipts.reduce((n,row)=>n+Number(row.counts?.rejected??0),0),
    replayedCount:this.receipts.reduce((n,row)=>n+Number(row.counts?.replayed??0),0),last:clone(last),supportAdded:false,authorityChanged:false,canonicalMutationAuthority:false};}
  snapshot(){return{kind:'MemoryRetrievalFeedbackSnapshot',contractVersion:'1.0.0',maxReceipts:this.maxReceipts,maxOutcomeIds:this.maxOutcomeIds,outcomeOrder:[...this.outcomeOrder],receipts:clone(this.receipts)};}
  restore(snapshot){if(snapshot?.kind!=='MemoryRetrievalFeedbackSnapshot')return this.snapshot();this.maxReceipts=Math.max(32,Number(snapshot.maxReceipts??this.maxReceipts)||this.maxReceipts);
    this.maxOutcomeIds=Math.max(256,Number(snapshot.maxOutcomeIds??this.maxOutcomeIds)||this.maxOutcomeIds);this.outcomeOrder=uniq(snapshot.outcomeOrder??[]).slice(-this.maxOutcomeIds);
    this.seenOutcomeIds=new Set(this.outcomeOrder);this.receipts=clone(snapshot.receipts??[]).slice(-this.maxReceipts);return this.snapshot();}
}
