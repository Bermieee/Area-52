# Scene Context Invalidation Contract

A confirmed Scene transition can make Scene-specific compiled context stale. Scene does not mutate Core caches directly.

The handoff is `SceneContextInvalidationSignal`.

## Signal

The signal contains:

- deterministic `invalidationId`;
- from Scene ID/revision;
- to Scene ID/revision;
- optional resumed Scene reference;
- relationship;
- invalidated scope names;
- source/evidence refs;
- reason;
- whether active Scene identity changed;
- whether the same conceptual Scene resumed.

Default scopes describe stale Scene-compiled context, Scene retrieval context, active Scene identity and Scene prompt segments.

## Resume

On resume, the same conceptual Scene ID is retained while the revision advances. The resume reference records the old suspended revision and the new resumed revision so Core can invalidate the right compiled context without treating the Scene as unrelated.

## Idempotence

The publisher deduplicates by deterministic invalidation ID and keeps a bounded dedupe set.

## Evidence-history invariant

Context invalidation means “eligible to leave active working context.”

It explicitly does **not** mean “delete evidence.” The signal carries `deleteEvidence:false`.

## Authority

SceneContextInvalidationSignal has no Core cache mutation or Context Seal authority. Core remains the owner of invalidation application.
