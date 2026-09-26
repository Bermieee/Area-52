# Area-52 installed SillyTavern live-test checklist

This checklist is for the Director after the Worker 3 owner-integration build reaches `main`. It does **not** close Trello #224 automatically.

## Before the run

- Install/update Area-52 from `main`; record the exact installed commit shown by Git/GitHub.
- Keep keys out of screenshots, diagnostics, Prompt Inspector exports, and chat logs.
- Start with **no Jev, Sidecar, Vectoring, external database, or orchestration service** configured. Native Brain must still operate.
- Select a real Lorebook from the current SillyTavern story. Do not substitute a hard-coded demo world or invented Lorebook identity.

## Required live pass

1. **Selected Lorebook → READY**
   - Select the real Lorebook.
   - Accept/submit it through the Area-52 Lore workspace.
   - Run due study until the owner reports retrieval-ready state.
   - Confirm source/lorebook identity and revision evidence refer to the selected book, not a fixture.

2. **Native Brain two-turn delivery and learning**
   - Run two ordinary turns in one chat with optional resources still absent.
   - For both turns confirm: prepared → sealed → exact model-request injection → assistant returned → learned.
   - Confirm the second turn can use learned/native state from the first without a Jev/Sidecar dependency.

3. **Lore review → Final Preview → approval → Settlement**
   - Make or select one reviewed Lore correction.
   - Inspect Draft Review and Final Preview before approving.
   - Approve explicitly, then Apply Settlement.
   - Verify Settlement produces source/revision receipts and triggers restudy/reload as needed.
   - Use Restore and verify restoration produces a new fenced revision path rather than silently rewinding bytes.
   - Confirm preview actions alone do not mutate canon.

4. **Source-backed retrieval / Truth**
   - Ask for information that requires the selected Lorebook.
   - Inspect retrieval, identity/graph traversal, Truth, rejected evidence, and revision fences.
   - Confirm stale or unrelated evidence is rejected and the delivered answer is backed by current source/revision evidence.

5. **Optional Jev / Sidecar**
   - Add one optional provider only after the native-only pass succeeds.
   - Record separately: configured, qualified, physically executed, returned, owner-accepted, admitted/delivered.
   - Confirm a physical provider success is not displayed as Context Seal admission by itself.

6. **Separate Vectoring execution**
   - Configure/test Vectoring separately if available.
   - Confirm its execution evidence is distinct from Jev/Sidecar execution and from owner acceptance.

7. **Forced provider failure / fallback**
   - Force a safe provider failure (for example disconnect or invalid test endpoint without exposing credentials).
   - Confirm Worker 1 retains scheduling/fallback authority, the failed physical attempt is visible, and native fallback remains usable.
   - Confirm no failed/stale/late optional result is admitted as owner evidence.

8. **Prompt Inspector**
   - Compare the Area-52 prepared/sealed context evidence with the actual model request.
   - Confirm the exact prepared payload is present once, no raw secret/key leakage occurs, and preview/dry-run evidence is not mislabeled as foreground delivery.

9. **Navigation/usability**
   - Open the Connections, Lore, Brain/forensics, Prompt/Context, and diagnostics surfaces.
   - Confirm controls are reachable, labels are readable, floating/navigation behavior is usable, and unavailable owner actions are hidden/disabled rather than simulated.

## Evidence vocabulary

Use these terms distinctly in screenshots/notes: **configured → qualified → physically executed → returned → owner accepted → admitted → delivered → learned**. Settlement is a separate Lore mutation lifecycle. A preview is not Settlement, and provider execution is not Context Seal admission.

## Pass boundary

Automated CI plus this checklist are complementary. Keep #224 open until the Director completes the installed SillyTavern pass and explicitly accepts the evidence.
