import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {AuthorityClass} from '../src/contracts.js';
import {
  KnowledgeAuthorityOrigin,KnowledgeMeasurementState,KnowledgeSourceClass,KnowledgeTemporalStatus,
  createDependencyInvalidationReceipt,createKnowledgeDisagreementSet,createKnowledgeEvidence,createKnowledgePerformanceFixture,
  dedupeKnowledgeEvidence,
} from '../src/knowledge-evidence.js';
import {knowledgeEvidenceFromRetrievalCandidate,reconstructKnowledgePath} from '../src/knowledge-integration-spine.js';
import {createCognitiveResult,ResultClass,ResultDestination,ResultPayloadClass} from '../src/publication-contracts.js';
import {evaluateFt003CorePreflight,evaluateFt004CorePreflight} from '../src/core-function-test-preflight.js';
import {createIntegrationLaneManifest,preflightAssemblyLane} from '../src/assembly-preflight.js';
import {GateEvidenceState,KnowledgeReadinessDimension,Phase1GateEvidenceAggregator} from '../src/phase1-gate-evidence.js';
import {createNexusContextCandidate,createNexusSnapshot,createNexusTurnObservation,createNexusWorkerObservation,exportNexusShadowReplay,NexusShadowIntegrationAdapter} from '../src/nexus-shadow-adapter.js';
import {EMBER_TAVERN_WAVE3} from './fixtures/ember-tavern-wave3.js';

const uniq=(xs)=>[...new Set((xs??[]).filter(Boolean))].sort();
const sourceRefs=(claim)=>uniq(claim?.provenance?.sourceRevisionIds??[]);
const claimSemantic=(claim)=>({subjectId:claim.subjectId,predicate:claim.predicate,value:claim.value,status:claim.status});
const candidate=(id)=>({candidateRefs:[id],nominationChannels:['DENSE'],evidenceRefs:[id]});
const precision=(id,refs,rank=1,reasons=['LEXICAL_MATCH'])=>({kind:'PrecisionResult',candidateId:id,finalRank:rank,normalizedScore:1-(rank-1)*.1,freshness:'FRESH',sourceRevisionIds:[...refs],reasonCodes:reasons});

