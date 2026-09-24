import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ArtifactReferenceStatus, CapabilityProfileRegistry, CognitiveDataPlane, DeterministicPrecisionAdapter,
  DeterministicProviderAdapter, FailureCode, MeasurementStatus, OpenAICompatibleProviderAdapter,
  Placement, ProviderAdapterRegistry, ProviderInvocationError, ResultClass, SpecialistExecutionLayer, TurnEventHub,
  artifactReferenceFromEnvelope, benchmarkReferenceTransfer, createArtifactReference, createCognitiveTask,
  createRevisionSet, createTurnEnvelope, negotiateCapabilities, resolveArtifactReference,
  runPrecisionBenchmark, runProviderQualification, summarizeCoprocessorIntegrationBenchmarks,
  toFrameworkTurnEventEnvelope, consumeRuntimeTurnEvent, toRuntimeObligation, transportCandidateMatrix,
} from '../src/coprocessor/index.js';

function task({
  taskId='task', taskType='HISTORIAN_RETRIEVAL', capabilities=['CAP'], capabilityRequests=null, fallbackCapabilitySets=[],
  resultClass=ResultClass.REQUIRED, placement=Placement.HOT, cognitiveLayer='L1', metadata={}, batchMetadata={batchable:false},
  softDeadline=40, hardDeadline=70,
}={}) {
  return createCognitiveTask({
    taskId, taskType, turnId:'turn', correlationId:'corr', causationId:'event', requiredCapabilities:capabilities,
    capabilityRequests:capabilityRequests ?? capabilities, fallbackCapabilitySets, resultClass, placement, cognitiveLayer,
    softDeadline, hardDeadline, compilerLane:'loreEvidence', intentFingerprint:'intent:turn', metadata, batchMetadata,
    inputRevisionSet:createRevisionSet({sourceRevisionSet:['source:1'],worldRevision:3,sceneRevision:4,characterStateRevision:5}),
  });
}

function profile(registry, overrides={}) {
  return registry.register({ profileId:'profile', workerId:'slot', providerId:'provider', capabilities:['CAP'], capabilityVersions:{CAP:2},
    latencyClass:'LOW', costClass:'LOW', maxContextTokens:4096, maxOutputTokens:1024, ...overrides });
}

function artifact({revision=4,owner='CORE',artifactType='Claim',payload=null}={}) {
  return { kind:'ArtifactEnvelope', artifactId:'artifact:1', artifactType, schemaVersion:'1.0.0', owner, authority:'UNRESOLVED',
    provenance:{sourceRevisionSet:['source:1'],worldRevision:3,sceneRevision:4}, revision, dependencies:[], invalidators:[], status:'VALID',
    payload:payload ?? {relationships:{Mara:{trust:'HIGH'}},huge:'x'.repeat(12000)} };
}

class RepoFixture {
  constructor(rows=[]){this.rows=rows;}
  get(domain,id,{revision=null}={}){
    const rows=this.rows.filter(row=>row.domain===domain&&row.id===id).sort((a,b)=>a.revision-b.revision);
    const row=revision==null?rows.at(-1):rows.find(item=>item.revision===revision);
    return row?structuredClone(row):null;
  }
}

function repoWith(...envelopes) {
  return new RepoFixture(envelopes.map(value=>({domain:'artifacts',id:value.artifactId,revision:value.revision,value})));
}

// #124 / #82 capability negotiation

test('capability negotiation returns provider-neutral eligible implementations without a scheduling decision',()=>{
  const registry=new CapabilityProfileRegistry(); profile(registry,{profileId:'mimo',providerId:'MiMo',workerId:'slot-a'}); profile(registry,{profileId:'glm',providerId:'GLM',workerId:'slot-b'});
  const outcome=negotiateCapabilities(registry,task({capabilityRequests:[{id:'CAP',minVersion:1,preferredVersion:2}]}));
  assert.equal(outcome.kind,'CapabilityNegotiation'); assert.equal(outcome.eligibleImplementations.length,2);
  assert.equal(outcome.schedulingDecision,null); assert.equal(outcome.authorityGranted,false);
  assert.deepEqual(outcome.requestedCapabilities,[{id:'CAP',minVersion:1,preferredVersion:2}]);
});

