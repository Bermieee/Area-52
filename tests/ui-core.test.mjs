import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ActionRouter,
  GeneralStatus,
  InspectorRegistry,
  KnowledgeStatus,
  MockBrainRuntime,
  RenderCost,
  RenderScheduler,
  ResourceScope,
  ResponsiveMode,
  RuntimeStatus,
  SignalHub,
  UIActionResult,
  UIStateStore,
  WidgetCategory,
  WidgetInstance,
  WidgetRegistry,
  WorkspaceRegistry,
  computeVirtualWindow,
  resolveResponsiveMode,
} from '../src/ui-core/index.js';

test('SignalHub publishes small envelopes and unsubscribe removes listener', () => {
  const signals = new SignalHub();
  const seen = [];
  const off = signals.subscribe('TEST', (event) => seen.push(event));
  signals.publish('TEST', { value: 1 }, { source: 'test', revision: 9, timestamp: 10 });
  off();
  signals.publish('TEST', { value: 2 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].payload.value, 1);
  assert.equal(seen[0].source, 'test');
  assert.equal(seen[0].revision, 9);
  assert.equal(signals.listenerCount('TEST'), 0);
});

test('RenderScheduler coalesces repeated invalidation by key', () => {
  let scheduled;
  const scheduler = new RenderScheduler({ requestFrame: (cb) => { scheduled = cb; return 1; }, cancelFrame: () => {} });
  const calls = [];
  scheduler.invalidate('worker:1', () => calls.push('old'), { cost: RenderCost.NORMAL });
  scheduler.invalidate('worker:1', () => calls.push('new'), { cost: RenderCost.NORMAL });
  assert.equal(scheduler.pendingCount, 1);
  scheduled(1);
  assert.deepEqual(calls, ['new']);
});

test('RenderScheduler orders cheap work before expensive work', () => {
  let scheduled;
  const scheduler = new RenderScheduler({ requestFrame: (cb) => { scheduled = cb; return 1; }, cancelFrame: () => {} });
  const calls = [];
  scheduler.invalidate('expensive', () => calls.push('expensive'), { cost: RenderCost.EXPENSIVE });
  scheduler.invalidate('cheap', () => calls.push('cheap'), { cost: RenderCost.CHEAP });
  scheduler.invalidate('normal', () => calls.push('normal'), { cost: RenderCost.NORMAL });
  scheduled(1);
  assert.deepEqual(calls, ['cheap', 'normal', 'expensive']);
});

test('hidden lazy expensive renders do not become foreground work', () => {
  let scheduled;
  const scheduler = new RenderScheduler({ requestFrame: (cb) => { scheduled = cb; return 1; }, cancelFrame: () => {} });
  const calls = [];
  scheduler.invalidate('graph', () => calls.push('graph'), { cost: RenderCost.EXPENSIVE, lazy: true, visible: false });
  scheduled(1);
  assert.deepEqual(calls, []);
});

test('ResourceScope cleans event listeners, subscriptions, and timers exactly once', () => {
  const scope = new ResourceScope();
  const calls = [];
  let added;
  let removed;
  const target = {
    addEventListener(type, handler) { added = { type, handler }; },
    removeEventListener(type, handler) { removed = { type, handler }; },
  };
  const handler = () => {};
  scope.listen(target, 'click', handler);
  scope.add(() => calls.push('cleanup'));
  assert.equal(scope.size, 2);
  scope.cleanup();
  scope.cleanup();
  assert.deepEqual(added, removed);
  assert.deepEqual(calls, ['cleanup']);
});

test('Widget destroy then re-mount does not retain duplicate signal handlers', () => {
  const signals = new SignalHub();
  const scheduler = { cancelPrefix() {} };
  let hits = 0;
  const spec = {
    widgetId: 'test.widget',
    version: '1.0.0',
    category: WidgetCategory.DIAGNOSTIC,
    propsSchema: {},
    supportedActions: [],
    subscriptions: ['PING'],
    permissions: [],
    renderCostClass: RenderCost.CHEAP,
    create({ scope }) {
      return { subscribe() { scope.subscribe(signals, 'PING', () => { hits += 1; }); } };
    },
  };
  const host = { replaceChildren() {} };
  const first = new WidgetInstance({ spec, host, services: { scheduler } }).mount();
  signals.publish('PING');
  first.destroy();
  signals.publish('PING');
  const second = new WidgetInstance({ spec, host, services: { scheduler } }).mount();
  signals.publish('PING');
  second.destroy();
  assert.equal(hits, 2);
  assert.equal(signals.listenerCount('PING'), 0);
});

test('WidgetRegistry validates metadata and rejects duplicate IDs', () => {
  const registry = new WidgetRegistry();
  const spec = {
    widgetId: 'diagnostic.test',
    version: '1.0.0',
    category: WidgetCategory.DIAGNOSTIC,
    propsSchema: {},
    supportedActions: [],
    subscriptions: [],
    permissions: [],
    renderCostClass: RenderCost.CHEAP,
    create() { return {}; },
  };
  registry.register(spec);
  assert.equal(registry.get('diagnostic.test').version, '1.0.0');
  assert.throws(() => registry.register(spec), /already registered/);
});

