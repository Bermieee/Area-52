# Coprocessor Wave 6 Change Log

Starting point: `f92c839e1ef74bf050ca02181a1ceff476ee6cbf` (Director-accepted Wave 5 checkpoint).

Validated implementation/documentation checkpoint before this changelog-only commit:
`696ef02665525c19b9d16daf59e39c06ad7a457d`.

## Scope

Wave 6 productionized the two assigned Phase 1 cognitive subsystems on `Development-Sidecar/Jev`:

- #78 Character Green Room;
- #79 Continuous Memory Consolidation — Sidecar cognitive-worker/proposal side.

This wave did not expand FT005/FT006, Dapr, provider qualification, provider learning, Lore, Sensory Net, Scene ownership, Runtime scheduling, Memory persistence, or visual UI.

## Added

- `src/coprocessor/cognitive-worker-pipelines.js`
  - `CharacterCognitionWorker` for real HOT Green Room execution;
  - `ContinuousConsolidationWorker` for real DEEP consolidation execution;
  - both execute through the accepted provider-neutral `SpecialistExecutionLayer`.

- Green Room production task/input/projection behavior:
  - HOT / L1 / normally OPPORTUNISTIC;
  - bounded active-cast batching;
  - PRESENT and legitimate UNCERTAIN characters eligible;
  - MENTIONED_ONLY excluded from automatic activation;
  - bounded reference-first evidence input;
  - compact generation-facing inferred projection;
  - post-Context-Seal routing to future/background use.

- Green Room lifecycle and evidence controls:
  - Scene close;
  - Scene replacement/revision change;
  - major time shift;
  - character departure;
  - contradictory evidence;
  - source-revision invalidation;
  - turn TTL;
  - chat switch;
  - Scene correction;
  - separate prior-inference refs vs direct-evidence refs;
  - deterministic support identity preventing repeated inference from becoming new evidence.

- Green Room Reflection seam:
  - independently supported repeated observations may produce `ReflectionCandidate`;
  - candidates remain INFERRED/proposal-only;
  - no durable Character State or Memory mutation.

- Consolidation production proposal architecture:
  - revisioned ArtifactReference inputs;
  - bounded provider evidence slices;
  - DEEP / L3 / DEFERRED task contract;
  - bounded `ConsolidationProposalBundle`;
  - per-proposal provenance, confidence, authority and temporal metadata;
  - episode summaries;
  - atomic claim candidates;
  - relationship updates;
  - state-change proposals;
  - Reflection evidence;
  - compressed representations;
  - cross-episode/hypothesis links.

- Consolidation execution safety:
  - deterministic unit/proposal dedupe;
  - source-revision lineage;
  - stale dependency rejection;
  - affected-work replanning;
  - checkpoint/yield/resume contracts;
  - bounded Sidecar-local backlog;
  - export/import restart state;
  - proposal-only `MemoryConsolidationProposalHandoff`.

- Wave 6 telemetry events for:
  - Green Room batch start/completion/invalidation/reflection proposal;
  - Consolidation queue/checkpoint/yield/resume/proposal emission/stale rejection.

- Focused Wave 6 test suites:
  - `tests/coprocessor-wave6-green-room.test.mjs`;
  - `tests/coprocessor-wave6-consolidation.test.mjs`;
  - `tests/coprocessor-wave6-golden.test.mjs`;
  - `tests/coprocessor-wave6-stress.test.mjs`.

- Dedicated CI:
  - `.github/workflows/coprocessor-wave6.yml`.

- Canonical documentation:
  - `docs/CHARACTER_GREEN_ROOM.md`;
  - `docs/CONTINUOUS_CONSOLIDATION_WORKER.md`;
  - `docs/COPROCESSOR_WAVE6_ACCEPTANCE.md`;
  - Wave 6 sections added to the Cognitive Coprocessor Blueprint and Implementation Runbook.

## Changed

### Canonical Green Room path

`src/coprocessor/green-room.js` is the canonical Green Room contract, validator, state model and generation projection.

`src/coprocessor/foreground-specialists.js` is now an explicit compatibility adapter:
- provider input delegates through `createGreenRoomProviderInput`;
- result normalization delegates through `validateGreenRoomProviderOutput`;
- `GreenRoomEphemeralStore` wraps canonical `GreenRoomStore`;
- legacy `characterId` is retained only as an alias for canonical `characterRef`.

This removes the prior risk of two independently evolving Green Room implementations.

### Continuous Consolidation

`src/coprocessor/continuous-consolidation.js` was deepened in place rather than replaced.

The previous single-proposal/starter behavior now supports:
- bounded multi-proposal output;
- semantic identities;
- deterministic proposal IDs;
- changed-source lineage;
- per-proposal authority/confidence/provenance;
- temporal and causal safeguards;
- owner-facing handoff;
- bounded backlog and checkpoint/restart behavior.

### Provider payload boundary

