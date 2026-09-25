import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoundaryStatus, BoundaryVerifier, NarrativeFeedAdapter, ObservationClass, SceneEpisodeCompiler, SceneGraph,
  SceneRelationship, SceneRetrievalAdapter, SceneStack, SemanticBoundaryDetector, createCurrentScene, createFieldState,
  HostActivity,
} from '../src/scene/index.js';

const observed=(value,revision,evidence)=>createFieldState({value,confidence:1,evidenceRefs:[evidence],observationClass:ObservationClass.OBSERVED,revision});
const inferred=(value,revision,evidence,confidence=.7)=>createFieldState({value,confidence,evidenceRefs:[evidence],observationClass:ObservationClass.INFERRED,revision});

test('Wave 2 labeled boundary golden world yields truthful precision/recall metrics',()=>{
  const detector=new SemanticBoundaryDetector({emitThreshold:.05});
  const verifier=new BoundaryVerifier();
  const cases=[
    {name:'location',positive:true,signals:{locationTransition:1},support:.5},
    {name:'time-jump',positive:true,signals:{majorTimeJump:{strength:1,explicit:true}}},
    {name:'sleep-wake',positive:true,signals:{sleepWake:1}},
    {name:'flashback',positive:true,signals:{flashback:1}},
    {name:'parallel',positive:true,signals:{parallel:1}},
    {name:'doorway-no-cut',positive:false,signals:{doorway:1},contradict:1},
    {name:'weak-cast-no-cut',positive:false,signals:{castReplacement:.2},contradict:1},
  ];
  let tp=0,fp=0,fn=0,tn=0;
  for(const [i,c] of cases.entries()){
    const candidate=detector.detect({sceneId:`g:${i}`,evidenceRefs:[`e:${i}`],signals:c.signals});
    let confirmed=false;
    if(candidate){
      const initial=verifier.submit(candidate);
      let decision=initial;
      if(initial.status===BoundaryStatus.PENDING)decision=verifier.observe(candidate.candidateId,{support:c.support??0,contradict:c.contradict??0,evidenceRefs:[`e:${i}:verify`]});
      confirmed=decision.status===BoundaryStatus.CONFIRMED;
    }
    if(c.positive&&confirmed)tp++;else if(c.positive&&!confirmed)fn++;else if(!c.positive&&confirmed)fp++;else tn++;
  }
  const precision=tp/(tp+fp);const recall=tp/(tp+fn);const falseCutRate=fp/(fp+tn);
  assert.equal(tp,5);assert.equal(fp,0);assert.equal(fn,0);assert.equal(tn,2);
  assert.equal(precision,1);assert.equal(recall,1);assert.equal(falseCutRate,0);
  console.log('WAVE2_BOUNDARY_METRICS',JSON.stringify({tp,fp,fn,tn,precision,recall,falseCutRate}));
});

test('flashback and parallel topology remain non-linear',()=>{
  const flash=new SceneStack();flash.open({sceneId:'present'});flash.open({sceneId:'past',relationshipToPrior:SceneRelationship.FLASHBACK_OF,interruptedSceneId:'present'});assert.equal(flash.frames.find(x=>x.sceneId==='past').relationshipToPrior,SceneRelationship.FLASHBACK_OF);
  const parallel=new SceneStack();parallel.open({sceneId:'left'});parallel.open({sceneId:'right',relationshipToPrior:SceneRelationship.PARALLEL_TO,interruptedSceneId:'left'});assert.equal(parallel.frames.find(x=>x.sceneId==='right').relationshipToPrior,SceneRelationship.PARALLEL_TO);
});

test('closed SceneEpisode preserves observed/inferred/unresolved distinctions and exact source refs',()=>{
  const scene=createCurrentScene({sceneId:'gold',revision:4,sourceRange:{start:'m1',end:'m8'},sourceRevisionRefs:['chat:m1:r1','chat:m8:r1'],fields:{
    location:observed({location:'Ember Tavern'},4,'e:loc'),
    activeCast:observed([{characterId:'Eris',state:'PRESENT'}],4,'e:cast'),
    activeThreads:createFieldState({value:['Where is the Sun Blade?'],confidence:.5,evidenceRefs:['e:thread'],observationClass:ObservationClass.UNRESOLVED,revision:4}),
    atmosphere:inferred({tension:{score:.8}},4,'e:vibe')
  },provenance:['e:loc','e:cast','e:thread','e:vibe']});
  const compiler=new SceneEpisodeCompiler();const ep=compiler.compile({scene,record:{deltas:[],snapshots:[scene],provenance:scene.provenance}});
  const required=['episodeId','sceneId','sceneRevision','sourceRange','sourceRevisionRefs','participants','location','narrativeTime','events','claims','relationshipSignals','stateTransitions','objectTransitions','threadsCarried','atmosphereTrajectory','compactSummary','provenance','artifactRef'];
  const retained=required.filter(k=>k in ep).length;const fidelity=retained/required.length;
  assert.equal(fidelity,1);assert.equal(ep.observationSummary.activeThreads.observationClass,ObservationClass.UNRESOLVED);assert.equal(ep.observationSummary.atmosphere.observationClass,ObservationClass.INFERRED);assert.deepEqual(ep.sourceRevisionRefs,['chat:m1:r1','chat:m8:r1']);assert.ok(ep.provenance.includes('e:thread'));
  console.log('WAVE2_EPISODE_FIDELITY',JSON.stringify({required:required.length,retained,fidelity}));
});

