import {deepClone} from './lore-contracts.js';
import {LoreNavigationEvidenceRegistry} from './lore-navigation-evidence-registry.js';
import {
  NavigationSummaryState,
  summaryReuseKey,
} from './lore-navigation-contracts.js';

export class LoreNavigationSummaryRegistry {
  constructor(snapshot = null) {
    this.evidenceRegistry = new LoreNavigationEvidenceRegistry();
    this.summaries = new Map();
    this.historyByScope = new Map();
    this.currentByScope = new Map();
    this.byReuseKey = new Map();
    this.staleReasons = new Map();
    if (snapshot) this.restore(snapshot);
  }

  registerEvidence(rows = []) {
    return this.evidenceRegistry.registerMany(rows);
  }

  resolveEvidenceRefs(refs = [], {limit = 4096} = {}) {
    return this.evidenceRegistry.resolveAll(refs, {limit});
  }

  readEvidenceRefs(refs = [], {offset = 0, limit = 64} = {}) {
    return this.evidenceRegistry.resolveMany(refs, {offset, limit});
  }

  evidenceForSummary(summaryOrId, {offset = 0, limit = 64} = {}) {
    const summary = typeof summaryOrId === 'string' ? this.get(summaryOrId) : deepClone(summaryOrId);
    if (!summary) {
      return {
        kind: 'LoreNavigationSummaryEvidenceDrillback',
        status: 'NOT_FOUND',
        summaryId: typeof summaryOrId === 'string' ? summaryOrId : null,
        evidence: [],
        missingEvidenceRefs: [],
        totalRefs: 0,
        offset: 0,
        limit,
        hasMore: false,
        authorityGranted: false,
        sourceAuthority: false,
        truthAuthority: false,
      };
    }
    const resolved = this.readEvidenceRefs(summary.criticalEvidenceRefs || [], {offset, limit});
    return {
      ...resolved,
      kind: 'LoreNavigationSummaryEvidenceDrillback',
      summaryId: summary.id,
      summaryRevision: summary.summaryRevision,
      targetScopeId: summary.targetScopeId,
      sourceRevisionRefs: [...summary.sourceRevisionSet],
      summaryState: summary.state,
      summaryFreshness: summary.freshness,
    };
  }

  nextRevision(scopeId) {
    return (this.historyByScope.get(scopeId) || []).length + 1;
  }

  findReusable({scope, sourceRevisionSet, childSummaryDependencies, generatorRevision}) {
    const reuseKey = summaryReuseKey({scope, sourceRevisionSet, childSummaryDependencies, generatorRevision});
    const id = this.byReuseKey.get(reuseKey);
    if (!id) return null;
    const row = this.summaries.get(id);
    if (!row || ![NavigationSummaryState.BUILT, NavigationSummaryState.REUSED].includes(row.state) || row.freshness !== 'FRESH') return null;
    row.state = NavigationSummaryState.REUSED;
    return deepClone(row);
  }

  publish({summary, scope}) {
    const evidenceResolution = this.resolveEvidenceRefs(summary?.criticalEvidenceRefs || []);
    if (evidenceResolution.status === 'LIMIT_EXCEEDED') {
      const error = new Error('Navigation summary evidence reference limit exceeded');
      error.code = 'EVIDENCE_REF_LIMIT';
      throw error;
    }
    if (evidenceResolution.status === 'DEGRADED') {
      const error = new Error('Navigation summary references missing evidence: ' + evidenceResolution.missingEvidenceRefs.join(','));
      error.code = 'EVIDENCE_REF_MISSING';
      error.missingEvidenceRefs = [...evidenceResolution.missingEvidenceRefs];
      throw error;
    }
    const reuseKey = summaryReuseKey({
      scope,
      sourceRevisionSet: summary.sourceRevisionSet,
      childSummaryDependencies: summary.childSummaryDependencies,
      generatorRevision: summary.generatorRevision,
    });
    const existingId = this.byReuseKey.get(reuseKey);
    if (existingId) {
      const existing = this.summaries.get(existingId);
      if (existing?.state === NavigationSummaryState.BUILT || existing?.state === NavigationSummaryState.REUSED) {
        existing.state = NavigationSummaryState.REUSED;
        return deepClone(existing);
      }
    }
    const priorId = this.currentByScope.get(scope.id);
    if (priorId && this.summaries.has(priorId)) {
      const prior = this.summaries.get(priorId);
      prior.state = NavigationSummaryState.HISTORICAL;
      prior.freshness = 'STALE';
      prior.replacedBySummaryId = summary.id;
      const oldReason = this.staleReasons.get(prior.id);
      if (oldReason) oldReason.replacedBySummaryId = summary.id;
      else this.staleReasons.set(prior.id, {reason: 'SUMMARY_REPLACED', replacedBySummaryId: summary.id});
    }
    const stored = deepClone(summary);
    stored.state = NavigationSummaryState.BUILT;
    stored.freshness = 'FRESH';
    stored.replacedBySummaryId = null;
    this.summaries.set(stored.id, stored);
    this.byReuseKey.set(reuseKey, stored.id);
    this.currentByScope.set(scope.id, stored.id);
    const history = this.historyByScope.get(scope.id) || [];
    this.historyByScope.set(scope.id, [...history, stored.id]);
    return deepClone(stored);
  }

