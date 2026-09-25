import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyDevelopmentDeploymentTurn,
  createDevelopmentDeploymentSillyTavernSession,
  extractDevelopmentDeploymentScene,
} from '../src/deployment/sillytavern-live.js';

function makeHost() {
  const listeners = new Map();
  const promptCalls = [];
  const context = {
    chatId: 'chat:observatory',
    chat: [],
    eventTypes: { GENERATION_AFTER_COMMANDS: 'generation_after_commands', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED:'message_edited', MESSAGE_DELETED:'message_deleted', MESSAGE_UPDATED:'message_updated', MESSAGE_SWIPED:'message_swiped', MESSAGE_SWIPE_DELETED:'message_swipe_deleted', CHAT_CHANGED:'chat_id_changed', CHAT_LOADED:'chatLoaded', CHAT_CREATED:'chat_created', CHAT_RENAMED:'chat_renamed', WORLDINFO_UPDATED:'worldinfo_updated', WORLDINFO_SETTINGS_UPDATED:'worldinfo_settings_updated', GENERATION_STARTED:'generation_started', GENERATION_ENDED:'generation_ended', GENERATION_STOPPED: 'generation_stopped' },
    eventSource: {
      on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeListener(type, fn) { listeners.get(type)?.delete(fn); },
    },
    async setExtensionPrompt(...args) { promptCalls.push(args); },
  };
  return { sillyTavern: { getContext: () => context }, context, promptCalls, listeners };
}

function operatorLore() {
  return {
    id: 'operator-unrelated-worlds',
    title: 'Operator Unrelated Worlds',
    discovery: { kind: 'DeploymentLiveFixture', stableId: 'operator-unrelated-worlds', exactAuthoredSource: true },
    entries: [
      { uid: 'observatory', content: 'The Moonlit Observatory is maintained by Ilya.', metadata: { title: 'Moonlit Observatory', at: 1, treePath: ['Places', 'Observatory'] } },
      { uid: 'compass-a', content: 'The Glass Compass was stored inside the Moonlit Observatory.', metadata: { title: 'Glass Compass Storage', at: 2, treePath: ['Objects', 'Glass Compass'] } },
      { uid: 'compass-b', content: 'A damaged log claims the Glass Compass was shattered during the storm.', metadata: { title: 'Glass Compass Report A', at: 3, treePath: ['Reports', 'Compass'] } },
      { uid: 'harbor', content: 'The Harbor Archive keeps navigation records for Tidewatch.', metadata: { title: 'Harbor Archive', at: 4, treePath: ['Places', 'Harbor'] } },
      { uid: 'ledger-a', content: 'The Tide Ledger was sealed in the Harbor Archive.', metadata: { title: 'Tide Ledger Report A', at: 5, treePath: ['Objects', 'Tide Ledger'] } },
      { uid: 'ledger-b', content: 'A witness report claims the Tide Ledger was removed before the flood.', metadata: { title: 'Tide Ledger Report B', at: 6, treePath: ['Reports', 'Ledger'] } },
    ],
  };
}

function pushUser(context, mes) {
  context.chat.push({ is_user: true, mes, send_date: Date.now() });
}

function pushAssistant(context, mes) {
  context.chat.push({ is_user: false, mes, send_date: Date.now() });
  return context.chat.length - 1;
}

