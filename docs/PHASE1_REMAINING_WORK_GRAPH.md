# Phase 1 Remaining-Work Graph

Wave 6 makes remaining Phase 1 work a dependency graph instead of an informal checklist.

## Gate

`PHASE1_GATE = BLOCKED`.

It depends on the remaining Function Tests and integration requirements. No automatic Phase 2 promotion exists.

## Main live path

FT002 live requires:

- accepted Scene contracts;
- accepted Coprocessor contracts;
- Runtime;
- real `main` assembly;
- live browser/SillyTavern gate.

FT005 live requires:

- Core structured-output validation;
- real provider execution/fallback;
- Runtime;
- real `main` assembly;
- live browser/SillyTavern gate.

FT003 remains blocked by real Memory/Sensory. FT004 remains blocked by real Lore/Sensory. FT006 remains blocked by real Lore, real Memory and representative integrated qualification; Nexus live shadow and UI acceptance remain partial.

The machine-readable graph is produced by `createPhase1RemainingWorkGraph()`.
