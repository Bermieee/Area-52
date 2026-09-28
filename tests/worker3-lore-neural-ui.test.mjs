import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createLoreNeuralRenderState, replayLoreNeuralGrowth, renderLoreNeuralWorkspace } from '../src/ui-core/lore-neural-graph.js';
import { FrontFacePresentationState, MotionMode, resolveMotionPolicy } from '../src/ui-core/wave6-presentation.js';
import { UIStateStore } from '../src/ui-core/persistence.js';
import { renderLoreStudySurface } from '../src/ui-core/wave13-operator-surfaces.js';
import { FakeDocument, FakeNode } from './fixtures/wave4-synthetic-extension.mjs';

function walk(node){return[node,...(node?.children??[]).flatMap(walk)];}
function textOf(node){return walk(node).map(x=>x.textContent??'').join(' ');}
function memoryStorage(){
  const map=new Map();
  return{getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),map};
}
function listenerScope(){return{listen(node,type,handler){node.addEventListener(type,handler);}};}

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
  assert.match(body,/Waiting for a Lorebook/);
  assert.match(body,/Accept the selected Lorebook, then run study to populate source nodes and learned links/);
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
  const d=new FakeDocument(),inspected=[],renderState=createLoreNeuralRenderState();
  const root=renderLoreNeuralWorkspace(d,{
    data:populatedData(),
    selected:{selection:{selected:true,title:'Moon Harbor',lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor',entries:new Array(4).fill({})}},
    source:{operationalState:'WORKING',statusToken:'observed'},
    progress:25,
    inspect:value=>inspected.push(value),
    renderState,
    scope:{listen(node,type,handler){node.addEventListener(type,handler);}},
  });
  const nodes=walk(root),body=textOf(root);
  assert.equal(root.dataset.graphState,'populated');
  assert.match(body,/World Overview/);
  assert.match(body,/Categories/);
  assert.match(body,/Filters/);
  assert.match(body,/Study State/);
  assert.match(body,/Selected Lorebook/);
  assert.match(body,/Graph growth/);
  assert.match(body,/Growth queue/);
  assert.match(body,/WORLD TREE/);
  assert.match(body,/Your world's memory, visualized/);
  assert.match(body,/Moon Harbor/);
  for(const label of ['Merge','Summarizer','Rebuild']){
    const button=nodes.find(x=>x.tagName==='BUTTON'&&x.textContent===label);
    assert.ok(button);assert.equal(Boolean(button.disabled||button.attributes?.disabled),true);assert.equal(button.dataset?.futureFeature,'true');
  }
  const search=nodes.find(x=>x.tagName==='INPUT'&&String(x.className??'').includes('a52-world-tree-search'));
  assert.ok(search);assert.equal(Boolean(search.disabled||search.attributes?.disabled),true);
  assert.equal(search.attributes?.placeholder,'Search world tree…');
  assert.doesNotMatch(body,/Character|Faction|Place|Event|Concept|Memory/);
  const svg=nodes.find(x=>x.tagName==='SVG'&&String(x.attributes?.class??'').includes('a52-lore-neural-svg'));
  assert.ok(svg);
  const entryNodes=nodes.filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.equal(entryNodes.length,4);
  const artifactNodes=nodes.filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-artifact-node'));
  assert.equal(artifactNodes.length,1);
  entryNodes[0].dispatch('pointerdown',{button:0,pointerId:17,clientX:300,clientY:300});
  assert.ok(renderState.nodeDrag);assert.equal(renderState.panGesture,null);
  entryNodes[0].dispatch('pointerup',{pointerId:17,clientX:300,clientY:300});
  entryNodes[0].dispatch('click');
  assert.equal(inspected.length,1);
  assert.equal(inspected[0].kind,'area52-lore-source-node');
  assert.equal(inspected[0].authority,'LORE_OWNER');
  assert.ok(['STUDYING','READY','ACCEPTED','FAILED'].includes(inspected[0].payload.operatorState));
  assert.equal(renderState.selectedNodeId,entryNodes[0].attributes?.['data-node-id']);
  assert.equal(renderState.selectedNodeKind,'source');
  assert.match(String(entryNodes[0].className??''),/is-selected/);
  const connected=nodes.filter(x=>String(x.className??'').includes('is-connected'));
  assert.ok(connected.length>=1);
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
  const toneByLabel=new Map(hubs.map(hub=>[textOf(hub).replace(/\s+/g,' ').trim().toLowerCase(),hub.attributes?.['data-tone']]));
  assert.ok([...toneByLabel].some(([label,tone])=>label.includes('character')&&tone==='violet'));
  assert.ok([...toneByLabel].some(([label,tone])=>label.includes('faction')&&tone==='blue'));
  assert.ok([...toneByLabel].some(([label,tone])=>label.includes('place')&&tone==='green'));
  assert.match(body,/Mara/);assert.match(body,/Moon Harbor/);assert.match(body,/Lantern Guild/);
});

test('cluster click selects and updates detail state without snapping the camera',()=>{
  const d=new FakeDocument(),state=createLoreNeuralRenderState(),refreshes=[];
  const data={
    kind:'Wave13LoreStudySurface',
    entries:[
      {sourceId:'lore:zoom:a',uid:'a',operatorState:'READY',artifactIds:[],representations:[],retrievalReady:true,sourceRevisionId:'r1'},
      {sourceId:'lore:zoom:b',uid:'b',operatorState:'READY',artifactIds:[],representations:[],retrievalReady:true,sourceRevisionId:'r2'},
      {sourceId:'lore:zoom:c',uid:'c',operatorState:'READY',artifactIds:[],representations:[],retrievalReady:true,sourceRevisionId:'r3'},
      {sourceId:'lore:zoom:d',uid:'d',operatorState:'READY',artifactIds:[],representations:[],retrievalReady:true,sourceRevisionId:'r4'},
    ],
    operatorCounts:{ACCEPTED:0,STUDYING:0,READY:4,FAILED:0,REMOVED:0},artifacts:[],conflicts:[],revision:1,retrievalReady:4,
  };
  const selected={selection:{selected:true,title:'Zoom Lore',lorebookId:'zoom'},snapshot:{id:'zoom',title:'Zoom Lore',entries:[
    {uid:'a',metadata:{title:'A',category:'Character'}},{uid:'b',metadata:{title:'B',category:'Character'}},
    {uid:'c',metadata:{title:'C',category:'Place'}},{uid:'d',metadata:{title:'D',category:'Place'}},
  ]}};
  const root=renderLoreNeuralWorkspace(d,{data,selected,progress:100,renderState:state,refresh:()=>refreshes.push('refresh'),scope:listenerScope()});
  const nodes=walk(root),svg=nodes.find(x=>x.tagName==='SVG'&&String(x.attributes?.class??'').includes('a52-lore-neural-svg'));
  const hubs=nodes.filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-hub-node'));
  assert.equal(hubs.length,2);
  const before=String(svg.attributes?.viewBox);
  hubs[0].dispatch('click');
  assert.equal(state.selectedNodeKind,'hub');
  assert.equal(state.selectedNodeId,hubs[0].attributes?.['data-node-id']);
  assert.equal(state.focusHubId,null);
  assert.match(String(hubs[0].className??''),/is-selected/);
  assert.equal(String(svg.attributes?.viewBox),before);
  assert.equal(refreshes.length,1);
  const rerender=renderLoreNeuralWorkspace(d,{data,selected,progress:100,renderState:state,refresh:()=>{},scope:listenerScope()});
  const rerenderBody=textOf(rerender);
  assert.match(rerenderBody,/Selected UID/);
  assert.match(rerenderBody,/Cluster/);
  assert.match(rerenderBody,/Direct graph relationships/);
});

test('source click renders truthful UID details in the right rail without moving viewport',()=>{
  const d=new FakeDocument(),state=createLoreNeuralRenderState(),refreshes=[];
  const data={
    kind:'Wave13LoreStudySurface',
    entries:[{sourceId:'lore:uid:mara',uid:'uid-mara',operatorState:'READY',artifactIds:['a1','a2'],representations:[{id:'rep1'}],retrievalReady:true,sourceRevisionId:'rev-42'}],
    operatorCounts:{ACCEPTED:0,STUDYING:0,READY:1,FAILED:0,REMOVED:0},artifacts:[],conflicts:[],revision:'graph-7',retrievalReady:1,
  };
  const selected={selection:{selected:true,title:'UID Lore',lorebookId:'uid'},snapshot:{id:'uid',title:'UID Lore',entries:[
    {uid:'uid-mara',metadata:{title:'Mara Vex',category:'Character',treePath:['Character','Primary']}},
  ]}};
  const root=renderLoreNeuralWorkspace(d,{data,selected,progress:100,renderState:state,refresh:()=>refreshes.push('refresh'),scope:listenerScope()});
  const nodes=walk(root),svg=nodes.find(x=>x.tagName==='SVG'&&String(x.attributes?.class??'').includes('a52-lore-neural-svg'));
  const source=nodes.find(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  const before=String(svg.attributes?.viewBox);
  source.dispatch('click');
  assert.equal(String(svg.attributes?.viewBox),before);
  assert.equal(state.selectedNodeId,'lore:uid:mara');
  assert.equal(refreshes.length,1);
  const detail=renderLoreNeuralWorkspace(d,{data,selected,progress:100,renderState:state,refresh:()=>{},scope:listenerScope()});
  const body=textOf(detail);
  assert.match(body,/Selected UID/);assert.match(body,/uid-mara/);assert.match(body,/Mara Vex/);assert.match(body,/Character/);
  assert.match(body,/rev-42/);assert.match(body,/1/);assert.match(body,/2/);assert.match(body,/Character › Primary/);
  assert.match(body,/Connections/);assert.match(body,/Direct graph relationships/);
  assert.match(body,/Narrative Intelligence/);
  assert.match(body,/Pending Scene Intelligence/);
  assert.match(body,/Not yet published/);
  assert.match(body,/does not infer these fields from Lore text today/);
});


test('dragging a Lore bubble moves it keeps live connections and persists without Lore mutation',()=>{
  const d=new FakeDocument(),state=createLoreNeuralRenderState(),data=populatedData(),original=JSON.stringify(data);
  const selected={selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}};
  const root=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,scope:listenerScope()});
  const nodes=walk(root),svg=nodes.find(x=>x.tagName==='SVG'&&String(x.attributes?.class??'').includes('a52-lore-neural-svg'));
  const source=nodes.find(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.ok(svg);assert.ok(source);
  const id=source.attributes?.['data-node-id'];
  const circle=source.children.find(child=>child.tagName==='CIRCLE'&&String(child.attributes?.class??'').includes('a52-lore-entry-node__body'));
  const beforeX=Number(circle.attributes?.cx),beforeY=Number(circle.attributes?.cy);
  const edge=nodes.find(x=>x.tagName==='PATH'&&(x.attributes?.['data-from-id']===id||x.attributes?.['data-to-id']===id));
  assert.ok(edge);const beforePath=String(edge.attributes?.d);

  source.dispatch('pointerdown',{button:0,pointerId:22,clientX:300,clientY:250});
  assert.ok(state.nodeDrag);assert.equal(state.panGesture,null);
  source.dispatch('pointermove',{pointerId:22,clientX:420,clientY:330});
  source.dispatch('pointerup',{pointerId:22,clientX:420,clientY:330});
  assert.equal(state.nodeDrag,null);
  assert.ok(state.nodePositions[id]);
  assert.notEqual(Number(circle.attributes?.cx),beforeX);
  assert.notEqual(Number(circle.attributes?.cy),beforeY);
  assert.notEqual(String(edge.attributes?.d),beforePath);
  assert.equal(JSON.stringify(data),original);

  source.dispatch('click');
  assert.notEqual(state.selectedNodeId,id);
  source.dispatch('click');
  assert.equal(state.selectedNodeId,id);

  const rerender=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,scope:listenerScope()});
  const moved=walk(rerender).find(x=>x.attributes?.['data-node-id']===id);
  const movedCircle=moved.children.find(child=>child.tagName==='CIRCLE'&&String(child.attributes?.class??'').includes('a52-lore-entry-node__body'));
  assert.equal(Number(movedCircle.attributes?.cx),Number(state.nodePositions[id].x));
  assert.equal(Number(movedCircle.attributes?.cy),Number(state.nodePositions[id].y));
  assert.equal(JSON.stringify(data),original);

  const reset=walk(rerender).find(x=>x.tagName==='BUTTON'&&x.textContent==='Reset Layout');
  assert.ok(reset);reset.dispatch('click');
  assert.deepEqual(state.nodePositions,{});
});

