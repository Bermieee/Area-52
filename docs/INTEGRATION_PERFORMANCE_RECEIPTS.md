# Integration Performance Receipts

Wave 6 prepares explicit performance measurement state for:

- event validation;
- contract normalization;
- Gather;
- Context Compiler;
- Context Seal;
- PromptPlan;
- Nexus replay;
- diagnostic reconstruction;
- manifest verification.

The acceptance harness measures these operations with the browser-neutral monotonic clock during CI and records `MEASURED` plus latency in milliseconds. Final exact-head CI output prints each measured value.

Where a future integration stage has not actually run, its correct state is `NOT_MEASURED`; missing measurements must never be represented as zero.
