import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HostActivity,ObjectPresence,ObservationClass,SceneGraph,SceneGraphEdgeType,SceneLifecycleRuntime,SceneRelationship,
  createFieldState,createGraphReferenceSetFromScene,exportSceneLifecycleState,importSceneLifecycleState,
} from '../src/scene/index.js';
import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {extractDevelopmentDeploymentScene} from '../src/deployment/sillytavern-live.js';
import {createSceneOwnerGraphProvider} from '../src/deployment/owner-graph-adapters.js';
import {NativeGraphNeighborhoodRetriever} from '../src/graph-neighborhood-retriever.js';

const field=(value,revision,evidenceRef,observationClass=ObservationClass.OBSERVED,confidence=1)=>createFieldState({
  value,revision,evidenceRefs:[evidenceRef],observationClass,confidence,provenance:[evidenceRef],
});

const host=(activity,id,content,extra={})=>({
  activity,chatId:extra.chatId??'graph-chat',hostEventId:extra.hostEventId??`graph:${id}:${activity}:r${extra.messageRevision??1}`,
  messageId:extra.messageId??id,messageRevision:extra.messageRevision??1,turnId:extra.turnId??`turn:${id}`,
  generationId:extra.generationId??`gen:${id}`,content,role:extra.role??'user',...extra,
});

const ingestDeployment=(brain,input)=>brain.ingestSceneHostEvent(input,{
  extract:(e,scene)=>extractDevelopmentDeploymentScene(e.content,{
    revision:scene.revision+1,evidenceRef:e.sourceRevisionId,currentScene:scene,sceneRuntime:brain.scene,
  }),
});

test('#110 Episode indexing keeps entity/event/object-state links, temporal applicability and bounded reference-only graph refs',()=>{
  const runtime=new SceneLifecycleRuntime();
  const opened=runtime.ensureChatScene('episode-links',{sourceRevisionRefs:['src:episode:1'],evidenceRefs:['src:episode:1']});
  const rev=opened.revision+1;
  const observed=runtime.sceneRuntime.observe({
    sceneId:opened.sceneId,proposalId:'episode-links:obs',sourceRevisionRefs:['src:episode:1'],evidenceRefs:['src:episode:1'],
    fields:{
      activeCast:field([{characterId:'Mara',state:'PRESENT'}],rev,'src:episode:1'),
      immediateObjects:field([
        {objectId:'relic',state:ObjectPresence.HELD,holderId:'Mara',confidence:1,observationClass:ObservationClass.OBSERVED,evidenceRefs:['src:episode:1'],seenRevision:rev},
        {objectId:'map',state:ObjectPresence.PRESENT,confidence:1,observationClass:ObservationClass.OBSERVED,evidenceRefs:['src:episode:1'],seenRevision:rev},
      ],rev,'src:episode:1'),
      narrativeTime:field({anchor:'dusk',mode:'CONTINUOUS'},rev,'src:episode:1'),
      activeThreads:field(['find-relic'],rev,'src:episode:1'),
    },
  });
  assert.equal(observed.applied,true);
  const episode=runtime.episodeCompiler.compile({
    scene:observed.scene,record:runtime.registry.get(opened.sceneId),
    events:[{eventId:'event:bell',evidenceRefs:['src:episode:1'],temporalApplicability:{anchor:'dusk',mode:'SCENE_LOCAL'}}],
  });
  const advanced=runtime.sceneRuntime.observe({
    sceneId:opened.sceneId,proposalId:'episode-links:later',sourceRevisionRefs:['src:episode:2'],evidenceRefs:['src:episode:2'],
    fields:{immediateObjects:field([{objectId:'relic',state:ObjectPresence.PRESENT,confidence:1,observationClass:ObservationClass.OBSERVED,evidenceRefs:['src:episode:2'],seenRevision:observed.scene.revision+1}],observed.scene.revision+1,'src:episode:2')},
  });
  assert.equal(advanced.applied,true);
  const indexed=runtime.indexEpisodeGraph(episode);
  assert.ok(indexed.length>=5);

  const refs=runtime.graph.references({sceneId:opened.sceneId,limit:32});
  const entity=refs.find(row=>row.edgeType===SceneGraphEdgeType.ENTITY_IN_SCENE&&row.edgeId.includes('Mara'));
  const event=refs.find(row=>row.edgeType===SceneGraphEdgeType.EVENT_IN_SCENE&&row.edgeId.includes('event:bell'));
  const object=refs.find(row=>row.edgeType===SceneGraphEdgeType.OBJECT_IN_SCENE&&row.edgeId.includes('relic'));
  assert.ok(entity&&event&&object);
  assert.equal(object.fromRef,'relic');
  assert.equal(object.observedState.state,ObjectPresence.HELD);
  assert.equal(object.observedState.holderId,'Mara');
  assert.equal(object.temporalApplicability.sceneRevision,observed.scene.revision);
  assert.equal(object.temporalApplicability.narrativeTime.anchor,'dusk');
  assert.equal(object.temporalStatus,'HISTORICAL');
  assert.equal(object.episodeRef.artifactId,episode.episodeId);
  assert.deepEqual(object.sourceRevisionRefs,['src:episode:1']);

  assert.ok(refs.length<=32);
  assert.ok(refs.filter(row=>[entity.edgeId,event.edgeId,object.edgeId].includes(row.edgeId)).every(row=>row.episodeRef.artifactId===episode.episodeId));

  const handoff=createGraphReferenceSetFromScene({graph:runtime.graph,scene:observed.scene,episodeRefs:[episode.artifactRef]});
  assert.ok(handoff.entityMembershipRefs.includes(entity.edgeId));
  assert.ok(handoff.eventMembershipRefs.includes(event.edgeId));
  assert.ok(handoff.objectMembershipRefs.includes(object.edgeId));
  assert.equal(handoff.authority,'REFERENCE_ONLY');
  assert.equal(handoff.memoryMutationAuthority,false);
});

