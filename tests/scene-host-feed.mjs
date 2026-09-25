import test from 'node:test';
import assert from 'node:assert/strict';
import { HostActivity, HostEventStatus, NarrativeFeedAdapter, ObservationClass, SceneLifecycleRuntime, createFieldState } from '../src/scene/index.js';

let hostSeq=0;const host=(activity,extra={})=>({activity,chatId:'chat-a',hostEventId:`host:${activity}:${extra.messageId??extra.eventSequence??++hostSeq}`,...extra});

test('normal user/assistant turns preserve stable identities and revisions',()=>{
  const a=new NarrativeFeedAdapter();
  const u=a.normalize(host(HostActivity.USER_SEND,{messageId:'m1',messageRevision:1,turnId:'t1',content:'Hello',role:'user'}));
  const s=a.normalize(host(HostActivity.ASSISTANT_GENERATION_COMPLETE,{messageId:'m2',messageRevision:1,turnId:'t1',content:'Hi',role:'assistant'}));
  assert.equal(u.status,HostEventStatus.ACCEPTED);assert.equal(s.status,HostEventStatus.ACCEPTED);assert.equal(u.evidence.chatId,'chat-a');assert.equal(u.evidence.messageId,'m1');assert.equal(u.evidence.messageRevision,1);assert.notEqual(u.evidence.sourceRevisionId,s.evidence.sourceRevisionId);assert.equal(a.currentEvidence('chat-a').length,2);
});

test('duplicate host delivery is idempotent',()=>{
  const a=new NarrativeFeedAdapter();const input={activity:HostActivity.USER_SEND,chatId:'c',hostEventId:'same',messageId:'m',messageRevision:1,content:'x'};const x=a.normalize(input);const y=a.normalize(input);assert.equal(x.status,HostEventStatus.ACCEPTED);assert.equal(y.status,HostEventStatus.DUPLICATE);assert.equal(a.currentEvidence('c').length,1);
});

test('regenerate makes abandoned assistant evidence historical and returns invalidation',()=>{
  const a=new NarrativeFeedAdapter();a.normalize({activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:'c',hostEventId:'a1',messageId:'m',messageRevision:1,content:'A'});
  const b=a.normalize({activity:HostActivity.REGENERATE,chatId:'c',hostEventId:'a2',messageId:'m',messageRevision:2,content:'B'});
  assert.equal(b.evidence.current,true);assert.ok(b.evidence.invalidates.some(x=>x.includes(':r:1:')));const current=a.currentEvidence('c');assert.equal(current.length,1);assert.equal(current[0].content,'B');
});

test('swipe selection leaves only selected variant CURRENT',()=>{
  const a=new NarrativeFeedAdapter();a.normalize({activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:'c',hostEventId:'v1',messageId:'m',messageRevision:1,swipeId:'A',content:'Variant A'});
  a.normalize({activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:'c',hostEventId:'v2',messageId:'m',messageRevision:2,swipeId:'B',content:'Variant B'});
  const chosen=a.normalize({activity:HostActivity.SWIPE_SELECTED,chatId:'c',hostEventId:'pick',messageId:'m',swipeId:'A'});
  assert.equal(chosen.evidence.content,'Variant A');assert.equal(a.currentEvidence('c').length,1);assert.equal(a.currentEvidence('c')[0].content,'Variant A');assert.ok(chosen.evidence.invalidates.some(x=>x.includes(':r:2:B')));
});

test('edit creates a new source revision and preserves lineage',()=>{
  const a=new NarrativeFeedAdapter();const first=a.normalize({activity:HostActivity.USER_SEND,chatId:'c',hostEventId:'e1',messageId:'m',messageRevision:1,content:'old'});const second=a.normalize({activity:HostActivity.EDIT,chatId:'c',hostEventId:'e2',messageId:'m',messageRevision:2,content:'new'});assert.notEqual(first.evidence.sourceRevisionId,second.evidence.sourceRevisionId);assert.equal(second.evidence.replacesRevisionId,first.evidence.sourceRevisionId);assert.equal(a.currentEvidence('c')[0].content,'new');
});

