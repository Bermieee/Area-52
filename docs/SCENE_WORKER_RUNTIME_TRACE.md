# Scene worker execution investigation

Architecture references: `AREA52_SUBSYSTEM_BOARD_MAP.md`, `AREA52_COGNITIVE_COPROCESSOR_BLUEPRINT.md`, `COPROCESSOR_NATIVE_SWARM_CONTRACT.md`, `SCENE_INTEGRATION_SIGNAL_CONTRACT.md`, and `HOT_DEEP_RUNTIME_CONTRACT.md`.

Scene creates a typed `SCENE_OBSERVATION` obligation. Runtime selects a capability worker; the existing `SceneObservationSpecialist` builds and validates its provider input/output. Scene accepts or rejects the proposal through its owner path. Successful late work routes forward without reopening the original Context Seal.

## Reproduced defect

With one CPU slot reserved for foreground generation, POST_RESPONSE Scene work becomes BLOCKED. After its initial pump finishes, generation completion releases the reserve and resumes parked records but previously did not pump the deployment resource director. The blocked job therefore receives no execution cycle until some unrelated work wakes that director.

The completion binding now schedules one nonblocking cycle after releasing generation capacity. There is no recurring polling loop or weakening of capacity, freshness, owner admission, or seal checks.

## Installed evidence limitation

The 2026-09-28 15:08 export contains a FOREGROUND_USER admission receipt and no physical Sidecar execution. The reproduced background reserve defect does not establish that this foreground job had the same cause.

The existing Diagnostics operational snapshot/JSON now includes `pipeline.sceneObservation.runtime`: selected-chat/generation task lifecycle, execution reason, start/resume counts, attached executor, in-flight state, negotiation, dependency status, queue depths, pump state, resource capacity/reserve/usage, and bounded worker eligibility metadata. Admission receipt history remains distinct from current execution state. Narrative and provider bodies are excluded.

## Graph trace

The export's Scene has no accepted active cast or objects, and Graph Walker reports no entity anchors. A production-interface test now proves that Sidecar extraction followed by Scene-owner cast acceptance supplies Graph Walker anchors on the next turn. This does not invent identities from an empty Scene or guarantee that every no-anchor query is a Scene failure.

## Verification

37 focused tests pass across asynchronous Scene lifecycle, Diagnostics, Scene/Jev integration, structured world references, and profiling UI. Changed production modules pass syntax checks. Installed foreground execution remains to be verified with the new runtime trace.