test('#110 linear production transition publishes explicit previous/next topology and adjacency never becomes causality',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const first=ingestDeployment(brain,host(HostActivity.USER_SEND,'linear-1','At North Gallery, Mara waits.'));
  const travel=ingestDeployment(brain,host(HostActivity.USER_SEND,'linear-2','We arrive at South Courtyard.'));
  assert.equal(travel.transition?.status,'COMPLETE');

  const rows=brain.scene.graph.neighbors(first.sceneId,{includeRetired:true});
  const continues=rows.find(row=>row.edgeType===SceneGraphEdgeType.SCENE_CONTINUES&&row.toSceneId===travel.sceneId);
  const precedes=rows.find(row=>row.edgeType===SceneGraphEdgeType.SCENE_PRECEDES&&row.toSceneId===travel.sceneId);
  assert.ok(continues);
  assert.ok(precedes);
  for(const edge of [continues,precedes]){
    assert.equal(edge.causal,false);
    assert.ok(edge.sourceRevisionRefs.includes(travel.evidence.sourceRevisionId));
    assert.equal(edge.episodeRef.artifactType,'SceneEpisode');
  }
  const episode=brain.scene.episodeCompiler.get(travel.transition.episodeRef.artifactId);
  assert.equal(continues.episodeRef.artifactId,episode.episodeId);
  assert.equal(precedes.episodeRef.artifactId,episode.episodeId);
  const historicalAdmission=brain.admitSceneGraphEvidenceLinks({
    chatId:'graph-chat',sceneId:first.sceneId,sceneRevision:travel.transition.episodeRef.revision,episodeRef:travel.transition.episodeRef,
    sourceRevisionId:travel.evidence.sourceRevisionId,
    links:[{fromRef:'event:departure',toRef:'event:arrival',relation:'SUPPORTS',supportStatus:'SUPPORTED',evidenceRefs:[travel.evidence.sourceRevisionId]}],
  });
  assert.equal(historicalAdmission.status,'ADMITTED');
  assert.equal(historicalAdmission.sceneRevision,travel.transition.episodeRef.revision);
  const historicalLink=brain.scene.graph.references({sceneId:first.sceneId,limit:32}).find(row=>row.edgeType===SceneGraphEdgeType.EVIDENCE_SUPPORTS&&row.episodeRef?.artifactId===episode.episodeId);
  assert.ok(historicalLink);
  assert.equal(historicalLink.temporalStatus,'HISTORICAL');
});

