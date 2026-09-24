import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const files=[
  'src/memory-contracts.js',
  'src/temporal-state-graph.js',
  'src/memory-green-room.js',
  'src/memory-experience-store.js',
  'src/memory-historian.js',
  'src/memory-temporal-producer.js',
  'src/memory-integration-surface.js',
  'src/memory-summary-hierarchy.js',
  'src/memory-evidence-bridge.js',
];

test('Memory Wave 1+2+3 production modules are browser/SillyTavern safe',async()=>{
  for (const file of files) {
    const source=await readFile(file,'utf8');
    assert.doesNotMatch(source,/from\s+['"]node:/,file+' imports node:*');
    assert.doesNotMatch(source,/\bBuffer\b/,file+' uses Buffer');
    assert.doesNotMatch(source,/\brequire\s*\(/,file+' uses require');
    assert.doesNotMatch(source,/\bworker_threads\b/,file+' uses worker_threads');
    assert.doesNotMatch(source,/\bprocess\.(?:env|cwd|argv|exit)/,file+' uses process runtime globals');
    assert.doesNotMatch(source,/from\s+['"](?:fs|path)['"]/,file+' imports Node fs/path');
  }
});
