import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthorityClass,
  MutationType,
  PerspectiveScope,
  SettlementDecisionType,
} from '../src/memory-contracts.js';
import {MemoryTemporalProducer} from '../src/memory-temporal-producer.js';

function ev(p,{id,src=id+'@r1',text,world,scene,participants=[],knownBy=[],kind='EXPERIENCE'}){
  return p.appendEvidence({
    id,sourceId:id,sourceRevisionId:src,exactContent:text,kind,
    occurredAt:world,worldRevision:world,sceneRevision:scene,participants,knownBy,
  });
}
function settle(p,{evidence,claimId,subjectId,predicate,value,world,decision=SettlementDecisionType.ACCEPT_CURRENT,temporalKind='CURRENT'}){
  const proposalId='p:'+claimId;
  return p.applySettlement({
    proposal:{
      id:proposalId,owner:'WORLD_STATE',mutationType:MutationType.SET_CLAIM,
      sourceRevisionIds:[evidence.sourceRevisionId],evidenceIds:[evidence.id],
      freshnessRevisionIds:[evidence.sourceRevisionId],
      payload:{claim:{
        id:claimId,subjectId,predicate,value,
        temporal:{kind:temporalKind,validFrom:world},
        authorityClass:AuthorityClass.OBSERVED,confidence:1,owner:'WORLD_STATE',
        provenance:{evidenceIds:[evidence.id],sourceRevisionIds:[evidence.sourceRevisionId]},
      }},
    },
    decision:{
      id:'d:'+claimId,proposalId,decision,owner:'WORLD_STATE',
      evidenceIds:[evidence.id],sourceRevisionIds:[evidence.sourceRevisionId],
      worldRevision:world,reason:'wave2 golden',
    },
    receipt:{
      id:'r:'+claimId,proposalId,owner:'WORLD_STATE',outcome:'SETTLED',
      settledArtifactIds:[claimId],supersededArtifactIds:[],revision:world,
    },
  });
}

