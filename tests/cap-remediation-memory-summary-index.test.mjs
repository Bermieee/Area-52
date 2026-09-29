import test from 'node:test';
import assert from 'node:assert/strict';
import {MemorySummaryHierarchy} from '../src/memory-summary-hierarchy.js';

function fixture(){
  const graph={
    isSourceRevisionActive:()=>true,
    evidenceFresh:()=>true,
    revisionRef:()=> 'graph:r1',
  };
  const experienceStore={
    refreshFreshness:()=>({}),
    currentReflections:()=>[],
    memoryRevisionRefs:()=>['memory:r1'],
  };
  const hierarchy=new MemorySummaryHierarchy({graph,experienceStore});
  const terms=Array.from({length:32768},(_,index)=>'term'+String(index).padStart(5,'0'));
  terms.push('needle_tail');
  const scope={
    kind:'MemorySummaryScope',contractVersion:'1.0.0',scopeRef:'SCENE:index-tail',level:'SCENE',scopeId:'index-tail',
    definitionRevision:1,parentScopeRefs:[],childScopeRefs:[],evidenceRefs:[],episodeLogicalIds:[],sourceSelector:{},
    narrativeTimeRange:null,provenance:[],summaryPolicyRevision:'memory-summary-policy-v1',
    compilerRevision:'memory-summary-local-v1',maxCharacters:12000,updatedSequence:1,
  };
  const artifact={
    kind:'MemoryHierarchicalSummary',contractVersion:'1.0.0',artifactType:'SCENE_SUMMARY',id:'summary:index-tail',
    scopeRef:scope.scopeRef,scopeId:scope.scopeId,scopeLevel:'SCENE',revision:1,definitionRevision:1,
    parentScopeRefs:[],childScopeRefs:[],childArtifactRefs:[],exactEvidenceRefs:['evidence:index-tail'],
    exactSourceRevisionSet:['source:index-tail@1'],
    sourceRange:{worldRevision:{start:1,end:1},sceneRevision:{start:1,end:1},narrativeTime:{start:1,end:1},appendSequence:{start:1,end:1}},
    sourceRangeHash:'range:index-tail',narrativeTimeRange:null,temporalClaims:[],unresolvedSetRefs:[],inferredReflectionRefs:[],
    representationText:terms.join(' '),representativeEvidenceRefs:['evidence:index-tail'],entityRefs:[],
    knowledgeFence:{perspective:'WORLD',fullyKnownBy:[],evidenceKnowledge:[]},
    summaryPolicyRevision:'memory-summary-policy-v1',compilerRevision:'memory-summary-local-v1',
    dependencyFingerprint:'fingerprint:index-tail',provenance:[],budget:{maxCharacters:12000,actualCharacters:0,essentialCharacters:0,omittedOptional:0},
    cost:{evidenceExamined:1,childArtifactsRead:0,claimRecordsRead:0,reflectionRecordsRead:0},
    authorityClass:'DERIVED',truthStatus:'HISTORICAL',independentEvidence:false,navigationOnly:true,
    worldTruthAuthority:false,settlementAuthority:false,admissionAuthority:false,contextInjectionAuthority:false,
    contextSealAuthority:false,freshness:'FRESH',state:'CURRENT',createdSequence:1,replacedByArtifactId:null,reused:false,
  };
  hierarchy.scopes.set(scope.scopeRef,scope);
  hierarchy.artifacts.set(artifact.id,artifact);
  hierarchy.currentByScope.set(scope.scopeRef,artifact.id);
  return hierarchy;
}

test('summary query terms beyond the reverse-index ceiling remain searchable through targeted fallback',()=>{
  const hierarchy=fixture();
  const index=hierarchy.ensureQueryIndex();
  assert.equal(index.rebuilt,true);
  const status=hierarchy.status();
  assert.equal(status.queryIndex.indexedTerms,32768);
  assert.equal(status.queryIndex.coverageComplete,false);
  assert.ok(status.queryIndex.boundedOutTerms>=1);
  assert.equal(status.queryIndex.targetedFallbackAvailable,true);

  const result=hierarchy.nominationsFromSummaries({
    query:'needle_tail',resolutionHint:'SCENE',maxCandidates:4,
    perspectiveConstraint:{scope:'WORLD'},
  },'SCENE',{useCache:false});

  assert.equal(result.nominations.length,1);
  assert.equal(result.nominations[0].metadata.summaryArtifactId,'summary:index-tail');
  assert.ok(result.profile.targetedFallbackExamined>=1);
  assert.equal(result.profile.queryIndexCoverageComplete,false);
});
