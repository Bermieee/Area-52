# Area-52 Memory Wave 4 — General-World Producer and FT003 Integration Contract

**Owner lane:** Worker 1 / Memory  
**Branch:** `Development-Memory`  
**Wave 3 baseline:** `a6d7cac76d5bb9fae7c9b2d67c2b7a6342db96b2`  
**Strongest lane claim when final validation is green:** **GENERAL-WORLD MEMORY PRODUCER READY FOR FT003 INTEGRATION**

This is a Memory-lane claim only. It does not declare #178 FT003 PASS, #224 Live Brain PASS, Core Candidate Bus admission, Truth, Settlement, Context Seal, PromptPlan, Scene interpretation, Runtime scheduling, or UI rendering complete.

## Referenced live owner contracts

Wave 4 was audited against the following owner heads as read-only references:

- Core: `Development-Nexus@ba4619f56db8e4f94873256dc26589e1680b7d29`
- Scene: `Development-Scene-Scanner@3aaf1c1e9e7e8703dc8c66c5542efb03cc9873cf`
- Lore: `Development-Lorebook-Editor@fa74d3e792d3d8aa4dc4879271bcfc42f43e7c2c`
- Runtime / deployment assembly reference: `Development-Deployment@3e9027e0b5918c9ea0dade248beb400004a01444`
- Jev / Coprocessor: `Development-Sidecar/Jev@e4da2ffcabd8a385b44fc1836b95a85836cfaf6e`
- UI.Core: `Development-UI@e10335c25d6f2baa11af5450e48494b0f0271ba8`

Relevant owner rules remain unchanged: models and retrieval rank do not grant authority; Scene owns Scene interpretation/boundaries; Core owns Candidate Bus admission, Truth, Settlement, Context Seal and PromptPlan; Runtime alone schedules and preempts deep work; UI.Core consumes read models and does not become a backend owner.

## General-world production path

Memory no longer depends on any fixed scenario identity. Production source contains no `Ember Tavern`, `Mara`, `Eris`, or `Sun Blade` fixture names.

The public path is:

```text
exact narrative / owner evidence
  -> appendEvidence / appendRawExperience
  -> optional external owner evidence mapping
  -> confirmed Scene-associated experience
  -> Core-owned Settlement adapter
  -> Temporal State Graph
       CURRENT / HISTORICAL / UNRESOLVED
  -> revisioned episodes / reflections
  -> grounded Scene -> Chapter/Session -> Arc -> Story summaries
  -> Historian exact or hierarchical nomination
  -> exact drillback
  -> Candidate Bus / Truth / Gather / Context Seal (other owners)
```

Raw evidence remains independently recoverable. Corrections stale only their truthful dependency cone. Historical revisions remain reconstructable.

## Public Memory integration surface

Create the public surface with `createMemoryIntegrationSurface(producer)`.

### Exact evidence and Scene

- `admitExternalEvidenceMapping(input)`
- `invalidateExternalEvidenceMapping(input)`
- `acceptSceneOwnerEvent(event, options)`
- `acceptSceneExperience(proposal, options)`

A Scene proposal is not fresh merely because it exists. Exact mapped evidence, matching source revisions and a confirmed Scene boundary are required. Wrong revisions, mentioned-only evidence, authority escalation and late sealed-generation material fail closed.

### Core Settlement

- `applyCoreSettlement(envelope, {evidenceArtifactRefs})`

Memory maps external evidence identity to exact local evidence, then delegates canonical mutation semantics to the existing owner Settlement validator. Memory does not manufacture Settlement receipts or choose unresolved winners.

### Temporal state

- `currentProjection(options)`
- `asOf(worldRevision)`

Current, historical and unresolved state remain distinct. Supersession preserves old versions. Unresolved alternatives remain unresolved until an authorized owner Settlement resolves them.

### Historian

- `queryHistorian(request)`
- `resolveHistorian(request)`
- `drillDown(nominationOrRecordRef, options)`
- `profileHierarchyQuery(request, options)`

Historian output is nomination-only. Exact and hierarchy paths apply selected-chat and perspective fences before presentation. Hierarchical summaries are navigation artifacts, not independent evidence. Drillback returns exact source evidence and re-applies perspective and chat fences.

### Summary hierarchy

- `defineSummaryScope(input)`
- `summaryWorkUnits(options)`
- `compileSummaryWorkUnit(workUnit, options)`
- `runSummaryCompaction(options)`
- `summaryArtifact(scopeRef, options)`
- `summaryHistory(scopeRef)`
- `summaryStatus()`

Summary work is grounded in exact evidence and child revisions. Invalidation is dependency-local and old revisions remain inspectable.

## Worker 3 — Memory -> UI.Core live producer contract

