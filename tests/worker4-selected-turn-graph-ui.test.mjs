import test from 'node:test';
import assert from 'node:assert/strict';
import {Area52NativeBrain} from '../src/native-brain.js';
import {
  BrainDecisionVisibilityAdapter,
  SelectedTurnGraphVisibilityAdapter,
  SelectedTurnLogModel,
  Wave13DiagnosticsCenterAdapter,
  renderSelectedTurnGraphVisibility,
} from '../src/ui-core/index.js';
import {FakeDocument,FakeNode} from './fixtures/wave4-synthetic-extension.mjs';

class Node extends FakeNode{
  constructor(tag,doc){super(tag,doc);this.value='';this.hidden=false;}
  remove(){const p=this.parentNode,i=p?.children?.indexOf(this)??-1;if(i>=0)p.children.splice(i,1);this.parentNode=null;}
}
class Doc extends FakeDocument{
  constructor(){super();this.body=new Node('body',this);this.documentElement=new Node('html',this);}
  createElement(tag){return new Node(tag,this);}
  createDocumentFragment(){return new Node('fragment',this);}
}
const walk=node=>[node,...(node?.children??[]).flatMap(walk)];
const textOf=node=>walk(node).map(x=>x.textContent??'').filter(Boolean).join(' ');

function scene(sceneId,sceneRevision){
  return{sceneId,sceneRevision,location:null,narrativeTime:'tick '+sceneRevision,activeCast:[],activeThreads:[],objects:[],sourceRevisionRefs:['scene:north@'+sceneRevision],provenance:['scene:prov:'+sceneRevision]};
}

