import { createButton, createKeyValue, element, makeBadge } from './primitives.js';
import { resolveMotionPolicy } from './wave6-presentation.js';

const STATE_ORDER=['READY','STUDYING','ACCEPTED','FAILED','REMOVED'];
const REVEAL_RENDER_PASSES=4;
const STATE_META={
  READY:{label:'Ready',tone:'ready',color:'#3ce4b1',symbol:'✓'},
  STUDYING:{label:'Studying',tone:'observed',color:'#42c7ff',symbol:'◌'},
  ACCEPTED:{label:'Due',tone:'warning',color:'#f1bb55',symbol:'•'},
  FAILED:{label:'Failed',tone:'warning',color:'#ff677e',symbol:'!'},
  REMOVED:{label:'Removed',tone:'historical',color:'#72899b',symbol:'×'},
};

export function createLoreNeuralRenderState(){
  return{lorebookKey:null,seenHubs:new Set(),seenNodes:new Set(),seenArtifacts:new Set(),seenEdges:new Set(),replayCount:0,animationInitialized:false,revealPassesRemaining:0};
}
export function replayLoreNeuralGrowth(state){
  if(!state)return false;
  state.seenHubs?.clear?.();state.seenNodes?.clear?.();state.seenArtifacts?.clear?.();state.seenEdges?.clear?.();
  state.replayCount=Number(state.replayCount??0)+1;
  state.revealPassesRemaining=REVEAL_RENDER_PASSES;
  return true;
}

export function renderLoreNeuralWorkspace(doc,{
  data=null,source=null,selected=null,progress=0,scope=null,inspect=null,renderState=null,refresh=null,motionMode='FULL',
}={}){
  const entries=Array.isArray(data?.entries)?data.entries:[],counts=data?.operatorCounts??{},snapshot=selected?.snapshot??null;
  const graphActive=entries.some(row=>['STUDYING','READY','FAILED'].includes(String(row?.operatorState??'').toUpperCase()));
  const root=element(doc,'section',{className:'a52-lore-neural-workspace',attrs:{'aria-label':'Lore neural knowledge graph'}});
  const left=renderStudyRail(doc,{data,source,counts,progress,selected});
  const center=renderGraphPanel(doc,{data,selected,progress,scope,inspect,renderState,refresh,motionMode});
  const right=renderLoreInsightRail(doc,{data,selected,progress});
  root.append(left,center,right);
  root.dataset.graphState=graphActive?'populated':entries.length?'armed':snapshot?'loaded':'blank';
  return root;
}

