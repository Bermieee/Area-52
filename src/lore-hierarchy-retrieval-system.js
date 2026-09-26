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

  snapshot({compact = false} = {}) {
    return {
      kind: 'LoreHierarchyRetrievalSystemSnapshot',
      hierarchy: deepClone(this.hierarchy),
      summaryRegistry: this.summaryRegistry.snapshot(),
      builder: this.builder.snapshot({includeCompletedSessions: !compact}),
      retrievalIndex: this.retrievalIndex.snapshot({includeRecords: !compact}),
      compactDerivedState: Boolean(compact),
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
    if (
      this.hierarchy
      && (snapshot?.compactDerivedState === true || snapshot?.retrievalIndex?.recordsIncluded === false)
    ) {
      this.retrievalIndex.build({
        runtime: this.runtime,
        hierarchy: this.hierarchy,
        summaryRegistry: this.summaryRegistry,
      });
    }
  }

  static fromSnapshot({runtime, snapshot, summaryProvider = null}) {
    return new LoreHierarchyRetrievalSystem({runtime, snapshot, summaryProvider});
  }
}
