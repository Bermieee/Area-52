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
