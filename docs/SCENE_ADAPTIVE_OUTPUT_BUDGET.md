# Adaptive Scene extraction output budget

PR #311 introduced adaptive Scene generation allowances. The allowance remains valid, but the Scene task's foreground deadline is **not** a provider lifetime.

- The final JSON estimate scales with the bounded narrative input and known cast/object/relationship/thread counts.
- Provider generation allowance adds reasoning headroom equal to three times that estimate. This is a planning heuristic, not measured model tokenization or a guarantee of completion.
- Qualified output capacity and remaining context capacity constrain the provider request. Insufficient capacity fails explicitly; evidence is not silently shortened to fit.
- Foreground Scene observation is OPPORTUNISTIC. Its foreground budget is the #94/#90 quorum/fallback window only. Missing that window does not abort otherwise-valid provider work and does not become a provider-qualification latency ceiling.
- POST_RESPONSE Scene observation is DEFERRED. It has no fabricated ten-second foreground window.
- Provider lifetime is bounded independently by the connected resource's configured transport timeout, provider capacity/concurrency, explicit cancellation, disconnect/credential changes, and source/Scene validity. Provider/network timeout remains a typed provider failure.
- Fresh completion after foreground closure is carried by the existing Runtime result-ready envelope and Core Result Bus. Foreground Scene work is forwarded to `NEXT_TURN`; post-response DEFERRED work is routed `BACKGROUND`.
- Forward/background routing never reopens Gather or Context Seal. A later Scene-owner acceptance may update CurrentScene for future turns only after exact chat/source/Scene revision validation.
- Edits, deletes, chat supersession, newer same-lane Scene work, and explicit operator cancellation request exact task cancellation through the existing Runtime/resource execution path.
- Safe generation-budget values remain in resource/execution diagnostics. No raw narrative, provider response body, credentials, or hidden reasoning are retained.

The resource transport timeout is operationally distinct from the foreground quorum deadline: it bounds a physical network/provider invocation so dead connections cannot occupy resource capacity indefinitely. It is configured on the resource connection (default 30 seconds for the OpenAI-compatible adapter) and is not derived from the 1.2-second Scene foreground budget.

This correction addresses the local cancellation observed in `Area52-Diagnostics-20260927-224810.json`. It does **not** claim to fix browser long tasks; synchronous browser work remains a separate performance problem.