test('capability negotiation uses declared fallback capability set only after primary has no match',()=>{
  const registry=new CapabilityProfileRegistry(); profile(registry,{capabilities:['ALT'],capabilityVersions:{ALT:2}});
  const outcome=negotiateCapabilities(registry,task({capabilities:['PRIMARY'],capabilityRequests:[{id:'PRIMARY',minVersion:1,preferredVersion:1}],fallbackCapabilitySets:[[{id:'ALT',minVersion:2,preferredVersion:2}]]}));
  assert.equal(outcome.degraded,true); assert.equal(outcome.fallbackSetUsed,0); assert.equal(outcome.eligibleImplementations.length,1);
});

test('capability negotiation reports version-too-old capability incompatibility',()=>{
  const registry=new CapabilityProfileRegistry(); profile(registry,{capabilityVersions:{CAP:1}});
  const outcome=negotiateCapabilities(registry,task({capabilityRequests:[{id:'CAP',minVersion:2,preferredVersion:3}]}));
  assert.deepEqual(outcome.missingCapabilities,['CAP']); assert.equal(outcome.incompatibilities[0].capabilityFailures[0].availableVersion,1);
});

for (const [name, mutate, expected] of [
  ['unavailable', r=>r.setAvailability('profile',false), 'UNAVAILABLE'],
  ['unhealthy', r=>r.setHealth('profile','unhealthy'), 'UNHEALTHY'],
  ['concurrency full', r=>r.setLoad('profile',1), 'CONCURRENCY_FULL'],
]) test(`capability negotiation rejects ${name} implementation`,()=>{
  const registry=new CapabilityProfileRegistry(); profile(registry); mutate(registry);
  const outcome=negotiateCapabilities(registry,task()); assert.equal(outcome.eligibleImplementations.length,0);
  assert.ok(outcome.constraintFailures[0].failures.includes(expected));
});

test('capability negotiation enforces foreground and background eligibility',()=>{
  const fg=new CapabilityProfileRegistry(); profile(fg,{foregroundEligible:false});
  assert.ok(negotiateCapabilities(fg,task()).constraintFailures[0].failures.includes('FOREGROUND_INELIGIBLE'));
  const bg=new CapabilityProfileRegistry(); profile(bg,{backgroundEligible:false,placements:[Placement.DEEP],supportedLayers:['L3']});
  const deep=task({resultClass:ResultClass.DEFERRED,placement:Placement.DEEP,cognitiveLayer:'L3'});
  assert.ok(negotiateCapabilities(bg,deep).constraintFailures[0].failures.includes('BACKGROUND_INELIGIBLE'));
});

test('capability negotiation enforces cost and latency budgets',()=>{
  const registry=new CapabilityProfileRegistry(); profile(registry,{costClass:'HIGH',latencyClass:'HIGH'});
  const outcome=negotiateCapabilities(registry,task(),{maxCostClass:'LOW',maxLatencyClass:'MEDIUM',maxLatencyMs:80});
  const failures=outcome.constraintFailures[0].failures;
  assert.ok(failures.includes('COST_BUDGET_EXCEEDED')); assert.ok(failures.includes('LATENCY_CLASS_EXCEEDED')); assert.ok(failures.includes('LATENCY_BUDGET_EXCEEDED'));
});

test('capability negotiation enforces context/output and structured-output requirements',()=>{
  const registry=new CapabilityProfileRegistry(); profile(registry,{maxContextTokens:10,maxOutputTokens:5,structuredOutput:false});
  const outcome=negotiateCapabilities(registry,task(),{contextTokens:11,expectedOutputTokens:6,requireStructuredOutput:true});
  const failures=outcome.constraintFailures[0].failures;
  assert.ok(failures.includes('CONTEXT_TOO_LARGE')); assert.ok(failures.includes('OUTPUT_TOO_LARGE')); assert.ok(failures.includes('STRUCTURED_OUTPUT_UNAVAILABLE'));
});

