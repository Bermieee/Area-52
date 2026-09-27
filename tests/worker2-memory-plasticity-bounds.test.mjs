import test from 'node:test';
import assert from 'node:assert/strict';

import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';
import {MEMORY_LIMITS} from '../src/memory-contracts.js';

test('Worker 2: hierarchical summary plasticity uses summary lineage bounds without weakening ordinary artifact limits',()=>{
  const memory=new MemoryTemporalProducer();
  const count=MEMORY_LIMITS.maxEvidenceRefsPerArtifact+64;
  const evidenceRefs=Array.from({length:count},(_,index)=>'summary-wide:e'+index);
  const sourceRevisionRefs=Array.from({length:count},(_,index)=>'summary-wide:s'+index+'@r1');

  const summary=memory.plasticity.observeArtifact({
    id:'summary:wide',
    revision:1,
    artifactType:'STORY_SUMMARY',
    authorityClass:'DERIVED',
    exactEvidenceRefs:evidenceRefs,
    exactSourceRevisionSet:sourceRevisionRefs,
  });

  assert.equal(summary.evidenceRefs.length,count);
  assert.equal(summary.sourceRevisionRefs.length,count);

  assert.throws(()=>memory.plasticity.observeArtifact({
    id:'reflection:too-wide',
    revision:1,
    artifactType:'REFLECTION',
    authorityClass:'INFERRED',
    supportEvidenceRefs:evidenceRefs,
    sourceRevisionRefs:[],
  }),/String array exceeds bound/);
});