test('Scene retrieval golden queries rank coherent relevant episode first',()=>{
  const graph=new SceneGraph();graph.addRelationship({fromSceneId:'tavern',toSceneId:'now',relationship:SceneRelationship.PRECEDES,evidenceRefs:['e:adj']});
  const episodes=[
    {sceneId:'tavern',sceneRevision:5,episodeId:'ep:tavern',sourceRange:{start:1,end:8},sourceRevisionRefs:['r:tavern'],participants:[{characterId:'Eris'}],location:{value:{location:'Ember Tavern'}},threadsCarried:['Sun Blade missing'],compactSummary:'Eris searches Ember Tavern for missing Sun Blade',artifactRef:{artifactId:'ep:tavern',artifactType:'SceneEpisode',revision:5}},
    {sceneId:'garden',sceneRevision:3,episodeId:'ep:garden',sourceRange:{start:9,end:12},sourceRevisionRefs:['r:garden'],participants:[{characterId:'Mara'}],location:{value:{location:'Garden'}},threadsCarried:['herbs'],compactSummary:'Mara tends herbs in the garden',artifactRef:{artifactId:'ep:garden',artifactType:'SceneEpisode',revision:3}},
  ];
  const retrieval=new SceneRetrievalAdapter({episodeProvider:episodes,graph});
  const queries=[
    {query:'Where was Eris searching for the Sun Blade?',entities:['Eris'],location:'Ember Tavern',expected:'tavern'},
    {query:'Mara herbs garden',entities:['Mara'],location:'Garden',expected:'garden'},
  ];
  let correct=0;
  for(const q of queries){const out=retrieval.retrieve({query:q.query,activeEntityRefs:q.entities,locationRef:q.location,currentSceneId:'now'});if(out[0]?.sceneId===q.expected)correct++;}
  const precisionAt1=correct/queries.length;assert.equal(precisionAt1,1);console.log('WAVE2_RETRIEVAL_METRICS',JSON.stringify({queries:queries.length,correctAt1:correct,precisionAt1}));
});

test('retrieved historical episode remains evidence rather than CurrentScene',()=>{
  const episodes=[{sceneId:'past',sceneRevision:1,episodeId:'ep:past',sourceRange:{start:1,end:2},sourceRevisionRefs:['r1'],participants:[],location:{value:{location:'Old Tavern'}},threadsCarried:[],compactSummary:'old tavern intact',artifactRef:{artifactId:'ep:past',artifactType:'SceneEpisode',revision:1}}];
  const r=new SceneRetrievalAdapter({episodeProvider:episodes});const out=r.retrieve({query:'old tavern intact'});assert.equal(out[0].relationshipToCurrentScene,'HISTORICAL');assert.equal(out[0].kind,'SceneRetrievalCandidate');assert.equal('currentScene' in out[0],false);
});

test('source revision invalidation removes stale closed episode from active retrieval',()=>{
  const episodes=[{sceneId:'past',sceneRevision:1,episodeId:'ep:past',sourceRange:{},sourceRevisionRefs:['old'],participants:[],threadsCarried:[],compactSummary:'Sun Blade at Tavern',artifactRef:{artifactId:'ep:past',artifactType:'SceneEpisode',revision:1}}];
  const current=new Set(['new']);const r=new SceneRetrievalAdapter({episodeProvider:episodes,isSourceRevisionCurrent:(ref)=>current.has(ref)});assert.equal(r.retrieve({query:'Sun Blade Tavern'}).length,0);
});

test('host golden regenerate/swipe/delete/chat switch/duplicate preserve current evidence truthfully',()=>{
  const a=new NarrativeFeedAdapter();
  a.normalize({activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:'c1',hostEventId:'a1',messageId:'m',messageRevision:1,swipeId:'A',content:'A'});
  a.normalize({activity:HostActivity.ASSISTANT_GENERATION_COMPLETE,chatId:'c1',hostEventId:'b1',messageId:'m',messageRevision:2,swipeId:'B',content:'B'});
  a.normalize({activity:HostActivity.SWIPE_SELECTED,chatId:'c1',hostEventId:'pick',messageId:'m',swipeId:'A'});
  assert.equal(a.currentEvidence('c1')[0].content,'A');
  a.normalize({activity:HostActivity.REGENERATE,chatId:'c1',hostEventId:'regen',messageId:'m',messageRevision:3,content:'C'});assert.equal(a.currentEvidence('c1')[0].content,'C');
  a.normalize({activity:HostActivity.DELETE,chatId:'c1',hostEventId:'del',messageId:'m',messageRevision:4});assert.equal(a.currentEvidence('c1').length,0);
  a.normalize({activity:HostActivity.USER_SEND,chatId:'c2',hostEventId:'c2m',messageId:'m',messageRevision:1,content:'other chat'});a.normalize({activity:HostActivity.CHAT_SWITCH,chatId:'c2',hostEventId:'switch'});assert.equal(a.currentEvidence('c2')[0].content,'other chat');
  const dup=a.normalize({activity:HostActivity.CHAT_SWITCH,chatId:'c2',hostEventId:'switch'});assert.equal(dup.status,'DUPLICATE');
});
