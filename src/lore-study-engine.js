import {
  ArtifactType,
  AuthorityClass,
  RetrievalForm,
  TemporalClass,
  boundedUnique,
  deepClone,
  makeArtifact,
  slug,
  stableHash,
  stableStringify,
} from './lore-contracts.js';

export const STUDY_UNITS = Object.freeze([
  'STRUCTURE_CONTEXT',
  'ENTITY_ALIAS',
  'CLAIM_RELATIONSHIP',
  'TEMPORAL_ONTOLOGY',
  'RETRIEVAL',
  'COMPILE',
  'VALIDATE',
]);

const MAX_SENTENCES = 96;
const MAX_CHUNKS = 24;
const MAX_ENTITIES = 96;
const MAX_CLAIMS = 192;
const MAX_RELATIONSHIPS = 128;
const MAX_CONCEPTS = 128;
const MAX_RETRIEVAL_FORMS = 32;

function cleanName(value) {
  return String(value || '').trim().replace(/^[\s"'“”‘’]+|[\s"'“”‘’.,!?;:]+$/g, '').replace(/^the\s+/i, '');
}

function splitSentences(content) {
  return String(content || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, MAX_SENTENCES);
}

function spanFor(sentence, sentenceIndex) {
  return {sentenceIndex, textHash: stableHash(sentence), length: sentence.length};
}

function inferEntityType(name) {
  const value = String(name);
  if (/\b(tavern|inn|house|hall|tower|city|kingdom|forest|temple|forge|shop|market)\b/i.test(value)) return 'LOCATION';
  if (/\b(blade|sword|dagger|spear|shield|ring|amulet|book|key|orb|staff)\b/i.test(value)) return 'OBJECT';
  if (/\b(guild|familia|order|company|clan|faction|council)\b/i.test(value)) return 'ORGANIZATION';
  if (/\b(fire|war|incident|festival|battle)\b/i.test(value)) return 'EVENT';
  return 'PERSON';
}

function temporalFor(sentence) {
  if (/\b(unclear|unknown|rumou?r|report(?:s|ed)?|claims?|may|might|possibly|perhaps|either)\b/i.test(sentence)) return TemporalClass.UNCERTAIN;
  if (/\b(formerly|once|used to|previously|before|had|was|were|carried)\b/i.test(sentence)) return TemporalClass.HISTORICAL;
  if (/\b(later|after|then|subsequently)\b/i.test(sentence)) return TemporalClass.SEQUENCE;
  if (/\b(currently|now|today|remains|is|owns|knows|carries)\b/i.test(sentence)) return TemporalClass.CURRENT;
  return TemporalClass.TIMELESS;
}

function authorityFor(sentence) {
  return /\b(unclear|unknown|rumou?r|report(?:s|ed)?|claims?|may|might|possibly|perhaps|either)\b/i.test(sentence)
    ? AuthorityClass.UNRESOLVED
    : AuthorityClass.SOURCE_CANON;
}

function confidenceFor(sentence) {
  if (/\b(rumou?r|possibly|perhaps|might|may)\b/i.test(sentence)) return 0.45;
  if (/\b(report(?:s|ed)?|claims?|witness)\b/i.test(sentence)) return 0.6;
  return 1;
}

function normalizedTokens(text) {
  return boundedUnique(
    String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g) || [],
    96,
  );
}

function createWorkspace(source, revision) {
  return {
    source: deepClone(source),
    revision: deepClone(revision),
    sentences: splitSentences(revision.exactContent || ''),
    artifacts: [],
    entities: {},
    aliasRows: [],
    claimRows: [],
    relationshipRows: [],
    conceptRows: [],
    warnings: [],
    unitReceipts: [],
    validation: null,
  };
}

function addArtifact(workspace, artifact) {
  if (!workspace.artifacts.some((row) => row.id === artifact.id)) workspace.artifacts.push(artifact);
  return artifact;
}

function ensureEntity(workspace, rawName, type = null, sentenceIndex = null) {
  const name = cleanName(rawName);
  if (!name) return null;
  const entityId = 'entity:' + slug(name);
  const existing = workspace.entities[entityId];
  const entityType = type || existing?.entityType || inferEntityType(name);
  const aliases = boundedUnique([...(existing?.aliases || []), name], 16);
  workspace.entities[entityId] = {
    entityId,
    canonicalName: existing?.canonicalName || name,
    entityType,
    aliases,
    evidenceSentenceIndexes: boundedUnique([...(existing?.evidenceSentenceIndexes || []), sentenceIndex].filter(Number.isInteger), 32),
  };
  return entityId;
}

function relationKey(subjectId, predicate, objectId) {
  return subjectId + '|' + predicate + '|' + objectId;
}

function claimKey(subjectId, predicate, value) {
  return subjectId + '|' + predicate + '|' + stableStringify(value);
}

function pushClaim(workspace, sentence, sentenceIndex, subjectId, predicate, value, extra = {}) {
  if (workspace.claimRows.length >= MAX_CLAIMS) return;
  const temporalClass = extra.temporalClass || temporalFor(sentence);
  const authorityClass = extra.authorityClass || authorityFor(sentence);
  const unresolved = extra.unresolved ?? (authorityClass === AuthorityClass.UNRESOLVED || temporalClass === TemporalClass.UNCERTAIN);
  workspace.claimRows.push({
    logicalKey: claimKey(subjectId, predicate, value),
    subjectId,
    predicate,
    value,
    temporalClass,
    authorityClass,
    confidence: extra.confidence ?? confidenceFor(sentence),
    unresolved,
    sentenceIndex,
    qualifier: extra.qualifier || null,
  });
}

function pushRelationship(workspace, sentence, sentenceIndex, subjectId, predicate, objectId, extra = {}) {
  if (workspace.relationshipRows.length >= MAX_RELATIONSHIPS) return;
  const temporalClass = extra.temporalClass || temporalFor(sentence);
  const authorityClass = extra.authorityClass || authorityFor(sentence);
  workspace.relationshipRows.push({
    logicalKey: relationKey(subjectId, predicate, objectId),
    subjectId,
    predicate,
    objectId,
    temporalClass,
    authorityClass,
    confidence: extra.confidence ?? confidenceFor(sentence),
    unresolved: extra.unresolved ?? (authorityClass === AuthorityClass.UNRESOLVED),
    sentenceIndex,
  });
}

function analyzeSentence(workspace, sentence, index) {
  let match;
  const s = sentence.replace(/\s+/g, ' ').trim();

  if ((match = s.match(/^(.+?),\s+also\s+(?:called|known as)\s+(.+?),\s+owns\s+(?:the\s+)?(.+?)[.!?]?$/i))) {
    const owner = ensureEntity(workspace, match[1], 'PERSON', index);
    const alias = cleanName(match[2]);
    const target = ensureEntity(workspace, match[3], null, index);
    workspace.entities[owner].aliases = boundedUnique([...workspace.entities[owner].aliases, alias], 16);
    pushClaim(workspace, s, index, target, 'owner', owner, {temporalClass: TemporalClass.CURRENT});
    pushRelationship(workspace, s, index, owner, 'owns', target, {temporalClass: TemporalClass.CURRENT});
    return;
  }

  if ((match = s.match(/^(.+?)\s+(?:is\s+)?also\s+(?:called|known as)\s+(.+?)[.!?]?$/i))) {
    const entity = ensureEntity(workspace, match[1], null, index);
    workspace.entities[entity].aliases = boundedUnique([...workspace.entities[entity].aliases, cleanName(match[2])], 16);
    return;
  }

  if ((match = s.match(/^(.+?)\s+owns\s+(?:the\s+)?(.+?)[.!?]?$/i))) {
    const owner = ensureEntity(workspace, match[1], 'PERSON', index);
    const target = ensureEntity(workspace, match[2], null, index);
    pushClaim(workspace, s, index, target, 'owner', owner, {temporalClass: TemporalClass.CURRENT});
    pushRelationship(workspace, s, index, owner, 'owns', target, {temporalClass: TemporalClass.CURRENT});
    return;
  }

  if ((match = s.match(/^(.+?)\s+knows\s+(.+?)[.!?]?$/i))) {
    const a = ensureEntity(workspace, match[1], 'PERSON', index);
    const b = ensureEntity(workspace, match[2], 'PERSON', index);
    pushClaim(workspace, s, index, a, 'knows', b, {temporalClass: TemporalClass.TIMELESS});
    pushRelationship(workspace, s, index, a, 'knows', b, {temporalClass: TemporalClass.TIMELESS});
    return;
  }

  if ((match = s.match(/^(.+?)\s+(?:carried|carries)\s+(?:the\s+)?(.+?)[.!?]?$/i))) {
    const actor = ensureEntity(workspace, match[1], 'PERSON', index);
    const object = ensureEntity(workspace, match[2], 'OBJECT', index);
    const temporalClass = /\bcarried\b/i.test(s) ? TemporalClass.HISTORICAL : TemporalClass.CURRENT;
    pushClaim(workspace, s, index, object, 'possessor', actor, {temporalClass});
    pushRelationship(workspace, s, index, actor, 'carried', object, {temporalClass});
    return;
  }

  if ((match = s.match(/^(.+?)\s+(?:later\s+)?left\s+(?:the\s+)?(.+?)\s+at\s+(?:the\s+)?(.+?)[.!?]?$/i))) {
    const actor = ensureEntity(workspace, match[1], 'PERSON', index);
    const object = ensureEntity(workspace, match[2], 'OBJECT', index);
    const location = ensureEntity(workspace, match[3], 'LOCATION', index);
    pushClaim(workspace, s, index, object, 'location', location, {temporalClass: TemporalClass.SEQUENCE});
    pushRelationship(workspace, s, index, actor, 'leftAt', object, {temporalClass: TemporalClass.HISTORICAL});
    pushRelationship(workspace, s, index, object, 'locatedAt', location, {temporalClass: TemporalClass.SEQUENCE});
    return;
  }

  if ((match = s.match(/^(?:The\s+)?(.+?)\s+(?:later\s+)?(?:burned|burned down|was destroyed in (?:the\s+)?fire)[.!?]?$/i))) {
    const entity = ensureEntity(workspace, match[1], null, index);
    pushClaim(workspace, s, index, entity, 'state', 'destroyed', {temporalClass: TemporalClass.CURRENT});
    return;
  }

  if ((match = s.match(/^(?:A\s+)?(?:witness\s+)?(?:report(?:s|ed)?|claim(?:s|ed)?|rumou?r(?:s|ed)?)\s+(?:that\s+)?(?:the\s+)?(.+?)\s+(?:was\s+)?removed\s+(?:shortly\s+)?before\s+(?:the\s+)?fire[.!?]?$/i))) {
    const object = ensureEntity(workspace, match[1], 'OBJECT', index);
    pushClaim(workspace, s, index, object, 'fate', 'removed-before-fire', {
      temporalClass: TemporalClass.UNCERTAIN,
      authorityClass: AuthorityClass.UNRESOLVED,
      confidence: confidenceFor(s),
      unresolved: true,
      qualifier: 'reported',
    });
    return;
  }

  if ((match = s.match(/^(?:A\s+)?(?:witness\s+)?(?:report(?:s|ed)?|claim(?:s|ed)?|rumou?r(?:s|ed)?)\s+(?:that\s+)?(?:the\s+)?(.+?)\s+(?:was\s+)?destroyed\s+in\s+(?:the\s+)?fire[.!?]?$/i))) {
    const object = ensureEntity(workspace, match[1], 'OBJECT', index);
    pushClaim(workspace, s, index, object, 'fate', 'destroyed-in-fire', {
      temporalClass: TemporalClass.UNCERTAIN,
      authorityClass: AuthorityClass.UNRESOLVED,
      confidence: confidenceFor(s),
      unresolved: true,
      qualifier: 'reported',
    });
    return;
  }

  if ((match = s.match(/^(?:The\s+)?(.+?)\s+was\s+destroyed\s+in\s+(?:the\s+)?(.+?)\s+fire[.!?]?$/i))) {
    const object = ensureEntity(workspace, match[1], 'OBJECT', index);
    const place = ensureEntity(workspace, match[2], 'LOCATION', index);
    pushClaim(workspace, s, index, object, 'fate', 'destroyed-in-fire', {temporalClass: TemporalClass.HISTORICAL});
    pushRelationship(workspace, s, index, object, 'destroyedAt', place, {temporalClass: TemporalClass.HISTORICAL});
    return;
  }

  if ((match = s.match(/^(?:The\s+)?(.+?)\s+is\s+(?:an?\s+)?(.+?)[.!?]?$/i))) {
    const subject = ensureEntity(workspace, match[1], null, index);
    const value = cleanName(match[2]).toLowerCase();
    if (['destroyed', 'damaged', 'intact', 'lost', 'missing'].includes(value)) {
      pushClaim(workspace, s, index, subject, 'state', value, {temporalClass: TemporalClass.CURRENT});
    } else {
      pushClaim(workspace, s, index, subject, 'type', value, {temporalClass: TemporalClass.TIMELESS});
    }
    return;
  }

  const candidates = s.match(/\b[A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*){0,3}\b/g) || [];
  for (const candidate of candidates.slice(0, 8)) {
    if (/^(The|A|An|Later|Before|After)$/i.test(candidate)) continue;
    ensureEntity(workspace, candidate, null, index);
  }
  workspace.warnings.push({
    kind: 'UnresolvedSourceFragment',
    sentenceIndex: index,
    textHash: stableHash(s),
    status: 'INSUFFICIENT_STRUCTURED_EVIDENCE',
  });
}

function finalizeEntities(workspace) {
  const rows = Object.values(workspace.entities).slice(0, MAX_ENTITIES);
  for (const row of rows) {
    const artifact = makeArtifact({
      type: ArtifactType.ENTITY,
      sourceId: workspace.source.sourceId,
      sourceRevisionId: workspace.revision.id,
      logicalKey: row.entityId,
      payload: {
        entityId: row.entityId,
        canonicalName: row.canonicalName,
        entityType: row.entityType,
        aliases: row.aliases,
      },
      derivation: 'ENTITY_EXTRACTION',
      dependencies: [],
      authorityClass: AuthorityClass.DERIVED,
      temporalClass: TemporalClass.TIMELESS,
    });
    addArtifact(workspace, artifact);
    for (const alias of row.aliases.slice(1, 8)) {
      const aliasArtifact = makeArtifact({
        type: ArtifactType.ALIAS,
        sourceId: workspace.source.sourceId,
        sourceRevisionId: workspace.revision.id,
        logicalKey: row.entityId + '|alias|' + alias.toLowerCase(),
        payload: {entityId: row.entityId, alias, certainty: 'SUPPORTED'},
        derivation: 'ALIAS_EXTRACTION',
        dependencies: [artifact.id],
        authorityClass: AuthorityClass.DERIVED,
      });
      addArtifact(workspace, aliasArtifact);
    }
  }
}

function finalizeClaims(workspace) {
  const seen = new Set();
  for (const row of workspace.claimRows) {
    if (seen.has(row.logicalKey)) continue;
    seen.add(row.logicalKey);
    const artifact = makeArtifact({
      type: ArtifactType.CLAIM,
      sourceId: workspace.source.sourceId,
      sourceRevisionId: workspace.revision.id,
      logicalKey: row.logicalKey,
      payload: {
        claimId: 'claim:' + stableHash(row.logicalKey),
        subjectId: row.subjectId,
        predicate: row.predicate,
        value: row.value,
        qualifier: row.qualifier,
      },
      span: spanFor(workspace.sentences[row.sentenceIndex] || '', row.sentenceIndex),
      derivation: 'ATOMIC_CLAIM_EXTRACTION',
      authorityClass: row.authorityClass,
      temporalClass: row.temporalClass,
      confidence: row.confidence,
      unresolved: row.unresolved,
    });
    addArtifact(workspace, artifact);
  }

  const relationSeen = new Set();
  for (const row of workspace.relationshipRows) {
    if (relationSeen.has(row.logicalKey)) continue;
    relationSeen.add(row.logicalKey);
    const supporting = workspace.artifacts
      .filter((artifact) => artifact.artifactType === ArtifactType.CLAIM && artifact.provenance.span?.sentenceIndex === row.sentenceIndex)
      .map((artifact) => artifact.id);
    addArtifact(workspace, makeArtifact({
      type: ArtifactType.RELATIONSHIP,
      sourceId: workspace.source.sourceId,
      sourceRevisionId: workspace.revision.id,
      logicalKey: row.logicalKey,
      payload: {
        relationshipId: 'relationship:' + stableHash(row.logicalKey),
        subjectId: row.subjectId,
        predicate: row.predicate,
        objectId: row.objectId,
        supportingClaimIds: supporting,
        sourceAuthorityClass: row.authorityClass,
      },
      span: spanFor(workspace.sentences[row.sentenceIndex] || '', row.sentenceIndex),
      derivation: 'RELATIONSHIP_EXTRACTION',
      dependencies: supporting,
      authorityClass: row.authorityClass === AuthorityClass.UNRESOLVED ? AuthorityClass.UNRESOLVED : AuthorityClass.DERIVED,
      temporalClass: row.temporalClass,
      confidence: row.confidence,
      unresolved: row.unresolved,
    }));
  }
}

function deriveOntology(workspace) {
  const concepts = [];
  const entities = workspace.artifacts.filter((artifact) => artifact.artifactType === ArtifactType.ENTITY);
  for (const entity of entities) {
    const type = entity.payload.entityType.toLowerCase();
    concepts.push({entityId: entity.payload.entityId, concept: type, parent: 'world-entity', authority: AuthorityClass.DERIVED, evidence: entity.id});
    const name = entity.payload.canonicalName;
    if (/\btavern\b/i.test(name)) {
      concepts.push({entityId: entity.payload.entityId, concept: 'tavern', parent: 'location', authority: AuthorityClass.INFERRED, evidence: entity.id});
      concepts.push({entityId: entity.payload.entityId, concept: 'business', parent: 'location', authority: AuthorityClass.INFERRED, evidence: entity.id});
    }
    if (/\b(blade|sword)\b/i.test(name)) {
      concepts.push({entityId: entity.payload.entityId, concept: 'sword', parent: 'weapon', authority: AuthorityClass.INFERRED, evidence: entity.id});
      concepts.push({entityId: entity.payload.entityId, concept: 'weapon', parent: 'object', authority: AuthorityClass.INFERRED, evidence: entity.id});
    }
  }
  const ownerships = workspace.artifacts.filter((artifact) => artifact.artifactType === ArtifactType.RELATIONSHIP && artifact.payload.predicate === 'owns');
  for (const relationship of ownerships) {
    concepts.push({
      entityId: relationship.payload.subjectId,
      concept: 'proprietor',
      parent: 'person-role',
      authority: AuthorityClass.INFERRED,
      evidence: relationship.id,
    });
  }

  const seen = new Set();
  for (const row of concepts.slice(0, MAX_CONCEPTS)) {
    const key = row.entityId + '|' + row.concept + '|' + row.parent;
    if (seen.has(key)) continue;
    seen.add(key);
    addArtifact(workspace, makeArtifact({
      type: ArtifactType.CONCEPT,
      sourceId: workspace.source.sourceId,
      sourceRevisionId: workspace.revision.id,
      logicalKey: key,
      payload: {
        entityId: row.entityId,
        concept: row.concept,
        parentConcept: row.parent,
        membership: 'DERIVED',
      },
      derivation: 'ONTOLOGY_FOUNDATION',
      dependencies: [row.evidence],
      authorityClass: row.authority,
      temporalClass: TemporalClass.TIMELESS,
    }));
  }

  const groups = new Map();
  for (const concept of workspace.artifacts.filter((artifact) => artifact.artifactType === ArtifactType.CONCEPT)) {
    const key = concept.payload.parentConcept;
    const ids = groups.get(key) || [];
    ids.push(concept.payload.entityId);
    groups.set(key, ids);
  }
  for (const [parentConcept, entityIds] of groups.entries()) {
    const uniqueIds = boundedUnique(entityIds, 64);
    addArtifact(workspace, makeArtifact({
      type: ArtifactType.COMMUNITY,
      sourceId: workspace.source.sourceId,
      sourceRevisionId: workspace.revision.id,
      logicalKey: 'community|' + parentConcept,
      payload: {
        communityId: 'community:' + slug(parentConcept),
        label: parentConcept,
        entityIds: uniqueIds,
      },
      derivation: 'HIERARCHY_COMMUNITY_FOUNDATION',
      dependencies: workspace.artifacts.filter((artifact) => artifact.artifactType === ArtifactType.CONCEPT && artifact.payload.parentConcept === parentConcept).map((artifact) => artifact.id),
      authorityClass: AuthorityClass.DERIVED,
    }));
  }
}

function retrievalArtifacts(workspace) {
  const title = workspace.revision.metadata?.title || workspace.source.uid;
  const entityNames = Object.values(workspace.entities).map((row) => row.canonicalName);
  const aliases = Object.values(workspace.entities).flatMap((row) => row.aliases);
  const claimTokens = workspace.artifacts
    .filter((artifact) => artifact.artifactType === ArtifactType.CLAIM)
    .flatMap((artifact) => [artifact.payload.subjectId, artifact.payload.predicate, String(artifact.payload.value)]);
  const sparseTerms = boundedUnique(normalizedTokens([title, ...entityNames, ...aliases, ...claimTokens, workspace.revision.exactContent].join(' ')), 96);
  const contextPrefix = [
    'Lorebook=' + workspace.source.lorebookId,
    'UID=' + workspace.source.uid,
    'Title=' + String(title),
    workspace.revision.metadata?.treePath?.length ? 'Path=' + workspace.revision.metadata.treePath.join(' > ') : null,
    entityNames.length ? 'Entities=' + entityNames.join(', ') : null,
  ].filter(Boolean).join(' | ');

  const forms = [
    {
      form: RetrievalForm.CONTEXTUAL_SPARSE,
      payload: {form: RetrievalForm.CONTEXTUAL_SPARSE, terms: sparseTerms, context: contextPrefix},
    },
    {
      form: RetrievalForm.DENSE_READY,
      payload: {
        form: RetrievalForm.DENSE_READY,
        text: contextPrefix + '\n' + workspace.revision.exactContent,
        embedding: null,
        embeddingAuthority: false,
      },
    },
    {
      form: RetrievalForm.PRECISION_READY,
      payload: {
        form: RetrievalForm.PRECISION_READY,
        tokenTerms: sparseTerms,
        entityIds: Object.keys(workspace.entities).sort(),
        claimSemanticIds: workspace.artifacts.filter((artifact) => artifact.artifactType === ArtifactType.CLAIM).map((artifact) => artifact.semanticId).sort(),
        scoreAuthority: false,
      },
    },
  ];

  for (const row of forms.slice(0, MAX_RETRIEVAL_FORMS)) {
    addArtifact(workspace, makeArtifact({
      type: ArtifactType.RETRIEVAL,
      sourceId: workspace.source.sourceId,
      sourceRevisionId: workspace.revision.id,
      logicalKey: 'retrieval|' + row.form,
      payload: row.payload,
      derivation: 'RETRIEVAL_REPRESENTATION',
      dependencies: workspace.artifacts.filter((artifact) => [ArtifactType.ENTITY, ArtifactType.CLAIM, ArtifactType.RELATIONSHIP].includes(artifact.artifactType)).map((artifact) => artifact.id),
      authorityClass: AuthorityClass.DERIVED,
    }));
  }
}

function compileArtifact(workspace) {
  const claims = workspace.artifacts.filter((artifact) => artifact.artifactType === ArtifactType.CLAIM);
  const relationships = workspace.artifacts.filter((artifact) => artifact.artifactType === ArtifactType.RELATIONSHIP);
  const concepts = workspace.artifacts.filter((artifact) => artifact.artifactType === ArtifactType.CONCEPT);
  const compact = {
    sourceRef: workspace.revision.id,
    entities: Object.values(workspace.entities).map((row) => [row.entityId, row.entityType]).sort(),
    claims: claims.map((row) => [row.payload.subjectId, row.payload.predicate, row.payload.value, row.temporalClass, row.unresolved]).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
    relationships: relationships.map((row) => [row.payload.subjectId, row.payload.predicate, row.payload.objectId, row.temporalClass]).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
    concepts: concepts.map((row) => [row.payload.entityId, row.payload.concept, row.payload.parentConcept]).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
    unresolvedCount: claims.filter((row) => row.unresolved).length,
  };
  addArtifact(workspace, makeArtifact({
    type: ArtifactType.COMPACT,
    sourceId: workspace.source.sourceId,
    sourceRevisionId: workspace.revision.id,
    logicalKey: 'compact|' + workspace.source.sourceId,
    payload: {
      form: RetrievalForm.COMPACT_LEARNED,
      representation: compact,
    },
    derivation: 'COMPILED_LEARNED_REPRESENTATION',
    dependencies: [...claims, ...relationships, ...concepts].map((artifact) => artifact.id),
    authorityClass: AuthorityClass.DERIVED,
  }));
}

export function semanticDiff(previousArtifacts, nextArtifacts) {
  const before = new Map((previousArtifacts || []).map((row) => [row.semanticId, row]));
  const after = new Map((nextArtifacts || []).map((row) => [row.semanticId, row]));
  const added = [...after.keys()].filter((key) => !before.has(key)).sort();
  const removed = [...before.keys()].filter((key) => !after.has(key)).sort();
  const preserved = [...after.keys()].filter((key) => before.has(key)).sort();

  const claimSlot = (artifact) => artifact.artifactType === ArtifactType.CLAIM
    ? artifact.payload.subjectId + '|' + artifact.payload.predicate
    : null;
  const beforeSlots = new Map();
  const afterSlots = new Map();
  for (const artifact of before.values()) {
    const key = claimSlot(artifact);
    if (key) beforeSlots.set(key, artifact);
  }
  for (const artifact of after.values()) {
    const key = claimSlot(artifact);
    if (key) afterSlots.set(key, artifact);
  }
  const changed = [];
  for (const [slot, oldArtifact] of beforeSlots.entries()) {
    const nextArtifact = afterSlots.get(slot);
    if (!nextArtifact) continue;
    const valueChanged = stableStringify(oldArtifact.payload.value) !== stableStringify(nextArtifact.payload.value);
    const temporalChanged = oldArtifact.temporalClass !== nextArtifact.temporalClass;
    const authorityChanged = oldArtifact.authorityClass !== nextArtifact.authorityClass || oldArtifact.unresolved !== nextArtifact.unresolved;
    if (valueChanged || temporalChanged || authorityChanged) {
      changed.push({
        slot,
        from: deepClone(oldArtifact.payload.value),
        to: deepClone(nextArtifact.payload.value),
        oldSemanticId: oldArtifact.semanticId,
        newSemanticId: nextArtifact.semanticId,
        valueChanged,
        temporalChanged,
        authorityChanged,
        oldTemporalClass: oldArtifact.temporalClass,
        newTemporalClass: nextArtifact.temporalClass,
      });
    }
  }
  const typeCounts = (ids, map) => {
    const counts = {};
    for (const id of ids) {
      const artifact = map.get(id);
      const type = artifact?.artifactType || 'UNKNOWN';
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  };
  return {
    kind: 'LoreSemanticDiff',
    addedSemanticIds: added,
    removedSemanticIds: removed,
    preservedSemanticIds: preserved,
    changed,
    addedByType: typeCounts(added, after),
    removedByType: typeCounts(removed, before),
    temporalMeaningChanged: changed.some((row) => row.temporalChanged),
    authorityMeaningChanged: changed.some((row) => row.authorityChanged),
    claimAdded: added.filter((id) => id.includes(':claim:')).length,
    claimRemoved: removed.filter((id) => id.includes(':claim:')).length,
    meaningChanged: added.length > 0 || removed.length > 0 || changed.length > 0,
    lineDiffAuthority: false,
  };
}

export class LoreStudyEngine {
  createSession({source, revision}) {
    if (!source || !revision) throw new TypeError('Source and revision are required');
    return {
      kind: 'LoreStudySession',
      id: 'study:' + stableHash(source.sourceId + '|' + revision.id),
      sourceId: source.sourceId,
      sourceRevisionId: revision.id,
      unitIndex: 0,
      units: [...STUDY_UNITS],
      workspace: createWorkspace(source, revision),
      complete: false,
      valid: null,
    };
  }

  step(session) {
    if (session.complete) return deepClone(session);
    const unit = session.units[session.unitIndex];
    const workspace = session.workspace;
    if (!unit) throw new Error('Study session has no remaining unit');

    if (unit === 'STRUCTURE_CONTEXT') {
      addArtifact(workspace, makeArtifact({
        type: ArtifactType.STRUCTURE,
        sourceId: workspace.source.sourceId,
        sourceRevisionId: workspace.revision.id,
        logicalKey: 'structure|' + workspace.source.sourceId,
        payload: {
          lorebookId: workspace.source.lorebookId,
          uid: workspace.source.uid,
          title: workspace.revision.metadata?.title || null,
          treePath: workspace.revision.metadata?.treePath || [],
          tags: workspace.revision.metadata?.tags || [],
          scope: workspace.revision.metadata?.scope || null,
          sourceOrder: workspace.revision.metadata?.order ?? null,
          truthAuthority: false,
        },
        derivation: 'STRUCTURAL_READING',
        authorityClass: AuthorityClass.DERIVED,
      }));
      const sentences = workspace.sentences;
      for (let i = 0; i < sentences.length && i < MAX_CHUNKS; i += 2) {
        const chunk = sentences.slice(i, i + 2);
        addArtifact(workspace, makeArtifact({
          type: ArtifactType.CONTEXT_CHUNK,
          sourceId: workspace.source.sourceId,
          sourceRevisionId: workspace.revision.id,
          logicalKey: 'chunk|' + i + '|' + chunk.map(stableHash).join('|'),
          payload: {
            chunkIndex: i / 2,
            sentenceIndexes: chunk.map((_, offset) => i + offset),
            text: chunk.join(' '),
            context: {
              lorebookId: workspace.source.lorebookId,
              uid: workspace.source.uid,
              title: workspace.revision.metadata?.title || null,
              treePath: workspace.revision.metadata?.treePath || [],
            },
          },
          derivation: 'CONTEXTUALIZATION',
          authorityClass: AuthorityClass.DERIVED,
        }));
      }
    } else if (unit === 'ENTITY_ALIAS') {
      workspace.sentences.forEach((sentence, index) => analyzeSentence(workspace, sentence, index));
      finalizeEntities(workspace);
    } else if (unit === 'CLAIM_RELATIONSHIP') {
      finalizeClaims(workspace);
    } else if (unit === 'TEMPORAL_ONTOLOGY') {
      deriveOntology(workspace);
    } else if (unit === 'RETRIEVAL') {
      retrievalArtifacts(workspace);
    } else if (unit === 'COMPILE') {
      compileArtifact(workspace);
    } else if (unit === 'VALIDATE') {
      workspace.validation = this.validateWorkspace(workspace);
      session.valid = workspace.validation.ok;
    }

    workspace.unitReceipts.push({
      kind: 'LoreStudyUnitReceipt',
      unit,
      index: session.unitIndex,
      artifactCount: workspace.artifacts.length,
      checksum: stableHash(workspace.artifacts.map((artifact) => artifact.id)),
    });
    session.unitIndex += 1;
    session.complete = session.unitIndex >= session.units.length;
    return deepClone(session);
  }

  runToCompletion(session) {
    let current = deepClone(session);
    while (!current.complete) current = this.step(current);
    return current;
  }

  validateWorkspace(workspace) {
    const failures = [];
    const ids = new Set();
    for (const artifact of workspace.artifacts) {
      if (ids.has(artifact.id)) failures.push('duplicate-artifact:' + artifact.id);
      ids.add(artifact.id);
      if (artifact.sourceId !== workspace.source.sourceId) failures.push('source-id:' + artifact.id);
      if (artifact.sourceRevisionId !== workspace.revision.id) failures.push('source-revision:' + artifact.id);
      if (artifact.provenance?.sourceRevisionId !== workspace.revision.id) failures.push('provenance:' + artifact.id);
      if (artifact.authorityClass === AuthorityClass.SOURCE_CANON && artifact.artifactType !== ArtifactType.CLAIM) {
        failures.push('authority-promotion:' + artifact.id);
      }
      if ([ArtifactType.CONCEPT, ArtifactType.COMMUNITY, ArtifactType.RETRIEVAL, ArtifactType.COMPACT, ArtifactType.STRUCTURE, ArtifactType.CONTEXT_CHUNK].includes(artifact.artifactType)
        && artifact.authorityClass === AuthorityClass.SOURCE_CANON) {
        failures.push('derived-became-source:' + artifact.id);
      }
    }
    const bounds = {
      chunks: workspace.artifacts.filter((row) => row.artifactType === ArtifactType.CONTEXT_CHUNK).length <= MAX_CHUNKS,
      entities: workspace.artifacts.filter((row) => row.artifactType === ArtifactType.ENTITY).length <= MAX_ENTITIES,
      claims: workspace.artifacts.filter((row) => row.artifactType === ArtifactType.CLAIM).length <= MAX_CLAIMS,
      relationships: workspace.artifacts.filter((row) => row.artifactType === ArtifactType.RELATIONSHIP).length <= MAX_RELATIONSHIPS,
      concepts: workspace.artifacts.filter((row) => row.artifactType === ArtifactType.CONCEPT).length <= MAX_CONCEPTS,
      retrieval: workspace.artifacts.filter((row) => row.artifactType === ArtifactType.RETRIEVAL).length <= MAX_RETRIEVAL_FORMS,
    };
    if (Object.values(bounds).some((value) => !value)) failures.push('artifact-bounds');
    return {
      kind: 'LoreStudyValidation',
      ok: failures.length === 0,
      failures,
      bounds,
      artifactCount: workspace.artifacts.length,
      sourcePreservedExternally: true,
      sourceAuthorityPromotions: failures.filter((failure) => failure.startsWith('authority-promotion') || failure.startsWith('derived-became-source')).length,
    };
  }
}
