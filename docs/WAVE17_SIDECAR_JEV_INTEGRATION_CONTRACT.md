# Wave 17 Sidecar / Jev Integration Contract

## Status and authority boundary

This is the merge-ready Worker 2 contract after the one-time Wave 17 sync from `main`.

Optional Sidecar, Vectoring, and Jev resources remain optional. A zero-resource installation must continue through the native Brain path. No external database or orchestration middleware is required by this contract.

Worker 2 never receives final Brain authority. Optional execution may produce owner-eligible contributions; the owning Brain stage still decides admission. Worker 1 retains final choice, evidence admission, Truth, Settlement, canonical mutation, and Context Seal authority. Jev remains bounded adjudication and is never generically inserted into Gather as canon.

## Browser transport rule

The provider transport binds the browser's native `globalThis.fetch` to its host receiver before storing it. This prevents detached `Window.fetch` calls from failing with `TypeError: Illegal invocation`.

This applies to both:

- chat model discovery and `/chat/completions`, and
- embeddings model discovery and `/embeddings`.

A failed discovery, qualification, or explicit connection test must not leave a public connected claim. Public `connected` is true only when the selected model is currently authenticated/qualified and the resource is callable.

## Stable Worker 3 backend surface

The public host is returned by:

`createCoprocessorResourceHost()`

### Read actions

- `read.resources()`
- `read.resource(resourceId)`
- `read.capabilityProfiles()`
- `read.swarm()`
- `read.swarmTurn(turnId)`

### Resource actions

- `actions.addResource(config)`
- `actions.discoverModels(config)`
- `actions.refreshModels(resourceId, options?)`
- `actions.setCredential(resourceId, credential)`
- `actions.clearCredential(resourceId)`
- `actions.revokeCredential(resourceId)`
- `actions.selectModel(resourceId, modelId)`
- `actions.connectResource(resourceId, options?)`
- `actions.testResource(resourceId, options?)`
- `actions.disconnectResource(resourceId, options?)`

### Execution actions

- `execution.executeTask(task, options?)`
- `execution.executeTaskWithFallback(task, options?)`
- `execution.createEmbeddings(resourceId, options)`
- `execution.createJevProviderExecutor(options?)`
- `execution.runSwarmTurn(input)`
- `execution.executeSwarmCheckpoint(checkpoint, options?)`

## Current Worker 3 compatibility path

The current `main` UI uses this sequence and it remains supported:

1. `discoverModels({ kind:"OPENAI_COMPATIBLE", endpoint, capabilities, apiKey?, transportMode? })`
2. operator selects one returned model, or manual entry only when discovery reports `UNSUPPORTED` with `manualModelEntryAllowed:true`
3. `addResource({ resourceId, displayName, kind:"OPENAI_COMPATIBLE", endpoint, modelId, apiKey?, capabilities, ... })`
4. `connectResource(resourceId)`
5. `testResource(resourceId)`
6. read the owner-reported resource row for final status
7. `disconnectResource(resourceId)` when requested

The API key submitted through this compatibility path is still session-memory-only. It is not written to public reads, telemetry, diagnostics, checkpoints, or repository state.

## Preferred resource lifecycle for future UI work

The preferred lifecycle avoids resubmitting credentials between discovery and connection:

1. `addResource(configWithoutSecret)`
2. `setCredential(resourceId, apiKey)`
3. `refreshModels(resourceId)`
4. `selectModel(resourceId, modelId)`
5. `connectResource(resourceId)`
6. `testResource(resourceId)`

Changing or revoking a credential invalidates selected-model qualification. Changing the selected model also invalidates qualification. Selection alone is never proof of connectivity.

## Discovery contract

`discoverModels` and `refreshModels` expose:

- `IDLE`
- `LOADING`
- `READY`
- `EMPTY`
- `UNSUPPORTED`
- `UNAUTHORIZED`
- `UNREACHABLE`
- `FAILED`

Public discovery fields include:

- `state`
- `models[]`
- `manualModelEntryAllowed`
- `reasonCode`
- `reason`
- `transportMode`
- `providerIdentity`
- `local`
- `credentialConfigured`
- `credentialStorage`
- `latencyMs` when measured

Manual model entry is allowed only for `UNSUPPORTED`. It is not a bypass for unauthorized, unreachable, failed, or empty discovery.

## Resource read model

Worker 3 should treat these as owner status rather than infer connection state from form submission:

- `resourceId`
- `displayName`
- `state`
- `connected`
- `callable`
- `reasonCode`
- `reason`
- `providerId`
- `providerProfileId`
- `workerId`
- `providerIdentity.family`
- `providerIdentity.remote`
- `modelId`
- `actualModelId`
- `actualProvider`
- `transportMode`
- `declaredCapabilities[]`
- `routableCapabilities[]`
- `activeCapabilities[]`
- `selectedModelQualified`
- `modelSelectionMode`
- `qualifiedAt`
- `credentialConfigured`
- `credentialRequired`
- `credentialStorage: "SESSION_MEMORY_ONLY"`
- `credentialVersion`
- `local`
- `measurementClass`
- `lastHealthResult`
- `lastHealthLatencyMs`
- `lastTest`
- `lastExecution`
- `lastFailure`
- `maxConcurrency`
- `activeExecutions`
- `currentLoad`

`connected:true` means authenticated/qualified and callable. `CONNECTING`, `UNAVAILABLE`, `CONFIGURED`, and `DISCONNECTED` do not publish `connected:true`.

## Safe errors

Provider/discovery failures are typed with machine-readable codes. UI-safe public error material is restricted to:

- thrown `error.code`
- a bounded `error.message`
- discovery `reasonCode` / `reason`
- resource `lastFailure.code` / `lastFailure.message` / `lastFailure.at`
- `lastTest.status` / `lastTest.failureCode`

Credentials, Authorization headers, prompts, raw provider responses, source bodies, and chain-of-thought are not part of those surfaces.

An explicit `testResource` failure invalidates the current qualification and publishes the resource as not connected/callable until it qualifies again.

## Transport qualification

Chat resources use:

- `GET /models`
- `POST /chat/completions`

Embedding resources use:

- `GET /embeddings/models`
- `POST /embeddings`

For OpenRouter the common base is `https://openrouter.ai/api/v1`.

A Vectoring resource that declares `RETRIEVAL + EMBED` is physically qualified as an embeddings transport. It directly advertises `EMBED` through that transport. A chat-completions response is never reported as an embedding.

Remote OpenRouter resources are always reported remote; caller-supplied `local:true` cannot override endpoint-derived identity.

## Swarm → owner admission

`NativeSidecarSwarm` still returns an authority-free `NativeSidecarSwarmContribution`.

Its `resultsForOwner` are only **eligible** for owner admission. They are not proof of admission.

Worker 1 may use:

`admitNativeSwarmContributionToOwner({ contribution, gather, semanticValidator?, arrivalAt? })`

with its `GatherCoordinator`-compatible owner boundary.

The returned `NativeSidecarSwarmOwnerHandoffReceipt` distinguishes:

- `executedResults[]`: physical/logical work attempted
- `eligibleResultIds[]`: Worker 2 results that survived worker-side validation/freshness/deadline/authority checks
- `admissions[]`: per-result owner decision
- `acceptedResultIds[]`: results actually admitted by owner Gather
- `rejectedAtOwnerResultIds[]`: worker-eligible results rejected by owner revalidation
- `ownerCompilerInput`: owner Gather's generation-facing projection after admission
- `ownerGather`: owner Gather receipt state

Owner Gather revalidates freshness, duplicates, seal/close state, and worker output. A result can therefore execute successfully and still be rejected as stale or late at the Brain owner boundary.

The bridge itself has no Truth, Precision, Settlement, canonical mutation, final-choice, or Context-Seal authority.

## Jev rule

A Jev receipt is deliberately not inserted into generic Gather by the owner-handoff bridge.

The handoff receipt exposes Jev only as:

- `present`
- `receiptId`
- `serviceStatus`
- `outcome`
- `admittedByBridge:false`
- `ownerAdapterRequired:true`

The relevant Jev domain adapter/owner must decide whether and how the bounded adjudication proposal affects its own policy. Jev cannot write canon or sealed context directly.

## Evidence labels

- `LOCAL_DETERMINISTIC`: deterministic resources, controlled HTTP fixtures, browser receiver fixtures, and owner-admission tests.
- `SIMULATED_FAILURE`: injected unauthorized, malformed, timeout, cancellation, unavailable, stale, and post-seal cases.
- `MEASURED_LIVE`: actual operator-configured external provider calls only.

Default CI does not contain an OpenRouter credential. Its live smoke must remain `SKIPPED` with `realProviderCallObserved:false`, `ft005LivePass:false`, `jevLivePass:false`, and `vectorLivePass:false`.

## Parent epic limits

Wave 17 improves integration readiness but does not by itself complete #75, #206, or #222.

Remaining acceptance includes operator-measured OpenRouter execution, live Jev usefulness evidence, and final assembled integration/review on the main line. Shared-owner cards such as Character Green Room/Memory integration, Cognitive Data Plane/Worker Director, and other subsystem-specific integration cards remain governed by their owning branches/cards.