UI.Core Wave 11 expects the host selection to include, when available:

```text
chatId
turnId
generationId
correlationId
worldRevision
sceneRevision
sourceRevisionRefs[]
```

Worker 3 should use one of these equivalent seams:

```js
surface.adapters.readMemory(selection)
surface.adapters.subscribeMemory(listener)
surface.adapters.createMemoryUiProducer({ readSelection })
```

The producer returned by `createMemoryUiProducer` exposes:

```js
producer.read(selection?)
producer.readRetrieval(request, selection?)
producer.subscribe(listener)
```

`MemoryUiReadModel v1.0.0` publishes:

- availability and inspectable degraded reasons;
- selected chat/turn/generation/correlation identity;
- world/Scene/source and Memory revision fences;
- exact evidence preview rows with provenance and freshness;
- chat-persistent CURRENT / HISTORICAL / UNRESOLVED state;
- selection-scoped episodes, reflections and summaries;
- only a retrieval receipt whose exact selection key matches the selected generation;
- aggregate provenance and freshness counts;
- explicit authority-negative fields.

Important scoping rules:

- persistent Memory state is chat scoped;
- observation evidence becomes selected turn/generation scoped when the host supplies those identities;
- retrieval receipts are selected-turn/generation scoped and never fall back to another generation;
- a missing selected-chat result remains unavailable/degraded instead of borrowing another chat;
- subscription events contain no raw evidence and exist only to trigger a fresh read.

Memory does not build UI widgets on this branch.

## Worker 2 / Runtime — bounded consolidation contract

Memory exposes:

```js
surface.adapters.startConsolidation(jobs, {
  selection,
  generationFence,
  sourceRevisionRefs,
  worldRevision,
  sceneRevision,
})
surface.adapters.consolidationWorkUnits(sessionId, { maxUnits })
surface.adapters.runConsolidation(sessionId, {
  maxUnits,
  sealed,
  sealedGenerationIds,
  currentSourceRevisionRefs,
})
```

`MemoryConsolidationWorkUnit v1.0.0` carries source/world/Scene revision fences plus chat/turn/generation/correlation/Context-Seal identity. The work unit explicitly has no Runtime scheduling, physical-worker, foreground-publication, Context-Seal or canonical-mutation authority.

A sealed generation returns `PARKED_AFTER_SEAL` with destination `NEXT_TURN`. A stale source fence returns `STALE` with destination `RECOMPUTE`. Runtime remains the scheduling/yield owner.

Session-level source fences are bounded independently from per-artifact source lists: up to 4,096 source revisions per consolidation session, while individual Memory artifacts keep their smaller artifact-specific bounds.

## Worker 4 — FT003/live assembly call sequence

For real SillyTavern evidence, Worker 4 should assemble the existing owners in this order:

1. Create one `MemoryTemporalProducer` and one `MemoryIntegrationSurface` for the active Brain resource.
2. For direct narrative experience, admit exact raw experience with host selection identity and provenance.
3. For Scene-owned evidence, call `admitExternalEvidenceMapping`, route `SCENE_BOUNDARY_CONFIRMED` (and `SCENE_EPISODE_READY` when published) through `acceptSceneOwnerEvent`, then route the `SceneExperienceProposal` through `acceptSceneExperience`.
4. For Core-owned world-state mutation, admit every exact owner evidence mapping, then call `applyCoreSettlement` with the owner evidence descriptors and the original Core proposal/decision/receipt envelope.
5. Register/execute Memory summary work only from exact fresh evidence; Runtime decides when background work runs.
6. Call `queryHistorian` with the active host selection and perspective constraint. Forward its `CandidateNomination` records to the real Candidate Bus. Memory does not self-admit.
7. Let Core/Sensory/Truth/Precision/Gather/Context-Seal/PromptPlan perform their existing owner stages.
8. Use `drillDown` when exact evidence is required for verification or operator inspection.
9. Bind `createMemoryUiProducer({readSelection})` into Worker 3's live UI port and fan Memory subscription notifications into the existing host subscription path.
10. Route deep consolidation through Runtime work scheduling. Pass sealed generation IDs so late results cannot alter the active generation.
11. Snapshot/reload the one Memory resource with `snapshot()` / `MemoryTemporalProducer.fromSnapshot(snapshot)` during durability validation.

Passing these Memory calls is necessary for FT003, but FT003 remains open until the assembled real Candidate Bus -> Truth/Precision -> Gather -> Context Seal -> PromptPlan path passes. #224 remains open until the live SillyTavern Brain/UI path passes.

## Native-resource rule

The Memory producer requires no external SQL database, Redis, Dapr, vector server, remote model, plugin or background service. Optional owner/runtime integrations can consume its public contracts, but the native Memory path is one local resource.