function buildEmber(){
  const p=new MemoryTemporalProducer();
  const intact=ev(p,{id:'ev:intact',text:'The Ember Tavern stood intact before the fire.',world:1,scene:1,participants:['Ember Tavern','Mara'],knownBy:['Mara','Eris']});
  settle(p,{evidence:intact,claimId:'c:intact',subjectId:'Ember Tavern',predicate:'state',value:'INTACT',world:1});
  const moved=ev(p,{id:'ev:moved',text:'Eris carried the Sun Blade and placed it inside the Ember Tavern immediately before the fire.',world:2,scene:2,participants:['Eris','Sun Blade','Ember Tavern'],knownBy:['Mara','Eris']});
  settle(p,{evidence:moved,claimId:'c:carried',subjectId:'Eris',predicate:'carried',value:'Sun Blade',world:2,decision:SettlementDecisionType.ACCEPT_HISTORICAL,temporalKind:'HISTORICAL'});
  settle(p,{evidence:moved,claimId:'c:blade-place',subjectId:'Sun Blade',predicate:'locatedAt',value:'Ember Tavern',world:2,decision:SettlementDecisionType.ACCEPT_HISTORICAL,temporalKind:'HISTORICAL'});
  p.publishEpisode({logicalId:'ep:blade',sceneId:'scene:blade',sceneRevision:2,sourceRevisionRefs:[moved.sourceRevisionId],evidenceRefs:[moved.id],participants:['Eris','Sun Blade','Ember Tavern'],knownBy:['Mara','Eris'],significance:1,timeStart:2,timeEnd:2,summary:'Eris placed the Sun Blade at the Ember Tavern immediately before the fire.'});
  const fire=ev(p,{id:'ev:fire',text:'The Ember Tavern burned and was destroyed in the fire.',world:3,scene:3,participants:['Ember Tavern','Mara','Eris'],knownBy:['Mara','Eris']});
  settle(p,{evidence:fire,claimId:'c:destroyed',subjectId:'Ember Tavern',predicate:'state',value:'DESTROYED',world:3,decision:SettlementDecisionType.SUPERSEDE});
  const fateA=ev(p,{id:'ev:fate-a',text:'One account says the Sun Blade was destroyed in the fire.',world:4,scene:3,participants:['Sun Blade'],knownBy:['Mara']});
  settle(p,{evidence:fateA,claimId:'c:fate-a',subjectId:'Sun Blade',predicate:'fate',value:'DESTROYED_IN_FIRE',world:4,decision:SettlementDecisionType.UNRESOLVED,temporalKind:'HISTORICAL'});
  const fateB=ev(p,{id:'ev:fate-b',text:'Another account says the Sun Blade was removed before the fire.',world:5,scene:3,participants:['Sun Blade'],knownBy:['Mara']});
  settle(p,{evidence:fateB,claimId:'c:fate-b',subjectId:'Sun Blade',predicate:'fate',value:'REMOVED_BEFORE_FIRE',world:5,decision:SettlementDecisionType.UNRESOLVED,temporalKind:'HISTORICAL'});
  const secret=ev(p,{id:'ev:secret',text:'Mara secretly hid a cellar ledger after the fire.',world:6,scene:4,participants:['Mara'],knownBy:['Mara']});
  p.publishEpisode({logicalId:'ep:secret',sceneId:'scene:secret',sceneRevision:4,sourceRevisionRefs:[secret.sourceRevisionId],evidenceRefs:[secret.id],participants:['Mara'],knownBy:['Mara'],significance:.8,timeStart:6,timeEnd:6,summary:'Mara secretly hid a cellar ledger after the fire.'});
  const market=ev(p,{id:'ev:market',text:'Bryn later visited the North Market.',world:20,scene:20,participants:['Bryn'],knownBy:['Bryn']});
  p.publishEpisode({logicalId:'ep:market',sceneId:'scene:market',sceneRevision:20,sourceRevisionRefs:[market.sourceRevisionId],evidenceRefs:[market.id],participants:['Bryn'],knownBy:['Bryn'],summary:'Bryn visited the North Market.',significance:.5,timeStart:20,timeEnd:20});

  p.defineSummaryScope({level:'SCENE',scopeId:'ember-fire',parentScopeRefs:['ARC:ember'],sourceSelector:{worldRevisionStart:1,worldRevisionEnd:6},episodeLogicalIds:['ep:blade','ep:secret']});
  p.defineSummaryScope({level:'ARC',scopeId:'ember',parentScopeRefs:['STORY:all'],childScopeRefs:['SCENE:ember-fire']});
  p.defineSummaryScope({level:'SCENE',scopeId:'market',parentScopeRefs:['ARC:market'],sourceSelector:{worldRevisionStart:20,worldRevisionEnd:20},episodeLogicalIds:['ep:market']});
  p.defineSummaryScope({level:'ARC',scopeId:'market',parentScopeRefs:['STORY:all'],childScopeRefs:['SCENE:market']});
  p.defineSummaryScope({level:'STORY',scopeId:'all',childScopeRefs:['ARC:ember','ARC:market']});
  let guard=0;
  while(p.summaryStatus().pendingWorkUnits&&guard++<20) p.runSummaryCompaction({maxUnits:8});
  assert.equal(p.summaryStatus().pendingWorkUnits,0);
  p.rebuildHistorian();
  return {p,intact,moved,fire,fateA,fateB,secret,market};
}

test('hierarchical summaries preserve Tavern eras and unresolved Blade fate with exact drillback',()=>{
  const {p}=buildEmber();
  const story=p.summaryArtifact('STORY:all');
  assert.ok(story);
  assert.match(story.representationText,/INTACT/);
  assert.match(story.representationText,/DESTROYED/);
  assert.match(story.representationText,/DESTROYED_IN_FIRE/);
  assert.match(story.representationText,/REMOVED_BEFORE_FIRE/);
  assert.equal(story.authorityClass,AuthorityClass.DERIVED);
  assert.equal(story.independentEvidence,false);
  assert.equal(story.contextSealAuthority,false);
  const raw=p.drillDown({metadata:{summaryArtifactId:story.id}});
  assert.ok(raw.some((row)=>row.id==='ev:intact'));
  assert.ok(raw.some((row)=>row.id==='ev:fire'));
  assert.ok(raw.some((row)=>row.id==='ev:fate-a'));
  assert.ok(raw.some((row)=>row.id==='ev:fate-b'));
  assert.equal(p.asOf(1).current.find((row)=>row.subjectId==='Ember Tavern'&&row.predicate==='state')?.value,'INTACT');
});

