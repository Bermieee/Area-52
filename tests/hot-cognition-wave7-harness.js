import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {AuthorityClass} from '../src/contracts.js';
import {HotCognitionRuntime} from '../src/hot-cognition-runtime.js';
import {HotSegmentKind,HotFreshness,HotChangeState,HotDependencyState,HotUpdateStatus} from '../src/hot-cognition-contracts.js';
import {ResultClass,ResultDestination,ResultPayloadClass,createCognitiveResult} from '../src/publication-contracts.js';
import {PromptSlot,ReuseState} from '../src/adaptive-context-contracts.js';
import {EMBER_TAVERN_WAVE3} from './fixtures/ember-tavern-wave3.js';

const clone=(v)=>v==null?v:structuredClone(v);
const seg=(snapshot,kind)=>snapshot.segments[kind];
const ids=(rows)=>rows.map(x=>x.id??x.threadId??x.ref??x.refId).filter(Boolean);
const source='scene:external@1';

export function sceneSignal({
  sceneId='scene:ember',sceneRevision=1,place='ember-tavern',subLocation='main-room',
  cast=['eris','mara'],mentioned=[],entities=['lantern'],threads=[],sourceRevisionRefs=[source],
  locationAuthority='OBSERVED',sceneRelationship='CONTINUES',latestEpisodeRef=null,
}={}){
  return{
    kind:'SceneIntegrationSignal',sceneId,sceneRevision,sourceRevisionRefs,
    location:{value:{place,subLocation},observationClass:locationAuthority,confidence:.95,evidenceRefs:['e:location:'+sceneRevision]},
    narrativeTime:{value:'evening',observationClass:'OBSERVED',confidence:.8,evidenceRefs:['e:time:'+sceneRevision]},
    activeCast:cast.map(id=>({characterId:id,state:'PRESENT',observationClass:'OBSERVED',confidence:.95,evidenceRefs:['e:cast:'+id]})),
    castObservations:[
      ...cast.map(id=>({characterId:id,state:'PRESENT',observationClass:'OBSERVED'})),
      ...mentioned.map(id=>({characterId:id,state:'MENTIONED_ONLY',observationClass:'OBSERVED'})),
    ],
    activeThreads:threads.map((row,i)=>typeof row==='string'?{
      threadId:row,status:'ACTIVE',owner:'SCENE_INTELLIGENCE',source:'SCENE_INTELLIGENCE',
      unresolvedQuestion:'What happens with '+row+'?',evidenceRefs:['e:thread:'+row],sourceRevisionRefs,revision:i+1,
    }:row),
    objects:entities.map(id=>({objectRef:id,state:'PRESENT',observationClass:'OBSERVED',confidence:.9,evidenceRefs:['e:object:'+id]})),
    objectObservations:entities.map(id=>({objectRef:id,state:'PRESENT',observationClass:'OBSERVED'})),
    uncertainFields:[],conflictSignals:[],boundaryState:{status:'STABLE'},sceneRelationship,transitionType:sceneRelationship,
    previousSceneRef:null,resumedSceneRef:null,latestEpisodeRef,episodeRefs:latestEpisodeRef?[latestEpisodeRef]:[],
    prefetchRecommendations:[],objectTransitionRefs:[],health:{status:'ready',reasons:[]},
    provenance:['scene-signal:'+sceneRevision],diagnosticRefs:{eventIds:['scene-event:'+sceneRevision]},
    authority:'DESCRIPTIVE',authorityGranted:false,settlementAuthority:false,contextSealBypass:false,
  };
}

function loadGoldenCore(){
  const core=new Area52CognitiveCore();
  for(const row of EMBER_TAVERN_WAVE3.sources)core.importAndLearn(row);
  for(const row of EMBER_TAVERN_WAVE3.experiences)core.importAndLearn(row);
  core.activateHotCognitionChat('chat:golden');
  return core;
}

function findSection(plan,slot){return plan.sections.find(x=>x.slot===slot)??null;}

