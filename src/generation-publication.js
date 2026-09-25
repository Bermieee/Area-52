import { AuthorityClass } from './contracts.js';
import { CandidateFreshness } from './candidate-bus-contracts.js';
import { ResultClass,ResultDestination,ResultPayloadClass,SealFallbackState,createCognitiveResult,createTruthAssessment } from './publication-contracts.js';
import { ResultBus } from './result-bus.js';
import { TruthPublicationGate,inferTruthNeed } from './truth-publication-gate.js';
import { DeterministicPrecisionStub } from './precision-contract.js';
import { PublicationContextCompiler } from './publication-context-compiler.js';
import { GenerationContextSeal } from './context-seal.js';
import { buildHotCognitionCompilerProjection,attachHotCognitionToPacket } from './hot-cognition-context.js';
import { stableHash,utf8ByteLength } from './browser-runtime-utils.js';

const uniq=(values)=>[...new Set(values)].sort();
const emptyAssessment=({turnId,query,intent,reason})=>createTruthAssessment({
  id:`truth-assessment:skipped:${turnId}`,query,intent,confidence:'LOW',truthResults:[],correctiveRequest:null,
  reason,admittedCandidateIds:[],supportCandidateIds:[],
});

export class GenerationPublicationPipeline {
  constructor({core,sceneRevision=0,cognitiveChoice=null,maxPublishedTurns=64}){
    this.core=core;
    this.sceneRevision=sceneRevision;
    this.sceneId=null;
    this.choice=cognitiveChoice??core.cognitiveChoice??null;
    this.maxPublishedTurns=Math.max(8,Number(maxPublishedTurns)||64);
    this.publishedTurns=new Map();
    this.publishedOrder=[];
    this.seal=new GenerationContextSeal();
    this.resultBus=new ResultBus({
      registry:core.registry,
      getWorldRevision:()=>core.graph.revision,
      getSceneRevision:()=>this.sceneRevision,
      isTurnSealed:(turnId)=>this.seal.isTurnSealed(turnId),
      isSourceRevisionCurrent:(revisionId)=>core.isSourceRevisionCurrent?.(revisionId)??core.registry.isActiveRevision(revisionId),
    });
    this.truth=new TruthPublicationGate({truthGate:core.truthGate,graph:core.graph});
    this.precision=new DeterministicPrecisionStub({graph:core.graph});
    this.compiler=new PublicationContextCompiler({graph:core.graph,baseCompiler:core.compiler});
  }

  setSceneRevision(revision,{sceneId=null}={}){
    const next=Number(revision);if(!Number.isInteger(next)||next<0)return this.sceneRevision;
    if(sceneId!=null&&this.sceneId!==null&&String(sceneId)!==String(this.sceneId)){this.sceneId=String(sceneId);this.sceneRevision=next;return this.sceneRevision;}
    if(sceneId!=null)this.sceneId=String(sceneId);this.sceneRevision=Math.max(this.sceneRevision,next);return this.sceneRevision;
  }