test('resolution-aware Historian uses overview for broad Tavern query and exact source for narrow Blade query',()=>{
  const {p}=buildEmber();
  const broad=p.queryHistorian({query:'what happened to the Ember Tavern?',mode:'EXPLICIT_HISTORY',breadth:'BROAD'});
  assert.ok(broad.nominations.length>0);
  assert.equal(broad.diagnostics.baseQueryUsed,false);
  assert.ok(['STORY','ARC'].includes(broad.nominations[0].metadata.resolutionLevel));
  assert.equal(broad.nominations.some((row)=>/current.*Sun Blade.*locatedAt/i.test(row.representationText)),false);

  const narrow=p.queryHistorian({query:'who moved the Sun Blade immediately before the fire?',mode:'EXPLICIT_HISTORY'});
  assert.ok(narrow.nominations.length>0);
  assert.equal(narrow.diagnostics.resolutionPolicy,'EXACT');
  assert.match(narrow.nominations[0].representationText,/Eris/i);
  const drill=p.drillDown(narrow.nominations[0]);
  assert.ok(drill.some((row)=>row.id==='ev:moved'));
});

test('character perspective cannot receive a world summary containing a secret event it did not know',()=>{
  const {p}=buildEmber();
  const world=p.queryHistorian({query:'story recap cellar ledger',breadth:'BROAD',perspectiveConstraint:{scope:PerspectiveScope.WORLD}});
  assert.ok(world.nominations.some((row)=>/cellar ledger/i.test(row.representationText)));
  const eris=p.queryHistorian({query:'story recap cellar ledger',breadth:'BROAD',perspectiveConstraint:{scope:PerspectiveScope.CHARACTER_KNOWLEDGE,characterRef:'Eris'}});
  assert.equal(eris.nominations.some((row)=>/cellar ledger/i.test(row.representationText)),false);
});

test('editing one source rebuilds only its dependency cone and preserves unrelated arc identity',()=>{
  const {p,fire}=buildEmber();
  const marketBefore=p.summaryArtifact('ARC:market').id;
  const emberBefore=p.summaryArtifact('ARC:ember').id;
  const receipt=p.invalidateSourceRevision(fire.sourceRevisionId,{replacedBy:'ev:fire@r2'});
  assert.ok(receipt.affectedSummaryScopeRefs.includes('SCENE:ember-fire'));
  assert.ok(receipt.affectedSummaryScopeRefs.includes('ARC:ember'));
  assert.equal(receipt.affectedSummaryScopeRefs.includes('ARC:market'),false);
  assert.equal(p.summaryArtifact('ARC:ember'),null);
  ev(p,{id:'ev:fire-r2',src:'ev:fire@r2',text:'The Ember Tavern was destroyed by the corrected fire account.',world:3,scene:3,participants:['Ember Tavern'],knownBy:['Mara','Eris']});
  let guard=0;
  while(p.summaryStatus().pendingWorkUnits&&guard++<20) p.runSummaryCompaction({maxUnits:8});
  assert.notEqual(p.summaryArtifact('ARC:ember').id,emberBefore);
  assert.equal(p.summaryArtifact('ARC:market').id,marketBefore);
  assert.equal(p.summaryHistory('ARC:ember').some((row)=>row.id===emberBefore),true);
});

test('impossible summary budget fails explicitly rather than truncating hard source rules',()=>{
  const p=new MemoryTemporalProducer();
  ev(p,{id:'ev:rule',text:'R'.repeat(400),world:1,scene:1,participants:['World'],knownBy:['Mara'],kind:'SOURCE'});
  p.defineSummaryScope({level:'SCENE',scopeId:'rule',sourceSelector:{worldRevisionStart:1,worldRevisionEnd:1},maxCharacters:128});
  const unit=p.summaryWorkUnits({maxUnits:1})[0];
  assert.throws(()=>p.compileSummaryWorkUnit(unit,{maxCharacters:128}),/MEMORY_SUMMARY_BUDGET_IMPOSSIBLE/);
  assert.equal(p.summaryArtifact('SCENE:rule'),null);
});

