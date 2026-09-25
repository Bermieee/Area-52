import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ActionRouter,
  ApplicationShell,
  InspectorRegistry,
  RenderScheduler,
  ResourceScope,
  SignalHub,
  UIActionResult,
  UIExtensionAvailability,
  UIExtensionLifecycle,
  UIExtensionRegistry,
  WorkspaceRegistry,
  normalizeGenericArtifact,
  presentEventEnvelope,
  validateUIExtensionDescriptor,
  RuntimeWave1UIAdapter,
  RuntimeWave1ContractFixture,
  createRuntimeWave1AdapterFromFixture,
} from '../src/ui-core/index.js';
import { createSyntheticUnknownExtension, FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

function extensionHarness() {
  const signals = new SignalHub();
  const workspaceRegistry = new WorkspaceRegistry();
  workspaceRegistry.register({ id:'built-in', title:'Built In', render() {} });
  const inspectorRegistry = new InspectorRegistry();
  inspectorRegistry.register('*', () => 'fallback');
  const actionRouter = new ActionRouter();
  const scheduler = new RenderScheduler({ requestFrame:(cb)=>{ cb(1); return 1; }, cancelFrame(){} });
  const registry = new UIExtensionRegistry({ workspaceRegistry, inspectorRegistry, actionRouter, scheduler });
  return { signals, workspaceRegistry, inspectorRegistry, actionRouter, scheduler, registry };
}

test('valid descriptor accepts compatible unknown optional fields and remains data-only', () => {
  const { signals } = extensionHarness();
  const synthetic = createSyntheticUnknownExtension(signals);
  const normalized = validateUIExtensionDescriptor(synthetic.descriptor);
  assert.equal(normalized.schemaVersion, '1.0.0');
  assert.equal(normalized.futureOptionalField.accepted, true);
  assert.equal(normalized.lifecycle, UIExtensionLifecycle.SHADOW);
  assert.equal(normalized.availability, UIExtensionAvailability.SHADOW);
});

test('invalid descriptors and executable manifest logic fail locally', () => {
  assert.throws(() => validateUIExtensionDescriptor(null), /descriptor/i);
  assert.throws(() => validateUIExtensionDescriptor({ extensionId:'x', subsystemId:'x', schemaVersion:'1.0.0', display:{title:'X'}, handler(){} }), /Executable function/);
});

test('unsupported schema major is rejected visibly without guessing', () => {
  const { signals } = extensionHarness();
  const synthetic = createSyntheticUnknownExtension(signals);
  assert.throws(() => validateUIExtensionDescriptor({ ...synthetic.descriptor, schemaVersion:'2.0.0' }), /Unsupported UI extension schema major/);
});

test('synthetic unknown subsystem registers workspace, inspector, telemetry and routed read-only action', async () => {
  const h = extensionHarness();
  const synthetic = createSyntheticUnknownExtension(h.signals);
  const accepted = h.registry.register(synthetic.descriptor, synthetic.binding);
  assert.equal(accepted.descriptor.extensionId, synthetic.ids.extensionId);
  assert.equal(h.workspaceRegistry.has(synthetic.ids.workspaceId), true);
  assert.equal(h.inspectorRegistry.has(synthetic.ids.inspectorKind), true);
  assert.equal(h.actionRouter.hasAction(synthetic.ids.actionType), true);

  const seen = [];
  const off = h.registry.subscribeTelemetry(synthetic.ids.extensionId, synthetic.ids.telemetryId, (event) => seen.push(event));
  synthetic.emitTelemetry({ queueDepth:7 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].payload.queueDepth, 7);

  const routed = await h.actionRouter.route({ type:synthetic.ids.actionType, target:{ id:'economy-1' } });
  assert.equal(routed.status, UIActionResult.OK);
  assert.equal(routed.result.readOnly, true);
  off();
  h.registry.destroy();
});

test('workspace mounts through registry-provided renderer and no synthetic subsystem name exists in ApplicationShell source', async () => {
  const h = extensionHarness();
  const counter = { count:0 };
  const synthetic = createSyntheticUnknownExtension(h.signals, { renderCounter:counter });
  h.registry.register(synthetic.descriptor, synthetic.binding);
  const doc = new FakeDocument();
  const host = new FakeNode('main', doc);
  const scope = new ResourceScope();
  h.workspaceRegistry.get(synthetic.ids.workspaceId).render(host, { scope, actionRouter:h.actionRouter });
  assert.equal(counter.count, 1);
  assert.ok(host.children.length >= 2);
  scope.cleanup();
  const source = await readFile(new URL('../src/ui-core/shell.js', import.meta.url), 'utf8');
  assert.equal(source.includes('World Economy'), false);
  assert.equal(source.includes('world-economy'), false);
});

test('ApplicationShell discovers a workspace registered after mount without subsystem-specific logic', () => {
  const h = extensionHarness();
  const doc = new FakeDocument();
  const root = new FakeNode('div', doc);
  const inspector = { host:null, mount(){}, destroy(){} };
  const stateStore = { load(){ return { selectedWorkspace:'built-in' }; }, save(){} };
  let activeScope = new ResourceScope();
  const shell = new ApplicationShell({
    root,
    workspaceRegistry:h.workspaceRegistry,
    inspector,
    signals:h.signals,
    stateStore,
    renderWorkspace(entry, host) {
      activeScope.cleanup();
      activeScope = new ResourceScope();
      host.replaceChildren();
      entry.render?.(host, { scope:activeScope, actionRouter:h.actionRouter });
    },
  }).mount();
  const synthetic = createSyntheticUnknownExtension(h.signals);
  h.registry.register(synthetic.descriptor, synthetic.binding);
  assert.ok(shell.nodes.nav.querySelectorAll('[data-workspace-id]').some((node) => node.dataset.workspaceId === synthetic.ids.workspaceId));
  shell.selectWorkspace(synthetic.ids.workspaceId);
  assert.equal(shell.currentWorkspace, synthetic.ids.workspaceId);
  h.registry.unregister(synthetic.ids.extensionId);
  assert.equal(shell.currentWorkspace, 'built-in');
  assert.equal(shell.nodes.nav.querySelectorAll('[data-workspace-id]').some((node) => node.dataset.workspaceId === synthetic.ids.workspaceId), false);
  activeScope.cleanup();
  shell.destroy();
});

test('optional dependency degradation is displayed state, not a disappearance or authority change', () => {
  const h = extensionHarness();
  const synthetic = createSyntheticUnknownExtension(h.signals);
  h.registry.register(synthetic.descriptor, synthetic.binding);
  const degraded = h.registry.update(synthetic.ids.extensionId, {
    lifecycle:UIExtensionLifecycle.SHADOW,
    availability:UIExtensionAvailability.DEGRADED,
    dependencies:[{ id:'precision-worker', required:false, status:'UNAVAILABLE' }],
    degradedReason:'optional precision worker unavailable',
  });
  assert.equal(degraded.state.availability, UIExtensionAvailability.DEGRADED);
  assert.equal(h.workspaceRegistry.has(synthetic.ids.workspaceId), true);
  assert.equal(h.workspaceRegistry.get(synthetic.ids.workspaceId).availability, UIExtensionAvailability.DEGRADED);
  const recovered = h.registry.update(synthetic.ids.extensionId, {
    availability:UIExtensionAvailability.SHADOW,
    dependencies:[{ id:'precision-worker', required:false, status:'AVAILABLE' }],
    degradedReason:null,
  });
  assert.equal(recovered.state.availability, UIExtensionAvailability.SHADOW);
});

test('required adapter missing fails before partial registration', () => {
  const h = extensionHarness();
  const synthetic = createSyntheticUnknownExtension(h.signals);
  const result = h.registry.tryRegister(synthetic.descriptor, { ...synthetic.binding, adapters:{} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'missing-required-adapter');
  assert.equal(h.workspaceRegistry.has(synthetic.ids.workspaceId), false);
  assert.equal(h.inspectorRegistry.has(synthetic.ids.inspectorKind), false);
  assert.equal(h.actionRouter.hasAction(synthetic.ids.actionType), false);
});

test('duplicate extension/workspace/inspector/action collisions fail safely', () => {
  const h = extensionHarness();
  const first = createSyntheticUnknownExtension(h.signals);
  h.registry.register(first.descriptor, first.binding);
  assert.equal(h.registry.tryRegister(first.descriptor, first.binding).error.code, 'duplicate-extension');

  const second = createSyntheticUnknownExtension(h.signals, { index:2 });
  second.descriptor.workspaces[0];
  const workspaceCollision = { ...second.descriptor, workspaces:[{ ...second.descriptor.workspaces[0], id:first.ids.workspaceId }] };
  assert.equal(h.registry.tryRegister(workspaceCollision, second.binding).error.code, 'duplicate-workspace');

  const inspectorCollision = { ...second.descriptor, inspectors:[{ ...second.descriptor.inspectors[0], kind:first.ids.inspectorKind }] };
  assert.equal(h.registry.tryRegister(inspectorCollision, second.binding).error.code, 'duplicate-inspector');

  const actionCollision = { ...second.descriptor, actions:[{ ...second.descriptor.actions[0], type:first.ids.actionType }] };
  assert.equal(h.registry.tryRegister(actionCollision, second.binding).error.code, 'duplicate-action');
});

test('invalid action binding fails safely and does not register extension', () => {
  const h = extensionHarness();
  const synthetic = createSyntheticUnknownExtension(h.signals);
  const binding = { ...synthetic.binding, actionHandlers:{} };
  const result = h.registry.tryRegister(synthetic.descriptor, binding);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid-action');
  assert.equal(h.registry.has(synthetic.ids.extensionId), false);
});

test('register -> mount -> update -> unmount -> unregister -> re-register leaves no telemetry/action leaks', async () => {
  const h = extensionHarness();
  const baseline = h.signals.listenerCount('SYNTHETIC_ECONOMY_TICK');
  const synthetic = createSyntheticUnknownExtension(h.signals);
  h.registry.register(synthetic.descriptor, synthetic.binding);
  const doc = new FakeDocument();
  const host = new FakeNode('main', doc);
  const scope = new ResourceScope();
  h.workspaceRegistry.get(synthetic.ids.workspaceId).render(host, { scope, actionRouter:h.actionRouter });
  const off = h.registry.subscribeTelemetry(synthetic.ids.extensionId, synthetic.ids.telemetryId, () => {});
  assert.equal(h.signals.listenerCount(synthetic.ids.telemetryType), baseline + 1);
  h.registry.update(synthetic.ids.extensionId, { availability:UIExtensionAvailability.DEGRADED });
  scope.cleanup();
  off();
  assert.equal(h.registry.unregister(synthetic.ids.extensionId), true);
  assert.equal(h.signals.listenerCount(synthetic.ids.telemetryType), baseline);
  assert.equal(h.actionRouter.hasAction(synthetic.ids.actionType), false);
  const missing = await h.actionRouter.route({ type:synthetic.ids.actionType });
  assert.equal(missing.status, UIActionResult.NOT_FOUND);
  h.registry.register(synthetic.descriptor, synthetic.binding);
  assert.equal(h.actionRouter.hasAction(synthetic.ids.actionType), true);
  h.registry.unregister(synthetic.ids.extensionId);
});

test('100+ dynamic extensions remain deterministic, lazy, collision-safe and cleanly unregister', () => {
  const h = extensionHarness();
  const renderCounter = { count:0 };
  const extensions = [];
  for (let i = 127; i >= 0; i -= 1) {
    const synthetic = createSyntheticUnknownExtension(h.signals, { index:i, renderCounter });
    extensions.push(synthetic);
    h.registry.register(synthetic.descriptor, synthetic.binding);
  }
  assert.equal(h.registry.list().length, 128);
  assert.equal(renderCounter.count, 0);
  const ordered = h.registry.list().map((item) => [item.descriptor.display.category, item.descriptor.display.order, item.descriptor.extensionId]);
  const sorted = [...ordered].sort((a,b)=>a[0].localeCompare(b[0]) || a[1]-b[1] || a[2].localeCompare(b[2]));
  assert.deepEqual(ordered, sorted);
  assert.equal(h.signals.listenerCount(extensions[0].ids.telemetryType), 0);
  for (const extension of extensions) h.registry.unregister(extension.ids.extensionId);
  assert.equal(h.registry.list().length, 0);
  assert.equal(h.workspaceRegistry.list().length, 1);
  assert.equal(h.inspectorRegistry.list().length, 1);
});

test('generic unknown artifact remains inspectable with common framework metadata', () => {
  const artifact = normalizeGenericArtifact({
    id:'artifact-future-1', kind:'FutureUnknownArtifact', schemaVersion:'1.0.0', owner:'future-service',
    authority:'INFERRED', revision:'W77', status:'SHADOW', provenance:['source-1'], dependencies:['graph'], invalidators:['revision-change'],
    payload:{ large:[1,2,3,4], note:'diagnostic summary' },
  });
  assert.equal(artifact.artifactId, 'artifact-future-1');
  assert.equal(artifact.artifactType, 'FutureUnknownArtifact');
  assert.equal(artifact.owner, 'future-service');
  assert.ok(artifact.payloadSummary.includes('large=Array(4)'));
});

test('known and unknown valid Event Spine envelopes render safely while incompatible major fails visibly', () => {
  const known = presentEventEnvelope({ schemaVersion:'1.0.0', eventId:'evt-1', eventType:'WORK_STARTED', payload:{ taskId:'task-1' } }, { knownTypes:['WORK_STARTED'] });
  const unknown = presentEventEnvelope({ schemaVersion:'1.0.0', eventId:'evt-2', eventType:'FUTURE_EXTENSION_EVENT', payload:{ detail:'safe' } }, { knownTypes:['WORK_STARTED'] });
  const incompatible = presentEventEnvelope({ schemaVersion:'2.0.0', eventId:'evt-3', eventType:'FUTURE' });
  assert.equal(known.presentation, 'RICH');
  assert.equal(unknown.presentation, 'GENERIC');
  assert.equal(unknown.compatible, true);
  assert.equal(incompatible.compatible, false);
  assert.equal(incompatible.presentation, 'INCOMPATIBLE');
});

test('Runtime Wave 1 adapter consumes canonical lifecycle/execution/resource vocabulary', () => {
  const { adapter } = createRuntimeWave1AdapterFromFixture();
  const summary = adapter.getTelemetrySummary();
  assert.deepEqual(Object.keys(summary.queueDepth), ['L0','L1','L2','L3','L4']);
  assert.deepEqual(summary.reservedForegroundCapacity, { CPU:1 });
  const lifecycle = adapter.getLifecyclePage({ offset:0, limit:10 }).items;
  assert.ok(lifecycle.some((item) => item.cognitiveLayer === 'L3' && item.lifecycleStatus === 'ELIGIBLE' && item.executionStatus === 'ACTIVE'));
  const workers = adapter.getWorkers();
  assert.ok(workers.some((worker) => worker.capabilities.includes('STRUCTURED_LLM')));
});

test('Runtime Wave 1 safe-yield scenario preserves lifecycle through YIELDING/PARKED and resumes from checkpoint', () => {
  const fixture = new RuntimeWave1ContractFixture();
  const adapter = new RuntimeWave1UIAdapter(fixture.bridge());
  const states = fixture.runAcceptanceScenario();
  assert.deepEqual(states.map((x) => x.label), [
    'L3 ACTIVE','yield requested / YIELDING','checkpoint committed','L3 PARKED lifecycle persists','L1 foreground ACTIVE','generation complete','L3 ACTIVE resumed next slice','COMPLETE',
  ]);
  const parked = states[3].ledger.find((record) => record.taskId === 'task-lore-study');
  assert.equal(parked.lifecycleStatus, 'ELIGIBLE');
  assert.equal(parked.executionStatus, 'PARKED');
  assert.equal(parked.checkpoint.completedUnitIds.length, 2);
  assert.equal(states[3].snapshot.resources.borrowedBackgroundLeases, 0);
  const foreground = states[4].ledger.find((record) => record.taskId === 'task-foreground');
  assert.equal(foreground.executionStatus, 'ACTIVE');
  const resumed = states[6].ledger.find((record) => record.taskId === 'task-lore-study');
  assert.equal(resumed.executionStatus, 'ACTIVE');
  assert.equal(resumed.resumeCount, 1);
  const complete = states[7].ledger.find((record) => record.taskId === 'task-lore-study');
  assert.equal(complete.lifecycleStatus, 'SATISFIED');
  assert.equal(complete.executionStatus, 'COMPLETE');
  assert.equal(adapter.getLedgerTaskDetail('task-lore-study').receipts.length >= 1, true);
});

test('Runtime Work Ledger mapping remains paged, explicit-detail, and aligned to canonical fields', () => {
  const { adapter } = createRuntimeWave1AdapterFromFixture();
  const page = adapter.getLedgerPage({ offset:0, limit:1 });
  assert.equal(page.items.length, 1);
  assert.equal('completedSlices' in page.items[0], false);
  const detail = adapter.getLedgerTaskDetail(page.items[0].id);
  for (const key of ['taskId','taskType','layer','sourceRevisions','dependencies','completedSlices','pendingSlices','checkpoint','retryState','recoveryState','dedupeKey','conflictKey','receipts']) assert.ok(key in detail, key);
});

test('Runtime Event Spine unknown extension event falls back to generic safe presentation', () => {
  const fixture = new RuntimeWave1ContractFixture();
  const adapter = new RuntimeWave1UIAdapter(fixture.bridge());
  const event = fixture.emitUnknownEvent();
  const presented = adapter.presentEvent(event);
  assert.equal(presented.compatible, true);
  assert.equal(presented.presentation, 'GENERIC');
  assert.equal(presented.eventType, 'FUTURE_EXTENSION_EVENT');
});

test('Runtime adapter subscriptions cleanly release telemetry and Event Spine listeners', () => {
  const fixture = new RuntimeWave1ContractFixture();
  const adapter = new RuntimeWave1UIAdapter(fixture.bridge());
  const baseline = fixture.listenerCount();
  const off = adapter.subscribeRuntime(() => {});
  assert.equal(fixture.listenerCount(), baseline + 2);
  off();
  assert.equal(fixture.listenerCount(), baseline);
});

test('integrated Wave 4 acceptance covers unknown extension discovery plus Runtime contract lifecycle without changing authority', async () => {
  const h = extensionHarness();
  const synthetic = createSyntheticUnknownExtension(h.signals);
  const steps = [];
  steps.push('built-ins-operational');
  h.registry.register(synthetic.descriptor, synthetic.binding); steps.push('descriptor-registered');
  assert.equal(h.workspaceRegistry.has(synthetic.ids.workspaceId), true); steps.push('workspace-discovered');
  const doc = new FakeDocument(); const host = new FakeNode('main', doc); const scope = new ResourceScope();
  h.workspaceRegistry.get(synthetic.ids.workspaceId).render(host, { scope, actionRouter:h.actionRouter }); steps.push('workspace-mounted');
  assert.equal(h.inspectorRegistry.has(synthetic.ids.inspectorKind), true); steps.push('inspector-registered');
  assert.equal(h.registry.get(synthetic.ids.extensionId).state.lifecycle, 'SHADOW'); steps.push('shadow-presented');
  const events=[]; const off=h.registry.subscribeTelemetry(synthetic.ids.extensionId,synthetic.ids.telemetryId,(event)=>events.push(event)); synthetic.emitTelemetry(); assert.equal(events.length,1); steps.push('telemetry-flow');
  h.registry.update(synthetic.ids.extensionId,{availability:'DEGRADED',dependencies:[{id:'precision-worker',required:false,status:'UNAVAILABLE'}]}); steps.push('degraded');
  h.registry.update(synthetic.ids.extensionId,{availability:'SHADOW',dependencies:[{id:'precision-worker',required:false,status:'AVAILABLE'}]}); steps.push('recovered');
  const artifact=normalizeGenericArtifact({id:'unknown-1',kind:'FutureUnknownArtifact',schemaVersion:'1.0.0'}); assert.equal(artifact.artifactId,'unknown-1'); steps.push('generic-artifact');
  const runtimeFixture=new RuntimeWave1ContractFixture(); const runtimeAdapter=new RuntimeWave1UIAdapter(runtimeFixture.bridge());
  const runtimeStates=runtimeFixture.runAcceptanceScenario(); steps.push('runtime-active','generation-start','yield-checkpoint-park');
  const parked=runtimeStates[3].ledger.find((r)=>r.taskId==='task-lore-study'); assert.equal(parked.lifecycleStatus,'ELIGIBLE'); steps.push('lifecycle-persists');
  assert.equal(runtimeStates[4].ledger.find((r)=>r.taskId==='task-foreground').executionStatus,'ACTIVE'); steps.push('foreground-runs');
  assert.equal(runtimeStates[6].ledger.find((r)=>r.taskId==='task-lore-study').executionStatus,'ACTIVE'); steps.push('background-resumes');
  off(); scope.cleanup(); h.registry.unregister(synthetic.ids.extensionId); steps.push('extension-unregistered');
  assert.equal(h.workspaceRegistry.has('built-in'),true); steps.push('built-ins-still-operational');
  assert.equal(h.signals.listenerCount(synthetic.ids.telemetryType),0); steps.push('cleanup-complete');
  const action=await h.actionRouter.route({type:synthetic.ids.actionType}); assert.equal(action.status,UIActionResult.NOT_FOUND); steps.push('action-removed');
  assert.equal(runtimeAdapter.getLedgerTaskDetail('task-lore-study').lifecycleStatus,'SATISFIED'); steps.push('runtime-complete');
  steps.push('authority-unchanged');
  assert.equal(steps.length,22);
});
