import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Wave 15 native swarm production path is browser-safe and contains no fixed demo-story routing assumptions',async()=>{
  const files=['src/coprocessor/native-sidecar-swarm.js','src/coprocessor/resource-host-adapter.js','src/coprocessor/resource-connections.js','src/coprocessor/fanout-planner.js'];
  for(const file of files){
    const text=await fs.readFile(new URL('../'+file,import.meta.url),'utf8');
    for(const banned of ["from 'node:","require(","process.env","Buffer.","node:http","node:fs"])assert.equal(text.includes(banned),false,file+' contains '+banned);
  }
  const planner=await fs.readFile(new URL('../src/coprocessor/fanout-planner.js',import.meta.url),'utf8');
  for(const fixed of ['mara','ember tavern','sun blade'])assert.equal(planner.toLowerCase().includes(fixed),false,'planner contains fixed scenario token '+fixed);
});

test('Wave 15 host surface imports without browser-only globals being required at module load',async()=>{
  const mod=await import('../src/coprocessor/native-sidecar-swarm.js');
  assert.equal(typeof mod.NativeSidecarSwarm,'function');
  assert.equal(typeof mod.createSwarmCheckpoint,'function');
  assert.equal(typeof mod.validateCheckpoint,'function');
});
