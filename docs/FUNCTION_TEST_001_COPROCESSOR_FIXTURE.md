# Function Test 001 — Coprocessor Fixture

## API

`runFunctionTestTurn(options)`

Default input:

> Eris returns to the ruined Ember Tavern looking for the Sun Blade while speaking to Mara.

## Fixture truth

Ember Tavern:

- CURRENT = destroyed.

Sun Blade:

- HISTORICAL = at Tavern;
- CURRENT location = unknown / UNRESOLVED.

Credible conflict:

- destroyed in fire;
- removed before fire.

No worker may fabricate CURRENT Blade-at-Tavern.

## Default fan-out

- Historian — REQUIRED — 40ms;
- Graph Walker — REQUIRED — 50ms;
- Truth / Precision — REQUIRED — 70ms;
- Green Room — OPPORTUNISTIC — 240ms.

Foreground closes at 70ms.

Green Room routes NEXT_TURN after the simulated external Seal boundary.

## Output

The fixture returns:

- `fanOutPlan`;
- `runtimeSubmissions`;
- `workerResults`;
- `gatherBundle`;
- `foregroundQuorumReceipt`;
- `lateResults`;
- `compilerInput`;
- `sealCompatibilityReceipt`;
- `promptPlan` when externally injected;
- `telemetrySummary`;
- explicit `fixtureBoundaries`.

## Integration mode

An integration worker may inject:

- real provider execution layer;
- real Result Bus receive boundary;
- real compiler callback;
- real Context Seal callback;
- real PromptPlan callback.

Sidecar does not implement or own Context Seal/PromptPlan.

## Purpose

The API is the explicit bridge from deterministic Sidecar acceptance to the first integrated Area-52 Function Test 001.
