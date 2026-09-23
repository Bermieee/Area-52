import { ResourceScope } from '../../src/ui-core/lifecycle.js';

export class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.listeners = new Map();
    this.body = new FakeNode('body', this);
  }

  createElement(tag) { return new FakeNode(tag, this); }
  addEventListener(type, handler) { add(this.listeners, type, handler); }
  removeEventListener(type, handler) { remove(this.listeners, type, handler); }
}

export class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.disabled = false;
    this.offsetParent = {};
    this.clientWidth = 1280;
    this.style = {};
    this.classList = {
      add: (...names) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach((name) => current.add(name));
        this.className = [...current].join(' ');
      },
      toggle: (name, force) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force ?? !current.has(name);
        if (enabled) current.add(name); else current.delete(name);
        this.className = [...current].join(' ');
      },
    };
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node == null) continue;
      this.children.push(node);
      if (typeof node === 'object') node.parentNode = this;
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, handler) { add(this.listeners, type, handler); }
  removeEventListener(type, handler) { remove(this.listeners, type, handler); }
  focus() { this.ownerDocument.activeElement = this; }

  querySelectorAll(selector) {
    const nodes = [];
    const walk = (node) => {
      for (const child of node.children ?? []) {
        if (typeof child !== 'object') continue;
        if (matches(child, selector)) nodes.push(child);
        walk(child);
      }
    };
    walk(this);
    return nodes;
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler({ type, target:this, preventDefault() {}, ...event });
  }
}

export function createSyntheticUnknownExtension(signals, { index = null, renderCounter = null } = {}) {
  const suffix = index == null ? '' : `-${index}`;
  const extensionId = `synthetic.world-economy${suffix}`;
  const workspaceId = `economy${suffix}`;
  const inspectorKind = `synthetic-economy-artifact${suffix}`;
  const actionType = `synthetic.economy${suffix}.inspect`;
  const telemetryType = `SYNTHETIC_ECONOMY_TICK${suffix}`;
  const adapterName = `EconomyUIAdapter${suffix}`;
  const adapter = {
    getSummary() { return { market:'stable', revision:index ?? 1 }; },
    inspect(target) { return { ...target, readOnly:true, source:'synthetic-fixture' }; },
  };
  const descriptor = {
    extensionId,
    subsystemId:`world-economy${suffix}`,
    schemaVersion:'1.0.0',
    display:{ title:index == null ? 'World Economy' : `World Economy ${String(index).padStart(3,'0')}`, category:`Synthetic ${(index ?? 0) % 5}`, icon:'¤', order:index ?? 0 },
    workspaces:[{ id:workspaceId, title:index == null ? 'World Economy' : `Economy ${index}`, category:`Synthetic ${(index ?? 0) % 5}`, adapter:adapterName, surfaceId:'economy.overview', views:['overview'], actions:[actionType] }],
    inspectors:[{ id:`economy-inspector${suffix}`, kind:inspectorKind, adapter:adapterName, surfaceId:'economy.inspect' }],
    telemetry:[{ id:`economy-telemetry${suffix}`, signalType:telemetryType, adapter:adapterName, surfaceId:'economy.telemetry', lightweight:true }],
    actions:[{ type:actionType, operation:'inspect', adapter:adapterName, readOnly:true }],
    lifecycle:'SHADOW',
    requiredCapabilities:['READ_STATE'],
    optionalCapabilities:['PRECISION'],
    dependencies:[{ id:'precision-worker', required:false, status:'AVAILABLE' }],
    permissions:['ui:inspect'],
    authorityHints:['READ_ONLY'],
    availability:'SHADOW',
    futureOptionalField:{ accepted:true },
  };
  const binding = {
    adapters:{ [adapterName]:adapter },
    workspaceRenderers:{
      'economy.overview'(host, ctx) {
        if (renderCounter) renderCounter.count += 1;
        const node = host.ownerDocument.createElement('div');
        node.textContent = `Economy surface · ${ctx.adapter.getSummary().market}`;
        host.append(node);
      },
    },
    inspectorRenderers:{
      'economy.inspect'(object, { document }) {
        const node = document.createElement('div');
        node.textContent = `Economy artifact · ${object.id ?? 'unknown'}`;
        return node;
      },
    },
    telemetrySubscribers:{
      'economy.telemetry'({ handler }) {
        return signals.subscribe(telemetryType, handler);
      },
    },
    actionHandlers:{
      inspect(action) { return adapter.inspect(action.target ?? { id:'none' }); },
    },
  };
  return {
    descriptor,
    binding,
    ids:{ extensionId, workspaceId, inspectorKind, actionType, telemetryType, telemetryId:`economy-telemetry${suffix}` },
    emitTelemetry(payload = { queueDepth:1 }) { signals.publish(telemetryType, payload, { source:extensionId }); },
  };
}

export function makeWorkspaceRenderContext() {
  return {
    scope:new ResourceScope(),
    permissions:[],
    signals:null,
    scheduler:null,
    actionRouter:null,
  };
}

function add(map, type, handler) {
  if (!map.has(type)) map.set(type, new Set());
  map.get(type).add(handler);
}

function remove(map, type, handler) {
  map.get(type)?.delete(handler);
}

function matches(node, selector) {
  if (selector === '[data-workspace-id]') return 'workspaceId' in node.dataset;
  if (selector === '[data-roving-item]') return 'rovingItem' in node.dataset;
  return false;
}
