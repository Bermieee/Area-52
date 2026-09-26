import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {AuthorityClass} from '../src/contracts.js';
import {
  KnowledgeAuthorityOrigin,KnowledgeSourceClass,KnowledgeTemporalStatus,
  classifyKnowledgeEvidenceFreshness,createDependencyInvalidationReceipt,createKnowledgeDisagreementSet,createKnowledgeEvidence,dedupeKnowledgeEvidence,
} from '../src/knowledge-evidence.js';
import {reconstructKnowledgePath} from '../src/knowledge-integration-spine.js';
import {evaluateFt003CorePreflight,evaluateFt004CorePreflight} from '../src/core-function-test-preflight.js';
import {createIntegrationLaneManifest,preflightAssemblyLane} from '../src/assembly-preflight.js';
import {createNexusContextCandidate,exportNexusShadowReplay,NexusShadowIntegrationAdapter} from '../src/nexus-shadow-adapter.js';
import {EMBER_TAVERN_WAVE3} from './fixtures/ember-tavern-wave3.js';
import {runKnowledgeWave5Acceptance} from './knowledge-wave5-harness.js';

const counts={
  knowledgeEvidenceValidations:0,mixedLoreMemoryEvidenceSets:0,revisionFreshnessChecks:0,provenanceReconstructions:0,
  dependencyInvalidationReceipts:0,ft003MixedMemoryCases:0,ft004LoreCases:0,crossSourceContradictionSets:0,
  contextCompilerMixedAuthorityPackets:0,nexusShadowReplayObservations:0,assemblyManifestEvaluations:0,
};
const maxima={dedupedEvidence:0,provenanceDepth:0,compiledItems:0};
let staleAdmissions=0,authorityEscalations=0,wholeWorldInvalidations=0,duplicateMultiplications=0;

function lore(i){
  return createKnowledgeEvidence({evidenceId:'stress:lore:'+i,artifactRef:{artifactId:'lore:'+i,revision:1},sourceClass:KnowledgeSourceClass.SOURCE_LORE,authorityClass:AuthorityClass.SOURCE_CANON,authorityOrigin:KnowledgeAuthorityOrigin.SOURCE,temporalStatus:i%3===0?KnowledgeTemporalStatus.HISTORICAL:KnowledgeTemporalStatus.CURRENT,sourceRevisionRefs:['lore:'+i+'@1'],provenanceRefs:['lore:'+i+'@1'],semantic:{subjectId:'entity:'+i,predicate:'fact',value:i}});
}
function memory(i){
  return createKnowledgeEvidence({evidenceId:'stress:memory:'+i,artifactRef:{artifactId:'memory:'+i,revision:1},sourceClass:KnowledgeSourceClass.EPISODIC_MEMORY,authorityClass:AuthorityClass.OBSERVED,authorityOrigin:KnowledgeAuthorityOrigin.CARRIED,sourceAuthorityClass:AuthorityClass.OBSERVED,temporalStatus:i%2?KnowledgeTemporalStatus.HISTORICAL:KnowledgeTemporalStatus.CURRENT,sourceRevisionRefs:['experience:'+i+'@1'],dependencyRevisionRefs:['experience:'+i+'@1'],provenanceRefs:['experience:'+i+'@1'],semantic:{subjectId:'entity:'+i,predicate:'event',value:i}});
}

