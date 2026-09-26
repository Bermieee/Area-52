import { SceneGraphEdgeType, SceneRelationship } from './lifecycle-contracts.js';

const clone=(v)=>structuredClone(v);
const relationEdge={CONTINUES:SceneGraphEdgeType.SCENE_CONTINUES,PRECEDES:SceneGraphEdgeType.SCENE_PRECEDES,PARALLEL_TO:SceneGraphEdgeType.SCENE_PARALLEL,FLASHBACK_OF:SceneGraphEdgeType.SCENE_FLASHBACK,INTERRUPTS:SceneGraphEdgeType.SCENE_INTERRUPTS,RESUMES:SceneGraphEdgeType.SCENE_RESUMES};

export class SceneGraph{
  constructor(){this.nodes=new Map();this.edges=new Map();}
  addScene({sceneId,episodeRef=null,revision=1,metadata={}}){const prior=this.nodes.get(sceneId);this.nodes.set(sceneId,{kind:'SceneNode',sceneId,revision:Math.max(prior?.revision??0,revision),episodeRef:episodeRef??prior?.episodeRef??null,metadata:{...(prior?.metadata??{}),...clone(metadata)}});return clone(this.nodes.get(sceneId));}
  addRelationship({fromSceneId,toSceneId,relationship,evidenceRefs=[],provenance=[],derivedFrom=[]}){
    if(!Object.values(SceneRelationship).includes(relationship))throw new TypeError(`unsupported relationship ${relationship}`);
    if(relationship===SceneRelationship.ISOLATED)throw new TypeError('ISOLATED host contexts are not narrative graph relationships');
    this.addScene({sceneId:fromSceneId});this.addScene({sceneId:toSceneId});
    const edgeType=relationEdge[relationship];const id=`${edgeType}:${fromSceneId}->${toSceneId}`;
    if(this.edges.has(id))return clone(this.edges.get(id));
    const edge={kind:'SceneGraphEdge',edgeId:id,edgeType,fromSceneId,toSceneId,evidenceRefs:[...new Set(evidenceRefs)],provenance:[...new Set(provenance)],derivedFrom:[...new Set(derivedFrom)],causal:false};
    this.edges.set(id,edge);return clone(edge);
  }
  addMembership({sceneId,refId,kind,evidenceRefs=[],provenance=[]}){
    const map={ENTITY:SceneGraphEdgeType.ENTITY_IN_SCENE,EVENT:SceneGraphEdgeType.EVENT_IN_SCENE,OBJECT:SceneGraphEdgeType.OBJECT_IN_SCENE,THREAD:SceneGraphEdgeType.THREAD_IN_SCENE};
    const edgeType=map[kind];if(!edgeType)throw new TypeError(`unsupported membership kind ${kind}`);
    this.addScene({sceneId});const id=`${edgeType}:${refId}->${sceneId}`;const edge={kind:'SceneGraphEdge',edgeId:id,edgeType,fromRef:refId,toSceneId:sceneId,evidenceRefs:[...new Set(evidenceRefs)],provenance:[...new Set(provenance)],causal:false};this.edges.set(id,edge);return clone(edge);
  }

  addEvidenceLink({fromRef,toRef,relation='SUPPORTS',evidenceRefs=[],provenance=[],derivedFrom=[]}={}){
    const from=String(fromRef??'').trim(),to=String(toRef??'').trim(),kind=String(relation??'SUPPORTS').toUpperCase();
    if(!from||!to)throw new TypeError('evidence link requires fromRef and toRef');
    if(!['CAUSES','SUPPORTS'].includes(kind))throw new TypeError(`unsupported evidence relation ${kind}`);
    const refs=[...new Set((evidenceRefs??[]).filter(Boolean).map(String))];
    if(!refs.length)throw new TypeError('evidence-backed Scene graph link requires evidenceRefs');
    const edgeType=kind==='CAUSES'?SceneGraphEdgeType.EVIDENCE_CAUSES:SceneGraphEdgeType.EVIDENCE_SUPPORTS;
    const id=`${edgeType}:${from}->${to}`;
    const prior=this.edges.get(id);
    const edge={kind:'SceneGraphEdge',edgeId:id,edgeType,fromRef:from,toRef:to,evidenceRefs:[...new Set([...(prior?.evidenceRefs??[]),...refs])],provenance:[...new Set([...(prior?.provenance??[]),...(provenance??[])])],derivedFrom:[...new Set([...(prior?.derivedFrom??[]),...(derivedFrom??[])])],causal:kind==='CAUSES',evidenceBacked:true};
    this.edges.set(id,edge);return clone(edge);
  }
  neighbors(sceneId){return [...this.edges.values()].filter((e)=>e.fromSceneId===sceneId||e.toSceneId===sceneId).map(clone);}
  relation(from,to){return [...this.edges.values()].find((e)=>e.fromSceneId===from&&e.toSceneId===to)??null;}
  exportState(){return clone({version:1,nodes:[...this.nodes.values()],edges:[...this.edges.values()]});}
  static importState(state){const g=new SceneGraph();for(const n of state.nodes??[])g.nodes.set(n.sceneId,n);for(const e of state.edges??[])g.edges.set(e.edgeId,e);return g;}
}
