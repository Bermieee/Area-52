import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthorityClass, KnowledgeStatus, MutationType,
  createClaim, createMutationProposal, createProvenance,
} from '../src/contracts.js';
import {Area52CognitiveCore} from '../src/cognitive-core.js';
import {Area52NativeBrain} from '../src/native-brain.js';
import {createOwnerGraphProviders} from '../src/deployment/owner-graph-adapters.js';

function admitEvidence(core,id,content=id){
  const imported=core.registry.importSource({id,sourceType:'WORKER4_GRAPH_TEST',content});
  const artifactId='evidence:'+id;
  core.registry.registerDerivedArtifact({
    artifactId,artifact:{kind:'Worker4GraphEvidence',id:artifactId},
    sourceRevisionIds:[imported.revision.id],activity:'WORKER4_GRAPH_FIXTURE',agent:'worker4',
  });
  return {revisionId:imported.revision.id,artifactId};
}

function settle(core,evidence,{id,subjectId,predicate,value,at,temporalKind='CURRENT',authorityClass=AuthorityClass.OBSERVED,identityRevisionRefs=[]}){
  const provenance=createProvenance({
    id:'prov:'+id,sourceRevisionIds:[evidence.revisionId],evidenceIds:[evidence.artifactId],
    derivedFromIds:[evidence.artifactId],activity:'WORKER4_GRAPH_FIXTURE',agent:'worker4',
    invalidators:[evidence.revisionId,evidence.artifactId,...identityRevisionRefs],
  });
  const claim=createClaim({
    id,subjectId,predicate,value,temporal:{kind:temporalKind,validFrom:at,validUntil:null},
    authorityClass,confidence:1,status:temporalKind==='HISTORICAL'?KnowledgeStatus.HISTORICAL:KnowledgeStatus.CURRENT,
    provenance,owner:'WORLD_STATE',identityRevisionRefs,claimType:'FACT',slotPolicy:'SINGLE',explicitness:'EXPLICIT_TEST',evidenceTime:at,
  });
  const proposal=createMutationProposal({
    id:'proposal:'+id,mutationType:MutationType.SET_CLAIM,owner:'WORLD_STATE',
    sourceRevisionIds:[evidence.revisionId],evidenceIds:[evidence.artifactId],
    freshnessRevisionIds:[evidence.revisionId],payload:{claim},status:'PROPOSED',
  });
  return core.settlement.settle(proposal);
}

function world(){
  const core=new Area52CognitiveCore();
  core.registerEntityIdentity({entityId:'entity:pilot',canonicalLabel:'Pilot',entityType:'PERSON',worldId:'world:test'});
  const identityRef=core.entities.identityReference('entity:pilot').revisionRef;
  const a=admitEvidence(core,'turn:1','Pilot was at North Dock.');
  const b=admitEvidence(core,'turn:2','Pilot moved to South Dock.');
  settle(core,a,{id:'claim:location:north',subjectId:'entity:pilot',predicate:'location',value:'location:north',at:1,identityRevisionRefs:[identityRef]});
  settle(core,b,{id:'claim:location:south',subjectId:'entity:pilot',predicate:'location',value:'location:south',at:2,identityRevisionRefs:[identityRef]});
  return {core,a,b,identityRef};
}

test('multi-turn structured world references preserve current versus historical location without erasing history',()=>{
  const {core}=world();
  const current=core.worldGraphReferences('where is Pilot',{intent:'CURRENT',anchorEntityIds:['entity:pilot'],worldRevision:core.graph.revision});
  const historical=core.worldGraphReferences('where was Pilot',{intent:'HISTORICAL',anchorEntityIds:['entity:pilot'],worldRevision:core.graph.revision});
  const currentLocation=current.edges.filter(row=>row.providerId==='CORE_TEMPORAL_STATE'&&row.edgeMeaning==='location');
  const historicalLocation=historical.edges.filter(row=>row.providerId==='CORE_TEMPORAL_STATE'&&row.edgeMeaning==='location');
  assert.deepEqual(currentLocation.map(row=>[row.toEntityId,row.temporalStatus]),[['location:south','CURRENT']]);
  const prior=historicalLocation.find(row=>row.toEntityId==='location:north'&&row.temporalStatus==='SUPERSEDED');
  assert.ok(prior);
  assert.equal(prior.temporal.validFrom,1);
  assert.equal(prior.temporal.validUntil,2);
  assert.ok(historicalLocation.some(row=>row.toEntityId==='location:south'&&row.temporalStatus==='CURRENT'));
  assert.equal(current.authority.truth,false);
  assert.equal(current.authority.settlement,false);
  assert.equal(current.readOnly,true);
});

