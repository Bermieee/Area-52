# UI.Core Wave 8 — Live Brain Cognition Workspace

## Purpose

Wave 8 turns the accepted Brain workspace, Brain Pulse, Generation Explainability, and Cognitive Forensics into one operator-visible cognition flow.

The product question is:

> What did the Brain choose to do, what evidence did it find, what did it reject or preserve as unresolved, and what actually reached this generation?

Wave 8 is observational. It does not own Cognitive Choice policy, Candidate Bus fusion, retrieval-quality evaluation, Truth classification, Jev adjudication, Precision routing, Gather admission, Settlement, or Context Seal semantics.

## Product location

Wave 8 extends the existing `brain` workspace inside the existing ApplicationShell.

It does not create:

- a second root application;
- a second Brain app;
- a second Inspector;
- a second Action Router;
- a second Signal Hub;
- a second Render Scheduler;
- a separate Jev UI;
- a host chat surface.

SillyTavern/host conversation remains host-owned.

## Cognitive pipeline

The normalized operator path is:

~~~text
Scene
  -> Cognitive Choice
  -> Scatter
  -> Sensory / Candidate Bus
  -> Retrieval Quality
  -> Truth
  -> optional Jev
  -> Precision
  -> Gather
  -> Context Seal
  -> PromptPlan
~~~

Each stage may be:

- ACTIVE
- COMPLETE
- SKIPPED
- DEFERRED
- UNAVAILABLE
- DEGRADED
- STALE
- INVALID
- FAILED

A stage is never shown as COMPLETE merely because the architecture contains it.

A stage is shown as SKIPPED only when an owning receipt/decision explicitly records the skip. Missing data remains UNAVAILABLE.

## Production adapter

`Wave8CognitionProductionAdapter` consumes optional read-only producers.

Supported bindings:

- `readHotCognitionReadModel`
- `readCognitiveChoiceReceipt`
- `readScatterReceipt`
- `readSensoryTrace`
- `readCandidateBusEnvelope`
- `readCandidateFusionReceipt`
- `readTruthAssessment`
- `readCorrectiveRetrievalReceipt`
- `readJevDecisionReceipt`
- `readPrecisionReceipt`
- `readGatherReceipt`
- `readContextSealReceipt`
- `readLoreStatus`
- `subscribe`

Scene and PromptPlan continue through their accepted Wave 6/7 adapters.

`createWave8ProductionBindings()` validates optional function shape and composes the accepted Wave 7 binding seam.

## Current real contracts

The current Core reference lane already exposes production-compatible contracts for:

- `CandidateBusEnvelope`
- `CandidateFusionReceipt`
- `TruthAssessment`
- `CorrectiveRetrievalRequest`
- `PrecisionResult`
- `ContextSealReceipt`
- `PromptPlanReadModel`
- `ContextReceiptReadModel`
- `ForensicReadModel`
- `HotCognitionReadModel`
- `SceneUiReadModel` on the Scene lane

Worker 1 and Worker 2 subsequently landed the canonical Wave-8 contracts on their own read-only reference branches. The UI lane consumes those contracts by shape without copying their production implementations:

- Worker 1 Core reference: `CognitiveChoiceReceipt` contract v1.0.0 from `Development-Nexus`.
- Worker 2 Coprocessor reference: `JevDecisionReceipt` contract v1.0.0 from `Development-Sidecar/Jev`.

Focused acceptance fixtures are contract-shaped from those canonical definitions. They prove normalization and presentation behavior, including Core summary-only cognition and Jev service states, but they are still FIXTURE evidence on the UI branch. The owning producers are not assembled into `Development-UI`, so production still reports UNAVAILABLE unless Integration supplies the optional live readers.

The same rule applies to assembled Gather/Lore-status producers where a canonical read receipt is not yet bound.

## Normal / Detail / Advanced

### NORMAL

Normal answers:

- what Scene is active;
- what the Brain chose;
- admitted / skipped / deferred job counts;
- Sensory nomination -> unique count;
- retrieval HIGH / MIXED / LOW;
- Truth category counts;
- Jev invoked/skipped/unavailable and outcome;
- Gather admitted/stale/late/rejected counts;
- whether context is SEALED;
- PromptPlan contribution.

Provider/model IDs do not lead the view.

### DETAIL

Detail adds:

- candidate cognitive jobs;
- recorded admission/skip/defer reasons;
- Sensory per-channel counts;
- Candidate Bus duplicate removal;
- retrieval-quality reason;
- one bounded corrective pass where recorded;
- Truth evidence categories;
- Jev outcome/evidence summary;
- Precision used/skipped;
- Gather dispositions and reasons;
- stale/late/invalid containment.

### ADVANCED

Advanced may show:

- turn/generation/correlation identity;
- resource/provider/model identity;
- source/world/scene revisions;
- candidate IDs/rank signals/graph metadata;
- Jev option IDs/evidence/reason codes/unresolved factors;
- Precision score/rank metadata;
- Gather result IDs;
- Context Seal / PromptPlan IDs;
- links into existing Forensics.

No hidden chain-of-thought is rendered.

## Job admission and scatter

Logical cognition is primary:

- Historian
- Graph reasoning
- Truth verification
- Green Room
- Jev
- Precision

Physical execution resource is secondary and appears in Advanced.

One resource executing several jobs is normal. Multiple resources improve concurrency but do not redefine cognition.

SKIPPED and DEFERRED are valid policy outcomes, not failures.

## Sensory Net

Wave 8 consumes Candidate Bus/Sensory receipts.

Normal:

~~~text
18 nominations -> 7 unique
~~~

Detail can show per-channel counts and duplicate removal.

Advanced can show evidence identity, channels, graph metadata, source revisions, rank signals and bounded representation text.

Permanent rule:

> channel count / fusion rank / retrieval score are retrieval metadata, not authority.

## Retrieval Quality

The UI preserves Core's:

- HIGH — retrieval sufficient;
- MIXED — useful but incomplete/conflicting;
- LOW — no useful long-term-memory contribution.

LOW is not an error.

For MIXED, a corrective pass appears only if a real request/receipt says it occurred. The UI does not invent or recurse correction.

## Truth

Truth remains:

- CURRENT
- HISTORICAL
- SUPERSEDED
- CONTRADICTED
- UNCERTAIN
- UNRESOLVED

Retrieval rank does not alter Truth.

The Ember Tavern / Sun Blade fixture demonstrates:

- historical: Sun Blade was left at Ember Tavern;
- current: Ember Tavern destroyed;
- current Sun Blade location unknown;
- competing destroyed-vs-removed evidence;
- UNRESOLVED preserved.

## Jev

Jev is optional cognition.

Visible outcomes include:

- DECIDED
- PARTIAL
- UNRESOLVED
- ABSTAINED
- ESCALATE_OWNER
- REQUEST_OPERATOR
- STALE
- INVALID

An explicit Choice receipt may also prove Jev was SKIPPED.

Jev does not grant authority. Confidence is metadata only. A selected option is not CANON merely because Jev selected it.

Owner Settlement remains separate.

## Precision

Precision presentation states whether reranking ran or was explicitly skipped.

Scores/ranks remain ordering metadata. They are never authority.

Stale Precision remains visibly stale and cannot be presented as current contribution.

## Gather

Gather is the clearest contribution boundary before Seal.

Rows are normalized as:

- ADMITTED
- STALE
- LATE
- REJECTED
- INVALID

Late/stale/invalid/rejected rows are not generation contributors.

A late foreground result may be visible as routed forward for future cognition, but it cannot appear among this generation's admitted evidence.

## Context Seal / PromptPlan

Context Seal remains the immutable publication boundary.

Wave 8 links:

~~~text
cognitive evidence -> Gather -> Context Seal -> PromptPlan -> Why This Generation?
~~~

Wave 7 explainability and forensics are reused rather than duplicated.

## Scene and Lore

Scene consumes `SceneUiReadModel`.

Missing Scene producer displays:

~~~text
Scene Intelligence unavailable
~~~

Lore status is optional and only reports learned/index state when an owning producer supplies it. A lorebook file existing is not evidence that learned representations are ready.

## Live / fixture / unavailable

Production and fixture are permanently distinct:

- LIVE — real producer/read model;
- DEGRADED — real producer with contained read/health failure;
- UNAVAILABLE — no producer/read model;
- FIXTURE — deterministic test/demo data.

Fixture mode is explicit both at adapter source and inside the normalized cognition path.

Fixture data never masquerades as LIVE.

## Degraded semantics

The UI distinguishes:

- UNAVAILABLE
- DEGRADED
- STALE
- LATE
- INVALID
- ABSTAINED
- UNRESOLVED

Safe containment is not rendered as catastrophic failure.

Examples:

- LOW retrieval can continue from Hot/current state;
- Jev unavailable may preserve UNRESOLVED;
- stale Scene result is excluded;
- late Green Room result can route to NEXT_TURN;
- invalid structured output is not admitted.

## Live updates and performance

Wave 8 reuses the existing Signal/Render Scheduler path.

One optional cognition subscription invalidates a stable `wave8:cognition-refresh` render key.

Large Scatter/Sensory/Gather collections use UI.Core virtualization.

Deep diagnostics remain on-demand.

## Lifecycle

Destroy releases:

- cognition subscription;
- Wave 8 Inspector render listeners;
- Wave 8 Action Router registrations;
- workspace scope;
- virtual lists;
- existing shell/Signal/Scheduler resources.

Persisted state remains presentation identity only; cognitive payloads are not persisted.
