# Area-52 Cognitive Core — Wave 2

## Authority and baseline

Wave 2 builds directly on the accepted Wave 1 baseline without replacing its contracts or regressions.

- Wave 1 accepted head: `ddeb13697709a4c5c32136dec174c47051c855fb`
- Wave 2 validated implementation checkpoint: `9c5a4449c393e8830ebccd53047c194e92b59f9a`
- Working branch: `Development-Nexus`
- `main` remains preserved.

The governing rules remain: source and learned knowledge are separate; every learned belief retains provenance; inference is not fact; current and historical truth coexist; models propose and canonical owners settle; caches are disposable; relearning is revision-fenced and dependency-bounded.

## Wave 2 result

Wave 2 deepens the first vertical slice into a richer evolving world model.

The executable flow is now:

```text
SOURCE / EXPERIENCE
  -> Source Registry
  -> Lore Study
  -> typed entities / aliases / properties / rules / capabilities /
     restrictions / relationships / events / atomic claims
  -> Mutation Proposals
  -> Settlement Engine
  -> Temporal State Graph
  -> Current / Historical / Contradicted / Unresolved projections
  -> exact / semantic / graph / temporal / conflict retrieval
  -> Truth Gate
  -> compact Context Compiler packet
  -> bounded Reflection proposals from repeated experience
  -> source edit
  -> dependency-cone invalidation
  -> incremental relearning / reflection refresh
```

## Cognitive contracts

### Input contract

Provider-neutral JSON-serializable values. Wave 2 extends the existing contracts with:

- `SettlementDecisionType`: `ACCEPT_CURRENT`, `ACCEPT_HISTORICAL`, `SUPERSEDE`, `CONTRADICT`, `UNRESOLVED`, `REJECT`;
- distinct knowledge forms for property, rule, capability, restriction, relationship and event;
- Reflection proposal/decision statuses;
- future evidence-input types compatible with Scene Intelligence outputs without depending on a scanner implementation.

### Output contract

Deterministic plain objects suitable for batched/asynchronous execution and later UI inspection.

### Canonical authority

Contracts define shape only. They grant no mutation authority.

### Provenance / freshness

Claims carry exact source revisions, semantic identity, revision-specific evidence identity, temporal validity and authority class.

### Failure / rebuild

Invalid constructors fail before canonical mutation. All contracts remain reconstructible from source/evidence plus revision identity.

### Benchmark coverage

Wave 1 serialization tests remain green; Wave 2 tests exercise the new settlement, reflection and evidence vocabulary.

## Lore Study Engine expansion (#4 foundation)

### Input contract

One active `SourceRevision`, immutable source metadata, and a replaceable study adapter. Batch entry points expose `prepareBatch -> executeBatch -> validateBatch -> commitBatch`.

### Output contract

Lore Study now emits distinguishable derived forms:

- entities and aliases;
- atomic state/location/ownership/relationship claims;
- properties;
- rules;
- capabilities;
- restrictions;
- temporal relationships;
- events;
- explicitly supported causal relationships;
- unresolved/reported claims;
- closures;
- typed world-state mutation proposals.

Source text is never rewritten into the learned representation.

### Canonical authority

Lore Study remains a proposer. It cannot choose current truth or settle conflicts.

### Provenance behavior

Every derived artifact points to the exact source revision and to contextual/event dependencies where applicable. Event-backed claims carry derivation links to the extracted event.

### Stable identity / freshness

Revision-specific claim IDs preserve Wave 1 evidence identity. A separate stable semantic identity allows the same meaning to be recognized across source revisions without making old evidence look current.

Reprocessing an unchanged revision is idempotent at derived-artifact identity. Editing source creates a new revision and new evidence IDs while retaining semantic identity where meaning survives.

### Invalidators

Source revision replacement invalidates only the transitive dependency cone rooted in the replaced revision.

### Failure behavior

Unsupported deterministic reference extraction fails before settlement. Prepared batches also fail validation if their source revision becomes stale before commit.

### Rebuild / recovery

Study can restart from the active source revision. The explicit prepare/execute/validate/commit boundary is compatible with future safe-yield/checkpoint execution without introducing Runtime Fabric in this lane.

### Benchmark coverage

Tests cover richer knowledge forms, aliases, exact-source preservation, provenance, stable semantic identity across edits, batch boundaries, event derivation and isolated relearning.

## Settlement Engine (#37 foundation)

### Input contract

