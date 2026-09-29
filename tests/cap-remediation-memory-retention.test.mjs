import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceRegistry} from '../src/source-registry.js';
import {NativeKnowledgeStore} from '../src/native-knowledge-store.js';
import {compactTurnRecord,DEFAULT_FULL_DETAIL_TURNS} from '../src/native-turn-retention.js';

test('row 61: turn-detail compaction is diagnostic-only and preserves the immutable published packet',()=>{
  assert.equal(DEFAULT_FULL_DETAIL_TURNS,4);
  const packet={
    kind:'SealedContextPacket',
    sealId:'seal:test',
    sourceRevisionSet:['source:test@1'],
    messages:[{role:'system',content:'sealed prompt text'}],
  };
  const sealReceipt={kind:'ContextSealReceipt',sealId:'seal:test',status:'SEALED'};
  const experience={sourceRevisionId:'source:test@1',evidenceIds:['evidence:test']};
  const record={
    turnId:'turn:test',sequence:1,
    published:{
      packet,
      sealReceipt,
      candidates:[{candidateId:'candidate:1',sourceRevisionRefs:['source:test@1'],representationText:'x'.repeat(5000)}],
    },
    experience,
    oversizedDiagnostic:{payload:'diagnostic-only '.repeat(1000)},
  };

  const compacted=compactTurnRecord(record,{sequence:9});

  assert.equal(compacted.retention.state,'COMPACTED');
  assert.equal(compacted.retention.ownerEvidenceAuthoritative,true);
  assert.equal(compacted.retention.sealedPacketRetained,true);
  assert.deepEqual(compacted.published.packet,packet);
  assert.deepEqual(compacted.published.sealReceipt,sealReceipt);
  assert.deepEqual(compacted.experience,experience);
  assert.equal(compacted.oversizedDiagnostic.retainedAs,'REFERENCE');
  assert.ok(compacted.retention.bytesAfter<compacted.retention.bytesBefore);
  assert.deepEqual(record.published.packet,packet,'input record is not mutated');
});

test('row 64: evicting non-current native-knowledge cache rows never evicts exact source revision history',()=>{
  const registry=new SourceRegistry();
  const store=new NativeKnowledgeStore({registry,maxRecords:64,maxHistoryPerSource:2});

  store.admitExperience({
    sourceId:'memory:cache-history',
    exactContent:'revision 1 exact learned evidence',
    chatId:'chat:a',
    turnId:'turn:1',
  });
  for(let revision=2;revision<=70;revision+=1){
    store.correctSource('memory:cache-history','revision '+revision+' exact learned evidence',{turnId:'turn:'+revision});
  }

  assert.ok(store.records.size<=64);
  assert.ok(store.history('memory:cache-history').length<=2);
  assert.equal(registry.listRevisions('memory:cache-history').length,70);
  assert.equal(registry.getRevision('memory:cache-history@1').exactContent,'revision 1 exact learned evidence');
  assert.equal(registry.getRevision('memory:cache-history@70').exactContent,'revision 70 exact learned evidence');

  const restoredRegistry=new SourceRegistry();
  restoredRegistry.restoreState(JSON.parse(JSON.stringify(registry.exportState())));
  const restoredStore=new NativeKnowledgeStore({
    registry:restoredRegistry,
    snapshot:JSON.parse(JSON.stringify(store.exportState())),
  });

  assert.equal(restoredRegistry.listRevisions('memory:cache-history').length,70);
  assert.equal(restoredRegistry.getRevision('memory:cache-history@1').exactContent,'revision 1 exact learned evidence');
  assert.equal(restoredStore.currentRecordForSource('memory:cache-history').exactContent,'revision 70 exact learned evidence');
  assert.equal(restoredStore.diagnostics().externalDatabaseRequired,false);
});