test('#110 topology contract preserves parallel, flashback, interruption and resume separately without causal promotion',()=>{
  const graph=new SceneGraph();
  const cases=[
    [SceneRelationship.PARALLEL_TO,SceneGraphEdgeType.SCENE_PARALLEL],
    [SceneRelationship.FLASHBACK_OF,SceneGraphEdgeType.SCENE_FLASHBACK],
    [SceneRelationship.INTERRUPTS,SceneGraphEdgeType.SCENE_INTERRUPTS],
    [SceneRelationship.RESUMES,SceneGraphEdgeType.SCENE_RESUMES],
  ];
  for(const [relationship,edgeType] of cases){
    const edge=graph.addRelationship({fromSceneId:'from:'+relationship,toSceneId:'to:'+relationship,relationship,evidenceRefs:['e:'+relationship],sourceRevisionRefs:['src:'+relationship],sceneRevision:1});
    assert.equal(edge.edgeType,edgeType);
    assert.equal(edge.causal,false);
    assert.equal(edge.authorityClass,'OBSERVED');
    assert.equal(edge.temporalStatus,relationship===SceneRelationship.FLASHBACK_OF?'HISTORICAL':'CURRENT');
  }
  assert.equal([...graph.edges.values()].some(edge=>edge.edgeType===SceneGraphEdgeType.EVIDENCE_CAUSES),false);
});

test('#110 Scene owner admits only evidence-backed approved causal/supporting links and preserves unresolved competing interpretations',()=>{
  const runtime=new SceneLifecycleRuntime();
  const receipt=runtime.ingestHostEvent(host(HostActivity.USER_SEND,'links','The storm broke the seal while two witnesses disagree about the warning.'),{
    extract:(e,scene)=>({
      fields:{location:field({location:'Archive'},scene.revision+1,e.sourceRevisionId)},
      graphEvidenceLinksOwnerApproved:true,
      graphEvidenceLinks:[
        {fromRef:'event:storm',toRef:'object:seal',relation:'CAUSES',supportStatus:'SUPPORTED',evidenceRefs:[e.sourceRevisionId]},
        {fromRef:'event:maybe',toRef:'object:seal',relation:'CAUSES',supportStatus:'UNRESOLVED',evidenceRefs:[e.sourceRevisionId]},
        {fromRef:'event:witness',toRef:'thread:warning',relation:'SUPPORTS',supportStatus:'UNRESOLVED',interpretationId:'A',evidenceRefs:[e.sourceRevisionId]},
        {fromRef:'event:witness',toRef:'thread:warning',relation:'SUPPORTS',supportStatus:'UNRESOLVED',interpretationId:'B',evidenceRefs:[e.sourceRevisionId]},
      ],
    }),
  });
  const admitted=receipt.graphEvidenceReceipts.filter(row=>row.status==='ADMITTED');
  const rejected=receipt.graphEvidenceReceipts.filter(row=>row.status==='REJECTED');
  assert.equal(admitted.length,3);
  assert.equal(rejected.length,1);
  assert.ok(rejected.some(row=>String(row.reasonCode).includes('causal Scene graph link requires explicitly supported')));

  const unapproved=runtime.ingestHostEvent(host(HostActivity.USER_SEND,'links-unapproved','A rumor claims the seal failed.'),{
    extract:(e,scene)=>({
      fields:{},
      graphEvidenceLinks:[{fromRef:'event:rumor',toRef:'object:seal',relation:'CAUSES',supportStatus:'SUPPORTED',evidenceRefs:[e.sourceRevisionId]}],
    }),
  });
  assert.equal(unapproved.graphEvidenceAdmission.status,'REJECTED');
  assert.equal(unapproved.graphEvidenceAdmission.reasonCode,'SCENE_GRAPH_OWNER_APPROVAL_REQUIRED');

  const edges=runtime.graph.references({sceneId:receipt.scene.sceneId,limit:32});
  const causal=edges.filter(row=>row.edgeType===SceneGraphEdgeType.EVIDENCE_CAUSES);
  const competing=edges.filter(row=>row.edgeType===SceneGraphEdgeType.EVIDENCE_SUPPORTS);
  assert.equal(causal.length,1);
  assert.equal(causal[0].causal,true);
  assert.equal(causal[0].authorityClass,'INFERRED');
  assert.equal(competing.length,2);
  assert.deepEqual(competing.map(row=>row.interpretationId).sort(),['A','B']);
  assert.ok(competing.every(row=>row.causal===false&&row.authorityClass==='UNRESOLVED'&&row.ownerApproved===true));
});

