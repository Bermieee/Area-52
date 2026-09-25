import test from 'node:test';
import assert from 'node:assert/strict';
import { ActiveCastResolver, AtmosphereTracker, BoundaryStatus, ObjectStateTracker, ObservationClass, SceneIntelligenceRuntime, SpatialStateTracker, TemporalStateTracker, createFieldState } from '../src/scene/index.js';

const f=(value,revision,observationClass=ObservationClass.OBSERVED,confidence=1,evidenceRefs=['fixture:e'])=>createFieldState({value,revision,observationClass,confidence,evidenceRefs});

function fixture(){const rt=new SceneIntelligenceRuntime();rt.open({sceneId:'ember'});return rt;}

test('golden stable same-scene dialogue yields delta without cut',()=>{const rt=fixture();const r=rt.observe({sceneId:'ember',proposalId:'p1',evidenceRefs:['turn:1'],fields:{activeThreads:f(['Where is the Sun Blade?'],2,ObservationClass.OBSERVED,1,['turn:1'])}});assert.equal(r.applied,true);assert.equal(r.delta.fullRefreshRequired,false);const b=rt.boundary({sceneId:'ember',evidenceRefs:['turn:1'],signals:{}});assert.equal(b,null)});

test('golden true location transition confirms after support',()=>{const rt=fixture();const b=rt.boundary({sceneId:'ember',evidenceRefs:['turn:2'],signals:{locationTransition:1}});assert.equal(b.decision.status,BoundaryStatus.PENDING);const d=rt.boundaryVerifier.observe(b.candidate.candidateId,{support:.5,evidenceRefs:['turn:3']});assert.equal(d.status,BoundaryStatus.CONFIRMED)});

test('golden doorway/no-cut rejects false boundary',()=>{const rt=fixture();rt.boundaryDetector.emitThreshold=.05;const b=rt.boundary({sceneId:'ember',evidenceRefs:['turn:door'],signals:{doorway:1}});const d=rt.boundaryVerifier.observe(b.candidate.candidateId,{contradict:1,evidenceRefs:['turn:talk']});assert.equal(d.status,BoundaryStatus.REJECTED)});

test('golden cast entrance/exit and mentioned-only preserve precision',()=>{const r=new ActiveCastResolver();let s=r.resolve({observations:[r.enter('Mara','turn:enter'),r.mention('Rudeus','turn:memory')],revision:2});assert.equal(s.value.find(x=>x.characterId==='Mara').state,'PRESENT');assert.equal(s.value.find(x=>x.characterId==='Rudeus').state,'MENTIONED_ONLY');s=r.resolve({previous:s.value,observations:[r.exit('Mara','turn:exit')],revision:3});assert.equal(s.value.find(x=>x.characterId==='Mara').state,'DEPARTED')});

test('golden explicit time jump observed; false inferred jump remains unresolved',()=>{const t=new TemporalStateTracker();const observed=t.update({sceneId:'ember',revision:2,evidenceRefs:['turn:later'],proposal:{anchor:'Day 34',mode:'TIME_SKIP',explicit:true}});assert.equal(observed.observationClass,ObservationClass.OBSERVED);const bad=t.update({sceneId:'ember',previous:observed,revision:3,evidenceRefs:['turn:guess'],proposal:{anchor:'Day 8',derivedFromPriorInference:true,observationClass:ObservationClass.INFERRED,confidence:.9}});assert.equal(bad.observationClass,ObservationClass.UNRESOLVED)});

test('golden atmosphere change remains inferred',()=>{const a=new AtmosphereTracker();const x=a.update({revision:2,evidenceRefs:['turn:tone'],dimensions:{hostility:{score:.7,confidence:.8},uncertainty:{score:.6,confidence:.9}}});assert.equal(x.observationClass,ObservationClass.INFERRED);assert.deepEqual(Object.keys(x.value).sort(),['hostility','uncertainty'])});

test('golden source edit invalidates only dependent field',()=>{const rt=fixture();rt.observe({sceneId:'ember',proposalId:'p1',evidenceRefs:['turn:1'],fields:{location:f({location:'Ember Tavern'},2,ObservationClass.OBSERVED,1,['turn:1']),activeThreads:f(['Find Blade'],2,ObservationClass.OBSERVED,1,['turn:1'])}});rt.registry.reviseSource('ember',{sourceRevisionRef:'chat:r2',affectedFields:['location'],evidenceRefs:['edit:1']});const s=rt.registry.current('ember');assert.equal(s.fields.location.observationClass,ObservationClass.UNRESOLVED);assert.deepEqual(s.fields.activeThreads.value,['Find Blade'])});

test('golden pickup/drop and mentioned-only object continuity',()=>{const o=new ObjectStateTracker();let s=o.update({observations:[o.mention('SunBlade','turn:ask')],revision:2});assert.equal(s.value[0].state,'MENTIONED_ONLY');s=o.update({previous:s.value,observations:[o.pickup('SunBlade','Eris','turn:pickup')],revision:3});assert.equal(s.value[0].state,'HELD');assert.equal(s.value[0].holderId,'Eris');s=o.update({previous:s.value,observations:[o.drop('SunBlade','turn:drop')],revision:4});assert.equal(s.value[0].state,'PRESENT');assert.equal(s.value[0].holderId,null)});

test('golden Ember Tavern does not fabricate current Sun Blade presence',()=>{const o=new ObjectStateTracker();const s=o.update({observations:[o.mention('SunBlade','turn:search')],revision:2});assert.equal(s.value[0].state,'MENTIONED_ONLY');assert.equal(s.value[0].holderId,null)});

test('golden spatial gaze does not teleport scene',()=>{const tracker=new SpatialStateTracker();const prev=f({location:'Across Street'},1);const next=tracker.viewedLocation({previous:prev,viewedLocation:'Ruined Tavern',revision:2,evidenceRefs:['turn:gaze']});assert.equal(next.value.location,'Across Street')});
