import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

import {SceneJevOwnerAdjudicator,SceneOwnerDecision} from '../src/scene/jev-owner.js';
import {normalizeJevDecisionReceipt} from '../src/ui-core/wave8-cognition.js';
import {createPromptPlanReadModel,createContextReceiptReadModel} from '../src/core-ui-read-models.js';
import {SceneQueryPlanner} from '../src/scene/scene-query-planner.js';
import {SceneRetrievalAdapter} from '../src/scene/scene-retrieval.js';
import {ScenePrefetchTrigger} from '../src/scene/prefetch-trigger.js';
import {ContextCompiler} from '../src/context-compiler.js';
import {CandidateBus} from '../src/candidate-bus.js';
import {createChannelNomination} from '../src/candidate-bus-contracts.js';
import {NativeJevAdvisory} from '../src/native-jev-advisory.js';

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

test('Scene Jev owner enforces the request deadline and aborts the provider signal',async()=>{
  let providerAborted=false;
  const owner=new SceneJevOwnerAdjudicator({service:{adjudicate:(_input,{signal}={})=>new Promise((resolve,reject)=>{
    signal?.addEventListener('abort',()=>{providerAborted=true;reject(Object.assign(new Error('aborted'),{code:'PROVIDER_ABORTED'}));},{once:true});
    void resolve;
  })}});
  const started=Date.now();
  const receipt=await owner.adjudicate(
    {decisionId:'d:timeout',sceneRevision:1,deadline:Date.now()+50},
    {currentScene:{sceneId:'scene:1',revision:1}},
  );
  assert.equal(receipt.ownerDecision,SceneOwnerDecision.UNRESOLVED);
  assert.equal(receipt.reasonCode,'JEV_ADJUDICATION_DEADLINE_EXCEEDED');
  assert.equal(receipt.timedOut,true);
  assert.equal(providerAborted,true);
  assert.ok(Date.now()-started<500,'owner consideration is bounded independently of provider completion');
});

test('Scene Jev owner external cancellation is terminal and does not wait for a non-cooperative provider',async()=>{
  const controller=new AbortController();
  const owner=new SceneJevOwnerAdjudicator({service:{adjudicate:()=>new Promise(()=>{})}});
  const pending=owner.adjudicate(
    {decisionId:'d:cancel',sceneRevision:1,deadline:Date.now()+5000},
    {currentScene:{sceneId:'scene:1',revision:1},signal:controller.signal},
  );
  setTimeout(()=>controller.abort(),10);
  const receipt=await pending;
  assert.equal(receipt.ownerDecision,SceneOwnerDecision.UNRESOLVED);
  assert.equal(receipt.reasonCode,'JEV_ADJUDICATION_CANCELLED');
  assert.equal(receipt.cancelled,true);
});

test('Jev choice-summary normalization never invents a physical provider attempt',()=>{
  const normalized=normalizeJevDecisionReceipt({
    considered:true,invoked:false,skipped:true,unavailable:true,action:'JEV_UNAVAILABLE',
    reason:'JEV_UNAVAILABLE',reasonDetail:'NO_FRESH_ADVICE_FOR_THIS_DECISION',reasonCodes:['JEV_UNAVAILABLE'],
  });
  assert.equal(normalized.state,'UNAVAILABLE');
  assert.equal(normalized.outcome,'UNAVAILABLE');
  assert.equal(normalized.invoked,false);
  assert.equal(normalized.physicalAttempt,false);
  assert.equal(normalized.reason,'NO_FRESH_ADVICE_FOR_THIS_DECISION');
});

