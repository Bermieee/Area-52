# Core Assembly Preflight

Wave 4 expands assembly tooling without assembling or mutating `main`.

An IntegrationLaneManifest records:
- source branch;
- accepted SHA;
- acceptance run;
- copied paths and source digests;
- browser-runtime paths;
- Node-only tool paths;
- required/optional Web APIs and host capabilities;
- integration adapters;
- integration-only patches with expected digest and reason;
- known conflicts;
- superseded assembly revision.

Preflight states:
- READY_TO_COPY
- STALE_SOURCE
- CONFLICT
- MISSING_ACCEPTANCE
- MISSING_PATH
- INTEGRATION_PATCH_REQUIRED

A changed lane head or changed source digest is visible rather than silently copied. An integration-local modification not covered by a documented patch is CONFLICT. A documented compatibility patch is INTEGRATION_PATCH_REQUIRED and remains traceable.

`createDryAssemblyPlan` deterministically emits COPY, APPLY_DOCUMENTED_PATCH, VERIFY_LANE_DIGESTS and RUN_GATE steps. It always reports `mainMutationAllowed:false`.

This extends the Wave 1 assembly-manifest primitives. #186 remains open until a real fresh `main` reconstruction from accepted lane checkpoints succeeds.

## Wave 5 knowledge-lane support

IntegrationLaneManifest now also carries `artifactContracts[]` and `requiredAdapters[]`. A future accepted Memory/Lore/Sensory/Precision checkpoint can declare its source/browser paths, accepted SHA/run, contract versions, adapter requirements, known conflicts, and integration patches before any copy into `main`. The existing dry plan remains non-mutating.
