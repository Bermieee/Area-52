# Area-52 Cap Ledger (cap-remediation wave)

Status of this ledger: **inventory only; no cap changed yet.** Built by a read-only audit of `src/` at `repair/live-fixes` (6c20f2d, on main 786c67e) against `AREA52_CAP_REMEDIATION_ARCHITECTURE_HANDOFF.md`. The top findings (rows 1, 2, 13, 42, 51) were re-read in the code by the main session; the others are cited from the audit and are re-verified when their row is worked.

Classifications: SLICE, PAGE, RANK, CACHE, PHYSICAL, DIAGNOSTIC (handoff § Core Architecture Invariant). "Proposed" = intended new classification; "Status": untouched / changed / validated.

## Corrections to the handoff's assumptions (found by the audit)
- Memory `uniqStrings(values, limit)` **throws** (`memory-contracts.js:155-159`); Memory ref caps are hard failures, not trims. Lore `boundedUnique` does trim silently (`lore-contracts.js:92-94`).
- Declared but unused: Lore representation `relationshipRefs 128`, `claimRefs 192`, `behavioralAnchors 64`, `sensoryAnchors 64`, `validationRefs 768`; Memory `maxHistorianEpisodes 24`, `maxHistorianReflections 12`, `maxReflectionBatch 32`, `maxSummaryScopes 2048` (reported only).
- Scene `maxIntents 8 / hard 12` never binds (at most 7 intent kinds); Scene graph traversal limits are metadata only.
- Production warmer is capacity 16 with a 112-ref budget (`speculative-warmer-coordinator.js`), not 24/64.
- `enqueueDeep()` has no production caller; the production path (`classify()` -> DEFER) loses nothing. Row 59 is PHYSICAL/none today.
- Lore Study `MAX_CHUNKS` confirmed: `for (i=0; i<len && i<MAX_CHUNKS; i+=2)` gives at most 12 chunks covering sentences 0-23.

## Ledger

