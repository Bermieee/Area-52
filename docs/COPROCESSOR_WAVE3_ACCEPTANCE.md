# Cognitive Coprocessor Phase 1 — Wave 3 Acceptance

## Scope

Worker 2 Wave 3 remains on `Development-Sidecar/Jev` and advances Phase 1 adaptive cognition only. It does not begin learned provider preference, provider self-optimization, predictive world canon, meta-cognition, autonomous self-maintenance, automatic Memory admission, or automatic Settlement.

Accepted starting SHA: `4b0a0382856a5306f716b1b0ec3f9d931322b0d0`.

Implementation checkpoint: `c51b35b0766d12616bfa357494988a37fb36deac`.

No other worker branch was merged and `main` was not modified.

## Accepted Sidecar capabilities

### Dynamic Fan-Out Planner

- consumes provider-neutral scene/query/cache/capability/health/load/latency/cost/revision signals;
- emits bounded task nominations with expected value, reason codes, required inputs, freshness fences, optional cost/latency hints and fallback metadata;
- independently bounds foreground, opportunistic, background, cost and foreground deadline exposure;
- validates available capabilities before nomination;
- treats zero workers as a legal successful plan;
- never selects a provider or Runtime execution slot and never grants canonical authority.

### Speculative Context Warmer

- consumes stable Scene prefetch recommendations without importing Scene implementation code;
- supports `FRESH`, `PARTIALLY_STALE`, `STALE`, and `INVALID` WarmPacket outcomes;
- keys identity by scene/world/character-state/source revisions, intent fingerprint and retrieval-policy revision;
- partial staleness may salvage candidate references only and requires rerank/revalidation/recompile;
- stale/invalid packets are excluded from foreground reuse;
- the cache has explicit capacity, TTL, revision/intent invalidation and eviction;
- repeated warming never changes authority;
- warmer failure falls back to normal foreground retrieval and degrades latency only.

### Adaptive Retrieval Control

- `HIGH` proceeds;
- `MIXED` permits one bounded corrective pass;
- a failed corrective pass stops instead of looping;
- `LOW` may abstain from long-term-memory use;
- `SKIP` is legal when hot cognition already satisfies the turn;
- retrieval quality never grants truth authority.

### Character Green Room

- uses sparse, bounded, scene-local micro-state with required character/evidence/revision/confidence/created-at/expiry metadata;
- all output is `INFERRED` and cannot claim canonical, Settlement or Memory mutation authority;
- active cast is batched and bounded by character, dimension, evidence and history limits;
- scene close/replacement/revision change, departure, contradiction/source invalidation and TTL can expire state;
- compatible repetition may create a proposal-only `ReflectionCandidate`;
- false persistence across scenes is rejected.

### Continuous Consolidation

- runs as DEEP L3/L4 proposal work using Artifact References;
- produces `ConsolidationProposal`, never direct Memory mutation;
- preserves raw-source recoverability and rejects source deletion / Settlement claims;
- exposes batch slice, checkpoint boundary, resume identity, partial-result semantics and legal Runtime yield metadata;
- exposes bounded backlog pressure: pending units, age, priority, checkpoint, superseded and stale-discard state;
- stale source/scene/world/character-state inputs cannot become active durable memory.

### Streaming Truth Monitor

- buffers complete clauses/claims rather than judging raw tokens;
- supports `OBSERVE`, `VERIFIED_CHUNKS`, and opt-in experimental `HARD_INTERCEPT`;
- hard interception requires deterministic, high-confidence, high-severity, CURRENT-canon violation and is disabled by default;
- historical, figurative, ambiguous and low-confidence cases do not hard-intercept;
- checker failure fails open and generation continues unverified;
- each observation is revision-fenced to the generation context and never rewrites an already-sealed generation retroactively.

### Telemetry and qualification

- bounded telemetry adds warm hit/miss/partial, retrieval quality, result destination, streamed claim checks and consolidation backlog while preserving queue/execution/batch/yield/park/resume/retry/fallback/validation/stale signals;
- raw prompts, responses, source text, retrieved text, candidate bodies and full artifact bodies remain excluded from continuous telemetry;
- qualification reports preserve `MEASURED`, `REPLAYED`, `NOT_MEASURED`, and `NOT_APPLICABLE` rather than converting missing metrics to zero;
- the existing intent-opposite precision corpus remains active; no external FlashRank/ColBERT quality result was fabricated.

