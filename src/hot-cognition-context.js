import {PromptSlot,ContributionSource,createPromptContribution} from './adaptive-context-contracts.js';
import {stableHash} from './browser-runtime-utils.js';
import {HotSegmentKind,HotFreshness} from './hot-cognition-contracts.js';
import {AuthorityClass} from './contracts.js';

const clone=(v)=>v==null?v:structuredClone(v);
const uniq=(values)=>[...new Set((values??[]).filter(x=>typeof x==='string'&&x.length))].sort();
const currentT=[null,null,'CURRENT'];
const unresolvedT=[null,null,'UNRESOLVED'];

function segmentFact(snapshot,kind,{predicate=kind.toLowerCase(),slot=PromptSlot.CURRENT_SCENE,temporal='CURRENT',value=null}={}){
  const segment=snapshot.segments[kind];if(!segment||segment.freshness!==HotFreshness.FRESH)return null;
  const resolved=value===null?clone(segment.value):clone(value);
  if(resolved==null||(Array.isArray(resolved)&&resolved.length===0))return null;
  return{
    id:'hot:'+snapshot.stateId+':'+kind.toLowerCase()+':'+segment.revision,
    e:'hot:'+snapshot.chatNamespace,p:predicate,v:resolved,a:segment.authorityClass??AuthorityClass.UNRESOLVED,cf:1,
    t:temporal==='UNRESOLVED'?unresolvedT:currentT,hotSlot:slot,hotSegment:kind,segmentRevision:segment.revision,
    sourceRevisionRefs:uniq(segment.sourceRevisionRefs),dependencyRevisionRefs:uniq(segment.dependencyRevisionRefs),
    provenanceRefs:uniq(segment.provenanceRefs),owner:segment.owner,freshness:segment.freshness,
  };
}

function recentEpisodeFact(snapshot,perspectiveConstraint=null){
  const segment=snapshot.segments[HotSegmentKind.RECENT_EPISODE_TAIL];
  if(!segment||segment.freshness!==HotFreshness.FRESH)return null;
  const scope=String(perspectiveConstraint?.scope??perspectiveConstraint?.kind??'WORLD');
  const characterRef=perspectiveConstraint?.characterRef??perspectiveConstraint?.characterId??null;
  const rows=(segment.value??[]).filter(row=>{
    if(scope!=='CHARACTER_KNOWLEDGE')return true;
    if(!characterRef)return false;
    return Boolean(row?.publicToAll)||(row?.knownBy??[]).map(String).includes(String(characterRef));
  });
  if(!rows.length)return null;
  const fact=segmentFact(snapshot,HotSegmentKind.RECENT_EPISODE_TAIL,{predicate:'recent_episode_tail',value:rows});
  if(!fact)return null;
  fact.sourceRevisionRefs=uniq(rows.map(row=>row?.sourceRevisionId));
  fact.provenanceRefs=uniq(fact.sourceRevisionRefs);
  return fact;
}

