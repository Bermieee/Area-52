import test from 'node:test';
import assert from 'node:assert/strict';
import {MemorySummaryHierarchy} from '../src/memory-summary-hierarchy.js';

function makeGraph(total){
  const evidence=new Map();
  for(let i=0;i<total;i+=1){
    evidence.set('ev:'+i,{
      id:'ev:'+i,sourceRevisionId:'src:'+i+'@1',contentHash:'hash:'+i,appendSequence:i+1,
      worldRevision:i+1,sceneRevision:Math.floor(i/256)+1,occurredAt:i+1,
      exactContent:i===0?'BEGIN_FACT: Mara carried the brass key.':i===total-1?'END_FACT: Eris rang the harbor bell.':'fact '+i,
      participants:[],knownBy:[],authorityClass:'OBSERVED',evidenceKind:'NARRATIVE_EXPERIENCE',
    });
  }
  evidence.set('ev:corrected',{
    id:'ev:corrected',sourceRevisionId:'src:corrected@1',contentHash:'hash:corrected',appendSequence:1,
    worldRevision:1,sceneRevision:1,occurredAt:1,
    exactContent:'CORRECTED_BEGIN_FACT: Mara carried the silver key.',participants:[],knownBy:[],
    authorityClass:'OBSERVED',evidenceKind:'NARRATIVE_EXPERIENCE',
  });
  return {
    evidenceOrder:[...evidence.keys()],
    evidenceRecord:id=>evidence.get(id)??null,
    evidenceView:id=>evidence.get(id)??null,
    exactEvidence:id=>evidence.get(id)??null,
    evidenceFresh:id=>evidence.has(id),
    isSourceRevisionActive:()=>true,
    currentProjection:()=>[],
    historicalClaims:()=>[],
    unresolvedSets:()=>[],
    revisionRef:()=> 'graph:longrun',
  };
}
function childArtifact(index,totalChildren){
  const start=index*256,end=start+255;
  const refs=Array.from({length:256},(_,i)=>'ev:'+(start+i));
  return {
    kind:'MemoryHierarchicalSummary',contractVersion:'1.0.0',artifactType:'SCENE_SUMMARY',
    id:'summary:scene:'+index+':r1',scopeRef:'SCENE:scene-'+index,scopeId:'scene-'+index,scopeLevel:'SCENE',
    revision:1,definitionRevision:1,parentScopeRefs:['SESSION:long'],childScopeRefs:[],childArtifactRefs:[],
    evidenceManifest:{kind:'MemorySummaryEvidenceManifest',contractVersion:'1.0.0',mode:'DIRECT',directEvidenceRefs:refs,childArtifactRefs:[],exactEvidenceCount:256,pageSize:256,coverageComplete:true,continuationAvailable:false,canonicalKnowledgeDropped:false},
    exactEvidenceRefs:refs,exactSourceRevisionSet:refs.map((_,i)=>'src:'+(start+i)+'@1'),
    sourceRange:{evidenceCount:256,appendSequence:{start:start+1,end:end+1},worldRevision:{start:start+1,end:end+1},sceneRevision:{start:index+1,end:index+1},narrativeTime:{start:start+1,end:end+1}},
    sourceRangeHash:'range:'+index,narrativeTimeRange:{start:start+1,end:end+1},
    temporalClaims:[],unresolvedSetRefs:[],inferredReflectionRefs:[],
    representationText:index===0?'BEGIN_FACT child summary':index===totalChildren-1?'END_FACT child summary':'scene summary '+index,
    representativeEvidenceRefs:[refs[0],refs.at(-1)],representativeChildArtifactRefs:[],entityRefs:[],
    knowledgeFence:{perspective:'WORLD',fullyKnownBy:[],evidenceKnowledge:refs.slice(0,2).map(id=>({evidenceId:id,knownBy:[]})),childKnowledge:[]},
    summaryPolicyRevision:'memory-summary-policy-v1',compilerRevision:'memory-summary-local-v1',
    dependencyFingerprint:'dep:'+index,provenance:[],budget:{maxCharacters:12000,actualCharacters:20,essentialCharacters:20,omittedOptional:0},
    cost:{evidenceExamined:256,childArtifactsRead:0,claimRecordsRead:0,reflectionRecordsRead:0},
    authorityClass:'DERIVED',truthStatus:'HISTORICAL',independentEvidence:false,navigationOnly:true,
    worldTruthAuthority:false,settlementAuthority:false,admissionAuthority:false,contextInjectionAuthority:false,contextSealAuthority:false,
    freshness:'FRESH',state:'CURRENT',createdSequence:index+1,replacedByArtifactId:null,reused:false,
  };
}
function fixture(){
  const totalChildren=36,total=totalChildren*256; // 9,216 descendant evidence rows, beyond the former 8,192 flat cap.
  const graph=makeGraph(total);
  const experienceStore={refreshFreshness:()=>({}),currentEpisodes:()=>[],currentReflections:()=>[],memoryRevisionRefs:()=>['memory:longrun']};
  const h=new MemorySummaryHierarchy({graph,experienceStore});
  const childRefs=[];
  for(let i=0;i<totalChildren;i+=1){
    const scope={kind:'MemorySummaryScope',contractVersion:'1.0.0',scopeRef:'SCENE:scene-'+i,level:'SCENE',scopeId:'scene-'+i,definitionRevision:1,
      parentScopeRefs:['SESSION:long'],childScopeRefs:[],evidenceRefs:[],episodeLogicalIds:[],sourceSelector:{},narrativeTimeRange:null,provenance:[],
      summaryPolicyRevision:'memory-summary-policy-v1',compilerRevision:'memory-summary-local-v1',maxCharacters:12000,updatedSequence:i+1};
    const artifact=childArtifact(i,totalChildren);
    h.scopes.set(scope.scopeRef,scope);h.artifacts.set(artifact.id,artifact);h.currentByScope.set(scope.scopeRef,artifact.id);h.historyByScope.set(scope.scopeRef,[artifact.id]);
    childRefs.push(scope.scopeRef);
  }
  h.scopes.set('SESSION:long',{kind:'MemorySummaryScope',contractVersion:'1.0.0',scopeRef:'SESSION:long',level:'SESSION',scopeId:'long',definitionRevision:1,
    parentScopeRefs:[],childScopeRefs:childRefs,evidenceRefs:[],episodeLogicalIds:[],sourceSelector:{},narrativeTimeRange:null,provenance:[],
    summaryPolicyRevision:'memory-summary-policy-v1',compilerRevision:'memory-summary-local-v1',maxCharacters:12000,updatedSequence:100});
  return {h,graph,total,totalChildren};
}

