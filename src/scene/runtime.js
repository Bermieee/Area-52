import { DeltaReason, createSceneDelta, createSceneObservationProposal } from './contracts.js';
import { SceneRegistry } from './scene-registry.js';
import { SceneDeltaEngine } from './delta-engine.js';
import { SceneReconciler } from './reconciliation.js';
import { SemanticBoundaryDetector } from './boundary-detector.js';
import { BoundaryVerifier } from './boundary-verifier.js';

export class SceneIntelligenceRuntime {
  constructor({ registry = new SceneRegistry(), deltaEngine = new SceneDeltaEngine(), reconciler = new SceneReconciler(), boundaryDetector = new SemanticBoundaryDetector(), boundaryVerifier = new BoundaryVerifier() } = {}) {
    this.registry=registry;this.deltaEngine=deltaEngine;this.reconciler=reconciler;this.boundaryDetector=boundaryDetector;this.boundaryVerifier=boundaryVerifier;
  }

  open(options={}) { const record=this.registry.openScene(options); this.reconciler.markKnownGood(record.snapshots.at(-1)); return record; }

  observe({ sceneId, proposalId, fields, sourceRevisionRefs = [], evidenceRefs = [], reason, provider = null, allowWhenRefreshRequired = false }) {
    const current=this.registry.current(sceneId); if(!current)throw new Error(`unknown scene ${sceneId}`);
    const proposal=createSceneObservationProposal({proposalId,sceneId,baseRevision:current.revision,fields,sourceRevisionRefs,evidenceRefs,reason,provider});
    const guarded=this.reconciler.guardProposal(current,proposal);
    if(!Object.keys(guarded.proposal.fields??{}).length&&guarded.blockedFields.length)return{scene:current,delta:null,applied:false,proposal,blockedFields:guarded.blockedFields,noChange:true};
    const result=this.deltaEngine.apply(current,guarded.proposal,{allowWhenRefreshRequired});
    if(result.applied){this.registry.commit(result.scene,result.delta); if(!result.delta.fullRefreshRequired)this.reconciler.markKnownGood(result.scene);}
    return {...result,proposal,blockedFields:guarded.blockedFields};
  }

  correct({sceneId,fieldName,fieldState,evidenceRefs=[]}={}){
    const current=this.registry.current(sceneId);if(!current)throw new Error(`unknown scene ${sceneId}`);
    if(!fieldName||!current.fields?.[fieldName])throw new Error(`unknown Scene field ${fieldName}`);
    const corrected=this.reconciler.applyCorrection(current,fieldName,fieldState,{evidenceRefs});
    const after=corrected.scene.fields[fieldName];
    const delta=createSceneDelta({sceneId,fromRevision:current.revision,toRevision:corrected.scene.revision,changedFields:{[fieldName]:{before:current.fields[fieldName],after}},evidenceRefs:[...new Set(evidenceRefs)],confidence:after.confidence,reason:DeltaReason.CORRECTION});
    this.registry.commit(corrected.scene,delta);this.reconciler.markKnownGood(corrected.scene);
    return{scene:corrected.scene,delta,reconciliation:corrected.reconciliation,applied:true};
  }

  boundary(input) { const candidate=this.boundaryDetector.detect(input); if(!candidate)return null; return { candidate, decision:this.boundaryVerifier.submit(candidate) }; }

  publicSignals(sceneId) {
    const scene=this.registry.current(sceneId); if(!scene)return null; const f=scene.fields;
    return { sceneId:scene.sceneId,sceneRevision:scene.revision,activeCast:f.activeCast?.value??[],location:f.location?.value??null,activeThreads:f.activeThreads?.value??[],conflictSignals:scene.unresolvedFields,boundaryState:f.boundaryState?.value??null,uncertainFields:[...scene.unresolvedFields],objects:f.immediateObjects?.value??[],atmosphere:f.atmosphere?.value??null,health:scene.health??{status:'ready',reasons:[]} };
  }
}
