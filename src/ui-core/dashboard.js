import { SignalHub } from './signals.js';
import { RenderScheduler } from './render-scheduler.js';
import { WidgetRegistry, WorkspaceRegistry, InspectorRegistry } from './registry.js';
import { WidgetRuntime } from './lifecycle.js';
import { ActionRouter } from './action-router.js';
import { UIStateStore } from './persistence.js';
import { OverlayManager } from './overlay.js';
import { NotificationCenter, ToastViewport } from './notifications.js';
import { registerPrimitiveWidgets, createButton, element } from './primitives.js';
import { registerCognitiveWidgets } from './cognitive-widgets.js';
import { InspectorController } from './inspector.js';
import { ApplicationShell } from './shell.js';
import { MockBrainRuntime } from './mock-brain.js';
import { Signals } from './constants.js';
import { ResourceScope } from './lifecycle.js';

export function createBrainDashboard({ root, stateStore = new UIStateStore() } = {}) {
  if (!root) throw new Error('Area-52 Brain Dashboard requires a root element');
  const signals = new SignalHub();
  const scheduler = new RenderScheduler();
  const widgetRegistry = new WidgetRegistry();
  const workspaceRegistry = new WorkspaceRegistry();
  const inspectorRegistry = new InspectorRegistry();
  const actionRouter = new ActionRouter();
  const overlays = new OverlayManager({ document: root.ownerDocument, root: root.ownerDocument.body, getResponsiveMode: () => shell?.mode });
  const notifications = new NotificationCenter({ signals });
  const runtime = new MockBrainRuntime({ signals, scheduler });
  const mounted = new Set();

  registerPrimitiveWidgets(widgetRegistry);
  registerCognitiveWidgets(widgetRegistry);
  registerInspectorRenderers(inspectorRegistry);
  const widgetRuntime = new WidgetRuntime({ registry: widgetRegistry, services: { signals, scheduler, actionRouter, overlays, notifications, mockBrain: runtime } });

  actionRouter.registerSubsystem('mock-brain', async (action) => {
    if (action.type === 'mock.worker.advance') return runtime.advanceWorker();
    if (action.type === 'mock.claim.supersede') return runtime.supersedeClaim();
    if (action.type === 'mock.batch.advance') return runtime.advanceBatch();
    throw new Error(`Unsupported mock action: ${action.type}`);
  });
  actionRouter.registerAction('mock.worker.advance', { subsystem: 'mock-brain', permissions: ['demo:operate'] });
  actionRouter.registerAction('mock.claim.supersede', { subsystem: 'mock-brain', permissions: ['demo:operate'], allowedStates: ['CURRENT'] });
  actionRouter.registerAction('mock.batch.advance', { subsystem: 'mock-brain', permissions: ['demo:operate'] });

  const inspector = new InspectorController({ host: root, registry: inspectorRegistry, signals, scheduler, services: { signals } });
  let shell;
  const renderWorkspace = (entry, host) => {
    for (const instance of mounted) widgetRuntime.destroy(instance);
    mounted.clear();
    host.replaceChildren();
    entry.render?.(host, { mount(widgetId, node, props) { const instance = widgetRuntime.mount(widgetId, node, props); mounted.add(instance); return instance; }, signals, runtime, actionRouter, permissions: ['demo:operate'], overlays, notifications });
  };

  registerWorkspaces(workspaceRegistry, root.ownerDocument);
  shell = new ApplicationShell({ root, workspaceRegistry, inspector, signals, stateStore, renderWorkspace });
  shell.mount();

  const toastScope = new ResourceScope();
  const toastViewport = new ToastViewport({ host: shell.nodes.toastHost, signals, scope: toastScope });
  toastViewport.mount();
  signals.publish(Signals.COGNITIVE_MODE_CHANGED, { mode: 'HOT / MOCK' }, { source: 'mock-brain' });

  return {
    shell, signals, scheduler, widgetRegistry, workspaceRegistry, inspectorRegistry, actionRouter, runtime, overlays, notifications,
    destroy() { for (const instance of mounted) widgetRuntime.destroy(instance); mounted.clear(); toastScope.cleanup(); overlays.destroy(); shell.destroy(); scheduler.destroy(); signals.clear(); },
  };
}

function registerWorkspaces(registry, doc) {
  registry.register({ id: 'memory', title: 'Memory', icon: '◉', views: ['overview'], supportedActions: ['inspect'], render(host, ctx) { renderBrainWorkspace(doc, host, ctx); } });
  registry.register({ id: 'world', title: 'World', icon: '◇', views: ['temporal'], supportedActions: ['inspect'], render(host, ctx) { renderWorldWorkspace(doc, host, ctx); } });
  registry.register({ id: 'study', title: 'Study', icon: '▦', views: ['provenance'], supportedActions: ['inspect'], render(host, ctx) { renderStudyWorkspace(doc, host, ctx); } });
  registry.register({ id: 'runtime', title: 'Runtime', icon: '↯', views: ['workers', 'batches'], supportedActions: ['mock.worker.advance'], render(host, ctx) { renderRuntimeWorkspace(doc, host, ctx); } });
  registry.register({ id: 'retrieval', title: 'Retrieval', icon: '⌕', views: ['candidates'], supportedActions: ['inspect'], render(host, ctx) { renderRetrievalWorkspace(doc, host, ctx); } });
  registry.register({ id: 'evaluation', title: 'Evaluation', icon: '✓', views: ['shadow'], supportedActions: ['inspect'], render(host, ctx) { renderEvaluationWorkspace(doc, host, ctx); } });
}

