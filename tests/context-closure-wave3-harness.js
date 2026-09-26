import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {EMBER_TAVERN_WAVE3} from './fixtures/ember-tavern-wave3.js';
import {runWave3PublicationGoldenWorld} from './wave3-golden-harness.js';
import {benchmarkContextCompression,buildPositionSensitivityFixtures,compareCompressionBenchmarks} from '../src/context-benchmarks.js';
import {PromptSlot,deliveryHash} from '../src/adaptive-context-contracts.js';
import {feedbackMetricsFromBenchmark} from '../src/delivery-learning.js';

function loadCore(){const core=new Area52CognitiveCore();for(const source of EMBER_TAVERN_WAVE3.sources)core.importAndLearn(source);for(const source of EMBER_TAVERN_WAVE3.experiences)core.importAndLearn(source);return core;}
function semanticHash(delivery){return deliveryHash((delivery.plan?.segments??[]).flatMap(s=>s.semanticManifest??[]).map(x=>x.semanticKey).sort());}
function compressionFor(base){const packet=base.published.packet,facts=[...packet.current,...packet.historical,...packet.unresolved].filter(f=>f.v!=='unknown'),rawRepresentation={exactEvidence:EMBER_TAVERN_WAVE3.sources.concat(EMBER_TAVERN_WAVE3.experiences).map(x=>({source:x,verbatim:x.content.repeat(6)})),duplicatedFacts:facts.flatMap(f=>[f,f,f])},temporal=packet.historical.filter(f=>Array.isArray(f.t)).map(f=>({e:f.e,p:f.p,v:f.v,status:f.t[2],validFrom:f.t[0],validUntil:f.t[1]})),provenance=Object.entries(packet.provenanceIndex).map(([factId,sourceRevisionIds])=>({factId,sourceRevisionIds}));return benchmarkContextCompression({rawRepresentation,compiledPacket:packet,requirements:{facts,temporal,unresolved:packet.unresolved.filter(f=>f.v!=='unknown'),provenance,relationships:[]}});}
export function runContextClosureWave3GoldenWorld(){
  const base=runWave3PublicationGoldenWorld(),compression=compressionFor(base),core=loadCore(),before=JSON.stringify(core.currentWorldModel());
  const thread={threadId:'find-sun-blade',subjectRefs:['sun-blade'],unresolvedQuestion:'Where is the Sun Blade?',priority:10,sourceRevisionIds:['w3:journal@1'],evidenceRefs:['w3:journal@1']};
  const published=core.publishGenerationContext({turnId:'turn:closure:1',correlationId:'corr:closure:1',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,activeThreads:[thread],sealedAt:10});
  const delivered=core.deliverGenerationContext({published,generationId:'generation:closure:base',modelProfileId:'RECENCY_WEIGHTED',userInput:EMBER_TAVERN_WAVE3.query});
  const after=JSON.stringify(core.currentWorldModel()),threadPriority=(published.compilerReceipt.semanticPriority??[]).filter(x=>x.reasons.some(r=>r==='THREAD_RELEVANCE:find-sun-blade')),profile=core.delivery.profileRegistry.get('RECENCY_WEIGHTED'),newOrder=[PromptSlot.SYSTEM_POLICY,PromptSlot.WORLD_FOUNDATION,PromptSlot.CHARACTER_FOUNDATION,PromptSlot.HISTORICAL_SUPPORT,PromptSlot.RELEVANT_LORE,PromptSlot.EPISODIC_MEMORY,PromptSlot.UNRESOLVED_EVIDENCE,PromptSlot.ACTIVE_THREADS,PromptSlot.CURRENT_WORLD_STATE,PromptSlot.CURRENT_CHARACTER_STATE,PromptSlot.CURRENT_SCENE,PromptSlot.RECENT_NARRATIVE,PromptSlot.USER_INPUT];
  const feedbackRefs=[];for(let i=0;i<5;i++){const id=`feedback:closure:${i}`;feedbackRefs.push(id);core.deliveryLearning.recordFeedback({feedbackId:id,modelProfileId:'RECENCY_WEIGHTED',evidenceRef:`benchmark:closure:${i}`,metrics:feedbackMetricsFromBenchmark({semanticRetention:1,unresolvedRetention:1,temporalQualifierRetention:1,provenanceReferenceRetention:1},{improvementScore:.08,baselinePacketHash:published.sealReceipt.packetHash})});}
  const proposal=core.deliveryLearning.proposeRevision({modelProfileId:'RECENCY_WEIGHTED',evidenceRefs:feedbackRefs,changedParameters:{positionOrder:newOrder,sectionAllocationWeights:{[PromptSlot.UNRESOLVED_EVIDENCE]:3,[PromptSlot.ACTIVE_THREADS]:3}}}),qualified=core.deliveryLearning.qualify(proposal.policyId),active=core.deliveryLearning.activate(proposal.policyId),sealHashBefore=published.sealReceipt.packetHash;
  const learned=core.delivery.deliver({sealedPacket:published.packet,sealReceipt:published.sealReceipt,generationId:'generation:closure:learned',turnId:'turn:closure:1',modelProfileId:'RECENCY_WEIGHTED',userInput:EMBER_TAVERN_WAVE3.query});
  const edit=core.editAndRelearn('w3:journal','A later recovered journal claims the Sun Blade survived the fire.'),staleThread=core.publishGenerationContext({turnId:'turn:closure:2',correlationId:'corr:closure:2',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,activeThreads:[thread],sealedAt:20});
  const comparison=compareCompressionBenchmarks(compression),positions=buildPositionSensitivityFixtures({current:published.packet.current,character:[],unresolved:published.packet.unresolved,supportingLore:[],historical:published.packet.historical});
  const falseCurrent=published.packet.current.some(f=>f.e==='sun-blade'&&f.p==='location'&&f.v==='ember-tavern'),activeSection=delivered.plan.sections.find(s=>s.slot===PromptSlot.ACTIVE_THREADS);
  const metrics={
    priorGoldenWorld:base.pass,structuredCompressionPreserved:compression.pass&&compression.compiledBytes<compression.rawBytes&&compression.compressionRatio<1&&compression.factualRetention===1&&compression.temporalRetention===1&&compression.contradictionRetention===1&&compression.provenanceRetention===1,
    neutralSizingPresent:published.compilerReceipt.semanticSizing?.serializedBytes>0&&published.compilerReceipt.semanticSizing?.tokenEstimate===null,
    tokenSizingOwnedByDelivery:Boolean(delivered.plan?.diagnosticReceipt?.estimator?.id)&&Number.isFinite(delivered.plan?.budget?.allocated),
    activeThreadSealed:published.packet.activeThreads?.[0]?.threadId==='find-sun-blade',activeThreadSemanticSection:Boolean(activeSection?.semantic&&activeSection.semanticManifest?.[0]?.authorityClass==='UNRESOLVED'),
    activeThreadRaisesPriority:threadPriority.some(x=>x.semanticId.includes('sun-blade')||published.packet.unresolved.some(f=>f.id===x.semanticId&&f.e==='sun-blade')),
    activeThreadCannotCreateTruth:before===after&&!falseCurrent,staleThreadRejected:(staleThread.packet.activeThreads??[]).length===0&&staleThread.compilerReceipt.threadDiagnostics.staleThreadIds.includes('find-sun-blade'),
    policyQualified:qualified.status==='QUALIFIED',policyActivated:active.status==='ACTIVE',futurePlanUsesLearnedPolicy:learned.plan.deliveryPolicyRevision===active.version,
    learnedPresentationDiffers:learned.plan.ordering.join('|')!==delivered.plan.ordering.join('|'),semanticMeaningPreserved:semanticHash(learned)===semanticHash(delivered),sealImmutableAfterLearning:published.sealReceipt.packetHash===sealHashBefore,
    externalComparisonHonest:comparison.rows[1].measurementState==='NOT_MEASURED'&&comparison.rows[1].outputBytes===null&&comparison.winner===null,
    positionFixturesReady:positions.length>=13&&positions.some(x=>x.position==='EARLY')&&positions.some(x=>x.position==='MIDDLE')&&positions.some(x=>x.position==='LATE'),
    sourceEditStillRelearns:edit.replacement.changed===true&&staleThread.packet.dependencies.includes('w3:journal@2'),
    compilerPacketModelIndependent:published.compilerReceipt.semanticSizing.modelProfileId===null&&!('estimatedModelTokens' in published.packet),
  };
  return{pass:Object.values(metrics).every(Boolean),metrics,base,core,published,delivered,learned,proposal,qualified,active,compression,comparison,positions,staleThread};
}
