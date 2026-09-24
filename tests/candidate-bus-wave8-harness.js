import {CandidateBus} from '../src/candidate-bus.js';
import {RetrievalChannelRegistry} from '../src/retrieval-channel-registry.js';
import {
  CandidateFreshness,CandidateTruthStatus,RetrievalChannelCapability,RetrievalChannelHealth,
  createChannelNomination,createRetrievalChannelDescriptor,createRetrievalIntent,
} from '../src/candidate-bus-contracts.js';
import {
  createOwnerRetrievalArtifact,RetrievalIndexFamily,IndexVerifyStatus,
} from '../src/retrieval-index-contracts.js';
import {RetrievalIndexLifecycleManager} from '../src/retrieval-index-lifecycle.js';
import {SparseMemoryIndexAdapter,DenseMemoryIndexAdapter} from '../src/retrieval-index-adapters.js';
import {DeterministicRetrievalRepresentationProvider} from '../src/retrieval-representation-provider.js';
import {IndexRetrievalChannelProvider} from '../src/sensory-net-channels.js';
import {HotCognitionRuntime} from '../src/hot-cognition-runtime.js';
import {SensoryNetBackbone} from '../src/sensory-net-backbone.js';
import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {stableJson} from '../src/browser-runtime-utils.js';

const clone=(v)=>v==null?v:structuredClone(v);
const intent=(id,kind='GENERAL',query='sun blade')=>createRetrievalIntent({intentId:id,kind,query});
const nom=(channel,evidenceIdentity,overrides={})=>createChannelNomination({
  nominationId:overrides.nominationId??(channel+':'+evidenceIdentity+':'+(overrides.retrievalIntentIds?.[0]??'i')),
  channelId:channel,evidenceIdentity,candidateId:overrides.candidateId??('candidate:'+evidenceIdentity),
  artifactRef:overrides.artifactRef??{artifactId:'artifact:'+evidenceIdentity,artifactType:'Fixture',revision:overrides.artifactRevision??1},
  artifactRevision:overrides.artifactRevision??1,sourceRevisionRefs:overrides.sourceRevisionRefs??['source@1'],
  claimRefs:overrides.claimRefs??[],eventRefs:overrides.eventRefs??[],entityRefs:overrides.entityRefs??[],
  relationshipRefs:overrides.relationshipRefs??[],retrievalIntentIds:overrides.retrievalIntentIds??['intent:current'],
  rankSignals:overrides.rankSignals??{},normalizedRank:overrides.normalizedRank??.8,graphMetadata:overrides.graphMetadata??null,
  temporalHints:overrides.temporalHints??[],continuitySignals:overrides.continuitySignals??[],
  authorityClass:overrides.authorityClass??'OBSERVED',truthStatusHint:overrides.truthStatusHint??CandidateTruthStatus.CURRENT,
  provenance:overrides.provenance??[{ref:'prov:'+evidenceIdentity}],evidenceRefs:overrides.evidenceRefs??['evidence:'+evidenceIdentity],
  dependencyRevisions:overrides.dependencyRevisions??[],freshness:overrides.freshness??CandidateFreshness.FRESH,
  representationRef:overrides.representationRef??('rep:'+evidenceIdentity),representationRevision:overrides.representationRevision??1,
  representationText:overrides.representationText??evidenceIdentity,metadata:overrides.metadata??{},
  worldRevision:overrides.worldRevision??3,sceneRevision:overrides.sceneRevision??7,
});

function semanticPool(envelope){
  return envelope.candidates.map(c=>({
    candidateId:c.candidateId,evidenceIdentity:c.evidenceIdentity,authorityClass:c.authorityClass,truthStatusHint:c.truthStatusHint,
    freshness:c.freshness,retrievalIntentIds:c.retrievalIntentIds,
    channels:c.channelNominations.map(n=>({channelId:n.channelId,rankSignals:n.rankSignals,graphMetadata:n.graphMetadata})).sort((a,b)=>a.channelId.localeCompare(b.channelId)),
    claimRefs:c.claimRefs,eventRefs:c.eventRefs,
  })).sort((a,b)=>a.candidateId.localeCompare(b.candidateId));
}

