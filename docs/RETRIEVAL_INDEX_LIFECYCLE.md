# Retrieval Index Lifecycle

## Principle

An index entry is a derived retrieval representation. The owner artifact remains semantic truth.

Storage/backend replacement must not change owner identity, candidate identity, provenance, source revisions, authority or temporal metadata.

## Indexed artifact contract

`IndexedArtifactRepresentation` retains:

- representation ID/revision;
- owner artifact ID/revision;
- source ID/revision;
- entity/concept/claim/event/relationship refs;
- owner authority and truth-status hint;
- provenance refs and dependency invalidators;
- index adapter/version;
- residency state;
- derived representation data/text.

## Adapter contract

Adapters implement lifecycle equivalents of:

- putRepresentation;
- invalidateRepresentation;
- tombstoneRepresentation;
- query;
- verify;
- rebuild;
- compact.

The contract is backend-neutral. Wave 8 does not select Qdrant, Milvus or another production vector database.

## Representation provider boundary

Artifact ownership, representation generation and storage are separate.

Wave 8 supplies a deterministic replaceable proof provider:

- sparse form: token/count representation;
- dense form: deterministic small vector.

It exists to prove contract equivalence only; it is not a production embedding model.

## Revision lifecycle

First insert records the exact owner/source revision.

When owner revision N -> N+1:

1. only representations owned by that artifact are invalidated/reindexed;
2. unrelated expected representations remain reusable;
3. the committed lifecycle marker advances only after every requested adapter succeeds;
4. old/torn representations cannot publish as fresh.

Source-revision invalidation can target the smallest dependent cone. No global rebuild is required.

## Tombstone / retirement

Tombstoned representations stop current retrieval but remain inspectable for provenance/history until compaction policy removes them.

The adapter cannot silently resurrect a tombstone as an active result.

## Verify

Verification distinguishes:

- FRESH;
- STALE;
- MISSING;
- ORPHAN;
- WRONG_REVISION;
- TOMBSTONED;
- INVALIDATED;
- ADAPTER_VERSION_MISMATCH;
- TORN.

Verification is retrieval infrastructure and does not settle truth.

## Torn transactions

Partial multi-adapter update does not advance the committed owner marker. Successful-but-uncommitted representations therefore query as STALE and verification reports DEGRADED/TORN.

Interrupted rebuild follows the same rule: the prior committed marker is retained, the lifecycle becomes degraded/torn, and a later clean rebuild can recover deterministically.

## Rebuild

The index can be deleted and reconstructed from supplied owner artifacts plus the representation provider.

Stable claim/event evidence identities and exact provenance survive rebuild.

## Migration

Migration rebuilds a target adapter from owner artifacts and verifies it. Adapter-specific representation IDs may change; candidate/evidence identity does not.

This is the seam for future backend A -> backend B migration. Production backend choice remains #41.
