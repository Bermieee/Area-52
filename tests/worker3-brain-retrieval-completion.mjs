import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductionSparseRetrievalChannel} from '../src/production-sparse-retrieval.js';
import {Area52NativeBrain} from '../src/native-brain.js';

function loreOwner(entries){
  const revisions=new Map(entries.map(row=>[row.sourceId,row.revision]));
  return{
    contractVersion:1,
    status:({chatId}={})=>({
      kind:'LoreIntelligenceStatus',
      entries:entries.map(row=>({
        sourceId:row.sourceId,lorebookId:row.lorebookId,uid:row.uid,
        sourceRevisionId:row.revision.id,sourceState:row.revision.state,
        freshness:'CURRENT',retrievalReady:true,
        eligibleForStoryRetrieval:row.allowedChats.includes(String(chatId)),
      })),
    }),
    sourceRevision:(sourceId)=>structuredClone(revisions.get(String(sourceId))??null),
  };
}
function entry({book='book-a',uid='7',title='Moon Key',content='The Moon Key was forged in the eastern vault.',aliases=['Lunar Key'],keywords=['silver oath'],triggers=['moon-key-77'],allowedChats=['chat:a'],revision=1}={}){
  const sourceId='lore:'+book+':'+uid;
  return{
    sourceId,lorebookId:book,uid:String(uid),allowedChats,
    revision:{
      kind:'LoreSourceRevision',id:sourceId+'@r'+revision,sourceId,lorebookId:book,uid:String(uid),revision,
      state:'CURRENT',exactContent:content,contentHash:'hash:'+revision,
      metadata:{title,tags:['relic'],treePath:['Artifacts'],extra:{aliases,keywords,triggers}},
      provenance:{kind:'SourceProvenance',sourceId,sourceRevisionId:sourceId+'@r'+revision,authored:true},
    },
  };
}

test('production sparse channel qualifies exact identifiers, phrases and authored keywords above lexical fallback',()=>{
  const owner=loreOwner([entry()]);
  const channel=new ProductionSparseRetrievalChannel({maxArtifacts:8,maxCandidates:8});
  const hydration=channel.hydrateLoreOwner(owner,{chatId:'chat:a'});
  assert.equal(hydration.status,'READY');
  assert.equal(hydration.indexedCount,1);

  const exact=channel.retrieve({intentId:'exact',intentKind:'NARROW',query:'moon-key-77'},{worldRevision:1,sceneRevision:1});
  assert.equal(exact.length,1);
  assert.equal(exact[0].rankSignals.sparseExecution,'EXACT_IDENTIFIER');
  assert.equal(exact[0].metadata.ownerSourceRevisionId,'lore:book-a:7@r1');

  const sourceId=channel.retrieve({intentId:'source-id',intentKind:'NARROW',query:'lore:book-a:7'},{worldRevision:1,sceneRevision:1});
  assert.equal(sourceId[0].rankSignals.sparseExecution,'EXACT_IDENTIFIER');

  const uid=channel.retrieve({intentId:'uid',intentKind:'NARROW',query:'7'},{worldRevision:1,sceneRevision:1});
  assert.equal(uid[0].rankSignals.sparseExecution,'EXACT_IDENTIFIER');

  const phrase=channel.retrieve({intentId:'phrase',intentKind:'NARROW',query:'Moon Key'},{worldRevision:1,sceneRevision:1});
  assert.equal(phrase[0].rankSignals.sparseExecution,'EXACT_PHRASE');

  const keyword=channel.retrieve({intentId:'keyword',intentKind:'NARROW',query:'silver oath'},{worldRevision:1,sceneRevision:1});
  assert.equal(keyword[0].rankSignals.sparseExecution,'AUTHORED_KEYWORD');

  const lexical=channel.retrieve({intentId:'lex',intentKind:'NARROW',query:'forged eastern vault'},{worldRevision:1,sceneRevision:1});
  assert.equal(lexical[0].rankSignals.sparseExecution,'LEXICAL_FALLBACK');
  assert.equal(Object.hasOwn(lexical[0].rankSignals,'bm25Score'),false);
  assert.equal(Object.hasOwn(lexical[0].rankSignals,'bm25LikeScore'),false);
});

