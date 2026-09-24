# Cognitive Coprocessor Phase 1 Closure

## Scope

This document records the Sidecar/Jev Phase 1 closure wave on `Development-Sidecar/Jev`.

Accepted starting SHA: `af2f494654c6e723bfa94a927fe3219ece63dc47`.

The wave is closure work only. It does not introduce Phase 2 learned provider intelligence, predictive cognition, meta-cognition, autonomous maintenance, or a second Runtime/Event Spine.

## Source changes

- Browser-safe UTF-8 sizing and synchronous SHA-256 remove integration-visible `Buffer` and `node:crypto` dependencies.
- Capability discovery now evaluates versioned primary and fallback capability sets while preserving Runtime scheduling ownership.
- Foreground/background eligibility, health, availability, concurrency/load, structured-output support, latency, cost, context and output limits participate in capability discovery.
- Runtime descriptors expose provider-neutral negotiation metadata without execute/schedule authority.
- Gather compiler input now includes an explicit `precisionResults` lane while preserving the existing typed lanes and disagreement state.
- Telemetry recursively strips raw prompt/response/payload surfaces, clips bounded values, retains a bounded ring, and can fail without interrupting cognition.
- HOT/DEEP placement policy is explicit and testable.
- Sidecar CRAG/Self-RAG policy is explicit: HIGH proceeds, MIXED permits bounded corrective retrieval, LOW can refuse long-term memory.
- The manual provider harness now supports a configurable timeout and bounded telemetry without committed credentials.
- The deterministic benchmark summary exposes malformed-output, fallback, zero-worker, and provider-interchange checks when actually measured.

## Phase 1 invariants retained

- one immutable Turn Event may fan out to many capability consumers;
- zero-worker turns are valid;
- fan-out remains bounded;
- providers are replaceable metadata, not downstream semantic types;
- REQUIRED work has bounded retry/fallback;
- OPPORTUNISTIC and DEFERRED work cannot extend foreground indefinitely;
- stale/future results cannot mutate the active generation;
- post-Seal work routes NEXT_TURN/BACKGROUND;
- Gather preserves credible disagreement;
- compiler input remains typed rather than free-form synthesis;
- Green Room remains inferred, scene-scoped and expiring;
- Jev remains semantic capability lineage, not privileged truth authority;
- native provider function calling is not required.

## Validation evidence

Implementation checkpoint `b54c81e7b99368d0eb1cfa12442ca9855a38570e`:

- full regression: 91/91 PASS;
- Wave 1 focused: 40/40 PASS;
- Wave 2 focused: 30/30 PASS;
- stress suites: 3/3 PASS;
- browser/no-`Buffer` FT001 regression: PASS;
- syntax sweep: PASS;
- Coprocessor module import: PASS;
- GitHub Actions Wave 1 run #35: PASS;
- GitHub Actions Wave 2 run #14: PASS.

Preserved stress evidence:

- Wave 1: 525 turns / 2,100 worker tasks;
- Wave 2: 1,400 turns / 5,320 planned worker tasks, bounded fan-out <= 4.

## Issue truth

Complete Sidecar work does not imply every shared card can close. Runtime scheduling, UI, Scene Intelligence, Memory, real-provider qualification, and browser-host integration retain their documented ownership.

The final handoff must use the exact final branch SHA and exact final Actions runs after documentation is committed.

## Wave 3 adaptive cognition checkpoint

Starting from accepted Wave 2 head `4b0a0382856a5306f716b1b0ec3f9d931322b0d0`, Worker 2 added Phase 1 adaptive cognition without beginning Phase 2 Provider Intelligence.

Implementation checkpoint: `c51b35b0766d12616bfa357494988a37fb36deac`.

Wave 3 adds bounded expected-value fan-out, revision/intent-fenced speculative warming, one-pass adaptive retrieval, bounded scene-local Green Room inference, proposal-only DEEP consolidation, multi-mode generation-side truth monitoring, expanded bounded telemetry, Scene/FT002 contract readiness, and Wave 3 qualification metrics.

Implementation-checkpoint evidence:
- full regression 178/178 PASS;
- Wave 1 focused 40/40 PASS;
- Wave 2 focused 62/62 PASS;
- Wave 3 focused 46/46 PASS;
- stress 12/12 PASS;
- browser-like production paths 2/2 PASS;
- syntax and ESM import PASS;
- Actions Wave 1 #39, Wave 2 #18 and Wave 3 #1 PASS.

Shared Runtime/Core/Scene/Memory/UI/live-provider integration cards remain subject to their owning lanes. FT002 is Coprocessor-side ready only; FT005 is side ready only; FT006 is shadow-ready only.
