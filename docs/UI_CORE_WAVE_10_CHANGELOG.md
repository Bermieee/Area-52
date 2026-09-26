# UI.Core Wave 10 Changelog

## Generation-context explanation

- Upgraded the Brain explainability launcher into a current-generation summary answering why the generation received its context.
- Added explicit budget, section disposition, model-profile, fallback and packet-estimate presentation.
- Added source-mode labeling so deterministic review readers remain visibly FIXTURE.
- Added section ordering and token allocation to the generation explainability workspace.
- Expanded the shared Inspector with ordered sections, source/revision fences, authority labels and recorded decision trail.
- Kept raw payload and provider/debug information Advanced-only.

## Cognitive forensics

- Added a recorded-only semantic generation path: Source → Proposal → Validation → Owner Settlement → State/Reflection → Retrieval → Compiled Context → Context Seal.
- Added explicit MISSING steps instead of synthesizing absent cognitive work.
- Added transaction mappings for unresolved Settlement, retrieval completion/skip and context-section compilation.
- Added late-after-seal detection for operator explanation.
- Fixed the path matcher so validation owned by Settlement cannot be mistaken for an owner Settlement decision.

## Review shell

- Bound contract-shaped PromptPlan / ContextReceipt / ContextSeal / ForensicReadModel / CognitiveTransaction fixtures through the existing production UI adapter seams.
- Preserved all Wave 9 scenarios.
- Added Context loading and Stale context review scenarios.
- Added an Ember Tavern / Sun Blade trace where competing claims remain UNRESOLVED into the sealed packet.
- Kept the existing static entry point: `demo/phase2-shell/index.html`.

## State / authority safety

- Added explicit fixture provenance to Wave 7 production bindings/adapters.
- Preserved WORKING, STALE and DEGRADED reader health instead of flattening transitional states.
- Confidence remains separate from authority.
- Added no cognitive mutation authority to UI.Core.

## Validation

- Added `tests/wave10.test.mjs`.
- Added `tests/wave10-stress.mjs`.
- Added package scripts for Wave 7 / Wave 10 focused and stress validation.
- Added `.github/workflows/ui-core-wave10.yml`.
- Implementation checkpoint `f9ff0117c6c06149bd5fbac6eee9883ecba95d28`: full regression 249/249; Wave 7 35/35; Wave 8 44/44; Wave 9 19/19; Wave 10 11/11; stress/browser/syntax/ESM GREEN.

## Live integration boundary

Wave 10 does not implement Scene, Lore, Memory, Runtime, Gather, Jev, Settlement or context-compiler semantics.

#224 remains the live integrated Brain gate.
