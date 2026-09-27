import { KnowledgeStatus } from './contracts.js';
import { RetrievalConfidence,createCorrectiveRetrievalRequest,createTruthAssessment } from './publication-contracts.js';
import {
  CorrectiveRetrievalAction,
  RetrievalQuality,
  evaluateRetrievalQuality,
  retrievalControlDecision,
} from './coprocessor/retrieval-control-policy.js';

const unresolved=new Set([KnowledgeStatus.CONTRADICTED,KnowledgeStatus.UNCERTAIN,KnowledgeStatus.UNRESOLVED]);
const historical=new Set([KnowledgeStatus.HISTORICAL,KnowledgeStatus.SUPERSEDED]);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))].sort();
const QUALITY_RANK=Object.freeze({LOW:0,MIXED:1,HIGH:2});

function inferNeed(query){
  const text=String(query).toLowerCase();
  if(/\bwhere\b|\bfind\b|\blocat(?:e|ion)\b/.test(text))return'location';
  if(/\bstate\b|\bstatus\b|\bintact\b|\bdestroyed\b|\bsurviv/.test(text))return'state';
  if(/\bowner\b|\bowns\b|\bbelong/.test(text))return'owner';
  if(/\bmember\b|\bjoin\b|\bleave\b/.test(text))return'memberOf';
  return null;
}
function minQuality(a,b){
  return QUALITY_RANK[a]<=QUALITY_RANK[b]?a:b;
}
function intentId(row,index){
  return String(row?.intentId??row?.id??('intent:'+index));
}
function attemptedChannels(candidates=[]){
  return uniq(candidates.flatMap((candidate)=>[
    ...(candidate?.channelNominations??[]).map((row)=>row?.channelId),
    candidate?.channel,
  ]));
}
function unavailableChannels(candidateEnvelope){
  return uniq([
    ...(candidateEnvelope?.unavailableChannels??[]),
    ...((candidateEnvelope?.metadata?.channelReceipts??[]).filter((row)=>row?.status==='UNAVAILABLE').map((row)=>row.channelId)),
  ]);
}
function correctiveAction({quality,retrievalIntents=[],intent='CURRENT'}={}){
  const missing=new Set(quality?.missingIntentIds??[]);
  const rows=(retrievalIntents??[]).filter((row,index)=>!missing.size||missing.has(intentId(row,index)));
  if(rows.some((row)=>String(row?.kind??row?.intentKind??'').toUpperCase().includes('RELATIONSHIP')||(row?.relationshipRefs??[]).length)){
    return CorrectiveRetrievalAction.GRAPH_EXPANSION;
  }
  if(['HISTORICAL','TEMPORAL'].includes(String(intent).toUpperCase())
    ||rows.some((row)=>/TEMPORAL|HISTORY|HISTORICAL/.test(String(row?.kind??row?.intentKind??'').toUpperCase()))){
    return CorrectiveRetrievalAction.TEMPORAL_NARROWING;
  }
  if((quality?.missingEntityRefs??[]).length||rows.some((row)=>missing.size&&(row?.entityRefs??[]).length)){
    return CorrectiveRetrievalAction.ENTITY_CONSTRAINED_SEARCH;
  }
  if(quality?.exactIdentifierMissing===true
    ||rows.some((row)=>missing.size&&['AUTO','DIRECT_QUERY','NARROW','CURRENT'].includes(String(row?.kind??row?.intentKind??'').toUpperCase()))){
    return CorrectiveRetrievalAction.SPARSE_RETRY;
  }
  return CorrectiveRetrievalAction.QUERY_REFORMULATION;
}
function expandGraphTraversal(value={}){
  const src=value&&typeof value==='object'?value:{};
  const bounded=(v,fallback,max)=>Math.max(1,Math.min(max,Math.trunc(Number(v)||fallback)));
  return{
    ...structuredClone(src),
    maxDepth:Math.min(3,bounded(src.maxDepth,1,3)+1),
    maxNodes:Math.min(64,bounded(src.maxNodes,24,64)+8),
    maxEdges:Math.min(128,bounded(src.maxEdges,48,128)+16),
    maxCandidates:Math.min(32,bounded(src.maxCandidates,12,32)+4),
  };
}

