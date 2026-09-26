import {ArtifactType, deepClone, stableHash, stableStringify} from './lore-contracts.js';
import {
  LORE_WAVE3_LIMITS,
  NavigationScopeType,
  createNavigationScope,
} from './lore-navigation-contracts.js';

function pathKey(lorebookId, path) {
  return String(lorebookId) + '|' + path.join('>');
}

function scopeLabel(path, fallback) {
  return path.length ? path[path.length - 1] : fallback;
}

function currentFreshSources(runtime) {
  const rows = [];
  const diagnostics = [];
  for (const source of runtime.registry.listEntries({includeRemoved: true})) {
    const revision = runtime.registry.currentRevision(source.sourceId, {allowMissing: true});
    const learned = runtime.store.currentLearnedRevision(source.sourceId);
    if (!revision || revision.state === 'REMOVED') {
      diagnostics.push({sourceId: source.sourceId, status: 'REMOVED_EXCLUDED'});
      continue;
    }
    if (!learned || learned.state !== 'CURRENT' || learned.sourceRevisionId !== revision.id) {
      diagnostics.push({sourceId: source.sourceId, status: 'UNSTUDIED_OR_STALE_EXCLUDED', sourceRevisionId: revision.id});
      continue;
    }
    const treePath = Array.isArray(revision.metadata?.treePath) ? revision.metadata.treePath.map(String) : [];
    if (treePath.length > LORE_WAVE3_LIMITS.maxHierarchyDepth) {
      diagnostics.push({sourceId: source.sourceId, status: 'DEPTH_LIMIT_EXCLUDED', depth: treePath.length});
      continue;
    }
    rows.push({source, revision, learned, treePath});
  }
  return {rows, diagnostics};
}

function conceptMemberships(runtime, sourceRows) {
  const sourceSet = new Set(sourceRows.map((row) => row.source.sourceId));
  const memberships = new Map();
  const add = (key, sourceId) => {
    const ids = memberships.get(key) || new Set();
    ids.add(sourceId);
    memberships.set(key, ids);
  };

  for (const row of sourceRows) {
    for (const segment of row.treePath || []) {
      const normalized = String(segment).trim().toLowerCase();
      if (normalized) add('tree:' + row.source.lorebookId + ':' + normalized, row.source.sourceId);
    }
  }

  for (const artifact of runtime.store.currentArtifacts(runtime.registry, {types: [ArtifactType.CONCEPT, ArtifactType.COMMUNITY]})) {
    if (!sourceSet.has(artifact.sourceId)) continue;
    if (artifact.artifactType === ArtifactType.CONCEPT) {
      const concept = String(artifact.payload?.concept || '');
      if (concept && !concept.startsWith('entity-type:')) add('concept:' + concept, artifact.sourceId);
    } else if (artifact.payload?.label) {
      const label = String(artifact.payload.label);
      if (label && !label.startsWith('entity-type:')) add('community:' + label, artifact.sourceId);
    }
  }
  return memberships;
}

function shardChildren({parentLogicalKey, parentLabel, childIds, sourceMap, lorebookId, treePath, depth}) {
  if (childIds.length <= LORE_WAVE3_LIMITS.maxChildrenPerSummary) return {childIds, shards: []};
  const shards = [];
  const shardIds = [];
  for (let i = 0; i < childIds.length; i += LORE_WAVE3_LIMITS.maxChildrenPerSummary) {
    const children = childIds.slice(i, i + LORE_WAVE3_LIMITS.maxChildrenPerSummary);
    const sources = [...new Set(children.flatMap((id) => sourceMap.get(id)?.sourceIds || []))].sort();
    const shard = createNavigationScope({
      type: NavigationScopeType.SHARD,
      logicalKey: parentLogicalKey + '|shard|' + Math.floor(i / LORE_WAVE3_LIMITS.maxChildrenPerSummary),
      label: parentLabel + ' [' + (Math.floor(i / LORE_WAVE3_LIMITS.maxChildrenPerSummary) + 1) + ']',
      lorebookId,
      treePath,
      sourceIds: sources,
      childScopeIds: children,
      depth,
      metadata: {derivedShard: true},
    });
    shards.push(shard);
    shardIds.push(shard.id);
  }
  return {childIds: shardIds, shards};
}

