# Integration Browser Matrix V2

Wave 6 distinguishes evidence state rather than calling all browser compatibility “executed.”

Functional rehearsal:

- Core accepted checkpoint: executed browser-like source/runtime checks -> PASS;
- Coprocessor accepted checkpoint: imported accepted browser-like evidence -> PASS / REPLAYED;
- Scene accepted checkpoint: imported accepted browser-style evidence -> PASS / REPLAYED;
- Runtime accepted checkpoint: Worker 1 did not execute a dedicated browser-host qualification -> NOT_RUN / NOT_MEASURED.

Therefore integration browser acceptance remains **PARTIAL**, even though the Core source scan and runtime path are green.

This honesty is required for #185: Node or replay evidence cannot substitute for the final live SillyTavern gate.
