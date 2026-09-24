import { createProvenance, createSourceRecord, createSourceRevision } from './contracts.js';
import { stableHash } from './browser-runtime-utils.js';

export function hashContent(content) { return stableHash(content,{alreadyString:true}); }

export class SourceRegistry {
  #sources=new Map(); #revisions=new Map(); #revisionIdsBySource=new Map(); #activeRevisionBySource=new Map();
  #artifacts=new Map(); #artifactDeps=new Map(); #artifactChildren=new Map(); #revisionChildren=new Map(); #invalidated=new Map();

  importSource({id,sourceType,content,logicalKey=id,metadata={}}){
    if(this.#sources.has(id)) throw new Error(`Source already exists: ${id}`);
    const record=createSourceRecord({id,sourceType,logicalKey,metadata}); this.#sources.set(id,record);
    const revision=this.#createRevision(record.id,content,null); return{record:structuredClone(record),revision:structuredClone(revision)};
  }
  replaceSource(sourceId,exactContent){
    const record=this.#sources.get(sourceId); if(!record) throw new Error(`Unknown source: ${sourceId}`);
    const current=this.getActiveRevision(sourceId); const nextHash=hashContent(exactContent);
    if(current.contentHash===nextHash) return{changed:false,revision:current,invalidatedArtifactIds:[]};
    const revision=this.#createRevision(sourceId,exactContent,current.id);
    const invalidatedArtifactIds=this.invalidateFromRevision(current.id,`source-replaced:${revision.id}`);
    return{changed:true,revision:structuredClone(revision),invalidatedArtifactIds};
  }
  #createRevision(sourceId,exactContent,replacesRevisionId){
    if(typeof exactContent!=='string'||!exactContent.length) throw new TypeError('Source content must be a non-empty string');
    const ids=this.#revisionIdsBySource.get(sourceId)??[]; const revisionNumber=ids.length+1; const id=`${sourceId}@${revisionNumber}`;
    const revision=createSourceRevision({id,sourceId,revision:revisionNumber,contentHash:hashContent(exactContent),exactContent,replacesRevisionId});
    this.#revisions.set(id,revision); this.#revisionIdsBySource.set(sourceId,[...ids,id]); this.#activeRevisionBySource.set(sourceId,id); return revision;
  }
  getSource(sourceId){const r=this.#sources.get(sourceId);return r?structuredClone(r):null;}
  getRevision(revisionId){const r=this.#revisions.get(revisionId);return r?structuredClone(r):null;}
  getActiveRevision(sourceId){const id=this.#activeRevisionBySource.get(sourceId);if(!id)throw new Error(`Unknown source: ${sourceId}`);return this.getRevision(id);}
  isActiveRevision(revisionId){const r=this.#revisions.get(revisionId);return Boolean(r&&this.#activeRevisionBySource.get(r.sourceId)===revisionId);}
  listRevisions(sourceId){return(this.#revisionIdsBySource.get(sourceId)??[]).map(id=>this.getRevision(id));}
  listSources(){return[...this.#sources.values()].map(x=>structuredClone(x));}

  registerDerivedArtifact({artifactId,artifact,sourceRevisionIds=[],dependsOnArtifactIds=[],activity='DERIVE',agent='area52-core'}){
    if(!artifactId) throw new TypeError('artifactId is required');
    for(const revisionId of sourceRevisionIds) if(!this.#revisions.has(revisionId)) throw new Error(`Unknown source revision dependency: ${revisionId}`);
    for(const dependencyId of dependsOnArtifactIds) if(!this.#artifacts.has(dependencyId)) throw new Error(`Unknown artifact dependency: ${dependencyId}`);
    this.#unlinkArtifact(artifactId);
    const provenance=createProvenance({id:`prov:${artifactId}`,sourceRevisionIds,derivedFromIds:dependsOnArtifactIds,activity,agent,invalidators:[...sourceRevisionIds,...dependsOnArtifactIds]});
    const stored={...structuredClone(artifact),provenance}; this.#artifacts.set(artifactId,stored);
    this.#artifactDeps.set(artifactId,{sourceRevisionIds:[...sourceRevisionIds],dependsOnArtifactIds:[...dependsOnArtifactIds]}); this.#invalidated.delete(artifactId);
    for(const revisionId of sourceRevisionIds)this.#addChild(this.#revisionChildren,revisionId,artifactId);
    for(const dependencyId of dependsOnArtifactIds)this.#addChild(this.#artifactChildren,dependencyId,artifactId);
    return structuredClone(stored);
  }
  #addChild(map,key,value){const set=map.get(key)??new Set();set.add(value);map.set(key,set);}
  #unlinkArtifact(artifactId){const deps=this.#artifactDeps.get(artifactId);if(!deps)return;for(const r of deps.sourceRevisionIds)this.#revisionChildren.get(r)?.delete(artifactId);for(const p of deps.dependsOnArtifactIds)this.#artifactChildren.get(p)?.delete(artifactId);}
  invalidateFromRevision(revisionId,reason='source-revision-invalidated'){
    if(!this.#revisions.has(revisionId))throw new Error(`Unknown source revision: ${revisionId}`);
    const queue=[...(this.#revisionChildren.get(revisionId)??[])],invalidated=[],seen=new Set();
    while(queue.length){const id=queue.shift();if(seen.has(id))continue;seen.add(id);this.#invalidated.set(id,{reason,revisionId});invalidated.push(id);queue.push(...(this.#artifactChildren.get(id)??[]));}
    return invalidated.sort();
  }
  isArtifactValid(artifactId){return this.#artifacts.has(artifactId)&&!this.#invalidated.has(artifactId);}
  getArtifact(artifactId,{includeInvalid=false}={}){if(!includeInvalid&&!this.isArtifactValid(artifactId))return null;const a=this.#artifacts.get(artifactId);return a?structuredClone(a):null;}
  listArtifacts({kind=null,includeInvalid=false}={}){return[...this.#artifacts.entries()].filter(([id,a])=>(includeInvalid||this.isArtifactValid(id))&&(!kind||a.kind===kind)).map(([,a])=>structuredClone(a));}
  artifactDependencies(artifactId){const d=this.#artifactDeps.get(artifactId);return d?structuredClone(d):null;}
  invalidationReason(artifactId){const r=this.#invalidated.get(artifactId);return r?structuredClone(r):null;}
  explainArtifact(artifactId){
    if(!this.#artifacts.has(artifactId))return null;
    const visit=(id,seen=new Set())=>{if(seen.has(id))return{artifactId:id,cycle:true};seen.add(id);const deps=this.#artifactDeps.get(id)??{sourceRevisionIds:[],dependsOnArtifactIds:[]};return{artifactId:id,valid:this.isArtifactValid(id),sourceRevisions:deps.sourceRevisionIds.map(r=>this.getRevision(r)),derivedFrom:deps.dependsOnArtifactIds.map(p=>visit(p,new Set(seen)))}};
    return visit(artifactId);
  }
  activeRevisionIds(){return[...this.#activeRevisionBySource.values()].sort();}
}