test('same-time incompatible settled evidence remains unresolved instead of graph proximity choosing a winner',()=>{
  const {core,identityRef}=world();
  const north=admitEvidence(core,'affiliation:north','Pilot joined the North crew.');
  const south=admitEvidence(core,'affiliation:south','Pilot joined the South crew.');
  settle(core,north,{id:'claim:affiliation:north',subjectId:'entity:pilot',predicate:'affiliation',value:'crew:north',at:3,identityRevisionRefs:[identityRef]});
  const second=settle(core,south,{id:'claim:affiliation:south',subjectId:'entity:pilot',predicate:'affiliation',value:'crew:south',at:3,identityRevisionRefs:[identityRef]});
  assert.equal(second.decision.decision,'UNRESOLVED');
  const unresolved=core.graph.unresolvedState('entity:pilot','affiliation');
  assert.equal(unresolved.status,'UNRESOLVED');
  assert.equal(unresolved.claimIds.length,2);
  const refs=core.worldGraphReferences('Pilot affiliation',{intent:'CONTRADICTION',anchorEntityIds:['entity:pilot'],worldRevision:core.graph.revision});
  assert.equal(refs.edges.filter(row=>row.edgeMeaning==='affiliation').length,2);
  assert.ok(refs.edges.filter(row=>row.edgeMeaning==='affiliation').every(row=>['CONTRADICTED','UNRESOLVED','UNCERTAIN'].includes(row.temporalStatus)));
});

