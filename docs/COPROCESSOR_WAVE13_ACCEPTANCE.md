# Cognitive Coprocessor Wave 13 Acceptance

## Branch claim

**COPROCESSOR COGNITIVE-CHOICE CONTRIBUTION READY FOR CORE ASSEMBLY**

This is not a full #225 acceptance, #212 Jev acceptance, #77 pre-Send warmer acceptance or #224 Live Brain PASS.

## Acceptance boundary

The Coprocessor now provides a deterministic/replayable proposal and execution trace answering:

- which registered cognition options were considered;
- which were nominated, skipped, deferred or unavailable;
- why each disposition occurred;
- what revision/evidence fence was used;
- expected latency/cost;
- which physical resource/provider actually executed admitted work;
- what failed, timed out, became stale/invalid/late or used fallback;
- whether a warm packet was only a hint or was later Core-revalidated;
- why Jev was considered/skipped and whether it abstained/remained unresolved.

Core still owns final per-turn choice admission and final `CognitiveChoiceReceipt`.

## Goldens

Wave 13 validation covers:

- hot-sufficient "Thanks" with zero optional nominations and every role visibly skipped;
- current-location/history query with useful Historian + Graph nominations and exact revision fences;
- one-resource serial versus multi-resource parallel hints with identical semantic choices;
- MIXED retrieval with at most one owner-gated corrective nomination;
- LOW retrieval owner abstention fixture without Coprocessor evidence admission;
- competing Blade-destroyed versus Blade-removed evidence remaining UNRESOLVED when Jev abstains;
- deterministic Jev skip;
- missing/unhealthy/overloaded capability;
- optional provider timeout/failure;
- stale, invalid and late result facts;
- warm FRESH useful-hit accounting only after Core revalidation;
- warm miss/stale;
- revision/policy replay invalidation;
- bounded history and receipt size.

## Measurement honesty

The Wave 13 evaluator labels:

- Node process wall/CPU/RAM measurements as actual host measurements;
- per-capability/provider latency values as deterministic/simulated fixture estimates;
- token/currency cost as NOT_MEASURED unless a real usage/pricing receipt exists;
- live Jev provider bound as SKIPPED when the evaluator has no configured provider.

A fixture timing is never presented as a measured external-provider bound.

## Remaining blockers

#225 remains open until Core assembles these facts with its authoritative retrieval-quality, Candidate Bus, Truth, corrective, Precision, Gather and Seal receipts.

#212 remains open because Worker 4's replay repair is not transferred to this owner branch and Wave 13 does not substitute fixture Jev timing for real-provider acceptance.

#77 remains open until real Scene/Runtime/Core pre-Send warmer consumption is assembled.

#224 remains open until the full operator-visible Brain path is proven.
