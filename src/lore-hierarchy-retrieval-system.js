import {deepClone} from './lore-contracts.js';
import {deriveLoreNavigationHierarchy, hierarchyScopeMap} from './lore-navigation-hierarchy.js';
import {LoreNavigationSummaryRegistry} from './lore-navigation-summary-registry.js';
import {
  DeterministicNavigationSummaryProvider,
  LoreNavigationSummaryBuilder,
} from './lore-navigation-summary-builder.js';
import {LoreContextualRetrievalIndex} from './lore-contextual-retrieval.js';

export class LoreHierarchyRetrievalSystem {
  constructor({
    runtime,
    summaryRegistry = new LoreNavigationSummaryRegistry(),
    summaryProvider = new DeterministicNavigationSummaryProvider(),
    retrievalIndex = new LoreContextualRetrievalIndex(),
    snapshot = null,
  } = {}) {
    if (!runtime) throw new TypeError('LoreHierarchyRetrievalSystem requires LoreStudyRuntime');
    this.runtime = runtime;
    this.summaryRegistry = summaryRegistry;
    this.retrievalIndex = retrievalIndex;
    this.hierarchy = null;
    this.builder = new LoreNavigationSummaryBuilder({
      runtime,
      registry: summaryRegistry,
      provider: summaryProvider,
    });
    if (snapshot) this.restore(snapshot, {summaryProvider});
  }

  refreshHierarchy() {
    const hierarchy = deriveLoreNavigationHierarchy(this.runtime);
    this.summaryRegistry.syncHierarchy({hierarchy, runtime: this.runtime});
    this.hierarchy = hierarchy;
    return deepClone(hierarchy);
  }

  beginBuild() {
    if (!this.hierarchy) this.refreshHierarchy();
    return this.builder.start(this.hierarchy);
  }

  runBuild(sessionId, options = {}) {
    return this.builder.run(sessionId, options);
  }

  buildAll(options = {}) {
    if (!this.hierarchy) this.refreshHierarchy();
    const result = this.builder.buildAll(this.hierarchy, options);
    this.retrievalIndex.build({runtime: this.runtime, hierarchy: this.hierarchy, summaryRegistry: this.summaryRegistry});
    return result;
  }

  rebuild({maxUnits} = {}) {
    this.refreshHierarchy();
    return this.buildAll({maxUnits});
  }

  refreshRetrieval() {
    if (!this.hierarchy) this.refreshHierarchy();
    return this.retrievalIndex.build({runtime: this.runtime, hierarchy: this.hierarchy, summaryRegistry: this.summaryRegistry});
  }