test('DETERMINISTIC: real Native Brain selected turn renders GraphTraversalReceipt + worldGraphReferences candidate path without raw bodies',async()=>{
  const brain=new Area52NativeBrain();
  brain.registerEntityIdentity({entityId:'entity:pilot',canonicalLabel:'Pilot',entityType:'PERSON',worldId:'world:graph-ui'});
  brain.registerGraphProvider({
    providerId:'LIVE_GRAPH_OWNER',owner:'LORE_INTELLIGENCE',semanticsVersion:'ui-v1',
    isRevisionCurrent:(ref)=>ref==='owner:fresh@1',
    query:()=>({providerRevision:'live-provider:3',edges:[{
      edgeId:'edge:fresh',fromEntityId:'entity:pilot',toEntityId:'location:north-pier',edgeMeaning:'KNOWN_ROUTE',
      sourceRevisionRefs:['owner:fresh@1'],provenanceRefs:['prov:fresh'],evidenceRefs:['evidence:fresh'],
      artifactRef:{artifactId:'lore-route',artifactType:'LoreEntry',revision:1},temporalStatus:'CURRENT',authorityClass:'SOURCE_CANON',
      representationText:'SECRET_LORE_BODY_GRAPH_UI_MUST_NOT_RENDER',
    }]}),
  });
  brain.registerGraphProvider({
    providerId:'STALE_GRAPH_OWNER',owner:'MEMORY_TEMPORAL',semanticsVersion:'ui-v1',
    isRevisionCurrent:()=>false,
    query:()=>({providerRevision:'stale-provider:1',edges:[{
      edgeId:'edge:stale',fromEntityId:'entity:pilot',toEntityId:'event:old-route',edgeMeaning:'REMEMBERED_ROUTE',
      sourceRevisionRefs:['memory:stale@1'],artifactRef:{artifactId:'memory-old-route',artifactType:'MemoryEpisode',revision:1},
      temporalStatus:'HISTORICAL',representationText:'SECRET_MEMORY_BODY_GRAPH_UI_MUST_NOT_RENDER',
    }]}),
  });

  const prepared=await brain.prepareTurn({
    chatId:'chat:graph-ui',turnId:'turn:graph-ui:1',generationId:'gen:graph-ui:1',correlationId:'corr:graph-ui:1',
    query:'Which route applies to Pilot?',intent:'CURRENT',scene:scene('scene:north',1),anchorEntityIds:['entity:pilot'],
    channelIds:['ZZ_NATIVE_GRAPH_WALKER'],candidateBudget:24,latencyBudgetMs:1000,budgetBytes:6000,executionLabel:'DETERMINISTIC',
  });
  const selection=prepared.selection,bindings=brain.uiBindings();
  const decision=new BrainDecisionVisibilityAdapter({bindings,selectionProvider:()=>selection});
  const graph=new SelectedTurnGraphVisibilityAdapter({bindings,selectionProvider:()=>selection,decisionVisibility:decision});
  const model=graph.read();

  assert.equal(model.selection.chatId,selection.chatId);
  assert.equal(model.selection.turnId,selection.turnId);
  assert.equal(model.selection.generationId,selection.generationId);
  assert.equal(model.state,'READY');
  assert.ok(model.owners.some(row=>row.owner==='LORE_INTELLIGENCE'&&row.providerId==='LIVE_GRAPH_OWNER'));
  assert.ok(
    model.relationships.some(row=>row.edgeId==='edge:fresh'&&row.edgeMeaning==='KNOWN_ROUTE'),
    JSON.stringify({
      traversal:{
        traversedEdgeCount:prepared.graphTraversalReceipt?.traversedEdgeCount??null,
        nominationCount:prepared.graphTraversalReceipt?.nominationCount??null,
        providers:prepared.graphTraversalReceipt?.providers??[],
        referenceSummary:(prepared.graphTraversalReceipt?.referenceSummary??[]).map(row=>({edgeId:row.edgeId,providerId:row.providerId,edgeMeaning:row.edgeMeaning,fromEntityId:row.fromEntityId,toEntityId:row.toEntityId})),
        staleRejected:prepared.graphTraversalReceipt?.staleRejected??[],
      },
      uiRelationships:model.relationships.map(row=>({edgeId:row.edgeId,providerId:row.providerId,edgeMeaning:row.edgeMeaning})),
      referenceEdges:model.referenceEdges.map(row=>({edgeId:row.edgeId,providerId:row.providerId,edgeMeaning:row.edgeMeaning})),
    })
  );
  assert.ok(model.staleRejected.some(row=>row.edgeId==='edge:stale'&&row.reason==='OWNER_GRAPH_SOURCE_REVISION_STALE'));
  assert.equal(model.generationTraversal.evidenceClass,'GENERATION_TIME_RECEIPT');
  assert.equal(model.worldReferenceRead.evidenceClass,'ON_DEMAND_SELECTED_TURN_REFERENCE_READ');
  assert.equal(model.worldReferenceRead.generationTimeReceipt,false);

  const candidate=model.candidates.find(row=>row.edgeIds.includes('edge:fresh'));
  assert.ok(candidate,'fresh graph edge should have a retained Candidate Bus graph candidate');
  assert.equal(candidate.candidateBus,'PROVEN');
  assert.equal(candidate.truth,'PROVEN');
  assert.equal(candidate.gather,'PROVEN');
  assert.equal(candidate.contextSeal,'PROVEN');

  const json=JSON.stringify(model);
  assert.doesNotMatch(json,/SECRET_LORE_BODY_GRAPH_UI_MUST_NOT_RENDER|SECRET_MEMORY_BODY_GRAPH_UI_MUST_NOT_RENDER/);
  assert.doesNotMatch(json,/"query"\s*:/);

  const doc=new Doc(),rendered=renderSelectedTurnGraphVisibility(doc,model,{compact:false});
  const body=textOf(rendered);
  assert.match(body,/LORE_INTELLIGENCE/);
  assert.match(body,/KNOWN_ROUTE/);
  assert.match(body,/OWNER_GRAPH_SOURCE_REVISION_STALE/);
  assert.match(body,/Candidate Bus: PROVEN/);
  assert.match(body,/Context Seal: PROVEN/);
  assert.doesNotMatch(body,/SECRET_LORE_BODY|SECRET_MEMORY_BODY/);

  const diagnostics=new Wave13DiagnosticsCenterAdapter({graphVisibility:graph,liveReceiptBinding:{selection:()=>selection,diagnostics:()=>({reads:1,rejected:0})}});
  const diagnosticRead=diagnostics.read();
  assert.equal(diagnosticRead.graph.selection.generationId,selection.generationId);
  assert.equal(diagnosticRead.graph.candidates.find(row=>row.candidateId===candidate.candidateId).contextSeal,'PROVEN');

  const journal={readTurn:()=>({entries:[],firstSeenAt:1,lastUpdatedAt:2}),status:()=>({turnCount:1,entryCount:0}),exportEvidence:()=>({turns:[]})};
  const turnLog=new SelectedTurnLogModel({journal,selectionProvider:()=>selection,decisionVisibility:decision,graphVisibility:graph,diagnostics,now:()=>3});
  assert.equal(turnLog.read().graphTrace.generationTraversal.traversedEdgeCount,model.generationTraversal.traversedEdgeCount);
  assert.equal(turnLog.exportMetadata({selection}).graphTrace.selection.turnId,selection.turnId);
  assert.equal(turnLog.exportDiagnostics({selection}).operationalSnapshot.graph.selection.generationId,selection.generationId);
});