test('native async Jev diagnostics distinguish disconnected, pending, failed, and owner-rejected states',async()=>{
  let rejectProvider=null;
  const service={adjudicate:()=>new Promise((resolve,reject)=>{rejectProvider=reject;void resolve;})};
  const advisory=new NativeJevAdvisory();
  assert.equal(advisory.diagnostics().connectionState,'SERVICE_NOT_ATTACHED');
  advisory.attach({service,isConfigured:()=>false});
  assert.equal(advisory.diagnostics().connectionState,'RESOURCE_DISCONNECTED');
  advisory.attach({service,isConfigured:()=>true});
  const set={
    id:'conflict:set',property:'location',sourceRevisionRefs:['src@1'],
    members:[{claimId:'claim:1',sourceRevisionId:'src@1',value:'north',attribution:'SOURCE'}],
    alternatives:[['north'],['south']],
  };
  const record={chatId:'chat:1',turnId:'turn:1',generationId:'gen:1',correlationId:'corr:1',published:{sealReceipt:{id:'seal:1'},candidates:[]}};
  const loreInterface={conflictSets:()=>[set]};
  const run=advisory.run({set,record,loreInterface});
  for(let i=0;i<20&&!rejectProvider;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(advisory.diagnostics().connectionState,'CONNECTED');
  assert.equal(advisory.diagnostics().pending.count,1);
  rejectProvider?.(new Error('provider down'));
  const failed=await run;
  advisory.remember(failed);
  assert.equal(advisory.diagnostics().pending.count,0);
  assert.equal(advisory.diagnostics().failedExecutionCount,1);
  advisory.remember({conflictSetId:'conflict:rejected',status:'UNRESOLVED',ownerDecision:'REJECTED'});
  assert.equal(advisory.diagnostics().ownerRejectedCount,1);
});

test('partial Lore is included in Prompt/Context read models while its deferred remainder stays visible',()=>{
  const plan={
    promptPlanId:'plan:1',generationId:'gen:1',turnId:'turn:1',contextSealId:'seal:1',sealedPacketHash:'hash',
    modelProfileId:'RECENCY_WEIGHTED',modelProfileRevision:'1',deliveryPolicyRevision:'1',worldRevision:1,sceneRevision:2,
    sourceRevisionDependencies:['src@1'],ordering:['RELEVANT_LORE','CURRENT_SCENE','USER_INPUT'],segments:[],
    sections:[
      {slot:'RELEVANT_LORE',representation:'COMPACT',allocatedTokens:180,compactTokens:180,richTokens:500,targetTokens:500,required:false,protected:false},
      {slot:'CURRENT_SCENE',representation:'COMPACT',allocatedTokens:200,compactTokens:200,richTokens:300,targetTokens:300,required:true,protected:true},
      {slot:'USER_INPUT',representation:'RICH',allocatedTokens:20,compactTokens:20,richTokens:20,targetTokens:20,required:true,protected:true},
    ],
    deferred:[{slot:'RELEVANT_LORE',reason:'PARTIAL_OPTIONAL_LORE_BY_BUDGET',partial:true,admittedEntryCount:2,deferredEntryCount:4,requiredTokens:500,remainingTokensAtDecision:180}],
    dropped:[],fallbackDecisions:['PARTIAL_OPTIONAL_LORE_BY_BUDGET'],budget:{totalTokens:4096,usedTokens:400},status:'READY',
  };
  const prompt=createPromptPlanReadModel(plan);
  const lore=prompt.slotAllocation.find(row=>row.slot==='RELEVANT_LORE');
  assert.equal(lore.state,'PARTIAL');
  assert.equal(lore.included,true);
  assert.equal(lore.partial,true);
  assert.equal(lore.deferredEntryCount,4);
  const context=createContextReceiptReadModel({
    published:{sealReceipt:{id:'seal:1',turnId:'turn:1',correlationId:'corr:1',packetId:'packet:1',packetHash:'hash',worldRevision:1,sceneRevision:2,sourceRevisionIds:['src@1'],fallbackState:'NONE'},packet:{provenanceIndex:{}}},
    delivery:{plan},
  });
  assert.ok(context.includedSections.includes('RELEVANT_LORE'));
  assert.ok(context.deferredSections.some(row=>row.slot==='RELEVANT_LORE'&&row.partial===true));
});

test('long Scene query keeps both head and tail and reports every bounded reference family',()=>{
  const cast=Array.from({length:40},(_,i)=>'char:'+String(i).padStart(2,'0'));
  const scene={
    sceneId:'scene:query',revision:3,
    fields:{activeCast:{value:cast}},
    sourceRevisionRefs:Array.from({length:70},(_,i)=>'source:'+i),
    provenance:Array.from({length:70},(_,i)=>'prov:'+i),
  };
  const input='HEAD_ANCHOR '+('middle '.repeat(100))+'TAIL_ANCHOR';
  const plan=new SceneQueryPlanner().plan({scene,userInput:input});
  const direct=plan.intents.find(row=>row.intentKind==='DIRECT_QUERY');
  assert.ok(direct.query.length<=320);
  assert.match(direct.query,/HEAD_ANCHOR/);
  assert.match(direct.query,/TAIL_ANCHOR/);
  assert.equal(direct.queryCoverage.complete,false);
  assert.equal(direct.referenceCoverage.entityRefs.total,40);
  assert.equal(direct.entityRefs.length,32);
  assert.equal(direct.referenceCoverage.entityRefs.boundedOut,8);
  assert.equal(direct.referenceCoverage.sourceRevisionRefs.total,70);
  assert.equal(direct.sourceRevisionRefs.length,64);
});

test('Scene temporal traversal distinguishes hop exhaustion from genuine NOT_FOUND and can recover with a wider bounded hop budget',()=>{
  const edges=[
    {fromSceneId:'A',toSceneId:'B',evidenceRefs:['ab']},
    {fromSceneId:'B',toSceneId:'C',evidenceRefs:['bc']},
    {fromSceneId:'C',toSceneId:'D',evidenceRefs:['cd']},
  ];
  const graph={neighbors:(id)=>edges.filter(edge=>edge.fromSceneId===id||edge.toSceneId===id)};
  const retrieval=new SceneRetrievalAdapter({episodeProvider:[],graph});
  const capped=retrieval.temporalPath({fromSceneId:'A',toSceneId:'D',maxHops:2});
  assert.equal(capped.status,'HOP_LIMIT_REACHED');
  assert.equal(capped.continuation.suggestedMaxHops,4);
  const found=retrieval.temporalPath({fromSceneId:'A',toSceneId:'D',maxHops:4});
  assert.equal(found.status,'FOUND');
  const disconnected=new SceneRetrievalAdapter({episodeProvider:[],graph:{neighbors:(id)=>id==='A'?[{fromSceneId:'A',toSceneId:'B'}]:id==='B'?[{fromSceneId:'A',toSceneId:'B'}]:[]}});
  assert.equal(disconnected.temporalPath({fromSceneId:'A',toSceneId:'Z',maxHops:4}).status,'NOT_FOUND');
});

test('prefetch capacity never evicts ACTIVE work and returns explicit foreground recovery when saturated',()=>{
  const trigger=new ScenePrefetchTrigger({maxPending:2,defaultTtlRevisions:3});
  const a=trigger.recommend({sceneId:'scene:p',sceneRevision:1,trigger:'A',locationRefs:['A']});
  const b=trigger.recommend({sceneId:'scene:p',sceneRevision:1,trigger:'B',locationRefs:['B']});
  const c=trigger.recommend({sceneId:'scene:p',sceneRevision:1,trigger:'C',locationRefs:['C']});
  assert.equal(a.status,'ACTIVE');assert.equal(b.status,'ACTIVE');
  assert.equal(c.status,'DEFERRED');
  assert.equal(c.reasonCode,'PREFETCH_ACTIVE_CAPACITY_REACHED');
  assert.equal(c.recovery,'FOREGROUND_RETRIEVAL_REVALIDATION_REQUIRED');
  const active=trigger.active({sceneId:'scene:p',sceneRevision:1});
  assert.deepEqual(active.map(row=>row.trigger).sort(),['A','B']);
});

test('context compiler retains the 12-claim semantic publication bound but reports bounded-out canonical claims',()=>{
  const claims=new Map(Array.from({length:15},(_,i)=>{
    const id='claim:'+i;
    return[id,{id,subjectId:'entity:'+i,predicate:'state',value:'v'+i,authorityClass:'SOURCE_CANON',confidence:1,temporal:{validFrom:i,validUntil:null},provenance:{sourceRevisionIds:['src:'+i]}}];
  }));
  const compiler=new ContextCompiler({graph:{getClaim:(id)=>claims.get(id)??null},maxFactsPerSection:12});
  const truthResults=[...claims.keys()].map(id=>({usableForIntent:true,claimIds:[id],classification:'CURRENT'}));
  const {packet,metadata}=compiler.compileDetailed({query:'current state',intent:'CURRENT',truthResults,knowledgeEvidence:[]});
  assert.equal(packet.current.length,12);
  assert.equal(metadata.claimCoverage.current.total,15);
  assert.equal(metadata.claimCoverage.current.included,12);
  assert.equal(metadata.claimCoverage.current.boundedOut,3);
  assert.equal(metadata.claimCoverage.policy,'SEMANTIC_PRIORITY_RANK');
});

test('long external evidence is head+tail bounded, labels partial coverage, and retains source drillback',()=>{
  const text='HEAD_EVIDENCE\n'+('x'.repeat(13000))+'\nTAIL_EVIDENCE';
  const evidence={
    evidenceId:'ev:long',sourceClass:'SOURCE_LORE',authorityClass:'SOURCE_CANON',temporalStatus:'CURRENT',confidence:1,
    artifactRef:{artifactId:'artifact:long',revision:1},representationText:text,hardRule:false,
    sourceRevisionRefs:['src:long@1'],dependencyRevisionRefs:[],provenanceRefs:['src:long@1'],
  };
  const compiler=new ContextCompiler({graph:{getClaim:()=>null}});
  const {packet}=compiler.compileDetailed({query:'q',intent:'CURRENT',truthResults:[{usableForIntent:true,knowledgeEvidenceId:'ev:long',claimIds:[],classification:'CURRENT'}],knowledgeEvidence:[evidence]});
  const row=packet.relevantLore[0];
  assert.ok(row.text.length<=12000);
  assert.match(row.text,/HEAD_EVIDENCE/);
  assert.match(row.text,/TAIL_EVIDENCE/);
  assert.equal(row.textCoverage.complete,false);
  assert.equal(row.textCoverage.policy,'HEAD_TAIL_WITH_SOURCE_DRILLBACK');
  assert.deepEqual(row.sourceRevisionRefs,['src:long@1']);
  assert.equal(row.artifactRef.artifactId,'artifact:long');
});

test('Candidate Bus bounded ranking text keeps tail evidence and records source-drillback coverage',()=>{
  const representation='HEAD_MARKER '+('z'.repeat(2000))+' TAIL_MARKER';
  const bus=new CandidateBus({limits:{maxRepresentationChars:1600}});
  const envelope=bus.fuse({
    nominations:[createChannelNomination({
      nominationId:'nom:long',channelId:'SPARSE',candidateId:'cand:long',evidenceIdentity:'ev:long',
      artifactRef:{artifactId:'artifact:long',revision:1},sourceRevisionRefs:['src@1'],retrievalIntentIds:['intent:1'],
      rankSignals:{sparse:1},authorityClass:'OBSERVED',truthStatusHint:'CURRENT',
      representationRef:'representation:long',representationRevision:1,representationText:representation,
    })],
    retrievalIntents:['intent:1'],currentRevisionSet:{sourceRevisionSet:['src@1']},
  });
  const candidate=envelope.candidates[0];
  assert.ok(candidate.representationText.length<=1600);
  assert.match(candidate.representationText,/HEAD_MARKER/);
  assert.match(candidate.representationText,/TAIL_MARKER/);
  assert.equal(candidate.metadata.representationCoverage.complete,false);
  assert.equal(candidate.metadata.representationCoverage.sourceDrillbackAvailable,true);
});

test('native deep queue cap remains dormant in production source: enqueueDeep has no caller under src',()=>{
  const root=fileURLToPath(new URL('../src/',import.meta.url));
  const files=[];
  const walk=(dir)=>{for(const name of readdirSync(dir)){const full=join(dir,name),st=statSync(full);if(st.isDirectory())walk(full);else if(/\.js$/.test(name))files.push(full);}};
  walk(root);
  const callers=[];
  for(const file of files){
    if(file.endsWith(join('coprocessor','native-hot-deep-scheduler.js')))continue;
    const source=readFileSync(file,'utf8');
    if(source.includes('.enqueueDeep(')||/\benqueueDeep\s*\(/.test(source))callers.push(file.slice(root.length));
  }
  assert.deepEqual(callers,[]);
});
