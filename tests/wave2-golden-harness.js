import { Area52CognitiveCore } from '../src/cognitive-core.js';
import { EMBER_TAVERN_WAVE2 } from './fixtures/ember-tavern-wave2.js';

export function runWave2EmberTavernGoldenWorld({core=new Area52CognitiveCore(),world=EMBER_TAVERN_WAVE2}={}){
  for(const source of world.sources)core.importAndLearn(source);for(const source of world.experiences)core.importAndLearn(source);
  const ownerBefore=core.graph.currentProjection().find(x=>x.subjectId==='ember-tavern'&&x.predicate==='owner');
  const historical=core.query('Where did Eris leave the Sun Blade?',{intent:'HISTORICAL',anchorEntityIds:['sun-blade','eris','ember-tavern']});
  const temporal=core.query('What happened to the Sun Blade after Eris left it?',{intent:'TEMPORAL',anchorEntityIds:['sun-blade']});
  const conflict=core.query('Did the Sun Blade survive?',{intent:'CONTRADICTION',anchorEntityIds:['sun-blade']});
  const unresolvedFacts=conflict.packet.unresolved.filter(f=>f.e==='sun-blade'&&f.p==='state');
  const provenanceComplete=unresolvedFacts.every(f=>(conflict.packet.provenanceIndex[f.id]??[]).length>0);
  const edit=core.editAndRelearn('w2:e6','A later recovered journal claims the Sun Blade survived the fire.');
  const ownerAfter=core.graph.currentProjection().find(x=>x.subjectId==='ember-tavern'&&x.predicate==='owner');
  const metrics={
    tavernDestroyed:core.graph.currentClaims({subjectId:'ember-tavern',predicate:'state'}).some(c=>c.value==='destroyed'),
    bladeUnresolved:Boolean(core.graph.unresolvedState('sun-blade','state')),
    conflictingEvidencePaths:unresolvedFacts.length,
    historicalDepositRecovered:historical.packet.historical.some(f=>f.e==='sun-blade'&&f.p==='location'&&f.v==='ember-tavern'),
    temporalChannelCovered:temporal.candidates.some(c=>c.retrievalIntents.includes('temporal')),
    provenanceComplete,
    dependencyConeInvalidated:edit.replacement.invalidatedArtifactIds.length>0&&edit.replacement.invalidatedArtifactIds.every(id=>!id.includes('w2-tavern')),
    unrelatedKnowledgeSurvived:Boolean(ownerBefore&&ownerAfter&&ownerBefore.value===ownerAfter.value&&ownerBefore.claimIds.join('|')===ownerAfter.claimIds.join('|')),
    oldRevisionRecoverable:core.registry.getRevision('w2:e6@1')?.exactContent.includes('removed the Sun Blade')===true,
    activeRevisionAdvanced:core.registry.getActiveRevision('w2:e6')?.id==='w2:e6@2',
    unresolvedAfterRelearn:Boolean(core.graph.unresolvedState('sun-blade','state')),
    packetBytes:Buffer.byteLength(JSON.stringify(conflict.packet),'utf8'),
  };
  const pass=metrics.tavernDestroyed&&metrics.bladeUnresolved&&metrics.conflictingEvidencePaths>=2&&metrics.historicalDepositRecovered&&metrics.temporalChannelCovered&&metrics.provenanceComplete&&metrics.dependencyConeInvalidated&&metrics.unrelatedKnowledgeSurvived&&metrics.oldRevisionRecoverable&&metrics.activeRevisionAdvanced&&metrics.unresolvedAfterRelearn&&metrics.packetBytes<2500;
  return{pass,metrics,core,historical,temporal,conflict,edit};
}
