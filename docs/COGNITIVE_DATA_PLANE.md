# Cognitive Data Plane — Phase 1 Wave 2

Default rule: **move references first; fetch data only when needed**.

The browser-facing Sidecar transports compact artifact references, small typed payloads and bounded slices where possible. The owning Cognitive Repository retains the underlying artifact data.

`CognitiveDataPlane` accepts any repository adapter implementing the Core public `get(domain,id,{revision})` contract. It creates/consumes Artifact Registry-compatible references and does not own persistence.

## Transport classification

| Candidate | Area-52 classification | Adopted in browser runtime |
|---|---|---|
| structuredClone / JSON baseline | BROWSER_NATIVE | yes |
| in-process artifact reference | BROWSER_NATIVE | yes, default |
| Arrow IPC / RecordBatch | LOCAL_SERVICE | no; optional future adapter benchmark |
| local socket | NODE_SIDECAR_ONLY | no |
| shared memory / mmap | NODE_SIDECAR_ONLY | no |
| ZeroMQ | LOCAL_SERVICE | no |

No Arrow, ZeroMQ, Python or shared-memory dependency is added to the SillyTavern extension.

## Benchmarking

`benchmarkReferenceTransfer()` measures actual serialized byte size plus JSON round-trip and `structuredClone` timing for payload vs reference. Metrics that JavaScript cannot honestly expose—copy count, host memory pressure and repository transport latency—are marked `NOT_MEASURED` instead of zero.
