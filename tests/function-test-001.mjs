import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Hex } from '../src/browser-compat.js';
import { runPhase1FunctionTest001 } from '../src/integration/function-test-001.js';

test('browser compatibility SHA-256 matches the standard vector',()=>{
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('Phase 1 Function Test 001 passes end to end',async()=>{
  const report=await runPhase1FunctionTest001();
  assert.equal(report.pass,true,JSON.stringify(report.checks.filter(x=>!x.pass),null,2));
  assert.equal(report.summary.plannedWorkers,4);
  assert.equal(report.summary.foregroundClosedAt,70);
  assert.ok(report.summary.packetHash);
  assert.ok(report.summary.promptPlanId);
});


test('Phase 1 Function Test 001 passes in a browser-like runtime without Node Buffer',async()=>{
  const originalBuffer=globalThis.Buffer;
  try{
    globalThis.Buffer=undefined;
    const report=await runPhase1FunctionTest001();
    assert.equal(report.pass,true,JSON.stringify(report.checks.filter(x=>!x.pass),null,2));
  } finally {
    globalThis.Buffer=originalBuffer;
  }
});
