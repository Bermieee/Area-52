# Diagnostic Query Plane

Diagnostics are on-demand bounded lookups, not continuous brain snapshots.

Typed query surfaces include `whyRejected`, `whyStale`, `whyOmitted`, `whyBlocked`, `whyUnresolved`, `traceArtifact`, `traceTurn`, `traceGeneration`, `dependencyStatus` and `settlementExplanation`.

`DiagnosticResult` returns a machine-readable status, target, bounded `DiagnosticEvidenceRef[]`, missing references, truncation state, structured metadata and an optional human-readable explanation. Evidence kinds distinguish `RECORDED_FACT`, `DERIVED_EXPLANATION`, `MISSING_EVIDENCE` and `INFERRED_CAUSE`.

Diagnostic provider exceptions are contained as `DIAGNOSTIC_UNAVAILABLE`. Missing evidence returns `MISSING_REFERENCE` or partial reconstruction. Diagnostic failure never blocks Runtime, generation, Settlement, Context Seal or canonical state.

Dependency explanations read Framework Service Registry state. They do not create a second dependency graph. Runtime and Sidecar observability are consumed through read-only reference readers.
