# UI.Core Wave 3 — Issue / Card Status

## Active cross-lane cards

### #33 Runtime telemetry + lightweight brain activity signals
**State:** leave open.

UI-owned portion completed in Wave 3:
- runtime summary;
- worker lifecycle telemetry;
- queue/utilization/capacity signals;
- recovery/fallback visibility;
- batch/yield/checkpoint visibility;
- paged/on-demand Work Ledger inspection;
- keyed telemetry coalescing.

Remaining dependency:
- real \`Development-Worker-Director\` runtime publisher/integration and its backend acceptance evidence.

### #86 Cognitive Coprocessor telemetry + observability
**State:** leave open.

UI-owned portion completed in Wave 3:
- capability/task/layer/result-class telemetry;
- queue/execution latency;
- retries/validation;
- stale drops;
- dedupe;
- warm/cache hits;
- fallback;
- result destinations;
- Context Seal contribution;
- late routing;
- explicit on-demand debug payload boundary.

Remaining dependency:
- real \`Development-Sidecar/Jev\` telemetry publisher/execution integration and its backend acceptance evidence.

## Supported but not owned / do not close from Wave 3 UI work

- #8 Precision reranking;
- #9 Reflection/consolidation;
- #39 Learning feedback;
- #42 FlashRank/ColBERT benchmark;
- #43 Context compression;
- #75 Cognitive Coprocessor epic;
- Scene Intelligence backend systems.

Wave 3 fixtures exercise these concepts only for observability contracts. They do not satisfy backend ownership.

## Project workflow note

Issue comments were posted when Wave 3 UI work began and again at completion. If GitHub Projects automation maps issue closure/status automatically, #33/#86 must remain open until all owning lanes satisfy their acceptance criteria.