// Runtime obligation / #88 / #94

test('Runtime HOT REQUIRED obligation carries deadlines, fallback, quality and no scheduling authority',()=>{
  const obligation=toRuntimeObligation(task({metadata:{qualityWeight:.9,maxLatencyMs:70,maxCostClass:'LOW'}}));
  assert.equal(obligation.runtimeClass,'HOT'); assert.equal(obligation.resultClass,'REQUIRED');
  assert.deepEqual(obligation.deadlineBudget,{softDeadline:40,hardDeadline:70,resultClass:'REQUIRED',qualityWeight:.9});
  assert.equal(obligation.fallbackContract.type,'DETERMINISTIC'); assert.equal(obligation.schedulingDecision,null);
  assert.equal(obligation.resultContract.settlementAuthority,false); assert.equal(obligation.resultContract.contextSealBypass,false);
});

test('Runtime DEEP obligation exposes legal yield/checkpoint/resume metadata without owning checkpoint storage',()=>{
  const deep=task({resultClass:ResultClass.DEFERRED,placement:Placement.DEEP,cognitiveLayer:'L3',batchMetadata:{batchable:true,slicePolicy:'ADAPTIVE',checkpointBoundary:'SLICE',yieldSafety:'CHECKPOINT_ONLY',partialResultSemantics:'PRESERVE_VALID_SLICES'},metadata:{batchSlice:'slice:7'}});
  const obligation=toRuntimeObligation(deep);
  assert.equal(obligation.runtimeClass,'DEEP'); assert.equal(obligation.foreground,false); assert.equal(obligation.yieldPolicy.legal,true);
  assert.equal(obligation.yieldPolicy.checkpointBoundary,'SLICE'); assert.match(obligation.yieldPolicy.resumeIdentity,/^resume:/);
  assert.equal(obligation.checkpointPolicy.storageOwnedByRuntime,true); assert.equal(obligation.batchHint.batchSlice,'slice:7');
});

test('OPPORTUNISTIC obligation remains foreground-capable but does not gain Seal authority',()=>{
  const obligation=toRuntimeObligation(task({resultClass:ResultClass.OPPORTUNISTIC}));
  assert.equal(obligation.foreground,true); assert.equal(obligation.deadlineClass,'OPPORTUNISTIC'); assert.equal(obligation.resultContract.contextSealBypass,false);
});

// #89 canonical event boundary

test('Sidecar consumes Framework-shaped TURN_EVENT preserving identity and revision fences',()=>{
  const turn=createTurnEnvelope({turnId:'turn:evt',eventId:'event:evt',correlationId:'corr:evt',causationId:'cause:1',dedupeKey:'dedupe:evt',sourceRevisionSet:['source:9'],worldRevision:9,sceneRevision:8,characterStateRevision:7,createdAt:12,deadline:82,cognitiveLayer:'L1',requiredCapabilities:['CAP'],deliveryAttempt:2});
  const framework=toFrameworkTurnEventEnvelope(turn,{sequence:44});
  const {event}=consumeRuntimeTurnEvent(framework);
  assert.equal(event.eventId,'event:evt'); assert.equal(event.causationId,'cause:1'); assert.equal(event.correlationId,'corr:evt');
  assert.deepEqual(event.sourceRevisionSet,['source:9']); assert.equal(event.worldRevision,9); assert.equal(event.sceneRevision,8); assert.equal(event.deliveryAttempt,2);
});

test('duplicate Runtime TURN_EVENT delivery is idempotent through TurnEventHub',()=>{
  const hub=new TurnEventHub(); const turn=createTurnEnvelope({turnId:'turn:dup',eventId:'event:dup',correlationId:'corr:dup',dedupeKey:'dedupe:dup'});
  const framework=toFrameworkTurnEventEnvelope(turn);
  assert.equal(consumeRuntimeTurnEvent(framework,{eventHub:hub}).duplicate,false);
  assert.equal(consumeRuntimeTurnEvent({...framework,payload:{...framework.payload,deliveryAttempt:2}},{eventHub:hub}).duplicate,true);
  assert.equal(hub.list().length,1);
});