function slot(doc, parent, className = '') { const node = element(doc, 'div', { className }); parent.append(node); return node; }

function renderBrainWorkspace(doc, host, ctx) {
  host.append(element(doc, 'h1', { text: 'Brain Dashboard' }));
  const controls = element(doc, 'div', { className: 'a52-stack' });
  controls.append(
    createButton(doc, { label: 'Advance worker lifecycle', onPress: () => ctx.actionRouter.route({ type: 'mock.worker.advance' }, { permissions: ctx.permissions }) }),
    createButton(doc, { label: 'Advance batch', onPress: () => ctx.actionRouter.route({ type: 'mock.batch.advance' }, { permissions: ctx.permissions }) }),
    createButton(doc, { label: 'Supersede temporal claim', onPress: () => ctx.actionRouter.route({ type: 'mock.claim.supersede', target: { state: ctx.runtime.claim.status } }, { permissions: ctx.permissions }) }),
  );
  host.append(controls);
  const grid = element(doc, 'div', { className: 'a52-grid' }); host.append(grid);
  ctx.mount('cognitive.BrainStatus', slot(doc, grid), { mode: 'HOT', queueCount: 3, status: 'ready' });
  ctx.mount('cognitive.WorkerPool', slot(doc, grid), { workers: ctx.runtime.workers });
  ctx.mount('cognitive.BatchProgress', slot(doc, grid), { batchId: 'batch-42', progress: ctx.runtime.batchProgress });
  ctx.mount('cognitive.TemporalStateCard', slot(doc, grid), { claim: ctx.runtime.claim });
  ctx.mount('cognitive.ReflectionCard', slot(doc, grid), { reflection: ctx.runtime.reflection });
  ctx.mount('cognitive.ContextPacketViewer', slot(doc, grid), { packet: { turnId: 'TURN-001', lanes: ['lore', 'graph', 'green-room'], sealed: true } });
}

function renderRuntimeWorkspace(doc, host, ctx) {
  host.append(element(doc, 'h1', { text: 'Runtime' }));
  ctx.mount('cognitive.WorkerPool', slot(doc, host), { workers: ctx.runtime.workers });
  ctx.mount('cognitive.LifecycleLane', slot(doc, host), { workerId: ctx.runtime.workers[0].id, current: ctx.runtime.workers[0].state });
  ctx.mount('cognitive.BatchProgress', slot(doc, host), { batchId: 'batch-42', progress: ctx.runtime.batchProgress });
}

function renderWorldWorkspace(doc, host, ctx) {
  host.append(element(doc, 'h1', { text: 'World Model' }));
  ctx.mount('cognitive.TemporalStateCard', slot(doc, host), { claim: ctx.runtime.claim });
  ctx.mount('cognitive.GraphExplorer', slot(doc, host), { nodes: 42, edges: 71, selected: 'Tavern' });
}

function renderStudyWorkspace(doc, host, ctx) {
  host.append(element(doc, 'h1', { text: 'Lore Study' }));
  ctx.mount('cognitive.SourceCard', slot(doc, host), { source: { id: 'UID-184', title: 'Tavern State', revision: 3, status: 'canonical' } });
  ctx.mount('cognitive.ProvenanceChain', slot(doc, host), { chain: ctx.runtime.claim.provenance });
}

function renderRetrievalWorkspace(doc, host, ctx) {
  host.append(element(doc, 'h1', { text: 'Retrieval' }), element(doc, 'p', { text: '10,000 logical candidates; only the visible window is mounted.' }));
  const candidates = Array.from({ length: 10000 }, (_, i) => ({ id: `candidate-${i + 1}`, title: `Candidate ${i + 1}`, score: (1 - (i % 97) / 100).toFixed(2) }));
  ctx.mount('cognitive.VirtualCandidateList', slot(doc, host), { items: candidates });
}

function renderEvaluationWorkspace(doc, host, ctx) {
  host.append(element(doc, 'h1', { text: 'Evaluation' }));
  const grid = element(doc, 'div', { className: 'a52-grid' }); host.append(grid);
  ctx.mount('cognitive.TruthDecision', slot(doc, grid), { decision: 'CURRENT', confidence: 0.96, reason: 'Temporal graph agrees with source revision.' });
  ctx.mount('cognitive.RerankResult', slot(doc, grid), { before: 50, after: 8, model: 'mock-cross-encoder' });
  ctx.mount('cognitive.ShadowComparison', slot(doc, grid), { left: 'Nexus', right: 'Area-52', agreement: '87%' });
}

function registerInspectorRenderers(registry) {
  registry.register('*', (object, { document: doc }) => {
    const root = element(doc, 'div', { className: 'a52-stack' });
    root.append(element(doc, 'h2', { text: object.title ?? object.name ?? object.id ?? object.kind }), element(doc, 'pre', { className: 'a52-context-packet', text: JSON.stringify(object, null, 2) }));
    return root;
  });
}
