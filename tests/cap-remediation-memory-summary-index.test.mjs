import test from 'node:test';
import assert from 'node:assert/strict';
import {MemorySummaryHierarchy} from '../src/memory-summary-hierarchy.js';

function addSceneArtifact(hierarchy,{index,representationText}){
  const suffix=String(index).padStart(4,'0');
  const scopeRef='SCENE:index-'+suffix;
  const artifactId='summary:index-'+suffix;
  const evidenceId='evidence:index-'+suffix;
  const sourceRevisionId='source:index-'+suffix+'@1';
  const scope={
    kind:'MemorySummaryScope',contractVersion:'1.0.0',scopeRef,level:'SCENE',scopeId:'index-'+suffix,
    definitionRevision:1,parentScopeRefs:[],childScopeRefs:[],evidenceRefs:[evidenceId],episodeLogicalIds:[],sourceSelector:{},
    narrativeTimeRange:null,provenance:[],summaryPolicyRevision:'memory-summary-policy-v1',
    compilerRevision:'memory-summary-local-v1',maxCharacters:12000,updatedSequence:index+1,
  };
  const artifact={
    kind:'MemoryHierarchicalSummary',contractVersion:'1.0.0',artifactType:'SCENE_SUMMARY',id:artifactId,
    scopeRef,scopeId:scope.scopeId,scopeLevel:'SCENE',revision:1,definitionRevision:1,
    parentScopeRefs:[],childScopeRefs:[],childArtifactRefs:[],
    evidenceManifest:{kind:'MemorySummaryEvidenceManifest',contractVersion:'1.0.0',mode:'DIRECT',
      directEvidenceRefs:[evidenceId],childArtifactRefs:[],exactEvidenceCount:1,pageSize:256,
      coverageComplete:true,continuationAvailable:false,canonicalKnowledgeDropped:false},
    exactEvidenceRefs:[evidenceId],exactSourceRevisionSet:[sourceRevisionId],
    sourceRange:{evidenceCount:1,worldRevision:{start:index+1,end:index+1},sceneRevision:{start:index+1,end:index+1},
      narrativeTime:{start:index+1,end:index+1},appendSequence:{start:index+1,end:index+1}},
    sourceRangeHash:'range:index-'+suffix,narrativeTimeRange:null,temporalClaims:[],unresolvedSetRefs:[],inferredReflectionRefs:[],
    representationText,representativeEvidenceRefs:[evidenceId],representativeChildArtifactRefs:[],entityRefs:[],
    knowledgeFence:{perspective:'WORLD',fullyKnownBy:[],evidenceKnowledge:[{evidenceId,knownBy:[]}],childKnowledge:[]},
    summaryPolicyRevision:'memory-summary-policy-v1',compilerRevision:'memory-summary-local-v1',
    dependencyFingerprint:'fingerprint:index-'+suffix,provenance:[],
    budget:{maxCharacters:12000,actualCharacters:representationText.length,essentialCharacters:representationText.length,omittedOptional:0},
    cost:{evidenceExamined:1,childArtifactsRead:0,claimRecordsRead:0,reflectionRecordsRead:0},
    authorityClass:'DERIVED',truthStatus:'HISTORICAL',independentEvidence:false,navigationOnly:true,
    worldTruthAuthority:false,settlementAuthority:false,admissionAuthority:false,contextInjectionAuthority:false,
    contextSealAuthority:false,freshness:'FRESH',state:'CURRENT',createdSequence:index+1,replacedByArtifactId:null,reused:false,
  };
  hierarchy.scopes.set(scopeRef,scope);
  hierarchy.artifacts.set(artifactId,artifact);
  hierarchy.currentByScope.set(scopeRef,artifactId);
  return artifact;
}

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

  // The seed alone fills the 32,768-term reverse index. Every later unique term remains
  // present in its artifact token list but cannot receive a reverse posting.
  const seedTerms=Array.from({length:32768},(_,index)=>'term'+String(index).padStart(5,'0'));
  addSceneArtifact(hierarchy,{index:0,representationText:seedTerms.join(' ')});

  // Put the only matching unindexed term past the first 512 deterministic fallback rows.
  for(let index=1;index<=600;index+=1){
    addSceneArtifact(hierarchy,{
      index,
      representationText:index===550?'needletail':'unindexedterm'+String(index).padStart(4,'0'),
    });
  }
  return hierarchy;
}

test('summary query terms beyond the reverse-index ceiling recover through paged targeted fallback',()=>{
  const hierarchy=fixture();
  const index=hierarchy.ensureQueryIndex();
  assert.equal(index.rebuilt,true);

  const status=hierarchy.status();
  assert.equal(status.queryIndex.indexedTerms,32768);
  assert.equal(status.queryIndex.coverageComplete,false);
  assert.ok(status.queryIndex.boundedOutTerms>=600);
  assert.equal(status.queryIndex.targetedFallbackAvailable,true);

  const first=hierarchy.nominationsFromSummaries({
    query:'needletail',resolutionHint:'SCENE',maxCandidates:4,
    perspectiveConstraint:{scope:'WORLD'},
    targetedFallbackOffset:0,
  },'SCENE',{useCache:false});

  assert.equal(first.nominations.length,0,'the first 512-row page must not pretend coverage is complete');
  assert.equal(first.profile.targetedFallbackExamined,512);
  assert.equal(first.profile.targetedFallbackOffset,0);
  assert.deepEqual(first.profile.targetedFallbackTier,['SCENE']);
  assert.equal(first.profile.targetedFallbackCoverageComplete,false);
  assert.equal(first.profile.nextTargetedFallbackOffset,512);
  assert.ok(first.profile.targetedFallbackRemaining>0);
  assert.equal(first.profile.queryIndexCoverageComplete,false);

  const second=hierarchy.nominationsFromSummaries({
    query:'needletail',resolutionHint:'SCENE',maxCandidates:4,
    perspectiveConstraint:{scope:'WORLD'},
    targetedFallbackOffset:first.profile.nextTargetedFallbackOffset,
  },'SCENE',{useCache:false});

  assert.equal(second.nominations.length,1);
  assert.equal(second.nominations[0].metadata.summaryArtifactId,'summary:index-0550');
  assert.equal(second.profile.targetedFallbackOffset,512);
  assert.equal(second.profile.targetedFallbackCoverageComplete,true);
  assert.equal(second.profile.nextTargetedFallbackOffset,null);
  assert.equal(second.profile.targetedFallbackRemaining,0);
  assert.equal(second.profile.queryIndexCoverageComplete,false);
});
