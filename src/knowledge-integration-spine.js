import { createCandidateBusResult } from './contracts.js';
import {
  KnowledgeAuthorityOrigin,KnowledgeFreshness,KnowledgeSourceClass,KnowledgeTemporalStatus,
  KnowledgeContractError,classifyKnowledgeEvidenceFreshness,createKnowledgeEvidence,dedupeKnowledgeEvidence,normalizeKnowledgeAuthority,
} from './knowledge-evidence.js';

const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean).map(String))].sort();
const freezeDeep=(v)=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))freezeDeep(x);Object.freeze(v);}return v;};

export function knowledgeEvidenceFromRetrievalCandidate(candidate,{evidenceId=null,sourceClass=KnowledgeSourceClass.RETRIEVAL_CANDIDATE,sourceAuthorityClass=null,temporalStatus=null}={}){
  if(!candidate||typeof candidate!=='object')throw new KnowledgeContractError('KNOWLEDGE_CANDIDATE_INVALID','retrieval candidate is required');
  const candidateId=String(candidate.candidateId??candidate.ref??'');
  if(!candidateId)throw new KnowledgeContractError('KNOWLEDGE_CANDIDATE_INVALID','candidateId is required');
  const rawAuthority=sourceAuthorityClass??candidate.sourceAuthorityClass??candidate.authorityClass??'UNRESOLVED';
  const authority=normalizeKnowledgeAuthority(rawAuthority);
  const status=temporalStatus??candidate.truthStatus??candidate.temporalStatus??KnowledgeTemporalStatus.UNRESOLVED;
  const sourceRevisionRefs=uniq(candidate.sourceRevisionRefs??candidate.sourceRevisionSet??candidate.provenance?.sourceRevisionIds??[]);
  const provenanceRefs=uniq([
    ...(candidate.evidenceRefs??[]),
    ...(Array.isArray(candidate.provenance)?candidate.provenance.map(x=>typeof x==='string'?x:x?.ref).filter(Boolean):[]),
    ...(candidate.provenance?.sourceRevisionIds??[]),
  ]);
  const nominatedBy=uniq([...(candidate.nominatedBy??[]),candidate.channel].filter(Boolean));
  return createKnowledgeEvidence({
    evidenceId:evidenceId??'knowledge:'+candidateId,
    evidenceIdentity:candidate.evidenceIdentity??undefined,
    artifactRef:candidate.artifactRef??{candidateId,sourceId:candidate.sourceId??null},
    sourceClass,
    authorityClass:authority,
    authorityOrigin:KnowledgeAuthorityOrigin.CARRIED,
    sourceAuthorityClass:authority,
    temporalStatus:status,
    sourceRevisionRefs,
    dependencyRevisionRefs:uniq(candidate.dependencyRevisionRefs??[]),
    provenanceRefs,
    confidence:candidate.confidence??null,
    retrievalMetadata:{
      rankSignals:clone(candidate.rankSignals??candidate.scoreSignals??{}),
      inputRank:candidate.inputRank??null,
      sceneRelevance:candidate.sceneRelevance??null,
      temporalHints:clone(candidate.temporalHints??[]),
    },
    candidateLineage:{
      candidateRefs:[candidateId],
      evidenceIdentity:candidate.evidenceIdentity??null,
      nominationChannels:nominatedBy.length?nominatedBy:uniq(candidate.retrievalIntents??[]),
      evidenceRefs:uniq(candidate.evidenceRefs??[]),
    },
    contradictionSetId:candidate.contradictionSetId??null,
    hypothesisSetId:candidate.hypothesisSetId??null,
    claimIds:uniq(candidate.claimIds??[]),
    semantic:candidate.semantic??null,
  });
}

export function applyPrecisionResult(evidence,result){
  const item=evidence?.kind==='KnowledgeEvidence'?evidence:createKnowledgeEvidence(evidence);
  if(!result||typeof result!=='object')throw new KnowledgeContractError('KNOWLEDGE_PRECISION_INVALID','Precision result is required');
  const resultCandidate=String(result.candidateId??result.candidateRef??result.precisionCandidateRef??'');
  const candidates=new Set(item.candidateLineage?.candidateRefs??[]);
  if(resultCandidate&&candidates.size&&!candidates.has(resultCandidate))
    throw new KnowledgeContractError('KNOWLEDGE_REFERENCE_MISMATCH','Precision result references a different candidate',{resultCandidate,evidenceId:item.evidenceId});
  const freshness=String(result.freshness??'FRESH');
  if(freshness!=='FRESH')throw new KnowledgeContractError('KNOWLEDGE_STALE_PRECISION','Stale Precision result cannot authorize active admission',{candidateId:resultCandidate,freshness});
  const resultSources=uniq(result.sourceRevisionRefs??result.sourceRevisionIds??[]);
  if(resultSources.length){
    const expected=new Set(item.sourceRevisionRefs);
    if(resultSources.some(x=>!expected.has(x)))throw new KnowledgeContractError('KNOWLEDGE_REFERENCE_MISMATCH','Precision result source revision differs from evidence source',{candidateId:resultCandidate});
  }
  return createKnowledgeEvidence({
    ...clone(item),
    evidenceId:item.evidenceId,
    contractVersion:item.contractVersion,
    authorityClass:item.authorityClass,
    authorityOrigin:item.authorityOrigin,
    sourceAuthorityClass:item.sourceAuthorityClass,
    retrievalMetadata:{
      ...clone(item.retrievalMetadata),
      precision:{
        candidateId:resultCandidate||null,
        finalRank:result.finalRank??result.outputRank??null,
        score:result.normalizedScore??result.score??result.relevanceScore??null,
        semanticScore:result.semanticScore??null,
        reasonCodes:uniq(result.reasonCodes??result.reasons??[]),
        stagesUsed:uniq(result.stagesUsed??[]),
      },
    },
  });
}

