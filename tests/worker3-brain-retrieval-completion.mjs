import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductionSparseRetrievalChannel} from '../src/production-sparse-retrieval.js';

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
