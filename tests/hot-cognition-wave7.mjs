import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HotCognitionRuntime} from '../src/hot-cognition-runtime.js';
import {HotSegmentKind,HotFreshness,HotDependencyState,HotUpdateStatus} from '../src/hot-cognition-contracts.js';
import {AuthorityClass} from '../src/contracts.js';
import {browserHostConformanceReport} from '../src/browser-host-conformance.js';
import {runHotCognitionWave7Acceptance,sceneSignal} from './hot-cognition-wave7-harness.js';

test('Wave 7 Hot Cognition production acceptance is green',()=>{
  const r=runHotCognitionWave7Acceptance();
  assert.equal(r.pass,true,JSON.stringify(r.metrics,null,2));
  assert.equal(r.publication.delivered.ok,true);
  assert.equal(r.publication.nextDelivered.ok,true);
});

test('scene projection excludes mentioned-only cast and keeps inference authority',()=>{
  const hot=new HotCognitionRuntime();hot.activateChat('chat');
  hot.consumeSceneSignal(sceneSignal({sceneId:'s',sceneRevision:1,cast:['eris'],mentioned:['mara'],locationAuthority:'INFERRED'}));
  const snapshot=hot.snapshot(),cast=snapshot.segments[HotSegmentKind.ACTIVE_CAST].value;
  assert.deepEqual(cast.map(x=>x.id),['eris']);
  assert.equal(snapshot.segments[HotSegmentKind.LOCATION].authorityClass,AuthorityClass.INFERRED);
});

test('out-of-order and duplicate Scene delivery cannot resurrect stale state',()=>{
  const hot=new HotCognitionRuntime();hot.activateChat('chat');
  const signal=sceneSignal({sceneId:'s',sceneRevision:2,place:'new'});
  const first=hot.consumeSceneSignal(signal,{updateId:'scene:2'});
  const duplicate=hot.consumeSceneSignal(signal,{updateId:'scene:2'});
  const before=hot.snapshot(),stale=hot.consumeSceneSignal(sceneSignal({sceneId:'s',sceneRevision:1,place:'old'}),{updateId:'scene:1'}),after=hot.snapshot();
  assert.equal(first.status,HotUpdateStatus.APPLIED);
  assert.equal(duplicate.status,HotUpdateStatus.DUPLICATE);
  assert.equal(stale.status,HotUpdateStatus.STALE);
  assert.equal(after.hotRevision,before.hotRevision);
  assert.equal(after.segments[HotSegmentKind.LOCATION].value.place,'new');
});

test('boundary candidate is descriptive and cannot cut the active scene',()=>{
  const hot=new HotCognitionRuntime();hot.activateChat('chat');
  hot.consumeSceneSignal(sceneSignal({sceneId:'s',sceneRevision:4,place:'room'}));
  const before=hot.snapshot();
  const receipt=hot.consumeEvent({eventId:'boundary:1',eventType:'SCENE_BOUNDARY_CANDIDATE',sceneId:'s',sceneRevision:4,sourceRevisionSet:['scene:external@1'],payload:{candidateId:'candidate:false'}});
  const after=hot.snapshot();
  assert.equal(receipt.status,HotUpdateStatus.NO_CHANGE);
  assert.equal(after.sceneId,before.sceneId);
  assert.equal(after.hotRevision,before.hotRevision);
  assert.deepEqual(after.segments[HotSegmentKind.LOCATION].value,before.segments[HotSegmentKind.LOCATION].value);
});

test('targeted invalidation does not clear unrelated Scene working state',()=>{
  const hot=new HotCognitionRuntime();hot.activateChat('chat');
  hot.consumeSceneSignal(sceneSignal({sceneId:'s',sceneRevision:1,place:'room'}));
  hot.consumeOwnerWorldChange({updateId:'world:1',worldRevision:1,sourceRevisionRefs:['lore@1'],artifactRefs:[{ref:'artifact:x',temporalStatus:'CURRENT'}]});
  const locationRevision=hot.snapshot().segments[HotSegmentKind.LOCATION].revision;
  const receipt=hot.invalidateKnowledge({updateId:'invalidate:lore',invalidatedSourceRevisionRefs:['lore@1'],reason:'SOURCE_EDIT'});
  const snapshot=hot.snapshot();
  assert.deepEqual(receipt.invalidatedSegments,[HotSegmentKind.WORLD_REFERENCES]);
  assert.equal(snapshot.segments[HotSegmentKind.WORLD_REFERENCES].freshness,HotFreshness.INVALIDATED);
  assert.equal(snapshot.segments[HotSegmentKind.LOCATION].freshness,HotFreshness.FRESH);
  assert.equal(snapshot.segments[HotSegmentKind.LOCATION].revision,locationRevision);
});

