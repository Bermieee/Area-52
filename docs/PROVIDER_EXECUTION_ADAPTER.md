# Provider Execution Adapter — Phase 1 Wave 5

Canonical cognitive execution path:

CognitiveTask
-> capability negotiation
-> Runtime-selected providerProfileId
-> ProviderExecutionRequest
-> provider-specific transport adapter
-> ProviderTransportResult
-> parse
-> type/schema validation
-> semantic validation
-> normalization
-> CognitiveResult eligibility

Provider-specific formatting stays behind the adapter. Provider A and Provider B normalize to the same Area-52 result contract.

ProviderExecutionRequest is minimum-necessary and reference-first. It carries a bounded task slice, source references, selected context slices and bounded diagnostic metadata. Whole conversation, whole lorebook, all memory, raw prompt, private diagnostics and chain-of-thought fields are not legal default payloads.

ProviderTransportResult normalizes timing, provider/model provenance and a ProviderUsageReceipt. Provider identity is diagnostic/provenance only and authorityGranted remains false.

Cancellation, stale revision, duplicate delivery and sealed-turn containment are enforced outside provider reputation or quality metadata.