  rebuildAffected({sourceIds = [], maxScopes = 128} = {}) {
    const wanted = new Set((sourceIds || []).filter(Boolean).map(String));
    if (!wanted.size) {
      throw Object.assign(new TypeError('Targeted navigation rebuild requires sourceIds'), {
        code: 'LORE_NAV_TARGET_SOURCE_REQUIRED',
      });
    }
    const before = new Map(this.summaryRegistry.activeSummaries().map((row) => [row.targetScopeId, row.id]));
    const preexistingStaleScopeIds = new Set([...this.summaryRegistry.summaries.values()]
      .filter((row) => row?.freshness === 'STALE' && row?.targetScopeId)
      .map((row) => row.targetScopeId));
    const previousScopes = this.hierarchy ? hierarchyScopeMap(this.hierarchy) : new Map();
    const previousAffectedScopeIds = new Set([...previousScopes.values()]
      .filter((scope) => (scope.sourceIds || []).some((sourceId) => wanted.has(String(sourceId))))
      .map((scope) => scope.id));
    this.refreshHierarchy();
    const scopes = hierarchyScopeMap(this.hierarchy);
    const affectedSetFromSource = new Set([...scopes.values()]
      .filter((scope) => (scope.sourceIds || []).some((sourceId) => wanted.has(String(sourceId))))
      .map((scope) => scope.id));
    for (const scopeId of previousAffectedScopeIds) {
      if (scopes.has(scopeId)) affectedSetFromSource.add(scopeId);
    }
    for (const scopeId of preexistingStaleScopeIds) {
      if (scopes.has(scopeId)) affectedSetFromSource.add(scopeId);
    }
    const affected = [...affectedSetFromSource].sort();
    const limit = Math.max(1, Math.min(1024, Number(maxScopes) || 128));
    if (affected.length > limit) {
      throw Object.assign(new Error('Targeted navigation rebuild scope limit exceeded'), {
        code: 'LORE_NAV_TARGET_SCOPE_LIMIT_EXCEEDED',
        details: {affectedScopes: affected.length, maxScopes: limit},
      });
    }

    const affectedSet = new Set(affected);
    const visited = new Set();
    const plan = [];
    const visit = (scopeId) => {
      if (visited.has(scopeId) || !affectedSet.has(scopeId)) return;
      visited.add(scopeId);
      const scope = scopes.get(scopeId);
      if (!scope) return;
      for (const childId of [...(scope.childScopeIds || [])].sort()) visit(childId);
      plan.push(scopeId);
    };
    for (const scopeId of affected) visit(scopeId);

    const results = [];
    for (const scopeId of plan) {
      const scope = scopes.get(scopeId);
      const result = this.builder.buildScope(scope);
      this.builder.scopeStates.set(scopeId, {
        state: result.state,
        reason: result.reason || null,
        summaryId: result.summary?.id || null,
      });
      results.push({
        scopeId,
        scopeType: scope.type,
        state: result.state,
        reason: result.reason || null,
        summaryId: result.summary?.id || null,
      });
    }
    const retrieval = this.refreshRetrieval();
    const after = new Map(this.summaryRegistry.activeSummaries().map((row) => [row.targetScopeId, row.id]));
    const untouchedScopeIds = [...scopes.keys()]
      .filter((scopeId) => !affectedSet.has(scopeId))
      .filter((scopeId) => before.get(scopeId) && before.get(scopeId) === after.get(scopeId))
      .sort();
    const changedSummaryIds = results
      .filter((row) => row.summaryId && before.get(row.scopeId) !== row.summaryId)
      .map((row) => row.summaryId);
    return {
      kind: 'LoreTargetedNavigationRebuildReceipt',
      contractVersion: 1,
      sourceIds: [...wanted].sort(),
      hierarchyRevision: this.hierarchy?.hierarchyRevision || null,
      affectedScopeIds: affected,
      previousAffectedScopeIds: [...previousAffectedScopeIds].sort(),
      preexistingStaleScopeIds: [...preexistingStaleScopeIds].filter((scopeId) => scopes.has(scopeId)).sort(),
      executionPlan: plan,
      results,
      builtScopeIds: results.filter((row) => row.state === 'BUILT').map((row) => row.scopeId),
      reusedScopeIds: results.filter((row) => row.state === 'REUSED').map((row) => row.scopeId),
      blockedScopeIds: results.filter((row) => row.state === 'BLOCKED' || row.state === 'INVALID').map((row) => row.scopeId),
      changedSummaryIds,
      untouchedScopeIds,
      unrelatedScopeCount: untouchedScopeIds.length,
      retrievalRevision: retrieval?.revision || this.retrievalIndex.status().revision,
      fullRebuildPerformed: false,
      exactSourceMutationPerformed: false,
      treeMutationPerformed: false,
      settlementAuthority: false,
    };
  }

  query(request) {
    return this.retrievalIndex.query(request);
  }

  drillDown(nomination) {
    return this.retrievalIndex.drillDown(nomination);
  }

  scope(scopeId) {
    return hierarchyScopeMap(this.hierarchy).get(scopeId) || null;
  }

  currentSummary(scopeId) {
    return this.summaryRegistry.current(scopeId);
  }

  diagnostics() {
    return {
      kind: 'LoreHierarchyRetrievalDiagnostics',
      hierarchyRevision: this.hierarchy?.hierarchyRevision || null,
      hierarchyScopes: this.hierarchy?.scopes.length || 0,
      includedSources: this.hierarchy?.includedSourceIds.length || 0,
      excludedSources: this.hierarchy?.excludedSourceCount || 0,
      build: this.builder.status(this.hierarchy),
      summaries: this.summaryRegistry.status(),
      retrieval: this.retrievalIndex.status(),
      sourceDrillbackAvailable: true,
      authorityGranted: false,
      candidateBusAdmissionAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    };
  }

  snapshot() {
    return {
      kind: 'LoreHierarchyRetrievalSystemSnapshot',
      hierarchy: deepClone(this.hierarchy),
      summaryRegistry: this.summaryRegistry.snapshot(),
      builder: this.builder.snapshot(),
      retrievalIndex: this.retrievalIndex.snapshot(),
    };
  }

  restore(snapshot, {summaryProvider = null} = {}) {
    this.hierarchy = deepClone(snapshot?.hierarchy || null);
    this.summaryRegistry.restore(snapshot?.summaryRegistry || null);
    this.retrievalIndex.restore(snapshot?.retrievalIndex || null);
    this.builder = new LoreNavigationSummaryBuilder({
      runtime: this.runtime,
      registry: this.summaryRegistry,
      provider: summaryProvider || new DeterministicNavigationSummaryProvider(),
      snapshot: snapshot?.builder || null,
    });
  }

  static fromSnapshot({runtime, snapshot, summaryProvider = null}) {
    return new LoreHierarchyRetrievalSystem({runtime, snapshot, summaryProvider});
  }
}
