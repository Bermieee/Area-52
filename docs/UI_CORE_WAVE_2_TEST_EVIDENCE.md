# UI.Core Wave 2 — Deterministic Test Evidence

Command:

```text
npm test
```

Result:

```text
tests 16
pass 16
fail 0
cancelled 0
skipped 0
todo 0
```

Passing tests:

1. adapter bundle satisfies Scene/Runtime/Coprocessor/Knowledge UI contracts
2. scene-delta projector updates only changed fields through keyed scheduler invalidations
3. boundary state exposes evidence, contradiction, confirmation window and final decision
4. scene navigation supports non-linear relation types
5. Turn Event fans out to four typed cognitive coprocessors
6. Gather closes on required foreground quorum without waiting for Green Room
7. Context Seal is a hard foreground publication boundary
8. late Green Room result is visibly routed to NEXT TURN and cannot contribute to sealed context
9. queued lifecycle obligations remain visible while a worker parks and resumes
10. high-frequency scene signals coalesce by field instead of causing whole-state redraws
11. large scene history remains virtualizable and paged
12. provenance inspection is universal read-only adapter interaction, including live CurrentScene sourceEvidence
13. mount/destroy/remount cleans adapter signal subscriptions without duplicates
14. integrated Ember Tavern acceptance sequence preserves required foreground/late-result semantics
15. stress fixtures cover large workers, obligations, batches, histories, provenance and stale/late swarm results
16. high-frequency batch updates coalesce per batch key

Syntax validation:

```text
All Wave 2 JavaScript files: PASS
```

Stress fixture sizes verified by the suite:

```text
workers: 256
lifecycle obligations: 8000
batches: 128
scene history: 10000
provenance edges: 12000
swarm results: 192
rapid Scene deltas: 1000 -> 1 pending field render
rapid batch updates: 2000 -> 1 pending batch render
```
