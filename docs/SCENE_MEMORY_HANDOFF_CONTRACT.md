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
