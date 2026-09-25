# Artifact Registry Contract

The common `ArtifactEnvelope` preserves:

- `artifactId`
- `artifactType`
- `schemaVersion`
- `owner`
- `authority`
- `provenance`
- `revision`
- `dependencies`
- `invalidators`
- `status`
- type-specific `payload`

Built-in recognition exists for Claim, Reflection, Experience, SceneEpisode, Hypothesis, CausalRelation, OntologyConcept, RetrievalRepresentation and CompiledArtifact. Future types register through `ArtifactTypeRegistry` without modifying storage or kernel switches.

The envelope is not a universal semantic schema. Each registered type owns its payload validator and repository-domain routing. Registration does not grant CURRENT status, Settlement authority, truth ownership, or Context Seal bypass.
