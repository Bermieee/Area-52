import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ConsolidationBacklog, ConsolidationProposalDeduper, ConsolidationProposalKind, GreenRoomStore,
  createConsolidationCheckpoint, createConsolidationProposal, createConsolidationProposalBundle,
  createConsolidationUnit, createGreenRoomBatch, createRevisionSet, evaluateConsolidationResume,
  validateConsolidationProviderOutput, validateGreenRoomProviderOutput,
} from '../src/coprocessor/index.js';

const artifact=(i,revision=1)=>({kind:'ArtifactReference',artifactId:'episode:'+i,artifactType:'SceneEpisode',owner:'SCENE_INTELLIGENCE',revision,storageDomain:'episodes'});
const rev=(sourceRevisionSet,sceneRevision=7)=>createRevisionSet({sourceRevisionSet,worldRevision:5,sceneRevision,characterStateRevision:3});

test('Wave 6 focused cognition stress preserves Green Room and Consolidation invariants',()=>{
  const totals={
    greenRoomBatchValidations:0,greenRoomExpirySequences:0,greenRoomContradictionRevisionCases:0,
    consolidationUnits:0,derivedProposalValidations:0,dedupeReplayCases:0,staleSupersededCases:0,
    checkpointYieldResumeCycles:0,longGreenRoomReplay:0,longConsolidationBacklogReplay:0,
  };

  for(let i=0;i<2000;i++){
    const sceneRevision=i%17;
    const chars=['A','B','C'].map((id,j)=>({
      characterRef:id+':'+(i%5),sceneRevision,evidenceRefs:['e:'+i+':'+j],sourceRevisionSet:['src:'+i],
      confidence:.5+(j*.1),dimensions:{guardedness:(i%10)/10,uncertainty:(j+1)/10,trustTrend:'STABLE'},expiryCondition:{ttlTurns:2},
    }));
    const value={sceneRevision,characters:chars,authority:'INFERRED'};
    const out=validateGreenRoomProviderOutput(value,{
      sceneRevision,knownCharacterRefs:chars.map((c)=>c.characterRef),knownEvidenceRefs:chars.flatMap((c)=>c.evidenceRefs),
    });
    assert.equal(out.characters.length,3);assert.equal(out.characters.every((c)=>c.authority==='INFERRED'),true);
    totals.greenRoomBatchValidations++;
  }

  for(let i=0;i<500;i++){
    const store=new GreenRoomStore({defaultTtlTurns:1,maxHistory:8});
    store.putBatch({sceneRevision:i,characters:[{characterRef:'C',evidenceRefs:['e:'+i],confidence:.6,dimensions:{warmth:.5},expiryCondition:{ttlTurns:1}}]},{turnSequence:1});
    assert.ok(store.get('C',{sceneRevision:i,turnSequence:1}));
    assert.equal(store.get('C',{sceneRevision:i,turnSequence:3}),null);
    assert.equal(store.size(),0);totals.greenRoomExpirySequences++;
  }

  for(let i=0;i<500;i++){
    const store=new GreenRoomStore({defaultTtlTurns:5,maxHistory:8});
    store.putBatch({sceneRevision:7,characters:[{characterRef:'Mara',evidenceRefs:['e:'+i],sourceRevisionSet:['src:'+i],confidence:.7,dimensions:{anger:.4}}]},{turnSequence:1});
    const reason=i%2?{contradictoryCharacterRefs:['Mara']}:{invalidatedSourceRevisionIds:['src:'+i]};
    assert.equal(store.invalidate(reason),1);assert.equal(store.size(),0);totals.greenRoomContradictionRevisionCases++;
  }

  const backlog=new ConsolidationBacklog({capacity:1600});
  for(let i=0;i<1500;i++){
    const u=backlog.enqueue(createConsolidationUnit({
      unitId:'u:'+i,artifactRefs:[artifact(i)],sourceRevisionSet:['src:'+i],worldRevision:5,sceneRevision:7,
      characterStateRevision:3,priority:i%7,createdAt:i,resumeIdentity:'resume:'+i,
    }));
    assert.equal(u.authority,'NONE');assert.equal(u.durableMutation,false);totals.consolidationUnits++;
  }
  assert.equal(backlog.metrics().pendingUnits,1500);

  for(let i=0;i<3000;i++){
    const ref=artifact(i%1500);
    const proposal=createConsolidationProposal({
      proposalKind:i%3===0?ConsolidationProposalKind.CLAIM_CANDIDATE:i%3===1?ConsolidationProposalKind.RELATIONSHIP_UPDATE:ConsolidationProposalKind.REFLECTION_EVIDENCE,
      semanticIdentity:'semantic:'+i,sourceArtifactRefs:[ref],sourceRevisionSet:['src:'+(i%1500)],confidence:.5+(i%5)*.1,
      authority:i%3===2?'INFERRED':'UNRESOLVED',
      payload:i%3===0?{subjectRef:'entity:'+(i%10),predicate:'state',object:'v:'+i}
        :i%3===1?{fromRef:'A',toRef:'B',relation:'r:'+i}
        :{directObservations:['e:'+i],repeatedPatterns:['p:'+i],inferredInterpretations:[],contradictingEvidence:[],uncertainty:'LOW'},
    },{worldRevision:5,sceneRevision:7,characterStateRevision:3});
    assert.equal(proposal.memoryMutation,false);assert.equal(proposal.deleteSourceTurns,false);totals.derivedProposalValidations++;
  }

  for(let i=0;i<500;i++){
    const ref=artifact(i);
    const bundle=createConsolidationProposalBundle({
      unitId:'d:'+i,sourceRevisionSet:['src:'+i],proposals:[{
        proposalKind:ConsolidationProposalKind.CLAIM_CANDIDATE,semanticIdentity:'claim:'+i,sourceArtifactRefs:[ref],
        confidence:.7,payload:{claim:'fact:'+i},
      }],
    },{unitId:'d:'+i,sourceArtifactRefs:[ref],sourceRevisionSet:['src:'+i],worldRevision:5,sceneRevision:7,characterStateRevision:3});
    const deduper=new ConsolidationProposalDeduper();assert.equal(deduper.accept(bundle).acceptedCount,1);assert.equal(deduper.accept(bundle).duplicateCount,1);
    totals.dedupeReplayCases++;
  }

  for(let i=0;i<500;i++){
    const ref=artifact(2000+i);
    const source='src:stale:'+i;
    const value={unitId:'s:'+i,sourceRevisionSet:[source],proposals:[{
      proposalKind:ConsolidationProposalKind.CLAIM_CANDIDATE,semanticIdentity:'stale:'+i,sourceArtifactRefs:[ref],confidence:.7,payload:{claim:'x'},
    }]};
    assert.throws(()=>validateConsolidationProviderOutput(value,{
      unitId:'s:'+i,sourceArtifactRefs:[ref],knownArtifactRefs:[ref],sourceRevisionSet:[source],
      worldRevision:5,sceneRevision:7,characterStateRevision:3,currentRevisionSet:rev(['src:new:'+i]),
    }));
    totals.staleSupersededCases++;
  }

  for(let i=0;i<250;i++){
    const u=createConsolidationUnit({
      unitId:'cp:'+i,artifactRefs:[artifact(3000+i)],sourceRevisionSet:['src:cp:'+i],worldRevision:5,sceneRevision:7,
      characterStateRevision:3,resumeIdentity:'resume:cp:'+i,
    });
    const cp=createConsolidationCheckpoint(u,{completedArtifactRefs:[],completedProposalIds:[],nextOffset:i%4});
    assert.equal(evaluateConsolidationResume(cp,rev(['src:cp:'+i])).action,'RESUME_FROM_CHECKPOINT');
    assert.equal(evaluateConsolidationResume(cp,rev(['src:changed:'+i])).action,'INVALIDATE_AND_REPLAN');
    totals.checkpointYieldResumeCycles++;
  }

  const longGreen=new GreenRoomStore({maxCharacters:24,maxHistory:64,defaultTtlTurns:2});
  for(let i=0;i<5000;i++){
    const characterRef='char:'+(i%40);
    longGreen.putBatch(createGreenRoomBatch({sceneRevision:i%20,characters:[{
      characterRef,evidenceRefs:['long:e:'+i],sourceRevisionSet:['long:s:'+i],confidence:.6,
      dimensions:{uncertainty:(i%10)/10},
    }]}),{turnSequence:i,activeCharacterRefs:[characterRef]});
    if(i%13===0)longGreen.invalidate({contradictoryCharacterRefs:[characterRef]});
    assert.ok(longGreen.size()<=24);assert.ok(longGreen.historySize()<=64);
  }
  totals.longGreenRoomReplay=1;

  const longBacklog=new ConsolidationBacklog({capacity:128});
  for(let i=0;i<5000;i++){
    const u=longBacklog.enqueue(createConsolidationUnit({
      unitId:'long:'+i,artifactRefs:[artifact(5000+i)],sourceRevisionSet:['long:src:'+i],worldRevision:5,sceneRevision:7,
      characterStateRevision:3,priority:i%10,createdAt:i,
    }));
    const resident=longBacklog.list().some((row)=>row.unitId===u.unitId);
    if(resident&&i%3===0)longBacklog.complete(u.unitId);
    else if(resident&&i%5===0)longBacklog.supersede(u.unitId,'replacement:'+i);
    assert.ok(longBacklog.metrics({now:i}).storedUnits<=128);
  }
  assert.ok(longBacklog.metrics({now:5001}).pendingUnits<=128);totals.longConsolidationBacklogReplay=1;

  assert.deepEqual(totals,{
    greenRoomBatchValidations:2000,greenRoomExpirySequences:500,greenRoomContradictionRevisionCases:500,
    consolidationUnits:1500,derivedProposalValidations:3000,dedupeReplayCases:500,staleSupersededCases:500,
    checkpointYieldResumeCycles:250,longGreenRoomReplay:1,longConsolidationBacklogReplay:1,
  });
  console.log(JSON.stringify({stress:'wave6-cognition',...totals,greenRoomFinal:{active:longGreen.size(),history:longGreen.historySize()},backlogFinal:longBacklog.metrics({now:5001})}));
});