test('unknown Runtime TURN_EVENT major version is rejected explicitly',()=>{
  const turn=createTurnEnvelope({turnId:'turn:bad',eventId:'event:bad',correlationId:'corr:bad',dedupeKey:'dedupe:bad'});
  const framework={...toFrameworkTurnEventEnvelope(turn),eventVersion:'2.0.0'};
  assert.throws(()=>consumeRuntimeTurnEvent(framework),/Unsupported eventVersion/);
});

// #81 data plane

test('artifact reference uses Core ArtifactEnvelope identity and exact repository revision',()=>{
  const env=artifact(); const reference=artifactReferenceFromEnvelope(env,{storageDomain:'artifacts'});
  assert.equal(reference.artifactId,env.artifactId); assert.equal(reference.artifactType,env.artifactType); assert.equal(reference.owner,env.owner); assert.equal(reference.revision,4);
  const resolved=resolveArtifactReference(reference,{repository:repoWith(env)});
  assert.equal(resolved.status,ArtifactReferenceStatus.EXACT); assert.equal(resolved.material.revision,4); assert.equal(resolved.authorityGranted,false);
});

test('artifact reference revision fences produce explicit STALE without fetching a newer revision',()=>{
  const env=artifact(); const reference=artifactReferenceFromEnvelope(env,{sourceRevisionSet:['source:1'],worldRevision:3,sceneRevision:4});
  const resolved=resolveArtifactReference(reference,{repository:repoWith(env),currentRevisionSet:{sourceRevisionSet:['source:1'],worldRevision:3,sceneRevision:5}});
  assert.equal(resolved.status,ArtifactReferenceStatus.STALE); assert.equal(resolved.material,null);
});

test('missing exact artifact revision never silently substitutes newer data',()=>{
  const latest=artifact({revision:5}); const reference=createArtifactReference({artifactId:'artifact:1',artifactType:'Claim',owner:'CORE',revision:4,storageDomain:'artifacts'});
  const resolved=resolveArtifactReference(reference,{repository:repoWith(latest)});
  assert.equal(resolved.status,ArtifactReferenceStatus.SUPERSEDED); assert.equal(resolved.material,null);
});

test('missing artifact produces typed MISSING',()=>{
  const reference=createArtifactReference({artifactId:'missing',artifactType:'Claim',owner:'CORE',revision:1});
  assert.equal(resolveArtifactReference(reference,{repository:new RepoFixture()}).status,ArtifactReferenceStatus.MISSING);
});

test('wrong artifact owner or type is rejected rather than reinterpreted',()=>{
  const env=artifact();
  const wrongOwner=createArtifactReference({artifactId:env.artifactId,artifactType:env.artifactType,owner:'OTHER',revision:env.revision});
  const wrongType=createArtifactReference({artifactId:env.artifactId,artifactType:'Reflection',owner:env.owner,revision:env.revision});
  assert.equal(resolveArtifactReference(wrongOwner,{repository:repoWith(env)}).status,ArtifactReferenceStatus.INVALID);
  assert.equal(resolveArtifactReference(wrongType,{repository:repoWith(env)}).status,ArtifactReferenceStatus.INVALID);
});

test('slice retrieval returns only requested material',()=>{
  const env=artifact(); const reference=artifactReferenceFromEnvelope(env,{sliceSelector:['payload','relationships']});
  const resolved=resolveArtifactReference(reference,{repository:repoWith(env)});
  assert.equal(resolved.status,ArtifactReferenceStatus.EXACT); assert.deepEqual(resolved.material,{Mara:{trust:'HIGH'}}); assert.equal('huge' in resolved.material,false);
});

test('large payload reference benchmark measures real byte savings and leaves unavailable metrics explicit',()=>{
  const env=artifact(); const reference=artifactReferenceFromEnvelope(env); const benchmark=benchmarkReferenceTransfer({payload:env,reference,iterations:5});
  assert.equal(benchmark.serializedBytes.status,'MEASURED'); assert.ok(benchmark.serializedBytes.value.saved>10000); assert.ok(benchmark.savingsRatio.value>0.8);
  assert.equal(benchmark.copies.status,'NOT_MEASURED'); assert.equal(benchmark.memoryPressure.status,'NOT_MEASURED');
});

