# Lore Wave 5 — Learned Ontology, Multi-Level Summaries, and Retrieval

Owner branch: `Development-Lorebook-Editor`

## Wave 4 regression repair

Exact-head runs on `2d95d5fad42129b47ccb72da4690c552339749e2` failed because Wave 4 changed `LorePublicIntegrationSurface.contractVersion` from `1` to `2`, while Wave 1 deliberately asserts version 1. The Wave 4 additions were additive and did not require an incompatible protocol break.

Fix: restore public surface contract version 1 and keep the additive Wave 4 fields. No Wave 1–3 coverage was removed.

## Learned ontology

The old study pass contained fixed RP-specific concepts:

- tavern -> location/business
- blade/sword -> weapon
- owns -> proprietor

Wave 5 removes those hardcoded semantic categories.

Ontology concepts are now learned from current studied lore evidence:

- entity type evidence;
- claim subject/object roles;
- relationship subject/object roles;
- authored Lore Tree topics;
- repeated evidence-backed concept/community membership.

`LoreWorldOntology` aggregates these into revision-fenced concept nodes, relationship evidence, and communities. It never claims source-canon, Temporal State Graph, settlement, or Context Seal authority.

## Multi-level summaries

Existing hierarchy/navigation summaries are promoted into a stable read contract through `LoreIntelligenceService.summarySurface()`.

Levels:

- ENTRY
- TOPIC
- COMMUNITY
- BOOK
- CORPUS

Every summary contains source revision refs, child summary refs, provenance, and a quality receipt.

## Retention quality gates

Critical evidence now includes:

- hard rules;
- rule exceptions;
- character-specific behavior;
- significant relationships;
- current/historical/sequence/dated/uncertain/conflicting evidence;
- unresolved claims.

A summary that omits decisive critical evidence fails validation and is not published. Retrieval can still fall back to exact/current source records and detailed representations.

## Brain contract additions

`brainInterface()` remains backward compatible and adds:

- `summaries()`
- `query()` packets now include `ontologyRevision`
- `thematicCommunities[]`
- relevant multi-level `summaries[]`

Packets retain `sourceRevisionFence[]`, exact-source drillback, and no truth/settlement/seal authority.

## Worker 3 operator contract

No Worker 3 UI files are changed. `operatorInterface()` is unchanged from Wave 4:

- reads: surface/status/loreStudy
- actions: accept/submit/ingest/run/start/retry

The status payload additionally contains current ontology data through the Lore Intelligence status.

## Dependency cone

Source edits invalidate only representations/summaries/ontology memberships that depend on the changed revision. Unrelated lorebooks retain current learned revisions and reusable summaries.

Source removal creates a tombstone revision and removes that source from current ontology/retrieval while historical exact source remains in revision history.

## Self-contained native path

No external graph database, vector server, model provider, orchestration daemon, Redis, SQL, or Dapr is required.

## Acceptance suite

`tests/lore-wave5.mjs` covers:

1. two unrelated discovered lorebooks;
2. evidence-derived ontology and communities;
3. absence of old fixed RP ontology labels;
4. ENTRY/COMMUNITY/BOOK/CORPUS summaries;
5. rules, exceptions, behavior, temporal and unresolved evidence retention;
6. broad thematic retrieval with Lean selection;
7. narrow detailed retrieval with Heavy selection;
8. exact authored source drillback;
9. lossy summary rejection with exact-source fallback;
10. edit-scoped summary/ontology invalidation;
11. unrelated book summary reuse;
12. removal from current ontology/retrieval;
13. checkpoint/reload/resume continuity;
14. performance metrics emitted by the exact-head suite.
