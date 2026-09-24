import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Wave 12 production warmer modules remain browser-safe and native/default path has no network dependency',async()=>{
  for(const file of ['../src/coprocessor/speculative-warmer.js','../src/coprocessor/speculative-warmer-coordinator.js']){
    const src=await fs.readFile(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(src,/from\s+['"]node:|require\s*\(|process\.env|Buffer\./);
    assert.doesNotMatch(src,/fetch\s*\(|WebSocket\s*\(|EventSource\s*\(/);
  }
  const mod=await import('../src/coprocessor/index.js');
  const warmer=new mod.SpeculativeWarmCoordinator();
  assert.equal(warmer.metrics().providerMode,'NATIVE_REFERENCE_ONLY');
});
