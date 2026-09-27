import test from 'node:test';
import assert from 'node:assert/strict';
import {DevelopmentDeploymentBrain} from '../src/deployment/brain.js';
import {createDevelopmentDeploymentSillyTavernSession,extractDevelopmentDeploymentScene} from '../src/deployment/sillytavern-live.js';
import {Area52NativeBrain} from '../src/native-brain.js';
import {HostActivity,SceneRelationship,SceneEventType} from '../src/scene/index.js';

const event=(activity,id,content,extra={})=>({
  activity,
  chatId:extra.chatId??'clapperboard-chat',
  hostEventId:extra.hostEventId??`clapper:${id}:${activity}:r${extra.messageRevision??1}`,
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

function ownerReceipt(row){
  const safe=structuredClone(row);
  delete safe.dispatchTimeline;
  delete safe.signal;
  delete safe.parsed;
  return safe;
}

test('real close-open production path finalizes Episode, invalidates working context, publishes prefetch intent, and preserves evidence history',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const rows=[];
  for(let i=1;i<=5;i++)rows.push(ingest(brain,event(HostActivity.USER_SEND,`prior-${i}`,`At North Gallery, Mara waits near marker ${i}.`)));
  const priorSceneId=rows.at(-1).sceneId;
  const sourceRefs=rows.map(row=>row.evidence.sourceRevisionId);
  const moved=ingest(brain,event(HostActivity.USER_SEND,'move','We arrive at South Courtyard.'));

  assert.notEqual(moved.sceneId,priorSceneId);
  assert.equal(moved.transition?.status,'COMPLETE');
  assert.ok(moved.transition?.episodeRef);
  assert.equal(moved.transitionHandoff?.kind,'SceneTransitionContextHandoff');
  assert.equal(moved.transitionHandoff?.continuity?.episodeRef?.artifactId,moved.transition.episodeRef.artifactId);
  assert.equal(moved.transitionHandoff?.rawDialogueDeletionAuthority,false);
  const recentTailRefs=moved.transitionHandoff?.continuity?.recentTailRefs??[];
  assert.ok(recentTailRefs.length>0&&recentTailRefs.length<=2);
  assert.ok(recentTailRefs.every(ref=>sourceRefs.includes(ref)),'recent tail must point at actual prior-Scene evidence');
  assert.ok(moved.eventTypes.includes(SceneEventType.SCENE_CLOSED));
  assert.ok(moved.eventTypes.includes(SceneEventType.SCENE_OPENED));
  assert.ok(moved.eventTypes.includes(SceneEventType.PREFETCH_RECOMMENDED));
  assert.equal(moved.invalidationIds.length,1);
  assert.ok(moved.handoffReceipts.some(row=>row.reasonCode==='SCENE_TRANSITION_HANDOFF_APPLIED'));

  const coreHandoff=brain.core.sceneTransitionContext(moved.chatId);
  assert.equal(coreHandoff?.handoffId,moved.transitionHandoff.handoffId);
  for(const ref of sourceRefs)assert.ok(brain.scene.narrativeFeed.findSourceRevision(moved.chatId,ref),'raw narrative evidence must remain recoverable');
});

test('Core context owner decides raw-turn retirement and preserves transition recent tail',async()=>{
  const owner=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const prior=[];
  for(let i=1;i<=7;i++)prior.push(ingest(owner,event(HostActivity.USER_SEND,`ctx-${i}`,`At North Gallery, Mara waits near marker ${i}.`,{chatId:'ctx-chat'})));
  const moved=ingest(owner,event(HostActivity.USER_SEND,'ctx-move','We arrive at South Courtyard.',{chatId:'ctx-chat'}));
  const handoff=moved.transitionHandoff,tail=new Set(handoff.continuity.recentTailRefs);

  const activeMessages=prior.map((row,index)=>({
    messageId:`ctx-${index+1}`,sequence:index,role:'user',content:`prior ${index+1}`,
    sourceRevisionRefs:[row.evidence.sourceRevisionId],
  }));
  activeMessages.push({messageId:'ctx-move',sequence:99,role:'user',content:'What happens next?',sourceRevisionRefs:[moved.evidence.sourceRevisionId]});

  const native=new Area52NativeBrain();
  const prepared=await native.prepareTurn({
    chatId:'ctx-chat',turnId:'native:ctx',generationId:'native:ctx:g1',query:'What happens next?',
    sceneSignal:moved.signal,sceneTimeline:moved.dispatchTimeline,sceneOwnerReceipt:ownerReceipt(moved),
    activeContext:{messages:activeMessages,coverage:[],recentWindow:1},
    executionLabel:'DETERMINISTIC',
  });

  assert.ok(prepared.contextRetirement);
  assert.equal(prepared.contextRetirement.hostHistoryMutation,false);
  assert.equal(prepared.contextRetirement.sceneTransition.eligibilityDecisionOwner,'CORE_CONTEXT_POLICY');
  assert.equal(prepared.contextRetirement.sceneTransition.episodeRef.artifactId,handoff.continuity.episodeRef.artifactId);
  const retired=new Set(prepared.contextRetirement.retireEligibleMessageIds);
  assert.ok(retired.size>0,'older Episode-covered prior turns should become eligible for active-prompt retirement');
  for(const row of prior)if(tail.has(row.evidence.sourceRevisionId))assert.equal(retired.has(row.evidence.messageId),false,'handoff recent tail must remain raw');
  assert.equal(retired.has('ctx-move'),false);
  assert.ok(prepared.contextRetirement.decisions.every(row=>['RETIRE_FROM_ACTIVE_PROMPT','KEEP_RAW'].includes(row.action)));
  assert.equal(prepared.contextRetirement.sceneTransition.rawDialogueDeletionAuthority,false);
  assert.equal(prepared.contextRetirement.sceneTransition.promptInclusionAuthority,false);
  assert.equal(prepared.contextRetirement.sceneTransition.compactSummaryAvailable,true);
  assert.equal(prepared.contextRetirement.rawNarrativeIncluded,false);
  assert.equal(prepared.contextRetirement.storyTextIncluded,false);
  assert.equal(prepared.contextRetirement.retainedMessages,undefined);
  assert.ok(Array.isArray(prepared.contextRetirement.retainedMessageRefs));
  const safeRetirementJson=JSON.stringify(prepared.contextRetirement);
  assert.equal(safeRetirementJson.includes('prior 1'),false);
  assert.equal(safeRetirementJson.includes(handoff.continuity.compactPriorSceneSummary),false);
  assert.equal(JSON.stringify(prepared.sceneOwnerReceipt).includes(handoff.continuity.compactPriorSceneSummary),false);
  assert.ok(JSON.stringify(prepared.promptPlan).includes(handoff.continuity.compactPriorSceneSummary),'Core-approved compact Scene continuity must remain available to the prompt planner');
});

test('flashback and resume preserve conceptual Scene identity and finalize only the temporary Scene on resume',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const present=ingest(brain,event(HostActivity.USER_SEND,'resume-present','At Present Hall, Mara waits.',{chatId:'resume-chat'}));
  const presentId=present.sceneId;
  const flashback=ingest(brain,event(HostActivity.USER_SEND,'resume-flash','Years earlier, at Old Hall, Mara waited.',{chatId:'resume-chat'}));

  assert.equal(flashback.signal.sceneRelationship,SceneRelationship.FLASHBACK_OF);
  assert.equal(flashback.transitionHandoff?.continuity?.episodeRef??null,null,'suspension must not falsely finalize the present Scene');

  const resumed=ingest(brain,event(HostActivity.USER_SEND,'resume-return','Back in the present, Mara resumes in Present Hall.',{chatId:'resume-chat'}));
  assert.equal(resumed.sceneId,presentId);
  assert.equal(resumed.signal.sceneRelationship,SceneRelationship.RESUMES);
  assert.equal(resumed.transitionHandoff?.relationship,SceneRelationship.RESUMES);
  assert.ok(resumed.transitionHandoff?.continuity?.episodeRef,'temporary flashback Scene must finalize on resume');
  assert.equal(brain.core.sceneTransitionContext('resume-chat')?.toSceneRef.sceneId,presentId);
});

