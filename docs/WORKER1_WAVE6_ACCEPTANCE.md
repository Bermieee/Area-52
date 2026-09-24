# Worker 1 — Phase 1 Wave 6 Acceptance

## Scope

Wave 6 is shared-contract closure, accepted-checkpoint control and integration rehearsal. It remains Phase 1, does not implement Lore or Memory, does not merge worker branches, and does not mutate `main`.

Starting accepted Core checkpoint: `eabf052b95d67752236365252420286d6323791f`.

Primary functional checkpoint: `a374a45d71e22acbe0b463d4cb8bae2658a0c88d`.

Corrected accepted-contract reconciliation checkpoint: `e17e71cbedce17b933026e7f9fd208d88a20d202`.

Exact reconciliation CI: Cognitive Core CI `35967412490` — **SUCCESS**.

## Validation

- full Node regression: **156/156 PASS**
- Wave 4 integration: **32/32 PASS**
- Wave 5 acceptance: **28/28 PASS**
- Wave 6 acceptance: **37/37 PASS**
- Wave 6 stress: **36,000 cases**
- browser-host source: **78/78 PASS**
- browser runtime: **7/7 PASS**
- syntax: PASS
- ESM import: PASS

Wave 6 stress includes:

- 10,000 event registry validations
- 5,000 contract drift comparisons
- 5,000 dependency state transitions
- 5,000 integration rehearsal turns
- 2,000 stale-result cases
- 2,000 duplicate-event cases
- 2,000 provider fallback cases
- 2,000 assembly manifest validations
- 1,000 integration-patch validations
- 1,000 diagnostic reconstructions
- 1,000 multi-turn FT006 replay sequences

## Contract reconciliation

Validated matrix: **8 COMPATIBLE / 26 PARTIAL / 38 BLOCKED_ON_OTHER_LANE / 0 MISMATCH**.

Moving-head drift: **4 NO_CHANGE / 1 COMPATIBLE_EXTENSION / 0 REQUIRES_ADAPTER / 0 BREAKING_CHANGE / 0 UNKNOWN**. Scene is the compatible extension; accepted checkpoints remain the rehearsal inputs.

## Issue closure pass

Closed as completed on Wave 6 evidence:

- **#46** Structured-output shared boundary
- **#125** Service dependency graph
- **#131** Event type registry / extensible event envelope

Intentionally open:

- **#13** Nexus shadow: live adapter implementation ready, runtime connection not executed
- **#157** Phase 1 gate: BLOCKED
- **#177** FT002: assembly rehearsal green, live SillyTavern pending
- **#178** FT003: Memory/Sensory missing
- **#179** FT004: Lore/Sensory missing
- **#180** FT005: assembly rehearsal green, live provider execution pending
- **#181** FT006: integrated representative qualification pending
- **#185** browser host: live assembled-host gate pending
- **#186** main assembly: real fresh main reconstruction pending

No Memory, Lore, Sensory or UI-owned card is closed by Core work.

## Integration result

The deterministic public-contract chain reaches Result Bus, Gather, Truth/KnowledgeEvidence, Context Compiler, Context Seal and PromptPlan with no `main` mutation.

FT002: **ASSEMBLY REHEARSAL GREEN / LIVE SILLYTAVERN PENDING**.

FT005: **ASSEMBLY REHEARSAL GREEN / LIVE PROVIDER EXECUTION PENDING**.

FT006 has a richer deterministic replay dataset with independent metrics and `aggregateScore:null`; no fabricated global RP score exists.

## Accepted-checkpoint proof

Coprocessor accepted Wave 4 checkpoint is `d9b1953...` (CI `35963531808`). Historical `8eca22f...` remains the green implementation checkpoint immediately beneath that documentation/acceptance commit.

Scene moving head `bee29f0...` is refused as an integration source; independently accepted `5ad7567...` is selected.

The newer Scene public contract surface is still inspected via drift detection and classifies as `COMPATIBLE_EXTENSION`.

## Assembly rehearsal

The plan emits:

- 4 COPY
- 4 VERIFY_DIGEST
- 1 APPLY_DOCUMENTED_PATCH
- 3 CHECK_CONTRACT_VERSION
- 4 RUN_BROWSER_GATE
- 2 RUN_FUNCTION_TEST

It always reports `mainMutationAllowed:false`.

## Browser and host posture

Core source/runtime execution is green. Accepted Scene/Coprocessor browser evidence is imported with explicit replay state. Runtime browser-host qualification remains NOT_RUN/NOT_MEASURED in Worker 1 evidence, so integration browser readiness is PARTIAL rather than falsely PASS.

## Phase 1 gate

Gate V2 remains **BLOCKED** and `phase2PromotionAllowed:false`.

The remaining live blockers include FT002 live SillyTavern, real Memory, real Lore/Sensory, FT005 live provider execution, FT006 representative integrated workload, #185 live browser host and #186 real main reconstruction.
