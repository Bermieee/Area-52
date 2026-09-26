import assert from 'node:assert/strict';
import {
  AdaptiveBatchSizer,
  CAPABILITIES,
  COGNITIVE_LAYERS,
  EVENT_TYPES,
  EXECUTION_STATUS,
  LIFECYCLE_STATUS,
  MemoryPersistenceAdapter,
  WorkerDirector,
  WorkLedger,
} from '../src/runtime/index.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function units(count, prefix = 'u') {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, payload: i }));
}
function executor(log, { gate = null, failOnce = false } = {}) {
  let failed = false;
  return {
    async execute({ units: sliceUnits, sliceId }) {
      if (gate) await gate.wait();
      if (failOnce && !failed) {
        failed = true;
        throw new Error('synthetic worker crash');
      }
      return sliceUnits.map((u) => u.payload);
    },
    validate({ output }) { return Array.isArray(output); },
    commit({ units: sliceUnits, idempotencyKey }) {
      if (!log.has(idempotencyKey)) log.set(idempotencyKey, sliceUnits.map((u) => u.id));
      return { applied: sliceUnits.length };
    },
  };
}
function cpuWorker(id, capabilities, options = {}) {
  return {
    workerId: id,
    capabilities,
    supportedLayers: options.layers ?? ['L0','L1','L2','L3','L4'],
    resourceProfile: options.resources ?? { CPU: 1 },
    concurrencyCapacity: options.capacity ?? 1,
    latencyScore: options.latency ?? 10,
    health: options.health ?? 'healthy',
  };
}

for (const layer of Object.keys(COGNITIVE_LAYERS)) {
  test(`layer contract accepts ${layer}`, async () => {
    const d = new WorkerDirector();
    d.registerWorker(cpuWorker(`w-${layer}`, [CAPABILITIES.CPU_ANALYSIS]));
    const r = d.submit({ taskType:'classify', owner:'test', layer, requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS], dedupeKey:`${layer}` }, { units:units(1), ...executor(new Map()) });
    assert.equal(r.accepted, true);
    assert.equal(r.task.layer, layer);
  });
}

test('lifecycle remains valid when no worker can execute it', async () => {
  const d = new WorkerDirector();
  const r = d.submit({ taskType:'study', owner:'lore', layer:'L3', requiredCapabilities:[CAPABILITIES.STRUCTURED_LLM], dedupeKey:'blocked' }, { units:units(2), ...executor(new Map()) });
  await d.runCycle();
  const rec = d.ledger.get(r.task.taskId);
  assert.equal(rec.lifecycleStatus, LIFECYCLE_STATUS.ELIGIBLE);
  assert.equal(rec.executionStatus, EXECUTION_STATUS.BLOCKED);
});

test('layer-aware scheduling prefers L1 over L3', async () => {
  const d = new WorkerDirector({ capacity:{CPU:1}, foregroundReserve:{CPU:1}, batch:{base:1,max:1} });
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const order=[];
  const execFor=(name)=>({
    execute: async()=>[name],
    validate:()=>true,
    commit:()=>{order.push(name);},
  });
  d.submit({taskType:'bg',owner:'x',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'bg'}, {units:units(1,'b'),...execFor('L3')});
  d.submit({taskType:'fg',owner:'x',layer:'L1',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'fg'}, {units:units(1,'f'),...execFor('L1')});
  await d.runCycle();
  assert.deepEqual(order,['L1']);
  await d.runCycle();
  assert.deepEqual(order,['L1','L3']);
});

