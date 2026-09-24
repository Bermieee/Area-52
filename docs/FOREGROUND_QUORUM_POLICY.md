# Foreground Quorum Policy — Phase 1 Wave 5

Worker 2 defines cognitive policy. Runtime owns timers, queues, cancellation and scheduling.

Task classes:
- REQUIRED
- OPPORTUNISTIC
- DEFERRED

Per-task policy includes softDeadline, hardDeadline, deterministic fallback metadata, qualityWeight and deadlineClass.

ForegroundQuorumPlan expresses:
- required task set
- minimum foreground completion
- deadline
- fallback readiness
- optional arrivals
- deferred destinations

Rules:
- REQUIRED failure/deadline invokes bounded fallback rather than indefinite waiting.
- OPPORTUNISTIC work is never awaited after required foreground quorum is available.
- DEFERRED work never blocks active generation.
- no result arriving after Context Seal may mutate the sealed generation.

Late destinations supported by policy:
DROP, NEXT_TURN, WARM_CACHE, NEARLINE, BACKGROUND and DIAGNOSTIC_ONLY.

The existing Gather Coordinator remains the gather owner. Wave 5 adds policy input; it does not create a competing coordinator.