test('duplicate confirmed transition is idempotent for Episode, invalidation, handoff, and prefetch',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const first=ingest(brain,event(HostActivity.USER_SEND,'dup-1','At North Gallery, Mara waits.',{chatId:'dup-chat'}));
  const moved=ingest(brain,event(HostActivity.USER_SEND,'dup-2','We arrive at South Courtyard.',{chatId:'dup-chat'}));
  const episodesBefore=brain.scene.episodeCompiler.list().length;
  const invalidationsBefore=brain.scene.contextInvalidationPublisher.size();
  const prefetchBefore=brain.scene.prefetchTrigger.active({sceneId:moved.sceneId,sceneRevision:moved.sceneRevision}).length;

  const duplicate=brain.scene.transitionManager.transition({
    decision:moved.boundary.decision,fromSceneId:first.sceneId,nextSceneId:moved.sceneId,relationship:moved.transition.relationship,
    evidenceRefs:[moved.evidence.sourceRevisionId],sourceRevisionRefs:[moved.evidence.sourceRevisionId],
  });

  assert.equal(duplicate.status,'DUPLICATE');
  assert.equal(brain.scene.episodeCompiler.list().length,episodesBefore);
  assert.equal(brain.scene.contextInvalidationPublisher.size(),invalidationsBefore);
  assert.equal(brain.scene.prefetchTrigger.active({sceneId:moved.sceneId,sceneRevision:moved.sceneRevision}).length,prefetchBefore);
  assert.equal(brain.scene.transitionManager.listHandoffs().filter(row=>row.handoffId===moved.transitionHandoff.handoffId).length,1);
});