test('delete invalidates lineage and leaves no current evidence',()=>{
  const a=new NarrativeFeedAdapter();a.normalize({activity:HostActivity.USER_SEND,chatId:'c',hostEventId:'d1',messageId:'m',messageRevision:1,content:'x'});const d=a.normalize({activity:HostActivity.DELETE,chatId:'c',hostEventId:'d2',messageId:'m',messageRevision:2});assert.equal(d.evidence.current,false);assert.ok(d.evidence.invalidates.length>=1);assert.equal(a.currentEvidence('c').length,0);
});

test('chat switching isolates current narrative evidence',()=>{
  const a=new NarrativeFeedAdapter();a.normalize({activity:HostActivity.USER_SEND,chatId:'one',hostEventId:'1',messageId:'m1',messageRevision:1,content:'one'});a.normalize({activity:HostActivity.USER_SEND,chatId:'two',hostEventId:'2',messageId:'m1',messageRevision:1,content:'two'});a.normalize({activity:HostActivity.CHAT_SWITCH,chatId:'two',hostEventId:'switch'});assert.equal(a.currentEvidence('one')[0].content,'one');assert.equal(a.currentEvidence('two')[0].content,'two');assert.equal(a.activeChatId,'two');
});

test('feed state survives JSON restart with swipe maps and dedupe state',()=>{
  const a=new NarrativeFeedAdapter();a.normalize({activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:'c',hostEventId:'v1',messageId:'m',messageRevision:1,swipeId:'A',content:'A'});const state=JSON.parse(JSON.stringify(a.exportState()));const b=NarrativeFeedAdapter.importState(state);const d=b.normalize({activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:'c',hostEventId:'v1',messageId:'m',messageRevision:1,swipeId:'A',content:'A'});assert.equal(d.status,HostEventStatus.DUPLICATE);const pick=b.normalize({activity:HostActivity.SWIPE_SELECTED,chatId:'c',hostEventId:'pick',messageId:'m',swipeId:'A'});assert.equal(pick.status,HostEventStatus.ACCEPTED);assert.equal(pick.evidence.content,'A');
});

test('unsupported host event does not fabricate evidence',()=>{const a=new NarrativeFeedAdapter();const r=a.normalize({activity:'MAGIC_EVENT',chatId:'c'});assert.equal(r.status,HostEventStatus.UNSUPPORTED);assert.equal('evidence' in r,false)});

test('SceneLifecycleRuntime turns normalized host evidence into real CurrentScene revisions',()=>{
  const rt=new SceneLifecycleRuntime();
  const out=rt.ingestHostEvent({activity:HostActivity.USER_SEND,chatId:'c',hostEventId:'h1',messageId:'m1',messageRevision:1,content:'Mara enters the room.'},{extract:(e,scene)=>({fields:{activeCast:createFieldState({value:[{characterId:'Mara',state:'PRESENT',confidence:1,evidenceRefs:[e.sourceRevisionId]}],confidence:1,evidenceRefs:[e.sourceRevisionId],observationClass:ObservationClass.OBSERVED,revision:scene.revision+1})}})});
  assert.equal(out.status,HostEventStatus.ACCEPTED);assert.equal(out.scene.revision,2);assert.equal(out.scene.fields.activeCast.value[0].characterId,'Mara');assert.ok(out.scene.fields.activeCast.evidenceRefs.includes(out.evidence.sourceRevisionId));
});

test('regeneration invalidates fields backed by abandoned evidence',()=>{
  const rt=new SceneLifecycleRuntime();
  const extract=(e,scene)=>({fields:{location:createFieldState({value:{location:e.content},confidence:1,evidenceRefs:[e.sourceRevisionId],observationClass:ObservationClass.OBSERVED,revision:scene.revision+1})}});
  const a=rt.ingestHostEvent({activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:'c',hostEventId:'a',messageId:'m',messageRevision:1,content:'Tavern'},{extract});
  const b=rt.ingestHostEvent({activity:HostActivity.REGENERATE,chatId:'c',hostEventId:'b',messageId:'m',messageRevision:2,content:'Street'},{extract});
  assert.ok(b.invalidated.length>=1);assert.equal(b.scene.fields.location.value.location,'Street');assert.ok(b.scene.revision>a.scene.revision);
});

