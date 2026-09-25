# Integration Rehearsal Harness

Wave 6 adds a deterministic, non-`main` rehearsal of the shared Phase 1 path.

## Contract-only chain

```text
HostActivity
  -> accepted Scene contract fixture
  -> Dynamic Fan-Out contract fixture
  -> Runtime obligation fixture
  -> worker result fixture
  -> Result Bus
  -> Gather
  -> Truth / KnowledgeEvidence
  -> Context Compiler
  -> Context Seal
  -> PromptPlan
```

No worker implementation code is copied into Core. Public contracts and fixtures are the integration boundary.

The rehearsal records accepted checkpoint refs at the start and produces an `IntegrationRehearsalReceipt` with `mainMutationAllowed:false`.

## Purpose

A green rehearsal proves the contracts compose before `main` is touched. It is not a live Function Test and does not grant acceptance to an unverified moving branch head.

## Functional result

Wave 6 functional checkpoint `a374a45d71e22acbe0b463d4cb8bae2658a0c88d`:

- accepted-checkpoint lock: PASS
- full contract chain: PASS
- Result Bus / Gather / Truth / Seal / PromptPlan continuity: PASS
- Ember Tavern current truth retained: PASS
- `mainMutationAllowed:false`: PASS
