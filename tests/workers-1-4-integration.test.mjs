import test from 'node:test';
import assert from 'node:assert/strict';

import {Area52NativeBrain} from '../src/native-brain.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';
import {createMemoryIntegrationSurface} from '../src/memory-integration-surface.js';

const clone=(value)=>value==null?value:structuredClone(value);

function scene(sceneId,sceneRevision,{activeRelationships=[]}={}){
  return {
    sceneId,sceneRevision,location:'Observatory',narrativeTime:'turn '+sceneRevision,
    activeCast:['Mira'],activeThreads:['recover-astrolabe'],
    activeRelationships,objects:[{objectId:'Cedar Cabinet'}],
    sourceRevisionRefs:[],provenance:['workers-1-4-integration:'+sceneId+':'+sceneRevision],
  };
}

function loreOwner(){
  const sourceId='lore:integration:astrolabe';
  const revision={
    kind:'LoreSourceRevision',id:sourceId+'@r1',sourceId,lorebookId:'integration-book',uid:'astrolabe',
    revision:1,state:'CURRENT',
    exactContent:'The brass astrolabe is associated with Mira and the cedar cabinet in the observatory.',
    contentHash:'hash:integration-astrolabe:1',
    metadata:{
      title:'Brass Astrolabe',
      tags:['observatory','relic'],
      treePath:['Observatory','Artifacts'],
      extra:{aliases:['Lunar Astrolabe'],keywords:['cedar cabinet'],triggers:['brass-astrolabe']},
    },
    provenance:{kind:'SourceProvenance',sourceId,sourceRevisionId:sourceId+'@r1',authored:true},
  };
  const api={
    kind:'LoreBrainRetrievalInterface',contractVersion:1,
    status:({chatId}={})=>({
      kind:'LoreIntelligenceStatus',
      entries:[{
        sourceId,lorebookId:'integration-book',uid:'astrolabe',
        sourceRevisionId:revision.id,sourceState:'CURRENT',freshness:'CURRENT',retrievalReady:true,
        eligibleForStoryRetrieval:String(chatId)==='chat:workers-1-4',
      }],
    }),
    sourceRevision:(requested)=>String(requested)===sourceId?clone(revision):null,
    queryScoped:(request={})=>({
      kind:'LoreBrainRetrievalPacket',contractVersion:1,status:'ELIGIBLE',
      reason:'NO_AUTHORIZED_RETRIEVAL_MATCH',query:String(request.query??''),intent:String(request.intent??'AUTO'),
      retrievalIntentId:request.intentId??null,indexRevision:'integration-lore-index:1',ontologyRevision:'integration-lore-ontology:1',
      sourceRevisionFence:[revision.id],nominations:[],candidateReceipts:[],exclusionReceipts:[],
      storyScope:{chatId:String(request.chatId??''),state:'BOUND',acceptedForStudy:[{lorebookId:'integration-book'}],readLorebookIds:['integration-book']},
    }),
  };
  api.query=(request={})=>api.queryScoped(request);
  return api;
}

function candidatesFor(prepared,channelId){
  return (prepared.candidateEnvelope?.candidates??[]).filter(candidate=>
    (candidate.channelNominations??[]).some(row=>row.channelId===channelId)
  );
}