test('interrupted compaction survives snapshot reload without duplicate publication or raw-turn loss',()=>{
  let {p}=buildEmber();
  const rawCount=p.graph.evidence.size;
  p.defineSummaryScope({level:'SCENE',scopeId:'extra',sourceSelector:{worldRevisionStart:1,worldRevisionEnd:2}});
  const first=p.runSummaryCompaction({maxUnits:1});
  assert.equal(first.usedWorkUnits,1);
  const snap=p.snapshot();
  p=MemoryTemporalProducer.fromSnapshot(snap);
  let guard=0;
  while(p.summaryStatus().pendingWorkUnits&&guard++<20) p.runSummaryCompaction({maxUnits:2});
  assert.equal(p.graph.evidence.size,rawCount);
  const hist=p.summaryHistory('SCENE:extra');
  assert.equal(new Set(hist.map((row)=>row.id)).size,hist.length);
});

test('late compaction work carries revision fences and cannot publish after source movement',()=>{
  const p=new MemoryTemporalProducer();
  ev(p,{id:'ev:one',text:'First event.',world:1,scene:1,participants:['A'],knownBy:['A']});
  p.defineSummaryScope({level:'SCENE',scopeId:'open',sourceSelector:{worldRevisionStart:1}});
  const unit=p.summaryWorkUnits({maxUnits:1})[0];
  ev(p,{id:'ev:two',text:'Second event changes the open scene.',world:2,scene:1,participants:['A'],knownBy:['A']});
  assert.throws(()=>p.compileSummaryWorkUnit(unit),/MEMORY_SUMMARY_WORK_FENCE_CHANGED/);
});

test('hierarchical artifacts survive reload and keep old revisions available for as-of inspection',()=>{
  const {p}=buildEmber();
  const story=p.summaryArtifact('STORY:all');
  const restored=MemoryTemporalProducer.fromSnapshot(p.snapshot());
  assert.equal(restored.summaryArtifact('STORY:all').id,story.id);
  assert.equal(restored.summaryHistory('STORY:all')[0].id,story.id);
  assert.equal(restored.summaryStatus().providerRequired,false);
  assert.equal(restored.publicApi().ownership.summaries,'DERIVED_NAVIGATION_ONLY');
});


test('public Historian resolver can nominate a fenced hierarchical summary without granting authority',()=>{
  const {p}=buildEmber();
  const request={
    kind:'HistorianMemoryRequest',
    contractVersion:'1.0.0',
    requestId:'wave2:broad',
    retrievalIntents:[{
      intentId:'hist:ember-overview',
      mode:'EXPLICIT_HISTORY',
      query:'what happened to the Ember Tavern?',
      entityRefs:['Ember Tavern'],
      breadth:'BROAD',
    }],
    retrievalIntentIds:['hist:ember-overview'],
    activeEntityIds:['Ember Tavern'],
    activeThreadIds:[],
    perspectiveConstraint:{scope:PerspectiveScope.WORLD,characterRef:null},
    memoryRevisionRefs:p.memoryRevisionRefs(),
    limits:{maxArtifacts:8,maxEvidenceBytes:65536},
  };
  const resolved=p.resolveHistorianMemoryRequest(request);
  assert.equal(resolved.status,'OK');
  assert.ok(resolved.artifacts.length>0);
  assert.equal(resolved.artifacts[0].channel,'HIERARCHICAL_SUMMARY');
  assert.ok(['STORY','ARC'].includes(resolved.artifacts[0].resolutionLevel));
  assert.equal(resolved.artifacts[0].independentEvidence,false);
  assert.equal(resolved.artifacts[0].navigationOnly,true);
  assert.equal(resolved.artifacts[0].authorityGranted,false);
  assert.equal(resolved.artifacts[0].memoryMutation,false);

  const stale=p.resolveHistorianMemoryRequest({...request,memoryRevisionRefs:['memory:stale']});
  assert.equal(stale.status,'DEGRADED');
  assert.deepEqual(stale.artifacts,[]);
  assert.ok(stale.unavailableChannels.includes('MEMORY_REVISION_FENCE_CHANGED'));
});
