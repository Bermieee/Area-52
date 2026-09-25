import {HotCognitionRuntime} from '../src/hot-cognition-runtime.js';
import {HotSegmentKind,HotDependencyState,HotUpdateStatus} from '../src/hot-cognition-contracts.js';
import {AuthorityClass} from '../src/contracts.js';
import {runHotCognitionWave7Acceptance,sceneSignal} from './hot-cognition-wave7-harness.js';

const ids=(rows)=>rows.map(x=>x.id??x.threadId??x.ref??x.refId).filter(Boolean);

export function runHotCognitionWave7Stress(){
  let hot=new HotCognitionRuntime({maxRecentTail:32,maxActiveThreads:64,maxActiveEntities:64,maxDedupe:2048,maxChats:4,maxWorldRefs:128,maxProvenanceRefs:128});
  hot.activateChat('stress:a');
  const counts={
    incrementalHotUpdates:0,castLocationTransitions:0,duplicateEvents:0,staleEvents:0,targetedInvalidations:0,
    reloadReconstructionCycles:0,continuousSceneReplayEvents:0,
  };
  let failures=0;
  let lastLocation='room:0';

  for(let i=1;i<=5000;i++){
    const locationIndex=Math.floor((i-1)/5),place='room:'+locationIndex;
    if(place!==lastLocation){counts.castLocationTransitions++;lastLocation=place;}
    const cast=i%10<5?['eris','mara']:['eris','doran'];
    const receipt=hot.consumeSceneSignal(sceneSignal({
      sceneId:'scene:continuous',sceneRevision:i,place,subLocation:'continuous',cast,mentioned:['offscreen'],
      entities:['lamp','table'],threads:i%100<50?['thread:continuity']:[],sourceRevisionRefs:['scene:stress@1'],
    }),{updateId:'scene:'+i});
    if(![HotUpdateStatus.APPLIED,HotUpdateStatus.NO_CHANGE].includes(receipt.status))failures++;
    counts.incrementalHotUpdates++;
  }

  const afterUpdates=hot.snapshot();
  const latestSignal=sceneSignal({sceneId:'scene:continuous',sceneRevision:5000,place:lastLocation,subLocation:'continuous',cast:['eris','doran'],sourceRevisionRefs:['scene:stress@1']});
  for(let i=0;i<500;i++){
    const receipt=hot.consumeSceneSignal(latestSignal,{updateId:'scene:5000'});
    if(receipt.status!==HotUpdateStatus.DUPLICATE)failures++;
    counts.duplicateEvents++;
  }
  for(let i=0;i<500;i++){
    const receipt=hot.consumeSceneSignal(sceneSignal({sceneId:'scene:continuous',sceneRevision:4000-i,place:'stale:'+i,sourceRevisionRefs:['scene:stress@1']}),{updateId:'stale:'+i});
    if(receipt.status!==HotUpdateStatus.STALE)failures++;
    counts.staleEvents++;
  }

  const locationRevisionBeforeInvalidations=hot.snapshot().segments[HotSegmentKind.LOCATION].revision;
  for(let i=0;i<500;i++){
    const ref='lore:stress:'+i+'@1';
    hot.consumeOwnerWorldChange({updateId:'world:'+i,worldRevision:i+1,sourceRevisionRefs:[ref],artifactRefs:[{ref:'artifact:'+i,temporalStatus:'CURRENT'}]});
    const receipt=hot.invalidateKnowledge({updateId:'invalidate:'+i,invalidatedSourceRevisionRefs:[ref],reason:'TARGETED_STRESS'});
    if(!receipt.invalidatedSegments.includes(HotSegmentKind.WORLD_REFERENCES)||receipt.invalidatedSegments.some(x=>x!==HotSegmentKind.WORLD_REFERENCES))failures++;
    counts.targetedInvalidations++;
  }
  if(hot.snapshot().segments[HotSegmentKind.LOCATION].revision!==locationRevisionBeforeInvalidations)failures++;

  for(let i=0;i<2000;i++){
    const receipt=hot.consumeNarrativeEvidence({
      kind:'NarrativeEvidence',activity:'ASSISTANT_GENERATION_COMPLETE',chatId:'stress:a',messageId:'m:'+i,messageRevision:1,
      turnId:'turn:'+i,sourceRevisionId:'chat:stress:a:m:'+i+'@1',sequence:i+1,current:true,historical:false,
      content:'Continuous scene narrative beat '+i,role:'assistant',invalidates:[],
    });
    if(![HotUpdateStatus.APPLIED,HotUpdateStatus.NO_CHANGE].includes(receipt.status))failures++;
    counts.continuousSceneReplayEvents++;
  }

  hot.consumeSceneSignal(sceneSignal({
    sceneId:'scene:continuous',sceneRevision:5001,place:lastLocation,subLocation:'continuous',cast:['eris','doran'],
    threads:Array.from({length:100},(_,i)=>'thread:'+i),sourceRevisionRefs:['scene:stress@1'],
  }),{updateId:'scene:5001'});
  const boundedBeforeReload=hot.snapshot();

  let persisted=hot.exportState();
  for(let i=0;i<250;i++){
    const restored=new HotCognitionRuntime({maxRecentTail:32,maxActiveThreads:64,maxActiveEntities:64,maxDedupe:2048,maxChats:4,maxWorldRefs:128,maxProvenanceRefs:128});
    restored.restoreState(persisted,{sceneRevision:5001,worldRevision:500});
    hot=restored;persisted=hot.exportState();counts.reloadReconstructionCycles++;
  }

  const restoredA=hot.snapshot();
  hot.activateChat('stress:b');hot.consumeSceneSignal(sceneSignal({sceneId:'scene:b',sceneRevision:1,place:'beta',sourceRevisionRefs:['scene:b@1']}),{updateId:'b:scene:1'});
  const b=hot.snapshot();hot.activateChat('stress:a');const aAgain=hot.snapshot();

  const authority=new HotCognitionRuntime();authority.activateChat('authority');
  for(let i=1;i<=100;i++)authority.consumeSceneSignal(sceneSignal({sceneId:'authority',sceneRevision:i,place:'inferred',locationAuthority:'INFERRED'}),{updateId:'authority:'+i});
  const authoritySnapshot=authority.snapshot();

  const invariants={
    noFailures:failures===0,
    incrementalMinimum:counts.incrementalHotUpdates>=5000,
    transitionMinimum:counts.castLocationTransitions>=999,
    duplicateStaleMinimum:counts.duplicateEvents+counts.staleEvents>=1000,
    invalidationMinimum:counts.targetedInvalidations>=500,
    reconstructionMinimum:counts.reloadReconstructionCycles>=250,
    noStaleStateResurrection:aAgain.segments[HotSegmentKind.LOCATION].value.place===lastLocation,
    noDuplicateMultiplication:aAgain.counters.duplicates>=500&&aAgain.hotRevision<10000,
    noWholeStateRebuildLoop:Number(aAgain.counters.rebuilds??0)===0,
    recentTailBounded:(aAgain.segments[HotSegmentKind.RECENT_EPISODE_TAIL].value??[]).length<=32,
    activeThreadsBounded:(aAgain.segments[HotSegmentKind.ACTIVE_THREADS].value??[]).length<=64,
    worldRefsBounded:(aAgain.segments[HotSegmentKind.WORLD_REFERENCES].value??[]).length<=128,
    dedupeBounded:(hot.exportState().states.find(x=>x.chatNamespace==='stress:a')?.dedupe??[]).length<=2048,
    crossChatIsolated:b.segments[HotSegmentKind.LOCATION].value.place==='beta'&&aAgain.segments[HotSegmentKind.LOCATION].value.place===lastLocation,
    noAuthorityEscalation:authoritySnapshot.segments[HotSegmentKind.LOCATION].authorityClass===AuthorityClass.INFERRED,
  };

  const acceptance=runHotCognitionWave7Acceptance();
  invariants.noPostSealMutation=acceptance.metrics.postSealImmutable===true;
  invariants.compilerSealPath=acceptance.metrics.compilerContribution===true&&acceptance.metrics.nextGenerationConsumesHot===true;

  const metrics={
    finalHotRevision:aAgain.hotRevision,
    finalSceneRevision:aAgain.sceneRevision,
    locationRevision:aAgain.segments[HotSegmentKind.LOCATION].revision,
    activeCastRevision:aAgain.segments[HotSegmentKind.ACTIVE_CAST].revision,
    activeThreadRevision:aAgain.segments[HotSegmentKind.ACTIVE_THREADS].revision,
    recentTailSize:(aAgain.segments[HotSegmentKind.RECENT_EPISODE_TAIL].value??[]).length,
    activeThreadSize:(aAgain.segments[HotSegmentKind.ACTIVE_THREADS].value??[]).length,
    worldRefSize:(aAgain.segments[HotSegmentKind.WORLD_REFERENCES].value??[]).length,
    dedupeSize:(hot.exportState().states.find(x=>x.chatNamespace==='stress:a')?.dedupe??[]).length,
    serializedStateBytes:JSON.stringify(hot.exportState()).length,
    reconstructionState:aAgain.reconstructionState,
    unavailableDependencies:aAgain.unavailableDependencies,
  };
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  return{pass:Object.values(invariants).every(Boolean),counts,total,invariants,metrics,failures,boundedBeforeReload,restoredA};
}