test('Workers 1-4 exact-head integration: turn A memory becomes turn B Memory + sparse + graph evidence through delivery, provider response, and learning',async()=>{
  const memory=new MemoryTemporalProducer();
  const memoryInterface=createMemoryIntegrationSurface(memory);
  const brain=new Area52NativeBrain({memoryInterface,loreInterface:loreOwner()});

  brain.registerEntityIdentity({entityId:'Mira',canonicalLabel:'Mira',entityType:'PERSON',worldId:'workers-1-4'});
  brain.registerEntityIdentity({entityId:'Cedar Cabinet',canonicalLabel:'Cedar Cabinet',entityType:'OBJECT',worldId:'workers-1-4'});
  brain.registerGraphProvider({
    providerId:'INTEGRATION_GRAPH_OWNER',owner:'INTEGRATION_OWNER',semanticsVersion:'1',
    isRevisionCurrent:(ref)=>ref==='graph:integration@1',
    query:()=>({
      providerRevision:'integration-graph:1',
      edges:[{
        edgeId:'edge:mira-cabinet',fromEntityId:'Mira',toEntityId:'Cedar Cabinet',edgeMeaning:'PLACED_IN',
        sourceKind:'OWNER_GRAPH',temporalStatus:'CURRENT',authorityClass:'OBSERVED',
        sourceRevisionRefs:['graph:integration@1'],provenanceRefs:['prov:integration:graph'],evidenceRefs:['evidence:integration:graph'],
        artifactRef:{artifactId:'graph-artifact:mira-cabinet',artifactType:'RELATIONSHIP',revision:1},
        representationText:'Mira placed the brass astrolabe in the cedar cabinet.',
      }],
    }),
  });

  await brain.prepareTurn({
    chatId:'chat:workers-1-4',turnId:'workers-1-4:A',generationId:'gen:workers-1-4:A',
    query:'Continue from the observatory.',intent:'CURRENT',
    scene:scene('observatory',1),budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  const learnedA=await brain.completeTurn({
    turnId:'workers-1-4:A',
    response:'Mira leaves the brass astrolabe inside the cedar cabinet beneath the western window.',
    knownBy:['Mira'],
  });
  assert.equal(learnedA.memoryPostTurn?.status,'COMPLETED');
  assert.ok(learnedA.memoryPostTurn?.episodeId);
  const episodeA=memory.experienceStore.artifact(learnedA.memoryPostTurn.episodeId);
  assert.ok(episodeA);
  assert.match(JSON.stringify(memory.experienceStore.exactDrillback(episodeA.id)),/brass astrolabe/i);

  const result=await brain.runTurn({
    chatId:'chat:workers-1-4',turnId:'workers-1-4:B',generationId:'gen:workers-1-4:B',
    query:'Where is brass-astrolabe, and how is Mira related to the Cedar Cabinet?',intent:'HISTORICAL',
    anchorEntityIds:['Mira'],
    scene:scene('observatory-return',2,{activeRelationships:[{relationshipId:'edge:mira-cabinet'}]}),
    budgetTokens:4096,budgetBytes:12000,latencyBudgetMs:1000,
    graphTraversal:{maxDepth:1,maxNodes:16,maxEdges:32,maxCandidates:8},
    providerId:'OpenRouter',modelId:'integration/model',routeId:'integration-route',
    executionLabel:'ASSEMBLED_HOST_REQUEST',
  },{
    generate:async(_rendered,{selection,promptPlan,contextSealReceipt})=>{
      const record=brain.readTurn(selection.turnId);
      const receipt=record.delivery.receipt;
      const observed=brain.recordObservedHostPromptEvidence(selection.turnId,{
        host:'TEST_PROVIDER_BOUNDARY',requestId:'provider:req:workers-1-4:B',live:true,
        chatId:selection.chatId,turnId:selection.turnId,generationId:selection.generationId,
        correlationId:selection.correlationId,contextSealId:contextSealReceipt.id,
        sealedPacketHash:receipt.sealedPacketHash,semanticManifestIdentity:receipt.semanticManifestIdentity,
        observedRoles:receipt.providerRoles,observedSections:(receipt.plannedSections??[]).map(row=>row.slot),
      });
      assert.equal(observed.status,'OBSERVED_MATCH');
      assert.equal(observed.phases.hostRequest.status,'OBSERVED_MATCH');
      assert.equal(observed.phases.providerResponse.status,'NOT_RECEIVED');
      assert.equal(promptPlan.contextSealId,contextSealReceipt.id);
      return {
        text:'The brass astrolabe remains in the cedar cabinet; Mira placed it there.',
        chatId:selection.chatId,turnId:selection.turnId,generationId:selection.generationId,
        correlationId:selection.correlationId,contextSealId:contextSealReceipt.id,
        requestId:'provider:req:workers-1-4:B',responseId:'provider:resp:workers-1-4:B',
        providerId:'OpenRouter',routeId:'integration-route',
      };
    },
  });

  const prepared=result.prepared;
  const memoryCandidates=candidatesFor(prepared,'OWNER_MEMORY');
  const sparseCandidates=candidatesFor(prepared,'OWNER_SPARSE_EXACT');
  const graphCandidates=candidatesFor(prepared,'ZZ_NATIVE_GRAPH_WALKER');
  assert.ok(memoryCandidates.length>=1,'turn B must retrieve the durable turn-A episode through OWNER_MEMORY');
  assert.ok(sparseCandidates.length>=1,'turn B must nominate exact/sparse owner evidence');
  assert.ok(graphCandidates.some(candidate=>(candidate.graphMetadata??[]).some(meta=>meta.edgeId==='edge:mira-cabinet')),
    'turn B must nominate the fresh graph relationship');
  assert.equal(prepared.sparseRetrievalReceipt?.status,'READY');
  assert.ok(prepared.graphTraversalReceipt?.nominationCount>=1);

  const sparseTrace=prepared.candidateTraceReceipt.rows.find(row=>row.candidateId===sparseCandidates[0].candidateId);
  assert.equal(sparseTrace?.truthUsable,true);
  assert.equal(sparseTrace?.gathered,true);
  assert.equal(sparseTrace?.sealed,true);
  const graphTrace=prepared.candidateTraceReceipt.rows.find(row=>row.candidateId===graphCandidates[0].candidateId);
  assert.equal(graphTrace?.truthUsable,true);
  assert.equal(graphTrace?.gathered,true);
  assert.equal(graphTrace?.sealed,true);
  assert.ok(prepared.gatherReceipt);
  assert.ok(prepared.contextSealReceipt?.sealedState);
  assert.ok(prepared.promptPlan);
  assert.ok(prepared.rendered);
  assert.match(JSON.stringify(prepared.promptPlan),/brass astrolabe/i);

  const finalRecord=brain.readTurn('workers-1-4:B');
  assert.equal(finalRecord.delivery.receipt.phases.planned.status,'PLANNED');
  assert.equal(finalRecord.delivery.receipt.phases.sealedCompiled.status,'SEALED_COMPILED');
  assert.equal(finalRecord.delivery.receipt.phases.hostRequest.status,'OBSERVED_MATCH');
  assert.equal(finalRecord.delivery.receipt.phases.providerResponse.status,'RECEIVED');
  assert.equal(finalRecord.state,'LEARNED');
  assert.ok(result.learning?.experienceId);
  assert.notEqual(finalRecord.delivery.receipt.phases.hostRequest.requestId,finalRecord.delivery.receipt.phases.providerResponse.responseId);

  const selected=brain.uiBindings().readSelectedTurnReceipt(prepared.selection);
  assert.equal(selected.producers.truth.status,'PUBLISHED');
  assert.equal(selected.producers.gather.status,'PUBLISHED');
  assert.equal(selected.producers.contextSeal.status,'PUBLISHED');
  assert.equal(selected.producers.compiledDelivery.status,'PUBLISHED');
  assert.equal(selected.producers.delivery.status,'OBSERVED');
  assert.equal(selected.producers.learning.status,'PUBLISHED');
});
