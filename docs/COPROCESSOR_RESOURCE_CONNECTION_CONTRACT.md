# Coprocessor Optional Resource Connection Contract

**Version:** 1.0.0  
**Owner:** Worker 2 / Coprocessor  
**Purpose:** stable host-facing contract for optional Jev and sidecar resources. Brain Core remains final decision owner.

## Host surface

`createCoprocessorResourceHost(options)` returns:

- `actions.addResource(config)`
- `actions.connectResource(resourceId, options?)`
- `actions.disconnectResource(resourceId, options?)`
- `actions.testResource(resourceId, options?)`
- `read.resources()`
- `read.resource(resourceId)`
- `execution.executeTask(task, options?)`
- `execution.executeTaskWithFallback(task, options?)`
- `execution.createJevProviderExecutor(options?)`
- `subscribe(listener)`

The host adapter owns no UI layout and grants no Truth, Precision, settlement, final-choice, canonical-mutation, or Context Seal authority.

## Add resource

`addResource(config)` configures a resource but does not make it executable. Required identity fields are `resourceId`, `providerProfileId`, `providerId`, `workerId`, `modelId`, and `capabilities`. `kind` is `OPENAI_COMPATIBLE` or `DETERMINISTIC_LOCAL`.

For an OpenAI-compatible resource, `endpoint` is the provider base URL and `apiKey` is optional. Credentials remain private. Endpoint URLs containing embedded credentials, query parameters, or fragments are rejected rather than echoed into diagnostics.

A configured profile is unavailable until `connectResource` completes a real probe. A simulated resource cannot be registered as a callable execution resource.

## Connection states

The public read model reports exactly one of:

- `CONFIGURED`
- `CONNECTING`
- `READY`
- `DEGRADED`
- `UNAVAILABLE`
- `DISCONNECTED`

It also reports a typed `reasonCode`, safe reason text, declared and active capabilities, profile/provider/model/worker identity, measurement class, bounded capacity/load, last health check, last test, last execution, last failure, a sanitized endpoint, and bounded diagnostics.

`READY` means the adapter exposes `invoke()` and `probe()`, the probe passed, and the registered capability profile is available. `activeCapabilities` is empty whenever the resource is not executable.

## Health and operator actions

`connectResource(resourceId)` transitions through `CONNECTING`, probes the resource, and ends in `READY`, `DEGRADED`, or `UNAVAILABLE`.

`disconnectResource(resourceId)` aborts in-flight calls owned by that resource, removes its availability, and reports `DISCONNECTED`.

`testResource(resourceId,{mode:'PROBE'})` runs a health probe. `mode:'EXECUTION'` requires a bounded task and executes through the normal provider validation path.

## Execution and routing

Only connected profiles whose declared capabilities and constraints satisfy the job are eligible. One physical resource may execute multiple logical jobs up to `maxConcurrency`. A second resource is optional and is used only when routing/fallback makes it useful.

`executeTaskWithFallback` records every attempted profile/provider and returns `SUCCESS`, `FALLBACK`, or `FAILED`. Provider output is normalized by the task specialist before it can become a WorkerResult. Malformed, unavailable, timed-out, aborted, stale, invalid, or late work remains typed failure/diagnostic evidence and gains no Brain authority.

Jev uses the same registered resource inventory through `createJevProviderExecutor()`. Deterministic gates may skip Jev; bounded ambiguity may invoke it; abstention and `UNRESOLVED` remain valid.

## Read model example

```json
{
  "kind": "CoprocessorResourceReadModel",
  "contractVersion": "1.0.0",
  "resourceId": "sidecar-a",
  "state": "READY",
  "reasonCode": "HEALTH_CHECK_PASSED",
  "providerProfileId": "profile:sidecar-a",
  "providerId": "provider:sidecar-a",
  "modelId": "local-model",
  "declaredCapabilities": ["GRAPH"],
  "activeCapabilities": ["GRAPH"],
  "measurementClass": "MEASURED_LIVE",
  "callable": true,
  "maxConcurrency": 2,
  "activeExecutions": 0,
  "credentialConfigured": true
}
```

No credential value or raw private prompt content is present.

## Worker 3 integration

Worker 3 should bind visible controls directly to the `actions` methods and render only the `read` models/events. Do not infer readiness from configuration alone. Show `state`, `reasonCode`, capabilities, safe diagnostics, health/test timestamps, and physical provider/worker identity from the backend contract.

## Worker 4 integration

Worker 4 should instantiate one host per Brain runtime, pass admitted tasks through `execution`, preserve stable task/choice identity, and join provider results back to the existing Wave 13 execution trace. Context Seal and Brain Core admission remain owner gates. The reproducible local transport evaluation is `npm run report:wave14`; an operator-configured provider can be checked with `npm run smoke:sidecar-jev:live`.
