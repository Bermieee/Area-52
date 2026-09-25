# Historian Retrieval Worker — Phase 1 Wave 7

## Purpose

The Historian is the Coprocessor's production HOT/L1 retrieval-cognition worker for long-range roleplay history. It retrieves and nominates Memory-owned historical evidence; it does not persist Memory, settle truth, or inject context directly.

Canonical implementation: `src/coprocessor/historian-retrieval.js`.

## Execution path

```text
TURN_EVENT / Scene-owned retrieval intent
 -> createHistorianTask
 -> HistorianMemoryRequest
 -> Memory-owned resolver seam
 -> bounded ArtifactReference nominations
 -> provider-neutral SpecialistExecutionLayer
 -> strict Historian validation
 -> Candidate Bus-compatible nominations
 -> adaptive retrieval quality
 -> Truth / Precision corridor
 -> Gather
```

## Task contract

The task carries where available:
- turn/task/correlation/causation IDs;
- retrieval intents and active entities/threads;
- location/Scene refs;
- temporal and perspective constraints;
- source/world/Scene/Character-State/Memory revisions;
- intent fingerprint;
- result class/deadlines;
- explicit caps for artifacts, episodes, Reflections, provider candidates and evidence bytes.

Historian is HOT/L1 only over already-derived/retrievable evidence. It does not perform Reflection synthesis, consolidation, graph construction, cold embedding, or large-scale reconstruction in the foreground.

## Retrieval modes

Supported modes:
- CONTINUITY_RECALL;
- EXPLICIT_HISTORY;
- RELATIONSHIP_HISTORY;
- EVENT_CAUSAL_RECALL;
- REFLECTION_RECALL.

Historical evidence remains historical. Reflection artifacts are forced to INFERRED unless an owner already supplies an independently settled underlying fact.

## Memory resolver seam

`HistorianMemoryResolver` is storage-neutral. It consumes `HistorianMemoryRequest` and returns bounded, reference-first evidence.

Potential owner channels include SceneEpisode, Experience, episodic memory, relationship/event memory, durable Reflection, causal/event memory, unresolved hypotheses and historical-state references.

Worker 2 does not implement those stores.

Unknown provider nominations fail closed. Memory revision mismatches fail stale. Artifact revision/retirement changes are rejected at the freshness fence.

## Perspective fences

Supported perspective vocabulary includes WORLD, CHARACTER_KNOWLEDGE, OBSERVED_BY, HEARD_FROM, BELIEVED, UNCERTAIN and FALSE_BELIEF.

A character-perspective request cannot silently consume WORLD-only evidence. If the Memory owner cannot provide the requested boundary, `PERSPECTIVE_UNAVAILABLE` is a valid abstaining result.

## Ranking signals

Historian preserves independent retrieval metadata such as:
- intent match;
- entity/thread/event/location overlap;
- relationship relevance;
- temporal fit;
- continuity;
- significance;
- recency;
- perspective compatibility;
- provenance quality.

No ranking signal grants epistemic authority.

```text
recency != truth
similarity != identity
rank != authority
confidence != canon
retrieval frequency != settlement
```

## Candidate output

Historian nominations preserve where supplied:
- candidate/artifact identity and revision;
- source revisions;
- entity/relationship/event/claim refs;
- retrieval-intent IDs;
- channel and rank signals;
- temporal hints;
- owner-supplied authority/truth hints;
- provenance/evidence refs;
- freshness/dependency revisions;
- perspective metadata.

The Candidate Bus remains globally owned outside Worker 2. Wave 7 only extends the local compatibility contract needed to preserve these optional fields.

## Dynamic urgency

Historian can be:
- REQUIRED when generation materially depends on prior experience;
- OPPORTUNISTIC when history can enrich but is not necessary;
- skipped when hot state/warm state already satisfies the turn or no historical value is expected.

Physical/current-state turns may nominate Historian opportunistically; explicit/history-dependent turns become required. No physical sidecar identity is encoded in the task.

## Failure / late behavior

Memory/provider failure degrades recall without fabricating evidence. Perspective-unavailable may abstain. Stale results are rejected. Post-Seal results route NEXT_TURN/background and cannot mutate the active generation.

## Ownership

Worker 2 owns Historian cognitive-task construction, bounded resolver/request contracts, provider-neutral execution, validation, ranking/nominations, perspective fencing, revision safety and degradation behavior.

Memory owns persistence, Experience/SceneEpisode stores, durable Reflection, Temporal State, Character Memory, causal/event truth, Memory admission and reconsolidation.
