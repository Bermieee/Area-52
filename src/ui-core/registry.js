import { RenderCost, WidgetCategory } from './constants.js';

const VALID_COST = new Set(Object.values(RenderCost));
const VALID_CATEGORY = new Set(Object.values(WidgetCategory));

function validateWidgetSpec(spec) {
  if (!spec?.widgetId || typeof spec.widgetId !== 'string') throw new TypeError('widgetId is required');
  if (!spec.version || typeof spec.version !== 'string') throw new TypeError(`${spec.widgetId}: version is required`);
  if (!VALID_CATEGORY.has(spec.category)) throw new TypeError(`${spec.widgetId}: invalid category`);
  if (!VALID_COST.has(spec.renderCostClass)) throw new TypeError(`${spec.widgetId}: invalid renderCostClass`);
  if (typeof spec.create !== 'function') throw new TypeError(`${spec.widgetId}: create() is required`);
  return Object.freeze({
    ...spec,
    propsSchema: Object.freeze({ ...(spec.propsSchema ?? {}) }),
    supportedActions: Object.freeze([...(spec.supportedActions ?? [])]),
    subscriptions: Object.freeze([...(spec.subscriptions ?? [])]),
    permissions: Object.freeze([...(spec.permissions ?? [])]),
  });
}

export class WidgetRegistry {
  #widgets = new Map();

  register(spec) {
    const normalized = validateWidgetSpec(spec);
    if (this.#widgets.has(normalized.widgetId)) throw new Error(`Widget already registered: ${normalized.widgetId}`);
    this.#widgets.set(normalized.widgetId, normalized);
    return normalized;
  }

  get(widgetId) {
    const spec = this.#widgets.get(widgetId);
    if (!spec) throw new Error(`Unknown widget: ${widgetId}`);
    return spec;
  }

  has(widgetId) { return this.#widgets.has(widgetId); }
  list({ category } = {}) {
    return [...this.#widgets.values()].filter((spec) => !category || spec.category === category);
  }
}

export class WorkspaceRegistry {
  #workspaces = new Map();

  register(workspace) {
    if (!workspace?.id || !workspace?.title) throw new TypeError('workspace id/title required');
    if (this.#workspaces.has(workspace.id)) throw new Error(`Workspace already registered: ${workspace.id}`);
    const normalized = Object.freeze({
      id: workspace.id,
      title: workspace.title,
      icon: workspace.icon ?? '',
      views: Object.freeze([...(workspace.views ?? [])]),
      supportedActions: Object.freeze([...(workspace.supportedActions ?? [])]),
      render: workspace.render,
    });
    this.#workspaces.set(normalized.id, normalized);
    return normalized;
  }

  get(id) {
    const workspace = this.#workspaces.get(id);
    if (!workspace) throw new Error(`Unknown workspace: ${id}`);
    return workspace;
  }

  list() { return [...this.#workspaces.values()]; }
}

export class InspectorRegistry {
  #renderers = new Map();

  register(kind, renderer) {
    if (!kind || typeof renderer !== 'function') throw new TypeError('Inspector kind and renderer required');
    this.#renderers.set(kind, renderer);
    return () => this.#renderers.delete(kind);
  }

  resolve(kind) { return this.#renderers.get(kind) ?? this.#renderers.get('*') ?? null; }
}
