import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {ResultClass,ResultDestination,ResultPayloadClass,createCognitiveResult} from '../src/publication-contracts.js';
import {CognitiveChoicePath,CognitiveJob,CognitiveReason,JevAction} from '../src/cognitive-choice-contracts.js';
import {EMBER_TAVERN_WAVE3} from './fixtures/ember-tavern-wave3.js';
import {sceneSignal} from './hot-cognition-wave7-harness.js';

function loadEmber(){
  const core=new Area52CognitiveCore();
  for(const row of EMBER_TAVERN_WAVE3.sources)core.importAndLearn(row);
  for(const row of EMBER_TAVERN_WAVE3.experiences)core.importAndLearn(row);
  return core;
}

function highCore(id='wave9:high'){
  const core=new Area52CognitiveCore();
  core.importAndLearn({id,sourceType:'LORE',content:'The Relic is intact.',at:0});
  return core;
}

function publishHigh(core,turnId='w9:high:turn',extra={}){
  return core.publishGenerationContext({
    turnId,correlationId:'corr:'+turnId,query:'What is the Relic state?',intent:'CURRENT',
    anchorEntityIds:['relic'],sealedAt:100,...extra,
  });
}

export function runCognitiveChoiceWave9Acceptance(){
  const hot=new Area52CognitiveCore();
  hot.activateHotCognitionChat('chat:wave9-hot');
  hot.consumeSceneSignal(sceneSignal({sceneId:'scene:wave9',sceneRevision:1,place:'ember-tavern',subLocation:'main-room'}));
  const hotOut=hot.publishGenerationContext({
    turnId:'w9:hot:turn',turnRevision:1,correlationId:'corr:w9:hot',query:'Continue the current scene.',
    intent:'CURRENT',anchorEntityIds:[],sealedAt:10,
  });

  const high=highCore(),highOut=publishHigh(high);
  const low=new Area52CognitiveCore(),lowOut=low.publishGenerationContext({
    turnId:'w9:low:turn',correlationId:'corr:w9:low',query:'Who is the Moon Emperor?',intent:'CURRENT',
    anchorEntityIds:[],sealedAt:20,
  });

  const mixed=loadEmber(),mixedBefore=JSON.stringify(mixed.currentWorldModel().unresolved),mixedOut=mixed.publishGenerationContext({
    turnId:'w9:mixed:turn',correlationId:'corr:w9:mixed',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',
    anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:30,
  });

  const truthCounts=mixedOut.cognitiveChoiceReceipt.truthGate.outcomeCounts;
  let jevCalls=0;
  const jev=loadEmber();
  jev.registerJevAdapter({invoke:(request)=>{
    jevCalls+=1;
    return{status:'ABSTAINED',decisionId:'jev:wave9:abstain',decisionRevision:'jev-rev:1',alternativeCount:request.alternatives.length};
  }});
  const jevBefore=JSON.stringify(jev.currentWorldModel());
  const jevOut=jev.publishGenerationContext({
    turnId:'w9:jev:turn',correlationId:'corr:w9:jev',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',
    anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:40,
  });
  const jevReplay=jev.publishGenerationContext({
    turnId:'w9:jev:turn',correlationId:'corr:w9:jev',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',
    anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:41,
  });

  const lateId='result:wave9:late';
  const late=high.publication.receiveResult(createCognitiveResult({
    id:lateId,taskId:'late:task',turnId:'w9:high:turn',correlationId:'corr:w9:high:turn',
    sourceSubsystem:'WAVE9_TEST',resultType:'LATE_OBSERVATION',resultClass:ResultClass.OPPORTUNISTIC,
    payloadClass:ResultPayloadClass.DERIVED_DATA,evidenceIds:[],provenance:{late:true},
    sourceRevisionIds:[],worldRevision:highOut.worldRevision,sceneRevision:highOut.sceneRevision,
    authorityClass:'UNRESOLVED',destination:ResultDestination.FOREGROUND,payload:{ok:true},timing:{},
  }));
  const lateReceipt=high.cognitiveChoiceReceipt('w9:high:turn');

  const stale=highCore('wave9:stale');
  const staleOut=publishHigh(stale,'w9:stale:turn');
  stale.editAndRelearn('wave9:stale','The Relic is damaged.');
  const staleId='result:wave9:stale';
  const staleRoute=stale.publication.receiveResult(createCognitiveResult({
    id:staleId,taskId:'stale:task',turnId:'w9:stale:turn',correlationId:'corr:w9:stale:turn',
    sourceSubsystem:'WAVE9_TEST',resultType:'STALE_OBSERVATION',resultClass:ResultClass.REQUIRED,
    payloadClass:ResultPayloadClass.DERIVED_DATA,evidenceIds:[],provenance:{source:'old'},
    sourceRevisionIds:['wave9:stale@1'],worldRevision:staleOut.worldRevision,sceneRevision:staleOut.sceneRevision,
    authorityClass:'UNRESOLVED',destination:ResultDestination.FOREGROUND,payload:{ok:true},timing:{},
  }));
  const staleReceipt=stale.cognitiveChoiceReceipt('w9:stale:turn');

  const orderA=highCore('wave9:order'),orderB=highCore('wave9:order');
  const channels=orderA.sensoryManifest().channels.map(x=>x.channelId);
  const orderAOut=publishHigh(orderA,'w9:order:a',{channelIds:channels});
  const orderBOut=publishHigh(orderB,'w9:order:b',{channelIds:[...channels].reverse()});

  const replayCore=highCore('wave9:replay');
  const beforeFusion=replayCore.sensoryDiagnostics().candidateBus.counters.fusions;
  const replayFirst=publishHigh(replayCore,'w9:replay:turn');
  const afterFirstFusion=replayCore.sensoryDiagnostics().candidateBus.counters.fusions;
  const replaySecond=publishHigh(replayCore,'w9:replay:turn');
  const afterReplayFusion=replayCore.sensoryDiagnostics().candidateBus.counters.fusions;

  const noPrecision=loadEmber(),noPrecisionOut=noPrecision.publishGenerationContext({
    turnId:'w9:no-precision',correlationId:'corr:w9:no-precision',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',
    anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,precisionAvailable:false,sealedAt:50,
  });

  const metrics={
    hotOnlyPath:hotOut.cognitiveChoiceReceipt.paths.includes(CognitiveChoicePath.HOT_ONLY),
    hotOnlySkippedRetrieval:hotOut.candidateEnvelope===null&&hotOut.primaryCandidates.length===0&&hotOut.cognitiveChoiceReceipt.skippedJobs.includes(CognitiveJob.RETRIEVAL),
    hotOnlyUsesHotContext:(hotOut.packet.hotCognition??[]).length>0&&hotOut.cognitiveChoiceReceipt.reasonCodes.includes(CognitiveReason.HOT_SUFFICIENT),
    highRetrieval:highOut.assessment.confidence==='HIGH'&&highOut.cognitiveChoiceReceipt.paths.includes(CognitiveChoicePath.STANDARD_RETRIEVAL),
    highMultiChannel:highOut.cognitiveChoiceReceipt.candidateCounts.nominated>highOut.cognitiveChoiceReceipt.candidateCounts.deduplicated&&highOut.cognitiveChoiceReceipt.sensoryChannelsUsed.length>1,
    highNoCorrection:highOut.cognitiveChoiceReceipt.correctiveRetrieval.correctionCount===0,
    precisionSkippedTinyExact:highOut.cognitiveChoiceReceipt.precision.skipped===true&&highOut.cognitiveChoiceReceipt.reasonCodes.includes(CognitiveReason.PRECISION_NOT_REQUIRED),
    mixedDetected:mixedOut.cognitiveChoiceReceipt.paths.includes(CognitiveChoicePath.MIXED_CORRECTION)&&mixedOut.cognitiveChoiceReceipt.reasonCodes.includes(CognitiveReason.RETRIEVAL_MIXED),
    oneCorrection:mixedOut.cognitiveChoiceReceipt.correctiveRetrieval.requested===true&&mixedOut.cognitiveChoiceReceipt.correctiveRetrieval.executed===true&&mixedOut.cognitiveChoiceReceipt.correctiveRetrieval.correctionCount===1,
    correctionBounded:mixedOut.cognitiveChoiceReceipt.correctiveRetrieval.maxCorrections===1&&mixedOut.corrective.terminated===true,
    lowAbstains:lowOut.assessment.confidence==='LOW'&&lowOut.cognitiveChoiceReceipt.paths.includes(CognitiveChoicePath.LOW_ABSTAIN)&&lowOut.cognitiveChoiceReceipt.abstained===true,
    lowOmitsLongTerm:lowOut.packet.current.length===0&&lowOut.packet.historical.length===0&&lowOut.packet.unresolved.length===0&&lowOut.cognitiveChoiceReceipt.candidateCounts.truthAdmitted===0,
    truthCurrentAndHistorical:truthCounts.CURRENT>0&&truthCounts.HISTORICAL>0,
    ambiguityPreserved:mixedOut.cognitiveChoiceReceipt.unresolved===true&&mixedOut.cognitiveChoiceReceipt.jev.unavailable===true&&mixedOut.cognitiveChoiceReceipt.jev.action===JevAction.JEV_UNAVAILABLE&&JSON.stringify(mixed.currentWorldModel().unresolved)===mixedBefore,
    jevInvokedAndAbstains:jevCalls===1&&jevOut.cognitiveChoiceReceipt.jev.invoked===true&&jevOut.cognitiveChoiceReceipt.jev.abstained===true&&jevOut.cognitiveChoiceReceipt.jev.action===JevAction.JEV_ABSTAINED,
    jevNoCanonicalMutation:JSON.stringify(jev.currentWorldModel())===jevBefore,
    jevReplayIdempotent:jevReplay.duplicate===true&&jevCalls===1&&jevReplay.cognitiveChoiceReceipt.id===jevOut.cognitiveChoiceReceipt.id,
    lateExcluded:late.route.late===true&&late.route.effectiveDestination===ResultDestination.NEXT_TURN&&lateReceipt.lateResultIds.includes(lateId)&&lateReceipt.reasonCodes.includes(CognitiveReason.SEAL_CLOSED),
    staleExcluded:staleRoute.route.freshness==='STALE'&&staleRoute.route.effectiveDestination===ResultDestination.EVALUATION&&staleReceipt.staleResultIds.includes(staleId)&&staleReceipt.reasonCodes.includes(CognitiveReason.STALE_RESULT),
    orderIndependent:JSON.stringify(orderAOut.cognitiveChoiceReceipt.finalEvidenceRefs)===JSON.stringify(orderBOut.cognitiveChoiceReceipt.finalEvidenceRefs)&&orderAOut.sealReceipt.packetHash===orderBOut.sealReceipt.packetHash,
    publicationReplayNoReexecution:beforeFusion===0&&afterFirstFusion>beforeFusion&&afterReplayFusion===afterFirstFusion&&replaySecond.duplicate===true&&replaySecond.cognitiveChoiceReceipt.id===replayFirst.cognitiveChoiceReceipt.id,
    precisionFallback:noPrecisionOut.cognitiveChoiceReceipt.precision.required===true&&noPrecisionOut.cognitiveChoiceReceipt.precision.fallback===true&&noPrecisionOut.cognitiveChoiceReceipt.reasonCodes.includes(CognitiveReason.PRECISION_FALLBACK),
    sealRevisionFenced:mixedOut.cognitiveChoiceReceipt.revisions.worldRevision===mixedOut.worldRevision&&mixedOut.cognitiveChoiceReceipt.revisions.sceneRevision===mixedOut.sceneRevision&&mixedOut.cognitiveChoiceReceipt.seal.sealed===true,
    noAuthorityEscalation:mixedOut.cognitiveChoiceReceipt.truthAuthority===false&&mixedOut.cognitiveChoiceReceipt.settlementAuthority===false&&mixedOut.cognitiveChoiceReceipt.canonicalMutationAuthority===false,
  };
  return{
    pass:Object.values(metrics).every(Boolean),metrics,
    hot:hotOut,high:highOut,low:lowOut,mixed:mixedOut,jev:jevOut,jevReplay,late,lateReceipt,staleRoute,staleReceipt,
    orderA:orderAOut,orderB:orderBOut,replayFirst,replaySecond,noPrecision:noPrecisionOut,
  };
}
