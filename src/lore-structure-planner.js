import {ArtifactType, deepClone, slug, stableHash, stableStringify} from './lore-contracts.js';
import {LoreReviewState, LoreTreeAction, makeReviewItem, sourceRevisionIdentity} from './lore-authoring-contracts.js';

function currentStudiedSource(intelligence, source) {
  const revision = intelligence.runtime.registry.currentRevision(source.sourceId, {allowMissing: true});
  const learned = intelligence.runtime.store.currentLearnedRevision(source.sourceId);
  if (!revision || revision.state === 'REMOVED' || !learned || learned.state !== 'CURRENT' || learned.sourceRevisionId !== revision.id) {
    return null;
  }
  return {source, revision, learned, artifacts: intelligence.runtime.store.artifactsForLearnedRevision(learned.id)};
}

function pathKey(lorebookId, path) {
  return lorebookId + '|' + (path || []).join('>');
}

function proposalId(payload) {
  return 'lore-tree-proposal:' + stableHash(payload);
}

function makeProposal(action, payload, {state = LoreReviewState.PROPOSED, confidence = 1} = {}) {
  const row = {
    kind: 'LoreStructureProposal',
    action,
    state,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
    ...deepClone(payload),
    automaticMutation: false,
    truthAuthority: false,
  };
  return {...row, id: proposalId(row)};
}

function intersectionSize(a, b) {
  let count = 0;
  for (const value of a) if (b.has(value)) count += 1;
  return count;
}

function canonicalSiblingLabel(labels) {
  return [...labels].sort((a, b) => {
    const ta = a.trim();
    const tb = b.trim();
    if (ta.length !== tb.length) return ta.length - tb.length;
    return ta.localeCompare(tb);
  })[0];
}

export class LoreStructurePlanner {
  constructor({intelligence} = {}) {
    if (!intelligence) throw new TypeError('LoreStructurePlanner requires LoreIntelligenceService');
    this.intelligence = intelligence;
  }

