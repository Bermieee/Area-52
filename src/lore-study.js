import {
  AuthorityClass, KnowledgeStatus, MutationType,
  createClaim, createEntity, createMutationProposal, createProvenance,
} from './contracts.js';

const slug = (name) => name.toLowerCase().replace(/^the\s+/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clean = (value) => value.replace(/[.,]$/, '').trim();

function entity(name, entityType) {
  return { id: slug(name), canonicalName: clean(name).replace(/^the\s+/i, ''), entityType, aliases: [clean(name)] };
}

export class RuleBasedStudyAdapter {
  extract({ exactContent, sourceType, at = 0 }) {
    const authorityClass = sourceType === 'EXPERIENCE' ? AuthorityClass.OBSERVED : AuthorityClass.SOURCE_CANON;
    const entities = new Map();
    const claims = [];
    const relationships = [];
    const closures = [];
    const addEntity = (name, type) => { const e = entity(name, type); entities.set(e.id, e); return e.id; };
    const addClaim = (subjectId, predicate, value, temporalKind = 'CURRENT', confidence = 1) => claims.push({ subjectId, predicate, value, temporalKind, at, authorityClass, confidence });
    const addRelation = (subjectId, predicate, objectId) => relationships.push({ subjectId, predicate, objectId });

    let m;
    if ((m = exactContent.match(/^The (.+?) is intact and owned by (.+?)\.$/i))) {
      const placeId = addEntity(m[1], 'PLACE');
      const ownerId = addEntity(m[2], 'PERSON');
      addClaim(placeId, 'state', 'intact');
      addClaim(placeId, 'owner', ownerId, 'TIMELESS');
      addRelation(ownerId, 'owns', placeId);
    } else if ((m = exactContent.match(/^The (.+?) is carried by (.+?)(?: and forged by (.+?))?\.$/i))) {
      const objectId = addEntity(m[1], 'OBJECT');
      const carrierId = addEntity(m[2], 'PERSON');
      addClaim(objectId, 'location', carrierId);
      addRelation(carrierId, 'carries', objectId);
      if (m[3]) {
        const makerId = addEntity(m[3], 'PERSON');
        addClaim(objectId, 'forgedBy', makerId, 'TIMELESS');
        addRelation(makerId, 'forged', objectId);
      }
    } else if ((m = exactContent.match(/^(.+?) knows (.+?)\.$/i))) {
      const a = addEntity(m[1], 'PERSON');
      const b = addEntity(m[2], 'PERSON');
      addClaim(a, 'knows', b, 'TIMELESS');
      addRelation(a, 'knows', b);
    } else if ((m = exactContent.match(/^(.+?) leaves the (.+?) at the (.+?)\.$/i))) {
      const actor = addEntity(m[1], 'PERSON');
      const objectId = addEntity(m[2], 'OBJECT');
      const placeId = addEntity(m[3], 'PLACE');
      addClaim(objectId, 'location', placeId);
      addRelation(actor, 'left', objectId);
      addRelation(objectId, 'locatedAt', placeId);
    } else if ((m = exactContent.match(/^The (.+?) burns down\.$/i))) {
      const placeId = addEntity(m[1], 'PLACE');
      addClaim(placeId, 'state', 'destroyed');
    } else if ((m = exactContent.match(/^The (.+?) is destroyed in the fire\.$/i))) {
      const objectId = addEntity(m[1], 'OBJECT');
      addClaim(objectId, 'state', 'destroyed');
      closures.push({ subjectId: objectId, predicate: 'location', at, reason: 'destroyed-object-has-no-current-location' });
    } else {
      throw new Error(`RuleBasedStudyAdapter has no deterministic extractor for: ${exactContent}`);
    }

    return { entities: [...entities.values()], claims, relationships, closures };
  }
}

export class LoreStudyEngine {
  constructor({ registry, adapter = new RuleBasedStudyAdapter(), agent = 'lore-study:rule-reference' }) {
    this.registry = registry;
    this.adapter = adapter;
    this.agent = agent;
  }

  studySource(sourceId) {
    const source = this.registry.getSource(sourceId);
    if (!source) throw new Error(`Unknown source: ${sourceId}`);
    const revision = this.registry.getActiveRevision(sourceId);
    const at = Number.isFinite(source.metadata?.at) ? source.metadata.at : 0;
    const extracted = this.adapter.extract({ exactContent: revision.exactContent, sourceType: source.sourceType, at, source, revision });
    const contextualId = `context:${revision.id}`;
    const contextual = this.registry.registerDerivedArtifact({
      artifactId: contextualId,
      artifact: {
        kind: 'ContextualSource',
        sourceRevisionId: revision.id,
        context: { sourceType: source.sourceType, logicalKey: source.logicalKey, at },
        exactTextHash: revision.contentHash,
      },
      sourceRevisionIds: [revision.id], activity: 'CONTEXTUALIZE', agent: this.agent,
    });

    const entities = extracted.entities.map((item) => {
      const artifactId = `entity-mention:${revision.id}:${item.id}`;
      const baseProv = createProvenance({ id:`pending:${artifactId}`, sourceRevisionIds:[revision.id], activity:'ENTITY_EXTRACT', agent:this.agent });
      const built = createEntity({ ...item, provenance: baseProv });
      return this.registry.registerDerivedArtifact({ artifactId, artifact: built, sourceRevisionIds:[revision.id], dependsOnArtifactIds:[contextualId], activity:'ENTITY_EXTRACT', agent:this.agent });
    });

    const claims = extracted.claims.map((item, index) => {
      const id = `claim:${revision.id}:${index + 1}`;
      const prov = createProvenance({ id:`prov:${id}`, sourceRevisionIds:[revision.id], activity:'CLAIM_EXTRACT', agent:this.agent });
      const claim = createClaim({
        id, subjectId:item.subjectId, predicate:item.predicate, value:item.value,
        temporal:{ kind:item.temporalKind, validFrom:item.at, validUntil:null },
        authorityClass:item.authorityClass, confidence:item.confidence,
        status:KnowledgeStatus.CURRENT, provenance:prov,
      });
      return this.registry.registerDerivedArtifact({ artifactId:id, artifact:claim, sourceRevisionIds:[revision.id], dependsOnArtifactIds:[contextualId], activity:'CLAIM_EXTRACT', agent:this.agent });
    });

    const relationships = extracted.relationships.map((rel, index) => this.registry.registerDerivedArtifact({
      artifactId:`relationship:${revision.id}:${index + 1}`,
      artifact:{ kind:'Relationship', ...rel }, sourceRevisionIds:[revision.id], dependsOnArtifactIds:[contextualId], activity:'RELATIONSHIP_EXTRACT', agent:this.agent,
    }));

    const proposals = claims.map((claim) => createMutationProposal({
      id:`proposal:set:${claim.id}`, mutationType:MutationType.SET_CLAIM, owner:'WORLD_STATE', sourceRevisionIds:[revision.id], evidenceIds:[claim.id], payload:{ claim },
    }));
    for (let i = 0; i < extracted.closures.length; i += 1) {
      const closure = extracted.closures[i];
      const closureArtifactId = `closure:${revision.id}:${i + 1}`;
      this.registry.registerDerivedArtifact({ artifactId:closureArtifactId, artifact:{kind:'SlotClosure', ...closure}, sourceRevisionIds:[revision.id], dependsOnArtifactIds:[contextualId], activity:'TEMPORAL_CLASSIFY', agent:this.agent });
      proposals.push(createMutationProposal({
        id:`proposal:close:${revision.id}:${i + 1}`, mutationType:MutationType.CLOSE_SLOT, owner:'WORLD_STATE', sourceRevisionIds:[revision.id], evidenceIds:[closureArtifactId], payload:closure,
      }));
    }

    return { source, revision, contextual, entities, claims, relationships, proposals };
  }
}
