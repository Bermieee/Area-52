# Area-52 Precision Integration Contract

## Boundary

Development-Nexus defines the contract.

Production reranking engines belong to the specialist Sidecar/Jev lane.

Wave 3 intentionally does not install FlashRank, ONNX Runtime, TensorRT, ColBERT, BGE or MiniLM.

## Input

A bounded candidate set plus:

- query;
- intent;
- source revision fences;
- world revision;
- scene revision;
- model/profile selection;
- runtime profile.

## Output

`PrecisionResult` contains:

- candidate ID;
- raw score;
- normalized score;
- final rank;
- model/profile ID and revision;
- runtime/backend profile;
- latency;
- truncation metadata;
- FRESH / STALE;
- source/world/scene revision fences.

## Routing

Precision output returns through Result Bus before publication.

A precision result is not authoritative truth and cannot mutate memory.

Stale precision cannot affect the current foreground packet.

## Deterministic Wave 3 reference

The reference stub exists only to prove integration semantics.

Intent-opposite fixtures include:

- kill dragon / heal dragon;
- enter dungeon / leave dungeon;
- trust Mara / distrust Mara;
- weapon intact / destroyed;
- character present / departed;
- tavern current / historical.

## Failure

If precision is unavailable or throws, publication uses the existing deterministic ordering/fusion path and records PRECISION_FALLBACK.

Generation is not blocked indefinitely.

## Replaceability

The rest of Area-52 consumes normalized `PrecisionResult` and must not depend on a specific model/runtime.

## Benchmark

Wave 3 tests prove opposite-intent ordering, normalized metadata, stale precision metadata, Result Bus routing and failure fallback.