test('Scene, Lore and Memory providers identity-link through one bounded reference set while retaining owner authority and exact drillback refs',()=>{
  const {core}=world();
  const loreInterface={
    status:()=>({entries:[{sourceRevisionId:'lore:pilot@1',sourceState:'ACTIVE'}]}),
    query:()=>({
      indexRevision:'lore-index:7',
      nominations:[{
        nomination:{
          candidateId:'lore-candidate:pilot',artifactRef:{artifactId:'lore:pilot',artifactType:'LoreEntry',revision:1},
          artifactRevision:1,sourceRevisionRefs:['lore:pilot@1'],entityRefs:['entity:pilot'],
          authorityClass:'SOURCE_CANON',temporalHints:[{status:'CURRENT'}],provenance:[{ref:'prov:lore:pilot@1'}],
          evidenceRefs:['lore:evidence:pilot'],representationRef:'lore:representation:pilot',representationRevision:1,
          representationText:'SECRET_LORE_BODY_MUST_NOT_APPEAR_IN_REFERENCE_SET',
        },
        drillback:[{
          sourceId:'lore:pilot',sourceRevisionId:'lore:pilot@1',lorebookId:'lorebook:test',uid:'pilot',
          representationRef:'lore:representation:pilot',exactAuthoredText:'SECRET_LORE_BODY_MUST_NOT_APPEAR_IN_REFERENCE_SET',
        }],
      }],
    }),
  };
  const memoryInterface={
    adapters:{
      snapshot:()=>({graph:{sourceRevisionState:[['memory:scene@1',{state:'ACTIVE'}]]}}),
      queryHistorian:()=>({
        historianRevision:'historian:9',
        nominations:[{
          candidateId:'memory-candidate:pilot',artifactRef:{artifactId:'memory-episode:pilot',artifactType:'SCENE_EPISODE',revision:2},
          artifactRevision:2,sourceRevisionRefs:['memory:scene@1'],entityRefs:['entity:pilot'],
          authorityClass:'OBSERVED',temporalHints:['HISTORICAL'],provenance:[{ref:'prov:memory:scene@1'}],
          evidenceRefs:['memory:evidence:scene'],dependencyRevisions:['memory:scene@1','memory-episode:pilot'],
          representationRef:'memory-record:pilot',representationRevision:2,representationText:'SECRET_MEMORY_BODY_MUST_NOT_APPEAR_IN_REFERENCE_SET',
        }],
      }),
    },
  };
  core.registerEntityIdentity({entityId:'entity:oldmate',canonicalLabel:'Oldmate',entityType:'PERSON',worldId:'world:test'});
  core.registerEntityIdentity({entityId:'entity:newmate',canonicalLabel:'Newmate',entityType:'PERSON',worldId:'world:test'});
  const sceneOld={sceneId:'scene:north',revision:3,lifecycle:'CLOSED',sourceRevisionRefs:['scene:north@3'],fields:{}};
  const sceneCurrent={sceneId:'scene:harbor',revision:4,lifecycle:'OPEN',sourceRevisionRefs:['scene:harbor@4'],fields:{}};
  const scenes=new Map([[sceneOld.sceneId,sceneOld],[sceneCurrent.sceneId,sceneCurrent]]);
  const sceneRuntime={
    registry:{list:()=>[sceneOld,sceneCurrent].map(row=>({sceneId:row.sceneId})),current:(id)=>scenes.get(id)??null,get:(id)=>scenes.get(id)??null},
    graph:{exportState:()=>({version:4,edges:[
      {edgeId:'ENTITY_IN_SCENE:entity:pilot->scene:north',edgeType:'ENTITY_IN_SCENE',fromRef:'entity:pilot',toSceneId:'scene:north',evidenceRefs:['scene:evidence:pilot:north'],provenance:['scene:prov:north'],derivedFrom:[]},
      {edgeId:'ENTITY_IN_SCENE:entity:oldmate->scene:north',edgeType:'ENTITY_IN_SCENE',fromRef:'entity:oldmate',toSceneId:'scene:north',evidenceRefs:['scene:evidence:oldmate'],provenance:['scene:prov:north'],derivedFrom:[]},
      {edgeId:'SCENE_PRECEDES:scene:north->scene:harbor',edgeType:'SCENE_PRECEDES',fromSceneId:'scene:north',toSceneId:'scene:harbor',evidenceRefs:['scene:evidence:transition'],provenance:['scene:prov:transition'],derivedFrom:[]},
      {edgeId:'ENTITY_IN_SCENE:entity:pilot->scene:harbor',edgeType:'ENTITY_IN_SCENE',fromRef:'entity:pilot',toSceneId:'scene:harbor',evidenceRefs:['scene:evidence:pilot:harbor'],provenance:['scene:prov:harbor'],derivedFrom:[]},
      {edgeId:'ENTITY_IN_SCENE:entity:newmate->scene:harbor',edgeType:'ENTITY_IN_SCENE',fromRef:'entity:newmate',toSceneId:'scene:harbor',evidenceRefs:['scene:evidence:newmate'],provenance:['scene:prov:harbor'],derivedFrom:[]},
    ]})},
  };
  for(const provider of createOwnerGraphProviders({loreInterface,memoryInterface,sceneRuntime}))core.registerGraphProvider(provider);
  const refs=core.worldGraphReferences('Pilot context',{intent:'TEMPORAL',anchorEntityIds:['entity:pilot'],worldRevision:core.graph.revision,sceneRevision:4});
  const byProvider=new Map(refs.edges.map(row=>[row.providerId,row]));
  assert.ok(byProvider.has('LORE_OWNER_GRAPH'));
  assert.ok(byProvider.has('MEMORY_OWNER_GRAPH'));
  assert.ok(byProvider.has('SCENE_OWNER_GRAPH'));
  assert.equal(byProvider.get('LORE_OWNER_GRAPH').temporalStatus,'CURRENT');
  assert.equal(byProvider.get('MEMORY_OWNER_GRAPH').temporalStatus,'HISTORICAL');
  const sceneEdges=refs.edges.filter(row=>row.providerId==='SCENE_OWNER_GRAPH');
  assert.ok(sceneEdges.some(row=>row.fromEntityId==='entity:oldmate'&&row.temporalStatus==='HISTORICAL'&&row.sourceRevisionRefs.includes('scene:north@3')));
  assert.ok(sceneEdges.some(row=>row.fromEntityId==='entity:newmate'&&row.temporalStatus==='CURRENT'&&row.sourceRevisionRefs.includes('scene:harbor@4')));
  assert.ok(sceneEdges.every(row=>!row.sourceRevisionRefs.some(ref=>ref.startsWith('scene:evidence:'))));
  assert.equal(byProvider.get('LORE_OWNER_GRAPH').drillbackRefs[0].sourceRevisionId,'lore:pilot@1');
  assert.equal(byProvider.get('MEMORY_OWNER_GRAPH').drillbackRefs.at(-1).artifactRef.artifactId,'memory-episode:pilot');
  assert.equal(JSON.stringify(refs).includes('SECRET_LORE_BODY_MUST_NOT_APPEAR'),false);
  assert.equal(JSON.stringify(refs).includes('SECRET_MEMORY_BODY_MUST_NOT_APPEAR'),false);
  assert.ok(refs.edges.every(row=>row.readOnly===true));
});