export class TruthPublicationGate {
  constructor({truthGate,graph}){this.truthGate=truthGate;this.graph=graph;}

  assess(candidates,{
    query,intent='CURRENT',sourceRevisionIds=[],worldRevision=0,sceneRevision=0,
    attempt=0,maxCorrectiveAttempts=1,allowHistoricalSupport=false,
    retrievalIntents=[],candidateEnvelope=null,
  }={}){
    const truthResults=this.truthGate.classifyAll(candidates,{intent});
    const need=inferNeed(query);
    const rows=truthResults.map((truth,index)=>{
      const candidate=candidates[index]??candidates.find(c=>c.candidateId===truth.candidateId);
      const claim=truth.claimIds.map(id=>this.graph.getClaim(id)).find(Boolean)??null;
      return{truth,candidate,claim};
    }).filter(x=>x.candidate);

    const focused=rows.filter(({claim})=>{
      if(!need||!claim)return true;
      if(claim.predicate===need)return true;
      if(need==='location'&&claim.predicate==='state')return true;
      return false;
    });
    const currentRows=focused.filter(x=>x.truth.classification===KnowledgeStatus.CURRENT&&x.truth.usableForIntent);
    const unresolvedRows=focused.filter(x=>unresolved.has(x.truth.classification));
    const historicalRows=focused.filter(x=>historical.has(x.truth.classification));

    let truthConfidence;
    let truthReason;
    if(intent==='HISTORICAL'){
      const usable=focused.filter(x=>x.truth.usableForIntent);
      if(usable.length&&!unresolvedRows.length){truthConfidence=RetrievalConfidence.HIGH;truthReason='historical evidence is sufficient for the requested temporal intent';}
      else if(usable.length||unresolvedRows.length){truthConfidence=RetrievalConfidence.MIXED;truthReason='historical evidence exists but remains incomplete or disputed';}
      else{truthConfidence=RetrievalConfidence.LOW;truthReason='no useful long-term evidence was found for the historical intent';}
    }else if(intent==='CONTRADICTION'){
      if(unresolvedRows.length>=2){truthConfidence=RetrievalConfidence.HIGH;truthReason='multiple explicit conflict paths are available for contradiction analysis';}
      else if(unresolvedRows.length){truthConfidence=RetrievalConfidence.MIXED;truthReason='conflict evidence exists but is incomplete';}
      else{truthConfidence=RetrievalConfidence.LOW;truthReason='no contradiction evidence is currently available';}
    }else if(currentRows.length&&!unresolvedRows.length){
      truthConfidence=RetrievalConfidence.HIGH;truthReason='fresh current evidence satisfies the requested state without unresolved conflict';
    }else if(unresolvedRows.length||historicalRows.length){
      truthConfidence=RetrievalConfidence.MIXED;truthReason='useful evidence exists but current resolution is incomplete, historical, or conflicting';
    }else{
      truthConfidence=RetrievalConfidence.LOW;truthReason='no useful current long-term memory is available';
    }

    const requiredIntentIds=(retrievalIntents??[]).map(intentId);
    const truthByCandidate=new Map(truthResults.map((row)=>[row.candidateId,row]));
    const qualityCandidates=(candidates??[]).map((candidate)=>{
      const truth=truthByCandidate.get(candidate.candidateId);
      return{
        ...structuredClone(candidate),
        truthStatus:truth?.classification??candidate.truthStatus??candidate.truthStatusHint??KnowledgeStatus.UNRESOLVED,
      };
    });
    const coverage=evaluateRetrievalQuality({
      requiredIntentIds,
      candidates:qualityCandidates,
      attemptedChannels:attemptedChannels(candidates),
      // Optional provider absence is diagnostic, not a mandatory-intent failure.
      unavailableChannels:[],
      confidence:requiredIntentIds.length
        ?Math.min(1,new Set(qualityCandidates.flatMap((candidate)=>candidate.retrievalIntentIds??[]).filter((id)=>requiredIntentIds.includes(id))).size/requiredIntentIds.length)
        :(qualityCandidates.length?1:0),
    });
    const confidence=minQuality(truthConfidence,coverage.quality);
    const reason=confidence===truthConfidence?truthReason:coverage.reason;
    const action=correctiveAction({quality:coverage,retrievalIntents,intent});
    const decision=retrievalControlDecision({
      quality:confidence,
      correctiveAttempt:attempt,
      maxCorrectiveAttempts,
      recommendedAction:action,
    });
    const rawUnavailable=unavailableChannels(candidateEnvelope);
    const retrievalQuality={
      kind:'SelectedTurnRetrievalQualityReceipt',
      quality:confidence,
      reason,
      truthConfidence,
      intentCoverageQuality:coverage.quality,
      requiredIntentIds:[...requiredIntentIds],
      satisfiedIntentIds:[...(coverage.satisfiedIntentIds??[])],
      missingIntentIds:[...(coverage.missingIntentIds??[])],
      coverage:Number(coverage.coverage??0),
      candidateCount:candidates.length,
      attemptedChannels:attemptedChannels(candidates),
      unavailableChannels:rawUnavailable,
      correctiveAction:decision.correctiveAction??null,
      correctiveAllowed:decision.action==='CORRECTIVE_RETRIEVAL',
      maxCorrectiveAttempts:Math.min(1,Math.max(0,Number(maxCorrectiveAttempts)||0)),
      correctiveAttempt:Number(attempt)||0,
      allowLongTermMemory:confidence!==RetrievalQuality.LOW,
      productionDenseExecuted:false,
      productionDenseOwner:'WORKER_1',
      canonicalTruthGranted:false,
      admissionAuthority:false,
      settlementAuthority:false,
      contextSealAuthority:false,
    };

    const admittedCandidateIds=rows.filter(x=>x.truth.usableForIntent).map(x=>x.candidate.candidateId);
    const supportCandidateIds=(allowHistoricalSupport||confidence===RetrievalConfidence.MIXED)
      ? historicalRows.map(x=>x.candidate.candidateId):[];

    let correctiveRequest=null;
    if(decision.action==='CORRECTIVE_RETRIEVAL'&&attempt<maxCorrectiveAttempts){
      correctiveRequest=createCorrectiveRetrievalRequest({
        id:`corrective:${intent.toLowerCase()}:${attempt+1}:${uniq(candidates.map(c=>c.candidateId)).join('|')||'empty'}`,
        reason,requestedAction:action,originalQuery:query,intent,
        sourceRevisionIds:uniq(sourceRevisionIds.length?sourceRevisionIds:candidates.flatMap(c=>c.sourceRevisionRefs??c.legacyProvenance?.sourceRevisionIds??c.provenance?.sourceRevisionIds??[])),
        worldRevision,sceneRevision,priorCandidateIds:uniq(candidates.map(c=>c.candidateId)),
        missingEvidenceType:need??(coverage.missingIntentIds?.length?'RETRIEVAL_INTENT':null),
        maxAttempts:Math.min(1,Math.max(1,Number(maxCorrectiveAttempts)||1)),attempt:attempt+1,
      });
    }

    return{
      ...createTruthAssessment({
        id:`truth-assessment:${intent.toLowerCase()}:${attempt}:${confidence.toLowerCase()}`,
        query,intent,confidence,truthResults,correctiveRequest,reason,
        admittedCandidateIds:uniq(admittedCandidateIds),supportCandidateIds:uniq(supportCandidateIds),
      }),
      retrievalQuality,
    };
  }