test('production sparse channel enforces owner story scope and hydration bounds',()=>{
  const rows=[
    entry({uid:'1',title:'Allowed One',allowedChats:['chat:a']}),
    entry({uid:'2',title:'Private Two',allowedChats:['chat:b']}),
    entry({uid:'3',title:'Allowed Three',allowedChats:['chat:a']}),
  ];
  const owner=loreOwner(rows);
  const channel=new ProductionSparseRetrievalChannel({maxArtifacts:1,maxCandidates:8});
  const receipt=channel.hydrateLoreOwner(owner,{chatId:'chat:a'});
  assert.equal(receipt.indexedCount,1);
  assert.equal(receipt.eligibleCount,2);
  assert.equal(receipt.boundedOutCount,1);
  assert.equal(channel.retrieve({intentId:'private',intentKind:'NARROW',query:'Private Two'},{}).length,0);
  assert.ok(channel.diagnostics().artifactCount<=1);
});


function mutableLoreOwner(initialRows){
  const state={rows:initialRows.map((row)=>structuredClone(row)),queryCalls:[]};
  const api={
    kind:'LoreBrainRetrievalInterface',contractVersion:1,
    status:({chatId}={})=>({
      kind:'LoreIntelligenceStatus',
      entries:state.rows.map(row=>({
        sourceId:row.sourceId,lorebookId:row.lorebookId,uid:row.uid,
        sourceRevisionId:row.revision.id,sourceState:row.revision.state,
        freshness:row.revision.state==='REMOVED'?'REMOVED':'CURRENT',
        retrievalReady:row.revision.state!=='REMOVED',
        eligibleForStoryRetrieval:row.revision.state!=='REMOVED'&&row.allowedChats.includes(String(chatId)),
      })),
    }),
    sourceRevision:(sourceId)=>structuredClone(state.rows.find(row=>row.sourceId===String(sourceId))?.revision??null),
    queryScoped:(request={})=>{
      state.queryCalls.push(structuredClone(request));
      return{
        kind:'LoreBrainRetrievalPacket',contractVersion:1,status:'ELIGIBLE',
        reason:'NO_AUTHORIZED_RETRIEVAL_MATCH',query:String(request.query??''),intent:String(request.intent??'AUTO'),
        retrievalIntentId:request.intentId??null,indexRevision:'fake-index:1',ontologyRevision:'fake-ontology:1',
        sourceRevisionFence:[],nominations:[],candidateReceipts:[],exclusionReceipts:[],
        storyScope:{chatId:String(request.chatId??''),state:'BOUND',acceptedForStudy:[],readLorebookIds:[]},
      };
    },
    query(request={}){return api.queryScoped(request);},
  };
  return{
    api,state,
    replace(sourceId,{content,title='Moon Key Revised',aliases=['Lunar Key'],keywords=['silver oath revised'],triggers=['moon-key-88']}={}){
      const row=state.rows.find(item=>item.sourceId===sourceId);
      const nextRevision=Number(row.revision.revision)+1;
      row.revision={
        ...row.revision,id:sourceId+'@r'+nextRevision,revision:nextRevision,state:'CURRENT',
        exactContent:content??'The revised Moon Key opens the western vault.',contentHash:'hash:'+nextRevision,
        metadata:{title,tags:['relic'],treePath:['Artifacts'],extra:{aliases,keywords,triggers}},
        provenance:{kind:'SourceProvenance',sourceId,sourceRevisionId:sourceId+'@r'+nextRevision,authored:true},
      };
      return structuredClone(row.revision);
    },
    remove(sourceId){
      const row=state.rows.find(item=>item.sourceId===sourceId);
      const nextRevision=Number(row.revision.revision)+1;
      row.revision={
        ...row.revision,id:sourceId+'@r'+nextRevision,revision:nextRevision,state:'REMOVED',
        exactContent:null,contentHash:null,
        provenance:{kind:'SourceProvenance',sourceId,sourceRevisionId:sourceId+'@r'+nextRevision,authored:true,removal:true},
      };
      return structuredClone(row.revision);
    },
  };
}
function turnScene(sceneId,sceneRevision,{location='Moon Vault',activeCast=['Mara'],activeThreads=['find-key'],objects=[{objectId:'Moon Key'}],activeRelationships=[]}={}){
  return{
    sceneId,sceneRevision,location,narrativeTime:'turn '+sceneRevision,activeCast,activeThreads,objects,activeRelationships,
    sourceRevisionRefs:[],provenance:['worker3-scene:'+sceneId+':'+sceneRevision],
  };
}
function channelCandidates(envelope,channelId){
  return (envelope?.candidates??[]).filter(candidate=>(candidate.channelNominations??[]).some(row=>row.channelId===channelId));
}


