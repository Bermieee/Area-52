# Main Assembly Manifest Contract

This is the Development-Nexus contribution to integration issue #186. It does not mutate `main`.

Each accepted lane record captures source branch, accepted source SHA, copied paths and source digests, integration-only patches and their expected digests/reasons, acceptance evidence, integration SHA and optional superseding SHA.

`verifyAssemblyLane()` classifies each copied path as `EXACT`, `INTEGRATION_PATCHED`, `STALE_COPY`, `MISSING`, or `UNEXPECTED_DRIFT`. A lane is reconstructable only when every recorded path is exact or an explicitly documented integration patch.

`STALE_COPY` means the lane source has advanced beyond the accepted SHA while the assembled file still matches the old accepted digest. `UNEXPECTED_DRIFT` means bytes differ from both accepted source and any declared integration-only patch.

The Node CLI `scripts/verify-assembly-manifest.mjs` is deterministic integration tooling around the browser-neutral contract. It takes an entry JSON file and an observed-state JSON file, prints the verification report and exits non-zero when the lane is not reconstructable.


## Wave 3 Core lane self-audit

`src/core-assembly-manifest.js` exposes a deterministic sorted enumeration of Core-owned runtime files intended for later copy-based `main` assembly. `createCoreAssemblyLaneManifest()` feeds those paths into the existing lane manifest contract with Development-Nexus source SHA, source digests, integration-only patches, acceptance evidence, integration SHA and superseding SHA.

This is readiness evidence only. It does not mutate `main` and does not close #186; full acceptance still requires reconstructing the real integrated `main` from accepted lane checkpoints.
