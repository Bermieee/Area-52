import test from 'node:test';
import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {EMBER_TAVERN_WAVE3} from './fixtures/ember-tavern-wave3.js';

test('DETERMINISTIC DIAGNOSTIC: Wave3 publication retains anchored current world state',()=>{
  const core=new Area52CognitiveCore();
  for(const row of EMBER_TAVERN_WAVE3.sources)core.importAndLearn(row);
  for(const row of EMBER_TAVERN_WAVE3.experiences)core.importAndLearn(row);
  const out=core.publishGenerationContext({
    turnId:'worker1:diag:wave3',correlationId:'worker1:diag:wave3',
    query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:1,
  });
  const summarize=c=>({id:c.candidateId,claims:c.claimRefs??c.claimIds,channels:(c.channelNominations??[]).map(x=>x.channelId),legacy:c.retrievalIntents,freshness:c.freshness});
  console.log('WORKER1_WAVE3_DIAG',JSON.stringify({
    primary:(out.primaryCandidates??[]).map(summarize),
    final:(out.candidates??[]).map(summarize),
    truth:out.assessment?.truthResults,
    admitted:out.publicationAssessment?.admittedCandidateIds,
    support:out.publicationAssessment?.supportCandidateIds,
    packet:out.packet,
    graphReceipt:out.graphTraversalReceipt,
  }));
});
