import {KnowledgeStatus} from './contracts.js';
import {CandidateFreshness} from './candidate-bus-contracts.js';
import {HotFreshness,HotSegmentKind} from './hot-cognition-contracts.js';
import {stableHash} from './browser-runtime-utils.js';
import {
  CognitiveChoicePath,CognitiveJob,CognitiveReason,JevAction,createCognitiveChoiceReceipt,
} from './cognitive-choice-contracts.js';

const clone=(value)=>value==null?value:structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(x=>typeof x==='string'&&x.length))].sort();
const unresolvedStatus=new Set([KnowledgeStatus.CONTRADICTED,KnowledgeStatus.UNCERTAIN,KnowledgeStatus.UNRESOLVED]);
const truthStatuses=[
  KnowledgeStatus.CURRENT,KnowledgeStatus.HISTORICAL,KnowledgeStatus.SUPERSEDED,
  KnowledgeStatus.CONTRADICTED,KnowledgeStatus.UNCERTAIN,KnowledgeStatus.UNRESOLVED,
];
const allJobs=Object.values(CognitiveJob);

function now(){return globalThis.performance?.now?.()??Date.now();}
function freshSegment(snapshot,kind){
  const segment=snapshot?.segments?.[kind];
  if(!segment||segment.freshness!==HotFreshness.FRESH)return null;
  if(segment.value==null)return null;
  if(Array.isArray(segment.value)&&segment.value.length===0)return null;
  return segment;
}
function inferHotNeed(query){
  const text=String(query??'').trim().toLowerCase();
  if(!text)return null;
  if(/\b(?:continue|keep going|carry on|respond|reply|what happens next)\b/.test(text))return HotSegmentKind.SCENE;
  if(/\bwhere (?:are we|am i)\b|\bcurrent location\b|\bour location\b/.test(text))return HotSegmentKind.LOCATION;
  if(/\bwho(?:'s| is) here\b|\bwho is present\b|\bactive cast\b/.test(text))return HotSegmentKind.ACTIVE_CAST;
  if(/\bcurrent scene\b|\bwhat is happening\b|\bwhat's happening\b/.test(text))return HotSegmentKind.SCENE;
  if(/\bcurrent (?:objective|thread|goal)\b|\bactive thread\b/.test(text))return HotSegmentKind.ACTIVE_THREADS;
  return null;
}
function hotSufficient({snapshot,query,intent,anchorEntityIds=[],worldRevision=0,sceneRevision=0}){
  if(!snapshot||intent!=='CURRENT'||anchorEntityIds.length)return false;
  if((snapshot.invalidationState??[]).length)return false;
  if(Number(snapshot.worldRevision)!==Number(worldRevision))return false;
  if(Number(snapshot.sceneRevision)!==Number(sceneRevision))return false;
  const need=inferHotNeed(query);if(!need)return false;
  return Boolean(freshSegment(snapshot,need));
}
function truthCounts(results=[]){
  const counts=Object.fromEntries(truthStatuses.map(status=>[status,0]));
  for(const result of results??[])if(Object.prototype.hasOwnProperty.call(counts,result.classification))counts[result.classification]+=1;
  return counts;
}
function evidenceRefs(packet){
  const refs=[];
  for(const row of [...(packet?.current??[]),...(packet?.historical??[]),...(packet?.unresolved??[]),...(packet?.hotCognition??[])]){
    if(typeof row?.id==='string')refs.push(row.id);
    refs.push(...(row?.supportIds??[]));
  }
  return uniq(refs);
}
function representationRefs(envelopes=[]){
  const refs=[];
  for(const envelope of envelopes)for(const candidate of envelope?.candidates??[]){
    if(candidate.representationRef)refs.push(candidate.representationRef+(candidate.representationRevision==null?'':'@'+candidate.representationRevision));
  }
  return uniq(refs);
}
function candidateRevisionRefs(envelopes=[]){
  const refs=[];
  for(const envelope of envelopes)for(const candidate of envelope?.candidates??[]){
    if(candidate.artifactRevision!=null){
      const id=typeof candidate.artifactRef==='string'?candidate.artifactRef:candidate.artifactRef?.artifactId??candidate.artifactRef?.id??candidate.candidateId;
      refs.push(String(id)+'@'+String(candidate.artifactRevision));
    }
    refs.push(...(candidate.dependencyRevisions??[]));
  }
  return uniq(refs);
}
function channelSummary(envelope){
  if(!envelope)return{requested:[],used:[]};
  const receipt=envelope.fusionReceipt??{};
  return{
    requested:uniq((envelope.metadata?.channelReceipts??[]).map(x=>x.channelId)),
    used:uniq(Object.entries(receipt.perChannelCounts??{}).filter(([,count])=>Number(count)>0).map(([id])=>id)),
  };
}

export class CognitiveChoiceController{
  constructor({maxReceipts=128}={}){
    this.maxReceipts=Math.max(8,Number(maxReceipts)||128);
    this.receipts=new Map();
    this.receiptOrder=[];
    this.jevAdapter=null;
  }

  registerJevAdapter(adapter=null){
    if(adapter!==null&&typeof adapter?.invoke!=='function')throw new TypeError('Jev adapter requires invoke(request)');
    this.jevAdapter=adapter;
    return{registered:Boolean(adapter),capability:'BOUNDED_JEV_ADJUDICATION',canonicalMutationAuthority:false};
  }

  begin({
    turnId,turnRevision=0,correlationId,query,intent='CURRENT',anchorEntityIds=[],
    hotSnapshot=null,worldRevision=0,sceneRevision=0,budgetBytes=null,deadline=null,channelIds=null,channelManifest=null,
  }={}){
    const startedAt=now();
    const requested=channelIds?.length?uniq(channelIds):uniq((channelManifest?.channels??[]).filter(x=>x.available!==false).map(x=>x.channelId));
    const hotOnly=hotSufficient({snapshot:hotSnapshot,query,intent,anchorEntityIds,worldRevision,sceneRevision});
    const session={
      turnId:String(turnId),turnRevision:Number(turnRevision)||0,correlationId:String(correlationId),query:String(query),intent:String(intent),
      anchorEntityIds:uniq(anchorEntityIds),startedAt,budgetBytes,deadline,hotSnapshotId:hotSnapshot?.snapshotId??null,
      worldRevision:Number(worldRevision)||0,sceneRevision:Number(sceneRevision)||0,requestedChannels:requested,
      paths:new Set([hotOnly?CognitiveChoicePath.HOT_ONLY:CognitiveChoicePath.STANDARD_RETRIEVAL]),
      admitted:new Set([CognitiveJob.CONTEXT_COMPILER,CognitiveJob.CONTEXT_SEAL]),
      skipped:new Set(),deferred:new Set([CognitiveJob.DEEP_COGNITION]),reasons:new Set([CognitiveReason.DEFER_BACKGROUND]),
      envelopes:[],candidateIds:new Set(),retrievalIntents:new Set(),channelsUsed:new Set(),
      correctionRequested:false,correctionExecuted:false,correctionCount:0,correctionFailed:false,
      quality:null,jev:this.#defaultJev(),precision:this.#defaultPrecision(),hotOnly,
    };
    if(hotOnly){
      session.admitted.add(CognitiveJob.HOT_CONTEXT);
      for(const job of [CognitiveJob.RETRIEVAL,CognitiveJob.HISTORIAN,CognitiveJob.GRAPH_WALKER,CognitiveJob.GREEN_ROOM,CognitiveJob.CORRECTIVE_RETRIEVAL,CognitiveJob.TRUTH,CognitiveJob.JEV,CognitiveJob.PRECISION,CognitiveJob.EXTERNAL_GROUNDING])session.skipped.add(job);
      session.reasons.add(CognitiveReason.HOT_SUFFICIENT);session.reasons.add(CognitiveReason.JEV_NOT_REQUIRED);session.reasons.add(CognitiveReason.PRECISION_NOT_REQUIRED);
      session.jev={...session.jev,considered:true,skipped:true,action:JevAction.SKIP_JEV,reason:CognitiveReason.JEV_NOT_REQUIRED};
      session.precision={...session.precision,considered:true,skipped:true,reason:CognitiveReason.PRECISION_NOT_REQUIRED};
    }else{
      session.admitted.add(CognitiveJob.RETRIEVAL);session.admitted.add(CognitiveJob.TRUTH);session.admitted.add(CognitiveJob.GATHER);
      for(const job of [CognitiveJob.HISTORIAN,CognitiveJob.GRAPH_WALKER,CognitiveJob.GREEN_ROOM,CognitiveJob.EXTERNAL_GROUNDING])session.skipped.add(job);
      session.reasons.add(CognitiveReason.RETRIEVAL_REQUIRED);session.reasons.add(CognitiveReason.LOW_EXPECTED_VALUE);
    }
    return session;
  }

  observeRetrieval(session,envelope,{phase='PRIMARY'}={}){
    if(!session||!envelope)return;
    session.envelopes.push(envelope);
    for(const id of envelope.retrievalIntentIds??[])session.retrievalIntents.add(id);
    for(const candidate of envelope.candidates??[])session.candidateIds.add(candidate.candidateId);
    const channels=channelSummary(envelope);for(const id of channels.used)session.channelsUsed.add(id);
    for(const id of envelope.unavailableChannels??[])session.reasons.add(CognitiveReason.CHANNEL_UNAVAILABLE);
    if(phase==='CORRECTIVE'){session.correctionExecuted=true;session.correctionCount+=1;session.admitted.add(CognitiveJob.CORRECTIVE_RETRIEVAL);}
  }

  observeQuality(session,quality,{correctiveRequested=false,correctionFailed=false}={}){
    session.quality=quality??null;
    if(quality==='HIGH')session.reasons.add(CognitiveReason.RETRIEVAL_HIGH);
    if(quality==='MIXED'){
      session.paths.add(CognitiveChoicePath.MIXED_CORRECTION);session.reasons.add(CognitiveReason.RETRIEVAL_MIXED);
      if(correctiveRequested){session.correctionRequested=true;session.reasons.add(CognitiveReason.CORRECTION_REQUIRED);}
    }
    if(quality==='LOW'){
      session.paths.add(CognitiveChoicePath.LOW_ABSTAIN);session.reasons.add(CognitiveReason.RETRIEVAL_LOW);
      session.skipped.add(CognitiveJob.CORRECTIVE_RETRIEVAL);session.skipped.add(CognitiveJob.PRECISION);session.skipped.add(CognitiveJob.JEV);
    }
    if(correctionFailed){session.correctionFailed=true;}
  }

  noteCorrectionLimit(session){
    if(session.correctionCount>=1)session.reasons.add(CognitiveReason.CORRECTION_LIMIT_REACHED);
  }

  evaluateJev(session,truthResults=[]){
    const alternatives=(truthResults??[]).filter(x=>unresolvedStatus.has(x.classification)).map(x=>({
      candidateId:x.candidateId,classification:x.classification,claimIds:uniq(x.claimIds??[]),
    })).sort((a,b)=>a.candidateId.localeCompare(b.candidateId));
    if(alternatives.length<2){
      session.skipped.add(CognitiveJob.JEV);session.reasons.add(CognitiveReason.JEV_NOT_REQUIRED);
      session.jev={...this.#defaultJev(),considered:true,skipped:true,action:JevAction.SKIP_JEV,reason:CognitiveReason.JEV_NOT_REQUIRED,alternativeCount:alternatives.length};
      return session.jev;
    }

    session.paths.add(CognitiveChoicePath.BOUNDED_AMBIGUITY);session.reasons.add(CognitiveReason.TRUTH_UNRESOLVED);session.reasons.add(CognitiveReason.JEV_REQUIRED);
    const request={
      kind:'JevInvocationRequest',turnId:session.turnId,correlationId:session.correlationId,
      query:session.query,intent:session.intent,alternatives,
      revisionFence:{turnRevision:session.turnRevision,worldRevision:session.worldRevision,sceneRevision:session.sceneRevision},
      canonicalMutationAuthority:false,
    };
    if(!this.jevAdapter){
      session.skipped.add(CognitiveJob.JEV);session.reasons.add(CognitiveReason.JEV_UNAVAILABLE);
      session.jev={...this.#defaultJev(),considered:true,skipped:true,unavailable:true,action:JevAction.JEV_UNAVAILABLE,reason:CognitiveReason.JEV_UNAVAILABLE,alternativeCount:alternatives.length,request};
      return session.jev;
    }

    session.admitted.add(CognitiveJob.JEV);session.skipped.delete(CognitiveJob.JEV);
    try{
      const result=this.jevAdapter.invoke(clone(request));
      if(result&&typeof result.then==='function')throw new TypeError('Asynchronous Jev adapters must return through the coordinated Result Bus path, not the synchronous Core seam');
      const abstained=String(result?.status??'').toUpperCase()==='ABSTAINED'||result?.abstained===true;
      if(abstained)session.reasons.add(CognitiveReason.JEV_ABSTAINED);
      session.jev={
        ...this.#defaultJev(),considered:true,invoked:true,abstained,skipped:false,unavailable:false,
        action:abstained?JevAction.JEV_ABSTAINED:JevAction.INVOKE_JEV,
        reason:abstained?CognitiveReason.JEV_ABSTAINED:CognitiveReason.JEV_REQUIRED,
        alternativeCount:alternatives.length,request,
        decisionRevision:result?.decisionRevision??result?.revision??null,
        resultRef:result?.decisionId??result?.id??null,
      };
    }catch(error){
      session.reasons.add(CognitiveReason.JEV_UNAVAILABLE);
      session.jev={...this.#defaultJev(),considered:true,invoked:true,skipped:false,unavailable:true,action:JevAction.JEV_UNAVAILABLE,reason:CognitiveReason.JEV_UNAVAILABLE,alternativeCount:alternatives.length,request,error:String(error?.message??error)};
    }
    return session.jev;
  }

  decidePrecision(session,{candidateCount=0,quality=session.quality,precisionAvailable=true}={}){
    const required=!session.hotOnly&&quality!=='LOW'&&(quality==='MIXED'||Number(candidateCount)>1);
    if(!required){
      session.skipped.add(CognitiveJob.PRECISION);session.reasons.add(CognitiveReason.PRECISION_NOT_REQUIRED);
      session.precision={...this.#defaultPrecision(),considered:true,skipped:true,required:false,available:Boolean(precisionAvailable),reason:CognitiveReason.PRECISION_NOT_REQUIRED};
      return session.precision;
    }
    session.reasons.add(CognitiveReason.PRECISION_REQUIRED);
    if(!precisionAvailable){
      session.skipped.add(CognitiveJob.PRECISION);session.reasons.add(CognitiveReason.PRECISION_UNAVAILABLE);session.reasons.add(CognitiveReason.PRECISION_FALLBACK);
      session.precision={...this.#defaultPrecision(),considered:true,skipped:true,required:true,available:false,fallback:true,reason:CognitiveReason.PRECISION_UNAVAILABLE};
      return session.precision;
    }
    session.admitted.add(CognitiveJob.PRECISION);session.skipped.delete(CognitiveJob.PRECISION);
    session.precision={...this.#defaultPrecision(),considered:true,invoked:true,required:true,available:true,reason:CognitiveReason.PRECISION_REQUIRED};
    return session.precision;
  }

  recordPrecisionOutcome(session,{failed=false,resultCount=0}={}){
    if(!session.precision.considered)return;
    if(failed){session.precision={...session.precision,invoked:true,fallback:true,failed:true,resultCount:0,reason:CognitiveReason.PRECISION_FALLBACK};session.reasons.add(CognitiveReason.PRECISION_FALLBACK);}
    else session.precision={...session.precision,failed:false,resultCount:Number(resultCount)||0};
  }

  finalize(session,{
    assessment=null,publicationAssessment=null,corrective=null,packet=null,sealReceipt=null,resultRoutes=[],
    precisionResults=[],precisionFailed=false,compilerReceipt=null,finishedAt=now(),
  }={}){
    const envelopes=session.envelopes;
    const fusionReceipts=envelopes.map(x=>x?.fusionReceipt).filter(Boolean);
    const nominated=fusionReceipts.reduce((n,x)=>n+Number(x.inputNominationCount??0),0);
    const invalid=fusionReceipts.reduce((n,x)=>n+Number(x.invalidNominationCount??0),0);
    const normalized=Math.max(0,nominated-invalid);
    const finalTruth=publicationAssessment??assessment;
    const truthAdmitted=uniq([...(finalTruth?.admittedCandidateIds??[]),...(finalTruth?.supportCandidateIds??[])]).length;
    const precisionAdmitted=session.precision.invoked&&!precisionFailed?Number(precisionResults?.length??0):truthAdmitted;
    const refs=evidenceRefs(packet),counts=truthCounts(assessment?.truthResults??[]);
    const staleResultIds=uniq(resultRoutes.filter(x=>x.route?.freshness==='STALE').map(x=>x.result?.id));
    const invalidResultIds=uniq(resultRoutes.filter(x=>x.route?.freshness==='INVALID').map(x=>x.result?.id));
    const lateResultIds=uniq(resultRoutes.filter(x=>x.route?.late).map(x=>x.result?.id));
    for(const id of staleResultIds)session.reasons.add(CognitiveReason.STALE_RESULT);
    for(const id of invalidResultIds)session.reasons.add(CognitiveReason.INVALID_RESULT);
    if(lateResultIds.length)session.reasons.add(CognitiveReason.SEAL_CLOSED);

    const sourceRevisionRefs=uniq([
      ...(packet?.dependencies??[]),
      ...envelopes.flatMap(x=>x?.sourceRevisionSet??[]),
    ]);
    const receipt=createCognitiveChoiceReceipt({
      id:'cognitive-choice:'+stableHash({turnId:session.turnId,correlationId:session.correlationId},{length:24}),
      receiptRevision:1,turnId:session.turnId,turnRevision:session.turnRevision,correlationId:session.correlationId,
      paths:[...session.paths],consideredCognitionOptions:allJobs,admittedJobs:[...session.admitted],
      skippedJobs:[...session.skipped],deferredJobs:[...session.deferred],reasonCodes:[...session.reasons],
      retrievalIntents:[...session.retrievalIntents],sensoryChannelsRequested:session.requestedChannels,
      sensoryChannelsUsed:[...session.channelsUsed],candidateCounts:{
        nominated,normalized,deduplicated:session.candidateIds.size,truthAdmitted,precisionAdmitted,finalGenerationFacing:refs.length,
      },
      retrievalQuality:session.hotOnly?null:assessment?.confidence??session.quality,
      correctiveRetrieval:{
        requested:Boolean(session.correctionRequested),executed:Boolean(session.correctionExecuted),
        correctionCount:session.correctionCount,maxCorrections:1,failed:Boolean(session.correctionFailed||corrective?.failed),
        result:session.correctionExecuted?(assessment?.confidence??session.quality):session.correctionRequested?'NOT_EXECUTED':'NOT_REQUIRED',
      },
      truthGate:{
        considered:!session.hotOnly,invoked:!session.hotOnly,skipped:session.hotOnly,
        outcomeCounts:counts,admittedCandidateIds:uniq(finalTruth?.admittedCandidateIds??[]),
        supportCandidateIds:uniq(finalTruth?.supportCandidateIds??[]),
      },
      jev:session.jev,precision:{...session.precision,failed:Boolean(precisionFailed),resultCount:Number(precisionResults?.length??0)},
      finalEvidenceRefs:refs,abstained:assessment?.confidence==='LOW',
      unresolved:counts.CONTRADICTED+counts.UNCERTAIN+counts.UNRESOLVED>0,
      latencyResourceBudget:{
        budgetBytes:session.budgetBytes,deadline:session.deadline,
        controllerOverheadMs:Math.max(0,Number(finishedAt)-Number(session.startedAt)),
        compilerBytes:compilerReceipt?.compiledBytes??null,
      },
      revisions:{
        turnRevision:session.turnRevision,sceneRevision:session.sceneRevision,worldRevision:session.worldRevision,
        sourceRevisionRefs,candidateRevisionRefs:candidateRevisionRefs(envelopes),
        retrievalRepresentationRevisionRefs:representationRefs(envelopes),
        truthInputCandidateIds:uniq(assessment?.truthResults?.map(x=>x.candidateId)??[]),
        jevDecisionRevision:session.jev?.decisionRevision??null,
        contextSealRevision:sealReceipt?.sequence??null,
      },
      freshness:{
        candidateSet:envelopes.at(-1)?.freshness??(session.hotOnly?CandidateFreshness.UNKNOWN:null),
        staleNominationCount:fusionReceipts.reduce((n,x)=>n+Number(x.staleNominationCount??0),0),
        invalidNominationCount:invalid,staleResultCount:staleResultIds.length,invalidResultCount:invalidResultIds.length,
      },
      seal:{
        sealed:Boolean(sealReceipt?.sealedState),sealReceiptId:sealReceipt?.id??null,sequence:sealReceipt?.sequence??null,
        packetId:sealReceipt?.packetId??packet?.id??null,packetHash:sealReceipt?.packetHash??null,publicationBoundary:'CLOSED',
      },
      lateResultIds,staleResultIds,invalidResultIds,
      metadata:{hotCognitionSnapshotId:session.hotSnapshotId,query:session.query,intent:session.intent},
    });
    this.#store(receipt);return receipt;
  }

  observeResultRoute(received){
    const turnId=received?.result?.turnId;if(!turnId)return null;
    const current=this.receipts.get(String(turnId));if(!current)return null;
    const late=received.route?.late,stale=received.route?.freshness==='STALE',invalid=received.route?.freshness==='INVALID';
    if(!late&&!stale&&!invalid)return clone(current);
    const next=createCognitiveChoiceReceipt({
      ...clone(current),receiptRevision:current.receiptRevision+1,
      reasonCodes:uniq([...current.reasonCodes,...(late?[CognitiveReason.SEAL_CLOSED]:[]),...(stale?[CognitiveReason.STALE_RESULT]:[]),...(invalid?[CognitiveReason.INVALID_RESULT]:[])]),
      lateResultIds:uniq([...current.lateResultIds,...(late?[received.result.id]:[])]),
      staleResultIds:uniq([...current.staleResultIds,...(stale?[received.result.id]:[])]),
      invalidResultIds:uniq([...current.invalidResultIds,...(invalid?[received.result.id]:[])]),
      freshness:{...current.freshness,staleResultCount:current.staleResultIds.length+(stale&&!current.staleResultIds.includes(received.result.id)?1:0),invalidResultCount:current.invalidResultIds.length+(invalid&&!current.invalidResultIds.includes(received.result.id)?1:0)},
    });
    this.receipts.set(String(turnId),next);return clone(next);
  }

  markDuplicate(turnId){
    const current=this.receipts.get(String(turnId));if(!current)return null;
    if(current.reasonCodes.includes(CognitiveReason.DUPLICATE_PUBLICATION))return clone(current);
    const next=createCognitiveChoiceReceipt({...clone(current),receiptRevision:current.receiptRevision+1,reasonCodes:[...current.reasonCodes,CognitiveReason.DUPLICATE_PUBLICATION]});
    this.receipts.set(String(turnId),next);return clone(next);
  }

  getReceipt(turnId){const receipt=this.receipts.get(String(turnId));return receipt?clone(receipt):null;}

  #store(receipt){
    const id=String(receipt.turnId);
    if(!this.receipts.has(id))this.receiptOrder.push(id);
    this.receipts.set(id,receipt);
    while(this.receiptOrder.length>this.maxReceipts){const old=this.receiptOrder.shift();this.receipts.delete(old);}
  }

  #defaultJev(){return{considered:false,invoked:false,skipped:false,unavailable:false,abstained:false,action:JevAction.SKIP_JEV,reason:null,alternativeCount:0,request:null,decisionRevision:null,resultRef:null};}
  #defaultPrecision(){return{considered:false,invoked:false,skipped:false,required:false,available:true,fallback:false,failed:false,resultCount:0,reason:null};}
}

export {hotSufficient as isHotCognitionSufficient};
