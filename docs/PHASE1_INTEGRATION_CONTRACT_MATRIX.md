# Phase 1 Integration Contract Matrix

Wave 4 turns cross-lane compatibility into explicit data rather than an assumption.

The Core matrix compares four seams: Core/Scene, Core/Coprocessor, Core/Runtime and Core/UI observation. Contract families cover Artifact Envelope/Reference, Cognitive Event Envelope, revision fences, turn/correlation/causation identity, Result Bus eligibility, structured-output validation, dependency state, Context Seal admission, PromptPlan identity and diagnostic/forensic references.

Allowed states are only COMPATIBLE, PARTIAL, BLOCKED_ON_OTHER_LANE and MISMATCH.

At the Worker 1 Wave 4 functional checkpoint the deterministic fixture reports:
- COMPATIBLE: 5
- PARTIAL: 15
- BLOCKED_ON_OTHER_LANE: 20
- MISMATCH: 0

A PARTIAL row means the contract shape is compatible but an adapter or live integration step remains. BLOCKED_ON_OTHER_LANE means the corresponding checkpoint/acceptance is not yet accepted or the owner lane still owes execution acceptance. MISMATCH is reserved for an actual version or required-feature incompatibility.

Scene's latest public contracts were inspected read-only at `Development-Scene-Scanner@131bdaa1b3a9340b35e2b86519a0271e51d7125a`. Worker 1 does not mark that checkpoint accepted. Coprocessor Wave 3 accepted implementation evidence is `c51b35b0766d12616bfa357494988a37fb36deac`; its later branch head is documentation-only.

No implementation file from another lane is copied into Core. Cross-lane fixtures reproduce public contract shapes only.

A major contract-version mismatch or missing required feature produces MISMATCH deterministically. There is no "probably compatible" state.