test('delete invalidates dependent Scene field instead of leaving abandoned evidence CURRENT',()=>{
  const rt=new SceneLifecycleRuntime();const extract=(e,scene)=>({fields:{activeThreads:createFieldState({value:['secret'],confidence:1,evidenceRefs:[e.sourceRevisionId],observationClass:ObservationClass.OBSERVED,revision:scene.revision+1})}});
  const a=rt.ingestHostEvent({activity:HostActivity.USER_SEND,chatId:'c',hostEventId:'a',messageId:'m',messageRevision:1,content:'secret'},{extract});const d=rt.ingestHostEvent({activity:HostActivity.DELETE,chatId:'c',hostEventId:'d',messageId:'m',messageRevision:2},{extract});
  const scene=rt.registry.current(a.scene.sceneId);assert.equal(scene.fields.activeThreads.observationClass,ObservationClass.UNRESOLVED);assert.ok(d.invalidated.some(x=>x.fields.includes('activeThreads')));
});

test('chat switch produces separate Scene namespace without cross-chat contamination',()=>{
  const rt=new SceneLifecycleRuntime();rt.ingestHostEvent({activity:HostActivity.CHAT_LOAD,chatId:'one',hostEventId:'l1'});rt.ingestHostEvent({activity:HostActivity.CHAT_SWITCH,chatId:'two',hostEventId:'l2'});assert.notEqual(rt.chatScenes.get('one'),rt.chatScenes.get('two'));assert.ok(rt.chatScenes.get('one').startsWith('chat:one:'));assert.ok(rt.chatScenes.get('two').startsWith('chat:two:'));
});


test('CONTINUE joins existing message lineage without fabricating a new chat',()=>{
  const a=new NarrativeFeedAdapter();a.normalize({activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:'c',hostEventId:'c1',messageId:'m',messageRevision:1,content:'Part one'});const cont=a.normalize({activity:HostActivity.CONTINUE,chatId:'c',hostEventId:'c2',messageId:'m',messageRevision:2,content:'Part two'});assert.equal(cont.status,HostEventStatus.ACCEPTED);assert.equal(cont.evidence.chatId,'c');assert.equal(cont.evidence.messageRevision,2);assert.equal(a.currentEvidence('c')[0].content,'Part two');
});

test('meaningful location/cast/thread delta emits bounded speculative prefetch recommendation',()=>{
  const rt=new SceneLifecycleRuntime();const out=rt.ingestHostEvent({activity:HostActivity.USER_SEND,chatId:'pf',hostEventId:'pf1',messageId:'m1',messageRevision:1,content:'Eris enters the Ember Tavern looking for the Blade.'},{extract:(e,scene)=>({fields:{
    location:createFieldState({value:{location:'Ember Tavern'},confidence:1,evidenceRefs:[e.sourceRevisionId],observationClass:ObservationClass.OBSERVED,revision:scene.revision+1}),
    activeCast:createFieldState({value:[{characterId:'Eris',state:'PRESENT'}],confidence:1,evidenceRefs:[e.sourceRevisionId],observationClass:ObservationClass.OBSERVED,revision:scene.revision+1}),
    activeThreads:createFieldState({value:['Find Blade'],confidence:1,evidenceRefs:[e.sourceRevisionId],observationClass:ObservationClass.OBSERVED,revision:scene.revision+1})
  }})});const signal=rt.publicSignalArtifact('pf');assert.ok(signal.prefetchRecommendations.length>=1);assert.ok(signal.prefetchRecommendations[0].entityRefs.includes('Eris'));assert.ok(signal.prefetchRecommendations[0].locationRefs.includes('Ember Tavern'));assert.ok(signal.prefetchRecommendations[0].threadRefs.includes('Find Blade'));assert.equal(out.scene.revision,2);
});

test('chat switch stack relation is isolated rather than parallel story continuity',()=>{
  const rt=new SceneLifecycleRuntime();rt.ingestHostEvent({activity:HostActivity.CHAT_LOAD,chatId:'iso-one',hostEventId:'iso1'});rt.ingestHostEvent({activity:HostActivity.CHAT_SWITCH,chatId:'iso-two',hostEventId:'iso2'});const sceneId=rt.chatScenes.get('iso-two');const frame=rt.stack.frames.find((x)=>x.sceneId===sceneId);assert.equal(frame.relationshipToPrior,'ISOLATED');assert.equal(rt.graph.relation(rt.chatScenes.get('iso-one'),sceneId),null);
});