function coreForCompiler(){
  const core=new Area52CognitiveCore();
  for(const row of EMBER_TAVERN_WAVE3.sources)core.importAndLearn(row);
  for(const row of EMBER_TAVERN_WAVE3.experiences)core.importAndLearn(row);
  const candidates=core.retrieval.retrieve(EMBER_TAVERN_WAVE3.query,{intent:'CURRENT',anchorEntityIds:EMBER_TAVERN_WAVE3.anchors});
  const truth=core.truthGate.classifyAll(candidates,{intent:'CURRENT'});
  const byClaim=new Map();
  for(const candidate of candidates)for(const id of candidate.claimIds)byClaim.set(id,candidate);
  const evidence=[];
  for(const result of truth){
    const id=result.claimIds[0],claim=core.graph.getClaim(id);if(!claim)continue;
    const sourceRevisionRefs=claim.provenance?.sourceRevisionIds??[];
    const sourceType=sourceRevisionRefs.some(x=>x.includes(':e'))?KnowledgeSourceClass.OBSERVED_EXPERIENCE:KnowledgeSourceClass.RETRIEVAL_CANDIDATE;
    const authorityClass=sourceType===KnowledgeSourceClass.OBSERVED_EXPERIENCE?AuthorityClass.OBSERVED:claim.authorityClass;
    const authorityOrigin=sourceType===KnowledgeSourceClass.OBSERVED_EXPERIENCE?KnowledgeAuthorityOrigin.OBSERVATION:KnowledgeAuthorityOrigin.CARRIED;
    evidence.push(createKnowledgeEvidence({evidenceId:'compiler:'+id,artifactRef:{artifactId:id,revision:1},sourceClass:sourceType,authorityClass,authorityOrigin,sourceAuthorityClass:authorityOrigin===KnowledgeAuthorityOrigin.CARRIED?authorityClass:null,temporalStatus:result.classification,sourceRevisionRefs,provenanceRefs:sourceRevisionRefs,claimIds:[id],candidateLineage:{candidateRefs:[byClaim.get(id)?.candidateId??'c:'+id],nominationChannels:['STRESS'],evidenceRefs:[id]},semantic:{subjectId:claim.subjectId,predicate:claim.predicate,value:claim.value}}));
  }
  return{core,truth,evidence};
}

