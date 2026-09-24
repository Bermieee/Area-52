import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ArtifactReferenceStatus, CapabilityProfileRegistry, Placement, ResultClass, TurnEventHub,
  artifactReferenceFromEnvelope, benchmarkReferenceTransfer, createCognitiveTask, createRevisionSet, createTurnEnvelope,
  consumeRuntimeTurnEvent, negotiateCapabilities, resolveArtifactReference, toFrameworkTurnEventEnvelope, toRuntimeObligation,
} from '../src/coprocessor/index.js';

function makeTask(index,{fallback=false,deep=false}={}){
  const cap=`CAP_${index%8}`; const alt=`ALT_${index%4}`;
  return createCognitiveTask({taskId:`stress:${index}`,taskType:'STRESS',turnId:`turn:${index}`,correlationId:`corr:${index}`,
    requiredCapabilities:[cap],capabilityRequests:[{id:cap,minVersion:index%5===0?2:1,preferredVersion:2}],
    fallbackCapabilitySets:fallback?[[{id:alt,minVersion:1,preferredVersion:1}]]:[],cognitiveLayer:deep?'L3':'L1',
    resultClass:deep?ResultClass.DEFERRED:ResultClass.REQUIRED,placement:deep?Placement.DEEP:Placement.HOT,
    softDeadline:40,hardDeadline:70,compilerLane:'externalGrounding',intentFingerprint:`intent:${index}`,
    batchMetadata:deep?{batchable:true,slicePolicy:'ADAPTIVE',checkpointBoundary:'SLICE',yieldSafety:'CHECKPOINT_ONLY',partialResultSemantics:'PRESERVE_VALID_SLICES'}:{batchable:false},
    inputRevisionSet:createRevisionSet({sourceRevisionSet:[`source:${index}`],worldRevision:index,sceneRevision:index,characterStateRevision:index})});
}

function registryFixture(){
  const registry=new CapabilityProfileRegistry();
  for(let i=0;i<8;i++)registry.register({profileId:`p${i}`,workerId:`slot${i}`,providerId:`provider${i}`,capabilities:[`CAP_${i}`,`ALT_${i%4}`],
    capabilityVersions:{[`CAP_${i}`]:i%2?1:2,[`ALT_${i%4}`]:1},latencyClass:i%3===0?'MEDIUM':'LOW',costClass:i%4===0?'MEDIUM':'LOW',
    concurrencyCapacity:2,placements:[Placement.HOT,Placement.DEEP],supportedLayers:['L1','L3'],foregroundEligible:true,backgroundEligible:true});
  return registry;
}

test('Wave 2 integration stress: 2,500 capability negotiations remain bounded under health/load/version/fallback churn',()=>{
  const registry=registryFixture(); let eligible=0,degraded=0,empty=0;
  for(let i=0;i<2500;i++){
    const profileId=`p${i%8}`;
    registry.setHealth(profileId,i%19===0?'unhealthy':'healthy');
    registry.setLoad(profileId,i%23===0?2:0);
    const task=makeTask(i,{fallback:i%7===0,deep:i%11===0});
    const result=negotiateCapabilities(registry,task,{maxCostClass:'MEDIUM',maxLatencyClass:'MEDIUM',contextTokens:128,expectedOutputTokens:64});
    assert.equal(result.schedulingDecision,null); assert.equal(result.authorityGranted,false); assert.ok(result.eligibleImplementations.length<=8);
    eligible+=result.eligibleImplementations.length; if(result.degraded)degraded++; if(result.eligibleImplementations.length===0)empty++;
  }
  assert.ok(eligible>0); assert.ok(empty>0);
  console.log(JSON.stringify({stress:'capability-negotiation',iterations:2500,eligibleNominations:eligible,degraded,empty}));
});

test('Wave 2 integration stress: 1,200 exact/stale/superseded artifact-reference operations never substitute latest revision',()=>{
  const rows=[];
  for(let i=0;i<400;i++){
    const env={kind:'ArtifactEnvelope',artifactId:`a:${i}`,artifactType:'Claim',schemaVersion:'1.0.0',owner:'CORE',authority:'UNRESOLVED',
      provenance:{sourceRevisionSet:[`s:${i}`],worldRevision:i,sceneRevision:i},revision:4,dependencies:[],invalidators:[],status:'VALID',payload:{id:i,blob:'x'.repeat(4000)}};
    rows.push({domain:'artifacts',id:env.artifactId,revision:4,value:env});
  }
  const repository={get(domain,id,{revision=null}={}){const matches=rows.filter(r=>r.domain===domain&&r.id===id);const row=revision==null?matches.at(-1):matches.find(r=>r.revision===revision);return row?structuredClone(row):null;}};
  let exact=0,stale=0,missing=0;
  for(let i=0;i<1200;i++){
    const id=i%400; const env=rows[id].value; const ref=artifactReferenceFromEnvelope(env,{sourceRevisionSet:[`s:${id}`],worldRevision:id,sceneRevision:id,sliceSelector:['payload','id']});
    const current=i%3===1?{sourceRevisionSet:[`s:${id}`],worldRevision:id,sceneRevision:id+1}:{sourceRevisionSet:[`s:${id}`],worldRevision:id,sceneRevision:id};
    const resolved=resolveArtifactReference(ref,{repository,currentRevisionSet:current});
    if(resolved.status===ArtifactReferenceStatus.EXACT){exact++;assert.equal(resolved.material,id);} else if(resolved.status===ArtifactReferenceStatus.STALE) stale++; else missing++;
  }
  assert.equal(exact,800); assert.equal(stale,400); assert.equal(missing,0);
  const bench=benchmarkReferenceTransfer({payload:rows[0].value,reference:artifactReferenceFromEnvelope(rows[0].value),iterations:3});assert.ok(bench.serializedBytes.value.saved>3000);
  console.log(JSON.stringify({stress:'artifact-reference',operations:1200,exact,stale,missing,bytesSaved:bench.serializedBytes.value.saved}));
});

test('Wave 2 integration stress: 1,500 duplicate TURN_EVENT deliveries and mixed HOT/DEEP obligations remain idempotent and authority-free',()=>{
  const hub=new TurnEventHub({limit:2000}); let duplicates=0,hot=0,deep=0;
  for(let i=0;i<1500;i++){
    const turn=createTurnEnvelope({turnId:`evt:${i}`,eventId:`event:${i}`,correlationId:`corr:${i}`,dedupeKey:`dedupe:${i}`,sourceRevisionSet:[`s:${i}`],worldRevision:i,sceneRevision:i,characterStateRevision:i,deliveryAttempt:1});
    const envelope=toFrameworkTurnEventEnvelope(turn); consumeRuntimeTurnEvent(envelope,{eventHub:hub});
    if(consumeRuntimeTurnEvent({...envelope,payload:{...envelope.payload,deliveryAttempt:2}},{eventHub:hub}).duplicate)duplicates++;
    const obligation=toRuntimeObligation(makeTask(i,{deep:i%2===1}));
    assert.equal(obligation.schedulingDecision,null); assert.equal(obligation.authorityGranted,false); assert.equal(obligation.resultContract.contextSealBypass,false);
    if(obligation.runtimeClass==='HOT')hot++;else deep++;
  }
  assert.equal(duplicates,1500); assert.equal(hub.list().length,1500); assert.equal(hot,750); assert.equal(deep,750);
  console.log(JSON.stringify({stress:'event-obligation',turns:1500,duplicateDeliveries:duplicates,hot,deep}));
});
