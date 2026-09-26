import {
  ArtifactType,
  AuthorityClass,
  TemporalClass,
  deepClone,
  stableHash,
} from './lore-contracts.js';
import {
  LORE_WAVE3_LIMITS,
  NavigationFailure,
  NavigationQualityStatus,
  NavigationSummaryState,
  createNavigationSummaryArtifact,
} from './lore-navigation-contracts.js';
import {hierarchyScopeMap} from './lore-navigation-hierarchy.js';

const SIGNIFICANT_RELATIONSHIPS = new Set([
  'owns', 'knows', 'family', 'alliedWith', 'rivalOf', 'employedBy', 'carries', 'carried', 'leftAt', 'locatedAt', 'destroyedAt',
]);

function humanize(value, labels) {
  if (labels.has(value)) return labels.get(value);
  if (typeof value !== 'string') return String(value);
  return value.replace(/^entity:/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function sentenceSpans(content) {
  const text = String(content || '');
  const rows = [];
  const regex = /[^.!?\n]+[.!?]?/g;
  let match;
  let index = 0;
  while ((match = regex.exec(text)) && rows.length < 512) {
    const value = match[0].trim();
    if (!value) continue;
    const offset = match[0].indexOf(value);
    rows.push({index: index++, start: match.index + offset, end: match.index + offset + value.length, text: value});
  }
  return rows;
}

function sourceEvidence(runtime, sourceId) {
  const revision = runtime.registry.currentRevision(sourceId, {allowMissing: true});
  const learned = runtime.store.currentLearnedRevision(sourceId);
  if (!revision || revision.state === 'REMOVED' || !learned || learned.state !== 'CURRENT' || learned.sourceRevisionId !== revision.id) {
    return {ok: false, reason: NavigationFailure.SOURCE_REVISION_STALE, evidence: []};
  }
  const artifacts = runtime.store.artifactsForLearnedRevision(learned.id);
  const labels = new Map(
    artifacts
      .filter((artifact) => artifact.artifactType === ArtifactType.ENTITY)
      .map((artifact) => [artifact.payload.entityId, artifact.payload.canonicalName]),
  );
  const evidence = [];
  const push = (row) => {
    if (!evidence.some((existing) => existing.evidenceId === row.evidenceId)) evidence.push(row);
  };

  for (const artifact of artifacts) {
    if (artifact.artifactType === ArtifactType.CLAIM) {
      const temporal = artifact.temporalClass === TemporalClass.TIMELESS ? '' : '[' + artifact.temporalClass + '] ';
      const unresolved = artifact.unresolved ? '[UNRESOLVED] ' : '';
      const text = temporal + unresolved
        + humanize(artifact.payload.subjectId, labels) + ' '
        + artifact.payload.predicate + ' '
        + humanize(artifact.payload.value, labels) + '.';
      const critical = artifact.unresolved
        || [TemporalClass.HISTORICAL, TemporalClass.SEQUENCE, TemporalClass.DATED, TemporalClass.UNCERTAIN, TemporalClass.CONFLICTING].includes(artifact.temporalClass)
        || ['state', 'behavior'].includes(artifact.payload.predicate);
      push({
        evidenceId: 'evidence:' + artifact.id,
        kind: 'CLAIM',
        text,
        critical,
        sourceId,
        sourceRevisionId: revision.id,
        artifactRefs: [artifact.id],
        claimRefs: [artifact.payload.claimId || artifact.semanticId],
        relationshipRefs: [],
        entityRefs: [artifact.payload.subjectId].filter(Boolean),
        temporalClass: artifact.temporalClass,
        unresolved: artifact.unresolved,
        provenance: deepClone(artifact.provenance),
      });
    } else if (artifact.artifactType === ArtifactType.RELATIONSHIP) {
      const temporal = artifact.temporalClass === TemporalClass.TIMELESS ? '' : '[' + artifact.temporalClass + '] ';
      const unresolved = artifact.unresolved ? '[UNRESOLVED] ' : '';
      const text = temporal + unresolved
        + humanize(artifact.payload.subjectId, labels) + ' '
        + artifact.payload.predicate + ' '
        + humanize(artifact.payload.objectId, labels) + '.';
      const critical = artifact.unresolved
        || [TemporalClass.HISTORICAL, TemporalClass.SEQUENCE, TemporalClass.DATED, TemporalClass.UNCERTAIN, TemporalClass.CONFLICTING].includes(artifact.temporalClass)
        || SIGNIFICANT_RELATIONSHIPS.has(artifact.payload.predicate);
      push({
        evidenceId: 'evidence:' + artifact.id,
        kind: 'RELATIONSHIP',
        text,
        critical,
        sourceId,
        sourceRevisionId: revision.id,
        artifactRefs: [artifact.id],
        claimRefs: artifact.payload.supportingClaimIds || [],
        relationshipRefs: [artifact.payload.relationshipId || artifact.semanticId],
        entityRefs: [artifact.payload.subjectId, artifact.payload.objectId].filter(Boolean),
        temporalClass: artifact.temporalClass,
        unresolved: artifact.unresolved,
        provenance: deepClone(artifact.provenance),
      });
    }
  }

  const relationships = artifacts.filter((artifact) => artifact.artifactType === ArtifactType.RELATIONSHIP);
  for (const left of relationships.filter((artifact) => artifact.payload?.predicate === 'leftAt')) {
    const sentenceIndex = left.provenance?.span?.sentenceIndex;
    const located = relationships.find((artifact) =>
      artifact.payload?.predicate === 'locatedAt'
      && artifact.payload?.subjectId === left.payload?.objectId
      && artifact.provenance?.span?.sentenceIndex === sentenceIndex
    );
    if (!located) continue;
    push({
      evidenceId: 'composite:' + stableHash(left.id + '|' + located.id),
      kind: 'TEMPORAL_RELATIONSHIP_COMPOSITE',
      text: '[HISTORICAL] '
        + humanize(left.payload.subjectId, labels) + ' left '
        + humanize(left.payload.objectId, labels) + ' at '
        + humanize(located.payload.objectId, labels) + '.',
      critical: true,
      sourceId,
      sourceRevisionId: revision.id,
      artifactRefs: [left.id, located.id],
      claimRefs: [...new Set([...(left.payload.supportingClaimIds || []), ...(located.payload.supportingClaimIds || [])])],
      relationshipRefs: [left.payload.relationshipId || left.semanticId, located.payload.relationshipId || located.semanticId],
      entityRefs: [left.payload.subjectId, left.payload.objectId, located.payload.objectId].filter(Boolean),
      temporalClass: TemporalClass.HISTORICAL,
      unresolved: false,
      provenance: {
        kind: 'LoreCompositeEvidenceProvenance',
        sourceId,
        sourceRevisionId: revision.id,
        derivedFromArtifactIds: [left.id, located.id],
        sentenceIndex,
      },
    });
  }

  for (const span of sentenceSpans(revision.exactContent)) {
    const hardRule = /\b(cannot|can't|must|never|only|prohibited|required|immune|unable|must not|may not)\b/i.test(span.text);
    const exception = /\b(except|unless|however|but only|except when|except if)\b/i.test(span.text);
    const behavior = /\b(protects?|shields?|evacuates?|abandons?|fidgets?|flinches?|smiles?|laughs?|hums?|paces?|whispers?|avoids? eye contact|leans?|pulls? away|reaches? for)\b/i.test(span.text);
    if (!hardRule && !exception && !behavior) continue;
    const kind = hardRule && exception ? 'HARD_RULE_EXCEPTION' : hardRule ? 'HARD_RULE' : exception ? 'RULE_EXCEPTION' : 'CHARACTER_BEHAVIOR';
    const prefix = hardRule && exception ? '[RULE][EXCEPTION] ' : hardRule ? '[RULE] ' : exception ? '[EXCEPTION] ' : '[BEHAVIOR] ';
    push({
      evidenceId: (hardRule && exception ? 'source-rule-exception:' : hardRule ? 'source-rule:' : exception ? 'source-exception:' : 'source-behavior:') + stableHash(revision.id + '|' + span.start + '|' + span.end + '|' + span.text),
      kind,
      text: prefix + span.text,
      critical: true,
      sourceId,
      sourceRevisionId: revision.id,
      artifactRefs: [],
      claimRefs: [],
      relationshipRefs: [],
      entityRefs: [],
      temporalClass: TemporalClass.TIMELESS,
      unresolved: false,
      provenance: {
        kind: 'LoreSourceSpanProvenance',
        sourceId,
        sourceRevisionId: revision.id,
        start: span.start,
        end: span.end,
        textHash: stableHash(span.text),
      },
    });
  }

  return {
    ok: true,
    sourceId,
    sourceRevisionId: revision.id,
    title: revision.metadata?.title || runtime.registry.getEntry(sourceId)?.uid || sourceId,
    evidence: evidence.sort((a, b) => Number(b.critical) - Number(a.critical) || a.evidenceId.localeCompare(b.evidenceId)),
  };
}

function setDiagnostics(session, row) {
  session.diagnostics.push(deepClone(row));
  if (session.diagnostics.length > LORE_WAVE3_LIMITS.maxDiagnostics) {
    session.diagnostics.splice(0, session.diagnostics.length - LORE_WAVE3_LIMITS.maxDiagnostics);
  }
}

function exactSetValidation(expected, received, type) {
  const failures = [];
  if (!Array.isArray(received)) return [NavigationFailure.MALFORMED_OUTPUT];
  const expectedSet = new Set(expected);
  const receivedSet = new Set();
  for (const ref of received) {
    if (receivedSet.has(ref)) failures.push(type === 'source' ? NavigationFailure.SOURCE_REF_DUPLICATE : NavigationFailure.CHILD_REF_DUPLICATE);
    receivedSet.add(ref);
    if (!expectedSet.has(ref)) failures.push(type === 'source' ? NavigationFailure.SOURCE_REF_EXTRA : NavigationFailure.CHILD_REF_EXTRA);
  }
  for (const ref of expectedSet) if (!receivedSet.has(ref)) failures.push(type === 'source' ? NavigationFailure.SOURCE_REF_MISSING : NavigationFailure.CHILD_REF_MISSING);
  return [...new Set(failures)];
}

function criticalKey(row) {
  return row.evidenceId + '|' + row.sourceRevisionId;
}

function buildScopeRequest({scope, runtime, registry, evidenceCache = null}) {
  if (scope.sourceIds.length > LORE_WAVE3_LIMITS.maxSourceRefsPerSummary) {
    return {ok: false, failure: NavigationFailure.SOURCE_REF_LIMIT};
  }
  if (scope.childScopeIds.length > LORE_WAVE3_LIMITS.maxChildrenPerSummary) {
    return {ok: false, failure: NavigationFailure.CHILD_LIMIT};
  }

  const sourceRows = [];
  for (const sourceId of scope.sourceIds) {
    const revision = runtime.registry.currentRevision(sourceId, {allowMissing: true});
    const cacheKey = revision ? sourceId + '|' + revision.id : sourceId + '|missing';
    let row = evidenceCache?.get(cacheKey) || null;
    if (!row) {
      row = sourceEvidence(runtime, sourceId);
      if (evidenceCache && row.ok) evidenceCache.set(cacheKey, deepClone(row));
    } else {
      row = deepClone(row);
    }
    if (!row.ok) return {ok: false, failure: row.reason, sourceId};
    sourceRows.push(row);
  }
  const sourceRevisionSet = sourceRows.map((row) => row.sourceRevisionId).sort();
  const childSummaries = [];
  const childEvidence = new Map();
  for (const childScopeId of scope.childScopeIds) {
    const child = registry.current(childScopeId);
    if (!child) return {ok: false, failure: NavigationFailure.CHILD_SUMMARY_FAILED, childScopeId};
    const resolved = registry.resolveEvidenceRefs(child.criticalEvidenceRefs || [], {
      limit: LORE_WAVE3_LIMITS.maxEvidenceRefsPerSummary,
    });
    if (resolved.status === 'LIMIT_EXCEEDED') {
      return {ok: false, failure: NavigationFailure.EVIDENCE_REF_LIMIT, childScopeId};
    }
    if (resolved.status === 'DEGRADED') {
      return {
        ok: false,
        failure: NavigationFailure.EVIDENCE_REF_MISSING,
        childScopeId,
        missingEvidenceRefs: resolved.missingEvidenceRefs,
      };
    }
    childSummaries.push(child);
    childEvidence.set(child.id, resolved.evidence);
  }
  const childSummaryDependencies = childSummaries
    .map((row) => ({
      scopeId: row.targetScopeId,
      summaryId: row.id,
      summaryRevision: row.summaryRevision,
      structureRevision: row.structureRevision,
      sourceRevisionSet: [...row.sourceRevisionSet],
    }))
    .sort((a, b) => a.scopeId.localeCompare(b.scopeId));

  const evidenceById = new Map();
  if (!scope.childScopeIds.length) {
    for (const source of sourceRows) {
      const refs = registry.registerEvidence(source.evidence);
      for (let index = 0; index < source.evidence.length; index += 1) {
        const row = {...deepClone(source.evidence[index]), evidenceRef: refs[index]};
        evidenceById.set(criticalKey(row), row);
      }
    }
  } else {
    for (const child of childSummaries) {
      for (const row of childEvidence.get(child.id) || []) evidenceById.set(criticalKey(row), deepClone(row));
    }
  }
  const criticalEvidence = [...evidenceById.values()].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  if (criticalEvidence.length > LORE_WAVE3_LIMITS.maxEvidenceRefsPerSummary) {
    return {ok: false, failure: NavigationFailure.EVIDENCE_REF_LIMIT};
  }
  const criticalEvidenceRefs = [...new Set(criticalEvidence.map((row) => row.evidenceRef).filter(Boolean))];
  const navigationStatements = [];

  if (!scope.childScopeIds.length) {
    const all = sourceRows.flatMap((row) => row.evidence);
    for (const row of all) {
      navigationStatements.push({
        statementId: 'statement:' + stableHash(scope.id + '|' + row.evidenceId),
        text: row.text,
        sourceRevisionRefs: [row.sourceRevisionId],
        evidenceRefs: [row.evidenceId],
        critical: row.critical,
      });
    }
    if (!navigationStatements.length) {
      for (const source of sourceRows) {
        navigationStatements.push({
          statementId: 'statement:' + stableHash(scope.id + '|source|' + source.sourceRevisionId),
          text: source.title + ' is available as exact authored lore.',
          sourceRevisionRefs: [source.sourceRevisionId],
          evidenceRefs: [],
          critical: false,
        });
      }
    }
  } else {
    for (const child of childSummaries) {
      const firstLine = String(child.content || '').split('\n').find(Boolean) || child.targetLabel;
      navigationStatements.push({
        statementId: 'statement:' + stableHash(scope.id + '|child|' + child.id),
        text: child.targetLabel + ': ' + firstLine.slice(0, 260),
        sourceRevisionRefs: [...child.sourceRevisionSet],
        evidenceRefs: (childEvidence.get(child.id) || []).slice(0, 16).map((row) => row.evidenceId),
        childSummaryRef: child.id,
        critical: false,
      });
    }
    for (const row of criticalEvidence) {
      navigationStatements.push({
        statementId: 'statement:' + stableHash(scope.id + '|critical|' + row.evidenceId + '|' + row.sourceRevisionId),
        text: row.text,
        sourceRevisionRefs: [row.sourceRevisionId],
        evidenceRefs: [row.evidenceId],
        critical: true,
      });
    }
  }

  const deduped = new Map();
  for (const statement of navigationStatements) {
    const key = statement.text + '|' + statement.sourceRevisionRefs.join('|');
    if (!deduped.has(key) || statement.critical) deduped.set(key, statement);
  }

  return {
    ok: true,
    kind: 'LoreNavigationSummaryRequest',
    scope: deepClone(scope),
    sourceRevisionSet,
    childSummaryDependencies,
    childSummaries,
    criticalEvidence,
    criticalEvidenceRefs,
    allowedStatements: [...deduped.values()].sort((a, b) => Number(b.critical) - Number(a.critical) || a.statementId.localeCompare(b.statementId)),
  };
}

export class DeterministicNavigationSummaryProvider {
  constructor({failScopeIds = []} = {}) {
    this.failScopeIds = new Set(failScopeIds);
  }

  generate(request) {
    if (this.failScopeIds.has(request.scope.id)) {
      return {kind: 'NavigationSummaryDraft', failed: true, failure: 'PROVIDER_FORCED_FAILURE', scopeId: request.scope.id};
    }
    const critical = request.allowedStatements.filter((row) => row.critical);
    const optional = request.allowedStatements.filter((row) => !row.critical);
    const selected = [];
    let content = '';
    const append = (statement) => {
      const next = selected.length ? content + '\n' + statement.text : statement.text;
      if (next.length > LORE_WAVE3_LIMITS.maxSummaryCharacters) return false;
      selected.push(statement);
      content = next;
      return true;
    };
    for (const statement of critical) {
      if (!append(statement)) {
        return {
          kind: 'NavigationSummaryDraft',
          failed: true,
          failure: NavigationFailure.SUMMARY_TOO_LARGE,
          scopeId: request.scope.id,
          sourceRevisionRefs: [...request.sourceRevisionSet],
          childSummaryRefs: request.childSummaryDependencies.map((row) => row.summaryId),
        };
      }
    }
    for (const statement of optional) append(statement);
    return {
      kind: 'NavigationSummaryDraft',
      failed: false,
      scopeId: request.scope.id,
      structureRevision: request.scope.structureRevision,
      sourceRevisionRefs: [...request.sourceRevisionSet],
      childSummaryRefs: request.childSummaryDependencies.map((row) => row.summaryId),
      statementRefs: selected.map((row) => row.statementId),
      content,
      authorityClass: AuthorityClass.DERIVED,
      providerMetadata: {provider: 'DETERMINISTIC_NAVIGATION_V1', persistentId: null},
    };
  }
}

export function validateNavigationSummaryDraft({draft, request}) {
  const failures = [];
  if (!draft || draft.kind !== 'NavigationSummaryDraft' || draft.failed || typeof draft.content !== 'string' || !Array.isArray(draft.statementRefs)) {
    failures.push(draft?.failure || NavigationFailure.MALFORMED_OUTPUT);
  }
  if (draft?.scopeId !== request.scope.id || draft?.structureRevision !== request.scope.structureRevision) failures.push(NavigationFailure.MALFORMED_OUTPUT);
  failures.push(...exactSetValidation(request.sourceRevisionSet, draft?.sourceRevisionRefs, 'source'));
  failures.push(...exactSetValidation(request.childSummaryDependencies.map((row) => row.summaryId), draft?.childSummaryRefs, 'child'));
  if (draft?.authorityClass !== AuthorityClass.DERIVED) failures.push(NavigationFailure.UNSUPPORTED_AUTHORITY);
  if (draft?.providerMetadata?.persistentId) failures.push(NavigationFailure.UNSUPPORTED_AUTHORITY);
  if ((draft?.content || '').length > LORE_WAVE3_LIMITS.maxSummaryCharacters) failures.push(NavigationFailure.SUMMARY_TOO_LARGE);

  const allowed = new Map(request.allowedStatements.map((row) => [row.statementId, row]));
  const seen = new Set();
  for (const ref of draft?.statementRefs || []) {
    if (seen.has(ref) || !allowed.has(ref)) failures.push(NavigationFailure.UNSUPPORTED_STATEMENT);
    seen.add(ref);
  }
  const expectedText = (draft?.statementRefs || []).filter((ref) => allowed.has(ref)).map((ref) => allowed.get(ref).text).join('\n');
  if (draft?.content !== expectedText) failures.push(NavigationFailure.UNSUPPORTED_STATEMENT);

  const criticalStatements = request.allowedStatements.filter((row) => row.critical);
  for (const row of criticalStatements) if (!seen.has(row.statementId)) {
    if (row.text.includes('[UNRESOLVED]')) failures.push('UNRESOLVED_EVIDENCE_DROPPED');
    else if (row.text.includes('[HISTORICAL]') || row.text.includes('[SEQUENCE]') || row.text.includes('[DATED]')) failures.push('TEMPORAL_EVIDENCE_DROPPED');
    else if (row.text.includes('[EXCEPTION]')) failures.push('RULE_EXCEPTION_DROPPED');
    else if (row.text.startsWith('[RULE]')) failures.push('HARD_RULE_DROPPED');
    else if (row.text.startsWith('[BEHAVIOR]')) failures.push('CHARACTER_BEHAVIOR_DROPPED');
    else failures.push('SIGNIFICANT_RELATIONSHIP_OR_STATE_DROPPED');
  }

  const uniqueFailures = [...new Set(failures)];
  return {
    kind: 'NavigationSummaryQualityReceipt',
    status: uniqueFailures.length ? NavigationQualityStatus.FAIL : NavigationQualityStatus.PASS,
    scopeId: request.scope.id,
    structureRevision: request.scope.structureRevision,
    sourceRefsTotal: request.sourceRevisionSet.length,
    sourceRefsRetained: new Set(draft?.sourceRevisionRefs || []).size,
    childRefsTotal: request.childSummaryDependencies.length,
    childRefsRetained: new Set(draft?.childSummaryRefs || []).size,
    statementCandidates: request.allowedStatements.length,
    statementsRetained: new Set(draft?.statementRefs || []).size,
    criticalEvidenceTotal: criticalStatements.length,
    criticalEvidenceRetained: criticalStatements.filter((row) => seen.has(row.statementId)).length,
    hardRulesTotal: criticalStatements.filter((row) => row.text.startsWith('[RULE]')).length,
    hardRulesRetained: criticalStatements.filter((row) => row.text.startsWith('[RULE]') && seen.has(row.statementId)).length,
    exceptionsTotal: criticalStatements.filter((row) => row.text.includes('[EXCEPTION]')).length,
    exceptionsRetained: criticalStatements.filter((row) => row.text.includes('[EXCEPTION]') && seen.has(row.statementId)).length,
    behaviorTotal: criticalStatements.filter((row) => row.text.startsWith('[BEHAVIOR]') || / behavior /.test(row.text)).length,
    behaviorRetained: criticalStatements.filter((row) => (row.text.startsWith('[BEHAVIOR]') || / behavior /.test(row.text)) && seen.has(row.statementId)).length,
    unresolvedTotal: criticalStatements.filter((row) => row.text.includes('[UNRESOLVED]')).length,
    unresolvedRetained: criticalStatements.filter((row) => row.text.includes('[UNRESOLVED]') && seen.has(row.statementId)).length,
    temporalTotal: criticalStatements.filter((row) => /\[(HISTORICAL|SEQUENCE|DATED|UNCERTAIN|CONFLICTING)\]/.test(row.text)).length,
    temporalRetained: criticalStatements.filter((row) => /\[(HISTORICAL|SEQUENCE|DATED|UNCERTAIN|CONFLICTING)\]/.test(row.text) && seen.has(row.statementId)).length,
    summaryCharacters: (draft?.content || '').length,
    maxSummaryCharacters: LORE_WAVE3_LIMITS.maxSummaryCharacters,
    validationFailures: uniqueFailures,
    sourceAuthority: false,
    truthAuthority: false,
    settlementAuthority: false,
  };
}

function topologicalScopes(hierarchy) {
  const scopes = hierarchyScopeMap(hierarchy);
  const temporary = new Set();
  const permanent = new Set();
  const ordered = [];
  const visit = (id) => {
    if (permanent.has(id)) return;
    if (temporary.has(id)) throw new Error('LORE_NAVIGATION_HIERARCHY_CYCLE');
    temporary.add(id);
    const scope = scopes.get(id);
    if (!scope) throw new Error('UNKNOWN_NAVIGATION_SCOPE:' + id);
    for (const child of scope.childScopeIds) visit(child);
    temporary.delete(id);
    permanent.add(id);
    ordered.push(id);
  };
  for (const id of [...scopes.keys()].sort()) visit(id);
  return ordered;
}

export class LoreNavigationSummaryBuilder {
  constructor({
    runtime,
    registry,
    provider = new DeterministicNavigationSummaryProvider(),
    generatorRevision = 'lore-nav-summary-v1',
    snapshot = null,
  } = {}) {
    if (!runtime || !registry) throw new TypeError('LoreNavigationSummaryBuilder requires runtime and registry');
    this.runtime = runtime;
    this.registry = registry;
    this.provider = provider;
    this.generatorRevision = generatorRevision;
    this.sessions = new Map();
    this.scopeStates = new Map();
    this.evidenceCache = new Map();
    this.sequence = 0;
    if (snapshot) this.restore(snapshot);
  }

  start(hierarchy) {
    this.registry.syncHierarchy({hierarchy, runtime: this.runtime});
    this.evidenceCache = new Map();
    const id = 'navigation-build:' + stableHash(hierarchy.hierarchyRevision + '|' + (++this.sequence));
    const session = {
      kind: 'LoreNavigationBuildSession',
      id,
      hierarchyRevision: hierarchy.hierarchyRevision,
      hierarchy: deepClone(hierarchy),
      plan: topologicalScopes(hierarchy),
      cursor: 0,
      state: 'ACTIVE',
      completedScopeIds: [],
      blockedScopeIds: [],
      reusedScopeIds: [],
      builtScopeIds: [],
      diagnostics: [],
      checkpoint: null,
    };
    this.sessions.set(id, session);
    return deepClone(session);
  }

  run(sessionId, {maxUnits = LORE_WAVE3_LIMITS.maxActiveWorkBatch} = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Unknown navigation build session: ' + sessionId);
    if (session.state === 'COMPLETED') return deepClone(session);
    const scopes = hierarchyScopeMap(session.hierarchy);
    const limit = Math.max(1, Math.min(LORE_WAVE3_LIMITS.maxActiveWorkBatch, Number(maxUnits) || 1));
    let used = 0;

    while (session.cursor < session.plan.length && used < limit) {
      const scopeId = session.plan[session.cursor];
      const scope = scopes.get(scopeId);
      const result = this.buildScope(scope, session);
      this.scopeStates.set(scopeId, {state: result.state, reason: result.reason || null, summaryId: result.summary?.id || null});
      if (result.state === NavigationSummaryState.BLOCKED || result.state === NavigationSummaryState.INVALID) {
        session.blockedScopeIds.push(scopeId);
      } else if (result.state === NavigationSummaryState.REUSED) {
        session.reusedScopeIds.push(scopeId);
        session.completedScopeIds.push(scopeId);
      } else if (result.state === NavigationSummaryState.BUILT) {
        session.builtScopeIds.push(scopeId);
        session.completedScopeIds.push(scopeId);
      }
      setDiagnostics(session, {
        scopeId,
        scopeType: scope.type,
        state: result.state,
        reason: result.reason || null,
        summaryId: result.summary?.id || null,
      });
      session.cursor += 1;
      used += 1;
      session.checkpoint = {
        cursor: session.cursor,
        total: session.plan.length,
        lastScopeId: scopeId,
        checksum: stableHash(session.completedScopeIds.join('|') + '|' + session.blockedScopeIds.join('|')),
      };
    }

    if (session.cursor >= session.plan.length) session.state = 'COMPLETED';
    else session.state = 'CHECKPOINTED';
    return deepClone(session);
  }

  buildScope(scope, session = null) {
    for (const childId of scope.childScopeIds) {
      const childState = this.scopeStates.get(childId);
      if (childState && [NavigationSummaryState.BLOCKED, NavigationSummaryState.INVALID].includes(childState.state)) {
        return {state: NavigationSummaryState.BLOCKED, reason: NavigationFailure.CHILD_SUMMARY_FAILED, childScopeId: childId};
      }
      if (!this.registry.current(childId)) {
        return {state: NavigationSummaryState.BLOCKED, reason: NavigationFailure.CHILD_SUMMARY_STALE, childScopeId: childId};
      }
    }

    const request = buildScopeRequest({scope, runtime: this.runtime, registry: this.registry, evidenceCache: this.evidenceCache});
    if (!request.ok) return {state: NavigationSummaryState.BLOCKED, reason: request.failure, details: request};

    const reusable = this.registry.findReusable({
      scope,
      sourceRevisionSet: request.sourceRevisionSet,
      childSummaryDependencies: request.childSummaryDependencies,
      generatorRevision: this.generatorRevision,
    });
    if (reusable) return {state: NavigationSummaryState.REUSED, summary: reusable};

    const draft = this.provider.generate(request);
    const receipt = validateNavigationSummaryDraft({draft, request});
    if (receipt.status !== NavigationQualityStatus.PASS) {
      return {state: NavigationSummaryState.INVALID, reason: receipt.validationFailures[0] || NavigationFailure.MALFORMED_OUTPUT, qualityReceipt: receipt};
    }

    const summaryRevision = this.registry.nextRevision(scope.id);
    const summary = createNavigationSummaryArtifact({
      scope,
      summaryRevision,
      sourceRevisionSet: request.sourceRevisionSet,
      childSummaryDependencies: request.childSummaryDependencies,
      content: draft.content,
      criticalEvidenceRefs: request.criticalEvidenceRefs,
      provenance: {
        kind: 'NavigationSummaryProvenance',
        targetScopeId: scope.id,
        structureRevision: scope.structureRevision,
        sourceRevisionRefs: [...request.sourceRevisionSet],
        childSummaryRefs: request.childSummaryDependencies.map((row) => row.summaryId),
        statementRefs: draft.statementRefs.map((ref) => {
          const row = request.allowedStatements.find((statement) => statement.statementId === ref);
          return {
            statementId: ref,
            sourceRevisionRefs: [...(row?.sourceRevisionRefs || [])],
            evidenceRefs: [...(row?.evidenceRefs || [])],
            childSummaryRef: row?.childSummaryRef || null,
          };
        }),
      },
      qualityReceipt: receipt,
      generatorRevision: this.generatorRevision,
    });
    return {state: NavigationSummaryState.BUILT, summary: this.registry.publish({summary, scope})};
  }

  buildAll(hierarchy, {maxUnits = LORE_WAVE3_LIMITS.maxActiveWorkBatch} = {}) {
    let session = this.start(hierarchy);
    while (session.state !== 'COMPLETED') session = this.run(session.id, {maxUnits});
    return session;
  }

  status(hierarchy = null) {
    const counts = {BUILT: 0, BLOCKED: 0, STALE: 0, REUSED: 0, PENDING: 0};
    if (hierarchy) {
      for (const scope of hierarchy.scopes) {
        const row = this.scopeStates.get(scope.id);
        const current = this.registry.current(scope.id);
        if (row?.state === NavigationSummaryState.BLOCKED || row?.state === NavigationSummaryState.INVALID) counts.BLOCKED += 1;
        else if (row?.state === NavigationSummaryState.REUSED) counts.REUSED += 1;
        else if (current) counts.BUILT += 1;
        else counts.PENDING += 1;
      }
    }
    counts.STALE = [...this.registry.summaries.values()].filter((row) => row.state === NavigationSummaryState.STALE).length;
    return {
      kind: 'LoreNavigationBuildStatus',
      counts,
      activeSessions: [...this.sessions.values()].filter((row) => row.state !== 'COMPLETED').length,
      runtimeSchedulingAuthority: false,
      physicalWorkerAuthority: false,
    };
  }

  snapshot({includeCompletedSessions = true} = {}) {
    const sessions = [...this.sessions.entries()];
    const retainedSessions = includeCompletedSessions
      ? sessions
      : sessions.filter(([, session]) => session?.state !== 'COMPLETED');
    return {
      kind: 'LoreNavigationSummaryBuilderSnapshot',
      generatorRevision: this.generatorRevision,
      sequence: this.sequence,
      sessions: retainedSessions.map(([id, session]) => [id, deepClone(session)]),
      completedSessionsOmitted: includeCompletedSessions
        ? 0
        : sessions.filter(([, session]) => session?.state === 'COMPLETED').length,
      scopeStates: [...this.scopeStates.entries()].map(([id, state]) => [id, deepClone(state)]),
    };
  }

  restore(snapshot) {
    this.generatorRevision = snapshot?.generatorRevision || this.generatorRevision;
    this.sequence = Number(snapshot?.sequence || 0);
    this.sessions = new Map((snapshot?.sessions || []).map(([id, session]) => [id, deepClone(session)]));
    this.scopeStates = new Map((snapshot?.scopeStates || []).map(([id, state]) => [id, deepClone(state)]));
    this.evidenceCache = new Map();
  }
}