function renderStudyRail(doc,{data,source,counts,progress,selected}={}){
  const rail=element(doc,'aside',{className:'a52-lore-neural-rail a52-lore-neural-rail--left'});
  const progressCard=panel(doc,'What Lore is doing now','Owner-reported study progress','◉');
  progressCard.root.classList?.add?.('a52-lore-neural-progress-card');
  const total=STATE_ORDER.reduce((sum,key)=>sum+Number(counts?.[key]??0),0);
  const ring=element(doc,'div',{className:'a52-lore-progress-ring',attrs:{role:'img','aria-label':'Lore readiness '+progress+' percent'},dataset:{progress:String(progress)}});
  ring.setAttribute?.('style','--a52-lore-progress:'+Math.max(0,Math.min(100,Number(progress)||0))+'%');
  ring.append(element(doc,'strong',{text:String(progress)+'%'}),element(doc,'span',{text:String(Number(counts?.READY??0))+' / '+String(Math.max(0,total-Number(counts?.REMOVED??0)))+' ready'}));
  const legend=element(doc,'div',{className:'a52-lore-state-legend'});
  for(const state of STATE_ORDER){
    const meta=STATE_META[state],row=element(doc,'div',{className:'a52-lore-state-legend__row',dataset:{state}});
    row.append(element(doc,'span',{className:'a52-lore-state-dot',text:meta.symbol}),element(doc,'strong',{text:meta.label}),element(doc,'span',{text:String(Number(counts?.[state]??0))}));
    legend.append(row);
  }
  const top=element(doc,'div',{className:'a52-lore-progress-overview'});top.append(ring,legend);progressCard.body.append(top);
  progressCard.body.append(element(doc,'p',{className:'a52-lore-neural-contract',text:'DUE for study '+String(Number(counts?.ACCEPTED??0))+' · STUDYING now '+String(Number(counts?.STUDYING??0))+' · READY '+String(Number(counts?.READY??0))}),element(doc,'p',{className:'a52-muted a52-lore-neural-explainer',text:
    Number(counts?.FAILED??0)>0?'Study needs attention. Failed sources stay visible and are not treated as retrieval-ready.'
    :Number(counts?.STUDYING??0)>0?'Study is active. Nodes and links appear as the Lore owner publishes current learned representations.'
    :Number(counts?.ACCEPTED??0)>0?'DUE = accepted but not learned/current. Run pending study to grow retrieval-ready nodes.'
    :Number(counts?.READY??0)>0?'All currently counted learned sources shown in green are owner-reported READY.'
    :'Load and accept a selected Lorebook to begin growing the graph.'}));
  const state=source?.operationalState??source?.health??'IDLE';
  progressCard.body.append(makeBadge(doc,'LORE OWNER · '+String(state),source?.statusToken??'historical'));

  const categoryCounts=semanticCategoryCounts(selected?.snapshot,data?.entries??[]);
  const neutralClusterCount=categoryCounts.length?0:presentationClusterCount(data?.entries??[]);
  const legendCard=panel(doc,'Graph legend',categoryCounts.length?'Published source categories + owner study states':'Presentation clusters + real owner study states','⌘');
  categoryCounts.slice(0,7).forEach(([category,count],index)=>{const row=element(doc,'div',{className:'a52-lore-graph-legend-row a52-lore-graph-legend-row--category',dataset:{tone:SEMANTIC_TONES[index%SEMANTIC_TONES.length]}});row.append(element(doc,'span',{className:'a52-lore-category-dot'}),element(doc,'span',{text:category}),element(doc,'strong',{text:String(count)}));legendCard.body.append(row);});
  if(neutralClusterCount){
    const row=element(doc,'div',{className:'a52-lore-graph-legend-row a52-lore-graph-legend-row--structure',dataset:{tone:'cyan'}});
    row.append(element(doc,'span',{className:'a52-lore-category-dot'}),element(doc,'span',{text:'Source clusters · layout only'}),element(doc,'strong',{text:String(neutralClusterCount)}));legendCard.body.append(row);
    legendCard.body.append(element(doc,'p',{className:'a52-muted a52-lore-graph-legend-note',text:'Cluster membership is presentation-only. READY / STUDYING / DUE / FAILED still comes only from the Lore owner.'}));
  }
  for(const state of STATE_ORDER){
    const meta=STATE_META[state],row=element(doc,'div',{className:'a52-lore-graph-legend-row',dataset:{state}});
    row.append(element(doc,'span',{className:'a52-lore-state-dot',text:meta.symbol}),element(doc,'span',{text:meta.label}),element(doc,'strong',{text:String(Number(counts?.[state]??0))}));
    legendCard.body.append(row);
  }
  const artifactLegend=element(doc,'div',{className:'a52-lore-graph-legend-row',dataset:{state:'ARTIFACT'}});artifactLegend.append(element(doc,'span',{className:'a52-lore-state-dot',text:'◇'}),element(doc,'span',{text:'Derived artifact / representation'}),element(doc,'strong',{text:String(data?.artifacts?.length??0)}));legendCard.body.append(artifactLegend);

  rail.append(progressCard.root,legendCard.root);
  return rail;
}