test('source edit invalidates only dependent handoff and stale handoff cannot regain Core influence',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const original=ingest(brain,event(HostActivity.USER_SEND,'stale-1','At North Gallery, Mara waits.',{chatId:'stale-chat',messageId:'stale-message',messageRevision:1}));
  const moved=ingest(brain,event(HostActivity.USER_SEND,'stale-2','We arrive at South Courtyard.',{chatId:'stale-chat'}));
  assert.ok(brain.core.sceneTransitionContext('stale-chat'));

  const edited=ingest(brain,event(HostActivity.EDIT,'stale-edit','At North Gallery, Mara waits quietly.',{chatId:'stale-chat',messageId:'stale-message',messageRevision:2}));
  assert.ok(edited.invalidatedTransitionHandoffs.some(row=>row.handoffId===moved.transitionHandoff.handoffId&&row.status==='INVALIDATED'));
  assert.equal(brain.core.sceneTransitionContext('stale-chat'),null);
  const retry=brain.core.consumeSceneTransitionHandoff(moved.transitionHandoff,{chatNamespace:'stale-chat'});
  assert.equal(retry.status,'STALE');
  assert.ok(brain.scene.narrativeFeed.findSourceRevision('stale-chat',original.evidence.sourceRevisionId));
});

test('late handoff for a superseded destination Scene is excluded as stale',()=>{
  const brain=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  ingest(brain,event(HostActivity.USER_SEND,'late-1','At North Gallery, Mara waits.',{chatId:'late-chat'}));
  const firstMove=ingest(brain,event(HostActivity.USER_SEND,'late-2','We arrive at South Courtyard.',{chatId:'late-chat'}));
  const oldHandoff=structuredClone(firstMove.transitionHandoff);
  const secondMove=ingest(brain,event(HostActivity.USER_SEND,'late-3','We arrive at East Terrace.',{chatId:'late-chat'}));
  assert.notEqual(secondMove.sceneId,firstMove.sceneId);
  const late=brain.core.consumeSceneTransitionHandoff(oldHandoff,{chatNamespace:'late-chat'});
  assert.equal(late.status,'STALE');
  assert.notEqual(brain.core.sceneTransitionContext('late-chat')?.handoffId,oldHandoff.handoffId);
});

