# Memory Wave 4 Acceptance Candidate

## Lane claim

**GENERAL-WORLD MEMORY PRODUCER READY FOR FT003 INTEGRATION**

This claim is valid only when the final `Development-Memory` head has a green exact-head Actions run covering Wave 1–4 focused tests, browser portability, representative stress, full regression, syntax and ESM import.

It does **not** mean #178 FT003 PASS or #224 Live Brain PASS.

## Starting condition and drift

The requested baseline was:

`a6d7cac76d5bb9fae7c9b2d67c2b7a6342db96b2`

At Wave 4 audit time, the live branch was already 20 commits ahead at:

`22d59f3062b495cb837841a2a8cb01aea7575ce5`

Those commits were treated as pre-existing Wave 4 work and audited in place. No replacement branch was created and no owner lane was edited.

## Acceptance coverage

Wave 4 focused goldens exercise the same public Memory APIs with two unrelated user-authored worlds and no fixed Ember Tavern fixture dependency.

The tests prove:

- unrelated characters, locations, objects and time changes use the same public APIs;
- a justified location transition is CURRENT while the earlier location remains HISTORICAL and reconstructable with `asOf`;
- conflicting reports remain UNRESOLVED despite a Reflection, a high-confidence Jev-like proposal and Historian ranking;
- Reflection artifacts remain INFERRED and do not become observed fact or canonical Settlement;
- selected-chat Historian filtering happens before ranking, including when another world has a larger matching candidate population;
- character perspective cannot reveal private evidence through exact retrieval, hierarchy retrieval, cache or drillback;
- one source correction invalidates only its dependency cone while an unrelated world's Arc identity remains unchanged;
- unconfirmed Scene boundaries, wrong Scene revisions, forged authority and late sealed-generation evidence fail closed with inspectable reason codes;
- the Memory UI producer follows selected chat/turn/generation and does not reuse another generation's retrieval receipt;
- Memory subscription events are read-only notifications and do not include raw evidence;
- consolidation work is bounded, resumable after snapshot/reload and parked when its generation is already sealed;
- stale consolidation source fences cannot publish a Reflection;
- consolidation-session revision fences can exceed the 64-ref per-artifact limit while remaining bounded at the session-level 4,096-ref cap.

Production Memory modules are additionally scanned by the Wave 4 review path and contain no fixed `Ember Tavern`, `Mara`, `Eris`, or `Sun Blade` scenario dependency.

## Card-by-card Memory disposition

| Card | Worker 1 Memory-owned scope | Remaining work outside Memory |
| --- | --- | --- |
| #178 — FT003: real Memory / Experience -> Retrieval -> Seal | Exact/general-world evidence admission, Scene-associated experience, Temporal projection, Historian nomination, exact drillback and public assembly seams are production-ready when exact-head CI is green. | Director/Worker 4 must assemble real Memory nominations through Candidate Bus, Truth/Precision, Gather, Context Seal and PromptPlan in SillyTavern. |
| #5 — Temporal State Graph | Memory validates CURRENT/HISTORICAL/UNRESOLVED transitions, supersession, as-of reconstruction, exact evidence provenance and correction invalidation on general-world fixtures. | Full card completion depends on accepted assembled owner Settlement behavior and project-level integration acceptance. |
| #175 — Hierarchical Summary and compaction | Grounded revisioned Scene->Chapter/Session->Arc->Story summaries, source drillback, query indexing, dependency-local invalidation and general-world selected-chat retrieval are covered. | Cross-lane long-horizon assembled acceptance remains. |
| #205 — Historian retrieval | Exact and hierarchical nomination, source drillback, selected-chat freshness fencing and character-perspective fencing are exposed through the public producer contract. | Candidate Bus/Sensory admission and downstream Truth/Precision remain Core/Sensory-owned. |
| #9 — Reflection and consolidation | Supported revisioned Reflection publication, provenance, correction invalidation and stale/late fencing are covered on ordinary narratives. Reflections remain INFERRED. | Broader project learning/promotion behavior and owner admission remain outside this lane. |
| #79 — Sleep Cycle worker | Memory supplies bounded resumable consolidation sessions/work units, revision fences, checkpoints, snapshot/reload and sealed-generation parking. | Runtime/sidecar scheduling, preemption, physical worker execution and system-wide continuous operation remain Worker 2/Runtime-owned. |

Shared blockers are not closed here. Memory contributes the general-world producer path needed to remove the fixed Ember Tavern scenario and the live read/subscribe producer needed by Worker 3's Brain-to-UI wiring. Worker 4 still owns assembled demo repair and final validation.

## Worker 3 handoff

Use:

- `readMemory(selection)`
- `subscribeMemory(listener)`
- or `createMemoryUiProducer({readSelection})`

The UI producer's `read()`, `readRetrieval()` and `subscribe()` methods use the UI.Core Wave 11 host selection identity. Missing or stale selected-context data stays unavailable/degraded; no unrelated prior generation is substituted.

See `docs/MEMORY_WAVE4_GENERAL_WORLD_PRODUCER.md` for the complete field and scoping contract.

## Worker 4 handoff

The required Memory assembly order is:

`exact evidence -> owner mapping -> confirmed Scene experience / Core Settlement -> Temporal State -> Historian nomination -> Candidate Bus -> Truth/Precision -> Gather -> Context Seal -> PromptPlan`

Memory supplies the left side through Historian nomination and exact drillback. It does not claim the downstream owner stages.

Deep consolidation must be executed through Runtime scheduling with generation/source revision fences. A result that is late for an already sealed generation is parked for the next turn and cannot mutate the active Context Seal.

## Validation gate

The authoritative acceptance evidence is the final exact-head GitHub Actions run after all Wave 4 source, tests and documentation are pushed. The Director return should report that run ID/URL, focused/full counts, all four stress receipts, changed-file compare, final SHA and measured Wave 4 resource costs.
