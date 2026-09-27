import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentDeploymentBrain } from '../src/deployment/brain.js';
import { extractDevelopmentDeploymentScene } from '../src/deployment/sillytavern-live.js';
import { Area52NativeBrain } from '../src/native-brain.js';
import { HostActivity, ObservationClass, SceneEventType } from '../src/scene/index.js';

const hostEvent=(activity,id,content,extra={})=>({
  activity,
  chatId:extra.chatId??'scene-atmosphere',
  hostEventId:extra.hostEventId??`atmosphere:${id}:${activity}:r${extra.messageRevision??1}`,
  messageId:extra.messageId??id,
  messageRevision:extra.messageRevision??1,
  turnId:extra.turnId??`turn:${id}`,
  content,
  role:extra.role??(activity===HostActivity.ASSISTANT_GENERATION_COMPLETE?'assistant':'user'),
  ...extra,
});

const ingest=(brain,input)=>brain.ingestSceneHostEvent(input,{
  extract:(e,scene)=>extractDevelopmentDeploymentScene(e.content,{
    revision:scene.revision+1,
    evidenceRef:e.sourceRevisionId,
    currentScene:scene,
    sceneRuntime:brain.scene,
  }),
});

function nativeSignal(signal,{sceneId=signal.sceneId,sceneRevision=signal.sceneRevision}={}){
  const out=structuredClone(signal);
  out.sceneId=sceneId;out.sceneRevision=sceneRevision;
  out.sourceRevisionRefs=[];out.sourceRevisionSet=[];out.provenance=[];
  return out;
}

test('installed narrative evidence updates bounded inferred atmosphere with per-dimension confidence and evidence',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const receipt=ingest(brain,hostEvent(
    HostActivity.USER_SEND,
    'atmosphere-1',
    'At Ember Hall, the room is tense and dangerous; the exchange turns hostile and urgent.',
  ));
  assert.equal(receipt.status,'OBSERVED');
  assert.ok(receipt.changedFields.includes('atmosphere'));
  assert.ok(receipt.eventTypes.includes(SceneEventType.VIBE_CHANGED));
  const field=receipt.signal.atmosphere;
  assert.equal(field.observationClass,ObservationClass.INFERRED);
  assert.equal(field.metadata.sceneScoped,true);
  assert.equal(field.metadata.canonical,false);
  assert.equal(field.metadata.proseStyleAuthority,false);
  assert.equal(field.metadata.factCreationAuthority,false);
  for(const name of ['tension','danger','urgency','hostility']){
    assert.ok(field.value[name],name);
    assert.ok(field.value[name].confidence>0);
    assert.ok(field.value[name].evidenceRefs.includes(receipt.evidence.sourceRevisionId));
  }
  assert.equal(receipt.signal.atmosphereContribution.status,'AVAILABLE');
  assert.deepEqual(
    Object.keys(receipt.signal.atmosphereContribution.dimensions).sort(),
    ['danger','hostility','tension','urgency'].sort(),
  );
  assert.equal(receipt.signal.atmosphereContribution.promptStyleInstruction,null);
  assert.equal(receipt.signal.atmosphereContribution.settlementAuthority,false);
});

test('installed extractor supports the full #107 atmosphere matrix from explicit narrative cues',()=>{
  const parsed=extractDevelopmentDeploymentScene(
    'The scene is tense, dangerous, intimate, urgent, uncertain, humorous, full of grief, and openly hostile.',
    {revision:2,evidenceRef:'narrative:matrix:1'},
  );
  assert.deepEqual(
    Object.keys(parsed.fields.atmosphere.value).sort(),
    ['tension','danger','intimacy','urgency','uncertainty','humor','grief','hostility'].sort(),
  );
  for(const row of Object.values(parsed.fields.atmosphere.value)){
    assert.ok(row.confidence>0);
    assert.deepEqual(row.evidenceRefs,['narrative:matrix:1']);
  }
});

