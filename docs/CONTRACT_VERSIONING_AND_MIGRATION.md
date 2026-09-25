# Contract Versioning and Migration

Area-52 Framework contracts use deterministic numeric versions. `ContractVersionRegistry` reports `EXACT`, `COMPATIBLE`, `DEPRECATED`, `MIGRATION_REQUIRED`, `INCOMPATIBLE`, `UNSUPPORTED_FUTURE`, or `INVALID_VERSION`.

Same-major older versions may be accepted as compatible additive contracts. Explicit deprecated versions remain readable but are reported as deprecated. Breaking older versions require an explicit registered migration path; unsupported future versions are rejected.

Migrations execute as deterministic steps and validate each result. Missing paths and malformed migration output are typed failures. Migration is also fenced from rewriting protected semantic identity and authority fields, including artifact/event/service identity, owner/producer, authority declarations, provenance, revision and temporal classification, source revision fences, world/scene/turn/task fences, causation/correlation identity and dedupe identity.

A migration transforms representation. It does not create new truth or new authority.
