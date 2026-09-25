import { createSceneObservationProposal } from './contracts.js';
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
    const result=this.deltaEngine.apply(current,proposal,{allowWhenRefreshRequired});
    if(result.applied){this.registry.commit(result.scene,result.delta); if(!result.delta.fullRefreshRequired)this.reconciler.markKnownGood(result.scene);} return {...result,proposal};
  }

  boundary(input) { const candidate=this.boundaryDetector.detect(input); if(!candidate)return null; return { candidate, decision:this.boundaryVerifier.submit(candidate) }; }

  publicSignals(sceneId) {
    const scene=this.registry.current(sceneId); if(!scene)return null; const f=scene.fields;
    return { sceneId:scene.sceneId,sceneRevision:scene.revision,activeCast:f.activeCast?.value??[],location:f.location?.value??null,activeThreads:f.activeThreads?.value??[],conflictSignals:scene.unresolvedFields,boundaryState:f.boundaryState?.value??null,uncertainFields:[...scene.unresolvedFields],objects:f.immediateObjects?.value??[],atmosphere:f.atmosphere?.value??null,health:scene.health??{status:'ready',reasons:[]} };
  }
}
