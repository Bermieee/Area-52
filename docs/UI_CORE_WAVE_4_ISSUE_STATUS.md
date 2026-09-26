# UI.Core Wave 4 — Issue Disposition

## #128 UI workspace/inspector discovery for registered subsystems

Primary Wave 4 card.

Closure requires the synthetic unknown-subsystem proof to pass:

- data-only versioned descriptor;
- dynamic workspace;
- dynamic inspector;
- lazy telemetry;
- Action Router path;
- degradation/recovery;
- unmount/unregister cleanup;
- collision/invalid-descriptor safety;
- existing UI regression pass;
- no subsystem-specific Application Shell logic.

The issue may close only after committed validation proves these conditions.

## #33 Runtime telemetry

Do not close in this wave.

Wave 4 materially advances integration readiness by providing a UI-side adapter against the accepted Runtime Wave 1 contract and a contract-level safe-yield/park/resume fixture.

Remaining acceptance: real Runtime and UI must coexist on an integrated branch and pass end-to-end telemetry consumption.

## #86 Coprocessor telemetry

Do not close. Wave 3 UI display work remains valid, but Wave 4 does not integrate the real Sidecar/Jev publisher.

## Framework cards not owned by UI Wave 4

Do not close or move merely because UI.Core can consume future typed contracts:

- #121 Subsystem Manifest + Service Registry
- #122 Artifact Type Registry
- #123 Contract versioning/migrations
- #125 Service dependency graph/degradation
- #127 Experimental/Shadow/Active/Deprecated lifecycle
- #129 Cognitive service conformance kit
- #130 Golden-world plugin certification
- #131 Event type registry

UI.Core implements only a presentation extension registry and adapter seams.
