# Diagnostic Cross-System Incident

Wave 6 includes one deterministic incident crossing Scene, Coprocessor/worker timing, KnowledgeEvidence, Truth/Gather and the sealed generation.

Scenario:

- stale Scene result from scene revision 3 while the sealed generation is revision 4;
- optional worker result arrives after seal;
- historical Lore evidence says an older location;
- current OBSERVED correction carries the current state.

Expected explanation:

- stale Scene result -> **REJECTED**, reason `STALE_SCENE_REVISION`;
- late optional result -> **DEFERRED**, reason `TURN_ALREADY_SEALED`;
- historical Lore -> **ENTERED** as historical support only;
- current observed correction -> **ENTERED** as current observed evidence;
- cross-temporal disagreement -> **UNRESOLVED_OR_TEMPORALLY_DISTINGUISHED**, never resolved by rank alone.

The receipt is diagnostic/read-only and has no mutation authority.
