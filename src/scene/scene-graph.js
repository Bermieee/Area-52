import { SceneGraphEdgeType, SceneRelationship } from './lifecycle-contracts.js';

const clone=(v)=>structuredClone(v);
const uniq=(v)=>[...new Set((v??[]).filter(Boolean).map(String))];
const relationEdge={CONTINUES:SceneGraphEdgeType.SCENE_CONTINUES,PRECEDES:SceneGraphEdgeType.SCENE_PRECEDES,PARALLEL_TO:SceneGraphEdgeType.SCENE_PARALLEL,FLASHBACK_OF:SceneGraphEdgeType.SCENE_FLASHBACK,INTERRUPTS:SceneGraphEdgeType.SCENE_INTERRUPTS,RESUMES:SceneGraphEdgeType.SCENE_RESUMES};

export class SceneGraph{
  constructor(){this.nodes=new Map();this.edges=new Map();}
  addScene({sceneId,episodeRef=null,revision=1,metadata={}}){const prior=this.nodes.get(sceneId);this.nodes.set(sceneId,{kind:'SceneNode',sceneId,revision:Math.max(prior?.revision??0,revision),episodeRef:episodeRef??prior?.episodeRef??null,metadata:{...(prior?.metadata??{}),...clone(metadata)}});return clone(this.nodes.get(sceneId));}
  addRelationship({fromSceneId,toSceneId,relationship,evidenceRefs=[],sourceRevisionRefs=[],provenance=[],derivedFrom=[],sceneRevision=null,episodeRef=null}){
    if(!Object.values(SceneRelationship).includes(relationship))throw new TypeError(`unsupported relationship ${relationship}`);
    if(relationship===SceneRelationship.ISOLATED)throw new TypeError('ISOLATED host contexts are not narrative graph relationships');
    this.addScene({sceneId:fromSceneId});this.addScene({sceneId:toSceneId});
    const edgeType=relationEdge[relationship],id=`${edgeType}:${fromSceneId}->${toSceneId}`;const prior=this.edges.get(id);
    const edge={kind:'SceneGraphEdge',edgeId:id,edgeType,fromSceneId,toSceneId,evidenceRefs:uniq([...(prior?.evidenceRefs??[]),...evidenceRefs]),sourceRevisionRefs:uniq([...(prior?.sourceRevisionRefs??[]),...sourceRevisionRefs]),provenance:uniq([...(prior?.provenance??[]),...provenance]),derivedFrom:uniq([...(prior?.derivedFrom??[]),...derivedFrom]),sceneRevision:sceneRevision??prior?.sceneRevision??null,episodeRef:clone(episodeRef??prior?.episodeRef??null),temporalStatus:prior?.temporalStatus??'CURRENT',status:'ACTIVE',causal:false,authorityClass:'OBSERVED'};
    this.edges.set(id,edge);return clone(edge);
  }
  addMembership({sceneId,refId,kind,evidenceRefs=[],sourceRevisionRefs=[],provenance=[],sceneRevision=null,episodeRef=null,observedState=null,temporalApplicability=null,temporalStatus='CURRENT',metadata={}}){
    const map={ENTITY:SceneGraphEdgeType.ENTITY_IN_SCENE,EVENT:SceneGraphEdgeType.EVENT_IN_SCENE,OBJECT:SceneGraphEdgeType.OBJECT_IN_SCENE,THREAD:SceneGraphEdgeType.THREAD_IN_SCENE};
    const edgeType=map[kind];if(!edgeType)throw new TypeError(`unsupported membership kind ${kind}`);
    this.addScene({sceneId});const id=`${edgeType}:${refId}->${sceneId}`;const prior=this.edges.get(id);
    const edge={kind:'SceneGraphEdge',edgeId:id,edgeType,fromRef:String(refId),toSceneId:sceneId,evidenceRefs:uniq([...(prior?.evidenceRefs??[]),...evidenceRefs]),sourceRevisionRefs:uniq([...(prior?.sourceRevisionRefs??[]),...sourceRevisionRefs]),provenance:uniq([...(prior?.provenance??[]),...provenance]),sceneRevision:sceneRevision??prior?.sceneRevision??null,episodeRef:clone(episodeRef??prior?.episodeRef??null),observedState:observedState==null?prior?.observedState??null:clone(observedState),temporalApplicability:temporalApplicability==null?prior?.temporalApplicability??null:clone(temporalApplicability),metadata:{...(prior?.metadata??{}),...clone(metadata)},temporalStatus:String(temporalStatus??'CURRENT').toUpperCase(),status:'ACTIVE',causal:false,authorityClass:'OBSERVED'};
    this.edges.set(id,edge);return clone(edge);
  }
  addEvidenceLink({sceneId=null,sceneRevision=null,episodeRef=null,fromRef,toRef,relation='SUPPORTS',evidenceRefs=[],sourceRevisionRefs=[],provenance=[],derivedFrom=[],ownerApproved=false,supportStatus='SUPPORTED',interpretationId=null,temporalApplicability=null}={}){
    const from=String(fromRef??'').trim(),to=String(toRef??'').trim(),kind=String(relation??'SUPPORTS').toUpperCase(),support=String(supportStatus??'SUPPORTED').toUpperCase();
    if(!from||!to)throw new TypeError('evidence link requires fromRef and toRef');
    if(!['CAUSES','SUPPORTS'].includes(kind))throw new TypeError(`unsupported evidence relation ${kind}`);
    if(ownerApproved!==true)throw new TypeError('Scene graph evidence link requires ownerApproved=true');
    const refs=uniq(evidenceRefs);if(!refs.length)throw new TypeError('evidence-backed Scene graph link requires evidenceRefs');
    if(kind==='CAUSES'&&support!=='SUPPORTED')throw new TypeError('causal Scene graph link requires explicitly supported owner-approved evidence');
    if(!['SUPPORTED','UNRESOLVED'].includes(support))throw new TypeError('unsupported evidence supportStatus');
    const edgeType=kind==='CAUSES'?SceneGraphEdgeType.EVIDENCE_CAUSES:SceneGraphEdgeType.EVIDENCE_SUPPORTS;
    const suffix=interpretationId?':'+String(interpretationId):'',id=`${edgeType}:${from}->${to}${suffix}`;const prior=this.edges.get(id);
    const edge={kind:'SceneGraphEdge',edgeId:id,edgeType,sceneId:sceneId==null?prior?.sceneId??null:String(sceneId),sceneRevision:sceneRevision??prior?.sceneRevision??null,episodeRef:clone(episodeRef??prior?.episodeRef??null),fromRef:from,toRef:to,evidenceRefs:uniq([...(prior?.evidenceRefs??[]),...refs]),sourceRevisionRefs:uniq([...(prior?.sourceRevisionRefs??[]),...sourceRevisionRefs]),provenance:uniq([...(prior?.provenance??[]),...provenance]),derivedFrom:uniq([...(prior?.derivedFrom??[]),...derivedFrom]),supportStatus:support,interpretationId:interpretationId==null?null:String(interpretationId),temporalApplicability:clone(temporalApplicability),temporalStatus:support==='SUPPORTED'?'CURRENT':'UNRESOLVED',status:'ACTIVE',causal:kind==='CAUSES',evidenceBacked:true,ownerApproved:true,authorityClass:support==='SUPPORTED'?'INFERRED':'UNRESOLVED'};
    this.edges.set(id,edge);return clone(edge);
  }
  invalidateBySource(sourceRevisionId,replacementRef=null){
    const source=String(sourceRevisionId??'');if(!source)return[];const changed=[];
    for(const [id,edge] of this.edges){if(edge.status==='RETIRED')continue;const refs=uniq([...(edge.sourceRevisionRefs??[]),...(edge.evidenceRefs??[])]);if(!refs.includes(source))continue;const next={...edge,status:'RETIRED',temporalStatus:'SUPERSEDED',retiredSourceRevisionId:source,invalidatedBy:replacementRef==null?null:String(replacementRef)};this.edges.set(id,next);changed.push(clone(next));}
    return changed;
  }
  neighbors(sceneId,{includeRetired=false}={}){return [...this.edges.values()].filter(e=>(includeRetired||e.status!=='RETIRED')&&(e.fromSceneId===sceneId||e.toSceneId===sceneId||e.toSceneId===sceneId||e.sceneId===sceneId)).map(clone);}
  relation(from,to,{includeRetired=false}={}){return [...this.edges.values()].find(e=>(includeRetired||e.status!=='RETIRED')&&e.fromSceneId===from&&e.toSceneId===to)??null;}
  references({sceneId=null,includeRetired=false,limit=64}={}){const rows=[...this.edges.values()].filter(e=>(includeRetired||e.status!=='RETIRED')&&(!sceneId||e.fromSceneId===sceneId||e.toSceneId===sceneId||e.sceneId===sceneId)).slice(0,Math.max(1,Math.min(256,Number(limit)||64)));return rows.map(e=>({edgeId:e.edgeId,edgeType:e.edgeType,sceneId:e.sceneId??e.toSceneId??e.fromSceneId??null,sceneRevision:e.sceneRevision??null,episodeRef:clone(e.episodeRef??null),sourceRevisionRefs:uniq(e.sourceRevisionRefs??[]),evidenceRefs:uniq(e.evidenceRefs??[]),provenance:uniq(e.provenance??[]),observedState:clone(e.observedState??null),temporalApplicability:clone(e.temporalApplicability??null),temporalStatus:e.temporalStatus??'UNRESOLVED',status:e.status??'ACTIVE',causal:Boolean(e.causal),authorityClass:e.authorityClass??'UNRESOLVED'}));}
  exportState(){return clone({version:2,nodes:[...this.nodes.values()],edges:[...this.edges.values()]});}
  static importState(state){const g=new SceneGraph();for(const n of state.nodes??[])g.nodes.set(n.sceneId,n);for(const e of state.edges??[])g.edges.set(e.edgeId,e);return g;}
}
