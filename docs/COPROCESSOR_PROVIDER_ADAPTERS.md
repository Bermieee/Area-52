# Cognitive Coprocessor Provider Adapters

## Architectural interface

A provider adapter exposes provider/model metadata, advertised capabilities and an asynchronous invoke boundary.

The concrete JavaScript implementation is intentionally provider-neutral.

## DeterministicProviderAdapter

Permanent regression adapter.

Properties:

- no credentials;
- deterministic handler per task type;
- structured JSON text output;
- injectable latency/usage metadata;
- abort awareness.

It is used by CI and Function Test 001.

## OpenAICompatibleProviderAdapter

Supports OpenAI-compatible chat-completion endpoints.

Configuration is constructor/environment supplied:

- providerId;
- modelId;
- endpoint;
- optional API key;
- optional headers;
- timeout;
- context/output limits;
- local/remote metadata;
- optional cost metadata.

The adapter sends ordinary messages. It does **not** use native tools/functions.

The provider response must contain text in `choices[0].message.content`. Area-52 then performs its own parse/type/semantic validation.

## Failure normalization

Provider-level failures normalize into typed Sidecar failure codes:

- PROVIDER_TIMEOUT;
- PROVIDER_UNAVAILABLE;
- PROVIDER_ABORTED;
- PROVIDER_FAILURE;
- MALFORMED_OUTPUT;
- CAPABILITY_UNAVAILABLE.

Provider HTTP/runtime behavior never becomes canonical state.

## Routing

CapabilityProfileRegistry considers:

- required/minimum/preferred capability version;
- cognitive layer/placement;
- context size;
- expected output size;
- structured-output support;
- health/availability/current load;
- reliability;
- latency;
- cost class;
- local preference;
- foreground/background eligibility.

This is provider nomination only. Runtime owns actual scheduling/resource allocation.

## Manual harness

`npm run manual:provider`

Environment:

- `AREA52_OPENAI_BASE_URL`;
- `AREA52_OPENAI_MODEL`;
- optional `AREA52_OPENAI_API_KEY`.

No external provider call occurs in CI.