test('Lore graph sandbox supports bounded drag pan wheel zoom and reset',()=>{
  const d=new FakeDocument(),state=createLoreNeuralRenderState(),refreshes=[];
  const data=populatedData(),selected={selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}};
  const root=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,refresh:()=>refreshes.push('refresh'),scope:listenerScope()});
  const nodes=walk(root),svg=nodes.find(x=>x.tagName==='SVG'&&String(x.attributes?.class??'').includes('a52-lore-neural-svg'));
  assert.ok(svg);assert.equal(svg.attributes?.viewBox,'0 0 1000 760');
  assert.equal(svg.attributes?.['data-zoom-level'],'overview');
  const sourceLabels=nodes.filter(x=>String(x.attributes?.class??'').includes('a52-lore-entry-node__label'));
  assert.ok(sourceLabels.length>0);

  svg.dispatch('pointerdown',{button:0,pointerId:3,clientX:500,clientY:350});
  svg.dispatch('pointermove',{pointerId:3,clientX:650,clientY:430});
  svg.dispatch('pointerup',{pointerId:3,clientX:650,clientY:430});
  assert.ok(state.viewport);
  assert.notEqual(svg.attributes?.viewBox,'0 0 1000 760');
  const panned=String(svg.attributes?.viewBox);

  svg.dispatch('wheel',{deltaY:-120,offsetX:640,offsetY:300});
  assert.notEqual(svg.attributes?.viewBox,panned);
  const zoomed=String(svg.attributes?.viewBox).split(/\s+/).map(Number);
  assert.ok(zoomed[2]<1000);assert.ok(zoomed[2]>=250);

  for(let i=0;i<20;i++)svg.dispatch('wheel',{deltaY:-120,offsetX:640,offsetY:300});
  const minZoom=String(svg.attributes?.viewBox).split(/\s+/).map(Number);
  assert.ok(minZoom[2]>=250);
  assert.equal(svg.attributes?.['data-zoom-level'],'close');
  for(let i=0;i<30;i++)svg.dispatch('wheel',{deltaY:120,offsetX:640,offsetY:300});
  const maxZoom=String(svg.attributes?.viewBox).split(/\s+/).map(Number);
  assert.ok(maxZoom[2]<=1180);

  const fullGraph=nodes.find(x=>x.tagName==='BUTTON'&&x.textContent==='Full Graph');
  assert.ok(fullGraph);fullGraph.dispatch('click');
  assert.equal(state.viewport,null);assert.equal(state.focusHubId,null);assert.equal(refreshes.length,1);
  const rerender=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,refresh:()=>{},scope:listenerScope()});
  const resetSvg=walk(rerender).find(x=>x.tagName==='SVG'&&String(x.attributes?.class??'').includes('a52-lore-neural-svg'));
  assert.equal(resetSvg.attributes?.viewBox,'0 0 1000 760');
});

