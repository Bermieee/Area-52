# Knowledge Invalidation Core Contract — Phase 1 Wave 5

## Smallest truthful cone

Source revision changes invalidate only artifacts that directly or transitively depend on the changed revision. Unrelated artifacts remain reusable.

`DependencyInvalidationReceipt` records the changed source revision, directly stale artifact refs, transitively stale artifact refs, preserved artifact refs, reason, dependency-graph revision, and invalidated/preserved counts.

The receipt explicitly records `wholeWorldInvalidation:false`.

## Source update

If source `r5` becomes `r6`, an old candidate or Precision result tied to `r5` is stale for active use. The old revision remains reconstructable.

## Source retirement

Retirement removes the source revision from the active revision set and invalidates active dependent representations. It does not erase the source record or revision history.

## Late results

A result produced from a stale revision cannot enter current admission. A result arriving after a Context Seal remains eligible only for its legal later destination; the published seal is unchanged.