export function runWave8CandidateBusAcceptance(){
  const bus=new CandidateBus({limits:{maxTotalCandidates:16,maxPerIntent:8,maxPerChannel:16,maxPerChannelIntent:8,maxNominationRecordsPerCandidate:8,maxGraphPathsPerCandidate:4,maxReceiptHistory:8}});
  const intents=[intent('intent:current','CURRENT','why is Mara furious about the Sun Blade?'),intent('intent:history','HISTORICAL','promise about Sun Blade'),intent('intent:relationship','RELATIONSHIP','Mara Eris relationship')];

  const promise=[
    nom('SPARSE','event:promise',{candidateId:'candidate:promise',eventRefs:['event:promise'],entityRefs:['mara','eris','sun-blade'],retrievalIntentIds:['intent:history'],rankSignals:{bm25Score:12.4},normalizedRank:.91,truthStatusHint:'HISTORICAL',representationText:'Mara made Eris promise never to bring the Sun Blade back.'}),
    nom('DENSE','event:promise',{candidateId:'candidate:promise',eventRefs:['event:promise'],entityRefs:['mara','eris','sun-blade'],retrievalIntentIds:['intent:current','intent:history'],rankSignals:{cosineSimilarity:.86},normalizedRank:.86,truthStatusHint:'HISTORICAL',representationText:'Mara made Eris promise never to bring the Sun Blade back.'}),
    nom('HISTORIAN','event:promise',{candidateId:'candidate:promise',eventRefs:['event:promise'],entityRefs:['mara','eris','sun-blade'],retrievalIntentIds:['intent:history','intent:relationship'],rankSignals:{temporalFit:.95,episodeRelevance:.92},normalizedRank:.95,truthStatusHint:'HISTORICAL'}),
    nom('GRAPH','event:promise',{candidateId:'candidate:promise',eventRefs:['event:promise'],entityRefs:['mara','eris','sun-blade'],relationshipRefs:['rel:mara-eris'],retrievalIntentIds:['intent:relationship'],rankSignals:{distance:2},normalizedRank:.7,truthStatusHint:'HISTORICAL',graphMetadata:{graphProvider:'fixture-graph',distance:2,path:['mara','promise','eris'],edgeTypes:['MADE_PROMISE']}}),
  ];
  const breach=[
    nom('DENSE','event:breach',{candidateId:'candidate:breach',eventRefs:['event:breach'],entityRefs:['eris','sun-blade','ember-tavern'],retrievalIntentIds:['intent:current','intent:history'],rankSignals:{cosineSimilarity:.9},normalizedRank:.9,truthStatusHint:'HISTORICAL',representationText:'Eris later left the Sun Blade at the tavern.'}),
    nom('HISTORIAN','event:breach',{candidateId:'candidate:breach',eventRefs:['event:breach'],entityRefs:['eris','sun-blade'],retrievalIntentIds:['intent:history'],rankSignals:{episodeRelevance:.96},normalizedRank:.96,truthStatusHint:'HISTORICAL'}),
  ];
  const continuity=[
    nom('ACTIVE_CONTINUITY','continuity:mara',{candidateId:'candidate:continuity:mara',entityRefs:['mara'],retrievalIntentIds:['intent:current'],rankSignals:{sceneRelevance:.99},normalizedRank:.99,authorityClass:'OBSERVED',truthStatusHint:'CURRENT',continuitySignals:[{type:'ACTIVE_CAST'}],representationText:'Mara is active in the current scene.'}),
    nom('ACTIVE_CONTINUITY','continuity:eris',{candidateId:'candidate:continuity:eris',entityRefs:['eris'],retrievalIntentIds:['intent:current'],rankSignals:{sceneRelevance:.99},normalizedRank:.99,authorityClass:'OBSERVED',truthStatusHint:'CURRENT',continuitySignals:[{type:'ACTIVE_CAST'}],representationText:'Eris is active in the current scene.'}),
  ];
  const longForm=bus.fuse({nominations:[...promise,...breach,...continuity],retrievalIntents:intents,query:'why is Mara furious?',currentRevisionSet:{sourceRevisionSet:['source@1'],worldRevision:3,sceneRevision:7}});
  const promiseCandidate=longForm.candidates.find(x=>x.evidenceIdentity==='event:promise');
  const breachCandidate=longForm.candidates.find(x=>x.evidenceIdentity==='event:breach');

  const sameSource=[
    nom('SPARSE','claim:owns',{candidateId:'candidate:owns',artifactRef:{artifactId:'lore:1',revision:1},claimRefs:['claim:owns'],representationRef:'lore:1:claim:owns',retrievalIntentIds:['intent:current'],rankSignals:{bm25Score:8}}),
    nom('DENSE','claim:owns',{candidateId:'candidate:owns',artifactRef:{artifactId:'lore:1',revision:1},claimRefs:['claim:owns'],representationRef:'lore:1:claim:owns',retrievalIntentIds:['intent:current'],rankSignals:{cosineSimilarity:.8}}),
    nom('SPARSE','claim:distrusts',{candidateId:'candidate:distrusts',artifactRef:{artifactId:'lore:1',revision:1},claimRefs:['claim:distrusts'],representationRef:'lore:1:claim:distrusts',retrievalIntentIds:['intent:relationship'],rankSignals:{bm25Score:7}}),
    nom('DENSE','claim:distrusts',{candidateId:'candidate:distrusts',artifactRef:{artifactId:'lore:1',revision:1},claimRefs:['claim:distrusts'],representationRef:'lore:1:claim:distrusts',retrievalIntentIds:['intent:relationship'],rankSignals:{cosineSimilarity:.75}}),
  ];
  const distinctClaims=bus.fuse({nominations:sameSource,retrievalIntents:intents,currentRevisionSet:{sourceRevisionSet:['source@1'],worldRevision:3,sceneRevision:7}});

  const conflict=bus.fuse({nominations:[
    nom('HISTORIAN','claim:destroyed',{candidateId:'candidate:destroyed',claimRefs:['claim:destroyed'],truthStatusHint:'CONTRADICTED',authorityClass:'OBSERVED',representationText:'Sun Blade destroyed in fire.'}),
    nom('HISTORIAN','claim:removed',{candidateId:'candidate:removed',claimRefs:['claim:removed'],truthStatusHint:'UNRESOLVED',authorityClass:'OBSERVED',representationText:'Sun Blade removed before fire.'}),
  ],retrievalIntents:[intents[1]],currentRevisionSet:{sourceRevisionSet:['source@1'],worldRevision:3,sceneRevision:7}});

  const orderA=bus.fuse({nominations:[...promise,...breach],retrievalIntents:intents,currentRevisionSet:{sourceRevisionSet:['source@1'],worldRevision:3,sceneRevision:7}});
  const orderB=bus.fuse({nominations:[...breach].reverse().concat([...promise].reverse(),[promise[0],promise[0]]) ,retrievalIntents:intents,currentRevisionSet:{sourceRevisionSet:['source@1'],worldRevision:3,sceneRevision:7}});

  const authority=bus.fuse({nominations:[
    nom('DENSE','reflection:1',{authorityClass:'INFERRED',truthStatusHint:'UNRESOLVED',normalizedRank:1,rankSignals:{cosineSimilarity:.999}}),
    nom('SPARSE','reflection:1',{authorityClass:'INFERRED',truthStatusHint:'UNRESOLVED',normalizedRank:1,rankSignals:{bm25Score:100}}),
  ],retrievalIntents:[intents[0]],currentRevisionSet:{sourceRevisionSet:['source@1'],worldRevision:3,sceneRevision:7}});

  const stale=bus.fuse({nominations:[nom('DENSE','stale:1',{sourceRevisionRefs:['source@4'],worldRevision:3,sceneRevision:7})],retrievalIntents:[intents[0]],currentRevisionSet:{sourceRevisionSet:['source@5'],worldRevision:3,sceneRevision:7}});

  const boundedBus=new CandidateBus({limits:{maxTotalCandidates:3,maxPerIntent:2,maxPerChannel:4,maxPerChannelIntent:3,maxNominationRecordsPerCandidate:3,maxGraphPathsPerCandidate:1,maxMetadataBytesPerCandidate:256,maxReceiptHistory:2}});
  const bounded=boundedBus.fuse({nominations:Array.from({length:10},(_,i)=>nom('DENSE','bounded:'+i,{candidateId:'candidate:b'+i,retrievalIntentIds:[i%2?'intent:history':'intent:current'],normalizedRank:1-i/20,metadata:{note:'x'.repeat(400),i}})),retrievalIntents:intents,currentRevisionSet:{sourceRevisionSet:['source@1'],worldRevision:3,sceneRevision:7}});

  return {
    pass:Boolean(
      promiseCandidate&&breachCandidate&&promiseCandidate.channelNominations.length===4&&
      distinctClaims.candidates.length===2&&conflict.candidates.length===2&&
      stableJson(semanticPool(orderA))===stableJson(semanticPool(orderB))&&
      authority.candidates[0]?.authorityClass==='INFERRED'&&authority.candidates[0]?.truthStatusHint==='UNRESOLVED'&&
      stale.candidates[0]?.freshness==='STALE'&&bounded.candidates.length<=3&&bounded.fusionReceipt.boundedOutCount>0
    ),
    longForm,distinctClaims,conflict,orderA,orderB,authority,stale,bounded,
    metrics:{
      promiseDeduped:promiseCandidate?.channelNominations.length===4,
      promiseAndBreachDistinct:Boolean(promiseCandidate&&breachCandidate&&promiseCandidate.candidateId!==breachCandidate.candidateId),
      noAngerSynthesis:!longForm.candidates.some(x=>/angry|furious/i.test(x.representationText??'')),
      distinctClaimsSameSource:distinctClaims.candidates.length===2,
      conflictPreserved:conflict.candidates.length===2,
      orderIndependent:stableJson(semanticPool(orderA))===stableJson(semanticPool(orderB)),
      replayIdempotent:orderA.candidateCount===orderB.candidateCount&&orderB.fusionReceipt.duplicateNominationCount>=1,
      authorityNotEscalated:authority.candidates[0]?.authorityClass==='INFERRED',
      truthStatusNotEscalated:authority.candidates[0]?.truthStatusHint==='UNRESOLVED',
      staleVisible:stale.candidates[0]?.freshness==='STALE',
      intentTraceability:Object.keys(longForm.fusionReceipt.candidateIdsByIntent).length===3,
      boundedPool:bounded.candidates.length<=3&&bounded.fusionReceipt.boundedOutCount>0,
      receiptBounded:boundedBus.diagnostics().recentReceipts.length<=2,
    },
  };
}