  current(scopeId) {
    const id = this.currentByScope.get(scopeId);
    const row = id ? this.summaries.get(id) : null;
    if (!row || ![NavigationSummaryState.BUILT, NavigationSummaryState.REUSED].includes(row.state) || row.freshness !== 'FRESH') return null;
    return deepClone(row);
  }

  get(id) {
    const row = this.summaries.get(id);
    return row ? deepClone(row) : null;
  }

  history(scopeId) {
    return (this.historyByScope.get(scopeId) || []).map((id) => this.get(id));
  }

  staleReason(summaryId) {
    const row = this.staleReasons.get(summaryId);
    return row ? deepClone(row) : null;
  }

  markScopeStale(scopeId, reason, details = {}) {
    const id = this.currentByScope.get(scopeId);
    if (!id) return null;
    const row = this.summaries.get(id);
    if (!row || ![NavigationSummaryState.BUILT, NavigationSummaryState.REUSED].includes(row.state)) return null;
    row.state = NavigationSummaryState.STALE;
    row.freshness = 'STALE';
    this.staleReasons.set(row.id, {reason, ...deepClone(details)});
    return row.id;
  }

  syncHierarchy({hierarchy, runtime}) {
    const scopes = new Map(hierarchy.scopes.map((scope) => [scope.id, scope]));
    const changed = [];
    for (const [scopeId, summaryId] of this.currentByScope.entries()) {
      const summary = this.summaries.get(summaryId);
      if (!summary || ![NavigationSummaryState.BUILT, NavigationSummaryState.REUSED].includes(summary.state)) continue;
      const scope = scopes.get(scopeId);
      let reason = null;
      if (!scope) reason = 'SCOPE_REMOVED_OR_REORGANIZED';
      else if (summary.structureRevision !== scope.structureRevision) reason = 'STRUCTURE_REVISION_CHANGED';
      else {
        const sourceRevisionSet = [];
        let sourceStale = false;
        for (const sourceId of scope.sourceIds) {
          const revision = runtime.registry.currentRevision(sourceId, {allowMissing: true});
          const learned = runtime.store.currentLearnedRevision(sourceId);
          if (!revision || revision.state === 'REMOVED' || !learned || learned.state !== 'CURRENT' || learned.sourceRevisionId !== revision.id) {
            sourceStale = true;
            break;
          }
          sourceRevisionSet.push(revision.id);
        }
        sourceRevisionSet.sort();
        if (sourceStale) reason = 'SOURCE_UNSTUDIED_OR_REMOVED';
        else if (JSON.stringify(sourceRevisionSet) !== JSON.stringify([...summary.sourceRevisionSet].sort())) reason = 'SOURCE_REVISION_SET_CHANGED';
      }
      if (reason) {
        const staleId = this.markScopeStale(scopeId, reason, {
          hierarchyRevision: hierarchy.hierarchyRevision,
          currentStructureRevision: scope?.structureRevision || null,
        });
        if (staleId) changed.push(staleId);
      }
    }
    return changed.sort();
  }

  activeSummaries() {
    return [...this.summaries.values()]
      .filter((row) => [NavigationSummaryState.BUILT, NavigationSummaryState.REUSED].includes(row.state) && row.freshness === 'FRESH')
      .map(deepClone)
      .sort((a, b) => a.targetScopeId.localeCompare(b.targetScopeId));
  }

  status() {
    const counts = {};
    for (const state of Object.values(NavigationSummaryState)) counts[state] = 0;
    for (const row of this.summaries.values()) counts[row.state] = (counts[row.state] || 0) + 1;
    return {kind: 'LoreNavigationSummaryStatus', counts, evidence: this.evidenceRegistry.status()};
  }

  snapshot() {
    return {
      kind: 'LoreNavigationSummaryRegistrySnapshot',
      contractVersion: 2,
      evidenceRegistry: this.evidenceRegistry.snapshot(),
      summaries: [...this.summaries.values()].map(deepClone),
      historyByScope: [...this.historyByScope.entries()].map(([id, rows]) => [id, [...rows]]),
      currentByScope: [...this.currentByScope.entries()],
      byReuseKey: [...this.byReuseKey.entries()],
      staleReasons: [...this.staleReasons.entries()].map(([id, reason]) => [id, deepClone(reason)]),
    };
  }

  restore(snapshot) {
    this.evidenceRegistry = new LoreNavigationEvidenceRegistry(snapshot?.evidenceRegistry || null);
    const rows = (snapshot?.summaries || []).map((row) => {
      const migrated = deepClone(row);
      const legacyEvidence = Array.isArray(migrated.criticalEvidence) ? migrated.criticalEvidence : [];
      const legacyRefs = legacyEvidence.length ? this.registerEvidence(legacyEvidence) : [];
      migrated.criticalEvidenceRefs = [...new Set([
        ...(migrated.criticalEvidenceRefs || []),
        ...legacyRefs,
      ].filter(Boolean).map(String))];
      migrated.criticalEvidenceCount = migrated.criticalEvidenceRefs.length;
      delete migrated.criticalEvidence;
      return migrated;
    });
    this.summaries = new Map(rows.map((row) => [row.id, row]));
    this.historyByScope = new Map((snapshot?.historyByScope || []).map(([id, values]) => [id, [...values]]));
    this.currentByScope = new Map(snapshot?.currentByScope || []);
    this.byReuseKey = new Map(snapshot?.byReuseKey || []);
    this.staleReasons = new Map((snapshot?.staleReasons || []).map(([id, reason]) => [id, deepClone(reason)]));
  }
}
