# Coprocessor Telemetry Contract

## Purpose

Coprocessor telemetry is a lightweight diagnostic signal surface. It is not a shadow copy of prompts, responses, candidate corpora, or canonical state.

## Bounded data

Telemetry has two independent bounds:

- event-count ring bound;
- payload-shape bounds for nesting depth, object keys, array items, and string length.

Sensitive/heavy keys are recursively removed, including prompt, rawPrompt, rawResponse, fullResponse, payload, messages, and candidateBodies.

Circular structures and excessive nesting are represented by bounded sentinels rather than cloned recursively.

## Signals

Where available, the Sidecar emits bounded fields for:

- worker capabilities;
- provider/model;
- task class;
- cognitive layer;
- HOT/DEEP placement;
- queue time;
- execution latency;
- validation latency;
- retry/fallback;
- batch slice;
- stale/late destination;
- capability/provider failure;
- provider health.

## Failure isolation

`emitTelemetry()` is explicitly non-authoritative: telemetry transport or observer failure returns null and cannot fail cognitive execution.

Subscriber exceptions are isolated.

Telemetry never grants truth, Settlement, canonical mutation, or scheduling authority.

## Shared ownership

This completes the bounded Sidecar telemetry contract but does not by itself close shared issue #86. UI.Core still owns presentation/consumption acceptance.
