# Jev Decision-Site and Turn-Receipt Inventory

## Scope and evidence labels

Jev is an optional bounded adviser. The native Brain path remains valid with no Jev, Sidecar, Vectoring, remote provider, external database, or orchestration service. Domain owners retain Truth, Settlement, canonical mutation, and Context Seal authority.

Execution-state labels in this inventory are intentionally strict:

- **CONTRACT_ONLY** — finite Jev options/owner boundary can be described, but the rebuilding subsystem does not expose a real owner contract in this wave.
- **OWNER_WIRED** — a production adapter plus explicit owner-admission contract exists and is covered by deterministic runtime tests.
- **LIVE_OBSERVED** — reserved for an actually observed operator-configured external-provider/installed-host path. No site in this wave is promoted to this state.

Evidence classes are separate from execution state. CI fixtures are **LOCAL_DETERMINISTIC** or injected failure evidence; they are not OpenRouter or installed SillyTavern acceptance.

## Canonical owner flow

```text
owner ambiguity
 -> deterministic owner precheck
 -> finite JevDecisionRequest + revision/evidence fence
 -> Jev invocation gate
 -> optional physical provider execution
 -> JevDecisionReceipt
 -> typed owner proposal (no authority)
 -> adjudicateJevForOwner()
 -> explicit owner ACCEPTED / REJECTED / UNRESOLVED / DEFERRED
 -> owner alone may perform any allowed Settlement/mutation
```

Freshness is checked before execution, after provider execution, on Decision Core replay, and again before an adapter accepts a receipt. Proposal replay is also rechecked against the current revision state and generation seal. A post-seal or stale proposal is rejected before owner review.

## Existing decision sites

