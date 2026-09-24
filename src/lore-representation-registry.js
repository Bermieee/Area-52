import {deepClone, stableHash, stableStringify} from './lore-contracts.js';
import {QualityStatus, RepresentationProfile} from './lore-representation-contracts.js';

function familyKey({sourceId, profile, capCharacters = null}) {
  return sourceId + '|' + profile + '|' + (capCharacters == null ? '-' : capCharacters);
}

export class LoreRepresentationRegistry {
  constructor(snapshot = null) {
    this.representations = new Map();
    this.historyByFamily = new Map();
    this.currentByFamily = new Map();
    this.byReuseKey = new Map();
    this.staleReasons = new Map();
    if (snapshot) this.restore(snapshot);
  }

  nextRevision({sourceId, profile, capCharacters = null}) {
    return (this.historyByFamily.get(familyKey({sourceId, profile, capCharacters})) || []).length + 1;
  }

  publish({representation, sourceRegistry}) {
    if (!representation?.id || representation.kind !== 'LoreRepresentationArtifact') throw new TypeError('Invalid Lore representation');
    if (representation.authorityClass === 'SOURCE_CANON') throw new Error('Derived representation cannot be SOURCE_CANON');
    if (representation.retentionReceipt?.status !== QualityStatus.PASS) throw new Error('Failed representation cannot be published');
    const currentSource = sourceRegistry.currentRevision(representation.sourceId);
    if (currentSource.id !== representation.sourceRevisionId) throw new Error('Cannot publish stale Lore representation');
    const existing = this.byReuseKey.get(representation.reuseKey);
    if (existing) return this.get(existing);

    const key = familyKey(representation);
    const priorId = this.currentByFamily.get(key);
    if (priorId && this.representations.has(priorId)) {
      const prior = this.representations.get(priorId);
      prior.state = 'HISTORICAL';
      prior.replacedByRepresentationId = representation.id;
      this.staleReasons.set(prior.id, {
        kind: 'LoreRepresentationStaleReason',
        reason: 'REPRESENTATION_REPLACED',
        replacedByRepresentationId: representation.id,
      });
    }
    const stored = deepClone(representation);
    stored.state = 'CURRENT';
    stored.replacedByRepresentationId = null;
    this.representations.set(stored.id, stored);
    this.byReuseKey.set(stored.reuseKey, stored.id);
    const history = this.historyByFamily.get(key) || [];
    this.historyByFamily.set(key, [...history, stored.id]);
    this.currentByFamily.set(key, stored.id);
    return this.get(stored.id);
  }

  get(id) {
    const row = this.representations.get(id);
    return row ? deepClone(row) : null;
  }

  getByReuseKey(reuseKey, {sourceRegistry = null} = {}) {
    const id = this.byReuseKey.get(reuseKey);
    if (!id) return null;
    const row = this.representations.get(id);
    if (!row || row.retentionReceipt?.status !== QualityStatus.PASS) return null;
    if (sourceRegistry) {
      const current = sourceRegistry.currentRevision(row.sourceId, {allowMissing: true});
      if (!current || current.id !== row.sourceRevisionId || current.state === 'REMOVED') return null;
    }
    if (row.state !== 'CURRENT') return null;
    return deepClone(row);
  }

  history({sourceId, profile, capCharacters = null}) {
    const ids = this.historyByFamily.get(familyKey({sourceId, profile, capCharacters})) || [];
    return ids.map((id) => this.get(id));
  }

  current({sourceId, profile, capCharacters = null, sourceRegistry, policyRevision = null, compilerRevision = null}) {
    const id = this.currentByFamily.get(familyKey({sourceId, profile, capCharacters}));
    if (!id) return null;
    const row = this.representations.get(id);
    if (!row) return null;
    const currentSource = sourceRegistry.currentRevision(sourceId, {allowMissing: true});
    if (!currentSource || currentSource.state === 'REMOVED' || row.sourceRevisionId !== currentSource.id) return null;
    if (policyRevision && row.generation.policyRevision !== policyRevision) return null;
    if (compilerRevision && row.generation.compilerRevision !== compilerRevision) return null;
    if (row.state !== 'CURRENT') return null;
    return deepClone(row);
  }