test('Episode compilation failure remains recoverable and cannot retire raw context',async()=>{
  const owner=new DevelopmentDeploymentBrain({resourceCount:1,jevAvailable:false});
  const prior=ingest(owner,event(HostActivity.USER_SEND,'fail-1','At North Gallery, Mara waits.',{chatId:'fail-chat'}));
  const originalCompile=owner.scene.episodeCompiler.compile.bind(owner.scene.episodeCompiler);
  owner.scene.episodeCompiler.compile=()=>{throw new Error('synthetic episode failure');};
  const moved=ingest(owner,event(HostActivity.USER_SEND,'fail-2','We arrive at South Courtyard.',{chatId:'fail-chat'}));
  owner.scene.episodeCompiler.compile=originalCompile;

  assert.equal(moved.transition.status,'EPISODE_PENDING');
  assert.equal(moved.transitionHandoff.continuity.episodeRef,null);

  const native=new Area52NativeBrain();
  const prepared=await native.prepareTurn({
    chatId:'fail-chat',turnId:'native:fail',generationId:'native:fail:g1',query:'Continue.',
    sceneSignal:moved.signal,sceneTimeline:moved.dispatchTimeline,sceneOwnerReceipt:ownerReceipt(moved),
    activeContext:{messages:[
      {messageId:'fail-1',sequence:1,role:'user',content:'old raw',sourceRevisionRefs:[prior.evidence.sourceRevisionId]},
      {messageId:'fail-2',sequence:2,role:'user',content:'Continue.',sourceRevisionRefs:[moved.evidence.sourceRevisionId]},
    ],coverage:[],recentWindow:1},
    executionLabel:'DETERMINISTIC',
  });
  assert.equal(prepared.contextRetirement.retireEligibleMessageIds.length,0);
  assert.equal(prepared.contextRetirement.sceneTransition.episodeRef,null);
});

function makeInstalledHost(){
  const context={chatId:'installed-clapper',chat:[]};
  return{sillyTavern:{getContext:()=>context},context};
}
function pushUser(context,mes){context.chat.push({is_user:true,mes,send_date:Date.now()});}
function pushAssistant(context,mes){context.chat.push({is_user:false,mes,send_date:Date.now()});return context.chat.length-1;}
async function installedRound(session,context,user,assistant,{inspectPending=false}={}){
  pushUser(context,user);
  const pending=await session.prepareNativeGeneration();
  const request={chat:context.chat.map(row=>({role:row.is_user?'user':'assistant',content:row.mes})),dryRun:false};
  session.injectNativeModelRequest(request);
  const assistantIndex=pushAssistant(context,assistant);
  await session.completeNativeGeneration({messageIndex:assistantIndex});
  return inspectPending?pending:null;
}

test('installed SillyTavern native path carries handoff into Core retirement without mutating host history',async()=>{
  const {sillyTavern,context}=makeInstalledHost();
  const nativeBrain=new Area52NativeBrain();
  const session=createDevelopmentDeploymentSillyTavernSession({sillyTavern,document:null,mountUi:false,nativeBrain});

  await installedRound(session,context,'At North Gallery, Mara waits near marker one.','Mara continues to wait.');
  await installedRound(session,context,'At North Gallery, Mara waits near marker two.','The gallery remains quiet.');
  await installedRound(session,context,'At North Gallery, Mara waits near marker three.','Nothing else changes.');
  await installedRound(session,context,'At North Gallery, Mara waits near marker four.','Mara glances toward the exit.');
  const rawBefore=context.chat.map(row=>row.mes);

  const pending=await installedRound(session,context,'We arrive at South Courtyard.','Mara steps into the courtyard.',{inspectPending:true});
  assert.ok(pending.contextRetirement,'installed path must expose the Core retirement receipt before model completion');
  assert.equal(pending.contextRetirement.hostHistoryMutation,false);
  assert.equal(pending.contextRetirement.sceneTransition?.eligibilityDecisionOwner,'CORE_CONTEXT_POLICY');
  assert.ok(pending.contextRetirement.sceneTransition?.episodeRef);
  assert.ok(pending.contextRetirement.retireEligibleMessageIds.length>0);
  assert.equal(pending.contextRetirement.rawNarrativeIncluded,false);
  assert.equal(pending.contextRetirement.storyTextIncluded,false);
  assert.equal(pending.contextRetirement.retainedMessages,undefined);
  const pendingJson=JSON.stringify(pending);
  assert.equal(pendingJson.includes('At North Gallery, Mara waits near marker one.'),false,'installed receipt must not retain raw story text');
  assert.equal(pendingJson.includes('North Gallery | Mara'),false,'installed receipt must not retain compact continuity story text');
  assert.deepEqual(context.chat.slice(0,rawBefore.length).map(row=>row.mes),rawBefore,'host transcript must remain untouched');

  session.destroy();
});
