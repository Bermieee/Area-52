# Cognitive Coprocessor Wave 1 — Integration Compatibility

## Runtime Fabric

Inspected live Runtime checkpoint:

`Development-Worker-Director@890f8576bcfcc4c056b959271027242dc6af7d7c`

Wave 2 adds version-aware capability negotiation and dynamic event types.

Sidecar compatibility exports:

- `toRuntimeCapabilityDescriptor(profile)`;
- `capabilityRequest(task)`;
- `toRuntimeObligation(task)`;
- `runtimeTurnEventTypeDescriptor()`;
- `toRuntimeTurnEventEmission(turnEvent)`.

### Ownership boundary

Sidecar declares:

- capability requirements/versions;
- cognitive layer;
- HOT/DEEP placement metadata;
- result class;
- deadlines;
- batch/checkpoint/yield metadata;
- revision fences;
- result contract.

Runtime owns:

- worker selection;
- scheduling;
- resource leases;
- Work Ledger;
- Batch Engine;
- retries/recovery at runtime execution level;
- yield/park/resume;
- queue/layer execution.

No Sidecar adapter contains a scheduler.

## Nexus Cognitive Core

Inspected live Nexus checkpoint:

`Development-Nexus@327c120bc8826e33c07766d94c88dd7d8b82d352`

Relevant stable boundaries:

- Result Bus receives normalized cognitive results and performs revision-aware FRESH/STALE/INVALID routing;
- post-Seal fresh foreground results route NEXT_TURN/BACKGROUND according to class;
- GenerationContextSeal freezes packet bytes and stable hash;
- Adaptive Context Runtime begins after the seal and produces disposable PromptPlan/model delivery artifacts.

Therefore the Sidecar Wave 1 rule remains valid:

> late cognitive work may route forward, but cannot alter the sealed generation packet.

## Golden-world compatibility

Current Nexus golden world preserves:

- Ember Tavern CURRENT destroyed;
- Sun Blade historical Tavern location;
- Sun Blade current location UNRESOLVED/unknown;
- no false current Blade-at-Tavern claim.

The Sidecar fixture matches this truth model.

## Still requiring integrated-build proof

The adapters prove contract compatibility but are not a shared-branch integration test. Keep cross-lane cards open where their acceptance requires actual Runtime/Nexus/UI coexistence.
