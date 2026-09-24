# Accepted Checkpoint Integration Policy

Wave 6 distinguishes `BRANCH_HEAD` from `ACCEPTED_CHECKPOINT`.

## Rule

Integration defaults to `ACCEPTED_CHECKPOINT`.

A branch head that differs from its accepted checkpoint is rejected unless an integration operator explicitly opts into unaccepted work. Normal rehearsal never does so.

## Proven examples

- Coprocessor Wave 4 accepted checkpoint is `d9b195332671d802639e6f9e7174de74f23a4b1e` (CI `35963531808`); `8eca22f0ae474a77914d8606148e433965aff205` is retained only as the historical green implementation checkpoint immediately beneath it.
- Scene moving head `bee29f03de586e7f77728a5a1b6b50dbec0fdf8b` is not silently substituted for independently accepted checkpoint `5ad7567225720292d759d4a75afe84479deb6c1a`.

The newer Scene head is still useful: it is inspected as a contract-drift input and currently classifies as `COMPATIBLE_EXTENSION`.

This policy is enforced by `resolveIntegrationCheckpoint()`, not by naming convention.
