import { KnowledgeStatus, createCandidateBusResult } from './contracts.js';

const TOKENS = /[a-z0-9]+/g;
const tokenize = (text) => new Set((String(text).toLowerCase().match(TOKENS) ?? []).filter((x) => !['the','a','an','is','by','at','in','can','did','what','where','before'].includes(x)));
const SYNONYMS = new Map([['weapon',new Set(['blade','sword'])],['inn',new Set(['tavern'])],['carry',new Set(['carried','location'])],['find',new Set(['location'])]]);

function lexicalScore(queryTokens, claim) {
  const text = tokenize(`${claim.subjectId} ${claim.predicate} ${claim.value}`);
  let score = 0;
  for (const token of queryTokens) if (text.has(token)) score += 1;
  return score;
}

function semanticScore(queryTokens, claim) {
  const text = tokenize(`${claim.subjectId} ${claim.predicate} ${claim.value}`);
  let score = 0;
  for (const token of queryTokens) {
    const expanded = SYNONYMS.get(token);
    if (expanded && [...expanded].some((word) => text.has(word))) score += .75;
  }
  return score;
}

export class MinimalRetrieval {
  constructor({ graph }) { this.graph = graph; }

  exact(query) {
    const q = tokenize(query);
    return this.graph.allClaims().map((claim) => ({ claim, score:lexicalScore(q, claim) })).filter((x) => x.score > 0);
  }

  semantic(query, scorer = null) {
    const q = tokenize(query);
    return this.graph.allClaims().map((claim) => ({ claim, score:scorer ? scorer(query, claim) : semanticScore(q, claim) })).filter((x) => x.score > 0);
  }

  graphNeighborhood(entityIds = []) {
    const out = [];
    for (const entityId of entityIds) for (const claim of this.graph.neighbors(entityId)) out.push({claim, score:1});
    return out;
  }

  retrieve(query, { intent = 'CURRENT', anchorEntityIds = [] } = {}) {
    const channels = [
      ['exact', this.exact(query)],
      ['semantic', this.semantic(query)],
      ['graph', this.graphNeighborhood(anchorEntityIds)],
    ];
    const merged = new Map();
    for (const [channel, rows] of channels) {
      for (const {claim, score} of rows) {
        const existing = merged.get(claim.id) ?? {claim, scoreSignals:{sparse:0,dense:0,graphDistance:null}, intents:new Set()};
        if (channel === 'exact') existing.scoreSignals.sparse = Math.max(existing.scoreSignals.sparse, score);
        if (channel === 'semantic') existing.scoreSignals.dense = Math.max(existing.scoreSignals.dense, score);
        if (channel === 'graph') existing.scoreSignals.graphDistance = 1;
        existing.intents.add(channel);
        merged.set(claim.id, existing);
      }
    }
    return [...merged.values()].map(({claim,scoreSignals,intents}) => createCandidateBusResult({
      candidateId:`candidate:${claim.id}`, sourceType:'CLAIM', sourceId:claim.id, entityIds:[claim.subjectId, ...(typeof claim.value === 'string' ? [claim.value] : [])], claimIds:[claim.id],
      scoreSignals, retrievalIntents:[intent, ...[...intents].sort()], temporalStatus:claim.status ?? KnowledgeStatus.UNRESOLVED, provenance:claim.provenance,
    })).sort((a,b) => {
      const sa=(a.scoreSignals.sparse??0)+(a.scoreSignals.dense??0)+(a.scoreSignals.graphDistance?1:0);
      const sb=(b.scoreSignals.sparse??0)+(b.scoreSignals.dense??0)+(b.scoreSignals.graphDistance?1:0);
      return sb-sa || a.candidateId.localeCompare(b.candidateId);
    });
  }
}
