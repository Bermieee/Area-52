# UI.Core Wave 2 — Change and Acceptance Record

**Working branch:** `Development-UI`  
**Accepted Wave 1 baseline:** `dc8758144c3c27b4a0f2dad0844bec65ebd25437`  
**Primary assignment:** #116 Scene Intelligence workspace + CurrentScene inspector

## Source note

At Wave 2 start, the three named Scene Intelligence documents were not present in `Development-UI`, `Development-Nexus`, or `Development-Scene-Scanner`:

- `docs/AREA52_SCENE_INTELLIGENCE_BLUEPRINT.md`
- `docs/AREA52_SCENE_INTELLIGENCE_REFERENCE_DOCUMENTATION.md`
- `docs/AREA52_SCENE_INTELLIGENCE_IMPLEMENTATION_RUNBOOK.md`

Issue #116 was present and defined the observational Scene Intelligence surface. The user-supplied Wave 2 assignment supplied the detailed CurrentScene, delta, boundary, episode, graph, runtime, adapter, stress, and acceptance requirements. This implementation follows those supplied requirements without inventing absent backend authority or settlement semantics.

The accepted UI baseline did contain the Cognitive Coprocessor blueprint/reference/runbook, and those documents were used for Turn Event fan-out, result classes, Gather quorum, late-result routing, and Context Seal behavior.

## Delivered surfaces

### Scene Intelligence
- CurrentScene scene ID/revision, location, time, cast, objects, threads/objectives, atmosphere, source evidence, observed/inferred/unresolved state.
- Field-level Scene Delta stream using SignalHub + keyed RenderScheduler coalescing.
- Boundary Inspector with supporting signals, contradictory evidence, confidence, confirmation window, final cut/no-cut decision.
- Virtualized SceneEpisode history with dedicated Inspector view.
- Non-linear navigation across PRECEDES, CONTINUES, PARALLEL_TO, FLASHBACK_OF, INTERRUPTS, RESUMES.

### Cognitive Runtime
- cognitive mode, Hot/Deep activity, L0-L4 utilization, reserved foreground and borrowed background capacity.
- existing WorkerPool widget fed by RuntimeUIAdapter.
- lifecycle obligations independent from worker availability.
- worker capability/layer/task/state/provider/model/latency data.
- batch units, active/next slice, checkpoint, adaptive size, yield request, resume point.
- paged/virtualized Work Ledger inspection.

### Cognitive Coprocessors
- Turn Swarm fan-out.
- REQUIRED / OPPORTUNISTIC / DEFERRED classes.
- worker start/completion/freshness/fallback/current-context contribution.
- Gather expected/completed/quorum/deadline/required-missing/late state.
- Context Seal timeline: TURN_EVENT -> fan-out -> worker results -> quorum -> compiler -> CONTEXT SEALED -> Main.
- late results visibly routed after seal as NEXT TURN or BACKGROUND.

### Hot Cognition
Compact workspace and bottom activity strip for CurrentScene, active characters, location, graph neighborhood, unresolved threads, recent episode tail, warm packet, and current world revision.

### Provenance UX
Universal read-only interactions through ActionRouter + KnowledgeUIAdapter:
- Inspect Source
- Inspect Provenance
- Inspect History
- Inspect Dependencies
- Inspect Settlement
- Inspect Evidence

No direct cognitive mutation hooks were added.

## Ember Tavern / Sun Blade integrated acceptance

The deterministic fixture executes the requested 16-step scenario:

1. CurrentScene is intact Ember Tavern.
2. Eris and Mara are active.
3. Eris leaves the Sun Blade.
4. Boundary candidate appears.
5. Time/location transition confirms closure.
6. SceneEpisode is compiled.
7. FireEvent492 changes Tavern and Sun Blade state.
8. Ruins scene opens.
9. Turn Event is created.
10. Historian, Graph Walker, Green Room and Truth Worker fan out.
11. Historian + Graph + Truth satisfy required foreground quorum.
12. Gather closes without Green Room.
13. compiler/Context Seal completes.
14. Main appears after the seal.
15. deliberately late Green Room is routed to NEXT TURN and cannot contribute to sealed context.
16. historical intact-tavern scene and provenance remain inspectable.

## Stress fixtures

Deterministic load fixtures include:
- 256 concurrent workers;
- 8,000 lifecycle obligations;
- 128 batches;
- 10,000 scene-history episodes;
- 12,000 provenance edges;
- 192 coprocessor results including stale and late cases;
- 1,000 rapid same-field Scene deltas;
- 2,000 rapid updates to one batch.

The scheduler coalesces the 1,000 Scene deltas to one pending field render and the 2,000 batch updates to one pending batch render.

## Validation

Wave 2 deterministic suite: **16/16 PASS**.  
Wave 2 JavaScript syntax validation: **PASS**.

Covered gates:
1. adapter compatibility;
2. field-level scene delta updates;
3. boundary view state;
4. non-linear scene navigation;
5. worker fan-out;
6. Gather quorum without waiting for Green Room;
7. hard Context Seal;
8. late-result presentation;
9. lifecycle obligations through park/resume;
10. high-frequency scene coalescing;
11. large history paging/virtualization;
12. universal provenance including live CurrentScene sourceEvidence;
13. mount/destroy/remount cleanup;
14. complete integrated Ember Tavern scenario;
15. stress fixture coverage;
16. high-frequency batch coalescing.

## Authority boundary

Wave 2 does not implement Scene Intelligence authority, Runtime Fabric authority, Work Ledger persistence, Gather authority, Context Compiler authority, Context Seal authority, or cognitive settlement. Those remain backend subsystem responsibilities.