function findClaim(core,predicate){
  const claim=core.graph.allClaims().find(predicate);
  if(!claim)throw new Error('required fixture claim missing');
  return claim;
}
function fixtureCore(){
  const core=new Area52CognitiveCore();
  for(const row of EMBER_TAVERN_WAVE3.sources)core.importAndLearn(row);
  for(const row of EMBER_TAVERN_WAVE3.experiences)core.importAndLearn(row);
  return core;
}
function contractEvidence(){
  const observed=createKnowledgeEvidence({
    evidenceId:'ft003:observed:mara-picks-up-blade',artifactRef:{artifactId:'experience:mara-pickup',revision:1},
    sourceClass:KnowledgeSourceClass.OBSERVED_EXPERIENCE,authorityClass:AuthorityClass.OBSERVED,authorityOrigin:KnowledgeAuthorityOrigin.OBSERVATION,
    temporalStatus:KnowledgeTemporalStatus.CURRENT,sourceRevisionRefs:['experience:mara-pickup@1'],provenanceRefs:['experience:mara-pickup@1'],
    semantic:{subjectId:'mara',predicate:'holds',value:'sun-blade'},
  });
  const episodic=createKnowledgeEvidence({
    evidenceId:'ft003:episodic:mara-pickup',artifactRef:{artifactId:'memory:episode:mara-pickup',revision:1},
    sourceClass:KnowledgeSourceClass.EPISODIC_MEMORY,authorityClass:AuthorityClass.OBSERVED,authorityOrigin:KnowledgeAuthorityOrigin.CARRIED,sourceAuthorityClass:AuthorityClass.OBSERVED,
    temporalStatus:KnowledgeTemporalStatus.CURRENT,sourceRevisionRefs:['experience:mara-pickup@1'],dependencyRevisionRefs:['experience:mara-pickup@1'],provenanceRefs:['memory:episode:mara-pickup','experience:mara-pickup@1'],
    memoryRef:{memoryId:'memory:episode:mara-pickup'},semantic:{subjectId:'mara',predicate:'holds',value:'sun-blade'},
  });
  const reflection=createKnowledgeEvidence({
    evidenceId:'ft003:reflection:mara-distrust',artifactRef:{artifactId:'reflection:mara-distrust',revision:1},
    sourceClass:KnowledgeSourceClass.REFLECTION,authorityClass:AuthorityClass.INFERRED,authorityOrigin:KnowledgeAuthorityOrigin.INFERENCE,
    temporalStatus:KnowledgeTemporalStatus.UNCERTAIN,sourceRevisionRefs:['experience:mara-pickup@1'],provenanceRefs:['reflection:mara-distrust'],
    semantic:{subjectId:'mara',predicate:'trusts',value:'eris'},
  });
  const historical=createKnowledgeEvidence({
    evidenceId:'ft003:historical:blade-tavern',artifactRef:{artifactId:'memory:blade-tavern',revision:1},
    sourceClass:KnowledgeSourceClass.EPISODIC_MEMORY,authorityClass:AuthorityClass.OBSERVED,authorityOrigin:KnowledgeAuthorityOrigin.CARRIED,sourceAuthorityClass:AuthorityClass.OBSERVED,
    temporalStatus:KnowledgeTemporalStatus.HISTORICAL,sourceRevisionRefs:['experience:blade-tavern@1'],provenanceRefs:['experience:blade-tavern@1'],
    semantic:{subjectId:'sun-blade',predicate:'location',value:'ember-tavern'},
  });
  const hypotheses=['burned','removed-before-fire'].map((value,index)=>createKnowledgeEvidence({
    evidenceId:'ft003:hypothesis:'+(index+1),artifactRef:{artifactId:'hypothesis:blade:'+value,revision:1},
    sourceClass:KnowledgeSourceClass.DERIVED_REPRESENTATION,authorityClass:AuthorityClass.UNRESOLVED,authorityOrigin:KnowledgeAuthorityOrigin.INFERENCE,
    temporalStatus:KnowledgeTemporalStatus.UNRESOLVED,sourceRevisionRefs:['experience:blade-fire@1'],provenanceRefs:['hypothesis:blade-fate'],
    hypothesisSetId:'hypothesis-set:blade-fate',semantic:{subjectId:'sun-blade',predicate:'fate',value},
  }));
  return{observed,episodic,reflection,historical,hypotheses};
}

