# Integration closure — Workers 1–3

Date: 2026-09-29

## Authority and integrated source heads

Common integration base: `1de19e82a0083d5dfa70175bc0434dae45ee676c`.

The integration preserves the three worker histories through merge commits on `Development-Worker-4`:

- Worker 1 / PR #326: `e1ca0ddf9b22fbd090820f30356229add683effe` → integration merge `545c76131e04a79466b50a8f4e2fb64253a41cff`.
- Worker 2 / PR #328: `590ddcfca365861b1300850e4b2ec26325fd7893` → integration merge `71fd9a07d95f2b6d7a0f0e5949183c4423fc967e`.
- Worker 3 / PR #327: `9d2f3c42a62be327a93106a362de56b1f34dcf91` → integration merge `346faeafec239a632a0d56d6ad54911ca91acb56`.

No worker branch was rewritten or force-pushed.

## Worker dispositions retained

Worker 1: rows 7/10/14/15/19/23/24/25 remain FIXED; row 20 remains VERIFIED_BY_DESIGN. Row 18 remains OPEN_WITH_EVIDENCE: the bounded examined working set still has no continuation across omitted middle candidates.

Worker 2: rows 40/45/46/49/50 remain FIXED; rows 61/64 remain VERIFIED_BY_DESIGN. Row 65 is closed by this integration only after installing the shared transport contract at the real deployment consumers.

Worker 3: rows 29/30/31/32/35/62 remain FIXED; row 33 remains VERIFIED_BY_DESIGN + OBSERVABILITY; row 59 remains VERIFIED_BY_DESIGN. The final Scene/Lore prompt tests establish partial-Lore accounting and actual host insertion behavior; this integration does not repeat the earlier stronger claim that Lore definitely never reached the provider.

No VERIFIED_BY_DESIGN row was promoted to FIXED merely because the branches were assembled.

## Row 65 — FIXED at installed deployment consumers

Code/test integration head: `f640fce9bba1d40791e890e4be3470580f83fdb1`.

`src/deployment/brain.js` now uses Worker 2's `createMemoryTransportExcerpt()` at both remaining installed consumers:

1. Memory consolidation evidence keeps the existing 2,400-character physical excerpt boundary while carrying explicit `MemoryTransportCoverage` and `MemoryTransportDrillback` structured facts. The consumer resolves the complete episode `sourceRevisionRefs` manifest through `memoryReferenceValues()` instead of relying on the compatibility array view.
2. Jev evidence keeps the existing 1,200-character summary boundary while carrying transport coverage and drillback metadata beside the bounded summary and existing provenance refs.

Short inputs still return the same text as the old `.slice(...)` behavior. Long inputs now state omitted coverage instead of silently presenting the prefix as complete, and exact source/revision recovery remains available.

Consumer-path regressions were added to:
- `tests/memory-cognition-completion.test.mjs`: a >2,400-character real deployment consolidation request must expose omitted coverage and exact drillback in the provider request.
- `tests/deployment-brain.integration.test.mjs`: a connected deterministic Jev provider captures the real deployment request and verifies the 1,200-character bound plus coverage/drillback metadata.

Measured physical limits are intentionally unchanged: 2,400 characters for consolidation excerpts and 1,200 characters for Jev evidence summaries. The Jev request retains the existing bounded evidence/nominations behavior. These are transport limits, not claims of complete source coverage.

## Runtime and authority reconciliation

Worker 2's persisted consolidation review continuation and Worker 3's Scene/Jev terminal cancellation and lease-release work coexist in the combined tree. The worker deliveries did not have a direct production-file conflict in these owners: Worker 2 intentionally left `src/deployment/brain.js` for integration, while Worker 3 supplied the deployment/Scene/Jev side. Row 65 was therefore applied after all three merge commits.

The durable Memory review continuation remains Runtime-owned and resumable; provider/Director execution leases remain terminally releasable on timeout/cancel/failure. The final exact-head tests below are the acceptance authority for their combined behavior.

## Assembly reconciliation

The assembly overlay was updated from the actual combined-tree Git blob digests, not from stale status summaries.

Exactly 19 changed paths intersect the copied lane manifests:

- 10 Worker 1 Lore paths from `worker-1-assembly-addendum.md`.
- 5 Worker 2 Memory paths: `src/memory-experience-store.js`, `src/memory-historian.js`, `src/memory-summary-hierarchy.js`, `src/memory-temporal-producer.js`, and `tests/memory-wave4.mjs`.
- 4 Worker 3 tracked paths: `src/scene/prefetch-trigger.js`, `src/scene/scene-retrieval.js`, `src/ui-core/wave8-cognition.js`, and `tests/runtime-fabric.mjs`.

Worker 3's combined-tree `tests/runtime-fabric.mjs` blob is `dcf10ee7b41d4a43bf6ce16c3d1d54099cefe52c`, replacing the stale overlay digest that caused its source-PR assembly job to fail.

No unrelated path was broadly blessed. Paths intentionally withheld by the prior assembly drift review remain outside the reconciliation overlay. `src/deployment/brain.js` and the new row-65 tests are not copied lane paths, so they are recorded here and validated by the deployment/full-suite gates instead of being added as fictitious lane copies.

## Verification authority

Documented runtime: Node.js 22, matching the repository integration workflows.

Targeted regression commands for the combined code include:

```sh
node --test tests/deployment-brain.integration.test.mjs
node --test tests/memory-cognition-completion.test.mjs
node --test tests/worker3-scene-jev-publication.test.mjs
node --test tests/deployment-live-host.test.mjs
node --test tests/main-owner-integration.test.mjs
node scripts/verify-development-deployment.mjs
```

Final exact-head gates include:

```sh
npm test
npm run check
node --test tests/deployment-brain.integration.test.mjs tests/deployment-live-host.test.mjs tests/deployment-install-contract.test.mjs
node -e "globalThis.Buffer=undefined; import('./index.js').then(()=>console.log('INSTALLED ROOT IMPORT PASS'))"
node scripts/verify-development-deployment.mjs
```

The exact final PR head, command outcomes, pass/fail counts, and hosted CI status are recorded on integration PR #332 and in the merge report after the final exact-head workflows complete. A queued or skipped workflow is not treated as a pass.

## Explicit residuals and live acceptance boundary

- CAP row 18 remains open: Lore examined-page continuation across the omitted middle is not implemented by Worker 1.
- All other explicit ledger residual/VERIFIED_BY_DESIGN classifications are retained unless their owner closure explicitly fixed them.
- Real SillyTavern/browser/provider acceptance is not established by deterministic or mock-host tests. It remains the next live test after merge.
- Live acceptance should specifically exercise Scene completion, Jev timeout/recovery, admitted Lore appearing exactly once in the final host prompt, and Memory recall/correction after reload.