export function buildHotCognitionCompilerProjection(snapshot,{perspectiveConstraint=null}={}){
  if(!snapshot?.snapshotId)return{kind:'HotCognitionCompilerProjection',snapshotId:null,hotRevision:null,facts:[],contributions:[],dependencies:[]};
  const sceneFacts=[];
  const candidates=[
    segmentFact(snapshot,HotSegmentKind.SCENE,{predicate:'scene'}),
    segmentFact(snapshot,HotSegmentKind.LOCATION,{predicate:'location'}),
    segmentFact(snapshot,HotSegmentKind.ACTIVE_CAST,{predicate:'active_cast'}),
    segmentFact(snapshot,HotSegmentKind.ACTIVE_ENTITIES,{predicate:'active_entities'}),
    segmentFact(snapshot,HotSegmentKind.CONTINUITY,{predicate:'continuity'}),
    recentEpisodeFact(snapshot,perspectiveConstraint),
    segmentFact(snapshot,HotSegmentKind.WORLD_REFERENCES,{predicate:'world_references'}),
  ];
  const graph=snapshot.segments[HotSegmentKind.GRAPH_NEIGHBORHOOD];
  if(graph?.freshness===HotFreshness.FRESH&&graph.value?.state==='AVAILABLE'&&(graph.value?.refs??[]).length)candidates.push(segmentFact(snapshot,HotSegmentKind.GRAPH_NEIGHBORHOOD,{predicate:'graph_neighborhood'}));
  for(const fact of candidates)if(fact)sceneFacts.push(fact);

  const threadSegment=snapshot.segments[HotSegmentKind.ACTIVE_THREADS],threadFacts=[];
  if(threadSegment?.freshness===HotFreshness.FRESH){
    for(const thread of threadSegment.value??[]){
      threadFacts.push({
        id:'hot:'+snapshot.stateId+':thread:'+String(thread.threadId)+':'+threadSegment.revision,
        e:'hot:'+snapshot.chatNamespace,p:'active_thread',v:{
          threadId:thread.threadId,owner:thread.owner,source:thread.source,status:thread.status,
          objective:thread.objective??null,unresolvedQuestion:thread.unresolvedQuestion??null,
          expiry:clone(thread.expiry??null),closureConditions:clone(thread.closureConditions??[]),
        },
        a:AuthorityClass.UNRESOLVED,cf:1,t:unresolvedT,hotSlot:PromptSlot.ACTIVE_THREADS,hotSegment:HotSegmentKind.ACTIVE_THREADS,
        segmentRevision:threadSegment.revision,sourceRevisionRefs:uniq([...threadSegment.sourceRevisionRefs,...(thread.sourceRevisionRefs??[])]),
        dependencyRevisionRefs:uniq(threadSegment.dependencyRevisionRefs),provenanceRefs:uniq([...threadSegment.provenanceRefs,...(thread.evidenceRefs??[]),...(thread.provenanceRefs??[])]),
        owner:thread.owner??threadSegment.owner,freshness:threadSegment.freshness,
      });
    }
  }

  const facts=[...sceneFacts,...threadFacts];
  const contributions=[];
  if(sceneFacts.length){
    contributions.push(createPromptContribution({
      id:'hot-contribution:scene:'+snapshot.snapshotId,slot:PromptSlot.CURRENT_SCENE,sourceCategory:ContributionSource.SEALED_PACKET,
      owner:'CONTEXT_COMPILER',semantic:true,semanticRefs:sceneFacts.map(x=>x.id),
      content:null,sourceRevisionIds:uniq(sceneFacts.flatMap(x=>x.sourceRevisionRefs)),authorityClass:AuthorityClass.UNRESOLVED,
      temporalStatus:'CURRENT',role:'context',required:true,priority:10,
      metadata:{hotCognitionSnapshotId:snapshot.snapshotId,hotRevision:snapshot.hotRevision,chatNamespace:snapshot.chatNamespace},
    }));
  }
  if(threadFacts.length){
    contributions.push(createPromptContribution({
      id:'hot-contribution:threads:'+snapshot.snapshotId,slot:PromptSlot.ACTIVE_THREADS,sourceCategory:ContributionSource.SEALED_PACKET,
      owner:'CONTEXT_COMPILER',semantic:true,semanticRefs:threadFacts.map(x=>x.id),
      content:null,sourceRevisionIds:uniq(threadFacts.flatMap(x=>x.sourceRevisionRefs)),authorityClass:AuthorityClass.UNRESOLVED,
      temporalStatus:'UNRESOLVED',role:'context',required:true,priority:10,
      metadata:{hotCognitionSnapshotId:snapshot.snapshotId,hotRevision:snapshot.hotRevision,chatNamespace:snapshot.chatNamespace},
    }));
  }
  return{
    kind:'HotCognitionCompilerProjection',snapshotId:snapshot.snapshotId,hotRevision:snapshot.hotRevision,chatNamespace:snapshot.chatNamespace,
    sceneRevision:snapshot.sceneRevision,worldRevision:snapshot.worldRevision,facts,contributions,
    dependencies:uniq(facts.flatMap(x=>[...x.sourceRevisionRefs,...x.dependencyRevisionRefs])),
  };
}

export function attachHotCognitionToPacket(packet,projection){
  if(!projection?.facts?.length)return{packet:clone(packet),contributions:[],attached:false};
  const next=clone(packet),provenanceIndex={...(next.provenanceIndex??{})},dependencies=new Set(next.dependencies??[]);
  for(const fact of projection.facts){
    provenanceIndex[fact.id]=uniq([...fact.sourceRevisionRefs,...fact.dependencyRevisionRefs]);
    for(const ref of [...fact.sourceRevisionRefs,...fact.dependencyRevisionRefs])dependencies.add(ref);
  }
  next.hotCognitionProvenanceIndex=Object.fromEntries(projection.facts.map(fact=>[fact.id,uniq(fact.provenanceRefs??[])]));
  next.hotCognition=projection.facts.map(fact=>{const row=clone(fact);delete row.provenanceRefs;return row;});
  next.provenanceIndex=provenanceIndex;next.dependencies=[...dependencies].sort();
  next.hotCognitionSnapshotId=projection.snapshotId;next.hotCognitionRevision=projection.hotRevision;next.hotCognitionChatNamespace=projection.chatNamespace;
  next.id=String(packet.id)+':hot:'+stableHash({snapshotId:projection.snapshotId,facts:projection.facts.map(x=>[x.id,x.hotSlot,x.segmentRevision])},{length:16});
  return{packet:next,contributions:projection.contributions.map(clone),attached:true};
}