export function buildWave5Fixture(){
  const core=fixtureCore(),contracts=contractEvidence();
  const activeSourceRevisionRefs=core.registry.activeRevisionIds();

  const tavernDestroyed=findClaim(core,c=>c.subjectId==='ember-tavern'&&c.predicate==='state'&&c.value==='destroyed'&&c.status==='CURRENT');
  const bladeHistorical=findClaim(core,c=>c.subjectId==='sun-blade'&&c.predicate==='location'&&c.value==='ember-tavern'&&['HISTORICAL','SUPERSEDED'].includes(c.status));
  const destroyedHyp=findClaim(core,c=>c.subjectId==='sun-blade'&&c.predicate==='state'&&c.value==='destroyed'&&['CONTRADICTED','UNRESOLVED','UNCERTAIN'].includes(c.status));
  const survivedHyp=findClaim(core,c=>c.subjectId==='sun-blade'&&c.predicate==='state'&&c.value==='survived'&&['CONTRADICTED','UNRESOLVED','UNCERTAIN'].includes(c.status));

  const observedPipeline=createKnowledgeEvidence({
    evidenceId:'ft003:pipeline:observed-tavern-fire',artifactRef:{artifactId:tavernDestroyed.id,revision:1},
    sourceClass:KnowledgeSourceClass.OBSERVED_EXPERIENCE,authorityClass:AuthorityClass.OBSERVED,authorityOrigin:KnowledgeAuthorityOrigin.OBSERVATION,
    temporalStatus:KnowledgeTemporalStatus.CURRENT,sourceRevisionRefs:sourceRefs(tavernDestroyed),provenanceRefs:sourceRefs(tavernDestroyed),claimIds:[tavernDestroyed.id],candidateLineage:candidate('ft003:c:observed'),semantic:claimSemantic(tavernDestroyed),
  });
  const episodicPipeline=createKnowledgeEvidence({
    evidenceId:'ft003:pipeline:episodic-blade-location',artifactRef:{artifactId:'memory:'+bladeHistorical.id,revision:1},
    sourceClass:KnowledgeSourceClass.EPISODIC_MEMORY,authorityClass:AuthorityClass.OBSERVED,authorityOrigin:KnowledgeAuthorityOrigin.CARRIED,sourceAuthorityClass:AuthorityClass.OBSERVED,
    temporalStatus:KnowledgeTemporalStatus.HISTORICAL,sourceRevisionRefs:sourceRefs(bladeHistorical),dependencyRevisionRefs:sourceRefs(bladeHistorical),provenanceRefs:[bladeHistorical.id,...sourceRefs(bladeHistorical)],claimIds:[bladeHistorical.id],candidateLineage:candidate('ft003:c:episodic'),memoryRef:{memoryId:'memory:'+bladeHistorical.id},semantic:claimSemantic(bladeHistorical),
  });
  const hypothesisPipeline=[destroyedHyp,survivedHyp].map((claim,index)=>createKnowledgeEvidence({
    evidenceId:'ft003:pipeline:hypothesis:'+(index+1),artifactRef:{artifactId:'hypothesis:'+claim.id,revision:1},
    sourceClass:KnowledgeSourceClass.DERIVED_REPRESENTATION,authorityClass:AuthorityClass.UNRESOLVED,authorityOrigin:KnowledgeAuthorityOrigin.INFERENCE,
    temporalStatus:KnowledgeTemporalStatus.UNRESOLVED,sourceRevisionRefs:sourceRefs(claim),provenanceRefs:[claim.id,...sourceRefs(claim)],claimIds:[claim.id],
    candidateLineage:{candidateRefs:['ft003:c:hypothesis:'+(index+1)],nominationChannels:['EPISODES','REFLECTION'],evidenceRefs:[claim.id]},
    hypothesisSetId:'hypothesis-set:blade-fate',semantic:claimSemantic(claim),
  }));
  const staleEvidence=createKnowledgeEvidence({
    evidenceId:'ft003:stale-memory',artifactRef:{artifactId:'memory:old',revision:1},sourceClass:KnowledgeSourceClass.EPISODIC_MEMORY,
    authorityClass:AuthorityClass.OBSERVED,authorityOrigin:KnowledgeAuthorityOrigin.CARRIED,sourceAuthorityClass:AuthorityClass.OBSERVED,
    temporalStatus:KnowledgeTemporalStatus.CURRENT,sourceRevisionRefs:['obsolete-memory-source@5'],provenanceRefs:['obsolete-memory-source@5'],
    candidateLineage:candidate('ft003:c:stale'),claimIds:[tavernDestroyed.id],semantic:claimSemantic(tavernDestroyed),
  });
  const ft003Evidence=[observedPipeline,episodicPipeline,...hypothesisPipeline,staleEvidence];
  const ft003Precision=ft003Evidence.map((x,i)=>precision(x.candidateLineage.candidateRefs[0],x.sourceRevisionRefs,i+1,['FT003_FIXTURE']));
  const ft003Publication=core.knowledge.publishFixture({
    turnId:'turn:ft003:core',correlationId:'corr:ft003:core',generationId:'generation:ft003:core',
    query:'What is current and remembered about the Ember Tavern and Sun Blade?',intent:'TEMPORAL',
    evidence:ft003Evidence,precisionResults:ft003Precision,activeSourceRevisionRefs,activeDependencyRevisionRefs:activeSourceRevisionRefs,sealedAt:300,
  });
  const ft003PacketBefore=JSON.stringify(ft003Publication.packet);
  const lateResult=core.publication.receiveResult(createCognitiveResult({
    id:'result:memory:late-consolidation',taskId:'memory:consolidate',turnId:'turn:ft003:core',correlationId:'corr:ft003:core',
    sourceSubsystem:'MEMORY',workerId:'fixture-memory',resultType:'MEMORY_CONSOLIDATION',resultClass:ResultClass.OPPORTUNISTIC,payloadClass:ResultPayloadClass.DERIVED_DATA,
    evidenceIds:['ft003:pipeline:episodic-blade-location'],provenance:{fixture:true},sourceRevisionIds:sourceRefs(bladeHistorical),
    worldRevision:core.graph.revision,sceneRevision:core.publication.sceneRevision,authorityClass:AuthorityClass.INFERRED,destination:ResultDestination.FOREGROUND,
    payload:{memoryRef:'late:consolidation'},timing:{completedAt:301},
  }));
  const ft003SealStable=JSON.stringify(core.publication.seal.getPacket('turn:ft003:core'))===ft003PacketBefore;

  const intactLore=findClaim(core,c=>c.subjectId==='ember-tavern'&&c.predicate==='state'&&c.value==='intact'&&(c.provenance?.sourceRevisionIds??[]).includes('w3:lore:tavern@1'));
  const exactLore=createKnowledgeEvidence({
    evidenceId:'ft004:exact:lore-tavern',artifactRef:{artifactId:'w3:lore:tavern@1',revision:1},sourceClass:KnowledgeSourceClass.SOURCE_LORE,
    authorityClass:AuthorityClass.SOURCE_CANON,authorityOrigin:KnowledgeAuthorityOrigin.SOURCE,temporalStatus:KnowledgeTemporalStatus.HISTORICAL,
    sourceRevisionRefs:['w3:lore:tavern@1'],provenanceRefs:['w3:lore:tavern@1'],claimIds:[intactLore.id],candidateLineage:{candidateRefs:['ft004:c:exact'],nominationChannels:['EXACT_SOURCE'],evidenceRefs:['w3:lore:tavern@1']},loreRef:{sourceId:'w3:lore:tavern',revision:1},semantic:claimSemantic(intactLore),hardRule:true,
  });
  const derivedClasses=['CONTEXTUAL_CHUNK','RAPTOR_SUMMARY','LEAN_REPRESENTATION','NAVIGATION_SUMMARY','TREE_NOMINATION','ONTOLOGY_NOMINATION'];
  const derivedLore=derivedClasses.map((type,index)=>createKnowledgeEvidence({
    evidenceId:'ft004:derived:'+type.toLowerCase(),artifactRef:{artifactId:'derived:'+type.toLowerCase(),revision:1},sourceClass:KnowledgeSourceClass.DERIVED_REPRESENTATION,
    authorityClass:AuthorityClass.INFERRED,authorityOrigin:KnowledgeAuthorityOrigin.INFERENCE,temporalStatus:KnowledgeTemporalStatus.HISTORICAL,
    sourceRevisionRefs:['w3:lore:tavern@1'],dependencyRevisionRefs:['w3:lore:tavern@1'],provenanceRefs:['derived:'+type.toLowerCase(),'w3:lore:tavern@1'],
    claimIds:[intactLore.id],candidateLineage:{candidateRefs:['ft004:c:derived:'+(index+1)],nominationChannels:[type.includes('TREE')?'TREE':type.includes('ONTOLOGY')?'ONTOLOGY':type.includes('RAPTOR')?'RAPTOR':'DENSE'],evidenceRefs:['w3:lore:tavern@1']},
    loreRef:{sourceId:'w3:lore:tavern',revision:1},semantic:claimSemantic(intactLore),
  }));
  const ft004Evidence=[exactLore,...derivedLore],ft004Precision=ft004Evidence.map((x,i)=>precision(x.candidateLineage.candidateRefs[0],x.sourceRevisionRefs,i+1,['FT004_FIXTURE']));
  const ft004Publication=core.knowledge.publishFixture({
    turnId:'turn:ft004:core',correlationId:'corr:ft004:core',generationId:'generation:ft004:core',
    query:'What is known about the history of the Ember Tavern?',intent:'HISTORICAL',
    evidence:ft004Evidence,precisionResults:ft004Precision,activeSourceRevisionRefs,activeDependencyRevisionRefs:activeSourceRevisionRefs,sealedAt:400,
  });

  core.registry.registerDerivedArtifact({artifactId:'w5:direct:tavern',artifact:{kind:'Wave5Derived',id:'w5:direct:tavern'},sourceRevisionIds:['w3:lore:tavern@1'],activity:'WAVE5_DIRECT',agent:'wave5-fixture'});
  core.registry.registerDerivedArtifact({artifactId:'w5:child:tavern',artifact:{kind:'Wave5Derived',id:'w5:child:tavern'},dependsOnArtifactIds:['w5:direct:tavern'],activity:'WAVE5_CHILD',agent:'wave5-fixture'});
  core.registry.registerDerivedArtifact({artifactId:'w5:unrelated:blade',artifact:{kind:'Wave5Derived',id:'w5:unrelated:blade'},sourceRevisionIds:['w3:lore:blade@1'],activity:'WAVE5_UNRELATED',agent:'wave5-fixture'});
  const edit=core.editAndRelearn('w3:lore:tavern','The Ember Tavern is damaged.');
  const invalidation=createDependencyInvalidationReceipt({
    receiptId:'invalidation:w3:lore:tavern@1',changedSourceRevisionRef:'w3:lore:tavern@1',
    directlyStaleArtifactRefs:['w5:direct:tavern'],transitivelyStaleArtifactRefs:['w5:child:tavern'],
    preservedArtifactRefs:core.registry.isArtifactValid('w5:unrelated:blade')?['w5:unrelated:blade']:[],
    reason:'SOURCE_EDIT',dependencyGraphRevision:core.graph.revision,
  });
  const ft004SealStable=JSON.stringify(core.publication.seal.getPacket('turn:ft004:core'))===JSON.stringify(ft004Publication.packet);

  const ft003=evaluateFt003CorePreflight({
    observedEvidence:contracts.observed,episodicEvidence:contracts.episodic,reflectionEvidence:contracts.reflection,historicalEvidence:contracts.historical,hypothesisEvidence:contracts.hypotheses,lateRoute:{...lateResult.route,resultId:lateResult.result.id},
    staleEvidence:[staleEvidence],publication:{...ft003Publication,gather:ft003Publication.gather},
  });
  const ft004=evaluateFt004CorePreflight({
    exactSourceEvidence:exactLore,derivedEvidence:derivedLore,raptorEvidence:derivedLore[1],treeEvidence:derivedLore[4],invalidationReceipt:invalidation,
    oldRevisionRecoverable:Boolean(core.registry.getRevision('w3:lore:tavern@1')),newSourceRestudyRequired:Boolean(edit.relearned?.result?.revision?.id==='w3:lore:tavern@2'),
    publication:{...ft004Publication,gather:ft004Publication.gather},
  });

  return{core,contracts,activeSourceRevisionRefs,observedPipeline,episodicPipeline,hypothesisPipeline,staleEvidence,ft003Publication,lateResult,ft003SealStable,
    exactLore,derivedLore,ft004Publication,edit,invalidation,ft004SealStable,ft003,ft004};
}

