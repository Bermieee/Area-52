import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createLoreNeuralRenderState, replayLoreNeuralGrowth, renderLoreNeuralWorkspace } from '../src/ui-core/lore-neural-graph.js';
import { renderLoreStudySurface } from '../src/ui-core/wave13-operator-surfaces.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

function walk(node){return[node,...(node?.children??[]).flatMap(walk)];}
function textOf(node){return walk(node).map(x=>x.textContent??'').join(' ');}

function emptyData(){
  return{
    kind:'Wave13LoreStudySurface',
    entries:[],
    operatorCounts:{ACCEPTED:0,STUDYING:0,READY:0,FAILED:0,REMOVED:0},
    artifacts:[],conflicts:[],revision:null,retrievalReady:0,
  };
}
function populatedData(){
  return{
    kind:'Wave13LoreStudySurface',
    entries:[
      {sourceId:'lore:book:rudeus',uid:'rudeus',operatorState:'STUDYING',artifactIds:[],representations:[],retrievalReady:false,sourceRevisionId:'r1'},
      {sourceId:'lore:book:asura',uid:'asura-kingdom',operatorState:'READY',artifactIds:['artifact:asura:retrieval'],representations:[{profile:'BALANCED'}],retrievalReady:true,sourceRevisionId:'r2'},
      {sourceId:'lore:book:laplace',uid:'laplace',operatorState:'ACCEPTED',artifactIds:[],representations:[],retrievalReady:false,sourceRevisionId:'r3'},
      {sourceId:'lore:book:broken',uid:'broken-entry',operatorState:'FAILED',artifactIds:[],representations:[],retrievalReady:false,sourceRevisionId:'r4',studyError:{code:'TEST'}},
    ],
    operatorCounts:{ACCEPTED:1,STUDYING:1,READY:1,FAILED:1,REMOVED:0},
    artifacts:[{artifactId:'artifact:asura:retrieval',artifactType:'RETRIEVAL'}],
    conflicts:[],revision:9,retrievalReady:1,
  };
}

test('Lore neural canvas starts blank before a source is accepted',()=>{
  const d=new FakeDocument();
  const root=renderLoreNeuralWorkspace(d,{data:emptyData(),selected:{selection:{selected:false},snapshot:null},source:{operationalState:'IDLE',statusToken:'historical'},progress:0});
  const body=textOf(root);
  assert.equal(root.dataset.graphState,'blank');
  assert.match(body,/Waiting for a Lorebook/);
  assert.match(body,/blank canvas/);
  assert.match(body,/Load and accept a selected Lorebook to begin growing the graph/);
  assert.equal(walk(root).some(x=>String(x.className??'').includes('a52-lore-neural-svg')),false);
});