  refreshPolicyFreshness(sourceRegistry, {profile, policyRevision = null, compilerRevision = null} = {}) {
    const changed = [];
    for (const row of this.representations.values()) {
      if (row.state !== 'CURRENT' || row.profile !== profile) continue;
      const source = sourceRegistry.currentRevision(row.sourceId, {allowMissing: true});
      let reason = null;
      if (!source || source.state === 'REMOVED') reason = 'SOURCE_REMOVED';
      else if (source.id !== row.sourceRevisionId) reason = 'SOURCE_REVISION_CHANGED';
      else if (policyRevision && row.generation.policyRevision !== policyRevision) reason = 'POLICY_REVISION_CHANGED';
      else if (compilerRevision && row.generation.compilerRevision !== compilerRevision) reason = 'COMPILER_REVISION_CHANGED';
      if (reason) {
        row.state = 'STALE';
        this.staleReasons.set(row.id, {
          kind: 'LoreRepresentationStaleReason',
          reason,
          sourceRevisionId: row.sourceRevisionId,
          currentSourceRevisionId: source?.id || null,
          policyRevision: row.generation.policyRevision,
          compilerRevision: row.generation.compilerRevision,
        });
        changed.push(row.id);
      }
    }
    return changed.sort();
  }

  refreshFreshness(sourceRegistry, {policyRevision = null, compilerRevision = null} = {}) {
    const changed = [];
    for (const row of this.representations.values()) {
      if (row.state !== 'CURRENT') continue;
      const source = sourceRegistry.currentRevision(row.sourceId, {allowMissing: true});
      let reason = null;
      if (!source || source.state === 'REMOVED') reason = 'SOURCE_REMOVED';
      else if (source.id !== row.sourceRevisionId) reason = 'SOURCE_REVISION_CHANGED';
      else if (policyRevision && row.generation.policyRevision !== policyRevision) reason = 'POLICY_REVISION_CHANGED';
      else if (compilerRevision && row.generation.compilerRevision !== compilerRevision) reason = 'COMPILER_REVISION_CHANGED';
      if (reason) {
        row.state = 'STALE';
        this.staleReasons.set(row.id, {
          kind: 'LoreRepresentationStaleReason',
          reason,
          sourceRevisionId: row.sourceRevisionId,
          currentSourceRevisionId: source?.id || null,
          policyRevision: row.generation.policyRevision,
          compilerRevision: row.generation.compilerRevision,
        });
        changed.push(row.id);
      }
    }
    return changed.sort();
  }

  staleReason(id) {
    const row = this.staleReasons.get(id);
    return row ? deepClone(row) : null;
  }

  activeForSource(sourceId, sourceRegistry) {
    return [...this.representations.values()]
      .filter((row) => row.sourceId === sourceId && row.state === 'CURRENT')
      .filter((row) => {
        const source = sourceRegistry.currentRevision(sourceId, {allowMissing: true});
        return source && source.state !== 'REMOVED' && row.sourceRevisionId === source.id;
      })
      .map(deepClone)
      .sort((a, b) => a.profile.localeCompare(b.profile) || (a.capCharacters || 0) - (b.capCharacters || 0));
  }

  selectionSurface({sourceId, sourceRegistry, desiredProfile = null, availableBudget = null, precisionNeed = 'NORMAL'}) {
    const source = sourceRegistry.currentRevision(sourceId, {allowMissing: true});
    if (!source || source.state === 'REMOVED') return {
      kind: 'LoreRepresentationSelectionSurface',
      sourceId,
      sourceRevisionId: source?.id || null,
      desiredProfile,
      availableBudget,
      precisionNeed,
      available: [],
      requestedMatch: null,
      fallbackRepresentationRefs: [],
      sourceDrillbackAvailable: false,
      chooserAuthority: false,
    };
    const active = this.activeForSource(sourceId, sourceRegistry);
    const withinBudget = active.filter((row) => availableBudget == null || row.size.characters <= availableBudget);
    const requested = desiredProfile
      ? withinBudget.filter((row) => row.profile === desiredProfile).sort((a, b) => (a.capCharacters || 0) - (b.capCharacters || 0))[0] || null
      : null;
    const drillbackOrder = [RepresentationProfile.LEAN, RepresentationProfile.BALANCED, RepresentationProfile.HEAVY, RepresentationProfile.CUSTOM_CAP];
    const fallbacks = active
      .filter((row) => !requested || row.id !== requested.id)
      .sort((a, b) => drillbackOrder.indexOf(a.profile) - drillbackOrder.indexOf(b.profile) || a.size.characters - b.size.characters)
      .map((row) => row.id);
    fallbacks.push('source:' + source.id);
    return {
      kind: 'LoreRepresentationSelectionSurface',
      sourceId,
      sourceRevisionId: source.id,
      desiredProfile,
      availableBudget,
      precisionNeed,
      available: active.map((row) => ({
        representationRef: row.id,
        profile: row.profile,
        size: deepClone(row.size),
        sourceRevisionId: row.sourceRevisionId,
        qualityStatus: row.retentionReceipt.status,
        representationRevision: row.representationRevision,
        capCharacters: row.capCharacters,
      })),
      requestedMatch: requested ? {
        representationRef: requested.id,
        profile: requested.profile,
        size: deepClone(requested.size),
        sourceRevisionId: requested.sourceRevisionId,
        qualityStatus: requested.retentionReceipt.status,
      } : null,
      fallbackRepresentationRefs: fallbacks,
      sourceDrillbackAvailable: true,
      chooserAuthority: false,
    };
  }

