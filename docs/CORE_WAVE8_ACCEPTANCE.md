# Core Wave 8 Acceptance

## Scope

Wave 8 builds the production Hybrid Sensory Net backbone: Candidate Bus, multi-channel fusion/deduplication, Active Continuity channel, typed provider registry, and backend-neutral revision-aware index lifecycle.

It does not implement Scene Query Planner, Adaptive Retrieval control, Graph Walker, Historian, Character Memory, Lore Study, RAPTOR/GraphRAG, production embedding service, Qdrant/Milvus selection, UI, or another Hot Cognition system.

## Starting point

- branch: `Development-Nexus`
- Wave 7 starting SHA: `7bfed00a7e6962c711b16f9f2fb9641e4cbcb914`
- protected main: `daad62cc62c27acd12f7d77bf1fec5bdfc06ca45`

## Production acceptance checkpoint

- SHA: `d2e676d04c06aaddeaeb559b729009a9659b7049`
- Cognitive Core CI: `35983436143` — SUCCESS
- full Node test result: **181/181 PASS**
- Wave 8 acceptance: **30/30 PASS**
- browser-host source: **91/91 PASS**
- browser runtime: **7/7 PASS**
- syntax: PASS
- Core ESM load: PASS

Wave 7 Hot Cognition regression remains green: 10 focused Hot Cognition tests plus the focused Hot Cognition stress test run inside the 181-test suite.

## Candidate Bus goldens

PASS:

- long-form RP complementary retrieval;
- one promise nominated by Sparse + Dense + Historian + Graph -> one candidate with four preserved channel records;
- promise and later breach remain distinct;
- distinct claims in one source remain distinct;
- contradiction candidates remain both present;
- order-independent fusion;
- replay idempotence;
- authority/truth negative tests;
- stale revision fencing;
- per-intent traceability;
- deterministic bounding/receipt;
- partial channel failure isolation;
- zero-external-channel Active Continuity path;
- production Core publication emits CandidateBusEnvelope.

## Index lifecycle goldens

PASS:

- sparse + dense same lifecycle contract;
- source B r1 -> r2 only changes B representations;
- A/C representations remain reusable;
- stale old B cannot publish fresh;
- invalidation visible;
- tombstone visible;
- deterministic rebuild from owners;
- backend migration preserves candidate/evidence identity;
- torn update detected and not fresh;
- torn update recovery;
- duplicate lifecycle idempotence;
- out-of-order owner revision rejected;
- interrupted rebuild detected;
- interrupted rebuild recovery.

## Focused stress

**31,250 pressure units**:

- 10,000 candidate nominations;
- 5,000 duplicate nominations;
- 5,000 order permutations;
- 2,000 stale/revision cases;
- 2,000 partial-channel failure cases;
- 2,000 index inserts;
- 2,000 index updates;
- 1,000 invalidations;
- 1,000 tombstones;
- 500 rebuilds;
- 500 verify cycles;
- 250 torn-state recovery cases.

Stress invariants all PASS: bounded pool/metadata/receipts/history, replay dedupe, order independence, no authority escalation, stale visibility, channel-failure isolation, lifecycle counts, invalid/tombstone non-freshness, rebuild stability, torn recovery and no candidate-set retention leak.

## CI performance measurements

These are deterministic CI-fixture measurements, not production latency promises:

- fusion of 15,000 delivered nominations under stress: 1447.599 ms;
- 5,000 small-set order permutations: 8971.492 ms total;
- 2,000 twenty-channel failure-isolation cycles: 1027.364 ms total;
- 2,000 two-adapter inserts: 645.941 ms;
- 2,000 two-adapter updates: 1094.769 ms;
- 1,000 two-adapter invalidations: 119.665 ms;
- verify 2,000-entry two-adapter lifecycle: 211.814 ms;
- 500 rebuild + verify cycles on deterministic fixture: 2342.112 ms;
- 250 torn/recovery cycles: 4111.913 ms.

The bounded stress envelope contained 512 candidates; fusion receipt was 78,787 bytes; full stress envelope was 1,656,486 bytes; compact receipt history size was 1 for the measured fusion.

## Result

Candidate Bus Core is complete. Live channel population is intentionally incomplete.

The parent Sensory Net remains open because production providers/backends outside Core remain future/shared work.
