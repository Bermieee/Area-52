import {deepClone, stableHash, stableStringify} from './lore-contracts.js';

const DEFAULT_LIMIT = 64;
const MAX_LIMIT = 4096;

function boundedInt(value, fallback, max = MAX_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(parsed)));
}

function evidenceIdentity(row) {
  if (!row?.evidenceId || !row?.sourceRevisionId) {
    const error = new TypeError('Navigation evidence requires evidenceId and sourceRevisionId');
    error.code = 'LORE_NAVIGATION_EVIDENCE_IDENTITY_REQUIRED';
    throw error;
  }
  return {
    evidenceId: String(row.evidenceId),
    sourceRevisionId: String(row.sourceRevisionId),
  };
}

export function navigationEvidenceRef(row) {
  const identity = evidenceIdentity(row);
  return 'lore-nav-evidence:' + stableHash(stableStringify(identity));
}

export class LoreNavigationEvidenceRegistry {
  constructor(snapshot = null) {
    this.records = new Map();
    if (snapshot) this.restore(snapshot);
  }

  register(row) {
    const identity = evidenceIdentity(row);
    const evidenceRef = row?.evidenceRef ? String(row.evidenceRef) : navigationEvidenceRef(identity);
    const record = {
      ...deepClone(row),
      evidenceRef,
      evidenceId: identity.evidenceId,
      sourceRevisionId: identity.sourceRevisionId,
      authorityClass: row?.authorityClass ?? 'DERIVED_EVIDENCE',
      sourceAuthority: false,
      truthAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    };
    const existing = this.records.get(evidenceRef);
    if (existing) {
      const left = stableStringify({...existing, evidenceRef: undefined});
      const right = stableStringify({...record, evidenceRef: undefined});
      if (left !== right) {
        const error = new Error('Conflicting navigation evidence payload for stable ref: ' + evidenceRef);
        error.code = 'LORE_NAVIGATION_EVIDENCE_REF_CONFLICT';
        throw error;
      }
      return evidenceRef;
    }
    this.records.set(evidenceRef, record);
    return evidenceRef;
  }

  registerMany(rows = []) {
    return [...new Set((rows || []).map((row) => this.register(row)))];
  }

  resolve(evidenceRef) {
    const row = this.records.get(String(evidenceRef));
    return row ? deepClone(row) : null;
  }

  resolveMany(refs = [], {offset = 0, limit = DEFAULT_LIMIT} = {}) {
    const unique = [...new Set((refs || []).filter(Boolean).map(String))];
    const start = boundedInt(offset, 0, Number.MAX_SAFE_INTEGER);
    const size = Math.max(1, boundedInt(limit, DEFAULT_LIMIT));
    const selected = unique.slice(start, start + size);
    const evidence = [];
    const missingEvidenceRefs = [];
    for (const evidenceRef of selected) {
      const row = this.resolve(evidenceRef);
      if (row) evidence.push(row);
      else missingEvidenceRefs.push(evidenceRef);
    }
    return {
      kind: 'LoreNavigationEvidenceResolution',
      status: missingEvidenceRefs.length ? 'DEGRADED' : 'COMPLETE',
      totalRefs: unique.length,
      offset: start,
      limit: size,
      returnedRefs: selected.length,
      hasMore: start + selected.length < unique.length,
      evidence,
      missingEvidenceRefs,
      authorityGranted: false,
      sourceAuthority: false,
      truthAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    };
  }

  resolveAll(refs = [], {limit = MAX_LIMIT} = {}) {
    const unique = [...new Set((refs || []).filter(Boolean).map(String))];
    const size = Math.max(1, boundedInt(limit, MAX_LIMIT));
    if (unique.length > size) {
      return {
        kind: 'LoreNavigationEvidenceResolution',
        status: 'LIMIT_EXCEEDED',
        totalRefs: unique.length,
        offset: 0,
        limit: size,
        returnedRefs: 0,
        hasMore: true,
        evidence: [],
        missingEvidenceRefs: [],
        authorityGranted: false,
        sourceAuthority: false,
        truthAuthority: false,
        settlementAuthority: false,
        contextSealAuthority: false,
      };
    }
    return this.resolveMany(unique, {offset: 0, limit: size});
  }

  delete(evidenceRef) {
    return this.records.delete(String(evidenceRef));
  }

  status() {
    return {
      kind: 'LoreNavigationEvidenceRegistryStatus',
      records: this.records.size,
      authorityGranted: false,
      sourceAuthority: false,
      truthAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    };
  }

  snapshot() {
    return {
      kind: 'LoreNavigationEvidenceRegistrySnapshot',
      contractVersion: 1,
      records: [...this.records.values()].map(deepClone),
    };
  }

  restore(snapshot) {
    this.records = new Map();
    for (const row of snapshot?.records || []) {
      const evidenceRef = row?.evidenceRef || navigationEvidenceRef(row);
      this.register({...deepClone(row), evidenceRef});
    }
  }
}