test('row 49: SESSION summary keeps exact beginning/end drillback beyond 8,192 descendants without flattening refs',()=>{
  const {h,total}=fixture();
  const parent=h.compileScope('SESSION:long');
  assert.equal(parent.sourceRange.evidenceCount,total);
  assert.equal(parent.exactEvidenceRefs.length,0);
  assert.equal(parent.evidenceManifest.mode,'HIERARCHICAL');
  assert.equal(parent.evidenceManifest.childArtifactRefs.length,36);
  assert.equal(parent.evidenceManifest.coverageComplete,true);
  assert.equal(parent.evidenceManifest.canonicalKnowledgeDropped,false);
  assert.match(parent.representationText,/BEGIN_FACT/);
  assert.match(parent.representationText,/END_FACT/);

  const first=h.exactDrillbackPage(parent,{offset:0,limit:1});
  const last=h.exactDrillbackPage(parent,{offset:total-1,limit:1});
  assert.equal(first.rows[0].exactContent,'BEGIN_FACT: Mara carried the brass key.');
  assert.equal(last.rows[0].exactContent,'END_FACT: Eris rang the harbor bell.');
  assert.equal(last.processed,1);
  assert.equal(last.coverageComplete,true);
});

test('row 49: child correction invalidates parent identity, rebuilds it, and survives snapshot/restore',()=>{
  const {h,graph,total,totalChildren}=fixture();
  const firstParent=h.compileScope('SESSION:long');
  const oldChild=h.currentArtifact('SCENE:scene-0',{freshOnly:false});
  oldChild.state='HISTORICAL';oldChild.freshness='STALE';
  h.artifacts.set(oldChild.id,oldChild);
  const corrected=childArtifact(0,totalChildren);
  corrected.id='summary:scene:0:r2';corrected.revision=2;corrected.dependencyFingerprint='dep:0:r2';
  corrected.exactEvidenceRefs=['ev:corrected',...corrected.exactEvidenceRefs.slice(1)];
  corrected.evidenceManifest={...corrected.evidenceManifest,directEvidenceRefs:[...corrected.exactEvidenceRefs]};
  corrected.exactSourceRevisionSet=['src:corrected@1',...corrected.exactSourceRevisionSet.slice(1)];
  corrected.sourceRangeHash='range:0:r2';corrected.representationText='CORRECTED_BEGIN_FACT child summary';
  corrected.representativeEvidenceRefs=['ev:corrected',corrected.exactEvidenceRefs.at(-1)];
  h.artifacts.set(corrected.id,corrected);h.currentByScope.set(corrected.scopeRef,corrected.id);h.historyByScope.set(corrected.scopeRef,[oldChild.id,corrected.id]);

  assert.equal(h.artifactIsFresh(firstParent),false);
  const rebuilt=h.compileScope('SESSION:long');
  assert.notEqual(rebuilt.id,firstParent.id);
  assert.match(rebuilt.representationText,/CORRECTED_BEGIN_FACT/);
  assert.equal(rebuilt.sourceRange.evidenceCount,total);
  assert.equal(h.exactDrillbackPage(rebuilt,{offset:0,limit:1}).rows[0].exactContent,'CORRECTED_BEGIN_FACT: Mara carried the silver key.');
  assert.equal(h.exactDrillbackPage(rebuilt,{offset:total-1,limit:1}).rows[0].exactContent,'END_FACT: Eris rang the harbor bell.');

  const restored=new MemorySummaryHierarchy({graph,experienceStore:{refreshFreshness:()=>({}),currentEpisodes:()=>[],currentReflections:()=>[],memoryRevisionRefs:()=>['memory:longrun']},snapshot:JSON.parse(JSON.stringify(h.snapshot()))});
  const restoredParent=restored.currentArtifact('SESSION:long',{freshOnly:true});
  assert.ok(restoredParent);
  assert.equal(restored.exactDrillbackPage(restoredParent,{offset:0,limit:1}).rows[0].exactContent,'CORRECTED_BEGIN_FACT: Mara carried the silver key.');
  assert.equal(restored.exactDrillbackPage(restoredParent,{offset:total-1,limit:1}).rows[0].exactContent,'END_FACT: Eris rang the harbor bell.');
});

test('row 49: allowed-evidence filtering follows child manifests instead of rejecting a parent with no direct refs',()=>{
  const {h,total}=fixture();
  const parent=h.compileScope('SESSION:long');
  h.ensureQueryIndex();
  const all=new Set(Array.from({length:total},(_,i)=>'ev:'+i));
  const result=h.nominationsFromSummaries({query:'BEGIN_FACT',resolutionHint:'SESSION',allowedEvidenceIds:[...all],perspectiveConstraint:{scope:'WORLD'},maxCandidates:4},'SESSION',{useCache:false});
  assert.ok(result.nominations.some(row=>row.metadata.summaryArtifactId===parent.id));
  all.delete('ev:0');
  const blocked=h.nominationsFromSummaries({query:'BEGIN_FACT',resolutionHint:'SESSION',allowedEvidenceIds:[...all],perspectiveConstraint:{scope:'WORLD'},maxCandidates:4},'SESSION',{useCache:false});
  assert.equal(blocked.nominations.some(row=>row.metadata.summaryArtifactId===parent.id),false);
});
