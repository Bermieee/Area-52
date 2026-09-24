import test from 'node:test';
import assert from 'node:assert/strict';

test('Wave 3 production Scene integration surfaces execute with Buffer unavailable',async()=>{
  const priorBuffer=globalThis.Buffer;
  try{
    globalThis.Buffer=undefined;
    const mod=await import('../src/scene/index.js?wave3-browser-runtime');
    const events=[];const publisher=new mod.SceneEventPublisher({sink:(e)=>events.push(e)});
    const rt=new mod.SceneLifecycleRuntime({publisher});
    const out=rt.ingestHostEvent({activity:mod.HostActivity.USER_SEND,chatId:'browser3',hostEventId:'h1',messageId:'m1',messageRevision:1,content:'Mara enters the Tavern.'},{extract:(e,s)=>({fields:{
      location:mod.createFieldState({value:{location:'Ember Tavern'},confidence:1,evidenceRefs:[e.sourceRevisionId],observationClass:mod.ObservationClass.OBSERVED,revision:s.revision+1}),
      activeCast:mod.createFieldState({value:[{characterId:'Mara',state:'PRESENT'}],confidence:1,evidenceRefs:[e.sourceRevisionId],observationClass:mod.ObservationClass.OBSERVED,revision:s.revision+1}),
      activeThreads:mod.createFieldState({value:['Find Blade'],confidence:1,evidenceRefs:[e.sourceRevisionId],observationClass:mod.ObservationClass.OBSERVED,revision:s.revision+1}),
    }})});
    const signal=rt.integrationSignal('browser3'),fanout=rt.fanOutInput('browser3'),ui=rt.uiReadModel('browser3');
    assert.equal(signal.sceneRevision,2);assert.equal(fanout.activeCast[0].characterId,'Mara');assert.equal(ui.revision,2);
    const recommendation=rt.prefetchTrigger.recommend({sceneId:signal.sceneId,sceneRevision:signal.sceneRevision,trigger:'BROWSER',entityRefs:['Mara'],sourceRevisionRefs:signal.sourceRevisionSet});
    assert.equal(rt.prefetchTrigger.isFresh(recommendation,{sceneId:signal.sceneId,sceneRevision:signal.sceneRevision}),true);
    const record=rt.registry.get(signal.sceneId);const episode=rt.episodeCompiler.compile({scene:rt.registry.current(signal.sceneId),record});assert.equal(episode.artifactRef.kind,'ArtifactReference');
    const results=rt.retrieval.retrieve({query:'Mara Tavern',activeEntityRefs:['Mara'],locationRef:'Ember Tavern',currentSceneId:signal.sceneId});assert.ok(Array.isArray(results));
    const bridge=new mod.SillyTavernHostBridge({eventsByActivity:{USER_SEND:'HOST_SEND'}});assert.equal(bridge.toCanonical('HOST_SEND',{chatId:'browser3'}).input.activity,mod.HostActivity.USER_SEND);
    const event=publisher.publish({eventType:mod.SceneEventType.SCENE_STATE_DELTA,sceneId:signal.sceneId,sceneRevision:signal.sceneRevision,sourceRevisionRefs:signal.sourceRevisionSet,payload:{browser:true},dedupeKey:'browser-wave3'});assert.equal(publisher.validateCompatibility(event).ok,true);
    const manifest=mod.createSceneAssemblyLaneManifest({sourceSha:'browser-sha'});assert.ok(manifest.browserVisiblePaths.length>0);assert.ok(events.length>0);JSON.stringify({out,signal,fanout,ui,recommendation,event,manifest});
  }finally{globalThis.Buffer=priorBuffer;}
});