test('production sparse residency remains bounded across repeated story-scope changes',()=>{
  const rows=[
    entry({book:'scope-a',uid:'1',title:'Scope A',allowedChats:['chat:a']}),
    entry({book:'scope-b',uid:'2',title:'Scope B',allowedChats:['chat:b']}),
    entry({book:'scope-c',uid:'3',title:'Scope C',allowedChats:['chat:c']}),
  ];
  const owner=loreOwner(rows);
  const channel=new ProductionSparseRetrievalChannel({maxArtifacts:2,maxCandidates:4});
  channel.hydrateLoreOwner(owner,{chatId:'chat:a'});
  channel.hydrateLoreOwner(owner,{chatId:'chat:b'});
  channel.hydrateLoreOwner(owner,{chatId:'chat:c'});
  const diagnostics=channel.diagnostics();
  assert.ok(diagnostics.residentOwnerArtifactCount<=2,JSON.stringify(diagnostics,null,2));
  assert.ok(diagnostics.artifactCount<=2);
});


test('bounded hydration prioritizes an exact source identifier outside the default long-Lore window',()=>{
  const rows=[
    entry({uid:'1',title:'First Entry',allowedChats:['chat:a']}),
    entry({uid:'2',title:'Second Entry',allowedChats:['chat:a']}),
    entry({uid:'99',title:'Tail Entry',allowedChats:['chat:a'],triggers:['tail-trigger']}),
  ];
  const owner=loreOwner(rows);
  const channel=new ProductionSparseRetrievalChannel({maxArtifacts:2,maxCandidates:4});
  const receipt=channel.hydrateLoreOwner(owner,{chatId:'chat:a',query:'Find lore:book-a:99'});
  assert.equal(receipt.indexedCount,2);
  assert.equal(receipt.boundedOutCount,1);
  const exact=channel.retrieve({intentId:'long-lore-id',intentKind:'NARROW',query:'Find lore:book-a:99'},{});
  assert.ok(exact.some(candidate=>candidate.metadata.ownerSourceId==='lore:book-a:99'));
  assert.equal(exact.find(candidate=>candidate.metadata.ownerSourceId==='lore:book-a:99').rankSignals.sparseExecution,'EXACT_IDENTIFIER');
});