test('Memory, Lore, Sensory and graph absence degrade honestly without blocking Scene',()=>{
  const hot=new HotCognitionRuntime();hot.activateChat('chat');
  hot.consumeSceneSignal(sceneSignal({sceneId:'s',sceneRevision:1}));
  hot.setGraphNeighborhood({state:HotDependencyState.UNAVAILABLE,refs:[],updateId:'graph:missing'});
  const snapshot=hot.snapshot();
  assert.equal(snapshot.segments[HotSegmentKind.SCENE].freshness,HotFreshness.FRESH);
  assert.ok(snapshot.unavailableDependencies.includes('MEMORY'));
  assert.ok(snapshot.unavailableDependencies.includes('LORE_STUDY'));
  assert.ok(snapshot.unavailableDependencies.includes('SENSORY_NET'));
  assert.ok(snapshot.unavailableDependencies.includes('GRAPH_NEIGHBORHOOD'));
  assert.ok(!snapshot.unavailableDependencies.includes('CORE'));
});

test('authority bypass is rejected and repetition never upgrades inferred Scene state',()=>{
  const hot=new HotCognitionRuntime();hot.activateChat('chat');
  hot.consumeSceneSignal(sceneSignal({sceneId:'s',sceneRevision:1,locationAuthority:'INFERRED'}));
  hot.consumeSceneSignal(sceneSignal({sceneId:'s',sceneRevision:2,locationAuthority:'INFERRED'}));
  assert.equal(hot.snapshot().segments[HotSegmentKind.LOCATION].authorityClass,AuthorityClass.INFERRED);
  assert.throws(()=>hot.consumeSceneSignal({...sceneSignal({sceneId:'s',sceneRevision:3}),settlementAuthority:true}),error=>error.code==='HOT_AUTHORITY_VIOLATION');
});

test('historical world reference is not admitted as current working world state',()=>{
  const hot=new HotCognitionRuntime();hot.activateChat('chat');
  hot.consumeOwnerWorldChange({updateId:'history',worldRevision:1,artifactRefs:[{ref:'past',temporalStatus:'HISTORICAL'}]});
  assert.equal(hot.snapshot().segments[HotSegmentKind.WORLD_REFERENCES].value.length,0);
});

test('persisted reconstruction preserves chat namespaces without cross-chat contamination',()=>{
  const hot=new HotCognitionRuntime();hot.activateChat('a');hot.consumeSceneSignal(sceneSignal({sceneId:'a',sceneRevision:1,place:'alpha'}));
  hot.activateChat('b');hot.consumeSceneSignal(sceneSignal({sceneId:'b',sceneRevision:1,place:'beta'}));
  const persisted=hot.exportState(),restored=new HotCognitionRuntime();restored.restoreState(persisted);
  restored.activateChat('a');assert.equal(restored.snapshot().segments[HotSegmentKind.LOCATION].value.place,'alpha');
  restored.activateChat('b');assert.equal(restored.snapshot().segments[HotSegmentKind.LOCATION].value.place,'beta');
});

test('Hot Cognition production modules are browser-host safe',()=>{
  const paths=['src/hot-cognition-contracts.js','src/hot-cognition-runtime.js','src/hot-cognition-context.js','src/hot-cognition-read-model.js'];
  const rows=paths.map(path=>({path,source:readFileSync(new URL('../'+path,import.meta.url),'utf8')}));
  const report=browserHostConformanceReport(rows);
  assert.equal(report.pass,true,JSON.stringify(report.results,null,2));
});