export function runWave8ChannelFailureGolden(){
  const registry=new RetrievalChannelRegistry();
  const make=(id,{health=RetrievalChannelHealth.HEALTHY,available=true,throws=false,freshness=CandidateFreshness.FRESH}={})=>({
    descriptor:createRetrievalChannelDescriptor({channelId:id,capabilities:[RetrievalChannelCapability.SPECIALIZED_STORE],supportedIntentKinds:['GENERAL'],maxCandidates:4,health,available}),
    retrieve:(i)=>{if(throws)throw Object.assign(new Error(id+' unavailable'),{code:'CHANNEL_DOWN'});return[nom(id,'evidence:'+id,{retrievalIntentIds:[i.intentId],freshness})];},
  });
  registry.register(make('SPARSE'));
  registry.register(make('DENSE',{throws:true}));
  registry.register(make('GRAPH',{health:RetrievalChannelHealth.STALE,freshness:CandidateFreshness.STALE}));
  registry.register(make('HISTORIAN'));
  registry.register(make('CONTINUITY'));
  const i=intent('intent:test');
  const scatter=registry.retrieveAllSync({intents:[i],context:{}});
  const bus=new CandidateBus();
  const envelope=bus.fuse({nominations:scatter.nominations,retrievalIntents:[i],unavailableChannels:scatter.unavailableChannels,degradedChannels:scatter.degradedChannels,currentRevisionSet:{sourceRevisionSet:['source@1'],worldRevision:3,sceneRevision:7}});
  return{
    pass:envelope.candidates.some(x=>x.channelNominations.some(n=>n.channelId==='SPARSE'))&&envelope.candidates.some(x=>x.channelNominations.some(n=>n.channelId==='HISTORIAN'))&&
      scatter.degradedChannels.includes('DENSE')&&scatter.degradedChannels.includes('GRAPH')&&scatter.errors.some(x=>x.channelId==='DENSE'),
    scatter,envelope,manifest:registry.manifest(),
  };
}

