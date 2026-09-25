# FT002 Assembly Rehearsal

Status: **ASSEMBLY REHEARSAL GREEN / LIVE SILLYTAVERN PENDING**.

This rehearsal uses the accepted Scene checkpoint and accepted Coprocessor/Core contracts. It does not close #177 and does not claim FT002 PASS.

Covered deterministic scenarios:

- stable dialogue;
- location transition;
- doorway false cut;
- cast entrance/exit;
- mentioned-not-present;
- time shift;
- flashback;
- parallel Scene;
- interrupt/resume;
- stale Scene result;
- corrected Scene inference.

All scenarios retain Scene/source revision fences, keep `MENTIONED_ONLY` outside active cast, prevent stale Scene results from entering the active seal, preserve flashback/parallel chronology semantics, and keep FT001 Ember Tavern truth/history/unresolved invariants intact.

Live blockers remain the assembled `main` path and direct SillyTavern execution.