  executeCorrective(assessment,{
    retrieval,anchorEntityIds=[],perspectiveConstraint=null,candidateBudget=64,latencyBudgetMs=100,
    graphTraversal=null,retrievalIntents=[],channelIds=null,
  }={}){
    const request=assessment.correctiveRequest;
    if(!request)return{assessment,candidates:[],executed:false,terminated:true,failed:false,error:null,action:null,correctivePasses:0,maxCorrectiveAttempts:1};
    if(request.attempt>request.maxAttempts)return{assessment,candidates:[],executed:false,terminated:true,failed:false,error:null,action:request.requestedAction,correctivePasses:0,maxCorrectiveAttempts:request.maxAttempts};

    const action=String(request.requestedAction??CorrectiveRetrievalAction.QUERY_REFORMULATION);
    const missing=new Set(assessment?.retrievalQuality?.missingIntentIds??[]);
    let intents=(retrievalIntents??[]).filter((row,index)=>!missing.size||missing.has(intentId(row,index)));
    if(!intents.length)intents=[{kind:request.intent,query:request.originalQuery,entityRefs:anchorEntityIds,perspective:perspectiveConstraint}];
    const legacyPublicationFallback=intents.length>0&&intents.every((row)=>row?.metadata?.publicationFallbackIntent===true);
    const legacyCorrectiveIntent=request.intent==='HISTORICAL'?'TEMPORAL':'CONTRADICTION';
    let correctiveGraph=graphTraversal;
    if(action===CorrectiveRetrievalAction.GRAPH_EXPANSION)correctiveGraph=expandGraphTraversal(graphTraversal);
    if(action===CorrectiveRetrievalAction.TEMPORAL_NARROWING){
      intents=intents.map((row)=>({...structuredClone(row),kind:request.intent==='HISTORICAL'?'HISTORICAL':'TEMPORAL'}));
    }
    if(action===CorrectiveRetrievalAction.QUERY_REFORMULATION){
      const anchors=uniq(intents.flatMap((row)=>[...(row.entityRefs??[]),...(row.relationshipRefs??[]),...(row.artifactRefs??[])]));
      const reformulated=uniq([request.originalQuery,...anchors]).join(' ').slice(0,800);
      intents=intents.map((row)=>({...structuredClone(row),query:reformulated||request.originalQuery}));
    }

    try{
      const candidates=retrieval.retrieve(request.originalQuery,{
        intent:legacyPublicationFallback?legacyCorrectiveIntent:request.intent,
        anchorEntityIds,
        worldRevision:request.worldRevision,
        sceneRevision:request.sceneRevision,
        candidateBudget,
        latencyBudgetMs,
        graphTraversal:correctiveGraph,
        channelIds,
        retrievalIntents:intents.map((row)=>({
          ...structuredClone(row),
          kind:legacyPublicationFallback?legacyCorrectiveIntent:row.kind,
          perspective:row.perspective??perspectiveConstraint,
          metadata:{...(row.metadata??{}),correctiveAction:action,correctiveAttempt:request.attempt,legacyCorrectiveIntent:legacyPublicationFallback?legacyCorrectiveIntent:null,...(correctiveGraph?{graphTraversal:correctiveGraph}:{})},
        })),
        metadata:{correctiveAction:action,correctiveAttempt:request.attempt},
      });
      return{
        assessment,candidates,executed:true,terminated:true,failed:false,error:null,
        action,correctivePasses:1,maxCorrectiveAttempts:request.maxAttempts,
      };
    }catch(error){
      return{
        assessment,candidates:[],executed:true,terminated:true,failed:true,
        error:error?.message??String(error),action,correctivePasses:1,maxCorrectiveAttempts:request.maxAttempts,
      };
    }
  }
}

export { inferNeed as inferTruthNeed };
