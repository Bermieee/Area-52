import assert from 'node:assert/strict';
import {LoreStudyRuntime} from '../src/lore-study-runtime.js';
import {LORE_WAVE3_LIMITS, NavigationScopeType} from '../src/lore-navigation-contracts.js';
import {LoreHierarchyRetrievalSystem} from '../src/lore-hierarchy-retrieval-system.js';

const SOURCE_COUNT = 2100;
const BRANCHES = 30;
const TARGETED_EDITS = 20;
const runtime0 = new LoreStudyRuntime();
runtime0.registerLorebook({id:'wave3-stress',title:'Wave 3 Stress'});

for (let i=0;i<SOURCE_COUNT;i++) {
  runtime0.upsertEntry({
    lorebookId:'wave3-stress',
    uid:i,
    content:'Record'+i+' is a note.',
    metadata:{title:'Record'+i,treePath:['Region'+(i%BRANCHES),'Topic'+(i%5)]},
  });
}
runtime0.runDue();

let runtime = runtime0;
let system = new LoreHierarchyRetrievalSystem({runtime});
system.refreshHierarchy();
const initialScopes = system.hierarchy.scopes.length;
let session = system.beginBuild();
session = system.runBuild(session.id,{maxUnits:17});
assert.equal(session.state,'CHECKPOINTED');
const savedCursor = session.checkpoint.cursor;
const runtimeSnapshot = runtime.snapshot();
const systemSnapshot = system.snapshot();

runtime = LoreStudyRuntime.fromSnapshot(runtimeSnapshot);
system = LoreHierarchyRetrievalSystem.fromSnapshot({runtime,snapshot:systemSnapshot});
let resumeBatches = 0;
while (session.state !== 'COMPLETED') {
  session = system.runBuild(session.id,{maxUnits:LORE_WAVE3_LIMITS.maxActiveWorkBatch});
  resumeBatches += 1;
}
assert.ok(session.checkpoint.cursor > savedCursor);
system.refreshRetrieval();

let narrowQueries = 0;
let broadQueries = 0;
let maxExamined = 0;
let maxReturned = 0;
for (let i=0;i<80;i++) {
  const narrow = system.query({query:'Record'+((i*23)%SOURCE_COUNT),intent:'NARROW'});
  assert.ok(narrow.nominations.length > 0);
  assert.equal(narrow.nominations[0].metadata.loreResolution,'EXACT_SOURCE');
  narrowQueries += 1;
  maxExamined = Math.max(maxExamined,narrow.diagnostics.examined);
  maxReturned = Math.max(maxReturned,narrow.nominations.length);

  const broad = system.query({query:'Region'+(i%BRANCHES),intent:'BROAD'});
  assert.ok(broad.nominations.length > 0);
  assert.ok(broad.nominations.some((row)=>row.metadata.loreResolution!=='EXACT_SOURCE'));
  broadQueries += 1;
  maxExamined = Math.max(maxExamined,broad.diagnostics.examined);
  maxReturned = Math.max(maxReturned,broad.nominations.length);
}

const unaffectedScope = system.hierarchy.scopes.find((scope)=>
  scope.type===NavigationScopeType.TREE && JSON.stringify(scope.treePath)===JSON.stringify(['Region29'])
);
assert.ok(unaffectedScope);
const unaffectedBefore = system.currentSummary(unaffectedScope.id).id;

for (let k=0;k<TARGETED_EDITS;k++) {
  const i = k*BRANCHES;
  const update = runtime.upsertEntry({
    lorebookId:'wave3-stress',
    uid:i,
    content:'Record'+i+' is an archive.',
    metadata:{title:'Record'+i,treePath:['Region0','Topic0']},
  });
  runtime.run(update.obligation.id);
}
system.refreshHierarchy();
const staleBeforeRebuild = [...system.summaryRegistry.summaries.values()].filter((row)=>row.state==='STALE').length;
assert.ok(staleBeforeRebuild > 0);
system.buildAll({maxUnits:LORE_WAVE3_LIMITS.maxActiveWorkBatch});
system.refreshRetrieval();
const unaffectedAfter = system.currentSummary(unaffectedScope.id).id;
assert.equal(unaffectedAfter,unaffectedBefore);

const movedIndex = 0;
const exactBeforeMove = runtime.registry.currentRevision('lore:wave3-stress:'+movedIndex).exactContent;
const moved = runtime.upsertEntry({
  lorebookId:'wave3-stress',
  uid:movedIndex,
  content:exactBeforeMove,
  metadata:{title:'Record'+movedIndex,treePath:['Relocated','Topic0']},
});
runtime.run(moved.obligation.id);
assert.equal(runtime.registry.currentRevision('lore:wave3-stress:'+movedIndex).exactContent,exactBeforeMove);
system.rebuild({maxUnits:LORE_WAVE3_LIMITS.maxActiveWorkBatch});

const finalDiagnostics = system.diagnostics();
const summaries = [...system.summaryRegistry.summaries.values()];
const currentSummaries = system.summaryRegistry.activeSummaries();
const staleCurrent = currentSummaries.filter((summary)=>
  summary.sourceRevisionSet.some((revisionId)=>!runtime.registry.isCurrentRevision(revisionId))
).length;
const authorityPromotions = currentSummaries.filter((summary)=>summary.authorityClass!=='DERIVED' || summary.sourceAuthority || summary.truthAuthority).length;
const duplicateCurrentScopes = currentSummaries.length - new Set(currentSummaries.map((row)=>row.targetScopeId)).size;
const missingSource = runtime.registry.listEntries({includeRemoved:true}).filter((entry)=>
  runtime.registry.revisionHistory(entry.sourceId).some((revision)=>revision.state!=='REMOVED' && typeof revision.exactContent!=='string')
).length;

assert.equal(staleCurrent,0);
assert.equal(authorityPromotions,0);
assert.equal(duplicateCurrentScopes,0);
assert.equal(missingSource,0);
assert.ok(maxExamined<=LORE_WAVE3_LIMITS.maxExaminedEntries);
assert.ok(maxReturned<=LORE_WAVE3_LIMITS.maxTotalNominations);
assert.ok(finalDiagnostics.retrieval.externalEmbeddingRequired===false);
assert.ok(finalDiagnostics.retrieval.externalDatabaseRequired===false);

console.log('LORE_WAVE3_STRESS '+JSON.stringify({
  pass:true,
  sources:SOURCE_COUNT,
  initialScopes,
  finalScopes:system.hierarchy.scopes.length,
  sourceRevisions:runtime.registry.listEntries({includeRemoved:true}).reduce((sum,entry)=>sum+runtime.registry.revisionHistory(entry.sourceId).length,0),
  interruptedBuildCursor:savedCursor,
  resumeBatches,
  narrowQueries,
  broadQueries,
  maxExamined,
  maxReturned,
  targetedEdits:TARGETED_EDITS,
  treeReorganizations:1,
  staleSummariesBeforeTargetedRebuild:staleBeforeRebuild,
  totalSummaryArtifacts:summaries.length,
  currentSummaries:currentSummaries.length,
  reusedUnrelatedBranch:unaffectedAfter===unaffectedBefore,
  staleCurrentSummaries:staleCurrent,
  authorityPromotions,
  duplicateCurrentScopes,
  sourceLoss:missingSource,
  retrievalRecords:finalDiagnostics.retrieval.records,
  retrievalTokenTerms:finalDiagnostics.retrieval.tokenTerms,
  retainedDiagnostics:finalDiagnostics.retrieval.diagnostics.length,
  maxActiveWorkBatch:LORE_WAVE3_LIMITS.maxActiveWorkBatch,
}));
