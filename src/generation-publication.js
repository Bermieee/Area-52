import { AuthorityClass } from './contracts.js';
import { ResultClass,ResultDestination,ResultPayloadClass,SealFallbackState,createCognitiveResult } from './publication-contracts.js';
import { ResultBus } from './result-bus.js';
import { TruthPublicationGate,inferTruthNeed } from './truth-publication-gate.js';
import { DeterministicPrecisionStub } from './precision-contract.js';
import { PublicationContextCompiler } from './publication-context-compiler.js';
import { GenerationContextSeal } from './context-seal.js';

const uniq=(values)=>[...new Set(values)].sort();

export class GenerationPublicationPipeline {
  constructor({core,sceneRevision=0}){
    this.core=core;
    this.sceneRevision=sceneRevision;
    this.seal=new GenerationContextSeal();
    this.resultBus=new ResultBus({
      registry:core.registry,
      getWorldRevision:()=>core.graph.revision,
      getSceneRevision:()=>this.sceneRevision,
      isTurnSealed:(turnId)=>this.seal.isTurnSealed(turnId),
    });
    this.truth=new TruthPublicationGate({truthGate:core.truthGate,graph:core.graph});
    this.precision=new DeterministicPrecisionStub({graph:core.graph});
    this.compiler=new PublicationContextCompiler({graph:core.graph,baseCompiler:core.compiler});
  }

  setSceneRevision(revision){this.sceneRevision=Number(revision);}

  publish({
    turnId,correlationId,query,intent='CURRENT',anchorEntityIds=[],
    budgetBytes=2500,deadline=null,sealedAt=null,precisionAvailable=true,
  }){
    const worldRevision=this.core.graph.revision,sceneRevision=this.sceneRevision;
    const primary=this.core.retrieval.retrieve(query,{intent,anchorEntityIds});
    for(const candidate of primary)this.resultBus.receiveCandidate(candidate,{
      taskId:`retrieve:${turnId}`,turnId,correlationId,sourceSubsystem:'SENSORY_NET',
      resultClass:ResultClass.REQUIRED,destination:ResultDestination.FOREGROUND,worldRevision,sceneRevision,
    });

    let candidates=this.#freshForegroundCandidates(turnId);
    let assessment=this.truth.assess(candidates,{
      query,intent,worldRevision,sceneRevision,attempt:0,maxCorrectiveAttempts:1,
    });
    let corrective={executed:false,terminated:true,candidates:[]};

    if(assessment.correctiveRequest){
      corrective=this.truth.executeCorrective(assessment,{retrieval:this.core.retrieval,anchorEntityIds});
      for(const candidate of corrective.candidates)this.resultBus.receiveCandidate(candidate,{
        taskId:`corrective:${turnId}`,turnId,correlationId,causationId:assessment.correctiveRequest.id,
        sourceSubsystem:'TRUTH_CORRECTIVE_RETRIEVAL',resultClass:ResultClass.REQUIRED,
        destination:ResultDestination.FOREGROUND,worldRevision,sceneRevision,
      });
      candidates=this.#freshForegroundCandidates(turnId);
      assessment=this.truth.assess(candidates,{
        query,intent,worldRevision,sceneRevision,attempt:1,maxCorrectiveAttempts:1,allowHistoricalSupport:true,
      });
    }

    const precisionResults=precisionAvailable
      ?this.precision.rank(candidates,{query,intent,worldRevision,sceneRevision})
      :[];
    for(const precisionResult of precisionResults){
      this.resultBus.receive(createCognitiveResult({
        id:`result:precision:${precisionResult.candidateId}:${correlationId}`,
        taskId:`precision:${turnId}`,turnId,correlationId,causationId:null,
        sourceSubsystem:'PRECISION',workerId:'deterministic-reference',destinationOwner:null,
        resultType:'PRECISION_RESULT',resultClass:ResultClass.REQUIRED,payloadClass:ResultPayloadClass.DERIVED_DATA,
        evidenceIds:[precisionResult.candidateId],provenance:{candidateId:precisionResult.candidateId},
        sourceRevisionIds:precisionResult.sourceRevisionIds,worldRevision:precisionResult.worldRevision,
        sceneRevision:precisionResult.sceneRevision,authorityClass:'UNRESOLVED',
        destination:ResultDestination.FOREGROUND,payload:precisionResult,timing:{latencyMs:precisionResult.latencyMs},
      }));
    }
    const usablePrecision=this.resultBus.foreground(turnId)
      .filter(x=>x.result.resultType==='PRECISION_RESULT')
      .map(x=>x.result.payload);
    const unknownSlots=this.#unknownSlots(query,intent,anchorEntityIds);
    const compiled=this.compiler.compile({
      query,intent,truthAssessment:assessment,precisionResults:usablePrecision,budgetBytes,unknownSlots,rawEvidence:candidates,
    });

    const turnResults=this.resultBus.results({turnId});
    const candidateToResult=new Map(turnResults.map(x=>[x.result.payload?.candidateId,x]));
    const admittedCandidateIds=uniq([...assessment.admittedCandidateIds,...assessment.supportCandidateIds]);
    const admittedResultIds=uniq([
      ...admittedCandidateIds.map(id=>candidateToResult.get(id)?.result.id).filter(Boolean),
      ...turnResults.filter(x=>x.route.effectiveDestination===ResultDestination.FOREGROUND&&x.route.freshness==='FRESH'&&x.result.resultType==='PRECISION_RESULT').map(x=>x.result.id),
    ]);
    const staleResultIds=uniq(turnResults.filter(x=>x.route.freshness==='STALE').map(x=>x.result.id));
    const rejectedResultIds=uniq(turnResults.filter(x=>!x.route.accepted).map(x=>x.result.id));

    let fallbackState=SealFallbackState.NONE;
    if(!precisionAvailable)fallbackState=SealFallbackState.PRECISION_FALLBACK;
    if(compiled.receipt.fallbackUsed)fallbackState=SealFallbackState.RICH_CONTEXT;
    if(corrective.executed&&assessment.confidence==='MIXED'&&fallbackState===SealFallbackState.NONE)fallbackState=SealFallbackState.CORRECTIVE_FAILED;

    const sealed=this.seal.seal({
      turnId,correlationId,packet:compiled.packet,sourceRevisionIds:compiled.packet.dependencies,
      worldRevision,sceneRevision,admittedResultIds,rejectedResultIds,staleResultIds,
      fallbackState,deadline,sealedAt,dependencies:compiled.packet.dependencies,
    });
    return{
      worldRevision,sceneRevision,primaryCandidates:primary,candidates,assessment,corrective,
      precisionResults:usablePrecision,compilerReceipt:compiled.receipt,packet:sealed.packet,sealReceipt:sealed.receipt,
      resultRoutes:turnResults,
    };
  }

