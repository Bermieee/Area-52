# Candidate Bus Contract

## Canonical candidate

`CanonicalRetrievalCandidate` retains:

- candidate ID and deterministic evidence identity;
- artifact ref/revision and source revision refs;
- claim/event/entity/relationship refs;
- retrieval intent IDs;
- preserved channel nominations;
- channel-specific raw rank signals;
- graph metadata, temporal hints and continuity signals;
- owner authority and truth-status hint;
- provenance/evidence/dependency refs;
- freshness;
- representation ref/revision and bounded representation text;
- bounded metadata.

It always carries:

```text
authorityGranted: false
admissionAuthority: false
settlementAuthority: false
canonicalMutationAuthority: false
```

## Evidence identity

Evidence identity is finer than source identity.

Claim-backed evidence is identified from the claim identity plus stable owner artifact/semantic identity, not the storage adapter or retrieval representation. Event and relationship evidence follow the same rule.

This means:

- sparse + dense + graph nomination of one claim can dedupe;
- two different claims in one lore source remain different;
- backend A -> backend B does not change the semantic candidate identity;
- representation revisions remain provenance/freshness data, not semantic identity.

## Fusion

Fusion is deterministic and order-independent for equivalent nomination sets.

Exact replayed nominations are idempotent and increment duplicate diagnostics without multiplying evidence.

Cross-channel duplicates collapse to one candidate while keeping independent `channelNominations[]`. Raw BM25-like, cosine, graph path/distance, Historian and continuity signals remain distinguishable.

Disagreeing evidence does not merge merely because entity/source overlap is high. Candidate Bus never chooses a contradiction winner.

## Authority and temporal pass-through

Candidate Bus does not promote:

- INFERRED -> SETTLED;
- HISTORICAL -> CURRENT;
- UNRESOLVED -> CURRENT;
- dense similarity -> SOURCE_CANON.

When nominations disagree about authority or truth-status metadata, the fused candidate uses UNKNOWN and records the metadata conflict instead of escalating.

## Intent traceability

Fusion receipts expose:

- coverage by intent;
- candidate IDs by intent;
- uncovered intent IDs;
- per-intent counts.

A turn does not collapse to one undifferentiated score.

## Boundedness

Default configurable bounds include:

- 64 candidates per intent;
- 128 nominations per channel;
- 32 nominations per channel/intent pair;
- 256 total fused candidates;
- 16 nomination records per candidate;
- 8 graph paths per candidate;
- 64 provenance refs;
- 64 evidence refs;
- 4096 metadata bytes;
- 1600 representation-text chars;
- 128 compact receipt history entries.

Pruning produces a deterministic fusion receipt. Pruning removes retrieval candidates only; it does not mutate epistemic state.

## Freshness

Candidate freshness is explicit: FRESH / STALE / INVALID / UNKNOWN.

Source, dependency, world and scene revision fences are checked before the envelope is published. Stale nominations remain diagnosable and cannot masquerade as fresh.

An optional artifact-owner resolver can reject unknown artifact refs with typed `UNKNOWN_ARTIFACT_REF`.

## Fusion receipt

`CandidateFusionReceipt` records candidate-set ID, intent IDs, input nomination/channel counts, deduplicated candidate count, duplicate count, per-channel/per-intent counts, bounded-out count, unavailable/degraded channels, stale/invalid counts, revision set, intent coverage, pruned IDs and policy version.

The receipt is diagnostic metadata only.
