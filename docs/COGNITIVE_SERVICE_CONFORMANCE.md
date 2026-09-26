# Cognitive Service Conformance

`CognitiveServiceConformanceKit` is the reusable Framework-side test surface for cognitive services.

It checks manifest registration, artifact validation, event compatibility/idempotence, provenance presence, source-revision freshness, declared authority, lifecycle routing, required dependencies, optional degradation disclosure, rebuild/recovery declaration and diagnostics availability.

Generation-facing violations are explicit: direct prompt injection fails with `CONTEXT_SEAL_REQUIRED`; direct canonical mutation fails with `SETTLEMENT_REQUIRED`; SHADOW foreground routing fails with `LIFECYCLE_AUTHORITY_BLOCKED`.

Negative fixtures are expected to fail for their actual invariant, not merely return a generic false result. Wave 1 includes missing provenance, stale revisions, authority violations, seal violations, Settlement violations, unknown artifact schema, unknown/incompatible event versions, dependency failure and lifecycle violations.