| # | Subsystem | Location | Value | Current behaviour when hit | Recorded? | Risk | Proposed | Continuation / canonical recovery | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Lore Study | lore-study-engine.js:35,52 `MAX_SENTENCES` | 96 | `splitSentences(...).slice(0,96)`; 97+ never studied; obligation COMPLETED | silent | knowledge loss | SLICE (96/slice, sentence cursor) | Runtime batch checkpoint; exact source canonical; coverage receipt required before COMPLETED | untouched |
| 2 | Lore Study | :36,865 `MAX_CHUNKS` | 24 | index compared to chunk cap: 12 chunks, sentences 0-23 | silent | knowledge loss | SLICE (24 chunks/slice) | chunk cursor | untouched |
| 3 | Lore Study | :37,450 `MAX_ENTITIES` | 96 | first-seen `.slice(0,96)`; claims may point at missing ENTITY artifacts | silent | knowledge loss | SLICE (publication), identity across session | session-wide entity map | untouched |
| 4 | Lore Study | :38,145 / :39,167 `MAX_CLAIMS` / `MAX_RELATIONSHIPS` | 192 / 128 | push returns once full | silent | knowledge loss | SLICE | pending claims carried to next slice | untouched |
| 5 | Lore Study | :40,619 `MAX_CONCEPTS` | 128 | sliced before dedupe | silent | knowledge loss (derived) | SLICE | continue derivation | untouched |
| 6 | Lore Study | :433 per-sentence candidates | 8 | fallback branch `.slice(0,8)` | silent | minor | SLICE or explicit overflow | — | untouched |
| 7 | Lore Study | :125/:469 aliases | 16 / 7 | trimmed | silent | minor | RANK (artifact) | aliases recoverable from exact source | untouched |
| 8 | Lore Study | :41,714 / :89-91 forms / sparse terms | 32 / 96 | forms never bind (3 exist); terms capped | silent | low | PHYSICAL (fail explicitly) / PAGE | — | untouched |
| 9 | Lore Study | :938-946 validateWorkspace | — | checks against the same caps, cannot fail; no sentences-studied/total | none | — | add coverage receipt | — | untouched |
| 10 | Lore Repr. | lore-representation-compiler.js:25-27,72 slices | 1200 / 120 / 128 | throws `SOURCE_SLICE_LIMIT_EXCEEDED` (~138K chars); all profiles for the source fail | compileFailures | work loss | SLICE (segment windows) | segments under one source revision; coverage receipt | untouched |
| 11 | Lore Repr. | :50 sentence spans | 512 | sentences after 512 get no texture contributions | silent | knowledge loss | SLICE | — | untouched |
| 12 | Lore Repr. | :28,203 contributionsPerSlice | 48 | rest of slice skipped | silent | knowledge loss | SLICE | extra extraction unit | untouched |
| 13 | Lore Repr. | :29,324-326 totalContributions | 512 | **alphabetical sort by semanticClass then slice**: REQUIRED_IDENTITY / TEMPORAL_ANCHOR / UNRESOLVED_CONFLICT cut first; receipt PASS | silent (PASS) | **knowledge loss** | SLICE (representation segments) | segments; validation against untruncated set | untouched |
| 14 | Lore Repr. | :35,430 maxRepresentationCharacters | 24000 | profile FAIL `CAP_EXCEEDED` | qualityReceipt | work loss | PHYSICAL per artifact + segments | segments | untouched |
| 15 | Lore Repr. | :36,641-659 provider request | 96000 | FAIL `PROVIDER_REQUEST_LIMIT_EXCEEDED` | qualityReceipt | work loss | PHYSICAL, split work | — | untouched |
| 16 | Lore Retrieval | lore-contextual-retrieval.js:391 query | 512 | **throws**; channel DEGRADED; brain passes raw message text | exception | knowledge loss (turn) | derived bounded query | original request identity kept | untouched |
| 17 | Lore Retrieval | :86-88,266 maxTokensPerRecord | 192 | only first 192 unique tokens indexed | silent | **knowledge loss** | PAGE (chunked records, common source id) | chunks | untouched |
| 18 | Lore Retrieval | :398-405 maxExaminedEntries | 512 | token-order pre-score cutoff; scope filter after the cap | `examined` | knowledge loss | PAGE (scope before cap; continuation on weak/exact miss) | page cursor | untouched |
| 19 | Lore Retrieval | :434-435 nominations | 16 / 24 | top 16; `boundedOut` not propagated by `queryForStory` | partial | knowledge loss | RANK (keep 16/24) + propagate boundedOut | — | untouched |
| 20 | Lore Retrieval | :100,112-132 candidate text / refs | 1600 / 64 | sliced; brain uses exact drillback | truncated flags | low | RANK/transport | drillback | untouched |
| 21 | Lore Hierarchy | lore-navigation-hierarchy.js:31 depth | 12 | deeper sources excluded from hierarchy **and retrieval index** | diagnostic ring | knowledge loss | virtual grouping (PAGE) | — | untouched |
| 22 | Lore Hierarchy | :70-79 children | 64 | already sharded | n/a | none | PAGE | — | validated (audit) |
| 23 | Lore Hierarchy | :198 community scopes | 256 | further communities never built | silent | nav loss | CACHE/working set | — | untouched |
| 24 | Lore Hierarchy | :273 scope count | 12000 | throws; whole hierarchy build fails | exception | work loss | PAGE/shard | — | untouched |
| 25 | Lore Summary | summary builder 214-218,401,444 | 4096 refs / 12000 chars | scope fails, skipped from index | failure codes | work loss | paged manifests | — | untouched |
| 26 | Sparse Lore | production-sparse-retrieval.js:176,247-276 maxArtifacts | 512 | exact matches then **alphabetical**; rest never indexed; status READY/HEALTHY | boundedOutCount | knowledge loss | CACHE (active working set) + targeted lookup | exact lookup / page expansion | untouched |
| 27 | Sparse Lore | :33-35 tokens | 512 | first 512 tokens per entry/query | silent | knowledge loss | PAGE | — | untouched |
| 28 | Scene obs. | deployment/brain.js:908; scene-observation-specialist.js:83 | 6000 chars | head kept; end of long replies never observed | silent | knowledge loss | SLICE (segments under one source revision) | segments reconciled by Scene owner | untouched |
| 29 | Scene query | scene/scene-query-planner.js:3,10 | 320 chars | first 320 chars feed Lore/Memory/Graph intents | silent | knowledge loss | derived query | — | untouched |
| 30 | Scene query | :2 refs | 32 | sliced | silent | minor | RANK | — | untouched |
| 31 | Scene retrieval | scene-retrieval.js:9,42,45-46 | 8 / 4-8 hops | NOT_FOUND indistinguishable from hop cap | silent | minor | RANK / PAGE with continuation | — | untouched |
| 32 | Scene prefetch | prefetch-trigger.js:47,65,69 | 32 / 8 / 3 rev | FIFO evicts even ACTIVE | silent | latency | CACHE | foreground retrieval authoritative | untouched |
| 33 | Context compiler | context-compiler.js:30,82 claims | 12 | priority sort; RICH_FALLBACK on retention < 1 | fallbackUsed | low | RANK (adaptive) | — | untouched |
| 34 | Context compiler | :86-87 external Lore/Memory | 12 each | **admission order, unsorted**, no retention check | silent | **knowledge loss** | RANK (priority + receipt) | — | untouched |
| 35 | Context compiler | :19 external text | 12000 | head-sliced | silent | knowledge loss | RANK/transport + drillback | — | untouched |
| 36 | Memory historian | memory-historian.js:246 query | 600 | **throws** | exception | knowledge loss (turn) | derived query | — | untouched |
| 37 | Memory historian | :253-270 examined | 512 | token-order pre-score cutoff | examined | knowledge loss | PAGE | — | untouched |
| 38 | Memory historian | :284-285,416 candidates | 48 | top-48 | boundedOut | low | RANK | — | validated (audit) |
| 39 | Memory historian | :126,161,198 indexed terms | 192 | tail unindexed | silent | knowledge loss | PAGE (chunked index) | — | untouched |
| 40 | Memory historian | :456-470 evidence bytes | 65536 | **all-or-nothing**: empty artifacts when over | EVIDENCE_BUDGET_EXCEEDED | knowledge loss | RANK (top-N that fit) | — | untouched |
| 41 | Memory episode | memory-temporal-producer.js:272 | 1600 | episode summary = first 1600 chars; sole dense/historian text | silent | **knowledge loss** | segmented representation | exact evidence canonical | untouched |
| 42 | Memory graph | memory-temporal-state-graph.js:313,335,354 journal traversal | 8192 | `slice(-8192)`: facts settled earlier vanish from CURRENT/HISTORICAL | silent | **knowledge loss** | PAGE / snapshot-based projection | journal retained | untouched |
| 43 | Memory graph | :342 projection slots | 4096 | throws for whole projection | exception | work loss | PAGE | — | untouched |
| 44 | Memory graph | :402-412 traversal claims | 512 | keeps **oldest**, drops newest | bounded:true | knowledge loss | PAGE (newest-first + cursor) | — | untouched |
| 45 | Memory store | memory-experience-store.js:109-117,194,274 | 128 / 64 / 64 | throws | exception | work loss | SLICE/segments | — | untouched |
| 46 | Memory store | :426; producer :414 consolidation jobs | 4096 | store throws; producer silently slices | exception / silent | work loss | backpressure (parked) | Runtime | untouched |
| 47 | Memory store | :477-480,533 checkpoint/summary units | 32 | resumable | CHECKPOINTED | latency | SLICE | — | validated (audit) |
| 48 | Memory summaries | memory-summary-hierarchy.js:354-357 via producer :325-327 | 512 episodes/child scopes | **turn 513 throws every turn**: summary, reflections, vectors skipped permanently | FAILED | **work + knowledge loss** | PAGE (hierarchical summaries) | — | untouched |
| 49 | Memory summaries | :418,431,488,753 | 8192 / 12000 / 256 | throws non-retryable; drillback paged | failures[] | work loss | paged manifests | — | untouched |
| 50 | Memory summaries | :272 query index terms | 32768 | new tokens unindexed | silent | minor | PAGE | — | untouched |
| 51 | Memory vectors | memory-vector-index.js:9,19 maxPending | 4096 | **`pending.splice(0,…)` drops oldest pending** | silent | knowledge loss (dense) | backpressure `DEFERRED_BACKPRESSURE` | reconstructable from canonical Memory | untouched |
| 52 | Memory vectors | :9,86 maxVectors | 4096 | oldest evicted, no receipt, no re-queue | silent | knowledge loss (dense) | CACHE (visible, regenerable) | lexical fallback; re-embed on wake | untouched |
| 53 | Memory vectors | :22,57,64 | 16/cycle / 48 | bounded batch / top-k | — | latency | SLICE / RANK | — | validated (audit) |
| 54 | Memory bridge | memory-evidence-bridge.js:84,326 raw input | 32768 | throws **after** evidence appended and prior mapping marked STALE (`replacedByMappingId:'pending'`) | typed error, corrupt state | knowledge loss + integrity | segmented admission; validate before mutate | — | untouched |
| 55 | Memory bridge | :255/:261/:427/:493 | 8192 / 32 / 2048 / 4096 | lifetime journals; after limit every new mapping throws | typed error / REJECTED | work + knowledge loss | split operational vs diagnostic history; compaction | — | untouched |
| 56 | Warmer | speculative-warmer.js:107,115 | 24 / 64 / 2 | put throws -> WARMER_FAILED; FIFO eviction | receipt | latency | CACHE | ordinary retrieval | validated (audit) |
| 57 | Warmer (prod) | speculative-warmer-coordinator.js:15-16,79-83 | 16 / 48+64 | mergeBounded throws; falls back | diagnostic | latency | CACHE | ordinary retrieval | validated (audit) |
| 58 | Jev | native-jev-advisory.js:19,63-67,81,181 | 2 / 8 / 64 / 240 | sets >2 break unrecorded; >8 members skipped permanently | partial | advice loss | SLICE + UNRESOLVED/DEFERRED_JEV | next turns | untouched |
| 59 | Deep scheduler | native-hot-deep-scheduler.js:29,43,104 | 128 | enqueueDeep throws, no production caller | metric | none (prod) | PHYSICAL + parked obligation if ever used | — | untouched |
| 60 | Native Brain turns | native-brain.js:148,154,2059 maxTurns | 256 | FIFO eviction; evicted `experience` breaks host edit/delete retirement (old deleted message stays current); `correctTurn` throws | silent / error | **freshness loss** | split: operational identity (durable) vs diagnostic record (CACHE) | durable per-message source identity | untouched |
| 61 | Native Brain turns | native-turn-retention.js:12,110 full detail | 4 | older settled records compacted (safe) | retention block | diagnostic | DIAGNOSTIC | — | untouched |
| 62 | Candidate bus | candidate-bus.js:17,185 | 1600 | ranking text head-sliced | silent | low | RANK/transport | evidence text | untouched |
| 63 | Consolidation | continuous-consolidation.js:599,603 dedupe identity | 256 / 512 chars | claims sharing a 256-char prefix deduped as one | silent | knowledge loss (collision) | full-content identity (hash) | — | untouched |
| 64 | Knowledge store | native-knowledge-store.js:46,137,323-331 | 8192 / 64 | non-current evicted oldest first | silent | low (history) | CACHE/DIAGNOSTIC | — | untouched |
| 65 | Memory drill excerpts | deployment/brain.js:3000,3612 | 2400 / 1200 / 8 | head-sliced inputs for consolidation/Jev | silent | low | RANK/transport | drillback | untouched |

## Related performance finding carried into this wave
Checkpoint size and CPU grow linearly with retained turns (repro `LEN=80 TURNS=40`: ~245 KB and ~45 ms per turn; 0.33 s -> 2.2 s post-response work at 40 turns; `maxTurns` 256). The turn record is mostly diagnostic (row 61) except the operational identity row 60 needs. Splitting durable operational identity from the diagnostic record (row 60) is the fix path; it also bounds checkpoint growth.

## Proposed order (handoff priorities, adjusted by audit severity)
1. P1 semantic truncation: rows 1-5, 13 (+11, 12, 10), 28, 41, 54, 17.
2. P2 silent lost work: 48 (turn-513 wall), 42 (journal window), 51-52, 46, 55, 60.
3. P3 bounded search: 16/36 (throwing queries), 18/37, 26-27, 44, 29, 40.
4. P4 derived representation overflow: 10-12, 14, 21, 23-25, 49.
5. P5 publication: 34, 35, 33, 19.
6. P6 audit remaining CACHE/PHYSICAL/DIAGNOSTIC rows.
