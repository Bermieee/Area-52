import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { renderLoreNeuralWorkspace } from '../src/ui-core/lore-neural-graph.js';
import { FakeDocument } from './fixtures/wave4-synthetic-extension.mjs';

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
  const svg=nodes.find(x=>String(x.getAttribute?.('class')??'').includes('a52-lore-neural-svg'));
  assert.ok(svg);
  const entryNodes=nodes.filter(x=>String(x.getAttribute?.('class')??'').includes('a52-lore-entry-node'));
  assert.equal(entryNodes.length,4);
  const artifactNodes=nodes.filter(x=>String(x.getAttribute?.('class')??'').includes('a52-lore-artifact-node'));
  assert.equal(artifactNodes.length,1);
  entryNodes[0].dispatch('click');
  assert.equal(inspected.length,1);
  assert.equal(inspected[0].kind,'area52-lore-source-node');
  assert.equal(inspected[0].authority,'LORE_OWNER');
  assert.ok(['STUDYING','READY','ACCEPTED','FAILED'].includes(inspected[0].payload.operatorState));
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
});
