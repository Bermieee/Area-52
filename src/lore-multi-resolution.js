import {deepClone} from './lore-contracts.js';
import {RepresentationProfile, createProfilePolicy} from './lore-representation-contracts.js';
import {LoreRepresentationCompiler} from './lore-representation-compiler.js';
import {LoreRepresentationRegistry} from './lore-representation-registry.js';

export class LoreMultiResolutionSystem {
  constructor({runtime, registry = new LoreRepresentationRegistry(), provider = null, compilerRevision = null, policyOverrides = {}} = {}) {
    if (!runtime) throw new TypeError('LoreMultiResolutionSystem requires a LoreStudyRuntime');
    this.runtime = runtime;
    this.registry = registry;
    const options = {runtime, representationRegistry: registry, policyOverrides};
    if (provider) options.provider = provider;
    if (compilerRevision) options.compilerRevision = compilerRevision;
    this.compiler = new LoreRepresentationCompiler(options);
  }

  compile(request) {
    this.registry.refreshFreshness(this.runtime.registry);
    return this.compiler.compile(request);
  }

  compileFamily(request) {
    this.registry.refreshFreshness(this.runtime.registry);
    return this.compiler.compileFamily(request);
  }

  representationHistory(request) {
    return this.registry.history(request);
  }

  selection(request) {
    return this.registry.selectionSurface({...request, sourceRegistry: this.runtime.registry});
  }

  readModel(sourceId) {
    return this.registry.uiReadModel({sourceId, sourceRegistry: this.runtime.registry});
  }

  refreshFreshness({policyRevision = null, compilerRevision = null} = {}) {
    return this.registry.refreshFreshness(this.runtime.registry, {policyRevision, compilerRevision});
  }

  compareSemanticRetention(beforeSignature, sourceId) {
    const after = this.compiler.semanticRetentionSignature(sourceId);
    const before = new Set(beforeSignature.semanticIds || []);
    const now = new Set(after.semanticIds || []);
    return {
      kind: 'LoreRepresentationSemanticImpact',
      sourceId,
      fromSourceRevisionId: beforeSignature.sourceRevisionId,
      toSourceRevisionId: after.sourceRevisionId,
      wordingOnlyEquivalent: beforeSignature.contributionFingerprint === after.contributionFingerprint,
      addedContributionSemanticIds: [...now].filter((id) => !before.has(id)).sort(),
      removedContributionSemanticIds: [...before].filter((id) => !now.has(id)).sort(),
      representationRegenerationRequired: beforeSignature.sourceRevisionId !== after.sourceRevisionId,
      sourceRevisionChanged: beforeSignature.sourceRevisionId !== after.sourceRevisionId,
      provenanceReason: 'Representations remain keyed to exact source revision even when semantic content is equivalent.',
    };
  }

  withPolicyOverride({profile, revision, classes, baseProfile = null}) {
    const policy = createProfilePolicy({profile, revision, classes, baseProfile});
    this.compiler.policyOverrides[profile] = deepClone(policy);
    this.registry.refreshPolicyFreshness(this.runtime.registry, {
      profile,
      policyRevision: policy.revision,
      compilerRevision: this.compiler.compilerRevision,
    });
    return deepClone(policy);
  }

  snapshot() {
    return {
      kind: 'LoreMultiResolutionSystemSnapshot',
      representationRegistry: this.registry.snapshot(),
      compilerRevision: this.compiler.compilerRevision,
      policyOverrides: deepClone(this.compiler.policyOverrides),
    };
  }

  static profiles() {
    return Object.values(RepresentationProfile);
  }
}
