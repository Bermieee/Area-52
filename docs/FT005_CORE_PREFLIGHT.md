# FT005 Core Preflight

Status after Worker 1 Wave 4: **CORE SIDE READY FOR LIVE PROVIDER TEST**.

Core validates the authority/freshness side of the provider path:
provider result -> structured validation -> normalized contract -> Result Bus/freshness -> Context Seal.

Provider-neutral proof:
- Provider A and Provider B can submit equivalent objects and produce the same normalized canonical contract.
- Provider identity remains diagnostic/provenance metadata and is not part of normalized epistemic authority.
- malformed JSON returns a typed PARSE failure with canonicalReady=false;
- type-invalid output fails before semantic validation;
- type-valid but semantically invalid output fails at SEMANTIC before normalization;
- unsupported major schema version fails deterministically;
- validation failures expose failureStage, schema ID/version, retryable and fallbackEligible information.

Failure/freshness proof:
- optional provider/capability loss can be represented as DEGRADED rather than truth failure;
- an OPPORTUNISTIC result arriving after Context Seal cannot mutate the sealed turn;
- REQUIRED fallback is modeled as bounded evidence rather than an unlimited retry loop.

#46 remains shared until provider-side/integration acceptance is complete. #180 remains open until a real provider run executes through assembled `main`.
