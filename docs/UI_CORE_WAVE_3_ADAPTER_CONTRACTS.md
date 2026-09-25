# UI.Core Wave 3 — Hardened Adapter Contracts

**Owner lane:** \`Development-UI\`  
**Wave 2 baseline:** \`aa466daadfed9f335993b83c6bfd4b44a32f41bc\`

Wave 3 keeps the four Wave 2 seams intact and extends observability without importing backend implementation objects into UI.Core.

## Preserved Wave 2 contracts

- \`SceneUIAdapter\`
- \`RuntimeUIAdapter\`
- \`CoprocessorUIAdapter\`
- \`KnowledgeUIAdapter\`

## Runtime telemetry extensions

\`RuntimeUIAdapter\` remains the runtime surface and now supports:

- \`getTelemetrySummary()\`
- \`getWorkerTelemetry(workerId)\`
- \`getLedgerTaskDetail(taskId)\`
- \`getRecoveryPage({ offset, limit })\`

The summary is intentionally lightweight. Worker recovery history, complete Work Ledger dependencies/slices/revision fences, and other detail are explicit inspection reads.

High-frequency signals carry only the changed metric or worker/batch identity. They do not continuously clone complete worker arrays, Work Ledger state, prompts, responses, or brain snapshots.

## Coprocessor telemetry extensions

\`CoprocessorUIAdapter\` now supports:

- \`getCoprocessorTelemetry(turnId)\`
- \`getWorkerTelemetryDetail(workerId)\`
- \`getDebugArtifact(ref)\`

Normal telemetry omits raw model payloads. Full prompts/responses/debug artifacts are explicit on-demand diagnostic reads.

Observable result destinations are:

- \`CURRENT CONTEXT\`
- \`NEXT TURN\`
- \`BACKGROUND\`
- \`STALE / DROPPED\`
- \`FALLBACK\`

These labels describe publication/routing state only. UI.Core does not own Gather, Context Seal, freshness, dedupe, fallback, or worker execution semantics.

## MemoryStateUIAdapter

New read-only state/memory observability surface:

- \`getStateOverview()\`
- \`getMemoryRecord(id)\`
- \`getSettlementTrace(id)\`
- \`getReflections()\`
- \`getEpisodicChain(id)\`
- \`subscribeMemory(handler)\`

It exposes the chain:

\`SOURCE -> DERIVED UNDERSTANDING -> PROPOSAL -> SETTLEMENT -> CURRENT / HISTORICAL / UNRESOLVED STATE\`

The adapter reports authority/provenance/revision/settlement data but exposes no unrestricted mutation path.

## PrecisionUIAdapter

New implementation-neutral precision diagnostics surface:

- \`getPipeline()\`
- \`getCandidateFunnel()\`
- \`getCandidatesPage({ offset, limit })\`
- \`getCandidateDetail(id)\`
- \`getIntentOppositeFixtures()\`
- \`getRuntimeBenchmarks()\`
- \`getDeadlineState()\`
- \`subscribePrecision(handler)\`

The UI contract can display runtime/model/profile metadata but does not care whether the backend is FlashRank, ONNX Runtime, TensorRT, PyTorch, ColBERT, BGE, MiniLM, or a future implementation.

## Signal-first invariant

Wave 3 keyed/coalesced signals cover:

- worker transitions;
- queue depth;
- L0-L4 utilization;
- capacity;
- recovery/fallback;
- batch progress;
- candidate funnel stages;
- rerank progress;
- settlement/reflection state;
- Context Seal / late-result activity.

Expensive details remain pull-on-inspect. This prevents telemetry from becoming cognitive workload.

## Fixture/real adapter parity

\`createBrainDashboard({ adapters })\` accepts a real Wave 3 adapter bundle.

When no adapters are supplied, \`createEmberTavernWave3AdapterBundle()\` provides deterministic fixtures implementing the same contracts. Replacing fixtures therefore does not require rewriting workspaces or widgets.
