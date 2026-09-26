# Context Sizing and Token Ownership

There is no universal Area-52 token count because tokenizer behavior is model/profile dependent.

## Context Compiler

Compiler-side neutral sizing is model independent:
- serialized UTF-8 bytes;
- semantic fact count;
- active-thread count;
- total semantic entry count;
- per-section counts;
- average bytes per semantic entry.

CompilerReceipt therefore exposes NeutralSemanticSizing with tokenEstimate = null and modelProfileId = null.

## Adaptive Context

Adaptive Context owns model/profile-specific sizing:
- deterministic/model-specific token estimator identity;
- estimated section tokens;
- protected minimum floor;
- requested/allocated prompt budget;
- model context limit/reserve;
- compact/rich representation selection;
- dropped/deferred optional material.

PromptPlan diagnosticReceipt records the estimator used. ModelProfile carries tokenizer/estimator identity and model limits.

This split satisfies #10's token-estimation requirement without pretending that the model-independent compiler can predict every tokenizer family.
