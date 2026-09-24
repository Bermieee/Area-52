import { SceneLifecycle } from './contracts.js';
import { createCurrentScene } from './current-scene.js';

const clone = (value) => structuredClone(value);

export class SceneRegistry {
  constructor() { this.records = new Map(); this.sequence = 0; }

  openScene({ sceneId = null, sourceRange = { start:null, end:null }, sourceRevisionRefs = [], parentSceneId = null, relatedSceneIds = [], startMarker = null, provenance = [] } = {}) {
    const id = sceneId ?? `scene:${++this.sequence}`;
    if (this.records.has(id)) throw new Error(`scene already exists: ${id}`);
    const current = createCurrentScene({ sceneId:id, revision:1, lifecycle:SceneLifecycle.OPEN, sourceRange, sourceRevisionRefs, provenance });
    const record = { sceneId:id, revision:1, lifecycle:SceneLifecycle.OPEN, sourceRange:clone(sourceRange), startMarker:clone(startMarker), endMarker:null, parentSceneId, relatedSceneIds:[...new Set(relatedSceneIds)], provenance:[...new Set(provenance)], snapshots:[clone(current)], deltas:[], futureSceneEpisodeRef:null, createdAt:Date.now(), updatedAt:Date.now() };
    this.records.set(id, record); return clone(record);
  }

  current(sceneId) { const record=this.records.get(sceneId); return record ? clone(record.snapshots.at(-1)) : null; }
  get(sceneId) { const record=this.records.get(sceneId); return record ? clone(record) : null; }
  list() { return [...this.records.values()].map(clone); }

  commit(scene, delta = null) {
    const record = this.records.get(scene.sceneId); if (!record) throw new Error(`unknown scene ${scene.sceneId}`);
    if (scene.revision <= record.revision) throw new Error('scene revision must advance monotonically');
    record.revision = scene.revision; record.lifecycle = scene.lifecycle; record.sourceRange = clone(scene.sourceRange); record.snapshots.push(clone(scene)); if (delta) record.deltas.push(clone(delta)); record.updatedAt = Date.now();
    return { sceneId: record.sceneId, revision: record.revision, lifecycle: record.lifecycle };
  }

  closeScene(sceneId, { endMarker = null, futureSceneEpisodeRef = null, evidenceRefs = [] } = {}) {
    const record = this.records.get(sceneId); if (!record) throw new Error(`unknown scene ${sceneId}`);
    const current = clone(record.snapshots.at(-1)); current.revision += 1; current.lifecycle = SceneLifecycle.CLOSED; current.updatedAt = Date.now(); current.provenance = [...new Set([...current.provenance, ...evidenceRefs])]; record.revision = current.revision; record.lifecycle = SceneLifecycle.CLOSED; record.endMarker = clone(endMarker); record.futureSceneEpisodeRef = futureSceneEpisodeRef; record.snapshots.push(current); record.updatedAt = Date.now(); return clone(record);
  }

  suspendScene(sceneId, evidenceRefs = []) { const record=this.records.get(sceneId); if(!record)throw new Error(`unknown scene ${sceneId}`); const current=clone(record.snapshots.at(-1)); current.revision+=1; current.lifecycle=SceneLifecycle.SUSPENDED; current.provenance=[...new Set([...current.provenance,...evidenceRefs])]; record.revision=current.revision; record.lifecycle=SceneLifecycle.SUSPENDED; record.snapshots.push(current); return clone(record); }

  resumeScene(sceneId, evidenceRefs = []) { const record=this.records.get(sceneId); if(!record)throw new Error(`unknown scene ${sceneId}`); const current=clone(record.snapshots.at(-1)); current.revision+=1; current.lifecycle=SceneLifecycle.OPEN; current.provenance=[...new Set([...current.provenance,...evidenceRefs])]; record.revision=current.revision; record.lifecycle=SceneLifecycle.OPEN; record.snapshots.push(current); return clone(record); }

  exportState(){return clone({version:1,sequence:this.sequence,records:[...this.records.entries()]});}
  static importState(state){const r=new SceneRegistry();r.sequence=state.sequence??0;r.records=new Map((state.records??[]).map(([id,record])=>[id,clone(record)]));return r;}

  reviseSource(sceneId, { sourceRevisionRef, affectedFields = [], evidenceRefs = [] }) {
    const record=this.records.get(sceneId); if(!record)throw new Error(`unknown scene ${sceneId}`); const current=clone(record.snapshots.at(-1)); current.revision+=1; current.sourceRevisionRefs=[...new Set([...current.sourceRevisionRefs,sourceRevisionRef])].slice(-128); current.updatedAt=Date.now(); current.provenance=[...new Set([...current.provenance,...evidenceRefs])].slice(-128);
    for(const field of affectedFields){if(current.fields[field]){current.fields[field]={...current.fields[field],observationClass:'UNRESOLVED',confidence:0,evidenceRefs:[...new Set(evidenceRefs)],revision:current.revision,provenance:[...new Set([...(current.fields[field].provenance??[]),...evidenceRefs])],metadata:{...(current.fields[field].metadata??{}),invalidatedBySourceEdit:true,previousEvidenceRefs:[...(current.fields[field].evidenceRefs??[])]}}; current.fieldEvidence[field]=[...new Set([...(current.fieldEvidence[field]??[]),...evidenceRefs])].slice(-64); if(!current.unresolvedFields.includes(field))current.unresolvedFields.push(field);}}
    record.revision=current.revision; record.snapshots.push(current); record.updatedAt=Date.now(); return clone(record);
  }
}
