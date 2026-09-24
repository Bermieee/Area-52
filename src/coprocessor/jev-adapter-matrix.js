import { deepFreeze } from './contracts.js';
import { JevDecisionCore } from './jev-decision-core.js';
import { JevDomainAdapterRegistry, JevDomainAdapterService } from './jev-domain-adapter.js';
import { createLoreJevAdapter } from './jev-lore-adapter.js';
import { createSceneJevAdapter } from './jev-scene-adapter.js';
import { createRetrievalTruthJevAdapter } from './jev-retrieval-truth-adapter.js';

export function createDefaultJevDomainAdapterRegistry() {
  return new JevDomainAdapterRegistry()
    .register(createLoreJevAdapter())
    .register(createSceneJevAdapter())
    .register(createRetrievalTruthJevAdapter());
}

export function createJevDomainAdapterMatrix({ core = null, providerExecutor = null } = {}) {
  const decisionCore = core ?? new JevDecisionCore({ providerExecutor });
  const registry = createDefaultJevDomainAdapterRegistry();
  const service = new JevDomainAdapterService({ registry, core: decisionCore });
  return deepFreeze({ kind: 'JevDomainAdapterMatrix', registry, core: decisionCore, service });
}

export const JEV_WAVE9_CORPUS = deepFreeze([
  { fixtureId: 'W9-DETERMINISTIC-LORE', domain: 'LORE', class: 'DETERMINISTIC_SKIP' },
  { fixtureId: 'W9-AMBIGUOUS-LORE', domain: 'LORE', class: 'AMBIGUOUS' },
  { fixtureId: 'W9-UNRESOLVED-SUN-BLADE', domain: 'LORE', class: 'UNRESOLVED_CONTRADICTION' },
  { fixtureId: 'W9-SCENE-BOUNDARY', domain: 'SCENE', class: 'BOUNDARY_AMBIGUITY' },
  { fixtureId: 'W9-STALE-SCENE', domain: 'SCENE', class: 'STALE_REVISION' },
  { fixtureId: 'W9-RETRIEVAL-AMBIGUITY', domain: 'RETRIEVAL_TRUTH', class: 'AMBIGUOUS' },
  { fixtureId: 'W9-LOW-QUALITY-ABSTAIN', domain: 'RETRIEVAL_TRUTH', class: 'ABSTAIN' },
  { fixtureId: 'W9-STALE-RETRIEVAL', domain: 'RETRIEVAL_TRUTH', class: 'STALE_REVISION' },
  { fixtureId: 'W9-PROVIDER-FAILURE', domain: 'CROSS_DOMAIN', class: 'PROVIDER_FAILURE' },
]);