export function runHotCognitionWave7Acceptance(){
  const core=loadGoldenCore(),steps=[];

  const r1=core.consumeSceneSignal(sceneSignal({sceneRevision:1,mentioned:['lili'],latestEpisodeRef:{artifactId:'episode:1'}}));
  const s1=core.hotCognitionSnapshot();steps.push({step:1,name:'chat / scene opens',receipt:r1,snapshot:s1});
  const baseRevisions=Object.fromEntries(Object.values(HotSegmentKind).map(kind=>[kind,seg(s1,kind).revision]));

  const r2=core.consumeSceneSignal(sceneSignal({sceneRevision:2,mentioned:['lili'],latestEpisodeRef:{artifactId:'episode:1'}}));
  const s2=core.hotCognitionSnapshot();steps.push({step:2,name:'stable dialogue',receipt:r2,snapshot:s2});

  const r3=core.consumeSceneSignal(sceneSignal({sceneRevision:3,cast:['eris','mara','doran'],mentioned:['lili'],latestEpisodeRef:{artifactId:'episode:1'}}));
  const s3=core.hotCognitionSnapshot();steps.push({step:3,name:'third character enters',receipt:r3,snapshot:s3});

  const r4=core.consumeSceneSignal(sceneSignal({sceneRevision:4,cast:['eris','mara','doran'],mentioned:['lili'],threads:['promise:return-blade'],latestEpisodeRef:{artifactId:'episode:2'}}));
  const s4=core.hotCognitionSnapshot();steps.push({step:4,name:'unresolved thread appears',receipt:r4,snapshot:s4});

  const r5=core.consumeSceneSignal(sceneSignal({sceneRevision:5,place:'ember-tavern',subLocation:'rear-courtyard',cast:['eris','mara','doran'],mentioned:['lili'],threads:['promise:return-blade'],latestEpisodeRef:{artifactId:'episode:2'}}));
  const s5=core.hotCognitionSnapshot();steps.push({step:5,name:'sub-location changes',receipt:r5,snapshot:s5});

  const r6=core.consumeSceneSignal(sceneSignal({sceneRevision:6,place:'ember-tavern',subLocation:'rear-courtyard',cast:['eris','doran'],mentioned:['mara','lili'],threads:['promise:return-blade'],latestEpisodeRef:{artifactId:'episode:2'}}));
  const s6=core.hotCognitionSnapshot();steps.push({step:6,name:'one character exits',receipt:r6,snapshot:s6});

  const n1=core.consumeNarrativeEvidence({kind:'NarrativeEvidence',activity:'USER_SEND',chatId:'chat:golden',messageId:'m1',messageRevision:1,turnId:'turn:narr:1',sourceRevisionId:'chat:golden:m1@1',sequence:1,current:true,historical:false,content:'Eris promises to return the blade.',role:'user',invalidates:[]});
  const n2=core.consumeNarrativeEvidence({kind:'NarrativeEvidence',activity:'EDIT',chatId:'chat:golden',messageId:'m1',messageRevision:2,turnId:'turn:narr:1',sourceRevisionId:'chat:golden:m1@2',sequence:2,current:true,historical:false,content:'Eris promises to return the blade before dawn.',role:'user',invalidates:[],replacesRevisionId:'chat:golden:m1@1'});
  const s7=core.hotCognitionSnapshot();steps.push({step:7,name:'source evidence edited',receipt:n2,snapshot:s7});

  const beforeStale=core.hotCognitionSnapshot();
  const stale=core.consumeSceneSignal(sceneSignal({sceneRevision:5,place:'old-place',subLocation:'wrong',cast:['mara']}));
  const afterStale=core.hotCognitionSnapshot();steps.push({step:8,name:'stale Scene update rejected',receipt:stale,snapshot:afterStale});

  core.hotCognition.consumeOwnerWorldChange({
    updateId:'world-ref:lore@1',worldRevision:core.graph.revision,sourceRevisionRefs:['w3:lore:tavern@1'],
    artifactRefs:[{ref:'world:ember-owner',temporalStatus:'CURRENT'}],provenanceRefs:['w3:lore:tavern@1'],
  });
  const beforeLoreInvalidation=core.hotCognitionSnapshot();
  const targeted=core.hotCognition.invalidateKnowledge({updateId:'invalidate:lore@1',invalidatedSourceRevisionRefs:['w3:lore:tavern@1'],reason:'SOURCE_EDIT'});
  const afterLoreInvalidation=core.hotCognitionSnapshot();

  const preSeal=core.hotCognitionSnapshot();
  const published=core.publishGenerationContext({
    turnId:'turn:golden:seal',correlationId:'corr:golden:seal',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',
    anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:1000,
  });
  const delivered=core.deliverGenerationContext({published,generationId:'generation:golden:1',modelProfileId:'RECENCY_WEIGHTED',userInput:EMBER_TAVERN_WAVE3.query});
  const sealedRecord=core.hotCognition.snapshotForTurn('turn:golden:seal'),sealedHot=sealedRecord?.snapshot??null;steps.push({step:9,name:'generation seals',receipt:published.sealReceipt,snapshot:sealedHot});

  const late=core.publication.receiveResult(createCognitiveResult({
    id:'result:late:golden',taskId:'task:late:golden',turnId:'turn:golden:seal',correlationId:'corr:golden:seal',
    sourceSubsystem:'COPROCESSOR',workerId:'provider:test',resultType:'WORK_RESULT',resultClass:ResultClass.OPPORTUNISTIC,
    payloadClass:ResultPayloadClass.DERIVED_DATA,evidenceIds:[],provenance:{providerId:'untrusted-provider'},
    sourceRevisionIds:[],worldRevision:published.worldRevision,sceneRevision:published.sceneRevision,authorityClass:AuthorityClass.INFERRED,
    destination:ResultDestination.FOREGROUND,payload:{hotCognitionRefs:['late:continuity-ref']},timing:{completedAt:1001},
  }));
  const afterLate=core.hotCognitionSnapshot();steps.push({step:10,name:'late result arrives',receipt:late.route,snapshot:afterLate});

  const rTransition=core.consumeSceneSignal(sceneSignal({
    sceneId:'scene:street',sceneRevision:7,place:'market-street',subLocation:'north-gate',cast:['eris'],mentioned:['mara'],
    entities:['sun-blade-case'],threads:[],sourceRevisionRefs:['scene:street@1'],sceneRelationship:'PRECEDES',latestEpisodeRef:{artifactId:'episode:3'},
  }));
  const transitioned=core.hotCognitionSnapshot();steps.push({step:11,name:'scene transitions',receipt:rTransition,snapshot:transitioned});

  const persisted=core.hotCognition.exportState();
  const restoredRuntime=new HotCognitionRuntime({sourceRegistry:core.registry,getWorldRevision:()=>core.graph.revision});
  restoredRuntime.restoreState(persisted,{sceneRevision:7,worldRevision:core.graph.revision,activeSourceRevisionRefs:core.registry.activeRevisionIds()});
  core.hotCognition=restoredRuntime;core.publication.setSceneRevision(7);
  const restored=core.hotCognitionSnapshot();steps.push({step:12,name:'extension reconstruction',snapshot:restored});

  const nextPublished=core.publishGenerationContext({
    turnId:'turn:golden:next',correlationId:'corr:golden:next',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',
    anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:1100,
  });
  const nextDelivered=core.deliverGenerationContext({published:nextPublished,generationId:'generation:golden:2',modelProfileId:'RECENCY_WEIGHTED',userInput:EMBER_TAVERN_WAVE3.query});
  steps.push({step:13,name:'next generation consumes restored snapshot',receipt:nextPublished.sealReceipt,snapshot:core.hotCognition.snapshotForTurn('turn:golden:next')?.snapshot});

  const stable8=core.consumeSceneSignal(sceneSignal({
    sceneId:'scene:street',sceneRevision:8,place:'market-street',subLocation:'north-gate',cast:['eris'],mentioned:['mara'],
    entities:['sun-blade-case'],threads:[],sourceRevisionRefs:['scene:street@1'],sceneRelationship:'PRECEDES',latestEpisodeRef:{artifactId:'episode:3'},
  }));
  const stableSnapshot=core.hotCognitionSnapshot();
  const reusePublished=core.publishGenerationContext({
    turnId:'turn:golden:reuse',correlationId:'corr:golden:reuse',query:EMBER_TAVERN_WAVE3.query,intent:'CURRENT',
    anchorEntityIds:EMBER_TAVERN_WAVE3.anchors,sealedAt:1200,
  });
  const reuseDelivered=core.deliverGenerationContext({published:reusePublished,generationId:'generation:golden:3',modelProfileId:'RECENCY_WEIGHTED',userInput:EMBER_TAVERN_WAVE3.query,previousPlan:nextDelivered.plan});
  steps.push({step:14,name:'stable next generation reuses maintained segments',receipt:stable8,snapshot:stableSnapshot});

  const graphEmpty=core.hotCognition.setGraphNeighborhood({state:HotDependencyState.AVAILABLE,refs:[],sourceRevisionRefs:[],updateId:'graph:empty'});
  const graphUnavailable=core.hotCognition.setGraphNeighborhood({state:HotDependencyState.UNAVAILABLE,refs:[],sourceRevisionRefs:[],updateId:'graph:unavailable'});
  const degraded=core.hotCognitionSnapshot();

  const historicalBefore=(seg(degraded,HotSegmentKind.WORLD_REFERENCES).value??[]).length;
  core.hotCognition.consumeOwnerWorldChange({updateId:'historical:not-current',worldRevision:core.graph.revision,artifactRefs:[{ref:'historical-only',temporalStatus:'HISTORICAL'}]});
  const historicalAfter=(seg(core.hotCognitionSnapshot(),HotSegmentKind.WORLD_REFERENCES).value??[]).length;

  const authorityRuntime=new HotCognitionRuntime();authorityRuntime.activateChat('chat:authority');
  authorityRuntime.consumeSceneSignal(sceneSignal({sceneId:'scene:authority',sceneRevision:1,locationAuthority:'INFERRED'}));
  const inferred1=authorityRuntime.snapshot();
  authorityRuntime.consumeSceneSignal(sceneSignal({sceneId:'scene:authority',sceneRevision:2,locationAuthority:'INFERRED'}));
  const inferred2=authorityRuntime.snapshot();
  let authorityViolation=false;try{authorityRuntime.consumeSceneSignal({...sceneSignal({sceneId:'scene:authority',sceneRevision:3}),authorityGranted:true});}catch(error){authorityViolation=error.code==='HOT_AUTHORITY_VIOLATION';}

  const cross=new HotCognitionRuntime();
  cross.activateChat('chat:a');cross.consumeSceneSignal(sceneSignal({sceneId:'scene:a',sceneRevision:1,place:'alpha'}));
  const alpha=cross.snapshot();
  cross.activateChat('chat:b');cross.consumeSceneSignal(sceneSignal({sceneId:'scene:b',sceneRevision:1,place:'beta'}));
  cross.activateChat('chat:a');const alphaAgain=cross.snapshot();

  const editRuntime=new HotCognitionRuntime({maxRecentTail:4});editRuntime.activateChat('chat:edit');
  const baseEvidence={kind:'NarrativeEvidence',chatId:'chat:edit',messageId:'m',turnId:'t',role:'assistant',current:true,historical:false,invalidates:[]};
  editRuntime.consumeNarrativeEvidence({...baseEvidence,activity:'ASSISTANT_GENERATION_COMPLETE',messageRevision:1,sourceRevisionId:'m@1',sequence:1,content:'one'});
  editRuntime.consumeNarrativeEvidence({...baseEvidence,activity:'EDIT',messageRevision:2,sourceRevisionId:'m@2',sequence:2,content:'two',replacesRevisionId:'m@1'});
  editRuntime.consumeNarrativeEvidence({...baseEvidence,activity:'REGENERATE',messageRevision:3,sourceRevisionId:'m@3',sequence:3,content:'three',invalidates:['m@2']});
  editRuntime.consumeNarrativeEvidence({...baseEvidence,activity:'SWIPE_SELECTED',messageRevision:4,sourceRevisionId:'m@4:swipe',sequence:4,content:'four',invalidates:['m@3'],swipeId:'s2'});
  editRuntime.consumeNarrativeEvidence({...baseEvidence,activity:'DELETE',messageRevision:5,sourceRevisionId:'m@5',sequence:5,content:null,current:false,invalidates:['m@4:swipe']});
  const editTail=seg(editRuntime.snapshot(),HotSegmentKind.RECENT_EPISODE_TAIL).value;

  const readModel=core.observation.hotCognition(core.hotCognitionSnapshot());
  const currentSceneSection=findSection(nextDelivered.plan,PromptSlot.CURRENT_SCENE);
  const threadSection=findSection(delivered.plan,PromptSlot.ACTIVE_THREADS);
  const reuseSceneSegment=reuseDelivered.plan?.segments?.find(x=>x.sections?.some(section=>section.slot===PromptSlot.CURRENT_SCENE));

  const debug={
    preSealSnapshotId:preSeal.snapshotId,
    publishedSnapshotId:published.hotCognition?.snapshotId??null,
    sealedSnapshotId:sealedHot?.snapshotId??null,
    preSealHotRevision:preSeal.hotRevision,
    sealedHotRevision:sealedHot?.hotRevision??null,
    afterLateHotRevision:afterLate.hotRevision,
    sealedSnapshotFrozen:Boolean(sealedHot&&Object.isFrozen(sealedHot)),
    sealedContainsLateRef:Boolean(sealedHot&&JSON.stringify(sealedHot).includes('late:continuity-ref')),
    liveContainsLateRef:JSON.stringify(afterLate).includes('late:continuity-ref'),
    reuseSceneState:reuseSceneSegment?.reuseState??null,
  };

  const metrics={
    sceneOpenApplied:r1.status===HotUpdateStatus.APPLIED&&s1.sceneId==='scene:ember'&&s1.sceneRevision===1,
    mentionedOnlyNotActive:!ids(seg(s1,HotSegmentKind.ACTIVE_CAST).value).includes('lili'),
    stableLocationReused:seg(s2,HotSegmentKind.LOCATION).revision===baseRevisions[HotSegmentKind.LOCATION]&&r2.reusedSegments.includes(HotSegmentKind.LOCATION),
    stableCastReused:seg(s2,HotSegmentKind.ACTIVE_CAST).revision===baseRevisions[HotSegmentKind.ACTIVE_CAST]&&r2.reusedSegments.includes(HotSegmentKind.ACTIVE_CAST),
    enteringCharacterTargeted:ids(seg(s3,HotSegmentKind.ACTIVE_CAST).value).includes('doran')&&seg(s3,HotSegmentKind.LOCATION).revision===seg(s2,HotSegmentKind.LOCATION).revision,
    threadTargeted:seg(s4,HotSegmentKind.ACTIVE_THREADS).revision>seg(s3,HotSegmentKind.ACTIVE_THREADS).revision&&seg(s4,HotSegmentKind.LOCATION).revision===seg(s3,HotSegmentKind.LOCATION).revision,
    locationTargeted:seg(s5,HotSegmentKind.LOCATION).value.subLocation==='rear-courtyard'&&seg(s5,HotSegmentKind.ACTIVE_CAST).revision===seg(s4,HotSegmentKind.ACTIVE_CAST).revision,
    characterExitTargeted:!ids(seg(s6,HotSegmentKind.ACTIVE_CAST).value).includes('mara')&&ids(seg(s6,HotSegmentKind.ACTIVE_CAST).value).includes('eris'),
    editReplacesTail:ids(seg(s7,HotSegmentKind.RECENT_EPISODE_TAIL).value).includes('recent:chat:golden:m1@2')&&!ids(seg(s7,HotSegmentKind.RECENT_EPISODE_TAIL).value).includes('recent:chat:golden:m1@1'),
    staleFailsClosed:stale.status===HotUpdateStatus.STALE&&beforeStale.hotRevision===afterStale.hotRevision&&seg(afterStale,HotSegmentKind.LOCATION).value.subLocation==='rear-courtyard',
    loreInvalidationTargeted:targeted.invalidatedSegments.includes(HotSegmentKind.WORLD_REFERENCES)&&seg(afterLoreInvalidation,HotSegmentKind.LOCATION).freshness===HotFreshness.FRESH&&seg(afterLoreInvalidation,HotSegmentKind.LOCATION).revision===seg(beforeLoreInvalidation,HotSegmentKind.LOCATION).revision,
    hotSnapshotPublishedMatchesPreSeal:published.hotCognition?.snapshotId===preSeal.snapshotId,
    sealedSnapshotRecorded:Boolean(sealedHot),
    sealedSnapshotMatchesPreSeal:sealedHot?.snapshotId===preSeal.snapshotId,
    sealedSnapshotFrozen:Boolean(sealedHot&&Object.isFrozen(sealedHot)),
    hotSnapshotSealed:published.hotCognition?.snapshotId===preSeal.snapshotId&&sealedHot?.snapshotId===preSeal.snapshotId&&Boolean(sealedHot&&Object.isFrozen(sealedHot)),
    compilerContribution:published.packet.hotCognitionSnapshotId===preSeal.snapshotId&&Boolean(findSection(delivered.plan,PromptSlot.CURRENT_SCENE)),
    activeThreadContribution:Boolean(threadSection)&&threadSection.semantic===true,
    lateRoutedNextTurn:late.route.late===true&&late.route.effectiveDestination===ResultDestination.NEXT_TURN,
    lateAdvancesFutureHot:Boolean(sealedHot)&&afterLate.hotRevision>sealedHot.hotRevision,
    sealedSnapshotExcludesLate:Boolean(sealedHot)&&!JSON.stringify(sealedHot).includes('late:continuity-ref'),
    postSealImmutable:Boolean(sealedHot)&&sealedHot.hotRevision===preSeal.hotRevision&&afterLate.hotRevision>sealedHot.hotRevision&&!JSON.stringify(sealedHot).includes('late:continuity-ref'),
    sceneTransitionTargeted:transitioned.sceneId==='scene:street'&&seg(transitioned,HotSegmentKind.LOCATION).value.place==='market-street'&&ids(seg(transitioned,HotSegmentKind.ACTIVE_CAST).value).join(',')==='eris',
    reconstructionPreservesIdentity:restored.chatNamespace==='chat:golden'&&restored.sceneId==='scene:street'&&['RESTORED_PERSISTED','RESTORED_WITH_INVALIDATION'].includes(restored.reconstructionState),
    nextGenerationConsumesHot:nextPublished.hotCognition?.snapshotId===restored.snapshotId&&nextDelivered.ok===true&&currentSceneSection?.semantic===true,
    stablePromptSceneReuse:reuseSceneSegment?.reuseState===ReuseState.NO_CHANGE,
    dependencyOptionality:degraded.unavailableDependencies.includes('MEMORY')&&degraded.unavailableDependencies.includes('LORE_STUDY')&&degraded.unavailableDependencies.includes('SENSORY_NET')&&!degraded.unavailableDependencies.includes('CORE'),
    graphEmptyAndUnavailableLegal:graphEmpty.status!==HotUpdateStatus.REJECTED&&graphUnavailable.status!==HotUpdateStatus.REJECTED,
    historicalNotPromoted:historicalAfter===historicalBefore,
    inferredNotEscalated:seg(inferred1,HotSegmentKind.LOCATION).authorityClass===AuthorityClass.INFERRED&&seg(inferred2,HotSegmentKind.LOCATION).authorityClass===AuthorityClass.INFERRED,
    explicitAuthorityBypassRejected:authorityViolation,
    crossChatIsolation:seg(alpha,HotSegmentKind.LOCATION).value.place==='alpha'&&seg(alphaAgain,HotSegmentKind.LOCATION).value.place==='alpha'&&alphaAgain.sceneId==='scene:a',
    editRegenerateSwipeDeleteSafe:editTail.length===0,
    boundedReadModel:readModel.mutationAuthority===false&&readModel.readOnly===true&&readModel.hotRevision===core.hotCognitionSnapshot().hotRevision,
    noSettlementAuthority:core.hotCognitionSnapshot().settlementAuthority===false&&core.hotCognitionSnapshot().canonicalMutationAuthority===false,
  };

  return{
    pass:Object.values(metrics).every(Boolean),metrics,steps,
    receipts:{r1,r2,r3,r4,r5,r6,n1,n2,stale,targeted,late,rTransition,stable8,graphEmpty,graphUnavailable},
    snapshots:{s1,s2,s3,s4,s5,s6,s7,beforeStale,afterStale,beforeLoreInvalidation,afterLoreInvalidation,preSeal,afterLate,transitioned,restored,stableSnapshot,degraded},
    publication:{published,delivered,nextPublished,nextDelivered,reusePublished,reuseDelivered},
    readModel,debug,
  };
}