function renderGraphPanel(doc,{data,selected,progress,scope,inspect,renderState,refresh,motionMode='FULL'}={}){
  const entries=Array.isArray(data?.entries)?data.entries:[],snapshot=selected?.snapshot??null;
  const graphActive=entries.some(row=>['STUDYING','READY','FAILED'].includes(String(row?.operatorState??'').toUpperCase()));
  const systemReduced=prefersReducedMotion(doc),motionPolicy=resolveMotionPolicy(motionMode,{systemReduced}),nativeMotion=motionPolicy.enabled;
  const panelRoot=element(doc,'section',{className:'a52-lore-neural-canvas-card'});
  const head=element(doc,'header',{className:'a52-lore-neural-canvas-head'});
  const title=element(doc,'div');
  title.append(element(doc,'span',{className:'a52-eyebrow',text:'LIVE LORE GRAPH'}),element(doc,'h2',{text:snapshot?.title??selected?.selection?.title??'Lore Knowledge Canvas'}));
  const badge=makeBadge(doc,graphActive?(Number(data?.operatorCounts?.STUDYING??0)>0?'GROWING':'POPULATED'):entries.length?'ARMED':'BLANK CANVAS',graphActive?'observed':entries.length?'warning':'historical');
  const headActions=element(doc,'div',{className:'a52-lore-neural-canvas-head__actions'});
  headActions.append(badge);
  if(graphActive&&renderState){
    headActions.append(createButton(doc,{label:'Replay Growth',scope,size:'sm',variant:'secondary',disabled:!motionPolicy.enabled,onPress:()=>{
      replayLoreNeuralGrowth(renderState);
      refresh?.();
    }}));
  }
  head.append(title,headActions);panelRoot.append(head);

  const canvas=element(doc,'div',{className:'a52-lore-neural-canvas'});
  if(!entries.length||!graphActive){
    canvas.append(renderEmptyCanvas(doc,{loaded:Boolean(snapshot),accepted:entries.length>0}));
    panelRoot.append(canvas,canvasFooter(doc,entries.length?'Lore is accepted. Run pending study; source nodes appear only after owner study evidence begins publishing.':'Accept the selected Lorebook, then run study to populate source nodes and learned links.'));
    return panelRoot;
  }

  const graph=buildLoreGraph({entries,data,selected});
  const growth=growthState(renderState,selected,graph);
  const svg=svgEl(doc,'svg',{'viewBox':'0 0 1000 760','class':'a52-lore-neural-svg','role':'img','aria-label':'Circular Lore source and representation graph'});
  const defs=svgEl(doc,'defs');
  const filter=svgEl(doc,'filter',{'id':'a52-lore-glow','x':'-60%','y':'-60%','width':'220%','height':'220%'});
  filter.append(svgEl(doc,'feGaussianBlur',{'stdDeviation':'4','result':'blur'}),svgEl(doc,'feMerge',{},[svgEl(doc,'feMergeNode',{'in':'blur'}),svgEl(doc,'feMergeNode',{'in':'SourceGraphic'})]));
  defs.append(filter);svg.append(defs);
  svg.append(svgEl(doc,'circle',{'cx':'500','cy':'380','r':'300','class':'a52-lore-orbit a52-lore-orbit--outer'}),svgEl(doc,'circle',{'cx':'500','cy':'380','r':'228','class':'a52-lore-orbit'}),svgEl(doc,'circle',{'cx':'500','cy':'380','r':'148','class':'a52-lore-orbit a52-lore-orbit--inner'}));

  for(const edge of graph.edges){
    const isNew=growth.newEdges.has(edge.id),delay=animationDelay(edge,growth);
    const path=svgEl(doc,'path',{
      d:curve(edge.from.x,edge.from.y,edge.to.x,edge.to.y),
      class:'a52-lore-neural-link '+(edge.kind==='artifact'?'a52-lore-neural-link--artifact ':'')+(isNew?'is-new':'is-steady')+(isNew&&nativeMotion?' has-native-reveal':''),
      'data-state':edge.state,'data-tone':edge.tone??null,'data-wave':edge.wave??null,
      'style':'--a52-link-delay:'+String(delay)+'ms'+(isNew&&nativeMotion?';stroke-dasharray:1;stroke-dashoffset:1;animation:none':''),
      'pathLength':isNew&&nativeMotion?'1':null,
    });
    if(isNew&&nativeMotion)path.append(nativeAnimate(doc,{attributeName:'stroke-dashoffset',from:'1',to:'0',begin:delay,dur:760}));
    svg.append(path);
  }

  const core=svgEl(doc,'g',{'class':'a52-lore-core-node','tabindex':'0','role':'button','aria-label':'Selected Lorebook core'});
  core.append(svgEl(doc,'circle',{'cx':'500','cy':'380','r':'72','class':'a52-lore-core-node__halo'}),svgEl(doc,'circle',{'cx':'500','cy':'380','r':'55','class':'a52-lore-core-node__body'}));
  const coreTitle=svgEl(doc,'text',{'x':'500','y':'370','text-anchor':'middle','class':'a52-lore-core-node__title'});coreTitle.textContent='LORE';
  const coreCount=svgEl(doc,'text',{'x':'500','y':'394','text-anchor':'middle','class':'a52-lore-core-node__count'});coreCount.textContent=String(entries.length)+' sources';
  const coreProgress=svgEl(doc,'text',{'x':'500','y':'415','text-anchor':'middle','class':'a52-lore-core-node__meta'});coreProgress.textContent=String(progress)+'% ready';
  core.append(coreTitle,coreCount,coreProgress);svg.append(core);

  for(const hub of graph.hubs){
    const isNew=growth.newHubs.has(hub.id),delay=animationDelay(hub,growth);
    const g=svgEl(doc,'g',{'class':'a52-lore-hub-node '+(isNew?'is-new':'is-steady')+(isNew&&nativeMotion?' has-native-reveal':''),'data-state':hub.state,'data-tone':hub.tone??null,'data-wave':hub.wave??null,'tabindex':'0','role':'button','aria-label':hub.label+' '+hub.count});
    g.setAttribute('style','--a52-node-delay:'+String(delay)+'ms');
    const halo=svgEl(doc,'circle',{'cx':String(hub.x),'cy':String(hub.y),'r':isNew&&nativeMotion?'5':'42','class':'a52-lore-hub-node__halo'});
    const body=svgEl(doc,'circle',{'cx':String(hub.x),'cy':String(hub.y),'r':isNew&&nativeMotion?'2':'31','class':'a52-lore-hub-node__body'});
    const t=svgEl(doc,'text',{'x':String(hub.x),'y':String(hub.y-2),'text-anchor':'middle','class':'a52-lore-hub-node__title'});t.textContent=hub.label.toUpperCase();
    const count=svgEl(doc,'text',{'x':String(hub.x),'y':String(hub.y+16),'text-anchor':'middle','class':'a52-lore-hub-node__count'});count.textContent=String(hub.count);
    if(isNew&&nativeMotion){
      halo.append(nativeAnimate(doc,{attributeName:'r',from:'5',to:'42',begin:delay,dur:620}));
      body.append(nativeAnimate(doc,{attributeName:'r',from:'2',to:'31',begin:delay+55,dur:520}));
      t.setAttribute('opacity','0');count.setAttribute('opacity','0');
      t.append(nativeAnimate(doc,{attributeName:'opacity',from:'0',to:'1',begin:delay+250,dur:280}));
      count.append(nativeAnimate(doc,{attributeName:'opacity',from:'0',to:'1',begin:delay+300,dur:280}));
    }
    g.append(halo,body,t,count);svg.append(g);
  }

  for(const node of graph.nodes){
    const isNew=growth.newNodes.has(node.id),delay=animationDelay(node,growth);
    const g=svgEl(doc,'g',{'class':'a52-lore-entry-node '+(isNew?'is-new':'is-steady')+(isNew&&nativeMotion?' has-native-reveal':''),'data-state':node.state,'data-tone':node.tone??null,'data-wave':node.wave??null,'tabindex':'0','role':'button','aria-label':'Lore source '+node.label+' '+node.state});
    g.setAttribute('style','--a52-node-delay:'+String(delay)+'ms');
    const radius=node.artifactCount?10:8;
    const halo=svgEl(doc,'circle',{'cx':String(node.x),'cy':String(node.y),'r':isNew&&nativeMotion?'1':String(radius+5),'class':'a52-lore-entry-node__halo'});
    const body=svgEl(doc,'circle',{'cx':String(node.x),'cy':String(node.y),'r':isNew&&nativeMotion?'0.5':String(radius),'class':'a52-lore-entry-node__body'});
    if(isNew&&nativeMotion){
      halo.append(nativeAnimate(doc,{attributeName:'r',from:'1',to:String(radius+5),begin:delay,dur:420}));
      body.append(nativeAnimate(doc,{attributeName:'r',from:'0.5',to:String(radius),begin:delay+35,dur:360}));
    }
    g.append(halo,body);
    const title=svgEl(doc,'title');title.textContent=node.label+' · '+node.state+(node.artifactCount?' · '+node.artifactCount+' artifacts':'');g.append(title);
    const activate=()=>inspect?.({kind:'area52-lore-source-node',id:node.id,title:node.label,authority:'LORE_OWNER',payload:node.payload});
    scope?.listen?.(g,'click',activate);scope?.listen?.(g,'keydown',event=>{if(event?.key==='Enter'||event?.key===' '){event.preventDefault?.();activate();}});
    svg.append(g);
  }
  for(const node of graph.artifacts){
    const isNew=growth.newArtifacts.has(node.id),delay=animationDelay(node,growth);
    const g=svgEl(doc,'g',{'class':'a52-lore-artifact-node '+(isNew?'is-new':'is-steady')+(isNew&&nativeMotion?' has-native-reveal':''),'data-state':node.state,'data-tone':node.tone??null,'data-wave':node.wave??null,'tabindex':'0','role':'button','aria-label':'Derived Lore artifact group '+node.label});
    g.setAttribute('style','--a52-node-delay:'+String(delay)+'ms');
    const radius=Math.min(9,4+Math.log2(Number(node.count??1)+1));
    const body=svgEl(doc,'circle',{'cx':String(node.x),'cy':String(node.y),'r':isNew&&nativeMotion?'0.5':String(radius),'class':'a52-lore-artifact-node__body'});
    if(isNew&&nativeMotion)body.append(nativeAnimate(doc,{attributeName:'r',from:'0.5',to:String(radius),begin:delay,dur:320}));
    g.append(body);
    const title=svgEl(doc,'title');title.textContent=node.label;g.append(title);svg.append(g);
  }
  canvas.append(svg);
  if(nativeMotion)scheduleNativeAnimations(svg,doc);
  panelRoot.append(canvas,canvasFooter(doc,graph.visibleSourceCount+' of '+graph.totalSourceCount+' source nodes shown · topology uses published structure or presentation-only clusters; state colors remain owner-reported.'));
  return panelRoot;
}