test('Lore neural canvas stays quiet after discovery until acceptance creates owner entries',()=>{
  const d=new FakeDocument();
  const root=renderLoreNeuralWorkspace(d,{data:emptyData(),selected:{selection:{selected:true,title:'Moon Harbor',lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor',entries:[{uid:'one'}]}},source:{operationalState:'IDLE',statusToken:'historical'},progress:0});
  const body=textOf(root);
  assert.equal(root.dataset.graphState,'loaded');
  assert.match(body,/Moon Harbor/);
  assert.match(body,/Source loaded — ready to accept/);
  assert.match(body,/Accept this verified source, then run pending study/);
});

test('Lore neural canvas grows bounded owner-state nodes and artifact links from real study data',()=>{
  const d=new FakeDocument(),inspected=[];
  const root=renderLoreNeuralWorkspace(d,{
    data:populatedData(),
    selected:{selection:{selected:true,title:'Moon Harbor',lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor',entries:new Array(4).fill({})}},
    source:{operationalState:'WORKING',statusToken:'observed'},
    progress:25,
    inspect:value=>inspected.push(value),
    scope:{listen(node,type,handler){node.addEventListener(type,handler);}},
  });
  const nodes=walk(root),body=textOf(root);
  assert.equal(root.dataset.graphState,'populated');
  assert.match(body,/What Lore is doing now/);
  assert.match(body,/Graph legend/);
  assert.match(body,/Selected Lorebook/);
  assert.match(body,/Graph growth/);
  assert.match(body,/Growth queue/);
  assert.match(body,/Moon Harbor/);
  assert.doesNotMatch(body,/Character|Faction|Place|Event|Concept|Timeline|Memory/);
  const svg=nodes.find(x=>x.tagName==='SVG'&&String(x.attributes?.class??'').includes('a52-lore-neural-svg'));
  assert.ok(svg);
  const entryNodes=nodes.filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.equal(entryNodes.length,4);
  const artifactNodes=nodes.filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-artifact-node'));
  assert.equal(artifactNodes.length,1);
  entryNodes[0].dispatch('click');
  assert.equal(inspected.length,1);
  assert.equal(inspected[0].kind,'area52-lore-source-node');
  assert.equal(inspected[0].authority,'LORE_OWNER');
  assert.ok(['STUDYING','READY','ACCEPTED','FAILED'].includes(inspected[0].payload.operatorState));
});

test('Lore neural canvas uses published category metadata without inferring categories from prose',()=>{
  const d=new FakeDocument(),data={
    kind:'Wave13LoreStudySurface',
    entries:[
      {sourceId:'lore:semantic:mara',uid:'mara',operatorState:'READY',artifactIds:[],representations:[],retrievalReady:true,sourceRevisionId:'r1'},
      {sourceId:'lore:semantic:harbor',uid:'harbor',operatorState:'READY',artifactIds:[],representations:[],retrievalReady:true,sourceRevisionId:'r2'},
      {sourceId:'lore:semantic:guild',uid:'guild',operatorState:'STUDYING',artifactIds:[],representations:[],retrievalReady:false,sourceRevisionId:'r3'},
    ],
    operatorCounts:{ACCEPTED:0,STUDYING:1,READY:2,FAILED:0,REMOVED:0},artifacts:[],conflicts:[],revision:10,retrievalReady:2,
  };
  const selected={selection:{selected:true,title:'Semantic Lore',lorebookId:'semantic'},snapshot:{id:'semantic',title:'Semantic Lore',entries:[
    {uid:'mara',content:'Prose is not classified.',metadata:{title:'Mara',treePath:['Character','Mara']}},
    {uid:'harbor',content:'Prose is not classified.',metadata:{title:'Moon Harbor',category:'Place'}},
    {uid:'guild',content:'Prose is not classified.',metadata:{title:'Lantern Guild',type:'Faction'}},
  ]}};
  const root=renderLoreNeuralWorkspace(d,{data,selected,source:{operationalState:'WORKING',statusToken:'observed'},progress:67});
  const nodes=walk(root),body=textOf(root);
  assert.match(body,/Character/);assert.match(body,/Place/);assert.match(body,/Faction/);
  const hubs=nodes.filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-hub-node'));
  assert.equal(hubs.length,3);
  assert.ok(hubs.every(x=>String(x.attributes?.['data-state'])==='SEMANTIC'));
  assert.ok(hubs.every(x=>Boolean(x.attributes?.['data-tone'])));
  assert.match(body,/Mara/);assert.match(body,/Moon Harbor/);assert.match(body,/Lantern Guild/);
});

test('105 READY metadata-poor sources distribute across neutral topology hubs instead of one READY hub',()=>{
  const d=new FakeDocument();
  const entries=Array.from({length:105},(_,index)=>({
    sourceId:'lore:large:'+index,uid:'entry-'+index,operatorState:'READY',
    artifactIds:index===64?Array.from({length:80},(__,artifact)=>'artifact:'+artifact):[],
    representations:[],retrievalReady:true,sourceRevisionId:'r'+index,
  }));
  const data={
    kind:'Wave13LoreStudySurface',entries,
    operatorCounts:{ACCEPTED:0,STUDYING:0,READY:105,FAILED:0,REMOVED:0},
    artifacts:[],conflicts:[],revision:'hierarchy:a59b5c6ea9e88b85deadbeef',retrievalReady:105,
  };
  const selected={selection:{selected:true,title:'Large Lore',lorebookId:'large'},snapshot:{id:'large',title:'Large Lore',entries:Array.from({length:105},(_,index)=>({uid:'entry-'+index}))}};
  const root=renderLoreNeuralWorkspace(d,{data,selected,source:{operationalState:'READY',statusToken:'ready'},progress:100});
  const nodes=walk(root),body=textOf(root);
  const hubs=nodes.filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-hub-node'));
  const sourceNodes=nodes.filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  const artifactNodes=nodes.filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-artifact-node'));
  assert.equal(hubs.length,7);
  assert.ok(hubs.every(x=>x.attributes?.['data-state']==='STRUCTURE'));
  assert.deepEqual(hubs.map(x=>Number(x.attributes?.['data-wave'])),[0,1,2,3,4,5,6]);
  const hubDelays=hubs.map(x=>Number(String(x.attributes?.style??'').match(/--a52-node-delay:(\d+)ms/)?.[1]??-1));
  assert.deepEqual(hubDelays,[210,630,1050,1470,1890,2310,2730]);
  assert.ok(hubDelays.at(-1)-hubDelays[0]>=2400);
  assert.ok(sourceNodes.every(x=>x.attributes?.['data-state']==='READY'));
  assert.equal(sourceNodes.length,54);
  assert.equal(artifactNodes.length,1);
  assert.match(body,/Source clusters · layout only/);
  assert.match(body,/54 of 105 source nodes shown/);
  assert.doesNotMatch(body,/hierarchy:a59b5c6ea9e88b85deadbeef/);
  assert.match(body,/hierarchy:a59b5c6e…beef/);
  const positions=hubs.map(hub=>hub.children?.find?.(child=>child.tagName==='CIRCLE')?.attributes??{});
  const xs=positions.map(pos=>Number(pos.cx)),ys=positions.map(pos=>Number(pos.cy));
  assert.ok(Math.min(...xs)<350&&Math.max(...xs)>650);
  assert.ok(Math.min(...ys)<250&&Math.max(...ys)>500);
  const artifactTitle=artifactNodes[0].children?.find?.(child=>child.tagName==='TITLE');
  assert.match(String(artifactTitle?.textContent??''),/80 derived refs/);
  const firstWaveSource=sourceNodes.find(node=>String(node.children?.find?.(child=>child.tagName==='TITLE')?.textContent??'').includes('entry 64'));
  assert.ok(firstWaveSource);
  const sourceDelay=Number(String(firstWaveSource.attributes?.style??'').match(/--a52-node-delay:(\d+)ms/)?.[1]??-1);
  const artifactDelay=Number(String(artifactNodes[0].attributes?.style??'').match(/--a52-node-delay:(\d+)ms/)?.[1]??-1);
  assert.ok(artifactDelay>sourceDelay);
  const avgX=xs.reduce((sum,value)=>sum+value,0)/xs.length,avgY=ys.reduce((sum,value)=>sum+value,0)/ys.length;
  assert.ok(Math.abs(avgX-500)<1);assert.ok(Math.abs(avgY-380)<1);
});

test('current fully READY Lore disables redundant study while keeping re-accept available',()=>{
  const d=new FakeDocument(),host=new FakeNode('section',d),entries=Array.from({length:105},(_,index)=>({
    sourceId:'lore:current:'+index,uid:'entry-'+index,operatorState:'READY',artifactIds:[],representations:[],retrievalReady:true,sourceRevisionId:'r'+index,
  }));
  const loreStudy={
    capabilities:()=>({read:true,discover:true,accept:true,run:true,retry:false,summaries:false,subscribe:false}),
    read:()=>({source:{operationalState:'READY',health:'READY',statusToken:'ready',impact:'Current.'},data:{
      kind:'Wave13LoreStudySurface',entries,operatorCounts:{ACCEPTED:0,STUDYING:0,READY:105,FAILED:0,REMOVED:0},artifacts:[],conflicts:[],revision:1,retrievalReady:105,
    }}),
    selectedLorebook:()=>({selection:{selected:true,lorebookId:'current',title:'Current Lore'},snapshot:{id:'current',title:'Current Lore',entries:Array.from({length:105},(_,index)=>({uid:'entry-'+index}))}}),
    summaries:()=>null,
    discoverSelectedLorebook:async()=>null,
  };
  renderLoreStudySurface(host,{loreStudy,actionRouter:{route:async()=>({ok:true})},scope:{listen(){},add(){}},refresh:()=>{},notifications:null,productAdapter:null});
  const buttons=walk(host).filter(node=>node.tagName==='BUTTON');
  const accept=buttons.find(node=>node.textContent==='Re-accept source'),run=buttons.find(node=>node.textContent==='Study current');
  assert.ok(accept);assert.ok(run);
  assert.equal(Boolean(accept.disabled||accept.attributes?.disabled),false);
  assert.equal(Boolean(run.disabled||run.attributes?.disabled),true);
});

test('Lore neural render state holds reveal across incidental refreshes then animates only newly published nodes',()=>{
  const d=new FakeDocument(),state=createLoreNeuralRenderState(),base=populatedData();
  const selected={selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}};
  const render=()=>renderLoreNeuralWorkspace(d,{data:base,selected,progress:25,renderState:state});

  const first=render();
  const firstEntries=walk(first).filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.equal(firstEntries.length,4);
  assert.ok(firstEntries.every(x=>String(x.attributes.class).includes('is-new')));
  assert.ok(walk(first).filter(x=>x.tagName==='ANIMATE').length>0);

  for(let pass=0;pass<3;pass++){
    const held=render(),heldEntries=walk(held).filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
    assert.ok(heldEntries.every(x=>String(x.attributes.class).includes('is-new')));
    assert.ok(walk(held).filter(x=>x.tagName==='ANIMATE').length>0);
  }

  const steady=render(),steadyEntries=walk(steady).filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.ok(steadyEntries.every(x=>String(x.attributes.class).includes('is-steady')));
  assert.equal(walk(steady).filter(x=>x.tagName==='ANIMATE').length,0);

  const grown={...base,entries:[...base.entries,{sourceId:'lore:book:new',uid:'new-source',operatorState:'STUDYING',artifactIds:[],representations:[],retrievalReady:false,sourceRevisionId:'r5'}],operatorCounts:{...base.operatorCounts,STUDYING:2}};
  const third=renderLoreNeuralWorkspace(d,{data:grown,selected,progress:25,renderState:state});
  const thirdEntries=walk(third).filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  const newlyPublished=thirdEntries.filter(x=>String(x.attributes.class).includes('is-new'));
  assert.equal(newlyPublished.length,1);
  assert.ok(walk(third).filter(x=>x.tagName==='ANIMATE').length>0);
  const incrementalDelay=Number(String(newlyPublished[0].attributes?.style??'').match(/--a52-node-delay:(\d+)ms/)?.[1]??-1);
  assert.ok(incrementalDelay>=180&&incrementalDelay<=490);
});

test('legacy seen render state still gets one visible wave after animation lifecycle upgrade',()=>{
  const d=new FakeDocument(),data=populatedData(),selected={selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}};
  const legacyState={
    lorebookKey:'moon',
    seenHubs:new Set(['legacy-hub']),
    seenNodes:new Set(data.entries.map(row=>String(row.sourceId))),
    seenArtifacts:new Set(['legacy-artifact']),
    seenEdges:new Set(['legacy-edge']),
  };
  const root=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:legacyState,refresh:()=>{}});
  const nodes=walk(root).filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.ok(nodes.length>0);
  assert.ok(nodes.every(x=>String(x.attributes?.class??'').includes('is-new')));
  assert.equal(legacyState.animationInitialized,true);
});

test('Lore growth replay replays native SVG visuals without mutating Lore data',()=>{
  const d=new FakeDocument(),state=createLoreNeuralRenderState(),data=populatedData();
  const selected={selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}};
  const original=JSON.stringify(data);

  const first=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,refresh:()=>{}});
  assert.ok(walk(first).filter(x=>x.tagName==='ANIMATE').length>0);

  for(let pass=0;pass<3;pass++)renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,refresh:()=>{}});
  const steady=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,refresh:()=>{}});
  const steadyNodes=walk(steady).filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.ok(steadyNodes.every(x=>String(x.attributes?.class??'').includes('is-steady')));
  assert.equal(walk(steady).filter(x=>x.tagName==='ANIMATE').length,0);
  assert.match(textOf(steady),/Replay Growth/);

  assert.equal(replayLoreNeuralGrowth(state),true);
  const replayed=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,refresh:()=>{}});
  const replayedNodes=walk(replayed).filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.ok(replayedNodes.every(x=>String(x.attributes?.class??'').includes('is-new')));
  const animations=walk(replayed).filter(x=>x.tagName==='ANIMATE');
  assert.ok(animations.length>0);
  assert.ok(animations.every(x=>x.attributes?.begin==='indefinite'));
  assert.ok(animations.every(x=>Number(x.attributes?.['data-a52-start-ms'])>=0));
  assert.ok(animations.some(x=>x.attributes?.attributeName==='stroke-dashoffset'));
  assert.ok(animations.some(x=>x.attributes?.attributeName==='r'));
  assert.ok(animations.some(x=>x.attributes?.attributeName==='opacity'));
  const replayCircles=walk(replayed).filter(x=>x.tagName==='CIRCLE');
  assert.ok(replayCircles.some(x=>String(x.attributes?.class??'').includes('a52-lore-entry-node__body')&&Number(x.attributes?.r)===0.5));
  assert.ok(replayCircles.some(x=>String(x.attributes?.class??'').includes('a52-lore-hub-node__body')&&Number(x.attributes?.r)===2));
  const replayDelays=replayedNodes.map(x=>Number(String(x.attributes?.style??'').match(/--a52-node-delay:(\d+)ms/)?.[1]??-1));
  assert.ok(Math.max(...replayDelays)>=500);
  assert.equal(JSON.stringify(data),original);
  assert.equal(state.replayCount,1);
});

