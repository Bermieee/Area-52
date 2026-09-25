function parseVersion(value) {
  const text = String(value ?? '1.0');
  const match = text.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) throw new TypeError(`Invalid schemaVersion: ${text}`);
  return { text, major: Number(match[1]), minor: Number(match[2] ?? 0), patch: Number(match[3] ?? 0) };
}

function validateSchema(schema = {}) {
  const required = [...(schema.required ?? [])];
  const properties = { ...(schema.properties ?? {}) };
  const allowUnknown = schema.allowUnknown ?? true;
  if (required.some((name) => typeof name !== 'string')) throw new TypeError('payloadSchema.required must contain strings');
  for (const [name, type] of Object.entries(properties)) {
    if (!['string', 'number', 'boolean', 'object', 'array', 'any'].includes(type)) {
      throw new TypeError(`Unsupported payload schema type for ${name}: ${type}`);
    }
  }
  return { required, properties, allowUnknown };
}

function matchesType(value, type) {
  if (type === 'any') return true;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

export class EventTypeRegistry {
  constructor({ builtins = [], onDiagnostic = null } = {}) {
    this.types = new Map();
    this.onDiagnostic = onDiagnostic;
    for (const eventType of builtins) {
      this.register({ eventType, schemaVersion: '1.0', producer: 'RUNTIME_CORE', payloadSchema: { allowUnknown: true } });
    }
  }

  register({ eventType, schemaVersion = '1.0', producer = 'UNSPECIFIED', payloadSchema = { allowUnknown: true } } = {}) {
    try {
      if (typeof eventType !== 'string' || !eventType) throw new TypeError('eventType is required');
      if (typeof producer !== 'string' || !producer) throw new TypeError('producer is required');
      const version = parseVersion(schemaVersion);
      const versions = this.types.get(eventType) ?? new Map();
      if (versions.has(version.text)) throw new Error(`Event type/version already registered: ${eventType}@${version.text}`);
      const descriptor = { eventType, schemaVersion: version.text, major: version.major, minor: version.minor, patch: version.patch, producer, payloadSchema: validateSchema(payloadSchema) };
      versions.set(version.text, descriptor);
      this.types.set(eventType, versions);
      return structuredClone(descriptor);
    } catch (error) {
      this.onDiagnostic?.({ type: 'EVENT_REGISTRATION_FAILED', eventType: eventType ?? null, schemaVersion: schemaVersion ?? null, reason: error?.message ?? String(error) });
      throw error;
    }
  }

  resolve(eventType, schemaVersion = null) {
    const versions = this.types.get(eventType);
    if (!versions) return null;
    if (schemaVersion == null) {
      return [...versions.values()].sort((a, b) => b.major - a.major || b.minor - a.minor || b.patch - a.patch)[0] ?? null;
    }
    const requested = parseVersion(schemaVersion);
    if (versions.has(requested.text)) return versions.get(requested.text);
    const compatible = [...versions.values()].filter((item) => item.major === requested.major)
      .sort((a, b) => b.minor - a.minor || b.patch - a.patch);
    return compatible[0] ?? null;
  }

  validate(eventType, schemaVersion, payload) {
    const descriptor = this.resolve(eventType, schemaVersion);
    if (!descriptor) {
      const reason = this.types.has(eventType) ? 'unsupported-major-version' : 'unregistered-event-type';
      this.onDiagnostic?.({ type: 'EVENT_REGISTRATION_FAILED', eventType, schemaVersion, reason });
      return { ok: false, reason, descriptor: null };
    }
    if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, reason: 'payload-must-be-object', descriptor };
    }
    const schema = descriptor.payloadSchema;
    for (const name of schema.required) {
      if (!(name in payload)) return { ok: false, reason: `missing-required-payload-field:${name}`, descriptor };
    }
    for (const [name, value] of Object.entries(payload)) {
      const expected = schema.properties[name];
      if (!expected) {
        if (!schema.allowUnknown) return { ok: false, reason: `unknown-payload-field:${name}`, descriptor };
        continue;
      }
      if (!matchesType(value, expected)) return { ok: false, reason: `payload-field-type:${name}:${expected}`, descriptor };
    }
    return { ok: true, reason: 'compatible', descriptor };
  }

  list() {
    return [...this.types.values()].flatMap((versions) => [...versions.values()].map((item) => structuredClone(item)))
      .sort((a, b) => a.eventType.localeCompare(b.eventType) || a.schemaVersion.localeCompare(b.schemaVersion));
  }
}
