# Cognitive Coprocessor Wave 3 Changelog

Starting checkpoint: `4b0a0382856a5306f716b1b0ec3f9d931322b0d0`

Implementation checkpoint: `c51b35b0766d12616bfa357494988a37fb36deac`

## Adaptive swarm

- Replaced fixed wake-set behavior with expected-value task nominations.
- Added provider-neutral Scene/query/cache/capability/health/load/cost/latency/revision inputs.
- Added deterministic foreground/opportunistic/background/cost/deadline-exposure caps.
- Added reason codes, required-input declarations, freshness fences, cost/latency estimates and fallback receipts.
- Preserved legal zero-worker success.

## Predictive warming

- Added revision- and intent-fenced WarmPacket contract.
- Added FRESH / PARTIALLY_STALE / STALE / INVALID classification.
- Added safe partial candidate-reference salvage with mandatory revalidation/recompile.
- Added bounded WarmPacket cache with TTL, capacity, invalidation and eviction.
- Added Scene `PREFETCH_RECOMMENDED` adapter without a Scene source import.
- Added latency-only warmer failure fallback.

## Adaptive retrieval

- Preserved HIGH/MIXED/LOW policy and made the corrective-pass bound hard at one pass.
- Added corrective action vocabulary and deterministic quality evaluation seam.
- Added controller that can SKIP, PROCEED, correct once, or abstain.

## Character Green Room

- Added sparse Wave 3 inference contract with required evidence/revision/expiry metadata.
- Added bounded batch/store policies for active characters, dimensions, evidence and history.
- Added scene/character/revision/source/contradiction/TTL invalidation.
- Added proposal-only ReflectionCandidate generation.
- Added strict authority and provider-output validation.

## Continuous consolidation

- Added reference-first consolidation units and proposal-only outputs.
- Added DEEP L3 Runtime task construction with checkpoint/yield/resume metadata.
- Added stale-result fencing and source-fact retention qualification.
- Added bounded backlog pressure accounting.
- Explicitly rejected direct Memory mutation, Settlement and source deletion claims.

## Streaming Truth

- Advanced OBSERVE prototype to explicit OBSERVE / VERIFIED_CHUNKS / experimental HARD_INTERCEPT modes.
- Added complete-claim buffering and provider receipt validation.
- Added CURRENT-vs-HISTORICAL, ambiguity and creative-language guards.
- Added fail-open verifier behavior.
- Kept hard interception disabled unless explicitly opted in.

## Telemetry and benchmarking

- Added bounded warm/retrieval/result-route/claim-check/backlog telemetry.
- Expanded recursive raw-material protection.
- Added Wave 3 qualification summary with MEASURED / REPLAYED / NOT_MEASURED / NOT_APPLICABLE states.
- Preserved deterministic precision corpus; no fabricated FlashRank/ColBERT result.

## Compatibility

- Added provider-neutral Scene signal/event adapters and FT002 contract fixtures.
- Preserved FT005 provider-neutral routing and strict validation.
- Added FT006 shadow-readiness metric surface without implementing FT006.
- Extended browser-path acceptance to all new production modules.

## Validation

Implementation checkpoint `c51b35b0766d12616bfa357494988a37fb36deac` passed:

- full regression 178/178;
- Wave 1 40/40;
- Wave 2 62/62;
- Wave 3 46/46;
- stress 12/12;
- browser-like 2/2;
- syntax PASS;
- ESM import PASS;
- GitHub Actions Wave 1 #39 PASS;
- GitHub Actions Wave 2 #18 PASS;
- GitHub Actions Wave 3 #1 PASS.

Phase 2 Provider Intelligence was not started.
