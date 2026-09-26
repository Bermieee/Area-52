import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSelectedTurnInspection } from '../src/ui-core/selected-turn-inspection.js';

const current={chatId:'chat-a',turnId:'turn-2',generationId:'gen-2',correlationId:'corr-2',worldRevision:8,sceneRevision:5,sourceRevisionRefs:['src-8']};

test('turn-scoped Inspect target is fenced to the exact current selection and exposes missing receipt edges honestly',()=>{
  const read=prepareSelectedTurnInspection({kind:'wave8-stage',id:'truth',title:'Truth',item:{state:'COMPLETE'}},current);
  assert.equal(read.available,true);
  assert.equal(read.selection.generationId,'gen-2');
  assert.equal(read.selectionEvidence.selectionSource,'UI_RENDER_SELECTION');
  assert.equal(read.selectionEvidence.receipt,'NO_EVIDENCE');
  assert.equal(read.selectionEvidence.parentLink,'NO_EVIDENCE');
  assert.equal(read.selectionEvidence.duration,'NO_EVIDENCE');
  assert.equal(read.selectionEvidence.ownerAcceptance,'NO_EVIDENCE');
});

test('foreign or regenerated Inspect target becomes NO_EVIDENCE instead of opening stale state',()=>{
  const stale=prepareSelectedTurnInspection({kind:'wave13-gather-trace',id:'gather-old',selection:{...current,turnId:'turn-1',generationId:'gen-1'},payload:{receiptId:'gather-old'}},current);
  assert.equal(stale.available,false);
  assert.equal(stale.availabilityState,'STALE_SELECTED_TURN_EVIDENCE');
  assert.equal(stale.payload.status,'NO_EVIDENCE');
  assert.equal(stale.receiptRef,null);
});

test('turn-scoped Inspect target with no exact active turn states that evidence is unavailable',()=>{
  const read=prepareSelectedTurnInspection({kind:'wave13-producer-inspection',id:'scene'}, {chatId:'chat-a'});
  assert.equal(read.available,false);
  assert.equal(read.availabilityState,'NO_SELECTED_TURN_EVIDENCE');
  assert.equal(read.selectionEvidence.receipt,'NO_EVIDENCE');
});

test('non-turn-scoped configuration inspection remains unchanged',()=>{
  const object={kind:'wave13-resource-profile',id:'resource-1',available:true};
  assert.equal(prepareSelectedTurnInspection(object,current),object);
});