Fresh `MutationProposal` objects owned by `WORLD_STATE`, with valid evidence IDs and source-revision fences.

### Output contract

An inspectable `SettlementDecision` plus canonical `SettlementReceipt` where mutation occurs.

Decision vocabulary:

- `ACCEPT_CURRENT`;
- `ACCEPT_HISTORICAL`;
- `SUPERSEDE`;
- `CONTRADICT`;
- `UNRESOLVED`;
- `REJECT`.

### Canonical authority

Settlement owns the decision boundary; models/study workers remain proposers. Temporal State Graph applies accepted canonical mutations.

### Decision inputs

The reference policy considers:

- canonical owner;
- evidence validity;
- source freshness;
- authority class;
- temporal position;
- corroboration;
- contradiction;
- prior settled state.

Confidence is diagnostic and never independently grants authority.

### Conflict behavior

Compatible multi-source evidence is retained as multiple provenance paths supporting one semantic fact.

If legitimate evidence conflicts at the same temporal position and no authority rule resolves it, `UNRESOLVED` is a successful settlement state. No silent winner is selected.

A weaker inferred candidate that conflicts with stronger admitted evidence is classified `CONTRADICT` without being promoted into canonical world state.

### Failure behavior

Wrong owner, stale source, invalid evidence or unsupported mutation yields `REJECT`; canonical mutation is not partially applied.

### Rebuild / recovery

Settlement decisions are deterministic from the proposal, current graph revision and valid evidence. Diagnostic explanations are non-canonical metadata.

### Benchmark coverage

All six required Wave 2 settlement outcomes are exercised in deterministic tests.

## Temporal State Graph expansion (#5 foundation)

### Input contract

Settlement-approved claim and slot-closure proposals.

### Output contract

Revisioned current, historical, superseded, contradicted and unresolved claim state; explicit validity intervals; transition sequences; bounded neighborhoods; receipts and change journal.

### Canonical authority

The graph owns settled temporal world-state storage, not extraction interpretation.

### Temporal behavior

Single-valued slots now use explicit validity windows. Newer incompatible state closes the prior state's interval instead of deleting it.

Temporal relationships can begin and end. Example membership:

```text
member_of = Ash Guild    T10..T20
no current membership    after T20
```

State transitions are queryable, including:

```text
intact -> damaged -> repaired -> destroyed
```

### Contradiction / unresolved behavior

Same-time incompatible admitted evidence does not select an arbitrary current winner. Evidence remains inspectable as contradicted/unresolved and the current slot can correctly have no settled value.

### Provenance behavior

Every stored claim retains exact source/evidence provenance. Historical states remain recoverable after supersession.

### Invalidators

Source edits invalidate only claims and closures tied to the replaced revision, then recompute affected slots.

### Failure behavior

Stale proposals are rejected by freshness fences. Invalid payloads do not partially mutate canonical state.

### Rebuild / recovery

Current projection, timeline and transitions are reconstructible from valid settled claims and closures. A simple revision journal records accepted changes/invalidation events for diagnostics.

### Benchmark coverage

Tests cover temporal relationship end, four-state object history, contradiction/unresolved state, bounded traversal, current projection and source-edit recomputation.

## Multi-source understanding

Compatible sources no longer become unrelated world facts merely because they have different source IDs.

Example:

```text
Source A: Mara owns the Ember Tavern.
Source B: The Ember Tavern has belonged to Mara for twelve years.
```

Area-52 retains separate evidence claims and both provenance paths. The current projection recognizes semantic compatibility, while Context Compiler emits one compact fact with aggregated support.

Conflicting sources remain separate evidence and are passed to Settlement rather than resolved by Lore Study.

## Event-driven world changes

Events are explicit derived artifacts. State claims can depend on events.

Causal relationships are emitted only for source text that explicitly supports them. The reference adapter does not infer causation from temporal correlation alone.

## Retrieval and Truth Gate expansion

### Retrieval channels

Wave 1 exact, semantic and graph channels remain. Wave 2 adds:

- temporal retrieval for timeline/history questions;
- conflict retrieval for contradiction/current questions where unresolved evidence matters.

### Query intent

Truth Gate now distinguishes:

- `CURRENT`;
- `HISTORICAL`;
- `TEMPORAL`;
- `CONTRADICTION`.

Unresolved/contradicted evidence may be admitted for current or contradiction-oriented reasoning as explicitly unresolved evidence; it is not mislabeled as current truth.

