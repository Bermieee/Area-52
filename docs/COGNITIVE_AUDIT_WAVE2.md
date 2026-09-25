# Cognitive Audit + Diagnostics Plane — Wave 2

Worker 1 Wave 2 adds explainability and forensic reconstruction on top of the accepted Framework Kernel without starting Phase 2 cognition.

The architecture keeps five concerns separate: Runtime Work Ledger (computation), Cognitive Transaction Ledger (meaningful knowledge decisions), lightweight telemetry (operational signals), diagnostics (on-demand explanations), and forensics (explicit persistent incident reconstruction).

Foreground integration is limited to small append/reference writes for source admission, proposals/Settlement, invalidation, Context Seal publication, late/stale external result routing and PromptPlan omission/defer decisions. Deep reconstruction is on-demand.

Runtime Work Ledger and Sidecar telemetry remain read-only external surfaces. UI receives typed transaction, diagnostic and forensic contracts but no UI workspace is implemented here.