test('WorkspaceRegistry is declarative and does not require shell changes', () => {
  const registry = new WorkspaceRegistry();
  registry.register({ id: 'memory', title: 'Memory', views: ['overview'], supportedActions: ['inspect'], render() {} });
  registry.register({ id: 'shadow', title: 'Shadow Comparison', views: ['compare'], supportedActions: [], render() {} });
  assert.deepEqual(registry.list().map((item) => item.id), ['memory', 'shadow']);
  assert.equal(registry.get('shadow').title, 'Shadow Comparison');
});

test('InspectorRegistry resolves typed renderer with fallback support', () => {
  const registry = new InspectorRegistry();
  const fallback = () => 'fallback';
  const claim = () => 'claim';
  registry.register('*', fallback);
  registry.register('claim', claim);
  assert.equal(registry.resolve('claim'), claim);
  assert.equal(registry.resolve('worker'), fallback);
});

test('ActionRouter enforces permission and target-state validation before subsystem handler', async () => {
  const router = new ActionRouter();
  let mutations = 0;
  router.registerSubsystem('brain', async () => { mutations += 1; return 'ok'; });
  router.registerAction('claim.settle', { subsystem: 'brain', permissions: ['claim:settle'], allowedStates: [KnowledgeStatus.CURRENT] });

  const denied = await router.route({ type: 'claim.settle', target: { state: KnowledgeStatus.CURRENT } }, { permissions: [] });
  assert.equal(denied.status, UIActionResult.DENIED);
  assert.equal(mutations, 0);

  const wrongState = await router.route({ type: 'claim.settle', target: { state: KnowledgeStatus.SUPERSEDED } }, { permissions: ['claim:settle'] });
  assert.equal(wrongState.status, UIActionResult.INVALID);
  assert.equal(mutations, 0);

  const ok = await router.route({ type: 'claim.settle', target: { state: KnowledgeStatus.CURRENT } }, { permissions: ['claim:settle'] });
  assert.equal(ok.status, UIActionResult.OK);
  assert.equal(mutations, 1);
});

test('UI persistence failure is isolated from cognitive behavior', () => {
  const storage = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); }, removeItem() {} };
  const store = new UIStateStore({ storage, defaults: { selectedWorkspace: 'memory' } });
  assert.deepEqual(store.load(), { selectedWorkspace: 'memory' });
  const saved = store.save({ inspectorWidth: 320 });
  assert.equal(saved.selectedWorkspace, 'memory');
  assert.equal(saved.inspectorWidth, 320);
  assert.match(store.lastError.message, /unavailable/);
});

test('virtual window keeps 10,000 logical records to a bounded live range', () => {
  const range = computeVirtualWindow({ count: 10000, itemSize: 40, viewportSize: 400, scrollOffset: 20000, overscan: 5 });
  assert.equal(range.totalSize, 400000);
  assert.ok(range.end - range.start <= 20);
  assert.ok(range.start > 0);
  assert.ok(range.end < 10000);
});

test('responsive modes resolve WIDE, COMPACT, STACKED deterministically', () => {
  assert.equal(resolveResponsiveMode(1440), ResponsiveMode.WIDE);
  assert.equal(resolveResponsiveMode(900), ResponsiveMode.COMPACT);
  assert.equal(resolveResponsiveMode(600), ResponsiveMode.STACKED);
});

test('mock worker follows required ACTIVE → YIELDING → PARKED → ACTIVE → COMPLETE signal path', () => {
  const signals = new SignalHub();
  const runtime = new MockBrainRuntime({ signals });
  const seen = [];
  signals.subscribe('WORKER_STATE_CHANGED', ({ payload }) => seen.push(payload.state));
  for (let i = 0; i < 5; i += 1) runtime.advanceWorker();
  assert.deepEqual(seen, [RuntimeStatus.ACTIVE, RuntimeStatus.YIELDING, RuntimeStatus.PARKED, RuntimeStatus.ACTIVE, RuntimeStatus.COMPLETE]);
});

test('mock temporal claim supersession preserves historical state and provenance', () => {
  const signals = new SignalHub();
  const runtime = new MockBrainRuntime({ signals });
  let event;
  signals.subscribe('CLAIM_STATE_CHANGED', (next) => { event = next; });
  runtime.supersedeClaim();
  assert.equal(runtime.claim.status, KnowledgeStatus.SUPERSEDED);
  assert.equal(runtime.claim.history.length, 2);
  assert.equal(runtime.claim.history[0].validUntil, 'T492');
  assert.equal(runtime.claim.history[1].value, 'destroyed');
  assert.ok(runtime.claim.provenance.some((item) => item.label === 'FireEvent492'));
  assert.equal(event.payload.status, KnowledgeStatus.SUPERSEDED);
});