### Failure behavior

Missing/invalid claims remain unresolved rather than fabricated.

## Context Compiler expansion

The compiler still protects Main from database sprawl.

Compatible support is deduplicated semantically while source-revision provenance remains aggregated. Historical/unresolved facts carry bounded temporal qualifiers. Output sections remain current + relevant history + unresolved evidence rather than a raw claim dump.

Wave 1's compact packet acceptance ceiling remains satisfied after Wave 2.

## Bounded Reflection / learning loop (#9 foundation)

### Input contract

Repeated settled evidence claim IDs. At least two valid evidence items are required to create a proposal.

### Output contract

A `ReflectionProposal` carries:

- proposal ID;
- evidence IDs;
- source revisions;
- world revision;
- type;
- confidence;
- reasoning summary;
- invalidators;
- `INFERRED` authority;
- proposal status.

Settlement produces an inspectable Reflection decision and, where appropriate, an explicitly inferential Reflection artifact.

### Canonical authority

Reflection cannot create source canon or directly write settled world-state fact. Confidence never grants canonical authority.

### Feedback behavior

Repeated support can strengthen/admit an inference. Contradictory evidence can make it unresolved/contradicted. Editing/removing support refreshes only dependent reflections and can weaken/supersede them.

### Failure behavior

One isolated observation cannot create a Reflection proposal. Invalid/stale support is not silently retained as current evidence.

### Rebuild / recovery

Reflection artifacts declare source/evidence dependencies and can be recomputed from valid support.

### Boundary

This is the bounded Wave 2 learning-loop foundation only. Full consolidation, split/merge policy, lifecycle scheduling, retrieval feedback and Development-Memory work remain open.

## Future Scene Intelligence boundary

No Scene Scanner or Scene Intelligence implementation was added.

The core can consume provider-neutral evidence envelopes corresponding to future:

- `CurrentScene`;
- `SceneDelta`;
- `SceneEpisode`;
- `SCENE_CLOSED`;
- `SCENE_EPISODE_READY`;
- `LOCATION_CHANGED`;
- `TIME_SHIFT_DETECTED`.

Knowledge logic is not hard-coded to a particular scanner.

The requested `docs/AREA52_SCENE_INTELLIGENCE_BLUEPRINT.md` was not present on `Development-Nexus` during this wave, so no cross-branch copy was used.

## Runtime / batchability boundary

No Worker Director or Runtime Fabric was implemented.

Lore Study and Reflection expose bounded batch preparation/execution semantics so later runtime work can wrap them in the intended:

```text
prepareBatch
-> executeBatch
-> validate/checkpoint
-> commit
-> safeYield
```

without redefining cognitive authority.

## Golden-world expansion

Wave 2 adds:

- extended Ember Tavern / Sun Blade conflict world;
- temporal group membership;
- changed property lifecycle;
- legitimate conflicting evidence;
- multi-source corroboration;
- bounded learned inference with support erosion.

The extended Ember world proves the destroyed original tavern remains historical/current-destroyed while the Sun Blade can become genuinely unresolved when a later journal conflicts with destruction evidence. Both evidence paths remain recoverable.

## Validation

The exact published Wave 2 runtime/test blobs were SHA-compared against the local validated tree.

Combined branch test surface:

- **22/22 PASS**
  - 10 accepted Wave 1 tests;
  - 12 Wave 2 tests.
- JavaScript syntax checks: **PASS** across `src` and `tests`.
- direct ESM module loading: **PASS**.
- Wave 1 compact post-edit packet: **2,093 bytes**, preserving the original <2,500-byte acceptance ceiling.
- Wave 1 stale-current escape, provenance, historical recovery, dependency isolation and old-revision recovery remain green.
- Wave 2 Settlement decision vocabulary: all six outcomes exercised.
- Wave 2 source/runtime/test blob integrity audit: exact match at the implementation checkpoint.

## Intentional deferrals

This wave deliberately does **not** complete:

- full Lore Study hierarchy/community/ontology synthesis;
- production semantic extraction/model adapters;
- final persistence backend;
- production embeddings/rerankers;
- full Settlement policy including human-approval workflow;
- complete Reflection/consolidation lifecycle;
- broader learning-feedback loop owned by Development-Memory;
- Scene Intelligence;
- Runtime Fabric / Worker Director;
- UI.Core;
- Sidecar swarm.

Accordingly #4, #5, #9 and #37 remain open for broader planned work.