function renderEmptyCanvas(doc,{loaded=false,accepted=false}={}){
  const empty=element(doc,'div',{className:'a52-lore-neural-empty'});
  const rings=element(doc,'div',{className:'a52-lore-neural-empty__rings'});
  rings.append(element(doc,'span'),element(doc,'span'),element(doc,'span'));
  const core=element(doc,'div',{className:'a52-lore-neural-empty__core'});
  core.append(element(doc,'strong',{text:'LORE'}),element(doc,'span',{text:'blank canvas'}));
  empty.append(rings,core,element(doc,'h3',{text:accepted?'Lore accepted — graph armed':loaded?'Source loaded — ready to accept':'Waiting for a Lorebook'}),element(doc,'p',{className:'a52-muted',text:accepted?'Run pending study. Nodes and links will begin growing only when the Lore owner publishes active/current study evidence.':loaded?'Accept this verified source, then run pending study. The neural graph will grow from owner-published study state.':'Select a SillyTavern Lorebook and load it. Area-52 will not invent nodes before a real source is accepted.'}));
  return empty;
}

function renderLoreInsightRail(doc,{data,selected,progress}={}){
  const rail=element(doc,'aside',{className:'a52-lore-neural-rail a52-lore-neural-rail--right'}),entries=data?.entries??[],snapshot=selected?.snapshot??null;
  const book=panel(doc,'Selected Lorebook','Current SillyTavern source','▤');
  book.body.append(createKeyValue(doc,[
    {key:'Title',value:snapshot?.title??selected?.selection?.title??'Not loaded'},
    {key:'Lorebook ID',value:snapshot?.id??selected?.selection?.lorebookId??'NO_EVIDENCE'},
    {key:'Entries',value:snapshot?.entries?.length??entries.length??0},
    {key:'Readiness',value:String(progress)+'%'},
    {key:'Graph revision',value:shortGraphRevision(data?.revision)},
  ]));

  const activity=panel(doc,'Graph growth','What the owner has published','⇄');
  const represented=entries.filter(row=>Array.isArray(row.representations)&&row.representations.length).length;
  const retrieval=entries.filter(row=>row.retrievalReady).length;
  const artifacts=entries.reduce((sum,row)=>sum+Number(row.artifactIds?.length??0),0);
  activity.body.append(createKeyValue(doc,[
    {key:'Source nodes',value:entries.length},
    {key:'Displayed in graph',value:String(Math.min(MAX_VISIBLE_SOURCE_NODES,entries.filter(row=>String(row.operatorState??'')!=='REMOVED').length))+' / '+String(entries.length)},
    {key:'Retrieval-ready',value:retrieval},
    {key:'Sources with representations',value:represented},
    {key:'Derived artifact refs',value:artifacts},
    {key:'Conflicts',value:data?.conflicts?.length??0},
  ]));

  const queue=panel(doc,'Growth queue','Sources still changing state','◌');
  const active=entries.filter(row=>['STUDYING','ACCEPTED','FAILED'].includes(String(row.operatorState))).slice(0,10);
  if(active.length){
    for(const row of active){
      const state=String(row.operatorState??'ACCEPTED'),meta=STATE_META[state]??STATE_META.ACCEPTED,item=element(doc,'div',{className:'a52-lore-growth-row',dataset:{state}});
      item.append(element(doc,'span',{className:'a52-lore-state-dot',text:meta.symbol}),element(doc,'strong',{text:shortLabel(row.uid??row.sourceId)}),makeBadge(doc,meta.label,meta.tone));
      queue.body.append(item);
    }
  }else queue.body.append(element(doc,'p',{className:'a52-muted',text:entries.length?'No DUE, STUDYING, or FAILED sources are currently published.':'The queue will appear after Lore acceptance.'}));
  rail.append(book.root,activity.root,queue.root);
  return rail;
}

