# Cognitive Coprocessor Batch Adapter

## Ownership

Sidecar does not implement a private scheduling/batch loop.

`SidecarBatchAdapter` prepares a submission compatible with Runtime's common Batch Engine:

```
prepare
 -> Runtime executes slice
 -> validate slice
 -> Runtime checkpoint/commit
 -> safe yield boundary
 -> next Runtime slice
```

## Adaptive sizing

`AdaptiveSidecarSlicePolicy` considers:

- item count;
- estimated tokens per item;
- provider context limit;
- reserved output tokens;
- previous latency;
- output expansion;
- provider error pressure;
- REQUIRED/OPPORTUNISTIC/DEFERRED class.

It emits a maximum slice-unit recommendation that Runtime remains free to constrain further.

## Partial completion

`PartialResultAccumulator` records successful committed slices independently from failures.

A later failed slice does not erase earlier valid committed slices.

The durable production checkpoint owner remains Runtime Work Ledger.

## Yield

Runtime obligations carry:

- checkpoint boundary;
- max units/checkpoint;
- yield safety;
- max uninterrupted slice recommendation;
- batchability/slice policy;
- partial-result semantics.

Runtime owns when work actually yields/parks/resumes.