export function knowledgeEvidenceToTruthCandidate(evidence){
  const item=evidence?.kind==='KnowledgeEvidence'?evidence:createKnowledgeEvidence(evidence);
  return createCandidateBusResult({
    candidateId:item.candidateLineage?.candidateRefs?.[0]??'knowledge-candidate:'+item.evidenceId,
    sourceType:item.sourceClass,
    sourceId:item.evidenceId,
    entityIds:uniq([item.semantic?.subjectId,item.semantic?.objectId].filter(Boolean)),
    claimIds:item.claimIds,
    scoreSignals:clone(item.retrievalMetadata?.rankSignals??{}),
    retrievalIntents:uniq(item.candidateLineage?.nominationChannels??[]),
    temporalStatus:item.temporalStatus,
    provenance:{
      id:'knowledge-prov:'+item.evidenceId,
      sourceRevisionIds:[...item.sourceRevisionRefs],
      evidenceIds:[item.evidenceId],
      derivedFromIds:uniq([item.artifactRef?.artifactId,item.artifactRef?.id].filter(Boolean)),
      activity:'KNOWLEDGE_EVIDENCE_ADMISSION',
      agent:'area52-core',
      invalidators:uniq([...item.sourceRevisionRefs,...item.dependencyRevisionRefs]),
      knowledgeEvidenceId:item.evidenceId,
      authorityClass:item.authorityClass,
      sourceClass:item.sourceClass,
    },
  });
}

export function createKnowledgeGatherReceipt({gatherId,evidence=[],truthResults=[]}={}){
  const truthByCandidate=new Map((truthResults??[]).map(x=>[x.candidateId,x]));
  const admitted=[],rejected=[];
  for(const item of evidence){
    const candidateId=item.candidateLineage?.candidateRefs?.[0]??'knowledge-candidate:'+item.evidenceId;
    const truth=truthByCandidate.get(candidateId);
    if(truth?.usableForIntent)admitted.push(item.evidenceId);else rejected.push(item.evidenceId);
  }
  return freezeDeep({kind:'KnowledgeGatherReceipt',contractVersion:'1.0.0',gatherId:String(gatherId),admittedEvidenceIds:uniq(admitted),rejectedEvidenceIds:uniq(rejected),authorityGranted:false,settlementAuthority:false});
}

export function reconstructKnowledgePath({
  contextItemId,sourceRevisionRefs=[],derivationChain=[],retrievalCandidateRef=null,precisionRef=null,truthRef=null,gatherRef=null,contextSealRef=null,promptPlanRef=null,maxDepth=64,
}={}){
  const chain=(derivationChain??[]).slice(0,maxDepth).map(clone);
  const truncated=(derivationChain?.length??0)>maxDepth;
  const missing=[];
  if(!contextItemId)missing.push('contextItemId');
  if(!sourceRevisionRefs?.length)missing.push('sourceRevisionRefs');
  return freezeDeep({
    kind:'KnowledgeDiagnosticReconstruction',contextItemId:contextItemId??null,sourceRevisionRefs:uniq(sourceRevisionRefs),
    derivationChain:chain,retrievalCandidateRef,precisionRef,truthRef,gatherRef,contextSealRef,promptPlanRef,
    complete:missing.length===0&&!truncated,missingRefs:missing,truncated,maxDepth,
  });
}

export class KnowledgeIntegrationSpine{
  constructor({core}){if(!core)throw new TypeError('KnowledgeIntegrationSpine requires core');this.core=core;}