  publish({
    turnId,turnRevision=0,correlationId,query,intent='CURRENT',anchorEntityIds=[],
    budgetBytes=2500,deadline=null,sealedAt=null,precisionAvailable=true,activeThreads=[],channelIds=null,perspectiveConstraint=null,
  }){
    const fingerprint=stableHash({
      turnId,turnRevision,correlationId,query,intent,anchorEntityIds:uniq(anchorEntityIds),budgetBytes,deadline,
      precisionAvailable:Boolean(precisionAvailable),activeThreads,channelIds:channelIds?uniq(channelIds):null,perspectiveConstraint,
    },{length:24});
    const replay=this.publishedTurns.get(String(turnId));
    if(replay){
      if(replay.fingerprint!==fingerprint)throw new Error(`Turn ${turnId} is already sealed with different cognitive-choice inputs`);
      const receipt=this.choice?.markDuplicate?.(turnId)??replay.output.cognitiveChoiceReceipt??null;
      return{...replay.output,cognitiveChoiceReceipt:receipt,duplicate:true};
    }

    const hotSnapshot=this.core.hotCognition?.hasMeaningfulState?.()?this.core.hotCognition.snapshot():null;
    const sceneTrace=this.core.sceneIntegration?.publicationTrace?.(hotSnapshot?.chatNamespace)??null;
    if(sceneTrace?.sceneId)this.setSceneRevision(sceneTrace.sceneRevision,{sceneId:sceneTrace.sceneId});
    else if(hotSnapshot?.sceneId)this.setSceneRevision(hotSnapshot.sceneRevision,{sceneId:hotSnapshot.sceneId});
    else if(hotSnapshot?.sceneRevision&&hotSnapshot.sceneRevision>this.sceneRevision)this.sceneRevision=hotSnapshot.sceneRevision;
    const worldRevision=this.core.graph.revision,sceneRevision=this.sceneRevision;
    const sceneAnchors=sceneTrace?.retrievalRequired?uniq([...(sceneTrace.activeAnchorIds??[]),...(sceneTrace.activeObjectIds??[])]):[];
    const effectiveAnchorEntityIds=uniq([...anchorEntityIds,...sceneAnchors]);
    const hotProjection=hotSnapshot?buildHotCognitionCompilerProjection(hotSnapshot,{perspectiveConstraint}):null;
    const choiceSession=this.choice?.begin?.({
      turnId,turnRevision,correlationId,query,intent,anchorEntityIds:effectiveAnchorEntityIds,hotSnapshot,worldRevision,sceneRevision,
      budgetBytes,deadline,channelIds,channelManifest:this.core.retrieval.manifest(),sceneContext:sceneTrace,
    })??null;

    let primary=[],primaryEnvelope=null,correctiveEnvelope=null,candidates=[];
    let assessment=null,publicationAssessment=null;
    let corrective={executed:false,terminated:true,candidates:[],failed:false,error:null};
    let precisionResults=[],precisionFailed=false;

    if(choiceSession?.hotOnly){
      publicationAssessment=emptyAssessment({turnId,query,intent,reason:'long-term retrieval and Truth were skipped because Hot Cognition satisfied the turn'});
    }else{
      primaryEnvelope=this.core.retrieval.retrieveEnvelope(query,{intent,anchorEntityIds:effectiveAnchorEntityIds,worldRevision,sceneRevision,channelIds,retrievalIntents:[{kind:intent,query,entityRefs:effectiveAnchorEntityIds,perspective:perspectiveConstraint}],metadata:{sceneId:sceneTrace?.sceneId??null,sceneRevision,sceneIntegrationReceiptId:sceneTrace?.lastReceiptId??null}});
      this.choice?.observeRetrieval?.(choiceSession,primaryEnvelope,{phase:'PRIMARY'});
      primary=primaryEnvelope.candidates.filter(candidate=>candidate.freshness===CandidateFreshness.FRESH);
      for(const candidate of primary)this.resultBus.receiveCandidate(candidate,{
        taskId:`retrieve:${turnId}`,turnId,correlationId,sourceSubsystem:'SENSORY_NET',
        resultClass:ResultClass.REQUIRED,destination:ResultDestination.FOREGROUND,worldRevision,sceneRevision,
      });

      candidates=this.#freshForegroundCandidates(turnId);
      assessment=this.truth.assess(candidates,{
        query,intent,worldRevision,sceneRevision,attempt:0,maxCorrectiveAttempts:1,
      });
      this.choice?.observeQuality?.(choiceSession,assessment.confidence,{correctiveRequested:Boolean(assessment.correctiveRequest)});

      if(assessment.correctiveRequest){
        corrective=this.truth.executeCorrective(assessment,{retrieval:this.core.retrieval,anchorEntityIds:effectiveAnchorEntityIds,perspectiveConstraint});
        if(corrective.executed&&!corrective.failed){
          correctiveEnvelope=this.core.retrieval.lastEnvelope??null;
          if(correctiveEnvelope)this.choice?.observeRetrieval?.(choiceSession,correctiveEnvelope,{phase:'CORRECTIVE'});
        }else if(corrective.executed){
          choiceSession.correctionExecuted=true;choiceSession.correctionCount+=1;choiceSession.correctionFailed=true;
        }
        for(const candidate of corrective.candidates)this.resultBus.receiveCandidate(candidate,{
          taskId:`corrective:${turnId}`,turnId,correlationId,causationId:assessment.correctiveRequest.id,
          sourceSubsystem:'TRUTH_CORRECTIVE_RETRIEVAL',resultClass:ResultClass.REQUIRED,
          destination:ResultDestination.FOREGROUND,worldRevision,sceneRevision,
        });
        candidates=this.#freshForegroundCandidates(turnId);
        assessment=this.truth.assess(candidates,{
          query,intent,worldRevision,sceneRevision,attempt:1,maxCorrectiveAttempts:1,allowHistoricalSupport:true,
        });
        this.choice?.observeQuality?.(choiceSession,assessment.confidence,{correctiveRequested:false,correctionFailed:Boolean(corrective.failed)});
        this.choice?.noteCorrectionLimit?.(choiceSession);
      }

      publicationAssessment=assessment.confidence==='LOW'
        ?emptyAssessment({turnId,query,intent,reason:'retrieval quality LOW; weak long-term-memory evidence abstained from generation'})
        :assessment;

      if(assessment.confidence==='LOW')this.choice?.evaluateJev?.(choiceSession,[]);
      else this.choice?.evaluateJev?.(choiceSession,assessment.truthResults);

      const precisionDecision=this.choice?.decidePrecision?.(choiceSession,{
        candidateCount:uniq([...(publicationAssessment.admittedCandidateIds??[]),...(publicationAssessment.supportCandidateIds??[])]).length,
        quality:assessment.confidence,precisionAvailable,
      })??{invoked:Boolean(precisionAvailable),required:true,fallback:!precisionAvailable};

      if(precisionDecision.invoked){
        try{precisionResults=this.precision.rank(candidates,{query,intent,worldRevision,sceneRevision});}
        catch(error){precisionFailed=true;precisionResults=[];}
      }
      this.choice?.recordPrecisionOutcome?.(choiceSession,{failed:precisionFailed,resultCount:precisionResults.length});

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
    }

    const usablePrecision=this.resultBus.foreground(turnId)
      .filter(x=>x.result.resultType==='PRECISION_RESULT')
      .map(x=>x.result.payload);
    const lowAbstention=assessment?.confidence==='LOW';
    const admittedKnowledgeCandidateIds=new Set([
      ...(publicationAssessment?.admittedCandidateIds??[]),
      ...(publicationAssessment?.supportCandidateIds??[]),
    ]);
    const precisionByCandidate=new Map(usablePrecision.map(row=>[row.candidateId,row]));
    const admittedKnowledgeEvidence=(lowAbstention||choiceSession?.hotOnly?[]:candidates)
      .filter(candidate=>admittedKnowledgeCandidateIds.has(candidate.candidateId))
      .map(candidate=>{
        const evidence=this.core.resolveExternalKnowledge?.(candidate)??null;
        if(!evidence)return null;
        const precision=precisionByCandidate.get(candidate.candidateId)??null;
        return {
          ...structuredClone(evidence),
          representationText:candidate.representationText??'',
          candidateLineage:{
            ...(structuredClone(evidence.candidateLineage??{})),
            candidateRefs:uniq([...(evidence.candidateLineage?.candidateRefs??[]),candidate.candidateId]),
            nominationChannels:uniq([...(evidence.candidateLineage?.nominationChannels??[]),...(candidate.channelNominations??[]).map(x=>x.channelId)]),
            evidenceRefs:uniq([...(evidence.candidateLineage?.evidenceRefs??[]),...(candidate.evidenceRefs??[])]),
          },
          retrievalMetadata:{
            ...(structuredClone(evidence.retrievalMetadata??{})),
            fusionScore:candidate.fusionScore??null,
            precision:precision?{candidateId:precision.candidateId,finalRank:precision.finalRank,score:precision.normalizedScore,freshness:precision.freshness}:null,
          },
        };
      }).filter(Boolean);
    const unknownSlots=lowAbstention||choiceSession?.hotOnly?[]:this.#unknownSlots(query,intent,effectiveAnchorEntityIds);
    let compiled=this.compiler.compile({
      query,intent,truthAssessment:publicationAssessment,precisionResults:usablePrecision,budgetBytes,unknownSlots,
      rawEvidence:lowAbstention||choiceSession?.hotOnly?[]:candidates,activeThreads,knowledgeEvidence:admittedKnowledgeEvidence,
    });
    let hotContributions=[];
    if(hotProjection?.facts?.length){
      const attached=attachHotCognitionToPacket(compiled.packet,hotProjection);
      hotContributions=attached.contributions;
      compiled={...compiled,packet:attached.packet,receipt:{...compiled.receipt,packetId:attached.packet.id,compiledBytes:utf8ByteLength(JSON.stringify(attached.packet)),reason:compiled.receipt.reason+'; Hot Cognition snapshot '+hotProjection.snapshotId+' attached through sealed semantic contributions'}};
    }
    if(sceneTrace){
      const packet=structuredClone(compiled.packet);
      packet.sceneIntegration=structuredClone(sceneTrace);
      packet.sceneId=sceneTrace.sceneId;packet.sceneRevision=sceneTrace.sceneRevision;
      packet.sceneProvenanceRefs=uniq(sceneTrace.provenanceRefs??[]);
      packet.dependencies=uniq([...(packet.dependencies??[]),...(sceneTrace.sourceRevisionRefs??[])]);
      packet.id=String(packet.id)+':scene:'+stableHash({sceneId:sceneTrace.sceneId,sceneRevision:sceneTrace.sceneRevision,invalidationEpoch:sceneTrace.contextInvalidationEpoch,receipt:sceneTrace.lastReceiptId},{length:16});
      compiled={...compiled,packet,receipt:{...compiled.receipt,id:'compiler-receipt:'+packet.id,packetId:packet.id,compiledBytes:utf8ByteLength(JSON.stringify(packet)),reason:compiled.receipt.reason+'; native Scene integration trace '+sceneTrace.sceneId+'@'+sceneTrace.sceneRevision+' attached'}};
    }

    const turnResults=this.resultBus.results({turnId});
    const candidateToResult=new Map(turnResults.map(x=>[x.result.payload?.candidateId,x]));
    const admittedCandidateIds=uniq([
      ...(publicationAssessment?.admittedCandidateIds??[]),...(publicationAssessment?.supportCandidateIds??[]),
    ]);
    const admittedResultIds=uniq([
      ...admittedCandidateIds.map(id=>candidateToResult.get(id)?.result.id).filter(Boolean),
      ...turnResults.filter(x=>x.route.effectiveDestination===ResultDestination.FOREGROUND&&x.route.freshness==='FRESH'&&x.result.resultType==='PRECISION_RESULT').map(x=>x.result.id),
    ]);
    const staleResultIds=uniq(turnResults.filter(x=>x.route.freshness==='STALE').map(x=>x.result.id));
    const rejectedResultIds=uniq(turnResults.filter(x=>!x.route.accepted).map(x=>x.result.id));
    const gatherReceipt={
      kind:'GenerationGatherReceipt',turnId,correlationId,sceneId:sceneTrace?.sceneId??this.sceneId,sceneRevision,
      sourceRevisionRefs:uniq(sceneTrace?.sourceRevisionRefs??[]),provenanceRefs:uniq(sceneTrace?.provenanceRefs??[]),
      foregroundResultIds:uniq(turnResults.filter(x=>x.route.effectiveDestination===ResultDestination.FOREGROUND&&x.route.freshness==='FRESH').map(x=>x.result.id)),
      admittedResultIds:[...admittedResultIds],staleResultIds:[...staleResultIds],rejectedResultIds:[...rejectedResultIds],
      cognitiveNeeds:structuredClone(sceneTrace?.cognitiveNeeds??[]),deadline,closedForForeground:true,authorityGranted:false,canonicalMutationAuthority:false,
    };

    let fallbackState=SealFallbackState.NONE;
    const precisionState=choiceSession?.precision??{};
    if(precisionState.required&&(precisionState.fallback||precisionFailed))fallbackState=SealFallbackState.PRECISION_FALLBACK;
    if(compiled.receipt.fallbackUsed)fallbackState=SealFallbackState.RICH_CONTEXT;
    if(corrective.failed&&fallbackState===SealFallbackState.NONE)fallbackState=SealFallbackState.CORRECTIVE_FAILED;
    else if(corrective.executed&&corrective.terminated&&assessment?.confidence==='MIXED'&&fallbackState===SealFallbackState.NONE)fallbackState=SealFallbackState.CORRECTIVE_EXHAUSTED;

    const sealed=this.seal.seal({
      turnId,correlationId,packet:compiled.packet,sourceRevisionIds:compiled.packet.dependencies,
      worldRevision,sceneRevision,admittedResultIds,rejectedResultIds,staleResultIds,
      fallbackState,deadline,sealedAt,dependencies:compiled.packet.dependencies,
    });
    if(hotSnapshot)this.core.hotCognition?.noteGenerationSeal?.({turnId,sealReceipt:sealed.receipt,snapshot:hotSnapshot});

    const finalRoutes=this.resultBus.results({turnId});
    const cognitiveChoiceReceipt=this.choice?.finalize?.(choiceSession,{
      assessment,publicationAssessment,corrective,packet:sealed.packet,sealReceipt:sealed.receipt,resultRoutes:finalRoutes,
      precisionResults:usablePrecision,precisionFailed,compilerReceipt:compiled.receipt,
    })??null;
    if(sceneTrace)this.core.sceneIntegration?.noteSeal?.({chatNamespace:hotSnapshot?.chatNamespace,sealReceipt:sealed.receipt});

    const output={
      worldRevision,sceneRevision,primaryCandidates:primary,candidates,assessment,publicationAssessment,corrective,
      precisionResults:usablePrecision,precisionFailed,compilerReceipt:compiled.receipt,packet:sealed.packet,sealReceipt:sealed.receipt,
      candidateEnvelope:primaryEnvelope,candidateEnvelopes:[primaryEnvelope,correctiveEnvelope].filter(Boolean),
      hotCognition:hotSnapshot?{snapshotId:hotSnapshot.snapshotId,hotRevision:hotSnapshot.hotRevision,chatNamespace:hotSnapshot.chatNamespace}:null,
      hotContributions,resultRoutes:finalRoutes,cognitiveChoiceReceipt,gatherReceipt,sceneIntegration:sceneTrace,duplicate:false,
    };
    this.#rememberPublished(turnId,fingerprint,output);
    return output;
  }

