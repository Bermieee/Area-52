import assert from 'node:assert/strict';
import { ActiveCastResolver, BoundaryVerifier, ObjectStateTracker, ObservationClass, SceneDeltaEngine, SceneReconciler, SceneRegistry, SemanticBoundaryDetector, createFieldState, createSceneObservationProposal } from '../src/scene/index.js';

const registry=new SceneRegistry();
registry.openScene({sceneId:'stress'});
const engine=new SceneDeltaEngine({maxUncertainChain:100000,castChurnThreshold:100000,sourceEditFanoutThreshold:100000});
const rec=new SceneReconciler({maxHistory:64});
rec.markKnownGood(registry.current('stress'));
const cast=new ActiveCastResolver({maxEntries:48,maxMentionedOnly:20});
const objects=new ObjectStateTracker({maxEntries:64,maxMentionedOnly:24});
const detector=new SemanticBoundaryDetector({emitThreshold:.05});
const verifier=new BoundaryVerifier();

let scene=registry.current('stress');
let deltas=0,mentions=0,objectMentions=0,boundaryCandidates=0,boundaryRejected=0,corrections=0,locationCorrections=0,castChurnEvents=0;
for(let i=0;i<1200;i+=1){
  const evidence=`turn:${i+1}`;
  const fields={};
  if(i%2===0)fields.activeThreads=createFieldState({value:[`thread:${Math.floor(i/50)}`],confidence:1,evidenceRefs:[evidence],observationClass:ObservationClass.OBSERVED,revision:scene.revision+1});
  if(i%3===0){mentions++;const observations=[cast.mention(`Mentioned${i}`,evidence)];if(i%30===0){castChurnEvents++;observations.push(cast.enter(`Active${i%9}`,evidence));}if(i%45===0)observations.push(cast.exit(`Active${(i-45+900)%9}`,evidence));fields.activeCast=cast.resolve({previous:scene.fields.activeCast.value??[],observations,revision:scene.revision+1});}
  if(i%4===0){objectMentions++;const observations=[objects.mention(`Object${i}`,evidence)];if(i%40===0)observations.push(objects.pickup(`Held${i%7}`,'Eris',evidence));if(i%80===0&&i>0)observations.push(objects.drop(`Held${i%7}`,evidence));fields.immediateObjects=objects.update({previous:scene.fields.immediateObjects.value??[],observations,revision:scene.revision+1});}
  if(i%25===0){const c=detector.detect({sceneId:'stress',evidenceRefs:[evidence],signals:{doorway:1}});if(c){boundaryCandidates++;verifier.submit(c);const d=verifier.observe(c.candidateId,{contradict:1,evidenceRefs:[`${evidence}:continue`]});if(d.status==='REJECTED')boundaryRejected++;}}
  if(i%100===0&&i>0){corrections++;fields.narrativeTime=createFieldState({value:{anchor:`T${i}`,mode:'CORRECTION'},confidence:1,evidenceRefs:[evidence],observationClass:ObservationClass.OBSERVED,revision:scene.revision+1});}
  if(i%150===0&&i>0){locationCorrections++;fields.location=createFieldState({value:{location:`Zone${i/150}`},confidence:1,evidenceRefs:[evidence],observationClass:ObservationClass.OBSERVED,revision:scene.revision+1});}
  if(!Object.keys(fields).length)continue;
  const proposal=createSceneObservationProposal({proposalId:`p:${i}`,sceneId:'stress',baseRevision:scene.revision,sourceRevisionRefs:[`chat:r${i}`],evidenceRefs:[evidence],fields});
  const result=engine.apply(scene,proposal,{allowWhenRefreshRequired:true});assert.equal(result.applied,true);registry.commit(result.scene,result.delta);scene=result.scene;deltas++;if(i%40===0)rec.markKnownGood(scene);
}
assert.ok(deltas>=500,`expected >=500 deltas, got ${deltas}`);
assert.equal(scene.revision,deltas+1);
assert.equal(registry.get('stress').sceneId,'stress');
assert.equal(verifier.pending.size,0,'boundary verification must not leak resolved candidates');
assert.equal(boundaryRejected,boundaryCandidates,'all weak doorway burst candidates should reject');
const activeCast=scene.fields.activeCast.value??[];
assert.ok(activeCast.length<=48,'active cast must remain bounded');
assert.ok(activeCast.filter(x=>x.state==='MENTIONED_ONLY').length<=20,'mention-only cast must remain bounded');
const objectList=scene.fields.immediateObjects.value??[];
assert.ok(objectList.length<=64,'scene object set must remain bounded');
assert.ok(objectList.filter(x=>x.state==='MENTIONED_ONLY').length<=24,'mention-only objects must remain bounded');
registry.reviseSource('stress',{sourceRevisionRef:'source:edited',affectedFields:['narrativeTime'],evidenceRefs:['edit:stress']});
const revised=registry.current('stress');
assert.equal(revised.fields.narrativeTime.observationClass,ObservationClass.UNRESOLVED);
assert.ok(revised.fields.narrativeTime.evidenceRefs.includes('edit:stress'));
assert.deepEqual(revised.fields.activeCast.value,scene.fields.activeCast.value);
assert.deepEqual(revised.fields.immediateObjects.value,scene.fields.immediateObjects.value);
assert.ok(revised.provenance.length<=128);
assert.ok(revised.sourceRevisionRefs.length<=128);
const activeBytes=Buffer.byteLength(JSON.stringify(revised));
assert.ok(activeBytes<100000,`active CurrentScene grew too large: ${activeBytes}`);
const record=registry.get('stress');rec.trimRegistryRecord(record);assert.ok(record.snapshots.length<=64);assert.ok(record.deltas.length<=128);
console.log(JSON.stringify({updates:1200,deltas,mentions,objectMentions,boundaryCandidates,boundaryRejected,corrections,locationCorrections,castChurnEvents,finalRevision:revised.revision,castEntries:activeCast.length,objectEntries:objectList.length,activeProvenanceRefs:revised.provenance.length,activeSourceRevisionRefs:revised.sourceRevisionRefs.length,historyBound:record.snapshots.length,deltaHistoryBound:record.deltas.length,activeCurrentSceneBytes:activeBytes},null,2));