| Site | Owner | Trigger / finite options | Evidence + revision fence | Deterministic precheck | Invocation / cost | Outcome + admission | Fallback | State / evidence | Code |
|---|---|---|---|---|---|---|---|---|---|
| `LORE_TREE_PLACEMENT` | Lore owner | Ambiguous legal Tree placement; owner supplies 1–16 placements | compact evidence refs; source/world/Scene/character + lore/owner revisions + freshness token | protected/illegal placements removed; explicit or single surviving placement skips Jev | semantic-judgment provider only after ambiguity gate; receipt records attempts, latency/cost class when known | `LoreDecisionProposal` then explicit owner review; Jev cannot mutate Tree | unresolved/preserve Lore state | **OWNER_WIRED**, LOCAL_DETERMINISTIC | `jev-lore-adapter.js`, `owner-integration.js` |
| `LORE_RECONCILIATION` | Lore owner | duplicate/overlap/complementary/temporal/contradictory/related/unresolved | same Lore fence; compact UID/source evidence refs | exact duplicate, explicit outcome, or one survivor skips | same bounded provider path | `LoreReconciliationProposal`; SOURCE_CANON/UID merge/Settlement remain owner-only | unresolved | **OWNER_WIRED**, LOCAL_DETERMINISTIC | same |
| `LORE_RETENTION_REVIEW` | Lore owner | `PASS`, `REWORK_REQUIRED`, `UNRESOLVED` | representation refs + Lore revision fence | required contribution missing deterministically proposes rework | provider only for remaining bounded ambiguity | proposal only; cannot rewrite authored/source Lore | unresolved / preserve representation | **OWNER_WIRED**, LOCAL_DETERMINISTIC | same |
| `SCENE_BOUNDARY` | Scene owner | continue/open/resume/unresolved | Scene evidence refs; source/world/Scene/character + scene/owner revisions | doorway-only continuation and observed unambiguous location boundary skip Jev | bounded semantic provider | `SceneDecisionProposal` then owner admission | preserve accepted Scene | **OWNER_WIRED**, LOCAL_DETERMINISTIC | `jev-scene-adapter.js` |
| `SCENE_CAST_LOCATION_CONFLICT` | Scene owner | finite owner-supplied cast/location interpretations | same Scene fence | mention-only/presence and inferred/observed upgrades are hard-rejected | provider sees only surviving finite options | owner proposal cannot create Scene revision or truth | unresolved / preserve accepted state | **OWNER_WIRED**, LOCAL_DETERMINISTIC | same |
| `SCENE_MERGE_SPLIT_REVIEW` | Scene owner | finite merge/split/keep alternatives supplied by owner | same Scene fence | illegal semantic upgrades removed; single survivor skips | bounded provider | owner retains merge/split/revision authority | unresolved | **OWNER_WIRED**, LOCAL_DETERMINISTIC | same |
| `RETRIEVAL_CANDIDATE_INTERPRETATION` | Retrieval/Truth owner | finite candidate interpretations | candidate refs; source/world/Scene/character + candidate-set/truth-owner revisions | stale/illegal/authority-upgrading candidates removed; single survivor skips | provider only if safe ambiguity remains | `RetrievalTruthDecisionProposal`; no candidate/Truth authority | unresolved | **OWNER_WIRED**, LOCAL_DETERMINISTIC | `jev-retrieval-truth-adapter.js` |
| `RETRIEVAL_CORRECTIVE_CHOICE` | Retrieval/Truth owner | `NO_CORRECTION`, sparse/dense/graph retry, abstain | retrieval quality/corrective-attempt metadata + candidate-set fence | HIGH quality can choose no correction; LOW evidence fails safe | at most owner-bounded correction ambiguity; cost/latency metadata only | owner decides whether corrective route is admitted | unresolved/abstain | **OWNER_WIRED**, LOCAL_DETERMINISTIC | same |
| `TRUTH_SEMANTIC_AMBIGUITY` | Retrieval/Truth owner | support A/B, preserve unresolved, abstain/escalate or other owner-supplied finite set | candidate evidence/provenance + candidate-set/truth-owner fence | historical-to-current, provenance rewrite, or authority claims are hard-rejected | bounded provider | Jev cannot settle Truth or write Context Seal | unresolved | **OWNER_WIRED**, LOCAL_DETERMINISTIC | same |
| `MEMORY_KNOWLEDGE_BELIEF_CLASSIFICATION` | Memory owner | known/believed/false-belief/uncertain/unresolved | Memory evidence + source/world/Scene/character + memory/owner revisions | illegal durable/truth/Settlement upgrades rejected; character knowledge scope enforced | provider only for remaining ambiguity | `MemoryDecisionProposal`; explicit owner review required | unresolved | **OWNER_WIRED**, LOCAL_DETERMINISTIC | `jev-memory-temporal-adapter.js` |
| `MEMORY_CONSOLIDATION_REVIEW` | Memory owner | accept/reject/rework/unresolved proposal | same Memory fence | illegal durable mutation, Truth claim, Settlement bypass removed | bounded provider | Jev never settles Memory; owner may accept/reject proposal | unresolved/rework | **OWNER_WIRED**, LOCAL_DETERMINISTIC | same |
| `TEMPORAL_TRANSITION_CONTRADICTION` | Temporal owner | transition/contradiction/temporally-distinct/unresolved | temporal evidence + source/world/Scene/character + temporal/owner revisions | authority/provenance/history-upgrade options rejected; single survivor skips | bounded provider | `TemporalDecisionProposal`; owner retains revision/Settlement | unresolved | **OWNER_WIRED**, LOCAL_DETERMINISTIC | same |

No row above is **LIVE_OBSERVED** in this wave. Default CI does not convert deterministic fixtures into an OpenRouter or installed SillyTavern claim.

## Turn cognitive receipt — producer/read-model contract

`adjudicateJevForOwner()` now attaches one metadata-only `JevTurnCognitiveReceipt` to each owner admission receipt. It is the producer contract for Workers 1, 3, and 4.

The receipt exposes only:

- selection identity: `chatId` when supplied, `turnId`, `generationId` when supplied, `correlationId`, `taskId`, `decisionId`;
- bounded decision identity: domain, decision kind, deterministic/Jev/degraded path, service status and proposed outcome;
- invocation state: `INVOKED`, `SKIPPED_DETERMINISTIC`, `ABSTAINED`, `UNAVAILABLE`, `REPLAY`, or `NOT_INVOKED`;
- bounded reason codes;
- provider attempts and physical-execution attempted/succeeded booleans;
- optional provider/resource/model IDs plus measurement, latency, and cost classes/status;
- per-turn latency;
- stale/post-seal flags;
- owner-review invoked, owner decision, and owner-accepted fields;
- hard false authority flags for mutation, Truth, Settlement, and Context Seal.

It never carries raw prompts, messages, Lore text, full evidence bodies, credentials, API keys, or hidden reasoning.

`createCognitionUiReadModelReader()` whitelists that receipt into `jevDecisions[]`. Worker 3 should read this projection rather than infer execution from configuration. Worker 4 may aggregate/plot these fields without needing content. Worker 1 may use the owner-admission fields as evidence that a proposal was explicitly accepted; the receipt itself grants no Brain or owner authority.

## Replay and seal behavior

A replayed proposal increments replay evidence but performs zero new provider attempts. The per-turn receipt reports `invocation:"REPLAY"` and `physicalExecutionAttempted:false`. A provider result that becomes late after generation seal is marked post-seal and is rejected before owner review. Revision-stale proposals are likewise rejected before review.

The historical #211 replay regressions are permanently covered by `tests/worker4-jev211-repro.test.mjs`: Decision Core replay rechecks seal, adapter replay rechecks current revision, in-flight late results route out of the foreground, and both replay caches have bounded eviction.

## Rebuild candidates named in the Area-52 assignment

The assignment says “six” rebuild cards but enumerates five Jev candidates. This inventory records the five named sites and does not fabricate an unnamed sixth.

| Candidate site | Proposed owner | Finite Jev option set | Boundary | Current state |
|---|---|---|---|---|
| story-scope suggestion | Brain/story-scope owner (Worker 1 surface) | `KEEP_SCOPE`, `EXPAND_SCOPE`, `NARROW_SCOPE`, `UNRESOLVED` | adviser may suggest scope only; no story access or final prompt choice | **CONTRACT_ONLY** |
| lore-proposal comparison | Lore owner | `PREFER_A`, `PREFER_B`, `PRESERVE_BOTH`, `REJECT_ALL`, `UNRESOLVED` | no authored-Lore edit, merge, delete, or SOURCE_CANON write | **CONTRACT_ONLY** for rebuild integration |
| adaptive tree placement | Lore owner | owner-supplied candidate node IDs + `KEEP_CURRENT` + `UNRESOLVED` | generic `LORE_TREE_PLACEMENT` contract exists, but the rebuilding adaptive-tree subsystem is not claimed wired here | **CONTRACT_ONLY** for rebuild integration |
| context-retirement risk review | Context/Brain owner | `KEEP_HOT`, `RETIRE_TO_DEEP`, `DEFER`, `UNRESOLVED` | cannot retire active dialogue or alter a sealed packet | **CONTRACT_ONLY** |
| prompt-presentation advice | Prompt/Brain owner | `PRESENT_FULL`, `PRESENT_COMPRESSED`, `OMIT_OPTIONAL`, `UNRESOLVED` | presentation advice only; Worker 1 prompt contract remains authoritative | **CONTRACT_ONLY** |

## #124 and #88 gaps found by this audit

The audit found one real #124 adapter gap: `negotiateCapabilities()` already computed constraint failures, but `createRuntimeCapabilityAdmission()` discarded them. The Runtime admission receipt now preserves requested capabilities, missing capabilities, incompatibilities, constraint failures, missing requirements, and optional capability availability without granting scheduling authority.

The audit also repaired a read-model evidence merge used by the receipt card: an explicit resource snapshot value of `physicalExecutionAttempted:false` could mask a matching selected-turn `RESOURCE_EXECUTION` event. Positive execution evidence is now merged monotonically. No new #88 Hot/Deep scheduling policy is introduced by this wave.