function fakeNativeBrain(){
  const calls={prepare:[],complete:[],subscriptions:0};
  const listeners=new Set();
  return{
    calls,
    async prepareTurn(input){
      calls.prepare.push(structuredClone(input));
      const selection={chatId:input.chatId,turnId:input.turnId,generationId:input.generationId,correlationId:'corr:'+input.turnId,worldRevision:9,sceneRevision:input.sceneSignal?.sceneRevision??1,sourceRevisionRefs:[...(input.sceneSignal?.sourceRevisionRefs??[])]};
      const prepared={
        kind:'NativeBrainPreparedTurn',selection,
        promptPlan:{promptPlanId:'native-plan:'+input.turnId,generationId:input.generationId,contextSealId:'native-seal:'+input.turnId,sections:[
          {slot:'CURRENT_WORLD_STATE',representation:'RICH',text:'The sealed owner state says the harbor lantern is lit.'},
          {slot:'USER_INPUT',representation:'RICH',text:input.query},
        ]},
        contextSealReceipt:{id:'native-seal:'+input.turnId,sealedState:true},
        rendered:{kind:'RenderedModelInput',format:'messages',messages:[
          {role:'system',content:'[CURRENT_WORLD_STATE]\nThe sealed owner state says the harbor lantern is lit.'},
          {role:'user',content:'[USER_INPUT]\n'+input.query},
        ]},
      };
      for(const fn of listeners)fn({kind:'NativeBrainReceiptUpdate',stage:'TURN_PREPARED',selection,rawPromptIncluded:false,rawResponseIncluded:false});
      return prepared;
    },
    async completeTurn(input){
      calls.complete.push(structuredClone(input));
      const receipt={kind:'NativeBrainLearningReceipt',turnId:input.turnId,sourceRevisionId:'narrative:'+input.turnId+'@r1',rawExperienceRecoverable:true,settlements:[]};
      for(const fn of listeners)fn({kind:'NativeBrainReceiptUpdate',stage:'TURN_LEARNED',selection:{turnId:input.turnId},rawPromptIncluded:false,rawResponseIncluded:false});
      return receipt;
    },
    async runTurn(input,{generate,completeOptions={}}={}){
      const prepared=await this.prepareTurn(input);
      const response=await generate(prepared.rendered,{selection:prepared.selection,promptPlan:prepared.promptPlan,contextSealReceipt:prepared.contextSealReceipt});
      const learning=await this.completeTurn({turnId:input.turnId,response,...completeOptions});
      return{prepared,response,learning};
    },
    snapshot(){return{kind:'FakeNativeBrainSnapshot',turns:calls.complete.length};},
    uiBindings(){
      const empty=()=>null;
      return{
        subscribe(fn){listeners.add(fn);calls.subscriptions+=1;return()=>listeners.delete(fn);},
        readSelection:()=>({}),readScene:empty,readHotCognition:empty,readCognitiveChoice:empty,readScatter:empty,readSensoryTrace:empty,readCandidateBusEnvelope:empty,readCandidateFusionReceipt:empty,
        readIdentityResolution:empty,readGraphTraversal:empty,readRetrievalBudget:empty,readRejectedEvidence:empty,readTruth:empty,readCorrectiveRetrieval:empty,readJev:empty,readPrecision:empty,readGather:empty,readContextSeal:empty,
        readLoreStatus:empty,readMemoryStatus:empty,readRuntimeStatus:()=>({lifecycle:[],queueDepth:{},resources:{},workers:{},dependencies:{},eventTypes:[],telemetry:{retainedSignals:0,sinkFailures:0,latestSequence:0}}),
        readPromptPlan:empty,readContextReceipt:empty,listGenerations:()=>[],readGeneration:empty,
      };
    },
  };
}

