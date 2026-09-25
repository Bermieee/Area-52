import { Area52CognitiveCore } from '../src/cognitive-core.js';
import { ResultClass,ResultDestination,ResultPayloadClass,createCognitiveResult } from '../src/publication-contracts.js';
import { hashPacket } from '../src/context-seal.js';
import { EMBER_TAVERN_WAVE3 } from './fixtures/ember-tavern-wave3.js';

export function runWave3PublicationGoldenWorld({world=EMBER_TAVERN_WAVE3}={}){
  const core=new Area52CognitiveCore();
  for(const source of world.sources)core.importAndLearn(source);
  for(const source of world.experiences)core.importAndLearn(source);

  const published=core.publishGenerationContext({
    turnId:'turn:w3:1',correlationId:'corr:w3:1',query:world.query,intent:'CURRENT',
    anchorEntityIds:world.anchors,budgetBytes:2500,sealedAt:100,
  });
  const sealedBefore=JSON.stringify(published.packet);
  const hashBefore=published.sealReceipt.packetHash;

  const precision=published.precisionResults[0];
  const late=core.publication.receiveResult(createCognitiveResult({
    id:'result:precision:late:turn:w3:1',taskId:'precision:late',turnId:'turn:w3:1',
    correlationId:'corr:w3:1',causationId:'context-seal:turn:w3:1',
    sourceSubsystem:'PRECISION',workerId:'opportunistic-reference',destinationOwner:null,
    resultType:'PRECISION_RESULT',resultClass:ResultClass.OPPORTUNISTIC,payloadClass:ResultPayloadClass.DERIVED_DATA,
    evidenceIds:[precision?.candidateId??'none'],provenance:{late:true},
    sourceRevisionIds:precision?.sourceRevisionIds??[],worldRevision:published.worldRevision,sceneRevision:published.sceneRevision,
    authorityClass:'UNRESOLVED',destination:ResultDestination.FOREGROUND,
    payload:{...(precision??{}),late:true},timing:{completedAt:101},
  }));

  const sealAfterLate=core.publication.seal.getReceipt('turn:w3:1');
  const packetAfterLate=JSON.stringify(core.publication.seal.getPacket('turn:w3:1'));

  const edit=core.editAndRelearn('w3:journal','A later recovered journal claims the Sun Blade survived the fire.');
  const sealAfterEdit=core.publication.seal.getReceipt('turn:w3:1');
  const packetAfterEdit=JSON.stringify(core.publication.seal.getPacket('turn:w3:1'));

  const future=core.publishGenerationContext({
    turnId:'turn:w3:2',correlationId:'corr:w3:2',query:world.query,intent:'CURRENT',
    anchorEntityIds:world.anchors,budgetBytes:2500,sealedAt:200,
  });

  const currentTavern=published.packet.current.some(f=>f.e==='ember-tavern'&&f.p==='state'&&f.v==='destroyed');
  const historicalDeposit=published.packet.historical.some(f=>f.e==='sun-blade'&&f.p==='location'&&f.v==='ember-tavern');
  const unknownLocation=published.packet.unresolved.some(f=>f.e==='sun-blade'&&f.p==='location'&&f.v==='unknown');
  const disputedDestroyed=published.packet.unresolved.some(f=>f.e==='sun-blade'&&f.p==='state'&&f.v==='destroyed');
  const disputedSurvived=published.packet.unresolved.some(f=>f.e==='sun-blade'&&f.p==='state'&&f.v==='survived');
  const falseCurrentLocation=published.packet.current.some(f=>f.e==='sun-blade'&&f.p==='location'&&f.v==='ember-tavern');
  const provenanceComplete=[...published.packet.current,...published.packet.historical,...published.packet.unresolved]
    .filter(f=>!String(f.id).startsWith('compiled-unknown'))
    .every(f=>(published.packet.provenanceIndex[f.id]??[]).length>0);

  const metrics={
    truthConfidence:published.assessment.confidence,
    correctiveExecuted:published.corrective.executed,
    correctiveTerminated:published.corrective.terminated,
    precisionContributed:published.sealReceipt.admittedResultIds.some(id=>id.startsWith('result:precision:')),
    currentTavern,historicalDeposit,unknownLocation,disputedDestroyed,disputedSurvived,
    falseCurrentLocation,provenanceComplete,
    lateAccepted:late.route.accepted,
    lateRoutedTo:late.route.effectiveDestination,
    lateMarked:late.route.late,
    packetHashStableAfterLate:sealAfterLate.packetHash===hashBefore&&packetAfterLate===sealedBefore,
    packetHashStableAfterEdit:sealAfterEdit.packetHash===hashBefore&&packetAfterEdit===sealedBefore&&hashPacket(core.publication.seal.getPacket('turn:w3:1'))===hashBefore,
    oldSealFrozen:Object.isFrozen(core.publication.seal.getPacket('turn:w3:1')),
    oldRevisionRecoverable:core.registry.getRevision('w3:journal@1')?.exactContent.includes('removed the Sun Blade')===true,
    futureUsesNewRevision:future.packet.dependencies.includes('w3:journal@2')&&!future.packet.dependencies.includes('w3:journal@1'),
    futureSealDifferent:future.sealReceipt.id!==published.sealReceipt.id,
    editInvalidatedCone:edit.replacement.invalidatedArtifactIds.length>0,
  };

  const pass=metrics.truthConfidence==='MIXED'
    &&metrics.correctiveExecuted&&metrics.correctiveTerminated&&metrics.precisionContributed
    &&metrics.currentTavern&&metrics.historicalDeposit&&metrics.unknownLocation
    &&metrics.disputedDestroyed&&metrics.disputedSurvived&&!metrics.falseCurrentLocation
    &&metrics.provenanceComplete&&metrics.lateAccepted&&metrics.lateRoutedTo==='NEXT_TURN'&&metrics.lateMarked
    &&metrics.packetHashStableAfterLate&&metrics.packetHashStableAfterEdit&&metrics.oldSealFrozen
    &&metrics.oldRevisionRecoverable&&metrics.futureUsesNewRevision&&metrics.futureSealDifferent&&metrics.editInvalidatedCone;

  return{pass,metrics,core,published,late,edit,future};
}
