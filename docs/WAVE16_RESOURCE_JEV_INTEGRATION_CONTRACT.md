# Wave 16 Optional Resource + Jev Integration Contract

Status: backend contract for Worker 3 resource presentation and Worker 1 owner-stage admission.

This contract does **not** transfer Brain authority. Area-52 remains usable with zero optional resources. Jev, sidecars, and vector resources contribute bounded outputs only; Worker 1 retains final choice, evidence admission, Truth/Precision, Settlement, canonical mutation, and Context Seal authority.

## Credential lifetime and safety

Remote credentials are held **only in the current JavaScript resource-host session** by the provider adapter. The public value is:

`credentialStorage: "SESSION_MEMORY_ONLY"`

The backend does not persist credentials to Resource IDs, endpoints, model IDs, capability profiles, read models, diagnostics, telemetry, checkpoints, or logs. It does not silently write them to disk or browser storage. UI code must not persist them on behalf of this contract.

Credential public fields are limited to:

- `credentialConfigured: boolean`
- `credentialRequired: boolean`
- `credentialStorage: "SESSION_MEMORY_ONLY"`
- `credentialVersion: number`

Changing or revoking a credential invalidates the previous model qualification. A resource is not callable again until it passes authenticated qualification.

## Worker 3 actions

The stable host is `createCoprocessorResourceHost()`.

### Configuration and credentials

- `actions.addResource(config)`
- `actions.setCredential(resourceId, credentialOrApiKeyObject)`
- `actions.clearCredential(resourceId)`
- `actions.revokeCredential(resourceId)`

For OpenAI-compatible resources, `config` may include `endpoint`, `modelId`, declared `capabilities`, and optional `transportMode`. Credentials should be supplied through `setCredential` for the Wave 16 UI flow. The older construction-time `apiKey` field remains accepted for backward compatibility, but it is still session-memory-only.

The backend derives `local` from the endpoint. A resource at `openrouter.ai` is always reported as remote even if a caller supplies `local:true`.

### Load / Refresh Models

Two actions are available:

- `actions.discoverModels(config)` — stateless discovery before a resource row exists.
- `actions.refreshModels(resourceId)` — discovery for an existing resource.

Typed discovery states:

- `IDLE`
- `LOADING`
- `READY`
- `EMPTY`
- `UNSUPPORTED`
- `UNAUTHORIZED`
- `UNREACHABLE`
- `FAILED`

The result/read model includes `models[]`, `manualModelEntryAllowed`, `reasonCode`, `reason`, `transportMode`, provider identity, remote/local classification, and credential-presence metadata. Model rows expose public provider model metadata such as ID, name, context length, input/output modalities, supported parameters, relevant resource capabilities, and public pricing fields when returned.

Manual model entry is permitted by `actions.selectModel(resourceId, modelId)` only when discovery is `UNSUPPORTED`. When discovery is `READY`, selection must match a discovered model ID. `EMPTY`, `UNAUTHORIZED`, `UNREACHABLE`, `FAILED`, and pre-discovery states do not unlock manual entry.

### Selection, connection, and testing

- `actions.selectModel(resourceId, modelId)`
- `actions.connectResource(resourceId)`
- `actions.testResource(resourceId)`
- `actions.disconnectResource(resourceId)`

A model is **not connected merely because it was selected**. `connectResource` performs an authenticated selected-model qualification call. For chat resources it calls the chat-completions transport; for embeddings resources it calls the embeddings transport. Only a passed qualification can set:

- `selectedModelQualified: true`
- `callable: true`
- `state: READY | DEGRADED`

Important public resource fields:

- `displayName`
- `state`, `reasonCode`, `reason`
- `providerIdentity.family`, `providerIdentity.remote`
- `providerId`, `providerProfileId`, `workerId`
- `modelId`, `actualModelId`, `actualProvider`
- `transportMode`
- `declaredCapabilities[]`
- `routableCapabilities[]`
- `activeCapabilities[]`
- `modelDiscovery`
- `credentialConfigured`, `credentialRequired`, `credentialStorage`, `credentialVersion`
- `selectedModelQualified`, `qualifiedAt`, `modelSelectionMode`
- `measurementClass`
- `local`
- `lastHealthResult`, `lastHealthLatencyMs`, `lastTest`, `lastExecution`, `lastFailure`
- `maxConcurrency`, `activeExecutions`, `currentLoad`
- `callable`

