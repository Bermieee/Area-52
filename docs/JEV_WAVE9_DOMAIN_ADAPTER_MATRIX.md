# Jev Wave 9 — Cross-Domain Adapter Matrix

## Scope

Wave 9 adds thin semantic adapters between owner-specific ambiguity and the accepted generic Jev Decision Core. It does not change Jev into a domain owner and does not rebuild Runtime.

Canonical path:

```text
owner-specific ambiguity
 -> deterministic owner precheck
 -> thin domain adapter
 -> canonical JevDecisionRequest
 -> generic JevDecisionCore
 -> JevDecisionReceipt
 -> thin domain adapter
 -> typed owner proposal / abstain / unresolved / escalation
 -> owner policy / optional Settlement
```

Permanent invariant:

> Jev understands the bounded decision. Jev does not become the owner of the domain.

## Adapter contract

`JevDomainAdapterRegistry` explicitly registers adapters by stable `adapterId`, `domainId`, version and supported decision kinds. Duplicate adapter IDs and duplicate domain/kind registrations are rejected. Unsupported lookups fail clearly. Registry state is instance-local; no implicit global registration exists.

Each adapter supplies:

- `canAdapt(input)`;
- `deterministicPrecheck(input)`;
- `buildRequest(input, precheck)`;
- `validateReceipt(receipt, context)`;
- `interpretReceipt(receipt, context)`;
- `fallbackProposal(input, failure)`.

Precheck statuses are `DETERMINISTIC`, `JEV_REQUIRED`, `UNRESOLVED_WITHOUT_JEV`, `INVALID`, and `STALE`. Wave 9 production adapters use deterministic owner rules before provider execution; stale/freshness is also enforced by the canonical Jev request/receipt fence.

## Registered domains

### Lore — `jev.adapter.lore.v1`

Supported decision kinds:

- `LORE_TREE_PLACEMENT`;
- `LORE_RECONCILIATION`;
- `LORE_RETENTION_REVIEW`.

Lore reconciliation options include `EXACT_DUPLICATE`, `REDUNDANT_OVERLAP`, `COMPLEMENTARY`, `TEMPORALLY_DISTINCT`, `CONTRADICTORY`, `RELATED_NOT_MERGEABLE`, and `UNRESOLVED`. Protected/illegal Tree placement options become hard owner constraints before Jev. Exact duplicates, single surviving placements, and explicit retention failures can resolve deterministically.

The owner-facing result is `LoreDecisionProposal` or `LoreReconciliationProposal`. It cannot set SOURCE_CANON, delete a UID, move a Tree node, merge source entries, or settle conflicting lore. Retention review may propose `REWORK_REQUIRED`; it cannot rewrite a representation or source.

### Scene — `jev.adapter.scene.v1`

Supported decision kinds:

- `SCENE_BOUNDARY`;
- `SCENE_CAST_LOCATION_CONFLICT`;
- `SCENE_MERGE_SPLIT_REVIEW`.

Boundary alternatives are finite owner-supplied options such as `CONTINUE_SCENE`, `OPEN_NEW_SCENE`, `RESUME_PRIOR_SCENE`, and `UNRESOLVED`. Doorway/no-real-boundary and observed unambiguous location changes can resolve deterministically.

Scene owner rules are enforced before Jev:

- `MENTIONED_ONLY != PRESENT`;
- inferred location is not observed location;
- Jev cannot create a Scene revision;
- Jev cannot write Scene truth.

The owner-facing result is `SceneDecisionProposal`. Abstention preserves the accepted Scene state.

### Retrieval / Truth — `jev.adapter.retrieval-truth.v1`

Supported decision kinds:

- `RETRIEVAL_CANDIDATE_INTERPRETATION`;
- `RETRIEVAL_CORRECTIVE_CHOICE`;
- `TRUTH_SEMANTIC_AMBIGUITY`.

Jev is semantic fallback after deterministic Retrieval/Truth checks, not a general reranker. HIGH-quality retrieval can deterministically choose `NO_CORRECTION`; stale candidates and options that claim authority, rewrite provenance, or promote historical evidence to CURRENT are rejected before Jev. LOW-quality evidence remains unresolved without forcing provider execution.

The owner-facing result is `RetrievalTruthDecisionProposal`. It cannot set candidate authority, rewrite provenance, settle Truth, promote historical evidence to CURRENT, mutate Candidate Bus, or write Context Seal.

## Canonical request/evidence boundary

Adapters continue using `JevDecisionRequest`; the Jev kernel has no Lore/Scene/Retrieval branches. Domain context is bounded metadata plus compact owner-created evidence references.

Wave 9 adapter limits:

| Field | Limit |
|---|---:|
| options | 16 |
| evidence refs | 32 |
| compact evidence | 24 KiB |
| provenance refs | 64 |
| adapter metadata | 4 KiB |
| explanation | 400 chars |
| owner proposal | 32 KiB |

Full conversation, lorebook, Memory corpus, raw prompt, provider-response dumps and hidden reasoning are not adapter request fields. Tests verify unrelated raw payload fields are ignored.