test('CognitiveDataPlane resolves through Core-compatible repository get(domain,id,{revision}) contract',()=>{
  const env=artifact(); const plane=new CognitiveDataPlane({repository:repoWith(env)}); const reference=plane.reference(env);
  assert.equal(plane.resolve(reference).status,ArtifactReferenceStatus.EXACT);
});

test('transport matrix classifies browser-native and external-only candidates without installing them',()=>{
  const matrix=transportCandidateMatrix();
  assert.equal(matrix.find(x=>x.transport==='IN_PROCESS_ARTIFACT_REFERENCE').classification,'BROWSER_NATIVE');
  assert.equal(matrix.find(x=>x.transport==='LOCAL_SOCKET').classification,'NODE_SIDECAR_ONLY');
  assert.equal(matrix.find(x=>x.transport==='ZEROMQ').classification,'LOCAL_SERVICE');
  assert.equal(matrix.find(x=>x.transport==='ARROW_IPC_RECORDBATCH').adopted,false);
});

// #46 / #180 provider readiness

function providerTask(){ return task({taskId:'historian',taskType:'HISTORIAN_RETRIEVAL',capabilities:['RETRIEVAL','LONG_CONTEXT'],capabilityRequests:[{id:'RETRIEVAL',minVersion:1,preferredVersion:1},{id:'LONG_CONTEXT',minVersion:1,preferredVersion:1}]}); }
function historianInput(){ return {intent:'CURRENT',candidates:[{ref:'E1',summary:'Mara is at the tavern.',semanticKey:'mara:location',temporalStatus:'CURRENT',authority:'SOURCE_CANON'}],maxRefs:1}; }
function historianText(){ return JSON.stringify({refs:['E1'],relevance:[{ref:'E1',score:1}],uncertainty:'LOW',reasoningSummary:'matched'}); }
function providerFixture({aHandler=null,bHandler=null}={}){
  const profiles=new CapabilityProfileRegistry();
  profiles.register({profileId:'a',workerId:'slot-a',providerId:'A',capabilities:['RETRIEVAL','LONG_CONTEXT'],latencyClass:'LOW'});
  profiles.register({profileId:'b',workerId:'slot-b',providerId:'B',capabilities:['RETRIEVAL','LONG_CONTEXT'],latencyClass:'LOW'});
  const adapters=new ProviderAdapterRegistry();
  adapters.register(new DeterministicProviderAdapter({providerId:'A',handler:aHandler??(()=>({text:historianText(),latencyMs:1}))}));
  adapters.register(new DeterministicProviderAdapter({providerId:'B',handler:bHandler??(()=>({text:historianText(),latencyMs:1}))}));
  return {profiles,adapters,layer:new SpecialistExecutionLayer({profiles,adapters})};
}

test('Runtime-selected interchangeable provider profiles preserve normalized task semantics and authority',async()=>{
  const {layer}=providerFixture(); const t=providerTask(); const input=historianInput();
  const a=await layer.execute(t,{input,profileId:'a'}); const b=await layer.execute(t,{input,profileId:'b'});
  assert.deepEqual(a.payload,b.payload); assert.equal(a.authorityClass,'UNRESOLVED'); assert.equal(b.authorityClass,'UNRESOLVED');
  assert.notEqual(a.providerId,b.providerId); assert.deepEqual(Object.keys(a.payload),Object.keys(b.payload));
});

test('provider qualification harness performs bounded A failure then B fallback',async()=>{
  const failing=()=>{throw new ProviderInvocationError(FailureCode.PROVIDER_UNAVAILABLE,'forced outage',{providerId:'A'});};
  const {profiles,layer}=providerFixture({aHandler:failing});
  const report=await runProviderQualification({registry:profiles,executionLayer:layer,task:providerTask(),input:historianInput(),maxProviders:2});
  assert.equal(report.status,'FALLBACK'); assert.equal(report.attempts.length,2); assert.equal(report.attempts[0].failureCode,FailureCode.PROVIDER_UNAVAILABLE);
  assert.equal(report.result.providerId,'B'); assert.equal(report.result.authorityClass,'UNRESOLVED');
});