export function runKnowledgeWave5Acceptance(){
  const f=buildWave5Fixture(),{core}=f;
  const duplicateA=knowledgeEvidenceFromRetrievalCandidate({candidateId:'dup:dense',evidenceIdentity:'same-source',artifactRef:{artifactId:'same',revision:1},sourceRevisionRefs:['w3:lore:blade@1'],channel:'DENSE',nominatedBy:['DENSE'],authorityClass:'SOURCE_CANON',truthStatus:'CURRENT',provenance:[{ref:'w3:lore:blade@1'}],claimIds:[]});
  const duplicateB=knowledgeEvidenceFromRetrievalCandidate({candidateId:'dup:bm25',evidenceIdentity:'same-source',artifactRef:{artifactId:'same',revision:1},sourceRevisionRefs:['w3:lore:blade@1'],channel:'BM25',nominatedBy:['BM25'],authorityClass:'SOURCE_CANON',truthStatus:'CURRENT',provenance:[{ref:'w3:lore:blade@1'}],claimIds:[]});
  const dedupe=dedupeKnowledgeEvidence([duplicateA,duplicateB]);
  const disagreement=createKnowledgeDisagreementSet({setId:'mixed:history-current',evidence:[f.contracts.historical,f.contracts.observed]});
  const trace=core.knowledge.trace({contextItemId:f.ft004Publication.packet.historical[0]?.id??'historical:item',evidence:f.exactLore,truthClassification:'HISTORICAL',gatherRef:f.ft004Publication.gather.gatherId,contextSealRef:f.ft004Publication.sealReceipt.id,promptPlanRef:f.ft004Publication.promptPlan.promptPlanId});
  const reconstruction=reconstructKnowledgePath({...trace,maxDepth:64});
  const traceModel=core.observation.knowledgeTrace({
    contextItemId:trace.contextItemId,authority:f.exactLore.authorityClass,temporalStatus:f.exactLore.temporalStatus,immediateArtifact:f.exactLore.artifactRef,
    sourceRevisionRefs:f.exactLore.sourceRevisionRefs,derivationChain:trace.derivationChain,retrievalChannels:f.exactLore.candidateLineage.nominationChannels,
    precisionReasons:f.exactLore.retrievalMetadata?.precision?.reasonCodes??[],truthClassification:'HISTORICAL',freshness:'FRESH',
  });
  const performance=createKnowledgePerformanceFixture({fixtureId:'wave5:acceptance',state:KnowledgeMeasurementState.REPLAYED,candidateCount:f.ft004Publication.admission.fresh.length,derivedArtifactCount:f.derivedLore.length,invalidatedArtifactCount:f.invalidation.invalidatedCount,unaffectedReuse:f.invalidation.preservedCount,provenanceDepth:trace.derivationChain.length,contextAdmissionCount:f.ft004Publication.gather.admittedEvidenceIds.length,sealedByteCount:JSON.stringify(f.ft004Publication.packet).length,knowledgeTraceSize:JSON.stringify(traceModel).length,evidenceRefs:['wave5:fixture']});

  const nexusContext=createNexusContextCandidate({candidateId:'nexus:ctx:1',turnId:'nexus:turn:1',current:[{e:'ember-tavern',p:'state',v:'destroyed'}],sourceRevisionRefs:['nexus:lore@1'],evidenceRefs:['nexus:diag:1']});
  const replayExport=exportNexusShadowReplay({replayId:'nexus:replay:1',snapshot:createNexusSnapshot({snapshotId:'nexus:snapshot:1',turnId:'nexus:turn:1'}),turns:[createNexusTurnObservation({observationId:'nexus:turn-observation:1',turnId:'nexus:turn:1'})],contexts:[nexusContext],workers:[createNexusWorkerObservation({observationId:'nexus:worker:1',workerId:'Jev'})]});
  const adapter=new NexusShadowIntegrationAdapter(),replay=adapter.importReplay(replayExport),shadowStatus=adapter.status();

  const gate=new Phase1GateEvidenceAggregator();
  gate.recordKnowledgeReadiness({dimension:KnowledgeReadinessDimension.CORE,state:GateEvidenceState.PASS,summary:'FT003/FT004 Core preflights green'});
  gate.recordKnowledgeReadiness({dimension:KnowledgeReadinessDimension.MEMORY_OWNER,state:GateEvidenceState.BLOCKED,summary:'real Memory owner implementation pending',blockers:['#178 live Memory']});
  gate.recordKnowledgeReadiness({dimension:KnowledgeReadinessDimension.LORE_OWNER,state:GateEvidenceState.BLOCKED,summary:'real Lore owner implementation pending',blockers:['#179 live Lore']});
  gate.recordKnowledgeReadiness({dimension:KnowledgeReadinessDimension.SENSORY,state:GateEvidenceState.PARTIAL,summary:'Core receiving seam ready; live integrated Sensory pending'});
  gate.recordKnowledgeReadiness({dimension:KnowledgeReadinessDimension.PRECISION,state:GateEvidenceState.PARTIAL,summary:'Worker 2 Precision contract observed; assembled integration pending'});
  gate.recordKnowledgeReadiness({dimension:KnowledgeReadinessDimension.LIVE_ASSEMBLED_MAIN,state:GateEvidenceState.BLOCKED,summary:'main intentionally untouched'});
  const readiness=gate.knowledgeReadinessReport();

  const futureManifest=createIntegrationLaneManifest({branch:'Development-Memory',acceptedSha:'memory-sha',acceptanceRun:'memory-run',copiedPaths:['src/memory.js'],browserRuntimePaths:['src/memory.js'],artifactContracts:[{contractId:'KnowledgeEvidence',version:'1.0.0'}],requiredAdapters:['KnowledgeIntegrationSpine']});
  const futurePreflight=preflightAssemblyLane(futureManifest,{sourceHeadSha:'memory-sha',sourceFiles:{'src/memory.js':{digest:'M'}},integrationFiles:{}});

  const metrics={
    ft003CoreReady:f.ft003.state==='CORE_SIDE_READY',
    ft004CoreReady:f.ft004.state==='CORE_SIDE_READY',
    ft003NotLive:f.ft003.liveAcceptance===false,
    ft004NotLive:f.ft004.liveAcceptance===false,
    reflectionAuthorityPreserved:f.contracts.reflection.authorityClass==='INFERRED',
    observedAuthorityPreserved:f.contracts.observed.authorityClass==='OBSERVED',
    historicalPreserved:f.contracts.historical.temporalStatus==='HISTORICAL',
    hypothesesUnresolved:f.contracts.hypotheses.every(x=>x.temporalStatus==='UNRESOLVED'),
    lateConsolidationNextTurn:f.lateResult.route.late===true&&f.lateResult.route.effectiveDestination==='NEXT_TURN'&&f.ft003SealStable,
    staleEvidenceExcluded:f.ft003Publication.admission.stale.some(x=>x.evidence.evidenceId===f.staleEvidence.evidenceId),
    exactSourceCanon:f.exactLore.authorityClass==='SOURCE_CANON',
    derivedNonCanon:f.derivedLore.every(x=>x.authorityClass!=='SOURCE_CANON'),
    raptorNonCanon:f.derivedLore.find(x=>x.evidenceId.includes('raptor'))?.authorityClass==='INFERRED',
    treeNonCanon:f.derivedLore.find(x=>x.evidenceId.includes('tree'))?.authorityClass==='INFERRED',
    localInvalidation:f.invalidation.invalidatedCount===2&&f.invalidation.preservedCount===1&&!f.invalidation.wholeWorldInvalidation,
    oldRevisionRecoverable:Boolean(core.registry.getRevision('w3:lore:tavern@1')),
    newRevisionRestudied:Boolean(f.edit.relearned?.result?.revision?.id==='w3:lore:tavern@2'),
    sourceEditDoesNotMutateSeal:f.ft004SealStable,
    duplicateChannelsOneFact:dedupe.evidence.length===1&&dedupe.duplicateNominations===1&&dedupe.evidence[0].candidateLineage.nominationChannels.includes('DENSE')&&dedupe.evidence[0].candidateLineage.nominationChannels.includes('BM25'),
    disagreementNoForcedWinner:disagreement.winner===null&&['UNRESOLVED','PRESERVE_TEMPORAL_DISTINCTION'].includes(disagreement.resolutionStatus),
    mixedCompilerQualifiers:Boolean(f.ft004Publication.packet.knowledgeTraceIndex&&f.ft004Publication.packet.historical.some(x=>Array.isArray(x.q)&&x.q.some(q=>q.sourceClass==='SOURCE_LORE')&&x.q.some(q=>q.sourceClass==='DERIVED_REPRESENTATION'))),
    hardRuleSurvives:f.ft004Publication.packet.historical.some(x=>x.q?.some(q=>q.hardRule===true)),
    provenanceReconstruction:trace.complete&&reconstruction.complete&&trace.sourceRevisionRefs.includes('w3:lore:tavern@1'),
    traceReadModelFrozen:Object.isFrozen(traceModel)&&traceModel.readOnly===true&&traceModel.mutationAuthority===false,
    performanceStatesExplicit:Object.values(performance).filter(x=>x&&typeof x==='object'&&'state'in x).every(x=>Object.values(KnowledgeMeasurementState).includes(x.state)),
    nexusReplayReady:shadowStatus.replay==='REPLAY_ADAPTER_READY'&&shadowStatus.live==='LIVE_SHADOW_CONNECTION_PENDING'&&replay.replayState==='REPLAYED'&&replay.mutationAllowed===false,
    phaseGateSeparatesOwners:readiness.coreReady===true&&readiness.liveAssembledMainReady===false&&readiness.items.find(x=>x.dimension==='MEMORY_OWNER').state==='BLOCKED',
    futureManifestContracts:futureManifest.artifactContracts.length===1&&futureManifest.requiredAdapters.includes('KnowledgeIntegrationSpine')&&futurePreflight.state==='READY_TO_COPY',
  };
  return{pass:Object.values(metrics).every(Boolean),metrics,fixture:f,dedupe,disagreement,trace,reconstruction,traceModel,performance,replay,shadowStatus,readiness,futureManifest,futurePreflight};
}