test('reduced-motion omits native Lore reveal animations',()=>{
  const d=new FakeDocument();d.defaultView={matchMedia:query=>({matches:query.includes('prefers-reduced-motion')})};
  const state=createLoreNeuralRenderState(),data=populatedData(),selected={selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}};
  const root=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state});
  assert.equal(walk(root).filter(x=>x.tagName==='ANIMATE').length,0);
  assert.match(textOf(root),/MOTION REDUCED/);
  const nodes=walk(root).filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.ok(nodes.every(x=>!String(x.attributes?.class??'').includes('has-native-reveal')));
});

test('Lore study owner updates coalesce into live neural-canvas refreshes',()=>{
  const d=new FakeDocument(),host=new FakeNode('section',d);
  let listener=null,releases=0,refreshes=0,timeouts=0,pending=null;
  const scope={
    add(cleanup){this.cleanup=cleanup;return cleanup;},
    listen(){},
    timeout(callback){timeouts+=1;pending=callback;return callback;},
  };
  const loreStudy={
    capabilities:()=>({read:true,discover:true,accept:true,run:true,retry:false,summaries:false,subscribe:true}),
    read:()=>({source:{operationalState:'WORKING',health:'WORKING',statusToken:'observed',impact:'Study active.'},data:emptyData()}),
    selectedLorebook:()=>({selection:{selected:true,lorebookId:'moon',title:'Moon Harbor'},snapshot:{id:'moon',title:'Moon Harbor',entries:[{uid:'one',content:'One.'}]}}),
    summaries:()=>null,
    subscribe(fn){listener=fn;return()=>{releases+=1;};},
    discoverSelectedLorebook:async()=>null,
  };
  renderLoreStudySurface(host,{loreStudy,actionRouter:{route:async()=>({ok:true})},scope,refresh:()=>{refreshes+=1;},notifications:null,productAdapter:null});
  assert.equal(typeof listener,'function');
  listener({kind:'LORE_UPDATED'});listener({kind:'LORE_UPDATED'});
  assert.equal(timeouts,1);
  assert.equal(refreshes,0);
  pending();
  assert.equal(refreshes,1);
  scope.cleanup();
  assert.equal(releases,1);
});