export function runKnowledgeWave5Stress(){
  for(let i=0;i<10000;i++){const e=i%2?lore(i):memory(i);if(e.authorityGranted)authorityEscalations++;counts.knowledgeEvidenceValidations++;}

  for(let i=0;i<5000;i++){
    const a=lore(i),b=memory(i),dup=createKnowledgeEvidence({...a,evidenceId:'stress:lore-dup:'+i,candidateLineage:{nominationChannels:['BM25']}});
    const d=dedupeKnowledgeEvidence([a,b,dup]);maxima.dedupedEvidence=Math.max(maxima.dedupedEvidence,d.evidence.length);
    if(d.evidence.length>2)duplicateMultiplications++;
    counts.mixedLoreMemoryEvidenceSets++;
  }

  for(let i=0;i<5000;i++){
    const e=memory(i),fresh=i%2===0;
    const state=classifyKnowledgeEvidenceFreshness(e,{activeSourceRevisionRefs:[fresh?'experience:'+i+'@1':'experience:'+i+'@2'],activeDependencyRevisionRefs:[fresh?'experience:'+i+'@1':'experience:'+i+'@2']});
    if(!fresh&&state==='FRESH')staleAdmissions++;
    counts.revisionFreshnessChecks++;
  }

  for(let i=0;i<2000;i++){
    const depth=i%80,chain=Array.from({length:depth},(_,j)=>({kind:'DerivedRef',ref:'d:'+i+':'+j}));
    const r=reconstructKnowledgePath({contextItemId:'context:'+i,sourceRevisionRefs:['source:'+i+'@1'],derivationChain:chain,maxDepth:64});
    maxima.provenanceDepth=Math.max(maxima.provenanceDepth,r.derivationChain.length);
    counts.provenanceReconstructions++;
  }

  for(let i=0;i<2000;i++){
    const r=createDependencyInvalidationReceipt({receiptId:'inv:'+i,changedSourceRevisionRef:'source:'+i+'@1',directlyStaleArtifactRefs:['a:'+i],transitivelyStaleArtifactRefs:['b:'+i],preservedArtifactRefs:['other:'+i]});
    if(r.wholeWorldInvalidation)wholeWorldInvalidations++;
    counts.dependencyInvalidationReceipts++;
  }

  const base=runKnowledgeWave5Acceptance();
  for(let i=0;i<2000;i++){
    const r=evaluateFt003CorePreflight({observedEvidence:base.fixture.contracts.observed,episodicEvidence:base.fixture.contracts.episodic,reflectionEvidence:base.fixture.contracts.reflection,historicalEvidence:base.fixture.contracts.historical,hypothesisEvidence:base.fixture.contracts.hypotheses,lateRoute:{...base.fixture.lateResult.route,resultId:base.fixture.lateResult.result.id},staleEvidence:[base.fixture.staleEvidence],publication:{...base.fixture.ft003Publication,gather:base.fixture.ft003Publication.gather}});
    if(r.state!=='CORE_SIDE_READY')throw new Error('FT003 stress preflight failed at '+i);
    counts.ft003MixedMemoryCases++;
  }
  for(let i=0;i<2000;i++){
    const r=evaluateFt004CorePreflight({exactSourceEvidence:base.fixture.exactLore,derivedEvidence:base.fixture.derivedLore,raptorEvidence:base.fixture.derivedLore[1],treeEvidence:base.fixture.derivedLore[4],invalidationReceipt:base.fixture.invalidation,oldRevisionRecoverable:true,newSourceRestudyRequired:true,publication:{...base.fixture.ft004Publication,gather:base.fixture.ft004Publication.gather}});
    if(r.state!=='CORE_SIDE_READY')throw new Error('FT004 stress preflight failed at '+i);
    counts.ft004LoreCases++;
  }

  for(let i=0;i<1000;i++){
    const current=lore(i),historical=createKnowledgeEvidence({...memory(i),evidenceId:'stress:historical:'+i,temporalStatus:'HISTORICAL'});
    const d=createKnowledgeDisagreementSet({setId:'conflict:'+i,evidence:[current,historical]});
    if(d.winner!==null)throw new Error('contradiction winner manufactured');
    counts.crossSourceContradictionSets++;
  }

  const compiler=coreForCompiler();
  for(let i=0;i<1000;i++){
    const c=compiler.core.compiler.compileDetailed({query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',truthResults:compiler.truth,knowledgeEvidence:compiler.evidence});
    const total=c.packet.current.length+c.packet.historical.length+c.packet.unresolved.length;maxima.compiledItems=Math.max(maxima.compiledItems,total);
    if(!c.packet.knowledgeTraceIndex||!Object.keys(c.packet.knowledgeTraceIndex).length)throw new Error('knowledge qualifiers lost');
    counts.contextCompilerMixedAuthorityPackets++;
  }

  const adapter=new NexusShadowIntegrationAdapter();
  for(let i=0;i<1000;i++){
    const context=createNexusContextCandidate({candidateId:'nexus:'+i,turnId:'turn:'+i,current:[{e:'x',p:'state',v:'current'}],sourceRevisionRefs:['nexus:'+i+'@1']});
    const replay=adapter.importReplay(exportNexusShadowReplay({replayId:'replay:'+i,contexts:[context]}));
    if(replay.mutationAllowed!==false||replay.replayState!=='REPLAYED')throw new Error('shadow replay escaped read-only');
    counts.nexusShadowReplayObservations++;
  }

  for(let i=0;i<500;i++){
    const m=createIntegrationLaneManifest({branch:'Development-Memory',acceptedSha:'sha:'+i,acceptanceRun:'run:'+i,copiedPaths:[{path:'src/memory.js',sourceDigest:'M'}],artifactContracts:[{contractId:'KnowledgeEvidence',version:'1.0.0'}],requiredAdapters:['KnowledgeIntegrationSpine']});
    const p=preflightAssemblyLane(m,{sourceHeadSha:'sha:'+i,sourceFiles:{'src/memory.js':{digest:'M'}},integrationFiles:{}});
    if(p.state!=='READY_TO_COPY')throw new Error('assembly preflight failed');
    counts.assemblyManifestEvaluations++;
  }

  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  const invariants={
    boundedMemoryGrowth:maxima.dedupedEvidence<=2&&maxima.compiledItems<=36,
    boundedProvenanceProjections:maxima.provenanceDepth<=64,
    noStaleAdmission:staleAdmissions===0,
    noAuthorityEscalation:authorityEscalations===0,
    noHistoryErasure:Boolean(base.metrics.oldRevisionRecoverable),
    noWholeWorldInvalidation:wholeWorldInvalidations===0&&base.metrics.localInvalidation,
    noDuplicateEvidenceMultiplication:duplicateMultiplications===0,
    noContextSealMutationAfterPublication:base.fixture.ft003SealStable&&base.fixture.ft004SealStable,
  };
  return{pass:Object.values(invariants).every(Boolean),counts,total,maxima,invariants};
}
