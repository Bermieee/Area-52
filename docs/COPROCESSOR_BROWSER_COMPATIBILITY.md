# Coprocessor Browser Compatibility

## Contract

The authoritative Sidecar source lane is intended to be copied into a SillyTavern/browser extension. Integration-visible Coprocessor modules therefore cannot depend on Node-only globals or built-ins.

The live Function Test 001 defect was reproduced at the source-lane level:

- `provider-execution.js` used global `Buffer` for UTF-8 byte sizing;
- `integration-adapters.js` imported `node:crypto` for Context Seal packet hashing.

Both dependencies are removed in this lane.

## Browser-safe helper

`src/coprocessor/browser-compat.js` provides:

- `utf8Bytes()` using `TextEncoder`;
- `utf8ByteLength()`;
- `nowMs()` using browser `performance.now()` with `Date.now()` fallback;
- synchronous deterministic `sha256Hex()` without Node crypto.

The SHA-256 helper is pinned by the standard `abc` test vector.

## Permanent regression

`tests/coprocessor-phase1-closure.test.mjs` proves:

1. SHA-256 matches the standard vector.
2. token estimation works with `globalThis.Buffer = undefined`;
3. Function Test 001 completes with `globalThis.Buffer = undefined`;
4. the integration-visible Coprocessor files contain neither `Buffer` nor `node:*` imports.

The manual provider smoke script may use `process.env` because it is explicitly a Node CLI harness, not browser runtime source.

## Boundary

This advances integration issue #185 but does not close it globally. Other Area-52 lanes still own their own browser-host compatibility and live SillyTavern acceptance.
