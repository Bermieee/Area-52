import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createLoreNeuralRenderState, renderLoreNeuralWorkspace } from '../src/ui-core/lore-neural-graph.js';
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

test('Lore neural render state animates only newly published nodes across refreshes',()=>{
  const d=new FakeDocument(),state=createLoreNeuralRenderState(),base=populatedData();
  const first=renderLoreNeuralWorkspace(d,{data:base,selected:{selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}},progress:25,renderState:state});
  const firstEntries=walk(first).filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.equal(firstEntries.length,4);
  assert.ok(firstEntries.every(x=>String(x.attributes.class).includes('is-new')));

  const second=renderLoreNeuralWorkspace(d,{data:base,selected:{selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}},progress:25,renderState:state});
  const secondEntries=walk(second).filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.ok(secondEntries.every(x=>String(x.attributes.class).includes('is-steady')));

  const grown={...base,entries:[...base.entries,{sourceId:'lore:book:new',uid:'new-source',operatorState:'STUDYING',artifactIds:[],representations:[],retrievalReady:false,sourceRevisionId:'r5'}],operatorCounts:{...base.operatorCounts,STUDYING:2}};
  const third=renderLoreNeuralWorkspace(d,{data:grown,selected:{selection:{selected:true,lorebookId:'moon'},snapshot:{id:'moon',title:'Moon Harbor'}},progress:25,renderState:state});
  const thirdEntries=walk(third).filter(x=>String(x.attributes?.class??'').split(/\s+/).includes('a52-lore-entry-node'));
  assert.equal(thirdEntries.filter(x=>String(x.attributes.class).includes('is-new')).length,1);
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

test('Lore neural animation is CSS-only bounded and respects reduced motion',()=>{
  const js=readFileSync(new URL('../src/ui-core/lore-neural-graph.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../styles/ui-core-lore-neural.css',import.meta.url),'utf8');
  assert.doesNotMatch(js,/requestAnimationFrame|setInterval|setTimeout/);
  assert.match(css,/@keyframes a52-lore-link-grow/);
  assert.match(css,/@keyframes a52-lore-node-grow/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/animation:none!important/);
  assert.match(css,/\.a52-lore-neural-workspace\{/);
  const rootCss=readFileSync(new URL('../style.css',import.meta.url),'utf8');
  assert.match(rootCss,/ui-core-lore-neural\.css/);
  assert.ok(rootCss.indexOf('ui-core-lore-neural.css')>rootCss.indexOf('ui-core-console-theme.css'));
});
