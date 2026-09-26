import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ObservationClass,
  SceneIntelligenceRuntime,
  SceneLoadQualificationMonitor,
  createFieldState,
} from '../src/scene/index.js';

const field=(value,revision,evidence)=>createFieldState({value,revision,evidenceRefs:[evidence],observationClass:ObservationClass.OBSERVED,confidence:1});

test('long same-scene session keeps Scene snapshot/delta retention bounded and incremental',()=>{
  const runtime=new SceneIntelligenceRuntime();
  runtime.open({sceneId:'scene:stress',sourceRevisionRefs:['s:0'],provenance:['s:0']});
  for(let i=1;i<=2500;i++){
    const current=runtime.registry.current('scene:stress');
    const evidence='s:'+i;
    const result=runtime.observe({sceneId:'scene:stress',proposalId:'p:'+i,sourceRevisionRefs:[evidence],evidenceRefs:[evidence],fields:{activeThreads:field(['thread:'+(i%7)],current.revision+1,evidence)}});
    assert.equal(result.applied,true);
  }
  const record=runtime.registry.get('scene:stress');
  assert.ok(record.snapshots.length<=96,'snapshots='+record.snapshots.length);
  assert.ok(record.deltas.length<=192,'deltas='+record.deltas.length);
  assert.equal(runtime.registry.current('scene:stress').revision,2501);
});

test('browser load qualification records responsiveness and heap growth only when browser APIs support them',()=>{
  let t=100;
  const perf={now:()=>++t,memory:{usedJSHeapSize:10_000_000}};
  const monitor=new SceneLoadQualificationMonitor({performanceApi:perf,maxSamples:8});
  const sample=monitor.measure('turn',()=>{
    perf.memory.usedJSHeapSize+=250_000;
    for(let i=0;i<10000;i++)Math.sqrt(i);
  });
  assert.equal(sample.measurementClass,'MEASURED_BROWSER_API');
  assert.equal(sample.heapDeltaBytes,250000);
  assert.ok(sample.elapsedMs>=1);
  for(let i=0;i<20;i++)monitor.measure('burst',()=>{});
  const report=monitor.report();
  assert.ok(report.samples.length<=8);
  assert.equal(report.browserHeapSupported,true);
  assert.equal(report.readOnly,true);
});
