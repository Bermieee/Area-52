# Function Test Blocker Matrix

Canonical state vocabulary: `PASS`, `READY`, `PARTIAL`, `BLOCKED`, `NOT_RUN`.

| Test | Overall | Component state |
|---|---|---|
| FT001 | PASS | integrated `main` live baseline PASS |
| FT002 | BLOCKED | Core READY; Scene READY; Coprocessor READY; Runtime READY; Host BLOCKED; Main assembly BLOCKED |
| FT003 | BLOCKED | Core READY; Memory BLOCKED; Sensory BLOCKED; Precision READY; Host BLOCKED |
| FT004 | BLOCKED | Core READY; Lore BLOCKED; Sensory BLOCKED; Precision READY; Host BLOCKED |
| FT005 | BLOCKED | Core READY; Providers PARTIAL; Runtime READY; Host BLOCKED |
| FT006 | BLOCKED | Harness READY; Scene READY; Lore BLOCKED; Memory BLOCKED; Shadow PARTIAL; UI PARTIAL |

The machine-readable source of truth is `createFunctionTestBlockerMatrix()` in `src/phase1-readiness-v2.js`.

Core-side or assembly-rehearsal readiness is never converted into a live PASS.
