import { DeltaReason, ObservationClass, createFieldState } from './contracts.js';

const clone = (value) => structuredClone(value);
const uniq=(values)=>[...new Set((values??[]).filter(Boolean).map(String))];

export class SceneReconciler {
  constructor({ maxHistory = 64 } = {}) { this.maxHistory = maxHistory; this.lastKnownGood = new Map(); }

  markKnownGood(scene) { this.lastKnownGood.set(scene.sceneId, clone(scene)); return clone(scene); }
  getLastKnownGood(sceneId) { const value=this.lastKnownGood.get(sceneId); return value ? clone(value) : null; }

  detectSuspicious(scene, delta) {
    const warnings = [];
    for (const [name, change] of Object.entries(delta.changedFields ?? {})) {
      if (name === 'location' && change.after?.metadata?.impossibleTransition) warnings.push({ field:name, reason:'IMPOSSIBLE_SPATIAL_TRANSITION' });
      if (name === 'narrativeTime' && change.after?.metadata?.sequenceBroken) warnings.push({ field:name, reason:'TEMPORAL_SEQUENCE_BROKEN' });
      if (name === 'activeCast' && change.after?.observationClass !== ObservationClass.OBSERVED) {
        const before = Array.isArray(change.before?.value) ? change.before.value.length : 0; const after = Array.isArray(change.after?.value) ? change.after.value.length : 0;
        if (after - before > 6) warnings.push({ field:name, reason:'CAST_EXPLOSION' });
      }
    }
    return warnings;
  }

  guardProposal(scene,proposal){
    const fields={},blockedFields=[];
    for(const [name,proposed] of Object.entries(proposal?.fields??{})){
      const current=scene?.fields?.[name],fence=current?.metadata?.correctionFence??null;
      if(!fence||proposed?.observationClass!==ObservationClass.INFERRED){fields[name]=proposed;continue;}
      const evidence=uniq([...(proposed?.evidenceRefs??[]),...(proposal?.evidenceRefs??[]),...(proposal?.sourceRevisionRefs??[])]);
      const superseded=new Set(fence.supersededEvidenceRefs??[]);
      const hasNovel=evidence.some(ref=>!superseded.has(ref));
      if(hasNovel){fields[name]=proposed;continue;}
      blockedFields.push(name);
    }
    return{proposal:{...proposal,fields},blockedFields};
  }

  rollbackField(scene, fieldName, { evidenceRefs = [], reason = 'targeted rollback' } = {}) {
    const known = this.lastKnownGood.get(scene.sceneId); if (!known?.fields?.[fieldName]) throw new Error(`no last-known-good field ${fieldName}`);
    const next = clone(scene); next.revision += 1; next.updatedAt = Date.now(); next.fields[fieldName] = createFieldState({ ...known.fields[fieldName], revision:next.revision, evidenceRefs:[...new Set([...known.fields[fieldName].evidenceRefs,...evidenceRefs])], metadata:{...(known.fields[fieldName].metadata??{}), rollbackReason:reason, rollbackFromRevision:scene.revision} });
    next.provenance=[...new Set([...next.provenance,...evidenceRefs])]; next.unresolvedFields=next.unresolvedFields.filter((x)=>x!==fieldName); next.health={status:'ready',reasons:[]}; next.warnings=[];
    return { scene:next, reconciliation:{ kind:'SceneReconciliation', reason:DeltaReason.RECONCILIATION, fields:[fieldName], fromRevision:scene.revision, toRevision:next.revision, evidenceRefs:[...evidenceRefs] } };
  }

  applyCorrection(scene, fieldName, fieldState, { evidenceRefs = [] } = {}) {
    const before=scene?.fields?.[fieldName]??null;
    const supersededEvidenceRefs=uniq([...(before?.evidenceRefs??[]),...(before?.metadata?.correctionFence?.supersededEvidenceRefs??[])]);
    const next=clone(scene); next.revision+=1; next.updatedAt=Date.now();
    next.fields[fieldName]=createFieldState({
      ...fieldState,revision:next.revision,evidenceRefs:uniq([...(fieldState.evidenceRefs??[]),...evidenceRefs]),
      metadata:{...(fieldState.metadata??{}),operatorOrSourceCorrection:true,correctionFence:{atRevision:next.revision,supersededEvidenceRefs,correctionEvidenceRefs:uniq(evidenceRefs)}}
    });
    next.fieldEvidence[fieldName]=uniq([...(next.fieldEvidence?.[fieldName]??[]),...evidenceRefs]).slice(-64);
    next.provenance=uniq([...next.provenance,...evidenceRefs]).slice(-128);next.unresolvedFields=next.unresolvedFields.filter((x)=>x!==fieldName);next.health={status:'ready',reasons:[]};
    return{scene:next,reconciliation:{kind:'SceneReconciliation',reason:DeltaReason.CORRECTION,fields:[fieldName],fromRevision:scene.revision,toRevision:next.revision,evidenceRefs:uniq(evidenceRefs),correctionFence:true}};
  }

  trimRegistryRecord(record) { if(record.snapshots?.length>this.maxHistory) record.snapshots.splice(0,record.snapshots.length-this.maxHistory); if(record.deltas?.length>this.maxHistory*2) record.deltas.splice(0,record.deltas.length-this.maxHistory*2); return record; }
}