Worker 3 should display errors/status from these fields rather than inferring success from an entered endpoint/model.

## Transport semantics

OpenAI-compatible chat resources use:

- model listing: `/models`
- execution/qualification: `/chat/completions`

Embeddings resources use:

- embeddings-model listing: `/embeddings/models`
- execution/qualification: `/embeddings`

For OpenRouter the common base is `https://openrouter.ai/api/v1`, yielding the documented full routes.

A vector configuration that declares `RETRIEVAL + EMBED` is routed as an **embeddings** physical resource and advertises only `EMBED` as directly executable through that transport. Area-52 does not treat a chat-completions response as an embedding and does not claim that raw embeddings transport itself performs retrieval/reranking.

Embedding execution is exposed separately:

- `execution.createEmbeddings(resourceId, { input, dimensions?, inputType?, encodingFormat?, signal? })`

The result carries the physical resource/provider/worker identity, requested and actual model, upstream provider when returned, vector count/dimensions, latency, normalized usage/cost receipt, measurement class, and `authority: "NONE"`.

## Provider and measurement identity

The backend distinguishes configured provider identity from the upstream identity returned by the provider:

- `providerId`: Area-52 configured physical provider ID.
- `providerIdentity.family`: e.g. `OPENROUTER`, `OPENAI_COMPATIBLE`, `LOCAL_OPENAI_COMPATIBLE`.
- `modelId`: selected/requested model.
- `actualModelId`: model reported by the successful provider response when available.
- `actualProvider`: upstream/provider name reported by the provider response when available.
- `resourceId`, `providerProfileId`, and `workerId`: physical assignment identifiers.

Evidence labels are strict:

- `MEASURED_LIVE` — only an actual operator-configured external provider call.
- `LOCAL_DETERMINISTIC` — deterministic/local fixture or deterministic resource measurement.
- `SIMULATED_FAILURE` — injected failure evidence in the Wave 16 regression suite.

A skipped live smoke remains skipped. It must not set `realProviderCallObserved`, `ft005LivePass`, or `jevLivePass` true.

## Worker 1 contribution and freshness rules

The Native Sidecar Swarm remains an authority-free producer:

- `NativeSidecarSwarmContribution.ownerAdmissionRequired === true`
- `authority === "NONE"`
- Truth, Precision, Settlement, canonical mutation, final choice, and Context Seal authority are false.

Worker results are admitted to `resultsForOwner` only when validation passes, the revision fence is fresh, the result arrives before its hard deadline/seal, and the result authority class is permitted. Stale, invalid, late, unavailable, or failed optional results remain visible in result summaries but do not become owner-stage evidence.

Jev remains bounded adjudication:

- deterministic clear cases may skip Jev entirely;
- ambiguous bounded cases may produce `DECIDED`, `PARTIAL`, `ABSTAINED`, or `UNRESOLVED`;
- unknown option/evidence IDs and authority violations fail closed;
- Jev receipts never directly perform Settlement or canonical mutation;
- after Context Seal, a late Jev receipt is marked non-foreground-eligible and cannot reopen the sealed generation.

The owning Brain stage decides whether a fresh contribution is admitted, ignored, deferred, or otherwise handled under its own policy.

## Operator live acceptance

The opt-in command is:

`npm run smoke:wave16:live`

Credential/model inputs come from the operator environment, not chat or repository content:

- `AREA52_OPENROUTER_API_KEY`
- `AREA52_JEV_MODEL`
- `AREA52_SIDECAR_MODEL`
- `AREA52_VECTOR_MODEL`
- optional `AREA52_OPENROUTER_BASE_URL` (defaults to `https://openrouter.ai/api/v1`)

If the required environment values are absent, the script exits as `SKIPPED` and leaves all live-pass booleans false. The script never prints the credential.
