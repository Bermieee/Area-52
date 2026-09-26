import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  GreenRoomStore,
  NativeHotDeepScheduler,
  SpeculativeWarmCoordinator,
  createWave18CoprocessorReadModel,
} from '../src/coprocessor/index.js';

test('Wave18 production modules remain browser-host portable and avoid persistence or secret APIs',async()=>{
  const files=[
    'src/coprocessor/native-hot-deep-scheduler.js',
    'src/coprocessor/speculative-warmer.js',
    'src/coprocessor/speculative-warmer-coordinator.js',
    'src/coprocessor/green-room.js',
    'src/coprocessor/owner-integration.js',
    'src/coprocessor/jev-memory-temporal-adapter.js',
    'src/coprocessor/wave18-read-model.js',
  ];
  for(const file of files){
    const source=await fs.readFile(new URL('../'+file,import.meta.url),'utf8');
    for(const banned of ["from 'node:","from \"node:","require(","process.env","Buffer.","node:http","node:fs"]){
      assert.equal(source.includes(banned),false,file+' contains '+banned);
    }
    assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB/i,file+' must not persist optional-resource state or credentials');
  }
});

test('Wave18 scheduler, warmer, Green Room and read model operate with browser Web APIs only',async()=>{
  let now=0;
  const scheduler=new NativeHotDeepScheduler({resourceSlots:1,foregroundReserve:1,now:()=>now});
  const warmer=new SpeculativeWarmCoordinator({clock:()=>now});
  const greenRoom=new GreenRoomStore();
  greenRoom.putBatch({sceneRevision:1,characters:[{
    characterRef:'browser-char',evidenceRefs:['browser:e1'],sourceRevisionSet:['browser:s1'],confidence:.5,dimensions:{uncertainty:.5},
  }]},{turnSequence:1});
  scheduler.enqueueDeep({
    workId:'browser:deep',
    metadata:{owner:'MEMORY',rawPrompt:'MUST_NOT_APPEAR'},
    async runSlice(){now+=2;return{state:'COMPLETED',done:true,ownerAccepted:false};},
  });
  const deep=await scheduler.runDeepSlice('browser:deep');
  assert.equal(deep.status,'COMPLETED');
  const read=createWave18CoprocessorReadModel({scheduler,warmer,greenRoom,consolidation:[deep]});
  assert.equal(read.hotDeep.deepWork[0].status,'COMPLETED');
  assert.equal(read.greenRoom.proposals[0].characterRef,'browser-char');
  assert.equal(JSON.stringify(read).includes('MUST_NOT_APPEAR'),false);
});
