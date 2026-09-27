# Worker branch context

`Development-Worker-1`, `Development-Worker-2`, `Development-Worker-3`, and
`Development-Worker-4` each start from the same integrated `main` commit. All
current documentation under `docs/` is shared by all four branches. Worker
ownership changes where new work is done; it does not remove access to other
subsystem contracts or handoffs.

The integrated Workers 1–4 baseline is `e1828ac19a99df9bdefb61cfdae6e02005d5339f`
(PRs #278 and #279). Check the current `main` head before starting a wave;
this SHA identifies the initial common base, not a permanent merge target.

Five documents existed only on older branches. Copies are retained in
`docs/archive/legacy-branches/` so workers can inspect their reasoning and
contracts. Their branch status and test results are historical; verify any
claim against current code and current owner receipts before applying it.

| Archived document | Source branch | Context |
| --- | --- | --- |
| `JEV_DECISION_SITE_RECEIPT_INVENTORY.md` | `Development-Sidecar/Jev` | Jev decision-site and owner-receipt inventory |
| `WORKER2_LAYERED_SCATTER_HANDOFF.md` | `Development-Sidecar-Jev-Layered-Scatter-W2` | Earlier layered-scatter handoff; PR #262 was left out of the final integration in favor of #265 |
| `WORKER2_LAYERED_SCATTER_JEV_WAVE21_HANDOFF.md` | `Development-Worker2-Layered-Scatter-Jev` | Earlier Worker 2 Sidecar/Jev wave |
| `UI_CORE_WORKER3_PRODUCER_INSPECTOR_WAVE.md` | `Development-UI-Worker3` | Earlier UI producer and inspector wiring |
| `LIFECYCLE_CAUSAL_RECONCILIATION.md` | `feature/lifecycle-causal-telemetry` | Lifecycle obligation and causal telemetry design |

These documents are preserved for reference. Archiving a handoff does not
import its branch's code or promote its old validation to a current pass.
