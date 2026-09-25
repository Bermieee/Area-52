# UI.Core Wave 5 — Product Activity

## Goal

Brain Activity translates typed runtime/UI signals into human-readable product activity without becoming a second telemetry system.

Examples:

- worker park/yield -> “Background work paused while foreground work runs.”
- foreground L1 activation -> “Foreground cognition is active.”
- batch progress -> “Background study N% complete.”
- claim change -> “Current truth was checked.”
- reflection change -> “Memory learning was updated.”

## Coalescing

`ProductActivityFeed` is keyed and RenderScheduler-driven. Repeated transitions for the same activity key replace pending presentation state before render. The Wave 5 stress test sends 1,500 rapid transitions for one worker and requires a single product render invalidation.

The feed is bounded and does not load Work Ledger records.

## Notifications

Product notifications remain selective. `NotificationCenter` now supports acknowledge, dismiss, list, and clear state while preserving the existing toast signal for newly pushed notifications. Acknowledgement/dismissal uses a separate lifecycle signal and does not replay toast notifications.
