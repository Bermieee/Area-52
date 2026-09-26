# Coprocessor UI Read Model — Phase 1 Wave 5

CognitionUiState is a read-only projection for future Brain Pulse / Widget Health surfaces.

Fields:
- turnId
- activeTasks
- hotTasks
- deepTasks
- requiredPending
- opportunisticPending
- deferredTasks
- lateResults
- staleDrops
- warmHits
- fallbackCount
- providerHealth
- queuePressure
- health
- mutationAuthority: false

Health vocabulary is aligned to UI.Core:
READY, WORKING, DEGRADED, STALE, BLOCKED, ERROR.

The projection is observational. UI edits to this structure cannot mutate cognitive truth, Runtime state, Result Bus admission, Gather, Context Seal or canonical world state.
