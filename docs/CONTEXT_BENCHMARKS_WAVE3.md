# Area-52 Wave 3 Context Benchmarks

Validated implementation checkpoint: `e644b6197731b3a34f70ce17ad179f82a00daf3b`

## Compression benchmark (#43)

Deterministic Ember Tavern benchmark:

- raw representation: **6,012 bytes**
- compiled semantic packet: **2,269 bytes**
- compiled/raw ratio: **0.377412**
- factual retention: **1.0**
- temporal qualifier retention: **1.0**
- contradiction retention: **1.0**
- unresolved-thread retention: **1.0**
- provenance retention: **1.0**
- relationship retention: **1.0**
- result: **PASS**

The publication compiler's own receipt measured 5,975 input bytes and the same 2,269-byte compact packet under a 2,500-byte budget with no fallback and no dropped required claims.

A separate regression sets an impossible one-byte budget and verifies that the compiler chooses RICH_FALLBACK rather than dropping required cognition.

### Remaining #43 work

No LLMLingua-2 dependency was installed. A direct LLMLingua-style/model comparison remains future benchmark work, so #43 is not complete.

## Ordering benchmark (#57)

Wave 3 emits five reusable permutations of:

- current world state;
- character state;
- unresolved threads;
- supporting lore;
- historical evidence.

Coverage in the reference variants:

- current state positions: 0, 1, 2;
- unresolved positions: 0, 2, 4.

No provider-specific winner is declared.

### Remaining #57 work

No target-model-family measurements were run. The reusable permutation/measurement surface is implemented, but model-family sensitivity testing remains open.

## Reproducibility

`scripts/wave3-acceptance-report.mjs` prints golden-world, compiler, seal, compression and ordering metrics.

GitHub Actions runs this report after tests, syntax checks and ESM validation.
