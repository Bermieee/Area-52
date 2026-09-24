# Worker 1 — Phase 1 Wave 6 Acceptance

## Scope

Wave 6 is shared-contract closure, accepted-checkpoint control and integration rehearsal. It remains Phase 1, does not implement Lore or Memory, does not merge worker branches, and does not mutate `main`.

Starting accepted Core checkpoint: `eabf052b95d67752236365252420286d6323791f`.

Functional Wave 6 checkpoint: `a374a45d71e22acbe0b463d4cb8bae2658a0c88d`.

Functional CI: Cognitive Core CI `35966737529` — SUCCESS.

## Functional validation

- full Node regression: **156/156 PASS**
- Wave 4 integration: **32/32 PASS**
- Wave 5 acceptance: **28/28 PASS**
- Wave 6 acceptance: **37/37 PASS**
- Wave 6 stress: **36,000 cases**
- browser-host source: **78/78 PASS**
- browser runtime: **7/7 PASS**
- syntax: PASS
- ESM import: PASS

## Contract reconciliation

Overall: **5 COMPATIBLE / 15 PARTIAL / 52 BLOCKED_ON_OTHER_LANE / 0 MISMATCH**.

Moving-head drift: **4 NO_CHANGE / 1 COMPATIBLE_EXTENSION / 0 REQUIRES_ADAPTER / 0 BREAKING_CHANGE / 0 UNKNOWN**. Scene is the compatible extension; accepted checkpoints remain the rehearsal inputs.

## Shared issue status at functional checkpoint

#46, #125 and #131 have cross-lane closure evidence on the accepted public contracts. Final issue-state mutation is performed only after the final documentation checkpoint also passes exact CI.

#13 remains open: `LIVE_ADAPTER_IMPLEMENTATION_READY / RUNTIME_CONNECTION_NOT_EXECUTED`.

#157 remains BLOCKED.

#177 and #180 have green assembly rehearsals but live execution remains pending.

#178/#179 remain blocked by their owner implementations.

#181 remains an integration qualification card.

#185 and #186 remain open until live browser/main reconstruction requirements are met.

## Integration result

The deterministic public-contract chain reaches Result Bus, Gather, Truth/KnowledgeEvidence, Context Compiler, Context Seal and PromptPlan with no `main` mutation.

FT002: **ASSEMBLY REHEARSAL GREEN / LIVE SILLYTAVERN PENDING**.

FT005: **ASSEMBLY REHEARSAL GREEN / LIVE PROVIDER EXECUTION PENDING**.

FT006 now has a richer deterministic replay dataset with independent metrics and no fabricated global RP score.

## Control-plane result

- moving unaccepted heads are refused;
- every rehearsed source file has an origin receipt;
- compatibility patches have an explicit registry;
- undocumented integration drift remains CONFLICT;
- browser evidence distinguishes executed/replayed/not-run;
- clean-install/reload responsibilities are modeled;
- Function Test blockers and Phase 1 remaining work are machine-readable;
- Phase 1 gate V2 remains `BLOCKED`;
- `phase2PromotionAllowed:false`.