test('artifact bubbles lock fluorescent selection without mutating Lore data',()=>{
  const d=new FakeDocument(),state=createLoreNeuralRenderState(),data=populatedData(),original=JSON.stringify(data);
  const selected={selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}};
  const root=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,scope:listenerScope()});
  const nodes=walk(root),artifact=nodes.find(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-artifact-node'));
  assert.ok(artifact);artifact.dispatch('click');
  assert.equal(state.selectedNodeKind,'artifact');assert.equal(state.selectedNodeId,artifact.attributes?.['data-node-id']);
  assert.match(String(artifact.className??''),/is-selected/);
  assert.ok(nodes.some(x=>String(x.className??'').includes('is-connected')));
  assert.equal(JSON.stringify(data),original);
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
  assert.deepEqual([...new Set(hubDelays)],[1750]);
  const trunkLinks=nodes.filter(x=>x.tagName==='PATH'&&x.attributes?.['data-from-id']==='core');
  assert.equal(trunkLinks.length,7);
  const trunkDelays=trunkLinks.map(x=>Number(String(x.attributes?.style??'').match(/--a52-link-delay:(\d+)ms/)?.[1]??-1));
  assert.deepEqual([...new Set(trunkDelays)],[650]);
  const sourceDelays=sourceNodes.map(x=>Number(String(x.attributes?.style??'').match(/--a52-node-delay:(\d+)ms/)?.[1]??-1));
  assert.ok(Math.min(...sourceDelays)>=3200);
  assert.ok(Math.max(...sourceDelays)>=4100);
  assert.ok(Math.max(...sourceDelays)-Math.min(...sourceDelays)>=900);
  assert.ok(sourceNodes.every(x=>x.attributes?.['data-state']==='READY'));
  assert.equal(sourceNodes.length,54);
  assert.equal(artifactNodes.length,1);
  assert.match(body,/Presentation clusters until categories are published/);
  assert.match(body,/Layout-only clusters do not add semantic meaning to Lore/);
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
  const root=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,motionMode:'SYSTEM'});
  assert.equal(walk(root).filter(x=>x.tagName==='ANIMATE').length,0);
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

