# FT002 Coprocessor Readiness

Status: `COPROCESSOR SIDE READY` only. This is not an FT002 PASS claim.

The provider-neutral Scene adapter accepts current Scene public signals and these event names without importing Worker 3 implementation code: `SCENE_STATE_DELTA`, `LOCATION_CHANGED`, `TIME_SHIFT_DETECTED`, `ACTIVE_CAST_CHANGED`, `SCENE_BOUNDARY_CANDIDATE`, `SCENE_BOUNDARY_CONFIRMED`, `SCENE_OPENED`, `SCENE_CLOSED`, `PREFETCH_RECOMMENDED`, plus bounded related Scene events.

Contract fixtures cover same-scene dialogue, location change, cast entrance/exit, time shift, flashback, resumed scene, boundary candidate/false-boundary handling and uncertain Scene correction. The output feeds provider-neutral planner signals -> capability-defined tasks -> Runtime obligations.
