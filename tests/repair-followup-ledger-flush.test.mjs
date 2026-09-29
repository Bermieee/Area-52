// Performance (installed long-chat profile 2026-09-29): every Work Ledger flush cloned the whole ledger twice (snapshot()
// then MemoryPersistenceAdapter.save()). Flush now hands the adapter, which clones, a plain view. Contract: the stored
// snapshot after every operation equals the ledger snapshot, later in-memory changes never leak into it, and a reload
// restores the same ledger; an adapter that does not clone still receives a private copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkLedger } from '../src/runtime/work-ledger.js';
import { MemoryPersistenceAdapter } from '../src/runtime/persistence.js';

const obligation = (id) => ({ taskId: id, obligationId: 'o:' + id, kind: 'TEST', lifecycleStatus: 'PENDING', dependencies: [], payload: { nested: { list: [1, 2, { deep: 'x' }] } } });

test('stored ledger snapshots equal the ledger after every operation and are isolated from later mutation', () => {
  const persistence = new MemoryPersistenceAdapter();
  const ledger = new WorkLedger({ persistence });
  const check = (label) => assert.deepEqual(persistence.exportSnapshot(), ledger.snapshot(), label);
  check('initial');
  ledger.createTask(obligation('a')); check('create a');
  ledger.createTask(obligation('b')); check('create b');
  ledger.setLifecycle('a', 'ELIGIBLE', 'ready'); check('lifecycle');
  ledger.setExecution('a', 'ACTIVE', 'run'); check('execution');
  ledger.ensureBatch('a', { batchId: 'batch:a', units: [{ unitId: 'u1' }, { unitId: 'u2' }] }); check('batch');
  ledger.recordCausalReceipt('a', { kind: 'R', id: 'r1', detail: { n: 1 } }); check('receipt');
  ledger.setDegradation('b', { degraded: true, reasons: ['x'] }); check('degradation');
  const stored = persistence.exportSnapshot();
  // An in-memory change without a flush is not in the stored snapshot (the adapter kept its own copy).
  ledger.get('a').obligation.payload.nested.list[2].deep = 'changed';
  ledger.records.get('b').executionReason = 'changed';
  assert.deepEqual(persistence.exportSnapshot(), stored);
  // Reload from the stored snapshot restores the flushed ledger.
  const reloaded = new WorkLedger({ persistence: new MemoryPersistenceAdapter(stored) });
  assert.deepEqual(reloaded.get('a').obligation.payload.nested.list[2].deep, 'x');
  assert.equal(reloaded.snapshot().records.length, 2);
});

test('an adapter that keeps references still gets a private copy', () => {
  const saved = [];
  const ledger = new WorkLedger({ persistence: { load: () => null, save: (value) => saved.push(value) } });
  ledger.createTask(obligation('a'));
  const last = saved.at(-1);
  ledger.get('a').obligation.payload.nested.list[2].deep = 'changed';
  assert.equal(last.records[0].obligation.payload.nested.list[2].deep, 'x');
});