test('Area-52 motion policy defaults to Full persists and migrates legacy Lore mode',()=>{
  const storage=memoryStorage(),store=new UIStateStore({storage,namespace:'motion-policy-test'});
  const first=new FrontFacePresentationState({stateStore:store});
  assert.equal(first.get().motionMode,MotionMode.FULL);
  first.setMotionMode(MotionMode.REDUCED);
  assert.equal(new FrontFacePresentationState({stateStore:store}).get().motionMode,MotionMode.REDUCED);

  const legacyStore={load:()=>({loreMotionMode:'SYSTEM'}),save(){}};
  assert.equal(new FrontFacePresentationState({stateStore:legacyStore}).get().motionMode,MotionMode.SYSTEM);
  assert.deepEqual(resolveMotionPolicy(MotionMode.FULL,{systemReduced:true}),{mode:'FULL',reduced:false,enabled:true,systemReduced:true,ignoresSystemPreference:true});
  assert.equal(resolveMotionPolicy(MotionMode.SYSTEM,{systemReduced:true}).enabled,false);
  assert.equal(resolveMotionPolicy(MotionMode.REDUCED,{systemReduced:false}).enabled,false);
});

test('Full global motion overrides system reduced-motion without Lore-specific controls',()=>{
  const d=new FakeDocument();d.defaultView={matchMedia:()=>({matches:true})};
  const state=createLoreNeuralRenderState(),data=populatedData(),selected={selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}};
  const root=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,motionMode:'FULL',refresh:()=>{},scope:listenerScope()});
  assert.ok(walk(root).filter(x=>x.tagName==='ANIMATE').length>0);
  assert.equal(walk(root).some(x=>x.tagName==='SELECT'&&String(x.className??'').includes('a52-lore-motion-select')),false);
  assert.doesNotMatch(textOf(root),/MOTION FULL|SYSTEM · REDUCED|MOTION REDUCED/);
  assert.match(textOf(root),/Replay Growth/);
});