const SEMANTIC_TONES=['violet','green','blue','amber','magenta','teal','cyan'];
const MAX_VISIBLE_SOURCE_NODES=54;
const TARGET_NODES_PER_HUB=8;
const INITIAL_WAVE_SPACING_MS=420;
const INITIAL_HUB_LINK_MS=90;
const INITIAL_HUB_BLOOM_MS=210;
const INITIAL_NODE_START_MS=500;
const INITIAL_NODE_SPACING_MS=72;
const INITIAL_ARTIFACT_LAG_MS=245;

function buildLoreGraph({entries,data,selected}={}){
  const allVisible=entries.filter(row=>String(row.operatorState??'')!=='REMOVED');
  const visible=stableLoreSources(allVisible).slice(0,MAX_VISIBLE_SOURCE_NODES);
  const exactByUid=exactSourceMap(selected?.snapshot);
  const decorated=visible.map((row,index)=>{
    const exact=exactByUid.get(String(row.uid??index))??null;
    return{row,index,category:publishedSemanticCategory(exact),label:publishedSourceTitle(exact,row.uid??row.sourceId??'Lore source')};
  });

  const semantic=decorated.some(item=>item.category);
  const grouped=semantic?semanticTopologyGroups(decorated):neutralTopologyGroups(decorated);
  const hubs=[],nodes=[],artifacts=[],edges=[],center={x:500,y:380};
  const hubRadius=grouped.length<=2?190:grouped.length<=4?210:225;

  grouped.forEach((group,index)=>{
    const angle=(-Math.PI/2)+(index/Math.max(1,grouped.length))*Math.PI*2;
    const tone=group.tone??SEMANTIC_TONES[index%SEMANTIC_TONES.length];
    const waveStart=index*INITIAL_WAVE_SPACING_MS;
    const hub={
      id:group.id,state:group.kind==='semantic'?'SEMANTIC':'STRUCTURE',tone,label:group.label,count:group.items.length,
      presentationOnly:group.kind!=='semantic',wave:index,
      x:center.x+Math.cos(angle)*hubRadius,y:center.y+Math.sin(angle)*hubRadius,
      delay:waveStart+INITIAL_HUB_BLOOM_MS,incrementalDelay:100+(index%3)*90,
    };
    hubs.push(hub);
    edges.push({
      id:'edge:hub:'+hub.id,from:center,to:hub,state:hub.state,tone,kind:'hub',wave:index,
      delay:waveStart+INITIAL_HUB_LINK_MS,incrementalDelay:40+(index%3)*70,
    });

    group.items.forEach((item,rowIndex)=>{
      const row=item.row,sourceState=String(row.operatorState??'ACCEPTED');
      const ring=Math.floor(rowIndex/4),slot=rowIndex%4,ringSize=Math.min(4,group.items.length-ring*4);
      const slotOffset=ringSize<=1?0:(slot/(ringSize-1)-.5)*Math.min(1.18,.46+ringSize*.13);
      const nodeAngle=angle+slotOffset;
      const hash=hashText(String(row.uid??row.sourceId??rowIndex)),jitter=(hash%13)-6;
      const radius=68+ring*38+jitter;
      const artifactCount=Number(row.artifactIds?.length??0);
      const nodeDelay=waveStart+INITIAL_NODE_START_MS+rowIndex*INITIAL_NODE_SPACING_MS;
      const incrementalNodeDelay=180+(rowIndex%6)*62;
      const node={
        id:String(row.sourceId??row.uid??sourceState+':'+rowIndex),label:item.label,state:sourceState,tone,category:item.category,wave:index,
        x:hub.x+Math.cos(nodeAngle)*radius,y:hub.y+Math.sin(nodeAngle)*radius,
        artifactCount,delay:nodeDelay,incrementalDelay:incrementalNodeDelay,payload:row,
      };
      nodes.push(node);
      edges.push({
        id:'edge:source:'+node.id,from:hub,to:node,state:sourceState,tone,kind:'source',wave:index,
        delay:Math.max(waveStart+INITIAL_HUB_BLOOM_MS,nodeDelay-125),
        incrementalDelay:Math.max(80,incrementalNodeDelay-90),
      });

      if(artifactCount>0){
        const artifactAngle=nodeAngle+(rowIndex%2===0?.30:-.30),artifactRadius=30+Math.min(10,Math.log2(artifactCount+1)*2);
        const artifact={
          id:'artifact-group:'+node.id,
          label:artifactCount===1?String(row.artifactIds?.[0]??'derived artifact'):String(artifactCount)+' derived refs',
          count:artifactCount,state:sourceState,tone,wave:index,
          x:node.x+Math.cos(artifactAngle)*artifactRadius,y:node.y+Math.sin(artifactAngle)*artifactRadius,
          delay:node.delay+INITIAL_ARTIFACT_LAG_MS,incrementalDelay:node.incrementalDelay+190,
        };
        artifacts.push(artifact);
        edges.push({
          id:'edge:artifact:'+artifact.id,from:node,to:artifact,state:sourceState,tone,kind:'artifact',wave:index,
          delay:artifact.delay-90,incrementalDelay:artifact.incrementalDelay-75,
        });
      }
    });
  });

  return{
    hubs,nodes,artifacts,edges,semantic,
    totalSourceCount:allVisible.length,
    visibleSourceCount:visible.length,
    presentationClusterCount:grouped.filter(group=>group.kind!=='semantic').length,
  };
}

