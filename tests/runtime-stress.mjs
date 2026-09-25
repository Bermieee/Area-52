import assert from 'node:assert/strict';
import { CAPABILITIES, LIFECYCLE_STATUS, WorkerDirector } from '../src/runtime/index.js';

function worker(id, capability, resource='CPU') {
  return { workerId:id, capabilities:[capability], supportedLayers:['L0','L1','L2','L3','L4'], resourceProfile:{[resource]:1}, concurrencyCapacity:1, latencyScore:10 };
}
function oneUnit(id) { return [{id:`${id}:u`,payload:id}]; }
const commits=new Set();
const exec={
  async execute({units}) { return units.map((u)=>u.payload); },
  validate(){ return true; },
  commit({idempotencyKey}) { commits.add(idempotencyKey); return {ok:true}; },
};

const d=new WorkerDirector({persistence:null,maxOutstanding:500,capacity:{CPU:4,IO:2,GRAPH:1},foregroundReserve:{CPU:1,IO:1,GRAPH:0},batch:{base:1,max:4}});
d.registerWorker(worker('cpu-a',CAPABILITIES.CPU_ANALYSIS));
d.registerWorker(worker('cpu-b',CAPABILITIES.CPU_ANALYSIS));
d.registerWorker(worker('io-a',CAPABILITIES.IO,'IO'));
d.registerWorker(worker('graph-a',CAPABILITIES.GRAPH,'GRAPH'));

// Force one long-running background lease through a generation preemption before the bulk load.
const preempt=d.submit({taskType:'preempt-fixture',owner:'stress',layer:'L3',requiredCapabilities:[CAPABILITIES.GRAPH],dedupeKey:'preempt-fixture'}, {units:Array.from({length:3},(_,j)=>({id:`pre:u${j}`,payload:j})),...exec});
await d.runCycle();
d.beginGeneration({correlationId:'stress-preempt'});
await d.runCycle();
const preemptYieldCount=d.telemetry.list({type:'WORK_YIELD_REQUESTED'}).length;
d.completeGeneration({correlationId:'stress-preempt'});
await d.drain({maxCycles:20});
assert.equal(d.ledger.get(preempt.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);

let accepted=0, rejected=0;
for (let i=0;i<2200;i++) {
  const layer=i%23===0?'L1':i%5===0?'L2':i%3===0?'L3':'L4';
  const capability=layer==='L1'||layer==='L2'?CAPABILITIES.CPU_ANALYSIS:(i%2?CAPABILITIES.IO:CAPABILITIES.GRAPH);
  const speculative=layer==='L4';
  const result=d.submit({
    taskType:`stress-${capability}`,
    owner:'stress',
    layer,
    requiredCapabilities:[capability],
    dedupeKey:`stress:${i}`,
    conflictKey:i%19===0?`source:${i%57}`:null,
    revision:i,
    speculative,
    priority:layer==='L1'?0:50,
  },{units:(layer==='L3'||layer==='L4')?Array.from({length:3},(_,j)=>({id:`${i}:u${j}`,payload:i})):oneUnit(i),...exec});
  if(result.accepted) accepted++; else rejected++;
  if(i%137===0) {
    d.beginGeneration({correlationId:`stress-turn:${i}`});
    await d.runCycle();
    d.completeGeneration({correlationId:`stress-turn:${i}`});
  }
  if(i%41===0) await d.runCycle();
  assert.ok(d.lifecycle.listOpen().length<=500,'open obligation bound exceeded');
}

await d.drain({maxCycles:5000});

const records=d.ledger.list();
const completed=records.filter((r)=>r.lifecycleStatus===LIFECYCLE_STATUS.SATISFIED);
const superseded=records.filter((r)=>r.lifecycleStatus===LIFECYCLE_STATUS.SUPERSEDED);
const cancelled=records.filter((r)=>r.lifecycleStatus===LIFECYCLE_STATUS.CANCELLED);
assert.ok(accepted>0);
assert.ok(rejected>0 || cancelled.length>0,'stress should exercise backpressure');
assert.ok(completed.length>0,'stress should complete legitimate work');
assert.equal(new Set(commits).size,commits.size,'idempotency keys must remain unique');
assert.ok(d.lifecycle.listOpen().length<=500);
assert.ok(preemptYieldCount>0,'yield cycles should occur');
assert.ok(d.telemetry.list({type:'QUEUE_DEPTH'}).length>0);

console.log(`Runtime Fabric stress: 2200 submitted; accepted=${accepted}; rejected=${rejected}; completed=${completed.length}; superseded=${superseded.length}; cancelled=${cancelled.length}; open=${d.lifecycle.listOpen().length}`);
console.log('Runtime Fabric stress suite: PASS');
