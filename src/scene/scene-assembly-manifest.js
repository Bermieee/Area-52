export const SCENE_SOURCE_BRANCH='Development-Scene-Scanner';

export const SceneProductionPaths=Object.freeze([
  'src/scene/active-cast.js','src/scene/atmosphere.js','src/scene/boundary-detector.js','src/scene/boundary-verifier.js',
  'src/scene/context-invalidation.js','src/scene/contracts.js','src/scene/current-scene.js','src/scene/delta-engine.js',
  'src/scene/event-publisher.js','src/scene/host-bridge.js','src/scene/index.js','src/scene/integration-contracts.js',
  'src/scene/lifecycle-contracts.js','src/scene/lifecycle-state.js','src/scene/narrative-feed-adapter.js','src/scene/object-state.js',
  'src/scene/prefetch-trigger.js','src/scene/reconciliation.js','src/scene/runtime.js','src/scene/scene-episode.js',
  'src/scene/scene-assembly-manifest.js','src/scene/scene-graph.js','src/scene/scene-integration-view.js','src/scene/scene-lifecycle-runtime.js','src/scene/scene-memory-handoff.js',
  'src/scene/scene-registry.js','src/scene/scene-retrieval.js','src/scene/scene-stack.js','src/scene/scene-state-extractor.js',
  'src/scene/scene-ui-read-model.js','src/scene/spatial-state.js','src/scene/temporal-state.js','src/scene/transition-manager.js',
]);

export const SceneTestPaths=Object.freeze([
  'tests/scene-browser-compat.mjs','tests/scene-core.mjs','tests/scene-golden.mjs','tests/scene-host-feed.mjs','tests/scene-stress.mjs',
  'tests/scene-wave2-browser-runtime.mjs','tests/scene-wave2-golden.mjs','tests/scene-wave2-stress.mjs','tests/scene-wave2.mjs',
  'tests/scene-wave3.mjs','tests/scene-wave3-preflight.mjs','tests/scene-wave3-browser-runtime.mjs','tests/scene-wave3-stress.mjs',
]);

export const SceneDocumentationPaths=Object.freeze([
  'docs/AREA52_SCENE_INTELLIGENCE_BLUEPRINT.md','docs/AREA52_SCENE_INTELLIGENCE_IMPLEMENTATION_RUNBOOK.md',
  'docs/AREA52_SCENE_INTELLIGENCE_REFERENCE_DOCUMENTATION.md','docs/SCENE_INTELLIGENCE_WAVE1_ACCEPTANCE.md',
  'docs/SCENE_INTELLIGENCE_WAVE2_ACCEPTANCE.md','docs/SCENE_INTELLIGENCE_WAVE2_CHANGELOG.md',
  'docs/SCENE_INTELLIGENCE_WAVE3_ACCEPTANCE.md','docs/SCENE_INTELLIGENCE_WAVE3_CHANGELOG.md','docs/SCENE_INTEGRATION_SIGNAL_CONTRACT.md',
  'docs/SCENE_EVENT_INTEGRATION_CONTRACT.md','docs/SCENE_CONTEXT_INVALIDATION_CONTRACT.md',
  'docs/SCENE_MEMORY_HANDOFF_CONTRACT.md','docs/SCENE_UI_READ_MODEL.md','docs/FT002_SCENE_PREFLIGHT.md','docs/SCENE_PHASE1_EVIDENCE.md',
]);

export const SceneSharedContractDependencies=Object.freeze([
  Object.freeze({lane:'Development-Nexus',contract:'Core EventTypeRegistry / CognitiveEventEnvelope / assembly manifest / Context owner'}),
  Object.freeze({lane:'Development-Sidecar/Jev',contract:'Scene signal adapter / Dynamic Fan-Out / Speculative Warmer / ArtifactReference 1.0'}),
  Object.freeze({lane:'Development-Worker-Director',contract:'Runtime EventTypeRegistry / Event Spine'}),
  Object.freeze({lane:'Development-Memory',contract:'future SceneExperienceProposal consumer'}),
  Object.freeze({lane:'Development-UI',contract:'UI.Core read-only Scene adapter / product health vocabulary'}),
]);

export function createSceneAssemblyLaneManifest({sourceSha,acceptanceEvidence=[],integrationOnlyPatches=[]}={}){
  if(typeof sourceSha!=='string'||!sourceSha)throw new TypeError('sourceSha is required');
  const copiedPaths=[...SceneProductionPaths];
  return Object.freeze({
    kind:'SceneAssemblyLaneManifest',contractVersion:'1.0.0',sourceBranch:SCENE_SOURCE_BRANCH,sourceSha,
    productionPaths:[...SceneProductionPaths],testPaths:[...SceneTestPaths],documentationPaths:[...SceneDocumentationPaths],
    browserVisiblePaths:[...SceneProductionPaths],copiedPaths:copiedPaths.map((path)=>Object.freeze({path,sourceDigest:null})),
    expectedIntegrationAdapters:Object.freeze([
      'SillyTavern host event names -> SillyTavernHostBridge eventsByActivity',
      'SceneEventPublisher.runtimeSink(Runtime EventSpine)',
      'SceneEventPublisher.registerWithCoreRegistry(Core EventTypeRegistry)',
      'SceneIntegrationSignal -> Coprocessor adaptScenePublicSignals/plannerInputFromScene',
      'PrefetchRecommendation -> Coprocessor normalizePrefetchRecommendation/Speculative Warmer',
      'SceneContextInvalidationSignal -> Core Context owner',
      'SceneExperienceProposal -> Memory owner',
      'SceneUiReadModel -> UI.Core adapter',
    ]),
    sharedContractDependencies:SceneSharedContractDependencies.map((x)=>({...x})),
    compatibilityPatchExpectations:Object.freeze([
      'No semantic Scene patch expected when copied from accepted Scene SHA.',
      'Host-specific SillyTavern event-name binding is integration configuration, not Scene semantic code.',
      'Any main-only import/path adaptation must be recorded as an explicit integration-only patch.',
    ]),
    integrationOnlyPatches:integrationOnlyPatches.map((x)=>structuredClone(x)),acceptanceEvidence:acceptanceEvidence.map((x)=>structuredClone(x)),
    authorityGranted:false,
  });
}

export function toCoreAssemblyLaneEntry(manifest){
  if(manifest?.kind!=='SceneAssemblyLaneManifest')throw new TypeError('SceneAssemblyLaneManifest required');
  return Object.freeze({sourceBranch:manifest.sourceBranch,sourceSha:manifest.sourceSha,copiedPaths:manifest.copiedPaths.map((x)=>({...x})),integrationOnlyPatches:manifest.integrationOnlyPatches.map((x)=>({...x})),acceptanceEvidence:manifest.acceptanceEvidence.map((x)=>structuredClone(x)),integrationSha:null,supersedingSha:null});
}
