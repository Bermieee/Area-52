import { KnowledgeStatus } from './contracts.js';
import { RetrievalConfidence,createCorrectiveRetrievalRequest,createTruthAssessment } from './publication-contracts.js';

const unresolved=new Set([KnowledgeStatus.CONTRADICTED,KnowledgeStatus.UNCERTAIN,KnowledgeStatus.UNRESOLVED]);
const historical=new Set([KnowledgeStatus.HISTORICAL,KnowledgeStatus.SUPERSEDED]);
const uniq=(values)=>[...new Set(values)].sort();

function inferNeed(query){
  const text=String(query).toLowerCase();
  if(/\bwhere\b|\bfind\b|\blocat(?:e|ion)\b/.test(text))return'location';
  if(/\bstate\b|\bstatus\b|\bintact\b|\bdestroyed\b|\bsurviv/.test(text))return'state';
  if(/\bowner\b|\bowns\b|\bbelong/.test(text))return'owner';
  if(/\bmember\b|\bjoin\b|\bleave\b/.test(text))return'memberOf';
  return null;
}

export class TruthPublicationGate {
  constructor({truthGate,graph}){this.truthGate=truthGate;this.graph=graph;}

  assess(candidates,{
    query,intent='CURRENT',sourceRevisionIds=[],worldRevision=0,sceneRevision=0,
    attempt=0,maxCorrectiveAttempts=1,allowHistoricalSupport=false,
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

    let confidence;
    let reason;
    if(intent==='HISTORICAL'){
      const usable=focused.filter(x=>x.truth.usableForIntent);
      if(usable.length&&!unresolvedRows.length){confidence=RetrievalConfidence.HIGH;reason='historical evidence is sufficient for the requested temporal intent';}
      else if(usable.length||unresolvedRows.length){confidence=RetrievalConfidence.MIXED;reason='historical evidence exists but remains incomplete or disputed';}
      else{confidence=RetrievalConfidence.LOW;reason='no useful long-term evidence was found for the historical intent';}
    }else if(intent==='CONTRADICTION'){
      if(unresolvedRows.length>=2){confidence=RetrievalConfidence.HIGH;reason='multiple explicit conflict paths are available for contradiction analysis';}
      else if(unresolvedRows.length){confidence=RetrievalConfidence.MIXED;reason='conflict evidence exists but is incomplete';}
      else{confidence=RetrievalConfidence.LOW;reason='no contradiction evidence is currently available';}
    }else if(currentRows.length&&!unresolvedRows.length){
      confidence=RetrievalConfidence.HIGH;reason='fresh current evidence satisfies the requested state without unresolved conflict';
    }else if(unresolvedRows.length||historicalRows.length){
      confidence=RetrievalConfidence.MIXED;reason='useful evidence exists but current resolution is incomplete, historical, or conflicting';
    }else{
      confidence=RetrievalConfidence.LOW;reason='no useful current long-term memory is available';
    }

    const admittedCandidateIds=rows.filter(x=>x.truth.usableForIntent).map(x=>x.candidate.candidateId);
    const supportCandidateIds=(allowHistoricalSupport||confidence===RetrievalConfidence.MIXED)
      ? historicalRows.map(x=>x.candidate.candidateId):[];

    let correctiveRequest=null;
    if(confidence===RetrievalConfidence.MIXED&&attempt<maxCorrectiveAttempts){
      correctiveRequest=createCorrectiveRetrievalRequest({
        id:`corrective:${intent.toLowerCase()}:${attempt+1}:${uniq(candidates.map(c=>c.candidateId)).join('|')||'empty'}`,
        reason,originalQuery:query,intent,sourceRevisionIds:uniq(sourceRevisionIds.length?sourceRevisionIds:candidates.flatMap(c=>c.provenance?.sourceRevisionIds??[])),
        worldRevision,sceneRevision,priorCandidateIds:uniq(candidates.map(c=>c.candidateId)),
        missingEvidenceType:need,maxAttempts:maxCorrectiveAttempts,attempt:attempt+1,
      });
    }

    return createTruthAssessment({
      id:`truth-assessment:${intent.toLowerCase()}:${attempt}:${confidence.toLowerCase()}`,
      query,intent,confidence,truthResults,correctiveRequest,reason,
      admittedCandidateIds:uniq(admittedCandidateIds),supportCandidateIds:uniq(supportCandidateIds),
    });
  }

  executeCorrective(assessment,{retrieval,anchorEntityIds=[]}={}){
    const request=assessment.correctiveRequest;
    if(!request)return{assessment,candidates:[],executed:false,terminated:true};
    if(request.attempt>request.maxAttempts)return{assessment,candidates:[],executed:false,terminated:true};

    const correctiveIntent=request.intent==='HISTORICAL'?'TEMPORAL':'CONTRADICTION';
    const candidates=retrieval.retrieve(request.originalQuery,{intent:correctiveIntent,anchorEntityIds});
    return{assessment,candidates,executed:true,terminated:request.attempt>=request.maxAttempts};
  }
}

export { inferNeed as inferTruthNeed };
