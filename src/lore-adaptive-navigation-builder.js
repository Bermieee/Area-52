import {deepClone, stableHash, stableStringify} from './lore-contracts.js';
import {LoreStructurePlanner} from './lore-structure-planner.js';

function unique(values = []) {
  return [...new Set((values || []).filter((value) => value !== undefined && value !== null).map(String))].sort();
}

function path(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function pathIdentity(row) {
  return stableStringify([row.kind, row.path, row.communityId || null, row.conceptRef || null, row.relationshipPredicate || null]);
}

function reviewBySource(reviewItems = []) {
  const rows = new Map();
  for (const item of reviewItems || []) {
    for (const sourceId of item.sourceIds || []) {
      const bucket = rows.get(sourceId) || [];
      bucket.push(deepClone(item));
      rows.set(sourceId, bucket);
    }
  }
  return rows;
}

export class LoreAdaptiveNavigationBuilder {
  constructor({intelligence, structure = null} = {}) {
    if (!intelligence) throw new TypeError('LoreAdaptiveNavigationBuilder requires LoreIntelligenceService');
    this.intelligence = intelligence;
    this.structure = structure || new LoreStructurePlanner({intelligence});
  }

  survey({lorebookIds = null} = {}) {
    const plan = this.structure.plan({lorebookIds});
    const ontology = this.intelligence.ontology.current();
    const memberships = new Map();
    for (const row of plan.semanticMemberships || []) {
      const bucket = memberships.get(row.sourceId) || [];
      bucket.push(row);
      memberships.set(row.sourceId, bucket);
    }
    const communities = new Map();
    for (const community of ontology.communities || []) {
      for (const sourceId of community.sourceIds || []) {
        const bucket = communities.get(sourceId) || [];
        bucket.push(community);
        communities.set(sourceId, bucket);
      }
    }
    const relationships = new Map();
    for (const edge of ontology.edges || []) {
      if (!edge.sourceId || edge.kind !== 'RELATIONSHIP_EVIDENCE') continue;
      const bucket = relationships.get(edge.sourceId) || [];
      bucket.push(edge);
      relationships.set(edge.sourceId, bucket);
    }
    const reviews = reviewBySource(plan.reviewItems || []);
    const entries = [];
    for (const identity of plan.sourceIdentities || []) {
      const navigationPaths = [];
      const authoredPath = path(identity.metadata?.treePath);
      if (authoredPath.length) {
        navigationPaths.push({
          kind: 'AUTHORED_HOME',
          path: authoredPath,
          primaryHumanHome: true,
          derived: false,
          sourceRevisionId: identity.sourceRevisionId,
          mutationAuthority: false,
        });
      }
      for (const membership of memberships.get(identity.sourceId) || []) {
        navigationPaths.push({
          kind: 'SEMANTIC_CONCEPT',
          path: ['Concepts', ...(membership.parentConcept ? [String(membership.parentConcept)] : []), String(membership.concept)],
          conceptRef: membership.conceptRef,
          evidenceArtifactId: membership.evidenceArtifactId,
          sourceRevisionId: membership.sourceRevisionId,
          primaryHumanHome: false,
          derived: true,
          mutationAuthority: false,
        });
      }
      for (const community of communities.get(identity.sourceId) || []) {
        navigationPaths.push({
          kind: 'SEMANTIC_COMMUNITY',
          path: ['Communities', String(community.label)],
          communityId: community.id,
          sourceRevisionId: identity.sourceRevisionId,
          communitySourceRevisionFence: [...(community.sourceRevisionRefs || [])].sort(),
          primaryHumanHome: false,
          derived: true,
          mutationAuthority: false,
        });
      }
      for (const edge of relationships.get(identity.sourceId) || []) {
        navigationPaths.push({
          kind: 'RELATIONSHIP',
          path: ['Relationships', String(edge.predicate)],
          relationshipPredicate: String(edge.predicate),
          evidenceArtifactId: edge.evidenceArtifactId,
          sourceRevisionId: edge.sourceRevisionId,
          unresolved: Boolean(edge.unresolved),
          temporalClass: edge.temporalClass || null,
          primaryHumanHome: false,
          derived: true,
          mutationAuthority: false,
        });
      }
      const deduped = [...new Map(navigationPaths.map((row) => [pathIdentity(row), row])).values()]
        .sort((a, b) => pathIdentity(a).localeCompare(pathIdentity(b)));
      const sourceReviews = reviews.get(identity.sourceId) || [];
      const sourceCommunities = communities.get(identity.sourceId) || [];
      const orphaned = authoredPath.length === 0;
      const ambiguityReasons = sourceReviews
        .filter((row) => /AMBIGUOUS|SPLIT|COLLISION|NO_CLEAR_TREE_PLACEMENT/.test(String(row.type)))
        .map((row) => row.type);
      if (orphaned && sourceCommunities.length > 1 && !ambiguityReasons.includes('MULTIPLE_SEMANTIC_COMMUNITIES')) {
        ambiguityReasons.push('MULTIPLE_SEMANTIC_COMMUNITIES');
      }
      const ambiguous = ambiguityReasons.length > 0;
      entries.push({
        kind: 'LoreAdaptiveNavigationEntry',
        sourceId: identity.sourceId,
        lorebookId: identity.lorebookId,
        uid: identity.uid,
        sourceRevisionId: identity.sourceRevisionId,
        contentHash: identity.contentHash,
        authoredTreePath: authoredPath,
        navigationPaths: deduped,
        semanticMembershipRefs: (memberships.get(identity.sourceId) || []).map((row) => ({
          conceptRef: row.conceptRef,
          evidenceArtifactId: row.evidenceArtifactId,
          sourceRevisionId: row.sourceRevisionId,
        })),
        reviewItemIds: sourceReviews.map((row) => row.id),
        orphaned,
        ambiguous,
        ambiguityReasons: unique(ambiguityReasons),
        disposition: ambiguous ? 'AMBIGUOUS_REVIEW' : orphaned ? 'ORPHAN_REVIEW' : 'PLACED',
        authoredEntryDuplicated: false,
        sourceAuthority: false,
        treeMutationAuthority: false,
      });
    }
    const core = {
      sourceRevisionFence: [...(plan.sourceRevisionFence || [])].sort(),
      ontologyRevision: ontology.ontologyRevision,
      entries: entries.map((row) => [row.sourceId, row.sourceRevisionId, row.navigationPaths.map(pathIdentity), row.disposition]),
    };
    return {
      kind: 'LoreAdaptiveNavigationSurvey',
      contractVersion: 1,
      surveyId: 'lore-adaptive-navigation:' + stableHash(core),
      sourceRevisionFence: core.sourceRevisionFence,
      ontologyRevision: ontology.ontologyRevision,
      structurePlanId: plan.planId,
      entries,
      orphanedSourceIds: entries.filter((row) => row.orphaned).map((row) => row.sourceId).sort(),
      ambiguousSourceIds: entries.filter((row) => row.ambiguous).map((row) => row.sourceId).sort(),
      structureProposalIds: (plan.proposals || []).map((row) => row.id).sort(),
      reviewItems: deepClone(plan.reviewItems || []),
      protectedExistingNodes: deepClone(plan.protectedExistingNodes || []),
      semanticMembershipManyToMany: true,
      onePrimaryHumanHomeAtMost: true,
      virtualPathsDuplicateAuthoredEntries: false,
      originalAuthoredSourcePreserved: true,
      mutationAuthority: false,
      settlementAuthority: false,
    };
  }

  preview({lorebookIds = null} = {}) {
    const survey = this.survey({lorebookIds});
    const plan = this.structure.plan({lorebookIds});
    const affectedBranches = unique((plan.proposals || []).flatMap((proposal) => [
      ...(Array.isArray(proposal.fromPath) ? [proposal.fromPath.join(' > ')] : []),
      ...(Array.isArray(proposal.toPath) ? [proposal.toPath.join(' > ')] : []),
      ...(Array.isArray(proposal.proposedPath) ? [proposal.proposedPath.join(' > ')] : []),
      ...(Array.isArray(proposal.path) ? [proposal.path.join(' > ')] : []),
      ...((proposal.nodePaths || []).map((row) => path(row).join(' > '))),
    ].filter(Boolean)));
    return {
      kind: 'LoreAdaptiveNavigationPreview',
      contractVersion: 1,
      previewId: 'lore-adaptive-navigation-preview:' + stableHash({
        surveyId: survey.surveyId,
        structurePlanId: plan.planId,
        sourceRevisionFence: survey.sourceRevisionFence,
      }),
      survey,
      treeProposals: deepClone(plan.proposals || []),
      affectedBranches,
      reviewItems: deepClone(plan.reviewItems || []),
      exactSourceRevisionFence: [...survey.sourceRevisionFence],
      previewOnly: true,
      authoredEntriesDuplicated: false,
      treeMutationPerformed: false,
      sourceMutationPerformed: false,
      explicitApprovalRequiredForTreeMutation: true,
      settlementRequiredForTreeMutation: true,
      modelSuggestionMutationAuthority: false,
    };
  }

  rebuildAffected({sourceIds = [], maxScopes = 128} = {}) {
    return this.intelligence.hierarchy.rebuildAffected({sourceIds, maxScopes});
  }
}
