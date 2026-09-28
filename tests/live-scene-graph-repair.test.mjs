import test from 'node:test';
import assert from 'node:assert/strict';
import {SceneObservationSpecialist,createSceneObservationTask} from '../src/coprocessor/scene-observation-specialist.js';
import {NativeGraphNeighborhoodRetriever} from '../src/graph-neighborhood-retriever.js';
import {createMemoryOwnerGraphProvider,createLoreOwnerGraphProvider} from '../src/deployment/owner-graph-adapters.js';

test('Scene provider is given the observation shape enforced by its normalizer',()=>{
  const task=createSceneObservationTask({chatId:'chat',turnId:'turn',generationId:'gen',correlationId:'corr',sourceRevisionId:'source@1',sceneRevision:1});
  const input=SceneObservationSpecialist.buildInput(task,{narrative:'A person enters.',sceneId:'scene',baseRevision:1,evidenceRef:'evidence',sourceRevisionId:'source@1'});
  assert.match(input.messages[0].content,/observationClass/);
  assert.match(input.messages[0].content,/confidence/);
  assert.deepEqual(input.responseFormat,{type:'json_object'});
});

test('slow bounded owner graph cannot starve other bounded owners',()=>{
  const originalNow=Date.now;let time=0;
  const oldPerformance=globalThis.performance;
  Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>time}});
  try{
    const graph=new NativeGraphNeighborhoodRetriever({temporalGraph:{allClaims:()=>[]},limits:{latencyBudgetMs:15}});
    const calls=[];
    for(const name of ['LORE','MEMORY','SCENE'])graph.registerProvider({providerId:name,owner:name,isRevisionCurrent:()=>true,query:()=>{
      calls.push(name);time+=20;
      return {edges:[{edgeId:name,fromEntityId:'anchor',toEntityId:name,edgeMeaning:'RELATED',sourceRevisionRefs:['source@1'],temporalStatus:'CURRENT'}]};
    }});
    const result=graph.retrieve({intentId:'intent',query:'anchor',entityRefs:['anchor']},{sourceRevisionSet:['source@1']});
    assert.deepEqual(calls,['LORE','MEMORY','SCENE']);
    assert.equal(result.length,3);
  }finally{Date.now=originalNow;Object.defineProperty(globalThis,'performance',{configurable:true,value:oldPerformance});}
});

test('Memory graph revision validation never serializes the entire owner when lightweight refs exist',()=>{
  const provider=createMemoryOwnerGraphProvider({adapters:{queryHistorian:()=>({nominations:[]}),activeSourceRevisionRefs:()=>['source@1'],snapshot:()=>{throw new Error('full Memory snapshot on foreground path');}}});
  provider.query({query:'anchor'});
  assert.equal(provider.isRevisionCurrent('source@1'),true);
  assert.equal(provider.isRevisionCurrent('source@0'),false);
});

test('Lore graph uses exact owner revision check without building the full UI status',()=>{
  const provider=createLoreOwnerGraphProvider({query:()=>({nominations:[]}),isSourceRevisionCurrent:id=>id==='source@1',status:()=>{throw new Error('full Lore UI status on foreground path');}});
  provider.query({query:'anchor'});
  assert.equal(provider.isRevisionCurrent('source@1'),true);
  assert.equal(provider.isRevisionCurrent('source@0'),false);
});


test('anchorless graph request does not materialize owner graphs it cannot traverse',()=>{
  let reads=0;
  const graph=new NativeGraphNeighborhoodRetriever({temporalGraph:{allClaims:()=>{reads++;return[];}}});
  graph.registerProvider({providerId:'LORE',owner:'LORE',query:()=>{reads++;return{edges:[]};}});
  assert.deepEqual(graph.retrieve({intentId:'empty',entityRefs:[]}),[]);
  assert.equal(reads,0);
  assert.equal(graph.lastReceipt.noWorkReason,'NO_ENTITY_ANCHORS');
});
