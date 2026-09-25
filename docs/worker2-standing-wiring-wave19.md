# Worker 2 standing wiring contract — Wave 19

Branch owner: Worker 2 (`Development-Sidecar/Jev`)

This document is the producer/resource/adapter contract for Worker 3 integration. It does not grant UI, truth, settlement, Context Seal, or canonical mutation authority to Sidecar/Jev.

## Connections action contract

`createCoprocessorResourceHost()` exports the current Connections actions expected by Worker 3:

- `addResource(config)`
- `discoverModels(config, options)`
- `refreshModels(resourceId, options)`
- `setCredential(resourceId, credential)`
- `clearCredential(resourceId, options)` / `revokeCredential(...)`
- `selectModel(resourceId, modelId)`
- `connectResource(resourceId, options)`
- `disconnectResource(resourceId, options)`
- `testResource(resourceId, options)`

Credentials are session-memory only. Public resource/read models expose only `credentialConfigured` and credential version/storage metadata, never the secret.

Remote connection state is deliberately staged:

1. **configured** — a resource/profile exists; this is not evidence that the provider is reachable.
2. **qualified / connected** — the selected model is present when discovery is supported and an authenticated transport qualification probe succeeds.
3. **physically executed** — an actual cognitive execution reached the resource; exposed separately as `physicalExecutionAttempted` / `physicalExecutionSucceeded`.
4. **owner accepted** — never inferred by the resource registry. Resource rows report `ownerAccepted: null` and `ownerAcceptanceSource: OWNER_RECEIPT_REQUIRED`. The selected-turn cognition read model overlays owner admission receipts.

A passing Connect/Test probe is not a physical cognitive execution, and physical execution is not owner acceptance.

## Capability/model routing contract

Worker 2 exports:

- `resourceHost.read.capabilityProfiles()`
- `resourceHost.read.capabilityRoute(cognitiveTask, options)`
- `CoprocessorResourceConnections.routeQualifiedProviders(cognitiveTask, options)`

The route is built only from currently executable, model-qualified resource profiles. It returns a safe provider candidate list plus `taskContract`, a provider-independent projection of the original canonical `CognitiveTask`.

Changing provider load/health/availability may change the first candidate. It must not mutate or specialize the cognitive task contract. Provider/model/resource identity belongs to the route/execution receipt, not to the cognitive task.

Qualification evidence is exposed with the selected model's discovery facts when available: discovery state, model-list presence, transport mode, context/output limits, modalities, supported parameters, requested/actual model identity, actual upstream provider, and qualification status.

## Worker 3 cognition read contract

`resourceHost.read.cognition(selection)` returns `CognitionUiState` v2 for the supplied selected-chat identity:

```js
resourceHost.read.cognition({
  chatId,
  turnId,
  generationId,
  correlationId,
})
```

The read model preserves that identity and projects only matching turn/correlation events when those identities exist on receipts. It exposes:

- active task counts and bounded task details;
- HOT/DEEP placement and result class;
- queue, yield, park, resume;
- retry and fallback counts;
- validation/stale/late routing counts;
- provider health and queue pressure;
- physical execution attempts/success/failure;
- result destinations;
- safe resource lifecycle rows;
- owner-admission receipts projected to task/resource identity;
- lifecycle counts for configured, connected, physically executed, and owner accepted.

The read model explicitly reports:

- `rawPromptIncluded: false`
- `rawPayloadIncluded: false`
- `credentialIncluded: false`
- all authority flags false

Telemetry additionally normalizes secret-key spellings before redaction, so forms such as `api_key`, `API-KEY`, `raw_prompt`, authorization, credential, secret, and access/refresh token keys are excluded.

## Owner receipt input

Worker 3/integration may inject a bounded owner receipt provider when assembling the resource host:

```js
createCoprocessorResourceHost({
  telemetry,
  ownerReceipts: selection => [nativeSwarmOwnerHandoffReceipt],
  queuePressure: selection => currentQueuePressure,
})
```

For `NativeSidecarSwarmOwnerHandoffReceipt`, Worker 2 consumes only safe admission metadata such as task/result/resource/provider identity, `acceptedByOwner`, destination, stale/late/invalid flags, and reason. It does not forward `ownerGather`, compiler input, raw evidence, prompts, API keys, or arbitrary owner payloads.

## Native-path invariant

With zero configured Sidecar, Jev, Vectoring, external database, or orchestration resources:

- `resourceHost.read.resources().nativePathRequired === true`;
- cognition read remains available with zero optional resources;
- all Worker 2 authority flags remain false.

Optional resource failure degrades optional capability availability; it does not create truth or settlement authority.

## Live acceptance boundary

Deterministic and controlled-transport tests prove contracts, qualification state transitions, fallback behavior, redaction, and owner-admission separation. They are **not** proof of real OpenRouter usefulness/cost or installed SillyTavern execution.

#180 remains live-gated until an operator environment exposes both:
1. a real provider credential/model set, and
2. the installed SillyTavern host path that executes the integrated cognitive turn.

A direct provider smoke, when configured, is useful transport evidence but still does not by itself satisfy the SillyTavern end-to-end requirement.
