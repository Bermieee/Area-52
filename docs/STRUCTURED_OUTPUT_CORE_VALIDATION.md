# Structured Output — Core Validation Boundary

Worker 1 owns the provider-neutral Core/schema side of structured output validation. Provider execution remains Worker 2 / Coprocessor ownership.

Canonical Core order:

provider output -> syntactic parse -> runtime type/schema validation -> deterministic semantic validation -> normalization -> eligible normalized Area-52 data.

`StructuredOutputSchemaRegistry` registers explicit schema IDs/versions and provider-neutral validators. `CoreStructuredOutputValidator` returns typed failures for parse, unknown schema, unsupported version, type failure, semantic failure and normalization failure.

Every failure has `canonicalReady=false`. Semantic validation is never called when type validation fails. Provider identity is recorded only as diagnostic metadata and never changes the canonical schema.

Retry/fallback layers can consume typed retryable failures, but malformed data cannot become canonical-ready or enter a Result Bus path merely because a provider returned it.

#46 remains shared/open until provider-execution acceptance is also complete.