  receiveResult(result){
    const received=this.resultBus.receive(result);
    this.choice?.observeResultRoute?.(received);
    return received;
  }

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

  #rememberPublished(turnId,fingerprint,output){
    const key=String(turnId);if(!this.publishedTurns.has(key))this.publishedOrder.push(key);
    this.publishedTurns.set(key,{fingerprint,output});
    while(this.publishedOrder.length>this.maxPublishedTurns){const old=this.publishedOrder.shift();this.publishedTurns.delete(old);}
  }
}

export function createRetrievalResultEnvelope(candidate,{
  id,taskId,turnId,correlationId,worldRevision,sceneRevision=0,resultClass=ResultClass.OPPORTUNISTIC,
  destination=ResultDestination.FOREGROUND,
}){
  return{
    id,taskId,turnId,correlationId,sourceSubsystem:'PRECISION_OR_RETRIEVAL',workerId:'external-compatible',
    destinationOwner:null,resultType:'RETRIEVAL_CANDIDATE',resultClass,payloadClass:'DERIVED_DATA',
    evidenceIds:[...(candidate.claimIds??candidate.claimRefs??[])],provenance:candidate.legacyProvenance??(Array.isArray(candidate.provenance)?{sourceRevisionIds:[...(candidate.sourceRevisionRefs??[])],candidateProvenance:candidate.provenance}:candidate.provenance??{}),
    sourceRevisionIds:uniq(candidate.sourceRevisionRefs??candidate.legacyProvenance?.sourceRevisionIds??candidate.provenance?.sourceRevisionIds??[]),worldRevision,sceneRevision,
    authorityClass:AuthorityClass.UNRESOLVED,destination,payload:candidate,timing:{},
  };
}
