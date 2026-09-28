# Adaptive Scene extraction output budget

Base: main `5d120f7ed1f411f808c45fbb8bc2a67c025fba3d`.

The fixed 700-token Scene estimate no longer becomes its provider output cap.

- The final JSON estimate scales with the existing bounded narrative input and known cast/object/relationship/thread counts. Routing uses this estimate.
- Provider generation allowance adds reasoning headroom equal to three times that estimate. This is a planning heuristic, not measured model tokenization or a guarantee of completion. Total allowance therefore grows with the Scene workload rather than remaining fixed at 700.
- Qualified output capacity and remaining context capacity constrain the actual provider request. Insufficient capacity fails explicitly; evidence is not silently shortened to fit.
- Foreground and post-response Scene deadlines remain separate from output size. The invocation enforces the existing task deadline over the complete response, including providers that ignore abort. It requests cancellation and rejects late output before normalization or owner admission.
- Exhausting Area-52's local Scene time budget does not establish provider failure and does not place a healthy provider into cooldown. Existing post-response Scene work can still run under its own source/Scene fences. This is not continuation or admission of the cancelled foreground result.
- Safe generation-budget values reach existing resource receipts, Diagnostics journal drillback and JSON export. No new UI or raw narrative/response retention is added. Other specialist output policies are unchanged.

Validation: six new budget/deadline tests first exposed the fixed estimate/limit and unbounded wait. The combined focused provider, Scene/Jev, host, Diagnostics/export and profiling set passes 91 tests. Syntax/import checks pass. Installed GLM completion is still unproven; a larger allowance may increase provider work, so the independent foreground deadline is enforced.

A separate FT002 assembly file fails at construction because its Memory consolidation fixture lacks propose(input); the relevant fixture and Native Brain files are unchanged by this patch. No claim is made that the broad repository suite is green.