  admitBatch({evidence=[],precisionResults=[],activeSourceRevisionRefs=null,activeDependencyRevisionRefs=null}={}){
    const deduped=dedupeKnowledgeEvidence(evidence);
    const precisionByCandidate=new Map((precisionResults??[]).map(x=>[String(x.candidateId??x.candidateRef??x.precisionCandidateRef??''),x]));
    const fresh=[],stale=[],rejected=[];
    for(const original of deduped.evidence){
      let item=original;
      const candidateRefs=item.candidateLineage?.candidateRefs??[];
      const precision=candidateRefs.map(id=>precisionByCandidate.get(id)).find(Boolean);
      try{if(precision)item=applyPrecisionResult(item,precision);}
      catch(error){rejected.push({evidenceId:item.evidenceId,code:error.code??'KNOWLEDGE_PRECISION_REJECTED',reason:error.message});continue;}
      const state=classifyKnowledgeEvidenceFreshness(item,{activeSourceRevisionRefs,activeDependencyRevisionRefs});
      if(state===KnowledgeFreshness.FRESH)fresh.push(item);
      else stale.push({evidence:item,freshness:state});
    }
    return freezeDeep({
      kind:'KnowledgeAdmissionBatch',fresh,stale,rejected,duplicateNominations:deduped.duplicateNominations,
      coreCandidates:fresh.map(knowledgeEvidenceToTruthCandidate),
      authorityGranted:false,settlementAuthority:false,
    });
  }

  compile({query,intent='CURRENT',evidence=[],precisionResults=[],activeSourceRevisionRefs=null,activeDependencyRevisionRefs=null,activeThreads=[]}={}){
    const admission=this.admitBatch({evidence,precisionResults,activeSourceRevisionRefs,activeDependencyRevisionRefs});
    const truthResults=this.core.truthGate.classifyAll(admission.coreCandidates,{intent});
    const gather=createKnowledgeGatherReceipt({gatherId:'knowledge-gather:'+String(query),evidence:admission.fresh,truthResults});
    const admittedSet=new Set(gather.admittedEvidenceIds);
    const admittedEvidence=admission.fresh.filter(x=>admittedSet.has(x.evidenceId));
    const compiled=this.core.compiler.compileDetailed({query,intent,truthResults,activeThreads,knowledgeEvidence:admittedEvidence});
    return freezeDeep({kind:'KnowledgeCompileResult',admission,truthResults,gather,packet:compiled.packet,compilerMetadata:compiled.metadata});
  }

  publishFixture({
    turnId,correlationId,generationId,query,intent='CURRENT',evidence=[],precisionResults=[],activeThreads=[],
    activeSourceRevisionRefs=null,activeDependencyRevisionRefs=null,worldRevision=this.core.graph.revision,sceneRevision=this.core.publication.sceneRevision,
    sealedAt=null,modelProfileId='RECENCY_WEIGHTED',
  }={}){
    const compiled=this.compile({query,intent,evidence,precisionResults,activeSourceRevisionRefs,activeDependencyRevisionRefs,activeThreads});
    const dependencies=uniq([
      ...(compiled.packet.dependencies??[]),
      ...compiled.admission.fresh.flatMap(x=>[...x.sourceRevisionRefs,...x.dependencyRevisionRefs]),
    ]);
    const sealed=this.core.publication.seal.seal({
      turnId,correlationId,packet:compiled.packet,sourceRevisionIds:dependencies,worldRevision,sceneRevision,
      admittedResultIds:[],rejectedResultIds:compiled.admission.rejected.map(x=>x.evidenceId),
      staleResultIds:compiled.admission.stale.map(x=>x.evidence.evidenceId),fallbackState:'NONE',sequence:1,sealedAt,dependencies,
    });
    const delivery=this.core.deliverGenerationContext({
      published:{packet:sealed.packet,sealReceipt:sealed.receipt},
      generationId,modelProfileId,userInput:query,
    });
    return freezeDeep({...compiled,packet:sealed.packet,sealReceipt:sealed.receipt,promptPlan:delivery.plan,delivery});
  }

  trace({contextItemId,evidence,truthClassification=null,gatherRef=null,contextSealRef=null,promptPlanRef=null}={}){
    const item=evidence?.kind==='KnowledgeEvidence'?evidence:createKnowledgeEvidence(evidence);
    const precision=item.retrievalMetadata?.precision??null;
    return reconstructKnowledgePath({
      contextItemId,
      sourceRevisionRefs:item.sourceRevisionRefs,
      derivationChain:[
        {kind:'KnowledgeEvidenceRef',ref:item.evidenceId,artifactRef:clone(item.artifactRef),sourceClass:item.sourceClass,authorityClass:item.authorityClass,temporalStatus:item.temporalStatus},
        ...item.provenanceRefs.map(ref=>({kind:'ProvenanceRef',ref})),
      ],
      retrievalCandidateRef:item.candidateLineage?.candidateRefs?.[0]??null,
      precisionRef:precision?.candidateId?{candidateId:precision.candidateId,reasonCodes:clone(precision.reasonCodes??[]),rank:precision.finalRank??null}:null,
      truthRef:truthClassification,
      gatherRef,contextSealRef,promptPlanRef,
    });
  }
}
