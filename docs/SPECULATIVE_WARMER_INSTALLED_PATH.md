# Installed Speculative Context Warmer Path

Status: Worker 1 production integration for Trello #77. Installed provider qualification remains open.

## Construction and trigger

`DevelopmentDeploymentBrain` constructs one `SpeculativeWarmCoordinator` per Brain instance and binds one Scene Event Spine obligation producer, `SPECULATIVE_CONTEXT_WARM_OWNER`, to `PREFETCH_RECOMMENDED`.

The installed path is:

```
Scene PREFETCH_RECOMMENDED
  -> Scene owner guard (chat/source/Scene/Seal fences)
  -> SpeculativeWarmCoordinator Runtime plan
  -> WorkerDirector background obligation
  -> owner-backed Lore + Memory + Scene graph retrieval
  -> existing Truth policy
  -> existing Precision policy
  -> bounded compilation receipt
  -> dependency-fenced WarmPacketCache
  -> runTurn pre-Send consumeForSend()
  -> normal Core retrieval / Cognitive Choice / Truth / Precision / compiler / Seal
```

Scene supplies recommendation intent only. Runtime owns scheduling, capacity, foreground reserve, checkpointing, yielding, resume, dedupe, and supersession. The warmer has no scheduling or truth authority in the installed path.

## Runtime ownership and safe yield

The coordinator exposes a staged Runtime plan. Retrieval batches, quality, Truth, Precision, compile, and cache publication are separate Runtime units. `WorkerDirector` executes one unit per checkpoint slice.

When generation begins, `DevelopmentDeploymentBrain.runTurn()` calls `runtimeDirector.beginGeneration()`. Active background work receives a safe-boundary yield request. Capacity remains physically occupied until the active execution call exits; a cancellation or yield request does not fabricate free capacity. Parked valid work resumes after `completeGeneration()`.

Equivalent recommendations use the coordinator's semantic preparation key as the Runtime dedupe key. A newer Scene revision uses the same per-chat conflict key and Runtime supersession rules to obsolete older work. Source invalidation and chat switches cancel matching open warm obligations explicitly.

## Owner-backed preparation

The installed retrieval adapter uses accepted owner interfaces:

- Lore: `RuntimePreparedLoreChannel.prepareSpeculative()`.
- Memory: Historian retrieval through the Memory integration surface.
- Scene graph: current Scene graph references.
- Truth: the existing Core Truth publication gate.
- Precision: the existing deterministic Precision owner.
- Compile: the existing Core compiler path, retained as a non-authoritative preparation receipt.

Warm retrieval stores references and bounded receipts only. It does not place raw prompts, story bodies, Lore bodies, credentials, or hidden reasoning into Diagnostics Center records.

Predicted destinations, entities, locations, threads, and prepared results remain advisory. Warming never mutates `CurrentScene`, canonical Lore, durable Memory/world truth, or Context Seal.

## Freshness and pre-Send consumption

Warm identity is fenced by:

- chat namespace;
- Scene revision;
- world revision;
- character-state revision;
- current source-revision set;
- Scene recommendation intent fingerprint;
- retrieval-policy revision.

The packet cache is bounded. Per-reference dependency metadata records the source revisions that support each candidate/evidence reference.

### Fresh

A fresh packet still returns `REVALIDATE_FOR_CORE_ADMISSION`; it never grants admission itself.

The installed consumer additionally requires the later Send to match the active Scene recommendation's scope/intent. Only then may the precomputed Lore owner result be activated for the exact Send query. This avoids the foreground planning query and the separate Runtime `LORE_RETRIEVAL` preparation job.

Core still executes current retrieval, Cognitive Choice, Truth, Precision, compilation, publication, and Seal. A prepared destination is never evidence that the destination became current.

`recordCoreRevalidation()` receives the stages actually reused. Avoided-work counters therefore do not count Truth, Precision, compile, or Core retrieval merely because a warm packet contained those preparation receipts.

### Partially stale

Source- or character-state changes clear compiled material. If per-reference dependency metadata is available, only refs whose entire dependency set is still current are salvageable. The installed consumer forwards those candidate IDs only as external selection hints. GenerationPublication resolves them against fresh owner retrieval and then reruns Truth, rerank/Precision, compiler, and admission.

### Stale, incompatible, miss, or unavailable

Scene/world/policy mismatch, incompatible intent, expired TTL, missing owner preparation, or unavailable warm work falls through to the normal foreground path. Normal generation does not depend on speculative warming.

## Invalidation and recovery

- Source edit/delete: invalidate matching cache dependency cones and cancel matching open Runtime obligations.
- Scene revision change: retain only the current Scene-revision cache for that chat; Runtime supersedes/cancels obsolete work.
- Chat switch: invalidate the old chat cache and cancel foreign-chat warm work.
- Context Seal: a warm packet has no Seal authority and cannot reopen a sealed generation.
- Reload: deployment Runtime persistence is currently `null`; warm cache/work state therefore cold-starts. No unsupported warm state is restored.
- Repeated Brain construction is instance-scoped; each instance owns one coordinator and one Event Spine binding.

## Diagnostics Center / JSON export

`DevelopmentDeploymentBrain.diagnostics().speculativeWarm` exposes bounded metadata for:

- recommendation receipt and eligibility;
- Runtime admission/dedupe;
- scheduled versus physically attempted stages;
- retrieval/Truth/Precision/compile progression;
- cache publication;
- source dependency identity counts;
- fresh hit, partial salvage, stale discard, miss, and unavailable/failure;
- reused stages and foreground stages still required;
- cancellation/supersession and late destination;
- actual foreground work avoided;
- Runtime lifecycle/checkpoint/supersession state;
- explicit cold-start recovery policy.

A scheduled obligation is not reported as physical execution. A cache hit is not reported as provider delivery.

## Installed acceptance boundary

Deterministic assembled tests cover the installed Scene -> Runtime -> owner preparation -> cache -> pre-Send route, duplicate suppression, quiet/no-work behavior, fresh reuse, dependency-aware partial salvage, source invalidation, and preserved Core/Seal authority.

Live installed Scene/provider qualification remains open under #177/#180. No typing monitor, Phase-2 predictive learning, Memory outcome feedback, Object continuity admission, Green Room ownership, Lore synchronous-study backlog, World Tree narrative work, or UI redesign is included in this wave.