function owner(id,revision,sourceRevision,text,claimRef){
  return createOwnerRetrievalArtifact({artifactId:id,artifactRevision:revision,artifactType:'LoreClaim',sourceId:'source:'+id,sourceRevision,
    claimRefs:[claimRef],entityRefs:['sun-blade'],authorityClass:'SOURCE_CANON',truthStatusHint:'HISTORICAL',
    provenanceRefs:[sourceRevision,claimRef],dependencyInvalidators:[sourceRevision],semanticKey:claimRef,text});
}

export function runWave8IndexLifecycleAcceptance(){
  const provider=new DeterministicRetrievalRepresentationProvider(),manager=new RetrievalIndexLifecycleManager({representationProvider:provider});
  const sparse=new SparseMemoryIndexAdapter({adapterId:'SPARSE_A'}),dense=new DenseMemoryIndexAdapter({adapterId:'DENSE_A'});
  manager.registerAdapter(sparse);manager.registerAdapter(dense);
  const A1=owner('A',1,'source:A@1','Mara owns Ember Tavern.','claim:A');
  const B1=owner('B',1,'source:B@1','Eris left the Sun Blade at Ember Tavern.','claim:B');
  const C1=owner('C',1,'source:C@1','The tavern has a stone cellar.','claim:C');
  const inserts=[manager.indexArtifact(A1),manager.indexArtifact(B1),manager.indexArtifact(C1)];
  const beforeA=manager.expectedRepresentations('SPARSE_A').find(x=>x.ownerArtifactId==='A');
  const beforeC=manager.expectedRepresentations('DENSE_A').find(x=>x.ownerArtifactId==='C');
  const B2=owner('B',2,'source:B@2','Eris removed the Sun Blade before the fire.','claim:B');
  const update=manager.indexArtifact(B2);
  const afterA=manager.expectedRepresentations('SPARSE_A').find(x=>x.ownerArtifactId==='A');
  const afterC=manager.expectedRepresentations('DENSE_A').find(x=>x.ownerArtifactId==='C');
  const bSparse=manager.expectedRepresentations('SPARSE_A').find(x=>x.ownerArtifactId==='B');
  const bDense=manager.expectedRepresentations('DENSE_A').find(x=>x.ownerArtifactId==='B');
  const verifyFresh=manager.verify({ownerArtifacts:[A1,B2,C1]});

  const invalid=manager.invalidateArtifact('B',{reason:'TEST_INVALIDATION'});
  const invalidVerify=manager.verify({ownerArtifacts:[A1,B2,C1]});
  manager.indexArtifact({...clone(B2),artifactRevision:3,sourceRevision:'source:B@3',text:'Eris removed the Sun Blade before the fire, confirmed.'});
  const B3=manager.getOwnerArtifact('B');
  const tombstone=manager.tombstoneArtifact('B',{reason:'SOURCE_RETIRED'});
  const tombVerify=manager.verify({ownerArtifacts:[A1,B3,C1]});

  const identitiesBefore=manager.expectedRepresentations('SPARSE_A').map(x=>[x.ownerArtifactId,x.claimRefs[0],x.provenanceRefs]).sort();
  const rebuild=manager.rebuild({ownerArtifacts:[A1,B3,C1]});
  const identitiesAfter=manager.expectedRepresentations('SPARSE_A').map(x=>[x.ownerArtifactId,x.claimRefs[0],x.provenanceRefs]).sort();

  const denseB=new DenseMemoryIndexAdapter({adapterId:'DENSE_B'});
  const migration=manager.migrate({fromAdapterId:'DENSE_A',toAdapter:denseB,ownerArtifacts:[A1,B3,C1]});
  const indexAChannel=new IndexRetrievalChannelProvider({channelId:'DENSE_A_CHANNEL',lifecycle:manager,adapterId:'DENSE_A'});
  const indexBChannel=new IndexRetrievalChannelProvider({channelId:'DENSE_B_CHANNEL',lifecycle:manager,adapterId:'DENSE_B'});
  const ri=intent('intent:index','HISTORICAL','Sun Blade removed before fire');
  const ca=indexAChannel.retrieve(ri,{worldRevision:3,sceneRevision:7}),cb=indexBChannel.retrieve(ri,{worldRevision:3,sceneRevision:7});
  const identityA=ca[0]?.evidenceIdentity,identityB=cb[0]?.evidenceIdentity;

  let failDense=false;
  const tornManager=new RetrievalIndexLifecycleManager({representationProvider:provider});
  const tornSparse=new SparseMemoryIndexAdapter({adapterId:'TORN_SPARSE'});
  const tornDense=new DenseMemoryIndexAdapter({adapterId:'TORN_DENSE',faultInjector:(op,payload)=>failDense&&op==='PUT'&&payload.ownerArtifactRevision===2?'dense write failed':false});
  tornManager.registerAdapter(tornSparse);tornManager.registerAdapter(tornDense);
  tornManager.indexArtifact(B1);failDense=true;
  const tornUpdate=tornManager.indexArtifact(B2),tornVerify=tornManager.verify({ownerArtifacts:[B1]});
  const tornQuery=tornManager.queryAdapter('TORN_SPARSE',{query:'Sun Blade',currentOwnerArtifacts:[B2]});
  failDense=false;const recovered=tornManager.indexArtifact(B2),recoveredVerify=tornManager.verify({ownerArtifacts:[B2]});

  let outOfOrderRejected=false;try{tornManager.indexArtifact(B1);}catch(error){outOfOrderRejected=error.code==='OWNER_REVISION_OUT_OF_ORDER';}
  const duplicate=tornManager.indexArtifact(B2);

  return{
    pass:Boolean(
      inserts.every(x=>x.status==='APPLIED')&&update.status==='APPLIED'&&beforeA.representationRevision===afterA.representationRevision&&beforeC.representationRevision===afterC.representationRevision&&
      bSparse.ownerArtifactRevision===2&&bDense.ownerArtifactRevision===2&&verifyFresh.overall==='FRESH'&&
      invalid.affectedRepresentationIds.length===2&&Object.values(invalidVerify.adapterReceipts[0].statusCounts).some(Boolean)&&
      tombVerify.adapterReceipts.some(r=>(r.statusCounts.TOMBSTONED??0)>0)&&stableJson(identitiesBefore)===stableJson(identitiesAfter)&&
      migration.verification.overall==='FRESH'&&identityA===identityB&&tornUpdate.status==='TORN'&&tornVerify.overall==='DEGRADED'&&
      tornQuery.every(x=>x.freshness==='STALE')&&recovered.status==='APPLIED'&&recoveredVerify.overall==='FRESH'&&outOfOrderRejected&&duplicate.status==='NO_CHANGE'
    ),
    manager,inserts,update,verifyFresh,invalid,invalidVerify,tombstone,tombVerify,rebuild,migration,
    torn:{tornUpdate,tornVerify,tornQuery,recovered,recoveredVerify,outOfOrderRejected,duplicate},
    metrics:{
      sourceEditSmallCone:beforeA.representationRevision===afterA.representationRevision&&beforeC.representationRevision===afterC.representationRevision&&bSparse.ownerArtifactRevision===2&&bDense.ownerArtifactRevision===2,
      staleOldRevisionCannotPublish:bSparse.sourceRevision==='source:B@2'&&bDense.sourceRevision==='source:B@2',
      invalidationVisible:invalid.affectedRepresentationIds.length===2,
      tombstoneVisible:tombVerify.adapterReceipts.some(r=>(r.statusCounts.TOMBSTONED??0)>0),
      rebuildIdentityStable:stableJson(identitiesBefore)===stableJson(identitiesAfter),
      migrationCandidateIdentityStable:identityA===identityB,
      tornDetected:tornUpdate.status==='TORN'&&tornVerify.overall==='DEGRADED',
      tornNotFresh:tornQuery.every(x=>x.freshness==='STALE'),
      tornRecoverable:recovered.status==='APPLIED'&&recoveredVerify.overall==='FRESH',
      duplicateLifecycleIdempotent:duplicate.status==='NO_CHANGE',
      outOfOrderRejected,
    },
  };
}

