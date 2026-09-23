import { UIActionResult } from './constants.js';

/** Presentation dispatch boundary. This router never becomes mutation authority. */
export class ActionRouter {
  #actions = new Map();
  #subsystems = new Map();

  registerSubsystem(id, invoke) {
    if (!id || typeof invoke !== 'function') throw new TypeError('subsystem id/invoke required');
    this.#subsystems.set(id, invoke);
    return () => this.#subsystems.delete(id);
  }

  registerAction(type, definition) {
    if (!type || !definition?.subsystem) throw new TypeError('action type/subsystem required');
    this.#actions.set(type, Object.freeze({
      ...definition,
      permissions: Object.freeze([...(definition.permissions ?? [])]),
      allowedStates: definition.allowedStates ? Object.freeze([...(definition.allowedStates)]) : null,
      validate: definition.validate ?? null,
    }));
    return () => this.#actions.delete(type);
  }

  async route(action, context = {}) {
    const definition = this.#actions.get(action?.type);
    if (!definition) return { ok: false, status: UIActionResult.NOT_FOUND, error: 'unknown-action' };

    const permissionSet = new Set(context.permissions ?? []);
    if (definition.permissions.some((permission) => !permissionSet.has(permission))) {
      return { ok: false, status: UIActionResult.DENIED, error: 'permission-denied' };
    }

    if (definition.allowedStates && !definition.allowedStates.includes(action?.target?.state)) {
      return { ok: false, status: UIActionResult.INVALID, error: 'invalid-target-state' };
    }

    const validation = definition.validate?.(action, context);
    if (validation === false || typeof validation === 'string') {
      return { ok: false, status: UIActionResult.INVALID, error: validation || 'invalid-action' };
    }

    const invoke = this.#subsystems.get(definition.subsystem);
    if (!invoke) return { ok: false, status: UIActionResult.NOT_FOUND, error: 'subsystem-unavailable' };

    try {
      const result = await invoke(action, context);
      return { ok: true, status: UIActionResult.OK, result };
    } catch (error) {
      return { ok: false, status: UIActionResult.ERROR, error: error?.message ?? String(error) };
    }
  }
}