  receiveResult(result){return this.resultBus.receive(result);}

  #freshForegroundCandidates(turnId){
    const rows=this.resultBus.foreground(turnId);
    const merged=new Map();
    for(const row of rows){
      const candidate=row.result.payload;
      if(candidate?.candidateId)merged.set(candidate.candidateId,candidate);
    }
    return[...merged.values()].sort((a,b)=>a.candidateId.localeCompare(b.candidateId));
  }

  #unknownSlots(query,intent,anchorEntityIds){
    if(intent!=='CURRENT'||inferTruthNeed(query)!=='location')return[];
    const rows=[];
    for(const subjectId of anchorEntityIds){
      const current=this.core.graph.currentClaims({subjectId,predicate:'location'});
      if(current.length)continue;
      const history=this.core.graph.historicalClaims({subjectId,predicate:'location'});
      const unresolved=this.core.graph.unresolvedClaims({subjectId});
      if(!history.length&&!unresolved.length)continue;
      rows.push({
        subjectId,predicate:'location',
        reason:'no settled current location; historical location and/or disputed fate exists',
        supportClaimIds:uniq([...history.map(c=>c.id),...unresolved.map(c=>c.id)]),
      });
    }
    return rows;
  }
}

export function createRetrievalResultEnvelope(candidate,{
  id,taskId,turnId,correlationId,worldRevision,sceneRevision=0,resultClass=ResultClass.OPPORTUNISTIC,
  destination=ResultDestination.FOREGROUND,
}){
  return{
    id,taskId,turnId,correlationId,sourceSubsystem:'PRECISION_OR_RETRIEVAL',workerId:'external-compatible',
    destinationOwner:null,resultType:'RETRIEVAL_CANDIDATE',resultClass,payloadClass:'DERIVED_DATA',
    evidenceIds:[...(candidate.claimIds??[])],provenance:candidate.provenance??{},
    sourceRevisionIds:uniq(candidate.provenance?.sourceRevisionIds??[]),worldRevision,sceneRevision,
    authorityClass:AuthorityClass.UNRESOLVED,destination,payload:candidate,timing:{},
  };
}