test('Reduced global motion suppresses Lore animation on a motion-enabled system',()=>{
  const d=new FakeDocument();d.defaultView={matchMedia:()=>({matches:false})};
  const state=createLoreNeuralRenderState(),data=populatedData(),selected={selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}};
  const root=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,motionMode:'REDUCED'});
  assert.equal(walk(root).filter(x=>x.tagName==='ANIMATE').length,0);
  const replay=walk(root).find(x=>x.tagName==='BUTTON'&&x.textContent==='Replay Growth');
  assert.ok(replay);assert.equal(Boolean(replay.disabled||replay.attributes?.disabled),true);
});

test('System global motion honors browser reduced-motion',()=>{
  const d=new FakeDocument();d.defaultView={matchMedia:()=>({matches:true})};
  const state=createLoreNeuralRenderState(),data=populatedData(),selected={selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}};
  const root=renderLoreNeuralWorkspace(d,{data,selected,progress:25,renderState:state,motionMode:'SYSTEM'});
  assert.equal(walk(root).filter(x=>x.tagName==='ANIMATE').length,0);
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
  assert.match(js,/CENTER_TRUNK_START_MS=650/);
  assert.match(js,/HUB_BLOOM_START_MS=1750/);
  assert.match(js,/SOURCE_INNER_START_MS=3200/);
  assert.match(js,/SOURCE_RING_GAP_MS=900/);
  assert.match(js,/hubRadius=grouped\.length<=2\?220:grouped\.length<=4\?240:258/);
  assert.match(js,/const radius=76\+ring\*44\+jitter/);
  assert.match(js,/coreTitle\.textContent='WORLD TREE'/);
  assert.doesNotMatch(js,/index\*INITIAL_WAVE_SPACING_MS/);
  assert.doesNotMatch(js,/focusHubId=hub\.id/);
  assert.match(js,/dur:1500/);
  assert.match(js,/dur:1250/);
  assert.match(js,/dur:950/);
  assert.match(css,/has-native-reveal/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/animation:none!important/);
  assert.match(css,/\.a52-lore-neural-workspace\{/);
  assert.match(css,/height:clamp\(620px,72vh,820px\)/);
  assert.match(css,/padding:8px 0 18px/);
  assert.match(css,/@keyframes a52-lore-hub-arrival/);
  assert.match(css,/\.a52-lore-neural-canvas-head__actions/);
  assert.match(css,/\.a52-world-overview__stats/);
  assert.match(css,/\.a52-world-category-row/);
  assert.match(css,/\.a52-world-filter-row/);
  assert.match(css,/\.a52-world-tree-search/);
  assert.match(css,/@keyframes a52-lore-core-pulse\{0%,100%\{r:92/);
  const rootCss=readFileSync(new URL('../style.css',import.meta.url),'utf8');
  assert.match(rootCss,/ui-core-lore-neural\.css/);
  assert.ok(rootCss.indexOf('ui-core-lore-neural.css')>rootCss.indexOf('ui-core-console-theme.css'));
});