export function deriveLoreNavigationHierarchy(runtime) {
  const fresh = currentFreshSources(runtime);
  const sourceRows = fresh.rows;
  const scopes = new Map();
  const leafBySource = new Map();
  const treeLogical = new Map();

  for (const row of sourceRows) {
    const leaf = createNavigationScope({
      type: NavigationScopeType.LEAF,
      logicalKey: row.source.sourceId,
      label: row.revision.metadata?.title || row.source.uid || row.source.sourceId,
      lorebookId: row.source.lorebookId,
      treePath: row.treePath,
      sourceIds: [row.source.sourceId],
      childScopeIds: [],
      depth: row.treePath.length + 1,
      metadata: {sourceId: row.source.sourceId},
    });
    scopes.set(leaf.id, leaf);
    leafBySource.set(row.source.sourceId, leaf.id);

    for (let i = 0; i <= row.treePath.length; i += 1) {
      const path = row.treePath.slice(0, i);
      const logical = pathKey(row.source.lorebookId, path);
      const current = treeLogical.get(logical) || {
        lorebookId: row.source.lorebookId,
        path,
        directLeafIds: new Set(),
        directChildKeys: new Set(),
        sourceIds: new Set(),
      };
      current.sourceIds.add(row.source.sourceId);
      if (i === row.treePath.length) current.directLeafIds.add(leaf.id);
      if (i > 0) {
        const parentLogical = pathKey(row.source.lorebookId, path.slice(0, -1));
        const parent = treeLogical.get(parentLogical) || {
          lorebookId: row.source.lorebookId,
          path: path.slice(0, -1),
          directLeafIds: new Set(),
          directChildKeys: new Set(),
          sourceIds: new Set(),
        };
        parent.directChildKeys.add(logical);
        parent.sourceIds.add(row.source.sourceId);
        treeLogical.set(parentLogical, parent);
      }
      treeLogical.set(logical, current);
    }
  }

  const treeKeys = [...treeLogical.keys()].sort((a, b) => {
    const da = treeLogical.get(a).path.length;
    const db = treeLogical.get(b).path.length;
    return db - da || a.localeCompare(b);
  });

  const treeScopeByLogical = new Map();
  for (const logical of treeKeys) {
    const node = treeLogical.get(logical);
    const childScopeIds = [
      ...[...node.directChildKeys].map((key) => treeScopeByLogical.get(key)).filter(Boolean),
      ...node.directLeafIds,
    ].sort();
    const provisional = createNavigationScope({
      type: NavigationScopeType.TREE,
      logicalKey: logical,
      label: scopeLabel(node.path, node.lorebookId),
      lorebookId: node.lorebookId,
      treePath: node.path,
      sourceIds: [...node.sourceIds],
      childScopeIds,
      depth: node.path.length,
      metadata: {authoredTreePath: [...node.path]},
    });
    const sharded = shardChildren({
      parentLogicalKey: logical,
      parentLabel: provisional.label,
      childIds: childScopeIds,
      sourceMap: scopes,
      lorebookId: node.lorebookId,
      treePath: node.path,
      depth: provisional.depth + 1,
    });
    for (const shard of sharded.shards) scopes.set(shard.id, shard);
    const scope = createNavigationScope({
      ...provisional,
      type: NavigationScopeType.TREE,
      logicalKey: logical,
      label: provisional.label,
      lorebookId: node.lorebookId,
      treePath: node.path,
      sourceIds: [...node.sourceIds],
      childScopeIds: sharded.childIds,
      depth: node.path.length,
      metadata: provisional.metadata,
    });
    scopes.set(scope.id, scope);
    treeScopeByLogical.set(logical, scope.id);
  }

  const memberships = conceptMemberships(runtime, sourceRows);
  let communityCount = 0;
  for (const [communityKey, ids] of [...memberships.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sourceIds = [...ids].sort();
    if (sourceIds.length < 2 || communityCount >= LORE_WAVE3_LIMITS.maxCommunityScopes) continue;
    const leafIds = sourceIds.map((id) => leafBySource.get(id)).filter(Boolean).sort();
    const baseLogical = 'community|' + communityKey;
    const provisional = createNavigationScope({
      type: NavigationScopeType.COMMUNITY,
      logicalKey: baseLogical,
      label: communityKey.replace(/^(concept|parent|community):/, ''),
      sourceIds,
      childScopeIds: leafIds,
      communityKey,
      depth: 1,
      metadata: {evidenceBackedMembership: true},
    });
    const sharded = shardChildren({
      parentLogicalKey: baseLogical,
      parentLabel: provisional.label,
      childIds: leafIds,
      sourceMap: scopes,
      lorebookId: null,
      treePath: [],
      depth: 2,
    });
    for (const shard of sharded.shards) scopes.set(shard.id, shard);
    const scope = createNavigationScope({
      type: NavigationScopeType.COMMUNITY,
      logicalKey: baseLogical,
      label: provisional.label,
      sourceIds,
      childScopeIds: sharded.childIds,
      communityKey,
      depth: 1,
      metadata: provisional.metadata,
    });
    scopes.set(scope.id, scope);
    communityCount += 1;
  }

  const rootTreeScopes = [...treeScopeByLogical.entries()]
    .filter(([logical]) => treeLogical.get(logical).path.length === 0)
    .map(([, id]) => id)
    .sort();
  const allSources = sourceRows.map((row) => row.source.sourceId).sort();
  if (allSources.length) {
    const corpusLogical = 'corpus|' + stableHash(allSources.map((id) => runtime.registry.getEntry(id)?.lorebookId || '').sort().join('|'));
    const provisional = createNavigationScope({
      type: NavigationScopeType.CORPUS,
      logicalKey: corpusLogical,
      label: 'Lore Corpus',
      sourceIds: allSources,
      childScopeIds: rootTreeScopes,
      depth: 0,
      metadata: {corpus: true},
    });
    const sharded = shardChildren({
      parentLogicalKey: corpusLogical,
      parentLabel: provisional.label,
      childIds: rootTreeScopes,
      sourceMap: scopes,
      lorebookId: null,
      treePath: [],
      depth: 1,
    });
    for (const shard of sharded.shards) scopes.set(shard.id, shard);
    const corpus = createNavigationScope({
      type: NavigationScopeType.CORPUS,
      logicalKey: corpusLogical,
      label: provisional.label,
      sourceIds: allSources,
      childScopeIds: sharded.childIds,
      depth: 0,
      metadata: provisional.metadata,
    });
    scopes.set(corpus.id, corpus);
  }

  if (scopes.size > LORE_WAVE3_LIMITS.maxScopeCount) throw new Error('LORE_HIERARCHY_SCOPE_LIMIT_EXCEEDED');

  const structureFingerprint = stableHash(stableStringify([...scopes.values()]
    .map((scope) => [scope.id, scope.structureRevision])
    .sort((a, b) => a[0].localeCompare(b[0]))));

  return {
    kind: 'LoreNavigationHierarchy',
    hierarchyRevision: 'hierarchy:' + structureFingerprint,
    scopes: [...scopes.values()].map(deepClone).sort((a, b) => a.id.localeCompare(b.id)),
    leafBySource: [...leafBySource.entries()],
    diagnostics: fresh.diagnostics.slice(-LORE_WAVE3_LIMITS.maxDiagnostics),
    includedSourceIds: allSources,
    excludedSourceCount: fresh.diagnostics.length,
    authoredTreeMutated: false,
    treeTruthAuthority: false,
    entityMergeAuthority: false,
  };
}

export function hierarchyScopeMap(hierarchy) {
  return new Map((hierarchy?.scopes || []).map((scope) => [scope.id, deepClone(scope)]));
}