export function runWave8ContinuityAndCoreAcceptance(){
  const hot=new HotCognitionRuntime();hot.activateChat('chat:continuity');
  hot.consumeSceneSignal({sceneId:'scene:now',sceneRevision:5,sourceRevisionRefs:[],location:{value:{place:'ember-tavern'},observationClass:'OBSERVED',confidence:1,evidenceRefs:[]},narrativeTime:{value:'night',observationClass:'OBSERVED',confidence:1,evidenceRefs:[]},activeCast:[{characterId:'mara',state:'PRESENT',observationClass:'OBSERVED'},{characterId:'eris',state:'PRESENT',observationClass:'OBSERVED'}],castObservations:[],activeThreads:[{threadId:'thread:blade',status:'ACTIVE',owner:'SCENE_INTELLIGENCE',source:'SCENE_INTELLIGENCE',evidenceRefs:[],sourceRevisionRefs:[],revision:1}],objects:[],uncertainFields:[],conflictSignals:[],boundaryState:{status:'STABLE'},sceneRelationship:'CONTINUES',transitionType:'CONTINUES',health:{status:'ready',reasons:[]},authority:'DESCRIPTIVE'});
  const backbone=new SensoryNetBackbone({graph:{revision:0,allClaims:()=>[],neighbors:()=>[],unresolvedClaims:()=>[]},sourceRegistry:{activeRevisionIds:()=>[],getRevision:()=>null,isActiveRevision:()=>true},hotCognition:hot});
  const continuity=backbone.continuityOnly('what is happening now?',{intent:'CURRENT',sceneRevision:5,retrievalIntents:[intent('intent:now','CURRENT','what is happening now?')]});

  const core=new Area52CognitiveCore();
  const published=core.publishGenerationContext({turnId:'turn:wave8',correlationId:'corr:wave8',query:'What is relevant right now?',intent:'CURRENT',anchorEntityIds:[],sealedAt:2000});
  return{
    pass:continuity.candidateCount>0&&continuity.unavailableChannels.length===0&&published.candidateEnvelope?.kind==='CandidateBusEnvelope'&&published.candidateEnvelope.authorityGranted===false&&published.precisionResults.length>=0,
    continuity,published,
  };
}

export function runWave8Acceptance(){
  const candidateBus=runWave8CandidateBusAcceptance(),failures=runWave8ChannelFailureGolden(),index=runWave8IndexLifecycleAcceptance(),continuity=runWave8ContinuityAndCoreAcceptance();
  const metrics={...candidateBus.metrics,...index.metrics,
    partialChannelFailureIsolated:failures.pass,
    activeContinuityZeroExternal:continuity.continuity.candidateCount>0&&continuity.continuity.unavailableChannels.length===0,
    productionCoreUsesCandidateEnvelope:continuity.published.candidateEnvelope?.kind==='CandidateBusEnvelope',
    busGrantsNoAuthority:continuity.published.candidateEnvelope?.authorityGranted===false&&candidateBus.longForm.authorityGranted===false,
  };
  return{pass:candidateBus.pass&&failures.pass&&index.pass&&continuity.pass&&Object.values(metrics).every(Boolean),metrics,candidateBus,failures,index,continuity};
}