  uiReadModel({sourceId, sourceRegistry}) {
    const source = sourceRegistry.getEntry(sourceId);
    const revision = sourceRegistry.currentRevision(sourceId, {allowMissing: true});
    const active = revision && revision.state !== 'REMOVED' ? this.activeForSource(sourceId, sourceRegistry) : [];
    return {
      kind: 'LoreRepresentationReadModel',
      sourceId,
      title: revision?.metadata?.title || source?.uid || sourceId,
      sourceRevisionId: revision?.id || null,
      sourceState: revision?.state || 'MISSING',
      availableProfiles: active.map((row) => ({
        representationRef: row.id,
        profile: row.profile,
        capCharacters: row.capCharacters,
        size: deepClone(row.size),
        qualityState: row.retentionReceipt.status,
        compressionRatio: row.retentionReceipt.compressionRatio,
        state: row.state,
        representationRevision: row.representationRevision,
        provenanceSummary: {
          sourceId: row.sourceId,
          sourceRevisionId: row.sourceRevisionId,
          dependencyCount: row.dependencyArtifactIds.length,
        },
        capStatus: deepClone(row.hardCap),
      })),
      sourceDrillbackAvailable: Boolean(revision && revision.state !== 'REMOVED'),
      mutationAuthority: false,
      contextSelectionAuthority: false,
    };
  }

  impactPreview({sourceId, sourceRegistry}) {
    const source = sourceRegistry.currentRevision(sourceId, {allowMissing: true});
    const rows = [...this.representations.values()].filter((row) => row.sourceId === sourceId && row.state === 'CURRENT');
    const stale = rows.filter((row) => !source || source.state === 'REMOVED' || row.sourceRevisionId !== source.id);
    return {
      kind: 'LoreRepresentationImpactPreview',
      sourceId,
      currentSourceRevisionId: source?.id || null,
      dependentRepresentationIds: rows.map((row) => row.id).sort(),
      wouldBecomeStale: stale.map((row) => row.id).sort(),
      unaffectedRepresentationIds: [],
      advisory: true,
      mutationAuthority: false,
    };
  }

  snapshot() {
    return {
      kind: 'LoreRepresentationRegistrySnapshot',
      representations: [...this.representations.values()].map(deepClone),
      historyByFamily: [...this.historyByFamily.entries()].map(([key, ids]) => [key, [...ids]]),
      currentByFamily: [...this.currentByFamily.entries()],
      byReuseKey: [...this.byReuseKey.entries()],
      staleReasons: [...this.staleReasons.entries()].map(([id, reason]) => [id, deepClone(reason)]),
    };
  }

  restore(snapshot) {
    this.representations = new Map((snapshot.representations || []).map((row) => [row.id, deepClone(row)]));
    this.historyByFamily = new Map((snapshot.historyByFamily || []).map(([key, ids]) => [key, [...ids]]));
    this.currentByFamily = new Map(snapshot.currentByFamily || []);
    this.byReuseKey = new Map(snapshot.byReuseKey || []);
    this.staleReasons = new Map((snapshot.staleReasons || []).map(([id, reason]) => [id, deepClone(reason)]));
  }
}
