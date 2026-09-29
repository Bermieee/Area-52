// Cap remediation, cap ledger rows 42-44 (owner handoff "Memory Internal Traversal"). Projections read a trailing window
// of 8,192 journal entries, so a fact settled earlier disappeared from CURRENT and HISTORICAL; the projection threw past
// 4,096 slots; entity traversal kept the OLDEST 512 claims. Contract now: projections read the whole journal, never
// throw on slot count, and a traversal page keeps the newest claims and reports how many it left out.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityClass,MutationType,SettlementDecisionType} from '../src/memory-contracts.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';

function evidence(producer,{
  id,
  sourceId=id,
  sourceRevisionId=id+'@r1',
  text,
  worldRevision=0,
  sceneRevision=null,
  participants=[],
  knownBy=[],
  perspective='WORLD',
}={}) {
  return producer.appendEvidence({
    id,
    sourceId,
    sourceRevisionId,
    exactContent:text,
    kind:'EXPERIENCE',
    occurredAt:worldRevision,
    worldRevision,
    sceneRevision,
    participants,
    knownBy,
    perspective,
    provenance:['test:'+id],
  });
}

function settlementEnvelope({
  evidenceId,
  sourceRevisionId,
  claimId,
  subjectId,
  predicate,
  value,
  worldRevision,
  decision=SettlementDecisionType.ACCEPT_CURRENT,
  authorityClass=AuthorityClass.OBSERVED,
  temporalKind='CURRENT',
  validFrom=worldRevision,
  reason='test settlement',
}={}) {
  const proposalId='proposal:'+claimId;
  const claim={
    kind:'Claim',
    id:claimId,
    subjectId,
    predicate,
    value,
    temporal:{kind:temporalKind,validFrom},
    authorityClass,
    confidence:1,
    provenance:{sourceRevisionIds:[sourceRevisionId],evidenceIds:[evidenceId]},
    owner:'WORLD_STATE',
    semanticKey:subjectId+'|'+predicate+'|'+JSON.stringify(value),
    explicitness:'EXPLICIT',
  };
  return {
    proposal:{
      kind:'MutationProposal',
      id:proposalId,
      mutationType:MutationType.SET_CLAIM,
      owner:'WORLD_STATE',
      sourceRevisionIds:[sourceRevisionId],
      evidenceIds:[evidenceId],
      freshnessRevisionIds:[sourceRevisionId],
      payload:{claim},
      status:'PROPOSED',
    },
    decision:{
      kind:'SettlementDecision',
      id:'decision:'+claimId,
      proposalId,
      decision,
      owner:'WORLD_STATE',
      evidenceIds:[evidenceId],
      sourceRevisionIds:[sourceRevisionId],
      worldRevision,
      reason,
      consideredClaimIds:[],
      receiptId:'receipt:'+claimId,
      diagnostics:{validation:[{ok:true}]},
    },
    receipt:{
      kind:'SettlementReceipt',
      id:'receipt:'+claimId,
      proposalId,
      owner:'WORLD_STATE',
      outcome:'SETTLED',
      settledArtifactIds:[claimId],
      supersededArtifactIds:[],
      revision:worldRevision,
      reason:null,
    },
  };
}


function settle(producer,i,{subjectId,predicate,value,worldRevision}) {
  const ev=evidence(producer,{id:'ev:'+i,text:'Evidence '+i+'.',worldRevision,participants:[subjectId]});
  producer.applySettlement(settlementEnvelope({evidenceId:ev.id,sourceRevisionId:ev.sourceRevisionId,claimId:'claim:'+i,subjectId,predicate,value,worldRevision}));
}

test('a fact settled before 8,200 later settlements (on 8,200 other slots) is still CURRENT and HISTORICAL', {timeout:600000}, () => {
  const producer=new MemoryTemporalProducer();
  settle(producer,'early',{subjectId:'Mara',predicate:'home',value:'Harbor',worldRevision:1});
  const N=8200;
  for (let i=0;i<N;i+=1) settle(producer,i,{subjectId:'Walker'+i,predicate:'state',value:'awake',worldRevision:2});
  assert.ok(producer.graph.settlementJournal.length>8192);
  const current=producer.graph.currentProjection({includeStale:false});
  assert.ok(current.length>4096, 'more than 4,096 slots, no throw ('+current.length+')');
  assert.ok(current.some((row)=>row.subjectId==='Mara'&&row.value==='Harbor'), 'the early fact is still current');
  assert.equal(producer.graph.currentClaimForSlot('Mara|home')?.value ?? producer.graph.currentProjection().find((row)=>row.subjectId==='Mara')?.value,'Harbor');
  assert.ok(producer.graph.historicalClaims({subjectId:'Mara'}).some((row)=>row.value==='Harbor'));
});

test('an entity traversal page keeps the newest claims and reports the rest', () => {
  const producer=new MemoryTemporalProducer();
  for (let i=0;i<600;i+=1) settle(producer,i,{subjectId:'Mara',predicate:'visited-'+i,value:'Room'+i,worldRevision:i+1});
  const page=producer.traverseEntity('Mara');
  assert.equal(page.claims.length,512);
  assert.equal(page.bounded,true);
  assert.equal(page.boundedOut,88);
  assert.equal(page.totalMatching,600);
  assert.equal(page.claims.at(-1).value,'Room599','the newest claim is in the page');
  assert.equal(page.claims[0].value,'Room88');
  const small=producer.traverseEntity('Mara',{maxClaims:1000});
  assert.equal(small.bounded,false);
  assert.equal(small.boundedOut,0);
});

test('the historian\'s read-only claim view equals historicalClaims row for row', () => {
  const producer=new MemoryTemporalProducer();
  for (let i=0;i<40;i+=1) settle(producer,i,{subjectId:'Mara',predicate:'room-'+(i%5),value:'Room'+i,worldRevision:i+1});
  for (const options of [{},{includeUnresolved:true,includeStale:false},{subjectId:'Mara',predicate:'room-2'},{asOfWorldRevision:20}]) {
    assert.deepEqual(producer.graph.historicalClaimsView(options),producer.graph.historicalClaims(options));
  }
});
