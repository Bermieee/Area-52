# Coprocessor Cognitive Choice Contribution Contract

## Purpose

Wave 13 gives the Coprocessor a bounded, replayable explanation of what cognition was worth considering and what execution actually happened. It does **not** create a second Brain controller.

The authoritative per-turn `CognitiveChoiceReceipt` remains Core-owned on `Development-Nexus`. Candidate Bus admission, retrieval-quality policy, Truth, corrective retrieval approval, Precision, final generation-facing evidence and Context Seal remain owner-stage decisions.

## Read-only owner contracts inspected

Wave 13 was shaped against these live heads:

- Core / integration: `Development-Nexus@ba4619f56db8e4f94873256dc26589e1680b7d29`
- Runtime Fabric: `Development-Worker-Director@d7128397f0d432c4d6e088d9d2c5e8f8ac0aed3a`
- Scene: `Development-Scene-Scanner@3aaf1c1e9e7e8703dc8c66c5542efb03cc9873cf`
- Memory: `Development-Memory@7973bb7670b1c53809379491875aa0963b20b0e1`
- UI: `Development-UI@828e619f97f5b23597ea3354b4e6cd5fd1917f99`
- Worker 4 replay repair reference: `Development-Repair-Validation@54fe8cff459c184a8a47f9e1c75bf7a7f963a58b`

There is no branch literally named `Development-Runtime`; the live Runtime Fabric owner lane is `Development-Worker-Director`.

## CoprocessorChoiceProposal

`DynamicFanOutPlanner.planChoice()` wraps the existing `plan()` without changing the old fan-out semantics.

A proposal records **every bounded option considered**, not just work selected for execution. Current options include:

- Historian
- Graph Walker
- Green Room
- Truth/Precision worker
- Consolidation
- owner-gated corrective retrieval
- owner-gated Jev adjudication
- policy-gated external grounding

Each `CoprocessorChoiceOption` carries:

- logical capability and task type;
- required capabilities;
- registered and currently eligible provider-profile IDs;
- evidence-reference IDs only;
- source/world/Scene/character/intent/policy/provider revision fence;
- expected value;
- estimated latency and cost, labeled as estimates;
- deadline/result class;
- typed `NOMINATED`, `SKIPPED`, `DEFERRED` or `UNAVAILABLE` disposition;
- typed reason codes;
- task ID when the Coprocessor already owns a materialized task;
- physical execution hint;
- fallback contract;
- no authority.

A hot-sufficient turn may nominate zero optional functions. A skipped role remains present in the option inventory.

## Capability reality wins over nomination

The proposal rechecks current capability profile availability, provider health and load. If the fan-out plan previously nominated a role but the current capability inventory says its required capability is absent/unavailable/unhealthy/overloaded, the contribution reports `UNAVAILABLE` rather than fabricated executable success.

This does not cancel or reschedule the owner Runtime task. It is an execution-readiness fact for Core.

## Resource semantics

`resourceCount` changes only the physical hint:

- one resource -> `SERIALIZE_ON_AVAILABLE_RESOURCE`
- several resources -> `PARALLEL_ELIGIBLE`

Semantic option disposition/reasoning stays the same for the same evidence, policy and capability state. Runtime remains responsible for actual scheduling, leases, foreground reserve, yielding and deadlines.

## Owner-gated options

### Corrective retrieval

The Coprocessor can report that Core requested a corrective pass and that a registered retrieval capability is available. It cannot execute the correction merely because retrieval quality is MIXED.

The contract records attempt/max-attempt metadata and refuses to nominate another correction at the configured one-pass limit.

### Jev

Jev is nominated only when an owner-stage deterministic gate reports a bounded `INVOKE_JEV` question. The proposal retains:

- question/request ID;
- decision shape;
- bounded option IDs;
- evidence IDs;
- a hash of any question text.

Raw Jev question/prompt text is not retained in continuous choice telemetry.

Jev remains proposal-only. It cannot Settle world state, turn confidence into truth, or replace Core Truth classification. Abstention and UNRESOLVED are valid outcomes.

### External grounding

External grounding is skipped unless explicit owner policy allows it **and** the current turn indicates it is needed.

## CoprocessorChoiceExecutionTrace

The execution trace joins proposal identity to observed facts using either:

1. materialized `taskId`; or
2. stable `choiceOptionId` / `optionId` after Core admits an owner-gated option.

States are bounded and typed:

`NOT_ADMITTED`, `RUNTIME_ADMITTED`, `STARTED`, `COMPLETED`, `SKIPPED`, `DEFERRED`, `UNAVAILABLE`, `ABORTED`, `TIMED_OUT`, `FAILED`, `STALE`, `INVALID`, `LATE`.

Logical capability and physical resource/provider IDs are separate fields.

Late, stale and invalid facts remain diagnostic. They do not gain admission or Seal authority.

## Warm packet boundary

Warm freshness is a hint only.

A FRESH warm packet is never an admission result in this contract and is never counted as useful unless a later observation explicitly says `coreRevalidated: true`. Warm preparation cost and saved Send latency are separate fields.

## Core adapter

`toCoreCognitiveChoiceContribution()` exposes only proposal/execution facts.

It explicitly does **not** fabricate:

- `CognitiveChoiceReceipt`;
- Truth class;
- Precision decision;
- corrective execution authority;
- final evidence references;
- Candidate Bus admission;
- Settlement;
- Context Seal.

Core must combine the contribution with its own:

1. retrieval-quality receipt;
2. Candidate Bus fusion receipt;
3. Truth assessment;
4. corrective-retrieval receipt;
5. Precision receipt;
6. Gather receipt;
7. Context Seal receipt.

Only then can Core publish #225's final `CognitiveChoiceReceipt`.

## UI binding

The current UI Wave 11 live binding already uses subscription-driven coherent owner receipts and reads Core's final `CognitiveChoiceReceipt`.

Wave 13 does not add UI polling or fixture fallback. Assembly may either:

- include the Coprocessor contribution inside Core's final receipt/execution-plan detail; or
- add a dedicated coherent `readCoprocessorChoiceContribution` reader on the UI owner lane.

The UI owner must continue enforcing turn/correlation/world/Scene/source revision coherence.

## Remaining assembly seams

- **Core:** no live adapter currently consumes `CoprocessorChoiceContribution` into the final #225 receipt.
- **Runtime:** when Core admits corrective/Jev/external owner-gated work, the materialized Runtime job must preserve the stable `choiceOptionId` so outcomes rejoin this trace.
- **Scene:** existing Scene-to-planner inputs exist, but no assembled lifecycle currently proves a live Scene signal driving this choice proposal in the #224 Brain.
- **Memory:** Historian urgency/proposal is wired to the Coprocessor contract, but live Memory retrieval remains independently owner-fenced.
- **UI:** final Core receipt binding exists; a dedicated Coprocessor-contribution reader is not yet present.
