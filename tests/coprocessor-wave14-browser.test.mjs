import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  Capability, CoprocessorResourceConnections, ResourceConnectionState, ResourceKind, createCoprocessorResourceHost,
} from '../src/coprocessor/index.js';

test('Wave 14 connection production modules remain browser-host portable and orchestration-free',async()=>{
  for(const file of [
    '../src/coprocessor/resource-connections.js',
    '../src/coprocessor/resource-host-adapter.js',
    '../src/coprocessor/provider-adapters.js',
  ]){
    const src=await fs.readFile(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(src,/from\s+['"]node:|require\s*\(|process\.env|Buffer\./);
    assert.doesNotMatch(src,/redis|dapr|langgraph|sql server|postgres/i);
  }
  const registry=new CoprocessorResourceConnections();
  registry.addResource({
    resourceId:'browser-local',providerProfileId:'browser-profile',providerId:'browser-provider',workerId:'browser-worker',
    kind:ResourceKind.DETERMINISTIC_LOCAL,modelId:'browser-model',capabilities:[Capability.GRAPH],
    handler:()=>({nodes:[],edges:[],currentStateRefs:[],historicalRefs:[],unresolvedRefs:[],conflicts:[],reasoningSummary:'none'}),
  });
  const ready=await registry.connectResource('browser-local');
  assert.equal(ready.state,ResourceConnectionState.READY);
  assert.equal(ready.callable,true);
  assert.equal(registry.readModel().nativePathRequired,false);

  const host=createCoprocessorResourceHost({connections:registry});
  assert.equal(host.read.resources().readyResourceCount,1);
  assert.equal(host.authority.truth,false);
  assert.equal(host.authority.settlement,false);
  assert.equal(host.authority.contextSeal,false);
});