test('#110 deployment Scene owner exposes explicit evidence-link admission without truth, Temporal State or Memory authority',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const observed=ingestDeployment(brain,host(HostActivity.USER_SEND,'owner-link','At Archive Hall, Mara waits.'));
  const admission=brain.admitSceneGraphEvidenceLinks({
    chatId:'graph-chat',sceneId:observed.sceneId,sceneRevision:observed.sceneRevision,
    sourceRevisionId:observed.evidence.sourceRevisionId,
    links:[{fromRef:'event:bell',toRef:'thread:warning',relation:'SUPPORTS',supportStatus:'SUPPORTED',evidenceRefs:[observed.evidence.sourceRevisionId]}],
  });
  assert.equal(admission.status,'ADMITTED');
  assert.equal(admission.authorityGranted,false);
  assert.equal(admission.canonicalMutationAuthority,false);
  assert.equal(admission.truthAuthority,false);
  assert.equal(admission.temporalStateAuthority,false);
  assert.equal(admission.memoryMutationAuthority,false);
  assert.equal(admission.contextSealAuthority,false);
  const edge=brain.scene.graph.references({sceneId:observed.sceneId,limit:16}).find(row=>row.edgeType===SceneGraphEdgeType.EVIDENCE_SUPPORTS);
  assert.ok(edge);
  assert.deepEqual(edge.sourceRevisionRefs,[observed.evidence.sourceRevisionId]);
});

test('#110 source correction retires dependent current links, keeps historical evidence, versions replacement edges and survives reload',()=>{
  const runtime=new SceneLifecycleRuntime();
  const original=runtime.ingestHostEvent(host(HostActivity.USER_SEND,'corr-1','The storm broke the seal.',{messageId:'corr',messageRevision:1}),{
    extract:(e,scene)=>({
      fields:{location:field({location:'Archive'},scene.revision+1,e.sourceRevisionId)},
      graphEvidenceLinksOwnerApproved:true,graphEvidenceLinks:[{fromRef:'event:storm',toRef:'object:seal',relation:'CAUSES',supportStatus:'SUPPORTED',evidenceRefs:[e.sourceRevisionId]}],
    }),
  });
  const oldSource=original.evidence.sourceRevisionId;
  const oldEdge=runtime.graph.references({sceneId:original.scene.sceneId,limit:16}).find(row=>row.edgeType===SceneGraphEdgeType.EVIDENCE_CAUSES);
  assert.ok(oldEdge);

  const corrected=runtime.ingestHostEvent(host(HostActivity.EDIT,'corr-2','A falling beam broke the seal.',{messageId:'corr',messageRevision:2}),{
    extract:(e,scene)=>({
      fields:{location:field({location:'Archive'},scene.revision+1,e.sourceRevisionId)},
      graphEvidenceLinksOwnerApproved:true,graphEvidenceLinks:[{fromRef:'event:storm',toRef:'object:seal',relation:'CAUSES',supportStatus:'SUPPORTED',evidenceRefs:[e.sourceRevisionId]}],
    }),
  });
  const newSource=corrected.evidence.sourceRevisionId;
  assert.notEqual(newSource,oldSource);
  assert.ok(corrected.invalidatedGraph.some(row=>row.edgeId===oldEdge.edgeId&&row.status==='RETIRED'));

  const all=runtime.graph.references({sceneId:corrected.scene.sceneId,includeRetired:true,limit:32});
  const retired=all.find(row=>row.edgeId===oldEdge.edgeId);
  const active=all.find(row=>row.edgeType===SceneGraphEdgeType.EVIDENCE_CAUSES&&row.status==='ACTIVE');
  assert.equal(retired.status,'RETIRED');
  assert.equal(retired.temporalStatus,'SUPERSEDED');
  assert.ok(active);
  assert.notEqual(active.edgeId,retired.edgeId);
  assert.deepEqual(active.sourceRevisionRefs,[newSource]);
  assert.equal(active.sourceRevisionRefs.includes(oldSource),false);
  assert.equal(runtime.graph.references({sceneId:corrected.scene.sceneId,limit:32}).some(row=>row.edgeId===retired.edgeId),false);

  const provider=createSceneOwnerGraphProvider(runtime);
  const current=provider.query({intentKind:'CURRENT',sceneRevision:corrected.scene.revision,maxEdges:32});
  assert.equal(current.edges.some(row=>row.edgeId===retired.edgeId),false);
  const historical=provider.query({intentKind:'HISTORICAL',sceneRevision:corrected.scene.revision,maxEdges:32});
  assert.ok(historical.edges.some(row=>row.edgeId===retired.edgeId&&row.temporalStatus==='SUPERSEDED'));
  assert.equal(provider.isRevisionCurrent(oldSource),true,'historical owner query keeps retired source drillback valid');

  const snapshot=exportSceneLifecycleState({
    registry:runtime.registry,stack:runtime.stack,episodeCompiler:runtime.episodeCompiler,graph:runtime.graph,
    prefetchTrigger:runtime.prefetchTrigger,narrativeFeed:runtime.narrativeFeed,transitionManager:runtime.transitionManager,
    contextInvalidationPublisher:runtime.contextInvalidationPublisher,
  });
  const restored=importSceneLifecycleState(JSON.parse(JSON.stringify(snapshot)));
  const restoredRows=restored.graph.references({sceneId:corrected.scene.sceneId,includeRetired:true,limit:32});
  assert.ok(restoredRows.some(row=>row.edgeId===retired.edgeId&&row.status==='RETIRED'));
  assert.ok(restoredRows.some(row=>row.edgeId===active.edgeId&&row.status==='ACTIVE'));
});

