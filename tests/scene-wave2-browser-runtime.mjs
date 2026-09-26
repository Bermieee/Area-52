import test from 'node:test';
import assert from 'node:assert/strict';

test('production Scene lifecycle runtime executes with Buffer unavailable', async()=>{
  const original=globalThis.Buffer;
  try{
    globalThis.Buffer=undefined;
    const mod=await import('../src/scene/index.js?browser-runtime-wave2');
    const rt=new mod.SceneLifecycleRuntime();
    const out=rt.ingestHostEvent({activity:mod.HostActivity.USER_SEND,chatId:'browser',hostEventId:'h1',messageId:'m1',messageRevision:1,content:'Mara enters.'},{extract:(e,scene)=>({fields:{activeCast:mod.createFieldState({value:[{characterId:'Mara',state:'PRESENT'}],confidence:1,evidenceRefs:[e.sourceRevisionId],observationClass:mod.ObservationClass.OBSERVED,revision:scene.revision+1})}})});
    assert.equal(out.scene.revision,2);
    assert.equal(rt.publicSignalArtifact('browser').activeCast[0].characterId,'Mara');
    const state=rt.narrativeFeed.exportState();JSON.stringify(state);
  }finally{globalThis.Buffer=original;}
});