test('DETERMINISTIC: graph visibility makes zero-work and unavailable states explicit',()=>{
  const selection={chatId:'chat:zero',turnId:'turn:zero',generationId:'gen:zero',correlationId:'corr:zero',worldRevision:1,sceneRevision:1,sourceRevisionRefs:[]};
  const selected={kind:'NativeBrainSelectedTurnReceipt',...selection,producers:{retrieval:{status:'PUBLISHED'}}};
  const zero=new SelectedTurnGraphVisibilityAdapter({
    bindings:{
      readSelectedTurnReceipt:()=>selected,
      readGraphTraversal:()=>({kind:'GraphTraversalReceipt',traversedEdgeCount:0,visitedNodeCount:0,examinedEdgeCount:0,nominationCount:0,staleRejectedCount:0,staleRejected:[],referenceSummary:[],providers:[],limits:{maxEdges:32},authority:{graphMutation:false,truth:false,settlement:false,contextSeal:false}}),
      readWorldGraphReferences:()=>({kind:'NativeBrainSelectedTurnWorldGraphReferences',...selection,observationClass:'ON_DEMAND_SELECTED_TURN_REFERENCE_READ',referenceSet:{kind:'StructuredWorldStateReferenceSet',edges:[],identityReferences:[],temporalReferences:[],staleRejected:[],readOnly:true,rawSourceContentIncluded:false,authority:{graphMutation:false,truth:false,settlement:false,contextSeal:false,identitySettlement:false}}}),
      readCandidateBusEnvelope:()=>({kind:'CandidateBusEnvelope',candidates:[]}),
    },
    selectionProvider:()=>selection,
  }).read();
  assert.equal(zero.state,'ZERO_WORK');
  assert.equal(zero.summary.traversedEdgeCount,0);
  assert.equal(zero.summary.candidateBusGraphCandidates,0);

  const unavailable=new SelectedTurnGraphVisibilityAdapter({bindings:{readSelectedTurnReceipt:()=>selected},selectionProvider:()=>selection}).read();
  assert.equal(unavailable.state,'UNAVAILABLE');
  assert.match(unavailable.reason,/does not export|unavailable/i);

  const waiting=new SelectedTurnGraphVisibilityAdapter({bindings:{},selectionProvider:()=>({chatId:'chat:zero'})}).read();
  assert.equal(waiting.state,'WAITING_FOR_SELECTED_TURN');
});