## Scene / FT002 compatibility

The Coprocessor consumes provider-neutral Scene contracts for:

- `SCENE_STATE_DELTA`;
- `LOCATION_CHANGED`;
- `TIME_SHIFT_DETECTED`;
- `ACTIVE_CAST_CHANGED`;
- `SCENE_BOUNDARY_CANDIDATE` / `SCENE_BOUNDARY_CONFIRMED`;
- `SCENE_OPENED` / `SCENE_CLOSED`;
- `PREFETCH_RECOMMENDED`.

Contract fixtures cover same-scene dialogue, location change, cast entrance/exit, mentioned-only characters, time shift, flashback, resumed scene, false boundary, and uncertain Scene correction.

Status: **COPROCESSOR SIDE READY**. This is not an FT002 PASS; live `main` integration owns that acceptance.

## Provider / FT005 compatibility

All new provider-backed worker capabilities still route through capability-defined provider profiles and the existing strict parse -> schema/type -> deterministic semantic validation -> normalization boundary. No credentials or native function-call dependency were introduced.

Status: **FT005 SIDE READY, NOT PASS**. A real integrated provider run is still required.

## FT006 shadow readiness

Wave 3 exposes bounded metrics needed by later representative-workload qualification: fan-out count/zero-worker rate, warm outcomes, retrieval abstention/correction, Green Room expiry, consolidation backlog, streamed truth classifications, fallback/retry, and resource/cost fields when actually measured.

Status: **SHADOW READY ONLY**. FT006 itself was not implemented or claimed passed.

## Exact implementation-checkpoint validation

GitHub Actions on `c51b35b0766d12616bfa357494988a37fb36deac`:

- Cognitive Coprocessor Wave 1 run #39 / `35958937461`: PASS;
- Cognitive Coprocessor Wave 2 run #18 / `35958937480`: PASS;
- Cognitive Coprocessor Wave 3 run #1 / `35958937534`: PASS.

Totals from the Wave 3 run:

- full regression: **178/178 PASS**;
- Wave 1 focused: **40/40 PASS**;
- Wave 2 focused: **62/62 PASS**;
- Wave 3 focused: **46/46 PASS**;
- stress suites: **12/12 PASS**;
- browser-like Wave 3 production paths: **2/2 PASS**;
- syntax: **PASS**;
- Coprocessor ESM import: **PASS**.

## Stress evidence

Wave 3 additions:

- Fan-Out: 3,000 plans / 4,986 workers / 370 zero-worker plans / 300 background nominations / max observed workers 3;
- Warmer: 2,000 evaluations = 500 FRESH / 500 PARTIALLY_STALE / 500 STALE / 500 INVALID;
- Adaptive Retrieval: 1,000 evaluations / 333 corrective passes / 666 abstentions / 334 proceeds;
- Green Room: 1,000 outputs + 500 expiry cases; bounded final active state 24 and history 64;
- Consolidation: 1,000 units / 500 checkpointed / 1,000 DEEP obligations;
- Streaming Truth: 2,000 claim checks; OBSERVE mode produced zero interceptions.

Prior Wave 2 stress remains green in the same run: 2,500 capability negotiations, 1,200 exact-revision Artifact Reference operations, and 1,500 duplicate TURN_EVENT deliveries.

## Browser-host acceptance

Production Sidecar modules introduced/changed in Wave 3 are tested without Node `Buffer`/`process` conveniences and statically reject integration-visible `node:*`, `require()`, filesystem, `worker_threads`, and similar Node-only dependencies. Node/Python-only transport candidates remain isolated external tooling candidates.

This is Sidecar browser-path acceptance, not integration-wide SillyTavern clean-install acceptance under #185.

## Ownership boundaries retained

- Runtime owns scheduling, Resource Governor, pools, batch execution, yield/resume enforcement, backpressure, Event Spine delivery and Runtime Work Ledger.
- Core owns truth/state contracts, Artifact Repository authority, Context Compiler, Context Seal, Settlement and framework diagnostics.
- Memory owns durable storage/admission.
- Scene owns Scene state/events.
- UI owns presentation.
- Coprocessor remains proposal/advisory cognition only.
