import {createAssemblyLaneEntry} from './assembly-manifest.js';

export const CORE_MAIN_RUNTIME_PATHS=Object.freeze([
'src/adaptive-context-benchmarks.js','src/adaptive-context-budget.js','src/adaptive-context-contracts.js','src/adaptive-context-runtime.js','src/adaptive-context-sections.js','src/adaptive-context-segments.js','src/adaptive-context-slots.js',
'src/artifact-registry.js','src/assembly-manifest.js','src/assembly-preflight.js','src/browser-host-conformance.js','src/browser-runtime-utils.js','src/certification-matrix.js',
'src/cognitive-audit-contracts.js','src/cognitive-audit-plane.js','src/cognitive-audit.js','src/cognitive-core.js','src/cognitive-reconstruction.js','src/cognitive-repository.js','src/cognitive-transaction-ledger.js','src/conformance-kit.js',
'src/context-benchmarks.js','src/context-compiler-contracts.js','src/context-compiler.js','src/context-seal.js','src/contract-drift-detector.js','src/contract-versioning.js','src/contracts.js','src/coprocessor-precision-contract-adapter.js','src/core-function-test-preflight.js','src/core-ui-fixtures.js','src/core-ui-read-models.js',
'src/delivery-learning.js','src/dependency-graph.js','src/dependency-readiness.js','src/diagnostic-fidelity.js','src/diagnostic-query-plane.js','src/diagnostic-retention.js',
'src/event-conformance.js','src/event-registry.js','src/forensic-bundle.js','src/framework-contracts.js','src/framework-kernel.js','src/framework-utils.js','src/generation-publication.js',
'src/integration-browser-matrix.js','src/integration-contract-matrix.js','src/integration-control-plane.js','src/integration-rehearsal-contracts.js','src/knowledge-evidence.js','src/knowledge-integration-spine.js','src/lore-study.js','src/model-adapters.js','src/nexus-shadow-adapter.js','src/phase1-gate-evidence.js','src/phase1-integration-fixtures.js','src/phase1-integration.js','src/phase1-readiness-v2.js',
'src/precision-contract.js','src/prompt-integrity-guard.js','src/prompt-planner.js','src/publication-context-compiler.js','src/publication-contracts.js','src/reflection-engine.js','src/result-bus.js','src/retrieval.js',
'src/service-registry.js','src/settlement-boundary.js','src/settlement-engine.js','src/shadow-context-scorer.js','src/shared-contract-adapters.js','src/source-registry.js','src/structured-output-validation.js','src/temporal-state-graph.js','src/truth-gate.js','src/truth-publication-gate.js','src/wave6-contract-fixtures.js',
'src/core-assembly-manifest.js'
].sort());
export function enumerateCoreMainFiles(){return[...CORE_MAIN_RUNTIME_PATHS];}
export function createCoreAssemblyLaneManifest({acceptedSha,sourceDigests={},integrationOnlyPatches=[],acceptanceEvidence=[],integrationSha=null,supersedingSha=null}={}){
  if(typeof acceptedSha!=='string'||!acceptedSha.length)throw new TypeError('acceptedSha is required');
  return createAssemblyLaneEntry({sourceBranch:'Development-Nexus',sourceSha:acceptedSha,copiedPaths:CORE_MAIN_RUNTIME_PATHS.map(path=>({path,sourceDigest:sourceDigests[path]??null})),integrationOnlyPatches,acceptanceEvidence,integrationSha,supersedingSha});
}
