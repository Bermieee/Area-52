# Framework Kernel Wave 1 Acceptance

## Starting point

Branch: `Development-Nexus`

Accepted kickoff SHA: `327c120bc8826e33c07766d94c88dd7d8b82d352` (`fix(context): complete defer and extension acceptance`). The branch was verified identical to that SHA at Wave 1 start.

## Deterministic Framework acceptance

`tests/framework-wave1.mjs` covers registration, malformed/duplicate contracts, artifact authority, migration safety, required/optional dependencies, cycle rejection, capability discovery, repository adapters, lifecycle, SHADOW fencing, event compatibility/dedupe, conformance negatives, certification gating, browser compatibility, assembly verification, the unknown-subsystem golden world and stress.

`tests/framework-wave1-harness.js` is the synthetic unknown subsystem fixture.

`scripts/framework-wave1-acceptance-report.mjs` runs the synthetic lifecycle golden world and both repository adapters.

`scripts/framework-browser-acceptance.mjs` scans canonical Framework modules for Node-only assumptions.

## Core audit

### #10 Context Compiler

Existing Wave 3 code already demonstrates dedupe/compatible support merging, temporal qualifiers, unresolved preservation, sparse output, provenance, correctness-preserving rich fallback, precision-guided ordering and model-independent packets. Adaptive Context owns provider/model rendering downstream. This Wave does not rewrite the compiler. Issue closure should remain conservative until the issue's token-estimation responsibility is explicitly mapped to either compiler-side estimation or the downstream Adaptive Context estimator contract.

### #37 Settlement Engine

Existing SettlementBoundary/SettlementEngine behavior already follows schema/evidence/freshness/owner/approval/Settlement ordering. Existing Wave 3 tests prove unsupported owners do not mutate, stale/evidence-invalid proposals do not partially mutate, approval-required paths do not mutate before approval, Result Bus receipts do not grant authority, and temporal history survives supersession. No Settlement rewrite was needed.

## Shared/integration cards

#125 remains shared with Runtime for execution response. #131 remains shared with Runtime for Event Spine delivery. #185 remains integration-wide and cannot be closed by browser-safe Framework code alone. #186 receives the lane-origin and deterministic verifier contract but should remain open until a fresh `main` assembly is actually reconstructed and verified.

## Live-host scope

A green Worker 1 branch is not a claim of a new live SillyTavern integration pass. Live integration belongs to the assembled `main` acceptance surface.