test('native Brain hydrates owner sparse recall and sends bounded decomposed scene intents through Candidate Bus',async()=>{
  const row=entry();
  const owner=mutableLoreOwner([row]);
  const brain=new Area52NativeBrain({loreInterface:owner.api});
  const prepared=await brain.prepareTurn({
    chatId:'chat:a',turnId:'worker3:turn:1',generationId:'worker3:gen:1',
    query:'What is moon-key-77?',anchorEntityIds:['Moon Key'],
    scene:turnScene('worker3-vault',1),
    budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  assert.equal(prepared.sparseRetrievalReceipt.status,'READY');
  assert.ok(channelCandidates(prepared.candidateEnvelope,'OWNER_SPARSE_EXACT').length>0);
  assert.ok((prepared.candidateEnvelope.retrievalIntentIds??[]).length>=4);
  const sparseCandidate=channelCandidates(prepared.candidateEnvelope,'OWNER_SPARSE_EXACT')[0];
  assert.equal(sparseCandidate.channelNominations.find(row=>row.channelId==='OWNER_SPARSE_EXACT').rankSignals.sparseExecution,'EXACT_IDENTIFIER');
  const denseReceipt=(prepared.candidateEnvelope.metadata?.channelReceipts??[]).find(row=>row.channelId==='DENSE_EMBEDDINGS');
  assert.equal(denseReceipt?.status,'UNAVAILABLE');
  assert.equal(channelCandidates(prepared.candidateEnvelope,'DENSE_EMBEDDINGS').length,0);
});

test('native Brain reindexes only the changed Lore sparse source and tombstones removal',async()=>{
  const row=entry();
  const owner=mutableLoreOwner([row]);
  const brain=new Area52NativeBrain({loreInterface:owner.api});
  await brain.prepareTurn({
    chatId:'chat:a',turnId:'worker3:rev:1',generationId:'worker3:revgen:1',
    query:'moon-key-77',anchorEntityIds:['Moon Key'],scene:turnScene('worker3-rev',1),
    budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  const prior=row.revision.id;
  const revised=owner.replace(row.sourceId,{triggers:['moon-key-88'],keywords:['western oath']});
  const changed=brain.acceptLoreRevisionChange({
    kind:'LoreSourceRevisionChanged',sourceId:row.sourceId,lorebookId:row.lorebookId,uid:row.uid,
    previousSourceRevisionId:prior,sourceRevisionId:revised.id,sourceState:'CURRENT',contentHash:revised.contentHash,
  });
  assert.equal(changed.sparseRetrieval.status,'REINDEXED');
  assert.equal(changed.sparseRetrieval.wholeIndexRebuild,false);
  assert.deepEqual(changed.sparseRetrieval.invalidation.affectedArtifactIds,['owner-lore-sparse:'+row.sourceId]);

  const after=await brain.prepareTurn({
    chatId:'chat:a',turnId:'worker3:rev:2',generationId:'worker3:revgen:2',
    query:'moon-key-88',anchorEntityIds:['Moon Key'],scene:turnScene('worker3-rev',2),
    budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  assert.ok(channelCandidates(after.candidateEnvelope,'OWNER_SPARSE_EXACT').some(candidate=>candidate.sourceRevisionRefs.includes(revised.id)));
  assert.equal(channelCandidates(after.candidateEnvelope,'OWNER_SPARSE_EXACT').some(candidate=>candidate.sourceRevisionRefs.includes(prior)),false);

  const removed=owner.remove(row.sourceId);
  const removal=brain.acceptLoreRevisionChange({
    kind:'LoreSourceRevisionChanged',sourceId:row.sourceId,lorebookId:row.lorebookId,uid:row.uid,
    previousSourceRevisionId:revised.id,sourceRevisionId:removed.id,sourceState:'REMOVED',contentHash:null,
  });
  assert.equal(removal.sparseRetrieval.status,'TOMBSTONED');

  const postRemoval=await brain.prepareTurn({
    chatId:'chat:a',turnId:'worker3:rev:3',generationId:'worker3:revgen:3',
    query:'moon-key-88',anchorEntityIds:['Moon Key'],scene:turnScene('worker3-rev',3),
    budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  assert.equal(channelCandidates(postRemoval.candidateEnvelope,'OWNER_SPARSE_EXACT').length,0);
});


function minimalTurnScene(sceneId,sceneRevision){
  return turnScene(sceneId,sceneRevision,{location:null,activeCast:[],activeThreads:[],objects:[],activeRelationships:[]});
}
function enableHierarchyOwnerPacket(owner,row){
  owner.api.queryScoped=(request={})=>{
    owner.state.queryCalls.push(structuredClone(request));
    const revision=row.revision;
    return{
      kind:'LoreBrainRetrievalPacket',contractVersion:1,status:'ELIGIBLE',reason:'AUTHORIZED_CURRENT_RETRIEVAL_MATCH',
      query:String(request.query??''),intent:String(request.intent??'AUTO'),retrievalIntentId:request.intentId??null,
      indexRevision:'hierarchy-index:1',ontologyRevision:'hierarchy-ontology:1',
      sourceRevisionFence:[revision.id],
      nominations:[{
        nomination:{
          candidateId:'hierarchy:'+row.sourceId,normalizedRank:.92,
          rankSignals:{hierarchy:.92,community:.88},truthStatusHint:'CURRENT',
          temporalHints:[{status:'CURRENT'}],metadata:{resolution:'COMMUNITY',owner:'LORE'},
        },
        drillback:[{
          sourceId:row.sourceId,lorebookId:row.lorebookId,uid:row.uid,sourceRevisionId:revision.id,
          exactAuthoredText:revision.exactContent,representationRef:'hierarchy-source:'+revision.id,
          truthStatusHint:'CURRENT',temporalHints:[{status:'CURRENT'}],provenance:[{ref:revision.id}],
        }],
      }],
      candidateReceipts:[],exclusionReceipts:[],
      storyScope:{chatId:String(request.chatId??''),state:'BOUND',acceptedForStudy:[{lorebookId:row.lorebookId}],readLorebookIds:[row.lorebookId]},
    };
  };
}

test('selected-turn retrieval quality HIGH proceeds and exact sparse lineage reaches Truth, Gather and Context Seal',async()=>{
  const row=entry();
  const owner=mutableLoreOwner([row]);
  const brain=new Area52NativeBrain({loreInterface:owner.api});
  const prepared=await brain.prepareTurn({
    chatId:'chat:a',turnId:'worker3:quality:high',generationId:'worker3:qualitygen:high',
    query:'moon-key-77',scene:minimalTurnScene('worker3-quality-high',1),
    budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  assert.equal(prepared.retrievalQualityReceipt.quality,'HIGH');
  assert.equal(prepared.correctiveRetrievalReceipt.correctivePasses,0);
  const sparse=channelCandidates(prepared.candidateEnvelope,'OWNER_SPARSE_EXACT')[0];
  assert.ok(sparse);
  const trace=prepared.candidateTraceReceipt.rows.find(row=>row.candidateId===sparse.candidateId);
  assert.equal(trace.truthUsable,true);
  assert.equal(trace.gathered,true);
  assert.equal(trace.sealed,true);
  assert.ok(trace.resultId);
  assert.ok((prepared.gatherReceipt.admittedCandidateIds??[]).includes(sparse.candidateId));
  assert.equal(prepared.candidateTraceReceipt.hostDeliveryInferred,false);
});

test('selected-turn retrieval quality MIXED performs exactly one bounded corrective pass',async()=>{
  const brain=new Area52NativeBrain();
  brain.acceptLore({
    sourceId:'lore:mixed:omen',sourceType:'LORE_ENTRY',exactContent:'Moon Omen remains disputed.',
    temporalStatus:'UNRESOLVED',metadata:{representationText:'Moon Omen remains disputed.'},
  });
  const prepared=await brain.prepareTurn({
    chatId:'chat:mixed',turnId:'worker3:quality:mixed',generationId:'worker3:qualitygen:mixed',
    query:'Moon Omen disputed',scene:minimalTurnScene('worker3-quality-mixed',1),
    budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  assert.equal(prepared.retrievalQualityReceipt.quality,'MIXED');
  assert.equal(prepared.correctiveRetrievalReceipt.correctivePasses,1);
  assert.equal(prepared.correctiveRetrievalReceipt.terminated,true);
  assert.ok(['QUERY_REFORMULATION','SPARSE_RETRY','GRAPH_EXPANSION','ENTITY_CONSTRAINED_SEARCH','TEMPORAL_NARROWING'].includes(prepared.correctiveRetrievalReceipt.action));
  assert.equal(prepared.correctiveRetrievalReceipt.maxCorrectiveAttempts,1);
});

test('selected-turn retrieval quality LOW abstains from long-term memory admission',async()=>{
  const row=entry();
  const owner=mutableLoreOwner([row]);
  const brain=new Area52NativeBrain({loreInterface:owner.api});
  const prepared=await brain.prepareTurn({
    chatId:'chat:a',turnId:'worker3:quality:low',generationId:'worker3:qualitygen:low',
    query:'zzqv nonexistent memory target',anchorEntityIds:['missing:anchor'],
    scene:minimalTurnScene('worker3-quality-low',1),
    budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  assert.equal(prepared.retrievalQualityReceipt.quality,'LOW');
  assert.equal(prepared.correctiveRetrievalReceipt.correctivePasses,0);
  assert.deepEqual(prepared.gatherReceipt.admittedCandidateIds??[],[]);
  assert.equal(prepared.retrievalQualityReceipt.allowLongTermMemory,false);
});

test('relationship-only selected turn consumes existing Graph Walker provider candidates without granting graph truth authority',async()=>{
  const brain=new Area52NativeBrain();
  brain.registerEntityIdentity({entityId:'Mara',canonicalLabel:'Mara',entityType:'PERSON',worldId:'worker3:world'});
  brain.registerEntityIdentity({entityId:'Lio',canonicalLabel:'Lio',entityType:'PERSON',worldId:'worker3:world'});
  const graphRevision='graph:relationship:r1';
  brain.registerGraphProvider({
    providerId:'WORKER4_RELATIONSHIP_GRAPH',owner:'WORKER4_GRAPH',semanticsVersion:'1',
    isRevisionCurrent:(ref)=>ref===graphRevision,
    query:()=>({providerRevision:'worker4-graph:1',edges:[{
      edgeId:'rel:mara:lio',fromEntityId:'Mara',toEntityId:'Lio',edgeMeaning:'ALLY_OF',
      sourceKind:'OWNER_GRAPH',temporalStatus:'CURRENT',authorityClass:'OBSERVED',
      sourceRevisionRefs:[graphRevision],provenanceRefs:['worker4:rel:mara:lio'],
      representationText:'Mara and Lio are current allies.',
    }]}),
  });
  const prepared=await brain.prepareTurn({
    chatId:'chat:graph',turnId:'worker3:graph:1',generationId:'worker3:graphgen:1',
    query:'How is Mara related to Lio?',anchorEntityIds:['Mara'],
    scene:turnScene('worker3-graph',1,{location:null,activeCast:['Mara','Lio'],activeThreads:[],objects:[],activeRelationships:[{relationshipId:'rel:mara:lio'}]}),
    graphTraversal:{maxDepth:1,maxNodes:16,maxEdges:32,maxCandidates:8},budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  const graphRows=channelCandidates(prepared.candidateEnvelope,'ZZ_NATIVE_GRAPH_WALKER');
  const relationshipIntent=prepared.retrievalIntents.find(row=>row.metadata?.sceneIntentKind==='RELATIONSHIP_CONTEXT');
  assert.ok(relationshipIntent);
  assert.ok(graphRows.some(candidate=>(candidate.graphMetadata??[]).some(meta=>meta.edgeMeaning==='ALLY_OF')));
  assert.ok(graphRows.some(candidate=>(candidate.graphMetadata??[]).some(meta=>meta.edgeMeaning==='ALLY_OF')&&(candidate.retrievalIntentIds??[]).includes(relationshipIntent.intentId)));
  assert.equal(graphRows.some(candidate=>candidate.authority?.truth===true),false);
});

test('broad conceptual selected turn consumes existing owner Lore hierarchy nominations through the owner interface',async()=>{
  const row=entry({content:'The Moon Key belongs to a long lunar relic tradition.'});
  const owner=mutableLoreOwner([row]);
  enableHierarchyOwnerPacket(owner,row);
  const brain=new Area52NativeBrain({loreInterface:owner.api});
  const prepared=await brain.prepareTurn({
    chatId:'chat:a',turnId:'worker3:broad:1',generationId:'worker3:broadgen:1',
    query:'Give an overview of lunar relic traditions.',scene:minimalTurnScene('worker3-broad',1),
    budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  const loreRows=channelCandidates(prepared.candidateEnvelope,'OWNER_LORE');
  assert.ok(loreRows.length>0);
  assert.ok(loreRows.some(candidate=>(candidate.channelNominations??[]).some(nomination=>Number(nomination.rankSignals?.hierarchy)>0)));
  assert.ok(owner.state.queryCalls.some(call=>call.intent==='AUTO'));
});

test('unavailable corrective retrieval preserves first-pass evidence and terminates after one attempt',async()=>{
  const brain=new Area52NativeBrain();
  brain.acceptLore({
    sourceId:'lore:worker3:unavailable-corrective',sourceType:'LORE_ENTRY',
    exactContent:'Moon Omen remains disputed.',
    temporalStatus:'UNRESOLVED',
    metadata:{representationText:'Moon Omen remains disputed.'},
  });
  const original=brain.core.retrieval.retrieve.bind(brain.core.retrieval);
  brain.core.retrieval.retrieve=(query,options={})=>{
    if(options?.metadata?.correctiveAction||options?.retrievalIntents?.some(row=>row?.metadata?.correctiveAction)){
      const error=new Error('corrective provider unavailable');
      error.code='OPTIONAL_RETRIEVAL_PROVIDER_UNAVAILABLE';
      throw error;
    }
    return original(query,options);
  };
  const prepared=await brain.prepareTurn({
    chatId:'chat:corrective-unavailable',turnId:'worker3:corrective-unavailable:1',generationId:'worker3:corrective-unavailable-gen:1',
    query:'Moon Omen disputed',scene:minimalTurnScene('worker3-corrective-unavailable',1),
    budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  assert.equal(prepared.retrievalQualityReceipt.quality,'MIXED');
  assert.equal(prepared.correctiveRetrievalReceipt.correctivePasses,1);
  assert.equal(prepared.correctiveRetrievalReceipt.failed,true);
  assert.equal(prepared.correctiveRetrievalReceipt.terminated,true);
  assert.match(prepared.correctiveRetrievalReceipt.error,/unavailable/i);
  assert.ok((prepared.candidateTraceReceipt.rows??[]).length>0);
  assert.equal(prepared.candidateTraceReceipt.hostDeliveryInferred,false);
  assert.ok(prepared.contextSealReceipt);
});

test('paraphrase-only selected turn reports production dense capability unavailable and makes no dense-execution claim',async()=>{
  const row=entry();
  const owner=mutableLoreOwner([row]);
  const brain=new Area52NativeBrain({loreInterface:owner.api});
  const prepared=await brain.prepareTurn({
    chatId:'chat:a',turnId:'worker3:paraphrase:1',generationId:'worker3:paraphrasegen:1',
    query:'ceremonial implement bound to a nocturnal satellite',scene:minimalTurnScene('worker3-paraphrase',1),
    budgetTokens:4096,latencyBudgetMs:1000,executionLabel:'DETERMINISTIC',
  });
  const denseReceipt=(prepared.candidateEnvelope.metadata?.channelReceipts??[]).find(row=>row.channelId==='DENSE_EMBEDDINGS');
  assert.equal(denseReceipt?.status,'UNAVAILABLE');
  assert.equal(channelCandidates(prepared.candidateEnvelope,'DENSE_EMBEDDINGS').length,0);
  assert.equal(channelCandidates(prepared.candidateEnvelope,'OWNER_SPARSE_EXACT').length,0);
  assert.equal(prepared.retrievalQualityReceipt.productionDenseExecuted,false);
});
