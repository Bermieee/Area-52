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

## Wave 3 operational counters

Wave 3 extends the same bounded telemetry surface with provider-neutral receipts for:

- warm hit, miss and partial-salvage outcomes;
- retrieval HIGH / MIXED / LOW / SKIP outcomes;
- result destination;
- streamed claim-check classifications;
- consolidation backlog counts;
- existing queue / execution / batch / yield / park / resume / retry / fallback / validation / stale-drop signals.

The telemetry snapshot is counter-oriented. Raw source text, retrieved text, candidate bodies, full artifact bodies, prompts and provider responses remain blocked recursively. UI continues to own presentation.

## Wave 4 precision counters

The bounded telemetry surface now also covers:

- precision request input/output candidate counts;
- retrieval quality class and corrective-pass use;
- precision stages used;
- fallback stage;
- bounded stage latency;
- provider/capability identity as provenance only;
- stale-candidate rejection;
- authority-violation rejection;
- final result destination;
- multi-channel candidate dedupe counts.

Raw candidate bodies, raw source text, full prompts, retrieved text and full provider responses remain excluded from continuous telemetry. Issue #86 remains shared with UI.Core for presentation/consumption acceptance.

---

## Phase 1 Wave 5 Addendum — Provider/Runtime/UI Readiness

Wave 5 preserves all prior telemetry behavior and extends the compact read model with provider-health and execution-readiness evidence.

Additional bounded signals include:
- providerProfileId and operational provider health;
- executionClass / HOT-DEEP placement;
- queue/execution timing and deadline/quorum state;
- cancellation and supersession;
- late-result destination;
- normalized provider usage units/tokens and cache-hit units;
- cost status, which remains NOT_MEASURED unless deterministic pricing metadata is configured.

The sanitizer additionally fences whole conversation, whole lorebook, all memory, private diagnostics, chain-of-thought and reasoning fields from continuously copied telemetry.

CognitionUiState is a read-only projection with mutationAuthority:false and the UI.Core health vocabulary READY, WORKING, DEGRADED, STALE, BLOCKED and ERROR.

Provider identity, health, latency, cost and quality remain observability/routing data only. None grants epistemic authority.

## Wave 13 cognitive-choice counters

Wave 13 adds bounded choice observability without copying raw prompts or evidence bodies.

Events:

- `COPROCESSOR_CHOICE_PROPOSED`
- `COPROCESSOR_CHOICE_OPTION`
- `COPROCESSOR_CHOICE_EXECUTION`
- `COPROCESSOR_CHOICE_DEGRADED`

The compact snapshot tracks proposal/option counts, NOMINATED/SKIPPED/DEFERRED/UNAVAILABLE dispositions, execution observations and degraded executions.

Per-option telemetry is limited to IDs, typed disposition/reason codes, expected-value number and task identity where one already exists. Jev raw question text, provider prompt bodies, Candidate Bus bodies and owner Truth/Precision payloads remain excluded.

A telemetry choice count is diagnostic only. It does not create Core admission, Truth, Precision, Settlement, scheduling or Context Seal authority.