test('Native Brain exposes the bounded graph reference contract without authority escalation',()=>{
  const brain=new Area52NativeBrain();
  brain.registerEntityIdentity({entityId:'entity:pilot',canonicalLabel:'Pilot',entityType:'PERSON',worldId:'world:test'});
  brain.registerGraphProvider({
    providerId:'BRAIN_API_GRAPH',owner:'TEST_OWNER',semanticsVersion:'1',
    isRevisionCurrent:(ref)=>ref==='brain:source@1',
    query:()=>({providerRevision:'brain-provider:1',edges:[{
      edgeId:'brain-edge',fromEntityId:'entity:pilot',toEntityId:'artifact:brain',edgeMeaning:'RELATED_CONTEXT',
      sourceRevisionRefs:['brain:source@1'],provenanceRefs:['brain:prov@1'],artifactRef:{artifactId:'brain',artifactType:'Test',revision:1},temporalStatus:'CURRENT',
    }]}),
  });
  const refs=brain.worldGraphReferences('Pilot context',{intent:'CURRENT',anchorEntityIds:['entity:pilot'],worldRevision:brain.core.graph.revision});
  assert.equal(refs.kind,'StructuredWorldStateReferenceSet');
  assert.ok(refs.edges.some(row=>row.edgeId==='brain-edge'));
  assert.deepEqual(refs.authority,{graphMutation:false,truth:false,settlement:false,contextSeal:false,identitySettlement:false});
  assert.equal(refs.rawSourceContentIncluded,false);
});

test('targeted owner revision invalidation rejects only the stale dependency cone',()=>{
  const {core}=world();
  const active=new Set(['owner:a@1','owner:b@1']);
  const provider={
    providerId:'TARGETED_OWNER_GRAPH',owner:'TEST_OWNER',semanticsVersion:'1',
    isRevisionCurrent:(ref)=>active.has(String(ref)),
    query:()=>({providerRevision:'p1',edges:[
      {edgeId:'edge:a',fromEntityId:'entity:pilot',toEntityId:'artifact:a',edgeMeaning:'SUPPORTED_BY_A',sourceRevisionRefs:['owner:a@1'],provenanceRefs:['prov:a'],artifactRef:{artifactId:'a',artifactType:'Test',revision:1}},
      {edgeId:'edge:b',fromEntityId:'entity:pilot',toEntityId:'artifact:b',edgeMeaning:'SUPPORTED_BY_B',sourceRevisionRefs:['owner:b@1'],provenanceRefs:['prov:b'],artifactRef:{artifactId:'b',artifactType:'Test',revision:1}},
    ]}),
  };
  core.registerGraphProvider(provider);
  const before=core.worldGraphReferences('owner refs',{intent:'CURRENT',anchorEntityIds:['entity:pilot'],worldRevision:core.graph.revision});
  assert.ok(before.edges.some(row=>row.edgeId==='edge:a'));
  assert.ok(before.edges.some(row=>row.edgeId==='edge:b'));
  active.delete('owner:a@1');
  const after=core.worldGraphReferences('owner refs',{intent:'CURRENT',anchorEntityIds:['entity:pilot'],worldRevision:core.graph.revision});
  assert.equal(after.edges.some(row=>row.edgeId==='edge:a'),false);
  assert.ok(after.edges.some(row=>row.edgeId==='edge:b'));
  assert.ok(after.staleRejected.some(row=>row.edgeId==='edge:a'&&row.reason==='OWNER_GRAPH_SOURCE_REVISION_STALE'));
});

