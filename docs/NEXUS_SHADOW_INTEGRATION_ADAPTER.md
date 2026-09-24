# Nexus Shadow Integration Adapter — Phase 1 Wave 5

Issue #13 status after Wave 5:

```text
REPLAY ADAPTER READY
LIVE SHADOW CONNECTION PENDING
```

Nexus remains authoritative. Area-52 is observation/evaluation-only.

Typed read-only surfaces are `NexusSnapshot`, `NexusTurnObservation`, `NexusContextCandidate`, `NexusWorkerObservation`, and `NexusShadowReplay`.

Recorded observations can be exported/imported and deterministically replayed into the existing shadow scorer without a live Nexus process.

The optional live seam accepts read callbacks only. Adapter outputs always report `readOnly:true`, `mutationAllowed:false`, and `liveAcceptance:false`. No Core contract binds directly to mutable Nexus runtime objects.

Issue #13 should remain open until the real read-only live connection acceptance is completed.

## Wave 6 live-seam hardening

The adapter now exposes typed read-only surfaces for turn feed, Smart Context, Character State/Durable Lore, Work Director observations, Jev decision observations and Prompt Loader packets. The implementation reports `LIVE_ADAPTER_IMPLEMENTATION_READY` while an unavailable real Nexus process is explicitly `RUNTIME_CONNECTION_NOT_EXECUTED`. Every surface remains `readOnly:true` and `mutationAllowed:false`.