test('Lore neural animation uses bounded native SVG reveal without JS timer loops and respects reduced motion',()=>{
  const js=readFileSync(new URL('../src/ui-core/lore-neural-graph.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../styles/ui-core-lore-neural.css',import.meta.url),'utf8');
  assert.doesNotMatch(js,/requestAnimationFrame|setInterval|setTimeout/);
  assert.match(js,/function nativeAnimate/);
  assert.match(js,/begin:'indefinite'/);
  assert.match(js,/function startNativeAnimations/);
  assert.match(js,/function scheduleNativeAnimations/);
  assert.match(js,/queueMicrotask/);
  assert.match(js,/beginElementAt/);
  assert.match(js,/attributeName:'stroke-dashoffset'/);
  assert.match(js,/attributeName:'r'/);
  assert.match(css,/has-native-reveal/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/animation:none!important/);
  assert.match(css,/\.a52-lore-neural-workspace\{/);
  assert.match(css,/height:clamp\(480px,60vh,620px\)/);
  assert.match(css,/padding:8px 0 18px/);
  assert.match(css,/@keyframes a52-lore-hub-arrival/);
  assert.match(css,/\.a52-lore-neural-canvas-head__actions/);
  const rootCss=readFileSync(new URL('../style.css',import.meta.url),'utf8');
  assert.match(rootCss,/ui-core-lore-neural\.css/);
  assert.ok(rootCss.indexOf('ui-core-lore-neural.css')>rootCss.indexOf('ui-core-console-theme.css'));
});