function stableLoreSources(rows=[]){
  return [...rows].sort((a,b)=>{
    const aKey=String(a?.uid??a?.sourceId??''),bKey=String(b?.uid??b?.sourceId??'');
    const hashDelta=hashText(aKey)-hashText(bKey);
    return hashDelta||aKey.localeCompare(bKey);
  });
}
function semanticTopologyGroups(items=[]){
  const byCategory=new Map();
  for(const item of items){
    const key=item.category??'Other Lore';
    if(!byCategory.has(key))byCategory.set(key,[]);
    byCategory.get(key).push(item);
  }
  let categories=[...byCategory.entries()].sort((a,b)=>b[1].length-a[1].length||String(a[0]).localeCompare(String(b[0])));
  if(categories.length>7){
    const keep=categories.slice(0,6),other=categories.slice(6).flatMap(([,rows])=>rows);
    categories=[...keep,['Other Lore',other]];
  }
  const groups=[];
  categories.forEach(([category,rows],categoryIndex)=>{
    const chunks=chunkTopologyRows(rows,TARGET_NODES_PER_HUB);
    chunks.forEach((chunk,chunkIndex)=>{
      const suffix=chunks.length>1?' · '+String(chunkIndex+1):'';
      groups.push({
        id:'hub:category:'+category+':'+chunkIndex,
        kind:'semantic',
        label:String(category)+suffix,
        tone:SEMANTIC_TONES[categoryIndex%SEMANTIC_TONES.length],
        items:chunk,
      });
    });
  });
  return groups;
}
function neutralTopologyGroups(items=[]){
  if(!items.length)return[];
  const desired=Math.max(1,Math.min(8,Math.ceil(items.length/TARGET_NODES_PER_HUB)));
  const groupSize=Math.ceil(items.length/desired),groups=[];
  for(let index=0;index<desired;index++){
    const chunk=items.slice(index*groupSize,(index+1)*groupSize);
    if(!chunk.length)continue;
    groups.push({
      id:'hub:structure:'+index,
      kind:'structure',
      label:'Cluster '+String(index+1),
      tone:SEMANTIC_TONES[index%SEMANTIC_TONES.length],
      items:chunk,
    });
  }
  return groups;
}
function chunkTopologyRows(rows=[],maxSize=TARGET_NODES_PER_HUB){
  const result=[];
  for(let index=0;index<rows.length;index+=maxSize)result.push(rows.slice(index,index+maxSize));
  return result;
}
function presentationClusterCount(entries=[]){
  const count=Math.min(MAX_VISIBLE_SOURCE_NODES,entries.filter(row=>String(row?.operatorState??'')!=='REMOVED').length);
  return count?Math.max(1,Math.min(8,Math.ceil(count/TARGET_NODES_PER_HUB))):0;
}