test('foreground reservation and background borrowing are real resource constraints', async () => {
  const d = new WorkerDirector({ capacity:{CPU:2}, foregroundReserve:{CPU:1}, batch:{base:1,max:1} });
  d.registerWorker(cpuWorker('a',[CAPABILITIES.CPU_ANALYSIS]));
  d.registerWorker(cpuWorker('b',[CAPABILITIES.CPU_ANALYSIS]));
  const log=new Map();
  const a=d.submit({taskType:'deep-a',owner:'x',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'a'}, {units:units(3,'a'),...executor(log)});
  const b=d.submit({taskType:'deep-b',owner:'x',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'b'}, {units:units(3,'b'),...executor(log)});
  await d.runCycle();
  assert.equal(d.governor.snapshot().activeLeases,2);
  assert.equal(d.governor.snapshot().borrowedBackgroundLeases,1);
  const yielded=d.beginGeneration({correlationId:'turn-1'});
  assert.equal(yielded.length,2);
  await d.runCycle();
  assert.equal(d.ledger.get(a.task.taskId).executionStatus,EXECUTION_STATUS.PARKED);
  assert.equal(d.ledger.get(b.task.taskId).executionStatus,EXECUTION_STATUS.PARKED);
});

test('cooperative yield waits for the active atomic slice then checkpoints and parks', async () => {
  let release;
  const gate={
    wait:()=>new Promise((resolve)=>{release=resolve;}),
    release:()=>release?.(),
  };
  const d = new WorkerDirector({ capacity:{CPU:1}, foregroundReserve:{CPU:1}, batch:{base:1,max:1} });
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const commits=new Map();
  const r=d.submit({taskType:'study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'yield'}, {units:units(3),...executor(commits,{gate})});
  const cycle=d.runCycle();
  await new Promise((resolve)=>setTimeout(resolve,0));
  assert.equal(d.ledger.get(r.task.taskId).executionStatus,EXECUTION_STATUS.ACTIVE);
  d.beginGeneration();
  assert.equal(d.ledger.get(r.task.taskId).executionStatus,EXECUTION_STATUS.YIELDING);
  gate.release();
  await cycle;
  const rec=d.ledger.get(r.task.taskId);
  assert.equal(rec.executionStatus,EXECUTION_STATUS.PARKED);
  assert.equal(rec.lifecycleStatus,LIFECYCLE_STATUS.ELIGIBLE);
  assert.equal(rec.batch.completedUnitIds.length,1);
  assert.ok(rec.checkpoint);
});

test('parked work resumes from next truthful slice and completed slices do not replay', async () => {
  const d = new WorkerDirector({ capacity:{CPU:1}, foregroundReserve:{CPU:1}, batch:{base:1,max:1} });
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const commits=new Map();
  const r=d.submit({taskType:'study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'resume'}, {units:units(3),...executor(commits)});
  await d.runCycle();
  d.beginGeneration();
  await d.runCycle();
  assert.equal(d.ledger.get(r.task.taskId).executionStatus,EXECUTION_STATUS.PARKED);
  const committedBefore=d.ledger.get(r.task.taskId).batch.completedSliceIds.slice();
  d.completeGeneration();
  await d.drain();
  const rec=d.ledger.get(r.task.taskId);
  assert.equal(rec.lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
  assert.equal(rec.batch.completedUnitIds.length,3);
  assert.equal(new Set(rec.batch.completedSliceIds).size,rec.batch.completedSliceIds.length);
  assert.ok(committedBefore.every((id)=>rec.batch.completedSliceIds.includes(id)));
});

test('reload restores committed progress and never silently replays it', async () => {
  const persistence=new MemoryPersistenceAdapter();
  const first=new WorkerDirector({ persistence, capacity:{CPU:1}, foregroundReserve:{CPU:0}, batch:{base:1,max:1} });
  first.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const commits=new Map();
  const r=first.submit({taskType:'study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'reload'}, {units:units(3),...executor(commits)});
  await first.runCycle();
  const committedId=first.ledger.get(r.task.taskId).batch.completedSliceIds[0];
  const second=new WorkerDirector({ persistence, capacity:{CPU:1}, foregroundReserve:{CPU:0}, batch:{base:1,max:1} });
  second.registerWorker(cpuWorker('w2',[CAPABILITIES.CPU_ANALYSIS]));
  second.attachExecutor(r.task.taskId,executor(commits));
  second.recoverTask(r.task.taskId);
  await second.drain();
  const rec=second.ledger.get(r.task.taskId);
  assert.equal(rec.lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
  assert.equal(rec.batch.completedUnitIds.length,3);
  assert.equal(rec.batch.completedSliceIds.filter((x)=>x===committedId).length,1);
});

test('in-doubt COMMITTING recovery requires explicit reconciliation before resume', async () => {
  const persistence=new MemoryPersistenceAdapter();
  const ledger=new WorkLedger({persistence});
  ledger.createTask({taskId:'task-000001',taskType:'x',owner:'x',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dependencies:[],lifecycleStatus:LIFECYCLE_STATUS.ELIGIBLE});
  ledger.ensureBatch('task-000001',{batchId:'b',units:units(1),adaptiveBatchSize:1,batchPolicy:{}});
  ledger.setLifecycle('task-000001',LIFECYCLE_STATUS.ELIGIBLE);
  ledger.setExecution('task-000001',EXECUTION_STATUS.ACTIVE);
  ledger.startSlice('task-000001',{sliceId:'s1',unitIds:['u0'],size:1});
  ledger.markSliceValidated('task-000001','s1');
  ledger.prepareCommit('task-000001','s1','idem');
  const restored=new WorkLedger({persistence});
  const rec=restored.get('task-000001');
  assert.equal(rec.executionStatus,EXECUTION_STATUS.RECOVERING);
  assert.equal(rec.recoveryState,'commit-reconciliation-required');
});

test('duplicate delivery dedupes against durable identity before and after completion/reload', async () => {
  const persistence=new MemoryPersistenceAdapter();
  const d=new WorkerDirector({persistence});
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const spec={taskType:'same',owner:'x',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'same:1'};
  const a=d.submit(spec,{units:units(1),...executor(new Map())});
  const b=d.submit(spec,{units:units(1),...executor(new Map())});
  assert.equal(b.deduped,true);
  assert.equal(a.task.taskId,b.task.taskId);
  assert.equal(d.lifecycle.listOpen().length,1);
  await d.drain();
  assert.equal(d.ledger.get(a.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);

  const restored=new WorkerDirector({persistence});
  restored.registerWorker(cpuWorker('w2',[CAPABILITIES.CPU_ANALYSIS]));
  const c=restored.submit(spec,{units:units(1),...executor(new Map())});
  assert.equal(c.deduped,true);
  assert.equal(c.task.taskId,a.task.taskId);
  assert.equal(restored.ledger.list().length,1);
  assert.equal(restored.lifecycle.listOpen().length,0);
});

test('compatible pending work coalesces and appends unique units', async () => {
  const d=new WorkerDirector();
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const base={taskType:'source-study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],coalescible:true,coalesceKey:'book:1'};
  const a=d.submit({...base,dedupeKey:'rev1',revision:1},{units:units(1,'a'),...executor(new Map())});
  const b=d.submit({...base,dedupeKey:'rev2',revision:2},{units:units(1,'b'),...executor(new Map())});
  assert.equal(b.coalesced,true);
  assert.equal(b.task.taskId,a.task.taskId);
  assert.equal(d.ledger.get(a.task.taskId).batch.units.length,2);
  assert.equal(d.ledger.get(a.task.taskId).obligation.revision,2);
});

test('newer conflicting revision supersedes stale unstarted work without touching unrelated work', async () => {
  const d=new WorkerDirector();
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const ex=executor(new Map());
  const old=d.submit({taskType:'study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'old',conflictKey:'uid:184',revision:1},{units:units(2),...ex});
  const unrelated=d.submit({taskType:'study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'other',conflictKey:'uid:999',revision:1},{units:units(1),...ex});
  const newer=d.submit({taskType:'study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'new',conflictKey:'uid:184',revision:2},{units:units(1),...ex});
  assert.equal(d.ledger.get(old.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SUPERSEDED);
  assert.equal(d.ledger.get(unrelated.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.ELIGIBLE);
  assert.equal(d.ledger.get(newer.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.ELIGIBLE);
});


test('active stale revision is contained before commit when a newer obligation supersedes it', async () => {
  let release;
  const gate={wait:()=>new Promise((resolve)=>{release=resolve;}),release:()=>release?.()};
  const d=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:0},batch:{base:1,max:1}});
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const commits=[];
  const old=d.submit({taskType:'study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'active-old',conflictKey:'uid:active',revision:1},{
    units:units(2,'old'),
    execute:async({units:xs})=>{await gate.wait(); return xs.map((u)=>u.payload);},
    validate:()=>true,
    commit:({task})=>{commits.push(task.revision);},
  });
  const cycle=d.runCycle();
  await new Promise((resolve)=>setTimeout(resolve,0));
  assert.equal(d.ledger.get(old.task.taskId).executionStatus,EXECUTION_STATUS.ACTIVE);
  const newer=d.submit({taskType:'study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'active-new',conflictKey:'uid:active',revision:2},{units:units(1,'new'),...executor(new Map())});
  assert.equal(d.ledger.get(old.task.taskId).executionStatus,EXECUTION_STATUS.YIELDING);
  gate.release();
  await cycle;
  const stale=d.ledger.get(old.task.taskId);
  assert.equal(stale.lifecycleStatus,LIFECYCLE_STATUS.SUPERSEDED);
  assert.equal(stale.batch.completedUnitIds.length,0);
  assert.deepEqual(commits,[]);
  assert.equal(d.ledger.get(newer.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.ELIGIBLE);
});

test('ambiguous external commit enters reconciliation and is never blindly replayed', async () => {
  const d=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:0},batch:{base:1,max:1}});
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  let executions=0;
  let commits=0;
  const r=d.submit({taskType:'commit-uncertain',owner:'x',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'commit-uncertain'}, {
    units:units(1),
    execute:async({units:xs})=>{executions++; return xs;},
    validate:()=>true,
    commit:()=>{commits++; throw new Error('transport dropped after possible commit');},
  });
  await d.runCycle();
  let rec=d.ledger.get(r.task.taskId);
  assert.equal(rec.executionStatus,EXECUTION_STATUS.RECOVERING);
  assert.equal(rec.recoveryState,'commit-reconciliation-required');
  assert.equal(rec.batch.activeSlice.phase,'COMMITTING');
  await d.runCycle();
  assert.equal(executions,1);
  assert.equal(commits,1);
  d.resolveInDoubtCommit(r.task.taskId,{committed:true,receipt:{reconciled:true}});
  rec=d.ledger.get(r.task.taskId);
  assert.equal(rec.lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
  assert.equal(rec.executionStatus,EXECUTION_STATUS.COMPLETE);
  assert.equal(rec.batch.completedUnitIds.length,1);
});

test('adaptive batch sizing responds deterministically to foreground, pressure, history and backlog', async () => {
  const sizer=new AdaptiveBatchSizer({min:1,max:32,base:8,targetSliceMs:25});
  assert.equal(sizer.choose({}),8);
  assert.equal(sizer.choose({foregroundDemand:true}),4);
  assert.equal(sizer.choose({resourcePressure:0.8}),4);
  assert.equal(sizer.choose({historicalSliceMs:30}),4);
  assert.equal(sizer.choose({queueDepth:100,resourcePressure:0.2}),16);
  assert.equal(sizer.choose({queueDepth:100,resourcePressure:0.2}),16);
});

test('capability matching chooses among same-capability workers by deterministic policy', async () => {
  const d=new WorkerDirector({capacity:{CPU:2},foregroundReserve:{CPU:0}});
  d.registerWorker(cpuWorker('slow',[CAPABILITIES.RERANK],{latency:50}));
  d.registerWorker(cpuWorker('fast',[CAPABILITIES.RERANK],{latency:5}));
  const r=d.submit({taskType:'rerank',owner:'precision',layer:'L1',requiredCapabilities:[CAPABILITIES.RERANK],dedupeKey:'rr'}, {units:units(1),...executor(new Map())});
  await d.runCycle();
  const started=d.telemetry.list({type:EVENT_TYPES.WORK_STARTED}).find((s)=>s.taskId===r.task.taskId);
  assert.equal(started.workerId,'fast');
});


test('resource policy may choose CPU RERANK over faster GPU RERANK while generation reserves GPU', async () => {
  const d=new WorkerDirector({capacity:{CPU:1,GPU:1},foregroundReserve:{CPU:0,GPU:1},batch:{base:1,max:1}});
  d.registerWorker(cpuWorker('gpu-rerank',[CAPABILITIES.RERANK],{resources:{GPU:1},latency:1}));
  d.registerWorker(cpuWorker('cpu-rerank',[CAPABILITIES.RERANK],{resources:{CPU:1},latency:20}));
  d.beginGeneration({correlationId:'gpu-reserved'});
  const r=d.submit({taskType:'rerank',owner:'precision',layer:'L2',foreground:false,requiredCapabilities:[CAPABILITIES.RERANK],dedupeKey:'resource-rerank'}, {units:units(1),...executor(new Map())});
  await d.runCycle();
  const started=d.telemetry.list({type:EVENT_TYPES.WORK_STARTED}).find((signal)=>signal.taskId===r.task.taskId);
  assert.equal(started.workerId,'cpu-rerank');
  d.completeGeneration({correlationId:'gpu-reserved'});
});

test('starvation protection eventually services legitimate deep work despite recurring nearline arrivals', async () => {
  const d=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:0},batch:{base:1,max:1}});
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const order=[];
  const deep=d.submit({taskType:'deep',owner:'x',layer:'L4',priority:50,requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'deep-starvation'}, {
    units:units(1,'deep'), execute:async()=>['deep'], validate:()=>true, commit:()=>order.push('L4'),
  });
  for (let i=0;i<24 && d.ledger.get(deep.task.taskId).lifecycleStatus!==LIFECYCLE_STATUS.SATISFIED;i++) {
    d.submit({taskType:'nearline',owner:'x',layer:'L2',priority:50,requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:`near:${i}`}, {
      units:units(1,`n${i}`), execute:async()=>[i], validate:()=>true, commit:()=>order.push('L2'),
    });
    await d.runCycle();
  }
  assert.equal(d.ledger.get(deep.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
  assert.ok(order.includes('L4'));
});

test('unavailable workers block execution without deleting obligation', async () => {
  const d=new WorkerDirector();
  d.registerWorker(cpuWorker('w',[CAPABILITIES.GRAPH]));
  d.registry.setAvailability('w',false);
  const r=d.submit({taskType:'graph',owner:'x',layer:'L2',requiredCapabilities:[CAPABILITIES.GRAPH],dedupeKey:'g'}, {units:units(1),...executor(new Map())});
  await d.runCycle();
  assert.equal(d.ledger.get(r.task.taskId).executionStatus,EXECUTION_STATUS.BLOCKED);
  assert.equal(d.ledger.get(r.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.ELIGIBLE);
});

test('dependency blocking is explicit', async () => {
  const d=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:0},batch:{base:1,max:1}});
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const ex=executor(new Map());
  const a=d.submit({taskType:'a',owner:'x',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'dep-a'}, {units:units(1,'a'),...ex});
  const b=d.submit({taskType:'b',owner:'x',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'dep-b',dependencies:[a.task.taskId],priority:0}, {units:units(1,'b'),...ex});
  await d.runCycle();
  assert.equal(d.ledger.get(b.task.taskId).executionStatus,EXECUTION_STATUS.BLOCKED);
  await d.runCycle();
  assert.equal(d.ledger.get(b.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
});

test('Event Spine preserves correlation, causation and dedupe identity', async () => {
  const d=new WorkerDirector();
  const e1=d.events.emit(EVENT_TYPES.TURN_RECEIVED,{text:'x'},{correlationId:'c1',causationId:'root',dedupeKey:'turn:1'});
  const e2=d.events.emit(EVENT_TYPES.TURN_RECEIVED,{text:'duplicate'},{correlationId:'c1',causationId:'root',dedupeKey:'turn:1'});
  assert.equal(e1.eventId,e2.eventId);
  assert.equal(e1.correlationId,'c1');
  assert.equal(e1.causationId,'root');
  assert.ok(Object.isFrozen(e1));
});

test('backpressure keeps queue bounded and sheds speculative work for foreground obligations', async () => {
  const d=new WorkerDirector({maxOutstanding:3});
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const ex=executor(new Map());
  for (let i=0;i<3;i++) d.submit({taskType:'spec',owner:'x',layer:'L4',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:`s${i}`,speculative:true,priority:99},{units:units(1,`s${i}`),...ex});
  const fg=d.submit({taskType:'fg',owner:'x',layer:'L1',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'fg-pressure'}, {units:units(1,'f'),...ex});
  assert.equal(fg.accepted,true);
  assert.ok(d.lifecycle.listOpen().length<=3);
  assert.ok(d.ledger.list().some((r)=>r.lifecycleStatus===LIFECYCLE_STATUS.CANCELLED && r.lifecycleReason==='backpressure-shed'));
});

test('telemetry failure is non-fatal to cognition', async () => {
  const d=new WorkerDirector({telemetrySink:()=>{throw new Error('sink down');}});
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const r=d.submit({taskType:'x',owner:'x',layer:'L2',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'telemetry'}, {units:units(1),...executor(new Map())});
  await d.drain();
  assert.equal(d.ledger.get(r.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
  assert.ok(d.telemetry.sinkFailures>0);
});


test('runtime telemetry exposes lifecycle, queue, layer, resource, checkpoint and recovery signals', async () => {
  let release;
  let firstGate=true;
  const gate={
    wait:()=>{
      if (!firstGate) return Promise.resolve();
      firstGate=false;
      return new Promise((resolve)=>{release=resolve;});
    },
    release:()=>release?.(),
  };
  const d=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:1},batch:{base:1,max:1}});
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const r=d.submit({taskType:'telemetry-signals',owner:'x',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'telemetry-signals'}, {units:units(2),...executor(new Map(),{gate})});
  const cycle=d.runCycle();
  await new Promise((resolve)=>setTimeout(resolve,0));
  d.beginGeneration();
  gate.release();
  await cycle;
  d.completeGeneration();
  await d.drain();
  const types=new Set(d.telemetry.list().map((signal)=>signal.type));
  for (const required of ['WORK_STARTED','WORK_YIELD_REQUESTED','WORK_YIELDING','WORK_PARKED','WORK_RESUMED','WORK_COMPLETED','QUEUE_DEPTH','LAYER_UTILIZATION','RESOURCE_UTILIZATION','BATCH_CHECKPOINT']) {
    assert.ok(types.has(required),`missing telemetry ${required}`);
  }
  assert.equal(d.ledger.get(r.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
});

test('worker failure recovers from last checkpoint without replaying completed slices', async () => {
  const d=new WorkerDirector({capacity:{CPU:1},foregroundReserve:{CPU:0},batch:{base:1,max:1},maxRetries:3});
  d.registerWorker(cpuWorker('w',[CAPABILITIES.CPU_ANALYSIS]));
  const commits=new Map();
  const r=d.submit({taskType:'unstable',owner:'x',layer:'L3',requiredCapabilities:[CAPABILITIES.CPU_ANALYSIS],dedupeKey:'unstable'}, {units:units(2),...executor(commits,{failOnce:true})});
  await d.drain();
  const rec=d.ledger.get(r.task.taskId);
  assert.equal(rec.lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
  assert.equal(rec.batch.completedUnitIds.length,2);
  assert.equal(new Set(rec.batch.completedSliceIds).size,2);
});

test('integrated Wave 1 acceptance scenario', async () => {
  let releaseFirstSlice;
  let firstGate = true;
  const gate={
    wait:()=>{
      if (!firstGate) return Promise.resolve();
      firstGate = false;
      return new Promise((resolve)=>{releaseFirstSlice=resolve;});
    },
    release:()=>releaseFirstSlice?.(),
  };
  const persistence=new MemoryPersistenceAdapter();
  const commits=new Map();
  const d=new WorkerDirector({persistence,capacity:{CPU:2,STRUCTURED_LLM:1},foregroundReserve:{CPU:1,STRUCTURED_LLM:1},batch:{base:1,max:2}});
  d.registerWorker(cpuWorker('study-worker',[CAPABILITIES.STRUCTURED_LLM],{resources:{CPU:1,STRUCTURED_LLM:1},latency:20}));
  d.registerWorker(cpuWorker('assist-worker',[CAPABILITIES.SEMANTIC_JUDGMENT],{resources:{CPU:1},latency:5}));

  const study=d.submit({taskType:'lore-study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.STRUCTURED_LLM],dedupeKey:'lore:rev1',conflictKey:'lore:book1',revision:1,sourceRevisions:{book1:1}}, {units:units(4,'lore'),...executor(commits,{gate})});
  const running=d.runCycle();
  await new Promise((resolve)=>setTimeout(resolve,0));
  d.beginGeneration({correlationId:'turn-42'});
  const assist=d.submit({taskType:'truth-judgment',owner:'truth',layer:'L1',requiredCapabilities:[CAPABILITIES.SEMANTIC_JUDGMENT],dedupeKey:'truth:42',foreground:true,payload:{correlationId:'turn-42'}}, {units:units(1,'truth'),...executor(commits)});
  gate.release();
  await running;
  assert.equal(d.ledger.get(study.task.taskId).executionStatus,EXECUTION_STATUS.PARKED);
  assert.equal(d.ledger.get(study.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.ELIGIBLE);
  await d.runCycle();
  assert.equal(d.ledger.get(assist.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
  d.completeGeneration({correlationId:'turn-42'});
  await d.drain();
  assert.equal(d.ledger.get(study.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
  const committedBeforeReload=[...d.ledger.get(study.task.taskId).batch.completedSliceIds];

  const restored=new WorkerDirector({persistence,capacity:{CPU:2,STRUCTURED_LLM:1},foregroundReserve:{CPU:1,STRUCTURED_LLM:1},batch:{base:1,max:2}});
  restored.registerWorker(cpuWorker('study-worker-2',[CAPABILITIES.STRUCTURED_LLM],{resources:{CPU:1,STRUCTURED_LLM:1}}));
  const restoredRecord=restored.ledger.get(study.task.taskId);
  assert.equal(restoredRecord.lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
  assert.deepEqual(restoredRecord.batch.completedSliceIds,committedBeforeReload);

  restored.registerWorker(cpuWorker('assist-worker-2',[CAPABILITIES.SEMANTIC_JUDGMENT],{resources:{CPU:1}}));
  const dup=restored.submit({taskType:'lore-study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.STRUCTURED_LLM],dedupeKey:'lore:rev1',conflictKey:'lore:book1',revision:1},{units:units(4,'lore'),...executor(commits)});
  assert.equal(dup.deduped,true);
  assert.equal(dup.task.taskId,study.task.taskId);
  assert.equal(restored.ledger.get(study.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);

  const stale=restored.submit({taskType:'lore-study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.STRUCTURED_LLM],dedupeKey:'other:rev1',conflictKey:'lore:book2',revision:1},{units:units(1,'stale'),...executor(commits)});
  const newer=restored.submit({taskType:'lore-study',owner:'lore',layer:'L3',requiredCapabilities:[CAPABILITIES.STRUCTURED_LLM],dedupeKey:'other:rev2',conflictKey:'lore:book2',revision:2},{units:units(1,'new'),...executor(commits)});
  assert.equal(restored.ledger.get(stale.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SUPERSEDED);
  assert.equal(restored.ledger.get(newer.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.ELIGIBLE);
  assert.equal(restored.ledger.get(assist.task.taskId).lifecycleStatus,LIFECYCLE_STATUS.SATISFIED);
});

let passed=0;
for (const {name,fn} of tests) {
  try {
    await fn();
    passed+=1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
console.log(`\nRuntime Fabric deterministic suite: ${passed}/${tests.length} PASS`);
