# Scene -> Memory Handoff Contract

Wave 3 defines a reference-first Memory seam without implementing Memory persistence.

## SceneGraphReferenceSet

A `SceneGraphReferenceSet` contains references to:

- SceneEpisode artifacts;
- Scene relationship edge IDs;
- entity-in-scene edge IDs;
- event-in-scene edge IDs;
- object-in-scene edge IDs;
- thread-in-scene edge IDs;
- source revision refs;
- provenance refs.

The full Scene Graph is not copied into each proposal.

## SceneExperienceProposal

A `SceneExperienceProposal` packages:

- proposal identity;
- Scene ID/revision;
- exact SceneEpisode reference;
- SceneGraphReferenceSet;
- source revision/evidence/provenance refs;
- status PROPOSED.

It grants no Memory mutation or Settlement authority.

Memory may later decide whether and how this becomes durable experience structure.

## Freshness

A proposal is fresh only when its Scene revision and source-revision set still match the expected Scene/source state. A proposal referring to an older SceneEpisode after a source edit is detectable as stale.

## Causality

Scene adjacency is not causality.

A PRECEDES edge remains `causal:false`. Only a future evidence-backed causal/support contract may assert causal meaning.


## Installed lifecycle owner mapping

The production Scene → Memory connection is installed through the existing Runtime Event Spine and Memory integration surface. It does not create a second queue, graph, or Memory store.

- **Trigger:** only finalized `SCENE_EPISODE_READY` schedules the installed `MEMORY_SCENE_LIFECYCLE_OWNER` obligation. `SCENE_BOUNDARY_CONFIRMED` and `SCENE_CLOSED` remain lifecycle evidence, not duplicate scheduling triggers.
- **Runtime class:** bounded L2/background work with `DEFERRED` / `BACKGROUND` result destination. Scene events are work notifications only; they do not grant Memory mutation permission.
- **Historical-after-Seal exception:** ordinary Scene work keeps current-chat/current-Scene/Post-Seal guards. Finalized lifecycle work may run after Seal only when explicitly owner-approved as historical background work. The Memory bridge independently limits that exception to Scene lifecycle events and `SCENE_INTELLIGENCE` `SceneEpisode` owner artifacts.
- **Fences:** before execution and again before Memory admission, the installed owner checks chat/story identity, exact retained Scene revision, exact Episode artifact revision/source set, source-revision currency, and the matching confirmed boundary. A chat switch may not redirect the result into the new story.
- **Admission:** Memory first admits exact source mappings, then the matching boundary/Episode-ready owner events, then the existing `SceneExperienceProposal`. Memory decides whether the durable episode is fresh/resolved, rejected, deferred, or no-work.
- **Deduplication:** Event Spine replay and Runtime obligation dedupe prevent duplicate work. Exact source revision + content identity is shared with ordinary narrative learning so two owners can retain provenance without duplicating the durable Memory evidence record.
- **Invalidation/recovery:** source edits, deletion, regeneration/supersession invalidate dependent Memory state through existing source-revision invalidation. Historical/raw revisions remain recoverable. Missing retained owner evidence or unavailable Memory admission produces an explicit deferred owner decision rather than fabricated experience.
- **Diagnostics:** bounded Diagnostics Center / JSON receipts distinguish event publication, scheduling/dedupe, execution attempt, proposal creation, Memory owner decision, durable persistence, source invalidation, and later retrieval. These receipts retain identities/revisions/reasons only and do not export raw story text, credentials, provider bodies, or hidden reasoning.

Installed-host FT002/FT003 acceptance remains separate from this deterministic/interface contract.
