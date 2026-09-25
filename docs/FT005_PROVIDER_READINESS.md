# Function Test 005 — Sidecar Provider Readiness

This wave does **not** claim FT005 PASS. Final acceptance still requires an integrated `main` SillyTavern run with real providers and a forced failure/fallback drill.

`scripts/ft005-provider-readiness.mjs` supports two externally configured OpenAI-compatible providers (`A` and `B`) without committed credentials. It negotiates capabilities, exercises Runtime-selected profile execution, validates structured output, normalizes the worker result and records bounded telemetry.

Configuration uses `AREA52_PROVIDER_A_*` / `AREA52_PROVIDER_B_*` environment variables for base URL, model, optional API key, timeout, locality and optional limits. `AREA52_FT005_FORCE_A_UNAVAILABLE=1` provides a deterministic forced-outage drill so provider B can demonstrate bounded fallback without changing task truth semantics.

Expected report stages are `PROVIDER CONNECTED`, `CAPABILITY MATCHED`, `REQUEST SENT`, `OUTPUT VALIDATED`, `RESULT NORMALIZED` and `TELEMETRY RECORDED`.

Provider identity remains metadata and native function calling is not required. Cancellation, timeout, unavailable-provider and malformed-output paths are covered by deterministic tests.
