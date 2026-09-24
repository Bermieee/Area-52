# Continuous Consolidation Worker — Phase 1 Production Architecture

**Owner:** Cognitive Coprocessor proposal cognition  
**Primary card:** #79  
**Canonical implementation:** \`src/coprocessor/continuous-consolidation.js\`  
**Execution orchestration:** \`src/coprocessor/cognitive-worker-pipelines.js\`

## Purpose

Continuous Consolidation is DEEP/background cognition over revisioned prior experience. It derives bounded semantic proposal bundles while raw narrative evidence remains independently recoverable and Memory retains durable ownership.

Production path:

\`\`\`text
revisioned SceneEpisode / Experience ArtifactReferences
 -> ConsolidationUnit
 -> createConsolidationTask
 -> bounded provider request
 -> provider-neutral SpecialistExecutionLayer
 -> strict bundle validation
 -> per-proposal dedupe / revision fencing
 -> checkpoint
 -> MemoryConsolidationProposalHandoff
 -> Memory owner review
\`\`\`

Consolidation proposes. It does not persist or settle Memory.

## Input architecture

Inputs are revisioned ArtifactReferences, not copied full conversations.

A unit retains:
- artifact identity/type/revision;
- owning/storage domain where supplied;
- sourceRevisionSet;
- world/scene/character-state revisions;
- resumeIdentity;
- provenance;
- policy version;
- deterministic lineage and dedupe identity.

Provider input may include bounded artifact slices/excerpts and structured facts. Whole conversation/all Memory/all Lore are excluded by the shared provider-payload boundary.

## Execution class

Default:
- placement: DEEP;
- cognitive layer: L3;
- result class: DEFERRED;
- required capabilities: CONSOLIDATION + COMPRESSION;
- optional capabilities: REFLECTION, STRUCTURED_EXTRACTION, DEEP_REASONING;
- yield safety: CHECKPOINT_ONLY;
- partial-result semantics: preserve valid slices.

Worker 2 defines task/batch/checkpoint semantics. Runtime owns scheduling, preemption, Resource Governor, Work Ledger and actual execution timing.

## Proposal bundle

One bounded slice may emit multiple \`ConsolidationProposal\` entries inside a \`ConsolidationProposalBundle\`.

Supported proposal families:
- EPISODE_SUMMARY;
- CLAIM_CANDIDATE;
- RELATIONSHIP_UPDATE;
- REFLECTION_EVIDENCE;
- STATE_CHANGE_PROPOSAL;
- COMPRESSED_REPRESENTATION;
- CROSS_EPISODE_LINK.

Every proposal has its own:
- proposalId;
- semanticIdentity;
- source ArtifactReferences;
- source revisions;
- supporting/contradicting refs;
- provenance;
- confidence;
- authority;
- temporal metadata where applicable.

There is no bundle-level confidence copied onto every claim.

## Episode derivation

Episode proposals may preserve supplied:
- participants;
- location;
- time;
- salient events;
- unresolved outcomes;
- source ranges;
- chronology;
- authority class.

Missing details are not invented merely to create a cleaner summary. Raw evidence remains recoverable.

## Atomic claims

Claim proposals may retain:
- subject/entity ref;
- predicate/relation;
- object/value;
- temporal applicability;
- observation/authority class;
- confidence;
- supporting and contradicting refs;
- source revisions.

Semantic confidence never grants settlement.

## Relationship and state proposals

Relationship, possession, location, status and other state changes follow:

\`\`\`text
proposal
 -> validation
 -> owner review
 -> possible Settlement
\`\`\`

They never directly mutate canonical state.

## Reflection evidence

Reflection evidence distinguishes direct observations, repeated patterns, inferred interpretations, contradicting evidence and uncertainty.

Repeated evidence justifies consideration, not canonization. No observation-count threshold grants authority.

## Causal / hypothesis seam

Temporal adjacency is not causality. Multiple unresolved hypotheses remain representable.

A provider cannot claim CERTAIN causality without explicit direct-causal evidence references, and the Coprocessor does not pick a winner merely from model confidence.

## Dedupe and lineage

Proposal identity includes:
- source artifact/revision;
- proposal kind;
- semantic identity;
- consolidation policy version.

Replay of the same source/revision does not multiply equivalent proposals.

A changed source revision creates new derivation lineage; old lineage is superseded rather than overwritten.

## Revision invalidation

Queued/executing/checkpointed work is fenced by source/world/scene/character-state revisions.

Changed evidence causes affected work to become stale and require replanning. Unrelated valid proposals/units remain independently usable.

## Checkpoint / yield / resume

\`ConsolidationCheckpoint\` records:
- unit and resume identity;
- lineage/policy version;
- completed ArtifactReferences;
- completed proposal IDs;
- remaining ArtifactReferences;
- next offset;
- revision fence.

Same revision -> RESUME_FROM_CHECKPOINT.  
Changed revision -> INVALIDATE_AND_REPLAN.

A valid completed slice may survive failure of a sibling slice where batch semantics permit.

## Bounded backlog

\`ConsolidationBacklog\` is a bounded Sidecar-local cognition backlog, not a second Work Ledger.

It provides:
- deterministic priority ordering;
- unit dedupe;
- stale/superseded/complete states;
- checkpoint/resume state;
- capacity bounds;
- export/import for deterministic restart behavior.

Runtime remains the durable scheduling/Work Ledger owner.

## Memory owner handoff

\`MemoryConsolidationProposalHandoff\` contains compact:
- proposal refs/kinds/semantic identities;
- source ArtifactReferences;
- provenance refs;
- revision fence;
- validation receipt;
- uncertainty/contradiction metadata.

It explicitly carries:
- \`memoryPersistence:false\`;
- \`temporalSettlement:false\`;
- \`reflectionAdmission:false\`;
- \`sourceDeletion:false\`.

Memory owns Experience storage, durable Memory, Temporal State, Reflection admission, reconsolidation and canonical memory truth.

## Authority negatives

Permanent validation rejects:
- SETTLED or SOURCE_CANON consolidation authority;
- direct Memory mutation;
- source deletion;
- HISTORICAL -> CURRENT promotion;
- unsupported causal certainty;
- unknown source ArtifactReferences;
- stale revisions;
- duplicate proposal multiplication.

Models propose. Owners settle.
