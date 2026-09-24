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