function exactSourceMap(snapshot){
  return new Map((snapshot?.entries??[]).map((entry,index)=>[String(entry?.uid??index),entry]));
}
function sourceTreePath(entry){
  const value=entry?.metadata?.treePath??entry?.treePath??entry?.metadata?.path??null;
  if(Array.isArray(value))return value.filter(Boolean).map(x=>String(x).trim()).filter(Boolean).slice(0,8);
  if(typeof value==='string')return value.split(/[\\/>]+/).map(x=>x.trim()).filter(Boolean).slice(0,8);
  return[];
}
function publishedSemanticCategory(entry){
  const explicit=entry?.metadata?.category??entry?.category??entry?.metadata?.type??entry?.type??null;
  const value=explicit??sourceTreePath(entry)[0]??null;
  return value?String(value).trim().slice(0,28):null;
}
function publishedSourceTitle(entry,fallback){
  return shortLabel(entry?.title??entry?.comment??entry?.name??entry?.metadata?.title??entry?.metadata?.name??fallback);
}
function shortGraphRevision(value){
  if(value==null||value==='')return'NO_EVIDENCE';
  const text=String(value);
  if(text.length<=20)return text;
  const split=text.indexOf(':');
  if(split>0&&split<14){
    const prefix=text.slice(0,split+1),id=text.slice(split+1);
    return prefix+id.slice(0,8)+'…'+id.slice(-4);
  }
  return text.slice(0,10)+'…'+text.slice(-5);
}
function semanticCategoryCounts(snapshot,entries=[]){
  const exactByUid=exactSourceMap(snapshot),counts=new Map();
  entries.forEach((row,index)=>{
    const category=publishedSemanticCategory(exactByUid.get(String(row?.uid??index)));
    if(category)counts.set(category,(counts.get(category)??0)+1);
  });
  return[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}

function growthState(state,selected,graph){
  const key=String(selected?.snapshot?.id??selected?.selection?.lorebookId??'unselected');
  if(!state)return{
    initialBuild:true,
    newHubs:new Set(graph.hubs.map(row=>row.id)),newNodes:new Set(graph.nodes.map(row=>row.id)),
    newArtifacts:new Set(graph.artifacts.map(row=>row.id)),newEdges:new Set(graph.edges.map(row=>row.id)),
  };
  let reset=false;
  if(state.animationInitialized!==true){
    state.animationInitialized=true;reset=true;state.revealPassesRemaining=REVEAL_RENDER_PASSES;
    state.seenHubs?.clear?.();state.seenNodes?.clear?.();state.seenArtifacts?.clear?.();state.seenEdges?.clear?.();
  }
  if(state.lorebookKey!==key){
    state.lorebookKey=key;reset=true;state.revealPassesRemaining=REVEAL_RENDER_PASSES;
    state.seenHubs?.clear?.();state.seenNodes?.clear?.();state.seenArtifacts?.clear?.();state.seenEdges?.clear?.();
  }
  const hadGraph=Boolean(state.seenHubs?.size||state.seenNodes?.size||state.seenEdges?.size);
  const classify=(rows,seen)=>{const fresh=new Set();for(const row of rows){if(!seen.has(row.id))fresh.add(row.id);seen.add(row.id);}trimSeen(seen,192);return fresh;};
  const revealAll=Number(state.revealPassesRemaining??0)>0;
  const reveal=(rows,seen)=>{const fresh=revealAll?new Set(rows.map(row=>row.id)):classify(rows,seen);for(const row of rows)seen.add(row.id);trimSeen(seen,192);return fresh;};
  const result={
    initialBuild:revealAll||reset||!hadGraph,
    newHubs:reveal(graph.hubs,state.seenHubs),
    newNodes:reveal(graph.nodes,state.seenNodes),
    newArtifacts:reveal(graph.artifacts,state.seenArtifacts),
    newEdges:reveal(graph.edges,state.seenEdges),
  };
  if(revealAll)state.revealPassesRemaining=Math.max(0,Number(state.revealPassesRemaining)-1);
  return result;
}
function animationDelay(row,growth){
  return Number(growth?.initialBuild?row?.delay:row?.incrementalDelay) || 0;
}
function nativeAnimate(doc,{attributeName,from,to,begin=0,dur=400}={}){
  return svgEl(doc,'animate',{
    attributeName:String(attributeName),
    from:String(from),
    to:String(to),
    begin:'indefinite',
    dur:String(Math.max(1,Number(dur)||1))+'ms',
    fill:'freeze',
    'data-a52-start-ms':String(Math.max(0,Number(begin)||0)),
  });
}
function startNativeAnimations(root){
  const animations=[];
  const visit=node=>{
    for(const child of node?.children??[]){
      if(String(child?.tagName??'').toLowerCase()==='animate'&&readSvgAttr(child,'data-a52-start-ms')!=null)animations.push(child);
      visit(child);
    }
  };
  visit(root);
  for(const animation of animations){
    const offsetMs=Math.max(0,Number(readSvgAttr(animation,'data-a52-start-ms'))||0);
    try{
      if(typeof animation.beginElementAt==='function')animation.beginElementAt(offsetMs/1000);
      else if(typeof animation.beginElement==='function'&&offsetMs===0)animation.beginElement();
    }catch{}
  }
  return animations.length;
}
function scheduleNativeAnimations(root,doc){
  const start=()=>startNativeAnimations(root);
  const enqueue=doc?.defaultView?.queueMicrotask??globalThis.queueMicrotask;
  if(typeof enqueue==='function'){enqueue(start);return true;}
  Promise.resolve().then(start);
  return true;
}
function readSvgAttr(node,key){
  try{return node?.getAttribute?.(key)??node?.attributes?.[key]??null;}catch{return node?.attributes?.[key]??null;}
}
function prefersReducedMotion(doc){
  try{
    const view=doc?.defaultView??globalThis;
    return Boolean(view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  }catch{return false;}
}

function trimSeen(set,max){while(set.size>max)set.delete(set.values().next().value);}

function canvasFooter(doc,text){
  const footer=element(doc,'footer',{className:'a52-lore-neural-canvas-footer'});
  footer.append(element(doc,'span',{text:'◉ Click a source node for owner metadata'}),element(doc,'span',{text:'Growth: core → cluster → sources → derived'}),element(doc,'span',{text}));
  return footer;
}

function panel(doc,title,subtitle,icon){
  const root=element(doc,'section',{className:'a52-lore-neural-panel'}),head=element(doc,'header',{className:'a52-lore-neural-panel__head'}),copy=element(doc,'div');
  copy.append(element(doc,'h3',{text:title}),element(doc,'p',{className:'a52-muted',text:subtitle}));
  head.append(element(doc,'span',{className:'a52-lore-neural-panel__icon',text:icon}),copy);
  const body=element(doc,'div',{className:'a52-lore-neural-panel__body'});root.append(head,body);return{root,body};
}

function svgEl(doc,tag,attrs={},children=[]){
  const node=typeof doc.createElementNS==='function'?doc.createElementNS('http://www.w3.org/2000/svg',tag):doc.createElement(tag);
  for(const [key,value] of Object.entries(attrs??{}))if(value!=null)node.setAttribute?.(key,String(value));
  for(const child of children)node.append?.(child);
  return node;
}

function curve(x1,y1,x2,y2){
  const mx=(x1+x2)/2,my=(y1+y2)/2,dx=x2-x1,dy=y2-y1,len=Math.max(1,Math.hypot(dx,dy)),bend=Math.min(32,len*.12),cx=mx-(dy/len)*bend,cy=my+(dx/len)*bend;
  return'M '+round(x1)+' '+round(y1)+' Q '+round(cx)+' '+round(cy)+' '+round(x2)+' '+round(y2);
}
function round(value){return Math.round(Number(value)*10)/10;}
function shortLabel(value){const s=String(value??'Lore source').replace(/^lore:/i,'').replace(/[_-]+/g,' ');return s.length>28?s.slice(0,25)+'…':s;}
function hashText(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