test('quiet continuation and generated atmosphere wording do not amplify or refresh the same atmosphere',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const first=ingest(brain,hostEvent(HostActivity.USER_SEND,'quiet-1','At Ember Hall, the room is tense.'));
  const before=structuredClone(first.signal.atmosphere);

  const quiet=ingest(brain,hostEvent(HostActivity.USER_SEND,'quiet-2','Mara looks toward the window.',{chatId:first.chatId}));
  assert.equal(quiet.signal.atmosphere.revision,before.revision);
  assert.deepEqual(quiet.signal.atmosphere.evidenceRefs,before.evidenceRefs);
  assert.equal(quiet.signal.atmosphere.value.tension.score,before.value.tension.score);

  const generated=ingest(brain,hostEvent(
    HostActivity.ASSISTANT_GENERATION_COMPLETE,
    'quiet-3',
    'The tense silence lingers.',
    {chatId:first.chatId,role:'assistant'},
  ));
  assert.equal(generated.signal.atmosphere.revision,before.revision);
  assert.deepEqual(generated.signal.atmosphere.evidenceRefs,before.evidenceRefs);
  assert.equal(generated.signal.atmosphere.value.tension.score,before.value.tension.score);
  assert.equal(generated.signal.atmosphereContribution.status,'AVAILABLE');

  const generatedWithUnrelatedSceneField=ingest(brain,hostEvent(
    HostActivity.ASSISTANT_GENERATION_COMPLETE,
    'quiet-4',
    'At Ember Hall, the tense silence still lingers.',
    {chatId:first.chatId,role:'assistant'},
  ));
  assert.equal(generatedWithUnrelatedSceneField.signal.atmosphere.revision,before.revision);
  assert.deepEqual(generatedWithUnrelatedSceneField.signal.atmosphere.evidenceRefs,before.evidenceRefs);

  const eventful=ingest(brain,hostEvent(
    HostActivity.ASSISTANT_GENERATION_COMPLETE,
    'quiet-5',
    'Eris suddenly attacks Mara and snarls at her.',
    {chatId:first.chatId,role:'assistant'},
  ));
  assert.ok(eventful.changedFields.includes('atmosphere'));
  assert.ok(eventful.signal.atmosphere.metadata.novelNarrativeEvidenceRefs.includes(eventful.evidence.sourceRevisionId));
  assert.equal(eventful.signal.atmosphereContribution.status,'AVAILABLE');
});

test('source correction invalidates prior atmosphere and expiry removes it from later retrieval priority',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const first=ingest(brain,hostEvent(HostActivity.USER_SEND,'correct-atmosphere','At Ember Hall, the room is tense.'));
  const oldSource=first.evidence.sourceRevisionId;
  const corrected=ingest(brain,hostEvent(
    HostActivity.EDIT,
    'correct-atmosphere',
    'At Ember Hall, Mara waits quietly.',
    {chatId:first.chatId,messageId:'correct-atmosphere',messageRevision:2},
  ));
  assert.equal(corrected.signal.atmosphere.observationClass,ObservationClass.UNRESOLVED);
  assert.equal(corrected.signal.atmosphereContribution.status,'UNAVAILABLE');
  assert.ok(corrected.signal.atmosphere.metadata.previousEvidenceRefs.includes(oldSource));

  const expiringBrain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const seeded=ingest(expiringBrain,hostEvent(HostActivity.USER_SEND,'expiry-1','At Room One, the room is dangerous.',{chatId:'scene-atmosphere-expiry'}));
  let latest=seeded;
  for(const [index,location] of ['Room Two','Room Three','Room Four'].entries()){
    latest=ingest(expiringBrain,hostEvent(HostActivity.USER_SEND,`expiry-${index+2}`,`At ${location}, Mara waits quietly.`,{chatId:seeded.chatId}));
  }
  assert.ok(latest.signal.sceneRevision>seeded.signal.atmosphere.metadata.expiresAfterRevision);
  assert.equal(latest.signal.atmosphereContribution.status,'EXPIRED');
  assert.deepEqual(latest.signal.atmosphereContribution.dimensions,{});
});

test('fresh bounded atmosphere can nominate threat retrieval while unavailable atmosphere leaves cognition functional',async()=>{
  const deployment=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const fresh=ingest(deployment,hostEvent(HostActivity.USER_SEND,'retrieval-1','At Ember Hall, danger and tension rise.'));
  const nativeFresh=new Area52NativeBrain();
  const preparedFresh=await nativeFresh.prepareTurn({
    chatId:'native-atmosphere-fresh',
    turnId:'native-atmosphere-fresh:1',
    generationId:'native-atmosphere-fresh:g1',
    query:'What should Mara watch for?',
    sceneSignal:nativeSignal(fresh.signal,{sceneId:'native-atmosphere-fresh-scene'}),
    budgetTokens:4096,
    latencyBudgetMs:1000,
    executionLabel:'DETERMINISTIC',
  });
  assert.ok(preparedFresh.retrievalIntents.some((row)=>row.metadata?.sceneIntentKind==='THREAT_CONTEXT'));
  assert.ok(preparedFresh.retrievalIntents.some((row)=>row.metadata?.atmosphereContributionStatus==='AVAILABLE'));

  const neutralDeployment=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const neutral=ingest(neutralDeployment,hostEvent(HostActivity.USER_SEND,'retrieval-2','At Quiet Library, Mara reads.'));
  assert.equal(neutral.signal.atmosphereContribution.status,'UNAVAILABLE');
  const nativeNeutral=new Area52NativeBrain();
  const preparedNeutral=await nativeNeutral.prepareTurn({
    chatId:'native-atmosphere-neutral',
    turnId:'native-atmosphere-neutral:1',
    generationId:'native-atmosphere-neutral:g1',
    query:'What is nearby?',
    sceneSignal:nativeSignal(neutral.signal,{sceneId:'native-atmosphere-neutral-scene'}),
    budgetTokens:4096,
    latencyBudgetMs:1000,
    executionLabel:'DETERMINISTIC',
  });
  assert.ok(preparedNeutral.retrievalIntents.length>0);
  assert.equal(preparedNeutral.retrievalIntents.some((row)=>row.metadata?.sceneIntentKind==='THREAT_CONTEXT'),false);
});
