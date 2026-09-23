# Cognitive Coprocessor Wave 2

## Objective

Wave 2 turns the Wave 1 swarm skeleton into executable foreground cognition through replaceable provider/model adapters.

```
TURN_EVENT
 -> bounded Dynamic Fan-Out
 -> capability-defined specialist tasks
 -> provider-neutral execution
 -> strict structured parsing/validation
 -> normalized CognitiveWorkerResult
 -> deterministic Gather
 -> GatherCompilerInput
 -> external Result Bus / Context Seal / PromptPlan boundaries
```

Workers advise. Workers never gain canonical authority from valid JSON or provider identity.

## Executable foreground specialists

- Historian — reference-based evidence relevance.
- Graph Walker — bounded graph/current/historical/unresolved reference traversal.
- Character Green Room — batched ephemeral INFERRED scene state.
- Truth / Precision — semantic conflict judgment + candidate ranking while preserving uncertainty.

## Provider layer

Wave 2 adds:

- DeterministicProviderAdapter;
- OpenAICompatibleProviderAdapter;
- ProviderAdapterRegistry;
- SpecialistExecutionLayer;
- ProviderExecutionRouter.

Provider configuration is external. No API keys, endpoints, models, pricing or credentials are committed.

Native function/tool calling is not used.

## Runtime ownership

Sidecar nominates compatible providers and exports Runtime-ready task/worker descriptors.

Runtime still owns scheduling, worker/resource leases, Work Ledger, common Batch Engine, yield/park/resume and recovery.

## Nexus ownership

Sidecar produces normalized CognitiveWorkerResult / GatherCompilerInput and Result Bus-compatible envelopes.

Nexus still owns Result Bus, Truth publication, Context Compiler, Context Seal, Adaptive Context Runtime, PromptPlan and Prompt Integrity.

## Function Test 001

`runFunctionTestTurn()` exposes:

- fanOutPlan;
- runtimeSubmissions;
- workerResults;
- gatherBundle;
- foregroundQuorumReceipt;
- lateResults;
- compilerInput;
- sealCompatibilityReceipt;
- telemetrySummary;
- optional externally-injected compile/seal/PromptPlan results.

Default fixtures are explicit and deterministic.

## Streaming truth

Wave 2 includes only bounded OBSERVE mode.

It buffers clauses/sentences, logs deterministic/optional semantic observations, and never rewrites or blocks generation.

Verified chunks / hard intercept remain deferred.
