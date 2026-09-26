# Context Reuse / Change Gate

Delivery reuse is revision-aware representation reuse.

States:

- `NO_CHANGE` — segment identity and delivery policy are unchanged;
- `PATCH` — a grouped segment retains valid sub-sections while a bounded subset changed;
- `REBUILD` — relevant semantics, representation or policy require regeneration;
- `OMIT` — optional section intentionally does not enter this generation.

Segment identity includes semantic manifest, dependency revisions, representation, rendered section text, model-profile revision and delivery-policy revision.

The implementation compares the current plan only to an explicitly supplied previous PromptPlan. It does not use hidden historical state.

Volatile-tail segments always rebuild. Stable/revisioned segments may reuse. A changed source affects only segments whose semantic/dependency identity changed; unrelated atomic segments remain reusable.

Cache keys are derived from delivery identity. Cache availability may improve latency/cost, but a cache miss simply rebuilds and a stale identity never crosses the revision fence.

Priority:

```text
truth / authority / temporal correctness
  > delivery optimization
  > cache economics
```
