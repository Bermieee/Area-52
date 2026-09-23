import { SourceRegistry } from './source-registry.js';
import { LoreStudyEngine } from './lore-study.js';
import { TemporalStateGraph } from './temporal-state-graph.js';
import { MinimalRetrieval } from './retrieval.js';
import { TruthGate } from './truth-gate.js';
import { ContextCompiler } from './context-compiler.js';

export class Area52CognitiveCore {
  constructor() {
    this.registry = new SourceRegistry();
    this.study = new LoreStudyEngine({ registry:this.registry });
    this.graph = new TemporalStateGraph();
    this.retrieval = new MinimalRetrieval({ graph:this.graph });
    this.truthGate = new TruthGate({ graph:this.graph });
    this.compiler = new ContextCompiler({ graph:this.graph });
    this.studyResults = new Map();
  }

  importAndLearn({ id, sourceType, content, at = 0 }) {
    this.registry.importSource({ id, sourceType, content, metadata:{at} });
    return this.learnSource(id);
  }

  learnSource(sourceId) {
    const result = this.study.studySource(sourceId);
    const receipts = [];
    for (const proposal of result.proposals) {
      const receipt = this.graph.settleProposal(proposal, this.registry);
      receipts.push(receipt);
      if (receipt.outcome === 'SETTLED') {
        for (const claimId of receipt.settledArtifactIds) {
          this.registry.registerDerivedArtifact({ artifactId:`world:${claimId}`, artifact:{kind:'SettledWorldClaim',claimId}, dependsOnArtifactIds:[claimId], activity:'SETTLE', agent:'temporal-state-graph' });
        }
      }
    }
    this.studyResults.set(result.revision.id, result);
    return { result, receipts };
  }

  editAndRelearn(sourceId, content) {
    const oldRevision = this.registry.getActiveRevision(sourceId);
    const replacement = this.registry.replaceSource(sourceId, content);
    if (!replacement.changed) return { replacement, relearned:null, invalidatedGraphClaimIds:[] };
    const invalidatedGraphClaimIds = this.graph.invalidateClaimsBySourceRevision(oldRevision.id);
    const relearned = this.learnSource(sourceId);
    return { replacement, relearned, invalidatedGraphClaimIds };
  }

  query(query, { intent = 'CURRENT', anchorEntityIds = [] } = {}) {
    const candidates = this.retrieval.retrieve(query, { intent, anchorEntityIds });
    const truth = this.truthGate.classifyAll(candidates, { intent });
    const packet = this.compiler.compile({ query, intent, truthResults:truth });
    return { candidates, truth, packet };
  }
}
