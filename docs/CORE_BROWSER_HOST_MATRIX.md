# Core Browser Host Matrix

Wave 3 expands browser compatibility from Framework/Audit modules to every canonical `src/*.js` Core runtime module.

## Browser-neutral primitives

`src/browser-runtime-utils.js` supplies deterministic pure-JS SHA-256, UTF-8 byte sizing, stable object serialization/hash and monotonic timing. This removed runtime dependence on:
- `node:crypto`;
- `Buffer.byteLength`;
- `node:perf_hooks`.

The SHA-256 helper is regression-tested against the standard `sha256("abc")` vector so stable IDs/hashes do not drift solely because Node crypto was removed.

## Static source matrix

The permanent source scanner enumerates every `src/*.js` file and rejects Node built-ins, Buffer, process, CommonJS require, filesystem invocation, eval and Function-constructor assumptions.

Functional pre-documentation acceptance: **56/56 Core source modules PASS**.

## Runtime execution matrix

`scripts/core-browser-runtime-acceptance.mjs` temporarily removes global Buffer, process, crypto and TextEncoder using property descriptors, then dynamically imports and executes:
- Cognitive Core;
- source study;
- Context Compiler;
- active-thread publication;
- Context Seal;
- Adaptive Context / PromptPlan;
- diagnostic turn trace.

Functional pre-documentation acceptance: **7/7 PASS**.

Node-only CLI/benchmark tooling remains isolated under `scripts/`. No new live SillyTavern acceptance is claimed; #185 still requires assembled `main` plus live host smoke/update/reload evidence.

## Wave 5 knowledge path

The browser-visible manifest now includes `knowledge-evidence.js`, `knowledge-integration-spine.js`, and `nexus-shadow-adapter.js`. At Wave 5 functional checkpoint `5c34d9ae6f8bc880a2c8d13ddc00c1a20bf87956`, the source gate is **71/71 PASS** and browser runtime remains **7/7 PASS**. This is Core/browser compatibility evidence only; assembled-main live SillyTavern acceptance for #185 remains pending.