  plan({lorebookIds = null} = {}) {
    const wantedBooks = lorebookIds ? new Set(lorebookIds.map(String)) : null;
    const registry = this.intelligence.runtime.registry;
    const rows = registry.listEntries({includeRemoved: false})
      .filter((source) => !wantedBooks || wantedBooks.has(source.lorebookId))
      .map((source) => currentStudiedSource(this.intelligence, source))
      .filter(Boolean);
    const sourceById = new Map(rows.map((row) => [row.source.sourceId, row]));
    const sourceRevisionFence = rows.map((row) => row.revision.id).sort();
    const ontology = this.intelligence.ontology.current();
    const relevantSourceIds = new Set(rows.map((row) => row.source.sourceId));

    const semanticMemberships = [];
    const membershipBySource = new Map();
    for (const row of rows) {
      const memberships = row.artifacts
        .filter((artifact) => artifact.artifactType === ArtifactType.CONCEPT)
        .map((artifact) => ({
          kind: 'SemanticMembership',
          sourceId: row.source.sourceId,
          sourceRevisionId: row.revision.id,
          conceptRef: 'concept:' + artifact.payload.concept,
          concept: artifact.payload.concept,
          parentConcept: artifact.payload.parentConcept || null,
          entityId: artifact.payload.entityId,
          evidenceArtifactId: artifact.id,
          authorityClass: artifact.authorityClass,
          unresolved: Boolean(artifact.unresolved),
          treeMutationAuthority: false,
        }))
        .sort((a, b) => (a.conceptRef + a.entityId).localeCompare(b.conceptRef + b.entityId));
      semanticMemberships.push(...memberships);
      membershipBySource.set(row.source.sourceId, memberships);
    }

    const authoredHomes = rows.map((row) => ({
      sourceId: row.source.sourceId,
      sourceRevisionId: row.revision.id,
      lorebookId: row.source.lorebookId,
      uid: row.source.uid,
      title: row.revision.metadata?.title || row.source.uid,
      treePath: [...(row.revision.metadata?.treePath || [])],
      sourceAuthority: true,
      navigationChoice: true,
      semanticTruthAuthority: false,
    }));

    const communities = (ontology.communities || [])
      .filter((community) => community.sourceIds.some((id) => relevantSourceIds.has(id)))
      .map((community) => ({
        ...deepClone(community),
        sourceIds: community.sourceIds.filter((id) => relevantSourceIds.has(id)).sort(),
      }))
      .filter((community) => community.sourceIds.length >= 2);

    const communityBySource = new Map();
    for (const community of communities) {
      for (const sourceId of community.sourceIds) {
        const bucket = communityBySource.get(sourceId) || [];
        bucket.push(community);
        communityBySource.set(sourceId, bucket);
      }
    }

    const proposals = [];
    const reviewItems = [];
    const existingNodePaths = new Map();
    for (const home of authoredHomes) {
      for (let depth = 0; depth < home.treePath.length; depth += 1) {
        const nodePath = home.treePath.slice(0, depth + 1);
        existingNodePaths.set(pathKey(home.lorebookId, nodePath), {
          lorebookId: home.lorebookId,
          path: nodePath,
          label: nodePath[nodePath.length - 1],
          parentPath: nodePath.slice(0, -1),
        });
      }
    }

    for (const row of rows) {
      const treePath = row.revision.metadata?.treePath || [];
      const sourceCommunities = (communityBySource.get(row.source.sourceId) || [])
        .sort((a, b) => a.id.localeCompare(b.id));
      if (treePath.length === 0) {
        if (sourceCommunities.length === 1) {
          const community = sourceCommunities[0];
          proposals.push(makeProposal(LoreTreeAction.MOVE_ENTRY, {
            sourceId: row.source.sourceId,
            sourceRevisionId: row.revision.id,
            lorebookId: row.source.lorebookId,
            fromPath: [],
            toPath: ['Suggested', community.label],
            evidenceRefs: [community.id],
            rationale: 'One repeated learned community provides a bounded proposed navigation home.',
          }, {state: LoreReviewState.NEEDS_REVIEW, confidence: 0.72}));
        } else {
          reviewItems.push(makeReviewItem({
            type: sourceCommunities.length ? 'AMBIGUOUS_TREE_PLACEMENT' : 'NO_CLEAR_TREE_PLACEMENT',
            message: sourceCommunities.length
              ? 'Multiple semantic communities could be valid navigation homes; operator choice is required.'
              : 'No repeated semantic community supplies a clear navigation home.',
            sourceIds: [row.source.sourceId],
            evidenceRefs: sourceCommunities.map((community) => community.id),
            details: {
              currentPath: [],
              candidateCommunities: sourceCommunities.map((community) => ({id: community.id, label: community.label})),
            },
          }));
        }
      }
    }

    for (const community of communities) {
      const books = new Set(community.sourceIds.map((sourceId) => sourceById.get(sourceId)?.source.lorebookId).filter(Boolean));
      for (const lorebookId of books) {
        const candidateSources = community.sourceIds.filter((sourceId) => sourceById.get(sourceId)?.source.lorebookId === lorebookId);
        const labelSlug = slug(community.label);
        const alreadyRepresented = [...existingNodePaths.values()].some((node) => (
          node.lorebookId === lorebookId && slug(node.label) === labelSlug
        ));
        if (!alreadyRepresented) {
          proposals.push(makeProposal(LoreTreeAction.CREATE_NODE, {
            lorebookId,
            proposedPath: ['Suggested', community.label],
            sourceIds: candidateSources,
            evidenceRefs: [community.id],
            rationale: 'Repeated semantic membership suggests a useful optional navigation node.',
          }, {state: LoreReviewState.NEEDS_REVIEW, confidence: 0.65}));
        }
      }
    }

    const siblings = new Map();
    for (const node of existingNodePaths.values()) {
      const key = node.lorebookId + '|' + node.parentPath.join('>') + '|' + slug(node.label);
      const bucket = siblings.get(key) || [];
      bucket.push(node);
      siblings.set(key, bucket);
      if (node.label !== node.label.trim()) {
        proposals.push(makeProposal(LoreTreeAction.RENAME_NODE, {
          lorebookId: node.lorebookId,
          fromPath: node.path,
          toLabel: node.label.trim(),
          rationale: 'Whitespace-only label normalization is proposed for human review.',
        }, {state: LoreReviewState.NEEDS_REVIEW, confidence: 0.98}));
      }
    }

    for (const nodes of siblings.values()) {
      const distinct = [...new Set(nodes.map((node) => node.label))];
      if (distinct.length < 2) continue;
      const canonical = canonicalSiblingLabel(distinct);
      proposals.push(makeProposal(LoreTreeAction.MERGE_NODE, {
        lorebookId: nodes[0].lorebookId,
        parentPath: nodes[0].parentPath,
        nodePaths: nodes.map((node) => node.path),
        proposedLabel: canonical.trim(),
        rationale: 'Sibling labels normalize to the same deterministic key; merge is review-only.',
      }, {state: LoreReviewState.NEEDS_REVIEW, confidence: 0.9}));
      reviewItems.push(makeReviewItem({
        type: 'TREE_NODE_COLLISION',
        message: 'Multiple authored Tree nodes normalize to the same sibling key.',
        details: {nodePaths: nodes.map((node) => node.path), proposedLabel: canonical.trim()},
      }));
    }

    const occupants = new Map();
    for (const row of rows) {
      const treePath = row.revision.metadata?.treePath || [];
      if (!treePath.length) continue;
      const key = pathKey(row.source.lorebookId, treePath);
      const bucket = occupants.get(key) || [];
      bucket.push(row);
      occupants.set(key, bucket);
    }
    for (const occupantsAtPath of occupants.values()) {
      if (occupantsAtPath.length < 2) continue;
      let disjointPairs = 0;
      let comparedPairs = 0;
      for (let i = 0; i < occupantsAtPath.length; i += 1) {
        const a = new Set((membershipBySource.get(occupantsAtPath[i].source.sourceId) || []).map((row) => row.conceptRef));
        for (let j = i + 1; j < occupantsAtPath.length; j += 1) {
          const b = new Set((membershipBySource.get(occupantsAtPath[j].source.sourceId) || []).map((row) => row.conceptRef));
          if (!a.size || !b.size) continue;
          comparedPairs += 1;
          if (intersectionSize(a, b) === 0) disjointPairs += 1;
        }
      }
      if (comparedPairs && disjointPairs === comparedPairs) {
        const first = occupantsAtPath[0];
        const childSuggestions = occupantsAtPath.map((row) => {
          const firstMembership = (membershipBySource.get(row.source.sourceId) || [])[0];
          return {
            sourceId: row.source.sourceId,
            suggestedChildLabel: firstMembership?.concept || row.revision.metadata?.title || row.source.uid,
          };
        });
        proposals.push(makeProposal(LoreTreeAction.SPLIT_NODE, {
          lorebookId: first.source.lorebookId,
          path: [...(first.revision.metadata?.treePath || [])],
          sourceIds: occupantsAtPath.map((row) => row.source.sourceId).sort(),
          childSuggestions,
          rationale: 'Co-located entries have disjoint learned semantic memberships; split is review-only.',
        }, {state: LoreReviewState.NEEDS_REVIEW, confidence: 0.6}));
        reviewItems.push(makeReviewItem({
          type: 'POSSIBLE_TREE_SPLIT',
          message: 'A human Tree node contains semantically disjoint studied entries.',
          sourceIds: occupantsAtPath.map((row) => row.source.sourceId),
          details: {path: first.revision.metadata?.treePath || [], childSuggestions},
        }));
      }
    }

    const protectedExistingNodes = [...existingNodePaths.values()]
      .map((node) => ({lorebookId: node.lorebookId, path: node.path, protected: true}))
      .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));

    const planCore = {
      sourceRevisionFence,
      ontologyRevision: ontology.ontologyRevision,
      authoredHomes,
      semanticMemberships,
      proposals: proposals.sort((a, b) => a.id.localeCompare(b.id)),
      reviewItems: reviewItems.sort((a, b) => a.id.localeCompare(b.id)),
      protectedExistingNodes,
    };

    return {
      kind: 'LoreStructurePlan',
      contractVersion: 1,
      planId: 'lore-structure-plan:' + stableHash(planCore),
      ...planCore,
      supportedActions: Object.values(LoreTreeAction),
      primaryTreePlacementIsHumanChoice: true,
      semanticMembershipIsManyToMany: true,
      treePlacementGrantsTruthAuthority: false,
      proposalOnly: true,
      mutationAuthority: false,
      externalGraphDatabaseRequired: false,
      sourceIdentities: rows.map((row) => sourceRevisionIdentity(registry, row.source.sourceId, row.revision.id)),
    };
  }
}
