import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {createChannelNomination} from '../src/candidate-bus-contracts.js';
import {ResultClass,ResultDestination,ResultPayloadClass,createCognitiveResult} from '../src/publication-contracts.js';
import {CognitiveChoicePath,CognitiveReason} from '../src/cognitive-choice-contracts.js';
import {EMBER_TAVERN_WAVE3} from './fixtures/ember-tavern-wave3.js';
import {sceneSignal} from './hot-cognition-wave7-harness.js';

function loadEmber(){
  const core=new Area52CognitiveCore();
  for(const row of EMBER_TAVERN_WAVE3.sources)core.importAndLearn(row);
  for(const row of EMBER_TAVERN_WAVE3.experiences)core.importAndLearn(row);
  return core;
}
function highCore(id){
  const core=new Area52CognitiveCore();core.importAndLearn({id,sourceType:'LORE',content:'The Relic is intact.',at:0});return core;
}
function failingProvider(){
  return{
    descriptor:{channelId:'W9_FAILING_CHANNEL',capabilities:['SPARSE'],supportedIntentKinds:['*'],maxCandidates:16,revisionRequirements:[],health:'HEALTHY',available:true},
    retrieve(){throw new Error('intentional Wave 9 mixed-channel failure');},
  };
}

export function runCognitiveChoiceWave9Stress(){
  const counts={highTurns:0,mixedTurns:0,hotTurns:0,replays:0,burstNominations:0,lateResults:0,staleResults:0,precisionFallbackTurns:0};
  const failures=[];

  const channelCore=highCore('wave9:stress:channel');
  channelCore.registerRetrievalChannel(failingProvider());
  for(let i=0;i<12;i++){
    const out=channelCore.publishGenerationContext({
      turnId:'w9:stress:high:'+i,correlationId:'corr:w9:stress:high:'+i,query:'What is the Relic state?',intent:'CURRENT',anchorEntityIds:['relic'],sealedAt:100+i,
    });
    counts.highTurns+=1;
    if(out.assessment.confidence!=='HIGH')failures.push('high confidence '+i);
    if(!out.candidateEnvelope.degradedChannels.includes('W9_FAILING_CHANNEL'))failures.push('mixed channel failure hidden '+i);
    if(out.cognitiveChoiceReceipt.correctiveRetrieval.correctionCount>1)failures.push('correction overflow high '+i);
  }

  const burst=highCore('wave9:stress:burst');
  const claim=burst.graph.allClaims().find(x=>x.subjectId==='relic')??burst.graph.allClaims()[0];
  burst.registerRetrievalChannel({
    descriptor:{channelId:'W9_BURST',capabilities:['SPARSE'],supportedIntentKinds:['*'],maxCandidates:128,revisionRequirements:[],health:'HEALTHY',available:true},
    retrieve(intent){
      const rows=[];
      for(let i=0;i<96;i++)rows.push(createChannelNomination({
        nominationId:'w9:burst:'+i,channelId:'W9_BURST',candidateId:'candidate:'+claim.id,evidenceIdentity:'claim:'+claim.id,
        artifactRef:{artifactId:'world:'+claim.id,revision:1},artifactRevision:1,sourceRevisionRefs:['wave9:stress:burst@1'],
        claimRefs:[claim.id],entityRefs:[claim.subjectId],retrievalIntentIds:[intent.intentId],rankSignals:{bm25Score:20-i/100},
        normalizedRank:.9,authorityClass:claim.authorityClass,truthStatusHint:claim.status,
        provenance:[{sourceRevisionIds:['wave9:stress:burst@1'],claimId:claim.id}],evidenceRefs:[claim.id],
      }));
      return rows;
    },
  });
  const burstOut=burst.publishGenerationContext({
    turnId:'w9:stress:burst',correlationId:'corr:w9:stress:burst',query:'What is the Relic state?',intent:'CURRENT',anchorEntityIds:['relic'],sealedAt:200,
  });
  counts.burstNominations=burstOut.cognitiveChoiceReceipt.candidateCounts.nominated;
  if(counts.burstNominations<50)failures.push('burst pressure too low');
  if(burstOut.cognitiveChoiceReceipt.candidateCounts.deduplicated>=counts.burstNominations)failures.push('burst dedupe ineffective');
  if(burstOut.cognitiveChoiceReceipt.consideredCognitionOptions.length<=burstOut.cognitiveChoiceReceipt.admittedJobs.length)failures.push('fanout did not skip any logical jobs');

  const mixed=loadEmber();
  for(let i=0;i<10;i++){
    const precisionAvailable=i%3!==0;
    const out=mixed.publishGenerationContext({
      turnId:'w9:stress:mixed:'+i,correlationId:'corr:w9:stress:mixed:'+i,query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',
      anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,precisionAvailable,sealedAt:300+i,
    });
    counts.mixedTurns+=1;if(!precisionAvailable)counts.precisionFallbackTurns+=1;
    if(!out.cognitiveChoiceReceipt.paths.includes(CognitiveChoicePath.MIXED_CORRECTION))failures.push('mixed path absent '+i);
    if(out.cognitiveChoiceReceipt.correctiveRetrieval.correctionCount!==1)failures.push('mixed correction not exactly one '+i);
    if(out.cognitiveChoiceReceipt.correctiveRetrieval.maxCorrections!==1)failures.push('mixed max correction changed '+i);
    if(out.cognitiveChoiceReceipt.jev.unavailable!==true)failures.push('Jev unavailability not explicit '+i);
    if(!precisionAvailable&&out.cognitiveChoiceReceipt.precision.required&&!out.cognitiveChoiceReceipt.precision.fallback)failures.push('precision fallback hidden '+i);
  }

  const hot=new Area52CognitiveCore();hot.activateHotCognitionChat('chat:w9:stress:hot');
  for(let i=1;i<=15;i++){
    hot.consumeSceneSignal(sceneSignal({sceneId:'scene:w9:stress',sceneRevision:i,place:i%2?'ember-tavern':'rear-yard',subLocation:'step-'+i}));
    const out=hot.publishGenerationContext({
      turnId:'w9:stress:hot:'+i,turnRevision:i,correlationId:'corr:w9:stress:hot:'+i,query:'Continue the current scene.',intent:'CURRENT',anchorEntityIds:[],sealedAt:400+i,
    });
    counts.hotTurns+=1;
    if(!out.cognitiveChoiceReceipt.paths.includes(CognitiveChoicePath.HOT_ONLY))failures.push('hot path lost at scene revision '+i);
    if(out.candidateEnvelope!==null)failures.push('hot path executed retrieval '+i);
    if(out.cognitiveChoiceReceipt.revisions.sceneRevision!==i)failures.push('scene fence mismatch '+i);
  }

  const replay=highCore('wave9:stress:replay');
  const first=replay.publishGenerationContext({turnId:'w9:stress:replay',correlationId:'corr:w9:stress:replay',query:'What is the Relic state?',intent:'CURRENT',anchorEntityIds:['relic'],sealedAt:500});
  const fusionsAfterFirst=replay.sensoryDiagnostics().candidateBus.counters.fusions;
  for(let i=0;i<20;i++){
    const again=replay.publishGenerationContext({turnId:'w9:stress:replay',correlationId:'corr:w9:stress:replay',query:'What is the Relic state?',intent:'CURRENT',anchorEntityIds:['relic'],sealedAt:501+i});
    counts.replays+=1;
    if(!again.duplicate)failures.push('replay not marked duplicate '+i);
  }
  if(replay.sensoryDiagnostics().candidateBus.counters.fusions!==fusionsAfterFirst)failures.push('replay re-executed retrieval');

  const lateId='result:w9:stress:late';
  const late=replay.publication.receiveResult(createCognitiveResult({
    id:lateId,taskId:'w9:stress:late-task',turnId:'w9:stress:replay',correlationId:'corr:w9:stress:replay',
    sourceSubsystem:'W9_STRESS',resultType:'LATE',resultClass:ResultClass.OPPORTUNISTIC,payloadClass:ResultPayloadClass.DERIVED_DATA,
    evidenceIds:[],provenance:{},sourceRevisionIds:[],worldRevision:first.worldRevision,sceneRevision:first.sceneRevision,
    authorityClass:'UNRESOLVED',destination:ResultDestination.FOREGROUND,payload:{late:true},timing:{},
  }));
  counts.lateResults+=1;
  if(!late.route.late||late.route.effectiveDestination!==ResultDestination.NEXT_TURN)failures.push('late result entered sealed foreground');

  replay.editAndRelearn('wave9:stress:replay','The Relic is damaged.');
  const staleId='result:w9:stress:stale';
  const stale=replay.publication.receiveResult(createCognitiveResult({
    id:staleId,taskId:'w9:stress:stale-task',turnId:'w9:stress:replay',correlationId:'corr:w9:stress:replay',
    sourceSubsystem:'W9_STRESS',resultType:'STALE',resultClass:ResultClass.REQUIRED,payloadClass:ResultPayloadClass.DERIVED_DATA,
    evidenceIds:[],provenance:{},sourceRevisionIds:['wave9:stress:replay@1'],worldRevision:first.worldRevision,sceneRevision:first.sceneRevision,
    authorityClass:'UNRESOLVED',destination:ResultDestination.FOREGROUND,payload:{stale:true},timing:{},
  }));
  counts.staleResults+=1;
  const replayReceipt=replay.cognitiveChoiceReceipt('w9:stress:replay');
  if(stale.route.freshness!=='STALE'||stale.route.effectiveDestination!==ResultDestination.EVALUATION)failures.push('stale result entered active foreground');
  if(!replayReceipt.reasonCodes.includes(CognitiveReason.SEAL_CLOSED)||!replayReceipt.reasonCodes.includes(CognitiveReason.STALE_RESULT))failures.push('late/stale receipt trace missing');

  const invariants={
    boundedCorrections:failures.every(x=>!x.includes('correction')),
    highSurvivesMixedChannelFailure:failures.every(x=>!x.includes('mixed channel failure')&&!x.includes('high confidence')),
    candidateFusionBounded:failures.every(x=>!x.includes('burst')),
    dynamicFanoutSkipsWork:failures.every(x=>!x.includes('fanout')),
    repeatedTurnsIdempotent:failures.every(x=>!x.includes('replay')),
    rapidSceneRevisionsFenced:failures.every(x=>!x.includes('scene fence')&&!x.includes('hot path')),
    jevUnavailableSafe:failures.every(x=>!x.includes('Jev')),
    precisionUnavailableSafe:failures.every(x=>!x.includes('precision fallback')),
    lateAndStaleContained:failures.every(x=>!x.includes('late result')&&!x.includes('stale result')&&!x.includes('receipt trace')),
  };
  return{pass:failures.length===0&&Object.values(invariants).every(Boolean),counts,invariants,failures,burstReceipt:burstOut.cognitiveChoiceReceipt,replayReceipt};
}
