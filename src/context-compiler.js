import { KnowledgeStatus, createCompiledContextPacket } from './contracts.js';

export class ContextCompiler {
  constructor({ graph }) { this.graph = graph; }

  compile({ query, intent, truthResults }) {
    const current = [];
    const historical = [];
    const unresolved = [];
    const provenanceIndex = {};
    const dependencies = new Set();
    const seen = new Set();

    for (const result of truthResults) {
      if (!result.usableForIntent) continue;
      for (const claimId of result.claimIds) {
        if (seen.has(claimId)) continue;
        seen.add(claimId);
        const claim = this.graph.getClaim(claimId);
        if (!claim) continue;
        const fact = { e:claim.subjectId, p:claim.predicate, v:claim.value, a:claim.authorityClass, cf:claim.confidence, id:claim.id };
        if (result.classification === KnowledgeStatus.CURRENT) current.push(fact);
        else if ([KnowledgeStatus.HISTORICAL, KnowledgeStatus.SUPERSEDED].includes(result.classification)) historical.push(fact);
        else unresolved.push(fact);
        const refs = [...new Set(claim.provenance?.sourceRevisionIds ?? [])].sort();
        provenanceIndex[claim.id] = refs;
        for (const ref of refs) dependencies.add(ref);
      }
    }

    const sortFacts = (a,b) => a.e.localeCompare(b.e) || a.p.localeCompare(b.p) || String(a.v).localeCompare(String(b.v));
    current.sort(sortFacts); historical.sort(sortFacts); unresolved.sort(sortFacts);
    return createCompiledContextPacket({
      id:`packet:${intent.toLowerCase()}:${[...seen].sort().join('|') || 'empty'}`, query, intent, current, historical, unresolved, provenanceIndex, dependencies:[...dependencies].sort(),
    });
  }
}
