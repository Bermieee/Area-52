# Artifact Reference Contract

The Sidecar data plane reuses the Cognitive Core Artifact Registry identity rather than creating a competing artifact system.

An `ArtifactReference` contains `artifactId`, `artifactType`, `owner`, exact `revision`, repository/storage domain, optional source/world/scene revision fences, optional content hash, optional slice selector, optional provenance reference and optional expiry metadata.

A reference means **retrieve this exact revision**. Resolution uses the Core-compatible repository seam `get(domain, id, { revision })`. The resolver never silently substitutes the latest value.

Resolution statuses are `EXACT`, `STALE`, `SUPERSEDED`, `MISSING` and `INVALID`.

- `EXACT`: the requested revision and identity were returned.
- `STALE`: current source/world/scene fences do not match the reference.
- `SUPERSEDED`: the requested revision is unavailable while a newer revision exists.
- `MISSING`: no requested artifact/revision exists.
- `INVALID`: owner/type/hash/revision/slice validation failed.

Slice selectors are bounded property paths. A slice fetch returns only the selected material rather than the whole artifact.

Artifact references grant no truth, Settlement or Context Seal authority.