test('malformed provider output remains typed failure across Runtime-selected execution',async()=>{
  const {layer}=providerFixture({aHandler:()=>({text:'not-json'})});
  await assert.rejects(()=>layer.execute(providerTask(),{input:historianInput(),profileId:'a'}),error=>error.code===FailureCode.MALFORMED_OUTPUT);
});

test('OpenAI-compatible adapter cancellation remains typed PROVIDER_ABORTED',async()=>{
  const fake=async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
  const adapter=new OpenAICompatibleProviderAdapter({providerId:'cancel',modelId:'m',endpoint:'https://example.invalid/v1',fetchImpl:fake,timeoutMs:1000});
  const controller=new AbortController(); const pending=adapter.invoke({taskType:'X'},{messages:[{role:'user',content:'x'}]},{signal:controller.signal}); controller.abort();
  await assert.rejects(()=>pending,error=>error.code===FailureCode.PROVIDER_ABORTED);
});

test('OpenAI-compatible provider request has no native function-call dependency',async()=>{
  let body=null; const fake=async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{}}),{status:200,headers:{'content-type':'application/json'}});};
  const adapter=new OpenAICompatibleProviderAdapter({providerId:'plain',modelId:'m',endpoint:'https://example.invalid/v1',fetchImpl:fake});
  await adapter.invoke({taskType:'X'},{messages:[{role:'user',content:'x'}]});
  assert.equal('tools' in body,false); assert.equal('functions' in body,false); assert.equal('function_call' in body,false);
});

// #42 / #87

test('intent-opposite precision corpus has a measured deterministic baseline',async()=>{
  const report=await runPrecisionBenchmark({adapter:new DeterministicPrecisionAdapter()});
  assert.equal(report.cases,7); assert.equal(report.correct,7); assert.equal(report.intentOppositeAccuracy,1); assert.ok(report.latencyMs>=0);
});

test('integration benchmark marks measured, not-measured and not-applicable metrics explicitly',()=>{
  const referenceBenchmark=benchmarkReferenceTransfer({payload:artifact(),reference:artifactReferenceFromEnvelope(artifact()),iterations:2});
  const summary=summarizeCoprocessorIntegrationBenchmarks({traces:[],artifactBenchmarks:[referenceBenchmark],telemetryEvents:[],zeroWorkerChecks:[true],providerInterchangeChecks:[true]});
  assert.equal(summary.metrics.fanOutCount.status,MeasurementStatus.MEASURED); assert.equal(summary.metrics.artifactReferenceSavingsBytes.status,MeasurementStatus.MEASURED);
  assert.equal(summary.metrics.cpuMs.status,MeasurementStatus.NOT_MEASURED); assert.equal(summary.metrics.batchThroughput.status,MeasurementStatus.NOT_MEASURED);
});

test('all new integration-visible Sidecar modules remain browser-safe',async()=>{
  for(const rel of [
    '../src/coprocessor/capability-negotiation.js','../src/coprocessor/runtime-event-adapter.js','../src/coprocessor/artifact-reference.js',
    '../src/coprocessor/cognitive-data-plane.js','../src/coprocessor/runtime-benchmark.js','../src/coprocessor/precision-benchmark.js',
    '../src/coprocessor/provider-qualification.js','../src/coprocessor/runtime-compatibility.js','../src/coprocessor/provider-execution.js',
  ]){
    const source=await readFile(new URL(rel,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\bBuffer\b/); assert.doesNotMatch(source,/from\s+['"]node:/); assert.doesNotMatch(source,/\brequire\s*\(/);
    assert.doesNotMatch(source,/\bprocess\./); assert.doesNotMatch(source,/from\s+['"](?:fs|node:fs)/);
  }
});