test('#110 Graph Walker returns bounded reference nominations with Episode/object temporal drillback and no mutation authority',()=>{
  const runtime=new SceneLifecycleRuntime();
  const opened=runtime.ensureChatScene('walker',{sourceRevisionRefs:['src:walker:1'],evidenceRefs:['src:walker:1']});
  const rev=opened.revision+1;
  const observed=runtime.sceneRuntime.observe({
    sceneId:opened.sceneId,proposalId:'walker:obs',sourceRevisionRefs:['src:walker:1'],evidenceRefs:['src:walker:1'],
    fields:{
      immediateObjects:field([
        {objectId:'relic',state:ObjectPresence.HELD,holderId:'Mara',confidence:1,observationClass:ObservationClass.OBSERVED,evidenceRefs:['src:walker:1'],seenRevision:rev},
        {objectId:'map',state:ObjectPresence.PRESENT,confidence:1,observationClass:ObservationClass.OBSERVED,evidenceRefs:['src:walker:1'],seenRevision:rev},
        {objectId:'key',state:ObjectPresence.PRESENT,confidence:1,observationClass:ObservationClass.OBSERVED,evidenceRefs:['src:walker:1'],seenRevision:rev},
      ],rev,'src:walker:1'),
      narrativeTime:field({anchor:'midnight',mode:'CONTINUOUS'},rev,'src:walker:1'),
    },
  });
  const episode=runtime.episodeCompiler.compile({scene:observed.scene,record:runtime.registry.get(opened.sceneId)});
  runtime.indexEpisodeGraph(episode);

  const provider=createSceneOwnerGraphProvider(runtime);
  const walker=new NativeGraphNeighborhoodRetriever({
    temporalGraph:{allClaims:()=>[]},
    limits:{maxDepth:2,maxNodes:8,maxEdges:8,maxCandidates:1,latencyBudgetMs:100},
  });
  walker.registerProvider(provider);
  const nominations=walker.retrieve({
    intentId:'intent:scene-graph',query:'relic',intentKind:'HISTORICAL',entityRefs:['relic'],
    metadata:{graphTraversal:{allowedEdgeMeanings:[SceneGraphEdgeType.OBJECT_IN_SCENE],maxDepth:1,maxEdges:8,maxCandidates:1,latencyBudgetMs:100}},
  },{
    query:'relic',sceneRevision:observed.scene.revision,worldRevision:0,sourceRevisionSet:['src:walker:1'],
    graphTraversal:{allowedEdgeMeanings:[SceneGraphEdgeType.OBJECT_IN_SCENE],maxDepth:1,maxEdges:8,maxCandidates:1,latencyBudgetMs:100},
  });
  assert.equal(nominations.length,1);
  const nomination=nominations[0];
  assert.equal(nomination.channelId,'ZZ_NATIVE_GRAPH_WALKER');
  assert.equal(nomination.graphMetadata.edgeMeaning,SceneGraphEdgeType.OBJECT_IN_SCENE);
  assert.equal(nomination.artifactRef.artifactType,'SceneEpisode');
  assert.equal(nomination.artifactRef.revision,episode.sceneRevision);
  assert.equal(nomination.temporalHints[0].status,'HISTORICAL');
  const drillback=nomination.graphMetadata.drillbackRefs.find(row=>row.kind==='SCENE_SOURCE_REF');
  assert.equal(drillback.sceneRevision,episode.sceneRevision);
  assert.equal(drillback.observedState.state,ObjectPresence.HELD);
  assert.equal(drillback.temporalApplicability.narrativeTime.anchor,'midnight');
  assert.equal(nomination.metadata.graphOwner,'SCENE_LIFECYCLE');
  assert.equal(walker.diagnostics().lastReceipt.nominationCount,1);
  assert.equal(walker.diagnostics().lastReceipt.boundedOut.candidates>=0,true);
});
