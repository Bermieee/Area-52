# Coprocessor Wave 15 Acceptance

Status: **NATIVE SIDECAR SWARM / JEV SUBSYSTEM READY FOR BRAIN ASSEMBLY; LIVE PROVIDER ACCEPTANCE STILL OPERATOR-GATED**

## Scope completed in this lane

Wave 15 adds a native optional swarm coordinator above the connection/capability layer. It dynamically plans specialist jobs from current turn signals and live capability inventory, serializes multiple jobs on one bounded resource, uses additional resources only when useful, validates results against current revisions, rejects post-deadline/post-seal work, emits a Brain-Core contribution, and provides a bounded serializable checkpoint/resume contract.

Jev now participates through the same connected-resource lifecycle and concurrency accounting instead of bypassing resource load/health tracking.

The planner no longer contains fixed Ember Tavern / Sun Blade / named-character routing assumptions.

## Evidence classes

CI proves local deterministic execution and host timing only. It does not prove an external model/provider.

The opt-in commands are:

- `npm run smoke:swarm:live`
- `npm run smoke:sidecar-jev:live`

A live-provider claim requires an actual configured endpoint and `MEASURED_LIVE` provenance. The native swarm smoke reports `realProviderCallObserved` and `ft005LivePass`; the Jev smoke reports `realProviderCallObserved`, `jevLivePass`, and the observed deterministic-vs-Jev usefulness outcome.

## Cross-lane boundary

Worker 1 still owns final CognitiveChoiceReceipt, Truth, Precision, settlement, canonical mutation, final evidence admission and Context Seal.

Worker 3 owns presentation. The backend host/read/action contract is ready for UI binding.

The full #180 and live Brain #224 gates remain open until an operator-configured provider and assembled SillyTavern path are exercised.