test('live adapter source contains no Ember fixture names or fixed-scenario rejection', () => {
  const source = readFileSync(new URL('../src/deployment/sillytavern-live.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Ember Tavern|Sun Blade|\bMara\b|\bEris\b/);
  assert.doesNotMatch(source, /first live demo turn must/i);
});

test('classifier and scene extraction are story-independent', () => {
  assert.equal(classifyDevelopmentDeploymentTurn('Where are we?'), 'simple');
  assert.equal(classifyDevelopmentDeploymentTurn('Tell me about the Glass Compass history.'), 'retrieval');
  assert.equal(classifyDevelopmentDeploymentTurn('The reports conflict. Which account is current?'), 'ambiguous');

  const parsed = extractDevelopmentDeploymentScene(
    'At Moonlit Observatory, the storm shutters are closed.',
    { revision: 2, evidenceRef: 'source:host@1' },
  );
  assert.equal(parsed.explicit, true);
  assert.equal(parsed.fields.location.value.location, 'Moonlit Observatory');
  assert.equal(parsed.extractionPolicy, 'GENERIC_HOST_EVIDENCE_ONLY');

  const unknown = extractDevelopmentDeploymentScene(
    'I examine the sealed letter without saying where I am.',
    { revision: 1, evidenceRef: 'source:host@2' },
  );
  assert.equal(unknown.explicit, false);
  assert.deepEqual(unknown.fields, {});
});

test('first ordinary turn initializes a Scene without inventing a location', async () => {
  const { sillyTavern, context } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({ sillyTavern, document: null, mountUi: false });
  pushUser(context, 'I examine the sealed letter on the desk. Where are we?');
  const row = await session.processCurrentTurn();
  assert.equal(row.mode, 'simple');
  assert.equal(row.scene.initializedFromHostMessage, true);
  assert.equal(row.scene.observedFromHostMessage, false);
  assert.equal(row.scene.reason, 'SCENE_INITIALIZED_WITH_UNKNOWN_FIELDS');
  assert.ok(row.scene.sceneId);
  assert.equal(row.delivery.ok, true);
  assert.equal(row.delivery.promptInjection.succeeded, true);
  session.destroy();
});

test('armed session processes MESSAGE_SENT and records operator-visible failures', async () => {
  const { sillyTavern, context, listeners } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({ sillyTavern, document: null, mountUi: false });
  session.start();
  assert.equal(listeners.get('message_sent')?.size, 1);
  assert.equal(listeners.get('generation_after_commands')?.size ?? 0, 0);
  pushUser(context, 'At Moonlit Observatory, where are we?');
  await Promise.all([...listeners.get('message_sent')].map(fn => fn()));
  const evidence = session.exportEvidence();
  assert.equal(evidence.checks.anyReadyTurn, true);
  assert.equal(evidence.checks.twoUnrelatedStories, false);
  assert.equal(evidence.modeCoverage.simple, true);
  context.chatId = null;
  await assert.rejects(session.processCurrentTurn(), /chatId is unavailable/);
  assert.match(session.exportEvidence().errors.at(-1).message, /chatId is unavailable/);
  session.destroy();
});

test('native Brain host lifecycle seals before model request and learns completed assistant response',async()=>{
  const {sillyTavern,context,promptCalls,listeners}=makeHost(),nativeBrain=fakeNativeBrain(),persisted=[];
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain,persistNativeBrain:async row=>persisted.push({chatId:row.chatId,kind:row.snapshot.kind})});
  session.start();
  assert.equal(listeners.get('generation_after_commands')?.size,1);assert.equal(listeners.get('chat_completion_prompt_ready')?.size,1);assert.equal(listeners.get('message_received')?.size,1);assert.equal(listeners.get('message_sent')?.size??0,0);
  pushUser(context,'At Moonlit Observatory, tell me what the lantern shows.');
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));
  assert.equal(nativeBrain.calls.prepare.length,1);assert.equal(promptCalls.length,0);
  const actualRequest={chat:[{role:'system',content:'SillyTavern host policy'},{role:'user',content:'At Moonlit Observatory, tell me what the lantern shows.'}],dryRun:false};
  await Promise.all([...listeners.get('chat_completion_prompt_ready')].map(fn=>fn(actualRequest)));
  assert.deepEqual(actualRequest.chat.slice(1,3),[
    {role:'system',content:'[CURRENT_WORLD_STATE]\nThe sealed owner state says the harbor lantern is lit.'},
    {role:'user',content:'[USER_INPUT]\nAt Moonlit Observatory, tell me what the lantern shows.'},
  ]);
  assert.equal(session.exportEvidence().nativeBrainIntegration.exactPreparedRenderedObserved,true);
  assert.equal(session.exportEvidence().nativeBrainIntegration.pendingCount,1);
  const assistantIndex=pushAssistant(context,'The lantern throws a steady blue light across the observatory floor.');
  await Promise.all([...listeners.get('message_received')].map(fn=>fn(assistantIndex)));
  assert.equal(nativeBrain.calls.complete.length,1);assert.match(nativeBrain.calls.complete[0].response,/steady blue light/);
  const evidence=session.exportEvidence();
  assert.equal(evidence.nativeBrainIntegration.endToEndObserved,true);
  assert.equal(evidence.nativeBrainIntegration.pendingCount,0);
  assert.equal(evidence.nativeBrainIntegration.persistence.persistedCount,1);assert.deepEqual(persisted,[{chatId:'chat:observatory',kind:'FakeNativeBrainSnapshot'}]);
  assert.equal(evidence.nativeBrainIntegration.rawPromptCaptured,false);assert.equal(evidence.nativeBrainIntegration.rawResponseCaptured,false);
  assert.doesNotMatch(JSON.stringify(evidence.nativeBrainIntegration),/steady blue light|tell me what the lantern shows/i);
  session.destroy();
});

test('installed native host exposes provenance/runtime/memory readers through the UI binding seam',()=>{
  const {sillyTavern}=makeHost(),nativeBrain=fakeNativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});
  const native=session.exportEvidence().nativeBrainIntegration,names=native.installedUiReaderNames;
  for(const name of ['readIdentityResolution','readGraphTraversal','readRetrievalBudget','readRejectedEvidence','readLoreStatus','readMemoryStatus','readRuntimeStatus','readGeneration'])assert.ok(names.includes(name),name);
  assert.equal(names.includes('listResources'),false);assert.deepEqual(native.installedOptionalOwners,{resources:false,loreStudy:false,loreAuthoring:false,memory:false});
  session.destroy();
});

