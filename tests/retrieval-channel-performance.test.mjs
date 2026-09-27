import test from 'node:test';
import assert from 'node:assert/strict';
import {RetrievalChannelRegistry} from '../src/retrieval-channel-registry.js';

test('retrieval receipts attribute synchronous channel time even when nothing is nominated',()=>{
  const registry=new RetrievalChannelRegistry();
  registry.register({
    descriptor:{channelId:'SLOW_EMPTY',channelVersion:'1.0.0',capabilities:[],supportedIntentKinds:['GENERAL'],maxCandidates:4,revisionRequirements:[],health:'HEALTHY',available:true},
    retrieve:()=>{const end=performance.now()+15;while(performance.now()<end){}return[];},
  });
  const result=registry.retrieveAllSync({intents:[{intentId:'i1',kind:'GENERAL'}],context:{latencyBudgetMs:1000}});
  const row=result.channelReceipts.find(item=>item.channelId==='SLOW_EMPTY');
  assert.equal(row.status,'OK');
  assert.equal(row.nominationCount,0);
  assert.equal(row.attemptedIntents,1);
  assert.equal(row.failedIntents,0);
  assert.ok(row.elapsedMs>=10);
  assert.ok(result.budgetReceipt.elapsedMs>=row.elapsedMs);
});