`src/coprocessor/provider-payload-boundary.js` now preserves bounded nested structured task/evidence slices while continuing to block whole-brain fields such as full conversation, all Memory, all Lore, raw prompt and private reasoning material.

### Provider specialist adapters

- Green Room provider adapter now carries the canonical bounded contract while preserving accepted Wave 1–5 fixture compatibility.
- Consolidation provider adapter now builds bounded ArtifactReference-first provider input and validates canonical proposal bundles.

## Compatibility repairs during validation

Initial Wave 6 validation exposed compatibility/test issues before acceptance. They were repaired without weakening accepted Wave 1–5 tests:

1. Legacy Green Room deterministic provider fixtures expected `characterId`; canonical Wave 6 uses `characterRef`. The provider envelope now carries `characterId` strictly as a compatibility alias.
2. Legacy Green Room callers could omit newer optional dimensions such as `trustTrend`; compatibility handling preserves sparse state without creating a second schema.
3. Existing consolidation provider fixtures did not always supply an explicit `unitId`; the canonical provider-input adapter now derives the unit identity from accepted task/batch metadata where legal.
4. Wave 6 TTL tests initially relied on the store constructor TTL while row normalization intentionally carries its own default expiry. Tests were corrected to declare the intended per-row TTL explicitly.
5. One stress fixture attempted to terminally transition an item after bounded backlog eviction. The fixture now checks residency before applying a local terminal transition; bounded eviction remains intentional and is not treated as Runtime Work Ledger durability.

No inherited Wave 1–5 assertion was removed or relaxed to obtain green status.

## Authority and ownership boundaries

### Green Room

Green Room output is permanently:
- `INFERRED`;
- non-canonical;
- non-durable;
- evidence-backed;
- scene-scoped and expiring.

Green Room cannot:
- mutate canonical Character State;
- settle relationship truth;
- persist Memory;
- admit Reflection directly;
- mutate sealed current-turn context after Context Seal.

### Consolidation

Consolidation output cannot:
- claim `SETTLED` or `SOURCE_CANON`;
- write durable Memory;
- delete raw source turns;
- promote HISTORICAL evidence directly to CURRENT truth;
- claim unsupported causal certainty;
- own Reflection admission or Temporal State settlement.

Memory remains the owner of durable Experience/Memory, Temporal State, Reflection admission and reconsolidation.

Runtime remains the owner of scheduling, Resource Governor, Work Ledger, execution preemption and durable runtime obligations.

## Validation

Exact final pre-changelog implementation/documentation Actions run:

- `Cognitive Coprocessor Wave 6` run `35975585059` — SUCCESS.

Results:
- full regression: **280/280 PASS**;
- Wave 1: **40/40 PASS**;
- Wave 2: **62/62 PASS**;
- Wave 3: **46/46 PASS**;
- Wave 4: **39/39 PASS**;
- Wave 5: **24/24 PASS**;
- Wave 6 Green Room: **13/13 PASS**;
- Wave 6 Consolidation: **18/18 PASS**;
- Wave 6 goldens: **3/3 PASS**;
- historical stress: **15/15 PASS**;
- Wave 5 pressure regression: **PASS**;
- Wave 6 focused cognition stress: **PASS**;
- browser-like Wave 6: **2/2 PASS**;
- JavaScript syntax validation: **PASS**;
- Coprocessor ESM import: **PASS**.

Wave 6 stress totals:
- 2,000 Green Room batch validations;
- 500 Green Room expiry sequences;
- 500 contradiction/source-revision cases;
- 1,500 Consolidation units;
- 3,000 derived proposal validations;
- 500 dedupe/replay cases;
- 500 stale/superseded cases;
- 250 checkpoint/yield/resume cycles;
- 5,000-update Green Room bounded-growth replay;
- 5,000-unit Consolidation backlog bounded-growth replay.

Observed final long-run bounds:
- Green Room: **24 active / 64 history**;
- Consolidation backlog: **128 stored / 128 pending**.

## Issue disposition

- #78 Character Green Room — Worker 2 production acceptance complete; issue closed.
- #79 Continuous Memory Consolidation — **SIDECAR WORKER COMPLETE / MEMORY OWNER INTEGRATION PENDING**; issue remains open.
- #75 Cognitive Coprocessor epic — remains open for shared Runtime/UI/Data Plane/Memory/integration work.

## Explicit non-changes

- no `main` modification;
- no merge from another development branch;
- no Memory persistence implementation;
- no Temporal State ownership;
- no Reflection storage/admission implementation;
- no Lore Study / Semantic Lore Compiler implementation;
- no Sensory Net implementation;
- no Scene Intelligence ownership;
- no Context Compiler or Context Seal ownership;
- no Settlement Engine ownership;
- no Runtime scheduler / Resource Governor / Work Ledger implementation;
- no visual UI implementation;
- no Dapr adoption;
- no Phase 2 provider learning;
- no fabricated external-provider, Dapr or IPC benchmark evidence.
