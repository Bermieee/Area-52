export function deepClone(value) {
  return value == null ? value : structuredClone(value);
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function revisionRank(value) {
  if (value == null) return Number.NEGATIVE_INFINITY;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object' && 'revision' in value) return revisionRank(value.revision);
  const text = String(value);
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  if (matches?.length) return Number(matches[matches.length - 1]);
  let hash = 0;
  for (const char of text) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function compareRevision(a, b) {
  const ar = revisionRank(a);
  const br = revisionRank(b);
  if (ar === br) return String(a ?? '').localeCompare(String(b ?? ''));
  return ar < br ? -1 : 1;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function stableSort(items, comparator) {
  return items.map((value, index) => ({ value, index }))
    .sort((a, b) => comparator(a.value, b.value) || a.index - b.index)
    .map(({ value }) => value);
}

export function makeSequenceId(prefix, sequence, width = 6) {
  return `${prefix}-${String(sequence).padStart(width, '0')}`;
}

export function normalizeCapabilities(capabilities = []) {
  return [...new Set(capabilities)].sort();
}

export function normalizeResources(resources = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(resources)) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) out[key] = value;
  }
  return out;
}

export function immutableCopy(value) {
  return deepFreeze(deepClone(value));
}