## Deterministic-first behavior

A candidate decision can exist without a provider invocation. When owner policy already leaves one safe outcome, the adapter supplies a deterministic answer to the generic Jev gate. The resulting receipt records `JEV_SKIPPED`, and the owner proposal records `path: DETERMINISTIC`.

This is tested for all three domains:

- Lore exact duplicate / single legal Tree placement;
- Scene doorway with no real boundary / observed unambiguous location change;
- Retrieval stale-candidate elimination / HIGH-quality `NO_CORRECTION` / LOW-quality unresolved.

## Owner proposal contract

All proposals include domain, decision kind, proposed outcome, Jev receipt reference, source request fingerprint, owner, revision fence, stale state, abstain/unresolved/escalation state, deterministic/Jev path, evidence/option counts and bounded explanation.

Every proposal hard-codes:

```text
mutationAuthority: false
requiresOwnerPolicy: true
```

Provider identity and latency appear only as bounded provenance/advanced diagnostics.

## Abstention and escalation

ABSTAIN is successful bounded behavior, not a failure and not a default winner.

- Lore preserves classification as unresolved.
- Scene preserves current accepted Scene state.
- Retrieval/Truth prevents weak-evidence promotion.

Explicit Jev escalation becomes an owner concern. It does not perform Settlement.

## Freshness, replay and idempotency

Adapters validate decision ID, request fingerprint, canonical authority negatives and revision freshness before interpreting a receipt. Source/world/Scene/character plus domain revisions and freshness token remain fenced by the Wave 8 contract.

The adapter service keys proposal replay by adapter identity plus canonical Jev request fingerprint. Duplicate delivery of the same bounded request returns the same proposal and does not re-invoke the provider. Revision/evidence identity changes produce a different request fingerprint.

## Provider failure behavior

Wave 9 uses Wave 8 provider failure semantics. Provider unavailable, timeout and malformed output preserve safe owner behavior:

- Lore preserves ambiguity;
- Scene preserves accepted Scene state;
- Retrieval/Truth remains unresolved/degraded.

Provider failure cannot create domain facts.

## Runtime compatibility

Wave 9 does not implement Runtime. `JevDomainAdapterService.toRuntimeTask()` projects every domain request into the accepted generic shape:

```text
taskType: JEV_DECISION
requiredCapabilities:
  - SEMANTIC_JUDGMENT
```

No `LORE_DUPLICATE_DECISION` scheduler, Scene-specific worker or Truth-specific physical sidecar is introduced. One generic cognitive execution resource may run Jev and other compatible cognition.

## UI diagnostic read model

`diagnosticProjection()` exposes a bounded read-only view with domain, decision kind, deterministic/Jev path, status, outcome, abstain/unresolved/escalation, owner, evidence/option counts, stale state, receipt reference and concise explanation. Provider/latency is included only when `advanced: true`.

Raw evidence bodies and hidden reasoning are not copied into this projection.

## Telemetry

Per-domain/kind bounded metrics record decision count, deterministic skips, Jev invocations, abstentions, unresolved outcomes, escalations, stale rejections, adapter validation failures, replay count, total latency and provider IDs as execution provenance. Continuous telemetry does not copy evidence bodies.

## Cross-domain acceptance

One `JevDecisionCore` serves Lore, Scene and Retrieval/Truth. Each adapter returns a distinct owner proposal type. No domain has a privileged Jev core.

The Ember Tavern golden uses one shared world:

- disputed Sun Blade fate remains unresolved in Lore;
- ambiguous Eris/Tavern narration is handled as a bounded Scene boundary proposal;
- current destroyed-Tavern evidence remains temporally distinct from historical Blade-at-Tavern evidence;
- no receipt mutates another domain.

## Ownership matrix

| Domain | Adapter/Jev may propose | Adapter/Jev may NOT do |
|---|---|---|
| Lore | reconciliation classification, Tree placement proposal, retention rework | set SOURCE_CANON, delete UID, mutate Tree, merge source, settle conflict |
| Scene | boundary/cast/location/merge-split proposal | create Scene revision, promote mention to presence, promote inferred to observed, write Scene truth |
| Retrieval/Truth | finite semantic fallback/corrective proposal | set candidate authority, rewrite provenance, promote history to CURRENT, mutate Candidate Bus, write Context Seal, settle Truth |
| Jev kernel | bounded adjudication/abstain/escalate | canonical mutation or owner authority |

## Limited #212 corpus contribution

`JEV_WAVE9_CORPUS` records Wave 9 fixture classes for deterministic skip, ambiguous Lore, unresolved Lore contradiction, Scene boundary, stale Scene, Retrieval ambiguity, low-quality abstain, stale Retrieval and provider failure. This is a corpus contribution only; Wave 9 does not perform the full #212 benchmark/provider ranking/cost program.

## Known integration dependencies

Wave 9 does not claim owner-domain live integration, Settlement integration, #224 Live Brain Demo PASS, or full #212 completion. Those remain deliberate owner/main integration work.