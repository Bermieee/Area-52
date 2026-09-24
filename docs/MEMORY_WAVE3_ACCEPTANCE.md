# Memory Wave 3 Acceptance Candidate

## Strongest lane claim

**MEMORY EVIDENCE BRIDGE READY FOR FT003 ASSEMBLY**

This is a Memory-lane claim only. FT003 itself still requires the integrated Memory -> swarm/Candidate Bus -> Truth/Precision -> Gather/Context Seal -> PromptPlan path. #224 Live Brain Demo is a separate live SillyTavern gate.

## Verified starting point

Wave 3 started from:

`Development-Memory@7973bb7670b1c53809379491875aa0963b20b0e1`

The live branch was identical to the expected SHA before edits.

Read-only owner references used during implementation:

- Scene: `Development-Scene-Scanner@3aaf1c1e9e7e8703dc8c66c5542efb03cc9873cf`
- Core: `Development-Nexus@ba4619f56db8e4f94873256dc26589e1680b7d29`

## Pre-documentation execution gate

Connector runtime execution against the assembled Memory modules:

- Wave 1 focused: **16/16 PASS**
- Wave 2 focused: **9/9 PASS**
- Wave 3 focused: **14/14 PASS**
- combined focused: **39/39 PASS**
- Wave 1 2,600-event stress: **PASS**
- Wave 2 3,000-event hierarchy stress: **PASS**
- Wave 3 3,000-event + 300 external-mapping profile stress: **PASS**
- production/test static parse audit: **17/17 PASS**
- browser-forbidden-API audit: **9/9 production modules PASS**

The final documentation head still requires its own GitHub Actions run.

## Wave 3 goldens

Proven:

- Scene exact evidence may arrive before or after its proposal; only exact revision-matched evidence plus confirmed boundary makes the episode fresh.
- `SCENE_BOUNDARY_CANDIDATE` alone never materializes a current episode/scope.
- missing source mappings remain withheld.
- `MENTIONED_ONLY` evidence remains withheld.
- wrong Scene/world fences fail closed.
- source correction stales the dependent Scene/Arc and Historian material only.
- an unrelated Arc preserves artifact identity and its unaffected cached view.
- replaying an old Scene owner event cannot resurrect stale material.
- mapped Core Tavern evidence plus matching owner decision/receipt changes CURRENT INTACT -> DESTROYED while as-of INTACT remains reconstructible.
- mapped evidence without a matching owner receipt cannot mutate canon.
- two Sun Blade fate claims remain UNRESOLVED and produce no invented current winner.
- Eris cannot retrieve Mara-only secret evidence through exact episode retrieval, summary retrieval, warm cache or drillback.
- duplicate mapping is idempotent.
- conflicting identity reuse, forged authority, missing exact content, stale owner/source revision, wrong Scene/world fence and late sealed-generation material fail closed.
- snapshot/reload retains mapping journal, exact raw evidence, summary query index and bounded cache without duplicate publication.

## Local profiling result before documentation

Representative Wave 3 stress:

- narrative events: **3,000**
- external exact mappings: **300**
- total exact Memory evidence records retained: **3,300**
- episodes: **1,000**
- hierarchy scopes: **111**
- summary revisions retained: **114**
- initial hierarchy batches: **7**
- hierarchy build: approximately **2.944 s**
- bridge admission: approximately **129 ms total**, **0.43 ms/mapping**
- exact Historian: approximately **0 ms p50 / 1 ms p95**, max **40** candidates examined
- legacy Wave 2 hierarchy: approximately **11 ms p50 / 14 ms p95**, **10** summary artifacts examined
- indexed hierarchy, cache disabled: approximately **3 ms p50 / 5 ms p95**, **10** indexed candidates examined
- warm hierarchy cache: approximately **0 ms p50 / 1 ms p95**
- first optimized broad cold query: approximately **4 ms**
- one-source correction/rebuild: approximately **234 ms**, **1** rebuild batch
- one external mapping invalidation: approximately **54 ms**
- stale nominations after correction: **0**
- unrelated Arc identity preserved: **true**
- unrelated cached view preserved: **true**
- raw evidence loss: **0**

Resource snapshot:

- bridge mappings retained: **300**, fresh current: **299** after one invalidation
- raw owner audit payload: approximately **292,820 chars**
- retained summary estimate: approximately **3,329,980 UTF-16 bytes**
- query-index estimate: approximately **1,690,650 UTF-16 bytes**
- query-cache estimate: approximately **169,368 UTF-16 bytes**
- indexed query terms: **5,087**
- query cache entries at measurement end: **2**
- query-index builds: **2**
- accumulated query-index build time: approximately **42 ms**

The repeatable local speedup is **legacy hierarchy -> indexed hierarchy**, not hierarchy -> exact Historian. Exact retrieval remained as fast or faster for this lexical corpus. Warm cache closes most of the hierarchy overhead for repeated broad requests.

An earlier pre-optimization bridge run measured about **51.6 ms per mapping**. Revision-fence caching plus avoiding no-op Historian rebuilds reduced the same workload to about **0.43 ms per mapping** in the subsequent run.

## Authority gate

Every bridge/mapping/Scene/Core adapter receipt grants:

- Candidate Bus admission authority: **false**
- truth authority: **false**
- Settlement authority: **false**
- canonical mutation authority: **false**
- context injection authority: **false**
- Context Seal authority: **false**
- Runtime scheduling authority: **false**

Only the existing validated owner Settlement chain may mutate canonical Temporal State.

## Remaining assembly work

- Scene integration must call the bridge with the actual exact owner evidence content/revision proof and route confirmed boundary / episode-ready events.
- Core integration must provide explicit owner evidence descriptors for each Settlement evidence ID and continue owning Settlement.
- Runtime still owns scheduling/yield for Memory consolidation/compaction work.
- Core still owns Candidate Bus admission, Truth/Precision, Gather/Context Seal and PromptPlan.
- FT003 must exercise the real integrated path.
- #224 must pass separately in live SillyTavern.

## Issue disposition

Keep open:

- #178 — prepared for assembly; FT003 not passed.
- #5 — Memory evidence mapping improves assembly, issue-level integration acceptance remains Director/Core owned.
- #175 — hierarchy behavior preserved and optimized; assembled long-horizon acceptance remains open.
- #205 — Memory Historian producer is assembly-ready; integrated Candidate Bus path remains open.
- #9 — Reflection authority/dependency behavior preserved; broader learning card remains open.
- #79 — Memory work remains bounded/resumable; Runtime Sleep scheduling remains open.
- #224 — not passed.
