import {
  ArtifactType,
  AuthorityClass,
  TemporalClass,
  deepClone,
  stableHash,
} from './lore-contracts.js';
import {LORE_WAVE3_LIMITS, NavigationScopeType} from './lore-navigation-contracts.js';

const TOKEN_RE = /[a-z0-9][a-z0-9'-]{1,}/g;
const STOP = new Set(['the','a','an','and','or','of','to','in','on','at','for','with','is','was','were','be','been','about','tell','me','what','who','where','when','how']);

function tokenize(value) {
  return [...new Set((String(value || '').toLowerCase().match(TOKEN_RE) || []).filter((token) => !STOP.has(token)))];
}

function truthStatusForArtifacts(artifacts) {
  if (artifacts.some((row) => row.unresolved || [TemporalClass.UNCERTAIN, TemporalClass.CONFLICTING].includes(row.temporalClass))) return 'UNRESOLVED';
  const temporal = new Set(artifacts.map((row) => row.temporalClass).filter(Boolean));
  if (temporal.size === 1 && temporal.has(TemporalClass.HISTORICAL)) return 'HISTORICAL';
  return 'UNKNOWN';
}

function sourceContext(runtime, sourceId) {
  const source = runtime.registry.getEntry(sourceId);
  const revision = runtime.registry.currentRevision(sourceId, {allowMissing: true});
  const learned = runtime.store.currentLearnedRevision(sourceId);
  if (!source || !revision || revision.state === 'REMOVED' || !learned || learned.state !== 'CURRENT' || learned.sourceRevisionId !== revision.id) return null;
  const artifacts = runtime.store.artifactsForLearnedRevision(learned.id);
  const entities = artifacts
    .filter((row) => row.artifactType === ArtifactType.ENTITY)
    .flatMap((row) => [row.payload?.canonicalName, ...(row.payload?.aliases || [])])
    .filter(Boolean);
  const claims = artifacts.filter((row) => row.artifactType === ArtifactType.CLAIM);
  const relationships = artifacts.filter((row) => row.artifactType === ArtifactType.RELATIONSHIP);
  const title = revision.metadata?.title || source.uid || sourceId;
  const treePath = Array.isArray(revision.metadata?.treePath) ? revision.metadata.treePath : [];
  const contextPrefix = [
    'Title: ' + title,
    treePath.length ? 'Tree: ' + treePath.join(' > ') : null,
    entities.length ? 'Entities: ' + [...new Set(entities)].join(', ') : null,
  ].filter(Boolean).join(' | ');
  return {
    source,
    revision,
    artifacts,
    entities: [...new Set(entities)],
    claimRefs: claims.map((row) => row.payload?.claimId || row.semanticId).filter(Boolean),
    relationshipRefs: relationships.map((row) => row.payload?.relationshipId || row.semanticId).filter(Boolean),
    entityRefs: artifacts.filter((row) => row.artifactType === ArtifactType.ENTITY).map((row) => row.payload.entityId).filter(Boolean),
    truthStatusHint: truthStatusForArtifacts([...claims, ...relationships]),
    contextPrefix,
    contextualText: contextPrefix + '\n' + revision.exactContent,
  };
}

function recordTokens(text, extra = []) {
  return tokenize(text + ' ' + extra.join(' ')).slice(0, LORE_WAVE3_LIMITS.maxTokensPerRecord);
}

function summaryTruthStatus(summary) {
  const critical = summary.criticalEvidence || [];
  if (critical.some((row) => row.unresolved)) return 'UNRESOLVED';
  const temporal = new Set(critical.map((row) => row.temporalClass).filter(Boolean));
  if (temporal.size === 1 && temporal.has(TemporalClass.HISTORICAL)) return 'HISTORICAL';
  return 'UNKNOWN';
}

function candidateNomination({record, intentId, score, reason}) {
  const representationText = String(record.text || '').slice(0, LORE_WAVE3_LIMITS.maxCandidateTextCharacters);
  const representationRevision = Number(record.representationRevision || 1);
  return {
    kind: 'CandidateNomination',
    contractVersion: '1.0.0',
    nominationId: 'lore-nomination:' + stableHash(intentId + '|' + record.id),
    channelId: 'lore-contextual-local',
    channelVersion: '1.0.0',
    candidateId: 'lore-candidate:' + stableHash(record.id),
    evidenceIdentity: record.evidenceIdentity,
    artifactRef: {artifactId: record.artifactId, artifactType: record.artifactType},
    artifactRevision: Number(record.artifactRevision || 1),
    sourceRevisionRefs: record.sourceRevisionRefs.slice(0, LORE_WAVE3_LIMITS.maxCandidateSourceRefs),
    claimRefs: record.claimRefs.slice(0, 64),
    eventRefs: [],
    entityRefs: record.entityRefs.slice(0, 64),
    relationshipRefs: record.relationshipRefs.slice(0, 64),
    retrievalIntentIds: [intentId],
    rankSignals: {
      localLexicalOverlap: score.lexical,
      resolutionBias: score.resolution,
      scopeBreadth: score.breadth,
      deterministicLocal: true,
    },
    normalizedRank: score.normalized,
    graphMetadata: record.scopeId ? {scopeId: record.scopeId, scopeType: record.scopeType} : null,
    temporalHints: deepClone(record.temporalHints),
    continuitySignals: [],
    authorityClass: record.authorityClass,
    truthStatusHint: record.truthStatusHint,
    provenance: deepClone(record.provenance).slice(0, 16),
    evidenceRefs: record.evidenceRefs.slice(0, LORE_WAVE3_LIMITS.maxCandidateEvidenceRefs),
    dependencyRevisions: record.dependencyRevisions.slice(0, LORE_WAVE3_LIMITS.maxCandidateDependencyRefs),
    freshness: 'FRESH',
    representationRef: record.representationRef,
    representationRevision,
    representationText,
    metadata: {
      loreResolution: record.resolution,
      reason,
      sourceDrillbackRefs: record.sourceIds.slice(0, LORE_WAVE3_LIMITS.maxCandidateSourceRefs),
      sourceRefTotal: record.sourceIds.length,
      sourceRefsTruncated: record.sourceIds.length > LORE_WAVE3_LIMITS.maxCandidateSourceRefs,
      retrievalRecordRef: record.id,
      retrievalRankAuthority: false,
      communityTruthAuthority: false,
      summaryTruthAuthority: false,
      candidateBusAdmissionAuthority: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    },
    worldRevision: null,
    sceneRevision: null,
    authorityGranted: false,
    admissionAuthority: false,
    settlementAuthority: false,
    canonicalMutationAuthority: false,
  };
}

export class LoreContextualRetrievalIndex {
  constructor(snapshot = null) {
    this.records = new Map();
    this.inverted = new Map();
    this.sourceRecordIds = new Map();
    this.summaryRecordIds = new Map();
    this.revision = null;
    this.diagnostics = [];
    if (snapshot) this.restore(snapshot);
  }

  build({runtime, hierarchy, summaryRegistry}) {
    this.records.clear();
    this.inverted.clear();
    this.sourceRecordIds.clear();
    this.summaryRecordIds.clear();
    this.diagnostics = [];
    const scopeById = new Map(hierarchy.scopes.map((scope) => [scope.id, scope]));

    for (const sourceId of hierarchy.includedSourceIds) {
      const ctx = sourceContext(runtime, sourceId);
      if (!ctx) {
        this.pushDiagnostic({sourceId, status: 'SOURCE_SKIPPED_STALE_OR_UNSTUDIED'});
        continue;
      }
      const id = 'retrieval-source:' + stableHash(ctx.revision.id);
      const record = {
        kind: 'LoreRetrievalRecord',
        id,
        artifactId: 'lore-source-artifact:' + stableHash(ctx.revision.id),
        artifactType: 'LORE_EXACT_SOURCE',
        artifactRevision: ctx.revision.revision,
        representationRef: 'source:' + ctx.revision.id,
        representationRevision: ctx.revision.revision,
        resolution: 'EXACT_SOURCE',
        sourceIds: [sourceId],
        sourceRevisionRefs: [ctx.revision.id],
        text: ctx.contextualText,
        exactAuthoredText: ctx.revision.exactContent,
        tokens: recordTokens(ctx.contextualText, ctx.entities),
        claimRefs: ctx.claimRefs,
        relationshipRefs: ctx.relationshipRefs,
        entityRefs: ctx.entityRefs,
        evidenceRefs: [],
        dependencyRevisions: [ctx.revision.id],
        authorityClass: AuthorityClass.SOURCE_CANON,
        truthStatusHint: ctx.truthStatusHint,
        temporalHints: ctx.artifacts
          .filter((row) => row.temporalClass && row.temporalClass !== TemporalClass.TIMELESS)
          .slice(0, 32)
          .map((row) => ({artifactId: row.id, temporalClass: row.temporalClass, unresolved: row.unresolved})),
        provenance: [{kind: 'LoreRetrievalProvenance', sourceId, sourceRevisionId: ctx.revision.id, contextualized: true, sourceMutated: false}],
        evidenceIdentity: 'source:' + stableHash(ctx.revision.id),
        scopeId: null,
        scopeType: null,
      };
      this.addRecord(record);
      this.sourceRecordIds.set(sourceId, id);
    }

    for (const summary of summaryRegistry.activeSummaries()) {
      const scope = scopeById.get(summary.targetScopeId);
      if (!scope) continue;
      if (summary.sourceRevisionSet.some((revisionId) => {
        const revision = runtime.registry.getRevision(revisionId);
        return !revision || !runtime.registry.isCurrentRevision(revisionId);
      })) {
        this.pushDiagnostic({summaryId: summary.id, status: 'SUMMARY_SKIPPED_STALE_SOURCE'});
        continue;
      }
      const id = 'retrieval-summary:' + stableHash(summary.id);
      const record = {
        kind: 'LoreRetrievalRecord',
        id,
        artifactId: summary.id,
        artifactType: 'NAVIGATION_SUMMARY',
        artifactRevision: summary.summaryRevision,
        representationRef: summary.id,
        representationRevision: summary.summaryRevision,
        resolution: scope.type === NavigationScopeType.COMMUNITY ? 'COMMUNITY_SUMMARY' : 'NAVIGATION_SUMMARY',
        sourceIds: [...scope.sourceIds],
        sourceRevisionRefs: [...summary.sourceRevisionSet],
        text: [scope.label, scope.treePath?.join(' > '), summary.content].filter(Boolean).join('\n'),
        exactAuthoredText: null,
        tokens: recordTokens([scope.label, ...(scope.treePath || []), summary.content].join(' ')),
        claimRefs: [...new Set((summary.criticalEvidence || []).flatMap((row) => row.claimRefs || []))].slice(0, 192),
        relationshipRefs: [...new Set((summary.criticalEvidence || []).flatMap((row) => row.relationshipRefs || []))].slice(0, 128),
        entityRefs: [...new Set((summary.criticalEvidence || []).flatMap((row) => row.entityRefs || []))].slice(0, 128),
        evidenceRefs: [...new Set((summary.criticalEvidence || []).map((row) => row.evidenceId))].slice(0, 256),
        dependencyRevisions: [...new Set([summary.structureRevision, ...summary.sourceRevisionSet, ...summary.childSummaryDependencies.map((row) => row.summaryId)])],
        authorityClass: AuthorityClass.DERIVED,
        truthStatusHint: summaryTruthStatus(summary),
        temporalHints: (summary.criticalEvidence || [])
          .filter((row) => row.temporalClass && row.temporalClass !== TemporalClass.TIMELESS)
          .slice(0, 32)
          .map((row) => ({evidenceId: row.evidenceId, temporalClass: row.temporalClass, unresolved: row.unresolved})),
        provenance: [deepClone(summary.provenance)],
        evidenceIdentity: 'representation:' + stableHash(summary.id + '|' + summary.sourceRevisionSet.join('|')),
        scopeId: scope.id,
        scopeType: scope.type,
      };
      this.addRecord(record);
      this.summaryRecordIds.set(summary.id, id);
    }

    this.revision = 'lore-retrieval:' + stableHash(
      hierarchy.hierarchyRevision + '|'
      + [...this.records.values()].map((row) => row.id + ':' + row.dependencyRevisions.join(',')).sort().join('|'),
    );
    return this.status();
  }

  addRecord(record) {
    this.records.set(record.id, deepClone(record));
    for (const token of record.tokens) {
      const ids = this.inverted.get(token) || new Set();
      ids.add(record.id);
      this.inverted.set(token, ids);
    }
  }

  pushDiagnostic(row) {
    this.diagnostics.push(deepClone(row));
    if (this.diagnostics.length > LORE_WAVE3_LIMITS.maxDiagnostics) {
      this.diagnostics.splice(0, this.diagnostics.length - LORE_WAVE3_LIMITS.maxDiagnostics);
    }
  }

  query({query, intent = 'AUTO', intentId = null, allowedSourceIds = null} = {}) {
    const text = String(query || '').trim();
    if (!text) return {kind: 'LoreRetrievalResult', query: text, intent: 'EMPTY', nominations: [], diagnostics: {reason: 'EMPTY_QUERY'}};
    if (text.length > LORE_WAVE3_LIMITS.maxQueryCharacters) throw new Error('LORE_QUERY_LENGTH_LIMIT_EXCEEDED');
    const queryTokens = tokenize(text);
    const resolvedIntent = intent === 'AUTO'
      ? (/\b(overview|about|history|branch|faction|community|world|lore|background)\b/i.test(text) ? 'BROAD' : 'NARROW')
      : String(intent).toUpperCase();
    const resolvedIntentId = intentId || 'lore-intent:' + stableHash(resolvedIntent + '|' + text.toLowerCase());

    const scopeFilter = allowedSourceIds == null
      ? null
      : new Set((Array.isArray(allowedSourceIds) ? allowedSourceIds : [...allowedSourceIds]).map(String));
    const candidateIds = new Set();
    for (const token of queryTokens) {
      for (const id of this.inverted.get(token) || []) {
        const record = this.records.get(id);
        if (!record) continue;
        if (scopeFilter && !(record.sourceIds || []).every((sourceId) => scopeFilter.has(String(sourceId)))) continue;
        candidateIds.add(id);
        if (candidateIds.size >= LORE_WAVE3_LIMITS.maxExaminedEntries) break;
      }
      if (candidateIds.size >= LORE_WAVE3_LIMITS.maxExaminedEntries) break;
    }

    const scored = [];
    for (const id of candidateIds) {
      const record = this.records.get(id);
      if (!record) continue;
      if (scopeFilter && !(record.sourceIds || []).every((sourceId) => scopeFilter.has(String(sourceId)))) continue;
      const recordSet = new Set(record.tokens);
      const matched = queryTokens.filter((token) => recordSet.has(token));
      if (!matched.length) continue;
      const lexical = queryTokens.length ? matched.length / queryTokens.length : 0;
      const broadSummary = record.resolution !== 'EXACT_SOURCE';
      const resolution = resolvedIntent === 'BROAD' ? (broadSummary ? 0.25 : 0.02) : (broadSummary ? 0 : 0.25);
      const breadth = broadSummary ? Math.min(0.2, Math.log2(Math.max(1, record.sourceIds.length)) / 30) : 0;
      const phraseBonus = record.text.toLowerCase().includes(text.toLowerCase()) ? 0.2 : 0;
      const normalized = Math.max(0, Math.min(1, lexical * 0.65 + resolution + breadth + phraseBonus));
      scored.push({record, score: {lexical, resolution, breadth, normalized}, matched});
    }

    scored.sort((a, b) => b.score.normalized - a.score.normalized
      || Number(a.record.resolution !== 'EXACT_SOURCE') - Number(b.record.resolution !== 'EXACT_SOURCE')
      || a.record.id.localeCompare(b.record.id));

    const limit = Math.min(LORE_WAVE3_LIMITS.maxNominationsPerIntent, LORE_WAVE3_LIMITS.maxTotalNominations);
    const picked = scored.slice(0, limit);
    const nominations = picked.map(({record, score, matched}) => candidateNomination({
      record,
      intentId: resolvedIntentId,
      score,
      reason: {
        intent: resolvedIntent,
        matchedTokens: matched,
        resolution: record.resolution,
        sourceCount: record.sourceIds.length,
      },
    }));

    return {
      kind: 'LoreRetrievalResult',
      contractVersion: 1,
      query: text,
      queryTokens,
      intent: resolvedIntent,
      retrievalIntentId: resolvedIntentId,
      indexRevision: this.revision,
      nominations,
      diagnostics: {
        examined: Math.min(candidateIds.size, LORE_WAVE3_LIMITS.maxExaminedEntries),
        matched: scored.length,
        returned: nominations.length,
        boundedOut: Math.max(0, scored.length - nominations.length),
        deterministic: true,
        retrievalRankAuthority: false,
        candidateBusAdmissionAuthority: false,
        storyScopeFiltered: Boolean(scopeFilter),
        allowedSourceCount: scopeFilter ? scopeFilter.size : null,
      },
      authorityGranted: false,
      settlementAuthority: false,
      contextSealAuthority: false,
    };
  }

  drillDown(nomination) {
    const record = nomination?.metadata?.retrievalRecordRef
      ? this.records.get(nomination.metadata.retrievalRecordRef)
      : null;
    const refs = record?.sourceIds || nomination?.metadata?.sourceDrillbackRefs || [];
    return refs.slice(0, LORE_WAVE3_LIMITS.maxSourceRefsPerSummary).map((sourceId) => {
      const recordId = this.sourceRecordIds.get(sourceId);
      const record = recordId ? this.records.get(recordId) : null;
      if (!record) return null;
      return {
        sourceId,
        sourceRevisionId: record.sourceRevisionRefs[0],
        exactAuthoredText: record.exactAuthoredText,
        representationRef: record.representationRef,
        provenance: deepClone(record.provenance),
      };
    }).filter(Boolean);
  }

  status() {
    const records = [...this.records.values()];
    return {
      kind: 'LoreContextualRetrievalStatus',
      revision: this.revision,
      records: records.length,
      exactSourceRecords: records.filter((row) => row.resolution === 'EXACT_SOURCE').length,
      summaryRecords: records.filter((row) => row.resolution !== 'EXACT_SOURCE').length,
      tokenTerms: this.inverted.size,
      diagnostics: deepClone(this.diagnostics),
      externalEmbeddingRequired: false,
      externalDatabaseRequired: false,
      orchestrationServiceRequired: false,
    };
  }

  snapshot() {
    return {
      kind: 'LoreContextualRetrievalIndexSnapshot',
      revision: this.revision,
      records: [...this.records.values()].map(deepClone),
      diagnostics: deepClone(this.diagnostics),
    };
  }

  restore(snapshot) {
    this.records = new Map();
    this.inverted = new Map();
    this.sourceRecordIds = new Map();
    this.summaryRecordIds = new Map();
    this.revision = snapshot?.revision || null;
    this.diagnostics = deepClone(snapshot?.diagnostics || []);
    for (const record of snapshot?.records || []) {
      this.addRecord(record);
      if (record.resolution === 'EXACT_SOURCE' && record.sourceIds.length === 1) this.sourceRecordIds.set(record.sourceIds[0], record.id);
      if (record.artifactType === 'NAVIGATION_SUMMARY') this.summaryRecordIds.set(record.artifactId, record.id);
    }
  }
}
