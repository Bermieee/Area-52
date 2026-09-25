# Prompt Integrity Policy

`PromptIntegrityGuard` is the deterministic boundary between planning and model delivery.

It validates:

- seal ID and packet hash;
- semantic revision dependencies;
- post-seal semantic injection;
- duplicate semantic facts;
- slot/role ownership;
- authority escalation;
- temporal stripping/state mismatch;
- protected-content retention;
- semantic retention of Wave 3 current/historical/unresolved facts;
- budget domination.

The resulting receipt contains violations/warnings plus protected-content, semantic-retention, revision, authority, temporal and budget checks.

## Adapter integrity

After rendering, the runtime compares the adapter's semantic manifest and seal identity to the accepted PromptPlan. A model adapter that changes HISTORICAL to CURRENT, adds/removes a fact or changes the seal is rejected.

## Failure behavior

Integrity failure is explicit. Main receives no accepted corrupted delivery result.

No recovery path mutates canonical state.
