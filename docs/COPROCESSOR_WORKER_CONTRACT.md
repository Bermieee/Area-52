# Cognitive Coprocessor Worker Contract

## CognitiveTask

Required semantic fields:

- taskId / taskType;
- turnId / correlationId / causationId;
- requiredCapabilities[];
- cognitiveLayer;
- resultClass;
- inputRevisionSet;
- scene/world/source/character-state revisions;
- softDeadline / hardDeadline;
- batchMetadata;
- outputSchema;
- dedupeKey;
- fallbackPolicy;
- placement;
- compilerLane;
- intentFingerprint;
- contextSealPolicy.

The task does not select a worker/provider.

## CognitiveWorkerResult

Carries:

- resultId / taskId / turnId / correlationId;
- workerId / providerId;
- capabilities[];
- status;
- payload;
- provenance;
- confidence;
- freshnessIdentity / inputRevisionSet;
- timing/latency;
- validation receipt;
- authority class.

A worker result is never canonical merely because it validates.

## Validation pipeline

```
provider output
 -> schema/type validation
 -> identity/correlation validation
 -> capability attestation
 -> revision freshness validation
 -> optional bounded semantic validation
 -> normalized worker result
 -> Result Bus boundary
```

Malformed output becomes a typed failure. Retry is bounded by the task fallback policy.

## Batch metadata

Potentially large workers declare:

- batchable;
- slicePolicy;
- checkpointBoundary;
- yieldSafety;
- partialResultSemantics.

Wave 1 defines metadata only; Runtime owns actual batching.

## Authority

Models propose. Owners settle.

No worker contract grants direct canonical mutation.