test('live narrative feed journals revision events without raw text and invalidates a pending native generation',async()=>{
  const {sillyTavern,context,listeners}=makeHost(),nativeBrain=fakeNativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});session.start();
  pushUser(context,'I inspect the sealed compass.');
  await [...listeners.get('generation_after_commands')][0]('normal',{},false);
  assert.equal(session.exportEvidence().nativeBrainIntegration.pendingCount,1);
  await [...listeners.get('message_edited')][0](0);
  await Promise.resolve();
  const evidence=session.exportEvidence();
  assert.equal(evidence.nativeBrainIntegration.pendingCount,0);assert.ok(evidence.nativeBrainIntegration.rejections.some(row=>row.code==='HOST_MESSAGE_EDITED_INVALIDATED_PENDING_GENERATION'));
  const event=evidence.hostNarrativeFeed.events.find(row=>row.type==='MESSAGE_EDITED');assert.ok(event);assert.equal(event.messageIndex,0);assert.equal(event.revisionAffecting,true);assert.equal(event.rawTextIncluded,false);assert.equal(event.rawPayloadIncluded,false);
  assert.equal(event.chatId,'chat:observatory');assert.equal(event.messageId,'0');assert.match(event.messageDigest,/^[0-9a-f]{8}$/);assert.match(event.messageRevisionId,/^0:[0-9a-f]{8}$/);assert.match(event.eventId,/^st-host:/);assert.ok(event.turnId);assert.ok(event.generationId);
  assert.equal(evidence.hostNarrativeFeed.rawTextCaptured,false);assert.doesNotMatch(JSON.stringify(evidence.hostNarrativeFeed),/sealed compass/i);
  session.destroy();
});

test('live narrative feed records generation boundaries without retaining host payloads',async()=>{
  const {sillyTavern,context,listeners}=makeHost(),nativeBrain=fakeNativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});session.start();
  pushUser(context,'At Moonlit Observatory, continue.');
  await [...listeners.get('generation_after_commands')][0]('continue',{},false);
  await [...listeners.get('generation_started')][0]({type:'continue',prompt:'must not retain'});
  await [...listeners.get('generation_ended')][0]({raw:'must not retain'});
  const rows=session.exportEvidence().hostNarrativeFeed.events.filter(row=>row.generationBoundary);
  assert.deepEqual(rows.map(row=>row.type),['GENERATION_STARTED','GENERATION_ENDED']);assert.ok(rows.every(row=>row.rawPayloadIncluded===false&&row.rawTextIncluded===false));
  assert.doesNotMatch(JSON.stringify(rows),/must not retain/);session.destroy();
});

test('native Brain completion rejects cross-chat response instead of learning into the wrong story',async()=>{
  const {sillyTavern,context,listeners}=makeHost(),nativeBrain=fakeNativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});session.start();
  pushUser(context,'At Moonlit Observatory, continue.');
  await Promise.all([...listeners.get('generation_after_commands')].map(fn=>fn('normal',{},false)));
  const request={chat:[{role:'user',content:'At Moonlit Observatory, continue.'}],dryRun:false};
  await Promise.all([...listeners.get('chat_completion_prompt_ready')].map(fn=>fn(request)));
  context.chatId='chat:harbor';context.chat=[];const assistantIndex=pushAssistant(context,'A harbor reply appears in another story.');
  await Promise.all([...listeners.get('message_received')].map(fn=>fn(assistantIndex)));
  assert.equal(nativeBrain.calls.complete.length,0);
  const evidence=session.exportEvidence();
  assert.equal(evidence.nativeBrainIntegration.staleOrForeignCompletionRejected,1);assert.equal(evidence.nativeBrainIntegration.pendingCount,1);
  session.destroy();
});

test('operator lore records accepted, processed, and retrievable states separately', () => {
  const { sillyTavern } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({ sillyTavern, document: null, mountUi: false });
  const receipt = session.ingestLorebook(operatorLore());
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.processed, true);
  assert.equal(typeof receipt.retrievable, 'boolean');
  assert.equal(receipt.entryCount, 6);
  assert.equal(session.exportEvidence().loreIngestion.length, 1);
  session.destroy();
});

