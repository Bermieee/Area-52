# Scene Intelligence Wave 1 Acceptance

This document records acceptance evidence for the exact final Development-Scene-Scanner SHA.

## Authority

Scene outputs remain observation/inference only. No Scene module imports or implements Settlement, Runtime Fabric or Sidecar/provider scheduling.

## Negative regressions

Automated tests prove:

- character mentioned in memory -> MENTIONED_ONLY, not PRESENT;
- later mere mention does not downgrade an already PRESENT character;
- location viewed -> current location unchanged;
- object discussed -> MENTIONED_ONLY, no holder;
- later mention does not erase stronger held/present object state;
- doorway weak signal -> boundary rejected after contradictory continuation evidence;
- false cut has an explicit RECOVERED path;
- inferred time chained from prior inference -> UNRESOLVED and drift signal;
- atmosphere -> INFERRED, scene-scoped, non-canonical;
- impossible spatial transition -> bounded full refresh request, not applied by default;
- source edit -> only dependent field invalidated;
- targeted rollback -> unrelated fields preserved;
- every non-UNKNOWN field requires evidence.

## Scene-local object handoff

Object pickup may emit a durableProposal payload, but Scene does not settle it. This materially advances #184 while leaving the shared durable handoff acceptance open for Memory/Temporal/Settlement integration.

## #115 status

Wave 1 establishes deterministic Scene golden fixtures and core metrics. #115 remains open because later Scene Stack/SceneEpisode retrieval cases are intentionally deferred.

## #107 status

Wave 1 completes the Scene-side provider-neutral atmosphere contract and deterministic non-canonical behavior. Shared Sidecar classification/integration remains external; #107 remains open unless that shared acceptance is later completed.

## #49 status

Wave 1 exposes scene entities/location/threads/uncertainty/boundary data suitable for later retrieval-control policy. #49 remains open.

## #93 status

Wave 1 exposes active cast, location, active threads, conflict signals and scene revision through a provider-neutral public signal shape. Actual Fan-Out integration remains open.

## Stress evidence

Wave 1 stress target:

- 1,200 narrative evidence updates;
- at least 500 Scene deltas;
- repeated absent-character mentions;
- repeated object mentions;
- boundary-like bursts;
- temporal corrections;
- source-edit invalidation;
- bounded active CurrentScene size.

This is not #183 final qualification.

## FT002

Wave 1 is left-hand-side ready but does not claim Function Test 002 PASS.