test('graph nominations enter Candidate Bus while stale and late owner edges are rejected before Context Seal',()=>{
  const {core}=world();
  core.registerExternalKnowledgeResolver((candidate)=>core.retrieval.resolveKnowledgeEvidence(candidate));
  core.publication.setSceneRevision(2,{sceneId:'scene:current'});
  core.registerGraphProvider({
    providerId:'FRESH_GRAPH',owner:'TEST_OWNER',semanticsVersion:'1',
    isRevisionCurrent:(ref)=>ref==='owner:fresh@1',
    query:()=>({providerRevision:'fresh:1',edges:[{
      edgeId:'fresh-edge',fromEntityId:'entity:pilot',toEntityId:'artifact:fresh',edgeMeaning:'OWNER_SUPPORT',
      sourceRevisionRefs:['owner:fresh@1'],provenanceRefs:['prov:fresh'],artifactRef:{artifactId:'fresh',artifactType:'Test',revision:1},temporalStatus:'CURRENT',
    }]}),
  });
  core.registerGraphProvider({
    providerId:'STALE_GRAPH',owner:'TEST_OWNER',semanticsVersion:'1',
    isRevisionCurrent:()=>false,
    query:()=>({providerRevision:'stale:1',edges:[{
      edgeId:'stale-edge',fromEntityId:'entity:pilot',toEntityId:'artifact:stale',edgeMeaning:'OWNER_SUPPORT',
      sourceRevisionRefs:['owner:stale@1'],artifactRef:{artifactId:'stale',artifactType:'Test',revision:1},temporalStatus:'CURRENT',
    }]}),
  });
  core.registerGraphProvider({
    providerId:'LATE_GRAPH',owner:'TEST_OWNER',semanticsVersion:'1',
    isRevisionCurrent:(ref)=>ref==='owner:late@1',
    query:()=>({providerRevision:'late:1',edges:[{
      edgeId:'late-edge',fromEntityId:'entity:pilot',toEntityId:'artifact:late',edgeMeaning:'OWNER_SUPPORT',
      sourceRevisionRefs:['owner:late@1'],sceneRevision:1,artifactRef:{artifactId:'late',artifactType:'Test',revision:1},temporalStatus:'CURRENT',
    }]}),
  });
  const published=core.publishGenerationContext({
    turnId:'turn:graph:1',turnRevision:1,correlationId:'corr:graph:1',query:'Where is Pilot?',intent:'CURRENT',
    anchorEntityIds:['entity:pilot'],channelIds:['ZZ_NATIVE_GRAPH_WALKER'],candidateBudget:32,latencyBudgetMs:100,budgetBytes:4000,
  });
  const graphCandidates=published.candidateEnvelope.candidates.filter(row=>(row.graphMetadata??[]).length);
  assert.ok(graphCandidates.some(row=>row.graphMetadata.some(meta=>meta.edgeId==='fresh-edge')));
  assert.equal(graphCandidates.some(row=>row.graphMetadata.some(meta=>meta.edgeId==='stale-edge'||meta.edgeId==='late-edge')),false);
  assert.ok(published.graphTraversalReceipt.staleRejected.some(row=>row.edgeId==='stale-edge'&&row.reason==='OWNER_GRAPH_SOURCE_REVISION_STALE'));
  assert.ok(published.graphTraversalReceipt.staleRejected.some(row=>row.edgeId==='late-edge'&&row.reason==='OWNER_GRAPH_SCENE_REVISION_STALE'));
  assert.ok(published.graphTraversalReceipt.referenceSummary.some(row=>row.edgeId==='fresh-edge'));
  assert.equal(published.sealReceipt.sourceRevisionIds.includes('owner:stale@1'),false);
  assert.equal(published.sealReceipt.sourceRevisionIds.includes('owner:late@1'),false);
});