test('two unrelated chats run Scene -> retrieval/Truth -> optional Jev -> Gather -> Seal -> PromptPlan without fixed names', async () => {
  const { sillyTavern, context, promptCalls } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({
    sillyTavern,
    document: null,
    mountUi: false,
    initialLorebook: operatorLore(),
  });

  pushUser(context, 'At Moonlit Observatory, where are we?');
  const simple = await session.processCurrentTurn();
  assert.equal(simple.mode, 'simple');
  assert.equal(simple.runtime.jobCount, 0);
  assert.equal(simple.delivery.ok, true);

  pushUser(context, 'Tell me about the Glass Compass and the Moonlit Observatory history.');
  const retrieval = await session.processCurrentTurn();
  assert.equal(retrieval.mode, 'retrieval');
  assert.equal(retrieval.runtime.resourceCount, 1);
  assert.ok(retrieval.runtime.jobCount >= 2);
  assert.equal(retrieval.delivery.ok, true);

  context.chatId = 'chat:harbor';
  context.chat = [];
  pushUser(context, 'At Harbor Archive, conflicting reports disagree about the Tide Ledger. Which report is current?');
  const ambiguous = await session.processCurrentTurn();
  assert.equal(ambiguous.mode, 'ambiguous');
  assert.equal(ambiguous.scene.observedFromHostMessage, true);
  assert.ok(ambiguous.scene.changedFields.includes('location'));
  assert.ok(ambiguous.cognition.jev);
  assert.equal(ambiguous.cognition.jev.mutationAuthority, false);
  assert.equal(ambiguous.delivery.ok, true);

  const beforeReview = session.exportEvidence();
  assert.deepEqual(beforeReview.checks, {
    anyReadyTurn: true,
    twoUnrelatedStories: true,
    promptDeliveryObserved: true,
    sealedContextObserved: true,
    genericScenePolicyObserved: true,
  });
  assert.deepEqual(beforeReview.modeCoverage, { simple: true, retrieval: true, ambiguous: true });
  assert.equal(beforeReview.deterministicFixtureEvidence.acceptanceAuthority, false);
  assert.equal(beforeReview.deterministicFixtureEvidence.simulatedJevFailureSafe, true);
  assert.equal(beforeReview.degraded.evidenceClass, 'SIMULATED_FAILURE_PROBE');
  assert.equal(beforeReview.degraded.safe, true);
  assert.equal(beforeReview.twoStoryCoverage, true);
  assert.deepEqual(beforeReview.storyChatIds, ['chat:harbor', 'chat:observatory']);
  assert.equal(beforeReview.providerEvidence.jev, 'DETERMINISTIC_LOCAL_FIXTURE');
  assert.equal(beforeReview.providerEvidence.realProviderCallObserved, false);
  assert.equal(beforeReview.providerEvidence.ft005LivePass, false);
  assert.equal(beforeReview.liveEvidenceComplete, false);
  assert.equal(beforeReview.issue224AutomaticPass, false);
  assert.equal(promptCalls.length, 3);

  const afterReview = session.confirmOperatorReview({
    promptInspectorConfirmed: true,
    uiTraceReviewed: true,
    liveSillyTavernConfirmed: true,
  });
  assert.equal(afterReview.operatorReview.liveSillyTavernConfirmed, true);
  assert.equal(afterReview.liveEvidenceComplete, false);
  assert.equal(afterReview.issue224AutomaticPass, false);
  assert.equal(afterReview.directorApprovalRequired, true);
  session.destroy();
});


test('two unrelated live stories satisfy the live gate without scripted mode coverage', async () => {
  const { sillyTavern, context } = makeHost();
  const session = createDevelopmentDeploymentSillyTavernSession({
    sillyTavern,
    document: null,
    mountUi: false,
    initialLorebook: operatorLore(),
  });

  pushUser(context, 'At Moonlit Observatory, I study the Glass Compass on the central table.');
  const first = await session.processCurrentTurn();
  assert.equal(first.mode, 'retrieval');

  context.chatId = 'chat:harbor';
  context.chat = [];
  pushUser(context, 'At Harbor Archive, I inspect the Tide Ledger beside the flood records.');
  const second = await session.processCurrentTurn();
  assert.equal(second.mode, 'retrieval');

  const evidence = session.exportEvidence();
  assert.deepEqual(evidence.modeCoverage, { simple: false, retrieval: true, ambiguous: false });
  assert.deepEqual(evidence.checks, {
    anyReadyTurn: true,
    twoUnrelatedStories: true,
    promptDeliveryObserved: true,
    sealedContextObserved: true,
    genericScenePolicyObserved: true,
  });
  assert.equal(evidence.status, 'OPERATOR_CONFIRMATION_PENDING');
  assert.equal(evidence.deterministicFixtureEvidence.acceptanceAuthority, false);
  assert.equal(evidence.issue224AutomaticPass, false);
  assert.equal(evidence.liveEvidenceComplete, false);
  session.destroy();
});
