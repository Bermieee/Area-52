import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoreOwnerGraphProvider,createMemoryOwnerGraphProvider,createSceneOwnerGraphProvider} from '../src/deployment/owner-graph-adapters.js';

test('Lore graph validates one query against one revision snapshot, then refreshes next query',()=>{
  let revision='lore:entry@1',statusReads=0;
  const lore={
    status:()=>{statusReads+=1;return{entries:[{sourceState:'CURRENT',sourceRevisionId:revision}]};},
    query:()=>({nominations:[]}),
  };
  const provider=createLoreOwnerGraphProvider(lore);
  provider.query({query:'scene',maxEdges:192});
  for(let i=0;i<192;i++)assert.equal(provider.isRevisionCurrent('lore:entry@1'),true);
  assert.equal(statusReads,1);
  revision='lore:entry@2';
  provider.query({query:'next scene',maxEdges:192});
  assert.equal(provider.isRevisionCurrent('lore:entry@1'),false);
  assert.equal(provider.isRevisionCurrent('lore:entry@2'),true);
  assert.equal(statusReads,2);
});

test('Memory graph reuses one revision snapshot per query',()=>{
  let snapshotReads=0;
  const memory={adapters:{
    queryHistorian:()=>({nominations:[]}),
    snapshot:()=>{snapshotReads+=1;return{graph:{sourceRevisionState:[['memory:episode@1',{state:'ACTIVE'}]]}};},
  }};
  const provider=createMemoryOwnerGraphProvider(memory);
  provider.query({query:'scene',maxEdges:192});
  const before=snapshotReads;
  for(let i=0;i<192;i++)assert.equal(provider.isRevisionCurrent('memory:episode@1'),true);
  assert.ok(snapshotReads-before<=1);
});

test('Scene graph reuses one revision snapshot per query',()=>{
  let listReads=0;
  const scene={
    graph:{exportState:()=>({edges:[]})},
    registry:{list:()=>{listReads+=1;return[{sceneId:'scene:1'}];},current:()=>({sourceRevisionRefs:['scene:1@1']})},
  };
  const provider=createSceneOwnerGraphProvider(scene);
  provider.query({maxEdges:192});
  for(let i=0;i<192;i++)assert.equal(provider.isRevisionCurrent('scene:1@1'),true);
  assert.equal(listReads,1);
});
